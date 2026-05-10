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
import { Property, Delinquency } from "../types";
import { formatCurrency, formatPercent, cn, formatDate } from "../lib/utils";
import { X, Building2, User, MapPin, Search, AlertCircle, CheckCircle2, Clock, History, Receipt, Info } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { calculateTotalDue } from "../lib/taxCalculations";

interface PropertyDetailsProps {
  property: Property;
  onClose: () => void;
}

const PropertyDetails: React.FC<PropertyDetailsProps> = ({ property, onClose }) => {
  const [history, setHistory] = useState<Delinquency[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(
      collection(db, "delinquencies"), 
      where("propertyId", "==", property.id),
      orderBy("year", "desc")
    );

    return onSnapshot(q, (snapshot) => {
      setHistory(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Delinquency)));
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `delinquencies?propertyId=${property.id}`);
    });
  }, [property.id]);

  const totalOutstanding = history
    .filter(d => d.status === "Delinquent")
    .reduce((acc, curr) => acc + calculateTotalDue(curr.basicTaxDue, curr.sefTaxDue, curr.year).totalDue, 0);

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
        className="bg-slate-900 border border-slate-800 rounded-3xl shadow-3xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="p-6 border-b border-slate-800 bg-slate-900/50 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-indigo-500/10 border border-indigo-500/20 rounded-2xl flex items-center justify-center">
              <Building2 className="w-6 h-6 text-indigo-400" />
            </div>
            <div>
              <h3 className="text-xl font-bold text-white tracking-tight">Property Intelligence View</h3>
              <p className="text-xs text-slate-500 font-mono mt-1 uppercase tracking-widest">{property.pin}</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-2 hover:bg-slate-800 rounded-xl text-slate-400 transition-colors border border-transparent hover:border-slate-700"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 md:p-8">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Left Column: Summary Info */}
            <div className="space-y-6">
              <div className="p-6 bg-slate-950/50 rounded-2xl border border-slate-800 space-y-6">
                <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-4 flex items-center gap-2">
                  <User className="w-3 h-3" />
                  Ownership Data
                </h4>
                <div>
                  <p className="text-sm font-bold text-white mb-1">{property.ownerName}</p>
                  <p className="text-xs text-slate-400">Primary Registered Owner</p>
                </div>
                <div className="h-px bg-slate-800" />
                <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-4 flex items-center gap-2">
                  <MapPin className="w-3 h-3" />
                  Geographic Metadata
                </h4>
                <div>
                  <p className="text-sm font-bold text-white mb-1">{property.barangay}</p>
                  <p className="text-xs text-slate-400">Barangay Jurisdiction</p>
                </div>
                <div className="h-px bg-slate-800" />
                <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-4 flex items-center gap-2">
                  <History className="w-3 h-3" />
                  Valuation Metrics
                </h4>
                <div className="space-y-4">
                  <div>
                    <p className="text-sm font-bold text-white mb-1">{property.propertyType}</p>
                    <p className="text-xs text-slate-400">Property Classification</p>
                  </div>
                  <div>
                    <p className="text-xl font-bold text-emerald-400 mb-1">{formatCurrency(property.assessedValue)}</p>
                    <p className="text-xs text-slate-400">Current Assessed Value</p>
                  </div>
                </div>
              </div>

              {/* Outstanding Balance Card */}
              <div className={cn(
                "p-6 rounded-2xl border flex flex-col justify-between transition-all",
                totalOutstanding > 0 
                  ? "bg-red-500/5 border-red-500/20 shadow-lg shadow-red-500/5" 
                  : "bg-emerald-500/5 border-emerald-500/20 shadow-lg shadow-emerald-500/5"
              )}>
                <div className="flex items-center justify-between mb-4">
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Aggregate Outstanding</p>
                  <div className={cn(
                    "p-1.5 rounded-lg border",
                    totalOutstanding > 0 ? "bg-red-500/10 border-red-500/20 text-red-400" : "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                  )}>
                    {totalOutstanding > 0 ? <AlertCircle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
                  </div>
                </div>
                <p className={cn(
                  "text-3xl font-black tracking-tight",
                  totalOutstanding > 0 ? "text-red-400" : "text-emerald-400"
                )}>
                  {formatCurrency(totalOutstanding)}
                </p>
                <p className="text-[10px] text-slate-500 mt-2 uppercase font-bold">Total Principal + Accrued Interest</p>
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
                  {history.map((record) => {
                    const calc = calculateTotalDue(record.basicTaxDue, record.sefTaxDue, record.year);
                    return (
                      <div 
                        key={record.id} 
                        className={cn(
                          "p-4 rounded-xl border flex flex-col gap-4 transition-all hover:bg-slate-800/30",
                          record.status === "Delinquent" ? "bg-slate-900 border-slate-800" : "bg-slate-950 border-slate-800/50 opacity-90"
                        )}
                      >
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                          <div className="flex items-center gap-4">
                            <div className={cn(
                              "w-10 h-10 rounded-lg flex items-center justify-center font-bold text-xs",
                              record.status === "Delinquent" ? "bg-red-500/10 text-red-400 border border-red-500/20" : "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                            )}>
                              {record.year}
                            </div>
                            <div>
                              <p className="text-sm font-bold text-white">Tax Year {record.year}</p>
                              <span className={cn(
                                "text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full inline-block mt-1",
                                record.status === "Delinquent" ? "bg-red-500/10 text-red-500" : "bg-emerald-500/10 text-emerald-500"
                              )}>
                                {record.status}
                              </span>
                            </div>
                          </div>

                          <div className="grid grid-cols-2 md:grid-cols-3 gap-6 text-right">
                            <div className="hidden md:block">
                              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Principal</p>
                              <p className="text-xs text-slate-300 font-bold">{formatCurrency(record.basicTaxDue + record.sefTaxDue)}</p>
                            </div>
                            <div>
                              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Interest</p>
                              <p className="text-xs text-red-400 font-bold">+{formatCurrency(calc.interest)}</p>
                            </div>
                            <div>
                              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Total Due</p>
                              <p className="text-sm text-white font-black">{formatCurrency(calc.totalDue)}</p>
                            </div>
                          </div>
                        </div>

                        {record.status === "Paid" && record.paymentDetails && (
                          <div className="mt-2 p-3 bg-emerald-500/5 rounded-xl border border-emerald-500/10 grid grid-cols-2 md:grid-cols-4 gap-4">
                            <div>
                              <p className="text-[8px] font-bold text-emerald-500/50 uppercase tracking-tighter mb-0.5 flex items-center gap-1">
                                <Receipt className="w-2 h-2" />
                                Official Receipt
                              </p>
                              <p className="text-[10px] font-mono text-emerald-400 font-bold">{record.paymentDetails.orNumber}</p>
                            </div>
                            <div>
                              <p className="text-[8px] font-bold text-emerald-500/50 uppercase tracking-tighter mb-0.5 flex items-center gap-1">
                                <Clock className="w-2 h-2" />
                                Settlement Date
                              </p>
                              <p className="text-[10px] text-white font-bold">{formatDate(record.paymentDetails.paymentDate)}</p>
                            </div>
                            <div className="col-span-2">
                              <p className="text-[8px] font-bold text-emerald-500/50 uppercase tracking-tighter mb-0.5 flex items-center gap-1">
                                <User className="w-2 h-2" />
                                Authorized Payer
                              </p>
                              <p className="text-[10px] text-white font-bold truncate">{record.paymentDetails.payerName} ({record.paymentDetails.paymentType})</p>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
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
    </motion.div>
  );
};

export default PropertyDetails;
