import React, { useState, useEffect } from "react";
import { 
  collection, 
  onSnapshot, 
  addDoc, 
  updateDoc,
  doc,
  deleteDoc,
  query,
  where,
  serverTimestamp,
  getDocs,
  orderBy,
  limit
} from "firebase/firestore";
import { db, auth, OperationType, handleFirestoreError } from "../lib/firebase";
import { addToOfflineQueue } from "../lib/offlineSync";
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
  Trash2,
  Upload
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { logAudit } from "../lib/audit";
import DelinquencyActions from "./DelinquencyActions";
import { TransactionHistoryModal } from "./TransactionHistoryModal";

import { PaymentMigrator } from "./PaymentMigrator";
import { MigrationAuditLogModal } from "./MigrationAuditLogModal";

export default function CollectionModule({ prefillProperty }: { prefillProperty?: Property | null }) {
  const { profile, isEncoder, isAdmin } = useAuth();
  const [delinquencies, setDelinquencies] = useState<Delinquency[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [isPosting, setIsPosting] = useState(false);
  const [isMigrating, setIsMigrating] = useState(false);
  const [isViewingHistory, setIsViewingHistory] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedHistoryProperty, setSelectedHistoryProperty] = useState<Property | null>(null);

  // Secure find, view, and void states
  const [isReadOnlyForm, setIsReadOnlyForm] = useState(false);
  const [isSearchModalOpen, setIsSearchModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearchLoading, setIsSearchLoading] = useState(false);

  const [isVoidDialogOpen, setIsVoidDialogOpen] = useState(false);
  const [voidUsername, setVoidUsername] = useState("");
  const [voidPassword, setVoidPassword] = useState("");
  const [voidReason, setVoidReason] = useState("");
  const [isVoiding, setIsVoiding] = useState(false);
  const [voidError, setVoidError] = useState("");
  
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
        !p.isArchived && (
          p.tdNumber.toLowerCase().includes(propSearch.toLowerCase()) ||
          p.ownerName.toLowerCase().includes(propSearch.toLowerCase())
        )
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
    
    setIsAssessing(true);
    try {
      // Fetch all delinquencies for this property
      const q = query(
        collection(db, "delinquencies"), 
        where("propertyId", "==", prop.id)
      );
      const snap = await getDocs(q);
      const allRecords = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Delinquency));
      
      // Fetch all payments for this property to know what's paid
      const pq = query(
        collection(db, "payments"),
        where("propertyId", "==", prop.id),
        where("status", "==", "Active")
      );
      const psnap = await getDocs(pq);
      const payments = psnap.docs.map(doc => doc.data() as Payment);

      const currentYear = new Date().getFullYear();
      
      // Determine the effective starting year for assessing delinquencies
      let startYear = currentYear;
      if (prop.effectivityDate) {
        let extractedYear = NaN;
        if (prop.effectivityDate.includes('-')) {
          extractedYear = new Date(prop.effectivityDate).getFullYear();
        } else {
          extractedYear = parseInt(prop.effectivityDate, 10);
        }
        if (!isNaN(extractedYear)) {
          startYear = extractedYear;
        }
      }
      if (startYear > currentYear) startYear = currentYear;

      // We only display unpaid ones in the collection form
      let list = allRecords.filter(d => d.status === "Delinquent" || d.status === "Pending" || d.status === "NOTICE_ISSUED");
      
      // Deduplicate in case of React strict-mode double inserts
      const uniqueYears = new Set<number>();
      const duplicatesToDelete: string[] = [];
      list = list.filter(d => {
        if (uniqueYears.has(d.year)) {
          duplicatesToDelete.push(d.id);
          return false;
        }
        uniqueYears.add(d.year);
        return true;
      });

      // Cleanup duplicated records from DB
      for (const dupId of duplicatesToDelete) {
        try {
          await deleteDoc(doc(db, "delinquencies", dupId));
        } catch (e) {}
      }

      let newlyCreatedCount = 0;

      // Automate generation of missing delinquency records up to current year
      for (let y = startYear; y <= currentYear; y++) {
        const hasDelinq = allRecords.some(d => d.year === y);
        const hasPayment = payments.some(p => p.taxYear === y);

        if (!hasDelinq && !hasPayment) {
          const basicTax = prop.assessedValue * BASIC_TAX_RATE;
          const sefTax = prop.assessedValue * SEF_TAX_RATE;
          const calc = calculateTotalDue(basicTax, sefTax, y);

          const newDelinq = {
            propertyId: prop.id,
            year: y,
            basicTaxDue: basicTax,
            sefTaxDue: sefTax,
            penalty: 0,
            interest: calc.interest,
            totalDue: calc.totalDue,
            totalPaid: 0,
            status: y === currentYear ? "Pending" : "Delinquent" as const,
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
          allRecords.push(added); // update local copy too for later
          newlyCreatedCount++;
          
          // Log only for the current year or if bulk
          if (y === currentYear) {
             await logAudit("CREATE", "Delinquency (Auto Assess)", `Year ${y} for ${prop.tdNumber}`, null, newDelinq);
          }
        }
      }
      
      if (newlyCreatedCount > 1) {
        // Just log a bulk event if multiple were generated (historic gaps)
         await logAudit("CREATE", "Delinquency (Auto Assess Bulk)", `Generated ${newlyCreatedCount} missing records for ${prop.tdNumber}`, null, { count: newlyCreatedCount });
      }

      setAllPropertyYears(allRecords.map(r => r.year));
      setFormDelinquencies(list.sort((a, b) => a.year - b.year));
      setSelectedDelinqIds(new Set(list.map(d => d.id)));

    } catch (err: any) {
      console.error("Data Fetch/Auto-Assess Error:", err);
    } finally {
      setIsAssessing(false);
    }
  };

  useEffect(() => {
    if (prefillProperty) {
      setIsPosting(true);
      handleSelectProperty(prefillProperty);
    }
  }, [prefillProperty]);

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

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const handlePostPayment = async () => {
    const errors: Record<string, string> = {};
    
    if (!selectedProperty) {
      errors.property = "Property is required.";
    }
    if (selectedDelinqIds.size === 0) {
      errors.records = "Select at least one record.";
    }
    if (!orNumber.trim()) {
      errors.orNumber = "O.R. Number is required.";
    }
    if (!orDate) {
      errors.orDate = "O.R. Date is required.";
    }
    if (!taxPayer.trim()) {
      errors.taxPayer = "Tax Payer name is required.";
    }
    if (!treasurer.trim()) {
      errors.treasurer = "Treasurer name is required.";
    }
    if (!deputy.trim()) {
      errors.deputy = "Deputy name is required.";
    }
    if (paymentMode === "Installment" && quarters.length === 0) {
      errors.quarters = "Select at least one quarter.";
    }
    if (cashTendered <= 0) {
      errors.cashTendered = "Cash Tendered is required.";
    } else if (cashTendered < (formTotals.total - 0.01)) {
      errors.cashTendered = "Insufficient funds.";
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});

    setIsSubmitting(true);

    if (!navigator.onLine) {
      try {
        const batchRows = displayRows.filter(row => row.ids.every(id => selectedDelinqIds.has(id)));
        if (batchRows.length === 0) {
          throw new Error("Selection resolved to zero records.");
        }

        const paymentDetailsList = [];
        for (const row of batchRows) {
          for (const dataRecord of row.records) {
            const calc = calculateTotalDue(dataRecord.basicTaxDue, dataRecord.sefTaxDue, dataRecord.year, orDate ? new Date(orDate) : new Date(), 0, paymentMode, quarters, isAdvance);
            paymentDetailsList.push({
              delinquencyId: dataRecord.id,
              year: dataRecord.year,
              basicTaxDue: dataRecord.basicTaxDue,
              sefTaxDue: dataRecord.sefTaxDue,
              totalDue: calc.totalDue,
              interest: calc.interest,
              discount: calc.discount || 0,
              isAdvanceVirtual: dataRecord.isAdvanceVirtual || false
            });
          }
        }

        const taskData = {
          selectedProperty,
          orNumber,
          orDate,
          taxPayer,
          paymentMode,
          quarters,
          isAdvance,
          isCash,
          checkNumber,
          checkPayee,
          checkDate,
          isCheck,
          treasurer,
          deputy,
          paymentDetailsList,
          recordedBy: profile?.username || profile?.displayName || auth.currentUser?.email || "System"
        };

        addToOfflineQueue("RECORD_PAYMENT", taskData, `Payment O.R. ${orNumber.trim()} (Offline)`);
        
        setErrorDialog({
          isOpen: true,
          title: "Offline Transaction Cached",
          message: `The payment of ${formatCurrency(formTotals.total)} under O.R. Number ${orNumber.trim()} was successfully cached locally in Offline Mode!\n\nIt will be automatically synced with the server once your connection is restored.`,
          type: "success"
        });
        setIsPosting(false);
        resetForm();
        return;
      } catch (err: any) {
        console.error("Offline draft error:", err);
        setErrorDialog({
          isOpen: true,
          title: "Failed to cache transaction",
          message: `Could not save offline transaction: ${err.message}`,
          type: "danger"
        });
        return;
      } finally {
        setIsSubmitting(false);
      }
    }

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
        throw new Error(`CRITICAL: Duplicate O.R. detected. The Official Receipt Number '${orNumber}' has already been recorded and is currently active.`);
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
              status: "Pending" as const,
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
            
            // Check for identical O.R. Number for this Year and PIN
            const hasDuplicateOR = existingRecords.some(r => r.orNumber === orNumber.trim());
            if (hasDuplicateOR) {
              throw new Error(`Duplicate Payment Detected: This OR is already recorded for this Tax Year.`);
            }

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
            const dsQuery = query(
              collection(db, "delinquencies"),
              where("propertyId", "==", selectedProperty.id),
              where("year", "==", dataRecord.year)
            );
            const dsSnap = await getDocs(dsQuery);
            for (const delinqDoc of dsSnap.docs) {
              await updateDoc(doc(db, "delinquencies", delinqDoc.id), {
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
            }
          } catch (err) {
            handleFirestoreError(err, OperationType.UPDATE, `delinquencies?propertyId=${selectedProperty.id}&year=${dataRecord.year}`);
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

  useEffect(() => {
    if (!isSearchModalOpen) return;
    
    setIsSearchLoading(true);
    const paymentsRef = collection(db, "payments");
    const unsub = onSnapshot(paymentsRef, (snapshot) => {
      const allPmts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      const matched = allPmts.filter((p: any) => {
        if (p.status === "VOID" || p.status === "Voided") return false;

        const ownerName = (p.payerName || "").toLowerCase();
        const orNum = (p.orNumber || "").toLowerCase();
        const prop = properties.find(prop => prop.id === p.propertyId);
        if (!prop || prop.isArchived) return false;
        
        const tdn = (prop?.tdNumber || "").toLowerCase();

        const q = searchQuery.toLowerCase().trim();
        return orNum.includes(q) || tdn.includes(q) || ownerName.includes(q);
      });
      
      const groupedPmts: Record<string, any> = {};
      matched.forEach((p: any) => {
        const prop = properties.find(prop => prop.id === p.propertyId);
        const tdn = prop?.tdNumber || "—";
        if (!groupedPmts[p.orNumber]) {
          groupedPmts[p.orNumber] = {
            ...p,
            tdNumber: tdn,
            years: [p.taxYear],
            totalAmount: p.amountPaid
          };
        } else {
          if (!groupedPmts[p.orNumber].years.includes(p.taxYear)) {
            groupedPmts[p.orNumber].years.push(p.taxYear);
          }
          groupedPmts[p.orNumber].totalAmount += p.amountPaid;
        }
      });

      setSearchResults(Object.values(groupedPmts));
      setIsSearchLoading(false);
    }, (error) => {
      console.error("Failed to fetch payments:", error);
      setIsSearchLoading(false);
    });

    return () => unsub();
  }, [isSearchModalOpen, searchQuery, properties]);

  const handleSelectReceipt = async (paymentRecord: any) => {
    setIsReadOnlyForm(true);
    const prop = properties.find(p => p.id === paymentRecord.propertyId);
    if (prop) {
      setSelectedProperty(prop);
      setPropSearch(prop.tdNumber);
    }
    setOrNumber(paymentRecord.orNumber);
    setOrDate(paymentRecord.paymentDate);
    setTaxPayer(paymentRecord.payerName);
    setTreasurer(paymentRecord.treasurer || "");
    setDeputy(paymentRecord.deputy || "");
    
    if (paymentRecord.paymentType && paymentRecord.paymentType.startsWith("Installment")) {
      setPaymentMode("Installment");
      const match = paymentRecord.paymentType.match(/\(([^)]+)\)/);
      if (match) {
        setQuarters(match[1].split(",").map((q: string) => q.trim()));
      } else {
        setQuarters([]);
      }
    } else {
      setPaymentMode("Full");
      setQuarters([]);
    }
    
    setIsAdvance(paymentRecord.isAdvance || false);
    setIsCash(paymentRecord.settlementMethod === "Cash");
    setIsCheck(paymentRecord.settlementMethod === "Check");
    if (paymentRecord.checkDetails) {
      setCheckNumber(paymentRecord.checkDetails.number || "");
      setCheckPayee(paymentRecord.checkDetails.payee || "");
      setCheckDate(paymentRecord.checkDetails.date || "");
    } else {
      setCheckNumber("");
      setCheckPayee("");
      setCheckDate(new Date().toISOString().split('T')[0]);
    }
    setCashTendered(paymentRecord.amountPaid || 0);

    try {
      const pmtsSnap = await getDocs(query(
        collection(db, "payments"),
        where("orNumber", "==", paymentRecord.orNumber)
      ));
      const paymentList = pmtsSnap.docs.map(doc => doc.data());
      const delinquencyIds = paymentList.map(p => p.delinquencyId);
      
      const delinqsList: Delinquency[] = [];
      for (const id of delinquencyIds) {
        if (id) {
          const dSnap = await getDocs(query(collection(db, "delinquencies"), where("id", "==", id)));
          dSnap.forEach(docDoc => {
            delinqsList.push({ id: docDoc.id, ...docDoc.data() } as Delinquency);
          });
        }
      }
      
      if (delinqsList.length === 0) {
        paymentList.forEach((p: any) => {
          delinqsList.push({
            id: p.delinquencyId || p.orNumber + "-" + p.taxYear,
            propertyId: p.propertyId,
            year: p.taxYear,
            basicTaxDue: p.basicPaid || 0,
            sefTaxDue: p.sefPaid || 0,
            penalty: p.penaltyPaid || 0,
            interest: p.penaltyPaid || 0,
            totalDue: p.amountPaid || 0,
            totalPaid: p.amountPaid || 0,
            status: "Paid"
          } as unknown as Delinquency);
        });
      }

      setFormDelinquencies(delinqsList.sort((a, b) => a.year - b.year));
      setSelectedDelinqIds(new Set(delinqsList.map(d => d.id)));
    } catch (e) {
      console.error("Error loading delinquencies for record:", e);
    }
    setIsSearchModalOpen(false);
  };

  const handleVoidRecord = async (e: React.FormEvent) => {
    e.preventDefault();
    setVoidError("");
    setIsVoiding(true);

    if (!voidUsername.trim()) {
      setVoidError("Admin Username/Email is required.");
      setIsVoiding(false);
      return;
    }
    if (!voidPassword) {
      setVoidError("Admin Password is required.");
      setIsVoiding(false);
      return;
    }
    if (!voidReason.trim()) {
      setVoidError("Reason for voiding is required.");
      setIsVoiding(false);
      return;
    }

    try {
      const response = await fetch("/api/payments/invalidate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          adminEmail: voidUsername.trim(),
          adminPassword: voidPassword,
          orNumber: orNumber.trim(),
          reason: voidReason.trim()
        })
      });

      const responseText = await response.text();
      let data: any = null;
      
      try {
        data = JSON.parse(responseText);
      } catch (jsonErr) {
        if (!response.ok) {
          throw new Error(`Server returned error status ${response.status}: ${responseText.substring(0, 200)}`);
        }
      }

      if (!response.ok) {
        throw new Error(data?.error || "Failed to void payment record.");
      }

      setIsVoidDialogOpen(false);
      setVoidUsername("");
      setVoidPassword("");
      setVoidReason("");
      
      setErrorDialog({
        isOpen: true,
        title: "Record Voided Successfully",
        message: `The payment record for O.R. Number ${orNumber} has been successfully voided and audited. All associated delinquencies have been reset to active.`,
        type: "success"
      });

      setIsReadOnlyForm(false);
      setIsPosting(false);
      resetForm();
    } catch (err: any) {
      console.error(err);
      setVoidError(err.message || "An unexpected error occurred during voiding.");
    } finally {
      setIsVoiding(false);
    }
  };

  const resetForm = () => {
    setFieldErrors({});
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
    setIsReadOnlyForm(false);
  };

  const groupedPaid = React.useMemo(() => {
    const groups: Record<string, any> = {};
    delinquencies.forEach(d => {
      const prop = properties.find(p => p.id === d.propertyId);
      if (!prop || prop.isArchived) return;

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
        {isEncoder && (
          <div className="flex items-center gap-2">
            <button 
              onClick={() => setIsViewingHistory(true)}
              className="flex items-center gap-2 px-5 py-2.5 bg-transparent border border-slate-700 text-slate-300 rounded-xl hover:bg-slate-800 transition font-bold text-xs uppercase tracking-wider"
            >
              <History className="w-4 h-4 text-slate-400" />
              Import History
            </button>
            <button 
              onClick={() => setIsMigrating(true)}
              className="flex items-center gap-2 px-5 py-2.5 bg-transparent border border-blue-500/50 text-blue-400 rounded-xl hover:bg-blue-500/10 hover:border-blue-500 transition font-bold text-xs uppercase tracking-wider"
            >
              <Upload className="w-4 h-4" />
              Migrate Data
            </button>
            <button 
              onClick={() => setIsPosting(true)}
              className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-500 transition shadow-lg shadow-blue-600/20 font-bold text-xs uppercase tracking-wider"
            >
              <Receipt className="w-4 h-4" />
              Post Payment Record
            </button>
          </div>
        )}
      </div>

      {/* LEDGER TABLE */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl">
        <div className="p-4 border-b border-slate-800 bg-slate-900/50 flex items-center gap-4">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input 
              type="text" 
              placeholder="Search paid records by Owner or TDN..." 
              className="w-full pl-10 pr-4 py-2 border border-slate-800 rounded-xl bg-slate-950 text-slate-300 text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all"
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
                <tr key={group.property.id} className="hover:bg-blue-500/[0.02] transition-colors">
                  <td className="px-6 py-5">
                    <div className="flex flex-col">
                      <span className="font-bold text-slate-200 text-sm tracking-tight">{group.property.ownerName}</span>
                      <span className="text-[10px] font-mono text-slate-500 font-bold uppercase tracking-widest">{group.property.tdNumber}</span>
                    </div>
                  </td>
                  <td className="px-6 py-5 text-xs text-slate-400 text-center font-bold tracking-widest">
                    {group.minYear === group.maxYear ? group.minYear : `${group.minYear} – ${group.maxYear}`}
                    <div className="text-[10px] text-blue-500 mt-0.5">{group.records.length} paid record(s)</div>
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
                      onClick={() => setSelectedHistoryProperty(group.property)}
                      className="flex items-center gap-2 px-3 py-1.5 bg-blue-600/10 hover:bg-blue-500 hover:text-white text-blue-400 rounded-lg text-[10px] transition-all border border-blue-500/20 font-black cursor-pointer"
                    >
                      <History className="w-3.5 h-3.5" />
                      View Payment History
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
               isEncoder={isEncoder}
               isAdmin={isAdmin}
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
                  <div className="p-3 bg-blue-500/10 rounded-2xl">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="24"
                      height="24"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="w-6 h-6 text-blue-400"
                    >
                      <path d="M6 18V4h6a5 5 0 0 1 5 5v0a5 5 0 0 1-5 5H6" />
                      <path d="M3 8h12" />
                      <path d="M3 12h12" />
                    </svg>
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

              <div className="flex-1 overflow-y-auto bg-[#0a0c10]">
                {/* Balanced and standard padding with unified vertical flex spacing */}
                <div className="p-6 flex flex-col gap-6 w-full box-border">
                  {/* SECTION 1: TOP INFORMATION PANEL */}
                  <div className="space-y-4 w-full box-border">
                    <h4 className="text-xs font-black text-blue-400 uppercase tracking-[0.2em] flex items-center gap-2 mb-4">
                      <div className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                      • I. RECEIPT DETAILS
                    </h4>
                    <div className="w-full box-border" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem' }}>
                    {/* O.R. NO */}
                    <div className="flex flex-col space-y-1.5">
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-1">O.R. NO</label>
                      <input 
                        type="text" 
                        value={orNumber}
                        onChange={e => setOrNumber(e.target.value)}
                        disabled={isSubmitting || isReadOnlyForm}
                        className={cn(
                          "w-full h-10 px-4 bg-slate-950 border rounded-xl text-slate-200 focus:ring-2 focus:ring-blue-500 outline-none transition-all font-mono text-xs",
                          fieldErrors.orNumber ? "border-red-500/50 bg-red-500/5" : "border-slate-800"
                        )}
                        placeholder="Receipt Number..."
                      />
                    </div>

                    {/* O.R. DATE */}
                    <div className="flex flex-col space-y-1.5">
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-1">O.R. DATE</label>
                      <input 
                        type="date" 
                        value={orDate}
                        onChange={e => setOrDate(e.target.value)}
                        disabled={isReadOnlyForm}
                        className={cn(
                          "w-full h-10 px-4 bg-slate-950 border rounded-xl text-slate-200 focus:ring-2 focus:ring-blue-500 outline-none transition-all [color-scheme:dark] text-xs",
                          fieldErrors.orDate ? "border-red-500/50 bg-red-500/5" : "border-slate-800"
                        )}
                      />
                    </div>

                    {/* TD No / ARP No (Search Input) */}
                    <div className="flex flex-col space-y-1.5 relative">
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-1">Search Property (TD/ARP)</label>
                      <div className="relative">
                        <input 
                          type="text" 
                          value={propSearch}
                          onChange={e => setPropSearch(e.target.value)}
                          disabled={isReadOnlyForm}
                          className={cn(
                            "w-full h-10 pl-4 pr-10 bg-slate-950 border rounded-xl text-slate-200 focus:ring-2 focus:ring-blue-500 outline-none transition-all text-xs",
                            fieldErrors.property ? "border-red-500/50 bg-red-500/5" : "border-slate-800"
                          )}
                          placeholder="Search property..."
                        />
                        <Search className="w-4 h-4 absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
                      </div>
                      {propSearchResults.length > 0 && (
                        <div className="absolute top-full left-0 right-0 mt-1 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl z-[110] overflow-hidden">
                          {propSearchResults.map(p => (
                            <button 
                              key={p.id}
                              type="button"
                              onClick={() => handleSelectProperty(p)}
                              className="w-full p-2 text-left hover:bg-blue-500/10 border-b border-slate-800 last:border-0 transition-colors"
                            >
                              <p className="text-[10px] font-bold text-white uppercase">{p.tdNumber}</p>
                              <p className="text-[8px] text-slate-500">{p.ownerName}</p>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* ARP/Tax DEC. NO. display */}
                    <div className="flex flex-col space-y-1.5">
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-1">ARP/Tax DEC. NO.</label>
                      <div className="w-full h-10 px-4 bg-slate-950 border border-slate-800 rounded-xl flex items-center justify-between text-slate-300 text-xs truncate">
                        <span className="font-mono">{selectedProperty?.tdNumber || "No property selected"}</span>
                        {selectedProperty && (
                          <button
                            type="button"
                            onClick={() => setSelectedHistoryProperty(selectedProperty)}
                            className="px-2.5 py-1 bg-blue-600/10 hover:bg-blue-600/20 text-blue-400 rounded-lg text-[9px] border border-blue-500/20 hover:border-blue-500/30 transition-all font-black uppercase tracking-wider cursor-pointer"
                          >
                            Show History
                          </button>
                        )}
                      </div>
                    </div>

                    {/* TAX PAYER input */}
                    <div className="flex flex-col space-y-1.5">
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-1">TAX PAYER</label>
                      <input 
                        type="text" 
                        value={taxPayer}
                        onChange={e => setTaxPayer(e.target.value)}
                        disabled={isReadOnlyForm}
                        className={cn(
                          "w-full h-10 px-4 bg-slate-950 border rounded-xl text-slate-200 focus:ring-2 focus:ring-blue-500 outline-none transition-all text-xs",
                          fieldErrors.taxPayer ? "border-red-500/50 bg-red-500/5" : "border-slate-800"
                        )}
                        placeholder="Name of payer..."
                      />
                    </div>

                    {/* KIND (display) */}
                    <div className="flex flex-col space-y-1.5">
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-1">KIND (Classification)</label>
                      <div className="w-full h-10 px-4 bg-slate-950 border border-slate-800 rounded-xl flex items-center text-slate-300 text-xs truncate">
                        {selectedProperty?.classification || "---"}
                      </div>
                    </div>

                    {/* OWNER, OWNER ADDRESS, LOCATION, LOT NO (2-Column Symmetrical Grid Layout) */}
                    <div style={{ gridColumn: 'span 3', display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1rem' }} className="w-full box-border">
                      {/* OWNER */}
                      <div className="flex flex-col space-y-1.5">
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-1">OWNER</label>
                        <div className="w-full h-10 px-4 bg-slate-950 border border-slate-800 rounded-xl flex items-center text-slate-300 text-xs truncate">
                          {selectedProperty?.ownerName || "---"}
                        </div>
                      </div>

                      {/* OWNER ADDRESS */}
                      <div className="flex flex-col space-y-1.5">
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-1">OWNER ADDRESS</label>
                        <div className="w-full h-10 px-4 bg-slate-950 border border-slate-800 rounded-xl flex items-center text-slate-300 text-xs truncate">
                          {selectedProperty?.ownerAddress || "---"}
                        </div>
                      </div>

                      {/* LOCATION */}
                      <div className="flex flex-col space-y-1.5">
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-1">LOCATION</label>
                        <div className="w-full h-10 px-4 bg-slate-950 border border-slate-800 rounded-xl flex items-center text-slate-300 text-xs truncate">
                          {selectedProperty ? `${selectedProperty.barangay}, ${selectedProperty.municipality}` : "---"}
                        </div>
                      </div>

                      {/* LOT NO. */}
                      <div className="flex flex-col space-y-1.5">
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-1">LOT NO.</label>
                        <div className="w-full h-10 px-4 bg-slate-950 border border-slate-800 rounded-xl flex items-center text-slate-300 text-xs truncate">
                          {selectedProperty?.lotNo || "---"}
                        </div>
                      </div>
                    </div>

                    {/* TREASURER & DEPUTY (Symmetrical Layout) */}
                    <div style={{ gridColumn: 'span 3', display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1rem' }} className="w-full box-border">
                      {/* TREASURER */}
                      <div className="flex flex-col space-y-1.5">
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-1">TREASURER</label>
                        <input 
                          type="text" 
                          value={treasurer}
                          onChange={e => setTreasurer(e.target.value)}
                          disabled={isReadOnlyForm}
                          className={cn(
                            "w-full h-10 px-4 bg-slate-950 border rounded-xl text-slate-200 focus:ring-2 focus:ring-blue-500 outline-none transition-all text-xs",
                            fieldErrors.treasurer ? "border-red-500/50 bg-red-500/5" : "border-slate-800"
                          )}
                        />
                      </div>

                      {/* DEPUTY */}
                      <div className="flex flex-col space-y-1.5">
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-1">DEPUTY</label>
                        <input 
                          type="text" 
                          value={deputy}
                          onChange={e => setDeputy(e.target.value)}
                          disabled={isReadOnlyForm}
                          className={cn(
                            "w-full h-10 px-4 bg-slate-950 border rounded-xl text-slate-200 focus:ring-2 focus:ring-blue-500 outline-none transition-all text-xs",
                            fieldErrors.deputy ? "border-red-500/50 bg-red-500/5" : "border-slate-800"
                          )}
                        />
                      </div>
                    </div>

                    {/* PAYMENT MODE CONTAINER */}
                    <div 
                      className={cn(
                        "p-5 bg-slate-950/40 border rounded-2xl flex flex-col relative group text-xs w-full box-border",
                        fieldErrors.quarters ? "border-red-500 ring-1 ring-red-500/50" : "border-slate-800/80"
                      )}
                      style={{ gridColumn: 'span 3' }}
                    >
                      <div className="flex items-center justify-between border-b border-slate-800/80 pb-2 mb-3">
                        <label className="text-[10px] font-bold text-blue-400 uppercase tracking-widest block font-sans">Payment Mode</label>
                        <label className={cn("flex items-center gap-2", isReadOnlyForm ? "cursor-not-allowed" : "cursor-pointer")}>
                          <input 
                            type="checkbox" 
                            checked={isAdvance}
                            onChange={e => setIsAdvance(e.target.checked)}
                            disabled={isSubmitting || isReadOnlyForm}
                            className="w-3.5 h-3.5 accent-emerald-500 rounded-md disabled:opacity-50 disabled:cursor-not-allowed"
                          />
                          <span className={cn("text-[9px] font-black uppercase tracking-wider transition-colors", isAdvance ? "text-emerald-400" : "text-slate-500")}>Advance Payment (20%)</span>
                        </label>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-y-4 md:gap-x-6 items-center">
                        <label className={cn("flex items-center gap-2.5 cursor-pointer group", isReadOnlyForm && "cursor-not-allowed")}>
                          <input 
                            type="radio" 
                            checked={paymentMode === "Full"} 
                            onChange={() => setPaymentMode("Full")} 
                            disabled={isSubmitting || isReadOnlyForm} 
                            className="w-4 h-4 accent-blue-500 disabled:opacity-50" 
                          />
                          <span className="text-xs font-bold text-slate-300 group-hover:text-white transition-colors">Full Annual Payment</span>
                        </label>

                        <label className={cn("flex items-center gap-2.5 cursor-pointer group", isReadOnlyForm && "cursor-not-allowed")}>
                          <input 
                            type="radio" 
                            checked={paymentMode === "Installment"} 
                            onChange={() => { setPaymentMode("Installment"); setQuarters(["1st Qtr", "2nd Qtr", "3rd Qtr", "4th Qtr"]); }} 
                            disabled={isSubmitting || isReadOnlyForm} 
                            className="w-4 h-4 accent-blue-500 disabled:opacity-50" 
                          />
                          <span className="text-xs font-bold text-slate-300 group-hover:text-white transition-colors">Installment (Quarterly)</span>
                        </label>

                        <div className={cn("grid grid-cols-2 gap-2 transition-all", paymentMode === "Full" ? "opacity-20 pointer-events-none" : "opacity-100")}>
                          {["1st Qtr", "2nd Qtr", "3rd Qtr", "4th Qtr"].map((qtr) => (
                            <label key={qtr} className={cn("flex items-center gap-2 cursor-pointer group", isReadOnlyForm && "cursor-not-allowed")}>
                              <input 
                                type="checkbox" 
                                checked={quarters.includes(qtr)}
                                disabled={paymentMode === "Full" || isReadOnlyForm}
                                onChange={e => handleQuarterToggle(qtr, e.target.checked)}
                                className="w-3.5 h-3.5 accent-blue-500 disabled:opacity-50" 
                              />
                              <span className="text-[10px] font-bold text-slate-400 group-hover:text-slate-200 transition-colors uppercase tracking-wider">{qtr}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* SECTION 2: MIDDLE DATA TABLE */}
                <div className="space-y-4 w-full box-border">
                  <h4 className="text-xs font-bold text-blue-500 uppercase tracking-[0.2em]">
                    • II. ASSESSMENT BREAKDOWN
                  </h4>
                <div className={cn("border rounded-2xl overflow-hidden shadow-xl bg-slate-950/20 w-full box-border", fieldErrors.records ? "border-red-500 ring-1 ring-red-500/50" : "border-slate-800")}>
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
                        <th className="px-4 py-2 font-bold text-blue-400 uppercase tracking-widest text-[8px] text-right">Total</th>
                        <th className="px-4 py-2 font-bold text-slate-300 uppercase tracking-widest text-[8px] text-right">Balance</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                      {displayRows.map(row => {
                        const isSelected = row.ids.every((id: string) => selectedDelinqIds.has(id));
                        return (
                          <tr 
                            key={`${row.ids.join(',')}-${row.quarterLabel || 'full'}`} 
                            className={cn("hover:bg-white/[0.02] h-8 cursor-pointer select-none", !isSelected && "opacity-50")}
                            onClick={(e) => {
                              if (paymentMode === "Full" || isReadOnlyForm) return;
                              if ((e.target as HTMLElement).tagName === 'INPUT') return;
                              const next = new Set(selectedDelinqIds);
                              if (!isSelected) {
                                row.ids.forEach((id: string) => next.add(id));
                              } else {
                                row.ids.forEach((id: string) => next.delete(id));
                              }
                              setSelectedDelinqIds(next);
                            }}
                          >
                            <td className="px-4 py-1">
                              <input 
                                type="checkbox" 
                                checked={isSelected}
                                disabled={paymentMode === "Full" || isReadOnlyForm}
                                onChange={e => {
                                   const next = new Set(selectedDelinqIds);
                                   if (e.target.checked) row.ids.forEach((id: string) => next.add(id));
                                   else row.ids.forEach((id: string) => next.delete(id));
                                   setSelectedDelinqIds(next);
                                }}
                                className="w-3.5 h-3.5 accent-blue-500" 
                              />
                            </td>
                            <td className="px-4 py-1 font-mono text-slate-500">{selectedProperty?.tdNumber}</td>
                            <td className="px-4 py-1 text-center font-bold text-slate-200">
                              {row.yearDisplay}
                              {row.type === 'group' && <span className="block text-[7px] text-blue-500 font-black">CONSOLIDATED</span>}
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
              </div>

              {/* SECTION 3: BOTTOM PAYMENT DETAILS */}
              <div className="space-y-4 w-full box-border">
                <h4 className="text-xs font-bold text-blue-500 uppercase tracking-[0.2em]">
                  • III. SETTLEMENT DETAILS
                </h4>

                <div className="mt-2 space-y-3 w-full box-border">
                  {/* 2-Column Payment Inputs Grid */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-stretch w-full box-border">
                    {/* Column 1: Tender & Change */}
                    <div className="bg-slate-950/40 border border-slate-800/80 rounded-2xl p-5 flex flex-col justify-between h-full shadow-lg w-full box-border">
                       <div className="space-y-4">
                         {/* Integrated Amount Due Display */}
                         <div className="flex justify-between items-start border-b border-slate-800 pb-3">
                            <div>
                               <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block pl-1">Liability Amount</span>
                               <span className="text-[11px] font-black text-blue-400 uppercase tracking-widest block pl-1">Total Assessment Due</span>
                            </div>
                            <span className="text-xl font-black text-white">{formatCurrency(formTotals.total)}</span>
                         </div>

                         <div className="flex flex-col space-y-1.5">
                           <div className="flex justify-between items-center">
                             <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-1">Cash Tendered</label>
                             {fieldErrors.cashTendered && <span className="text-[9px] font-bold text-red-500 uppercase tracking-widest">{fieldErrors.cashTendered}</span>}
                           </div>
                           <div className="relative">
                              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-600 font-bold text-sm">₱</span>
                              <input 
                                type="number" 
                                value={cashTendered || ""}
                                onChange={e => setCashTendered(parseFloat(e.target.value) || 0)}
                                disabled={isReadOnlyForm}
                                className={cn(
                                  "w-full h-11 bg-slate-950 border rounded-xl pl-9 pr-4 text-base font-black text-white outline-none transition-all disabled:opacity-75 disabled:cursor-not-allowed",
                                  fieldErrors.cashTendered ? "border-red-500/50 bg-red-500/5" : "border-slate-800 focus:ring-2 focus:ring-blue-500"
                                )}
                                placeholder="0.00"
                              />
                           </div>
                         </div>
                       </div>
                       <div className="flex justify-between items-center bg-slate-950 border border-slate-800 p-4 rounded-xl mt-6">
                          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-1">Change / Surplus</span>
                          <span className={cn("text-lg font-black", balance >= 0 ? "text-emerald-400" : "text-red-500")}>
                            {formatCurrency(Math.abs(balance))}
                          </span>
                       </div>
                    </div>

                    {/* Column 2: Settlement Method */}
                    <div className="bg-slate-950/40 border border-slate-800/80 rounded-2xl p-5 flex flex-col h-full overflow-hidden w-full box-border">
                       <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block pl-1 border-b border-slate-800 pb-2 mb-4 w-full text-left">Settlement Method</label>
                       <div className="space-y-3 flex-1 flex flex-col">
                         <div className="flex gap-4">
                           <button 
                             type="button" disabled={isReadOnlyForm} onClick={() => { if (!isReadOnlyForm) { setIsCash(true); setIsCheck(false); } }}
                             className={cn(
                               "flex-1 h-11 rounded-xl border flex items-center justify-center gap-2.5 transition-all text-xs font-bold",
                               isCash ? "bg-blue-600/10 border-blue-500/40 text-blue-400" : "bg-slate-950 border-slate-800 text-slate-500 hover:border-slate-700",
                               isReadOnlyForm && "opacity-50 cursor-not-allowed"
                             )}
                           >
                             <div className={cn("w-3 h-3 rounded-full border-2 transition-colors", isCash ? "bg-blue-500 border-blue-400" : "border-slate-700")} />
                             <span className="uppercase tracking-wider whitespace-nowrap">Cash Settlement</span>
                           </button>
                           <button 
                             type="button" disabled={isReadOnlyForm} onClick={() => { if (!isReadOnlyForm) { setIsCash(false); setIsCheck(true); } }}
                             className={cn(
                               "flex-1 h-11 rounded-xl border flex items-center justify-center gap-2.5 transition-all text-xs font-bold",
                               isCheck ? "bg-blue-600/10 border-blue-500/40 text-blue-400" : "bg-slate-950 border-slate-800 text-slate-500 hover:border-slate-700",
                               isReadOnlyForm && "opacity-50 cursor-not-allowed"
                             )}
                           >
                             <div className={cn("w-3 h-3 rounded-full border-2 transition-colors", isCheck ? "bg-blue-500 border-blue-400" : "border-slate-700")} />
                             <span className="uppercase tracking-wider whitespace-nowrap">Check Settlement</span>
                           </button>
                         </div>

                         <div className={cn(
                           "grid grid-cols-2 gap-2 mt-1 transition-all duration-300",
                           !isCheck ? "opacity-30 pointer-events-none" : "opacity-100"
                         )}>
                           <div className="space-y-1">
                             <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-1">Check Number</label>
                             <input 
                               type="text" 
                               value={checkNumber}
                               disabled={!isCheck || isReadOnlyForm}
                               onChange={e => setCheckNumber(e.target.value)}
                               className="w-full h-10 bg-slate-950 border border-slate-800 rounded-xl px-4 text-xs text-white focus:ring-2 focus:ring-blue-500 outline-none disabled:opacity-75 disabled:cursor-not-allowed"
                               placeholder="Enter No..."
                             />
                           </div>
                           <div className="space-y-1">
                             <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-1">Check Date</label>
                             <input 
                               type="date" 
                               value={checkDate}
                               disabled={!isCheck || isReadOnlyForm}
                               onChange={e => setCheckDate(e.target.value)}
                               className="w-full h-10 bg-slate-950 border border-slate-800 rounded-xl px-4 text-xs text-white [color-scheme:dark] focus:ring-2 focus:ring-blue-500 outline-none disabled:opacity-75 disabled:cursor-not-allowed"
                             />
                           </div>
                           <div className="col-span-2 space-y-1">
                             <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-1">Payee / Drawee</label>
                             <input 
                               type="text" 
                               value={checkPayee}
                               disabled={!isCheck || isReadOnlyForm}
                               onChange={e => setCheckPayee(e.target.value)}
                               className="w-full h-10 bg-slate-950 border border-slate-800 rounded-xl px-4 text-xs text-white focus:ring-2 focus:ring-blue-500 outline-none disabled:opacity-75 disabled:cursor-not-allowed"
                               placeholder="Payee Name..."
                             />
                           </div>
                         </div>
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
                  {!isReadOnlyForm && (
                    <button 
                      type="button"
                      onClick={() => {
                        setIsSearchModalOpen(true);
                        setSearchQuery("");
                        setSearchResults([]);
                      }}
                      className="px-6 h-8 text-[9px] font-black uppercase tracking-widest text-slate-300 hover:bg-slate-800 rounded-lg transition-all border border-slate-800 bg-slate-900"
                    >
                      Find
                    </button>
                  )}
                  <button 
                    type="button"
                    onClick={() => {
                      setIsPosting(false);
                      resetForm();
                    }}
                    className="px-6 h-8 text-[9px] font-black uppercase tracking-widest text-slate-400 hover:bg-slate-800 rounded-lg transition-all border border-slate-800"
                  >
                    Cancel
                  </button>
                  {isReadOnlyForm ? (
                    <button 
                      type="button"
                      onClick={() => {
                        setIsVoidDialogOpen(true);
                      }}
                      className="px-6 h-8 text-[9px] font-black uppercase tracking-widest text-red-500 bg-red-950/20 hover:bg-red-950/40 rounded-lg transition-all border border-red-500/30"
                    >
                      Void Record
                    </button>
                  ) : (
                    <button 
                      type="button"
                      onClick={handlePostPayment}
                      disabled={isSubmitting}
                      className={cn(
                        "px-8 h-8 text-[9px] font-black uppercase tracking-widest rounded-lg transition-all shadow-xl font-black",
                        isSubmitting 
                          ? "bg-slate-800 text-slate-500 cursor-not-allowed" 
                          : "bg-blue-600 text-white hover:bg-blue-500 shadow-blue-600/30"
                      )}
                    >
                      {isSubmitting ? "Posting..." : "Post Payment Record"}
                    </button>
                  )}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {selectedHistoryProperty && (
          <TransactionHistoryModal
            property={selectedHistoryProperty}
            onClose={() => setSelectedHistoryProperty(null)}
          />
        )}
      </AnimatePresence>

      {/* MODAL 1: SEARCH POSTED RECEIPTS */}
      <AnimatePresence>
        {isSearchModalOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-[110] flex items-center justify-center p-4"
          >
            <motion.div 
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 20 }}
              className="bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl w-full max-w-4xl flex flex-col max-h-[85vh] overflow-hidden"
            >
              <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-slate-950/50">
                <div>
                  <h3 className="text-base font-bold text-white tracking-tight font-sans">Search Posted Receipts</h3>
                  <p className="text-xs text-slate-500 mt-0.5 font-sans">Find validated payments by O.R. Number, TDN, or Name to view details or void records.</p>
                </div>
                <button 
                  type="button"
                  onClick={() => setIsSearchModalOpen(false)}
                  className="p-1.5 hover:bg-slate-800 text-slate-400 hover:text-white rounded-lg transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-5 border-b border-slate-800 bg-slate-900/40">
                <div className="relative">
                  <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-500" />
                  <input 
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Enter O.R. Number, Tax Declaration Number (TDN), or Payer's Name..."
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-4 py-2 text-xs text-white placeholder-slate-600 focus:border-blue-500 outline-none transition-all font-sans"
                    autoFocus
                  />
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-5">
                {isSearchLoading ? (
                  <div className="flex flex-col items-center justify-center py-20 gap-3">
                    <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                    <p className="text-slate-500 text-xs font-medium font-sans animate-pulse">Searching ledger...</p>
                  </div>
                ) : searchResults.length === 0 ? (
                  <div className="text-center py-20 text-slate-500 italic text-xs font-sans">
                    No matching posted active payment receipts found in the archive folder.
                  </div>
                ) : (
                  <div className="border border-slate-850 rounded-xl overflow-hidden bg-slate-950/20">
                    <table className="w-full text-left text-xs font-sans">
                      <thead className="bg-slate-950 text-slate-500 font-bold border-b border-slate-850">
                        <tr>
                          <th className="px-4 py-3 text-[10px] tracking-widest uppercase">O.R. Number</th>
                          <th className="px-4 py-3 text-[10px] tracking-widest uppercase">Payer / Taxpayer</th>
                          <th className="px-4 py-3 text-[10px] tracking-widest uppercase">Tax Declaration Num</th>
                          <th className="px-4 py-3 text-[10px] tracking-widest uppercase">Years Paid</th>
                          <th className="px-4 py-3 text-[10px] tracking-widest uppercase text-right">Total Amount</th>
                          <th className="px-4 py-3 text-[10px] tracking-widest uppercase text-center">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-850 text-slate-300">
                        {searchResults.map((p) => (
                          <tr key={p.id} className="hover:bg-slate-850/40 transition-colors font-medium">
                            <td className="px-4 py-3 font-mono font-bold text-blue-400">{p.orNumber}</td>
                            <td className="px-4 py-3 font-semibold text-slate-200">{p.payerName || "—"}</td>
                            <td className="px-4 py-3 text-slate-400 font-mono text-xs">{p.tdNumber}</td>
                            <td className="px-4 py-3 text-slate-400">
                              {p.years?.join(", ") || p.taxYear}
                            </td>
                            <td className="px-4 py-3 text-right font-mono text-emerald-400 font-bold">
                              ₱{p.totalAmount ? p.totalAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : (p.amountPaid || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                            </td>
                            <td className="px-4 py-3 text-center">
                              <div className="table-actions">
                                <button
                                  type="button"
                                  onClick={() => handleSelectReceipt(p)}
                                  className="btn-action-primary"
                                >
                                  View Record
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* MODAL 2: VOID CONFIRMATION DIALOG */}
      <AnimatePresence>
        {isVoidDialogOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-slate-950/90 backdrop-blur-sm z-[120] flex items-center justify-center p-4"
          >
            <motion.div 
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 20 }}
              className="bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl w-full max-w-md flex flex-col overflow-hidden"
            >
              <div className="p-5 border-b border-slate-800 flex items-center gap-3 bg-red-950/20">
                <div className="w-10 h-10 bg-red-500/10 text-red-500 rounded-xl flex items-center justify-center border border-red-500/20">
                  <AlertCircle className="w-5 h-5 animate-pulse" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white tracking-tight font-sans">Void Payment Receipt</h3>
                  <p className="text-xs text-slate-500 mt-0.5 font-mono">O.R. Number: <span className="text-red-400 font-bold">{orNumber}</span></p>
                </div>
              </div>

              <form onSubmit={handleVoidRecord} className="p-5 space-y-4">
                <p className="text-xs text-slate-400 leading-relaxed font-sans">
                  Warning: Voiding is irreversible. This will invalidate the selected payment ledger records and unlock all attached delinquency balances for active reassessment.
                </p>

                {voidError && (
                  <div className="p-3 bg-red-500/10 text-red-400 border border-red-500/20 rounded-xl text-xs flex items-center gap-2 font-sans font-medium">
                    <span className="w-1.5 h-1.5 bg-red-500 rounded-full shrink-0" />
                    <span>{voidError}</span>
                  </div>
                )}

                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block font-sans">Admin Email Address</label>
                  <input 
                    type="email"
                    value={voidUsername}
                    onChange={(e) => setVoidUsername(e.target.value)}
                    placeholder="Enter Admin email address..."
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-600 focus:border-red-500 outline-none transition-all font-sans"
                    required
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block font-sans">Admin Clearance Password</label>
                  <input 
                    type="password"
                    value={voidPassword}
                    onChange={(e) => setVoidPassword(e.target.value)}
                    placeholder="Enter Admin password..."
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-600 focus:border-red-500 outline-none transition-all font-sans"
                    required
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block font-sans">Justification Reason for Voiding</label>
                  <textarea 
                    rows={3}
                    value={voidReason}
                    onChange={(e) => setVoidReason(e.target.value)}
                    placeholder="Describe why this transaction is being voided (clerical indexing errors, returned check)..."
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-600 focus:border-red-500 outline-none transition-all resize-none font-sans"
                    required
                  />
                </div>

                <div className="flex gap-2 justify-end pt-2 border-t border-slate-850">
                  <button 
                    type="button"
                    onClick={() => {
                      setIsVoidDialogOpen(false);
                      setVoidError("");
                    }}
                    className="px-5 h-8 text-[10px] font-black uppercase tracking-widest text-slate-400 hover:bg-slate-800 rounded-lg transition-all border border-slate-800 font-sans cursor-pointer"
                    disabled={isVoiding}
                  >
                    Abort
                  </button>
                  <button 
                    type="submit"
                    className="px-6 h-8 text-[10px] font-black uppercase tracking-widest text-white bg-red-600 hover:bg-red-500 rounded-lg transition-all shadow-xl shadow-red-600/20 font-sans cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={isVoiding}
                  >
                    {isVoiding ? "Verifying..." : "Confirm & Void"}
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {isMigrating && (
        <PaymentMigrator onClose={() => setIsMigrating(false)} />
      )}

      {isViewingHistory && (
        <MigrationAuditLogModal onClose={() => setIsViewingHistory(false)} />
      )}

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
