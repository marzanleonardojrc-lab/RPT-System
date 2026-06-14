import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { 
  Building2, 
  Wallet, 
  AlertTriangle, 
  Calculator, 
  CheckCircle2, 
  AlertCircle, 
  XOctagon, 
  Save, 
  FileCheck2,
  Lock
} from 'lucide-react';
import { 
  collection, 
  query,
  onSnapshot, 
  doc,
  setDoc,
  serverTimestamp,
  db,
  handleFirestoreError,
  OperationType 
} from "../lib/firebase";
import { useAuth } from "../AuthContext";
import { Property, Delinquency, Payment } from "../types";
import { BASIC_TAX_RATE, SEF_TAX_RATE, IDLE_LAND_RATE, calculateTotalDue } from "../lib/taxCalculations";

export const ReconciliationModule: React.FC = () => {
  const { auth, isEncoder } = useAuth();
  const [fiscalYear, setFiscalYear] = useState(new Date().getFullYear().toString());
  
  const [properties, setProperties] = useState<Property[]>([]);
  const [delinquencies, setDelinquencies] = useState<Delinquency[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [taxRate, setTaxRate] = useState(1);

  // Historical snapshots state
  const [snapshots, setSnapshots] = useState<Record<string, any>>({});
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    return onSnapshot(collection(db, "properties"), (snapshot) => {
      setProperties(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Property)));
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, "properties");
    });
  }, []);

  useEffect(() => {
    const q = query(collection(db, "delinquencies"));
    return onSnapshot(q, (snapshot) => {
      setDelinquencies(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Delinquency)));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, "delinquencies");
    });
  }, []);

  useEffect(() => {
    return onSnapshot(collection(db, "payments"), (snapshot) => {
      setPayments(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Payment)));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, "payments");
    });
  }, []);

  useEffect(() => {
    return onSnapshot(collection(db, "reconciliations"), (snapshot) => {
      const snaps: Record<string, any> = {};
      snapshot.docs.forEach(doc => {
        snaps[doc.id] = doc.data();
      });
      setSnapshots(snaps);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, "reconciliations");
    });
  }, []);

  // Augment virtual delinquencies
  const augmentedDelinquencies = [...delinquencies];
  const targetYear = parseInt(fiscalYear);
  const currYear = new Date().getFullYear();

  properties.forEach(p => {
    if (p.isArchived) return;
    let effYear = currYear;
    if (p.effectivityDate) {
      let extractedYear: number | typeof NaN = NaN;
      if (p.effectivityDate.includes('-')) {
          extractedYear = new Date(p.effectivityDate).getFullYear();
      } else {
          extractedYear = parseInt(p.effectivityDate, 10);
      }
      if (!isNaN(extractedYear)) {
        effYear = extractedYear;
      }
    }
    
    if (effYear > currYear) effYear = currYear;

    for (let y = effYear; y <= Math.min(targetYear, currYear); y++) {
      const existsInDelinq = delinquencies.some(d => d.propertyId === p.id && d.year === y);
      const existsInPayments = payments.some(pay => pay.propertyId === p.id && pay.taxYear === y && pay.status === "Active");
      
      if (!existsInDelinq && !existsInPayments) {
        const yearBasic = p.assessedValue * BASIC_TAX_RATE;
        const yearSef = p.assessedValue * SEF_TAX_RATE;
        augmentedDelinquencies.push({
          id: `virtual-${p.id}-${y}`,
          propertyId: p.id,
          year: y,
          assessedValue: p.assessedValue,
          basicTaxDue: yearBasic,
          sefTaxDue: yearSef,
          penalty: 0,
          interest: 0,
          totalDue: 0,
          status: "Delinquent",
          totalPaid: 0,
          updatedAt: new Date().toISOString(),
          createdAt: new Date().toISOString()
        } as Delinquency);
      }
    }
  });

  // Filter delinquencies by the selected fiscal year (Cumulative up to this year)
  const maxYearToInclude = targetYear;
  const filteredDelinquencies = augmentedDelinquencies.filter(d => 
    d.year <= maxYearToInclude && 
    !properties.find(p => p.id === d.propertyId)?.isArchived
  );

  // Assessor's Office
  const unarchivedProperties = properties.filter(p => !p.isArchived);
  const liveTotalAssessedValue = unarchivedProperties.reduce((sum, p) => sum + (Number(p.assessedValue) || 0), 0);
  const liveTaxableProperties = unarchivedProperties.length;
  
  // Cumulative Computed Tax Levy based on all records up to the selected year
  const liveComputedTaxLevy = filteredDelinquencies.reduce((sum, d) => sum + (d.basicTaxDue || 0), 0);

  // Treasurer's Office logic
  let liveTotalCollected = 0;
  const paidPropIds = new Set<string>();
  let livePartialPayments = 0;

  const validActivePayments = payments.filter(p => 
    p.status === "Active" && 
    p.taxYear <= maxYearToInclude && 
    !properties.find(prop => prop.id === p.propertyId)?.isArchived
  );

  validActivePayments.forEach(p => {
    liveTotalCollected += (p.basicPaid || 0);
    paidPropIds.add(p.propertyId);
    if (p.paymentType && p.paymentType.startsWith("Installment")) {
      livePartialPayments += 1;
    }
  });

  // RPT Tracker logic
  let liveDelinquentAmount = 0;
  let liveCurrentReceivables = 0;
  let liveDelinquentAccounts = 0;
  let livePenaltiesInterest = 0;

  const delinquentPropIds = new Set<string>();

  filteredDelinquencies.forEach(d => {
    if (d.status === "Voided") return;

    const originalBasic = d.basicTaxDue || 0;
    
    // Calculate how much basic tax was collected for this specific delinquency
    const relatedPayments = validActivePayments.filter(p => p.delinquencyId === d.id);
    const collectedBasic = relatedPayments.reduce((sum, p) => sum + (p.basicPaid || 0), 0);

    // Delinquencies (Cumulative Backlog)
    const isPaid = d.status === "Paid" && d.paymentDetails?.orNumber;
    if (!isPaid) {
      if (d.year === maxYearToInclude) {
        liveCurrentReceivables += Math.max(0, originalBasic - collectedBasic);
      } else {
        liveDelinquentAmount += Math.max(0, originalBasic - collectedBasic);
        delinquentPropIds.add(d.propertyId);
        livePenaltiesInterest += (d.penalty || 0) + (d.interest || 0);
      }
    }
  });

  // Round collected total to fix floating point precision issues
  liveTotalCollected = Math.round(liveTotalCollected * 100) / 100;
  const liveAccountsPaid = paidPropIds.size;
  liveDelinquentAccounts = delinquentPropIds.size;

  const activeSnapshot = snapshots[fiscalYear];
  const isCertified = activeSnapshot?.status === 'certified';
  const isDraft = activeSnapshot?.status === 'draft';
  const isSnapshotView = isCertified || isDraft;

  const [useLiveAssessorData, setUseLiveAssessorData] = useState(true);
  const [manualAssessedValue, setManualAssessedValue] = useState(0);
  const [manualTaxableProperties, setManualTaxableProperties] = useState(0);

  useEffect(() => {
    if (activeSnapshot) {
      setUseLiveAssessorData(activeSnapshot.assessorData.useLiveAssessorData ?? true);
      setManualAssessedValue(activeSnapshot.assessorData.assessedValue || 0);
      setManualTaxableProperties(activeSnapshot.assessorData.taxableProperties || 0);
    } else {
      setUseLiveAssessorData(true);
      setManualAssessedValue(liveTotalAssessedValue);
      setManualTaxableProperties(liveTaxableProperties);
    }
  }, [fiscalYear, activeSnapshot, liveTotalAssessedValue, liveTaxableProperties]);

  const totalAssessedValue = isCertified ? activeSnapshot.assessorData.assessedValue : (useLiveAssessorData ? liveTotalAssessedValue : manualAssessedValue);
  const taxableProperties = isCertified ? activeSnapshot.assessorData.taxableProperties : (useLiveAssessorData ? liveTaxableProperties : manualTaxableProperties);
  const activeTaxRate = isCertified ? activeSnapshot.assessorData.taxRate : taxRate;
  const computedTaxLevy = isCertified ? activeSnapshot.assessorData.computedTaxLevy : (useLiveAssessorData ? liveComputedTaxLevy : (manualAssessedValue * (activeTaxRate / 100)));
  
  const totalCollected = isSnapshotView ? activeSnapshot.treasurerData.totalCollected : liveTotalCollected;
  const accountsPaid = isSnapshotView ? activeSnapshot.treasurerData.accountsPaid : liveAccountsPaid;
  const partialPayments = isSnapshotView ? activeSnapshot.treasurerData.partialPayments : livePartialPayments;

  const delinquentAmount = isSnapshotView ? activeSnapshot.trackerData.delinquentAmount : liveDelinquentAmount;
  const currentReceivables = isSnapshotView ? (activeSnapshot.trackerData.currentReceivables || 0) : liveCurrentReceivables;
  const delinquentAccounts = isSnapshotView ? activeSnapshot.trackerData.delinquentAccounts : liveDelinquentAccounts;
  const penaltiesInterest = isSnapshotView ? activeSnapshot.trackerData.penaltiesInterest : livePenaltiesInterest;

  const variance = computedTaxLevy - (totalCollected + delinquentAmount + currentReceivables);
  const collectionRate = computedTaxLevy > 0 ? (totalCollected / computedTaxLevy) * 100 : 0;
  const delinquencyRate = computedTaxLevy > 0 ? (delinquentAmount / computedTaxLevy) * 100 : 0;

  const getStatusNode = () => {
    if (Math.abs(variance) < 0.01) return 'balanced';
    return 'error_variance';
  };

  const currentStatus = getStatusNode();

  const handleSaveSnapshot = async (status: 'draft' | 'certified') => {
    if (!auth || !auth.currentUser) return;
    if (status === 'certified') {
      if (currentStatus === 'error_variance') {
        alert("Cannot certify report with pending discrepancy.");
        return;
      }
      if (!window.confirm(`Are you sure you want to certify the ${fiscalYear} reconciliation report? This action will freeze the totals for this year.`)) return;
    }

    setIsSaving(true);
    try {
      const snapshotData = {
        year: fiscalYear,
        status: status,
        updatedAt: serverTimestamp(),
        [status === 'certified' ? 'certifiedAt' : 'draftedAt']: serverTimestamp(),
        updatedBy: auth.currentUser.uid,
        assessorData: {
          useLiveAssessorData,
          assessedValue: isSnapshotView ? totalAssessedValue : (useLiveAssessorData ? liveTotalAssessedValue : manualAssessedValue),
          taxableProperties: isSnapshotView ? taxableProperties : (useLiveAssessorData ? liveTaxableProperties : manualTaxableProperties),
          taxRate: isSnapshotView ? activeTaxRate : taxRate,
          computedTaxLevy: isSnapshotView ? computedTaxLevy : (useLiveAssessorData ? liveComputedTaxLevy : (manualAssessedValue * (taxRate / 100)))
        },
        treasurerData: {
          totalCollected: isSnapshotView ? totalCollected : liveTotalCollected,
          accountsPaid: isSnapshotView ? accountsPaid : liveAccountsPaid,
          partialPayments: isSnapshotView ? partialPayments : livePartialPayments
        },
        trackerData: {
          delinquentAmount: isSnapshotView ? delinquentAmount : liveDelinquentAmount,
          currentReceivables: isSnapshotView ? currentReceivables : liveCurrentReceivables,
          delinquentAccounts: isSnapshotView ? delinquentAccounts : liveDelinquentAccounts,
          penaltiesInterest: isSnapshotView ? penaltiesInterest : livePenaltiesInterest
        },
        metrics: {
          variance,
          collectionRate,
          delinquencyRate
        }
      };
      
      await setDoc(doc(db, "reconciliations", fiscalYear), snapshotData);
      alert(status === 'certified' ? `Reconciliation report for ${fiscalYear} has been certified and locked.` : `Draft for ${fiscalYear} saved successfully.`);
    } catch (e) {
      console.error(e);
      alert(`Failed to save ${status}.`);
    } finally {
      setIsSaving(false);
    }
  };

  // Generate an array of years from 2020 to current year + 1
  const currentYear = new Date().getFullYear();
  const years = Array.from({length: (currentYear + 1) - 2020 + 1}, (_, i) => (currentYear + 1 - i).toString());

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Calculator className="w-6 h-6 text-blue-400" />
            Inter-Department Reconciliation
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Reconcile Tax Levy, Collections, and Delinquencies for COA auditing
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-slate-800 border border-slate-700 px-4 py-2 rounded-lg">
            <span className="text-sm text-slate-400">Fiscal year:</span>
            <select 
              value={fiscalYear}
              onChange={(e) => setFiscalYear(e.target.value)}
              className="bg-slate-800 text-white font-semibold outline-none min-w-[120px] cursor-pointer"
            >
              {years.map(y => {
                const snap = snapshots[y];
                const labelSuffix = snap?.status === 'certified' ? ' (Certified)' : snap?.status === 'draft' ? ' (Draft)' : '';
                return (
                  <option key={y} value={y} className="bg-slate-800 text-white">
                    {y}{labelSuffix}
                  </option>
                );
              })}
            </select>
          </div>
          {!isCertified && isEncoder && (
            <button 
              onClick={() => handleSaveSnapshot('draft')}
              disabled={isSaving}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium transition-colors disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              {isSaving ? "Saving..." : "Save Draft"}
            </button>
          )}
        </div>
      </div>

      {isCertified && (
        <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-blue-500/20 p-2 rounded-full">
              <Lock className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">Certified Record</h3>
              <p className="text-xs text-slate-400">This reconciliation report is locked and reflects the historical snapshot.</p>
            </div>
          </div>
        </div>
      )}

      {isDraft && (
        <div className="bg-slate-500/10 border border-slate-500/30 rounded-lg p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-slate-500/20 p-2 rounded-full">
              <Save className="w-5 h-5 text-slate-400" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">Draft Record</h3>
              <p className="text-xs text-slate-400">This reflects a previously saved draft snapshot. You can certify this when ready, or continue saving updates.</p>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Assessor's Office Card */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden flex flex-col shadow-sm"
        >
          <div className="p-4 border-b border-slate-800 bg-slate-900/50">
            <div className="flex items-center gap-2 mb-1 justify-between">
              <span className="px-2 py-0.5 rounded text-xs font-semibold bg-blue-500/20 text-blue-400 border border-blue-500/30">Assessor's office</span>
              {!isCertified && (
                <label className="flex items-center gap-2 cursor-pointer">
                  <span className="text-xs text-slate-400">Live data</span>
                  <div className={`relative inline-flex h-4 w-8 items-center rounded-full transition-colors ${useLiveAssessorData ? 'bg-blue-500' : 'bg-slate-600'}`}>
                    <input type="checkbox" className="sr-only" checked={useLiveAssessorData} onChange={(e) => setUseLiveAssessorData(e.target.checked)} />
                    <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${useLiveAssessorData ? 'translate-x-4' : 'translate-x-1'}`} />
                  </div>
                </label>
              )}
            </div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Building2 className="w-4 h-4 text-slate-400" />
              Tax levy data
            </h2>
          </div>
          <div className="p-5 space-y-4 flex-1">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Total assessed value (₱)</label>
              <input 
                type="text" 
                value={Number(totalAssessedValue).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                onChange={(e) => !isCertified && !useLiveAssessorData && setManualAssessedValue(Number(e.target.value.replace(/,/g, '')))}
                readOnly={isCertified || useLiveAssessorData}
                className={`w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono focus:outline-none ${(isCertified || useLiveAssessorData) ? 'cursor-not-allowed opacity-80' : 'focus:border-blue-500 focus:ring-1 focus:ring-blue-500'}`}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Tax rate (%)</label>
              <input 
                type="number" 
                value={activeTaxRate}
                onChange={(e) => !isCertified && setTaxRate(Number(e.target.value))}
                readOnly={isCertified}
                className={`w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono focus:outline-none ${isCertified ? 'cursor-not-allowed opacity-80' : 'focus:border-blue-500 focus:ring-1 focus:ring-blue-500'}`}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">No. of taxable properties</label>
              <input 
                type="number" 
                value={taxableProperties}
                onChange={(e) => !isCertified && !useLiveAssessorData && setManualTaxableProperties(Number(e.target.value))}
                readOnly={isCertified || useLiveAssessorData}
                className={`w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono focus:outline-none ${(isCertified || useLiveAssessorData) ? 'cursor-not-allowed opacity-80' : 'focus:border-blue-500 focus:ring-1 focus:ring-blue-500'}`}
              />
            </div>
          </div>
          <div className="p-4 bg-slate-950/30 border-t border-slate-800 flex justify-between items-center">
            <span className="text-sm text-slate-400">Total Billed Levy (Cumulative)</span>
            <span className="font-bold text-white">₱{Number(computedTaxLevy).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>
        </motion.div>

        {/* Treasurer's Office Card */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden flex flex-col shadow-sm"
        >
          <div className="p-4 border-b border-slate-800 bg-slate-900/50">
            <div className="flex items-center gap-2 mb-1">
              <span className="px-2 py-0.5 rounded text-xs font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">Treasurer's office</span>
            </div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Wallet className="w-4 h-4 text-slate-400" />
              Collection data
            </h2>
          </div>
          <div className="p-5 space-y-4 flex-1">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Basic tax collected (₱)</label>
              <input 
                type="text" 
                value={Number(totalCollected).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                readOnly
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-emerald-400 font-mono font-medium focus:outline-none cursor-not-allowed opacity-80"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">No. of accounts paid</label>
              <input 
                type="number" 
                value={accountsPaid}
                readOnly
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono focus:outline-none cursor-not-allowed opacity-80"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">No. of partial payments</label>
              <input 
                type="number" 
                value={partialPayments}
                readOnly
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono focus:outline-none cursor-not-allowed opacity-80"
              />
            </div>
          </div>
          <div className="p-4 bg-slate-950/30 border-t border-slate-800 flex justify-between items-center">
            <span className="text-sm text-slate-400">Total Collected (Cumulative)</span>
            <span className="font-bold text-emerald-400">₱{Number(totalCollected).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>
        </motion.div>

        {/* RPT Tracker Card */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden flex flex-col shadow-sm"
        >
          <div className="p-4 border-b border-slate-800 bg-slate-900/50">
            <div className="flex items-center gap-2 mb-1">
              <span className="px-2 py-0.5 rounded text-xs font-semibold bg-blue-500/20 text-blue-400 border border-blue-500/30">RPT tracker</span>
            </div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-slate-400" />
              Delinquency data
            </h2>
          </div>
          <div className="p-5 space-y-4 flex-1">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Total delinquent amount (₱)</label>
              <input 
                type="text" 
                value={Number(delinquentAmount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                readOnly
                className="w-full bg-slate-900 border border-rose-500/50 rounded-lg px-3 py-2 text-rose-400 font-mono font-medium focus:outline-none cursor-not-allowed opacity-80"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Current year receivables (₱)</label>
              <input 
                type="text" 
                value={Number(currentReceivables).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                readOnly
                className="w-full bg-slate-900 border border-orange-500/50 rounded-lg px-3 py-2 text-orange-400 font-mono font-medium focus:outline-none cursor-not-allowed opacity-80"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">No. of delinquent accounts</label>
              <input 
                type="number" 
                value={delinquentAccounts}
                readOnly
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono focus:outline-none cursor-not-allowed opacity-80"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Penalties & interest (₱)</label>
              <input 
                type="text" 
                value={Number(penaltiesInterest).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                readOnly
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono focus:outline-none cursor-not-allowed opacity-80"
              />
            </div>
          </div>
          <div className="p-4 bg-slate-950/30 border-t border-slate-800 flex justify-between items-center">
            <span className="text-sm text-slate-400">Total Unpaid</span>
            <span className="font-bold text-rose-400">₱{Number(delinquentAmount + currentReceivables).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>
        </motion.div>
      </div>

      {/* Reconciliation Engine Bottom Area */}
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="bg-slate-900 rounded-xl border border-slate-800 shadow-sm text-slate-200 overflow-hidden"
      >
        <div className="p-4 border-b border-slate-800 font-bold flex items-center gap-2 text-lg">
          Reconciliation check
        </div>
        <div className="p-6 md:p-8">
          
          <div className="flex flex-col md:flex-row items-center justify-between bg-slate-950 rounded-xl p-6 mb-8 gap-4 border border-slate-800">
            <div className="text-center flex-1">
              <div className="text-xs font-bold text-slate-500 mb-1 uppercase tracking-wider">Tax levy (A)</div>
              <div className="text-[10px] text-slate-400 font-mono mb-1 leading-tight tracking-tighter">Tax Basis: ₱{Number(liveTotalAssessedValue).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
              <div className="text-2xl font-mono font-bold text-blue-600">₱{Number(computedTaxLevy).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
            </div>
            <div className="text-3xl text-slate-400 font-bold">=</div>
            <div className="text-center flex-1">
              <div className="text-xs font-bold text-slate-500 mb-1 uppercase tracking-wider">Collections (B)</div>
              <div className="text-[10px] text-slate-400 font-mono mb-1 leading-tight tracking-tighter opacity-0">Spacer</div>
              <div className="text-2xl font-mono font-bold text-emerald-600">₱{Number(totalCollected).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
            </div>
            <div className="text-3xl text-slate-400 font-bold">+</div>
            <div className="text-center flex-1">
              <div className="text-xs font-bold text-slate-500 mb-1 uppercase tracking-wider">Unpaid (C)</div>
              <div className="text-[10px] text-slate-400 font-mono mb-1 leading-tight tracking-tighter opacity-0">Spacer</div>
              <div className="text-2xl font-mono font-bold text-rose-600">₱{Number(delinquentAmount + currentReceivables).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
            </div>
          </div>

          <div className="space-y-4 font-mono text-sm">
            <div className="flex justify-between items-center py-2 border-b border-slate-800/50">
              <span className="font-sans text-slate-400">Equation substitution (A = B + C)</span>
              <span className="font-bold text-right">
                ₱{Number(computedTaxLevy).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} = ₱{Number(totalCollected).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} + ₱{Number(delinquentAmount + currentReceivables).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-slate-800/50">
              <span className="font-sans text-slate-400">Variance [A - (B + C)]</span>
              <span className={`font-bold text-right ${
                currentStatus === 'balanced' ? 'text-slate-200' : 'text-rose-500'
              }`}>
                {variance < 0 ? '-' : ''}₱{Number(Math.abs(variance)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-slate-800/50">
              <span className="font-sans text-slate-400">Collection rate</span>
              <span className="text-right font-bold">{collectionRate.toFixed(1)}%</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-slate-800/50">
              <span className="font-sans text-slate-400">Delinquency rate</span>
              <span className="text-right font-bold">{delinquencyRate.toFixed(1)}%</span>
            </div>
          </div>

          {/* Status Alert */}
          <div className="mt-8">
            {currentStatus === 'balanced' && (
              <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-5 flex items-start gap-4">
                <CheckCircle2 className="w-6 h-6 text-emerald-400 mt-0.5 shrink-0" />
                <div className="flex-1">
                  <h3 className="font-bold text-emerald-400 flex items-center gap-2">
                    Balanced — ready to submit to Accounting
                  </h3>
                  <div className="text-xl font-mono font-bold text-emerald-400 mt-1 mb-2">Variance: ₱0</div>
                  <p className="text-sm text-emerald-500">
                    All three departments agree. The reconciliation report can be certified and submitted to the Accounting Office and COA.
                  </p>
                  {!isCertified ? (
                    isEncoder && (
                      <button 
                        onClick={() => handleSaveSnapshot('certified')}
                        disabled={isSaving}
                        className="mt-4 flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2.5 rounded-lg font-medium transition-colors shadow-sm text-sm disabled:opacity-50"
                      >
                        <FileCheck2 className="w-4 h-4" />
                        {isSaving ? "Certifying..." : "Certify & Submit Report"}
                      </button>
                    )
                  ) : (
                    <button 
                      disabled
                      className="mt-4 flex items-center gap-2 bg-emerald-800 text-white px-5 py-2.5 rounded-lg font-medium shadow-sm text-sm opacity-50 cursor-not-allowed"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      Report Certified
                    </button>
                  )}
                </div>
              </div>
            )}

            {currentStatus === 'error_variance' && (
              <div className="bg-rose-500/10 border border-rose-500/20 rounded-lg p-5 flex items-start gap-4">
                <XOctagon className="w-6 h-6 text-rose-500 mt-0.5 shrink-0" />
                <div>
                  <h3 className="font-bold text-rose-400">Discrepancy detected — requires investigation</h3>
                  <div className="text-xl font-mono font-bold text-rose-500 mt-1 mb-2">
                    Variance: {variance < 0 ? '-' : ''}₱{Number(Math.abs(variance)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                  <p className="text-sm text-rose-500/80">
                    The tax levy does not equal collections plus delinquencies. Do not submit to COA until this variance is resolved.{' '}
                    {variance > 0 
                      ? "Tax Levy (A) exceeds Collections (B) + Delinquencies (C). Suggest reviewing Assessor's data for potential overassessments."
                      : "Collections (B) + Delinquencies (C) exceed Tax Levy (A). Suggest reviewing Treasurer's collections for duplicated payments."}
                  </p>
                </div>
              </div>
            )}
          </div>

        </div>
      </motion.div>
    </div>
  );
};
