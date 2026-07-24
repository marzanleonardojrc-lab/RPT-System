import React, { useState } from "react";
import { AuthProvider, useAuth } from "./AuthContext";
import Sidebar from "./components/Sidebar";
import Dashboard from "./components/Dashboard";
import PropertyRegistry from "./components/PropertyRegistry";
import DelinquencyList from "./components/DelinquencyList";
import COAReports from "./components/COAReports";
import AuditLogView from "./components/AuditLogView";
import Settings from "./components/Settings";
import { ReconciliationModule } from "./components/ReconciliationModule";
import CollectionModule from "./components/CollectionModule";
import ResidentQueriesModule from "./components/ResidentQueriesModule";
import DocumentRequestsModule from "./components/DocumentRequestsModule";
import Login from "./components/Login";
import ProfileModal from "./components/ProfileModal";
import { AlertCircle } from "lucide-react";
import TaxpayerPortal from "./components/TaxpayerPortal";
import ForcedPasswordResetOverlay from "./components/ForcedPasswordResetOverlay";
import { GlobalSearch } from "./components/GlobalSearch";
import PropertyDetails from "./components/PropertyDetails";
import { Property } from "./types";
import { motion } from "motion/react";
import OfflineSyncStatus from "./components/OfflineSyncStatus";
import { checkConnection, isSupabaseConfigured } from "./lib/supabase";

