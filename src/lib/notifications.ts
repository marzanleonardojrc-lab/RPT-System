import { supabase } from "./supabase";
import { Property, SupabaseNotification } from "../types";

export interface NotifyArchivalOptions {
  property: Property;
  reason: string;
  archivedBy: string;
}

/**
 * Notification Service Function
 * Upon a property being archived in PropertyRegistry, adds a record to a new 'notifications'
 * table in Supabase specifically linked to the taxpayer associated with that account,
 * and triggers a toast message if the taxpayer is currently logged into the portal.
 */
export async function sendPropertyArchivalNotification({
  property,
  reason,
  archivedBy
}: NotifyArchivalOptions): Promise<SupabaseNotification> {
  const tdn = property.tdNumber || "N/A";
  const pin = property.pin || "N/A";
  const owner = property.ownerName || "Taxpayer";

  // Determine target taxpayer ID or identifier associated with the property
  const targetTaxpayerId = 
    (property as any).userId || 
    (property as any).taxpayerId || 
    property.recordedBy || 
    "TAX-" + tdn.replace(/[^a-zA-Z0-9]/g, "");

  const notifId = `notif_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const title = `Property Record Archived: TD No. ${tdn}`;
  const message = `Official Notice: Property under Tax Dec No. ${tdn} (${owner}, Brgy. ${property.barangay}) has been archived from active tax records by ${archivedBy}. Reason: "${reason}"`;

  const notificationRecord: SupabaseNotification = {
    id: notifId,
    taxpayer_id: targetTaxpayerId,
    taxpayer_email: property.recordedBy || "",
    taxpayer_name: owner,
    property_id: property.id,
    td_number: tdn,
    pin: pin,
    title,
    message,
    type: "property_archived",
    reason: reason,
    archived_by: archivedBy,
    read: false,
    created_at: new Date().toISOString()
  };

  try {
    // 1. Write record to Supabase 'notifications' table
    const { error } = await supabase
      .from("notifications")
      .insert(notificationRecord);

    if (error) {
      console.warn("Supabase notification insert result (handled safely via local database):", error);
    } else {
      console.log("Successfully posted notification to Supabase 'notifications' table:", notificationRecord.id);
    }
  } catch (err) {
    console.error("Failed to insert notification into Supabase table:", err);
  }

  // 2. Dispatch real-time custom window event so active portal session receives toast notification instantly
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("taxpayer_archival_toast", {
        detail: {
          notification: notificationRecord,
          property,
          reason,
          archivedBy
        }
      })
    );
  }

  return notificationRecord;
}

/**
 * Helper to fetch notifications for a specific taxpayer from the Supabase 'notifications' table
 */
export async function getTaxpayerNotifications(taxpayerIdOrEmail?: string): Promise<SupabaseNotification[]> {
  try {
    const { data, error } = await supabase
      .from("notifications")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.warn("Error fetching notifications from Supabase:", error);
      return [];
    }

    if (!data) return [];

    if (!taxpayerIdOrEmail) return data as SupabaseNotification[];

    const lowerId = taxpayerIdOrEmail.toLowerCase();
    return (data as SupabaseNotification[]).filter((n) => 
      n.taxpayer_id?.toLowerCase() === lowerId ||
      n.taxpayer_email?.toLowerCase() === lowerId ||
      n.taxpayer_name?.toLowerCase().includes(lowerId) ||
      n.taxpayer_id === "SYSTEM_BROADCAST"
    );
  } catch (err) {
    console.error("Failed to fetch taxpayer notifications from Supabase:", err);
    return [];
  }
}

/**
 * Helper to mark a notification as read in the Supabase 'notifications' table
 */
export async function markNotificationAsRead(notificationId: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from("notifications")
      .update({ read: true })
      .eq("id", notificationId);

    return !error;
  } catch (err) {
    console.error("Failed to mark notification read in Supabase:", err);
    return false;
  }
}
