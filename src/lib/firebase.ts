import { supabase } from "./supabase";

// Perfect backwards-compatible bridge from Firestore patterns to native Supabase PostgreSQL
export const db = {};

// Custom mapped properties between camelCase (Firestore) and snake_case (PostgreSQL/Supabase)
const FIELD_MAP: Record<string, string> = {
  // Shared
  id: "id",
  createdAt: "created_at",
  updatedAt: "updated_at",

  // Users
  uid: "uid",
  email: "email",
  displayName: "display_name",
  username: "username",
  role: "role",
  status: "status",
  linkedPropertyIds: "linked_property_ids",

  // Properties
  pin: "pin",
  tdNumber: "td_number",
  ownerName: "owner_name",
  ownerAddress: "owner_address",
  administratorName: "administrator_name",
  administratorAddress: "administrator_address",
  effectivityDate: "effectivity_date",
  lotNo: "lot_no",
  blkNo: "blk_no",
  octTct: "oct_tct",
  cctCloa: "cct_cloa",
  classification: "classification",
  area: "area",
  assessedValue: "assessed_value",
  previousTdNo: "previous_td_no",
  previousOwner: "previous_owner",
  previousAssessedValue: "previous_assessed_value",
  recordedBy: "recorded_by",
  isArchived: "is_archived",
  archivedAt: "archived_at",

  // Delinquencies
  propertyId: "property_id",
  year: "year",
  basicTaxDue: "basic_tax",
  sefTaxDue: "sef_tax",
  penalty: "penalties",
  interest: "interest",
  totalDue: "total_amount",
  totalPaid: "total_paid",
  noticeIssuedAt: "notice_issued_at",
  paymentDetails: "payment_details",

  // Payments
  delinquencyId: "delinquency_id",
  orNumber: "or_number",
  orDate: "or_date",
  paymentDate: "payment_date",
  amountPaid: "amount_paid",
  paymentType: "payment_type",
  paymentPeriod: "payment_period",
  periodStartYear: "period_start_year",
  periodEndYear: "period_end_year",
  quarterStart: "quarter_start",
  quarterEnd: "quarter_end",
  basicTaxPaid: "basic_tax_paid",
  basicPaid: "basic_tax_paid",
  sefPaid: "sef_paid",
  penaltyPaid: "penalties_paid",
  discountPaid: "discount_applied",
  remarks: "remarks",
  voidMetadata: "void_metadata",
  approvedBy: "approved_by",
  treasurer: "treasurer",
  deputy: "deputy",
  payerName: "payer_name",
  recordedAt: "created_at"
};

const REVERSE_FIELD_MAP: Record<string, string> = {};
for (const [key, val] of Object.entries(FIELD_MAP)) {
  REVERSE_FIELD_MAP[val] = key;
}

// Ensure specific overclashes resolve correctly for delinquency structure in UI
REVERSE_FIELD_MAP['basic_tax'] = 'basicTaxDue';
REVERSE_FIELD_MAP['sef_tax'] = 'sefTaxDue';
REVERSE_FIELD_MAP['penalties'] = 'penalty';
REVERSE_FIELD_MAP['total_amount'] = 'totalDue';
REVERSE_FIELD_MAP['basic_tax_paid'] = 'basicPaid';

function getPrimaryKey(table: string): string {
  if (table === "users" || table === "staff_profiles") return "uid";
  return "id";
}

function mapToPostgres(table: string, data: any): any {
  if (!data) return data;
  const result: any = {};
  for (const [key, val] of Object.entries(data)) {
    const pgKey = FIELD_MAP[key] || key;
    let pgVal = val;
    
    // Convert Firestore timestamp-like structures to ISO strings
    if (val && typeof val === 'object' && 'seconds' in val) {
      pgVal = new Date((val as any).seconds * 1000).toISOString();
    }

    // Handle nested json values
    if (["void_metadata", "payment_details", "linked_property_ids"].includes(pgKey) && val && typeof val === 'object') {
      pgVal = val;
    }

    // Coerce numeric types
    if (
      ["assessed_value", "previous_assessed_value", "basic_tax", "sef_tax", "penalties", "interest", "total_amount",
       "amount_paid", "basic_tax_paid", "sef_paid", "penalties_paid", "discount_applied", "total_paid",
       "year", "period_start_year", "period_end_year", "quarter_start", "quarter_end"].includes(pgKey)
    ) {
      if (val !== undefined && val !== null) {
        pgVal = Number(val);
      }
    }

    if (pgKey === "is_archived") {
      pgVal = Boolean(val);
    }

    result[pgKey] = pgVal;
  }
  return result;
}

