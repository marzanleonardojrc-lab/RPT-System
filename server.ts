import express, { type Response, type NextFunction } from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import cookieParser from "cookie-parser";
import cors from "cors";
import { readFileSync } from "fs";

console.log("--- Server Starting ---");

let __filename = "";
let __dirname = "";

try {
  if (typeof import.meta !== "undefined" && import.meta.url) {
    __filename = fileURLToPath(import.meta.url);
    __dirname = path.dirname(__filename);
  } else {
    __dirname = process.cwd();
    __filename = path.join(__dirname, "server.ts");
  }
} catch {
  __dirname = process.cwd();
  __filename = path.join(__dirname, "server.ts");
}

// Read config safely
const firebaseConfig = JSON.parse(readFileSync(path.join(__dirname, "firebase-applet-config.json"), "utf8"));

const JWT_SECRET = process.env.JWT_SECRET || "rpt-local-secret-key-12345";
const adminEmail = "marzanleonardojrc@gmail.com";

// --- REST-based Firestore Implementation ---

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
  private token?: string;

  constructor(colName: string, token?: string) {
    this.colName = colName;
    this.token = token;
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

    const headers: any = { "Content-Type": "application/json" };
    if (this.token) {
      headers["Authorization"] = `Bearer ${this.token}`;
    }

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ structuredQuery })
    });

    if (!res.ok) {
      const text = await res.text();
      console.warn(`Query on ${this.colName} failed: ${text}`);
      return { empty: true, docs: [] };
    }

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
  private token?: string;

  constructor(colName: string, docId: string, token?: string) {
    this.colName = colName;
    this.docId = docId;
    this.token = token;
  }

  get id() { return this.docId; }

  async get() {
    const url = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/${firebaseConfig.firestoreDatabaseId}/documents/${this.colName}/${this.docId}?key=${firebaseConfig.apiKey}`;
    try {
      const headers: any = {};
      if (this.token) {
        headers["Authorization"] = `Bearer ${this.token}`;
      }
      const res = await fetch(url, { headers });
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
    const headers: any = { "Content-Type": "application/json" };
    if (this.token) {
      headers["Authorization"] = `Bearer ${this.token}`;
    }
    const res = await fetch(url, {
      method: "PATCH",
      headers,
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
    const headers: any = {};
    if (this.token) {
      headers["Authorization"] = `Bearer ${this.token}`;
    }
    const res = await fetch(url, { method: "DELETE", headers });
    if (!res.ok && res.status !== 404) {
      const text = await res.text();
      throw new Error(`REST Delete Doc error: ${text}`);
    }
  }
}

class RESTFirestore {
  private token?: string;
  constructor(token?: string) {
    this.token = token;
  }

  withToken(token: string) {
    return new RESTFirestore(token);
  }

  collection(colName: string) {
    return {
      doc: (docId: string) => new RESTFirestoreDoc(colName, docId, this.token),
      where: (field: string, op: string, val: any) => new RESTQuery(colName, this.token).where(field, op, val),
      limit: (n: number) => new RESTQuery(colName, this.token).limit(n),
      orderBy: (field: string, dir: string) => new RESTQuery(colName, this.token).orderBy(field, dir),
      get: async () => {
        return new RESTQuery(colName, this.token).get();
      }
    };
  }

  batch() {
    return new RESTBatch();
  }
}

const db = new RESTFirestore();
console.log(`Using REST-based Firestore Implementation with custom database: ${firebaseConfig.firestoreDatabaseId}`);

// --- Auth rest endpoints ---

async function signInWithPassword(email: string, pass: string): Promise<string> {
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${firebaseConfig.apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      password: pass,
      returnSecureToken: true
    })
  });
  if (!res.ok) {
    const json = await res.json();
    throw new Error(json.error?.message || "Invalid credentials");
  }
  const json = await res.json();
  return json.idToken;
}

async function createAuthUser(email: string, pass: string): Promise<string> {
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${firebaseConfig.apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      password: pass,
      returnSecureToken: true
    })
  });
  if (!res.ok) {
    const json = await res.json();
    throw new Error(json.error?.message || "Failed to create authentication login.");
  }
  const json = await res.json();
  return json.localId;
}

async function initDb() {
  try {
    console.log("REST database initialized smoothly.");
  } catch (err: any) {
    console.warn("REST initialization warn:", err.message);
  }
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json());
  app.use(cookieParser());

  // --- Auth Middleware ---
  const authenticateToken = (req: any, res: Response, next: NextFunction) => {
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ error: "Unauthorized" });

    jwt.verify(token, JWT_SECRET, (err: any, user: any) => {
      if (err) return res.status(403).json({ error: "Forbidden" });
      req.user = user;
      next();
    });
  };

  // --- Auth Routes ---
  app.post("/api/auth/register", async (req, res) => {
    const { email, password, name } = req.body;
    try {
      const hashedPassword = await bcrypt.hashSync(password, 10);
      const uid = Math.random().toString(36).substring(2, 15);
      const isAdminEmail = email === adminEmail;
      
      await db.collection("users").doc(uid).set({
        uid,
        email,
        password: hashedPassword,
        displayName: name,
        role: isAdminEmail ? "Admin" : "End-User",
        status: isAdminEmail ? "Approved" : "Pending",
        createdAt: new Date().toISOString()
      });
      res.json({ success: true });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    const { email, password } = req.body;
    try {
      const snapshot = await db.collection("users").where("email", "==", email).limit(1).get();
      
      if (snapshot.empty) {
        return res.status(401).json({ error: "Invalid credentials" });
      }

      const user = snapshot.docs[0].data();
      
      if (!bcrypt.compareSync(password, user.password || "")) {
        return res.status(401).json({ error: "Invalid credentials" });
      }

      const token = jwt.sign({ uid: user.uid, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: "24h" });
      res.cookie("token", token, { 
        httpOnly: true, 
        sameSite: "none", 
        secure: true,
        maxAge: 24 * 60 * 60 * 1000 
      });
      
      const { password: _, ...userWithoutPassword } = user;
      res.json({ user: userWithoutPassword });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/auth/logout", (req, res) => {
    res.clearCookie("token", { sameSite: "none", secure: true });
    res.json({ success: true });
  });

  app.get("/api/auth/me", async (req, res) => {
    const token = req.cookies.token;
    if (!token) return res.json({ user: null });
    
    try {
      const decoded: any = jwt.verify(token, JWT_SECRET);
      const userDoc = await db.collection("users").doc(decoded.uid).get();
      if (!userDoc.exists) return res.json({ user: null });
      
      const user = userDoc.data();
      res.json({ user });
    } catch {
      res.json({ user: null });
    }
  });

  app.post("/api/auth/update-profile", authenticateToken, async (req: any, res) => {
    const { displayName, password } = req.body;
    const updates: any = {};

    if (displayName) updates.displayName = displayName;
    if (password) updates.password = bcrypt.hashSync(password, 10);

    if (Object.keys(updates).length > 0) {
      await db.collection("users").doc(req.user.uid).update(updates);
    }
    res.json({ success: true });
  });

  // --- Property Routes ---
  app.get("/api/properties", authenticateToken, async (req, res) => {
    try {
      const snapshot = await db.collection("properties").get();
      const properties = snapshot.docs.map(doc => doc.data());
      res.json(properties);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/properties", authenticateToken, async (req, res) => {
    const { 
      pin, ownerName, ownerAddress, administratorName, administratorAddress, 
      effectivityDate, tdNumber, detailedLocation, street, barangay, 
      municipality, province, lotNo, blkNo, octTct, cctCloa, 
      classification, area, assessedValue, previousTdNo, previousOwner, 
      previousAssessedValue, recordedBy 
    } = req.body;
    const id = Math.random().toString(36).substring(2, 15);
    const now = new Date().toISOString();
    try {
      await db.collection("properties").doc(id).set({
        id, pin, ownerName, ownerAddress, administratorName, administratorAddress, 
        effectivityDate, tdNumber, detailedLocation, street, barangay, 
        municipality, province, lotNo, blkNo, octTct, cctCloa, 
        classification, area, assessedValue, previousTdNo, previousOwner, 
        previousAssessedValue, recordedBy, 
        updatedAt: now, createdAt: now
      });
      res.json({ id });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // --- Delinquency Routes ---
  app.get("/api/delinquencies", authenticateToken, async (req, res) => {
    const propertyId = req.query.propertyId as string;
    try {
      let q = db.collection("delinquencies") as any;
      if (propertyId) {
        q = q.where("propertyId", "==", propertyId);
      }
      const snapshot = await q.get();
      const delinquencies = snapshot.docs.map((doc: any) => doc.data());
      res.json(delinquencies);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/delinquencies", authenticateToken, async (req: any, res) => {
    const { propertyId, year, basicTaxDue, sefTaxDue, penalty, interest, totalDue, status } = req.body;
    const id = Math.random().toString(36).substring(2, 15);
    const now = new Date().toISOString();
    try {
      await db.collection("delinquencies").doc(id).set({
        id, propertyId, year, basicTaxDue, sefTaxDue, penalty, interest, totalDue, status, updatedAt: now, createdAt: now
      });
      res.json({ id });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/api/delinquencies/:id", authenticateToken, async (req, res) => {
    const { id } = req.params;
    const { status, paymentDetails } = req.body;
    const now = new Date().toISOString();
    
    try {
      await db.collection("delinquencies").doc(id).update({
        status, paymentDetails, updatedAt: now
      });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- User Management (Admin Only) ---
  app.get("/api/users", authenticateToken, async (req: any, res) => {
    if (req.user.role !== "Admin") return res.status(403).json({ error: "Unauthorized" });
    try {
      const snapshot = await db.collection("users").get();
      const users = snapshot.docs.map(doc => {
        const { password, ...rest } = doc.data();
        return rest;
      });
      res.json(users);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/api/users/:uid", authenticateToken, async (req: any, res) => {
    if (req.user.role !== "Admin") return res.status(403).json({ error: "Unauthorized" });
    const { uid } = req.params;
    const { role, status } = req.body;
    
    const updates: any = {};
    if (role) updates.role = role;
    if (status) updates.status = status;
    
    if (Object.keys(updates).length > 0) {
      await db.collection("users").doc(uid).update(updates);
    }
    res.json({ success: true });
  });

  // --- Audit Log Routes ---
  app.get("/api/audit_logs", authenticateToken, async (req: any, res) => {
    try {
      const snapshot = await db.collection("audit_logs").orderBy("timestamp", "desc").get();
      const logs = snapshot.docs.map(doc => doc.data());
      res.json(logs);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/audit_logs", authenticateToken, async (req: any, res) => {
    const { action, entityId, entityType, oldValue, newValue } = req.body;
    try {
      const id = Math.random().toString(36).substring(2, 15);
      await db.collection("audit_logs").doc(id).set({
        id,
        userId: req.user.uid,
        userEmail: req.user.email,
        action,
        entityId,
        entityType,
        oldValue,
        newValue,
        timestamp: new Date().toISOString()
      });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- Payment Voiding Route ---
  app.post("/api/payments/invalidate", authenticateToken, async (req: any, res) => {
    const { adminEmail, adminPassword, orNumber, reason } = req.body;
    try {
      if (!adminEmail || !adminPassword || !orNumber || !reason) {
        return res.status(400).json({ error: "Missing required fields for voiding." });
      }

      // 1. Verify admin credentials independently via Auth REST API sign-in
      let idToken = "";
      try {
        idToken = await signInWithPassword(adminEmail, adminPassword);
      } catch (authErr) {
        return res.status(401).json({ error: "Unauthorized: Invalid Admin Credentials." });
      }

      const activeDb = db.withToken(idToken);

      // Verify that the signed-in user actually has Admin role in Firestore
      const adminQuery = await activeDb.collection("users")
        .where("email", "==", adminEmail)
        .where("role", "==", "Admin")
        .limit(1)
        .get();

      if (adminQuery.empty) {
        return res.status(401).json({ error: "Unauthorized: Invalid Admin Privileges." });
      }

      // 2. Fetch payments under this O.R. Number
      const paymentsQuery = await activeDb.collection("payments")
        .where("orNumber", "==", orNumber)
        .get();

      if (paymentsQuery.empty) {
        return res.status(404).json({ error: `No payment records found with O.R. Number ${orNumber}` });
      }

      const batch = activeDb.batch();
      const currentYear = new Date().getFullYear();

      for (const pDoc of paymentsQuery.docs) {
        const paymentData = pDoc.data();
        
        // Mark payment record in payments collection as Voided
        const pRef = activeDb.collection("payments").doc(pDoc.id);
        batch.update(pRef, { 
          status: "Voided",
          voidedAt: new Date().toISOString(),
          voidedBy: adminEmail,
          voidReason: reason
        });

        // Find and unlock associated delinquency record
        if (paymentData.delinquencyId) {
          const dRef = activeDb.collection("delinquencies").doc(paymentData.delinquencyId);
          const dSnap = await dRef.get();
          if (dSnap.exists) {
            const dData = dSnap.data();
            const originalYear = dData?.year || paymentData.taxYear || currentYear;
            const restoredStatus = originalYear >= currentYear ? "Pending" : "Delinquent";

            batch.update(dRef, {
              status: restoredStatus,
              totalPaid: 0,
              updatedAt: new Date().toISOString(),
              paymentDetails: null
            });
          }
        } else {
          // Fallback to query delinquency record by propertyId and taxYear
          const dQuery = await activeDb.collection("delinquencies")
            .where("propertyId", "==", paymentData.propertyId)
            .where("year", "==", paymentData.taxYear)
            .limit(1)
            .get();

          if (!dQuery.empty) {
            const dDoc = dQuery.docs[0];
            const originalYear = paymentData.taxYear || currentYear;
            const restoredStatus = originalYear >= currentYear ? "Pending" : "Delinquent";

            batch.update(activeDb.collection("delinquencies").doc(dDoc.id), {
              status: restoredStatus,
              totalPaid: 0,
              updatedAt: new Date().toISOString(),
              paymentDetails: null
            });
          }
        }
      }

      // Commit batch update
      await batch.commit();

      // 3. Log into system-wide audit trail
      const auditId = Math.random().toString(36).substring(2, 15);
      await activeDb.collection("audit_logs").doc(auditId).set({
        id: auditId,
        userId: req.user.uid,
        userEmail: req.user.email,
        action: "VOID",
        entityId: orNumber,
        entityType: "Collection",
        oldValue: { orNumber, status: "Active" },
        newValue: { orNumber, status: "Voided", voidReason: reason, voidedBy: adminEmail },
        timestamp: new Date().toISOString()
      });

      res.json({ success: true });
    } catch (err: any) {
      console.error("Voiding process failure:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // --- Vite Middleware ---
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*all", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
    // Run DB init in background
    initDb().catch(err => {
      console.error("Delayed DB Init failed:", err);
    });
  });
}

startServer();
