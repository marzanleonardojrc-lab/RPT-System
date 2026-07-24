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
  Shield,
  Sun,
  Moon,
  MessageSquare,
  FileCheck
} from "lucide-react";
import { cn } from "../lib/utils";

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onLogout: () => void;
  isAdmin: boolean;
  theme?: "dark" | "light";
  onToggleTheme?: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ activeTab, setActiveTab, onLogout, isAdmin, theme = "dark", onToggleTheme }) => {
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
        { id: "requests", label: "Document Requests", icon: FileCheck },
        { id: "queries", label: "Resident Queries", icon: MessageSquare },
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
        <img src="/logo.png" alt="Dipaculao Logo" className="w-9 h-9 object-contain shrink-0" referrerPolicy="no-referrer" />
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
                      "sidebar-nav-item group",
                      activeTab === item.id && "active"
                    )}
                    data-active={activeTab === item.id}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <item.icon className={cn(
                        "w-4 h-4 shrink-0 transition-colors nav-icon",
                        activeTab === item.id 
                          ? "text-blue-400" 
                          : item.id === "collection" || item.id === "reconciliation" || item.id === "delinquencies"
                            ? "text-slate-400 group-hover:text-emerald-400"
                            : "text-slate-400 group-hover:text-blue-400"
                      )} />
                      <span className="truncate">{item.label}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </nav>

      <div className="p-4 bg-slate-950 border-t border-slate-800 space-y-2">
        {onToggleTheme && (
          <button
            onClick={onToggleTheme}
            className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-semibold text-slate-400 hover:bg-slate-800/80 hover:text-white transition-all border border-slate-800/80 cursor-pointer"
          >
            <div className="flex items-center gap-2.5">
              {theme === "light" ? (
                <Sun className="w-4 h-4 text-amber-500 shrink-0" />
              ) : (
                <Moon className="w-4 h-4 text-blue-400 shrink-0" />
              )}
              <span>{theme === "light" ? "Light Mode" : "Dark Mode"}</span>
            </div>
            <span className="text-[10px] font-mono uppercase text-slate-500 font-bold px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800">
              {theme === "light" ? "LIGHT" : "DARK"}
            </span>
          </button>
        )}
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
