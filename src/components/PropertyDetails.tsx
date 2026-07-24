import React, { useState, useEffect } from "react";
import { 
  collection, 
  query, 
  where, 
  onSnapshot,
  orderBy,
  db,
  handleFirestoreError,
  OperationType 
} from "../lib/firebase";
import { Property, Delinquency, Payment } from "../types";
import { formatCurrency, formatPercent, cn, formatDate } from "../lib/utils";
import { X, Building2, User, MapPin, Search, AlertCircle, CheckCircle2, Clock, History, Receipt, Info, Printer } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { calculateTotalDue, groupDelinquenciesByPenaltyRule, GroupedDelinquency } from "../lib/taxCalculations";
import { RPTARPrintView } from "./RPTARPrintView";

interface PropertyDetailsProps {
  property: Property;
  onClose: () => void;
  onPostPayment?: (prop: Property) => void;
}

const PropertyDetails: React.FC<PropertyDetailsProps> = ({ property, onClose, onPostPayment }) => {
  const [history, setHistory] = useState<Delinquency[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [showRptar, setShowRptar] = useState(false);

  useEffect(() => {
    const q = query(
      collection(db, "delinquencies"), 
      where("propertyId", "==", property.id),
      orderBy("year", "desc")
    );

    const unsubscribeDelinquencies = onSnapshot(q, (snapshot) => {
      setHistory(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Delinquency)));
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `delinquencies?propertyId=${property.id}`);
    });

    const pq = query(
      collection(db, "payments"),
      where("propertyId", "==", property.id),
      orderBy("recordedAt", "asc")
    );

    const unsubscribePayments = onSnapshot(pq, (snapshot) => {
      setPayments(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Payment)));
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `payments?propertyId=${property.id}`);
    });

    return () => {
      unsubscribeDelinquencies();
      unsubscribePayments();
    };
  }, [property.id]);

  const totalOutstanding = history
    .filter(d => d.status === "Delinquent" && !payments.some(p => p.taxYear === d.year && p.status === "Active"))
    .reduce((acc, curr) => acc + calculateTotalDue(curr.basicTaxDue, curr.sefTaxDue, curr.year).totalDue, 0);

  const totalPaymentsMade = payments
    .filter(p => p.status === "Active")
    .reduce((acc, curr) => acc + curr.amountPaid, 0);

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-slate-950/90 backdrop-blur-md z-50 flex items-center justify-center p-4 md:p-8"
    >
      {showRptar ? (
        <RPTARPrintView property={property} history={history} payments={payments} onClose={() => setShowRptar(false)} />
      ) : (
        <motion.div 
          initial={{ scale: 0.95, y: 20 }}
          animate={{ scale: 1, y: 0 }}
          exit={{ scale: 0.95, y: 20 }}
          className="bg-slate-900 border border-slate-800 rounded-3xl shadow-3xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col"
        >
        {/* Header */}
        <div className="p-6 border-b border-slate-800 bg-slate-900/50 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-blue-500/10 border border-blue-500/20 rounded-2xl flex items-center justify-center">
              <Building2 className="w-6 h-6 text-blue-400" />
            </div>
            <div>
              <h3 className="text-xl font-bold text-white tracking-tight">Real Property Tax Account Register (RPTAR)</h3>
              <p className="text-xs text-slate-500 font-mono mt-1 uppercase tracking-widest">{property.tdNumber}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {onPostPayment && (
              <button 
                onClick={() => onPostPayment(property)}
                className="hidden md:flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold border border-blue-500/50 transition-colors shadow-lg shadow-blue-600/20"
              >
                <Receipt className="w-4 h-4" />
                POST PAYMENT RECORD
              </button>
            )}
            <button 
              onClick={() => setShowRptar(true)}
              className="hidden md:flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-bold border border-slate-700 transition-colors"
            >
              <Printer className="w-4 h-4" />
              PRINT RPTAR
            </button>
            <button 
              onClick={onClose}
              className="p-2 hover:bg-slate-800 rounded-xl text-slate-400 transition-colors border border-transparent hover:border-slate-700"
            >
              <X className="w-6 h-6" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 md:p-8">
          {/* Top Row: 4 Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            {/* Card 1: Record of Ownership */}
            <div className="p-6 bg-slate-900/40 backdrop-blur-sm rounded-2xl border border-slate-800 shadow-xl flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <div className="p-1.5 bg-blue-500/10 border border-blue-500/20 rounded-lg text-blue-400">
                    <User className="w-4 h-4" />
                  </div>
                  <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                    I. Record of Ownership
                  </h4>
                </div>
                <div className="space-y-4">
                  <div>
                    <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold mb-1">Registered Owner</p>
                    <p className="text-sm font-bold text-white mb-0.5">{property.ownerName}</p>
                    <p className="text-[10px] text-slate-400 font-mono line-clamp-2">{property.ownerAddress}</p>
                  </div>
                  {property.administratorName ? (
                    <div>
                      <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold mb-1">Administrator / User</p>
                      <p className="text-xs font-bold text-slate-300 mb-0.5">{property.administratorName}</p>
                      <p className="text-[10px] text-slate-400 font-mono line-clamp-1">{property.administratorAddress}</p>
                    </div>
                  ) : null}
                  <div className="grid grid-cols-2 gap-4 pt-2">
                    <div>
                      <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold mb-1">Tax Dec No.</p>
                      <p className="text-xs font-mono font-bold text-blue-400 truncate">{property.tdNumber}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold mb-1">Effectivity</p>
                      <p className="text-xs font-bold text-slate-300">{property.effectivityDate}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Card 2: Technical Description */}
            <div className="p-6 bg-slate-900/40 backdrop-blur-sm rounded-2xl border border-slate-800 shadow-xl flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <div className="p-1.5 bg-blue-500/10 border border-blue-500/20 rounded-lg text-blue-400">
                    <MapPin className="w-4 h-4" />
                  </div>
                  <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                    II. Technical Description
                  </h4>
                </div>
                <div className="space-y-4">
                  <div>
                    <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold mb-1">Precise Location</p>
                    <p className="text-xs font-bold text-white mb-0.5 truncate">{property.detailedLocation}</p>
                    <p className="text-[10px] text-slate-400 line-clamp-1">{property.street ? `${property.street}, ` : ""}{property.barangay}, {property.municipality}, {property.province}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold mb-1">Lot / Blk No.</p>
                      <p className="text-xs font-bold text-slate-300">{property.lotNo || "-"} / {property.blkNo || "-"}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold mb-1">OCT / TCT</p>
                      <p className="text-xs font-bold text-slate-300 truncate">{property.octTct || "-"}</p>
                    </div>
                  </div>
                  <div>
                    <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold mb-1">CCT / CLOA</p>
                    <p className="text-xs font-bold text-slate-300 truncate">{property.cctCloa || "-"}</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Card 3: Assessment Data */}
            <div className="p-6 bg-slate-900/40 backdrop-blur-sm rounded-2xl border border-slate-800 shadow-xl flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <div className="p-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-emerald-400">
                    <History className="w-4 h-4" />
                  </div>
                  <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                    III. Assessment Data
                  </h4>
                </div>
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold mb-1">Classification</p>
                      <p className="text-xs font-bold text-white">{property.classification}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold mb-1">Area</p>
                      <p className="text-xs font-bold text-white">{property.area}</p>
                    </div>
                  </div>
                  <div>
                    <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold mb-1">Current Assessed Value</p>
                    <p className="text-xl font-black text-emerald-400 font-mono tracking-tight">{formatCurrency(property.assessedValue)}</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Card 4: Remarks & History */}
            <div className="p-6 bg-slate-900/40 backdrop-blur-sm rounded-2xl border border-slate-800 shadow-xl flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <div className="p-1.5 bg-amber-500/10 border border-amber-500/20 rounded-lg text-amber-500">
                    <Info className="w-4 h-4" />
                  </div>
                  <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                    IV. Remarks & History
                  </h4>
                </div>
                <div className="space-y-3">
                  {property.previousTdNo ? (
                    <div>
                      <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold mb-1">Previous Record</p>
                      <p className="text-[10px] font-bold text-slate-300">{property.previousTdNo} {property.previousOwner ? `(${property.previousOwner})` : ""}</p>
                      {property.previousAssessedValue > 0 && (
                        <p className="text-[9px] text-slate-500 font-mono">Prev. A.V.: {formatCurrency(property.previousAssessedValue)}</p>
                      )}
                    </div>
                  ) : null}
                  <div>
                    <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold mb-1">Recorded By</p>
                    <p className="text-[10px] font-medium text-slate-400 italic truncate">{property.recordedBy || "SYSTEM"}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Middle Row: Financial Summary */}
          <div className="p-6 bg-slate-900/40 backdrop-blur-sm rounded-2xl border border-slate-800 shadow-xl mb-8 transition-all">
            <div className="flex items-center gap-2 mb-6">
              <div className="p-1.5 bg-blue-500/10 border border-blue-500/20 rounded-lg text-blue-400">
                <Receipt className="w-4 h-4" />
              </div>
              <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                V. Financial Summary (All Years)
              </h4>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 md:divide-x md:divide-slate-800">
              {/* Left Column: Total Delinquent Balance */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <div className={cn(
                    "p-1 rounded-md border",
                    totalOutstanding > 0 
                      ? "bg-red-500/10 border-red-500/20 text-red-400" 
                      : "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                  )}>
                    {totalOutstanding > 0 ? <AlertCircle className="w-3.5 h-3.5" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                  </div>
                  <h5 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                    Total Delinquent Balance
                  </h5>
                </div>
                <div>
                  <p className={cn(
                    "text-2xl font-black font-mono tracking-tight",
                    totalOutstanding > 0 ? "text-red-400" : "text-emerald-400"
                  )}>
                    {formatCurrency(totalOutstanding)}
                  </p>
                  <p className="text-[10px] text-slate-500 mt-1 uppercase font-bold">Principal + Interest Accrued</p>
                </div>
              </div>

              {/* Right Column: Total Payments Made */}
              <div className="space-y-2 md:pl-8">
                <div className="flex items-center gap-2">
                  <div className="p-1 bg-emerald-500/10 border border-emerald-500/20 rounded-md text-emerald-400">
                    <History className="w-3.5 h-3.5" />
                  </div>
                  <h5 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                    Total Payments Made
                  </h5>
                </div>
                <div>
                  <p className="text-2xl font-black font-mono tracking-tight text-emerald-400">
                    {formatCurrency(totalPaymentsMade)}
                  </p>
                  <p className="text-[10px] text-slate-500 mt-1 uppercase font-bold">Lifetime Tax Collections</p>
                </div>
              </div>
            </div>
          </div>

          {/* Bottom Row: Tax History Ledger */}
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-extrabold text-white tracking-wider uppercase flex items-center gap-2">
                <Clock className="w-4 h-4 text-blue-400" />
                Record of Taxes Due and Payment
              </h4>
              <div className="px-3 py-1 bg-slate-800 bg-opacity-70 rounded-full text-[10px] font-bold text-slate-400 border border-slate-700">
                {history.length} RECORDS FOUND
              </div>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-20">
                <div className="w-8 h-8 border-2 border-blue-500/20 border-t-blue-500 rounded-full animate-spin" />
              </div>
            ) : history.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 bg-slate-950/30 rounded-3xl border border-slate-800/50 border-dashed">
                <div className="w-16 h-16 bg-slate-800 rounded-2xl flex items-center justify-center mb-4">
                  <CheckCircle2 className="w-8 h-8 text-emerald-400" />
                </div>
                <h5 className="text-white font-bold mb-1">Clear Compliance</h5>
                <p className="text-slate-500 text-sm">No delinquency records found for this property signature.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {(() => {
                  const grouped = groupDelinquenciesByPenaltyRule(history, property.assessedValue);
                  // Sort the groups in ascending order by the minimum year in each group (latest year below)
                  const sortedGrouped = [...grouped].sort((a, b) => {
                    const minA = Math.min(...a.years);
                    const minB = Math.min(...b.years);
                    return minA - minB;
                  });
                  return sortedGrouped.map((row) => {
                    const firstYearRecord = history.find(h => h.year === row.years[0]);
                    const isUnpaidDelinq = row.records.some(r => r.status === "Delinquent" && !payments.some(p => p.taxYear === r.year && p.status === "Active"));
                    const isUnpaidPending = row.records.some(r => r.status === "Pending" && !payments.some(p => p.taxYear === r.year && p.status === "Active"));
                    const status = isUnpaidDelinq ? "Delinquent" : (isUnpaidPending ? "Pending" : "Paid");

                    return (
                      <div 
                        key={`${row.ids.join(',')}-${row.quarterLabel || 'full'}`} 
                        className={cn(
                          "p-4 rounded-xl border flex flex-col gap-4 transition-all hover:bg-slate-800/30",
                          status === "Delinquent" ? "bg-slate-900 border-slate-800" : "bg-slate-950 border-slate-800/50 opacity-90"
                        )}
                      >
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                          <div className="flex items-center gap-4">
                            <div className={cn(
                              "min-w-[40px] px-2 h-10 rounded-lg flex items-center justify-center font-bold text-xs",
                              status === "Delinquent" ? "bg-red-500/10 text-red-400 border border-red-500/20" : status === "Pending" ? "bg-blue-500/10 text-blue-400 border border-blue-500/20" : "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                            )}>
                              {row.yearDisplay}
                            </div>
                            <div>
                              <p className="text-sm font-bold text-white">Tax Year {row.yearDisplay}</p>
                              <span className={cn(
                                "text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full inline-block mt-1",
                                status === "Delinquent" ? "bg-red-500/10 text-red-500" : status === "Pending" ? "bg-blue-500/10 text-blue-400" : "bg-emerald-500/10 text-emerald-500"
                              )}>
                                {row.years.length > 1 ? `${status} (Grouped)` : status}
                              </span>
                            </div>
                          </div>

                          <div className="grid grid-cols-2 md:grid-cols-3 gap-6 text-right">
                            <div className="hidden md:block">
                              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Principal</p>
                              <p className="text-xs text-slate-300 font-bold">{formatCurrency(row.totalBasic + row.totalSef)}</p>
                            </div>
                            <div>
                              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Interest</p>
                              <p className="text-xs text-red-400 font-bold">+{formatCurrency(row.totalInterest)}</p>
                            </div>
                            <div>
                              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Total Due</p>
                              <p className="text-sm text-white font-black">{formatCurrency(row.totalDue)}</p>
                            </div>
                          </div>
                        </div>

                        {row.years.length === 1 && firstYearRecord?.status === "Paid" && firstYearRecord.paymentDetails && (
                          <div className="mt-2 p-3 bg-emerald-500/5 rounded-xl border border-emerald-500/10 grid grid-cols-2 md:grid-cols-4 gap-4">
                            <div>
                              <p className="text-[8px] font-bold text-emerald-500/50 uppercase tracking-tighter mb-0.5 flex items-center gap-1">
                                <Receipt className="w-2 h-2" />
                                Official Receipt
                              </p>
                              <p className="text-[10px] font-mono text-emerald-400 font-bold">{firstYearRecord.paymentDetails.orNumber}</p>
                            </div>
                            <div>
                              <p className="text-[8px] font-bold text-emerald-500/50 uppercase tracking-tighter mb-0.5 flex items-center gap-1">
                                <Clock className="w-2 h-2" />
                                Settlement Date
                              </p>
                              <p className="text-[10px] text-white font-bold">{formatDate(firstYearRecord.paymentDetails.paymentDate)}</p>
                            </div>
                            <div className="col-span-2">
                              <p className="text-[8px] font-bold text-emerald-500/50 uppercase tracking-tighter mb-0.5 flex items-center gap-1">
                                <User className="w-2 h-2" />
                                Authorized Payer
                              </p>
                              <p className="text-[10px] text-white font-bold truncate">{firstYearRecord.paymentDetails.payerName} ({firstYearRecord.paymentDetails.paymentType})</p>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  });
                })()}
              </div>
            )}
          </div>
        </div>
        
        {/* Footer info */}
        <div className="p-4 bg-slate-950 border-t border-slate-800 flex items-center justify-between">
          <p className="text-[10px] text-slate-600 font-mono tracking-tighter">SECURE_LINK_ENCRYPTED // {property.id}</p>
          <p className="text-[10px] text-slate-600 font-mono uppercase tracking-widest">System Revision 2.4.0</p>
        </div>
      </motion.div>
      )}
    </motion.div>
  );
};

export default PropertyDetails;