function mapFromPostgres(table: string, pgData: any): any {
  if (!pgData) return pgData;
  const result: any = {};
  for (const [key, val] of Object.entries(pgData)) {
    const jsKey = REVERSE_FIELD_MAP[key] || key;
    let jsVal = val;

    // Handle parsed nested objects
    if (["voidMetadata", "paymentDetails", "linkedPropertyIds"].includes(jsKey) && typeof val === 'string') {
      try {
        jsVal = JSON.parse(val);
      } catch {
        jsVal = val;
      }
    }

    // Convert values
    if (
      ["assessedValue", "previousAssessedValue", "basicTaxDue", "sefTaxDue", "penalty", "interest", "totalDue",
       "amountPaid", "basicPaid", "sefPaid", "penaltyPaid", "discountPaid", "totalPaid",
       "year", "periodStartYear", "periodEndYear", "quarterStart", "quarterEnd"].includes(jsKey)
    ) {
      if (val !== undefined && val !== null) {
        jsVal = Number(val);
      }
    }

    if (jsKey === "isArchived") {
      jsVal = Boolean(val);
    }

    result[jsKey] = jsVal;
  }
  return result;
}

export function collection(dbRef: any, path: string) {
  return { type: "collection", path };
}

export function doc(first: any, second?: any, third?: any) {
  if (third !== undefined) {
    return { type: "doc", path: second, id: third };
  } else if (second !== undefined) {
    if (typeof first === "object" && first.type === "collection") {
      return { type: "doc", path: first.path, id: second };
    } else {
      const parts = second.split("/");
      return { type: "doc", path: parts[0], id: parts[1] };
    }
  }
  return { type: "doc", path: first };
}

export function query(collectionRef: any, ...constraints: any[]) {
  return {
    type: "query",
    path: collectionRef.path,
    constraints: constraints
  };
}

export function where(field: string, op: string, value: any) {
  return { type: "where", field, op, value };
}

export function limit(n: number) {
  return { type: "limit", value: n };
}

export function orderBy(field: string, direction: "asc" | "desc" = "asc") {
  return { type: "orderBy", field, direction };
}

export async function getDocs(queryOrRef: any) {
  let path = "";
  let constraints: any[] = [];
  
  if (queryOrRef.type === "collection") {
    path = queryOrRef.path;
  } else if (queryOrRef.type === "query") {
    path = queryOrRef.path;
    constraints = queryOrRef.constraints || [];
  } else {
    path = String(queryOrRef);
  }

  const table = path;
  let builder: any = supabase.from(table).select("*");

  // Apply filters
  for (const c of constraints) {
    if (c.type === "where") {
      const pgField = FIELD_MAP[c.field] || c.field;
      if (c.op === "==") {
        builder = builder.eq(pgField, c.value);
      } else if (c.op === ">=") {
        builder = builder.gte(pgField, c.value);
      } else if (c.op === "<=") {
        builder = builder.lte(pgField, c.value);
      } else if (c.op === "in") {
        builder = builder.in(pgField, c.value);
      } else if (c.op === "array-contains") {
        builder = builder.contains(pgField, [c.value]);
      }
    } else if (c.type === "limit") {
      builder = builder.limit(c.value);
    } else if (c.type === "orderBy") {
      const pgField = FIELD_MAP[c.field] || c.field;
      builder = builder.order(pgField, { ascending: c.direction === "asc" });
    }
  }

  const { data, error } = await builder;
  if (error) {
    throw error;
  }

  const mappedData = (data || []).map(item => mapFromPostgres(table, item));

  return {
    docs: mappedData.map(item => ({
      id: item.id || item.uid,
      exists: () => true,
      data: () => item
    })),
    empty: mappedData.length === 0,
    forEach(callback: (doc: any) => void) {
      this.docs.forEach(callback);
    }
  };
}

