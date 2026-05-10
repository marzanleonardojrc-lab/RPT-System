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
  OperationType,
  auth
} from "../lib/firebase";
import { Delinquency, Property, DelinquencyStatus, PaymentDetails } from "../types";
import { calculateTotalDue, BASIC_TAX_RATE, SEF_TAX_RATE, IDLE_LAND_RATE } from "../lib/taxCalculations";
import { cn, formatCurrency } from "../lib/utils";
import { Plus, Search, Filter, CreditCard, AlertCircle, CheckCircle2, Receipt, X, Clock, XCircle, Info } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { logAudit } from "../lib/audit";
import ConfirmDialog from "./ConfirmDialog";

const DelinquencyList: React.FC<{ isEncoder: boolean, isAdmin: boolean }> = ({ isEncoder, isAdmin }) => {
  const [delinquencies, setDelinquencies] = useState<Delinquency[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [isAdding, setIsAdding] = useState(false);
  const [selectedPropId, setSelectedPropId] = useState("");
  const [propertySearch, setPropertySearch] = useState("");
  const [propertySearchResults, setPropertySearchResults] = useState<Property[]>([]);
  const [focusedSearchIndex, setFocusedSearchIndex] = useState(-1);
  const [year, setYear] = useState(new Date().getFullYear() - 1);
  const [basicTax, setBasicTax] = useState(0);
  const [sefTax, setSefTax] = useState(0);
  const [idleTax, setIdleTax] = useState(0);

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
      p.pin.toLowerCase().includes(propertySearch.toLowerCase()) ||
      p.ownerName.toLowerCase().includes(propertySearch.toLowerCase())
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

    return () => { unsubDelinq(); unsubProp(); };
  }, []);

  useEffect(() => {
    if (selectedPropId) {
      const prop = properties.find(p => p.id === selectedPropId);
      if (prop) {
        // Automatically set rates based on R.A. 7160
        const calculatedBasic = prop.assessedValue * BASIC_TAX_RATE;
        const calculatedSef = prop.assessedValue * SEF_TAX_RATE;
        const calculatedIdle = prop.isIdle ? (prop.assessedValue * IDLE_LAND_RATE) : 0;
        
        setBasicTax(calculatedBasic);
        setSefTax(calculatedSef);
        setIdleTax(calculatedIdle);
      }
    } else {
      setBasicTax(0);
      setSefTax(0);
      setIdleTax(0);
    }
  }, [selectedPropId, properties]);

  const handleCreate = async () => {
    const calc = calculateTotalDue(basicTax, sefTax, year, new Date(), idleTax);

    try {
      // Check for existing "Delinquent" record for same property
      const existing = delinquencies.find(d => 
        d.propertyId === selectedPropId && 
        (d.status === "Delinquent" || d.status === "Pending")
      );

      const status: DelinquencyStatus = "Delinquent";

      if (existing) {
        // Update existing record
        const ref = doc(db, "delinquencies", existing.id);
        const updateData = {
          year,
          basicTaxDue: basicTax,
          sefTaxDue: sefTax,
          idleSurcharge: idleTax,
          penalty: calc.interest,
          interest: calc.interest,
          totalDue: calc.totalDue,
          status: status,
          updatedAt: serverTimestamp()
        };
        await updateDoc(ref, updateData);
        await logAudit("UPDATE", "Delinquency", existing.id, existing, updateData);
      } else {
        // Create new record
        const docRef = await addDoc(collection(db, "delinquencies"), {
          propertyId: selectedPropId,
          year,
          basicTaxDue: basicTax,
          sefTaxDue: sefTax,
          idleSurcharge: idleTax,
          penalty: calc.interest,
          interest: calc.interest,
          totalDue: calc.totalDue,
          status: status,
          createdBy: auth.currentUser?.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
        await logAudit("CREATE", "Delinquency", docRef.id, null, { propertyId: selectedPropId, year, totalDue: calc.totalDue });
      }
      
      setIsAdding(false);
      setSelectedPropId("");
      setPropertySearch("");
      setPropertySearchResults([]);
      setBasicTax(0);
      setSefTax(0);
      setIdleTax(0);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, "delinquencies");
    }
  };

  const preSubmitCheck = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPropId || !year || !basicTax) return;

    const prop = properties.find(p => p.id === selectedPropId);
    const existing = delinquencies.find(d => 
      d.propertyId === selectedPropId && 
      (d.status === "Delinquent" || d.status === "Pending")
    );

    setConfirmDialog({
      isOpen: true,
      title: existing ? "Modify Existing Record?" : "Issue New Delinquency?",
      message: existing 
        ? `A record already exists for ${prop?.ownerName}. \n\nThe previous amount will be DISCARDED and replaced with this new computation for FY${year}. This will be posted immediately. Do you wish to continue?`
        : `You are about to issue a formal delinquency record for ${prop?.ownerName} for taxable year ${year}. \n\nThis will be posted immediately.`,
      type: existing ? "danger" : "warning",
      onConfirm: handleCreate
    });
  };

  const filtered = delinquencies.filter(d => {
    const prop = properties.find(p => p.id === d.propertyId);
    if (!prop || prop.isArchived) return false;
    const searchStr = `${prop.ownerName} ${prop.pin} ${d.year}`.toLowerCase();
    const searchMatch = searchStr.includes(searchTerm.toLowerCase());
    
    const isEffectivelyPaid = d.status === "Paid" && d.paymentDetails?.orNumber;
    const statusToDisplay = (d.status === "Paid" && !isEffectivelyPaid) ? "Delinquent" : d.status;

    if (statusFilter !== "All" && statusToDisplay !== statusFilter) {
      return false;
    }
    
    return searchMatch;
  });

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

      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl">
        <div className="p-4 border-b border-slate-800 bg-slate-900/50 flex flex-col md:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input 
              type="text" 
              placeholder="Filter ledger by Owner, PIN, or Year..." 
              className="w-full pl-10 pr-4 py-2 border border-slate-800 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-slate-950 text-slate-300 text-sm transition-all"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>
          <div className="relative">
            <Filter className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <select
              title="Filter by Status"
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="pl-10 pr-8 py-2 border border-slate-800 bg-slate-950 rounded-xl text-slate-300 text-sm appearance-none focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
            >
              <option value="All">All Statuses</option>
              <option value="Delinquent">Delinquent</option>
              <option value="Pending">Pending</option>
              <option value="Paid">Paid</option>
              <option value="Voided">Voided</option>
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-slate-500">
              <svg className="h-4 w-4 fill-current" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
                <path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" />
              </svg>
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
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest text-right">Ops</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              <AnimatePresence>
                {isAdding && (
                  <motion.tr 
                    initial={{ opacity: 0, y: -20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="bg-red-500/5"
                  >
                    <td colSpan={7} className="p-6">
                      <form onSubmit={preSubmitCheck} className="space-y-4 max-w-4xl mx-auto bg-slate-900 p-6 rounded-2xl border border-red-500/20 shadow-2xl">
                        <h3 className="font-bold text-red-400 flex items-center gap-2 uppercase tracking-widest text-xs">
                          <AlertCircle className="w-4 h-4" />
                          Initialize Delinquency Entry
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
                          <div className="col-span-1 md:col-span-2 relative">
                            {selectedPropId ? (
                              <div className="flex items-center justify-between p-2 bg-indigo-500/10 border border-indigo-500/20 rounded-lg">
                                <div className="truncate">
                                  <p className="text-[10px] font-bold text-indigo-400">
                                    {properties.find(p => p.id === selectedPropId)?.pin}
                                  </p>
                                  <p className="text-xs text-white truncate max-w-[200px]">
                                    {properties.find(p => p.id === selectedPropId)?.ownerName}
                                  </p>
                                </div>
                                <button 
                                  type="button" 
                                  onClick={() => {
                                    setSelectedPropId("");
                                    setPropertySearch("");
                                  }}
                                  className="p-1 hover:bg-red-500/10 rounded text-red-500 transition"
                                >
                                  <X className="w-4 h-4" />
                                </button>
                              </div>
                            ) : (
                              <>
                                <div className="relative">
                                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                                  <input 
                                    type="text"
                                    placeholder="Search Tax Dec..."
                                    className="w-full pl-10 pr-4 py-2 border border-slate-700 bg-slate-950 rounded-lg text-xs text-slate-200 focus:ring-1 focus:ring-indigo-500 outline-none transition-all"
                                    value={propertySearch}
                                    onChange={e => {
                                      setPropertySearch(e.target.value);
                                      setFocusedSearchIndex(-1);
                                    }}
                                    onKeyDown={e => {
                                      if (propertySearchResults.length === 0) return;
                                      
                                      if (e.key === "ArrowDown") {
                                        e.preventDefault();
                                        setFocusedSearchIndex(prev => 
                                          prev < propertySearchResults.length - 1 ? prev + 1 : prev
                                        );
                                      } else if (e.key === "ArrowUp") {
                                        e.preventDefault();
                                        setFocusedSearchIndex(prev => prev > 0 ? prev - 1 : 0);
                                      } else if (e.key === "Enter") {
                                        e.preventDefault();
                                        const selectedIndex = focusedSearchIndex >= 0 ? focusedSearchIndex : 0;
                                        setSelectedPropId(propertySearchResults[selectedIndex].id);
                                        setPropertySearch("");
                                        setPropertySearchResults([]);
                                        setFocusedSearchIndex(-1);
                                      }
                                    }}
                                  />
                                </div>
                                <AnimatePresence>
                                  {propertySearchResults.length > 0 && (
                                    <motion.div 
                                      initial={{ opacity: 0, y: -10 }}
                                      animate={{ opacity: 1, y: 0 }}
                                      className="absolute z-50 w-full mt-1 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl overflow-hidden"
                                    >
                                      {propertySearchResults.map((p, idx) => (
                                        <button
                                          key={p.id}
                                          type="button"
                                          onClick={() => {
                                            setSelectedPropId(p.id);
                                            setPropertySearch("");
                                            setPropertySearchResults([]);
                                            setFocusedSearchIndex(-1);
                                          }}
                                          className={cn(
                                            "w-full p-3 text-left border-b border-slate-800 last:border-0 transition-colors",
                                            focusedSearchIndex === idx ? "bg-indigo-500/20" : "hover:bg-indigo-500/10"
                                          )}
                                        >
                                          <div className="flex items-center justify-between">
                                            <p className="text-xs font-bold text-white uppercase">{p.pin}</p>
                                            {p.isIdle && <span className="text-[8px] bg-amber-500/10 text-amber-500 px-1 rounded uppercase font-bold">Idle</span>}
                                          </div>
                                          <p className="text-[10px] text-slate-500 truncate">{p.ownerName}</p>
                                        </button>
                                      ))}
                                    </motion.div>
                                  )}
                                </AnimatePresence>
                              </>
                            )}
                          </div>
                          <select 
                            className="px-3 py-2 border border-slate-700 bg-slate-950 rounded-lg text-xs text-slate-200 focus:ring-1 focus:ring-indigo-500 outline-none"
                            value={year}
                            onChange={e => setYear(parseInt(e.target.value))}
                            required
                          >
                            {Array.from({ length: 30 }, (_, i) => new Date().getFullYear() - 1 - i).map(y => (
                              <option key={y} value={y}>{y}</option>
                            ))}
                          </select>
                          <input 
                            type="number" 
                            placeholder="Basic Tax" 
                            className="px-3 py-2 border border-slate-700 bg-slate-950 rounded-lg text-xs text-slate-200 focus:ring-1 focus:ring-indigo-500 outline-none"
                            value={Number.isNaN(basicTax) ? "" : basicTax}
                            onChange={e => setBasicTax(parseFloat(e.target.value) || 0)}
                            required
                          />
                          <input 
                            type="number" 
                            placeholder="SEF Tax" 
                            className="px-3 py-2 border border-slate-700 bg-slate-950 rounded-lg text-xs text-slate-200 focus:ring-1 focus:ring-indigo-500 outline-none"
                            value={Number.isNaN(sefTax) ? "" : sefTax}
                            onChange={e => setSefTax(parseFloat(e.target.value) || 0)}
                          />
                          <input 
                            type="number" 
                            placeholder="Idle Land Surcharge" 
                            className="px-3 py-2 border border-slate-700 bg-slate-950 rounded-lg text-xs text-slate-200 focus:ring-1 focus:ring-indigo-500 outline-none"
                            value={Number.isNaN(idleTax) ? "" : idleTax}
                            onChange={e => setIdleTax(parseFloat(e.target.value) || 0)}
                          />
                        </div>
                        <div className="flex justify-end gap-2 pt-2">
                          <button 
                            type="button" 
                            onClick={() => {
                              setIsAdding(false);
                              setSelectedPropId("");
                              setPropertySearch("");
                              setPropertySearchResults([]);
                            }}
                            className="px-4 py-2 text-xs font-bold uppercase tracking-widest text-slate-500 hover:bg-slate-800 rounded-xl transition"
                          >
                            Abort
                          </button>
                          <button 
                            type="submit"
                            className="px-6 py-2 text-xs font-bold uppercase tracking-widest bg-red-600 text-white rounded-xl hover:bg-red-500 transition shadow-lg shadow-red-600/20"
                          >
                            Commit Record
                          </button>
                        </div>
                      </form>
                    </td>
                  </motion.tr>
                )}
              </AnimatePresence>

              {filtered.map(d => {
                const prop = properties.find(p => p.id === d.propertyId);
                const currentCalc = calculateTotalDue(d.basicTaxDue, d.sefTaxDue, d.year, new Date(), (d as any).idleSurcharge || 0);
                return (
                  <tr key={d.id} className="hover:bg-indigo-500/[0.02] transition-colors group">
                    <td className="px-6 py-4">
                      <div className="flex flex-col">
                        <span className="font-bold text-slate-200 text-sm tracking-tight">{prop?.ownerName || "Unknown Profile"}</span>
                        <span className="text-[10px] font-mono text-slate-500 font-bold">{prop?.pin}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-xs text-slate-400 text-center font-bold tracking-widest">{d.year}</td>
                    <td className="px-6 py-4 text-sm text-slate-400 font-medium">
                      {formatCurrency(d.basicTaxDue + d.sefTaxDue + ((d as any).idleSurcharge || 0))}
                    </td>
                    <td className="px-6 py-4 text-sm text-red-400 font-bold">
                      +{formatCurrency(currentCalc.interest)}
                    </td>
                    <td className="px-6 py-4 text-sm text-white font-black">
                      <div className="flex items-center gap-2 relative group/tooltip w-max">
                        {formatCurrency(currentCalc.totalDue)}
                        <Info className="w-4 h-4 text-slate-500 hover:text-slate-300 transition-colors cursor-help" />
                        
                        <div className="absolute left-full ml-2 top-1/2 -translate-y-1/2 w-56 bg-slate-900 border border-slate-700 p-3 rounded-xl shadow-2xl opacity-0 group-hover/tooltip:opacity-100 pointer-events-none transition-all z-50">
                          <div className="text-[10px] uppercase font-bold text-slate-500 tracking-widest mb-3 border-b border-slate-800 pb-2">Amount Breakdown</div>
                          <div className="flex justify-between text-xs mb-1.5">
                            <span className="text-slate-400">Basic Tax:</span>
                            <span className="text-white font-medium">{formatCurrency(d.basicTaxDue)}</span>
                          </div>
                          <div className="flex justify-between text-xs mb-1.5">
                            <span className="text-slate-400">SEF Tax:</span>
                            <span className="text-white font-medium">{formatCurrency(d.sefTaxDue)}</span>
                          </div>
                          {((d as any).idleSurcharge > 0) && (
                            <div className="flex justify-between text-xs mb-1.5">
                              <span className="text-slate-400">Idle Surcharge:</span>
                              <span className="text-white font-medium">{formatCurrency((d as any).idleSurcharge)}</span>
                            </div>
                          )}
                          <div className="flex justify-between text-xs mb-3">
                            <span className="text-slate-400">Penalties:</span>
                            <span className="text-red-400 font-medium">{formatCurrency(currentCalc.interest)}</span>
                          </div>
                          <div className="pt-2 border-t border-slate-700 flex justify-between text-xs font-bold">
                            <span className="text-slate-300 uppercase tracking-widest">Aggregate:</span>
                            <span className="text-white">{formatCurrency(currentCalc.totalDue)}</span>
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      {(() => {
                        const isEffectivelyPaid = d.status === "Paid" && d.paymentDetails?.orNumber;
                        const statusToDisplay = (d.status === "Paid" && !isEffectivelyPaid) ? "Delinquent" : d.status;
                        
                        return (
                          <span className={cn(
                            "inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-[10px] font-bold uppercase tracking-widest border",
                            statusToDisplay === "Delinquent" ? "bg-red-500/10 text-red-400 border-red-500/20" :
                            statusToDisplay === "Pending" ? "bg-amber-500/10 text-amber-500 border-amber-500/20" :
                            statusToDisplay === "Paid" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" :
                            statusToDisplay === "Voided" ? "bg-slate-800 text-slate-400 border-slate-700" :
                            "bg-slate-800 text-slate-500 border-slate-700"
                          )}>
                            {statusToDisplay === "Delinquent" ? <AlertCircle className="w-3 h-3" /> : 
                             statusToDisplay === "Pending" ? <Clock className="w-3 h-3" /> : 
                             statusToDisplay === "Paid" ? <CheckCircle2 className="w-3 h-3" /> :
                             statusToDisplay === "Voided" ? <XCircle className="w-3 h-3" /> :
                             <CheckCircle2 className="w-3 h-3" />}
                            {statusToDisplay}
                          </span>
                        );
                      })()}
                    </td>
                    <td className="px-6 py-4 text-right">
                      {d.status === "Paid" && d.paymentDetails && (
                        <div className="flex flex-col items-end text-[9px] font-mono text-emerald-500/60 group-hover:text-emerald-500 transition-colors">
                          <div className="flex items-center gap-1">
                            <Receipt className="w-3 h-3" />
                            <span>OR: {d.paymentDetails.orNumber}</span>
                          </div>
                          <span>{d.paymentDetails.paymentDate}</span>
                        </div>
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
  );
};

export default DelinquencyList;
