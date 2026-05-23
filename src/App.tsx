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
import Login from "./components/Login";
import ProfileModal from "./components/ProfileModal";
import { AlertCircle } from "lucide-react";
import OfflineSyncStatus from "./components/OfflineSyncStatus";

const AppContent: React.FC = () => {
  const { user, profile, loading, logout, isAdmin, isEncoder, isOffline } = useAuth();
  const [activeTab, setActiveTab] = useState("dashboard");
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <div className="flex flex-col items-center gap-6 relative">
          <div className="absolute -inset-4 bg-indigo-500/10 blur-2xl rounded-full"></div>
          <div className="w-16 h-16 border-4 border-indigo-500/20 border-t-indigo-500 rounded-full animate-spin relative z-10" />
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
          <div className="w-16 h-16 border-4 border-indigo-500/20 border-t-indigo-500 rounded-full animate-spin" />
          <p className="text-slate-500 text-[10px] font-mono uppercase tracking-widest">Hydrating User Profile...</p>
        </div>
      </div>
    );
  }

  if (profile.status === "Pending") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 p-8">
        <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-[2.5rem] p-10 text-center relative overflow-hidden shadow-2xl">
          <div className="absolute -top-24 -left-24 w-48 h-48 bg-indigo-500/10 blur-[80px] rounded-full" />
          <div className="absolute -bottom-24 -right-24 w-48 h-48 bg-indigo-500/10 blur-[80px] rounded-full" />
          
          <div className="relative z-10 flex flex-col items-center">
            <div className="w-20 h-20 bg-indigo-500/10 border border-indigo-500/20 rounded-3xl flex items-center justify-center mb-8 shadow-inner shadow-indigo-500/5">
              <AlertCircle className="w-10 h-10 text-indigo-400" />
            </div>
            
            <h1 className="text-3xl font-black text-white mb-4 tracking-tight leading-tight">
              Access <span className="text-indigo-400">Request</span> Pending
            </h1>
            
            <p className="text-slate-400 text-sm leading-relaxed mb-8">
              Welcome, <span className="text-white font-bold">{profile.displayName}</span>. Your account is currently in the queue for manual eligibility review.
            </p>

            <div className="w-full p-6 bg-slate-950/50 rounded-2xl border border-slate-800/50 mb-8 space-y-4">
              <div className="flex items-center gap-3 text-left">
                <div className="w-2 h-2 bg-indigo-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(99,102,241,0.5)]" />
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
      case "properties": return <PropertyRegistry isEncoder={isEncoder} isAdmin={isAdmin} />;
      case "collection": return <CollectionModule />;
      case "delinquencies": return <DelinquencyList isEncoder={isEncoder} isAdmin={isAdmin} />;
      case "reconciliation": return <ReconciliationModule />;
      case "reports": return <COAReports />;
      case "audit": return isAdmin ? <AuditLogView /> : denied;
      case "settings": return isAdmin ? <Settings /> : denied;
      default: return <Dashboard />;
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 font-sans selection:bg-indigo-500/30">
      <Sidebar 
        activeTab={activeTab} 
        setActiveTab={setActiveTab} 
        onLogout={logout} 
        isAdmin={isAdmin}
      />
      <main className="pl-64 min-h-screen bg-[radial-gradient(circle_at_top_right,_#1e293b,_transparent_40%)]">
        <header className="h-16 bg-slate-900/50 backdrop-blur-md border-b border-slate-800 flex items-center justify-between px-8 sticky top-0 z-10">
          <div className="flex items-center gap-4">
            <OfflineSyncStatus />
          </div>
          <div className="flex items-center gap-4">
            <div 
              className="flex items-center gap-3 cursor-pointer hover:bg-slate-800/50 p-2 rounded-xl transition-colors"
              onClick={() => setIsProfileModalOpen(true)}
            >
              <div className="text-right">
                <p className="text-sm font-bold text-white leading-tight">{profile?.displayName}</p>
                <p className="text-[10px] text-indigo-400 font-bold uppercase tracking-wider">{profile?.role}</p>
              </div>
              <div className="w-9 h-9 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-indigo-400 font-bold shadow-inner group-hover:bg-indigo-500/10 group-hover:text-indigo-300">
                {profile?.displayName?.charAt(0)}
              </div>
            </div>
          </div>
        </header>
        <div className="p-8 max-w-7xl mx-auto">
          {renderContent()}
        </div>
      </main>
      
      <ProfileModal 
        isOpen={isProfileModalOpen}
        onClose={() => setIsProfileModalOpen(false)}
      />
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