export async function getDoc(docRef: any) {
  const table = docRef.path;
  const id = docRef.id;
  const pk = getPrimaryKey(table);

  const { data, error } = await supabase.from(table).select("*").eq(pk, id).maybeSingle();
  if (error) {
    throw error;
  }

  const mapped = data ? mapFromPostgres(table, data) : null;

  return {
    id,
    exists: () => !!mapped,
    data: () => mapped
  };
}

export async function addDoc(collectionRef: any, data: any) {
  const table = collectionRef.path;
  const pgData = mapToPostgres(table, data);
  const pk = getPrimaryKey(table);

  if (!pgData[pk] && pk === "id") {
    pgData[pk] = crypto.randomUUID();
  }

  const { data: inserted, error } = await supabase.from(table).insert(pgData).select().single();
  if (error) {
    throw error;
  }

  const mapped = mapFromPostgres(table, inserted);
  return {
    id: mapped[pk],
    exists: () => true,
    data: () => mapped
  };
}

export async function updateDoc(docRef: any, data: any) {
  const table = docRef.path;
  const id = docRef.id;
  const pgData = mapToPostgres(table, data);
  const pk = getPrimaryKey(table);

  const { error } = await supabase.from(table).update(pgData).eq(pk, id);
  if (error) {
    throw error;
  }

  // Relational Sync to staff_profiles
  if (table === "users") {
    const updatePayload: any = {};
    if (pgData.status !== undefined) updatePayload.status = pgData.status;
    if (pgData.display_name !== undefined) updatePayload.display_name = pgData.display_name;
    if (pgData.username !== undefined) updatePayload.username = pgData.username;

    if (Object.keys(updatePayload).length > 0) {
      updatePayload.updated_at = new Date().toISOString();
      await supabase.from("staff_profiles").update(updatePayload).eq("uid", id);
    }
  }
}

export async function setDoc(docRef: any, data: any, options?: { merge?: boolean }) {
  const table = docRef.path;
  const id = docRef.id;
  const pgData = mapToPostgres(table, data);
  const pk = getPrimaryKey(table);
  pgData[pk] = id;

  const { error } = await supabase.from(table).upsert(pgData);
  if (error) {
    throw error;
  }

  // Relational Sync to staff_profiles
  if (table === "users") {
    const updatePayload: any = {};
    if (pgData.status !== undefined) updatePayload.status = pgData.status;
    if (pgData.display_name !== undefined) updatePayload.display_name = pgData.display_name;
    if (pgData.username !== undefined) updatePayload.username = pgData.username;

    if (Object.keys(updatePayload).length > 0) {
      updatePayload.updated_at = new Date().toISOString();
      await supabase.from("staff_profiles").upsert({
        uid: id,
        email: pgData.email || "",
        display_name: pgData.display_name || "",
        username: pgData.username || "",
        status: pgData.status || "Pending",
        ...updatePayload
      });
    }
  }
}

export async function deleteDoc(docRef: any) {
  const table = docRef.path;
  const id = docRef.id;
  const pk = getPrimaryKey(table);

  const { error } = await supabase.from(table).delete().eq(pk, id);
  if (error) {
    throw error;
  }

  // Relational Sync to staff_profiles
  if (table === "users") {
    await supabase.from("staff_profiles").delete().eq("uid", id);
  }
}

export async function getDocFromServer(docRef: any) {
  return getDoc(docRef);
}

class SupabaseBatch {
  private operations: Array<() => Promise<void>> = [];

  set(docRef: any, data: any) {
    this.operations.push(async () => {
      await setDoc(docRef, data);
    });
  }

  update(docRef: any, data: any) {
    this.operations.push(async () => {
      await updateDoc(docRef, data);
    });
  }

