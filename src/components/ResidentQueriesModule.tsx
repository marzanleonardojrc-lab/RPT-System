import React, { useState, useEffect } from "react";
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
import { ResidentQuery, QueryStatus, QueryCategory, QueryReply } from "../types";
import { useAuth } from "../AuthContext";
import { logAudit } from "../lib/audit";
import { 
  MessageSquare, 
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
  MessageCircle,
  ShieldCheck,
  Tag,
  ArrowRight
} from "lucide-react";

export default function ResidentQueriesModule() {
  const { profile } = useAuth();
  const [queries, setQueries] = useState<ResidentQuery[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [categoryFilter, setCategoryFilter] = useState<string>("ALL");
  const [selectedQuery, setSelectedQuery] = useState<ResidentQuery | null>(null);

  // Response form state
  const [responseText, setResponseText] = useState("");
  const [newStatus, setNewStatus] = useState<QueryStatus>("Responded");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Listen to resident_queries collection
  useEffect(() => {
    setLoading(true);
    const q = query(collection(db, "resident_queries"), orderBy("createdAt", "desc"));
    
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const fetched: ResidentQuery[] = snapshot.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        })) as ResidentQuery[];
        setQueries(fetched);
        setLoading(false);
      },
      (error) => {
        console.error("Error fetching resident queries:", error);
        handleFirestoreError(error, OperationType.GET, "resident_queries");
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);

  // Filter queries
  const filteredQueries = queries.filter((q) => {
    const matchesSearch =
      q.userName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      q.userEmail?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      q.subject?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      q.propertyTdn?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      q.message?.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesStatus = statusFilter === "ALL" || q.status === statusFilter;
    const matchesCategory = categoryFilter === "ALL" || q.category === categoryFilter;

    return matchesSearch && matchesStatus && matchesCategory;
  });

  // Calculate statistics
  const totalCount = queries.length;
  const pendingCount = queries.filter((q) => q.status === "Pending").length;
  const inReviewCount = queries.filter((q) => q.status === "In Review").length;
  const respondedCount = queries.filter((q) => q.status === "Responded" || q.status === "Resolved").length;

  const handleOpenQueryModal = (q: ResidentQuery) => {
    setSelectedQuery(q);
    setResponseText(q.adminResponse || "");
    setNewStatus(q.status === "Pending" ? "Responded" : q.status);
    setSuccessMsg(null);
  };

  const handleApplyTemplate = (templateText: string) => {
    setResponseText((prev) => (prev ? `${prev}\n\n${templateText}` : templateText));
  };

  const handleSendResponse = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedQuery) return;
    if (!responseText.trim()) {
      alert("Please enter a response message.");
      return;
    }

    setIsSubmitting(true);
    try {
      const now = new Date().toISOString();
      const adminName = profile?.displayName || profile?.email || "Municipal Administrator";

      const newReply: QueryReply = {
        id: `reply-${Date.now()}`,
        senderUid: profile?.uid || "admin",
        senderName: adminName,
        senderRole: profile?.role || "Admin",
        message: responseText.trim(),
        createdAt: now,
      };

      const existingReplies = selectedQuery.replies || [];
      const updatedReplies = [...existingReplies, newReply];

      const updateData = {
        adminResponse: responseText.trim(),
        respondedBy: adminName,
        respondedAt: now,
        status: newStatus,
        replies: updatedReplies,
        updatedAt: now,
      };

      await updateDoc(doc(db, "resident_queries", selectedQuery.id), updateData);

      await logAudit("UPDATE", "resident_queries", selectedQuery.id, {
        status: selectedQuery.status,
      }, {
        status: newStatus,
        respondedBy: adminName,
      });

      setSuccessMsg("Response sent successfully to the resident!");
      setSelectedQuery({
        ...selectedQuery,
        ...updateData,
      });
      setResponseText("");
    } catch (err) {
      console.error("Failed to send response:", err);
      alert("Failed to submit response. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdateStatusOnly = async (status: QueryStatus) => {
    if (!selectedQuery) return;
    try {
      const now = new Date().toISOString();
      await updateDoc(doc(db, "resident_queries", selectedQuery.id), {
        status,
        updatedAt: now,
      });
      setSelectedQuery({ ...selectedQuery, status });
      await logAudit("UPDATE", "resident_queries", selectedQuery.id, { status: selectedQuery.status }, { status });
    } catch (err) {
      console.error("Failed to update status:", err);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* HEADER BAR */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-900/60 p-6 rounded-3xl border border-slate-800 backdrop-blur-sm">
        <div>
          <div className="flex items-center gap-2 text-blue-400 text-xs font-bold uppercase tracking-widest mb-1">
            <MessageSquare className="w-4 h-4" />
            <span>Resident Communications</span>
          </div>
          <h1 className="text-2xl font-black text-white tracking-tight">Resident Inquiries & Helpdesk</h1>
          <p className="text-xs text-slate-400 mt-1">
            Review, track, and officially respond to taxpayer queries, property claims, and assessment questions.
          </p>
        </div>

        {pendingCount > 0 && (
          <div className="flex items-center gap-3 px-4 py-2.5 bg-amber-500/10 border border-amber-500/20 rounded-2xl">
            <AlertCircle className="w-5 h-5 text-amber-400 shrink-0 animate-pulse" />
            <div>
              <p className="text-xs font-black text-amber-300 uppercase tracking-wider">{pendingCount} Pending Inquiries</p>
              <p className="text-[10px] text-amber-400/80">Requires official municipal officer response</p>
            </div>
          </div>
        )}
      </div>

      {/* METRIC SUMMARY CARDS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-5 bg-slate-900/80 border border-slate-800 rounded-3xl relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Total Inquiries</span>
            <div className="w-8 h-8 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
              <MessageCircle className="w-4 h-4" />
            </div>
          </div>
          <p className="text-2xl font-black text-white mt-3">{totalCount}</p>
          <p className="text-[10px] text-slate-500 mt-1">All registered resident tickets</p>
        </div>

        <div className="p-5 bg-slate-900/80 border border-slate-800 rounded-3xl relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-widest text-amber-400">Pending Action</span>
            <div className="w-8 h-8 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <p className="text-2xl font-black text-amber-400 mt-3">{pendingCount}</p>
          <p className="text-[10px] text-slate-500 mt-1">Awaiting initial administrator review</p>
        </div>

        <div className="p-5 bg-slate-900/80 border border-slate-800 rounded-3xl relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-widest text-blue-400">In Review</span>
            <div className="w-8 h-8 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
              <Sparkles className="w-4 h-4" />
            </div>
          </div>
          <p className="text-2xl font-black text-blue-400 mt-3">{inReviewCount}</p>
          <p className="text-[10px] text-slate-500 mt-1">Currently being verified with Treasury</p>
        </div>

        <div className="p-5 bg-slate-900/80 border border-slate-800 rounded-3xl relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-400">Responded & Resolved</span>
            <div className="w-8 h-8 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
              <CheckCircle2 className="w-4 h-4" />
            </div>
          </div>
          <p className="text-2xl font-black text-emerald-400 mt-3">{respondedCount}</p>
          <p className="text-[10px] text-slate-500 mt-1">Completed query responses</p>
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
              placeholder="Search query, name, email, TDN..."
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
            {["ALL", "Pending", "In Review", "Responded", "Resolved"].map((st) => {
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
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded-2xl h-9 sm:h-10 px-2.5 sm:px-3.5 text-xs font-semibold text-slate-200 focus:outline-none focus:border-blue-500 hover:border-slate-700 cursor-pointer shadow-sm transition-colors w-36 sm:w-44 min-w-0 whitespace-nowrap text-ellipsis"
          >
            <option value="ALL">All Categories</option>
            <option value="Tax Assessment">Tax Assessment</option>
            <option value="Payment Verification">Payment Verification</option>
            <option value="Property Claim">Property Claim</option>
            <option value="Penalty Appeal">Penalty Appeal</option>
            <option value="Ownership Transfer">Ownership Transfer</option>
            <option value="General Inquiry">General Inquiry</option>
          </select>
        </div>
      </div>

      {/* QUERY LIST TABLE / CARDS */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-3xl overflow-hidden shadow-xl">
        {loading ? (
          <div className="p-12 text-center text-slate-500">
            <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-blue-400" />
            <p className="text-xs font-semibold">Loading resident inquiries...</p>
          </div>
        ) : filteredQueries.length === 0 ? (
          <div className="p-12 text-center space-y-2">
            <MessageSquare className="w-10 h-10 text-slate-700 mx-auto" />
            <p className="text-sm font-bold text-slate-400">No resident queries found</p>
            <p className="text-xs text-slate-600">Try clearing filters or checking back later when taxpayers submit inquiries.</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-800/60">
            {filteredQueries.map((q) => {
              const statusColors: Record<QueryStatus, string> = {
                Pending: "bg-amber-500/10 border-amber-500/30 text-amber-400 animate-pulse",
                "In Review": "bg-blue-500/10 border-blue-500/30 text-blue-400",
                Responded: "bg-emerald-500/10 border-emerald-500/30 text-emerald-400",
                Resolved: "bg-slate-800 border-slate-700 text-slate-400",
              };

              return (
                <div
                  key={q.id}
                  onClick={() => handleOpenQueryModal(q)}
                  className="p-5 hover:bg-slate-800/40 transition-colors cursor-pointer flex flex-col md:flex-row md:items-center justify-between gap-4 group"
                >
                  <div className="space-y-2 max-w-2xl">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider border ${statusColors[q.status] || "bg-slate-800 text-slate-400"}`}>
                        {q.status}
                      </span>
                      <span className="bg-slate-950 border border-slate-800 text-slate-400 px-2.5 py-0.5 rounded-full text-[10px] font-bold flex items-center gap-1">
                        <Tag className="w-3 h-3 text-blue-400" />
                        {q.category}
                      </span>
                      {q.propertyTdn && (
                        <span className="bg-blue-500/10 border border-blue-500/20 text-blue-400 px-2.5 py-0.5 rounded-full text-[10px] font-bold flex items-center gap-1">
                          <Building2 className="w-3 h-3" />
                          TDN: {q.propertyTdn}
                        </span>
                      )}
                    </div>

                    <h3 className="text-sm font-bold text-white group-hover:text-blue-300 transition-colors">
                      {q.subject}
                    </h3>
                    <p className="text-xs text-slate-400 line-clamp-2 leading-relaxed">
                      {q.message}
                    </p>

                    <div className="flex items-center gap-4 text-[10px] text-slate-500 pt-1">
                      <span className="flex items-center gap-1">
                        <User className="w-3 h-3 text-slate-400" />
                        {q.userName || "Resident"} ({q.userEmail})
                      </span>
                      <span>•</span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {new Date(q.createdAt).toLocaleString()}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-right hidden sm:block">
                      {q.adminResponse ? (
                        <p className="text-[10px] font-bold text-emerald-400 flex items-center justify-end gap-1">
                          <ShieldCheck className="w-3.5 h-3.5" /> Responded by {q.respondedBy || "Admin"}
                        </p>
                      ) : (
                        <p className="text-[10px] font-bold text-amber-400 flex items-center justify-end gap-1">
                          <Clock className="w-3.5 h-3.5" /> Awaiting Reply
                        </p>
                      )}
                    </div>
                    <button className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-xl flex items-center gap-1.5 transition-transform active:scale-95 cursor-pointer">
                      <span>View & Respond</span>
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* RESPONSE & CONVERSATION MODAL */}
      {selectedQuery && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-3xl w-full p-6 space-y-6 shadow-2xl relative my-8 max-h-[90vh] overflow-y-auto">
            {/* MODAL HEADER */}
            <div className="flex items-start justify-between border-b border-slate-800 pb-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] font-black uppercase tracking-widest text-blue-400 bg-blue-500/10 border border-blue-500/20 px-2.5 py-0.5 rounded-full">
                    {selectedQuery.category}
                  </span>
                  <span className="text-[10px] font-bold text-slate-500">
                    Ticket ID: {selectedQuery.id}
                  </span>
                </div>
                <h2 className="text-lg font-black text-white">{selectedQuery.subject}</h2>
              </div>
              <button
                onClick={() => setSelectedQuery(null)}
                className="p-2 text-slate-400 hover:text-white bg-slate-800/60 hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* RESIDENT METADATA CARD */}
            <div className="p-4 bg-slate-950/80 border border-slate-800 rounded-2xl flex flex-wrap items-center justify-between gap-4 text-xs">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-blue-600/20 border border-blue-500/30 flex items-center justify-center font-bold text-blue-400 text-sm">
                  {selectedQuery.userName?.charAt(0) || "R"}
                </div>
                <div>
                  <p className="font-bold text-white">{selectedQuery.userName || "Resident"}</p>
                  <p className="text-[11px] text-slate-400">{selectedQuery.userEmail}</p>
                </div>
              </div>

              {selectedQuery.propertyTdn && (
                <div className="bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-xl text-right">
                  <p className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">Property Reference</p>
                  <p className="text-xs font-black text-blue-400">TDN: {selectedQuery.propertyTdn}</p>
                </div>
              )}

              <div>
                <p className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">Submitted Date</p>
                <p className="text-xs font-semibold text-slate-300">
                  {new Date(selectedQuery.createdAt).toLocaleString()}
                </p>
              </div>
            </div>

            {/* ORIGINAL QUERY MESSAGE */}
            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 block">
                Resident Inquiry Message
              </label>
              <div className="p-4 bg-slate-950/90 border border-slate-800/80 rounded-2xl text-xs text-slate-200 leading-relaxed font-medium whitespace-pre-wrap">
                {selectedQuery.message}
              </div>
            </div>

            {/* THREAD REPLIES IF ANY */}
            {selectedQuery.replies && selectedQuery.replies.length > 0 && (
              <div className="space-y-3 pt-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 block">
                  Communication History ({selectedQuery.replies.length} replies)
                </label>
                <div className="space-y-3 max-h-60 overflow-y-auto pr-1">
                  {selectedQuery.replies.map((reply) => {
                    const isAdminSender = reply.senderRole === "Admin" || reply.senderRole === "Encoder";
                    return (
                      <div
                        key={reply.id}
                        className={`p-3.5 rounded-2xl border text-xs space-y-1.5 ${
                          isAdminSender
                            ? "bg-blue-950/40 border-blue-800/50 text-blue-100 ml-4"
                            : "bg-slate-950 border-slate-800 text-slate-200 mr-4"
                        }`}
                      >
                        <div className="flex items-center justify-between text-[10px]">
                          <span className={`font-bold flex items-center gap-1 ${isAdminSender ? "text-blue-400" : "text-slate-400"}`}>
                            {isAdminSender ? <ShieldCheck className="w-3 h-3" /> : <User className="w-3 h-3" />}
                            {reply.senderName} ({reply.senderRole})
                          </span>
                          <span className="text-slate-500">
                            {new Date(reply.createdAt).toLocaleString()}
                          </span>
                        </div>
                        <p className="leading-relaxed whitespace-pre-wrap">{reply.message}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* QUICK RESPONSE TEMPLATES */}
            <div className="space-y-2 pt-2 border-t border-slate-800">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                Quick Municipal Response Templates
              </label>
              <div className="flex flex-wrap gap-2">
                {[
                  "Your tax payment has been verified and officially recorded in the municipal ledger.",
                  "Please present your Official Transfer Receipt and Title copy at the Municipal Treasury.",
                  "Your tax declaration assessment has been reviewed. Prompt payment discount remains valid.",
                  "Your property claim request has been verified and linked to your resident profile.",
                  "Our assessment team will inspect the property location and update tax declaration records."
                ].map((tpl, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => handleApplyTemplate(tpl)}
                    className="text-[10px] bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white px-3 py-1.5 rounded-xl transition-colors text-left cursor-pointer"
                  >
                    + {tpl.substring(0, 45)}...
                  </button>
                ))}
              </div>
            </div>

            {/* OFFICIAL ADMINISTRATOR RESPONSE FORM */}
            <form onSubmit={handleSendResponse} className="space-y-4 pt-2">
              <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-300 block mb-1.5">
                  Write Official Response Message
                </label>
                <textarea
                  rows={4}
                  required
                  placeholder="Type your official administrator reply or decision here..."
                  value={responseText}
                  onChange={(e) => setResponseText(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-2xl p-3.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors leading-relaxed"
                />
              </div>

              {/* SET TICKET STATUS */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-950/60 p-4 border border-slate-800 rounded-2xl">
                <div>
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 block">
                    Update Ticket Status
                  </span>
                  <p className="text-[10px] text-slate-500">Set current workflow stage for this inquiry</p>
                </div>

                <div className="flex items-center gap-2">
                  {(["Pending", "In Review", "Responded", "Resolved"] as QueryStatus[]).map((st) => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => setNewStatus(st)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                        newStatus === st
                          ? st === "Resolved"
                            ? "bg-emerald-600 text-white"
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
                  <button
                    type="button"
                    onClick={() => handleUpdateStatusOnly("Resolved")}
                    className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-bold rounded-xl transition-colors cursor-pointer"
                  >
                    Mark as Resolved
                  </button>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setSelectedQuery(null)}
                    className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold rounded-xl transition-colors cursor-pointer"
                  >
                    Close
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold uppercase tracking-wider rounded-xl flex items-center gap-2 transition-transform active:scale-95 disabled:opacity-50 cursor-pointer shadow-lg shadow-blue-500/20"
                  >
                    <Send className="w-4 h-4" />
                    <span>{isSubmitting ? "Sending..." : "Submit Official Response"}</span>
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
