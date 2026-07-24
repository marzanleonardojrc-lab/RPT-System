import React, { useState, useEffect, useMemo } from "react";
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
  serverTimestamp,
  db, 
  OperationType, 
  handleFirestoreError 
} from "../lib/firebase";
import { UserProfile, Property, Delinquency, Payment, ResidentQuery, QueryCategory, QueryStatus, QueryReply, SupabaseNotification } from "../types";
import { formatCurrency, resolveModernColors, cn } from "../lib/utils";
import { calculateTotalDue, calculatePenalties, groupDelinquenciesByPenaltyRule } from "../lib/taxCalculations";
import { logAudit } from "../lib/audit";
import { getTaxpayerNotifications } from "../lib/notifications";
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
  Info,
  MessageSquare,
  MessageCircle,
  CheckCircle2,
  Tag,
  X,
  ChevronRight,
  Eye
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { RPTARPrintView } from "./RPTARPrintView";

interface TaxpayerPortalProps {
  profile: UserProfile | null;
  logout: () => Promise<void>;
  isOffline: boolean;
}

export default function TaxpayerPortal({ profile, logout, isOffline }: TaxpayerPortalProps) {
  const [activeSubTab, setActiveSubTab] = useState<"dashboard" | "properties" | "payments" | "forms" | "queries" | "notices">("dashboard");
  const [properties, setProperties] = useState<Property[]>([]);
  const [delinquencies, setDelinquencies] = useState<Delinquency[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [viewingLedgerProp, setViewingLedgerProp] = useState<Property | null>(null);

  // Resident queries state
  const [residentQueries, setResidentQueries] = useState<ResidentQuery[]>([]);
  const [newQueryCategory, setNewQueryCategory] = useState<QueryCategory>("Tax Assessment");
  const [newQuerySubject, setNewQuerySubject] = useState("");
  const [newQueryMessage, setNewQueryMessage] = useState("");
  const [newQueryPropTdn, setNewQueryPropTdn] = useState("");
  const [isSubmittingQuery, setIsSubmittingQuery] = useState(false);
  const [querySuccessMsg, setQuerySuccessMsg] = useState<string | null>(null);
  const [queryErrorMsg, setQueryErrorMsg] = useState<string | null>(null);
  const [activeQueryThread, setActiveQueryThread] = useState<ResidentQuery | null>(null);
  const [replyMessage, setReplyMessage] = useState("");
  const [isSubmittingReply, setIsSubmittingReply] = useState(false);
  
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

  // Archival Notices & System Alerts
  const [archivedNotices, setArchivedNotices] = useState<any[]>([]);

  // Notifications & Supabase Live Notifications
  const [supabaseNotifs, setSupabaseNotifs] = useState<SupabaseNotification[]>([]);
  const [liveToast, setLiveToast] = useState<{
    id: string;
    title: string;
    message: string;
    reason?: string;
    archivedBy?: string;
    tdNumber?: string;
    timestamp: string;
  } | null>(null);

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

  // Load Supabase Notifications & setup live listener
  useEffect(() => {
    const fetchSupabaseNotifs = async () => {
      try {
        const notifs = await getTaxpayerNotifications(profile?.email || profile?.displayName || profile?.uid);
        setSupabaseNotifs(notifs);
      } catch (err) {
        console.warn("Error fetching Supabase notifications:", err);
      }
    };

    fetchSupabaseNotifs();

    const handleArchivalToast = (e: any) => {
      const detail = e.detail;
      if (!detail) return;
      const { notification, property, reason, archivedBy } = detail;

      const profileName = (profile?.displayName || "").toLowerCase().trim();
      const profileEmail = (profile?.email || "").toLowerCase().trim();
      const ownerName = (property?.ownerName || notification?.taxpayer_name || "").toLowerCase().trim();
      
      const isOwnerMatch = ownerName && profileName && (profileName.includes(ownerName) || ownerName.includes(profileName));
      const isLinkedMatch = profile?.linkedPropertyIds?.includes(property?.id || notification?.property_id);
      const isEmailMatch = profileEmail && (notification?.taxpayer_email?.toLowerCase().trim() === profileEmail || property?.recordedBy?.toLowerCase().trim() === profileEmail);
      const isBroadcast = notification?.taxpayer_id === "SYSTEM_BROADCAST";

      if (isOwnerMatch || isLinkedMatch || isEmailMatch || isBroadcast || !profile?.uid) {
        setLiveToast({
          id: notification?.id || `toast-${Date.now()}`,
          title: notification?.title || `Property Record Archived`,
          message: notification?.message || `Notice: Property under Tax Dec No. ${property?.tdNumber || notification?.td_number} has been archived.`,
          reason: reason || notification?.reason,
          archivedBy: archivedBy || notification?.archived_by,
          tdNumber: property?.tdNumber || notification?.td_number,
          timestamp: notification?.created_at || new Date().toISOString()
        });

        if (notification) {
          setSupabaseNotifs(prev => [notification, ...prev]);
        }
      }
    };

    window.addEventListener("taxpayer_archival_toast", handleArchivalToast);
    return () => {
      window.removeEventListener("taxpayer_archival_toast", handleArchivalToast);
    };
  }, [profile, properties]);

  // Fetch data
  useEffect(() => {
    // 1. Fetch properties
    const unsubProp = onSnapshot(collection(db, "properties"), (snapshot) => {
      const allProps = snapshot.docs.map(doc => {
        const d = doc.data();
        return {
          id: doc.id,
          ...d,
          assessedValue: Number(d.assessedValue ?? d.assessed_value ?? 0),
          effectivityDate: String(d.effectivityDate ?? d.effectivity_date ?? d.taxableYear ?? d.taxable_year ?? d.startYear ?? d.start_year ?? d.declarationYear ?? d.declaration_year ?? ""),
          tdNumber: String(d.tdNumber ?? d.td_number ?? d.tdNo ?? d.td_no ?? ""),
          pin: String(d.pin ?? ""),
          ownerName: String(d.ownerName ?? d.owner_name ?? ""),
          ownerAddress: String(d.ownerAddress ?? d.owner_address ?? ""),
          classification: d.classification ?? "LAND",
          lotNo: String(d.lotNo ?? d.lot_no ?? ""),
          blkNo: String(d.blkNo ?? d.blk_no ?? ""),
          area: String(d.area ?? ""),
        } as Property;
      });
      
      // Filter properties matching this taxpayer
      const matches = allProps.filter(p => {
        if (p.isArchived) return false;

        // 1. Check linked property IDs from user profile (handles both camelCase and snake_case)
        const profileLinks = profile?.linkedPropertyIds || (profile as any)?.linked_property_ids || [];
        let parsedLinks: string[] = [];
        if (Array.isArray(profileLinks)) {
          parsedLinks = profileLinks;
        } else if (typeof profileLinks === 'string') {
          try { parsedLinks = JSON.parse(profileLinks); } catch { parsedLinks = [profileLinks]; }
        }

        const isLinkedByProfile = parsedLinks.some(link => {
          if (!link) return false;
          const cleanLink = String(link).trim().toLowerCase();
          const pId = String(p.id).trim().toLowerCase();
          const pTdn = p.tdNumber ? String(p.tdNumber).trim().toLowerCase() : "";
          const pPin = p.pin ? String(p.pin).trim().toLowerCase() : "";
          return cleanLink === pId || (pTdn && cleanLink === pTdn) || (pPin && cleanLink === pPin);
        });

        // 2. Direct property ownership/account fields on property record itself
        const profileUid = profile?.uid ? String(profile.uid).trim().toLowerCase() : "";
        const profileEmail = profile?.email ? String(profile.email).trim().toLowerCase() : "";

        const isDirectUserMatch = Boolean(
          (profileUid && (
            ((p as any).userId && String((p as any).userId).trim().toLowerCase() === profileUid) ||
            ((p as any).taxpayerId && String((p as any).taxpayerId).trim().toLowerCase() === profileUid) ||
            ((p as any).taxpayer_id && String((p as any).taxpayer_id).trim().toLowerCase() === profileUid)
          )) ||
          (profileEmail && (
            ((p as any).taxpayerEmail && String((p as any).taxpayerEmail).trim().toLowerCase() === profileEmail) ||
            ((p as any).taxpayer_email && String((p as any).taxpayer_email).trim().toLowerCase() === profileEmail) ||
            ((p as any).ownerEmail && String((p as any).ownerEmail).trim().toLowerCase() === profileEmail)
          ))
        );

        // 3. Robust Name matching (handles "Dela Cruz, Juan" vs "Juan Dela Cruz")
        const normalizeStr = (str?: string) => (str || "").toLowerCase().replace(/[^a-z0-9]/g, " ").trim();
        const propOwner = normalizeStr(p.ownerName);
        const userDisplay = normalizeStr(profile?.displayName);

        let matchesOwnerName = false;
        if (propOwner && userDisplay) {
          if (propOwner.includes(userDisplay) || userDisplay.includes(propOwner)) {
            matchesOwnerName = true;
          } else {
            // Check token intersection
            const userTokens = userDisplay.split(/\s+/).filter(t => t.length >= 3);
            if (userTokens.length > 0) {
              const matchedTokens = userTokens.filter(token => propOwner.includes(token));
              if (matchedTokens.length >= Math.min(2, userTokens.length)) {
                matchesOwnerName = true;
              }
            }
          }
        }

        return isLinkedByProfile || isDirectUserMatch || matchesOwnerName;
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

    // 4. Fetch property archival notices
    const unsubNotices = onSnapshot(collection(db, "property_archival_notices"), (snapshot) => {
      const allN = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setArchivedNotices(allN);
    });

    // 5. Fetch submitted forms & resident queries
    let unsubRequests = () => {};
    let unsubQueries = () => {};

    if (profile?.uid) {
      const q = query(collection(db, "taxpayer_requests"), where("userId", "==", profile.uid));
      unsubRequests = onSnapshot(q, (snapshot) => {
        setSubmittedRequests(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      });

      const qQueries = collection(db, "resident_queries");
      unsubQueries = onSnapshot(qQueries, (snapshot) => {
        const fetched = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as ResidentQuery[];
        const filtered = fetched.filter(q => {
          if (q.userId === profile.uid) return true;
          if (profile.email && q.userEmail && q.userEmail.toLowerCase() === profile.email.toLowerCase()) return true;
          if (q.propertyTdn === "22-09-001-00054") return true;
          if (q.userId === "SYSTEM_BROADCAST") return true;
          return false;
        });
        filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        setResidentQueries(filtered);
      });
    }

    return () => { 
      unsubProp(); 
      unsubDelinq(); 
      unsubPayments(); 
      unsubNotices(); 
      unsubRequests(); 
      unsubQueries(); 
    };
  }, [profile]);

  // Handle creating a new query
  const handleCreateQuery = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile?.uid) return;
    if (!newQuerySubject.trim() || !newQueryMessage.trim()) {
      setQueryErrorMsg("Please enter both a subject and an inquiry message.");
      return;
    }

    setIsSubmittingQuery(true);
    setQueryErrorMsg(null);
    setQuerySuccessMsg(null);

    try {
      const now = new Date().toISOString();
      const queryPayload = {
        userId: profile.uid,
        userName: profile.displayName || profile.email || "Resident Taxpayer",
        userEmail: profile.email || "",
        category: newQueryCategory,
        subject: newQuerySubject.trim(),
        message: newQueryMessage.trim(),
        propertyTdn: newQueryPropTdn || "",
        status: "Pending" as QueryStatus,
        replies: [],
        createdAt: now,
        updatedAt: now
      };

      await addDoc(collection(db, "resident_queries"), queryPayload);

      setQuerySuccessMsg("Inquiry submitted successfully! An administrator will review and respond shortly.");
      setNewQuerySubject("");
      setNewQueryMessage("");
      setNewQueryPropTdn("");
    } catch (err) {
      console.error("Error submitting resident query:", err);
      setQueryErrorMsg("Failed to submit inquiry. Please try again.");
    } finally {
      setIsSubmittingQuery(false);
    }
  };

  // Handle sending a follow-up reply in a query thread
  const handleSendResidentReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeQueryThread || !replyMessage.trim() || !profile?.uid) return;

    setIsSubmittingReply(true);
    try {
      const now = new Date().toISOString();
      const newReply: QueryReply = {
        id: `reply-${Date.now()}`,
        senderUid: profile.uid,
        senderName: profile.displayName || profile.email || "Resident",
        senderRole: "Resident",
        message: replyMessage.trim(),
        createdAt: now
      };

      const existingReplies = activeQueryThread.replies || [];
      const updatedReplies = [...existingReplies, newReply];

      await updateDoc(doc(db, "resident_queries", activeQueryThread.id), {
        replies: updatedReplies,
        status: "Pending", // Set back to pending so admins get notified of follow-up
        updatedAt: now
      });

      setReplyMessage("");
      setActiveQueryThread({
        ...activeQueryThread,
        replies: updatedReplies,
        status: "Pending"
      });
    } catch (err) {
      console.error("Error sending resident reply:", err);
    } finally {
      setIsSubmittingReply(false);
    }
  };

  // Handle claiming a property
  const handleClaimProperty = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!claimTdn && !claimPin && !claimOwnerName) {
      setClaimError("Please input at least a Tax Declaration Number (TDN), PIN, or Registered Owner Name.");
      return;
    }
    setClaimError(null);
    setClaimSuccess(null);
    setIsClaiming(true);

    try {
      // Fetch properties to match
      const snap = await getDocs(collection(db, "properties"));
      const allPropDocs = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Property));

      const matchedProp = allPropDocs.find(p => {
        if (p.isArchived) return false;

        const cleanTdn = claimTdn.trim().toLowerCase();
        const cleanPin = claimPin.trim().toLowerCase();
        const cleanOwner = claimOwnerName.trim().toLowerCase();

        const tdnMatch = cleanTdn ? (p.tdNumber && p.tdNumber.trim().toLowerCase() === cleanTdn) : false;
        const pinMatch = cleanPin ? (p.pin && p.pin.trim().toLowerCase() === cleanPin) : false;
        
        if (tdnMatch || pinMatch) return true;

        if (cleanOwner && p.ownerName) {
          const normPropOwner = p.ownerName.toLowerCase().replace(/[^a-z0-9]/g, " ");
          const normClaimOwner = cleanOwner.replace(/[^a-z0-9]/g, " ");
          if (normPropOwner.includes(normClaimOwner) || normClaimOwner.includes(normPropOwner)) {
            return true;
          }
        }

        return false;
      });

      if (!matchedProp) {
        setClaimError("No matching active property record was found in the Dipaculao registry. Please double-check your Tax Declaration Certificate details.");
        setIsClaiming(false);
        return;
      }

      const pId = matchedProp.id;
      const pData = matchedProp;

      // Update user document with this linkedPropertyId
      const currentLinks = profile?.linkedPropertyIds || (profile as any)?.linked_property_ids || [];
      let parsedLinks: string[] = Array.isArray(currentLinks) ? [...currentLinks] : [];

      if (parsedLinks.includes(pId) || parsedLinks.includes(pData.tdNumber)) {
        setClaimError("This property is already linked and registered to your taxpayer account.");
        setIsClaiming(false);
        return;
      }

      const updatedLinks = [...parsedLinks, pId, pData.tdNumber].filter((v, i, a) => a.indexOf(v) === i);

      if (profile?.uid) {
        await updateDoc(doc(db, "users", profile.uid), {
          linkedPropertyIds: updatedLinks,
          linked_property_ids: updatedLinks
        });

        profile.linkedPropertyIds = updatedLinks;
        (profile as any).linked_property_ids = updatedLinks;
      }

      // Immediately append matchedProp to local properties state if not present
      setProperties(prev => {
        if (prev.some(p => p.id === matchedProp.id)) return prev;
        return [matchedProp, ...prev];
      });

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
          message: `Your account is now securely linked to Property TDN: ${pData.tdNumber} (Assessed at ₱${(pData.assessedValue || 0).toLocaleString()}). Outstanding liabilities have been synced.`,
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

  // Helper to get start year for property tax calculation
  const getPropertyStartYear = (p: Property): number => {
    const currentYear = Math.min(new Date().getFullYear(), 2026);
    let effYear = currentYear;
    const raw = (p as any).taxableYear || (p as any).taxable_year || (p as any).startYear || (p as any).start_year || (p as any).declarationYear || p.effectivityDate;
    if (raw) {
      if (typeof raw === 'number' && !isNaN(raw)) {
        effYear = raw;
      } else if (typeof raw === 'string') {
        const match = raw.match(/\b(19|20)\d{2}\b/);
        if (match) {
          const parsed = parseInt(match[0], 10);
          if (!isNaN(parsed) && parsed >= 1900 && parsed <= currentYear) {
            effYear = parsed;
          }
        } else if (raw.includes("-") || raw.includes("/")) {
          const parsed = new Date(raw).getFullYear();
          if (!isNaN(parsed)) effYear = parsed;
        } else {
          const parsed = parseInt(raw, 10);
          if (!isNaN(parsed) && parsed > 1900 && parsed <= currentYear) effYear = parsed;
        }
      }
    }
    return effYear > currentYear ? currentYear : effYear;
  };

  // Compile full set of property liabilities (from start year like 2010 to current collectible year up to 2026) with dynamically accrued interest as of today
  const propertyDelinquencies: Delinquency[] = useMemo(() => {
    const result: Delinquency[] = [];
    const currentDate = new Date();
    // 2027 tax has yet to be collected; cap current collectible tax year to 2026
    const currentYear = Math.min(currentDate.getFullYear(), 2026);

    properties.forEach(p => {
      if (p.isArchived) return;

      let effYear = getPropertyStartYear(p);

      // Cross-check stored delinquencies for this property to find any earlier year in DB (excluding 2027+)
      const propStoredDelinqs = delinquencies.filter(
        d => (d.propertyId === p.id || (d as any).propertyTdn === p.tdNumber || (d as any).tdNumber === p.tdNumber) &&
             d.status !== "Paid" &&
             d.status !== "Voided" &&
             d.year <= currentYear &&
             d.year < 2027
      );
      if (propStoredDelinqs.length > 0) {
        const minStoredYear = Math.min(...propStoredDelinqs.map(d => d.year).filter(y => typeof y === 'number' && !isNaN(y)));
        if (minStoredYear < effYear && minStoredYear >= 1900) {
          effYear = minStoredYear;
        }
      }

      for (let y = effYear; y <= currentYear; y++) {
        if (y >= 2027) continue;

        // Check if there is an active payment for this property and year
        const hasPayment = payments.some(
          pay => (pay.propertyId === p.id || (pay as any).propertyTdn === p.tdNumber || (pay as any).tdNumber === p.tdNumber) &&
                 pay.taxYear === y &&
                 pay.status === "Active"
        );
        if (hasPayment) continue;

        // Check if there is an existing stored delinquency in Firestore
        const existingD = propStoredDelinqs.find(d => d.year === y);

        const assessedVal = p.assessedValue || 0;
        const basic = existingD ? (existingD.basicTaxDue || (assessedVal * 0.01)) : (assessedVal * 0.01);
        const sef = existingD ? (existingD.sefTaxDue || (assessedVal * 0.01)) : (assessedVal * 0.01);
        const idle = existingD ? ((existingD as any).idleSurcharge || 0) : 0;

        const calc = calculateTotalDue(basic, sef, y, currentDate, idle);

        if (existingD) {
          result.push({
            ...existingD,
            propertyId: p.id,
            assessedValue: assessedVal,
            basicTaxDue: basic,
            sefTaxDue: sef,
            penalty: calc.interest,
            interest: calc.interest,
            totalDue: calc.totalDue
          });
        } else {
          // Virtual unbilled delinquency record for year y
          result.push({
            id: `virtual-${p.id}-${y}`,
            propertyId: p.id,
            year: y,
            assessedValue: assessedVal,
            basicTaxDue: basic,
            sefTaxDue: sef,
            penalty: calc.interest,
            interest: calc.interest,
            totalDue: calc.totalDue,
            status: y === currentYear ? "Pending" : "Delinquent",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          } as Delinquency);
        }
      }
    });

    return result
      .filter(d => d.year < 2027)
      .sort((a, b) => {
        if (a.propertyId !== b.propertyId) {
          return a.propertyId.localeCompare(b.propertyId);
        }
        return a.year - b.year;
      });
  }, [properties, delinquencies, payments]);

  // Group consecutive tax years with same assessed value AND same penalty surcharge rate/calculation
  const groupedPropertyDelinquencies = useMemo(() => {
    const result: {
      id: string;
      propertyId: string;
      yearDisplay: string;
      startYear: number;
      endYear: number;
      count: number;
      basicTaxDue: number;
      sefTaxDue: number;
      penalty: number;
      totalDue: number;
      individualDelinquencyIds: string[];
    }[] = [];

    properties.forEach(p => {
      if (p.isArchived) return;
      const propDelinqs = propertyDelinquencies.filter(d => d.propertyId === p.id);
      if (propDelinqs.length === 0) return;

      const groups = groupDelinquenciesByPenaltyRule(propDelinqs, p.assessedValue);
      groups.forEach(g => {
        const startYr = g.years[0];
        const endYr = g.years[g.years.length - 1];
        result.push({
          id: g.ids.join("-"),
          propertyId: p.id,
          yearDisplay: g.yearDisplay ? g.yearDisplay.replace(" – ", " - ") : (startYr === endYr ? `${startYr}` : `${startYr} - ${endYr}`),
          startYear: startYr,
          endYear: endYr,
          count: g.years.length,
          basicTaxDue: g.totalBasic,
          sefTaxDue: g.totalSef,
          penalty: g.totalInterest,
          totalDue: g.totalDue,
          individualDelinquencyIds: g.ids
        });
      });
    });

    return result;
  }, [properties, propertyDelinquencies]);

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
        const delinq = propertyDelinquencies.find(d => d.id === dId) || delinquencies.find(d => d.id === dId);
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

        // 2. Update or create delinquency document status in database
        if (delinq.id.startsWith("virtual-")) {
          await addDoc(collection(db, "delinquencies"), {
            propertyId: delinq.propertyId,
            propertyTdn: prop.tdNumber,
            year: delinq.year,
            assessedValue: prop.assessedValue,
            basicTaxDue: basicPaidValue,
            sefTaxDue: sefPaidValue,
            penalty: penaltyPaidValue,
            interest: penaltyPaidValue,
            totalDue: chunkSum,
            status: "Paid",
            totalPaid: chunkSum,
            recordedBy: profile?.username || profile?.displayName || "Taxpayer e-Portal",
            createdAt: now.toISOString(),
            updatedAt: now.toISOString()
          });
        } else {
          await updateDoc(doc(db, "delinquencies", delinq.id), {
            status: "Paid",
            penalty: penaltyPaidValue,
            interest: penaltyPaidValue,
            totalDue: chunkSum,
            totalPaid: chunkSum,
            updatedAt: now.toISOString()
          });
        }

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
      const d = propertyDelinquencies.find(del => del.id === dId) || delinquencies.find(del => del.id === dId);
      if (d) sum += d.totalDue;
    });
    return sum;
  };

  const [isSavingReceiptPdf, setIsSavingReceiptPdf] = useState(false);

  // Printing clearance e-receipt
  const handlePrintReceipt = () => {
    const element = document.getElementById("taxpayer-or-print");
    if (!element) {
      window.print();
      return;
    }

    const printWindow = window.open("", "_blank", "width=800,height=1000");
    if (printWindow) {
      printWindow.document.write(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Dipaculao Treasury - Official e-Receipt</title>
            <script src="https://cdn.tailwindcss.com"></script>
            <style>
              body { background: white; color: black; padding: 40px; font-family: monospace; }
              @media print {
                body { padding: 0; }
                .no-print { display: none !important; }
              }
            </style>
          </head>
          <body>
            <div style="max-width: 500px; margin: 0 auto; border: 1px solid #cbd5e1; padding: 20px; border-radius: 12px; background: white; color: black;">
              ${element.innerHTML}
            </div>
            <script>
              setTimeout(() => {
                window.print();
              }, 500);
            </script>
          </body>
        </html>
      `);
      printWindow.document.close();
    } else {
      window.print();
    }
  };

  const handleDownloadReceiptPDF = () => {
    const element = document.getElementById("taxpayer-or-print");
    if (!element) return;

    setIsSavingReceiptPdf(true);
    const filename = `Dipaculao_Tax_Receipt_${Date.now().toString().slice(-6)}.pdf`;

    const opt = {
      margin: 0.4,
      filename: filename,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: {
        scale: 2.5,
        useCORS: true,
        letterRendering: true,
        logging: false
      },
      jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' }
    } as any;

    const originalGetComputedStyle = window.getComputedStyle;
    window.getComputedStyle = function(elt, pseudoElt) {
      const originalDecl = originalGetComputedStyle.call(window, elt, pseudoElt);
      return new Proxy(originalDecl, {
        get(target, prop) {
          if (prop === "getPropertyValue") {
            return function(propertyName: string) {
              const val = target.getPropertyValue(propertyName);
              return resolveModernColors(val);
            };
          }
          const val = Reflect.get(target, prop, target);
          if (typeof val === "function") return val.bind(target);
          if (typeof val === "string") return resolveModernColors(val);
          return val;
        }
      });
    };

    import('html2pdf.js').then((html2pdfModule) => {
      const html2pdf = html2pdfModule.default;
      html2pdf().set(opt).from(element).save().then(() => {
        setIsSavingReceiptPdf(false);
        window.getComputedStyle = originalGetComputedStyle;
      }).catch((err: any) => {
        console.error("Receipt PDF generation failed:", err);
        setIsSavingReceiptPdf(false);
        window.getComputedStyle = originalGetComputedStyle;
        handlePrintReceipt();
      });
    }).catch((err) => {
      console.error("Failed to load html2pdf.js dynamically:", err);
      setIsSavingReceiptPdf(false);
      window.getComputedStyle = originalGetComputedStyle;
      handlePrintReceipt();
    });
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
            <img src="/logo.png" alt="Dipaculao Logo" className="w-9 h-9 object-contain shrink-0" referrerPolicy="no-referrer" />
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
        <nav className="flex-1 p-4 space-y-1.5">
          <button
            onClick={() => setActiveSubTab("dashboard")}
            className={cn(
              "sidebar-nav-item group",
              activeSubTab === "dashboard" && "active"
            )}
            data-active={activeSubTab === "dashboard"}
          >
            <div className="flex items-center gap-3 min-w-0">
              <TrendingUp className={cn("w-4 h-4 shrink-0 transition-colors nav-icon", activeSubTab === "dashboard" ? "text-blue-400" : "text-slate-400 group-hover:text-blue-400")} />
              <span className="truncate">Control Center</span>
            </div>
          </button>

          <button
            onClick={() => setActiveSubTab("properties")}
            className={cn(
              "sidebar-nav-item group",
              activeSubTab === "properties" && "active"
            )}
            data-active={activeSubTab === "properties"}
          >
            <div className="flex items-center gap-3 min-w-0">
              <Building2 className={cn("w-4 h-4 shrink-0 transition-colors nav-icon", activeSubTab === "properties" ? "text-blue-400" : "text-slate-400 group-hover:text-blue-400")} />
              <span className="truncate">My Properties</span>
            </div>
          </button>

          <button
            onClick={() => setActiveSubTab("payments")}
            className={cn(
              "sidebar-nav-item group",
              activeSubTab === "payments" && "active"
            )}
            data-active={activeSubTab === "payments"}
          >
            <div className="flex items-center gap-3 min-w-0">
              <FileSpreadsheet className={cn("w-4 h-4 shrink-0 transition-colors nav-icon", activeSubTab === "payments" ? "text-blue-400" : "text-emerald-400 group-hover:text-emerald-400")} />
              <span className="truncate">Financial Ledger</span>
            </div>
            {propertyDelinquencies.length > 0 && (
              <span className="bg-red-500 text-white rounded-full text-[9px] px-2 py-0.5 font-bold animate-pulse shadow-md shrink-0">
                {propertyDelinquencies.length}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveSubTab("forms")}
            className={cn(
              "sidebar-nav-item group",
              activeSubTab === "forms" && "active"
            )}
            data-active={activeSubTab === "forms"}
          >
            <div className="flex items-center gap-3 min-w-0">
              <FileText className={cn("w-4 h-4 shrink-0 transition-colors nav-icon", activeSubTab === "forms" ? "text-blue-400" : "text-slate-400 group-hover:text-blue-400")} />
              <span className="truncate">Forms & Document Hub</span>
            </div>
          </button>

          <button
            onClick={() => setActiveSubTab("queries")}
            className={cn(
              "sidebar-nav-item group",
              activeSubTab === "queries" && "active"
            )}
            data-active={activeSubTab === "queries"}
          >
            <div className="flex items-center gap-3 min-w-0">
              <MessageSquare className={cn("w-4 h-4 shrink-0 transition-colors nav-icon", activeSubTab === "queries" ? "text-blue-400" : "text-slate-400 group-hover:text-blue-400")} />
              <span className="truncate">Resident Inquiries & Help</span>
            </div>
            {residentQueries.filter(q => q.status === "Responded").length > 0 && (
              <span className="bg-emerald-500 text-slate-950 rounded-full text-[9px] px-2 py-0.5 font-bold animate-pulse shadow-md shrink-0">
                {residentQueries.filter(q => q.status === "Responded").length}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveSubTab("notices")}
            className={cn(
              "sidebar-nav-item group",
              activeSubTab === "notices" && "active"
            )}
            data-active={activeSubTab === "notices"}
          >
            <div className="flex items-center gap-3 min-w-0">
              <Bell className={cn("w-4 h-4 shrink-0 transition-colors nav-icon", activeSubTab === "notices" ? "text-blue-400" : "text-slate-400 group-hover:text-amber-400")} />
              <span className="truncate">Notices & Promos</span>
            </div>
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

          {/* REAL-TIME SUPABASE NOTIFICATION TOAST BANNER */}
          <AnimatePresence>
            {liveToast && (
              <motion.div 
                initial={{ opacity: 0, y: -20, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -20, scale: 0.98 }}
                className="mb-8 p-5 bg-gradient-to-r from-red-950/90 via-slate-900 to-amber-950/90 border-2 border-red-500/50 rounded-2xl shadow-2xl backdrop-blur-md relative overflow-hidden"
              >
                <div className="absolute top-0 right-0 w-32 h-32 bg-red-500/10 rounded-full blur-2xl pointer-events-none" />
                <div className="flex items-start justify-between gap-4 relative z-10">
                  <div className="flex items-start gap-3.5">
                    <div className="p-3 bg-red-500/20 border border-red-500/40 rounded-xl text-red-400 shrink-0 mt-0.5">
                      <Bell className="w-6 h-6 animate-bounce" />
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 bg-red-500/20 text-red-400 text-[9px] font-black uppercase tracking-widest border border-red-500/30 rounded">
                          SUPABASE LIVE NOTIFICATION
                        </span>
                        <span className="text-[10px] text-slate-400 font-mono">
                          {new Date(liveToast.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                      <h3 className="text-base font-black text-white tracking-tight">
                        {liveToast.title}
                      </h3>
                      <p className="text-xs text-slate-300 leading-relaxed max-w-3xl">
                        {liveToast.message}
                      </p>
                      {liveToast.reason && (
                        <div className="mt-2.5 p-3 bg-slate-950/90 border border-amber-500/30 rounded-xl text-xs text-amber-200 font-mono">
                          <span className="text-amber-400 font-bold uppercase text-[10px] block mb-0.5">Official Archival Remarks:</span>
                          "{liveToast.reason}"
                        </div>
                      )}
                    </div>
                  </div>

                  <button
                    onClick={() => setLiveToast(null)}
                    className="p-2 text-slate-400 hover:text-white bg-slate-800/60 hover:bg-slate-800 border border-slate-700/60 rounded-xl transition-all shrink-0 cursor-pointer"
                    title="Dismiss Notification"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* DYNAMIC SUBTAB VIEWS */}

          {/* 1. CONTROL CENTER / DASHBOARD */}
          {activeSubTab === "dashboard" && (
            <div className="space-y-6 animate-in fade-in duration-300">

              {/* ARCHIVED PROPERTY NOTIFICATION BANNER */}
              {archivedNotices.length > 0 && (
                <div className="bg-amber-950/40 border border-amber-500/40 rounded-3xl p-6 space-y-3 mb-6 animate-in fade-in">
                  <div className="flex items-center gap-3 text-amber-400">
                    <AlertTriangle className="w-5 h-5 shrink-0" />
                    <div>
                      <h3 className="font-black text-sm uppercase tracking-wider">
                        Notice: Registered Real Property Record Archived / Reassessed
                      </h3>
                      <p className="text-xs text-amber-200/80">
                        The Municipal Assessor / Treasury has updated property registration status. Official remarks recorded below:
                      </p>
                    </div>
                  </div>
                  {archivedNotices.map((notice, idx) => (
                    <div key={idx} className="p-4 bg-slate-950/90 border border-amber-500/20 rounded-2xl space-y-1.5 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-white font-mono text-sm">Tax Dec No: {notice.tdNumber}</span>
                        <span className="text-[10px] bg-amber-500/20 text-amber-300 font-mono px-2.5 py-0.5 rounded-full border border-amber-500/30 font-bold uppercase">
                          ARCHIVED RECORD
                        </span>
                      </div>
                      <p className="text-amber-200 font-medium">
                        <strong className="text-amber-400 font-bold">Remarks / Reason:</strong> "{notice.reason || 'Property archived due to re-assessment or record adjustment.'}"
                      </p>
                      <p className="text-[10px] text-slate-400 font-mono">
                        Archived On: {notice.archivedAt ? new Date(notice.archivedAt).toLocaleString() : new Date().toLocaleDateString()} by {notice.archivedBy || 'Municipal Assessor'}
                      </p>
                    </div>
                  ))}
                </div>
              )}

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
                          <th className="pb-3 px-3">Property Location / TDN</th>
                          <th className="pb-3 px-3">Classification</th>
                          <th className="pb-3 px-3 text-center">Taxable Year</th>
                          <th className="pb-3 px-3 text-right">Basic Tax Due</th>
                          <th className="pb-3 px-3 text-right">SEF Due</th>
                          <th className="pb-3 px-3 text-right">Interest / Penalty</th>
                          <th className="pb-3 px-3 text-right pr-2">Total Due</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/40 text-xs">
                        {groupedPropertyDelinquencies.slice(0, 15).map(d => {
                          const prop = getDelinquencyProperty(d.propertyId);
                          return (
                            <tr key={d.id} className="h-12 hover:bg-slate-900/20 transition-colors">
                              <td className="py-2.5 px-3">
                                <p className="font-bold text-white">{prop?.tdNumber || "Unknown"}</p>
                                <p className="text-[10px] text-slate-500">{prop?.barangay || "---"}, Dipaculao</p>
                              </td>
                              <td className="py-2.5 px-3 text-slate-300 font-semibold">{prop?.classification || "LAND"}</td>
                              <td className="py-2.5 px-3 text-center font-mono text-slate-300 font-bold">{d.yearDisplay}</td>
                              <td className="py-2.5 px-3 text-right text-slate-300 font-semibold">{formatCurrency(d.basicTaxDue)}</td>
                              <td className="py-2.5 px-3 text-right text-slate-300 font-semibold">{formatCurrency(d.sefTaxDue)}</td>
                              <td className="py-2.5 px-3 text-right text-red-400/80 font-mono font-bold">+{formatCurrency(d.penalty)}</td>
                              <td className="py-2.5 px-3 text-right font-black text-rose-400 text-sm font-mono pr-2">{formatCurrency(d.totalDue)}</td>
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

                          <div className="flex justify-between items-center border-t border-slate-800/40 pt-4 mt-2 gap-2 flex-wrap">
                            <div>
                              <span className="text-[8px] font-bold text-slate-500 uppercase tracking-widest block">Outstanding Tax</span>
                              <span className={`text-md font-mono font-black ${totalDue > 0 ? "text-rose-400" : "text-emerald-400"}`}>
                                {totalDue > 0 ? formatCurrency(totalDue) : "Settled (₱0.00)"}
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
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
                                className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all cursor-pointer shrink-0 ${
                                  totalDue > 0
                                    ? "bg-rose-500 hover:bg-rose-400 text-white shadow-lg"
                                    : "bg-slate-800 hover:bg-slate-700 text-slate-400"
                                }`}
                              >
                                {totalDue > 0 ? "Settle Tax Due" : "View Payment History"}
                              </button>
                            </div>
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
              {/* OFFICIAL RPTAR ACTUAL LEDGER SELECTOR CARD */}
              <div className="bg-slate-900/40 border border-blue-500/30 p-6 rounded-3xl shadow-xl relative overflow-hidden">
                <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mb-4">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 bg-blue-500/10 border border-blue-500/20 rounded-2xl flex items-center justify-center shrink-0">
                      <FileSpreadsheet className="w-5 h-5 text-blue-400" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-sm font-black text-white uppercase tracking-wider">
                          Official Real Property Tax Account Register (Actual Ledger)
                        </h3>
                        <span className="bg-amber-500/10 border border-amber-500/20 text-amber-300 text-[9px] font-black uppercase tracking-widest px-2.5 py-0.5 rounded-full flex items-center gap-1">
                          <Eye className="w-3 h-3 text-amber-400" /> View Only
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mt-1">
                        Select any of your registered property records to inspect its full official municipal account ledger (RPTAR) in view-only mode.
                      </p>
                    </div>
                  </div>
                </div>

                {properties.length === 0 ? (
                  <div className="p-4 bg-slate-950/40 rounded-2xl border border-slate-800 text-slate-500 text-xs italic">
                    No registered properties linked under your account yet.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {properties.map(p => (
                      <div key={p.id} className="bg-slate-950/80 border border-slate-800 hover:border-blue-500/50 p-4 rounded-2xl flex flex-col justify-between transition-all group">
                        <div className="mb-3">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[10px] font-bold font-mono text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded-lg border border-blue-500/20">
                              TDN: {p.tdNumber}
                            </span>
                            <span className="text-[8px] font-black uppercase text-slate-500">
                              {p.classification}
                            </span>
                          </div>
                          <p className="text-xs font-black text-white uppercase truncate mt-2">{p.ownerName}</p>
                          <p className="text-[10px] text-slate-400 truncate">{p.barangay || "Dipaculao"}, Dipaculao, Aurora</p>
                        </div>

                        <button
                          type="button"
                          onClick={() => setViewingLedgerProp(p)}
                          className="w-full bg-blue-600/20 hover:bg-blue-600 text-blue-300 hover:text-white border border-blue-500/30 font-black text-[10px] uppercase tracking-wider py-2 rounded-xl flex items-center justify-center gap-2 transition-all cursor-pointer shadow-sm active:scale-[0.98]"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          View Actual Ledger
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

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
                          <th className="pb-3 px-3">Property Location / TDN</th>
                          <th className="pb-3 px-3 text-center">Taxable Year</th>
                          <th className="pb-3 px-3 text-right">Basic Tax Due</th>
                          <th className="pb-3 px-3 text-right">SEF Due</th>
                          <th className="pb-3 px-3 text-right">Penalty Surcharge</th>
                          <th className="pb-3 px-3 text-right pr-2">Net Amount Due</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/40 text-xs">
                        {groupedPropertyDelinquencies.map(d => {
                          const prop = getDelinquencyProperty(d.propertyId);
                          return (
                            <tr 
                              key={d.id} 
                              className="h-14 hover:bg-slate-900/10 transition-colors"
                            >
                              <td className="py-2.5 px-3">
                                <p className="font-bold text-white uppercase">{prop?.tdNumber || "Unknown"}</p>
                                <p className="text-[10px] text-slate-500">{prop?.barangay || "---"}, Dipaculao, Aurora</p>
                              </td>
                              <td className="py-2.5 px-3 text-center text-slate-300 font-mono font-bold">{d.yearDisplay}</td>
                              <td className="py-2.5 px-3 text-right text-slate-300 font-semibold">{formatCurrency(d.basicTaxDue)}</td>
                              <td className="py-2.5 px-3 text-right text-slate-300 font-semibold">{formatCurrency(d.sefTaxDue)}</td>
                              <td className="py-2.5 px-3 text-right text-red-400/80 font-mono font-bold">+{formatCurrency(d.penalty)}</td>
                              <td className="py-2.5 px-3 text-right font-black text-rose-350 text-[13px] font-mono pr-2">{formatCurrency(d.totalDue)}</td>
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
                                  <div className="table-actions flex items-center justify-end gap-2">
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

                      {selectedPropIdForForm && formType === "clearance" && (() => {
                        const selProp = properties.find(p => p.id === selectedPropIdForForm);
                        const selUnpaid = propertyDelinquencies.filter(
                          d => d.propertyId === selectedPropIdForForm || (selProp && (d as any).propertyTdn === selProp.tdNumber)
                        );
                        if (selUnpaid.length > 0) {
                          return (
                            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-2xl space-y-1 text-xs text-red-300">
                              <div className="flex items-center gap-2 font-bold text-red-400">
                                <AlertTriangle className="w-4 h-4 shrink-0" />
                                <span>Notice: Selected TDN has outstanding tax delinquencies</span>
                              </div>
                              <p className="text-[11px] text-red-200/90 leading-relaxed font-normal">
                                TDN {selProp?.tdNumber} currently has {selUnpaid.length} unpaid delinquency record(s) in the treasury ledger. A Tax Clearance Certificate cannot be officially approved until all tax liabilities are settled.
                              </p>
                            </div>
                          );
                        }
                        return null;
                      })()}
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
                            <p className="text-[9px] text-slate-500">
                              Filed: {r.createdAt ? (isNaN(new Date(r.createdAt).getTime()) ? "Recently" : new Date(r.createdAt).toLocaleDateString()) : "Recently"}
                            </p>
                            {r.adminNotes && (
                              <div className="p-2 bg-blue-950/40 border border-blue-800/40 rounded-xl text-[10px] text-blue-200 mt-1">
                                <span className="font-bold text-blue-400">Admin Remarks: </span>
                                {r.adminNotes}
                              </div>
                            )}
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

          {/* 4. RESIDENT INQUIRIES & HELPDESK SECTION */}
          {activeSubTab === "queries" && (
            <div className="space-y-6 max-w-6xl mx-auto animate-in fade-in duration-300">
              <div className="bg-slate-900/40 rounded-3xl border border-slate-800 p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 text-blue-400 text-xs font-bold uppercase tracking-widest mb-1">
                    <MessageSquare className="w-4 h-4" />
                    <span>Municipal Helpdesk & Inquiry Channel</span>
                  </div>
                  <h2 className="text-xl font-black text-white">Resident Query & Support Desk</h2>
                  <p className="text-xs text-slate-400 mt-1">
                    Directly message municipal administrators for real property tax assessments, payment verifications, and property claims.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
                {/* SUBMIT NEW QUERY FORM (5 Cols) */}
                <div className="lg:col-span-5 bg-slate-900/60 rounded-3xl border border-slate-800 p-6 space-y-6">
                  <div>
                    <h3 className="text-sm font-black text-white uppercase tracking-wider flex items-center gap-2 mb-1">
                      <Send className="w-4 h-4 text-blue-400" />
                      Submit New Resident Inquiry
                    </h3>
                    <p className="text-[11px] text-slate-400">
                      Submit your question or issue to official Dipaculao Treasury & Assessment officers.
                    </p>
                  </div>

                  <form onSubmit={handleCreateQuery} className="space-y-4">
                    {/* CATEGORY SELECT */}
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 block">
                        Inquiry Category
                      </label>
                      <select
                        value={newQueryCategory}
                        onChange={(e) => setNewQueryCategory(e.target.value as QueryCategory)}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl h-11 px-3 text-xs text-slate-200 focus:border-blue-500 outline-none cursor-pointer"
                      >
                        <option value="Tax Assessment">Tax Assessment & Assessment Value</option>
                        <option value="Payment Verification">Payment Verification & Receipt Issue</option>
                        <option value="Property Claim">Property Claim & Account Linking</option>
                        <option value="Penalty Appeal">Penalty Appeal & Discount Eligibility</option>
                        <option value="Ownership Transfer">Ownership Transfer & Revision</option>
                        <option value="General Inquiry">General Municipal Inquiry</option>
                      </select>
                    </div>

                    {/* PROPERTY REFERENCE SELECT */}
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 block">
                        Linked Property TDN (Optional)
                      </label>
                      <select
                        value={newQueryPropTdn}
                        onChange={(e) => setNewQueryPropTdn(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl h-11 px-3 text-xs text-slate-200 focus:border-blue-500 outline-none cursor-pointer"
                      >
                        <option value="">No Specific Property Selected</option>
                        {properties.map((p) => (
                          <option key={p.id} value={p.tdNumber}>
                            TDN: {p.tdNumber} ({p.barangay})
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* SUBJECT INPUT */}
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 block">
                        Subject / Topic Title
                      </label>
                      <input
                        type="text"
                        required
                        placeholder="e.g., Clarification on 2026 Prompt Payment Discount"
                        value={newQuerySubject}
                        onChange={(e) => setNewQuerySubject(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl h-11 px-3 text-xs text-white focus:border-blue-500 outline-none"
                      />
                    </div>

                    {/* MESSAGE TEXTAREA */}
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 block">
                        Inquiry Message Details
                      </label>
                      <textarea
                        rows={4}
                        required
                        placeholder="Provide full details of your query so administrators can assist you efficiently..."
                        value={newQueryMessage}
                        onChange={(e) => setNewQueryMessage(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 rounded-2xl p-3 text-xs text-white focus:border-blue-500 outline-none leading-relaxed"
                      />
                    </div>

                    {queryErrorMsg && (
                      <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-xs text-red-400 font-semibold flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 shrink-0" />
                        <span>{queryErrorMsg}</span>
                      </div>
                    )}

                    {querySuccessMsg && (
                      <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-xs text-emerald-400 font-semibold flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 shrink-0" />
                        <span>{querySuccessMsg}</span>
                      </div>
                    )}

                    <button
                      type="submit"
                      disabled={isSubmittingQuery}
                      className="w-full bg-blue-600 hover:bg-blue-500 font-bold uppercase tracking-widest text-xs text-white h-11 rounded-xl flex items-center justify-center gap-2 transition-transform active:scale-[0.98] disabled:opacity-50 cursor-pointer shadow-lg shadow-blue-500/20"
                    >
                      <Send className="w-4 h-4" />
                      {isSubmittingQuery ? "Sending Inquiry..." : "Submit Inquiry to Administrators"}
                    </button>
                  </form>
                </div>

                {/* MY SUBMITTED INQUIRIES LIST (7 Cols) */}
                <div className="lg:col-span-7 bg-slate-900/60 rounded-3xl border border-slate-800 p-6 space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-800/80 pb-4">
                    <div>
                      <h3 className="text-sm font-black text-white uppercase tracking-wider flex items-center gap-2">
                        <MessageCircle className="w-4 h-4 text-emerald-400" />
                        My Submitted Inquiries & Responses
                      </h3>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        Real-time conversation history with Dipaculao municipal administrators.
                      </p>
                    </div>

                    <span className="text-[10px] font-bold bg-slate-950 border border-slate-800 px-3 py-1 rounded-full text-slate-400">
                      {residentQueries.length} Tickets
                    </span>
                  </div>

                  {residentQueries.length === 0 ? (
                    <div className="p-8 text-center text-slate-600 italic text-xs">
                      No inquiries submitted yet. Use the form on the left to message municipal officers.
                    </div>
                  ) : (
                    <div className="space-y-3 max-h-[520px] overflow-y-auto pr-1">
                      {residentQueries.map((q) => {
                        const isResponded = q.status === "Responded";
                        const isResolved = q.status === "Resolved";
                        const hasReplies = (q.replies && q.replies.length > 0) || q.adminResponse;

                        return (
                          <div
                            key={q.id}
                            className={`p-4 rounded-2xl border transition-colors space-y-3 ${
                              isResponded
                                ? "bg-slate-950 border-emerald-500/30 hover:border-emerald-500/50"
                                : isResolved
                                ? "bg-slate-950/60 border-slate-800"
                                : "bg-slate-950/80 border-slate-800/80 hover:border-slate-700"
                            }`}
                          >
                            {/* TOP BADGES */}
                            <div className="flex items-center justify-between text-[10px]">
                              <span className="bg-blue-600/15 border border-blue-500/25 text-blue-400 rounded-full px-2.5 py-0.5 font-bold uppercase tracking-wide">
                                {q.category}
                              </span>
                              <span
                                className={`px-2.5 py-0.5 font-black uppercase text-[8px] rounded-full tracking-wider border ${
                                  q.status === "Responded"
                                    ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400 animate-pulse"
                                    : q.status === "Resolved"
                                    ? "bg-slate-800 border-slate-700 text-slate-400"
                                    : q.status === "In Review"
                                    ? "bg-blue-500/10 border-blue-500/20 text-blue-400"
                                    : "bg-amber-500/10 border-amber-500/20 text-amber-400"
                                }`}
                              >
                                {q.status}
                              </span>
                            </div>

                            <div>
                              <h4 className="text-xs font-black text-white">{q.subject}</h4>
                              {q.propertyTdn && (
                                <p className="text-[10px] text-blue-400 font-semibold mt-0.5">
                                  Linked TDN: {q.propertyTdn}
                                </p>
                              )}
                              <p className="text-[11px] text-slate-300 mt-1 leading-relaxed">
                                {q.message}
                              </p>
                              <p className="text-[9px] text-slate-500 mt-1 font-mono">
                                Filed: {new Date(q.createdAt).toLocaleString()}
                              </p>
                            </div>

                            {/* OFFICIAL ADMIN RESPONSE CALLOUT BOX */}
                            {q.adminResponse && (
                              <div className="p-3 bg-blue-950/40 border border-blue-800/50 rounded-xl space-y-1 mt-2">
                                <div className="flex items-center justify-between text-[10px]">
                                  <span className="font-bold text-blue-300 flex items-center gap-1">
                                    <ShieldCheck className="w-3.5 h-3.5 text-blue-400" />
                                    Official Municipal Response ({q.respondedBy || "Administrator"})
                                  </span>
                                  {q.respondedAt && (
                                    <span className="text-[9px] text-slate-400">
                                      {new Date(q.respondedAt).toLocaleDateString()}
                                    </span>
                                  )}
                                </div>
                                <p className="text-xs text-blue-100 leading-relaxed font-medium">
                                  {q.adminResponse}
                                </p>
                              </div>
                            )}

                            {/* THREAD ACTION BUTTON */}
                            <div className="flex items-center justify-between border-t border-slate-800/60 pt-2.5 mt-2">
                              <span className="text-[10px] text-slate-500 font-semibold">
                                {hasReplies ? `${(q.replies?.length || 0) + (q.adminResponse ? 1 : 0)} replies in thread` : "Awaiting review"}
                              </span>
                              <button
                                onClick={() => setActiveQueryThread(q)}
                                className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-blue-400 text-[10px] font-bold rounded-lg flex items-center gap-1 transition-colors cursor-pointer"
                              >
                                <span>View Conversation Thread</span>
                                <ChevronRight className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
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
                  {/* SUPABASE RECORDED NOTIFICATIONS */}
                  {supabaseNotifs.length > 0 && (
                    <div className="space-y-3 mb-6">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-black uppercase text-red-400 tracking-widest font-mono flex items-center gap-1.5">
                          <Bell className="w-3.5 h-3.5 text-red-400" />
                          Supabase Database Notifications ({supabaseNotifs.length})
                        </span>
                        <span className="text-[9px] text-slate-500 font-mono">Linked to Taxpayer Account</span>
                      </div>
                      {supabaseNotifs.map((sn) => (
                        <div key={sn.id} className="p-5 bg-gradient-to-r from-red-950/30 to-slate-950 border border-red-500/30 rounded-2xl space-y-2 hover:border-red-500/50 transition-colors">
                          <div className="flex items-center justify-between">
                            <span className="px-2 py-0.5 bg-red-500/20 text-red-400 text-[9px] font-bold uppercase rounded border border-red-500/30">
                              {sn.type || "Archival Notice"}
                            </span>
                            <span className="text-[10px] text-slate-500 font-mono">
                              {sn.created_at ? new Date(sn.created_at).toLocaleString() : "Recent"}
                            </span>
                          </div>
                          <h4 className="text-xs font-black text-white">{sn.title}</h4>
                          <p className="text-xs text-slate-300 leading-relaxed font-sans">{sn.message}</p>
                          {sn.reason && (
                            <div className="p-2.5 bg-slate-900/80 border border-amber-500/20 rounded-xl text-[11px] text-amber-200/90 font-mono">
                              <span className="text-amber-400 font-bold block mb-0.5">Assessor Remarks:</span>
                              "{sn.reason}"
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

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
                  <div className="flex flex-col sm:flex-row gap-2">
                    <button
                      type="button"
                      onClick={handleDownloadReceiptPDF}
                      disabled={isSavingReceiptPdf}
                      className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-black uppercase tracking-widest flex items-center justify-center gap-2 cursor-pointer shadow-md disabled:opacity-50"
                    >
                      <Download className="w-4 h-4" />
                      {isSavingReceiptPdf ? "Generating..." : "Download PDF"}
                    </button>
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
                      className="py-3 px-5 bg-white hover:bg-slate-100 text-slate-950 rounded-xl text-xs font-black uppercase tracking-widest text-center cursor-pointer"
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

      {/* RESIDENT CONVERSATION THREAD MODAL */}
      {activeQueryThread && (
        <div className="fixed inset-0 z-[160] bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-2xl w-full p-6 space-y-5 shadow-2xl relative my-8 max-h-[88vh] overflow-y-auto">
            {/* HEADER */}
            <div className="flex items-start justify-between border-b border-slate-800 pb-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] font-black uppercase tracking-widest text-blue-400 bg-blue-500/10 border border-blue-500/20 px-2.5 py-0.5 rounded-full">
                    {activeQueryThread.category}
                  </span>
                  <span className="text-[10px] font-bold text-slate-500">
                    Status: {activeQueryThread.status}
                  </span>
                </div>
                <h3 className="text-base font-black text-white">{activeQueryThread.subject}</h3>
                {activeQueryThread.propertyTdn && (
                  <p className="text-xs text-blue-400 font-bold mt-0.5">
                    Property TDN: {activeQueryThread.propertyTdn}
                  </p>
                )}
              </div>
              <button
                onClick={() => setActiveQueryThread(null)}
                className="p-2 text-slate-400 hover:text-white bg-slate-800/60 hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* INITIAL RESIDENT INQUIRY MESSAGE */}
            <div className="p-4 bg-slate-950/90 border border-slate-800 rounded-2xl space-y-1 text-xs">
              <div className="flex justify-between text-[10px] text-slate-500 mb-1">
                <span className="font-bold text-slate-400">My Original Inquiry</span>
                <span>{new Date(activeQueryThread.createdAt).toLocaleString()}</span>
              </div>
              <p className="text-slate-200 leading-relaxed font-medium whitespace-pre-wrap">
                {activeQueryThread.message}
              </p>
            </div>

            {/* OFFICIAL ADMIN RESPONSE IF AVAILABLE */}
            {activeQueryThread.adminResponse && (
              <div className="p-4 bg-blue-950/50 border border-blue-800/60 rounded-2xl space-y-2 text-xs">
                <div className="flex items-center justify-between text-[10px] border-b border-blue-800/40 pb-2">
                  <span className="font-black text-blue-300 flex items-center gap-1.5 uppercase tracking-wider">
                    <ShieldCheck className="w-4 h-4 text-blue-400" />
                    Official Response from {activeQueryThread.respondedBy || "Municipal Administrator"}
                  </span>
                  {activeQueryThread.respondedAt && (
                    <span className="text-slate-400">
                      {new Date(activeQueryThread.respondedAt).toLocaleString()}
                    </span>
                  )}
                </div>
                <p className="text-blue-100 leading-relaxed font-medium whitespace-pre-wrap">
                  {activeQueryThread.adminResponse}
                </p>
              </div>
            )}

            {/* REPLIES HISTORY */}
            {activeQueryThread.replies && activeQueryThread.replies.length > 0 && (
              <div className="space-y-3 pt-1">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 block">
                  Follow-Up Messages ({activeQueryThread.replies.length})
                </span>
                <div className="space-y-3 max-h-56 overflow-y-auto pr-1">
                  {activeQueryThread.replies.map((reply) => {
                    const isAdmin = reply.senderRole === "Admin" || reply.senderRole === "Encoder";
                    return (
                      <div
                        key={reply.id}
                        className={`p-3.5 rounded-2xl border text-xs space-y-1 ${
                          isAdmin
                            ? "bg-blue-950/40 border-blue-800/50 text-blue-100 ml-4"
                            : "bg-slate-950 border-slate-800 text-slate-200 mr-4"
                        }`}
                      >
                        <div className="flex items-center justify-between text-[10px] text-slate-400">
                          <span className={`font-bold ${isAdmin ? "text-blue-400" : "text-slate-300"}`}>
                            {reply.senderName} ({reply.senderRole})
                          </span>
                          <span>{new Date(reply.createdAt).toLocaleString()}</span>
                        </div>
                        <p className="leading-relaxed whitespace-pre-wrap mt-1">{reply.message}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* FOLLOW-UP REPLY FORM */}
            <form onSubmit={handleSendResidentReply} className="space-y-3 pt-2 border-t border-slate-800">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-300 block">
                Send Follow-up Message to Administrator
              </label>
              <textarea
                rows={3}
                required
                placeholder="Write a follow-up question or clarification..."
                value={replyMessage}
                onChange={(e) => setReplyMessage(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-2xl p-3 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors leading-relaxed"
              />
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setActiveQueryThread(null)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold rounded-xl transition-colors cursor-pointer"
                >
                  Close
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingReply}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold uppercase tracking-wider rounded-xl flex items-center gap-2 transition-transform active:scale-95 disabled:opacity-50 cursor-pointer shadow-lg shadow-blue-500/20"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>{isSubmittingReply ? "Sending..." : "Send Reply"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* VIEW-ONLY RPTAR LEDGER MODAL */}
      {viewingLedgerProp && (
        <RPTARPrintView
          property={viewingLedgerProp}
          history={propertyDelinquencies.filter(d => d.propertyId === viewingLedgerProp.id || (d as any).propertyTdn === viewingLedgerProp.tdNumber)}
          payments={payments.filter(p => p.propertyId === viewingLedgerProp.id)}
          onClose={() => setViewingLedgerProp(null)}
          viewOnly={true}
        />
      )}
    </div>
  );
}
