import React, { useEffect, useState } from "react";
import { 
  collection, 
  db, 
  onSnapshot, 
  query, 
  orderBy, 
  getDocs, 
  where, 
  doc, 
  writeBatch 
} from "../lib/firebase";
import { useAuth } from "../AuthContext";
import { logAudit } from "../lib/audit";
import { motion, AnimatePresence } from "motion/react";
import { 
  History, 
  X, 
  RotateCcw, 
  AlertTriangle, 
  CheckCircle, 
  Database,
  Calendar,
  User,
  FileCheck
} from "lucide-react";

interface MigrationAuditLogModalProps {
  onClose: () => void;
}

interface ImportBatch {
  id: string; // Document ID
  batch_id: string;
  filename: string;
  imported_by: string;
  record_count: number;
  import_date: string;
  status: "Active" | "Rolled Back";
  rolled_back_at?: string;
  rolled_back_by?: string;
}

export const MigrationAuditLogModal: React.FC<MigrationAuditLogModalProps> = ({ onClose }) => {
  const { profile, isAdmin } = useAuth();
  const [batches, setBatches] = useState<ImportBatch[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Selected batch for confirmation
  const [confirmingBatch, setConfirmingBatch] = useState<ImportBatch | null>(null);
  const [isRollingBack, setIsRollingBack] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Sync import history in real-time
  useEffect(() => {
    const q = query(collection(db, "import_batches"), orderBy("import_date", "desc"));
    const unsub = onSnapshot(q, (snapshot) => {
      const bList = snapshot.docs.map(d => ({
        id: d.id,
        ...d.data()
      })) as ImportBatch[];
      setBatches(bList);
      setLoading(false);
    }, (err) => {
      console.error("Failed to sync import_batches:", err);
      setErrorMsg("Unable to retrieve migration history logs. Database offline.");
      setLoading(false);
    });

    return () => unsub();
  }, []);

  const handleRollback = async (batch: ImportBatch) => {
    if (!isAdmin) {
      setErrorMsg("Action Denied: Rollbacks are restricted strictly to Administrators.");
      return;
    }

    setIsRollingBack(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      // 1. Fetch payments belonging to this batch
      const paymentsQ = query(
        collection(db, "payments"), 
        where("batch_id", "==", batch.batch_id)
      );
      const paymentsSnap = await getDocs(paymentsQ);
      const paymentsList = paymentsSnap.docs.map(d => ({
        id: d.id,
        ...d.data()
      })) as any[];

      // 2. Run safeguard validations
      for (const p of paymentsList) {
        if (p.status !== "Active") {
          throw new Error(`Rollback Blocked: Payment for O.R. ${p.orNumber} is already Voided or altered.`);
        }

        // Query all active payments on this property to detect subsequent transactions
        const propPaymentsQ = query(
          collection(db, "payments"),
          where("propertyId", "==", p.propertyId),
          where("status", "==", "Active")
        );
        const propPaymentsSnap = await getDocs(propPaymentsQ);
        const propPayments = propPaymentsSnap.docs.map(d => d.data());

        // Check if there are any newer active payments linked to this property
        const hasNewer = propPayments.some((np: any) => {
          const npTime = np.recordedAt?.seconds || new Date(np.paymentDate).getTime() / 1000;
          const pTime = p.recordedAt?.seconds || new Date(p.paymentDate).getTime() / 1000;
          return npTime > pTime && np.orNumber !== p.orNumber;
        });

        if (hasNewer) {
          throw new Error(`Rollback Blocked: Property (linked to O.R. ${p.orNumber}) has subsequent active payment records, reporting is locked.`);
        }
      }

      // 3. Perform writeBatch transaction (Atomicity)
      const firestoreBatch = writeBatch(db);
      const currentYear = new Date().getFullYear();

      for (const p of paymentsList) {
        // Action A: Revert delinquency status to pre-import state
        if (p.delinquencyId) {
          const dRef = doc(db, "delinquencies", p.delinquencyId);
          const restoredStatus = p.taxYear >= currentYear ? "Pending" : "Delinquent";
          
          firestoreBatch.update(dRef, {
            status: restoredStatus,
            totalPaid: 0,
            updatedAt: new Date().toISOString(),
            paymentDetails: null
          });
        }

        // Action B: Purge payment records in this batch
        firestoreBatch.delete(doc(db, "payments", p.id));
      }

      // Action C: Mark batch as rolled back
      const bRef = doc(db, "import_batches", batch.id);
      firestoreBatch.update(bRef, {
        status: "Rolled Back",
        rolled_back_at: new Date().toISOString(),
        rolled_back_by: profile?.username || profile?.email || "Admin"
      });

      // Commit the database batch atomic write
      await firestoreBatch.commit();

      // Log a system audit trail log
      await logAudit("VOID", "PaymentMigrationRollback", batch.batch_id, null, {
        filename: batch.filename,
        record_count: batch.record_count,
        rolled_back_by: profile?.username || profile?.email || "Admin"
      });

      setSuccessMsg(`Successfully rolled back batch "${batch.filename}". Reverted ${batch.record_count} delinquencies.`);
      setConfirmingBatch(null);
    } catch (err: any) {
      console.error("Rollback execution failed:", err);
      setErrorMsg(err?.message || "Failed to successfully complete the secure database rollback.");
    } finally {
      setIsRollingBack(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 15 }}
        className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-4xl max-h-[85vh] flex flex-col shadow-2xl relative overflow-hidden"
      >
        {/* HEADER BLOCK */}
        <div className="p-6 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-blue-500/10 rounded-xl text-blue-400">
              <History className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white tracking-tight">Migration Audit Log &amp; History</h3>
              <p className="text-slate-500 text-xs mt-0.5">Chronological record of bulk imported records. Revert errors securely.</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="text-slate-400 hover:text-white p-2 rounded-lg hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* NOTIFICATION TOASTS */}
        {errorMsg && (
          <div className="mx-6 mt-4 p-4 bg-red-950/30 border border-red-500/30 rounded-xl flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
            <div className="text-xs text-red-200">
              <span className="font-bold">Rollback Error:</span> {errorMsg}
            </div>
          </div>
        )}

        {successMsg && (
          <div className="mx-6 mt-4 p-4 bg-green-950/30 border border-green-500/30 rounded-xl flex items-start gap-3">
            <CheckCircle className="w-5 h-5 text-green-400 shrink-0 mt-0.5" />
            <div className="text-xs text-green-200">
              <span className="font-bold">Success:</span> {successMsg}
            </div>
          </div>
        )}

        {/* LOGS DATATABLE */}
        <div className="p-6 overflow-y-auto flex-1">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent animate-spin rounded-full"></div>
              <p className="text-slate-400 text-sm">Syncing audit logs from Firestore...</p>
            </div>
          ) : batches.length === 0 ? (
            <div className="text-center py-16 border border-dashed border-slate-800 rounded-xl">
              <Database className="w-12 h-12 text-slate-700 mx-auto mb-3" />
              <p className="text-slate-400 font-bold mb-1 text-sm">No CSV imports registered</p>
              <p className="text-slate-500 text-xs">When you migrate files from the dashboard, records will show up here.</p>
            </div>
          ) : (
            <div className="overflow-x-auto border border-slate-800 rounded-xl">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-950/40 text-slate-400 uppercase tracking-wider text-[10px] border-b border-slate-800">
                    <th className="px-4 py-3.5 font-semibold">Import Details</th>
                    <th className="px-4 py-3.5 font-semibold">User</th>
                    <th className="px-4 py-3.5 font-semibold text-center">Records</th>
                    <th className="px-4 py-3.5 font-semibold text-center">Status</th>
                    <th className="px-4 py-3.5 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800 text-slate-300">
                  {batches.map((batch) => {
                    const isRolledBack = batch.status === "Rolled Back";
                    return (
                      <tr key={batch.id} className="hover:bg-slate-950/10 transition">
                        {/* Import Details */}
                        <td className="px-4 py-4">
                          <div className="font-bold text-white max-w-[280px] truncate" title={batch.filename}>
                            {batch.filename}
                          </div>
                          <div className="text-[10px] text-slate-500 flex items-center gap-1.5 mt-1">
                            <Calendar className="w-3.5 h-3.5 text-slate-600" />
                            {new Date(batch.import_date).toLocaleString()}
                          </div>
                        </td>

                        {/* User */}
                        <td className="px-4 py-4">
                          <div className="flex items-center gap-1.5 text-slate-400">
                            <User className="w-3.5 h-3.5 text-slate-600" />
                            <span>{batch.imported_by}</span>
                          </div>
                        </td>

                        {/* Records */}
                        <td className="px-4 py-4 text-center font-mono font-medium">
                          {batch.record_count} items
                        </td>

                        {/* Status */}
                        <td className="px-4 py-4 text-center">
                          {isRolledBack ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 text-[10px] font-bold border border-slate-700">
                              Rolled Back
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 text-[10px] font-bold border border-emerald-500/20">
                              Active
                            </span>
                          )}
                        </td>

                        {/* Actions */}
                        <td className="px-4 py-4 text-right">
                          {isRolledBack ? (
                            <span className="text-[10px] text-slate-600 italic">No actions allowed</span>
                          ) : (
                            <button
                              onClick={() => {
                                setErrorMsg(null);
                                setSuccessMsg(null);
                                setConfirmingBatch(batch);
                              }}
                              disabled={!isAdmin}
                              className={`inline-flex items-center gap-1 px-3 py-1.5 text-[11px] font-bold border rounded-lg transition ${
                                isAdmin 
                                  ? "border-red-500/40 text-red-400 hover:bg-red-500/10 hover:border-red-500" 
                                  : "border-slate-800 text-slate-600 cursor-not-allowed"
                              }`}
                              title={!isAdmin ? "Requires Administrator permissions" : "Revert this database migration"}
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                              Undo Import
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* NESTED CONFIRMATION MODAL */}
        <AnimatePresence>
          {confirmingBatch && (
            <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-sm z-50 flex items-center justify-center p-4">
              <motion.div 
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                className="bg-slate-900 border border-red-500/20 rounded-2xl p-6 max-w-md w-full shadow-2xl relative"
              >
                <div className="flex items-center gap-3 text-red-400 mb-4">
                  <div className="p-2.5 bg-red-500/10 rounded-xl">
                    <AlertTriangle className="w-6 h-6" />
                  </div>
                  <h4 className="text-base font-bold text-white tracking-tight">Confirm Migration Rollback</h4>
                </div>

                <div className="space-y-3.5 text-xs text-slate-300">
                  <p className="leading-relaxed">
                    Are you sure you want to rollback this import? This action is <span className="text-red-400 font-bold underline">irreversible</span>.
                  </p>
                  
                  <div className="p-3 bg-slate-950/60 rounded-xl space-y-1 border border-slate-800 font-mono text-[10px] text-slate-400">
                    <div>Batch: <span className="text-white font-bold">{confirmingBatch.filename}</span></div>
                    <div>Import Date: <span>{new Date(confirmingBatch.import_date).toLocaleString()}</span></div>
                    <div>Estimated Impact: <span className="text-red-400 font-bold">Purge {confirmingBatch.record_count} payments</span></div>
                    <div>Delinquencies Action: <span className="text-amber-400">Revert property logs back to "Delinquent" state</span></div>
                  </div>

                  <p className="text-slate-400 text-[11px] leading-relaxed">
                    Safeguards will prevent deletion if payments have been voided elsewhere or have newer active entries posted.
                  </p>
                </div>

                <div className="flex items-center justify-end gap-3 mt-6">
                  <button
                    disabled={isRollingBack}
                    onClick={() => setConfirmingBatch(null)}
                    className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-bold transition"
                  >
                    Cancel
                  </button>
                  <button
                    disabled={isRollingBack}
                    onClick={() => handleRollback(confirmingBatch)}
                    className="flex items-center gap-1.5 px-4 py-2 bg-red-600 hover:bg-red-500 disabled:bg-red-600/50 text-white rounded-xl text-xs font-bold transition shadow-lg shadow-red-600/20"
                  >
                    {isRollingBack ? (
                      <>
                        <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent animate-spin rounded-full"></div>
                        Executing Rollback...
                      </>
                    ) : (
                      <>
                        <RotateCcw className="w-3.5 h-3.5" />
                        Confirm &amp; Rollback
                      </>
                    )}
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
};
