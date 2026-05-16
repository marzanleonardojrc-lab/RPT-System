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
}

const PropertyDetails: React.FC<PropertyDetailsProps> = ({ property, onClose }) => {
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
    .filter(d => d.status === "Delinquent")
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
            <div className="w-12 h-12 bg-indigo-500/10 border border-indigo-500/20 rounded-2xl flex items-center justify-center">
              <Building2 className="w-6 h-6 text-indigo-400" />
            </div>
            <div>
              <h3 className="text-xl font-bold text-white tracking-tight">Real Property Tax Account Register (RPTAR)</h3>
              <p className="text-xs text-slate-500 font-mono mt-1 uppercase tracking-widest">{property.tdNumber}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
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
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Left Column: Summary Info */}
            <div className="space-y-6">
              <div className="p-6 bg-slate-950/50 rounded-2xl border border-slate-800 space-y-6">
                <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-4 flex items-center gap-2">
                  <User className="w-3 h-3 text-indigo-400" />
                  I. Record of Ownership
                </h4>
                <div className="space-y-4">
                  <div>
                    <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold mb-1">Registered Owner</p>
                    <p className="text-sm font-bold text-white mb-0.5">{property.ownerName}</p>
                    <p className="text-[10px] text-slate-400 font-mono">{property.ownerAddress}</p>
                  </div>
                  {property.administratorName && (
                    <div>
                      <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold mb-1">Administrator / User</p>
                      <p className="text-xs font-bold text-slate-300 mb-0.5">{property.administratorName}</p>
                      <p className="text-[10px] text-slate-400 font-mono">{property.administratorAddress}</p>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold mb-1">Tax Dec No.</p>
                      <p className="text-xs font-mono font-bold text-indigo-400">{property.tdNumber}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold mb-1">Effectivity</p>
                      <p className="text-xs font-bold text-slate-300">{property.effectivityDate}</p>
                    </div>
                  </div>
                </div>

                <div className="h-px bg-slate-800" />
                <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-4 flex items-center gap-2">
                  <MapPin className="w-3 h-3 text-indigo-400" />
                  II. Technical Description
                </h4>
                <div className="space-y-4">
                  <div>
                    <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold mb-1">Precise Location</p>
                    <p className="text-xs font-bold text-white mb-0.5">{property.detailedLocation}</p>
                    <p className="text-[10px] text-slate-400">{property.street ? `${property.street}, ` : ''}{property.barangay}, {property.municipality}, {property.province}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold mb-1">Lot / Blk No.</p>
                      <p className="text-xs font-bold text-slate-300">{property.lotNo || '-'} / {property.blkNo || '-'}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold mb-1">OCT / TCT</p>
                      <p className="text-xs font-bold text-slate-300">{property.octTct || '-'}</p>
                    </div>
                  </div>
                  <div>
                    <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold mb-1">CCT / CLOA</p>
                    <p className="text-xs font-bold text-slate-300">{property.cctCloa || '-'}</p>
                  </div>
                </div>

                <div className="h-px bg-slate-800" />
                <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-4 flex items-center gap-2">
                  <History className="w-3 h-3 text-indigo-400" />
                  III. Assessment Data
                </h4>
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
                    <p className="text-xl font-bold text-emerald-400">{formatCurrency(property.assessedValue)}</p>
                  </div>
                </div>

                <div className="h-px bg-slate-800" />
                <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-4 flex items-center gap-2">
                  <Info className="w-3 h-3 text-indigo-400" />
                  IV. Remarks & History
                </h4>
                <div className="space-y-3">
                  {property.previousTdNo && (
                    <div>
                      <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold mb-1">Previous Record</p>
                      <p className="text-[10px] font-bold text-slate-300">{property.previousTdNo} {property.previousOwner ? `(${property.previousOwner})` : ''}</p>
                      {property.previousAssessedValue > 0 && (
                        <p className="text-[9px] text-slate-500">Prev. A.V.: {formatCurrency(property.previousAssessedValue)}</p>
                      )}
                    </div>
                  )}
                  <div>
                    <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold mb-1">Recorded By</p>
                    <p className="text-[10px] font-medium text-slate-400 italic">{property.recordedBy || 'SYSTEM'}</p>
                  </div>
                </div>
              </div>

              {/* Financial Summary Section */}
              <div className="space-y-4">
                <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2 flex items-center gap-2">
                  <Receipt className="w-3 h-3 text-indigo-400" />
                  V. Financial Summary (All Years)
                </h4>
                
                <div className="grid grid-cols-1 gap-3">
                  {/* Outstanding Balance Card */}
                  <div className={cn(
                    "p-5 rounded-2xl border flex flex-col justify-between transition-all",
                    totalOutstanding > 0 
                      ? "bg-red-500/5 border-red-500/20 shadow-lg shadow-red-500/5" 
                      : "bg-emerald-500/5 border-emerald-500/20 shadow-lg shadow-emerald-500/5"
                  )}>
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Total Delinquent</p>
                      <div className={cn(
                        "p-1.5 rounded-lg border",
                        totalOutstanding > 0 ? "bg-red-500/10 border-red-500/20 text-red-400" : "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                      )}>
                        {totalOutstanding > 0 ? <AlertCircle className="w-3.5 h-3.5" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                      </div>
                    </div>
                    <p className={cn(
                      "text-2xl font-black tracking-tight",
                      totalOutstanding > 0 ? "text-red-400" : "text-emerald-400"
                    )}>
                      {formatCurrency(totalOutstanding)}
                    </p>
                    <p className="text-[9px] text-slate-500 mt-1 uppercase font-bold">Principal + Interest</p>
                  </div>

                  {/* Total Payments Card */}
                  <div className="p-5 bg-emerald-500/5 border border-emerald-500/20 rounded-2xl flex flex-col justify-between transition-all shadow-lg shadow-emerald-500/5">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Total Payments Made</p>
                      <div className="p-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-emerald-400">
                        <History className="w-3.5 h-3.5" />
                      </div>
                    </div>
                    <p className="text-2xl font-black tracking-tight text-emerald-400">
                      {formatCurrency(totalPaymentsMade)}
                    </p>
                    <p className="text-[9px] text-slate-500 mt-1 uppercase font-bold">Lifetime Collections</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Column: Tax History Ledger */}
            <div className="lg:col-span-2 space-y-6">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-bold text-white flex items-center gap-2">
                  <Clock className="w-4 h-4 text-indigo-400" />
                  Tax Delinquency Ledger
                </h4>
                <div className="px-3 py-1 bg-slate-800 rounded-full text-[10px] font-bold text-slate-400 border border-slate-700">
                  {history.length} RECORDS FOUND
                </div>
              </div>

              {loading ? (
                <div className="flex items-center justify-center py-20">
                  <div className="w-8 h-8 border-2 border-indigo-500/20 border-t-indigo-500 rounded-full animate-spin" />
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
                    return grouped.map((row) => {
                      const firstYearRecord = history.find(h => h.year === row.years[0]);
                      const status = row.years.some(y => history.find(h => h.year === y)?.status === "Delinquent") ? "Delinquent" : "Paid";

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
                                status === "Delinquent" ? "bg-red-500/10 text-red-400 border border-red-500/20" : "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                              )}>
                                {row.yearDisplay}
                              </div>
                              <div>
                                <p className="text-sm font-bold text-white">Tax Year {row.yearDisplay}</p>
                                <span className={cn(
                                  "text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full inline-block mt-1",
                                  status === "Delinquent" ? "bg-red-500/10 text-red-500" : "bg-emerald-500/10 text-emerald-500"
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
