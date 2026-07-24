import React, { useState, useEffect } from "react";
import { 
  Wifi, 
  WifiOff, 
  RefreshCw, 
  CheckCircle, 
  AlertCircle, 
  Clock, 
  Database,
  ChevronDown,
  ChevronUp,
  ServerCrash
} from "lucide-react";
import { getOfflineQueue, processOfflineQueue, OfflineTask, saveOfflineQueue } from "../lib/offlineSync";
import { useAuth } from "../AuthContext";
import { cn } from "../lib/utils";
import { checkConnection, isSupabaseConfigured } from "../lib/supabase";
import { motion, AnimatePresence } from "motion/react";

export default function OfflineSyncStatus() {
  const { isOffline, isAdmin } = useAuth();
  const [queue, setQueue] = useState<OfflineTask[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ success: number; fail: number } | null>(null);

  // Supabase connection state
  const [isSupabaseOnline, setIsSupabaseOnline] = useState<boolean | null>(null);
  const [isCheckingSupabase, setIsCheckingSupabase] = useState(false);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  const verifySupabaseConnection = async () => {
    if (isCheckingSupabase) return;
    setIsCheckingSupabase(true);
    try {
      if (!isSupabaseConfigured) {
        setIsSupabaseOnline(true);
        window.dispatchEvent(new CustomEvent("supabase-connection-changed", { detail: { isOnline: true } }));
        return;
      }

      if (isOffline) {
        setIsSupabaseOnline(false);
        window.dispatchEvent(new CustomEvent("supabase-connection-changed", { detail: { isOnline: false } }));
        return;
      }
      
      const isHealthy = await checkConnection();
      setIsSupabaseOnline(isHealthy);
      setLastChecked(new Date());
      window.dispatchEvent(new CustomEvent("supabase-connection-changed", { detail: { isOnline: isHealthy } }));
    } catch (err) {
      console.error("Supabase health check error:", err);
      setIsSupabaseOnline(false);
      window.dispatchEvent(new CustomEvent("supabase-connection-changed", { detail: { isOnline: false } }));
    } finally {
      setIsCheckingSupabase(false);
    }
  };

  // Sync queue listener
  useEffect(() => {
    setQueue(getOfflineQueue());

    const handleQueueChange = (e: Event) => {
      const customEvent = e as CustomEvent<OfflineTask[]>;
      setQueue(customEvent.detail || getOfflineQueue());
    };

    const handleSyncResult = (e: Event) => {
      const customEvent = e as CustomEvent<{ successCount: number; failCount: number }>;
      setSyncResult({
        success: customEvent.detail.successCount,
        fail: customEvent.detail.failCount
      });
      setTimeout(() => setSyncResult(null), 5000);
    };

    window.addEventListener("rpt-offline-queue-changed", handleQueueChange);
    window.addEventListener("rpt-offline-sync-result", handleSyncResult);

    return () => {
      window.removeEventListener("rpt-offline-queue-changed", handleQueueChange);
      window.removeEventListener("rpt-offline-sync-result", handleSyncResult);
    };
  }, []);

  // Periodic health check and network listeners
  useEffect(() => {
    // Initial run
    verifySupabaseConnection();

    // Set check interval to 20 seconds
    const intervalId = setInterval(() => {
      verifySupabaseConnection();
    }, 20000);

    const handleNetworkChange = () => {
      verifySupabaseConnection();
    };

    window.addEventListener("online", handleNetworkChange);
    window.addEventListener("offline", handleNetworkChange);

    return () => {
      clearInterval(intervalId);
      window.removeEventListener("online", handleNetworkChange);
      window.removeEventListener("offline", handleNetworkChange);
    };
  }, [isOffline]);

  const handleManualSync = async () => {
    if (isSyncing || queue.length === 0) return;
    setIsSyncing(true);
    try {
      await processOfflineQueue();
      // Re-verify health upon manual sync trigger
      verifySupabaseConnection();
    } catch (err) {
      console.error("Manual sync failed:", err);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleRemoveTask = (taskId: string) => {
    const nextQueue = queue.filter(t => t.id !== taskId);
    saveOfflineQueue(nextQueue);
  };

  const pendingCount = queue.filter(t => t.status !== 'failed').length;
  const failedCount = queue.filter(t => t.status === 'failed').length;

  const isInterrupted = isSupabaseConfigured && isSupabaseOnline === false;

  return (
    <div className="relative font-sans text-xs">
      {/* Mini Bar Status Badge */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "flex items-center gap-2 px-3 py-1.5 rounded-xl border transition-all duration-200 select-none shadow-md",
          isOffline 
            ? "bg-amber-500/15 border-amber-500/30 text-amber-400 hover:bg-amber-500/25"
            : isInterrupted
              ? "bg-rose-500/15 border-rose-500/30 text-rose-400 hover:bg-rose-500/25 animate-pulse"
              : queue.length > 0
                ? "bg-blue-500/15 border-blue-500/30 text-blue-400 hover:bg-blue-500/25"
                : "bg-emerald-500/15 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/25"
        )}
      >
        <span className="relative flex h-2 w-2">
          <span className={cn(
            "animate-ping absolute inline-flex h-full w-full rounded-full opacity-75",
            isOffline ? "bg-amber-400" : isInterrupted ? "bg-rose-400" : queue.length > 0 ? "bg-blue-400" : "bg-emerald-400"
          )}></span>
          <span className={cn(
            "relative inline-flex rounded-full h-2 w-2",
            isOffline ? "bg-amber-500" : isInterrupted ? "bg-rose-500" : queue.length > 0 ? "bg-blue-500" : "bg-emerald-500"
          )}></span>
        </span>

        {isOffline ? (
          <div className="flex items-center gap-1.5 font-bold uppercase tracking-wider text-[10px]">
            <WifiOff className="w-3.5 h-3.5" />
            <span>Offline Mode</span>
            {queue.length > 0 && (
              <span className="ml-1 px-1.5 py-0.2 bg-amber-500 text-slate-950 font-black rounded-full">
                {queue.length}
              </span>
            )}
          </div>
        ) : isInterrupted ? (
          <div className="flex items-center gap-1.5 font-bold uppercase tracking-wider text-[10px]">
            <ServerCrash className="w-3.5 h-3.5" />
            <span>Sync Interrupted</span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 font-bold uppercase tracking-wider text-[10px]">
            <Wifi className="w-3.5 h-3.5" />
            <span>{queue.length > 0 ? `${queue.length} Queue Pending` : "Live Connected"}</span>
          </div>
        )}
        
        {isOpen ? <ChevronUp className="w-3.5 h-3.5 opacity-60" /> : <ChevronDown className="w-3.5 h-3.5 opacity-60" />}
      </button>

      {/* Expanded Sync Manager Panel Dropdown */}
      <AnimatePresence>
        {isOpen && (
          <>
            {/* Overlay to close when clicking outside */}
            <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
            
            <motion.div
              initial={{ opacity: 0, y: 8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              className="absolute right-0 mt-3 w-80 bg-slate-900/95 backdrop-blur-md border border-slate-800 rounded-3xl p-5 shadow-2xl z-50 overflow-hidden"
            >
              {/* Background Glow */}
              <div className="absolute -top-12 -right-12 w-24 h-24 bg-blue-500/15 blur-2xl rounded-full pointer-events-none" />
              
              <div className="flex justify-between items-center pb-3 border-b border-slate-800/80 mb-4">
                <div className="flex items-center gap-2">
                  <Database className="w-4 h-4 text-blue-400" />
                  <span className="text-sm font-bold text-white tracking-tight">Sync & Connection Status</span>
                </div>
                <div className={cn(
                  "px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-wider",
                  isOffline ? "bg-amber-500/10 text-amber-500" : isInterrupted ? "bg-rose-500/10 text-rose-500" : "bg-emerald-500/10 text-emerald-500"
                )}>
                  {isOffline ? "Offline" : isInterrupted ? "Interrupted" : "Connected"}
                </div>
              </div>

              {/* Administrator Real-Time Alert Banner if Interrupted */}
              {isAdmin && isInterrupted && (
                <div className="mb-4 p-3 bg-rose-500/15 border border-rose-500/20 rounded-2xl text-rose-400 text-xs">
                  <div className="flex items-center gap-1.5 font-bold mb-1">
                    <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                    <span>Admin Alert: Sync Offline</span>
                  </div>
                  <p className="text-[10px] text-slate-400 leading-normal">
                    The connection to Supabase central database is unreachable. Synchronization has been paused. All changes are being recorded safely in the local queue.
                  </p>
                </div>
              )}

              {/* Connection health check block */}
              <div className="bg-slate-950/60 rounded-2xl p-3 border border-slate-800/60 mb-4 space-y-2">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-400">Database Connection:</span>
                  <span className={cn(
                    "font-bold uppercase tracking-wider text-[9px] px-1.5 py-0.5 rounded",
                    isOffline 
                      ? "bg-amber-500/10 text-amber-500" 
                      : isInterrupted 
                        ? "bg-rose-500/10 text-rose-500" 
                        : "bg-emerald-500/10 text-emerald-500"
                  )}>
                    {isOffline 
                      ? "Browser Offline" 
                      : isInterrupted 
                        ? "Sync Interrupted" 
                        : "Healthy (Live)"}
                  </span>
                </div>
                
                {lastChecked && (
                  <div className="flex justify-between text-[9px] text-slate-500">
                    <span>Last Checked:</span>
                    <span>{lastChecked.toLocaleTimeString()}</span>
                  </div>
                )}

                <button
                  onClick={verifySupabaseConnection}
                  disabled={isOffline || isCheckingSupabase}
                  className="w-full mt-1 py-1.5 px-2 bg-slate-800 hover:bg-slate-750 text-slate-300 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl font-bold flex items-center justify-center gap-1 border border-slate-700 text-[10px] transition-colors"
                >
                  <RefreshCw className={cn("w-3 h-3", isCheckingSupabase && "animate-spin")} />
                  {isCheckingSupabase ? "Testing..." : "Test Connection Now"}
                </button>
              </div>

              {/* Status information */}
              <div className="bg-slate-950/60 rounded-2xl p-3 border border-slate-800/60 mb-4 space-y-2">
                <div className="flex justify-between text-slate-400">
                  <span>Pending Operations:</span>
                  <span className="font-bold text-white">{pendingCount}</span>
                </div>
                {failedCount > 0 && (
                  <div className="flex justify-between text-red-400 font-medium">
                    <span>Failed Sync Attempts:</span>
                    <span className="font-bold">{failedCount}</span>
                  </div>
                )}
                <div className="h-px bg-slate-800/50 my-1" />
                <p className="text-[10px] text-slate-500 leading-relaxed font-normal">
                  Data entered offline is secured in browsers' IndexedDB cache queue and will sync automatically when central connection re-establishes.
                </p>
              </div>

              {/* Sync Controls */}
              {queue.length > 0 && (
                <button
                  onClick={handleManualSync}
                  disabled={isOffline || isSyncing}
                  className={cn(
                    "w-full py-2.5 mb-4 rounded-xl font-bold flex items-center justify-center gap-2 transition-all border shadow-lg",
                    isOffline
                      ? "bg-slate-800/60 border-slate-800 text-slate-500 cursor-not-allowed"
                      : isSyncing
                        ? "bg-blue-600/20 border-blue-500/30 text-blue-300"
                        : "bg-blue-600 hover:bg-blue-500 border-blue-500 text-white hover:shadow-blue-500/10"
                  )}
                >
                  <RefreshCw className={cn("w-4 h-4", isSyncing && "animate-spin")} />
                  {isSyncing ? "Synchronizing..." : isOffline ? "Connect to Sync" : "Sync Local Cache Now"}
                </button>
              )}

              {/* Success Sync Flash Message */}
              {syncResult && (
                <div className="mb-4 p-3 bg-emerald-500/10 border border-emerald-500/25 rounded-2xl flex items-center gap-2.5 text-emerald-400 font-medium">
                  <CheckCircle className="w-4 h-4 shrink-0" />
                  <div>
                    <p className="font-bold text-white">Sync Completed!</p>
                    <p className="text-[10px] opacity-80">Synced {syncResult.success} inputs successfully.</p>
                  </div>
                </div>
              )}

              {/* Queue List */}
              <div className="max-h-48 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                <p className="text-[10px] uppercase font-bold tracking-widest text-slate-500 mb-2">
                  Transaction Queue ({queue.length})
                </p>
                {queue.length === 0 ? (
                  <div className="text-center py-6 text-slate-500 flex flex-col items-center gap-2">
                    <CheckCircle className="w-8 h-8 text-slate-700" />
                    <span>No pending sync items. Your local cache is fully synchronized.</span>
                  </div>
                ) : (
                  queue.map((task) => (
                    <div 
                      key={task.id}
                      className="p-2.5 bg-slate-950/40 border border-slate-800/80 rounded-xl space-y-1 relative group"
                    >
                      <div className="flex justify-between items-start gap-2">
                        <span className="font-bold text-slate-200 block truncate max-w-[170px]">
                          {task.description}
                        </span>
                        
                        <button
                          onClick={() => handleRemoveTask(task.id)}
                          className="text-slate-500 hover:text-red-400 absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 hover:bg-slate-800 rounded"
                          title="Discard local draft"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>

                      <div className="flex justify-between items-center text-[10px] text-slate-500">
                        <div className="flex items-center gap-1 font-mono text-[9px]">
                          <Clock className="w-3 h-3 text-slate-600" />
                          <span>{new Date(task.createdAt).toLocaleTimeString()}</span>
                        </div>

                        <div>
                          {task.status === 'syncing' ? (
                            <span className="text-blue-400 flex items-center gap-1">
                              <RefreshCw className="w-2.5 h-2.5 animate-spin" />
                              Syncing
                            </span>
                          ) : task.status === 'failed' ? (
                            <span className="text-red-400 flex items-center gap-1" title={task.error}>
                              <AlertCircle className="w-2.5 h-2.5" />
                              Failed
                            </span>
                          ) : (
                            <span className="text-amber-500 flex items-center gap-1">
                              <Clock className="w-2.5 h-2.5" />
                              Cached
                            </span>
                          )}
                        </div>
                      </div>
                      
                      {task.error && (
                        <p className="text-[9px] text-red-400/90 leading-tight bg-red-500/5 p-1.5 border border-red-500/10 rounded-lg font-mono">
                          Error: {task.error}
                        </p>
                      )}
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
