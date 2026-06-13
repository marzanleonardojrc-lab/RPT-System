import React, { useState, useEffect } from "react";
import { 
  collection, 
  onSnapshot, 
  addDoc, 
  updateDoc,
  doc,
  query,
  serverTimestamp,
  db,
  handleFirestoreError,
  OperationType 
} from "../lib/firebase";
import { useAuth } from "../AuthContext";
import { Delinquency, Property, DelinquencyStatus, PaymentDetails, Payment } from "../types";
import { calculateTotalDue, calculatePenalties, groupDelinquenciesByPenaltyRule, GroupedDelinquency, BASIC_TAX_RATE, SEF_TAX_RATE, IDLE_LAND_RATE } from "../lib/taxCalculations";
import { cn, formatCurrency } from "../lib/utils";
import { Plus, Search, Filter, CreditCard, AlertCircle, CheckCircle2, Receipt, X, Clock, XCircle, Info, ArrowUp, Printer, FileText } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { logAudit } from "../lib/audit";
import ConfirmDialog from "./ConfirmDialog";
import DelinquencyActions from "./DelinquencyActions";
import { NoticeOfDelinquencyPrintView } from "./NoticeOfDelinquencyPrintView";

const DelinquencyList: React.FC<{ isEncoder: boolean, isAdmin: boolean }> = ({ isEncoder, isAdmin }) => {
  const { profile } = useAuth();
  const [delinquencies, setDelinquencies] = useState<Delinquency[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [activeDelinquency, setActiveDelinquency] = useState<Delinquency | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [expandedPropId, setExpandedPropId] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [selectedPropId, setSelectedPropId] = useState("");
  const [propertySearch, setPropertySearch] = useState("");
  const [propertySearchResults, setPropertySearchResults] = useState<Property[]>([]);
  const [focusedSearchIndex, setFocusedSearchIndex] = useState(-1);
  const [selectedPrintNotice, setSelectedPrintNotice] = useState<any | null>(null);

  // Dialog state
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    type?: "danger" | "warning" | "info" | "success";
  }>({
    isOpen: false,
    title: "",
    message: "",
    onConfirm: () => {},
  });

  useEffect(() => {
    if (!propertySearch.trim()) {
      setPropertySearchResults([]);
      return;
    }
    const filtered = properties.filter(p => 
      !p.isArchived && (
        p.tdNumber.toLowerCase().includes(propertySearch.toLowerCase()) ||
        p.ownerName.toLowerCase().includes(propertySearch.toLowerCase())
      )
    ).slice(0, 5); // Limit to top 5 results for clarity
    setPropertySearchResults(filtered);
  }, [propertySearch, properties]);

  useEffect(() => {
    const unsubDelinq = onSnapshot(collection(db, "delinquencies"), (snapshot) => {
      setDelinquencies(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Delinquency)));
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, "delinquencies");
    });

    const unsubProp = onSnapshot(collection(db, "properties"), (snapshot) => {
      setProperties(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Property)));
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, "properties");
    });

    const unsubPayments = onSnapshot(collection(db, "payments"), (snapshot) => {
      setPayments(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Payment)));
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, "payments");
    });

    return () => { unsubDelinq(); unsubProp(); unsubPayments(); };
  }, []);

  const [entryRows, setEntryRows] = useState<{ id: string; startYear: number; endYear: number; assessedValue: number }[]>([
    { id: Math.random().toString(36).substr(2, 9), startYear: new Date().getFullYear() - 1, endYear: new Date().getFullYear() - 1, assessedValue: 0 }
  ]);

  const addEntryRow = () => {
    const lastRow = entryRows[entryRows.length - 1];
    setEntryRows([
      ...entryRows,
      { 
        id: Math.random().toString(36).substr(2, 9), 
        startYear: lastRow ? lastRow.endYear + 1 : new Date().getFullYear() - 1,
        endYear: lastRow ? lastRow.endYear + 1 : new Date().getFullYear() - 1,
        assessedValue: lastRow?.assessedValue || 0
      }
    ]);
  };

  const removeEntryRow = (id: string) => {
    if (entryRows.length > 1) {
      setEntryRows(entryRows.filter(r => r.id !== id));
    }
  };

  const updateEntryRow = (id: string, updates: any) => {
    setEntryRows(entryRows.map(r => r.id === id ? { ...r, ...updates } : r));
  };

  const calculateRowStats = (row: typeof entryRows[0]) => {
    const span = Math.max(1, (row.endYear - row.startYear) + 1);
    const aggregateAssessed = row.assessedValue * span;
    const basicTax = aggregateAssessed * BASIC_TAX_RATE;
    const sefTax = aggregateAssessed * SEF_TAX_RATE;
    
    // Penalties are calculated per year and summed
    let totalPenalty = 0;
    for (let y = row.startYear; y <= row.endYear; y++) {
      const yearBasic = row.assessedValue * BASIC_TAX_RATE;
      const yearSef = row.assessedValue * SEF_TAX_RATE;
      const yearPenalties = calculatePenalties(yearBasic + yearSef, y, new Date());
      totalPenalty += yearPenalties.interestAmount;
    }

    const totalDue = basicTax + sefTax + totalPenalty;

    return {
      span,
      aggregateAssessed,
      basicTax,
      sefTax,
      totalPenalty,
      totalDue
    };
  };

  const handleCreate = async () => {
    try {
      for (const row of entryRows) {
        // We iterate through each year in the span and create/update records
        for (let y = row.startYear; y <= row.endYear; y++) {
          const yearBasic = row.assessedValue * BASIC_TAX_RATE;
          const yearSef = row.assessedValue * SEF_TAX_RATE;
          const calc = calculateTotalDue(yearBasic, yearSef, y, new Date(), 0);

          const existing = delinquencies.find(d => 
            d.propertyId === selectedPropId && 
            d.year === y &&
            (d.status === "Delinquent" || d.status === "Pending")
          );

          const status: DelinquencyStatus = "Delinquent";

          if (existing) {
            const ref = doc(db, "delinquencies", existing.id);
            const updateData = {
              basicTaxDue: yearBasic,
              sefTaxDue: yearSef,
              penalty: calc.interest,
              interest: calc.interest,
              totalDue: calc.totalDue,
              status: status,
              updatedAt: serverTimestamp()
            };
            await updateDoc(ref, updateData);
            await logAudit("UPDATE", "Delinquency", existing.id, existing, updateData);
          } else {
            const docRef = await addDoc(collection(db, "delinquencies"), {
              propertyId: selectedPropId,
              year: y,
              basicTaxDue: yearBasic,
              sefTaxDue: yearSef,
              idleSurcharge: 0,
              penalty: calc.interest,
              interest: calc.interest,
              totalDue: calc.totalDue,
              status: status,
              recordedBy: profile?.username || profile?.displayName || "System",
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp()
            });
            await logAudit("CREATE", "Delinquency", docRef.id, null, { propertyId: selectedPropId, year: y, totalDue: calc.totalDue });
          }
        }
      }
      
      setIsAdding(false);
      setSelectedPropId("");
      setPropertySearch("");
      setEntryRows([{ id: Math.random().toString(36).substr(2, 9), startYear: new Date().getFullYear() - 1, endYear: new Date().getFullYear() - 1, assessedValue: 0 }]);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, "delinquencies");
    }
  };

  const preSubmitCheck = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPropId || entryRows.some(r => r.assessedValue <= 0)) return;

    const prop = properties.find(p => p.id === selectedPropId);
    
    setConfirmDialog({
      isOpen: true,
      title: "Issue Batch Delinquencies?",
      message: `You are about to issue delinquency records for ${prop?.ownerName}. \n\nExisting records for the specified years will be updated. Do you wish to continue?`,
      type: "warning",
      onConfirm: handleCreate
    });
  };

  const groupedDelinquencies = React.useMemo(() => {
    const groups: Record<string, { 
      property: Property; 
      delinquencies: Delinquency[];
      totalPrincipal: number;
      totalInterest: number;
      totalDue: number;
      minYear: number;
      maxYear: number;
    }> = {};

    delinquencies.forEach(d => {
      const prop = properties.find(p => p.id === d.propertyId);
      if (!prop || prop.isArchived) return;

      const hasPayment = payments.some(p => p.propertyId === d.propertyId && p.taxYear === d.year && p.status === "Active");
      const isEffectivelyPaid = d.status === "Paid" || hasPayment;
      const statusToDisplay = isEffectivelyPaid ? "Paid" : d.status;

      // Search matching
      const searchStr = `${prop.ownerName} ${prop.tdNumber} ${d.year}`.toLowerCase();
      const matchesSearch = searchStr.includes(searchTerm.toLowerCase());

      // Status filtering matching
      let matchesStatus = true;
      if (statusFilter !== "All") {
        matchesStatus = statusToDisplay === statusFilter;
      } else {
        matchesStatus = statusToDisplay !== "Paid";
      }

      if (!matchesSearch || !matchesStatus) return;

      if (!groups[d.propertyId]) {
        groups[d.propertyId] = {
          property: prop,
          delinquencies: [],
          totalPrincipal: 0,
          totalInterest: 0,
          totalDue: 0,
          minYear: Infinity,
          maxYear: -Infinity
        };
      }

      const group = groups[d.propertyId];
      const currentCalc = calculateTotalDue(d.basicTaxDue, d.sefTaxDue, d.year, new Date(), (d as any).idleSurcharge || 0);

      group.delinquencies.push({ ...d });
      group.totalPrincipal += (d.basicTaxDue + d.sefTaxDue + ((d as any).idleSurcharge || 0));
      group.totalInterest += currentCalc.interest;
      group.totalDue += currentCalc.totalDue;
      group.minYear = Math.min(group.minYear, d.year);
      group.maxYear = Math.max(group.maxYear, d.year);
    });

    // Sort delinquencies within groups by year desc
    Object.values(groups).forEach(g => {
      g.delinquencies.sort((a, b) => b.year - a.year);
    });

    return Object.values(groups).sort((a, b) => a.property.ownerName.localeCompare(b.property.ownerName));
  }, [delinquencies, properties, searchTerm, statusFilter, payments]);

  return (
    <div className="space-y-6">
      <ConfirmDialog 
        isOpen={confirmDialog.isOpen}
        onClose={() => setConfirmDialog(prev => ({ ...prev, isOpen: false }))}
        onConfirm={confirmDialog.onConfirm}
        title={confirmDialog.title}
        message={confirmDialog.message}
        type={confirmDialog.type}
      />
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white tracking-tight">Delinquency Ledger</h2>
          <p className="text-slate-500 text-sm mt-1">Real-time monitoring of outstanding tax assets and liabilities.</p>
        </div>
        {isEncoder && (
          <button 
            onClick={() => setIsAdding(true)}
            className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-xl hover:bg-red-500 transition shadow-lg shadow-red-600/20 font-bold text-xs uppercase tracking-wider"
          >
            <Plus className="w-4 h-4" />
            Issue Delinquency
          </button>
        )}
      </div>

      <AnimatePresence mode="popLayout">
        {isAdding && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-[60] flex items-center justify-center p-4 overflow-y-auto"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl w-full max-w-5xl overflow-hidden"
            >
              <div className="p-6 border-b border-slate-800 flex items-center justify-between bg-slate-950/50">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-red-500/10 rounded-xl">
                    <AlertCircle className="w-5 h-5 text-red-400" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-white tracking-tight uppercase">Initialize Issuance Registry</h3>
                    <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Identify property and define delinquent periods.</p>
                  </div>
                </div>
                <button 
                  onClick={() => {
                    setIsAdding(false);
                    setSelectedPropId("");
                    setPropertySearch("");
                  }}
                  className="p-2 hover:bg-slate-800 rounded-xl text-slate-400 transition-colors"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="p-8 space-y-8 max-h-[80vh] overflow-y-auto">
                {/* Search Header */}
                <div className="bg-slate-950/50 p-6 rounded-2xl border border-slate-800 flex flex-col md:flex-row items-center justify-between gap-6">
                  <div className="w-full md:flex-1">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2 block">Search Property</label>
                    {selectedPropId ? (
                      <div className="flex items-center justify-between p-4 bg-indigo-500/5 border border-indigo-500/20 rounded-xl">
                        <div className="truncate">
                          <p className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest mb-0.5">TD: {properties.find(p => p.id === selectedPropId)?.tdNumber}</p>
                          <p className="text-sm text-white font-bold truncate">{properties.find(p => p.id === selectedPropId)?.ownerName}</p>
                        </div>
                        <button type="button" onClick={() => setSelectedPropId("")} className="px-4 py-2 hover:bg-red-500/10 text-red-400 text-[10px] font-bold uppercase tracking-widest rounded-lg transition-colors border border-red-500/20">
                          Change
                        </button>
                      </div>
                    ) : (
                      <div className="relative">
                        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                        <input 
                          type="text"
                          placeholder="Ex: 000-000-000-000 or Owner Name..."
                          className="w-full pl-10 pr-4 py-3 bg-slate-950 border border-slate-800 rounded-xl text-sm text-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                          value={propertySearch}
                          onChange={e => setPropertySearch(e.target.value)}
                        />
                        {propertySearchResults.length > 0 && (
                          <div className="absolute z-50 w-full mt-2 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl overflow-hidden py-1">
                            {propertySearchResults.map(p => (
                              <button
                                key={p.id}
                                type="button"
                                onClick={() => {
                                  setSelectedPropId(p.id);
                                  setPropertySearch("");
                                  setPropertySearchResults([]);
                                  
                                  // Automatically find earliest unpaid year
                                  const propDelinquencies = delinquencies.filter(d => d.propertyId === p.id);
                                  const unpaidYears = propDelinquencies
                                    .filter(d => d.status !== "Paid" && d.status !== "Voided")
                                    .map(d => d.year);
                                  
                                  let earliestYear = new Date().getFullYear() - 1;

                                  if (unpaidYears.length > 0) {
                                    earliestYear = Math.min(...unpaidYears);
                                  } else if (p.effectivityDate) {
                                    const effYear = new Date(p.effectivityDate).getFullYear();
                                    if (!isNaN(effYear) && effYear < new Date().getFullYear()) {
                                      earliestYear = effYear;
                                    }
                                  }

                                  setEntryRows([{ 
                                    id: Math.random().toString(36).substr(2, 9), 
                                    startYear: earliestYear, 
                                    endYear: new Date().getFullYear() - 1, 
                                    assessedValue: p.assessedValue 
                                  }]);
                                }}
                                className="w-full p-4 text-left hover:bg-indigo-500/10 transition-colors border-b border-slate-800 last:border-0"
                              >
                                <p className="text-xs font-bold text-white uppercase">{p.tdNumber}</p>
                                <p className="text-[10px] text-slate-500 truncate">{p.ownerName}</p>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  {selectedPropId && (
                    <div className="w-full md:w-64 p-4 bg-emerald-500/5 border border-emerald-500/20 rounded-xl">
                      <p className="text-[10px] font-bold text-emerald-500/70 uppercase tracking-widest mb-1">Declared Value</p>
                      <p className="text-xl font-black text-emerald-400">{formatCurrency(properties.find(p => p.id === selectedPropId)?.assessedValue || 0)}</p>
                    </div>
                  )}
                </div>

                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Delinquent Years & Assessments</h4>
                    <button 
                      onClick={addEntryRow}
                      className="flex items-center gap-2 px-3 py-1.5 text-[10px] font-bold text-indigo-400 hover:text-white bg-indigo-500/10 hover:bg-indigo-500 rounded-lg transition-all border border-indigo-500/20"
                    >
                      <Plus className="w-3 h-3" />
                      ADD NEW PERIOD
                    </button>
                  </div>

                  <div className="overflow-hidden border border-slate-800 rounded-2xl bg-slate-950/20">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="bg-slate-950/50 border-b border-slate-800">
                          <th className="px-6 py-4 font-bold text-slate-500 uppercase tracking-widest text-[9px]">Start Year</th>
                          <th className="px-6 py-4 font-bold text-slate-500 uppercase tracking-widest text-[9px]">End Year</th>
                          <th className="px-6 py-4 font-bold text-slate-500 uppercase tracking-widest text-[9px]">Assessed Value</th>
                          <th className="px-6 py-4 font-bold text-slate-500 uppercase tracking-widest text-[9px] text-center">Span</th>
                          <th className="px-6 py-4 font-bold text-slate-500 uppercase tracking-widest text-[9px]">Basic (1%)</th>
                          <th className="px-6 py-4 font-bold text-slate-500 uppercase tracking-widest text-[9px]">SEF (1%)</th>
                          <th className="px-6 py-4 font-bold text-slate-500 uppercase tracking-widest text-[9px]">Penalty</th>
                          <th className="px-6 py-4 font-bold text-indigo-400 uppercase tracking-widest text-[9px]">Total Due</th>
                          <th className="px-6 py-4"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/50">
                        {entryRows.map((row) => {
                          const stats = calculateRowStats(row);
                          return (
                            <tr key={row.id} className="hover:bg-white/[0.01] transition-colors">
                              <td className="px-6 py-4">
                                <input 
                                  type="number" 
                                  className="w-20 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-center focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                                  value={row.startYear}
                                  onChange={e => updateEntryRow(row.id, { startYear: parseInt(e.target.value) || new Date().getFullYear() })}
                                />
                              </td>
                              <td className="px-6 py-4">
                                <input 
                                  type="number" 
                                  className="w-20 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-center focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                                  value={row.endYear}
                                  onChange={e => updateEntryRow(row.id, { endYear: parseInt(e.target.value) || new Date().getFullYear() })}
                                />
                              </td>
                              <td className="px-6 py-4">
                                <div className="relative">
                                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600 font-bold">₱</span>
                                  <input 
                                    type="number" 
                                    className="w-32 bg-slate-950 border border-slate-800 rounded-xl pl-6 pr-3 py-2 focus:ring-2 focus:ring-indigo-500 outline-none font-bold text-emerald-400 transition-all"
                                    value={row.assessedValue || ""}
                                    onChange={e => updateEntryRow(row.id, { assessedValue: parseFloat(e.target.value) || 0 })}
                                  />
                                </div>
                              </td>
                              <td className="px-6 py-4 text-center">
                                <span className="bg-slate-800 text-slate-300 px-2 py-1 rounded text-[10px] font-black">{stats.span}Y</span>
                              </td>
                              <td className="px-6 py-4 text-slate-400 font-medium">{formatCurrency(stats.basicTax)}</td>
                              <td className="px-6 py-4 text-slate-400 font-medium">{formatCurrency(stats.sefTax)}</td>
                              <td className="px-6 py-4 text-red-500 font-bold">+{formatCurrency(stats.totalPenalty)}</td>
                              <td className="px-6 py-4 text-white font-black text-sm">{formatCurrency(stats.totalDue)}</td>
                              <td className="px-6 py-4 text-right">
                                {entryRows.length > 1 && (
                                  <button onClick={() => removeEntryRow(row.id)} className="p-2 text-slate-600 hover:text-red-400 hover:bg-red-500/10 rounded-xl transition-all">
                                    <X className="w-4 h-4" />
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              <div className="p-8 bg-slate-950/50 border-t border-slate-800 flex items-center justify-between">
                <div>
                  <p className="text-[10px] text-slate-500 font-bold uppercase tracking-[0.2em] mb-1">AGGREGATE COLLECTION TOTAL</p>
                  <p className="text-3xl font-black text-white tracking-tight">
                    {formatCurrency(entryRows.reduce((acc, r) => acc + calculateRowStats(r).totalDue, 0))}
                  </p>
                </div>
                <div className="flex gap-4">
                  <button 
                    onClick={() => {
                      setIsAdding(false);
                      setSelectedPropId("");
                      setPropertySearch("");
                    }}
                    className="px-8 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400 hover:bg-slate-800 rounded-2xl transition-all"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={preSubmitCheck}
                    disabled={!selectedPropId || entryRows.some(r => r.assessedValue <= 0)}
                    className="px-12 py-3 text-[10px] font-black uppercase tracking-widest bg-red-600 text-white rounded-2xl hover:bg-red-500 transition-all shadow-xl shadow-red-600/30 disabled:opacity-50 disabled:grayscale"
                  >
                    Issue Delinquency
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl">
        <div className="p-4 border-b border-slate-800 bg-slate-900/50 flex flex-col md:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input 
              type="text" 
              placeholder="Filter ledger by Owner, Tax Dec No, or Year..." 
              className="w-full pl-10 pr-4 py-2 border border-slate-800 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-slate-950 text-slate-300 text-sm transition-all"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-4">
            <div className="relative">
              <Filter className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <select
                title="Filter by Status"
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value)}
                className="pl-10 pr-8 py-2 border border-slate-800 bg-slate-950 rounded-xl text-slate-300 text-sm appearance-none focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
              >
                <option value="All" className="bg-slate-950 text-slate-300">All Statuses</option>
                <option value="Delinquent" className="bg-slate-950 text-slate-300">Delinquent</option>
                <option value="Pending" className="bg-slate-950 text-slate-300">Pending</option>
                <option value="Paid" className="bg-slate-950 text-slate-300">Paid</option>
                <option value="Voided" className="bg-slate-950 text-slate-300">Voided</option>
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-slate-500">
                <svg className="h-4 w-4 fill-current" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
                  <path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" />
                </svg>
              </div>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-950/50">
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Entity Signature</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest text-center">Year</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Principal Basis</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Interest Accrued</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Aggregate Due</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {groupedDelinquencies.map(group => {
                const delinquentRecords = group.delinquencies.filter(d => 
                  d.status === "Delinquent" && 
                  !payments.some(p => p.propertyId === group.property.id && p.taxYear === d.year && p.status === "Active")
                );
                const minDelinqYear = delinquentRecords.length > 0 ? Math.min(...delinquentRecords.map(d => d.year)) : group.minYear;
                const outstandingPeriods = delinquentRecords.length > 0 ? (new Date().getFullYear() - minDelinqYear) : 0;
                const showNotice = delinquentRecords.length >= 2 || (delinquentRecords.length > 0 && outstandingPeriods >= 2);

                return (
                  <React.Fragment key={group.property.id}>
                    <tr 
                      className={cn(
                        "hover:bg-indigo-500/[0.02] transition-colors cursor-pointer group/row",
                        expandedPropId === group.property.id ? "bg-indigo-500/[0.04]" : ""
                      )}
                      onClick={() => setExpandedPropId(expandedPropId === group.property.id ? null : group.property.id)}
                    >
                      <td className="px-6 py-5">
                        <div className="flex items-center gap-3">
                          <div className={cn(
                            "p-1.5 rounded-lg transition-colors border",
                            expandedPropId === group.property.id ? "bg-indigo-500/20 border-indigo-500/30 text-indigo-400" : "bg-slate-800 border-slate-700 text-slate-500 group-hover/row:border-slate-600"
                          )}>
                            {expandedPropId === group.property.id ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                          </div>
                          <div className="flex flex-col">
                            <span className="font-bold text-slate-200 text-sm tracking-tight">{group.property.ownerName}</span>
                            <span className="text-[10px] font-mono text-slate-500 font-bold uppercase tracking-widest">{group.property.tdNumber}</span>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-5 text-xs text-slate-400 text-center font-bold tracking-widest leading-relaxed">
                        {group.minYear === group.maxYear ? group.minYear : `${group.minYear} – ${group.maxYear}`}
                        <div className="text-[10px] text-indigo-500 mt-0.5">{group.delinquencies.length} record(s)</div>
                      </td>
                      <td className="px-6 py-5 text-sm text-slate-400 font-medium">
                        {formatCurrency(group.totalPrincipal)}
                      </td>
                      <td className="px-6 py-5 text-sm text-red-400 font-bold">
                        +{formatCurrency(group.totalInterest)}
                      </td>
                      <td className="px-6 py-5 text-sm text-white font-black">
                        {formatCurrency(group.totalDue)}
                      </td>
                      <td className="px-6 py-5">
                        <div className="flex items-center gap-2">
                          <span className={cn(
                            "inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-[10px] font-bold uppercase tracking-widest border bg-red-500/10 text-red-400 border-red-500/20 shadow-sm shadow-red-500/10"
                          )}>
                            <AlertCircle className="w-3 h-3" />
                            Account Delinquent
                          </span>
                          {showNotice && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedPrintNotice(group);
                              }}
                              title="Generate Notice of Delinquency (> 2 Years Delinquent)"
                              className="p-1.5 bg-red-600/10 hover:bg-red-600 border border-red-500/20 hover:border-red-500 rounded-lg text-red-400 hover:text-white transition-all cursor-pointer shadow-sm active:scale-95 flex items-center justify-center shrink-0"
                            >
                              <Printer className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>

                  {/* Expanded content */}
                  {expandedPropId === group.property.id && (
                    <tr className="bg-slate-950/40">
                      <td colSpan={7} className="px-10 py-6">
                        <motion.div 
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          className="overflow-hidden border border-slate-800 rounded-2xl bg-slate-900/40"
                        >
                          <table className="w-full text-left">
                            <thead className="bg-slate-950 border-b border-slate-800">
                              <tr>
                                <th className="px-6 py-3 text-[9px] font-bold text-slate-500 uppercase tracking-widest">Assessment Year</th>
                                <th className="px-6 py-3 text-[9px] font-bold text-slate-500 uppercase tracking-widest">Principal Basis</th>
                                <th className="px-6 py-3 text-[9px] font-bold text-slate-500 uppercase tracking-widest">Penalty</th>
                                <th className="px-6 py-3 text-[9px] font-bold text-slate-500 uppercase tracking-widest text-indigo-400">Total Due</th>
                                <th className="px-6 py-3 text-[9px] font-bold text-slate-500 uppercase tracking-widest">Status</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800/50">
                              {(() => {
                                const bundled = groupDelinquenciesByPenaltyRule(group.delinquencies, group.property.assessedValue);
                                return bundled.map(row => {
                                  // For actions, we still need a reference delinquency if it's a single year
                                  const baseDelinq = row.years.length === 1 ? group.delinquencies.find(d => d.year === row.years[0]) : null;

                                  const itemStatus = row.records.some(r => r.status === "Delinquent" && !payments.some(p => p.propertyId === group.property.id && p.taxYear === r.year && p.status === "Active")) ? "Delinquent" : 
                                                    (row.records.some(r => r.status === "Pending") ? "Pending" : "Paid");

                                  return (
                                    <tr key={`${row.ids.join(',')}-${row.quarterLabel || 'full'}`} className="hover:bg-white/[0.02]">
                                      <td className="px-6 py-3 text-xs font-mono font-bold text-slate-400 italic">FY {row.yearDisplay}</td>
                                      <td className="px-6 py-3 text-xs text-slate-500">{formatCurrency(row.totalBasic + row.totalSef)}</td>
                                      <td className="px-6 py-3 text-xs text-red-500/70">+{formatCurrency(row.totalInterest)}</td>
                                      <td className="px-6 py-3 text-xs text-white font-bold">{formatCurrency(row.totalDue)}</td>
                                      <td className="px-6 py-3">
                                        <span className={cn(
                                          "px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-widest border",
                                          itemStatus === "Delinquent" ? "bg-red-500/5 text-red-500 border-red-500/10" :
                                          itemStatus === "Pending" ? "bg-amber-500/5 text-amber-500 border-amber-500/10" :
                                          "bg-emerald-500/5 text-emerald-400 border-emerald-500/10"
                                        )}>
                                          {row.years.length > 1 ? `${itemStatus} (Grouped)` : itemStatus}
                                        </span>
                                      </td>
                                    </tr>
                                  );
                                });
                              })()}
                            </tbody>
                          </table>
                          {showNotice && (
                            <div className="p-4 bg-red-950/20 border-t border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                              <div className="flex items-center gap-3">
                                <div className="w-9 h-9 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center shrink-0">
                                  <FileText className="w-4 h-4 text-red-400" />
                                </div>
                                <div className="space-y-0.5">
                                  <h5 className="text-[10px] font-black text-rose-300 uppercase tracking-widest">Notice of Delinquency Standard</h5>
                                  <p className="text-[10px] text-slate-400 font-medium">Eligible for statutory demand notice. Outstanding real property liabilities span {outstandingPeriods} consecutive periods.</p>
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedPrintNotice(group);
                                }}
                                className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-xl text-[9px] font-black uppercase tracking-widest transition-all border border-red-500 flex items-center gap-1.5 cursor-pointer shadow-lg shadow-red-900/20 active:scale-95"
                              >
                                <Printer className="w-3.5 h-3.5" />
                                Print Demand Notice
                              </button>
                            </div>
                          )}
                        </motion.div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
                );
              })}
              
              {groupedDelinquencies.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-6 py-20 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-12 h-12 bg-slate-950 rounded-2xl flex items-center justify-center border border-slate-800">
                        <Search className="w-6 h-6 text-slate-700" />
                      </div>
                      <p className="text-slate-500 text-sm italic font-medium tracking-tight">No entities found matching the current filtration protocol.</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      {activeDelinquency && (
        <DelinquencyActions 
          delinquency={activeDelinquency}
          property={properties.find(p => p.id === activeDelinquency.propertyId)!}
          onClose={() => setActiveDelinquency(null)}
          isEncoder={isEncoder}
          isAdmin={isAdmin}
        />
      )}
      {selectedPrintNotice && (
        <NoticeOfDelinquencyPrintView
          property={selectedPrintNotice.property}
          delinquencies={selectedPrintNotice.delinquencies}
          onClose={() => setSelectedPrintNotice(null)}
        />
      )}
    </div>
  );
};

export default DelinquencyList;
