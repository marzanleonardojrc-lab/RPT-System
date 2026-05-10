import React, { useState, useEffect } from "react";
import { 
  collection, 
  query, 
  where, 
  onSnapshot,
  orderBy,
  addDoc,
  updateDoc,
  setDoc,
  doc,
  serverTimestamp,
  db,
  handleFirestoreError,
  OperationType,
  auth,
  getDocs
} from "../lib/firebase";
import { Delinquency, Property, DelinquencyStatus, PaymentDetails, AuditLog } from "../types";
import { calculateTotalDue, calculatePenalties } from "../lib/taxCalculations";
import { formatCurrency, formatPercent, cn, formatDate } from "../lib/utils";
import { 
  X, 
  AlertCircle, 
  Plus,
  CheckCircle2, 
  CalendarDays,
  PieChart,
  Clock, 
  History, 
  Receipt, 
  Info, 
  Edit3, 
  CreditCard, 
  Trash2, 
  ShieldAlert,
  ArrowRight,
  User,
  ExternalLink,
  ShieldCheck,
  XCircle
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { logAudit } from "../lib/audit";

interface DelinquencyActionsProps {
  delinquency: Delinquency;
  property: Property;
  onClose: () => void;
  isEncoder: boolean;
  isAdmin: boolean;
}

type TabType = "update" | "payment" | "audit" | "void";

const DelinquencyActions: React.FC<DelinquencyActionsProps> = ({ 
  delinquency, 
  property, 
  onClose,
  isEncoder,
  isAdmin
}) => {
  const [activeTab, setActiveTab] = useState<TabType>("update");
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);

  // Update Record State
  const [basicTax, setBasicTax] = useState(delinquency.basicTaxDue ?? 0);
  const [sefTax, setSefTax] = useState(delinquency.sefTaxDue ?? 0);
  const [idleSurcharge, setIdleSurcharge] = useState((delinquency as any).idleSurcharge ?? 0);
  const [monthsOverride, setMonthsOverride] = useState<number | null>(null);
  const [updateReason, setUpdateReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Payment State
  const [orNumber, setOrNumber] = useState("");
  const [paymentAmount, setPaymentAmount] = useState(0);
  const [payerName, setPayerName] = useState(property.ownerName ?? "");
  const [paymentType, setPaymentType] = useState<"Full" | "Partial" | "Installment">("Full");
  const [orExists, setOrExists] = useState(false);

  // Void State
  const [voidReason, setVoidReason] = useState("");
  const [encoderName, setEncoderName] = useState(auth.currentUser?.displayName ?? auth.currentUser?.email ?? "");
  const [approvingOfficer, setApprovingOfficer] = useState("");

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

  // Real-time calculation for Update Tab
  const getPenalties = () => {
    // If monthsOverride is null, we use the date-based calculation
    const calc = calculateTotalDue(basicTax, sefTax, delinquency.year, new Date(), idleSurcharge);
    if (monthsOverride !== null) {
      // Manual month override calculation
      const rate = Math.min(36, monthsOverride) * 0.02;
      const baseAmt = basicTax + sefTax + idleSurcharge;
      const interest = baseAmt * rate;
      return {
        ...calc,
        interest,
        totalDue: baseAmt + interest,
        interestRate: rate,
        monthsCount: monthsOverride
      };
    }
    return calc;
  };

  const currentCalc = getPenalties();

  // OR Duplicate Check
  useEffect(() => {
    if (orNumber.trim()) {
      const checkOR = async () => {
        const q = query(collection(db, "delinquencies"), where("paymentDetails.orNumber", "==", orNumber.trim()));
        const snapshot = await getDocs(q);
        setOrExists(!snapshot.empty);
      };
      checkOR();
    } else {
      setOrExists(false);
    }
  }, [orNumber]);

  const handleUpdateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!updateReason.trim()) return;
    setIsSubmitting(true);

    try {
      const isApprovedChange = isAdmin;
      const updateData: any = {
        updatedAt: serverTimestamp(),
        basicTaxDue: basicTax,
        sefTaxDue: sefTax,
        idleSurcharge: idleSurcharge,
        penalty: currentCalc.interest,
        interest: currentCalc.interest,
        totalDue: currentCalc.totalDue,
        status: (delinquency.year >= new Date().getFullYear() && delinquency.status !== "Paid" && delinquency.status !== "Voided") ? "Pending" 
                  : (delinquency.status === "Pending" ? "Delinquent" : delinquency.status),
        pendingUpdate: null
      };

      // Check if this is a new delinquency
      const isNew = typeof delinquency.createdAt === 'string' && delinquency.createdAt.includes('T');
      if (isNew) {
        updateData.createdAt = serverTimestamp();
        updateData.createdBy = auth.currentUser?.uid;
        updateData.propertyId = delinquency.propertyId;
        updateData.year = delinquency.year;
        
        const finalData = { ...delinquency, ...updateData };
        delete finalData.createdAt; // Let serverTimestamp override
        finalData.createdAt = serverTimestamp();
        
        console.log("Creating new delinquency with data:", finalData);
        await setDoc(doc(db, "delinquencies", delinquency.id), finalData);
        await logAudit("CREATE", "Delinquency", delinquency.id, null, finalData);
      } else {
        console.log("Updating delinquency with data:", updateData);
        await updateDoc(doc(db, "delinquencies", delinquency.id), updateData);
        await logAudit("UPDATE", "Delinquency", delinquency.id, delinquency, updateData);
      }
      
      alert(isNew ? "Delinquency record issued successfully." : "Record updated and posted successfully.");
      onClose();
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `delinquencies/${delinquency.id}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePaymentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (orExists || !orNumber || !paymentAmount) return;
    setIsSubmitting(true);

    try {
      const paymentDetails: PaymentDetails = {
        orNumber,
        paymentDate: new Date().toISOString().split('T')[0],
        payerName,
        paymentType,
        amountPaid: paymentAmount,
        recordedBy: auth.currentUser?.email || "System",
        recordedAt: new Date().toISOString()
      };

      const isFullyPaid = paymentAmount >= delinquency.totalDue;
      
      const paymentUpdateData = {
        status: isFullyPaid ? "Paid" : (delinquency.year >= new Date().getFullYear() ? "Pending" : "Delinquent"),
        paymentDetails: paymentDetails,
        updatedAt: serverTimestamp()
      };
      
      const isNew = typeof delinquency.createdAt === 'string' && delinquency.createdAt.includes('T');
      if (isNew) {
         // Should realistically never happen on payment tab, but handled for completeness
         const createData = { ...delinquency, ...paymentUpdateData, createdAt: serverTimestamp(), createdBy: auth.currentUser?.uid };
         await setDoc(doc(db, "delinquencies", delinquency.id), createData);
      } else {
         await updateDoc(doc(db, "delinquencies", delinquency.id), paymentUpdateData);
      }

      await logAudit("UPDATE", "Delinquency", delinquency.id, delinquency, paymentUpdateData);
      
      alert(isFullyPaid ? "Account settled successfully." : "Partial payment recorded.");
      onClose();
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `delinquencies/${delinquency.id}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleVoidSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!voidReason.trim() || !approvingOfficer.trim() || encoderName === approvingOfficer) return;
    setIsSubmitting(true);

    try {
      const voidData = {
        status: "Voided",
        voidMetadata: {
          reason: voidReason,
          encoder: encoderName,
          approver: approvingOfficer,
          voidedAt: new Date().toISOString()
        },
        updatedAt: serverTimestamp()
      };

      const isNew = typeof delinquency.createdAt === 'string' && delinquency.createdAt.includes('T');
      if (isNew) {
         const createData = { ...delinquency, ...voidData, createdAt: serverTimestamp(), createdBy: auth.currentUser?.uid };
         await setDoc(doc(db, "delinquencies", delinquency.id), createData);
      } else {
         await updateDoc(doc(db, "delinquencies", delinquency.id), voidData);
      }
      
      await logAudit("VOID", "Delinquency", delinquency.id, delinquency, voidData);
      
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
        className="bg-slate-900 border border-slate-800 rounded-3xl shadow-3xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col"
      >
        {/* Header Summary */}
        <div className="p-6 border-b border-slate-800 bg-slate-900/50">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-4">
              <div className="px-3 py-1 bg-slate-800 rounded-lg border border-slate-700 text-[10px] font-mono text-slate-400 font-bold">
                {property.pin}
              </div>
              {(() => {
                const isEffectivelyPaid = delinquency.status === "Paid" && delinquency.paymentDetails?.orNumber;
                const statusToDisplay = (delinquency.status === "Paid" && !isEffectivelyPaid) ? "Delinquent" : delinquency.status;
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

        {/* Navigation Tabs */}
        <div className="flex px-6 pt-6 gap-2 bg-slate-900">
          {[
            { id: "update", label: "Update record", icon: Edit3 },
            { id: "payment", label: "Record payment", icon: CreditCard },
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

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto bg-slate-800/30 p-6">
          {activeTab === "update" && (
            <div className="space-y-6">
              {/* Approval Banner Removed */}

              <form onSubmit={handleUpdateSubmit} className="space-y-6">
                {/* Section A: Read-Only Property */}
              <div className="p-4 bg-slate-900/50 rounded-2xl border border-slate-800/50 space-y-4">
                <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-slate-800 flex items-center justify-center text-[9px]">A</span>
                  Property & Account Details (Read-Only)
                </h4>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                  <div>
                    <label className="text-[10px] font-bold text-slate-600 uppercase mb-1 block">PIN</label>
                    <div className="p-2.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-400 font-mono">{property.pin}</div>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-600 uppercase mb-1 block">Tax Year</label>
                    <div className="p-2.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-400 font-mono">{delinquency.year}</div>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-600 uppercase mb-1 block">Owner Name</label>
                    <div className="p-2.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-400 truncate">{property.ownerName}</div>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-600 uppercase mb-1 block">Assessed Value</label>
                    <div className="p-2.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-400 font-bold">{formatCurrency(property.assessedValue)}</div>
                  </div>
                </div>
              </div>

              {/* Section B: Editable Amounts */}
              <div className="p-4 bg-slate-900/80 rounded-2xl border border-slate-700/50 space-y-4">
                <h4 className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-indigo-500/10 flex items-center justify-center text-[9px]">B</span>
                  Editable — Tax Amounts
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase mb-1 block">Basic Tax (₱)</label>
                    <input 
                      type="number"
                      step="any"
                      value={basicTax}
                      onChange={(e) => setBasicTax(parseFloat(e.target.value) || 0)}
                      className="w-full p-2.5 bg-slate-950 border border-slate-700 rounded-lg text-sm text-white focus:ring-1 focus:ring-indigo-500 outline-none font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase mb-1 block">SEF Tax (₱)</label>
                    <input 
                      type="number"
                      step="any"
                      value={sefTax}
                      onChange={(e) => setSefTax(parseFloat(e.target.value) || 0)}
                      className="w-full p-2.5 bg-slate-950 border border-slate-700 rounded-lg text-sm text-white focus:ring-1 focus:ring-indigo-500 outline-none font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase mb-1 block">Idle Land Surcharge (₱)</label>
                    <input 
                      type="number"
                      step="any"
                      value={idleSurcharge}
                      onChange={(e) => setIdleSurcharge(parseFloat(e.target.value) || 0)}
                      className="w-full p-2.5 bg-slate-950 border border-slate-700 rounded-lg text-sm text-white focus:ring-1 focus:ring-indigo-500 outline-none font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase mb-1 block">Months Delinquent</label>
                    <input 
                      type="number"
                      placeholder={currentCalc.monthsCount.toString()}
                      value={monthsOverride === null ? "" : monthsOverride}
                      onChange={(e) => {
                        const val = parseInt(e.target.value);
                        setMonthsOverride(Number.isNaN(val) ? null : val);
                      }}
                      className="w-full p-2.5 bg-slate-950 border border-slate-700 rounded-lg text-sm text-white focus:ring-1 focus:ring-indigo-500 outline-none font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase mb-1 block">Penalty (Auto)</label>
                    <div className="p-2.5 bg-slate-100 border border-slate-200 rounded-lg text-sm text-slate-900 font-bold font-mono">
                      {formatCurrency(currentCalc.interest)}
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase mb-1 block">Current Status</label>
                    <div className="p-2.5 bg-slate-100 border border-slate-200 rounded-lg text-xs text-slate-900 font-bold uppercase tracking-widest">
                      {delinquency.status}
                    </div>
                  </div>
                </div>
              </div>

              {/* Section C: Computed Totals */}
              <div className="p-4 bg-slate-100 rounded-2xl border border-slate-200 space-y-3">
                <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-slate-200 flex items-center justify-center text-[9px] text-slate-600">C</span>
                  Computed Totals
                </h4>
                <div className="space-y-2">
                  <div className="flex items-center justify-between p-2 bg-white/50 border border-slate-200 rounded-lg">
                    <span className="text-xs text-slate-500">Principal Basis (Basic + SEF + Idle)</span>
                    <span className="text-xs text-slate-900 font-bold font-mono">{formatCurrency(basicTax + sefTax + idleSurcharge)}</span>
                  </div>
                  <div className="flex items-center justify-between p-2 bg-white/50 border border-slate-200 rounded-lg">
                    <span className="text-xs text-slate-500">Penalty (2%/mo × {currentCalc.monthsCount} months)</span>
                    <span className="text-xs text-slate-900 font-bold font-mono">{formatCurrency(currentCalc.interest)}</span>
                  </div>
                  <div className="flex items-center justify-between p-2 bg-white/50 border border-slate-200 rounded-lg">
                    <span className="text-xs text-slate-500">Penalty rate applied</span>
                    <span className="text-xs text-slate-900 font-mono">{formatPercent(currentCalc.interestRate)} of basic tax</span>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-red-50 border border-red-100 rounded-lg">
                    <span className="text-xs text-red-900 font-bold uppercase tracking-widest">Total amount due</span>
                    <span className="text-lg text-red-900 font-black font-mono">{formatCurrency(currentCalc.totalDue)}</span>
                  </div>
                </div>
              </div>

              {/* Section D: Reason */}
              <div className="p-4 bg-slate-100 rounded-2xl border border-slate-200 space-y-4">
                <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-slate-200 flex items-center justify-center text-[9px] text-slate-600">D</span>
                  Reason for Update (Required)
                </h4>
                <div>
                  <textarea 
                    placeholder="e.g. Corrected basic tax based on revised assessment from Assessor's Office (AO memo dated April 20, 2025)"
                    className="w-full min-h-[80px] p-4 bg-white border border-slate-200 rounded-xl text-sm text-slate-900 outline-none focus:ring-1 focus:ring-indigo-500 transition-all resize-none shadow-sm"
                    value={updateReason}
                    onChange={(e) => setUpdateReason(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="flex items-center justify-between pt-4">
                <button type="button" className="px-4 py-2 bg-slate-100 text-slate-900 border border-slate-200 rounded-lg text-xs font-bold transition-all hover:bg-slate-200 flex items-center gap-2">
                  Need help?
                  <ExternalLink className="w-3 h-3" />
                </button>
                <button 
                  type="submit"
                  disabled={!updateReason.trim() || isSubmitting}
                  className="px-6 py-2.5 bg-white border border-slate-200 text-slate-900 rounded-lg font-bold text-xs hover:bg-slate-50 transition-all shadow-sm disabled:opacity-50 flex items-center gap-2"
                >
                  {isSubmitting ? "Processing..." : "Update & Post"}
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </form>
          </div>
        )}

          {activeTab === "payment" && (
            <form onSubmit={handlePaymentSubmit} className="space-y-6">
              <div className="p-6 bg-slate-950/50 rounded-3xl border border-slate-800/50 space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase mb-1.5 block tracking-widest">Official Receipt (OR) #</label>
                    <div className="relative">
                      <input 
                        type="text"
                        placeholder="OR-2024-XXXXX"
                        required
                        className={cn(
                          "w-full px-4 py-3 bg-slate-900 border rounded-xl text-sm font-mono transition-all outline-none",
                          orExists ? "border-red-500 text-red-400 focus:ring-red-500" : "border-slate-800 text-white focus:ring-indigo-500 focus:border-indigo-500"
                        )}
                        value={orNumber}
                        onChange={(e) => setOrNumber(e.target.value)}
                      />
                      {orExists && (
                        <p className="text-[10px] text-red-500 font-bold mt-1.5 flex items-center gap-1">
                          <AlertCircle className="w-3 h-3" />
                          Duplicate OR Number detected in the repository.
                        </p>
                      )}
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase mb-1.5 block tracking-widest">Payment Amount (₱)</label>
                    <input 
                      type="number"
                      step="any"
                      required
                      placeholder="0.00"
                      className="w-full px-4 py-3 bg-slate-900 border border-slate-800 rounded-xl text-sm text-white transition-all outline-none focus:ring-1 focus:ring-indigo-500"
                      value={paymentAmount || ""}
                      onChange={(e) => setPaymentAmount(parseFloat(e.target.value) || 0)}
                    />
                  </div>
                </div>

                <div className="space-y-6">
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase mb-3 block tracking-widest">Payment Type</label>
                    <div className="grid grid-cols-3 gap-3">
                      <button
                        type="button"
                        onClick={() => { setPaymentType("Full"); setPaymentAmount(delinquency.totalDue); }}
                        className={cn(
                          "flex flex-col items-center justify-center p-4 rounded-xl border transition-all gap-2 cursor-pointer",
                          paymentType === "Full" ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-500 shadow-sm shadow-emerald-500/10" : "bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-800"
                        )}
                      >
                        <CheckCircle2 className="w-5 h-5" />
                        <span className="text-[10px] font-bold uppercase tracking-widest">Full Payment</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setPaymentType("Partial")}
                        className={cn(
                          "flex flex-col items-center justify-center p-4 rounded-xl border transition-all gap-2 cursor-pointer",
                          paymentType === "Partial" ? "bg-amber-500/10 border-amber-500/30 text-amber-500 shadow-sm shadow-amber-500/10" : "bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-800"
                        )}
                      >
                        <PieChart className="w-5 h-5" />
                        <span className="text-[10px] font-bold uppercase tracking-widest">Partial</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setPaymentType("Installment")}
                        className={cn(
                          "flex flex-col items-center justify-center p-4 rounded-xl border transition-all gap-2 cursor-pointer",
                          paymentType === "Installment" ? "bg-blue-500/10 border-blue-500/30 text-blue-500 shadow-sm shadow-blue-500/10" : "bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-800"
                        )}
                      >
                        <CalendarDays className="w-5 h-5" />
                        <span className="text-[10px] font-bold uppercase tracking-widest">Installment</span>
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase mb-1.5 block tracking-widest">Payer Name</label>
                    <input 
                      type="text"
                      required
                      className="w-full px-4 py-3 bg-slate-900 border border-slate-800 rounded-xl text-sm text-white transition-all outline-none focus:ring-1 focus:ring-indigo-500"
                      value={payerName}
                      onChange={(e) => setPayerName(e.target.value)}
                    />
                  </div>
                </div>

                {/* Real-Time Balance Summary */}
                <div className="p-4 bg-slate-900 rounded-2xl border border-slate-800/50">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Settlement Progress</span>
                    <span className="text-xs font-bold text-indigo-400">
                      {paymentAmount >= delinquency.totalDue ? "100%" : `${Math.round((paymentAmount / delinquency.totalDue) * 100)}%`}
                    </span>
                  </div>
                  <div className="w-full h-2 bg-slate-950 rounded-full overflow-hidden">
                    <motion.div 
                      className={cn(
                        "h-full transition-colors",
                        paymentType === "Full" ? "bg-emerald-500" : paymentType === "Installment" ? "bg-blue-500" : "bg-indigo-500"
                      )}
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.min(100, (paymentAmount / delinquency.totalDue) * 100)}%` }}
                    />
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mt-4 pt-4 border-t border-slate-800/50">
                    <div>
                      <p className="text-[9px] font-bold text-slate-600 uppercase tracking-widest">Current Balance</p>
                      <p className="text-sm font-bold text-slate-300">{formatCurrency(delinquency.totalDue)}</p>
                    </div>
                    <div>
                      <p className="text-[9px] font-bold text-slate-600 uppercase tracking-widest">Payment Amount</p>
                      <p className={cn(
                        "text-sm font-bold",
                        paymentType === "Full" ? "text-emerald-400" : paymentType === "Installment" ? "text-blue-400" : "text-amber-400"
                      )}>- {formatCurrency(paymentAmount)}</p>
                    </div>
                    <div className="col-span-2 md:col-span-1 md:border-l md:border-slate-800/50 md:pl-4 text-right md:text-left">
                      <p className="text-[9px] font-bold text-slate-600 uppercase tracking-widest">Remaining Balance</p>
                      <p className={cn(
                        "text-lg font-bold",
                        paymentAmount >= delinquency.totalDue ? "text-emerald-400" : "text-red-400"
                      )}>
                        {formatCurrency(Math.max(0, delinquency.totalDue - paymentAmount))}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end gap-4">
                <button 
                  type="submit"
                  disabled={orExists || !orNumber || !paymentAmount || isSubmitting}
                  className="px-8 py-3 bg-indigo-600 text-white rounded-2xl font-bold text-xs uppercase tracking-widest hover:bg-indigo-500 transition-all shadow-xl shadow-indigo-600/20 disabled:opacity-50 disabled:grayscale"
                >
                  {isSubmitting ? "Processing..." : "Commit Payment Record"}
                </button>
              </div>
            </form>
          )}

          {activeTab === "audit" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between mb-4">
                <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
                  <History className="w-4 h-4 text-indigo-400" />
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
                            log.action === "UPDATE" ? "bg-indigo-500/10 text-indigo-400 border-indigo-500/20" :
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
                    <p className="text-xs text-slate-500 mt-1">This operation will flag the record as invalid across all financial reports.</p>
                  </div>
                </div>

                <div className="space-y-4">
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
                        value={encoderName}
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
                            encoderName === approvingOfficer && approvingOfficer ? "border-red-500 focus:ring-red-500" : "border-slate-800 focus:ring-indigo-500"
                          )}
                          value={approvingOfficer}
                          onChange={(e) => setApprovingOfficer(e.target.value)}
                        />
                        {encoderName === approvingOfficer && approvingOfficer && (
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
