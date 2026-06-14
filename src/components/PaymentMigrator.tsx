import React, { useState } from "react";
import Papa from "papaparse";
import { 
  collection, 
  addDoc, 
  setDoc,
  serverTimestamp,
  db,
  handleFirestoreError,
  OperationType,
  getDocs,
  query,
  where,
  updateDoc,
  doc
} from "../lib/firebase";
import { Upload, X, Loader2, Download, AlertCircle, Check } from "lucide-react";
import { logAudit } from "../lib/audit";
import { useAuth } from "../AuthContext";

interface ImporterProps {
  onClose: () => void;
}

export const PaymentMigrator: React.FC<ImporterProps> = ({ onClose }) => {
  const { profile } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<"idle" | "parsing" | "uploading" | "success" | "error">("idle");
  const [results, setResults] = useState({ success: 0, failed: 0, total: 0, cleared: 0 });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const parseCleanFloat = (val: any): number => {
    if (val === undefined || val === null) return 0;
    const str = String(val).replace(/,/g, '').trim();
    const num = parseFloat(str);
    return isNaN(num) ? 0 : num;
  };

  const downloadTemplate = () => {
    const headers = [
      "OR_Number",
      "Payment_Date",
      "TDN",
      "Tax_Year",
      "Basic_Tax",
      "SEF",
      "Penalty",
      "Total_Amount"
    ];
    
    const sampleRow = [
      "998123456",
      "2026-03-15",
      "22-09-001-00054",
      "2025",
      "500",
      "500",
      "20",
      "1020"
    ];

    const csvContent = [headers.join(","), sampleRow.join(",")].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", "payment_migration_template.csv");
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const startImport = async () => {
    if (!file) return;
    setStatus("parsing");
    setErrorMessage(null);
    
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (header) => header.trim(),
      complete: async (parsed) => {
        const userName = profile?.username || profile?.displayName || "Migrated_System";
        
        try {
          const rows = parsed.data as any[];
          if (rows.length === 0) {
            setErrorMessage("The CSV file is empty.");
            setStatus("error");
            return;
          }

          // 1. Column Validation
          const fields = (parsed.meta.fields || []).map((f: string) => f.trim());
          const requiredColumns = ["OR_Number", "Payment_Date", "TDN", "Tax_Year", "Total_Amount"];
          const missingColumns = requiredColumns.filter(col => !fields.includes(col));

          if (missingColumns.length > 0) {
            setErrorMessage(`Missing required columns: ${missingColumns.join(", ")}. Please use the template.`);
            setStatus("error");
            return;
          }

          setStatus("uploading");
          let success = 0;
          let failed = 0;
          let cleared = 0;

          // Create a new batch track document reference
          const batchDocRef = doc(collection(db, "import_batches"));
          const generatedBatchId = batchDocRef.id;

          // Insert high-level tracking document matching schema
          await setDoc(batchDocRef, {
            batch_id: generatedBatchId,
            filename: file.name,
            imported_by: profile?.username || profile?.displayName || profile?.email || "System",
            record_count: 0,
            import_date: new Date().toISOString(),
            status: "Active"
          });

          // Process row by row
          for (let row of rows) {
            try {
              const OR_Number = String(row.OR_Number || "").trim();
              const paymentDate = String(row.Payment_Date || "").trim();
              const TDN = String(row.TDN || "").trim();
              const taxYear = parseInt(String(row.Tax_Year || "").trim(), 10);
              const basicTax = parseCleanFloat(row.Basic_Tax);
              const sef = parseCleanFloat(row.SEF);
              const penalty = parseCleanFloat(row.Penalty);
              const totalAmount = parseCleanFloat(row.Total_Amount);

              if (!OR_Number || !TDN || !taxYear || isNaN(totalAmount)) {
                failed++;
                continue;
              }

              // Duplicate checking: Does this OR exist? Or does the delinquency exist and is paid?
              // Actually we check if a payment with OR_Number exists.
              const pq = query(collection(db, "payments"), where("orNumber", "==", OR_Number), where("taxYear", "==", taxYear), where("status", "==", "Active"));
              const pSnap = await getDocs(pq);
              
              if (!pSnap.empty) {
                // OR number already exists for this tax year, skip to prevent double posting
                failed++;
                continue;
              }

              // 1. Resolve Property
              const propQ = query(collection(db, "properties"), where("tdNumber", "==", TDN));
              const propSnap = await getDocs(propQ);
              
              let propertyId = "SYSTEM_ORPHAN";
              let assessedValue = 0;
              let payerName = "MIGRATED_RECORD";

              if (!propSnap.empty) {
                  const pDoc = propSnap.docs[0];
                  propertyId = pDoc.id;
                  assessedValue = pDoc.data().assessedValue || 0;
                  payerName = pDoc.data().ownerName || "MIGRATED_RECORD";
              }

              // 2. Resolve or Create Delinquency Record
              let delinquencyId = "SYSTEM_GENERATED";
              
              if (propertyId !== "SYSTEM_ORPHAN") {
                const dq = query(collection(db, "delinquencies"), where("propertyId", "==", propertyId), where("year", "==", taxYear));
                const dqSnap = await getDocs(dq);
                
                if (!dqSnap.empty) {
                  const dDoc = dqSnap.docs[0];
                  delinquencyId = dDoc.id;
                  
                  // Action A: Delinquency Resolution Logic (The Core Requirement)
                  // Update delinquency to Paid, which naturally hides it from the Delinquency Register.
                  if (dDoc.data().status !== "Paid") {
                    await updateDoc(doc(db, "delinquencies", delinquencyId), {
                        status: "Paid",
                        totalPaid: totalAmount,
                        updatedAt: serverTimestamp(),
                        paymentDetails: {
                            orNumber: OR_Number,
                            paymentDate: paymentDate,
                            amountPaid: totalAmount,
                            paymentType: "Migrated"
                        }
                    });
                    cleared++;
                  }
                } else {
                  // The property exists but no delinquency for this year, create a PAID delinquency
                  const newDqRef = await addDoc(collection(db, "delinquencies"), {
                      propertyId: propertyId,
                      year: taxYear,
                      basicTaxDue: basicTax,
                      sefTaxDue: sef,
                      penalty: penalty,
                      interest: 0,
                      totalDue: totalAmount,
                      totalPaid: totalAmount,
                      status: "Paid",
                      recordedBy: userName,
                      createdAt: serverTimestamp(),
                      updatedAt: serverTimestamp(),
                      paymentDetails: {
                        orNumber: OR_Number,
                        paymentDate: paymentDate,
                        amountPaid: totalAmount,
                        paymentType: "Migrated"
                      }
                  });
                  delinquencyId = newDqRef.id;
                  cleared++;
                }
              }

              // 3. Insert Payment
              const paymentData = {
                batch_id: generatedBatchId,
                propertyId: propertyId,
                delinquencyId: delinquencyId,
                taxYear: taxYear,
                assessedValue: assessedValue,
                orNumber: OR_Number,
                paymentDate: paymentDate,
                payerName: payerName,
                paymentType: "Full",
                amountPaid: totalAmount,
                basicPaid: basicTax,
                sefPaid: sef,
                penaltyPaid: penalty,
                recordedBy: userName,
                approvedBy: userName,
                treasurer: "Migrated",
                deputy: "Migrated",
                status: "Active",
                recordedAt: serverTimestamp(),
                migrated: true
              };

              await addDoc(collection(db, "payments"), paymentData);

              success++;
            } catch (err) {
              console.error("Migration error row:", row, err);
              failed++;
            }
          }

          // Update finalized counts on audit batch document
          await updateDoc(batchDocRef, {
            record_count: success
          });

          setResults({ success, failed, total: rows.length, cleared });
          setStatus("success");
          await logAudit("CREATE", "PaymentMigration", generatedBatchId, null, { count: success, file: file.name });
        } catch (err: any) {
          console.error("Migration process failed", err);
          setErrorMessage(err?.message || "An unexpected error occurred during CSV parsing.");
          setStatus("error");
        }
      }
    });
  };

  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 rounded-2xl shadow-3xl w-full max-w-md overflow-hidden border border-slate-800 ring-1 ring-white/5 transition-all duration-300">
        <div className="p-6 border-b border-slate-800 flex items-center justify-between bg-slate-900/50">
          <h3 className="font-bold text-white flex items-center gap-2">
            <Upload className="w-4 h-4 text-blue-400" />
            Import Collection Records
          </h3>
          <button onClick={onClose} className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 transition-colors">
            <X className="w-5 h-5"/>
          </button>
        </div>

        <div className="p-6 space-y-6">
          {status === "idle" || status === "parsing" || status === "error" ? (
            <>
              {status === "error" && errorMessage && (
                <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-500 text-sm rounded-lg flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span className="leading-snug font-bold">{errorMessage}</span>
                </div>
              )}
              
              <div className="space-y-4">
                <div className="text-[11px] text-slate-400 leading-relaxed mb-6">
                  Upload a CSV file containing batch payment records. The system will automatically reconcile and untag the properties from the Delinquency Ledger.
                </div>
                
                <div className="bg-slate-950/40 border border-slate-800/80 rounded-xl p-4 flex items-center justify-between">
                  <div className="pr-3">
                    <h4 className="text-xs font-bold text-slate-300">Need the CSV Template?</h4>
                    <p className="text-[10px] text-slate-500 mt-1 leading-snug">Download the pre-formatted structure with headers and samples.</p>
                  </div>
                  <button 
                    onClick={downloadTemplate}
                    type="button"
                    className="flex items-center gap-1.5 px-3 py-2 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 hover:text-blue-300 rounded-lg text-xs font-bold transition border border-blue-500/20 shrink-0 select-none shadow-sm shadow-blue-500/5 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Template
                  </button>
                </div>

                <div className="border-2 border-dashed border-slate-800 rounded-2xl p-10 text-center hover:border-blue-500/50 hover:bg-blue-500/5 transition-all cursor-pointer relative group">
                  <input 
                    type="file" 
                    accept=".csv"
                    onChange={(e) => {
                       if (e.target.files && e.target.files.length > 0) {
                         setFile(e.target.files[0]);
                         setStatus("idle");
                       }
                    }}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                  />
                  <div className="bg-slate-800 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform duration-300">
                    <Upload className="w-8 h-8 text-blue-400" />
                  </div>
                  <p className="text-sm font-semibold text-white tracking-wide">
                    {file ? file.name : "Select CSV File"}
                  </p>
                  <p className="text-xs text-slate-500 mt-2">
                    Drag & drop or click to browse
                  </p>
                  <p className="text-[10px] text-slate-500 mt-1">
                    Required columns: OR_Number, Payment_Date, TDN, Tax_Year, Total_Amount
                  </p>
                </div>

                <button 
                  onClick={startImport}
                  disabled={!file || status === "parsing"}
                  className="w-full bg-[#002060] hover:bg-[#001540] text-white font-bold py-3.5 rounded-xl uppercase tracking-widest text-xs flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-xl shadow-[#002060]/20"
                >
                  {status === "parsing" ? <Loader2 className="w-4 h-4 animate-spin"/> : null}
                  Import Records
                </button>
              </div>
            </>
          ) : status === "uploading" ? (
             <div className="py-12 flex flex-col items-center justify-center space-y-4">
               <Loader2 className="w-10 h-10 text-blue-500 animate-spin" />
               <p className="text-sm font-bold text-slate-300 animate-pulse">Running Reconciliation Logic...</p>
               <p className="text-xs text-slate-500">Updating Delinquency Ledger and migrating records.</p>
             </div>
          ) : status === "success" ? (
            <div className="py-6 text-center space-y-6">
              <div className="w-16 h-16 bg-emerald-500/10 border-2 border-emerald-500/20 text-emerald-500 rounded-full flex items-center justify-center mx-auto">
                <Check className="w-8 h-8" />
              </div>
              <div>
                <h4 className="text-lg font-black text-white uppercase tracking-wider">Migration Complete</h4>
                <p className="text-sm text-slate-400 mt-2 leading-relaxed">
                  Successfully imported <span className="text-emerald-400 font-bold">{results.success}</span> payment records.
                  <br/>
                  <span className="text-blue-400 font-bold">{results.cleared}</span> properties have been automatically cleared from the Delinquency Ledger.
                </p>
                {results.failed > 0 && (
                  <p className="text-xs text-amber-500 mt-4 bg-amber-500/10 py-2 px-3 rounded-lg border border-amber-500/20 inline-block font-mono">
                    Skipped {results.failed} duplicate/invalid records.
                  </p>
                )}
              </div>
              <button 
                onClick={onClose}
                className="w-full bg-slate-800 hover:bg-slate-700 text-white font-bold py-3 rounded-xl uppercase tracking-widest text-xs transition-colors"
              >
                Close & Refresh
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};
