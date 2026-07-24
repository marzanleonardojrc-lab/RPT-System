import { supabase } from "./supabase";
import { AuditAction } from "../types";

export async function logAudit(action: AuditAction, entityType: string, entityId: string, oldValue?: any, newValue?: any) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) return;

    const { error } = await supabase.from("audit_logs").insert({
      action,
      entity_type: entityType,
      entity_id: entityId,
      old_value: oldValue || null,
      new_value: newValue || null,
      user_id: user.id,
      user_email: user.email || "",
      timestamp: new Date().toISOString()
    });

    if (error) throw error;
  } catch (error) {
    console.error("Failed to log audit:", error);
  }
}
