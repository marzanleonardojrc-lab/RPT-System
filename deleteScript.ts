import path from "path";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const firebaseConfig = JSON.parse(readFileSync(path.join(__dirname, "firebase-applet-config.json"), "utf8"));

function fromFirestoreValue(valueObj: any): any {
  if (!valueObj) return undefined;
  if ("stringValue" in valueObj) return valueObj.stringValue;
  if ("doubleValue" in valueObj) return Number(valueObj.doubleValue);
  if ("integerValue" in valueObj) return Number(valueObj.integerValue);
  if ("booleanValue" in valueObj) return valueObj.booleanValue;
  if ("nullValue" in valueObj) return null;
  if ("timestampValue" in valueObj) return valueObj.timestampValue;
  if ("mapValue" in valueObj) {
    const mapFields = valueObj.mapValue.fields || {};
    const res: any = {};
    for (const k of Object.keys(mapFields)) {
      res[k] = fromFirestoreValue(mapFields[k]);
    }
    return res;
  }
  if ("arrayValue" in valueObj) {
    const list = valueObj.arrayValue.values || [];
    return list.map((item: any) => fromFirestoreValue(item));
  }
  return valueObj;
}

function fromFirestoreObj(doc: any): any {
  if (!doc || !doc.fields) return {};
  const res: any = {};
  for (const k of Object.keys(doc.fields)) {
    res[k] = fromFirestoreValue(doc.fields[k]);
  }
  return res;
}

function toFirestoreValue(val: any): any {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === "string") return { stringValue: val };
  if (typeof val === "boolean") return { booleanValue: val };
  if (typeof val === "number") {
    if (Number.isInteger(val)) return { integerValue: String(val) };
    return { doubleValue: val };
  }
  if (Array.isArray(val)) {
    return {
      arrayValue: {
        values: val.map(toFirestoreValue)
      }
    };
  }
  if (typeof val === "object") {
    const fields: any = {};
    for (const k of Object.keys(val)) {
      fields[k] = toFirestoreValue(val[k]);
    }
    return {
      mapValue: { fields }
    };
  }
  return { stringValue: String(val) };
}

function toFirestoreDocBody(obj: any): any {
  const fields: any = {};
  for (const k of Object.keys(obj)) {
    fields[k] = toFirestoreValue(obj[k]);
  }
  return { fields };
}

class RESTQuery {
  private colName: string;
  private filters: any[] = [];
  private limitVal?: number;
  private orderField?: string;
  private orderDir?: "ASCENDING" | "DESCENDING";

  constructor(colName: string) {
    this.colName = colName;
  }

  where(field: string, op: string, value: any) {
    let restOp = "EQUAL";
    if (op === "==") restOp = "EQUAL";
    else if (op === "<") restOp = "LESS_THAN";
    else if (op === "<=") restOp = "LESS_THAN_OR_EQUAL";
    else if (op === ">") restOp = "GREATER_THAN";
    else if (op === ">=") restOp = "GREATER_THAN_OR_EQUAL";
    else if (op === "array-contains") restOp = "ARRAY_CONTAINS";

    this.filters.push({
      fieldFilter: {
        field: { fieldPath: field },
        op: restOp,
        value: toFirestoreValue(value)
      }
    });
    return this;
  }

  limit(n: number) {
    this.limitVal = n;
    return this;
  }

  orderBy(field: string, dir: string = "asc") {
    this.orderField = field;
    this.orderDir = dir.toLowerCase() === "desc" ? "DESCENDING" : "ASCENDING";
    return this;
  }

