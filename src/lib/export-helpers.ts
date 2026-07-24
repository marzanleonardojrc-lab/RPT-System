import { supabase } from "./supabase";
import { Property } from "../types";

/**
 * Fetches all records from the Supabase 'properties' table 
 * and triggers a browser download of the formatted CSV file.
 */
export async function exportDatabaseToCSV(): Promise<void> {
  const { data, error } = await supabase
    .from("properties")
    .select("*");
  
  if (error) {
    throw error;
  }
  
  if (!data || data.length === 0) {
    throw new Error("No property records found in Supabase to export.");
  }

  const propertiesList: Property[] = data.map((item: any) => ({
    id: item.id || item.uid || "",
    pin: item.pin || "",
    ownerName: item.owner_name || item.ownerName || "",
    ownerAddress: item.owner_address || item.ownerAddress || "",
    administratorName: item.administrator_name || item.administratorName || "",
    administratorAddress: item.administrator_address || item.administratorAddress || "",
    effectivityDate: item.effectivity_date || item.effectivityDate || "",
    tdNumber: item.td_number || item.tdNumber || "",
    detailedLocation: item.detailed_location || item.detailedLocation || "",
    street: item.street || "",
    barangay: item.barangay || "",
    municipality: item.municipality || "Dipaculao",
    province: item.province || "Aurora",
    lotNo: item.lot_no || item.lotNo || "",
    blkNo: item.blk_no || item.blkNo || "",
    octTct: item.oct_tct || item.octTct || "",
    cctCloa: item.cct_cloa || item.cctCloa || "",
    classification: item.classification || "LAND",
    area: item.area || "",
    assessedValue: Number(item.assessed_value || item.assessedValue || 0),
    previousTdNo: item.previous_td_no || item.previousTdNo || "",
    previousOwner: item.previous_owner || item.previousOwner || "",
    previousAssessedValue: Number(item.previous_assessed_value || item.previousAssessedValue || 0),
    recordedBy: item.recorded_by || item.recordedBy || "System",
    isArchived: !!(item.is_archived || item.isArchived),
    archivedAt: item.archived_at || item.archivedAt || "",
    createdAt: item.created_at || item.createdAt || "",
    updatedAt: item.updated_at || item.updatedAt || ""
  } as Property));

  // Formatting headers to match the Property model nicely
  const headers = [
    "ID",
    "PIN (Property Index Number)",
    "TD Number (Tax Declaration Number)",
    "Owner Name",
    "Owner Address",
    "Administrator Name",
    "Administrator Address",
    "Classification",
    "Area",
    "Assessed Value",
    "Effectivity Date",
    "Lot No",
    "Blk No",
    "OCT/TCT No",
    "CCT/CLOA No",
    "Detailed Location",
    "Street",
    "Barangay",
    "Municipality",
    "Province",
    "Previous TD No",
    "Previous Owner",
    "Previous Assessed Value",
    "Recorded By",
    "Archived",
    "Archived At",
    "Created At",
    "Updated At"
  ];

  const escapeCSV = (val: any): string => {
    if (val === null || val === undefined) return "";
    let str = String(val).trim();
    // Replace double quotes with escaped double quotes
    str = str.replace(/"/g, '""');
    // Wrap in double quotes if it contains sensitive CSV characters
    if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
      return `"${str}"`;
    }
    return str;
  };

  const rows = propertiesList.map(p => [
    escapeCSV(p.id),
    escapeCSV(p.pin),
    escapeCSV(p.tdNumber),
    escapeCSV(p.ownerName),
    escapeCSV(p.ownerAddress),
    escapeCSV(p.administratorName),
    escapeCSV(p.administratorAddress),
    escapeCSV(p.classification),
    escapeCSV(p.area),
    escapeCSV(p.assessedValue),
    escapeCSV(p.effectivityDate),
    escapeCSV(p.lotNo),
    escapeCSV(p.blkNo),
    escapeCSV(p.octTct),
    escapeCSV(p.cctCloa),
    escapeCSV(p.detailedLocation),
    escapeCSV(p.street),
    escapeCSV(p.barangay),
    escapeCSV(p.municipality),
    escapeCSV(p.province),
    escapeCSV(p.previousTdNo),
    escapeCSV(p.previousOwner),
    escapeCSV(p.previousAssessedValue),
    escapeCSV(p.recordedBy),
    escapeCSV(p.isArchived ? "YES" : "NO"),
    escapeCSV(p.archivedAt),
    escapeCSV(p.createdAt),
    escapeCSV(p.updatedAt)
  ]);

  const csvContent = [
    headers.join(","),
    ...rows.map(row => row.join(","))
  ].join("\n");

  const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csvContent], { type: "text/csv;charset=utf-8;" }); // Add UTF-8 BOM
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  
  const timestamp = new Date().toISOString().slice(0, 10);
  link.setAttribute("download", `dipaculao_properties_export_${timestamp}.csv`);
  link.style.visibility = "hidden";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/**
 * Fetches all collections (properties, payments, delinquencies, audit_logs, users)
 * and triggers a browser download of a complete JSON database snapshot.
 */
export async function exportFullDatabaseToJSON(): Promise<void> {
  const [propertiesRes, paymentsRes, delinquenciesRes, auditLogsRes, usersRes] = await Promise.all([
    supabase.from("properties").select("*"),
    supabase.from("payments").select("*"),
    supabase.from("delinquencies").select("*"),
    supabase.from("audit_logs").select("*"),
    supabase.from("users").select("*")
  ]);

  const exportPayload = {
    metadata: {
      appName: "Dipaculao RPTA Database Backup",
      exportedAt: new Date().toISOString(),
      version: "1.0.0"
    },
    tables: {
      properties: propertiesRes.data || [],
      payments: paymentsRes.data || [],
      delinquencies: delinquenciesRes.data || [],
      audit_logs: auditLogsRes.data || [],
      users: usersRes.data || []
    }
  };

  const jsonString = JSON.stringify(exportPayload, null, 2);
  const blob = new Blob([jsonString], { type: "application/json;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);

  const timestamp = new Date().toISOString().slice(0, 10);
  link.setAttribute("download", `dipaculao_rpta_full_database_backup_${timestamp}.json`);
  link.style.visibility = "hidden";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
