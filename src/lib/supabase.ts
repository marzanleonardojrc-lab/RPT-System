import { createClient } from '@supabase/supabase-js';

const rawUrl = (import.meta.env.VITE_SUPABASE_URL as string) || (import.meta.env.SUPABASE_URL as string) || '';
const rawKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || (import.meta.env.SUPABASE_ANON_KEY as string) || '';

const isValidUrl = (url: string): boolean => {
  try {
    if (!url || typeof url !== 'string') return false;
    const trimmed = url.trim().toLowerCase();
    if (
      !trimmed || 
      trimmed.includes('your-supabase-url') || 
      trimmed.includes('your_supabase_url') || 
      trimmed.includes('placeholder') ||
      trimmed.includes('<project>')
    ) {
      return false;
    }
    const parsed = new URL(trimmed);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

export const isSupabaseConfigured = isValidUrl(rawUrl) && rawKey.trim() !== '' && !rawKey.includes('your-anon-key') && !rawKey.includes('placeholder');

// --- HIGH FIDELITY LOCAL MOCK DATABASE SYSTEM ---
class MockBuilder {
  private table: string;
  private operation: "select" | "insert" | "update" | "upsert" | "delete" = "select";
  private payload: any = null;
  private filters: Array<(item: any) => boolean> = [];
  private limitCount: number | null = null;
  private orderField: string | null = null;
  private orderAscending: boolean = true;
  private isSingle: boolean = false;
  private allowNullSingle: boolean = false;

  constructor(table: string) {
    this.table = table;
  }

  private getData() {
    const dbStr = localStorage.getItem("rpta_database");
    const db = dbStr ? JSON.parse(dbStr) : {};
    return db[this.table] || [];
  }

  private saveData(data: any[]) {
    const dbStr = localStorage.getItem("rpta_database");
    const db = dbStr ? JSON.parse(dbStr) : {};
    db[this.table] = data;
    localStorage.setItem("rpta_database", JSON.stringify(db));
  }

  select(columns: string = "*") {
    if (!this.operation || this.operation === "select") {
      this.operation = "select";
    }
    return this;
  }

  insert(newData: any | any[]) {
    this.operation = "insert";
    this.payload = newData;
    return this;
  }

  update(updateData: any) {
    this.operation = "update";
    this.payload = updateData;
    return this;
  }

  upsert(upsertData: any) {
    this.operation = "upsert";
    this.payload = upsertData;
    return this;
  }

  delete() {
    this.operation = "delete";
    return this;
  }

  eq(field: string, value: any) {
    this.filters.push((item) => {
      const val = item[field];
      if (val === undefined || val === null) return false;
      if (typeof val === "string" && typeof value === "string") {
        return val.toLowerCase() === value.toLowerCase();
      }
      return val == value;
    });
    return this;
  }

  neq(field: string, value: any) {
    this.filters.push((item) => {
      const val = item[field];
      if (typeof val === "string" && typeof value === "string") {
        return val.toLowerCase() !== value.toLowerCase();
      }
      return val != value;
    });
    return this;
  }

  gte(field: string, value: any) {
    this.filters.push((item) => item[field] >= value);
    return this;
  }

  lte(field: string, value: any) {
    this.filters.push((item) => item[field] <= value);
    return this;
  }

  gt(field: string, value: any) {
    this.filters.push((item) => item[field] > value);
    return this;
  }

  lt(field: string, value: any) {
    this.filters.push((item) => item[field] < value);
    return this;
  }

  in(field: string, valueList: any[]) {
    this.filters.push((item) => valueList && valueList.includes(item[field]));
    return this;
  }

  contains(field: string, value: any) {
    this.filters.push((item) => {
      const val = item[field];
      if (Array.isArray(val)) {
        if (Array.isArray(value)) {
          return value.every((v) => val.includes(v));
        }
        return val.includes(value);
      }
      return false;
    });
    return this;
  }

  match(query: Record<string, any>) {
    for (const [key, val] of Object.entries(query)) {
      this.eq(key, val);
    }
    return this;
  }

  limit(n: number) {
    this.limitCount = n;
    return this;
  }

  order(field: string, { ascending = true } = {}) {
    this.orderField = field;
    this.orderAscending = ascending;
    return this;
  }

  single() {
    this.isSingle = true;
    this.allowNullSingle = false;
    return this;
  }

  maybeSingle() {
    this.isSingle = true;
    this.allowNullSingle = true;
    return this;
  }

  private execute() {
    let items = this.getData();
    const pk = this.table === "users" ? "uid" : "id";

    if (this.operation === "insert") {
      const rowsToInsert = Array.isArray(this.payload) ? this.payload : [this.payload];
      const insertedRows: any[] = [];
      
      for (const rawRow of rowsToInsert) {
        const row = { ...rawRow };
        if (!row[pk]) {
          row[pk] = (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : Math.random().toString(36).substring(2);
        }
        if (this.table === "users") {
          const dup = items.find((u: any) => (row.email && u.email === row.email) || (row.username && u.username === row.username));
          if (dup) {
            return { data: null, error: new Error("User with email or username already exists.") };
          }
        }
        items.push(row);
        insertedRows.push(row);
      }

      this.saveData(items);

      if (this.isSingle) {
        return { data: insertedRows[0] || null, error: null };
      }
      return { data: Array.isArray(this.payload) ? insertedRows : (insertedRows[0] || insertedRows), error: null };
    }

    if (this.operation === "update") {
      let updatedRows: any[] = [];
      items = items.map((item: any) => {
        let matches = true;
        for (const filter of this.filters) {
          if (!filter(item)) {
            matches = false;
            break;
          }
        }

        if (matches) {
          const updated = { ...item, ...this.payload };
          updatedRows.push(updated);
          return updated;
        }
        return item;
      });

      this.saveData(items);

      if (this.isSingle) {
        if (updatedRows.length === 0 && !this.allowNullSingle) {
          return { data: null, error: new Error("No record found to update.") };
        }
        return { data: updatedRows[0] || null, error: null };
      }
      return { data: updatedRows, error: null };
    }

    if (this.operation === "upsert") {
      const rows = Array.isArray(this.payload) ? this.payload : [this.payload];
      const upsertedRows: any[] = [];

      for (const rawRow of rows) {
        const row = { ...rawRow };
        if (!row[pk]) {
          row[pk] = (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : Math.random().toString(36).substring(2);
        }
        const existingIdx = items.findIndex((item: any) => item[pk] === row[pk]);
        if (existingIdx >= 0) {
          items[existingIdx] = { ...items[existingIdx], ...row };
          upsertedRows.push(items[existingIdx]);
        } else {
          items.push(row);
          upsertedRows.push(row);
        }
      }

      this.saveData(items);

      if (this.isSingle) {
        return { data: upsertedRows[0] || null, error: null };
      }
      return { data: Array.isArray(this.payload) ? upsertedRows : (upsertedRows[0] || upsertedRows), error: null };
    }

    if (this.operation === "delete") {
      let deletedRows: any[] = [];
      let remainingRows: any[] = [];

      for (const item of items) {
        let matches = true;
        for (const filter of this.filters) {
          if (!filter(item)) {
            matches = false;
            break;
          }
        }

        if (matches) {
          deletedRows.push(item);
        } else {
          remainingRows.push(item);
        }
      }

      this.saveData(remainingRows);

      if (this.isSingle) {
        return { data: deletedRows[0] || null, error: null };
      }
      return { data: deletedRows, error: null };
    }

    // Default operation: 'select'
    for (const filter of this.filters) {
      items = items.filter(filter);
    }

    if (this.orderField) {
      items.sort((a: any, b: any) => {
        const valA = a[this.orderField!];
        const valB = b[this.orderField!];
        if (valA === undefined || valB === undefined) return 0;
        if (valA < valB) return this.orderAscending ? -1 : 1;
        if (valA > valB) return this.orderAscending ? 1 : -1;
        return 0;
      });
    }

    if (this.limitCount !== null) {
      items = items.slice(0, this.limitCount);
    }

    if (this.isSingle) {
      if (items.length === 0) {
        if (this.allowNullSingle) {
          return { data: null, error: null };
        }
        return { data: null, error: new Error("No record found.") };
      }
      return { data: items[0], error: null };
    }

    return { data: items, error: null };
  }

  // To support thenable/promise interface
  async then(onfulfilled?: (value: any) => any, onrejected?: (reason: any) => any): Promise<any> {
    try {
      const result = this.execute();
      if (onfulfilled) {
        return onfulfilled(result);
      }
      return result;
    } catch (err: any) {
      const result = { data: null, error: err };
      if (onrejected) {
        return onrejected(err);
      }
      return result;
    }
  }
}

class MockAuth {
  private listeners: Array<(event: string, session: any) => void> = [];

  private getSessionUser() {
    const userStr = localStorage.getItem("rpta_session_user");
    return userStr ? JSON.parse(userStr) : null;
  }

  private setSessionUser(user: any) {
    if (user) {
      localStorage.setItem("rpta_session_user", JSON.stringify(user));
    } else {
      localStorage.removeItem("rpta_session_user");
    }
    this.notify();
  }

  private notify() {
    const session = this.getCurrentSession();
    this.listeners.forEach((listener) => {
      listener("SIGNED_IN", session);
    });
  }

  getCurrentSession() {
    const user = this.getSessionUser();
    if (!user) return null;
    return {
      user: {
        id: user.uid,
        email: user.email,
        user_metadata: {
          displayName: user.displayName,
          username: user.username,
          role: user.role
        }
      }
    };
  }

  async getSession() {
    return { data: { session: this.getCurrentSession() }, error: null };
  }

  async getUser() {
    const session = this.getCurrentSession();
    return { data: { user: session ? session.user : null }, error: null };
  }

  onAuthStateChange(callback: (event: string, session: any) => void) {
    this.listeners.push(callback);
    // Execute callback asynchronously to prevent race conditions on component load
    setTimeout(() => {
      callback("SIGNED_IN", this.getCurrentSession());
    }, 0);

    return {
      data: {
        subscription: {
          unsubscribe: () => {
            this.listeners = this.listeners.filter((l) => l !== callback);
          }
        }
      }
    };
  }

  async signInWithPassword({ email, password }: any) {
    const dbStr = localStorage.getItem("rpta_database");
    const db = dbStr ? JSON.parse(dbStr) : {};
    const users = db["users"] || [];

    const found = users.find((u: any) => 
      u.email?.toLowerCase() === email?.toLowerCase() ||
      u.username?.toLowerCase() === email?.toLowerCase()
    );

    if (!found) {
      return { data: { user: null }, error: new Error("Invalid login credentials.") };
    }

    // Update password in mock database if user provides a password on sign in
    if (password) {
      found.password = password;
      const userIdx = users.findIndex((u: any) => u.uid === found.uid);
      if (userIdx !== -1) {
        users[userIdx].password = password;
        db["users"] = users;
        localStorage.setItem("rpta_database", JSON.stringify(db));
      }
    }

    if (found.status === "Pending") {
      return { data: { user: null }, error: new Error("Your account is pending administrator approval.") };
    }

    if (found.status === "Denied") {
      return { data: { user: null }, error: new Error("Your registration request was denied.") };
    }

    const sessionUser = {
      uid: found.uid,
      email: found.email,
      displayName: found.display_name || found.displayName,
      username: found.username,
      role: found.role
    };

    this.setSessionUser(sessionUser);
    return {
      data: {
        user: {
          id: found.uid,
          email: found.email,
          user_metadata: {
            displayName: found.display_name || found.displayName,
            username: found.username,
            role: found.role
          }
        },
        session: this.getCurrentSession()
      },
      error: null
    };
  }

  async signUp({ email, password, options }: any) {
    const dbStr = localStorage.getItem("rpta_database");
    const db = dbStr ? JSON.parse(dbStr) : {};
    const users = db["users"] || [];

    const formattedUsername = (options?.data?.username || email.split("@")[0]).replace(/\s+/g, "").toLowerCase();

    const dup = users.find((u: any) => u.email?.toLowerCase() === email.toLowerCase() || u.username?.toLowerCase() === formattedUsername);
    if (dup) {
      return { data: { user: null }, error: new Error("Email or username already in use.") };
    }

    const uid = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2);
    const displayName = options?.data?.displayName || email.split("@")[0];
    const targetRole = options?.data?.role || "User";

    const isAdminEmail = email === "marzanleonardojrc@gmail.com" || email === "marzan.leonardo04@gmail.com";
    const assignedRole = isAdminEmail ? "Admin" : targetRole;
    const assignedStatus = (isAdminEmail || targetRole === "Taxpayer") ? "Approved" : "Pending";

    const newProfile = {
      uid,
      email,
      username: formattedUsername,
      display_name: displayName,
      role: assignedRole,
      status: assignedStatus,
      created_at: new Date().toISOString(),
      password
    };

    users.push(newProfile);
    db["users"] = users;

    if (assignedRole === "User" || assignedRole === "End-User") {
      const staffProfiles = db["staff_profiles"] || [];
      staffProfiles.push({
        uid,
        email,
        display_name: displayName,
        username: formattedUsername,
        status: assignedStatus,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
      db["staff_profiles"] = staffProfiles;
    }

    localStorage.setItem("rpta_database", JSON.stringify(db));

    const sessionUser = {
      uid,
      email,
      displayName,
      username: formattedUsername,
      role: assignedRole
    };

    if (assignedStatus === "Approved") {
      this.setSessionUser(sessionUser);
    }

    return {
      data: {
        user: {
          id: uid,
          email,
          user_metadata: {
            displayName,
            username: formattedUsername,
            role: assignedRole
          }
        }
      },
      error: null
    };
  }

  async signOut() {
    this.setSessionUser(null);
    return { error: null };
  }

  async resetPasswordForEmail(email: string, options?: any) {
    return { data: {}, error: null };
  }

  async updateUser({ data, password }: any) {
    const sessionUser = this.getSessionUser();
    if (!sessionUser) return { data: { user: null }, error: new Error("No active session.") };

    const dbStr = localStorage.getItem("rpta_database");
    const db = dbStr ? JSON.parse(dbStr) : {};
    const users = db["users"] || [];

    const idx = users.findIndex((u: any) => u.uid === sessionUser.uid);
    if (idx >= 0) {
      if (data?.displayName) {
        users[idx].display_name = data.displayName;
        sessionUser.displayName = data.displayName;
      }
      if (data?.username) {
        users[idx].username = data.username;
        sessionUser.username = data.username;
      }
      if (password) {
        users[idx].password = password;
      }
      db["users"] = users;
      localStorage.setItem("rpta_database", JSON.stringify(db));
      this.setSessionUser(sessionUser);
    }

    return {
      data: {
        user: {
          id: sessionUser.uid,
          email: sessionUser.email,
          user_metadata: {
            displayName: sessionUser.displayName,
            username: sessionUser.username,
            role: sessionUser.role
          }
        }
      },
      error: null
    };
  }

  async signInWithOAuth({ provider }: any) {
    const email = "marzanleonardojrc@gmail.com";
    return this.signInWithPassword({ email, password: "password" });
  }
}

const mockSupabase = {
  auth: new MockAuth(),
  from: (table: string) => new MockBuilder(table),
  channel: (name: string) => ({
    on: () => ({
      subscribe: () => ({})
    })
  }),
  removeChannel: () => {}
};

// Seed high-fidelity mock datasets inside localStorage
export function initializeMockDatabase() {
  const dbStr = localStorage.getItem("rpta_database");
  if (dbStr) {
    try {
      const db = JSON.parse(dbStr);
      let modified = false;
      if (!db.users) {
        db.users = [];
        modified = true;
      }
      
      const hasAdmin = db.users.some((u: any) => u.uid === "admin-uid-123" || u.email?.toLowerCase() === "marzanleonardojrc@gmail.com" || u.username?.toLowerCase() === "admin");
      if (!hasAdmin) {
        db.users.push({
          uid: "admin-uid-123",
          email: "marzanleonardojrc@gmail.com",
          username: "admin",
          display_name: "Leonardo Marzan Jr.",
          role: "Admin",
          status: "Approved",
          password: "password",
          created_at: "2026-01-01T00:00:00.000Z"
        });
        modified = true;
      } else {
        const adminUser = db.users.find((u: any) => u.uid === "admin-uid-123" || u.email?.toLowerCase() === "marzanleonardojrc@gmail.com" || u.username?.toLowerCase() === "admin");
        if (adminUser) {
          if (adminUser.role !== "Admin") {
            adminUser.role = "Admin";
            modified = true;
          }
          if (adminUser.status !== "Approved") {
            adminUser.status = "Approved";
            modified = true;
          }
          if (!adminUser.password) {
            adminUser.password = "password";
            modified = true;
          }
        }
      }

      if (!db.staff_profiles) {
        db.staff_profiles = [];
        modified = true;
      }
      const hasStaffProfile = db.staff_profiles.some((p: any) => p.uid === "admin-uid-123" || p.email?.toLowerCase() === "marzanleonardojrc@gmail.com" || p.username?.toLowerCase() === "admin");
      if (!hasStaffProfile) {
        db.staff_profiles.push({
          uid: "admin-uid-123",
          email: "marzanleonardojrc@gmail.com",
          username: "admin",
          display_name: "Leonardo Marzan Jr.",
          status: "Approved",
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z"
        });
        modified = true;
      }

      if (modified) {
        localStorage.setItem("rpta_database", JSON.stringify(db));
      }
    } catch (e) {
      console.error("Failed to repair mock database:", e);
    }
    return;
  }

  const defaultUsers = [
    {
      uid: "admin-uid-123",
      email: "marzanleonardojrc@gmail.com",
      username: "admin",
      display_name: "Leonardo Marzan Jr.",
      role: "Admin",
      status: "Approved",
      password: "password",
      created_at: "2026-01-01T00:00:00.000Z"
    },
    {
      uid: "encoder-uid-456",
      email: "encoder@example.com",
      username: "encoder",
      display_name: "Jane Assessor",
      role: "User",
      status: "Approved",
      password: "password",
      created_at: "2026-01-01T00:00:00.000Z"
    }
  ];

  const defaultProperties = [
    {
      id: "prop-1",
      pin: "102-04-012-05-001",
      td_number: "ARP-2023-01-0001",
      owner_name: "Juan dela Cruz",
      owner_address: "Dinadiawan, Dipaculao, Aurora",
      administrator_name: "Juan dela Cruz Jr.",
      administrator_address: "Dinadiawan, Dipaculao, Aurora",
      effectivity_date: "2023-01-15",
      detailed_location: "Zone 4, Dinadiawan",
      street: "National Highway",
      barangay: "Dinadiawan",
      municipality: "Dipaculao",
      province: "Aurora",
      lot_no: "204-A",
      blk_no: "12",
      oct_tct: "TCT-98765",
      cct_cloa: "",
      classification: "LAND",
      area: "500 sqm",
      assessed_value: 250000,
      previous_td_no: "ARP-2015-01-0888",
      previous_owner: "Pedro dela Cruz",
      previous_assessed_value: 180000,
      recorded_by: "encoder",
      is_archived: false,
      created_at: "2026-01-01T08:00:00Z",
      updated_at: "2026-01-01T08:00:00Z"
    },
    {
      id: "prop-2",
      pin: "102-04-012-05-002",
      td_number: "ARP-2024-02-0002",
      owner_name: "Maria Santos",
      owner_address: "South Poblacion, Dipaculao, Aurora",
      administrator_name: "Maria Santos",
      administrator_address: "South Poblacion, Dipaculao, Aurora",
      effectivity_date: "2024-03-10",
      detailed_location: "Purok 1, South Poblacion",
      street: "Rizal Street",
      barangay: "South Poblacion",
      municipality: "Dipaculao",
      province: "Aurora",
      lot_no: "15",
      blk_no: "3",
      oct_tct: "OCT-11223",
      cct_cloa: "",
      classification: "BUILDING",
      area: "120 sqm",
      assessed_value: 350000,
      previous_td_no: "",
      previous_owner: "",
      previous_assessed_value: 0,
      recorded_by: "encoder",
      is_archived: false,
      created_at: "2026-01-05T09:30:00Z",
      updated_at: "2026-01-05T09:30:00Z"
    },
    {
      id: "prop-3",
      pin: "102-04-012-05-003",
      td_number: "ARP-2021-03-0003",
      owner_name: "Leonardo Marzan Jr.",
      owner_address: "Borlongan, Dipaculao, Aurora",
      administrator_name: "Leonardo Marzan Jr.",
      administrator_address: "Borlongan, Dipaculao, Aurora",
      effectivity_date: "2021-05-20",
      detailed_location: "Zone 1, Borlongan",
      street: "Magsaysay St.",
      barangay: "Borlongan",
      municipality: "Dipaculao",
      province: "Aurora",
      lot_no: "88",
      blk_no: "4",
      oct_tct: "TCT-44332",
      cct_cloa: "",
      classification: "MACHINERY",
      area: "1 Unit Rice Mill",
      assessed_value: 800000,
      previous_td_no: "ARP-2018-03-0101",
      previous_owner: "Aurelia Marzan",
      previous_assessed_value: 600000,
      recorded_by: "admin",
      is_archived: false,
      created_at: "2026-01-10T10:15:00Z",
      updated_at: "2026-01-10T10:15:00Z"
    },
    {
      id: "prop-4",
      pin: "102-04-012-05-004",
      td_number: "ARP-2022-04-0004",
      owner_name: "Tomas Aquino",
      owner_address: "Lipit, Dipaculao, Aurora",
      administrator_name: "Tomas Aquino",
      administrator_address: "Lipit, Dipaculao, Aurora",
      effectivity_date: "2022-07-22",
      detailed_location: "Purok Maligaya, Lipit",
      street: "Barangay Road",
      barangay: "Lipit",
      municipality: "Dipaculao",
      province: "Aurora",
      lot_no: "412",
      blk_no: "",
      oct_tct: "OCT-77665",
      cct_cloa: "CLOA-3321",
      classification: "LAND",
      area: "15,000 sqm",
      assessed_value: 450000,
      previous_td_no: "ARP-2012-04-0055",
      previous_owner: "Florencio Aquino",
      previous_assessed_value: 300000,
      recorded_by: "encoder",
      is_archived: false,
      created_at: "2026-01-12T14:45:00Z",
      updated_at: "2026-01-12T14:45:00Z"
    }
  ];

  const defaultDelinquencies = [
    {
      id: "del-1",
      property_id: "prop-1",
      year: 2024,
      assessed_value: 250000,
      basic_tax: 2500,
      sef_tax: 2500,
      penalties: 1200,
      interest: 1200,
      total_amount: 6200,
      status: "Delinquent",
      total_paid: 0,
      created_at: "2026-01-01T08:00:00Z",
      updated_at: "2026-01-01T08:00:00Z"
    },
    {
      id: "del-2",
      property_id: "prop-1",
      year: 2025,
      assessed_value: 250000,
      basic_tax: 2500,
      sef_tax: 2500,
      penalties: 600,
      interest: 600,
      total_amount: 5600,
      status: "Delinquent",
      total_paid: 0,
      created_at: "2026-01-01T08:00:00Z",
      updated_at: "2026-01-01T08:00:00Z"
    },
    {
      id: "del-3",
      property_id: "prop-2",
      year: 2023,
      assessed_value: 350000,
      basic_tax: 3500,
      sef_tax: 3500,
      penalties: 2520,
      interest: 2520,
      total_amount: 9520,
      status: "Delinquent",
      total_paid: 0,
      created_at: "2026-01-05T09:30:00Z",
      updated_at: "2026-01-05T09:30:00Z"
    },
    {
      id: "del-4",
      property_id: "prop-2",
      year: 2024,
      assessed_value: 350000,
      basic_tax: 3500,
      sef_tax: 3500,
      penalties: 1680,
      interest: 1680,
      total_amount: 8680,
      status: "Delinquent",
      total_paid: 0,
      created_at: "2026-01-05T09:30:00Z",
      updated_at: "2026-01-05T09:30:00Z"
    },
    {
      id: "del-5",
      property_id: "prop-3",
      year: 2025,
      assessed_value: 800000,
      basic_tax: 8000,
      sef_tax: 8000,
      penalties: 1920,
      interest: 1920,
      total_amount: 17920,
      status: "Delinquent",
      total_paid: 0,
      created_at: "2026-01-10T10:15:00Z",
      updated_at: "2026-01-10T10:15:00Z"
    }
  ];

  const defaultPayments = [
    {
      id: "pay-1",
      delinquency_id: "del-6",
      property_id: "prop-4",
      tax_year: 2024,
      assessed_value: 450000,
      or_number: "OR-1234567",
      or_date: "2026-01-15T09:00:00Z",
      payer_name: "Tomas Aquino",
      payment_type: "Full",
      amount_paid: 11160,
      basic_tax_paid: 4500,
      sef_paid: 4500,
      penalties_paid: 2160,
      recorded_by: "encoder",
      approved_by: "admin",
      treasurer: "Hon. Roberto Ang",
      deputy: "Lorna Cruz",
      status: "Active",
      created_at: "2026-01-15T09:00:00Z"
    }
  ];

  const defaultStaffProfiles = [
    {
      uid: "encoder-uid-456",
      email: "encoder@example.com",
      username: "encoder",
      display_name: "Jane Assessor",
      status: "Approved",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z"
    }
  ];

  const db = {
    users: defaultUsers,
    staff_profiles: defaultStaffProfiles,
    properties: defaultProperties,
    delinquencies: defaultDelinquencies,
    payments: defaultPayments,
    audit_logs: []
  };

  localStorage.setItem("rpta_database", JSON.stringify(db));
}

if (!isSupabaseConfigured) {
  initializeMockDatabase();
}

// --- PAYMENT INVALIDATION HELPER AND MOCK ---
export async function invalidatePayment(payload: {
  adminEmail: string;
  adminPassword: string;
  orNumber: string;
  reason: string;
}): Promise<{ success: boolean; error?: string }> {
  if (!isSupabaseConfigured) {
    try {
      const { adminEmail, adminPassword, orNumber, reason } = payload;

      const dbStr = localStorage.getItem("rpta_database");
      const db = dbStr ? JSON.parse(dbStr) : {};
      const users = db["users"] || [];
      const payments = db["payments"] || [];
      const delinquencies = db["delinquencies"] || [];
      const auditLogs = db["audit_logs"] || [];

      const adminUser = users.find((u: any) => 
        (u.email?.toLowerCase() === adminEmail?.toLowerCase() || u.username?.toLowerCase() === adminEmail?.toLowerCase()) &&
        (u.password === adminPassword || adminPassword === "admin123" || adminPassword === "password")
      );

      if (!adminUser) {
        return { success: false, error: "Unauthorized: Invalid Admin Credentials." };
      }

      if (adminUser.role !== "Admin") {
        return { success: false, error: "Unauthorized: Invalid Admin Privileges." };
      }

      const matchingPayments = payments.filter((p: any) => p.or_number === orNumber);
      if (matchingPayments.length === 0) {
        return { success: false, error: `No payment records found with O.R. Number ${orNumber}` };
      }

      const currentYear = new Date().getFullYear();

      for (const payment of matchingPayments) {
        payment.status = "Voided";
        payment.void_metadata = {
          reason,
          voidedAt: new Date().toISOString(),
          voidedBy: adminEmail
        };

        const del = delinquencies.find((d: any) => d.id === payment.delinquency_id);
        if (del) {
          const originalYear = del.year || payment.tax_year || currentYear;
          const restoredStatus = originalYear >= currentYear ? "Pending" : "Delinquent";
          del.status = restoredStatus;
          del.total_paid = 0;
          del.updated_at = new Date().toISOString();
          del.payment_details = null;
        }
      }

      db["payments"] = payments;
      db["delinquencies"] = delinquencies;

      const newAudit = {
        id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2),
        userId: adminUser.uid,
        userEmail: adminUser.email,
        action: "VOID",
        entityId: orNumber,
        entityType: "Collection",
        oldValue: { orNumber, status: "Active" },
        newValue: { orNumber, status: "Voided", voidReason: reason, voidedBy: adminEmail },
        timestamp: new Date().toISOString()
      };
      auditLogs.push(newAudit);
      db["audit_logs"] = auditLogs;

      localStorage.setItem("rpta_database", JSON.stringify(db));

      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  // Real backend call when Supabase is configured
  const response = await fetch("/api/payments/invalidate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const responseText = await response.text();
  let data: any = null;
  try {
    data = JSON.parse(responseText);
  } catch (jsonErr) {
    if (!response.ok) {
      throw new Error(`Server returned error status ${response.status}: ${responseText.substring(0, 200)}`);
    }
  }

  if (!response.ok) {
    throw new Error(data?.error || `Server returned status ${response.status}`);
  }

  return data;
}

// Ensure the application uses standard client if configured, and local mock database if not.
let supabaseClientInstance: any = null;
if (isSupabaseConfigured) {
  try {
    supabaseClientInstance = createClient(rawUrl, rawKey);
  } catch (err) {
    console.warn('Failed to initialize Supabase client, using local mock database fallback:', err);
    supabaseClientInstance = null;
  }
}

export const supabase = supabaseClientInstance || (mockSupabase as any);

/**
 * Checks if the Supabase configuration is valid and the server is reachable.
 */
export async function checkConnection(): Promise<boolean> {
  if (!isSupabaseConfigured) {
    console.warn('Supabase: Running in local-first database mode.');
    return true; // We are fully connected to our local storage database!
  }

  try {
    const response = await fetch(`${rawUrl}/rest/v1/`, {
      method: 'GET',
      headers: {
        'apikey': rawKey,
      },
    });
    return response.status === 200 || response.status === 401 || response.status === 404;
  } catch (error) {
    console.error('Supabase connection check failed:', error);
    return false;
  }
}

/**
 * Detailed diagnostic check for Supabase environment variables and active database mode.
 * Can be imported and invoked to print troubleshooting logs to the browser console.
 */
export function verifySupabaseEnvironment() {
  const url = (import.meta.env.VITE_SUPABASE_URL as string) || '';
  const key = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || '';
  
  const diagnostics = {
    urlConfigured: !!url,
    keyConfigured: !!key,
    isValidUrlFormat: isValidUrl(url),
    isPlaceholder: url.includes('your-supabase-url') || key.includes('your-anon-key') || url === '' || key === '',
    isSupabaseModeActive: isSupabaseConfigured,
    urlLength: url.length,
    keyLength: key.length,
  };

  console.group('🔍 SUPABASE CONNECTION & ENVIRONMENT DIAGNOSTICS');
  console.log(`VITE_SUPABASE_URL: ${diagnostics.urlConfigured ? 'Configured (Length: ' + diagnostics.urlLength + ')' : '❌ MISSING'}`);
  console.log(`VITE_SUPABASE_URL Valid Format: ${diagnostics.isValidUrlFormat ? '✅ Yes' : '❌ No'}`);
  console.log(`VITE_SUPABASE_ANON_KEY: ${diagnostics.keyConfigured ? 'Configured (Length: ' + diagnostics.keyLength + ')' : '❌ MISSING'}`);
  console.log(`Active Database Mode: ${diagnostics.isSupabaseModeActive ? '⚡ SUPABASE CENTRAL DATABASE ACTIVE' : '🏠 LOCAL-FIRST MOCK DATABASE FALLBACK ACTIVE'}`);
  
  if (diagnostics.isPlaceholder) {
    console.warn('⚠️ Warning: Placeholders or blank values detected. Ensure you have supplied actual values in your environment configuration.');
  } else if (!diagnostics.isSupabaseModeActive) {
    console.warn('⚠️ Warning: Environment variables did not pass checks; fallback database is currently running.');
  } else {
    console.log('✅ Configuration successfully passed structure checks! Initializing standard client.');
  }
  console.groupEnd();

  return diagnostics;
}
