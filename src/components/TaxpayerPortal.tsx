import React, { useState, useEffect } from "react";
import { 
  collection, 
  onSnapshot, 
  getDocs,
  query, 
  where, 
  doc, 
  setDoc,
  updateDoc,
  addDoc,
  serverTimestamp 
} from "firebase/firestore";
import { db, OperationType, handleFirestoreError } from "../lib/firebase";
import { UserProfile, Property, Delinquency, Payment } from "../types";
import { formatCurrency } from "../lib/utils";
import { calculateTotalDue, calculatePenalties } from "../lib/taxCalculations";
import { logAudit } from "../lib/audit";
import { 
  Building2, 
  CreditCard, 
  FileText, 
  FileCheck,
  History, 
  Bell, 
  CheckCircle, 
  Download, 
  Search, 
  Link, 
  AlertTriangle, 
  LogOut, 
  User, 
  ShieldCheck, 
  Calendar, 
  TrendingUp, 
  DollarSign, 
  Clock, 
  Plus, 
  ArrowRight, 
  Check, 
  Printer, 
  HelpCircle,
  FileSpreadsheet,
  Send,
  RefreshCw,
  Info
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface TaxpayerPortalProps {
  profile: UserProfile | null;
  logout: () => Promise<void>;
  isOffline: boolean;
}

export default function TaxpayerPortal({ profile, logout, isOffline }: TaxpayerPortalProps) {
  const [activeSubTab, setActiveSubTab] = useState<"dashboard" | "properties" | "payments" | "forms" | "notices">("dashboard");
  const [properties, setProperties] = useState<Property[]>([]);
  const [delinquencies, setDelinquencies] = useState<Delinquency[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  
  // Claim property state
  const [claimTdn, setClaimTdn] = useState("");
  const [claimPin, setClaimPin] = useState("");
  const [claimOwnerName, setClaimOwnerName] = useState("");
  const [claimError, setClaimError] = useState<string | null>(null);
  const [claimSuccess, setClaimSuccess] = useState<string | null>(null);
  const [isClaiming, setIsClaiming] = useState(false);

  // Payment states
  const [selectedDelinqs, setSelectedDelinqs] = useState<Set<string>>(new Set());
  const [isPayModalOpen, setIsPayModalOpen] = useState(false);
  const [paymentStep, setPaymentStep] = useState<"details" | "processing" | "success">("details");
  const [paymentMethod, setPaymentMethod] = useState<"gcash" | "card" | "paymaya" | "bank">("gcash");
  const [cashTendered, setCashTendered] = useState("");
  const [paymentSuccessData, setPaymentSuccessData] = useState<{
    orNumbers: string[];
    amountPaid: number;
    receiptDate: string;
    propertiesPaidCount: number;
  } | null>(null);

  // Digital request forms state
  const [formType, setFormType] = useState<"clearance" | "revision" | "transfer">("clearance");
  const [submittedRequests, setSubmittedRequests] = useState<any[]>([]);
  const [isSubmittingForm, setIsSubmittingForm] = useState(false);
  const [formSuccessMsg, setFormSuccessMsg] = useState<string | null>(null);
  const [selectedPropIdForForm, setSelectedPropIdForForm] = useState("");

  // Clearance form data
  const [clearanceContact, setClearanceContact] = useState("");
  const [clearancePurpose, setClearancePurpose] = useState("Transfer of Ownership");

  // Revision form data
  const [revisionProposedAssessed, setRevisionProposedAssessed] = useState("");
  const [revisionReason, setRevisionReason] = useState("");

  // Transfer form data
  const [newOwnerName, setNewOwnerName] = useState("");
  const [newOwnerAddress, setNewOwnerAddress] = useState("");
  const [transferDate, setTransferDate] = useState(new Date().toISOString().split("T")[0]);

  // Notifications
  const [notifications, setNotifications] = useState<any[]>([
    {
      id: "notif-1",
      title: "RPT Prompt Payment Discount Active",
      message: "Pay your 2026 Real Property Taxes before March 31, 2026, to enjoy a 10% discount on prompt payment!",
      type: "discount",
      date: "2026-05-15"
    },
    {
      id: "notif-2",
      title: "System Update Complete",
      message: "The Dipaculao Taxpayer e-Portal registration is online. Claim your properties using your Tax Declaration Number to view liabilities.",
      type: "info",
      date: "2026-05-20"
    }
  ]);

  // Fetch data
  useEffect(() => {
    // 1. Fetch properties
    const unsubProp = onSnapshot(collection(db, "properties"), (snapshot) => {
      const allProps = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Property));
      
      // Filter properties matching this taxpayer
      // A property is linked if:
      // a. Its ownerName case-insensatively matches user's displayName
      // b. OR the property id is contained within the user profile's linkedPropertyIds
      const matches = allProps.filter(p => {
        if (p.isArchived) return false;
        const isLinkedByProfile = profile?.linkedPropertyIds?.includes(p.id) || false;
        const matchesOwnerName = p.ownerName.toLowerCase().includes((profile?.displayName || "").toLowerCase());
        const matchesEmailContact = p.recordedBy === profile?.email; // fallback integration
        return isLinkedByProfile || matchesOwnerName || matchesEmailContact;
      });
      setProperties(matches);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, "properties");
    });

    // 2. Fetch delinquencies
    const unsubDelinq = onSnapshot(collection(db, "delinquencies"), (snapshot) => {
      setDelinquencies(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Delinquency)));
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, "delinquencies");
    });

    // 3. Fetch payments
    const unsubPayments = onSnapshot(collection(db, "payments"), (snapshot) => {
      setPayments(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Payment)));
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, "payments");
    });

    // 4. Fetch submitted forms
    if (profile?.uid) {
      const q = query(collection(db, "taxpayer_requests"), where("userId", "==", profile.uid));
      const unsubRequests = onSnapshot(q, (snapshot) => {
        setSubmittedRequests(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      });
      return () => { unsubProp(); unsubDelinq(); unsubPayments(); unsubRequests(); };
    }

    return () => { unsubProp(); unsubDelinq(); unsubPayments(); };
  }, [profile]);

  // Handle claiming a property
  const handleClaimProperty = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!claimTdn && !claimPin) {
      setClaimError("Please input at least a Tax Declaration Number (TDN) or PIN.");
      return;
    }
    setClaimError(null);
    setClaimSuccess(null);
    setIsClaiming(true);

    try {
      // Fetch properties to match
      const snap = await getDocs(collection(db, "properties"));
      const matchedProp = snap.docs.find(doc => {
        const data = doc.data();
        const tdnMatch = claimTdn ? data.tdNumber?.trim().toLowerCase() === claimTdn.trim().toLowerCase() : true;
        const pinMatch = claimPin ? data.pin?.trim().toLowerCase() === claimPin.trim().toLowerCase() : true;
        const ownerMatch = claimOwnerName ? data.ownerName?.trim().toLowerCase().includes(claimOwnerName.trim().toLowerCase()) : true;
        return tdnMatch && pinMatch && ownerMatch && !data.isArchived;
      });

      if (!matchedProp) {
        setClaimError("No matching property record was found in the Dipaculao registry. Please double-check your Tax Declaration Certificate of Title details.");
        setIsClaiming(false);
        return;
      }

      const pId = matchedProp.id;
      const pData = matchedProp.data() as Property;

      // Update user document with this linkedPropertyId
      const currentLinks = profile?.linkedPropertyIds || [];
      if (currentLinks.includes(pId)) {
        setClaimError("This property is already linked and registered to your taxpayer account.");
        setIsClaiming(false);
        return;
      }

      const newLinks = [...currentLinks, pId];
      await updateDoc(doc(db, "users", profile!.uid), {
        linkedPropertyIds: newLinks
      });

      // Update local profile profile state isn't strictly reactive since it's from context,
      // but the collection listener will re-index since profile will sync eventually.
      if (profile) {
        profile.linkedPropertyIds = newLinks;
      }

      // Log audit
      await logAudit("APPROVE", "TaxpayerPropertyLink", pId, null, {
        ownerName: pData.ownerName,
        tdNumber: pData.tdNumber,
        buyerTaxpayerId: profile?.uid
      });

      // Add success notification
      setNotifications(prev => [
        {
          id: `link-notif-${Date.now()}`,
          title: "Property Successfully Linked",
          message: `Your account is now securely linked to Property TDN: ${pData.tdNumber} (Assessed at ₱${pData.assessedValue.toLocaleString()}). Outstanding liabilities have been synced.`,
          type: "success",
          date: new Date().toISOString().split("T")[0]
        },
        ...prev
      ]);

      setClaimSuccess(`Success! Property with TDN ${pData.tdNumber} under ${pData.ownerName} has been linked to your taxpayer dashboard.`);
      setClaimTdn("");
      setClaimPin("");
      setClaimOwnerName("");
    } catch (err: any) {
      console.error(err);
      setClaimError("Claims verification failed. Please check network connectivity and retry.");
    } finally {
      setIsClaiming(false);
    }
  };

  // Submit Digital Request Form
  const handleSubmitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPropIdForForm) {
      alert("Please select a linked property to file this form for.");
      return;
    }
    setIsSubmittingForm(true);
    setFormSuccessMsg(null);

    const selectedProperty = properties.find(p => p.id === selectedPropIdForForm);

    try {
      const payload: any = {
        userId: profile?.uid,
        userEmail: profile?.email,
        userName: profile?.displayName,
        propertyId: selectedPropIdForForm,
        propertyTdn: selectedProperty?.tdNumber || "Unknown",
        propertyOwner: selectedProperty?.ownerName || "Unknown",
        type: formType,
        status: "Submitted",
        createdAt: new Date().toISOString()
      };

      if (formType === "clearance") {
        payload.contact = clearanceContact;
        payload.purpose = clearancePurpose;
      } else if (formType === "revision") {
        payload.proposedAssessedValue = parseFloat(revisionProposedAssessed) || 0;
        payload.reason = revisionReason;
      } else if (formType === "transfer") {
        payload.newOwnerName = newOwnerName;
        payload.newOwnerAddress = newOwnerAddress;
        payload.transferDate = transferDate;
      }

      await addDoc(collection(db, "taxpayer_requests"), payload);

      setFormSuccessMsg(`Your application for ${formType === "clearance" ? "Tax Clearance" : formType === "revision" ? "Assessment Revision" : "Property Transfer Notice"} has been submitted successfully to the Dipaculao Treasurer's Office! Staff will check your details.`);
      
      // Clear inputs
      setClearanceContact("");
      setRevisionProposedAssessed("");
      setRevisionReason("");
      setNewOwnerName("");
      setNewOwnerAddress("");
    } catch (err: any) {
      console.error(err);
      alert("Failed to submit request: " + err.message);
    } finally {
      setIsSubmittingForm(false);
    }
  };

  // Calculate liabilities and checkout items
  const linkedPropertyIds = properties.map(p => p.id);
  const propertyDelinquencies = delinquencies.filter(d => 
    linkedPropertyIds.includes(d.propertyId) && d.status !== "Paid" && d.status !== "Voided"
  );

  const calculateTotalLiabilitiesAmount = () => {
    return propertyDelinquencies.reduce((sum, d) => sum + (d.totalDue || 0), 0);
  };

  const getDelinquencyProperty = (propertyId: string) => {
    return properties.find(p => p.id === propertyId);
  };

  // Process Online e-Payment
  const handleCheckoutPayment = async () => {
    if (selectedDelinqs.size === 0) return;
    setPaymentStep("details");
    setIsPayModalOpen(true);
  };

  const executeOnlinePayment = async () => {
    setPaymentStep("processing");
    const orNumbersGenerated: string[] = [];
    const now = new Date();

    try {
      let paidCount = 0;
      let amountSum = 0;

      for (const dId of selectedDelinqs) {
        const delinq = delinquencies.find(d => d.id === dId);
        if (!delinq) continue;

        const prop = properties.find(p => p.id === delinq.propertyId);
        if (!prop) continue;

        const generatedOr = "OR-E" + Math.floor(100000 + Math.random() * 900000);
        orNumbersGenerated.push(generatedOr);

        const basicPaidValue = delinq.basicTaxDue || 0;
        const sefPaidValue = delinq.sefTaxDue || 0;
        const penaltyPaidValue = (delinq.penalty || 0) + (delinq.interest || 0);
        const chunkSum = (delinq.totalDue || 0);

        // 1. Create payment document record in database
        const paymentPayload: Payment = {
          id: Math.random().toString(36).substring(2, 11),
          delinquencyId: delinq.id,
          propertyId: delinq.propertyId,
          taxYear: delinq.year,
          assessedValue: prop.assessedValue,
          orNumber: generatedOr,
          paymentDate: now.toISOString().split("T")[0],
          payerName: profile?.displayName || "Online Taxpayer",
          paymentType: "Full",
          amountPaid: chunkSum,
          basicPaid: basicPaidValue,
          sefPaid: sefPaidValue,
          penaltyPaid: penaltyPaidValue,
          recordedBy: "Taxpayer e-Portal Portal",
          approvedBy: "Treasurer Auto-Approver",
          treasurer: "Novie D.T. Guzman",
          status: "Active",
          recordedAt: now.toISOString()
        };

        await setDoc(doc(db, "payments", paymentPayload.id), paymentPayload);

        // 2. Update delinquency document status to Paid in database
        await updateDoc(doc(db, "delinquencies", delinq.id), {
          status: "Paid",
          totalPaid: chunkSum,
          updatedAt: now.toISOString()
        });

        // 3. Log into Audit logs
        await logAudit("CREATE", "OnlineCollection", paymentPayload.id, null, {
          orNumber: generatedOr,
          amountPaid: chunkSum,
          taxpayerUid: profile?.uid
        });

        amountSum += chunkSum;
        paidCount++;
      }

      // Add success record to set state
      setPaymentSuccessData({
        orNumbers: orNumbersGenerated,
        amountPaid: amountSum,
        receiptDate: now.toLocaleDateString() + " " + now.toTimeString().substring(0, 5),
        propertiesPaidCount: paidCount
      });

      // Clear selection
      setSelectedDelinqs(new Set());

      // Add notification
      setNotifications(prev => [
        {
          id: `payment-notif-${Date.now()}`,
          title: "Online RPT Payment Completed",
          message: `Check cleared! Successfully made online RPT settlement of ₱${amountSum.toLocaleString()} under O.R. Reference: ${orNumbersGenerated.join(", ")}. Receipt generated.`,
          type: "success",
          date: now.toISOString().split("T")[0]
        },
        ...prev
      ]);

      setPaymentStep("success");
    } catch (err: any) {
      console.error(err);
      alert("Payment processing failed. Transaction reverted to secure database state: " + err.message);
      setIsPayModalOpen(false);
    }
  };

  const getSubTotalSelected = () => {
    let sum = 0;
    selectedDelinqs.forEach(dId => {
      const d = delinquencies.find(del => del.id === dId);
      if (d) sum += d.totalDue;
    });
    return sum;
  };

  // Printing clearance mock receipt
  const handlePrintReceipt = () => {
    window.print();
  };

  return (
    <div className="min-h-screen bg-[#0B1528] text-slate-100 flex flex-col md:flex-row relative">
      {/* BACKGROUND EFFECTS */}
      <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-blue-500/5 blur-[120px] rounded-full pointer-events-none z-0" />
      <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-emerald-500/5 blur-[120px] rounded-full pointer-events-none z-0" />

      {/* SIDEBAR FOR TAXPAYERS */}
      <aside className="w-full md:w-64 bg-slate-900 border-b md:border-b-0 md:border-r border-slate-800 flex flex-col z-10">
        <div className="p-6 border-b border-slate-800 flex flex-col gap-2 relative">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-600/15 border border-blue-500/30 rounded-xl flex items-center justify-center">
              <Building2 className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <h2 className="text-sm font-black text-white hover:text-blue-400 leading-tight">DIPACULAO, AURORA</h2>
              <p className="text-[9px] text-slate-500 font-bold uppercase tracking-widest font-mono">Taxpayer e-Portal</p>
            </div>
          </div>
        </div>

        {/* LOGGED IN USER REVENUE CARD */}
        <div className="p-4 mx-4 my-2 bg-slate-950 rounded-2xl border border-slate-800/80">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-8 h-8 rounded-full bg-blue-500/10 flex items-center justify-center font-bold text-blue-400 text-xs border border-blue-500/20">
              {profile?.displayName?.charAt(0) || "T"}
            </div>
            <div className="overflow-hidden">
              <p className="text-xs font-bold text-white truncate leading-none mb-1">{profile?.displayName}</p>
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-[9px] font-black uppercase text-emerald-400 tracking-wider">PORTAL_ONLINE</span>
              </div>
            </div>
          </div>
          <div className="h-px bg-slate-800 my-2" />
          <div>
            <span className="text-[8px] font-bold text-slate-500 uppercase tracking-widest block">Linked Properties</span>
            <span className="text-md font-black text-slate-200">{properties.length} Active Records</span>
          </div>
        </div>

        {/* MENU */}
        <nav className="flex-1 p-4 space-y-1">
          <button
            onClick={() => setActiveSubTab("dashboard")}
            className={`w-full h-10 px-4 rounded-xl flex items-center gap-3 text-xs font-black uppercase tracking-wider transition-all duration-200 ${
              activeSubTab === "dashboard"
                ? "bg-blue-600/15 border border-blue-500/20 text-blue-300 shadow-inner"
                : "text-slate-400 hover:text-slate-100 hover:bg-slate-800/40"
            }`}
          >
            <TrendingUp className="w-4 h-4" />
            Control Center
          </button>

          <button
            onClick={() => setActiveSubTab("properties")}
            className={`w-full h-10 px-4 rounded-xl flex items-center gap-3 text-xs font-black uppercase tracking-wider transition-all duration-200 ${
              activeSubTab === "properties"
                ? "bg-blue-600/15 border border-blue-500/20 text-blue-300 shadow-inner"
                : "text-slate-400 hover:text-slate-100 hover:bg-slate-800/40"
            }`}
          >
            <Building2 className="w-4 h-4" />
            My Properties
          </button>

          <button
            onClick={() => setActiveSubTab("payments")}
            className={`w-full h-10 px-4 rounded-xl flex items-center gap-3 justify-between text-xs font-black uppercase tracking-wider transition-all duration-200 ${
              activeSubTab === "payments"
                ? "bg-blue-600/15 border border-blue-500/20 text-blue-300 shadow-inner"
                : "text-slate-400 hover:text-slate-100 hover:bg-slate-800/40"
            }`}
          >
            <div className="flex items-center gap-3">
              <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
              Financial Ledger
            </div>
            {propertyDelinquencies.length > 0 && (
              <span className="bg-red-500 text-white rounded-full text-[9px] px-2 py-0.5 font-bold animate-pulse shadow-md">
                {propertyDelinquencies.length}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveSubTab("forms")}
            className={`w-full h-10 px-4 rounded-xl flex items-center gap-3 text-xs font-black uppercase tracking-wider transition-all duration-200 ${
              activeSubTab === "forms"
                ? "bg-blue-600/15 border border-blue-500/20 text-blue-300 shadow-inner"
                : "text-slate-400 hover:text-slate-100 hover:bg-slate-800/40"
            }`}
          >
            <FileText className="w-4 h-4" />
            Forms & Document Hub
          </button>

          <button
            onClick={() => setActiveSubTab("notices")}
            className={`w-full h-10 px-4 rounded-xl flex items-center gap-3 text-xs font-black uppercase tracking-wider transition-all duration-200 ${
              activeSubTab === "notices"
                ? "bg-blue-600/15 border border-blue-500/20 text-blue-300 shadow-inner"
                : "text-slate-400 hover:text-slate-100 hover:bg-slate-800/40"
            }`}
          >
            <Bell className="w-4 h-4" />
            Notices & Promos
          </button>
        </nav>

        {/* LOGOUT */}
        <div className="p-4 border-t border-slate-800">
          <button
            onClick={logout}
            className="w-full h-10 px-4 bg-slate-950 border border-slate-800 rounded-xl flex items-center justify-center gap-2 text-xs font-black uppercase tracking-widest text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            Secure Logout
          </button>
        </div>
      </aside>

      {/* CONTENT AREA */}
      <main className="flex-1 min-h-screen p-6 md:p-8 z-10 flex flex-col justify-between overflow-x-hidden md:pl-8">
        <div>
          {/* HEADER ROW */}
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border-b border-slate-800 pb-6 mb-8">
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <ShieldCheck className="w-4 h-4 text-blue-400" />
                <span className="text-[10px] font-black uppercase text-blue-400 tracking-widest font-mono">DIPACULAO TREASURY SYSTEM</span>
              </div>
              <h1 className="text-3xl font-black text-white tracking-tight leading-none uppercase">
                {activeSubTab === "dashboard" && "Dashboard Control Center"}
                {activeSubTab === "properties" && "Property Portfolio Registry"}
                {activeSubTab === "payments" && "RPTAR Financial Ledger"}
                {activeSubTab === "forms" && "Forms & Certification Hub"}
                {activeSubTab === "notices" && "Notices & Announcements"}
              </h1>
            </div>

            <div className="flex items-center gap-4 bg-slate-900 border border-slate-800 px-4 py-2.5 rounded-2xl font-mono text-xs text-slate-400 shadow-md">
              <Calendar className="w-4 h-4 text-blue-400 shrink-0" />
              <div className="flex flex-col">
                <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Active Fiscal Cycle</span>
                <span className="text-[11px] font-bold text-slate-300">2026-05-23 (UTC)</span>
              </div>
            </div>
          </div>

          {/* DYNAMIC SUBTAB VIEWS */}

          {/* 1. CONTROL CENTER / DASHBOARD */}
          {activeSubTab === "dashboard" && (
            <div className="space-y-6 animate-in fade-in duration-300">
              {/* TOP KPI BLOCK */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-slate-900/40 p-6 rounded-3xl border border-slate-800 relative overflow-hidden flex items-center justify-between">
                  <div className="absolute top-0 right-0 p-4 opacity-5">
                    <Building2 className="w-24 h-24" />
                  </div>
                  <div>
                    <span className="text-[10px] font-black uppercase text-slate-500 tracking-widest block mb-2">My Registered Properties</span>
                    <span className="text-3xl font-black text-white">{properties.length}</span>
                    <span className="text-[10px] text-blue-400 font-bold block mt-1 hover:underline cursor-pointer" onClick={() => setActiveSubTab("properties")}>Manage Properties &rarr;</span>
                  </div>
                </div>

                <div className="bg-slate-900/40 p-6 rounded-3xl border border-slate-800 relative overflow-hidden flex items-center justify-between">
                  <div className="absolute top-0 right-0 p-4 opacity-5">
                    <DollarSign className="w-24 h-24" />
                  </div>
                  <div>
                    <span className="text-[10px] font-black uppercase text-slate-500 tracking-widest block mb-2">Total Outstanding Liabilities</span>
                    <span className="text-3xl font-black text-red-400">{formatCurrency(calculateTotalLiabilitiesAmount())}</span>
                    <span className="text-[10px] text-red-500/80 font-bold block mt-1 uppercase tracking-wider flex items-center gap-1">
                      <Clock className="w-3 h-3 animate-pulse" />
                      {propertyDelinquencies.length} Bills Unpaid
                    </span>
                  </div>
                </div>

                <div className="bg-slate-900/40 p-6 rounded-3xl border border-slate-800 relative overflow-hidden flex items-center justify-between">
                  <div className="absolute top-0 right-0 p-4 opacity-5">
                    <CheckCircle className="w-24 h-24" />
                  </div>
                  <div>
                    <span className="text-[10px] font-black uppercase text-slate-500 tracking-widest block mb-2">Settled RPT Payments</span>
                    <span className="text-3xl font-black text-emerald-400">
                      {payments.filter(p => properties.map(pr => pr.id).includes(p.propertyId) && p.status !== "Voided").length}
                    </span>
                    <span className="text-[10px] text-emerald-400 font-bold block mt-1">Dipaculao Ledger Verified</span>
                  </div>
                </div>
              </div>

              {/* WELCOME NOTE AND PROMPT ACTION */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* LARGE STATS CANVAS */}
                <div className="lg:col-span-2 bg-gradient-to-br from-blue-950/10 to-slate-900/50 p-8 rounded-3xl border border-blue-500/10 flex flex-col justify-between min-h-[220px]">
                  <div>
                    <h2 className="text-xl font-black text-white uppercase tracking-tight mb-2">
                      Secure Dipaculao Resident e-Revenue Node
                    </h2>
                    <p className="text-slate-400 text-xs leading-relaxed max-w-xl">
                      Welcome to your property dashboard. You can securely inspect your registered land, building, and machinery assessments here. Outstanding real property taxes (RPT) can be settled instantly through digital gateways.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-3 mt-6">
                    <button 
                      onClick={() => setActiveSubTab("payments")}
                      className="px-6 h-10 bg-white hover:bg-slate-100 text-slate-950 rounded-xl text-xs font-black uppercase tracking-widest flex items-center gap-2 transition-transform hover:scale-[1.02] active:scale-[0.98] cursor-pointer"
                    >
                      <CreditCard className="w-4 h-4" />
                      Settle Unpaid Taxes
                    </button>
                    <button 
                      onClick={() => setActiveSubTab("properties")}
                      className="px-6 h-10 bg-slate-800 hover:bg-slate-700 text-white border border-slate-700 rounded-xl text-xs font-semibold uppercase tracking-widest flex items-center gap-2 cursor-pointer"
                    >
                      <Plus className="w-4 h-4" />
                      Add / Link Property
                    </button>
                  </div>
                </div>

                {/* IMPORTANT ALERTS BOX */}
                <div className="bg-slate-900/60 border border-slate-800 rounded-3xl p-6">
                  <h3 className="text-xs font-black text-white mb-4 uppercase tracking-wider flex items-center gap-2">
                    <Bell className="w-4 h-4 text-amber-500 mb-0.5" />
                    Government Alerts & Deadlines
                  </h3>
                  <div className="space-y-4">
                    <div className="p-3.5 bg-blue-500/5 border border-blue-500/10 rounded-2xl">
                      <span className="text-[8px] font-bold text-blue-400 uppercase tracking-widest block mb-1">RPT Discount Prompt</span>
                      <p className="text-[11px] font-bold text-slate-300 leading-snug">
                        2026 Fiscal Prompt payment discount is active: 10% Off before March 31!
                      </p>
                    </div>
                    <div className="p-3.5 bg-slate-950/40 border border-slate-800 rounded-2xl">
                      <span className="text-[8px] font-bold text-slate-500 uppercase tracking-widest block mb-1 font-mono">2026 Payments Cycle</span>
                      <p className="text-[11px] font-bold text-slate-400 leading-snug">
                        Ensure all your pre-existing delinquency records are cleared to generate official tax clearance certificates.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* OUTSTANDING DELINQUENCIES TABLE BRIEF */}
              <div className="bg-slate-900/20 border border-slate-800/80 rounded-3xl p-6">
                <div className="flex justify-between items-center mb-6">
                  <h3 className="text-sm font-black text-white uppercase tracking-wider flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-red-400" />
                    Pending Tax Liabilities Summary
                  </h3>
                  <button onClick={() => setActiveSubTab("payments")} className="text-xs text-blue-400 font-bold uppercase hover:underline">
                    View Complete Billing Statement &rarr;
                  </button>
                </div>

                {propertyDelinquencies.length === 0 ? (
                  <div className="p-8 text-center bg-slate-950/20 rounded-2xl border border-dashed border-slate-800 flex flex-col items-center justify-center">
                    <CheckCircle className="w-12 h-12 text-emerald-500 mb-3" />
                    <p className="text-white font-bold mb-1">Your Account has Zero Liabilities!</p>
                    <p className="text-slate-500 text-xs">All properties linked to your account are completely paid and up to date.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-slate-800 text-[10px] text-slate-500 font-black uppercase tracking-wider h-10">
                          <th className="pb-3">Property Location / TDN</th>
                          <th className="pb-3">Classification</th>
                          <th className="pb-3">Taxable Year</th>
                          <th className="pb-3">Basic Tax Due</th>
                          <th className="pb-3">SEF Due</th>
                          <th className="pb-3">Interest / Penalty</th>
                          <th className="pb-3 text-right">Total Due</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/40 text-xs">
                        {propertyDelinquencies.slice(0, 4).map(d => {
                          const prop = getDelinquencyProperty(d.propertyId);
                          return (
                            <tr key={d.id} className="h-12 hover:bg-slate-900/20 transition-colors">
                              <td className="py-2">
                                <p className="font-bold text-white">{prop?.tdNumber || "Unknown"}</p>
                                <p className="text-[10px] text-slate-500">{prop?.barangay || "---"}, Dipaculao</p>
                              </td>
                              <td className="py-2 text-slate-300 font-semibold">{prop?.classification || "LAND"}</td>
                              <td className="py-2 font-mono text-slate-400 font-bold">{d.year}</td>
                              <td className="py-2 text-slate-300">{formatCurrency(d.basicTaxDue)}</td>
                              <td className="py-2 text-slate-300">{formatCurrency(d.sefTaxDue)}</td>
                              <td className="py-2 text-red-400/80 font-mono">+{formatCurrency((d.penalty || 0) + (d.interest || 0))}</td>
                              <td className="py-2 text-right font-black text-rose-400 text-sm font-mono">{formatCurrency(d.totalDue)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 2. MY PROPERTIES PORTFOLIO */}
          {activeSubTab === "properties" && (
            <div className="space-y-8 animate-in fade-in duration-300">
              {/* CLAIM / LINK PROPERTY CARD */}
              <div className="bg-slate-900/60 p-6 rounded-3xl border border-slate-800 relative z-10">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
                    <Link className="w-4 h-4 text-blue-400" />
                  </div>
                  <div>
                    <h2 className="text-sm font-black text-white uppercase tracking-wider">Claim / Link Registered Property</h2>
                    <p className="text-[11px] text-slate-500">Associate matching land or buildings to view outstanding liabilities instantly.</p>
                  </div>
                </div>

                <form onSubmit={handleClaimProperty} className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                  <div className="space-y-1.5 col-span-1">
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block font-sans">ARP/Tax Dec Number *</label>
                    <input
                      type="text"
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl h-10 px-3 text-xs text-white focus:border-blue-500 outline-none"
                      placeholder="e.g. TD-2025-0012"
                      value={claimTdn}
                      onChange={e => setClaimTdn(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5 col-span-1">
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block font-sans">Property Index No. (PIN)</label>
                    <input
                      type="text"
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl h-10 px-3 text-xs text-white focus:border-blue-500 outline-none"
                      placeholder="e.g. 012-04-001..."
                      value={claimPin}
                      onChange={e => setClaimPin(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5 col-span-1">
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block font-sans">Registered Owner Name *</label>
                    <input
                      type="text"
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl h-10 px-3 text-xs text-white focus:border-blue-500 outline-none"
                      placeholder="e.g. Juan Dela Cruz"
                      value={claimOwnerName}
                      onChange={e => setClaimOwnerName(e.target.value)}
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={isClaiming}
                    className="w-full bg-white hover:bg-slate-100 font-bold uppercase tracking-widest text-[10px] text-slate-950 h-10 rounded-xl flex items-center justify-center gap-2 transition-transform hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 cursor-pointer"
                  >
                    {isClaiming ? "Verifying..." : "Validate & Link Property"}
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </form>

                {claimError && (
                  <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-2xl flex items-start gap-3 mt-4">
                    <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                    <p className="text-[11px] text-red-400 leading-relaxed font-semibold">{claimError}</p>
                  </div>
                )}
                {claimSuccess && (
                  <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl flex items-start gap-3 mt-4 animate-in fade-in duration-300">
                    <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                    <p className="text-[11px] text-emerald-400 leading-relaxed font-semibold">{claimSuccess}</p>
                  </div>
                )}
              </div>

              {/* REGISTERED PROPERTIES GRID */}
              <div>
                <h3 className="text-xs font-black text-white uppercase tracking-wider mb-4 flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-blue-400" />
                  My Registered Property Portfolio ({properties.length} Items)
                </h3>

                {properties.length === 0 ? (
                  <div className="p-12 text-center bg-slate-900/30 rounded-3xl border border-dashed border-slate-800 flex flex-col items-center justify-center max-w-2xl mx-auto">
                    <Building2 className="w-16 h-16 text-slate-700 mb-4" />
                    <h3 className="text-white font-black text-lg mb-1">No Properties Associated Yet</h3>
                    <p className="text-slate-500 text-xs mb-6 max-w-sm">
                      There are currently no real property records automatically matched with your account. Use the Claim Form above to sync your properties using your Tax Declarations.
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {properties.map(p => {
                      const propLiabilities = propertyDelinquencies.filter(d => d.propertyId === p.id);
                      const totalDue = propLiabilities.reduce((sum, d) => sum + (d.totalDue || 0), 0);

                      return (
                        <div key={p.id} className="bg-slate-900/40 border border-slate-800/85 hover:border-slate-700/80 p-6 rounded-3xl relative overflow-hidden flex flex-col justify-between transition-all group shadow-sm">
                          <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:scale-110 transition-transform">
                            <Building2 className="w-20 h-20 text-blue-400" />
                          </div>

                          <div>
                            {/* TD NO */}
                            <div className="flex items-center justify-between gap-4 mb-3">
                              <span className="bg-blue-600/15 border border-blue-500/20 text-blue-300 rounded-lg text-[9px] px-2 py-0.5 font-bold font-mono">
                                TDN: {p.tdNumber}
                              </span>
                              <span className="text-[8px] font-black uppercase text-slate-500 tracking-wider">
                                {p.classification}
                              </span>
                            </div>

                            {/* PIN AND LOCATION */}
                            <p className="text-xs font-black text-white uppercase mb-1">{p.ownerName}</p>
                            <p className="text-slate-400 text-xs truncate mb-4">{p.barangay}, Dipaculao, Aurora</p>

                            <div className="bg-slate-950/70 p-4 rounded-2xl border border-slate-900/80 space-y-3 mb-6">
                              <div className="flex justify-between items-center text-[11px]">
                                <span className="text-slate-500 font-bold uppercase tracking-wider block">Property Index No. (PIN)</span>
                                <span className="font-mono text-slate-300 font-bold">{p.pin || "Not Assigned"}</span>
                              </div>
                              <div className="flex justify-between items-center text-[11px]">
                                <span className="text-slate-500 font-bold uppercase tracking-wider block">Assessed Value</span>
                                <span className="font-mono font-black text-blue-300">₱{p.assessedValue.toLocaleString()}</span>
                              </div>
                              <div className="flex justify-between items-center text-[11px]">
                                <span className="text-slate-500 font-bold uppercase tracking-wider block">Area Lot Size</span>
                                <span className="text-slate-300 font-bold">{p.area || "N/A"}</span>
                              </div>
                            </div>
                          </div>

                          <div className="flex justify-between items-center border-t border-slate-800/40 pt-4 mt-2">
                            <div>
                              <span className="text-[8px] font-bold text-slate-500 uppercase tracking-widest block">Outstanding Tax</span>
                              <span className={`text-md font-mono font-black ${totalDue > 0 ? "text-rose-400" : "text-emerald-400"}`}>
                                {totalDue > 0 ? formatCurrency(totalDue) : "Settled (₱0.00)"}
                              </span>
                            </div>
                            <button
                              onClick={() => {
                                if (totalDue > 0) {
                                  // Set selection for this property
                                  const selectSet = new Set<string>();
                                  propLiabilities.forEach(l => selectSet.add(l.id));
                                  setSelectedDelinqs(selectSet);
                                  setActiveSubTab("payments");
                                } else {
                                  setActiveSubTab("payments");
                                }
                              }}
                              className={`px-4 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all cursor-pointer ${
                                totalDue > 0
                                  ? "bg-rose-500 hover:bg-rose-400 text-white shadow-lg"
                                  : "bg-slate-800 hover:bg-slate-700 text-slate-400"
                              }`}
                            >
                              {totalDue > 0 ? "Settle Tax Due" : "Payment History"}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 3. TAX OBLIGATIONS & FINANCIAL LEDGER */}
          {activeSubTab === "payments" && (
            <div className="space-y-6 animate-in fade-in duration-300">
              <div className="bg-slate-900/35 border border-slate-800 p-6 rounded-3xl">
                <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mb-6">
                  <div>
                    <h3 className="text-sm font-black text-white uppercase tracking-wider flex items-center gap-2">
                      <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
                      Active Outstanding Tax Obligations
                    </h3>
                    <p className="text-xs text-slate-500">Unpaid real property tax obligations for your registered property records retrieved from the official municipal databases.</p>
                  </div>
                </div>

                {propertyDelinquencies.length === 0 ? (
                  <div className="p-12 text-center bg-slate-950/20 rounded-2xl border border-dashed border-slate-800 flex flex-col items-center justify-center">
                    <CheckCircle className="w-12 h-12 text-emerald-500 mb-3" />
                    <h3 className="text-white font-black text-lg mb-1">Obligations Clear</h3>
                    <p className="text-slate-500 text-xs">All linked real property taxes are logged as settled with no outstanding arrears or obligations.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-slate-800 text-[10px] text-slate-500 font-black uppercase tracking-wider h-10">
                          <th className="pb-3">Property Location / TDN</th>
                          <th className="pb-3 text-center">Taxable Year</th>
                          <th className="pb-3 text-right">Basic Tax Due</th>
                          <th className="pb-3 text-right">SEF Due</th>
                          <th className="pb-3 text-right">Penalty Surcharge</th>
                          <th className="pb-3 text-right">Net Amount Due</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/40 text-xs">
                        {propertyDelinquencies.map(d => {
                          const prop = getDelinquencyProperty(d.propertyId);
                          return (
                            <tr 
                              key={d.id} 
                              className="h-14 hover:bg-slate-900/10 transition-colors"
                            >
                              <td className="py-2">
                                <p className="font-bold text-white uppercase">{prop?.tdNumber || "Unknown"}</p>
                                <p className="text-[10px] text-slate-500">{prop?.barangay || "---"}, Dipaculao, Aurora</p>
                              </td>
                              <td className="py-2 text-slate-400 font-mono font-bold text-center">{d.year}</td>
                              <td className="py-2 text-right text-slate-300 font-semibold">{formatCurrency(d.basicTaxDue)}</td>
                              <td className="py-2 text-right text-slate-300 font-semibold">{formatCurrency(d.sefTaxDue)}</td>
                              <td className="py-2 text-right text-red-400/80 font-mono font-bold font-mono">+{formatCurrency((d.penalty || 0) + (d.interest || 0))}</td>
                              <td className="py-2 text-right font-black text-rose-350 text-[13px] font-mono">{formatCurrency(d.totalDue)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* PAYMENT LEDGER ARCHIVE HISTORY */}
              <div className="bg-slate-900/20 border border-slate-800 rounded-3xl p-6">
                <h3 className="text-xs font-black text-white uppercase tracking-wider mb-6 flex items-center gap-2">
                  <History className="w-4 h-4 text-emerald-400" />
                  My Historic Tax Payments Ledger
                </h3>

                {payments.filter(p => properties.map(pr => pr.id).includes(p.propertyId)).length === 0 ? (
                  <div className="p-8 text-center text-slate-500 text-xs">No historic payments has been logged under this account UIDs yet.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-slate-800 text-[10px] text-slate-500 font-black uppercase tracking-wider h-10">
                          <th className="pb-3">Official Receipt (O.R.)</th>
                          <th className="pb-3">Tax Declaration Number</th>
                          <th className="pb-3 font-mono">Tax Year Settled</th>
                          <th className="pb-3">Date Processed</th>
                          <th className="pb-3 text-right border-l border-slate-800 pl-4">RPT Basic Paid</th>
                          <th className="pb-3 text-right">SEF Paid</th>
                          <th className="pb-3 text-right">Penalties Paid</th>
                          <th className="pb-3 text-right">Total Net Paid</th>
                          <th className="pb-3 text-right pr-2">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/40 text-[11px]">
                        {payments
                          .filter(p => properties.map(pr => pr.id).includes(p.propertyId))
                          .map(p => {
                            const prop = properties.find(pr => pr.id === p.propertyId);
                            return (
                              <tr key={p.id} className="h-12 hover:bg-slate-900/10 transition-colors">
                                <td className="py-2">
                                  <p className="font-bold text-white font-mono">{p.orNumber}</p>
                                  <p className="text-[9px] text-slate-500">Method: Online Web-Gateway</p>
                                </td>
                                <td className="py-2 text-slate-300 font-bold">{prop?.tdNumber || "---"}</td>
                                <td className="py-2 text-slate-400 font-mono font-bold">{p.taxYear}</td>
                                <td className="py-2 text-slate-400">{new Date(p.recordedAt || p.paymentDate).toLocaleDateString()}</td>
                                <td className="py-2 text-right text-slate-300 border-l border-slate-800 pl-4">{formatCurrency(p.basicPaid)}</td>
                                <td className="py-2 text-right text-slate-300">{formatCurrency(p.sefPaid)}</td>
                                <td className="py-2 text-right text-slate-400 font-mono">{formatCurrency(p.penaltyPaid || 0)}</td>
                                <td className="py-2 text-right font-black text-emerald-400 font-mono">{formatCurrency(p.amountPaid)}</td>
                                <td className="py-1 text-right pr-2">
                                  <div className="table-actions">
                                    <button
                                      onClick={() => {
                                        // Render a direct printable view of this receipt
                                        setPaymentSuccessData({
                                          orNumbers: [p.orNumber],
                                          amountPaid: p.amountPaid,
                                          receiptDate: new Date(p.recordedAt || p.paymentDate).toLocaleString(),
                                          propertiesPaidCount: 1
                                        });
                                        setPaymentStep("success");
                                        setIsPayModalOpen(true);
                                      }}
                                      className="btn-action-primary"
                                    >
                                      <Printer className="w-3 h-3" />
                                      Receipt
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 4. DIGITAL DOCUMENT HUB & FORMS */}
          {activeSubTab === "forms" && (
            <div className="space-y-8 animate-in fade-in duration-300">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* SELECTOR & FORM BODY */}
                <div className="lg:col-span-2 bg-slate-900/40 rounded-3xl border border-slate-800 p-6">
                  {/* SEGMENTED FORM CONTROLLERS */}
                  <div className="grid grid-cols-3 gap-2 bg-slate-950 p-1.5 rounded-2xl border border-slate-800/80 mb-6">
                    <button
                      type="button"
                      onClick={() => { setFormType("clearance"); setFormSuccessMsg(null); }}
                      className={`py-2 px-1 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all duration-300 ${
                        formType === "clearance" ? "bg-white text-slate-950 font-bold shadow-lg" : "text-slate-400 hover:text-white"
                      }`}
                    >
                      RPT Clearance
                    </button>
                    <button
                      type="button"
                      onClick={() => { setFormType("revision"); setFormSuccessMsg(null); }}
                      className={`py-2 px-1 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all duration-300 ${
                        formType === "revision" ? "bg-white text-slate-950 font-bold shadow-lg" : "text-slate-400 hover:text-white"
                      }`}
                    >
                      Assessment Revision
                    </button>
                    <button
                      type="button"
                      onClick={() => { setFormType("transfer"); setFormSuccessMsg(null); }}
                      className={`py-2 px-1 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all duration-300 ${
                        formType === "transfer" ? "bg-white text-slate-950 font-bold shadow-lg" : "text-slate-400 hover:text-white"
                      }`}
                    >
                      Notice of Transfer
                    </button>
                  </div>

                  <form onSubmit={handleSubmitForm} className="space-y-5">
                    <h3 className="text-sm font-black text-white uppercase tracking-tight pb-3 border-b border-slate-800">
                      {formType === "clearance" && "Clearance Application (Form RPT-F01)"}
                      {formType === "revision" && "Request for Revision of Assessment (Form RPT-F02)"}
                      {formType === "transfer" && "Property Ownership Transference Declaration (Form RPT-F03)"}
                    </h3>

                    {/* FIELD: PROPERTY ASSOCIATED */}
                    <div className="space-y-2">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">Select Portfolio Tax Decl. Asset *</label>
                      <select
                        required
                        className="w-full bg-slate-950 border border-slate-800 rounded-2xl h-11 px-3 text-xs text-white focus:border-blue-500 outline-none"
                        value={selectedPropIdForForm}
                        onChange={e => setSelectedPropIdForForm(e.target.value)}
                      >
                        <option value="">-- Choose Linked Property --</option>
                        {properties.map(p => (
                          <option key={p.id} value={p.id}>{p.tdNumber} - {p.barangay} ({p.classification})</option>
                        ))}
                      </select>
                    </div>

                    {/* DIGITAL CLEARANCE FIELDS */}
                    {formType === "clearance" && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-in fade-in duration-300">
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block col-span-1">Contact Reference Number</label>
                          <input
                            required
                            type="text"
                            placeholder="e.g. +63 912 345 6789"
                            className="w-full bg-slate-950 border border-slate-800 rounded-xl h-11 px-3 text-xs text-white focus:border-blue-500 outline-none"
                            value={clearanceContact}
                            onChange={e => setClearanceContact(e.target.value)}
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block col-span-1">Certificate Purpose</label>
                          <select
                            className="w-full bg-slate-950 border border-slate-800 rounded-xl h-11 px-3 text-xs text-white focus:border-blue-500 outline-none"
                            value={clearancePurpose}
                            onChange={e => setClearancePurpose(e.target.value)}
                          >
                            <option value="Transfer of Ownership">Transfer of Ownership</option>
                            <option value="Bank Loan Guarantee">Bank Loan Guarantee</option>
                            <option value="Building Permit Processing">Building Permit Processing</option>
                            <option value="Personal Records File">Personal Records File</option>
                          </select>
                        </div>
                      </div>
                    )}

                    {/* REVISION ASSESSMENT FIELDS */}
                    {formType === "revision" && (
                      <div className="space-y-4 animate-in fade-in duration-300">
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">Customer Proposed Fair Market Assessed Value (₱)</label>
                          <input
                            required
                            type="number"
                            placeholder="Proposed Assessment Amount..."
                            className="w-full bg-slate-950 border border-slate-800 rounded-xl h-11 px-3 text-xs text-white focus:border-blue-500 outline-none"
                            value={revisionProposedAssessed}
                            onChange={e => setRevisionProposedAssessed(e.target.value)}
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">Reasoning / Supporting Remarks</label>
                          <textarea
                            required
                            placeholder="State reasons for assessment correction (e.g., machinery depreciated, building damage, error in land dimension)..."
                            className="w-full bg-slate-950 border border-slate-800 rounded-2xl p-4 text-xs text-white focus:border-blue-500 outline-none h-28 resize-none"
                            value={revisionReason}
                            onChange={e => setRevisionReason(e.target.value)}
                          />
                        </div>
                      </div>
                    )}

                    {/* PROPERTY TRANSFER DECLARATION FIELDS */}
                    {formType === "transfer" && (
                      <div className="space-y-4 animate-in fade-in duration-300">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="space-y-1.5">
                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">Transferee (New Owner Full Name)</label>
                            <input
                              required
                              type="text"
                              placeholder="Buyer or successor name..."
                              className="w-full bg-slate-950 border border-slate-800 rounded-xl h-11 px-3 text-xs text-white focus:border-blue-500 outline-none"
                              value={newOwnerName}
                              onChange={e => setNewOwnerName(e.target.value)}
                            />
                          </div>
                          <div className="space-y-1.5">
                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">Transfer / Conveyance Date</label>
                            <input
                              required
                              type="date"
                              className="w-full bg-slate-950 border border-slate-800 rounded-xl h-11 px-3 text-xs text-white focus:border-blue-500 outline-none font-mono"
                              value={transferDate}
                              onChange={e => setTransferDate(e.target.value)}
                            />
                          </div>
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">Transferee Mailing Address</label>
                          <input
                            required
                            type="text"
                            placeholder="transferee complete residential address..."
                            className="w-full bg-slate-950 border border-slate-800 rounded-xl h-11 px-3 text-xs text-white focus:border-blue-500 outline-none"
                            value={newOwnerAddress}
                            onChange={e => setNewOwnerAddress(e.target.value)}
                          />
                        </div>
                      </div>
                    )}

                    {/* SUBMIT BUTTON */}
                    <button
                      type="submit"
                      disabled={isSubmittingForm || properties.length === 0}
                      className="w-full bg-white hover:bg-slate-100 font-bold uppercase tracking-widest text-[11px] text-slate-950 h-11 rounded-xl flex items-center justify-center gap-2 transition-transform hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50 cursor-pointer shadow-lg shadow-white/5"
                    >
                      <Send className="w-4 h-4" />
                      {isSubmittingForm ? "Submitting Request..." : "Submit Digital Request to Treasurer"}
                    </button>

                    {formSuccessMsg && (
                      <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl flex items-start gap-3 mt-4">
                        <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                        <p className="text-[11px] text-emerald-400 leading-relaxed font-semibold">{formSuccessMsg}</p>
                      </div>
                    )}
                  </form>
                </div>

                {/* DIGITAL RECIPIENT HISTORY */}
                <div className="bg-slate-900/60 rounded-3xl border border-slate-800 p-6 flex flex-col justify-between">
                  <div>
                    <h3 className="text-xs font-black text-white uppercase tracking-wider mb-4 flex items-center gap-2">
                      <FileCheck className="w-4 h-4 text-blue-400" />
                      Submitted Requests Tracker
                    </h3>
                    <p className="text-[11px] text-slate-500 mb-6">Real-time status tracking for digital forms submitted to municipal administrators.</p>

                    {submittedRequests.length === 0 ? (
                      <div className="text-center p-6 text-slate-600 font-medium italic text-[11px]">No documents or requests logged.</div>
                    ) : (
                      <div className="space-y-3 max-h-[350px] overflow-y-auto pr-1">
                        {submittedRequests.map(r => (
                          <div key={r.id} className="p-3 bg-slate-950/70 border border-slate-800 rounded-2xl space-y-2">
                            <div className="flex justify-between items-center text-[10px]">
                              <span className="bg-blue-600/15 border border-blue-500/25 text-blue-400 rounded px-1.5 py-0.5 font-bold uppercase tracking-wide">
                                {r.type === "clearance" ? "Tax Clearance" : r.type === "revision" ? "Revision" : "Notice to Transfer"}
                              </span>
                              <span className={`px-2 py-0.5 font-black uppercase text-[8px] rounded-lg tracking-wider ${
                                r.status === "Approved" || r.status === "Ready" || r.status === "Ready for Pick-up"
                                  ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 animate-pulse"
                                  : r.status === "Rejected"
                                  ? "bg-red-500/10 text-red-400"
                                  : "bg-amber-500/10 text-amber-500"
                              }`}>
                                {r.status || "Submitted"}
                              </span>
                            </div>
                            <p className="text-[11px] font-bold text-slate-300">TDN: {r.propertyTdn}</p>
                            <p className="text-[9px] text-slate-500">Filed: {new Date(r.createdAt).toLocaleDateString()}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="border-t border-slate-800/40 pt-4 mt-6">
                    <p className="text-[10px] text-slate-500 leading-relaxed font-semibold italic">
                      Note: Document requests are generally processed within 1-2 working days by Treasury officers. You will receive an status update in this dashboard when clearance logs are cleared.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 5. NOTICES & ALERTS SECTION */}
          {activeSubTab === "notices" && (
            <div className="space-y-6 max-w-4xl mx-auto animate-in fade-in duration-300">
              <div className="bg-slate-900/40 rounded-3xl border border-slate-800 p-6">
                <h3 className="text-xs font-black text-white uppercase tracking-wider mb-6 flex items-center gap-2">
                  <Bell className="w-4 h-4 text-amber-400" />
                  Government Bulletins & Discount Projections
                </h3>

                <div className="space-y-4">
                  {notifications.map(n => (
                    <div key={n.id} className="p-5 bg-slate-950/50 border border-slate-800/80 rounded-2xl flex gap-4 items-start hover:border-slate-700 transition-colors">
                      <div className={`p-2 rounded-xl mt-0.5 ${
                        n.type === "discount" ? "bg-amber-500/10 text-amber-400" : n.type === "success" ? "bg-emerald-500/10 text-emerald-400" : "bg-blue-500/10 text-blue-400"
                      }`}>
                        <Info className="w-5 h-5" />
                      </div>
                      <div className="space-y-1 flex-1">
                        <div className="flex justify-between items-center">
                          <h4 className="text-xs font-black text-white uppercase">{n.title}</h4>
                          <span className="text-[9px] text-slate-500 font-mono">{n.date}</span>
                        </div>
                        <p className="text-[11px] text-slate-400 leading-relaxed font-semibold">{n.message}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* RPT FAQS CARD */}
              <div className="bg-slate-900/20 border border-slate-800 rounded-3xl p-6">
                <h3 className="text-xs font-black text-white uppercase tracking-wider mb-4 flex items-center gap-2">
                  <HelpCircle className="w-4 h-4 text-blue-400 animate-bounce" />
                  Real Property Tax (RPT) FAQ & Information Guidelines
                </h3>
                <div className="space-y-4 text-xs font-semibold text-slate-400">
                  <div className="space-y-1">
                    <p className="font-bold text-slate-200">1. When is the deadline for filing Dipaculao RPT taxes?</p>
                    <p className="leading-relaxed">Real Property Tax is payable on an annual basis on or before March 31 of each taxable year to avoid late surcharge interest rates.</p>
                  </div>
                  <div className="h-px bg-slate-800/60" />
                  <div className="space-y-1">
                    <p className="font-bold text-slate-200">2. How are penalties computed for delinquent RPT status?</p>
                    <p className="leading-relaxed">An interest rate of 2% per month is added to the primary RPT tax amount until the delinquency is paid, capped at a maximum of 36 months (72%) according to RA 7160 Sec 255 laws.</p>
                  </div>
                  <div className="h-px bg-slate-800/60" />
                  <div className="space-y-1">
                    <p className="font-bold text-slate-200">3. Is online payment verified and secure?</p>
                    <p className="leading-relaxed">Absolutely. All transactions handled on the taxpayer e-portal sync directly to the Dipaculao Municipal Treasury server. Each transaction registers an immutable audit track.</p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* FOOTER */}
        <footer className="mt-16 border-t border-slate-800/40 pt-4 flex flex-col md:flex-row items-center justify-between gap-4 text-[10px] text-slate-500 font-semibold font-mono">
          <span>&copy; 2026 Dipaculao, Aurora e-Governance Unit. All rights cleared.</span>
          <span className="bg-slate-900/50 border border-slate-800 px-3 py-1 rounded-lg">RPT SECURE LAYER PORTAL V1.4.2</span>
        </footer>
      </main>

      {/* ONLINE CHECKOUT / DIGITAL RECEIPT MODAL */}
      <AnimatePresence>
        {isPayModalOpen && (
          <div className="fixed inset-0 z-[150] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => { if (paymentStep !== "processing") setIsPayModalOpen(false); }}
              className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm"
            />

            <motion.div 
              initial={{ scale: 0.95, y: 15, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.95, y: 15, opacity: 0 }}
              className="bg-slate-900 border border-slate-800/70 p-6 rounded-[2.5rem] w-full max-w-lg relative z-10 shadow-2xl max-h-[90vh] overflow-y-auto"
            >
              {/* DETAILS AND CHECKOUT */}
              {paymentStep === "details" && (
                <div className="space-y-6">
                  <div className="text-center">
                    <span className="text-[8px] font-black uppercase text-blue-400 tracking-widest bg-blue-500/10 border border-blue-500/20 px-2.5 py-1 rounded-full">Secure e-Payment Gateway</span>
                    <h3 className="text-xl font-black text-white mt-3 uppercase tracking-tight">RPT Electronic Remittance</h3>
                    <p className="text-xs text-slate-500">Settle outstanding balances via state-integrated digital providers.</p>
                  </div>

                  <div className="bg-slate-950 rounded-2xl border border-slate-800/80 p-4 space-y-3">
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-slate-400 font-semibold uppercase tracking-wider block">Sum of Liabilities Selected</span>
                      <span className="font-mono text-slate-400 font-bold">{selectedDelinqs.size} Records</span>
                    </div>
                    <div className="h-px bg-slate-800/50" />
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-slate-400 font-black uppercase tracking-wider block">Amount Payable Net</span>
                      <span className="text-xl font-bold font-mono text-blue-400">₱{getSubTotalSelected().toLocaleString()}</span>
                    </div>
                  </div>

                  {/* SELECT PAYMENT GATEWAY CATEGORIES */}
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-1">Choose Payment Operator</label>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={() => setPaymentMethod("gcash")}
                        className={`p-3.5 rounded-2xl border transition-all text-xs font-black uppercase tracking-wider text-center cursor-pointer ${
                          paymentMethod === "gcash"
                            ? "bg-blue-600/10 border-blue-500 text-blue-400 shadow-inner"
                            : "bg-slate-950 border-slate-800 text-slate-500 hover:border-slate-700 hover:text-white"
                        }`}
                      >
                        GCASH E-WALLET
                      </button>
                      <button
                        type="button"
                        onClick={() => setPaymentMethod("paymaya")}
                        className={`p-3.5 rounded-2xl border transition-all text-xs font-black uppercase tracking-wider text-center cursor-pointer ${
                          paymentMethod === "paymaya"
                            ? "bg-emerald-600/10 border-emerald-500 text-emerald-400 shadow-inner"
                            : "bg-slate-950 border-slate-800 text-slate-500 hover:border-slate-700 hover:text-white"
                        }`}
                      >
                        MAYA WALLET
                      </button>
                      <button
                        type="button"
                        onClick={() => setPaymentMethod("card")}
                        className={`p-3.5 rounded-2xl border transition-all text-xs font-black uppercase tracking-wider text-center cursor-pointer ${
                          paymentMethod === "card"
                            ? "bg-blue-600/10 border-blue-500 text-blue-400 shadow-inner"
                            : "bg-slate-950 border-slate-800 text-slate-500 hover:border-slate-700 hover:text-white"
                        }`}
                      >
                        CREDIT / DEBIT CARD
                      </button>
                      <button
                        type="button"
                        onClick={() => setPaymentMethod("bank")}
                        className={`p-3.5 rounded-2xl border transition-all text-xs font-black uppercase tracking-wider text-center cursor-pointer ${
                          paymentMethod === "bank"
                            ? "bg-purple-600/10 border-purple-500 text-purple-400 shadow-inner"
                            : "bg-slate-950 border-slate-800 text-slate-500 hover:border-slate-700 hover:text-white"
                        }`}
                      >
                        ONLINE BANKING
                      </button>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block font-sans">Verification Reference Confirmation Number</label>
                    <input
                      type="text"
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl h-11 px-3 text-xs text-white focus:border-blue-500 outline-none font-mono"
                      placeholder="Enter mobile wallet transaction ID..."
                      value={cashTendered}
                      onChange={e => setCashTendered(e.target.value)}
                    />
                  </div>

                  {/* BOTTOM TOOL ACTIONS */}
                  <div className="flex gap-2 border-t border-slate-800/40 pt-4">
                    <button
                      type="button"
                      onClick={() => setIsPayModalOpen(false)}
                      className="flex-1 py-3 bg-slate-950 border border-slate-800 rounded-xl text-xs font-semibold uppercase tracking-widest text-slate-400 hover:text-white transition-colors cursor-pointer"
                    >
                      Dismiss Checkout
                    </button>
                    <button
                      type="button"
                      onClick={executeOnlinePayment}
                      className="flex-1 py-3 bg-white hover:bg-slate-100 text-slate-950 rounded-xl text-xs font-bold uppercase tracking-widest transition-transform hover:scale-[1.02] cursor-pointer"
                    >
                      Authorize Payment
                    </button>
                  </div>
                </div>
              )}

              {/* PROCESSING SCREEN */}
              {paymentStep === "processing" && (
                <div className="py-12 flex flex-col items-center justify-center gap-4 text-center">
                  <div className="w-16 h-16 border-4 border-blue-500/20 border-t-blue-500 rounded-full animate-spin" />
                  <p className="text-white font-bold tracking-widest text-xs uppercase animate-pulse">Processing Remittance Secures...</p>
                  <p className="text-slate-500 text-[9px] font-mono">DIPACULAO_COMM_LINK_ENCRYPTED_VALIDATING_OR</p>
                </div>
              )}

              {/* SUCCESS RECEIPT / PDF CERTIFICATE VIEW */}
              {paymentStep === "success" && paymentSuccessData && (
                <div className="space-y-6 text-slate-200">
                  <div className="text-center pb-4 border-b border-slate-800">
                    <div className="w-12 h-12 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mx-auto mb-3">
                      <Check className="w-6 h-6 text-emerald-400" />
                    </div>
                    <span className="text-[8px] font-mono font-bold text-emerald-400 uppercase tracking-widest border border-emerald-500/10 bg-emerald-500/5 px-2 py-0.5 rounded">RPT_PAYMENT_SUCCESS</span>
                    <h3 className="text-lg font-black text-white mt-2 uppercase tracking-tight">Tax Settlement Clear</h3>
                    <p className="text-xs text-slate-500">Official receipt cleared at Dipaculao Treasury</p>
                  </div>

                  {/* HIGH FIDELITY STATEMENT RECORD */}
                  <div id="taxpayer-or-print" className="bg-slate-950 p-6 rounded-3xl border border-slate-800/80 space-y-4 font-mono text-[11px] text-slate-400 leading-tight">
                    <div className="text-center font-bold text-slate-300 text-xs pb-3 border-b border-dashed border-slate-800">
                      <p>MUNICIPAL TREASURY OFFICE</p>
                      <p>DIPACULAO, AURORA, PHILIPPINES</p>
                      <p className="text-[10px] text-slate-500 mt-1 uppercase">Official Electronic Receipt</p>
                    </div>

                    <div className="space-y-2">
                      <p><span className="text-slate-500 font-black">PAYER:</span> <span className="text-white font-sans">{profile?.displayName}</span></p>
                      <p><span className="text-slate-500 font-black">TAX REF:</span> <span className="text-white font-bold">{paymentSuccessData.orNumbers.join(", ")}</span></p>
                      <p><span className="text-slate-500 font-black">DATE:</span> <span className="text-white">{paymentSuccessData.receiptDate}</span></p>
                      <p><span className="text-slate-500 font-black">PROPERTIES:</span> <span className="text-white">{paymentSuccessData.propertiesPaidCount} Tax Bill Items Cleared</span></p>
                      <p><span className="text-slate-500 font-black">STATUS:</span> <span className="text-emerald-400 font-bold uppercase">PAID & COMPLIANT</span></p>
                    </div>

                    <div className="h-px bg-slate-850 border-b border-dashed border-slate-800 my-4" />

                    <div className="flex justify-between font-bold text-xs text-slate-300">
                      <span>TOTAL REMITTED CASH:</span>
                      <span className="text-emerald-400 font-black font-sans text-sm">₱{paymentSuccessData.amountPaid.toLocaleString()}</span>
                    </div>

                    <div className="text-center text-[8px] text-slate-600 font-black tracking-wider uppercase pt-3 border-t border-dashed border-slate-800 mt-4">
                      --- VERIFIED BY THE MUNICIPAL BOARD ---
                    </div>
                  </div>

                  {/* PRINT & DISMISS */}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={handlePrintReceipt}
                      className="flex-1 py-3 bg-slate-800 hover:bg-slate-700 text-blue-400 border border-slate-700/60 rounded-xl text-xs font-black uppercase tracking-widest flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <Printer className="w-4 h-4" />
                      Print e-Receipt
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsPayModalOpen(false);
                        setActiveSubTab("dashboard");
                      }}
                      className="flex-1 py-3 bg-white hover:bg-slate-100 text-slate-950 rounded-xl text-xs font-black uppercase tracking-widest text-center cursor-pointer"
                    >
                      Done
                    </button>
                  </div>
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
