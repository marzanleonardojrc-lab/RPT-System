import React, { useState, useEffect } from "react";
import { 
  collection, 
  onSnapshot, 
  addDoc, 
  updateDoc,
  doc,
  query,
  where,
  serverTimestamp,
  getDocs,
  orderBy,
  limit
} from "firebase/firestore";
import { db, auth, OperationType, handleFirestoreError } from "../lib/firebase";
import { useAuth } from "../AuthContext";
import { Delinquency, Property, Payment } from "../types";
import { calculateTotalDue, calculatePenalties, groupDelinquenciesByPenaltyRule, BASIC_TAX_RATE, SEF_TAX_RATE } from "../lib/taxCalculations";
import { cn, formatCurrency } from "../lib/utils";
import ConfirmDialog from "./ConfirmDialog";
import { 
  Plus, 
  Search, 
  Filter, 
  AlertCircle, 
  CheckCircle2, 
  X, 
  Receipt,
  ArrowUpRight,
  TrendingUp,
  FileText,
  DollarSign,
  History,
  Trash2
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { logAudit } from "../lib/audit";
import DelinquencyActions from "./DelinquencyActions";

export default function CollectionModule() {
  const { profile } = useAuth();
  const [delinquencies, setDelinquencies] = useState<Delinquency[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [isPosting, setIsPosting] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  
  // Modal Form State
  const [selectedProperty, setSelectedProperty] = useState<Property | null>(null);
  const [propSearch, setPropSearch] = useState("");
  const [propSearchResults, setPropSearchResults] = useState<Property[]>([]);
  const [formDelinquencies, setFormDelinquencies] = useState<Delinquency[]>([]);
  const [allPropertyYears, setAllPropertyYears] = useState<number[]>([]);
  const [selectedDelinqIds, setSelectedDelinqIds] = useState<Set<string>>(new Set());
  
  // Payment fields
  const [orNumber, setOrNumber] = useState("");
  const [orDate, setOrDate] = useState(new Date().toISOString().split('T')[0]);
  const [taxPayer, setTaxPayer] = useState("");
  const [treasurer, setTreasurer] = useState("NOVIE DT. GUZMAN");
  const [paymentMode, setPaymentMode] = useState<"Full" | "Installment">("Full");
  const [quarters, setQuarters] = useState<string[]>([]);
  const [deputy, setDeputy] = useState("");
  const [isAssessing, setIsAssessing] = useState(false);
  const [isAdvance, setIsAdvance] = useState(false);
  
  // Error Dialog State
  const [errorDialog, setErrorDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    type: "danger" | "success" | "warning";
  }>({
    isOpen: false,
    title: "",
    message: "",
    type: "danger"
  });

  useEffect(() => {
    if (paymentMode === "Full") {
      const nextIds = new Set(formDelinquencies.map(d => d.id));
      if (isAdvance) {
        const nextYear = new Date().getFullYear() + 1;
        nextIds.add(`advance-${nextYear}`);
      }
      setSelectedDelinqIds(nextIds);
    }
  }, [paymentMode, formDelinquencies, isAdvance]);

  const [cashTendered, setCashTendered] = useState(0);
  const [isCash, setIsCash] = useState(true);
  const [isCheck, setIsCheck] = useState(false);
  const [checkAmount, setCheckAmount] = useState(0);
  const [checkNumber, setCheckNumber] = useState("");
  const [checkPayee, setCheckPayee] = useState("");
  const [checkDate, setCheckDate] = useState(new Date().toISOString().split('T')[0]);

  useEffect(() => {
    // Load all properties
    const unsubProp = onSnapshot(collection(db, "properties"), (snapshot) => {
      setProperties(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Property)));
    });

    // Load only PAID delinquencies for the ledger view
    const q = query(collection(db, "delinquencies"), where("status", "==", "Paid"));
    const unsubDelinq = onSnapshot(q, (snapshot) => {
      setDelinquencies(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Delinquency)));
    });

    return () => { unsubProp(); unsubDelinq(); };
  }, []);

  // Modal search logic
  useEffect(() => {
    if (propSearch.length > 1 && propSearch !== selectedProperty?.tdNumber) {
      const results = properties.filter(p => 
        p.tdNumber.toLowerCase().includes(propSearch.toLowerCase()) ||
        p.ownerName.toLowerCase().includes(propSearch.toLowerCase())
      ).slice(0, 5);
      setPropSearchResults(results);
    } else {
      setPropSearchResults([]);
    }
  }, [propSearch, properties, selectedProperty]);

  const handleSelectProperty = async (prop: Property) => {
    setSelectedProperty(prop);
    setPropSearch(prop.tdNumber);
    setPropSearchResults([]);
    setTaxPayer(prop.ownerName);
    
    // Fetch all delinquencies for this property to check status accurately
    const q = query(
      collection(db, "delinquencies"), 
      where("propertyId", "==", prop.id)
    );
    const snap = await getDocs(q);
    const allRecords = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Delinquency));
    
    // We only display unpaid ones in the collection form
    let list = allRecords.filter(d => d.status === "Delinquent" || d.status === "Pending");
    
    const currentYear = new Date().getFullYear();
    const hasCurrentYear = allRecords.some(d => d.year === currentYear);

    // AUTOMATION: If no existing delinquent/assessment for current year, automatically issue it
    if (!hasCurrentYear) {
      try {
        setIsAssessing(true);
        const basicTax = prop.assessedValue * BASIC_TAX_RATE;
        const sefTax = prop.assessedValue * SEF_TAX_RATE;
        const calc = calculateTotalDue(basicTax, sefTax, currentYear);

        const newDelinq = {
          propertyId: prop.id,
          year: currentYear,
          basicTaxDue: basicTax,
          sefTaxDue: sefTax,
          penalty: 0,
          interest: calc.interest,
          totalDue: calc.totalDue,
          totalPaid: 0,
          status: "Delinquent" as const,
          recordedBy: profile?.username || profile?.displayName || auth.currentUser?.email || "System",
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        };

        const docRef = await addDoc(collection(db, "delinquencies"), newDelinq);
        
        const added = { 
          id: docRef.id, 
          ...newDelinq, 
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        } as unknown as Delinquency;
        
        list.push(added);
        await logAudit("CREATE", "Delinquency (Auto Assess)", `Year ${currentYear} for ${prop.tdNumber}`, null, newDelinq);
      } catch (err: any) {
        console.error("Auto Assess Error:", err);
      } finally {
        setIsAssessing(false);
      }
    }

    setAllPropertyYears(allRecords.map(r => r.year));
    setFormDelinquencies(list.sort((a, b) => a.year - b.year));
    setSelectedDelinqIds(new Set(list.map(d => d.id)));
  };

  const handleQuarterToggle = (q: string, checked: boolean) => {
    const allQuarters = ["1st Qtr", "2nd Qtr", "3rd Qtr", "4th Qtr"];
    const index = allQuarters.indexOf(q);
    
    if (checked) {
      // Select all up to this index
      const toAdd = allQuarters.slice(0, index + 1);
      setQuarters(prev => {
        const next = new Set(prev);
        toAdd.forEach(item => next.add(item));
        return Array.from(next);
      });
    } else {
      // Unselect all from this index onwards
      const toRemove = allQuarters.slice(index);
      setQuarters(prev => prev.filter(x => !toRemove.includes(x)));
    }
  };

  const displayRows = React.useMemo(() => {
    if (!selectedProperty) return [];
    const calcDate = orDate ? new Date(orDate) : new Date();
    return groupDelinquenciesByPenaltyRule(formDelinquencies, selectedProperty.assessedValue, calcDate, paymentMode, quarters, isAdvance, allPropertyYears);
  }, [formDelinquencies, selectedProperty, orDate, paymentMode, quarters, isAdvance, allPropertyYears]);

  const calculateFormTotals = () => {
    let assessed = 0;
    let basic = 0;
    let sef = 0;
    let penalty = 0;
    let discount = 0;
    let total = 0;
    let balanceAmount = 0;

    const calcDate = orDate ? new Date(orDate) : new Date();
    const currentYear = new Date().getFullYear();

    displayRows.filter(row => row.ids.every(id => selectedDelinqIds.has(id))).forEach(row => {
      assessed += row.assessedValue;
      basic += row.totalBasic;
      sef += row.totalSef;
      penalty += row.totalInterest;
      discount += row.totalDiscount;
      total += row.totalDue;
      balanceAmount += row.balanceAmount || 0;
    });

    return { assessed, basic, sef, penalty, discount, total, balanceAmount };
  };

  const formTotals = calculateFormTotals();
  const balance = cashTendered - formTotals.total;

  const handlePostPayment = async () => {
    const errors: string[] = [];
    
    if (!selectedProperty) {
      errors.push("• No property selected. Please search and select a tax declaration.");
    }
    if (selectedDelinqIds.size === 0) {
      errors.push("• No tax records selected for payment. Check at least one record.");
    }
    if (!orNumber.trim()) {
      errors.push("• O.R. Number is required.");
    }
    if (!orDate) {
      errors.push("• O.R. Date is required.");
    }
    if (!taxPayer.trim()) {
      errors.push("• Tax Payer name is required.");
    }
    if (!treasurer.trim()) {
      errors.push("• Treasurer name is required.");
    }
    if (!deputy.trim()) {
      errors.push("• Deputy name is required.");
    }
    if (paymentMode === "Installment" && quarters.length === 0) {
      errors.push("• At least one quarter must be selected for installment payments.");
    }
    if (cashTendered <= 0) {
      errors.push("• Cash Tendered is required.");
    } else if (cashTendered < (formTotals.total - 0.01)) {
      errors.push(`• Insufficient funds: Tendered ₱${cashTendered.toLocaleString()} vs required ₱${formTotals.total.toLocaleString()}.`);
    }

    if (errors.length > 0) {
      setErrorDialog({
        isOpen: true,
        title: "Missing or Invalid Fields",
        message: "Please correct the following issues before proceeding:\n\n" + errors.join("\n"),
        type: "danger"
      });
      return;
    }

    setIsSubmitting(true);
    try {
      // VALIDATION LAYER 1: UNIQUE O.R. CHECK
      const orQuery = query(
        collection(db, "payments"),
        where("orNumber", "==", orNumber.trim()),
        where("status", "==", "Active"),
        limit(1)
      );
      const orSnap = await getDocs(orQuery);
      if (!orSnap.empty) {
        throw new Error(`CRITICAL: Duplicate O.R. detected. The Official Receipt Number '${orNumber}' has already been used in a settled transaction.`);
      }

      const batchRows = displayRows.filter(row => row.ids.every(id => selectedDelinqIds.has(id)));
      if (batchRows.length === 0) {
        throw new Error("Selection resolved to zero records.");
      }

      const calcDate = orDate ? new Date(orDate) : new Date();
      for (const row of batchRows) {
        for (const dataRecord of row.records) {
          let targetDelinqId = dataRecord.id;

          // If this is a virtual advance record, we must create the delinquency entry first
          if (dataRecord.isAdvanceVirtual) {
            const nextYear = new Date().getFullYear() + 1;
            const newDelinq = {
              propertyId: selectedProperty.id,
              year: nextYear,
              basicTaxDue: dataRecord.basicTaxDue,
              sefTaxDue: dataRecord.sefTaxDue,
              penalty: 0,
              interest: 0,
              totalDue: dataRecord.basicTaxDue + dataRecord.sefTaxDue,
              totalPaid: 0,
              status: "Delinquent" as const,
              recordedBy: profile?.username || profile?.displayName || auth.currentUser?.email || "System",
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp()
            };
            const docRef = await addDoc(collection(db, "delinquencies"), newDelinq);
            targetDelinqId = docRef.id;
          }

          // VALIDATION LAYER 2: DOUBLE TAXATION CHECK
          const dtQuery = query(
            collection(db, "payments"),
            where("propertyId", "==", selectedProperty.id),
            where("taxYear", "==", dataRecord.year),
            where("status", "==", "Active")
          );
          const dtSnap = await getDocs(dtQuery);
          
          if (!dtSnap.empty) {
            const existingRecords = dtSnap.docs.map(doc => doc.data());
            const matchingValue = existingRecords.find(r => r.assessedValue === selectedProperty.assessedValue);
            
            if (matchingValue) {
              throw new Error(`DOUBLE TAXATION REJECTED: Tax for Year ${dataRecord.year} on property ${selectedProperty.tdNumber} has already been settled with an Assessed Value of ${formatCurrency(selectedProperty.assessedValue)}.`);
            }
          }

          // Calculate components for THIS specific year/record
          const calc = calculateTotalDue(dataRecord.basicTaxDue, dataRecord.sefTaxDue, dataRecord.year, calcDate, 0, paymentMode, quarters, isAdvance);
          
          const paymentData: any = {
            propertyId: selectedProperty.id,
            delinquencyId: targetDelinqId,
            taxYear: dataRecord.year,
            assessedValue: selectedProperty.assessedValue,
            orNumber: orNumber.trim(),
            paymentDate: orDate,
            payerName: taxPayer,
            paymentType: paymentMode === "Installment" ? `Installment (${quarters.join(", ")})` : "Full",
            isAdvance,
            settlementMethod: isCash ? "Cash" : "Check",
            checkDetails: isCheck ? {
              number: checkNumber.trim(),
              payee: checkPayee.trim(),
              date: checkDate
            } : null,
            amountPaid: calc.totalDue,
            basicPaid: calc.basicTaxDue,
            sefPaid: calc.sefTaxDue,
            penaltyPaid: calc.interest,
            discountPaid: calc.discount || 0,
            treasurer: treasurer.trim(),
            deputy: deputy.trim(),
            recordedBy: profile?.username || profile?.displayName || auth.currentUser?.email || "System",
            status: "Active",
            recordedAt: new Date().toISOString()
          };

          try {
            await addDoc(collection(db, "payments"), paymentData);
          } catch (err) {
            handleFirestoreError(err, OperationType.CREATE, "payments");
          }

          try {
            await updateDoc(doc(db, "delinquencies", targetDelinqId), {
              status: "Paid",
              totalPaid: calc.totalDue,
              updatedAt: serverTimestamp(),
              paymentDetails: { 
                orNumber: orNumber.trim(), 
                paymentDate: orDate, 
                amountPaid: calc.totalDue, 
                paymentType: paymentMode 
              }
            });
          } catch (err) {
            handleFirestoreError(err, OperationType.UPDATE, `delinquencies/${targetDelinqId}`);
          }
        }
      }

      await logAudit("CREATE", "Collection", orNumber.trim(), null, { 
        orNumber: orNumber.trim(), 
        propertyId: selectedProperty.id, 
        amount: formTotals.total 
      });
      
      setErrorDialog({
        isOpen: true,
        title: "Success",
        message: "Payment record successfully posted and validated! The transaction has been recorded in the ledger.",
        type: "success"
      });
      setIsPosting(false);
      resetForm();
    } catch (err: any) {
      console.error("Posting Error:", err);
      let errorMsg = err.message || "Unknown error";
      try {
        const errorData = JSON.parse(err.message);
        errorMsg = errorData.error || 'Permission Denied';
      } catch {}
      
      setErrorDialog({
        isOpen: true,
        title: "Posting Failed",
        message: `CRITICAL ERROR: ${errorMsg}\n\nThe transaction has been aborted to maintain database integrity. Please verify the O.R. Number or network status.`,
        type: "danger"
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const [activeActionDelinq, setActiveActionDelinq] = useState<Delinquency | null>(null);
  const [actionTab, setActionTab] = useState<"audit" | "void">("audit");

  const resetForm = () => {
    setSelectedProperty(null);
    setFormDelinquencies([]);
    setAllPropertyYears([]);
    setSelectedDelinqIds(new Set());
    setOrNumber("");
    setCashTendered(0);
    setTaxPayer("");
    setCheckNumber("");
    setCheckPayee("");
    setCheckDate(new Date().toISOString().split('T')[0]);
    setIsCash(true);
    setIsCheck(false);
    setIsAdvance(false);
  };

  const groupedPaid = React.useMemo(() => {
    const groups: Record<string, any> = {};
    delinquencies.forEach(d => {
      const prop = properties.find(p => p.id === d.propertyId);
      if (!prop) return;

      const searchStr = `${prop.ownerName} ${prop.tdNumber} ${d.year}`.toLowerCase();
      if (!searchStr.includes(searchTerm.toLowerCase())) return;

      if (!groups[d.propertyId]) {
        groups[d.propertyId] = {
          property: prop,
          records: [],
          totalPaid: 0,
          minYear: Infinity,
          maxYear: -Infinity
        };
      }
      groups[d.propertyId].records.push(d);
      groups[d.propertyId].totalPaid += (d.totalPaid || 0);
      groups[d.propertyId].minYear = Math.min(groups[d.propertyId].minYear, d.year);
      groups[d.propertyId].maxYear = Math.max(groups[d.propertyId].maxYear, d.year);
    });
    return Object.values(groups).sort((a, b) => b.maxYear - a.maxYear);
  }, [delinquencies, properties, searchTerm]);

  return (
    <div className="space-y-6">
      {/* LEDGER VIEW HEADER */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white tracking-tight">Collection Ledger</h2>
          <p className="text-slate-500 text-sm mt-1">Audit log of validated tax payments and property clearances.</p>
        </div>
        <button 
          onClick={() => setIsPosting(true)}
          className="flex items-center gap-2 px-6 py-2.5 bg-indigo-600 text-white rounded-xl hover:bg-indigo-500 transition shadow-lg shadow-indigo-600/20 font-bold text-xs uppercase tracking-wider"
        >
          <Receipt className="w-4 h-4" />
          Post Payment Record
        </button>
      </div>

      {/* LEDGER TABLE */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl">
        <div className="p-4 border-b border-slate-800 bg-slate-900/50 flex items-center gap-4">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input 
              type="text" 
              placeholder="Search paid records by Owner or TDN..." 
              className="w-full pl-10 pr-4 py-2 border border-slate-800 rounded-xl bg-slate-950 text-slate-300 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-950/50">
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Entity Signature</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest text-center">Period Covered</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Aggregate Collected</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Status</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {groupedPaid.map((group: any) => (
                <tr key={group.property.id} className="hover:bg-indigo-500/[0.02] transition-colors">
                  <td className="px-6 py-5">
                    <div className="flex flex-col">
                      <span className="font-bold text-slate-200 text-sm tracking-tight">{group.property.ownerName}</span>
                      <span className="text-[10px] font-mono text-slate-500 font-bold uppercase tracking-widest">{group.property.tdNumber}</span>
                    </div>
                  </td>
                  <td className="px-6 py-5 text-xs text-slate-400 text-center font-bold tracking-widest">
                    {group.minYear === group.maxYear ? group.minYear : `${group.minYear} – ${group.maxYear}`}
                    <div className="text-[10px] text-indigo-500 mt-0.5">{group.records.length} paid record(s)</div>
                  </td>
                  <td className="px-6 py-5 text-sm text-emerald-400 font-black">
                    {formatCurrency(group.totalPaid)}
                  </td>
                  <td className="px-6 py-5">
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-[10px] font-bold uppercase tracking-widest bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shadow-sm shadow-emerald-500/10">
                      <CheckCircle2 className="w-3 h-3" />
                      Paid & Verified
                    </span>
                  </td>
                  <td className="px-6 py-5 text-right font-bold uppercase tracking-widest flex items-center justify-end gap-2">
                    <button 
                      onClick={() => {
                        setActiveActionDelinq(group.records[0]);
                        setActionTab("audit");
                      }}
                      className="flex items-center gap-2 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-[10px] transition-colors border border-slate-700"
                    >
                      <History className="w-3.5 h-3.5" />
                      AUDIT TRAIL
                    </button>
                    <button 
                      onClick={() => {
                        setActiveActionDelinq(group.records[0]);
                        setActionTab("void");
                      }}
                      className="flex items-center gap-2 px-3 py-1.5 bg-slate-800 hover:bg-red-500/10 text-slate-300 hover:text-red-400 rounded-lg text-[10px] transition-colors border border-slate-700 hover:border-red-500/20"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      VOID RECORD
                    </button>
                  </td>
                </tr>
              ))}
              {groupedPaid.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-20 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-12 h-12 bg-slate-950 rounded-2xl flex items-center justify-center border border-slate-800">
                        <TrendingUp className="w-6 h-6 text-slate-700" />
                      </div>
                      <p className="text-slate-500 text-sm italic font-medium">No verified payment records found in the ledger.</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <AnimatePresence>
        {activeActionDelinq && (
           <div className="collection-actions-wrapper">
             {/* We need to somehow force the tab, but DelinquencyActions has its own state. 
                 We might need to modify DelinquencyActions to accept an initial tab, 
                 but for now it defaults to 'update'. 
                 Actually, looking at its code, setActiveTab is internal.
             */}
             <DelinquencyActions 
               delinquency={activeActionDelinq}
               property={properties.find(p => p.id === activeActionDelinq.propertyId)!}
               onClose={() => setActiveActionDelinq(null)}
               isEncoder={true}
               isAdmin={profile?.role === 'admin'}
               initialTab={actionTab}
               standalone={true}
             />
           </div>
        )}
      </AnimatePresence>

      {/* POST PAYMENT MODAL */}
      <AnimatePresence>
        {isPosting && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-slate-950/90 backdrop-blur-md z-[100] flex items-center justify-center p-4"
          >
            <motion.div 
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 20 }}
              className="bg-slate-900 border border-slate-800 rounded-[2rem] shadow-2xl w-full max-w-6xl flex flex-col max-h-[92vh] overflow-hidden"
            >
              {/* MODAL HEADER */}
              <div className="p-6 border-b border-slate-800 flex items-center justify-between bg-slate-950/50">
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-indigo-500/10 rounded-2xl">
                    <DollarSign className="w-6 h-6 text-indigo-400" />
                  </div>
                  <div>
                    <h3 className="text-xl font-black text-white uppercase tracking-tighter">Collection Registry</h3>
                    <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Consolidate assessments and issue official receipt.</p>
                  </div>
                </div>
                <button onClick={() => setIsPosting(false)} className="p-2 hover:bg-slate-800 rounded-xl text-slate-500 transition-colors">
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-[#0a0c10]">
                {/* SECTION 1: TOP INFORMATION PANEL */}
                <div className="grid grid-cols-2 grid-rows-7 gap-x-12 gap-y-2 items-start">
                  
                  {/* ROW 1 */}
                  <div className="grid grid-cols-3 gap-2 items-center h-8">
                    <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">O.R. NO:</label>
                    <input 
                      type="text" 
                      value={orNumber}
                      onChange={e => setOrNumber(e.target.value)}
                      className="col-span-2 h-8 bg-slate-950 border border-slate-800 rounded-lg px-3 text-white font-mono text-xs focus:ring-1 focus:ring-indigo-500 outline-none"
                      placeholder="Receipt Number..."
                    />
                  </div>
                  <div className="row-span-2 h-[72px] p-2 bg-slate-950 border border-slate-800 rounded-lg flex flex-col relative group">
                     <div className="flex items-center justify-between border-b border-slate-800/50 pb-0.5 mb-1.5">
                       <label className="text-[8px] font-bold text-indigo-400 uppercase tracking-widest block">Payment Mode</label>
                       <label className="flex items-center gap-1.5 cursor-pointer">
                         <input 
                           type="checkbox" 
                           checked={isAdvance}
                           onChange={e => setIsAdvance(e.target.checked)}
                           className="w-2.5 h-2.5 accent-emerald-500 rounded-sm"
                         />
                         <span className={cn("text-[7px] font-black uppercase tracking-tighter transition-colors", isAdvance ? "text-emerald-400" : "text-slate-600")}>Advance Payment (20%)</span>
                       </label>
                     </div>
                     <div className="grid grid-cols-3 grid-rows-2 gap-x-4 gap-y-1.5 flex-1 items-center">
                       {/* ROW 1 */}
                       <label className="flex items-center gap-2 cursor-pointer group">
                         <input type="radio" checked={paymentMode === "Full"} onChange={() => setPaymentMode("Full")} className="w-3 h-3 accent-indigo-500" />
                         <span className="text-[9px] font-bold text-slate-300 group-hover:text-white transition-colors">Full</span>
                       </label>
                       <label className={cn("flex items-center gap-2 transition-all", paymentMode === "Full" ? "opacity-20 cursor-not-allowed" : "cursor-pointer group")}>
                         <input 
                           type="checkbox" 
                           checked={quarters.includes("1st Qtr")}
                           disabled={paymentMode === "Full"}
                           onChange={e => handleQuarterToggle("1st Qtr", e.target.checked)}
                           className="w-2.5 h-2.5 accent-indigo-500" 
                         />
                         <span className="text-[8px] font-bold text-slate-400 group-hover:text-slate-200 transition-colors whitespace-nowrap">1st quarter</span>
                       </label>
                       <label className={cn("flex items-center gap-2 transition-all", paymentMode === "Full" ? "opacity-20 cursor-not-allowed" : "cursor-pointer group")}>
                         <input 
                           type="checkbox" 
                           checked={quarters.includes("3rd Qtr")}
                           disabled={paymentMode === "Full"}
                           onChange={e => handleQuarterToggle("3rd Qtr", e.target.checked)}
                           className="w-2.5 h-2.5 accent-indigo-500" 
                         />
                         <span className="text-[8px] font-bold text-slate-400 group-hover:text-slate-200 transition-colors whitespace-nowrap">3rd quarter</span>
                       </label>

                       {/* ROW 2 */}
                       <label className="flex items-center gap-2 cursor-pointer group">
                         <input type="radio" checked={paymentMode === "Installment"} onChange={() => setPaymentMode("Installment")} className="w-3 h-3 accent-indigo-500" />
                         <span className="text-[9px] font-bold text-slate-300 group-hover:text-white transition-colors">Installment</span>
                       </label>
                       <label className={cn("flex items-center gap-2 transition-all", paymentMode === "Full" ? "opacity-20 cursor-not-allowed" : "cursor-pointer group")}>
                         <input 
                           type="checkbox" 
                           checked={quarters.includes("2nd Qtr")}
                           disabled={paymentMode === "Full"}
                           onChange={e => handleQuarterToggle("2nd Qtr", e.target.checked)}
                           className="w-2.5 h-2.5 accent-indigo-500" 
                         />
                         <span className="text-[8px] font-bold text-slate-400 group-hover:text-slate-200 transition-colors whitespace-nowrap">2nd quarter</span>
                       </label>
                       <label className={cn("flex items-center gap-2 transition-all", paymentMode === "Full" ? "opacity-20 cursor-not-allowed" : "cursor-pointer group")}>
                         <input 
                           type="checkbox" 
                           checked={quarters.includes("4th Qtr")}
                           disabled={paymentMode === "Full"}
                           onChange={e => handleQuarterToggle("4th Qtr", e.target.checked)}
                           className="w-2.5 h-2.5 accent-indigo-500" 
                         />
                         <span className="text-[8px] font-bold text-slate-400 group-hover:text-slate-200 transition-colors whitespace-nowrap">4th quarter</span>
                       </label>
                     </div>
                  </div>

                  {/* ROW 2 */}
                  <div className="grid grid-cols-3 gap-2 items-center h-8">
                    <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">O.R. DATE:</label>
                    <input 
                      type="date" 
                      value={orDate}
                      onChange={e => setOrDate(e.target.value)}
                      className="col-span-2 h-8 bg-slate-950 border border-slate-800 rounded-lg px-3 text-white font-mono text-xs focus:ring-1 focus:ring-indigo-500 outline-none"
                    />
                  </div>


                  {/* ROW 3 */}
                  <div className="grid grid-cols-3 gap-2 items-center h-8">
                    <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">ARP/Tax DEC. NO.:</label>
                    <div className="col-span-2 h-8 flex items-center px-3 bg-slate-950/50 border border-slate-800 rounded-lg text-slate-400 text-xs italic truncate">
                      {selectedProperty?.tdNumber || "No property..."}
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 items-center h-8 relative">
                    <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest text-right whitespace-nowrap">TD No / ARP No:</label>
                    <div className="col-span-2 relative">
                      <input 
                        type="text" 
                        value={propSearch}
                        onChange={e => setPropSearch(e.target.value)}
                        className="w-full h-8 bg-slate-950 border border-slate-800 rounded-lg pl-3 pr-8 text-white text-xs focus:ring-1 focus:ring-indigo-500 outline-none"
                        placeholder="Search property..."
                      />
                      <Search className="w-3 h-3 absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
                      {propSearchResults.length > 0 && (
                        <div className="absolute top-full left-0 right-0 mt-1 bg-slate-900 border border-slate-700 rounded-lg shadow-2xl z-[110] overflow-hidden">
                          {propSearchResults.map(p => (
                            <button 
                              key={p.id}
                              onClick={() => handleSelectProperty(p)}
                              className="w-full p-2 text-left hover:bg-indigo-500/10 border-b border-slate-800 last:border-0 transition-colors"
                            >
                              <p className="text-[10px] font-bold text-white uppercase">{p.tdNumber}</p>
                              <p className="text-[8px] text-slate-500">{p.ownerName}</p>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* ROW 4 */}
                  <div className="grid grid-cols-3 gap-2 items-center h-8">
                    <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">LOCATION:</label>
                    <div className="col-span-2 h-8 flex items-center px-3 bg-slate-950/50 border border-slate-800 rounded-lg text-slate-400 text-xs italic truncate">
                      {selectedProperty ? `${selectedProperty.barangay}, ${selectedProperty.municipality}` : "---"}
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 items-center h-8">
                    <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest text-right">KIND:</label>
                    <div className="col-span-2 h-8 flex items-center px-3 bg-slate-950/50 border border-slate-800 rounded-lg text-slate-400 text-xs italic truncate">
                      {selectedProperty?.classification || "---"}
                    </div>
                  </div>

                  {/* ROW 5 */}
                  <div className="grid grid-cols-3 gap-2 items-center h-8">
                    <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">OWNER:</label>
                    <div className="col-span-2 h-8 flex items-center px-3 bg-slate-950/50 border border-slate-800 rounded-lg text-slate-400 text-xs italic truncate">
                      {selectedProperty?.ownerName || "---"}
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 items-center h-8">
                    <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest text-right">OWNER ADDRESS:</label>
                    <div className="col-span-2 h-8 flex items-center px-3 bg-slate-950/50 border border-slate-800 rounded-lg text-slate-400 text-xs italic truncate">
                      {selectedProperty?.ownerAddress || "---"}
                    </div>
                  </div>

                  {/* ROW 6 */}
                  <div className="grid grid-cols-3 gap-2 items-center h-8">
                    <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">TAX PAYER:</label>
                    <input 
                      type="text" 
                      value={taxPayer}
                      onChange={e => setTaxPayer(e.target.value)}
                      className="col-span-2 h-8 bg-slate-950 border border-slate-800 rounded-lg px-3 text-white text-xs focus:ring-1 focus:ring-indigo-500 outline-none"
                    />
                  </div>
                  <div className="grid grid-cols-3 gap-2 items-center h-8">
                    <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest text-right">LOT NO.:</label>
                    <div className="col-span-2 h-8 flex items-center px-3 bg-slate-950/50 border border-slate-800 rounded-lg text-slate-400 text-xs italic truncate">
                      {selectedProperty?.lotNo || "---"}
                    </div>
                  </div>

                  {/* ROW 7 */}
                  <div className="grid grid-cols-3 gap-2 items-center h-8">
                    <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">TREASURER:</label>
                    <input 
                      type="text" 
                      value={treasurer}
                      onChange={e => setTreasurer(e.target.value)}
                      className="col-span-2 h-8 bg-slate-950 border border-slate-800 rounded-lg px-3 text-white text-xs focus:ring-1 focus:ring-indigo-500 outline-none"
                    />
                  </div>
                  <div className="grid grid-cols-3 gap-2 items-center h-8">
                    <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest text-right">DEPUTY:</label>
                    <input 
                      type="text" 
                      value={deputy}
                      onChange={e => setDeputy(e.target.value)}
                      className="col-span-2 h-8 bg-slate-950 border border-slate-800 rounded-lg px-3 text-white text-xs focus:ring-1 focus:ring-indigo-500 outline-none"
                    />
                  </div>
                </div>

                {/* SECTION 2: MIDDLE DATA TABLE */}
                <div className="border border-slate-800 rounded-lg overflow-hidden shadow-xl bg-slate-950/20">
                  <table className="w-full text-left text-[11px]">
                    <thead>
                      <tr className="bg-slate-950/50 border-b border-slate-800">
                        <th className="px-4 py-2 font-bold text-slate-500 uppercase tracking-widest text-[8px] w-8">Sel</th>
                        <th className="px-4 py-2 font-bold text-slate-500 uppercase tracking-widest text-[8px]">TDN</th>
                        <th className="px-4 py-2 font-bold text-slate-500 uppercase tracking-widest text-[8px] text-center w-16">Year</th>
                        <th className="px-4 py-2 font-bold text-slate-500 uppercase tracking-widest text-[8px] text-right">Assessed</th>
                        <th className="px-4 py-2 font-bold text-slate-500 uppercase tracking-widest text-[8px] text-right">Basic</th>
                        <th className="px-4 py-2 font-bold text-slate-500 uppercase tracking-widest text-[8px] text-right">SEF</th>
                        <th className="px-4 py-2 font-bold text-slate-500 uppercase tracking-widest text-[8px] text-right">Disc</th>
                        <th className="px-4 py-2 font-bold text-slate-500 uppercase tracking-widest text-[8px] text-right">Int</th>
                        <th className="px-4 py-2 font-bold text-indigo-400 uppercase tracking-widest text-[8px] text-right">Total</th>
                        <th className="px-4 py-2 font-bold text-slate-300 uppercase tracking-widest text-[8px] text-right">Balance</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                      {displayRows.map(row => {
                        const isSelected = row.ids.every((id: string) => selectedDelinqIds.has(id));
                        return (
                          <tr key={`${row.ids.join(',')}-${row.quarterLabel || 'full'}`} className={cn("hover:bg-white/[0.02] h-8", !isSelected && "opacity-50")}>
                            <td className="px-4 py-1">
                              <input 
                                type="checkbox" 
                                checked={isSelected}
                                disabled={paymentMode === "Full"}
                                onChange={e => {
                                   const next = new Set(selectedDelinqIds);
                                   if (e.target.checked) row.ids.forEach((id: string) => next.add(id));
                                   else row.ids.forEach((id: string) => next.delete(id));
                                   setSelectedDelinqIds(next);
                                }}
                                className="w-3.5 h-3.5 accent-indigo-500" 
                              />
                            </td>
                            <td className="px-4 py-1 font-mono text-slate-500">{selectedProperty?.tdNumber}</td>
                            <td className="px-4 py-1 text-center font-bold text-slate-200">
                              {row.yearDisplay}
                              {row.type === 'group' && <span className="block text-[7px] text-indigo-500 font-black">CONSOLIDATED</span>}
                            </td>
                            <td className="px-4 py-1 text-right text-slate-400">
                              {formatCurrency(row.assessedValue)}
                            </td>
                            <td className="px-4 py-1 text-right text-slate-400">{formatCurrency(row.totalBasic)}</td>
                            <td className="px-4 py-1 text-right text-slate-400">{formatCurrency(row.totalSef)}</td>
                            <td className="px-4 py-1 text-right text-emerald-500">
                              {formatCurrency(row.totalDiscount)}
                            </td>
                            <td className="px-4 py-1 text-right text-red-500 font-medium">+{formatCurrency(row.totalInterest)}</td>
                            <td className="px-4 py-1 text-right text-white font-black">{formatCurrency(row.totalDue)}</td>
                            <td className="px-4 py-1 text-right text-slate-600">{formatCurrency(row.balanceAmount || 0)}</td>
                          </tr>
                        );
                      })}
                      {displayRows.length === 0 && (
                        <tr>
                          <td colSpan={10} className="px-4 py-4 text-center text-slate-500 italic">No records to assess. Search above.</td>
                        </tr>
                      )}
                    </tbody>
                    <tfoot className="bg-slate-950/80 border-t border-slate-800">
                      <tr className="font-bold h-10">
                        <td colSpan={3} className="px-4 py-2 text-[8px] text-slate-500 uppercase tracking-widest">Totals</td>
                        <td className="px-4 py-2 text-right text-slate-400">{formatCurrency(formTotals.assessed)}</td>
                        <td className="px-4 py-2 text-right text-slate-400">{formatCurrency(formTotals.basic)}</td>
                        <td className="px-4 py-2 text-right text-slate-400">{formatCurrency(formTotals.sef)}</td>
                        <td className="px-4 py-2 text-right text-emerald-500">{formatCurrency(formTotals.discount)}</td>
                        <td className="px-4 py-2 text-right text-red-500">{formatCurrency(formTotals.penalty)}</td>
                        <td className="px-4 py-2 text-right text-white text-sm font-black">{formatCurrency(formTotals.total)}</td>
                        <td className="px-4 py-2 text-right text-slate-600">{formatCurrency(formTotals.balanceAmount)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>

                {/* SECTION 3: BOTTOM PAYMENT DETAILS */}
                <div className="mt-2 space-y-3">
                  {/* 2-Column Payment Inputs Grid */}
                  <div className="grid grid-cols-2 gap-3 items-stretch">
                    {/* Column 1: Tender & Change */}
                    <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 flex flex-col justify-between h-full shadow-lg">
                       <div className="space-y-4">
                         {/* Integrated Amount Due Display */}
                         <div className="flex justify-between items-start border-b border-slate-800 pb-3">
                            <div>
                               <span className="text-[8px] font-black text-slate-500 uppercase tracking-widest block">Liability amount</span>
                               <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest">Total Assessment Due</span>
                            </div>
                            <span className="text-xl font-black text-white">{formatCurrency(formTotals.total)}</span>
                         </div>

                         <div className="space-y-1">
                           <label className="text-[9px] font-bold text-indigo-400 uppercase tracking-widest">Cash Tendered</label>
                           <div className="relative">
                              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600 font-bold text-sm">₱</span>
                              <input 
                                type="number" 
                                value={cashTendered || ""}
                                onChange={e => setCashTendered(parseFloat(e.target.value) || 0)}
                                className="w-full h-10 bg-slate-950 border border-indigo-500/30 rounded-lg pl-7 pr-3 text-lg font-black text-white focus:border-indigo-500 outline-none transition-all shadow-lg shadow-indigo-600/5 transition-all"
                                placeholder="0.00"
                              />
                           </div>
                         </div>
                       </div>
                       <div className="flex justify-between items-center bg-slate-900/50 p-3 rounded-lg border border-slate-800 mt-4">
                          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Change / Surplus</span>
                          <span className={cn("text-xl font-black", balance >= 0 ? "text-emerald-400" : "text-red-500")}>
                            {formatCurrency(Math.abs(balance))}
                          </span>
                       </div>
                    </div>

                    {/* Column 2: Settlement Method */}
                    <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 flex flex-col h-full overflow-hidden">
                       <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest block text-center border-b border-slate-800 pb-1.5 mb-3">Settlement Method</label>
                       <div className="space-y-3 flex-1 flex flex-col">
                         <div className="flex gap-4">
                           <button 
                             onClick={() => { setIsCash(true); setIsCheck(false); }}
                             className={cn(
                               "flex-1 p-2 rounded-lg border flex items-center justify-center gap-2 transition-all",
                               isCash ? "bg-indigo-600/10 border-indigo-500 text-indigo-400" : "bg-slate-950 border-slate-800 text-slate-500 hover:border-slate-700"
                             )}
                           >
                             <div className={cn("w-3 h-3 rounded-full border-2", isCash ? "bg-indigo-500 border-indigo-400" : "border-slate-700")} />
                             <span className="text-[10px] font-black uppercase tracking-widest whitespace-nowrap">Cash Settlement</span>
                           </button>
                           <button 
                             onClick={() => { setIsCash(false); setIsCheck(true); }}
                             className={cn(
                               "flex-1 p-2 rounded-lg border flex items-center justify-center gap-2 transition-all",
                               isCheck ? "bg-indigo-600/10 border-indigo-500 text-indigo-400" : "bg-slate-950 border-slate-800 text-slate-500 hover:border-slate-700"
                             )}
                           >
                             <div className={cn("w-3 h-3 rounded-full border-2", isCheck ? "bg-indigo-500 border-indigo-400" : "border-slate-700")} />
                             <span className="text-[10px] font-black uppercase tracking-widest whitespace-nowrap">Check Settlement</span>
                           </button>
                         </div>

                         <div className={cn(
                           "grid grid-cols-2 gap-2 mt-1 transition-all duration-300",
                           !isCheck ? "opacity-30 pointer-events-none" : "opacity-100"
                         )}>
                           <div className="space-y-1">
                             <label className="text-[8px] font-bold text-slate-500 uppercase tracking-widest">Check Number</label>
                             <input 
                               type="text" 
                               value={checkNumber}
                               disabled={!isCheck}
                               onChange={e => setCheckNumber(e.target.value)}
                               className="w-full h-7 bg-slate-900 border border-slate-800 rounded px-2 text-[10px] text-white focus:border-indigo-500 outline-none"
                               placeholder="Enter No..."
                             />
                           </div>
                           <div className="space-y-1">
                             <label className="text-[8px] font-bold text-slate-500 uppercase tracking-widest">Check Date</label>
                             <input 
                               type="date" 
                               value={checkDate}
                               disabled={!isCheck}
                               onChange={e => setCheckDate(e.target.value)}
                               className="w-full h-7 bg-slate-900 border border-slate-800 rounded px-2 text-[10px] text-white focus:border-indigo-500 outline-none"
                             />
                           </div>
                           <div className="col-span-2 space-y-1">
                             <label className="text-[8px] font-bold text-slate-500 uppercase tracking-widest">Payee / Drawee</label>
                             <input 
                               type="text" 
                               value={checkPayee}
                               disabled={!isCheck}
                               onChange={e => setCheckPayee(e.target.value)}
                               className="w-full h-7 bg-slate-900 border border-slate-800 rounded px-2 text-[10px] text-white focus:border-indigo-500 outline-none"
                               placeholder="Payee Name..."
                             />
                           </div>
                         </div>
                       </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* SECTION 4: ACTION TOOLBAR (FIXED FOOTER) */}
              <div className="p-4 bg-slate-950 border-t border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-3" />
                <div className="flex gap-2">
                  <button 
                    onClick={() => {
                      setIsPosting(false);
                      resetForm();
                    }}
                    className="px-6 h-8 text-[9px] font-black uppercase tracking-widest text-slate-400 hover:bg-slate-800 rounded-lg transition-all border border-slate-800"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={handlePostPayment}
                    disabled={isSubmitting}
                    className={cn(
                      "px-8 h-8 text-[9px] font-black uppercase tracking-widest rounded-lg transition-all shadow-xl font-black",
                      isSubmitting 
                        ? "bg-slate-800 text-slate-500 cursor-not-allowed" 
                        : "bg-indigo-600 text-white hover:bg-indigo-500 shadow-indigo-600/30"
                    )}
                  >
                    {isSubmitting ? "Posting..." : "Post Payment Record"}
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <ConfirmDialog
        isOpen={errorDialog.isOpen}
        onClose={() => setErrorDialog(prev => ({ ...prev, isOpen: false }))}
        onConfirm={() => setErrorDialog(prev => ({ ...prev, isOpen: false }))}
        title={errorDialog.title}
        message={errorDialog.message}
        type={errorDialog.type}
        confirmText="Acknowledge"
        cancelText="Close"
      />
    </div>
  );
}
