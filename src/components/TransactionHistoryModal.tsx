import React, { useState, useEffect, useMemo } from "react";
import { 
  collection, 
  query, 
  where, 
  onSnapshot 
} from "firebase/firestore";
import { db } from "../lib/firebase";
import { Property, Payment } from "../types";
import { formatCurrency, cn } from "../lib/utils";
import { 
  X, 
  ArrowUpDown, 
  ArrowUp, 
  ArrowDown, 
  History, 
  Calendar, 
  Receipt, 
  User, 
  CreditCard,
  AlertTriangle,
  CheckCircle2,
  Lock,
  Search,
  Filter
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface TransactionHistoryModalProps {
  property: Property | null;
  onClose: () => void;
}

type SortField = "taxYear" | "paymentDate" | "orNumber" | "amountPaid" | "status" | "payerName";
type SortOrder = "asc" | "desc";

export const TransactionHistoryModal: React.FC<TransactionHistoryModalProps> = ({ 
  property, 
  onClose 
}) => {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [stateFilter, setStateFilter] = useState<"all" | "Active" | "Voided">("all");

  // Sort State
  const [sortField, setSortField] = useState<SortField>("paymentDate");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");

  // Fetch payments for property
  useEffect(() => {
    if (!property) return;

    setLoading(true);
    const q = query(
      collection(db, "payments"),
      where("propertyId", "==", property.id)
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const fetched = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        } as Payment));
        setPayments(fetched);
        setLoading(false);
      },
      (err) => {
        console.error("Error fetching payments history:", err);
        setError("Failed to stream historical transactions.");
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [property]);

  // Handle Sort Toggle
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(prev => prev === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortOrder("desc"); // Default to desc for new fields
    }
  };

  // Filter & Sort logic
  const processedPayments = useMemo(() => {
    let result = [...payments];

    // 1. Text Filter (OR Number, Payer, Recorded By)
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      result = result.filter(p => 
        p.orNumber?.toLowerCase().includes(term) ||
        p.payerName?.toLowerCase().includes(term) ||
        p.recordedBy?.toLowerCase().includes(term) ||
        (p.taxYear?.toString() || "").includes(term)
      );
    }

    // 2. Status Filter
    if (stateFilter !== "all") {
      result = result.filter(p => p.status === stateFilter);
    }

    // 3. Sorting
    result.sort((a, b) => {
      let valA: any = a[sortField];
      let valB: any = b[sortField];

      // Handle undefined/nulls safely
      if (valA === undefined || valA === null) valA = "";
      if (valB === undefined || valB === null) valB = "";

      // Normalize types for comparison
      if (typeof valA === "string") valA = valA.toLowerCase();
      if (typeof valB === "string") valB = valB.toLowerCase();

      if (valA < valB) return sortOrder === "asc" ? -1 : 1;
      if (valA > valB) return sortOrder === "asc" ? 1 : -1;
      return 0;
    });

    return result;
  }, [payments, searchTerm, stateFilter, sortField, sortOrder]);

  // Aggregate stats
  const stats = useMemo(() => {
    const active = payments.filter(p => p.status === "Active");
    const voided = payments.filter(p => p.status === "Voided");
    
    const totalActivePaid = active.reduce((sum, p) => sum + (p.amountPaid || 0), 0);
    const totalActiveBasic = active.reduce((sum, p) => sum + (p.basicPaid || 0), 0);
    const totalActiveSef = active.reduce((sum, p) => sum + (p.sefPaid || 0), 0);
    const totalActivePenalty = active.reduce((sum, p) => sum + (p.penaltyPaid || 0), 0);

    return {
      totalActivePaid,
      totalActiveBasic,
      totalActiveSef,
      totalActivePenalty,
      activeCount: active.length,
      voidedCount: voided.length,
      totalCount: payments.length
    };
  }, [payments]);

  if (!property) return null;

  // Render direction indicator
  const renderSortIndicator = (field: SortField) => {
    if (sortField !== field) {
      return <ArrowUpDown className="w-3.5 h-3.5 text-slate-600 group-hover:text-slate-400 transition ml-1" />;
    }
    return sortOrder === "asc" 
      ? <ArrowUp className="w-3.5 h-3.5 text-indigo-400 ml-1" />
      : <ArrowDown className="w-3.5 h-3.5 text-indigo-400 ml-1" />;
  };

  return (
    <div className="fixed inset-0 bg-slate-950/90 backdrop-blur-md z-[120] flex items-center justify-center p-4">
      <motion.div 
        initial={{ scale: 0.95, y: 20, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ scale: 0.95, y: 20, opacity: 0 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className="bg-slate-900 border border-slate-800 rounded-[2rem] shadow-2xl w-full max-w-6xl flex flex-col max-h-[92vh] overflow-hidden"
      >
        {/* Header */}
        <div className="p-6 border-b border-slate-800 flex items-center justify-between bg-slate-950/50">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-indigo-500/10 rounded-2xl flex items-center justify-center border border-indigo-500/25">
              <History className="w-6 h-6 text-indigo-400" />
            </div>
            <div>
              <h3 className="text-lg font-black text-white uppercase tracking-tight">Transaction Ledger History</h3>
              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-0.5">
                Complete payment timeline for T.D. No: <span className="font-mono text-indigo-400 font-black">{property.tdNumber}</span>
              </p>
            </div>
          </div>
          <button 
            type="button"
            onClick={onClose} 
            className="p-2.5 hover:bg-slate-800 rounded-xl text-slate-500 hover:text-slate-300 transition-all border border-slate-800/40"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Property Metadata Cards */}
        <div className="px-6 py-4 bg-slate-950/30 border-b border-slate-800/50 grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="space-y-1">
            <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest block">Declared Owner</span>
            <span className="text-xs font-bold text-slate-200 block truncate">{property.ownerName}</span>
          </div>
          <div className="space-y-1">
            <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest block">Property Location</span>
            <span className="text-xs font-medium text-slate-400 block truncate">{property.barangay}, {property.municipality}</span>
          </div>
          <div className="space-y-1">
            <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest block">Assessed Valuation</span>
            <span className="text-xs font-black text-emerald-400 block">{formatCurrency(property.assessedValue)}</span>
          </div>
          <div className="space-y-1">
            <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest block">Classification / Kind</span>
            <span className="text-xs font-mono font-bold text-indigo-400 block uppercase tracking-wide">{property.classification}</span>
          </div>
        </div>

        {/* Main Content Area */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-[#0a0c10]">
          {/* Summary Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="p-4 bg-slate-950 border border-slate-800 rounded-2xl">
              <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Aggregate Collected</p>
              <h4 className="text-xl font-mono font-black text-emerald-400 mt-1">{formatCurrency(stats.totalActivePaid)}</h4>
              <p className="text-[9px] text-slate-500 font-bold mt-0.5">Excludes voided assessments</p>
            </div>
            <div className="p-4 bg-slate-950 border border-slate-800 rounded-2xl">
              <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Basic Tax Base</p>
              <h4 className="text-xl font-mono font-black text-white mt-1">{formatCurrency(stats.totalActiveBasic)}</h4>
              <p className="text-[9px] text-slate-500 font-bold mt-0.5">{formatCurrency(stats.totalActiveSef)} SEF portion</p>
            </div>
            <div className="p-4 bg-slate-950 border border-slate-800 rounded-2xl">
              <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Surcharges Gathered</p>
              <h4 className="text-xl font-mono font-black text-amber-500 mt-1">{formatCurrency(stats.totalActivePenalty)}</h4>
              <p className="text-[9px] text-slate-500 font-bold mt-0.5">Penalties and late interests</p>
            </div>
            <div className="p-4 bg-slate-950 border border-slate-800 rounded-2xl flex items-center justify-between">
              <div>
                <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Transaction Tally</p>
                <h4 className="text-xl font-mono font-black text-white mt-1">{stats.activeCount} <span className="text-slate-500 text-xs">Active</span></h4>
              </div>
              <div className="text-right">
                <span className="text-[9px] font-black text-rose-500 uppercase tracking-widest block">Voided</span>
                <span className="text-sm font-mono font-black text-rose-400">{stats.voidedCount} records</span>
              </div>
            </div>
          </div>

          {/* Filtering and Search Controls */}
          <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
            {/* Search Box */}
            <div className="relative w-full md:w-80">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input 
                type="text" 
                placeholder="Search by O.R. / Payer / Year..." 
                className="w-full pl-10 pr-4 py-2 text-xs border border-slate-800 rounded-xl bg-slate-950 text-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-medium"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
              />
            </div>

            {/* Tab filter presets */}
            <div className="flex bg-slate-950 border border-slate-800 rounded-xl p-0.5 w-full md:w-auto">
              {(["all", "Active", "Voided"] as const).map((filter) => (
                <button
                  key={filter}
                  onClick={() => setStateFilter(filter)}
                  className={cn(
                    "flex-1 md:flex-initial px-4 py-1.5 text-[9px] font-black uppercase tracking-wider rounded-lg transition-all",
                    stateFilter === filter
                      ? "bg-indigo-600 text-white shadow-lg"
                      : "text-slate-400 hover:text-slate-200"
                  )}
                >
                  {filter === "all" ? "All Receipts" : filter}
                </button>
              ))}
            </div>
          </div>

          {/* Sortable Transaction Table */}
          <div className="border border-slate-800 rounded-2xl overflow-hidden bg-slate-950/20 shadow-2xl">
            <div className="overflow-x-auto">
              <table className="w-full text-left font-sans border-collapse">
                <thead>
                  <tr className="bg-slate-950 border-b border-slate-800">
                    <th 
                      onClick={() => handleSort("orNumber")}
                      className="px-5 py-3 text-[9px] font-black text-slate-500 uppercase tracking-widest cursor-pointer hover:bg-slate-900 transition group select-none"
                    >
                      <div className="flex items-center">
                        Official Receipt
                        {renderSortIndicator("orNumber")}
                      </div>
                    </th>
                    <th 
                      onClick={() => handleSort("paymentDate")}
                      className="px-5 py-3 text-[9px] font-black text-slate-500 uppercase tracking-widest cursor-pointer hover:bg-slate-900 transition group select-none"
                    >
                      <div className="flex items-center">
                        Date Settled
                        {renderSortIndicator("paymentDate")}
                      </div>
                    </th>
                    <th 
                      onClick={() => handleSort("taxYear")}
                      className="px-5 py-3 text-[9px] font-black text-slate-500 uppercase tracking-widest cursor-pointer hover:bg-slate-900 transition group select-none"
                    >
                      <div className="flex items-center">
                        Period
                        {renderSortIndicator("taxYear")}
                      </div>
                    </th>
                    <th 
                      onClick={() => handleSort("payerName")}
                      className="px-5 py-3 text-[9px] font-black text-slate-500 uppercase tracking-widest cursor-pointer hover:bg-slate-900 transition group select-none"
                    >
                      <div className="flex items-center">
                        Taxpayer / Payee
                        {renderSortIndicator("payerName")}
                      </div>
                    </th>
                    <th className="px-5 py-3 text-[9px] font-black text-slate-500 uppercase tracking-widest text-right">
                      Levies (Basic / SEF)
                    </th>
                    <th className="px-5 py-3 text-[9px] font-black text-slate-500 uppercase tracking-widest text-right">
                      Interests / Penalties
                    </th>
                    <th 
                      onClick={() => handleSort("amountPaid")}
                      className="px-5 py-3 text-[9px] font-black text-indigo-400 uppercase tracking-widest cursor-pointer hover:bg-slate-900 transition group select-none text-right"
                    >
                      <div className="flex items-center justify-end">
                        Sum Settled
                        {renderSortIndicator("amountPaid")}
                      </div>
                    </th>
                    <th 
                      onClick={() => handleSort("status")}
                      className="px-5 py-3 text-[9px] font-black text-slate-500 uppercase tracking-widest cursor-pointer hover:bg-slate-900 transition group select-none text-center"
                    >
                      <div className="flex items-center justify-center">
                        Status
                        {renderSortIndicator("status")}
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono text-xs">
                  {loading ? (
                    <tr>
                      <td colSpan={8} className="px-5 py-16 text-center text-slate-500">
                        <div className="flex justify-center items-center gap-2">
                          <History className="w-4 h-4 text-indigo-400 animate-spin" />
                          <span className="font-sans font-medium text-slate-400 uppercase tracking-widest text-[10px]">Retrieving Receipt Timeline...</span>
                        </div>
                      </td>
                    </tr>
                  ) : processedPayments.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-5 py-16 text-center text-slate-500">
                        <div className="flex flex-col items-center gap-2 py-4">
                          <Receipt className="w-8 h-8 text-slate-800 mb-1" />
                          <p className="font-sans font-bold text-slate-400 text-sm">No transaction documents found</p>
                          <p className="font-sans text-[10px] text-slate-600 max-w-sm">No payments correspond to your criteria or search filters for this tax entry.</p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    processedPayments.map(payment => (
                      <tr 
                        key={payment.id} 
                        className={cn(
                          "hover:bg-slate-900/35 transition-colors",
                          payment.status === "Voided" && "bg-rose-950/5 text-slate-500 opacity-60"
                        )}
                      >
                        <td className="px-5 py-3.5">
                          <div className="flex flex-col gap-0.5">
                            <span className="font-bold text-slate-300 font-mono text-xs tracking-tight">O.R. {payment.orNumber}</span>
                            <span className="text-[8px] font-sans text-slate-500 uppercase tracking-wider font-bold">
                              By: {payment.recordedBy}
                            </span>
                          </div>
                        </td>
                        <td className="px-5 py-3.5 text-slate-400 font-sans">
                          {payment.paymentDate ? new Date(payment.paymentDate).toLocaleDateString("en-US", {
                            year: "numeric",
                            month: "short",
                            day: "numeric"
                          }) : "---"}
                        </td>
                        <td className="px-5 py-3.5 text-center font-bold text-slate-300 text-xs text-indigo-400/90 font-mono">
                          {payment.taxYear}
                        </td>
                        <td className="px-5 py-3.5 font-sans font-medium text-slate-300 truncate max-w-[150px]">
                          {payment.payerName}
                        </td>
                        <td className="px-5 py-3.5 text-right font-mono text-slate-400">
                          <div className="flex flex-col text-[10px]">
                            <span>Bsc: {formatCurrency(payment.basicPaid)}</span>
                            <span>Sef: {formatCurrency(payment.sefPaid)}</span>
                          </div>
                        </td>
                        <td className="px-5 py-3.5 text-right font-mono text-rose-400/80">
                          {payment.penaltyPaid > 0 ? `+${formatCurrency(payment.penaltyPaid)}` : "₱0.00"}
                        </td>
                        <td className="px-5 py-3.5 text-right text-xs font-black text-slate-200">
                          <div className="flex flex-col">
                            <span className={cn(
                              payment.status === "Active" ? "text-emerald-400" : "text-slate-500 line-through"
                            )}>
                              {formatCurrency(payment.amountPaid)}
                            </span>
                            <span className="text-[8px] font-sans font-bold uppercase text-slate-500 tracking-wider">
                              {payment.paymentType} • {payment.settlementMethod || "Cash"}
                            </span>
                          </div>
                        </td>
                        <td className="px-5 py-3.5 text-center">
                          {payment.status === "Active" ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[8px] font-black font-sans uppercase tracking-widest bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                              <CheckCircle2 className="w-2.5 h-2.5" />
                              Active
                            </span>
                          ) : (
                            <div className="flex flex-col items-center gap-0.5 justify-center">
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[8px] font-black font-sans uppercase tracking-widest bg-rose-500/10 text-rose-400 border border-rose-500/20">
                                <AlertTriangle className="w-2.5 h-2.5" />
                                Voided
                              </span>
                              {payment.voidMetadata && (
                                <span className="text-[7px] text-slate-500 font-sans tracking-wide block max-w-[120px] truncate" title={payment.voidMetadata.reason}>
                                  "{payment.voidMetadata.reason}"
                                </span>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 bg-slate-950 border-t border-slate-800 flex justify-end">
          <button 
            type="button"
            onClick={onClose} 
            className="px-6 h-9 text-[9px] font-black uppercase tracking-widest text-slate-200 hover:bg-slate-900 rounded-xl transition-all border border-slate-800 shadow-sm"
          >
            Acknowledge & Close
          </button>
        </div>
      </motion.div>
    </div>
  );
};