const AppContent: React.FC = () => {
  const { user, profile, loading, logout, isAdmin, isEncoder, isOffline, isTaxpayer, isQuotaExceeded } = useAuth();
  const [activeTabInner, setActiveTabInner] = useState("dashboard");
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [selectedPropertyFromSearch, setSelectedPropertyFromSearch] = useState<Property | null>(null);
  const [paymentPrefillProperty, setPaymentPrefillProperty] = useState<Property | null>(null);
  const [isSupabaseOnline, setIsSupabaseOnline] = useState<boolean>(true);

  React.useEffect(() => {
    const handleConnectionChange = (e: Event) => {
      const customEvent = e as CustomEvent<{ isOnline: boolean }>;
      setIsSupabaseOnline(customEvent.detail.isOnline);
    };
    window.addEventListener("supabase-connection-changed", handleConnectionChange);
    return () => {
      window.removeEventListener("supabase-connection-changed", handleConnectionChange);
    };
  }, []);

  const activeTab = activeTabInner;
  const setActiveTab = (tab: string) => {
    setActiveTabInner(tab);
    if (tab !== "collection") {
      setPaymentPrefillProperty(null); // Clear it if navigating away
    }
  };

  const handlePostPayment = (prop: Property) => {
    setSelectedPropertyFromSearch(null);
    setPaymentPrefillProperty(prop);
    setActiveTab("collection");
  };

  const [theme, setTheme] = useState<"dark" | "light">(
    () => (localStorage.getItem("theme") as "dark" | "light") || "dark"
  );

  const toggleTheme = () => {
    const nextTheme = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    localStorage.setItem("theme", nextTheme);
    if (nextTheme === "light") {
      document.documentElement.classList.add("light");
    } else {
      document.documentElement.classList.remove("light");
    }
    window.dispatchEvent(new CustomEvent("theme-changed", { detail: { theme: nextTheme } }));
  };

  React.useEffect(() => {
    if (theme === "light") {
      document.documentElement.classList.add("light");
    } else {
      document.documentElement.classList.remove("light");
    }

    const handleThemeEvent = (e: Event) => {
      const customEvent = e as CustomEvent<{ theme: "dark" | "light" }>;
      if (customEvent.detail?.theme) {
        setTheme(customEvent.detail.theme);
        if (customEvent.detail.theme === "light") {
          document.documentElement.classList.add("light");
        } else {
          document.documentElement.classList.remove("light");
        }
      }
    };

    window.addEventListener("theme-changed", handleThemeEvent);
    return () => {
      window.removeEventListener("theme-changed", handleThemeEvent);
    };
  }, [theme]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <div className="flex flex-col items-center gap-6 relative">
          <div className="absolute -inset-4 bg-blue-500/10 blur-2xl rounded-full"></div>
          <div className="w-16 h-16 border-4 border-blue-500/20 border-t-blue-500 rounded-full animate-spin relative z-10" />
          <div className="flex flex-col items-center gap-1 z-10">
            <p className="text-white font-bold tracking-widest text-xs uppercase animate-pulse">Initializing System</p>
            <p className="text-slate-500 text-[10px] font-mono">SECURE_ROOT_INIT_COMPLETE</p>
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Login />;
  }

  if (!profile) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <div className="flex flex-col items-center gap-6">
          <div className="w-16 h-16 border-4 border-blue-500/20 border-t-blue-500 rounded-full animate-spin" />
          <p className="text-slate-500 text-[10px] font-mono uppercase tracking-widest">Hydrating User Profile...</p>
        </div>
      </div>
    );
  }

  if (isTaxpayer) {
    return <TaxpayerPortal profile={profile} logout={logout} isOffline={isOffline} />;
  }

  if (profile.requiresPasswordReset) {
    return <ForcedPasswordResetOverlay profile={profile} logout={logout} />;
  }

  if (profile.status === "Pending") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 p-8">
        <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-[2.5rem] p-10 text-center relative overflow-hidden shadow-2xl">
          <div className="absolute -top-24 -left-24 w-48 h-48 bg-blue-500/10 blur-[80px] rounded-full" />
          <div className="absolute -bottom-24 -right-24 w-48 h-48 bg-blue-500/10 blur-[80px] rounded-full" />
          
          <div className="relative z-10 flex flex-col items-center">
            <div className="w-20 h-20 bg-blue-500/10 border border-blue-500/20 rounded-3xl flex items-center justify-center mb-8 shadow-inner shadow-blue-500/5">
              <AlertCircle className="w-10 h-10 text-blue-400" />
            </div>
            
            <h1 className="text-3xl font-black text-white mb-4 tracking-tight leading-tight">
              Access <span className="text-blue-400">Request</span> Pending
            </h1>
            
            <p className="text-slate-400 text-sm leading-relaxed mb-8">
              Welcome, <span className="text-white font-bold">{profile.displayName}</span>. Your account is currently in the queue for manual eligibility review.
            </p>

            <div className="w-full p-6 bg-slate-950/50 rounded-2xl border border-slate-800/50 mb-8 space-y-4">
              <div className="flex items-center gap-3 text-left">
                <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(99,102,241,0.5)]" />
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em]">Current Node: Pending_Approvals</span>
              </div>
              <div className="h-px bg-slate-800/50" />
              <p className="text-[11px] text-slate-500 font-mono leading-relaxed text-left">
                The administrator has been notified of your request. Access will be granted once your credentials are confirmed.
              </p>
            </div>

            <button
              onClick={logout}
              className="w-full py-4 bg-slate-800 hover:bg-slate-700 text-white rounded-2xl text-sm font-bold transition-all border border-slate-700 shadow-lg"
            >
              Log Out
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (profile && profile.status === "Denied") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 p-8">
        <div className="max-w-md w-full bg-slate-900 border border-red-500/20 rounded-[2.5rem] p-10 text-center relative overflow-hidden shadow-2xl">
          <div className="relative z-10 flex flex-col items-center">
            <div className="w-20 h-20 bg-red-500/10 border border-red-500/20 rounded-3xl flex items-center justify-center mb-8">
              <AlertCircle className="w-10 h-10 text-red-500" />
            </div>
            <h1 className="text-3xl font-black text-white mb-4 tracking-tight">Access <span className="text-red-500">Denied</span></h1>
            <p className="text-slate-400 text-sm leading-relaxed mb-8">
              Your request for system access has been rejected by the administrator.
            </p>
            <button
              onClick={logout}
              className="w-full py-4 bg-red-600 hover:bg-red-500 text-white rounded-2xl text-sm font-bold transition-all shadow-lg"
            >
              Exit System
            </button>
          </div>
        </div>
      </div>
    );
  }

  const renderContent = () => {
    const denied = (
      <div className="flex flex-col items-center justify-center py-20 animate-in fade-in slide-in-from-bottom-4 duration-700 flex-1">
        <div className="w-20 h-20 bg-red-500/10 border border-red-500/20 flex items-center justify-center mb-6">
          <AlertCircle className="w-10 h-10 text-red-500" />
        </div>
        <h3 className="text-2xl font-bold text-white mb-2">Access Denied</h3>
        <p className="text-slate-500 max-w-sm text-center">You do not have the required clearance level to access this encrypted node.</p>
        <button 
          onClick={() => setActiveTab("dashboard")}
          className="mt-8 px-6 py-2 bg-slate-800 hover:bg-slate-700 text-white text-sm font-bold transition-all border border-slate-700"
        >
          Return to Command Center
        </button>
      </div>
    );

    switch (activeTab) {
      case "dashboard": return <Dashboard />;
      case "properties": return <PropertyRegistry key="properties-active" isEncoder={isEncoder} isAdmin={isAdmin} initialTab="Active" showTabsSelector={false} onPostPayment={handlePostPayment} />;
      case "archive": return <PropertyRegistry key="properties-archive" isEncoder={isEncoder} isAdmin={isAdmin} initialTab="Archived" showTabsSelector={false} onPostPayment={handlePostPayment} />;
      case "collection": return <CollectionModule prefillProperty={paymentPrefillProperty} />;
      case "requests": return <DocumentRequestsModule />;
      case "queries": return <ResidentQueriesModule />;
      case "delinquencies": return <DelinquencyList isEncoder={isEncoder} isAdmin={isAdmin} onPostPayment={handlePostPayment} />;
      case "reconciliation": return <ReconciliationModule />;
      case "reports": return <COAReports />;
      case "audit": return isAdmin ? <AuditLogView /> : denied;
      case "settings": return isAdmin ? <Settings /> : denied;
      default: return <Dashboard />;
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 font-sans selection:bg-blue-500/30">
      <Sidebar 
        activeTab={activeTab} 
        setActiveTab={setActiveTab} 
        onLogout={logout} 
        isAdmin={isAdmin}
        theme={theme}
        onToggleTheme={toggleTheme}
      />
      <main className="pl-64 min-h-screen bg-[radial-gradient(circle_at_top_right,_#1e293b,_transparent_40%)]">
        <header className="h-16 bg-slate-900/50 backdrop-blur-md border-b border-slate-800 flex items-center justify-between px-8 sticky top-0 z-40">
          <div className="flex items-center gap-4">
            {isAdmin && (
              <GlobalSearch onSelectProperty={(p) => setSelectedPropertyFromSearch(p)} />
            )}
          </div>
          <div className="flex items-center gap-4">
            <OfflineSyncStatus />
            <div 
              className="flex items-center gap-3 cursor-pointer hover:bg-slate-800/50 p-2 rounded-xl transition-colors"
              onClick={() => setIsProfileModalOpen(true)}
            >
              <div className="text-right">
                <p className="text-sm font-bold text-white leading-tight">{profile?.displayName}</p>
                <p className="text-[10px] text-blue-400 font-bold uppercase tracking-wider">{profile?.role}</p>
              </div>
              <div className="w-9 h-9 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-blue-400 font-bold shadow-inner group-hover:bg-blue-500/10 group-hover:text-blue-300">
                {profile?.displayName?.charAt(0)}
              </div>
            </div>
          </div>
        </header>
        <div className="p-8 max-w-7xl mx-auto">
          {isAdmin && !isSupabaseOnline && (
            <motion.div 
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-6 p-5 bg-rose-500/10 border border-rose-500/20 rounded-[2.5rem] flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shadow-lg backdrop-blur-sm relative overflow-hidden"
            >
              <div className="absolute -top-12 -left-12 w-24 h-24 bg-rose-500/10 blur-xl rounded-full" />
              <div className="flex gap-3 relative z-10">
                <AlertCircle className="text-rose-500 w-5 h-5 shrink-0 mt-0.5 md:mt-0 animate-pulse" />
                <div>
                  <h4 className="text-sm font-bold text-rose-400">Database Synchronization Interrupted</h4>
                  <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                    Admin Attention Required: The connection to the central Supabase server is unreachable. Automatic sync is temporarily paused. Transactions will queue locally and sync automatically when connection health is restored.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0 relative z-10">
                <button 
                  onClick={async () => {
                    window.dispatchEvent(new CustomEvent("online"));
                    const healthy = await checkConnection();
                    setIsSupabaseOnline(healthy || !isSupabaseConfigured);
                  }}
                  className="px-4 py-2 bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 font-bold text-xs rounded-xl transition-all border border-rose-500/30 text-center font-sans cursor-pointer"
                >
                  Retry Central Connection
                </button>
                <button
                  onClick={() => setIsSupabaseOnline(true)}
                  className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs rounded-xl transition-all border border-slate-700 text-center font-sans cursor-pointer"
                >
                  Dismiss
                </button>
              </div>
            </motion.div>
          )}
          {isQuotaExceeded && (
            <div className="mb-6 p-5 bg-amber-500/10 border border-amber-500/20 rounded-2xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shadow-lg backdrop-blur-sm">
              <div className="flex gap-3">
                <AlertCircle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5 md:mt-0" />
                <div>
                  <h4 className="text-sm font-bold text-amber-400">Firebase Firestore Daily Read Quota Exceeded</h4>
                  <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                    The free tier database read quota for this project has been exhausted for today. The system is operating in restricted local-offline mode. Please wait for the daily reset tomorrow or upgrade your Firebase plan.
                  </p>
                </div>
              </div>
              <a 
                href="https://console.firebase.google.com/project/gen-lang-client-0015493170/firestore/databases/ai-studio-3027ba5d-1b4c-4ad6-8dbc-237c33ad3844/data?openUpgradeDialog=true"
                target="_blank"
                rel="noreferrer"
                className="shrink-0 px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs rounded-xl transition-all shadow-md shadow-amber-500/10 text-center"
              >
                Upgrade Plan in Console
              </a>
            </div>
          )}
          {renderContent()}
        </div>
      </main>
      
      <ProfileModal 
        isOpen={isProfileModalOpen}
        onClose={() => setIsProfileModalOpen(false)}
      />

      {selectedPropertyFromSearch && (
        <PropertyDetails 
          property={selectedPropertyFromSearch} 
          onClose={() => setSelectedPropertyFromSearch(null)} 
          onPostPayment={handlePostPayment}
        />
      )}
    </div>
  );
};

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