  delete(docRef: any) {
    this.operations.push(async () => {
      await deleteDoc(docRef);
    });
  }

  async commit() {
    for (const op of this.operations) {
      await op();
    }
  }
}

export function writeBatch(dbRef: any) {
  return new SupabaseBatch();
}

// Authentication synchronous current user state cache
export const auth = {
  get currentUser() {
    return _currentUser;
  }
};

let _currentUser: any = null;

supabase.auth.onAuthStateChange((_event, session) => {
  if (session?.user) {
    _currentUser = {
      uid: session.user.id,
      email: session.user.email,
      displayName: session.user.user_metadata?.displayName || session.user.user_metadata?.full_name || session.user.email?.split('@')[0] || "User",
      emailVerified: true
    };
  } else {
    _currentUser = null;
  }
});

export function onAuthStateChanged(authRef: any, callback: (user: any) => void) {
  const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
    if (session?.user) {
      const fbUser = {
        uid: session.user.id,
        email: session.user.email,
        displayName: session.user.user_metadata?.displayName || session.user.user_metadata?.full_name || session.user.email?.split('@')[0] || "User",
        emailVerified: true
      };
      _currentUser = fbUser;
      callback(fbUser);
    } else {
      _currentUser = null;
      callback(null);
    }
  });

  // Execute initial callback with current cached user if available
  if (_currentUser) {
    callback(_currentUser);
  }

  return () => {
    subscription.unsubscribe();
  };
}

export async function signInWithEmailAndPassword(authRef: any, email: string, pass: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password: pass });
  if (error) throw error;
  
  const user = {
    uid: data.user?.id,
    email: data.user?.email,
    displayName: data.user?.user_metadata?.displayName || data.user?.user_metadata?.full_name || data.user?.email?.split('@')[0] || "User",
    emailVerified: true
  };
  _currentUser = user;
  return { user };
}

export async function createUserWithEmailAndPassword(authRef: any, email: string, pass: string) {
  const { data, error } = await supabase.auth.signUp({ email, password: pass });
  if (error) throw error;
  
  const user = {
    uid: data.user?.id,
    email: data.user?.email,
    displayName: data.user?.user_metadata?.displayName || data.user?.user_metadata?.full_name || data.user?.email?.split('@')[0] || "User",
    emailVerified: true
  };
  _currentUser = user;
  return { user };
}

export async function sendPasswordResetEmail(authRef: any, email: string) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/reset-password`,
  });
  if (error) throw error;
}

export async function signOut(authRef: any) {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
  _currentUser = null;
}

export class GoogleAuthProvider {}
export const googleProvider = new GoogleAuthProvider();

export async function signInWithPopup(authRef: any, provider: any) {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
  });
  if (error) throw error;
  return data;
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errMsg = error instanceof Error ? error.message : String(error);
  console.error(`Supabase DB Adapter Error during ${operationType} on ${path}: ${errMsg}`);
  throw error;
}

export function serverTimestamp() {
  return new Date().toISOString();
}

export function onSnapshot(queryOrRef: any, onNext: (snap: any) => void, onError?: (err: any) => void) {
  let isUnsubscribed = false;
  let channel: any = null;

  const triggerUpdate = async () => {
    if (isUnsubscribed) return;
    try {
      const snap = await getDocs(queryOrRef);
      if (!isUnsubscribed) {
        onNext(snap);
      }
    } catch (err) {
      if (!isUnsubscribed && onError) {
        onError(err);
      }
    }
  };

  // Initial fetch
  triggerUpdate();

  // Get table name
  let path = "";
  if (queryOrRef.type === "collection" || queryOrRef.type === "query") {
    path = queryOrRef.path;
  } else {
    path = String(queryOrRef);
  }
  const table = path;

  // Realtime subscription channel
  channel = supabase
    .channel(`public-changes-${table}-${Math.floor(Math.random() * 100000)}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: table },
      () => {
        triggerUpdate();
      }
    )
    .subscribe();

  return () => {
    isUnsubscribed = true;
    if (channel) {
      supabase.removeChannel(channel);
    }
  };
}
