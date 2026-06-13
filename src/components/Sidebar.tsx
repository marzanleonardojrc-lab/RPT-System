import React from "react";
import { 
  LayoutDashboard, 
  Database, 
  FileText, 
  LogOut, 
  Settings, 
  History,
  ShieldCheck,
  Building2,
  AlertCircle,
  Calculator,
  Archive,
  Compass,
  Briefcase,
  Coins,
  Shield
} from "lucide-react";
import { cn } from "../lib/utils";

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onLogout: () => void;
  isAdmin: boolean;
}

const Sidebar: React.FC<SidebarProps> = ({ activeTab, setActiveTab, onLogout, isAdmin }) => {
  const menuGroups = [
    {
      title: "OVERVIEW",
      icon: Compass,
      items: [
        { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
      ]
    },
    {
      title: "MANAGEMENT",
      icon: Briefcase,
      items: [
        { id: "properties", label: "Properties", icon: Building2 },
        { id: "archive", label: "Archive", icon: Archive },
      ]
    },
    {
      title: "FINANCE",
      icon: Coins,
      items: [
        { id: "collection", label: "Collection", icon: FileText },
        { id: "delinquencies", label: "Delinquencies", icon: AlertCircle },
        { id: "reconciliation", label: "Reconciliation", icon: Calculator },
        { id: "reports", label: "COA Reports", icon: FileText },
      ]
    },
    {
      title: "ADMINISTRATION",
      icon: Shield,
      items: [
        { id: "audit", label: "Audit Logs", icon: History },
        ...(isAdmin ? [{ id: "settings", label: "System Roles", icon: ShieldCheck }] : []),
      ]
    }
  ];

  return (
    <aside className="w-64 bg-slate-900/50 backdrop-blur-sm border-r border-slate-800 h-screen fixed left-0 top-0 flex flex-col z-20">
      <div className="p-6 border-b border-slate-800 flex items-center gap-3">
        <div className="w-8 h-8 bg-slate-900 border border-slate-850 rounded-full flex items-center justify-center shrink-0 shadow-lg shadow-black/40 overflow-hidden">
          <img src="/logo.png" alt="Dipaculao Logo" className="w-6 h-6 object-contain" referrerPolicy="no-referrer" />
        </div>
        <div>
          <h1 className="text-lg font-bold tracking-tight text-white leading-none">RPT System</h1>
          <p className="text-[10px] text-slate-500 mt-1 uppercase tracking-widest font-bold font-mono">Dipaculao LGU</p>
        </div>
      </div>

      <nav className="flex-1 p-4 space-y-6 overflow-y-auto">
        {menuGroups.map((group) => {
          if (group.items.length === 0) return null;
          return (
            <div key={group.title} className="space-y-1.5 animate-in fade-in duration-300">
              <div className="text-[10px] uppercase tracking-widest text-slate-600 font-bold mb-2 ml-2 flex items-center gap-1.5">
                <group.icon className="w-3.5 h-3.5 text-slate-600/80" />
                <span>{group.title}</span>
              </div>
              <div className="space-y-1">
                {group.items.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => setActiveTab(item.id)}
                    className={cn(
                      "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 text-left",
                      activeTab === item.id 
                        ? "bg-indigo-500/10 text-indigo-400 border border-indigo-500/20" 
                        : "text-slate-400 hover:bg-slate-800 hover:text-slate-200 border border-transparent"
                    )}
                  >
                    <item.icon className={cn("w-4 h-4 shrink-0", activeTab === item.id ? "text-indigo-400" : "text-slate-500")} />
                    <span className="truncate">{item.label}</span>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </nav>

      <div className="p-4 bg-slate-950 border-t border-slate-800">
        <button
          onClick={onLogout}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-semibold text-slate-500 hover:bg-red-500/10 hover:text-red-400 transition-all border border-transparent hover:border-red-500/20"
        >
          <LogOut className="w-4 h-4" />
          Logout Session
        </button>
      </div>
    </aside>
  );
};

export default Sidebar;
