import React, { useEffect, useState } from "react";
import { AuditLog } from "../types";
import { formatDateFull } from "../lib/utils";
import { fetchAuditLogs } from "../lib/audit";
import { supabase } from "../lib/supabase";
import { Clock, User, ArrowRight, Shield, Filter, Search, Download, Trash2, Loader2, RefreshCw } from "lucide-react";

const AuditLogView: React.FC = () => {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState<"all" | "date" | "month" | "year">("all");
  const [filterValue, setFilterValue] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);

  const loadLogs = async () => {
    setLoading(true);
    try {
      const fetched = await fetchAuditLogs({
        filterType: filterType === "all" ? "none" : filterType,
        filterValue
      });
      setLogs(fetched);
    } catch (err) {
      console.error("Failed to load audit logs:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLogs();
  }, [filterType, filterValue]);

  const handleFilterTypeChange = (type: "all" | "date" | "month" | "year") => {
    setFilterType(type);
    if (type === "all") {
      setFilterValue("");
    }
  };

  const handleExportCSV = () => {
    if (filteredLogs.length === 0) return;
    const headers = ["Timestamp", "Action", "Entity Type", "Entity ID", "User Email", "User ID"];
    const rows = filteredLogs.map(l => [
      `"${l.timestamp}"`,
      `"${l.action}"`,
      `"${l.entityType}"`,
      `"${l.entityId}"`,
      `"${l.userEmail}"`,
      `"${l.userId}"`
    ]);

    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map(e => e.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `audit_trail_${new Date().toISOString().substring(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleBulkDelete = async () => {
    if (filterType === "all") {
      if (!window.confirm("Are you sure you want to clear ALL audit logs? This action cannot be undone.")) return;
    } else {
      if (!window.confirm(`WARNING: This will permanently delete audit logs for ${filterType} (${filterValue}). Continue?`)) return;
    }

    setIsDeleting(true);
    try {
      // 1. Clear local storage audit logs
      const dbStr = localStorage.getItem("rpta_database");
      if (dbStr) {
        const dbObj = JSON.parse(dbStr);
        dbObj["audit_logs"] = [];
        localStorage.setItem("rpta_database", JSON.stringify(dbObj));
      }

      // 2. Clear Supabase audit_logs table
      try {
        await supabase.from("audit_logs").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      } catch (err) {
        console.warn("Supabase audit log purge error:", err);
      }

      await loadLogs();
      alert("Audit logs successfully cleared.");
    } catch (e) {
      console.error("Bulk delete failed:", e);
      alert("Failed to clear audit logs.");
    } finally {
      setIsDeleting(false);
    }
  };

  const filteredLogs = logs.filter(log => {
    if (!searchTerm.trim()) return true;
    const query = searchTerm.toLowerCase();
    return (
      log.action.toLowerCase().includes(query) ||
      log.entityType.toLowerCase().includes(query) ||
      log.entityId.toLowerCase().includes(query) ||
      log.userEmail.toLowerCase().includes(query)
    );
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-900/60 p-6 rounded-3xl border border-slate-800 backdrop-blur-sm">
        <div>
          <div className="flex items-center gap-2 text-blue-400 text-xs font-bold uppercase tracking-widest mb-1">
            <Shield className="w-4 h-4" />
            <span>System Security & Oversight</span>
          </div>
          <h1 className="text-2xl font-black text-white tracking-tight">System Audit Trail</h1>
          <p className="text-xs text-slate-400 mt-1">
            Immutable log of municipal system activity, user security events, and database record modifications.
          </p>
        </div>
        
        <div className="flex flex-col sm:flex-row gap-2 items-center bg-slate-900/50 p-2 rounded-xl border border-slate-800">
           <div className="flex gap-1 bg-slate-950 p-1 rounded-lg">
             <button 
                onClick={() => handleFilterTypeChange("all")}
                className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${filterType === "all" ? "bg-blue-500 text-white shadow-md shadow-blue-500/20" : "text-slate-400 hover:text-white"}`}
             >
               All Recent
             </button>
             <button 
                onClick={() => handleFilterTypeChange("date")}
                className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${filterType === "date" ? "bg-blue-500 text-white shadow-md shadow-blue-500/20" : "text-slate-400 hover:text-white"}`}
             >
               Date
             </button>
             <button 
                onClick={() => handleFilterTypeChange("month")}
                className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${filterType === "month" ? "bg-blue-500 text-white shadow-md shadow-blue-500/20" : "text-slate-400 hover:text-white"}`}
             >
               Month
             </button>
             <button 
                onClick={() => handleFilterTypeChange("year")}
                className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${filterType === "year" ? "bg-blue-500 text-white shadow-md shadow-blue-500/20" : "text-slate-400 hover:text-white"}`}
             >
               Year
             </button>
           </div>
           
           {filterType !== "all" && (
             <div className="flex gap-2 w-full sm:w-auto">
               <input 
                 type={filterType === "year" ? "number" : filterType} 
                 min={filterType === "year" ? "1900" : undefined}
                 max={filterType === "year" ? "2100" : undefined}
                 placeholder={filterType === "year" ? "YYYY (e.g. 2026)" : filterType === "month" ? "YYYY-MM" : "YYYY-MM-DD"}
                 value={filterValue}
                 onChange={(e) => setFilterValue(e.target.value)}
                 className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500 min-w-[140px] w-full"
                 style={{ colorScheme: 'dark' }}
               />
             </div>
           )}
        </div>
      </div>

      {/* SEARCH AND TOOLBAR */}
      <div className="flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="relative w-full md:w-96">
          <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search by user, action, entity type or ID..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-10 pr-4 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500/50"
          />
        </div>

        <div className="flex items-center gap-2 w-full md:w-auto justify-end">
          <button
            onClick={loadLogs}
            disabled={loading}
            className="p-2.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 rounded-xl transition-all cursor-pointer"
            title="Refresh logs"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>

          <button
            onClick={handleExportCSV}
            disabled={filteredLogs.length === 0}
            className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 rounded-xl transition-all text-xs font-bold flex items-center gap-2 disabled:opacity-50 cursor-pointer"
          >
            <Download className="w-4 h-4 text-emerald-400" />
            Export CSV
          </button>

          <button
            onClick={handleBulkDelete}
            disabled={isDeleting || logs.length === 0}
            className="px-4 py-2.5 bg-red-950/40 hover:bg-red-900/60 border border-red-800/40 text-red-300 rounded-xl transition-all text-xs font-bold flex items-center gap-2 disabled:opacity-50 cursor-pointer"
          >
            {isDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
            Clear Logs
          </button>
        </div>
      </div>

      {/* LOGS LISTING */}
      <div className="space-y-3">
        {loading ? (
          <div className="text-center py-20 bg-slate-900/30 rounded-2xl border border-slate-800/50">
            <Loader2 className="w-8 h-8 text-blue-500 animate-spin mx-auto mb-3" />
            <p className="text-sm font-medium text-slate-400">Loading audit trail records...</p>
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="text-center py-16 bg-slate-900/30 rounded-2xl border border-slate-800/50 p-6">
            <Filter className="w-10 h-10 text-slate-600 mx-auto mb-3" />
            <h3 className="text-base font-bold text-white mb-1">No Audit Records Found</h3>
            <p className="text-xs text-slate-400 max-w-sm mx-auto">
              {searchTerm 
                ? `No logs match "${searchTerm}". Try adjusting your search keyword.` 
                : "No system audit events recorded yet for this filter criteria."}
            </p>
          </div>
        ) : (
          filteredLogs.map((log) => (
            <div key={log.id} className="bg-slate-900/60 backdrop-blur-sm p-4 rounded-2xl border border-slate-800/80 shadow-sm flex items-start gap-4 hover:border-slate-700 transition-all">
              <div className={`p-2.5 rounded-xl shrink-0 ${
                log.action === 'CREATE' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                log.action === 'UPDATE' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' :
                log.action === 'VOID' || log.action === 'DELETE' ? 'bg-red-500/10 text-red-400 border border-red-500/20' : 
                log.action === 'APPROVE' ? 'bg-purple-500/10 text-purple-400 border border-purple-500/20' :
                'bg-slate-800 text-slate-400 border border-slate-700'
              }`}>
                {log.action === 'LOGIN' ? <Shield className="w-5 h-5" /> : <Clock className="w-5 h-5" />}
              </div>
              
              <div className="flex-1 min-w-0">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center justify-between">
                  <p className="font-black text-white text-sm flex items-center gap-2 flex-wrap">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider ${
                      log.action === 'CREATE' ? 'bg-emerald-500/20 text-emerald-400' :
                      log.action === 'UPDATE' ? 'bg-blue-500/20 text-blue-400' :
                      log.action === 'VOID' || log.action === 'DELETE' ? 'bg-red-500/20 text-red-400' :
                      'bg-slate-800 text-slate-300'
                    }`}>
                      {log.action}
                    </span>
                    <span className="text-slate-400 font-normal">on</span> 
                    <span className="text-blue-400 font-bold">{log.entityType}</span>
                  </p>
                  <span className="text-xs text-slate-400 flex items-center gap-1 shrink-0 font-mono">
                    <Clock className="w-3 h-3 text-slate-500" />
                    {formatDateFull(log.timestamp)}
                  </span>
                </div>
                
                <div className="mt-2 flex items-center gap-2 text-xs text-slate-400 flex-wrap">
                  <span className="flex items-center gap-1 text-slate-300">
                    <User className="w-3.5 h-3.5 text-slate-500" />
                    {log.userEmail || "System User"}
                  </span>
                  <span className="w-1 h-1 bg-slate-700 rounded-full" />
                  <span className="font-mono text-[10px] text-slate-500">ID: {log.entityId}</span>
                </div>

                {log.newValue && (log.action === 'UPDATE' || log.action === 'CREATE' || log.action === 'VOID') && (
                  <div className="mt-3 p-3 bg-slate-950/80 rounded-xl text-xs font-mono border border-slate-800/80 overflow-x-auto">
                    <div className="grid grid-cols-1 gap-1.5">
                      {typeof log.newValue === 'object' && log.newValue !== null ? (
                        Object.keys(log.newValue).slice(0, 10).map(key => {
                          const val = log.newValue[key];
                          const oldVal = log.oldValue?.[key];
                          if (oldVal !== undefined && oldVal !== val) {
                            return (
                              <div key={key} className="flex items-center gap-2 flex-wrap text-[11px]">
                                <span className="text-slate-400 font-bold">{key}:</span>
                                <span className="line-through text-red-400 opacity-70">{JSON.stringify(oldVal)}</span>
                                <ArrowRight className="w-3 h-3 text-slate-600 shrink-0" />
                                <span className="text-emerald-400 font-bold">{JSON.stringify(val)}</span>
                              </div>
                            );
                          }
                          return (
                            <div key={key} className="flex items-center gap-2 flex-wrap text-[11px]">
                              <span className="text-slate-400 font-bold">{key}:</span>
                              <span className="text-blue-300">{JSON.stringify(val)}</span>
                            </div>
                          );
                        })
                      ) : (
                        <div className="text-slate-300">{JSON.stringify(log.newValue)}</div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default AuditLogView;
