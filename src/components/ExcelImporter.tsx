import React, { useState, useEffect } from "react";
import Papa from "papaparse";
import { 
  collection, 
  addDoc, 
  serverTimestamp,
  db,
  handleFirestoreError,
  OperationType,
  getDocs,
  query,
  where,
  doc,
  deleteDoc,
  updateDoc
} from "../lib/firebase";
import { Upload, Check, AlertCircle, X, Loader2, Download, Trash2, Edit3 } from "lucide-react";
import { logAudit } from "../lib/audit";

import { useAuth } from "../AuthContext";

interface ImporterProps {
  onClose: () => void;
}

const ExcelImporter: React.FC<ImporterProps> = ({ onClose }) => {
  const { profile } = useAuth();
  const parseCleanFloat = (val: any): number => {
    if (val === undefined || val === null) return 0;
    const str = String(val).replace(/,/g, '').trim();
    const num = parseFloat(str);
    return isNaN(num) ? 0 : num;
  };
  const [file, setFile] = useState<File | null>(null);
  const [overwriteDuplicates, setOverwriteDuplicates] = useState(true);
  const [importedProps, setImportedProps] = useState<any[]>([]);
  const [loadingProps, setLoadingProps] = useState(false);
  const [editingPropId, setEditingPropId] = useState<string | null>(null);
  const [inlineEditAssessed, setInlineEditAssessed] = useState("");
  const [inlineEditPrevAssessed, setInlineEditPrevAssessed] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [bulkScaling, setBulkScaling] = useState(false);
  const [purging, setPurging] = useState(false);

  const fetchImportedProperties = async () => {
    // keeping fetchImportedProperties here just in case, but probably not used if it was only for revise tab
  };



  const [status, setStatus] = useState<"idle" | "parsing" | "uploading" | "success" | "error">("idle");
  const [results, setResults] = useState({ success: 0, failed: 0 });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  interface SkippedProperty {
    id: string;
    originalIndex: number;
    data: {
      tdNumber: string;
      pin: string;
      ownerName: string;
      ownerAddress: string;
      administratorName: string;
      administratorAddress: string;
      effectivityDate: string;
      detailedLocation: string;
      street: string;
      barangay: string;
      classification: string;
      area: string;
      assessedValue: string;
      previousTdNo: string;
      previousOwner: string;
      previousAssessedValue: string;
    };
    errors: string[];
  }

  const handleDelinquencyGeneration = async (propertyId: string, effectivityDateRaw: string, assessedValueRaw: number) => {
    let effYear = parseInt(effectivityDateRaw);
    if (isNaN(effYear) && effectivityDateRaw.includes("-")) {
        effYear = new Date(effectivityDateRaw).getFullYear();
    } else if (isNaN(effYear)) {
        const match = effectivityDateRaw.match(/\b(19|20)\d{2}\b/);
        if (match) effYear = parseInt(match[0]);
    }
    
    if (!isNaN(effYear)) {
        const currentYear = new Date().getFullYear();
        for (let y = effYear; y <= currentYear; y++) {
            const dq = query(collection(db, "delinquencies"), where("propertyId", "==", propertyId), where("year", "==", y));
            const ds = await getDocs(dq);
            if (ds.empty) {
                const basicTaxDue = assessedValueRaw * 0.01; // BASIC_TAX_RATE
                const sefTaxDue = assessedValueRaw * 0.01; // SEF_TAX_RATE
                await addDoc(collection(db, "delinquencies"), {
                    propertyId: propertyId,
                    year: y,
                    basicTaxDue: basicTaxDue,
                    sefTaxDue: sefTaxDue,
                    penalty: 0,
                    interest: 0,
                    totalDue: basicTaxDue + sefTaxDue,
                    totalPaid: 0,
                    status: y === currentYear ? "Pending" : "Delinquent",
                    recordedBy: profile?.username || profile?.displayName || "System",
                    createdAt: serverTimestamp(),
                    updatedAt: serverTimestamp()
                });
            }
        }
    }
  };

  const [skippedProperties, setSkippedProperties] = useState<SkippedProperty[]>([]);
  const [showSkippedModal, setShowSkippedModal] = useState(false);
  const [selectedSkippedId, setSelectedSkippedId] = useState<string | null>(null);
  const [editFormData, setEditFormData] = useState<any | null>(null);
  const [correctingId, setCorrectingId] = useState<string | null>(null);
  const [correctionError, setCorrectionError] = useState<string | null>(null);

  const downloadTemplate = () => {
    const headers = [
      "tdNumber",
      "pin",
      "ownerName",
      "ownerAddress",
      "administratorName",
      "administratorAddress",
      "effectivityDate",
      "detailedLocation",
      "street",
      "barangay",
      "classification",
      "area",
      "assessedValue",
      "previousTdNo",
      "previousOwner",
      "previousAssessedValue"
    ];
    
    const sampleRow = [
      "22-09-001-00054",
      "102-09-001-05-002-R01",
      "John Doe",
      "Dipaculao, Aurora",
      "Jane Doe",
      "Dipaculao, Aurora",
      "2026",
      "Zone 4, Brgy. Balcobito",
      "Rizal St",
      "Balcobito",
      "LAND",
      "1250 sqm",
      "340000",
      "18-09-001-00122",
      "Juan Dela Cruz",
      "280000"
    ];

    const escapeCSV = (val: string) => {
      const str = String(val);
      if (str.includes(",") || str.includes('"') || str.includes("\n")) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const csvContent = [headers.join(","), sampleRow.map(escapeCSV).join(",")].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", "property_bulk_upload_template.csv");
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) setFile(e.target.files[0]);
  };

  const startImport = () => {
    if (!file) return;
    setStatus("parsing");
    setErrorMessage(null);
    
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (header) => {
        const lower = header.trim().toLowerCase();
        if (lower === "tdnumber" || lower === "td no" || lower === "td number" || lower === "td_number") return "tdNumber";
        if (lower === "ownername" || lower === "owner" || lower === "owner_name") return "ownerName";
        if (lower === "assessedvalue" || lower === "assessed value" || lower === "assessed_value") return "assessedValue";
        if (lower === "barangay" || lower === "brgy") return "barangay";
        if (lower === "effectivitydate" || lower === "effectivity date" || lower === "effectivity_date") return "effectivityDate";
        return header.trim();
      },
      complete: async (results) => {
        const userName = profile?.username || profile?.displayName || "Imported";
        
        try {
          // 1. Column Validation
          const fields = (results.meta.fields || []).map((f: string) => f.trim());
          const requiredColumns = ["tdNumber", "ownerName", "assessedValue", "barangay", "effectivityDate"];
          const missingColumns = requiredColumns.filter(col => !fields.includes(col));

          if (missingColumns.length > 0) {
            setErrorMessage(`The following required columns are missing from your CSV: ${missingColumns.join(", ")}. Please add them and try again.`);
            setStatus("error");
            return;
          }

          setStatus("uploading");
          let success = 0;
          let failed = 0;
          const skippedItems: SkippedProperty[] = [];

          // Fetch existing TD Numbers to support overwriting or skipping duplicates
          const existingSnapshot = await getDocs(collection(db, "properties"));
          const existingTDMap = new Map<string, { id: string }>();
          existingSnapshot.docs.forEach(d => {
            const data = d.data();
            if (data.tdNumber) {
              existingTDMap.set(data.tdNumber.trim().toLowerCase(), { id: d.id });
            }
          });

          const currentBatchTDs = new Set<string>();
          let rowIndex = 0;
          for (const row of results.data as any) {
            rowIndex++;
            try {
              // 2. Extract and sanitize values
              const tdRaw = String(row.tdNumber || "").trim();
              const ownerNameRaw = String(row.ownerName || "").trim();
              const assessedValueRawStr = row.assessedValue !== undefined && row.assessedValue !== null ? String(row.assessedValue).trim() : "";
              const assessedValueRaw = parseCleanFloat(assessedValueRawStr);
              const barangayRaw = String(row.barangay || "").trim();
              const effectivityDateRaw = String(row.effectivityDate || "").trim();
              const pinRaw = String(row.pin || "").trim();

              // 3. Row-level required-data checks & error gathering
              const rowErrors: string[] = [];
              if (!tdRaw) rowErrors.push("Missing Tax Declaration Number (TD No)");
              if (!ownerNameRaw) rowErrors.push("Missing Owner Name");
              if (assessedValueRawStr === "") {
                rowErrors.push("Missing Assessed Value");
              } else if (isNaN(assessedValueRaw) || assessedValueRaw <= 0) {
                rowErrors.push("Assessed Value must be a valid positive number");
              }
              if (!barangayRaw) rowErrors.push("Missing Barangay");
              if (!effectivityDateRaw) rowErrors.push("Missing Effectivity Date");

              const tdLower = tdRaw.toLowerCase();
              
              if (tdRaw && currentBatchTDs.has(tdLower)) {
                rowErrors.push("Duplicate TD Number within the same CSV upload batch");
              }

              if (tdRaw && !overwriteDuplicates && existingTDMap.has(tdLower)) {
                rowErrors.push("Duplicate TD Number: Already exists in database");
              }

              if (rowErrors.length > 0) {
                failed++;
                skippedItems.push({
                  id: `skipped-${rowIndex}-${Date.now()}`,
                  originalIndex: rowIndex,
                  data: {
                    tdNumber: tdRaw,
                    pin: pinRaw,
                    ownerName: ownerNameRaw,
                    ownerAddress: String(row.ownerAddress || "").trim(),
                    administratorName: String(row.administratorName || "").trim(),
                    administratorAddress: String(row.administratorAddress || "").trim(),
                    effectivityDate: effectivityDateRaw,
                    detailedLocation: String(row.detailedLocation || "").trim(),
                    street: String(row.street || "").trim(),
                    barangay: barangayRaw,
                    classification: String(row.classification || "").trim(),
                    area: String(row.area || "").trim(),
                    assessedValue: assessedValueRawStr,
                    previousTdNo: String(row.previousTdNo || "").trim(),
                    previousOwner: String(row.previousOwner || "").trim(),
                    previousAssessedValue: String(row.previousAssessedValue || "").trim(),
                  },
                  errors: rowErrors
                });
                continue;
              }

              currentBatchTDs.add(tdLower); // Prevent duplicates within active batch
              const existingDoc = existingTDMap.get(tdLower);

              if (existingDoc && overwriteDuplicates) {
                await updateDoc(doc(db, "properties", existingDoc.id), {
                  pin: pinRaw || tdRaw,
                  ownerName: ownerNameRaw,
                  ownerAddress: row.ownerAddress || "",
                  administratorName: row.administratorName || "",
                  administratorAddress: row.administratorAddress || "",
                  effectivityDate: effectivityDateRaw,
                  tdNumber: tdRaw,
                  detailedLocation: row.detailedLocation || barangayRaw,
                  street: row.street || "",
                  barangay: barangayRaw,
                  municipality: "Dipaculao",
                  province: "Aurora",
                  lotNo: row.lotNo || "",
                  blkNo: row.blkNo || "",
                  octTct: row.octTct || "",
                  cctCloa: row.cctCloa || "",
                  classification: (row.classification || "LAND").toUpperCase() as any,
                  area: row.area || "0 sqm",
                  assessedValue: assessedValueRaw,
                  previousTdNo: row.previousTdNo || "",
                  previousOwner: row.previousOwner || "",
                  previousAssessedValue: parseCleanFloat(row.previousAssessedValue),
                  isArchived: false,
                  updatedAt: serverTimestamp(),
                  imported: true
                });
                await logAudit("UPDATE", "PropertyBulkUpload", existingDoc.id, { tdNumber: tdRaw }, { assessedValue: assessedValueRaw });
                await handleDelinquencyGeneration(existingDoc.id, effectivityDateRaw, assessedValueRaw);
              } else {
                const newDocRef = await addDoc(collection(db, "properties"), {
                  pin: pinRaw || tdRaw,
                  ownerName: ownerNameRaw,
                  ownerAddress: row.ownerAddress || "",
                  administratorName: row.administratorName || "",
                  administratorAddress: row.administratorAddress || "",
                  effectivityDate: effectivityDateRaw,
                  tdNumber: tdRaw,
                  detailedLocation: row.detailedLocation || barangayRaw,
                  street: row.street || "",
                  barangay: barangayRaw,
                  municipality: "Dipaculao",
                  province: "Aurora",
                  lotNo: row.lotNo || "",
                  blkNo: row.blkNo || "",
                  octTct: row.octTct || "",
                  cctCloa: row.cctCloa || "",
                  classification: (row.classification || "LAND").toUpperCase() as any,
                  area: row.area || "0 sqm",
                  assessedValue: assessedValueRaw,
                  previousTdNo: row.previousTdNo || "",
                  previousOwner: row.previousOwner || "",
                  previousAssessedValue: parseCleanFloat(row.previousAssessedValue),
                  isArchived: false,
                  recordedBy: userName,
                  createdAt: serverTimestamp(),
                  updatedAt: serverTimestamp(),
                  imported: true
                });
                await handleDelinquencyGeneration(newDocRef.id, effectivityDateRaw, assessedValueRaw);
              }
              success++;
            } catch (err: any) {
              failed++;
              skippedItems.push({
                id: `skipped-${rowIndex}-${Date.now()}`,
                originalIndex: rowIndex,
                data: {
                  tdNumber: String(row.tdNumber || "").trim(),
                  pin: String(row.pin || "").trim(),
                  ownerName: String(row.ownerName || "").trim(),
                  ownerAddress: String(row.ownerAddress || "").trim(),
                  administratorName: String(row.administratorName || "").trim(),
                  administratorAddress: String(row.administratorAddress || "").trim(),
                  effectivityDate: String(row.effectivityDate || "").trim(),
                  detailedLocation: String(row.detailedLocation || "").trim(),
                  street: String(row.street || "").trim(),
                  barangay: String(row.barangay || "").trim(),
                  classification: String(row.classification || "").trim(),
                  area: String(row.area || "").trim(),
                  assessedValue: String(row.assessedValue || "").trim(),
                  previousTdNo: String(row.previousTdNo || "").trim(),
                  previousOwner: String(row.previousOwner || "").trim(),
                  previousAssessedValue: String(row.previousAssessedValue || "").trim(),
                },
                errors: [err?.message || "Internal writing error"]
              });
              console.error("Row import failed", err);
            }
          }

          setResults({ success, failed });
          setSkippedProperties(skippedItems);
          setStatus("success");
          await logAudit("CREATE", "Import", "batch", null, { count: success });
        } catch (err: any) {
          console.error("Import process failed", err);
          setErrorMessage(err?.message || "An unexpected database error occurred during import.");
          setStatus("error");
          handleFirestoreError(err, OperationType.GET, "properties");
        }
      }
    });
  };

  const handleCorrectAndImport = async (item: SkippedProperty) => {
    if (!editFormData) return;
    setCorrectingId(item.id);
    setCorrectionError(null);

    try {
      const userName = profile?.username || profile?.displayName || "Imported (Corrected)";
      
      const tdRaw = String(editFormData.tdNumber || "").trim();
      const ownerNameRaw = String(editFormData.ownerName || "").trim();
      const assessedValueRawStr = String(editFormData.assessedValue || "").trim();
      const assessedValueRaw = parseCleanFloat(assessedValueRawStr);
      const barangayRaw = String(editFormData.barangay || "").trim();
      const effectivityDateRaw = String(editFormData.effectivityDate || "").trim();
      const pinRaw = String(editFormData.pin || "").trim();

      const validationErrors: string[] = [];
      if (!tdRaw) validationErrors.push("Tax Declaration Number (TD No) is required.");
      if (!ownerNameRaw) validationErrors.push("Owner Name is required.");
      if (assessedValueRawStr === "" || isNaN(assessedValueRaw) || assessedValueRaw <= 0) {
        validationErrors.push("Assessed Value must be a valid positive number.");
      }
      if (!barangayRaw) validationErrors.push("Barangay is required.");
      if (!effectivityDateRaw) validationErrors.push("Effectivity Year/Date is required.");

      if (validationErrors.length > 0) {
        throw new Error(validationErrors.join(" "));
      }

      // Check if duplicate TDN exists in DB
      const q = query(collection(db, "properties"), where("tdNumber", "==", tdRaw));
      const snap = await getDocs(q);
      const isDuplicate = !snap.empty;

      if (isDuplicate && !overwriteDuplicates) {
        throw new Error(`Duplicate TD Number: "${tdRaw}" is already registered in the system database.`);
      }

      if (isDuplicate && overwriteDuplicates) {
        const docId = snap.docs[0].id;
        await updateDoc(doc(db, "properties", docId), {
          pin: pinRaw || tdRaw,
          ownerName: ownerNameRaw,
          ownerAddress: editFormData.ownerAddress || "",
          administratorName: editFormData.administratorName || "",
          administratorAddress: editFormData.administratorAddress || "",
          effectivityDate: effectivityDateRaw,
          tdNumber: tdRaw,
          detailedLocation: editFormData.detailedLocation || barangayRaw,
          street: editFormData.street || "",
          barangay: barangayRaw,
          municipality: "Dipaculao",
          province: "Aurora",
          lotNo: editFormData.lotNo || "",
          blkNo: editFormData.blkNo || "",
          octTct: editFormData.octTct || "",
          cctCloa: editFormData.cctCloa || "",
          classification: (editFormData.classification || "LAND").toUpperCase() as any,
          area: editFormData.area || "0 sqm",
          assessedValue: assessedValueRaw,
          previousTdNo: editFormData.previousTdNo || "",
          previousOwner: editFormData.previousOwner || "",
          previousAssessedValue: parseCleanFloat(editFormData.previousAssessedValue),
          isArchived: false,
          updatedAt: serverTimestamp(),
          imported: true
        });
        await logAudit("UPDATE", "ImportCorrection", docId, null, { ownerName: ownerNameRaw, tdNumber: tdRaw });
        await handleDelinquencyGeneration(docId, effectivityDateRaw, assessedValueRaw);
      } else {
        const newDocRef = await addDoc(collection(db, "properties"), {
          pin: pinRaw || tdRaw,
          ownerName: ownerNameRaw,
          ownerAddress: editFormData.ownerAddress || "",
          administratorName: editFormData.administratorName || "",
          administratorAddress: editFormData.administratorAddress || "",
          effectivityDate: effectivityDateRaw,
          tdNumber: tdRaw,
          detailedLocation: editFormData.detailedLocation || barangayRaw,
          street: editFormData.street || "",
          barangay: barangayRaw,
          municipality: "Dipaculao",
          province: "Aurora",
          lotNo: editFormData.lotNo || "",
          blkNo: editFormData.blkNo || "",
          octTct: editFormData.octTct || "",
          cctCloa: editFormData.cctCloa || "",
          classification: (editFormData.classification || "LAND").toUpperCase() as any,
          area: editFormData.area || "0 sqm",
          assessedValue: assessedValueRaw,
          previousTdNo: editFormData.previousTdNo || "",
          previousOwner: editFormData.previousOwner || "",
          previousAssessedValue: parseCleanFloat(editFormData.previousAssessedValue),
          isArchived: false,
          recordedBy: userName,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          imported: true
        });
        await logAudit("CREATE", "ImportCorrection", tdRaw, null, { ownerName: ownerNameRaw, tdNumber: tdRaw });
        await handleDelinquencyGeneration(newDocRef.id, effectivityDateRaw, assessedValueRaw);
      }

      setResults(prev => ({
        success: prev.success + 1,
        failed: Math.max(0, prev.failed - 1)
      }));

      await logAudit("CREATE", "ImportCorrection", tdRaw, null, { ownerName: ownerNameRaw, tdNumber: tdRaw });

      const remaining = skippedProperties.filter(p => p.id !== item.id);
      setSkippedProperties(remaining);

      if (remaining.length > 0) {
        setSelectedSkippedId(remaining[0].id);
        setEditFormData({ ...remaining[0].data });
      } else {
        setSelectedSkippedId(null);
        setEditFormData(null);
        setShowSkippedModal(false);
      }
    } catch (err: any) {
      console.error(err);
      setCorrectionError(err.message || "Failed to import property correction.");
    } finally {
      setCorrectingId(null);
    }
  };

  const handleDiscardSkipped = (itemId: string) => {
    const remaining = skippedProperties.filter(p => p.id !== itemId);
    setSkippedProperties(remaining);
    
    setResults(prev => ({
      ...prev,
      failed: Math.max(0, prev.failed - 1)
    }));

    if (remaining.length > 0) {
      setSelectedSkippedId(remaining[0].id);
      setEditFormData({ ...remaining[0].data });
    } else {
      setSelectedSkippedId(null);
      setEditFormData(null);
      setShowSkippedModal(false);
    }
  };

  const isReviewing = status === "success" && showSkippedModal && skippedProperties.length > 0;
  const modalMaxWidth = isReviewing ? "max-w-5xl" : "max-w-md";

  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
      <div className={`bg-slate-900 rounded-2xl shadow-3xl w-full ${modalMaxWidth} overflow-hidden border border-slate-800 ring-1 ring-white/5 transition-all duration-300`}>
        <div className="p-6 border-b border-slate-800 flex items-center justify-between bg-slate-900/50">
          <h3 className="font-bold text-white flex items-center gap-2">
            <Upload className="w-4 h-4 text-blue-400" />
            Data Migration (CSV)
          </h3>
          <button onClick={onClose} className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 transition-colors">
            <X className="w-5 h-5"/>
          </button>
        </div>

        {isReviewing ? (
          <div className="flex flex-col h-[650px] md:flex-row overflow-hidden divide-y md:divide-y-0 md:divide-x divide-slate-800 bg-slate-900 border-t border-slate-800">
            {/* Left Panel: Skipped items list */}
            <div className="w-full md:w-80 shrink-0 flex flex-col h-full bg-slate-950/20 overflow-hidden">
              <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/60 shrink-0">
                <span className="text-xs font-black text-slate-400 uppercase tracking-wider block">Skipped Items ({skippedProperties.length})</span>
                <span className="text-[10px] bg-red-500/10 border border-red-500/20 text-red-400 font-mono px-2 py-0.5 rounded font-bold uppercase tracking-wider">
                  Needs Repair
                </span>
              </div>
              
              <div className="flex-1 overflow-y-auto divide-y divide-slate-800/40">
                {skippedProperties.map(item => {
                  const isActive = selectedSkippedId === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setSelectedSkippedId(item.id);
                        setEditFormData({ ...item.data });
                        setCorrectionError(null);
                      }}
                      className={`w-full text-left p-4 transition-all hover:bg-slate-850/50 flex flex-col gap-1 cursor-pointer border-l-2 ${isActive ? 'bg-blue-500/5 border-l-blue-500' : 'border-l-transparent'}`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-xs text-white truncate max-w-[140px]">
                          {item.data.ownerName || "No Name Provided"}
                        </span>
                        <span className="text-[10px] text-slate-500 font-mono bg-slate-900 border border-slate-800 px-1.5 py-0.5 rounded font-bold">
                          Row #{item.originalIndex}
                        </span>
                      </div>
                      
                      <div className="text-[10px] text-slate-400 font-mono flex items-center justify-between mt-1">
                        <span>TD: {item.data.tdNumber || "MISSING"}</span>
                        <span className="text-emerald-400">₱{parseCleanFloat(item.data.assessedValue || "0")?.toLocaleString() || "0"}</span>
                      </div>

                      <div className="mt-2 space-y-1">
                        {item.errors.map((err, i) => (
                          <div key={i} className="text-[9px] text-red-400 font-bold leading-normal flex items-start gap-1">
                            <span className="text-red-500 shrink-0 select-none">•</span>
                            <span>{err}</span>
                          </div>
                        ))}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Right Panel: Active item's Correction Form */}
            <div className="flex-1 flex flex-col h-full bg-slate-900/40 overflow-hidden">
              <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/60 shrink-0">
                <div>
                  <h4 className="text-xs font-black text-blue-400 uppercase tracking-widest block">Correct & Resolve Errors</h4>
                  <p className="text-[10px] text-slate-400 mt-1">Submit corrected values to direct register inside database.</p>
                </div>
                
                {selectedSkippedId && (
                  <button
                    type="button"
                    onClick={() => handleDiscardSkipped(selectedSkippedId)}
                    className="text-[10px] text-slate-500 hover:text-red-400 font-bold uppercase tracking-wider flex items-center gap-1 border border-slate-800 px-2 py-1 rounded bg-slate-950 hover:bg-slate-955/80 transition-colors cursor-pointer"
                  >
                    <Trash2 className="w-3 h-3 text-red-400" />
                    Discard Entry
                  </button>
                )}
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                {correctionError && (
                  <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                    <div className="text-xs text-red-400 font-bold leading-relaxed">{correctionError}</div>
                  </div>
                )}

                {selectedSkippedId && editFormData ? (
                  <div className="space-y-6">
                    {/* Section 1: Ownership Identity */}
                    <div className="space-y-3">
                      <h5 className="text-[10px] font-black text-slate-500 uppercase tracking-widest border-b border-slate-800 pb-1.5">1. Owners & Administrators</h5>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider flex items-center gap-1">
                            Owner Name <span className="text-red-500 font-bold shrink-0">*</span>
                          </label>
                          <input
                            type="text"
                            value={editFormData.ownerName || ""}
                            onChange={(e) => setEditFormData({ ...editFormData, ownerName: e.target.value })}
                            placeholder="Enter Owner Name"
                            className="w-full bg-slate-950 border border-slate-800 focus:border-blue-500 rounded-xl py-2 px-3 text-xs text-white outline-none font-sans"
                          />
                        </div>

                        <div className="space-y-1">
                          <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Owner Address</label>
                          <input
                            type="text"
                            value={editFormData.ownerAddress || ""}
                            onChange={(e) => setEditFormData({ ...editFormData, ownerAddress: e.target.value })}
                            placeholder="Street / Barangay / Municipality / Province"
                            className="w-full bg-slate-950 border border-slate-800 focus:border-blue-500 rounded-xl py-2 px-3 text-xs text-white outline-none font-sans"
                          />
                        </div>

                        <div className="space-y-1">
                          <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Administrator Name</label>
                          <input
                            type="text"
                            value={editFormData.administratorName || ""}
                            onChange={(e) => setEditFormData({ ...editFormData, administratorName: e.target.value })}
                            placeholder="Enter Admin Name"
                            className="w-full bg-slate-950 border border-slate-800 focus:border-blue-500 rounded-xl py-2 px-3 text-xs text-white outline-none font-sans"
                          />
                        </div>

                        <div className="space-y-1">
                          <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Administrator Address</label>
                          <input
                            type="text"
                            value={editFormData.administratorAddress || ""}
                            onChange={(e) => setEditFormData({ ...editFormData, administratorAddress: e.target.value })}
                            placeholder="Enter Admin Address"
                            className="w-full bg-slate-950 border border-slate-800 focus:border-blue-500 rounded-xl py-2 px-3 text-xs text-white outline-none font-sans"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Section 2: Real Property Real Estate Spec */}
                    <div className="space-y-3 pt-2">
                      <h5 className="text-[10px] font-black text-slate-500 uppercase tracking-widest border-b border-slate-800 pb-1.5">2. Registry Identifiers & Mapping</h5>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider flex items-center gap-1">
                            Tax Declaration No. (TDN) <span className="text-red-500 font-bold shrink-0">*</span>
                          </label>
                          <input
                            type="text"
                            value={editFormData.tdNumber || ""}
                            onChange={(e) => setEditFormData({ ...editFormData, tdNumber: e.target.value })}
                            placeholder="Format: YY-MM-BBB-NNNNN"
                            className="w-full bg-slate-950 border border-slate-800 focus:border-blue-500 rounded-xl py-2 px-3 text-xs text-white font-mono outline-none"
                          />
                        </div>

                        <div className="space-y-1">
                          <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Property PIN</label>
                          <input
                            type="text"
                            value={editFormData.pin || ""}
                            onChange={(e) => setEditFormData({ ...editFormData, pin: e.target.value })}
                            placeholder="Leave as PIN or same as TDN"
                            className="w-full bg-slate-950 border border-slate-800 focus:border-blue-500 rounded-xl py-2 px-3 text-xs text-white font-mono outline-none"
                          />
                        </div>

                        <div className="space-y-1">
                          <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Classification</label>
                          <select
                            value={editFormData.classification || "LAND"}
                            onChange={(e) => setEditFormData({ ...editFormData, classification: e.target.value })}
                            className="w-full bg-slate-950 border border-slate-800 focus:border-blue-500 rounded-xl py-2 px-3 text-xs text-white outline-none font-sans"
                          >
                            <option value="LAND">LAND</option>
                            <option value="BUILDING">BUILDING</option>
                            <option value="MACHINERY">MACHINERY</option>
                            <option value="SPECIAL">SPECIAL</option>
                          </select>
                        </div>

                        <div className="space-y-1">
                          <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Property Lot Area</label>
                          <input
                            type="text"
                            value={editFormData.area || ""}
                            onChange={(e) => setEditFormData({ ...editFormData, area: e.target.value })}
                            placeholder="e.g. 500 sqm"
                            className="w-full bg-slate-950 border border-slate-800 focus:border-blue-500 rounded-xl py-2 px-3 text-xs text-white font-mono outline-none"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Section 3: Value, Valuation times, Location details */}
                    <div className="space-y-3 pt-2">
                      <h5 className="text-[10px] font-black text-slate-500 uppercase tracking-widest border-b border-slate-800 pb-1.5">3. Assessment, Location & Effectivity</h5>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider flex items-center gap-1">
                            Assessed Valuation (PHP) <span className="text-red-500 font-bold shrink-0">*</span>
                          </label>
                          <input
                            type="number"
                            value={editFormData.assessedValue || ""}
                            onChange={(e) => setEditFormData({ ...editFormData, assessedValue: e.target.value })}
                            placeholder="0"
                            className="w-full bg-slate-950 border border-slate-800 focus:border-blue-500 rounded-xl py-2 px-3 text-xs text-white font-mono outline-none"
                          />
                        </div>

                        <div className="space-y-1">
                          <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider flex items-center gap-1">
                            Effectivity Year / Date <span className="text-red-500 font-bold shrink-0">*</span>
                          </label>
                          <input
                            type="text"
                            value={editFormData.effectivityDate || ""}
                            onChange={(e) => setEditFormData({ ...editFormData, effectivityDate: e.target.value })}
                            placeholder="e.g. 2026"
                            className="w-full bg-slate-950 border border-slate-800 focus:border-blue-500 rounded-xl py-2 px-3 text-xs text-white font-mono outline-none"
                          />
                        </div>

                        <div className="space-y-1">
                          <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider flex items-center gap-1">
                            Barangay Location <span className="text-red-500 font-bold shrink-0">*</span>
                          </label>
                          <input
                            type="text"
                            value={editFormData.barangay || ""}
                            onChange={(e) => setEditFormData({ ...editFormData, barangay: e.target.value })}
                            placeholder="Entering Brgy Name"
                            className="w-full bg-slate-955 border border-slate-800 focus:border-blue-500 rounded-xl py-2 px-3 text-xs text-white outline-none font-sans"
                          />
                        </div>

                        <div className="space-y-1">
                          <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Detailed Location / Street</label>
                          <input
                            type="text"
                            value={editFormData.detailedLocation || ""}
                            onChange={(e) => setEditFormData({ ...editFormData, detailedLocation: e.target.value })}
                            placeholder="Zone details / landmark description"
                            className="w-full bg-slate-950 border border-slate-800 focus:border-blue-500 rounded-xl py-2 px-3 text-xs text-white outline-none font-sans"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Section 4: Previous property context (Optional) */}
                    <div className="space-y-3 pt-2">
                      <h5 className="text-[10px] font-black text-slate-500 uppercase tracking-widest border-b border-slate-800 pb-1.5">4. Prior Year Assessment Context (Optional)</h5>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="space-y-1">
                          <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Previous TDN</label>
                          <input
                            type="text"
                            value={editFormData.previousTdNo || ""}
                            onChange={(e) => setEditFormData({ ...editFormData, previousTdNo: e.target.value })}
                            placeholder="Prior TD No"
                            className="w-full bg-slate-950 border border-slate-800 focus:border-blue-500 rounded-xl py-2 px-3 text-xs text-white font-mono outline-none"
                          />
                        </div>

                        <div className="space-y-1">
                          <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Previous Owner</label>
                          <input
                            type="text"
                            value={editFormData.previousOwner || ""}
                            onChange={(e) => setEditFormData({ ...editFormData, previousOwner: e.target.value })}
                            placeholder="Prior Owner Name"
                            className="w-full bg-slate-950 border border-slate-800 focus:border-blue-500 rounded-xl py-2 px-3 text-xs text-white outline-none font-sans"
                          />
                        </div>

                        <div className="space-y-1">
                          <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Previous Assessed Value</label>
                          <input
                            type="number"
                            value={editFormData.previousAssessedValue || ""}
                            onChange={(e) => setEditFormData({ ...editFormData, previousAssessedValue: e.target.value })}
                            placeholder="Prior Valuation (PHP)"
                            className="w-full bg-slate-950 border border-slate-805 border-slate-800 focus:border-blue-500 rounded-xl py-2 px-3 text-xs text-white font-mono outline-none"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-12 text-slate-500 italic text-xs">
                    Select a skipped property from the checklist to resolve its assessment flaws.
                  </div>
                )}
              </div>

              <div className="p-4 border-t border-slate-800 bg-slate-950/20 flex items-center justify-between shrink-0">
                <button
                  type="button"
                  onClick={() => setShowSkippedModal(false)}
                  className="px-4 py-2 border border-slate-800 text-slate-400 hover:text-white rounded-lg text-xs font-black uppercase tracking-wider transition-all hover:bg-slate-800/40 cursor-pointer"
                >
                  Close Correction Panel
                </button>

                {selectedSkippedId && (
                  <button
                    type="button"
                    onClick={() => {
                      const currentItem = skippedProperties.find(p => p.id === selectedSkippedId);
                      if (currentItem) handleCorrectAndImport(currentItem);
                    }}
                    disabled={correctingId !== null}
                    className="px-5 py-2.5 bg-blue-500 hover:bg-blue-600 disabled:opacity-50 text-white rounded-lg text-xs font-black uppercase tracking-wider shadow-lg shadow-blue-500/20 transition-all flex items-center gap-2 cursor-pointer"
                  >
                    {correctingId !== null ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Validating & Importing...
                      </>
                    ) : (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        Correct & Import Property
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="p-8">
            {status === "idle" && (
            <div className="space-y-6">
              <div className="bg-slate-950/40 border border-slate-800/80 rounded-xl p-4 flex items-center justify-between">
                <div className="pr-3">
                  <h4 className="text-xs font-bold text-slate-300">Need the CSV Template?</h4>
                  <p className="text-[10px] text-slate-500 mt-1 leading-snug">Download the pre-formatted structure with headers and samples.</p>
                </div>
                <button 
                  onClick={downloadTemplate}
                  type="button"
                  className="flex items-center gap-1.5 px-3 py-2 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 hover:text-blue-300 rounded-lg text-xs font-bold transition border border-blue-500/20 shrink-0 select-none shadow-sm shadow-blue-500/5"
                >
                  <Download className="w-3.5 h-3.5" />
                  Template
                </button>
              </div>

              <div className="border-2 border-dashed border-slate-800 rounded-2xl p-10 text-center hover:border-blue-500/50 hover:bg-blue-500/5 transition-all cursor-pointer relative group">
                <input 
                  type="file" 
                  accept=".csv" 
                  onChange={handleFileChange}
                  className="absolute inset-0 opacity-0 cursor-pointer z-10"
                />
                <div className="bg-slate-800 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform duration-300">
                  <Upload className="w-8 h-8 text-blue-400" />
                </div>
                <p className="text-sm font-semibold text-white tracking-wide">
                  {file ? file.name : "Click to select CSV file"}
                </p>
                <p className="text-xs text-slate-500 mt-2">Required columns: tdNumber, ownerName, assessedValue, barangay (pin is optional)</p>
              </div>
              {file && (
                <div className="flex items-center gap-3 bg-slate-950/40 p-3.5 rounded-xl border border-slate-800/80 text-left">
                  <input
                    type="checkbox"
                    id="overwriteDuplicates"
                    checked={overwriteDuplicates}
                    onChange={(e) => setOverwriteDuplicates(e.target.checked)}
                    className="w-4 h-4 rounded text-blue-500 bg-slate-950 border-slate-800 focus:ring-0 cursor-pointer accent-blue-500"
                  />
                  <div className="space-y-0.5 cursor-pointer select-none" onClick={() => setOverwriteDuplicates(!overwriteDuplicates)}>
                    <label htmlFor="overwriteDuplicates" className="text-xs font-bold text-slate-200 block cursor-pointer">
                      Overwrite Existing Properties
                    </label>
                    <span className="text-[10px] text-slate-500 block">
                      Update details of existing properties in the database if TD Numbers match, instead of skipping them.
                    </span>
                  </div>
                </div>
              )}
              <button 
                onClick={startImport}
                disabled={!file}
                className="w-full py-3.5 bg-[#002060] text-white rounded-xl font-bold hover:bg-[#001540] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-xl shadow-[#002060]/20"
              >
                Start Migration
              </button>
            </div>
          )}

          {(status === "parsing" || status === "uploading") && (
            <div className="text-center py-12 space-y-4">
              <div className="relative w-20 h-20 mx-auto">
                <div className="absolute inset-0 border-4 border-blue-500/20 rounded-full"></div>
                <Loader2 className="w-20 h-20 text-blue-500 animate-spin relative z-10" />
              </div>
              <p className="text-slate-300 font-medium animate-pulse">Processing records... Please wait</p>
            </div>
          )}

          {status === "success" && (
            <div className="text-center py-6 space-y-6">
              <div className="w-20 h-20 bg-emerald-500/10 text-emerald-400 rounded-3xl flex items-center justify-center mx-auto rotate-12">
                <Check className="w-10 h-10 -rotate-12" />
              </div>
              <div>
                <h4 className="text-xl font-bold text-white">Import Complete</h4>
                <div className="mt-4 space-y-2 p-4 bg-slate-950/50 rounded-xl border border-slate-800/50">
                  <p className="text-emerald-400 text-sm font-bold flex items-center justify-center gap-2">
                    <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full"></span>
                    {results.success} properties imported
                  </p>
                  <p className="text-red-400 text-sm font-bold flex items-center justify-center gap-2">
                    <span className="w-1.5 h-1.5 bg-red-400 rounded-full"></span>
                    {results.failed} skipped (duplicates/invalid)
                  </p>
                </div>
              </div>

              {skippedProperties.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setShowSkippedModal(true);
                    setSelectedSkippedId(skippedProperties[0].id);
                    setEditFormData({ ...skippedProperties[0].data });
                    setCorrectionError(null);
                  }}
                  className="w-full py-3 bg-amber-500 hover:bg-amber-600 text-slate-950 rounded-xl font-bold transition-all shadow-xl shadow-amber-500/25 uppercase tracking-wider text-xs flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Edit3 className="w-4 h-4" />
                  Correct {skippedProperties.length} Skipped Errors
                </button>
              )}

              <button 
                onClick={onClose}
                className="w-full py-3.5 bg-slate-800 text-white rounded-xl font-bold hover:bg-slate-700 active:scale-[0.98] transition-all border border-slate-700 cursor-pointer"
              >
                Return to Dashboard
              </button>
            </div>
          )}

          {status === "error" && (
            <div className="text-center py-6 space-y-6">
              <div className="w-20 h-20 bg-rose-500/10 text-rose-400 rounded-3xl flex items-center justify-center mx-auto rotate-12 animate-bounce">
                <AlertCircle className="w-10 h-10 -rotate-12 animate-pulse text-rose-500" />
              </div>
              <div>
                <h4 className="text-xl font-bold text-white">Import Failed</h4>
                <p className="text-slate-400 text-xs mt-3 font-medium px-4 leading-relaxed bg-slate-950/40 p-4 rounded-xl border border-slate-800/80">
                  {errorMessage || "An unexpected error occurred while parsing or uploading the CSV data."}
                </p>
              </div>
              <div className="space-y-3 pt-2">
                <button 
                  onClick={() => {
                    setStatus("idle");
                    setErrorMessage(null);
                  }}
                  className="w-full py-3.5 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-500 active:scale-[0.98] transition-all shadow-xl shadow-blue-600/20"
                >
                  Try Again
                </button>
                <button 
                  onClick={onClose}
                  className="w-full py-3.5 bg-slate-800 text-slate-300 rounded-xl font-bold hover:bg-slate-700 active:scale-[0.98] transition-all border border-slate-700"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
          </div>
        )}
      </div>
    </div>
  );
};

export default ExcelImporter;
