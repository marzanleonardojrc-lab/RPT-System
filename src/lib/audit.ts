import { supabase } from "./supabase";
import { AuditAction, AuditLog } from "../types";

export async function logAudit(
  action: AuditAction, 
  entityType: string, 
  entityId: string, 
  oldValue?: any, 
  newValue?: any
) {
  try {
    let userEmail = "System Administrator";
    let userId = "admin_system";

    if (typeof window !== "undefined") {
      const cachedUser = localStorage.getItem("rpta_user");
      if (cachedUser) {
        try {
          const parsed = JSON.parse(cachedUser);
          userEmail = parsed.email || parsed.displayName || parsed.username || userEmail;
          userId = parsed.uid || parsed.id || userId;
        } catch (e) {
          // fallback
        }
      }
    }

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        userEmail = session.user.email || userEmail;
        userId = session.user.id || userId;
      }
    } catch (e) {}

    const auditItem: AuditLog = {
      id: crypto.randomUUID ? crypto.randomUUID() : `log_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      action,
      entityType,
      entityId,
      oldValue: oldValue || null,
      newValue: newValue || null,
      userId,
      userEmail,
      timestamp: new Date().toISOString()
    };

    // 1. Store in local database (rpta_database)
    try {
      const dbStr = localStorage.getItem("rpta_database");
      const dbObj = dbStr ? JSON.parse(dbStr) : {};
      const auditLogs: AuditLog[] = dbObj["audit_logs"] || [];
      auditLogs.unshift(auditItem);
      dbObj["audit_logs"] = auditLogs.slice(0, 500);
      localStorage.setItem("rpta_database", JSON.stringify(dbObj));
    } catch (e) {
      console.warn("Failed saving audit log to local storage:", e);
    }

    // 2. Store in Supabase audit_logs table
    try {
      await supabase.from("audit_logs").insert({
        id: auditItem.id,
        action: auditItem.action,
        entity_type: entityType,
        entity_id: entityId,
        old_value: oldValue || null,
        new_value: newValue || null,
        user_id: userId,
        user_email: userEmail,
        timestamp: auditItem.timestamp
      });
    } catch (sErr) {
      // handled gracefully
    }
  } catch (error) {
    console.error("Failed to log audit:", error);
  }
}

export async function fetchAuditLogs(options?: {
  entityId?: string;
  filterType?: "none" | "all" | "date" | "month" | "year";
  filterValue?: string;
}): Promise<AuditLog[]> {
  const logMap = new Map<string, AuditLog>();

  // 1. Fetch from Local Storage
  try {
    const dbStr = localStorage.getItem("rpta_database");
    if (dbStr) {
      const dbObj = JSON.parse(dbStr);
      const localLogs: any[] = dbObj["audit_logs"] || [];
      localLogs.forEach((item) => {
        const id = item.id || `local_${item.timestamp}_${item.entityId || item.entity_id}`;
        const log: AuditLog = {
          id,
          userId: item.userId || item.user_id || "system",
          userEmail: item.userEmail || item.user_email || "System User",
          action: item.action || "UPDATE",
          entityId: item.entityId || item.entity_id || "N/A",
          entityType: item.entityType || item.entity_type || "System",
          oldValue: item.oldValue || item.old_value || null,
          newValue: item.newValue || item.new_value || null,
          timestamp: item.timestamp || item.created_at || new Date().toISOString()
        };
        logMap.set(id, log);
      });
    }
  } catch (err) {
    console.warn("Error reading local audit logs:", err);
  }

  // 2. Fetch from Supabase audit_logs
  try {
    let query = supabase.from("audit_logs").select("*").order("timestamp", { ascending: false }).limit(200);
    
    if (options?.entityId) {
      query = query.eq("entity_id", options.entityId);
    }

    const { data, error } = await query;
    if (!error && data) {
      data.forEach((item: any) => {
        const id = item.id || `sb_${item.timestamp}_${item.entity_id}`;
        const log: AuditLog = {
          id,
          userId: item.user_id || item.userId || "system",
          userEmail: item.user_email || item.userEmail || "System User",
          action: item.action || "UPDATE",
          entityId: item.entity_id || item.entityId || "N/A",
          entityType: item.entity_type || item.entityType || "System",
          oldValue: item.old_value || item.oldValue || null,
          newValue: item.new_value || item.newValue || null,
          timestamp: item.timestamp || item.created_at || new Date().toISOString()
        };
        logMap.set(id, log);
      });
    }
  } catch (err) {
    console.warn("Error reading Supabase audit logs:", err);
  }

  let logs = Array.from(logMap.values());

  // Apply entityId filter
  if (options?.entityId) {
    logs = logs.filter(l => l.entityId === options.entityId);
  }

  // Apply date/month/year filter if provided
  if (options?.filterType && options.filterType !== "none" && options.filterType !== "all" && options.filterValue) {
    const val = options.filterValue.trim();
    logs = logs.filter(log => {
      const dateStr = log.timestamp ? log.timestamp.substring(0, 10) : "";
      if (options.filterType === "date") {
        return dateStr === val;
      } else if (options.filterType === "month") {
        return dateStr.startsWith(val);
      } else if (options.filterType === "year") {
        return dateStr.startsWith(val);
      }
      return true;
    });
  }

  // Sort descending by timestamp
  logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  return logs;
}
