import React, { useState, useEffect } from "react";
import { 
  collection, 
  query, 
  where, 
  onSnapshot,
  orderBy,
  updateDoc,
  setDoc,
  doc,
  serverTimestamp,
  db,
  handleFirestoreError,
  OperationType,
  getDocs
} from "../lib/firebase";
import { useAuth } from "../AuthContext";
import { Delinquency, Property, AuditLog, Payment } from "../types";
import { formatCurrency, cn, formatDate } from "../lib/utils";
import { 
  X, 
  AlertCircle, 
  Plus,
  CheckCircle2, 
  Clock, 
  History, 
  Info, 
  Edit3, 
  Trash2, 
  ShieldAlert,
  User,
  XCircle,
  ShieldCheck
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { logAudit } from "../lib/audit";

interface DelinquencyActionsProps {
  delinquency: Delinquency;
  property: Property;
  onClose: () => void;
  isEncoder: boolean;
  isAdmin: boolean;
  initialTab?: TabType;
  standalone?: boolean;
}

type TabType = "audit" | "void";

const DelinquencyActions: React.FC<DelinquencyActionsProps> = ({ 
  delinquency, 
  property, 
  onClose,
  isEncoder,
  isAdmin,
  initialTab,
  standalone
}) => {
  const { profile } = useAuth();
  const [activeTab, setActiveTab] = useState<TabType>(initialTab || "audit");
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);

  useEffect(() => {
    const q = query(
      collection(db, "payments"),
      where("propertyId", "==", property.id),
      orderBy("recordedAt", "desc")
    );

    return onSnapshot(q, (snapshot) => {
      setPayments(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Payment)));
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, "payments");
    });
  }, [property.id]);

  // Record State - Removed update/payment states
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Void State
  const [voidReason, setVoidReason] = useState("");
  const [selectedPaymentId, setSelectedPaymentId] = useState<string | "DELINQUENCY">("DELINQUENCY");
  const [encoderName, setEncoderName] = useState(profile?.username || profile?.displayName || "System");
  const [approvingOfficer, setApprovingOfficer] = useState("");

  useEffect(() => {
    if (profile) {
      setEncoderName(profile.username || profile.displayName || "System");
    }
  }, [profile]);

  useEffect(() => {
    if (activeTab === "audit") {
      setLoadingLogs(true);
      const q = query(
        collection(db, "audit_logs"),
        where("entityId", "==", delinquency.id),
        orderBy("timestamp", "desc")
      );

      return onSnapshot(q, (snapshot) => {
        setAuditLogs(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as AuditLog)));
        setLoadingLogs(false);
      }, (error) => {
        handleFirestoreError(error, OperationType.GET, "audit_logs");
      });
    }
  }, [activeTab, delinquency.id]);

  const handleVoidSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!voidReason.trim() || !approvingOfficer.trim() || (profile?.username || profile?.displayName || "System") === approvingOfficer) return;
    setIsSubmitting(true);

    try {
      const voidMetadata = {
        reason: voidReason,
        encoder: profile?.username || profile?.displayName || "System",
        approver: approvingOfficer,
        voidedAt: new Date().toISOString()
      };

      if (selectedPaymentId === "DELINQUENCY") {
        // Void the whole assessment
        const voidData = {
          status: "Voided",
          voidMetadata,
          updatedAt: serverTimestamp()
        };

        const isNew = typeof delinquency.createdAt === 'string' && delinquency.createdAt.includes('T');
        if (isNew) {
           const createData = { ...delinquency, ...voidData, createdAt: serverTimestamp(), recordedBy: profile?.username || profile?.displayName || "System" };
           await setDoc(doc(db, "delinquencies", delinquency.id), createData);
        } else {
           await updateDoc(doc(db, "delinquencies", delinquency.id), voidData);
        }
        await logAudit("VOID", "Delinquency", delinquency.id, delinquency, voidData);
      } else {
        // Void a specific payment
        const paymentToVoid = payments.find(p => p.id === selectedPaymentId);
        if (!paymentToVoid) throw new Error("Payment not found");

        const updatedPaymentStatus = {
          status: "Voided",
          voidMetadata,
          updatedAt: serverTimestamp()
        };

        await updateDoc(doc(db, "payments", selectedPaymentId), updatedPaymentStatus);

        const newTotalPaid = (delinquency.totalPaid || 0) - paymentToVoid.amountPaid;
        const isFullyPaid = newTotalPaid >= delinquency.totalDue;
        
        const delinquencyUpdate = {
          totalPaid: newTotalPaid,
          status: isFullyPaid ? "Paid" : (delinquency.year >= new Date().getFullYear() ? "Pending" : "Delinquent"),
          updatedAt: serverTimestamp()
        };

        await updateDoc(doc(db, "delinquencies", delinquency.id), delinquencyUpdate);
        await logAudit("VOID", "Payment", selectedPaymentId, paymentToVoid, updatedPaymentStatus);
      }
      
      alert("Record has been successfully voided and archived.");
      onClose();
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `delinquencies/${delinquency.id}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-slate-950/90 backdrop-blur-md z-50 flex items-center justify-center p-4 md:p-8"
    >
      <motion.div 
        initial={{ scale: 0.95, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.95, y: 20 }}
        className={cn(
          "bg-slate-900 border border-slate-800 rounded-3xl shadow-3xl w-full flex flex-col",
          standalone ? "max-w-2xl max-h-[80vh]" : "max-w-4xl max-h-[90vh]"
        )}
      >
        {/* Header Summary */}
        {!standalone ? (
          <div className="p-6 border-b border-slate-800 bg-slate-900/50">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-4">
                <div className="px-3 py-1 bg-slate-800 rounded-lg border border-slate-700 text-[10px] font-mono text-blue-400 font-bold">
                  TD: {property.tdNumber}
                </div>
                {(() => {
                  const hasPayment = payments.some(p => p.taxYear === delinquency.year && p.status === "Active");
                  const isEffectivelyPaid = delinquency.status === "Paid" || hasPayment;
                  const statusToDisplay = isEffectivelyPaid ? "Paid" : delinquency.status;
                  return (
                    <div className={cn(
                      "flex items-center gap-1.5 px-3 py-1 rounded-lg text-[10px] font-bold uppercase tracking-widest border",
                      statusToDisplay === "Delinquent" ? "bg-red-500/10 text-red-500 border-red-500/20" : 
                      statusToDisplay === "Voided" ? "bg-slate-800 text-slate-400 border-slate-700" :
                      "bg-emerald-500/10 text-emerald-500 border-emerald-500/20"
                    )}>
                      {statusToDisplay === "Delinquent" ? <AlertCircle className="w-3 h-3" /> : 
                       statusToDisplay === "Voided" ? <XCircle className="w-3 h-3" /> :
                       <CheckCircle2 className="w-3 h-3" />}
                      {statusToDisplay}
                    </div>
                  );
                })()}
              </div>
              <button 
                onClick={onClose}
                className="p-2 hover:bg-slate-800 rounded-xl text-slate-400 transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-2">
              <div>
                <h3 className="text-xl font-bold text-white tracking-tight leading-none mb-1">{property.ownerName}</h3>
                <p className="text-sm text-slate-500">{property.barangay} • FY {delinquency.year}</p>
              </div>
              <div className="text-right">
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Total Outstanding</p>
                <p className={cn(
                  "text-2xl font-black tracking-tighter",
                  delinquency.status === "Delinquent" ? "text-red-400" : "text-emerald-400"
                )}>
                  {formatCurrency(delinquency.totalDue)}
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between p-4 px-6 border-b border-slate-800 bg-slate-900/50">
            <div className="flex items-center gap-3">
               <div className="w-8 h-8 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center">
                  {activeTab === "audit" ? <History className="w-4 h-4 text-blue-400" /> : <Trash2 className="w-4 h-4 text-red-400" />}
               </div>
               <div>
                  <h3 className="text-sm font-bold text-white uppercase tracking-widest">{activeTab === 'audit' ? 'Audit Trail' : 'Void Record'}</h3>
                  <p className="text-[10px] text-slate-500 font-mono">TD: {property.tdNumber} • FY {delinquency.year}</p>
               </div>
            </div>
            <button 
              onClick={onClose}
              className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        )}

        {/* Navigation Tabs */}
        {!standalone && (
          <div className="flex px-6 pt-6 gap-2 bg-slate-900">
            {[
              { id: "audit", label: "Audit trail", icon: History },
              { id: "void", label: "Void record", icon: Trash2 },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as TabType)}
                className={cn(
                  "flex items-center gap-2 px-4 py-2.5 rounded-t-xl text-xs font-bold uppercase tracking-widest transition-all border-x border-t",
                  activeTab === tab.id 
                    ? "bg-slate-800 border-slate-700 text-white translate-y-[1px]" 
                    : "bg-transparent border-transparent text-slate-500 hover:text-slate-300"
                )}
              >
                <tab.icon className="w-3.5 h-3.5" />
                {tab.label}
              </button>
            ))}
          </div>
        )}

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto bg-slate-800/30 p-6">
          {activeTab === "audit" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between mb-4">
                <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
                  <History className="w-4 h-4 text-blue-400" />
                  Chain of Custody & Audit Logs
                </h4>
                <div className="px-3 py-1 bg-slate-900 border border-slate-800 rounded-full text-[9px] font-bold text-slate-500">
                  {auditLogs.length} EVENTS RECORDED
                </div>
              </div>

              {loadingLogs ? (
                <div className="flex items-center justify-center py-20">
                  <Clock className="w-6 h-6 text-slate-700 animate-spin" />
                </div>
              ) : auditLogs.length === 0 ? (
                <div className="text-center py-20 bg-slate-950/20 rounded-3xl border border-slate-800/50 border-dashed">
                  <p className="text-sm text-slate-500">No lifecycle events recorded for this node.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {auditLogs.map((log) => (
                    <div key={log.id} className="p-4 bg-slate-900 border border-slate-800 rounded-2xl group hover:border-slate-700 transition-colors">
                      <div className="flex items-start justify-between gap-4 mb-2">
                        <div className="flex items-center gap-3">
                          <div className={cn(
                            "w-8 h-8 rounded-xl flex items-center justify-center border",
                            log.action === "CREATE" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" :
                            log.action === "UPDATE" ? "bg-blue-500/10 text-blue-400 border-blue-500/20" :
                            "bg-amber-500/10 text-amber-400 border-amber-500/20"
                          )}>
                            {log.action === "CREATE" ? <Plus className="w-4 h-4" /> : 
                             log.action === "UPDATE" ? <Edit3 className="w-4 h-4" /> : 
                             <Trash2 className="w-4 h-4" />}
                          </div>
                          <div>
                            <p className="text-sm font-bold text-white uppercase tracking-tight">{log.action} <span className="text-slate-500 font-normal">on</span> {log.entityType}</p>
                            <div className="flex items-center gap-2 mt-0.5">
                              <User className="w-2.5 h-2.5 text-slate-600" />
                              <span className="text-[10px] text-slate-500 font-medium">{log.userEmail}</span>
                            </div>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-[10px] text-slate-500 font-mono flex items-center justify-end gap-1.5">
                            <Clock className="w-3 h-3" />
                            {formatDate(log.timestamp)}
                          </p>
                        </div>
                      </div>
                      {log.newValue && (
                        <div className="mt-3 p-3 bg-slate-950 rounded-xl border border-slate-800/50">
                          <p className="text-[9px] font-bold text-slate-600 uppercase mb-2">Change Payload Signature</p>
                          <pre className="text-[9px] font-mono text-slate-400 overflow-x-auto">
                            {JSON.stringify(log.newValue, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === "void" && (
            <form onSubmit={handleVoidSubmit} className="space-y-6">
              <div className="p-6 bg-red-500/5 rounded-3xl border border-red-500/10 space-y-6">
                <div className="flex items-center gap-4 mb-2">
                  <div className="w-12 h-12 bg-red-500/10 rounded-2xl flex items-center justify-center border border-red-500/20">
                    <ShieldAlert className="w-6 h-6 text-red-500" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-red-400 uppercase tracking-widest">Restrictive Action: Void Record</h4>
                    <p className="text-xs text-slate-500 mt-1">This operation will flag the selected record as invalid for all financial reports.</p>
                  </div>
                </div>

                <div className="space-y-4">
                  {payments.filter(p => p.status === 'Active').length > 0 && (
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase mb-1.5 block tracking-widest">Select Record to Void</label>
                      <select 
                        className="w-full px-4 py-3 bg-slate-900 border border-slate-800 rounded-xl text-sm text-white outline-none focus:ring-1 focus:ring-red-500"
                        value={selectedPaymentId}
                        onChange={(e) => setSelectedPaymentId(e.target.value)}
                      >
                        <option value="DELINQUENCY">FULL YEAR ASSESSMENT (FY {delinquency.year})</option>
                        {payments.filter(p => p.status === 'Active').map(p => (
                          <option key={p.id} value={p.id}>PAYMENT: OR#{p.orNumber} - {formatCurrency(p.amountPaid)} ({formatDate(p.paymentDate)})</option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase mb-1.5 block tracking-widest">Reason for Voiding (Required)</label>
                    <textarea 
                      required
                      placeholder="e.g. Double entry discovered during manual audit, OR was cancelled at counter..."
                      className="w-full min-h-[100px] p-4 bg-slate-900 border border-slate-800 rounded-2xl text-sm text-slate-300 outline-none focus:ring-1 focus:ring-red-500 transition-all resize-none"
                      value={voidReason}
                      onChange={(e) => setVoidReason(e.target.value)}
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase mb-1.5 block tracking-widest">Encoder Name</label>
                      <input 
                        type="text"
                        readOnly
                        className="w-full px-4 py-3 bg-slate-950 border border-slate-800 rounded-xl text-sm text-slate-500 font-bold outline-none"
                        value={profile?.username || profile?.displayName || "System"}
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase mb-1.5 block tracking-widest">Approving Officer Name</label>
                      <div className="relative">
                        <input 
                          type="text"
                          required
                          placeholder="Full name of second officer"
                          className={cn(
                            "w-full px-4 py-3 bg-slate-900 border rounded-xl text-sm text-white transition-all outline-none",
                            (profile?.username || profile?.displayName || "System") === approvingOfficer && approvingOfficer ? "border-red-500 focus:ring-red-500" : "border-slate-800 focus:ring-blue-500"
                          )}
                          value={approvingOfficer}
                          onChange={(e) => setApprovingOfficer(e.target.value)}
                        />
                        {(profile?.username || profile?.displayName || "System") === approvingOfficer && approvingOfficer && (
                          <p className="text-[10px] text-red-500 font-bold mt-1.5 flex items-center gap-1">
                            <ShieldAlert className="w-3 h-3" />
                            Dual-Control Violation: Approver cannot be the same as Encoder.
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="p-4 bg-red-600/10 rounded-2xl border border-red-600/20">
                  <div className="flex items-start gap-3">
                    <Info className="w-4 h-4 text-red-400 mt-0.5" />
                    <p className="text-[11px] text-red-300/80 leading-relaxed italic">
                      SYSTEM_PROTOCOL: This record will NOT be physically deleted from the database per COA standard audit protocols. 
                      It will remain in the history but will be mathematically excluded from all total calculations and reports.
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end">
                <button 
                  type="submit"
                  disabled={!voidReason.trim() || !approvingOfficer.trim() || encoderName === approvingOfficer || isSubmitting}
                  className="px-8 py-3 bg-red-600 text-white rounded-2xl font-bold text-xs uppercase tracking-widest hover:bg-red-500 transition-all shadow-xl shadow-red-600/20 disabled:opacity-50 disabled:grayscale flex items-center gap-2"
                >
                  <ShieldCheck className="w-4 h-4" />
                  {isSubmitting ? "Processing..." : "Authorize Void Sequence"}
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Footer info */}
        <div className="p-4 bg-slate-950 border-t border-slate-800 flex items-center justify-between">
          <p className="text-[10px] text-slate-600 font-mono tracking-tighter uppercase">Transaction Integrity Protected // {delinquency.id}</p>
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-[10px] text-emerald-500 font-bold uppercase tracking-widest">Server Synchronized</span>
            </span>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
};

export default DelinquencyActions;
