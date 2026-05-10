import React, { useState } from "react";
import Papa from "papaparse";
import { 
  collection, 
  addDoc, 
  serverTimestamp,
  db,
  handleFirestoreError,
  OperationType,
  getDocs
} from "../lib/firebase";
import { Upload, Check, AlertCircle, X, Loader2 } from "lucide-react";
import { logAudit } from "../lib/audit";

interface ImporterProps {
  onClose: () => void;
}

const ExcelImporter: React.FC<ImporterProps> = ({ onClose }) => {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<"idle" | "parsing" | "uploading" | "success" | "error">("idle");
  const [results, setResults] = useState({ success: 0, failed: 0 });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) setFile(e.target.files[0]);
  };

  const startImport = () => {
    if (!file) return;
    setStatus("parsing");
    
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        setStatus("uploading");
        let success = 0;
        let failed = 0;

        try {
          // Fetch existing PINs to avoid duplicates
          const existingSnapshot = await getDocs(collection(db, "properties"));
          const existingPINs = new Set<string>();
          existingSnapshot.docs.forEach(doc => {
            if (doc.data().pin) {
              existingPINs.add(doc.data().pin);
            }
          });

          for (const row of results.data as any) {
            try {
              const pinRaw = String(row.pin || "").trim();
              if (!pinRaw || !row.ownerName) {
                failed++;
                continue;
              }

              if (existingPINs.has(pinRaw)) {
                failed++;
                continue;
              }

              existingPINs.add(pinRaw); // Add to set to prevent duplicates within the same CSV

              await addDoc(collection(db, "properties"), {
                pin: pinRaw,
                ownerName: String(row.ownerName).trim(),
                assessedValue: parseFloat(row.assessedValue) || 0,
                barangay: row.barangay || "Unknown",
                propertyType: row.propertyType || "Residential",
                isIdle: row.isIdle === "true" || row.isIdle === "1" || row.isIdle === "Yes",
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
                imported: true
              });
              success++;
            } catch (err) {
              failed++;
              console.error("Row import failed", err);
            }
          }

          setResults({ success, failed });
          setStatus("success");
          await logAudit("CREATE", "Import", "batch", null, { count: success });
        } catch (err) {
          console.error("Import process failed", err);
          setStatus("error");
          handleFirestoreError(err, OperationType.GET, "properties");
        }
      }
    });
  };

  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 rounded-2xl shadow-3xl w-full max-w-md overflow-hidden border border-slate-800 ring-1 ring-white/5">
        <div className="p-6 border-b border-slate-800 flex items-center justify-between bg-slate-900/50">
          <h3 className="font-bold text-white flex items-center gap-2">
            <Upload className="w-4 h-4 text-indigo-400" />
            Data Migration (CSV)
          </h3>
          <button onClick={onClose} className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 transition-colors">
            <X className="w-5 h-5"/>
          </button>
        </div>

        <div className="p-8">
          {status === "idle" && (
            <div className="space-y-6">
              <div className="border-2 border-dashed border-slate-800 rounded-2xl p-10 text-center hover:border-indigo-500/50 hover:bg-indigo-500/5 transition-all cursor-pointer relative group">
                <input 
                  type="file" 
                  accept=".csv" 
                  onChange={handleFileChange}
                  className="absolute inset-0 opacity-0 cursor-pointer z-10"
                />
                <div className="bg-slate-800 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform duration-300">
                  <Upload className="w-8 h-8 text-indigo-400" />
                </div>
                <p className="text-sm font-semibold text-white tracking-wide">
                  {file ? file.name : "Click to select CSV file"}
                </p>
                <p className="text-xs text-slate-500 mt-2">Required columns: pin, ownerName, assessedValue, barangay</p>
              </div>
              <button 
                onClick={startImport}
                disabled={!file}
                className="w-full py-3.5 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-500 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-xl shadow-indigo-600/20"
              >
                Start Migration
              </button>
            </div>
          )}

          {(status === "parsing" || status === "uploading") && (
            <div className="text-center py-12 space-y-4">
              <div className="relative w-20 h-20 mx-auto">
                <div className="absolute inset-0 border-4 border-indigo-500/20 rounded-full"></div>
                <Loader2 className="w-20 h-20 text-indigo-500 animate-spin relative z-10" />
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
              <button 
                onClick={onClose}
                className="w-full py-3.5 bg-slate-800 text-white rounded-xl font-bold hover:bg-slate-700 active:scale-[0.98] transition-all border border-slate-700"
              >
                Return to Dashboard
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ExcelImporter;
