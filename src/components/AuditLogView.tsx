import React, { useEffect, useState } from "react";
import { collection, query, orderBy, limit, onSnapshot, db, handleFirestoreError, OperationType, where, getDocs, writeBatch, doc } from "../lib/firebase";
import { AuditLog } from "../types";
import { formatDateFull } from "../lib/utils";
import { Clock, User, ArrowRight, Shield, Filter, Search, Download, Trash2, Loader2 } from "lucide-react";

const AuditLogView: React.FC = () => {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [filterType, setFilterType] = useState<"none" | "date" | "month" | "year">("none");
  const [filterValue, setFilterValue] = useState("");
  const [isTracking, setIsTracking] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    if (filterType === "none" || !isTracking || !filterValue) {
      setLogs([]);
      return;
    }

    let startTarget: Date;
    let endTarget: Date;
    
    if (filterType === 'date') {
      startTarget = new Date(filterValue);
      endTarget = new Date(filterValue);
      endTarget.setDate(endTarget.getDate() + 1);
    } else if (filterType === 'month') {
      startTarget = new Date(filterValue + "-01");
      endTarget = new Date(startTarget.getFullYear(), startTarget.getMonth() + 1, 1);
    } else { // year
      startTarget = new Date(filterValue + "-01-01");
      endTarget = new Date(Number(filterValue) + 1, 0, 1);
    }

    const q = query(
      collection(db, "audit_logs"), 
      where("timestamp", ">=", startTarget),
      where("timestamp", "<", endTarget),
      orderBy("timestamp", "desc"), 
      limit(100)
    );
    
    return onSnapshot(q, (snapshot) => {
      setLogs(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as AuditLog)));
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, "audit_logs");
    });
  }, [filterType, filterValue, isTracking]);

  const handleTrack = () => {
    if (filterType !== "none" && filterValue) {
      setIsTracking(true);
    }
  };

  const handleFilterTypeChange = (type: "date" | "month" | "year") => {
    setFilterType(type);
    setFilterValue("");
    setIsTracking(false);
  };

  const handleBulkDelete = async () => {
    if (filterType === "none" || !filterValue) return;
    
    if (!window.confirm(`WARNING: This will permanently delete ALL audit logs for the selected ${filterType} (${filterValue}). Ensure you have exported a backup first.\n\nContinue?`)) return;
    setIsDeleting(true);
    try {
      let startTarget: Date;
      let endTarget: Date;
      
      if (filterType === 'date') {
        startTarget = new Date(filterValue);
        endTarget = new Date(filterValue);
        endTarget.setDate(endTarget.getDate() + 1);
      } else if (filterType === 'month') {
        startTarget = new Date(filterValue + "-01");
        endTarget = new Date(startTarget.getFullYear(), startTarget.getMonth() + 1, 1);
      } else { // year
        startTarget = new Date(filterValue + "-01-01");
        endTarget = new Date(Number(filterValue) + 1, 0, 1);
      }

      const q = query(
        collection(db, "audit_logs"), 
        where("timestamp", ">=", startTarget),
        where("timestamp", "<", endTarget)
      );
      
      const snap = await getDocs(q);
      const deletedCount = snap.docs.length;
      
      let batch = writeBatch(db);
      let opCount = 0;
      
      for (const d of snap.docs) {
        batch.delete(doc(db, "audit_logs", d.id));
        opCount++;
        if (opCount === 500) {
           await batch.commit();
           batch = writeBatch(db);
           opCount = 0;
        }
      }
      if (opCount > 0) {
         await batch.commit();
      }
      
      alert(`Successfully deleted ${deletedCount} audit logs for ${filterValue}.`);
    } catch (e) {
      console.error(e);
      alert("Failed to delete audit logs.");
    } finally {
      setIsDeleting(false);
    }
  };

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
        
        <div className="flex flex-col md:flex-row gap-2 items-center bg-slate-900/50 p-2 rounded-xl border border-slate-800">
           <div className="flex gap-1 bg-slate-950 p-1 rounded-lg">
             <button 
                onClick={() => handleFilterTypeChange("date")}
                className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${filterType === "date" ? "bg-blue-500 text-white" : "text-slate-400 hover:text-white"}`}
             >
               Date
             </button>
             <button 
                onClick={() => handleFilterTypeChange("month")}
                className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${filterType === "month" ? "bg-blue-500 text-white" : "text-slate-400 hover:text-white"}`}
             >
               Month
             </button>
             <button 
                onClick={() => handleFilterTypeChange("year")}
                className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${filterType === "year" ? "bg-blue-500 text-white" : "text-slate-400 hover:text-white"}`}
             >
               Year
             </button>
           </div>
           
           {filterType !== "none" && (
             <div className="flex gap-2">
               <input 
                 type={filterType === "year" ? "number" : filterType} 
                 min={filterType === "year" ? "1900" : undefined}
                 max={filterType === "year" ? "2100" : undefined}
                 placeholder={filterType === "year" ? "YYYY" : ""}
                 value={filterValue}
                 onChange={(e) => {
                   setFilterValue(e.target.value);
                   setIsTracking(false);
                 }}
                 onKeyDown={(e) => {
                   if (e.key === "Enter" && filterValue) {
                     handleTrack();
                   }
                 }}
                 className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500 min-w-[140px]"
                 style={{ colorScheme: 'dark' }}
               />
               <button 
                 onClick={handleTrack}
                 disabled={!filterValue}
                 className="bg-white text-slate-950 px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-slate-200 transition-all disabled:opacity-50 flex items-center gap-2"
               >
                 <Search className="w-3 h-3" />
                 Track
               </button>
             </div>
           )}
        </div>
      </div>

      <div className="flex justify-end gap-2">
         {isTracking && logs.length > 0 && (
           <>
             {(filterType === "month" || filterType === "year") && (
               <button 
                 onClick={handleBulkDelete}
                 disabled={isDeleting}
                 className="bg-red-600/20 text-red-400 border border-red-600/50 px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-red-600/30 transition-all flex items-center gap-2"
               >
                 {isDeleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                 Bulk Delete
               </button>
             )}
           </>
         )}
      </div>

      <div className="space-y-3">
        {filterType === "none" ? (
           <div className="text-center py-20 bg-slate-900/30 rounded-xl border border-slate-800/50">
             <Filter className="w-12 h-12 text-slate-600 mx-auto mb-4" />
             <h3 className="text-lg font-bold text-white mb-1">Audit Log Protected</h3>
             <p className="text-sm text-slate-400 max-w-sm mx-auto">
               System changes are not exposed by default. Please select a date, month, or year to track specific activity.
             </p>
           </div>
        ) : !isTracking ? (
           <div className="text-center py-20 bg-slate-900/30 rounded-xl border border-slate-800/50">
             <Search className="w-12 h-12 text-slate-600 mx-auto mb-4" />
             <h3 className="text-lg font-bold text-white mb-1">Ready to Track</h3>
             <p className="text-sm text-slate-400 max-w-sm mx-auto">
               Click the track button to fetch audit logs for the selected {filterType}.
             </p>
           </div>
        ) : logs.length === 0 ? (
           <div className="text-center py-10 bg-slate-900/30 rounded-xl border border-slate-800/50">
             <p className="text-sm text-slate-400">No audit logs found for the selected {filterType}.</p>
           </div>
        ) : (
          logs.map((log) => (
            <div key={log.id} className="bg-slate-900/50 backdrop-blur-sm p-4 rounded-xl border border-slate-800 shadow-sm flex items-start gap-4 hover:border-slate-700 transition-all">
              <div className={`p-2 rounded-lg ${
                log.action === 'CREATE' ? 'bg-emerald-500/10 text-emerald-400' :
                log.action === 'UPDATE' ? 'bg-blue-500/10 text-blue-400' :
                log.action === 'VOID' ? 'bg-red-500/10 text-red-400' : 
                'bg-slate-800 text-slate-400'
              }`}>
                {log.action === 'LOGIN' ? <Shield className="w-5 h-5" /> : <Clock className="w-5 h-5" />}
              </div>
              
              <div className="flex-1">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center justify-between">
                  <p className="font-bold text-white flex items-center gap-2 flex-wrap">
                    {log.action} <span className="text-slate-500 font-normal">on</span> <span className="text-blue-400">{log.entityType}</span>
                  </p>
                  <span className="text-xs text-slate-500 flex items-center gap-1 shrink-0">
                    <Clock className="w-3 h-3" />
                    {formatDateFull(log.timestamp)}
                  </span>
                </div>
                
                <div className="mt-2 flex items-center gap-2 text-sm text-slate-400 flex-wrap">
                  <User className="w-3 h-3 text-slate-500" />
                  <span>{log.userEmail}</span>
                  <span className="w-1 h-1 bg-slate-700 rounded-full mx-1" />
                  <span className="font-mono text-[10px] text-slate-500">ID: {log.entityId}</span>
                </div>

                {log.newValue && log.action === 'UPDATE' && (
                  <div className="mt-3 p-3 bg-slate-950/50 rounded-lg text-xs font-mono border border-slate-800/50 overflow-x-auto">
                    <div className="grid grid-cols-1 gap-2">
                       {Object.keys(log.newValue).map(key => {
                         if (log.oldValue?.[key] !== log.newValue[key]) {
                           return (
                             <div key={key} className="flex items-center gap-2 flex-wrap whitespace-nowrap">
                               <span className="text-slate-500 underline decoration-slate-800">{key}:</span>
                               <span className="line-through text-red-400 opacity-60 px-1">{JSON.stringify(log.oldValue?.[key])}</span>
                               <ArrowRight className="w-3 h-3 text-slate-600 shrink-0" />
                               <span className="text-emerald-400 font-bold bg-emerald-500/5 px-1 rounded">{JSON.stringify(log.newValue[key])}</span>
                             </div>
                           );
                         }
                         return null;
                       })}
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
