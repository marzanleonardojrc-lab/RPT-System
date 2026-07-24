import React, { useState, useEffect, useRef } from "react";
import { 
  collection, 
  onSnapshot, 
  doc, 
  updateDoc, 
  db, 
  handleFirestoreError, 
  OperationType,
  query,
  orderBy
} from "../lib/firebase";
import { TaxpayerRequest, RequestFormStatus, RequestFormType, Delinquency, Property, Payment } from "../types";
import { useAuth } from "../AuthContext";
import { logAudit } from "../lib/audit";
import { resolveModernColors } from "../lib/utils";
import { calculateTotalDue } from "../lib/taxCalculations";
import { 
  FileCheck, 
  Search, 
  Filter, 
  Clock, 
  CheckCircle2, 
  AlertCircle, 
  Send, 
  User, 
  Building2, 
  Sparkles, 
  RefreshCw, 
  X, 
  ChevronRight, 
  FileText,
  ShieldCheck,
  Tag,
  Printer,
  Download,
  FileSpreadsheet,
  AlertTriangle,
  ExternalLink,
  Award,
  Check,
  XCircle
} from "lucide-react";

export default function DocumentRequestsModule() {
  const { profile } = useAuth();
  const [requests, setRequests] = useState<TaxpayerRequest[]>([]);
  const [delinquencies, setDelinquencies] = useState<Delinquency[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [typeFilter, setTypeFilter] = useState<string>("ALL");
  const [selectedRequest, setSelectedRequest] = useState<TaxpayerRequest | null>(null);

  // Form processing state
  const [adminNotes, setAdminNotes] = useState("");
  const [newStatus, setNewStatus] = useState<RequestFormStatus>("Approved");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [showCertificateModal, setShowCertificateModal] = useState(false);
  const [isSavingPdf, setIsSavingPdf] = useState(false);
  const printAreaRef = useRef<HTMLDivElement>(null);

  // Fetch requests, delinquencies, properties, and payments from Firestore
  useEffect(() => {
    setLoading(true);

    const qReq = query(collection(db, "taxpayer_requests"), orderBy("createdAt", "desc"));
    const unsubReq = onSnapshot(
      qReq,
      (snapshot) => {
        const fetched: TaxpayerRequest[] = snapshot.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        })) as TaxpayerRequest[];
        setRequests(fetched);
        setLoading(false);
      },
      (error) => {
        console.error("Error fetching taxpayer requests:", error);
        handleFirestoreError(error, OperationType.GET, "taxpayer_requests");
        setLoading(false);
      }
    );

    const unsubDelinq = onSnapshot(
      collection(db, "delinquencies"),
      (snapshot) => {
        const fetched = snapshot.docs.map((d) => ({ id: d.id, ...d.data() })) as Delinquency[];
        setDelinquencies(fetched);
      },
      (error) => {
        console.error("Error fetching delinquencies:", error);
      }
    );

    const unsubProps = onSnapshot(
      collection(db, "properties"),
      (snapshot) => {
        const fetched = snapshot.docs.map((d) => ({ id: d.id, ...d.data() })) as Property[];
        setProperties(fetched);
      },
      (error) => {
        console.error("Error fetching properties:", error);
      }
    );

    const unsubPay = onSnapshot(
      collection(db, "payments"),
      (snapshot) => {
        const fetched = snapshot.docs.map((d) => ({ id: d.id, ...d.data() })) as Payment[];
        setPayments(fetched);
      },
      (error) => {
        console.error("Error fetching payments:", error);
      }
    );

    return () => {
      unsubReq();
      unsubDelinq();
      unsubProps();
      unsubPay();
    };
  }, []);

  // Filter requests
  const filteredRequests = requests.filter((r) => {
    const matchesSearch =
      r.userName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      r.userEmail?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      r.propertyTdn?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      r.propertyOwner?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      r.purpose?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      r.reason?.toLowerCase().includes(searchTerm.toLowerCase());

    const reqStatus = (r.status || "Submitted").trim().toLowerCase();
    const filter = statusFilter.trim().toLowerCase();

    let matchesStatus = false;
    if (statusFilter === "ALL") {
      matchesStatus = true;
    } else if (filter === "rejected") {
      matchesStatus = reqStatus === "rejected" || reqStatus === "denied" || reqStatus === "declined";
    } else if (filter === "submitted") {
      matchesStatus = reqStatus === "submitted" || reqStatus === "pending";
    } else if (filter === "under review") {
      matchesStatus = reqStatus === "under review" || reqStatus === "in review" || reqStatus === "processing";
    } else if (filter === "approved") {
      matchesStatus = reqStatus === "approved" || reqStatus === "cleared";
    } else if (filter === "ready for pick-up") {
      matchesStatus = reqStatus === "ready for pick-up" || reqStatus === "ready" || reqStatus === "issued";
    } else {
      matchesStatus = reqStatus === filter;
    }

    const matchesType = typeFilter === "ALL" || r.type === typeFilter;

    return matchesSearch && matchesStatus && matchesType;
  });

  // Calculate statistics
  const totalCount = requests.length;
  const pendingCount = requests.filter((r) => {
    const st = (r.status || "Submitted").toLowerCase();
    return st === "submitted" || st === "pending";
  }).length;
  const reviewCount = requests.filter((r) => {
    const st = (r.status || "").toLowerCase();
    return st === "under review" || st === "in review";
  }).length;
  const approvedCount = requests.filter((r) => {
    const st = (r.status || "").toLowerCase();
    return st === "approved" || st === "ready" || st === "ready for pick-up" || st === "issued";
  }).length;
  const rejectedCount = requests.filter((r) => {
    const st = (r.status || "").toLowerCase();
    return st === "rejected" || st === "denied" || st === "declined";
  }).length;

  const handleOpenRequestModal = (r: TaxpayerRequest) => {
    setSelectedRequest(r);
    setAdminNotes(r.adminNotes || "");
    setNewStatus(r.status || "Submitted");
    setSuccessMsg(null);
  };

  const handleApplyTemplate = (tpl: string) => {
    setAdminNotes((prev) => (prev ? `${prev}\n\n${tpl}` : tpl));
  };

  const handleQuickReject = async (defaultReason?: string) => {
    if (!selectedRequest) return;
    setIsSubmitting(true);
    try {
      const now = new Date().toISOString();
      const adminName = profile?.displayName || profile?.email || "Municipal Officer";
      const finalNotes = defaultReason || adminNotes.trim() || "Application rejected by Municipal Officer after treasury ledger verification.";

      const updateData = {
        status: "Rejected" as RequestFormStatus,
        adminNotes: finalNotes,
        processedBy: adminName,
        processedAt: now,
        updatedAt: now,
      };

      await updateDoc(doc(db, "taxpayer_requests", selectedRequest.id), updateData);

      await logAudit("UPDATE", "taxpayer_requests", selectedRequest.id, {
        status: selectedRequest.status,
      }, {
        status: "Rejected",
        processedBy: adminName,
      });

      setNewStatus("Rejected");
      setAdminNotes(finalNotes);
      setSuccessMsg(`Request status officially updated to "Rejected"!`);
      setSelectedRequest({
        ...selectedRequest,
        ...updateData,
      });
    } catch (err) {
      console.error("Failed to reject taxpayer request:", err);
      alert("Failed to update request status. Please check permissions and network connection.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdateStatus = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRequest) return;

    setIsSubmitting(true);
    try {
      const now = new Date().toISOString();
      const adminName = profile?.displayName || profile?.email || "Municipal Officer";

      const updateData = {
        status: newStatus,
        adminNotes: adminNotes.trim(),
        processedBy: adminName,
        processedAt: now,
        updatedAt: now,
      };

      await updateDoc(doc(db, "taxpayer_requests", selectedRequest.id), updateData);

      await logAudit("UPDATE", "taxpayer_requests", selectedRequest.id, {
        status: selectedRequest.status,
      }, {
        status: newStatus,
        processedBy: adminName,
      });

      setSuccessMsg(`Request status updated to "${newStatus}" successfully!`);
      setSelectedRequest({
        ...selectedRequest,
        ...updateData,
      });
    } catch (err) {
      console.error("Failed to update taxpayer request:", err);
      alert("Failed to update request. Please check permissions and network connection.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePrintCertificate = () => {
    const element = printAreaRef.current;
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
            <title>Tax Clearance - ${selectedRequest?.propertyTdn}</title>
            <script src="https://cdn.tailwindcss.com"></script>
            <style>
              body { background: white; color: black; padding: 40px; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }
              @media print {
                body { padding: 0; }
                .no-print { display: none !important; }
              }
            </style>
          </head>
          <body>
            ${element.innerHTML}
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

  const handleDownloadPDF = () => {
    const element = printAreaRef.current;
    if (!element || !selectedRequest) return;

    const filename = `Tax_Clearance_${selectedRequest.propertyTdn}.pdf`;
    setIsSavingPdf(true);

    const opt = {
      margin: 0.3,
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
        setIsSavingPdf(false);
        window.getComputedStyle = originalGetComputedStyle;
      }).catch((err: any) => {
        console.error("PDF generation failed:", err);
        setIsSavingPdf(false);
        window.getComputedStyle = originalGetComputedStyle;
        handlePrintCertificate();
      });
    }).catch((err) => {
      console.error("Failed to load html2pdf.js dynamically:", err);
      setIsSavingPdf(false);
      window.getComputedStyle = originalGetComputedStyle;
      handlePrintCertificate();
    });
  };

  // Check if selected property has unpaid delinquencies or unbilled liabilities in Treasury ledger
  const checkPropertyTaxStatus = (propertyTdn: string, propertyId?: string) => {
    // 1. Find property in properties collection
    const matchedProp = properties.find(
      (p) =>
        (propertyId && p.id === propertyId) ||
        (propertyTdn && p.tdNumber?.trim().toLowerCase() === propertyTdn.trim().toLowerCase()) ||
        (propertyTdn && p.id === propertyTdn)
    );

    const targetPropId = matchedProp ? matchedProp.id : propertyId;
    const targetTdNo = matchedProp ? matchedProp.tdNumber : propertyTdn;

    // 2. Real delinquency records in Firestore
    const realUnpaid = delinquencies
      .filter((d) => {
        const matchesId =
          (targetPropId && d.propertyId === targetPropId) ||
          (propertyId && d.propertyId === propertyId) ||
          (propertyTdn && d.propertyId === propertyTdn);

        const matchesTdn =
          (targetTdNo && (d as any).propertyTdn?.trim().toLowerCase() === targetTdNo.trim().toLowerCase()) ||
          (propertyTdn && (d as any).propertyTdn?.trim().toLowerCase() === propertyTdn.trim().toLowerCase());

        const isUnpaid = d.status !== "Paid" && d.status !== "Voided";
        return (matchesId || matchesTdn) && isUnpaid;
      })
      .map((d) => {
        const currentCalc = calculateTotalDue(
          d.basicTaxDue || 0,
          d.sefTaxDue || 0,
          d.year,
          new Date(),
          (d as any).idleSurcharge || 0
        );
        return {
          ...d,
          penalty: currentCalc.interest,
          interest: currentCalc.interest,
          totalDue: currentCalc.totalDue,
        };
      });

    if (realUnpaid.length > 0) {
      return realUnpaid;
    }

    // 3. Virtual unbilled delinquency check for matched property
    if (matchedProp && !matchedProp.isArchived) {
      const currentYear = new Date().getFullYear();
      let effYear = currentYear;
      if (matchedProp.effectivityDate) {
        let extractedYear = NaN;
        if (matchedProp.effectivityDate.includes("-")) {
          extractedYear = new Date(matchedProp.effectivityDate).getFullYear();
        } else {
          extractedYear = parseInt(matchedProp.effectivityDate, 10);
        }
        if (!isNaN(extractedYear)) effYear = extractedYear;
      }
      if (effYear > currentYear) effYear = currentYear;

      const virtualUnpaid: Delinquency[] = [];
      for (let y = effYear; y <= currentYear; y++) {
        const existsInDelinq = delinquencies.some(
          (d) => d.propertyId === matchedProp.id && d.year === y
        );
        const existsInPayments = payments.some(
          (pay) => pay.propertyId === matchedProp.id && pay.taxYear === y && pay.status === "Active"
        );

        if (!existsInDelinq && !existsInPayments) {
          const yearBasic = (matchedProp.assessedValue || 0) * 0.01;
          const yearSef = (matchedProp.assessedValue || 0) * 0.01;
          const currentCalc = calculateTotalDue(yearBasic, yearSef, y, new Date(), 0);
          virtualUnpaid.push({
            id: `virtual-${matchedProp.id}-${y}`,
            propertyId: matchedProp.id,
            year: y,
            assessedValue: matchedProp.assessedValue,
            basicTaxDue: yearBasic,
            sefTaxDue: yearSef,
            penalty: currentCalc.interest,
            interest: currentCalc.interest,
            totalDue: currentCalc.totalDue,
            status: y === currentYear ? "Pending" : "Delinquent",
            totalPaid: 0,
            updatedAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
          });
        }
      }

      if (virtualUnpaid.length > 0) {
        return virtualUnpaid;
      }
    }

    return [];
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* HEADER BAR */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-900/60 p-6 rounded-3xl border border-slate-800 backdrop-blur-sm">
        <div>
          <div className="flex items-center gap-2 text-blue-400 text-xs font-bold uppercase tracking-widest mb-1">
            <FileCheck className="w-4 h-4" />
            <span>Treasury & Assessment Services</span>
          </div>
          <h1 className="text-2xl font-black text-white tracking-tight">Tax Clearance & Document Requests</h1>
          <p className="text-xs text-slate-400 mt-1">
            Review, process, and issue Tax Clearances (Form RPT-F01), Assessment Revisions, and Notices of Transfer.
          </p>
        </div>

        {pendingCount > 0 && (
          <div className="flex items-center gap-3 px-4 py-2.5 bg-amber-500/10 border border-amber-500/20 rounded-2xl">
            <AlertCircle className="w-5 h-5 text-amber-400 shrink-0 animate-pulse" />
            <div>
              <p className="text-xs font-black text-amber-300 uppercase tracking-wider">{pendingCount} New Applications</p>
              <p className="text-[10px] text-amber-400/80">Requires official verification & sign-off</p>
            </div>
          </div>
        )}
      </div>

      {/* METRIC CARDS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="p-5 bg-slate-900/80 border border-slate-800 rounded-3xl">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Total Applications</span>
            <div className="w-8 h-8 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
              <FileText className="w-4 h-4" />
            </div>
          </div>
          <p className="text-2xl font-black text-white mt-3">{totalCount}</p>
          <p className="text-[10px] text-slate-500 mt-1">Filed by resident taxpayers</p>
        </div>

        <div className="p-5 bg-slate-900/80 border border-slate-800 rounded-3xl">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-widest text-amber-400">Pending Review</span>
            <div className="w-8 h-8 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <p className="text-2xl font-black text-amber-400 mt-3">{pendingCount}</p>
          <p className="text-[10px] text-slate-500 mt-1">Awaiting Treasury approval</p>
        </div>

        <div className="p-5 bg-slate-900/80 border border-slate-800 rounded-3xl">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-widest text-blue-400">Under Review</span>
            <div className="w-8 h-8 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
              <Sparkles className="w-4 h-4" />
            </div>
          </div>
          <p className="text-2xl font-black text-blue-400 mt-3">{reviewCount}</p>
          <p className="text-[10px] text-slate-500 mt-1">In verification / inspection</p>
        </div>

        <div className="p-5 bg-slate-900/80 border border-slate-800 rounded-3xl">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-400">Approved / Issued</span>
            <div className="w-8 h-8 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
              <CheckCircle2 className="w-4 h-4" />
            </div>
          </div>
          <p className="text-2xl font-black text-emerald-400 mt-3">{approvedCount}</p>
          <p className="text-[10px] text-slate-500 mt-1">Cleared documents issued</p>
        </div>

        <div className="p-5 bg-slate-900/80 border border-slate-800 rounded-3xl">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-widest text-red-400">Rejected</span>
            <div className="w-8 h-8 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-400">
              <AlertTriangle className="w-4 h-4" />
            </div>
          </div>
          <p className="text-2xl font-black text-red-400 mt-3">{rejectedCount}</p>
          <p className="text-[10px] text-slate-500 mt-1">Denied due to delinquencies</p>
        </div>
      </div>

      {/* SYMMETRICAL FILTER BAR */}
      <div 
        className="p-3 sm:p-4 rounded-3xl border flex flex-row flex-nowrap items-center justify-between gap-2 sm:gap-4 w-full shadow-md min-w-0 overflow-hidden"
        style={{
          backgroundColor: 'var(--clr-surface-a0)',
          borderColor: 'var(--clr-surface-a30)'
        }}
      >
        {/* LEFT COLUMN: Search input aligned left */}
        <div className="shrink-0 flex items-center justify-start">
          <div className="relative w-[275px] max-w-full min-w-0">
            <Search className="w-3.5 h-3.5 sm:w-4 sm:h-4 absolute left-2.5 sm:left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search TDN, name, owner..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-2xl h-9 sm:h-10 pl-8 sm:pl-10 pr-3 sm:pr-4 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-blue-500 transition-colors min-w-0 whitespace-nowrap text-ellipsis"
            />
          </div>
        </div>

        {/* CENTER COLUMN: Status filter group centered horizontally with priority space */}
        <div className="flex-1 min-w-0 flex items-center justify-center text-center px-1">
          <div className="flex items-center justify-center gap-0.5 sm:gap-1 bg-slate-950 border border-slate-800 rounded-2xl p-1 text-xs max-w-full overflow-x-auto no-scrollbar whitespace-nowrap shrink-0 mx-auto">
            <span className="text-[9px] sm:text-[10px] font-black text-slate-300 uppercase px-1 sm:px-1.5 shrink-0 tracking-wider whitespace-nowrap">STATUS:</span>
            {["ALL", "Submitted", "Under Review", "Approved", "Ready for Pick-up", "Rejected"].map((st) => {
              const isActive = statusFilter === st;
              return (
                <button
                  key={st}
                  type="button"
                  onClick={() => setStatusFilter(st)}
                  className={`px-1.5 sm:px-2.5 py-1 rounded-xl text-[11px] sm:text-xs font-bold transition-all cursor-pointer whitespace-nowrap shrink-0 ${
                    isActive
                      ? "text-white shadow-md font-extrabold"
                      : "text-slate-200 hover:text-white hover:bg-slate-800/80"
                  }`}
                  style={{
                    backgroundColor: isActive ? 'var(--clr-primary-a0)' : 'transparent'
                  }}
                >
                  {st}
                </button>
              );
            })}
          </div>
        </div>

        {/* RIGHT COLUMN: Select dropdown aligned to the right */}
        <div className="shrink-0 flex items-center justify-end">
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded-2xl h-9 sm:h-10 px-2.5 sm:px-3.5 text-xs font-semibold text-slate-200 focus:outline-none focus:border-blue-500 hover:border-slate-700 cursor-pointer shadow-sm transition-colors w-36 sm:w-44 min-w-0 whitespace-nowrap text-ellipsis"
          >
            <option value="ALL">All Request Types</option>
            <option value="clearance">Tax Clearance (Form RPT-F01)</option>
            <option value="revision">Assessment Revision</option>
            <option value="transfer">Notice of Transfer</option>
          </select>
        </div>
      </div>

      {/* REQUESTS LIST */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-3xl overflow-hidden shadow-xl">
        {loading ? (
          <div className="p-12 text-center text-slate-500">
            <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-blue-400" />
            <p className="text-xs font-semibold">Loading document requests...</p>
          </div>
        ) : filteredRequests.length === 0 ? (
          <div className="p-12 text-center space-y-2">
            <FileText className="w-10 h-10 text-slate-700 mx-auto" />
            <p className="text-sm font-bold text-slate-400">No requests found</p>
            <p className="text-xs text-slate-600">Resident applications for tax clearances and revisions will appear here.</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-800/60">
            {filteredRequests.map((r) => {
              const statusColors: Record<string, string> = {
                Submitted: "bg-amber-500/10 border-amber-500/30 text-amber-400 animate-pulse",
                "Under Review": "bg-blue-500/10 border-blue-500/30 text-blue-400",
                Approved: "bg-emerald-500/10 border-emerald-500/30 text-emerald-400",
                Ready: "bg-emerald-500/10 border-emerald-500/30 text-emerald-400",
                "Ready for Pick-up": "bg-emerald-500/10 border-emerald-500/30 text-emerald-400",
                Rejected: "bg-red-500/10 border-red-500/30 text-red-400",
              };

              const typeLabels: Record<string, string> = {
                clearance: "Tax Clearance (Form RPT-F01)",
                revision: "Assessment Revision",
                transfer: "Notice of Transfer",
              };

              const unpaidList = checkPropertyTaxStatus(r.propertyTdn, r.propertyId);
              const hasUnpaid = unpaidList.length > 0;

              return (
                <div
                  key={r.id}
                  onClick={() => handleOpenRequestModal(r)}
                  className="p-5 hover:bg-slate-800/40 transition-colors cursor-pointer flex flex-col md:flex-row md:items-center justify-between gap-4 group"
                >
                  <div className="space-y-2 max-w-2xl">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider border ${statusColors[r.status || "Submitted"] || "bg-slate-800 text-slate-400"}`}>
                        {r.status || "Submitted"}
                      </span>
                      <span className="bg-blue-500/10 border border-blue-500/20 text-blue-400 px-2.5 py-0.5 rounded-full text-[10px] font-bold flex items-center gap-1">
                        <Tag className="w-3 h-3" />
                        {typeLabels[r.type] || r.type}
                      </span>
                      <span className="bg-slate-950 border border-slate-800 text-slate-300 px-2.5 py-0.5 rounded-full text-[10px] font-bold flex items-center gap-1">
                        <Building2 className="w-3 h-3 text-slate-400" />
                        TDN: {r.propertyTdn}
                      </span>

                      {r.type === "clearance" && (
                        <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold flex items-center gap-1 border ${
                          hasUnpaid
                            ? "bg-red-500/10 border-red-500/20 text-red-400"
                            : "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                        }`}>
                          {hasUnpaid ? <AlertTriangle className="w-3 h-3" /> : <ShieldCheck className="w-3 h-3" />}
                          {hasUnpaid ? `${unpaidList.length} Unpaid Liabilities` : "Taxes Fully Settled"}
                        </span>
                      )}
                    </div>

                    <div>
                      <h3 className="text-sm font-bold text-white group-hover:text-blue-300 transition-colors">
                        Applicant: {r.userName || "Resident"} ({r.userEmail})
                      </h3>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Property Owner: <span className="text-slate-200 font-semibold">{r.propertyOwner}</span>
                        {r.purpose && ` • Purpose: ${r.purpose}`}
                        {r.reason && ` • Reason: ${r.reason}`}
                        {r.newOwnerName && ` • New Owner: ${r.newOwnerName}`}
                      </p>
                    </div>

                    <div className="flex items-center gap-4 text-[10px] text-slate-500 pt-1">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        Filed: {r.createdAt ? (isNaN(new Date(r.createdAt).getTime()) ? "Recently" : new Date(r.createdAt).toLocaleString()) : "Recently"}
                      </span>
                      {r.processedBy && (
                        <span>• Processed by {r.processedBy}</span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <button className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-xl flex items-center gap-1.5 transition-transform active:scale-95 cursor-pointer">
                      <span>Process Request</span>
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* PROCESSING MODAL */}
      {selectedRequest && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-3xl w-full p-6 space-y-6 shadow-2xl relative my-8 max-h-[90vh] overflow-y-auto">
            {/* HEADER */}
            <div className="flex items-start justify-between border-b border-slate-800 pb-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] font-black uppercase tracking-widest text-blue-400 bg-blue-500/10 border border-blue-500/20 px-2.5 py-0.5 rounded-full">
                    {selectedRequest.type === "clearance" ? "Tax Clearance Application (Form RPT-F01)" : selectedRequest.type === "revision" ? "Assessment Revision" : "Notice of Transfer"}
                  </span>
                  <span className="text-[10px] font-bold text-slate-500">
                    Application ID: {selectedRequest.id}
                  </span>
                </div>
                <h2 className="text-lg font-black text-white">TDN: {selectedRequest.propertyTdn}</h2>
                <p className="text-xs text-slate-400">Registered Owner: <span className="text-white font-bold">{selectedRequest.propertyOwner}</span></p>
              </div>
              <button
                onClick={() => setSelectedRequest(null)}
                className="p-2 text-slate-400 hover:text-white bg-slate-800/60 hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* APPLICANT & PROPERTY METADATA */}
            <div className="p-4 bg-slate-950/80 border border-slate-800 rounded-2xl grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
              <div>
                <p className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">Applicant Taxpayer</p>
                <p className="font-bold text-white mt-0.5">{selectedRequest.userName}</p>
                <p className="text-[11px] text-slate-400">{selectedRequest.userEmail}</p>
                {selectedRequest.contact && (
                  <p className="text-[11px] text-blue-400 font-semibold mt-0.5">Contact: {selectedRequest.contact}</p>
                )}
              </div>

              <div>
                <p className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">Application Type & Details</p>
                {selectedRequest.type === "clearance" && (
                  <p className="text-xs text-slate-200 mt-0.5">
                    Purpose: <span className="font-bold text-white">{selectedRequest.purpose || "Transfer of Ownership"}</span>
                  </p>
                )}
                {selectedRequest.type === "revision" && (
                  <div className="text-xs text-slate-200 mt-0.5 space-y-0.5">
                    <p>Proposed Assessed Val: <span className="font-bold text-emerald-400">₱{(selectedRequest.proposedAssessedValue || 0).toLocaleString()}</span></p>
                    <p>Reason: <span className="italic text-slate-300">{selectedRequest.reason}</span></p>
                  </div>
                )}
                {selectedRequest.type === "transfer" && (
                  <div className="text-xs text-slate-200 mt-0.5 space-y-0.5">
                    <p>New Owner: <span className="font-bold text-white">{selectedRequest.newOwnerName}</span></p>
                    <p>Address: <span className="text-slate-300">{selectedRequest.newOwnerAddress}</span></p>
                    <p>Transfer Date: <span className="text-slate-400">{selectedRequest.transferDate}</span></p>
                  </div>
                )}
              </div>

              <div>
                <p className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">Submission Timestamp</p>
                <p className="text-xs font-semibold text-slate-300 mt-0.5">
                  {selectedRequest.createdAt ? (isNaN(new Date(selectedRequest.createdAt).getTime()) ? "Recently" : new Date(selectedRequest.createdAt).toLocaleString()) : "Recently"}
                </p>
              </div>
            </div>

            {/* TAX COMPLIANCE CHECK FOR TAX CLEARANCE */}
            {selectedRequest.type === "clearance" && (() => {
              const currentUnpaid = checkPropertyTaxStatus(selectedRequest.propertyTdn, selectedRequest.propertyId);
              return (
                <div className="p-4 bg-slate-950/60 border border-slate-800 rounded-2xl space-y-2">
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-blue-400" />
                    Tax Clearance Eligibility Check (Real-time Treasury Ledger)
                  </span>

                  {currentUnpaid.length === 0 ? (
                    <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-xs text-emerald-300 font-bold flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
                      <span>ELIGIBLE FOR TAX CLEARANCE: No outstanding real property tax delinquencies found for TDN {selectedRequest.propertyTdn}.</span>
                    </div>
                  ) : (
                    <div className="p-3.5 bg-red-500/10 border border-red-500/30 rounded-xl text-xs text-red-300 font-bold space-y-2">
                      <div className="flex items-center gap-2 text-red-400">
                        <AlertTriangle className="w-4 h-4 shrink-0" />
                        <span className="uppercase tracking-wide font-black">NOT ELIGIBLE FOR TAX CLEARANCE: UNSETTLED TAX LIABILITIES DETECTED ({currentUnpaid.length} pending delinquency record{currentUnpaid.length > 1 ? "s" : ""})</span>
                      </div>
                      <div className="bg-slate-950/80 p-2.5 rounded-lg border border-red-500/20 font-mono text-[11px] space-y-1">
                        {currentUnpaid.map((d) => (
                          <div key={d.id} className="flex justify-between items-center text-red-200">
                            <span>Tax Year {d.year} (Basic & SEF):</span>
                            <span className="font-bold text-red-400">₱{(d.totalDue || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                          </div>
                        ))}
                      </div>
                      <p className="text-[10px] text-red-300/80 font-normal italic">
                        Note: Tax Clearance Certificates cannot be officially issued until all tax years are settled in full.
                      </p>
                      <button
                        type="button"
                        onClick={() =>
                          handleQuickReject(
                            `APPLICATION REJECTED: Outstanding real property tax liabilities / delinquencies detected on TDN ${selectedRequest.propertyTdn} (${currentUnpaid.length} delinquent year(s)). Please settle all delinquent tax years at the Treasury before applying for clearance.`
                          )
                        }
                        disabled={isSubmitting}
                        className="w-full mt-2 px-3.5 py-2.5 bg-red-600 hover:bg-red-500 text-white text-xs font-bold rounded-xl flex items-center justify-center gap-2 shadow-md transition-transform active:scale-95 disabled:opacity-50 cursor-pointer"
                      >
                        <XCircle className="w-4 h-4" />
                        <span>Reject Application (Unsettled Tax Liabilities)</span>
                      </button>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* QUICK RESPONSE TEMPLATES */}
            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                Quick Municipal Administrator Response Templates
              </label>
              <div className="flex flex-wrap gap-2">
                {[
                  "Official Tax Clearance Certificate RPT-2026 approved and signed by Municipal Treasurer.",
                  "Request approved. Please claim your signed physical certificate at Dipaculao Municipal Hall Window 2.",
                  "Property tax liabilities verified settled. Document cleared for release.",
                  "Pending clearance: Please settle outstanding tax delinquencies before clearance issuance.",
                  "Assessment revision request forwarded to Municipal Assessor for site inspection."
                ].map((tpl, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => handleApplyTemplate(tpl)}
                    className="text-[10px] bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white px-3 py-1.5 rounded-xl transition-colors text-left cursor-pointer"
                  >
                    + {tpl.substring(0, 48)}...
                  </button>
                ))}
              </div>
            </div>

            {/* OFFICIAL ACTION FORM */}
            <form onSubmit={handleUpdateStatus} className="space-y-4">
              <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-300 block mb-1.5">
                  Official Remarks & Action Notes
                </label>
                <textarea
                  rows={3}
                  placeholder="Enter official remarks, clearance certificate tracking number, or instructions..."
                  value={adminNotes}
                  onChange={(e) => setAdminNotes(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-2xl p-3 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors leading-relaxed"
                />
              </div>

              {/* STATUS SELECTOR */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-950/60 p-4 border border-slate-800 rounded-2xl">
                <div>
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 block">
                    Update Application Status
                  </span>
                  <p className="text-[10px] text-slate-500">Set official status visible on resident portal</p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {(["Submitted", "Under Review", "Approved", "Ready for Pick-up", "Rejected"] as RequestFormStatus[]).map((st) => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => setNewStatus(st)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                        newStatus === st
                          ? st === "Approved" || st === "Ready for Pick-up"
                            ? "bg-emerald-600 text-white"
                            : st === "Rejected"
                            ? "bg-red-600 text-white"
                            : "bg-blue-600 text-white"
                          : "bg-slate-900 border border-slate-800 text-slate-400 hover:text-white"
                      }`}
                    >
                      {st}
                    </button>
                  ))}
                </div>
              </div>

              {successMsg && (
                <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-xs text-emerald-400 font-bold flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>{successMsg}</span>
                </div>
              )}

              {/* ACTION BUTTONS */}
              <div className="flex items-center justify-between gap-3 pt-2">
                <div className="flex items-center gap-2">
                  {selectedRequest.type === "clearance" && (
                    <button
                      type="button"
                      onClick={() => setShowCertificateModal(true)}
                      className="px-3.5 py-2.5 bg-slate-800 hover:bg-slate-700 text-amber-400 hover:text-amber-300 text-xs font-bold rounded-xl flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <Award className="w-4 h-4" />
                      <span>Preview Official Clearance Certificate</span>
                    </button>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedRequest(null)}
                    className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold rounded-xl transition-colors cursor-pointer"
                  >
                    Close
                  </button>
                  <button
                    type="button"
                    onClick={() => handleQuickReject()}
                    disabled={isSubmitting}
                    className="px-4 py-2.5 bg-red-600/90 hover:bg-red-600 text-white text-xs font-bold uppercase tracking-wider rounded-xl flex items-center gap-2 transition-transform active:scale-95 disabled:opacity-50 cursor-pointer shadow-lg shadow-red-500/20"
                  >
                    <XCircle className="w-4 h-4" />
                    <span>Reject Request</span>
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold uppercase tracking-wider rounded-xl flex items-center gap-2 transition-transform active:scale-95 disabled:opacity-50 cursor-pointer shadow-lg shadow-blue-500/20"
                  >
                    <Send className="w-4 h-4" />
                    <span>{isSubmitting ? "Updating..." : "Save Official Decision"}</span>
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* OFFICIAL CERTIFICATE PRINT PREVIEW MODAL */}
      {showCertificateModal && selectedRequest && (
        <div className="fixed inset-0 z-[100] bg-slate-950/90 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white text-slate-900 rounded-3xl max-w-2xl w-full p-8 space-y-6 shadow-2xl relative my-8">
            <div className="flex justify-between items-start border-b border-slate-200 pb-4 no-print">
              <div className="flex items-center gap-3">
                <img src="/logo.png" alt="Dipaculao Seal" className="w-12 h-12 object-contain" />
                <div>
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Republic of the Philippines • Province of Aurora</p>
                  <h3 className="text-base font-black text-slate-900 uppercase">Municipality of Dipaculao</h3>
                  <p className="text-[10px] font-bold text-blue-700 uppercase">Office of the Municipal Treasurer</p>
                </div>
              </div>
              <button
                onClick={() => setShowCertificateModal(false)}
                className="p-1.5 text-slate-400 hover:text-slate-800 bg-slate-100 rounded-xl transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* PRINTABLE CERTIFICATE BODY */}
            <div id="printable-area" ref={printAreaRef} className="space-y-6 p-2 bg-white text-slate-900">
              <div className="flex items-center justify-center gap-3 mb-4 hidden print:flex">
                <img src="/logo.png" alt="Dipaculao Seal" className="w-12 h-12 object-contain" />
                <div className="text-center">
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Republic of the Philippines • Province of Aurora</p>
                  <h3 className="text-base font-black text-slate-900 uppercase">Municipality of Dipaculao</h3>
                  <p className="text-[10px] font-bold text-blue-700 uppercase">Office of the Municipal Treasurer</p>
                </div>
              </div>

              <div className="text-center space-y-1 py-2">
                <h2 className="text-xl font-black tracking-wider uppercase text-slate-900">Certificate of Real Property Tax Clearance</h2>
                <p className="text-xs text-slate-600 font-serif italic">Form RPT-F01 • Official Clearance Document</p>
              </div>

              <div className="text-xs leading-relaxed space-y-4 font-serif text-slate-800 border-y border-slate-200 py-4">
                <p>
                  <strong className="font-sans text-slate-900">TO WHOM IT MAY CONCERN:</strong>
                </p>
                <p className="indent-8">
                  THIS IS TO CERTIFY that according to the records on file in this Office, the Real Property Tax (Basic & SEF) on the property covered by Tax Declaration Number <strong className="font-bold underline text-slate-950">{selectedRequest.propertyTdn}</strong> registered in the name of <strong className="font-bold uppercase text-slate-950">{selectedRequest.propertyOwner}</strong> has been <strong className="text-emerald-700 font-bold">FULLY PAID</strong> up to and including Fiscal Year {new Date().getFullYear()}.
                </p>

                <div className="bg-slate-50 border border-slate-200 p-3.5 rounded-xl font-sans text-[11px] space-y-1">
                  <p><strong>Applicant Name:</strong> {selectedRequest.userName}</p>
                  <p><strong>Purpose of Clearance:</strong> {selectedRequest.purpose || "Transfer of Ownership"}</p>
                  <p><strong>Clearance Ref No:</strong> CERT-DIP-{Date.now().toString().slice(-6)}</p>
                  <p><strong>Date Issued:</strong> {new Date().toLocaleDateString()}</p>
                </div>

                <p className="indent-8 text-[11px] text-slate-600">
                  This clearance is issued upon the request of the above-named party for the purpose stated above. Valid for ninety (90) days from date of issuance.
                </p>
              </div>

              <div className="flex justify-between items-end pt-4 font-sans">
                <div>
                  <p className="text-[10px] text-slate-500 font-bold uppercase">Processed By:</p>
                  <p className="text-xs font-bold text-slate-900">{profile?.displayName || "Municipal Treasury Officer"}</p>
                  <p className="text-[10px] text-slate-500">Dipaculao LGU RPT Division</p>
                </div>

                <div className="text-center">
                  <div className="w-36 border-b border-slate-900 mb-1"></div>
                  <p className="text-xs font-black uppercase text-slate-900">Municipal Treasurer</p>
                  <p className="text-[10px] text-slate-500">Municipality of Dipaculao</p>
                </div>
              </div>
            </div>

            {/* ACTION BUTTONS */}
            <div className="flex justify-end gap-3 pt-4 border-t border-slate-200 no-print">
              <button
                type="button"
                onClick={handleDownloadPDF}
                disabled={isSavingPdf}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl flex items-center gap-2 cursor-pointer shadow-md transition-all active:scale-95 disabled:opacity-50"
              >
                <Download className="w-4 h-4" />
                <span>{isSavingPdf ? "Generating PDF..." : "Download Official PDF"}</span>
              </button>
              <button
                type="button"
                onClick={handlePrintCertificate}
                className="px-5 py-2 bg-blue-700 hover:bg-blue-600 text-white text-xs font-bold rounded-xl flex items-center gap-2 cursor-pointer shadow-md transition-all active:scale-95"
              >
                <Printer className="w-4 h-4" />
                <span>Print Document</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
