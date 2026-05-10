import { db, auth, collection, addDoc, serverTimestamp } from "./firebase";
import { AuditAction } from "../types";

export async function logAudit(action: AuditAction, entityType: string, entityId: string, oldValue?: any, newValue?: any) {
  try {
    const user = auth.currentUser;
    if (!user) return;

    await addDoc(collection(db, "audit_logs"), {
      action,
      entityType,
      entityId,
      oldValue: oldValue || null,
      newValue: newValue || null,
      userId: user.uid,
      userEmail: user.email,
      timestamp: serverTimestamp()
    });
  } catch (error) {
    console.error("Failed to log audit:", error);
  }
}