  async get() {
    const url = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/${firebaseConfig.firestoreDatabaseId}/documents:runQuery?key=${firebaseConfig.apiKey}`;
    
    let whereClause: any = undefined;
    if (this.filters.length === 1) {
      whereClause = this.filters[0];
    } else if (this.filters.length > 1) {
      whereClause = {
        compositeFilter: {
          op: "AND",
          filters: this.filters
        }
      };
    }

    const structuredQuery: any = {
      from: [{ collectionId: this.colName }]
    };

    if (whereClause) {
      structuredQuery.where = whereClause;
    }
    if (this.limitVal !== undefined) {
      structuredQuery.limit = this.limitVal;
    }
    if (this.orderField) {
      structuredQuery.orderBy = [{
        field: { fieldPath: this.orderField },
        direction: this.orderDir || "ASCENDING"
      }];
    }

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ structuredQuery })
    });

    const json = await res.json();
    const docsList = [];

    if (Array.isArray(json)) {
      for (const item of json) {
        if (item.document) {
          const docId = item.document.name.split("/").pop();
          const data = fromFirestoreObj(item.document);
          docsList.push({
            id: docId,
            exists: true,
            data: () => data
          });
        }
      }
    }

    return {
      empty: docsList.length === 0,
      docs: docsList
    };
  }
}

class RESTBatch {
  private writes: (() => Promise<void>)[] = [];

  update(docRef: any, updates: any) {
    this.writes.push(async () => {
      await docRef.update(updates);
    });
    return this;
  }

  set(docRef: any, data: any) {
    this.writes.push(async () => {
      await docRef.set(data);
    });
    return this;
  }

  async commit() {
    await Promise.all(this.writes.map(w => w()));
  }
}

class RESTFirestoreDoc {
  private colName: string;
  private docId: string;

  constructor(colName: string, docId: string) {
    this.colName = colName;
    this.docId = docId;
  }

  get id() { return this.docId; }

  async get() {
    const url = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/${firebaseConfig.firestoreDatabaseId}/documents/${this.colName}/${this.docId}?key=${firebaseConfig.apiKey}`;
    try {
      const res = await fetch(url);
      if (res.status === 404) {
        return { exists: false, data: () => undefined, id: this.docId };
      }
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`REST Get Doc error: ${res.statusText} (${text})`);
      }
      const json = await res.json();
      const data = fromFirestoreObj(json);
      return { exists: true, data: () => data, id: this.docId };
    } catch (err) {
      console.error(`Error fetching doc ${this.colName}/${this.docId}:`, err);
      return { exists: false, data: () => undefined, id: this.docId };
    }
  }

  async set(data: any) {
    const url = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/${firebaseConfig.firestoreDatabaseId}/documents/${this.colName}/${this.docId}?key=${firebaseConfig.apiKey}`;
    const body = toFirestoreDocBody(data);
    const res = await fetch(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`REST Set Doc error: ${text}`);
    }
  }

  async update(updates: any) {
    const existing = await this.get();
    const merged = { ...(existing.data() || {}), ...updates };
    await this.set(merged);
  }

  async delete() {
    const url = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/${firebaseConfig.firestoreDatabaseId}/documents/${this.colName}/${this.docId}?key=${firebaseConfig.apiKey}`;
    const res = await fetch(url, { method: "DELETE" });
    if (!res.ok && res.status !== 404) {
      const text = await res.text();
      throw new Error(`REST Delete Doc error: ${text}`);
    }
  }
}

class RESTFirestore {
  collection(colName: string) {
    return {
      doc: (docId: string) => new RESTFirestoreDoc(colName, docId),
      where: (field: string, op: string, val: any) => new RESTQuery(colName).where(field, op, val),
      limit: (n: number) => new RESTQuery(colName).limit(n),
      orderBy: (field: string, dir: string) => new RESTQuery(colName).orderBy(field, dir),
      get: async () => {
        return new RESTQuery(colName).get();
      }
    };
  }

  batch() {
    return new RESTBatch();
  }
}

const db = new RESTFirestore();

async function run() {
  console.log("Running direct document read REST check on properties...");
  const snap = await db.collection("properties").limit(3).get();
  console.log("Read completed! Number of properties retrieved:", snap.docs.length);
  process.exit(0);
}

run().catch(console.error);
