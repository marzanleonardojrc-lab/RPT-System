import React, { useEffect, useState } from "react";
import { 
  collection, 
  onSnapshot, 
  updateDoc, 
  deleteDoc,
  doc,
  db,
  auth,
  handleFirestoreError,
  OperationType,
  setDoc,
  query,
  where,
  getDocs,
  writeBatch
} from "../lib/firebase";
import { UserProfile, UserRole, Property } from "../types";
import { Shield, User, Check, X, Lock, Save, Loader2, AlertCircle, UserPlus, Eye, EyeOff, Sun, Moon, Database, Download, Building2, UserCheck } from "lucide-react";
import { createClient } from "@supabase/supabase-js";
import { isSupabaseConfigured } from "../lib/supabase";
import { logAudit } from "../lib/audit";
import ConfirmDialog from "./ConfirmDialog";
import { useAuth } from "../AuthContext";
import { motion, AnimatePresence } from "motion/react";
import { toISODateSafe } from "../lib/utils";
import { exportDatabaseToCSV, exportFullDatabaseToJSON } from "../lib/export-helpers";

const Settings: React.FC = () => {
  const { profile, updateUserName, updateUserUsername, updateUserPassword } = useAuth();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [activeSubTab, setActiveSubTab] = useState<"active" | "pending" | "staff" | "provision">("active");
  
  // Staff registration module states
  const [staffFullName, setStaffFullName] = useState("");
  const [staffEmail, setStaffEmail] = useState("");
  const [staffUsername, setStaffUsername] = useState("");
  const [staffPassword, setStaffPassword] = useState("StaffPass123!");
  const [staffRole, setStaffRole] = useState<UserRole>("User");
  const [staffDesignation, setStaffDesignation] = useState("Treasury Tax Encoder");
  const [staffStatus, setStaffStatus] = useState<"Approved" | "Pending">("Approved");
  const [staffLoading, setStaffLoading] = useState(false);
  const [staffError, setStaffError] = useState<string | null>(null);
  const [staffSuccess, setStaffSuccess] = useState<string | null>(null);
  
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    return (localStorage.getItem("theme") as "dark" | "light") || "dark";
  });

  const handleThemeChange = (newTheme: "dark" | "light") => {
    setTheme(newTheme);
    localStorage.setItem("theme", newTheme);
    if (newTheme === "light") {
      document.documentElement.classList.add("light");
    } else {
      document.documentElement.classList.remove("light");
    }
    window.dispatchEvent(new CustomEvent("theme-changed", { detail: { theme: newTheme } }));
  };

  useEffect(() => {
    const handleThemeEvent = (e: Event) => {
      const customEvent = e as CustomEvent<{ theme: "dark" | "light" }>;
      if (customEvent.detail?.theme) {
        setTheme(customEvent.detail.theme);
      }
    };
    window.addEventListener("theme-changed", handleThemeEvent);
    return () => {
      window.removeEventListener("theme-changed", handleThemeEvent);
    };
  }, []);
  
  // Remove security form from settings
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: (reason?: string) => void;
    type?: "danger" | "warning" | "info" | "success";
    showInput?: boolean;
    inputPlaceholder?: string;
    inputLabel?: string;
    requiredInput?: boolean;
  }>({
    isOpen: false,
    title: "",
    message: "",
    onConfirm: () => {},
  });

  // Provisioning module states
  const [properties, setProperties] = useState<Property[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedProperty, setSelectedProperty] = useState<Property | null>(null);
  
  const [provUsername, setProvUsername] = useState("");
  const [provPassword, setProvPassword] = useState("TempPass123!");
  const [provEmail, setProvEmail] = useState("");
  const [provError, setProvError] = useState<string | null>(null);
  const [provSuccess, setProvSuccess] = useState<string | null>(null);
  const [provLoading, setProvLoading] = useState(false);

  const [isExporting, setIsExporting] = useState(false);
  const [isExportingJSON, setIsExportingJSON] = useState(false);

  const handleExportCSV = async () => {
    setIsExporting(true);
    try {
      await exportDatabaseToCSV();
      await logAudit("EXPORT", "PropertyDatabase", "ALL", null, { format: "CSV", recipient: profile?.email });
      setConfirmDialog({
        isOpen: true,
        title: "Export Completed",
        message: "The property database records have been successfully fetched from the primary server, compiled, and downloaded as a CSV backup file.",
        type: "success",
        onConfirm: () => {}
      });
    } catch (err: any) {
      console.error("Export Error:", err);
      setConfirmDialog({
        isOpen: true,
        title: "Export Failed",
        message: err.message || "An error occurred while compiling the central database records.",
        type: "danger",
        onConfirm: () => {}
      });
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportJSON = async () => {
    setIsExportingJSON(true);
    try {
      await exportFullDatabaseToJSON();
      await logAudit("EXPORT", "FullDatabase", "ALL", null, { format: "JSON", recipient: profile?.email });
      setConfirmDialog({
        isOpen: true,
        title: "Full Backup Completed",
        message: "All database tables (properties, payments, delinquencies, audit logs, users) have been compiled and exported into a full JSON backup file.",
        type: "success",
        onConfirm: () => {}
      });
    } catch (err: any) {
      console.error("JSON Export Error:", err);
      setConfirmDialog({
        isOpen: true,
        title: "Export Failed",
        message: err.message || "An error occurred while compiling the full database snapshot.",
        type: "danger",
        onConfirm: () => {}
      });
    } finally {
      setIsExportingJSON(false);
    }
  };

  const currentCleanUsername = provUsername.trim().toLowerCase().replace(/\s+/g, "");
  const existingResidentUser = users.find(u => 
    (u.username && u.username.toLowerCase() === currentCleanUsername) ||
    (selectedProperty && u.displayName?.toLowerCase() === selectedProperty.ownerName?.toLowerCase())
  );

  // Active user list for property references
  useEffect(() => {
    return onSnapshot(collection(db, "properties"), (snapshot) => {
      setProperties(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Property)));
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, "properties");
    });
  }, []);

  // Secondary auth helper to create user without logging out the administrator
  const createSecondaryUser = async (email: string, pass: string): Promise<string> => {
    if (!isSupabaseConfigured) {
      return `mock-user-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    }
    const rawUrl = (import.meta.env.VITE_SUPABASE_URL as string) || (import.meta.env.SUPABASE_URL as string) || '';
    const rawKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || (import.meta.env.SUPABASE_ANON_KEY as string) || '';
    try {
      const secondarySupabase = createClient(rawUrl, rawKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false
        }
      });
      const { data, error } = await secondarySupabase.auth.signUp({ email, password: pass });
      if (error) throw error;
      if (!data.user) throw new Error("Failed to provision secondary user.");
      return data.user.id;
    } catch (err) {
      console.warn("Secondary user creation via Supabase failed, generating local mock UID:", err);
      return `mock-user-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    }
  };

  const handleSelectProperty = (prop: Property) => {
    setSelectedProperty(prop);
    setSearchQuery("");
    const defaultUsername = prop.tdNumber ? prop.tdNumber.replace(/[^a-zA-Z0-9-]/g, "").toLowerCase() : "";
    setProvUsername(defaultUsername);
    setProvEmail(defaultUsername ? `${defaultUsername}@rpt.dipaculao.gov` : "");
  };

  const handleProvisionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setProvError(null);
    setProvSuccess(null);
    
    if (!selectedProperty) {
      setProvError("Verification Blocked: Search and select an active property assessment context first.");
      return;
    }
    const cleanUsername = provUsername.trim().toLowerCase().replace(/\s+/g, "");
    if (cleanUsername.length < 3) {
      setProvError("Username must be at least 3 characters long.");
      return;
    }
    if (provPassword.length < 6) {
      setProvError("Temporary default password must be at least 6 characters.");
      return;
    }

    setProvLoading(true);
    try {
      const emailToUse = provEmail.trim() ? provEmail.trim() : `${cleanUsername}@rpt.dipaculao.gov`;
      
      // Check username conflict in user_mappings
      const q = query(collection(db, "user_mappings"), where("username", "==", cleanUsername));
      const snap = await getDocs(q);
      if (!snap.empty) {
        throw new Error("Username already assigned to another registered resident node. Please specify a unique identifier.");
      }

      // Create authentication profile
      const uid = await createSecondaryUser(emailToUse, provPassword);

      // Create users collection profile document
      const newUserProfile: any = {
        uid: uid,
        email: emailToUse,
        username: cleanUsername,
        displayName: selectedProperty.ownerName,
        role: "Resident", // As strictly specified
        status: "Approved",
        createdAt: new Date().toISOString(),
        requiresPasswordReset: true, // Core login transition guard
        linkedPropertyIds: [selectedProperty.id]
      };

      await setDoc(doc(db, "users", uid), newUserProfile);

      // Add routing mappings
      await setDoc(doc(db, "user_mappings", cleanUsername), {
        username: cleanUsername,
        email: emailToUse
      });

      // Also map TDN for direct login support if different from chosen username
      const tdnCleanStr = selectedProperty.tdNumber?.trim().toLowerCase().replace(/[^a-zA-Z0-9-]/g, "");
      if (tdnCleanStr && tdnCleanStr !== cleanUsername) {
        await setDoc(doc(db, "user_mappings", tdnCleanStr), {
          username: tdnCleanStr,
          email: emailToUse
        });
      }

      // Record logs
      await logAudit("CREATE", "ProvisionResidentAccess", uid, null, {
        displayName: selectedProperty.ownerName,
        email: emailToUse,
        username: cleanUsername,
        role: "Resident",
        linkedPropertyId: selectedProperty.id
      });

      setProvSuccess(`SUCCESS: Account successfully provisioned!\n\nResident Name: ${selectedProperty.ownerName}\nAssigned Username: "${cleanUsername}"\nTemporary Password: "${provPassword}"\n\nProvide these temporary credentials to the resident for their first-time login.`);
      setSelectedProperty(null);
      setProvUsername("");
      setProvPassword("TempPass123!");
      setProvEmail("");
    } catch (err: any) {
      console.error(err);
      setProvError(err.message || "Failed to provision resident credentials.");
    } finally {
      setProvLoading(false);
    }
  };

  const handleLinkPropertyToExisting = async (existingUser: UserProfile) => {
    if (!selectedProperty) return;
    setProvLoading(true);
    setProvError(null);
    setProvSuccess(null);
    try {
      const currentLinks = existingUser.linkedPropertyIds || [];
      if (currentLinks.includes(selectedProperty.id)) {
        throw new Error(`This property is already linked to the existing profile of ${existingUser.displayName}.`);
      }
      
      const updatedLinks = [...currentLinks, selectedProperty.id];
      await updateDoc(doc(db, "users", existingUser.uid), {
        linkedPropertyIds: updatedLinks
      });

      // Record logs
      await logAudit("UPDATE", "LinkPropertyToResident", existingUser.uid, { linkedPropertyIds: currentLinks }, {
        displayName: existingUser.displayName,
        username: existingUser.username,
        linkedPropertyIds: updatedLinks,
        addedPropertyId: selectedProperty.id,
        addedPropertyTDN: selectedProperty.tdNumber
      });

      setProvSuccess(`SUCCESS: Real Property Declaration linked successfully!\n\nOwner: ${existingUser.displayName}\nAccount Username: "@${existingUser.username}"\nTDN Added: "${selectedProperty.tdNumber}"\n\nThe resident can now manage this assessment within their existing account workspace.`);
      setSelectedProperty(null);
      setProvUsername("");
      setProvPassword("TempPass123!");
      setProvEmail("");
    } catch (err: any) {
      console.error(err);
      setProvError(err.message || "Failed to link property to the existing resident node.");
    } finally {
      setProvLoading(false);
    }
  };

  const handleStaffRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStaffError(null);
    setStaffSuccess(null);

    const cleanName = staffFullName.trim();
    if (!cleanName) {
      setStaffError("Full Name is required for staff account registration.");
      return;
    }

    const cleanUsername = staffUsername.trim().toLowerCase().replace(/\s+/g, "");
    if (cleanUsername.length < 3) {
      setStaffError("Username must be at least 3 characters long.");
      return;
    }

    if (staffPassword.length < 6) {
      setStaffError("Initial password must be at least 6 characters long.");
      return;
    }

    setStaffLoading(true);
    try {
      const emailToUse = staffEmail.trim() ? staffEmail.trim() : `${cleanUsername}@rpt.dipaculao.gov`;

      // Check username conflict in user_mappings
      const q = query(collection(db, "user_mappings"), where("username", "==", cleanUsername));
      const snap = await getDocs(q);
      if (!snap.empty) {
        throw new Error(`Username "@${cleanUsername}" is already assigned to another profile. Please specify a unique username.`);
      }

      // Check existing user in memory state
      const existing = users.find(u => 
        (u.username && u.username.toLowerCase() === cleanUsername) ||
        (u.email && u.email.toLowerCase() === emailToUse.toLowerCase())
      );
      if (existing) {
        throw new Error(`An account with username "@${cleanUsername}" or email "${emailToUse}" already exists.`);
      }

      // Create secondary authentication credential
      const uid = await createSecondaryUser(emailToUse, staffPassword);

      // Construct UserProfile
      const newStaffProfile: UserProfile = {
        uid: uid,
        email: emailToUse,
        username: cleanUsername,
        displayName: cleanName,
        role: staffRole,
        status: staffStatus as any,
        createdAt: new Date().toISOString(),
        designation: staffDesignation,
        requiresPasswordReset: true
      };

      // Save to Firestore
      await setDoc(doc(db, "users", uid), newStaffProfile);

      // Save routing mapping
      await setDoc(doc(db, "user_mappings", cleanUsername), {
        username: cleanUsername,
        email: emailToUse
      });

      // Write to Supabase staff_profiles if configured
      if (isSupabaseConfigured) {
        try {
          const rawUrl = (import.meta.env.VITE_SUPABASE_URL as string) || (import.meta.env.SUPABASE_URL as string) || '';
          const rawKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || (import.meta.env.SUPABASE_ANON_KEY as string) || '';
          const sbClient = createClient(rawUrl, rawKey);
          await sbClient.from("users").upsert(newStaffProfile);
          await sbClient.from("staff_profiles").upsert({
            uid: uid,
            email: emailToUse,
            display_name: cleanName,
            username: cleanUsername,
            designation: staffDesignation,
            status: staffStatus,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          });
        } catch (sbErr) {
          console.warn("Supabase staff sync warning:", sbErr);
        }
      }

      // Audit Log
      await logAudit("CREATE", "REGISTER_STAFF_ACCOUNT", uid, null, {
        displayName: cleanName,
        email: emailToUse,
        username: cleanUsername,
        role: staffRole,
        designation: staffDesignation,
        status: staffStatus,
        registeredBy: profile?.displayName || profile?.email || "Admin"
      });

      setStaffSuccess(
        `SUCCESS: Staff Account Registered Successfully!\n\n` +
        `Staff Name: ${cleanName}\n` +
        `Assigned Designation: ${staffDesignation}\n` +
        `Access Clearance: ${staffRole === 'Admin' ? 'Administrator' : 'Staff / Encoder (User)'}\n` +
        `Assigned Username: "${cleanUsername}"\n` +
        `Work Email: "${emailToUse}"\n` +
        `Initial Password: "${staffPassword}"\n` +
        `Account Status: ${staffStatus.toUpperCase()}\n\n` +
        `The staff member can now log in using these credentials under the Staff portal.`
      );

      // Reset form fields
      setStaffFullName("");
      setStaffEmail("");
      setStaffUsername("");
      setStaffPassword("StaffPass123!");
      setStaffDesignation("Treasury Tax Encoder");
      setStaffRole("User");
      setStaffStatus("Approved");

    } catch (err: any) {
      console.error("Staff Registration Error:", err);
      setStaffError(err.message || "Failed to register staff account.");
    } finally {
      setStaffLoading(false);
    }
  };

  useEffect(() => {
    return onSnapshot(collection(db, "users"), (snapshot) => {
      setUsers(snapshot.docs.map(doc => ({ uid: doc.id, ...doc.data() } as UserProfile)));
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, "users");
    });
  }, []);

  const updateRole = async (uid: string, newRole: UserRole) => {
    const user = users.find(u => u.uid === uid);
    
    setConfirmDialog({
      isOpen: true,
      title: "Authorize Level Shift?",
      message: `You are about to modify the security clearance for ${user?.displayName} to ${newRole.toUpperCase()}. \n\nThis will synchronize their permissions across all data modules.`,
      type: "warning",
      onConfirm: async () => {
        try {
          const old = users.find(u => u.uid === uid);
          await updateDoc(doc(db, "users", uid), { role: newRole });
          await logAudit("UPDATE", "UserRole", uid, old, { role: newRole });
        } catch (err) {
          handleFirestoreError(err, OperationType.WRITE, `users/${uid}`);
        }
      }
    });
  };



  const handleApproval = async (uid: string, status: "Approved" | "Denied") => {
    const user = users.find(u => u.uid === uid);
    
    setConfirmDialog({
      isOpen: true,
      title: status === "Approved" ? "Grant System Access?" : "Reject Access Request?",
      message: status === "Approved" 
        ? `You are about to VALIDATE ${user?.displayName} for system use. \n\nThey will be granted USER privileges by default. Proceed?`
        : `You are about to DENY ${user?.displayName}'s request to join the system. \n\nPlease provide official remarks for rejection.`,
      type: status === "Approved" ? "success" : "danger",
      showInput: status === "Denied",
      requiredInput: status === "Denied",
      inputPlaceholder: "State official reason for rejecting account request...",
      inputLabel: "Remarks / Reason for Rejection (Required):",
      onConfirm: async (reason?: string) => {
        try {
          const old = users.find(u => u.uid === uid);
          const updateData: any = { 
            status,
            role: status === "Approved" ? "User" : (old?.role || "Guest")
          };
          if (status === "Denied" && reason) {
            updateData.deactivationReason = reason;
            updateData.archiveReason = reason;
          }
          await updateDoc(doc(db, "users", uid), updateData);
          if (status === "Denied" && user?.username) {
            await setDoc(doc(db, "user_mappings", user.username.toLowerCase()), {
              username: user.username.toLowerCase(),
              email: user.email,
              status: "Denied",
              deactivationReason: reason
            }, { merge: true });
          }
          await logAudit("UPDATE", "UserStatus", uid, old, { status, deactivationReason: reason });
        } catch (err) {
          handleFirestoreError(err, OperationType.WRITE, `users/${uid}`);
        }
      }
    });
  };

  const pendingUsers = users.filter(u => u.status === "Pending");
  const activeUsers = users.filter(u => u.status === "Approved" || u.status === "Denied");

  return (
    <div className="space-y-6">
      <ConfirmDialog 
        isOpen={confirmDialog.isOpen}
        onClose={() => setConfirmDialog(prev => ({ ...prev, isOpen: false }))}
        onConfirm={confirmDialog.onConfirm}
        title={confirmDialog.title}
        message={confirmDialog.message}
        type={confirmDialog.type}
        showInput={confirmDialog.showInput}
        inputPlaceholder={confirmDialog.inputPlaceholder}
        inputLabel={confirmDialog.inputLabel}
        requiredInput={confirmDialog.requiredInput}
      />
      <div className="bg-slate-900/60 p-6 rounded-3xl border border-slate-800 backdrop-blur-sm flex flex-col xl:flex-row xl:items-center justify-between gap-6">
        <div>
          <div className="flex items-center gap-2 text-blue-400 text-xs font-bold uppercase tracking-widest mb-1">
            <Shield className="w-4 h-4" />
            <span>Administrative Controls</span>
          </div>
          <h1 className="text-2xl font-black text-white tracking-tight">System Authorization & Access</h1>
          <p className="text-xs text-slate-400 mt-1">
            Control administrative hierarchies, provision resident profiles, and manage system user access permissions.
          </p>
        </div>

        {/* Navigation Sub-Tabs Bar */}
        <div className="bg-slate-950/80 p-1.5 rounded-2xl border border-slate-800/80 flex flex-wrap items-center gap-1.5 shrink-0">
          <button 
            onClick={() => setActiveSubTab("active")}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${activeSubTab === "active" ? "bg-blue-600 text-white shadow-lg shadow-blue-600/20" : "text-slate-400 hover:text-white hover:bg-slate-800/50"}`}
          >
            Registered Users
          </button>
          <button 
            onClick={() => setActiveSubTab("pending")}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer whitespace-nowrap ${activeSubTab === "pending" ? "bg-blue-600 text-white shadow-lg shadow-blue-600/20" : "text-slate-400 hover:text-white hover:bg-slate-800/50"}`}
          >
            Pending Requests
            {pendingUsers.length > 0 && (
              <span className="w-4 h-4 bg-red-400 text-slate-950 text-[9px] font-black rounded-full flex items-center justify-center animate-pulse">
                {pendingUsers.length}
              </span>
            )}
          </button>
          <button 
            onClick={() => setActiveSubTab("staff")}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer whitespace-nowrap ${activeSubTab === "staff" ? "bg-blue-600 text-white shadow-lg shadow-blue-600/20" : "text-slate-400 hover:text-white hover:bg-slate-800/50"}`}
          >
            <UserPlus className="w-3.5 h-3.5" />
            Register Staff Account
          </button>
          <button 
            onClick={() => setActiveSubTab("provision")}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer whitespace-nowrap ${activeSubTab === "provision" ? "bg-blue-600 text-white shadow-lg shadow-blue-600/20" : "text-slate-400 hover:text-white hover:bg-slate-800/50"}`}
          >
            <Building2 className="w-3.5 h-3.5" />
            Provision Resident
          </button>
        </div>
      </div>

      {/* Database Backup & Export Utility Card */}
      <div className="p-6 bg-slate-900/40 rounded-2xl border border-slate-800/80 backdrop-blur-sm flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="space-y-1">
          <h3 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
            <Database className="w-4 h-4 text-blue-400" />
            <span>Database Backup & Export</span>
          </h3>
          <p className="text-slate-400 text-xs leading-relaxed max-w-xl">
            Allows administrators to fetch database records (properties, payments, delinquencies, audit logs, and user accounts) and export them instantly into downloadable CSV or full JSON backup files.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <button
            onClick={handleExportCSV}
            disabled={isExporting || isExportingJSON}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider bg-blue-600 hover:bg-blue-500 text-white font-sans transition-all disabled:opacity-50 disabled:cursor-not-allowed hover:shadow-lg hover:shadow-blue-500/10 active:scale-98 cursor-pointer border border-blue-500/30"
          >
            {isExporting ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Exporting CSV...</span>
              </>
            ) : (
              <>
                <Download className="w-3.5 h-3.5" />
                <span>Export CSV (Properties)</span>
              </>
            )}
          </button>
          <button
            onClick={handleExportJSON}
            disabled={isExporting || isExportingJSON}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider bg-slate-800 hover:bg-slate-700 text-emerald-400 font-sans transition-all disabled:opacity-50 disabled:cursor-not-allowed hover:shadow-lg hover:shadow-emerald-500/10 active:scale-98 cursor-pointer border border-emerald-500/30"
          >
            {isExportingJSON ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Exporting JSON...</span>
              </>
            ) : (
              <>
                <Download className="w-3.5 h-3.5" />
                <span>Export JSON (Full Backup)</span>
              </>
            )}
          </button>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {activeSubTab === "staff" ? (
          <motion.div 
            key="staff-registration-form"
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -15 }}
            transition={{ duration: 0.25 }}
            className="bg-slate-900/50 backdrop-blur-sm rounded-xl border border-slate-800 p-6 md:p-8 shadow-xl mt-6"
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-4 mb-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
                  <UserPlus className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white tracking-tight">Register Staff Account</h3>
                  <p className="text-slate-400 text-xs">Provision new staff accounts for encoders, revenue collectors, assessors, and municipal officers with authorized system access.</p>
                </div>
              </div>
              <button 
                onClick={() => setActiveSubTab("active")}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-bold transition-all cursor-pointer"
              >
                &larr; View All Users
              </button>
            </div>

            <form onSubmit={handleStaffRegisterSubmit} className="space-y-6">
              {staffError && (
                <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                  <div className="text-xs text-red-400 font-bold leading-relaxed">{staffError}</div>
                </div>
              )}

              {staffSuccess && (
                <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl flex items-start gap-3">
                  <Check className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                  <div className="text-xs text-emerald-300 font-medium whitespace-pre-wrap leading-relaxed">{staffSuccess}</div>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block">
                    Staff Full Name <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Maria Santos"
                    value={staffFullName}
                    onChange={(e) => setStaffFullName(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-blue-500 transition-colors"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block">
                    Work Email Address
                  </label>
                  <input
                    type="email"
                    placeholder="e.g. maria.santos@dipaculao.gov (or leave empty to auto-generate)"
                    value={staffEmail}
                    onChange={(e) => setStaffEmail(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-blue-500 transition-colors"
                  />
                  <p className="text-[10px] text-slate-500">If left empty, will auto-default to username@rpt.dipaculao.gov</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block">
                    Assigned Username <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. maria_santos"
                    value={staffUsername}
                    onChange={(e) => setStaffUsername(e.target.value.toLowerCase().replace(/\s+/g, ""))}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-white font-mono placeholder-slate-600 focus:outline-none focus:border-blue-500 transition-colors"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block">
                    Initial Access Password <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Must be at least 6 characters"
                    value={staffPassword}
                    onChange={(e) => setStaffPassword(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-white font-mono placeholder-slate-600 focus:outline-none focus:border-blue-500 transition-colors"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block">
                    Staff Office / Designation <span className="text-red-400">*</span>
                  </label>
                  <select
                    value={staffDesignation}
                    onChange={(e) => setStaffDesignation(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-white focus:outline-none focus:border-blue-500 transition-colors cursor-pointer"
                  >
                    <option value="Treasury Tax Encoder">Treasury Tax Encoder</option>
                    <option value="Revenue Collection Officer">Revenue Collection Officer</option>
                    <option value="Assessor Assessment Staff">Assessor Assessment Staff</option>
                    <option value="Real Property Examiner">Real Property Examiner</option>
                    <option value="Municipal Treasurer / Deputy">Municipal Treasurer / Deputy</option>
                    <option value="COA Resident Auditor">COA Resident Auditor</option>
                    <option value="IT & Records Administrator">IT & Records Administrator</option>
                    <option value="General Municipal Staff">General Municipal Staff</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block">
                    Clearance Level / Role <span className="text-red-400">*</span>
                  </label>
                  <select
                    value={staffRole}
                    onChange={(e) => setStaffRole(e.target.value as UserRole)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-white focus:outline-none focus:border-blue-500 transition-colors cursor-pointer"
                  >
                    <option value="User">Staff / Encoder (Standard Access)</option>
                    <option value="Admin">Administrator (Full System Access)</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block">
                    Account Access Status <span className="text-red-400">*</span>
                  </label>
                  <select
                    value={staffStatus}
                    onChange={(e) => setStaffStatus(e.target.value as "Approved" | "Pending")}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-white focus:outline-none focus:border-blue-500 transition-colors cursor-pointer"
                  >
                    <option value="Approved">Approved (Immediate Login Access)</option>
                    <option value="Pending">Pending Review</option>
                  </select>
                </div>
              </div>

              <div className="pt-4 flex items-center justify-end gap-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => {
                    setStaffFullName("");
                    setStaffEmail("");
                    setStaffUsername("");
                    setStaffError(null);
                    setStaffSuccess(null);
                  }}
                  className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold transition-all cursor-pointer"
                >
                  Reset Form
                </button>
                <button
                  type="submit"
                  disabled={staffLoading}
                  className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold uppercase tracking-wider transition-all disabled:opacity-50 flex items-center gap-2 cursor-pointer shadow-lg shadow-blue-600/20"
                >
                  {staffLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <UserPlus className="w-4 h-4" />
                  )}
                  <span>Register Staff Member</span>
                </button>
              </div>
            </form>
          </motion.div>
        ) : activeSubTab === "provision" ? (
          <motion.div 
            key="provision-form"
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -15 }}
            transition={{ duration: 0.25 }}
            className="bg-slate-900/50 backdrop-blur-sm rounded-xl border border-slate-800 p-6 md:p-8 shadow-xl mt-6"
          >
            <div className="flex items-center gap-3 border-b border-slate-800 pb-4 mb-6">
              <UserPlus className="w-5 h-5 text-blue-400" />
              <div>
                <h3 className="text-lg font-bold text-white tracking-tight">Provision Resident Access</h3>
                <p className="text-slate-400 text-xs">Directly provision high-security credentials for local land and property owners.</p>
              </div>
            </div>

            <form onSubmit={handleProvisionSubmit} className="space-y-6">
              {provError && (
                <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                  <div className="text-xs text-red-400 font-bold leading-relaxed">{provError}</div>
                </div>
              )}

              {provSuccess && (
                <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl flex items-start gap-3">
                  <Check className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                  <div className="text-xs text-emerald-300 font-medium whitespace-pre-wrap leading-relaxed">{provSuccess}</div>
                </div>
              )}

              {selectedProperty && existingResidentUser && (
                <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl space-y-3">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                    <div>
                      <h4 className="text-xs font-black text-amber-400 uppercase tracking-wider">Registered Resident Account Found</h4>
                      <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                        An existing resident account matches this name or username: <span className="font-bold text-white">"{existingResidentUser.displayName}"</span> (Username: <span className="font-mono text-white text-[11px]">@{existingResidentUser.username}</span>). Residents with multiple real properties should use a single, unified credential node.
                      </p>
                    </div>
                  </div>
                  <div className="pt-2 border-t border-amber-500/10 flex justify-end">
                    <button
                      type="button"
                      onClick={() => handleLinkPropertyToExisting(existingResidentUser)}
                      disabled={provLoading}
                      className="px-4 py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-slate-950 rounded-lg text-xs font-black uppercase tracking-wider transition-all flex items-center gap-2 cursor-pointer shadow-lg shadow-amber-500/20"
                    >
                      {provLoading ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          Linking...
                        </>
                      ) : (
                        <>
                          <UserPlus className="w-3.5 h-3.5" />
                          Link This Property to Existing Account Instead
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}

              {/* Step 1: Search Property Assessment */}
              <div className="space-y-2">
                <label className="text-xs font-black text-slate-400 uppercase tracking-wider block">1. Search & Select Real Property Declaration</label>
                <p className="text-xs text-slate-500 leading-relaxed">Type the property owner name, PIN, or TDN to query existing assessments linked to local taxpayer files.</p>
                
                <div className="relative">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Enter Owner Name, PIN, or Tax Declaration Number..."
                    className="w-full bg-slate-950 border border-slate-800 hover:border-slate-700 focus:border-blue-500 rounded-xl py-3 px-4 text-xs text-white placeholder-slate-600 outline-none transition-all"
                  />
                  
                  {searchQuery.trim().length > 0 && (
                    <div className="absolute left-0 right-0 mt-2 bg-slate-950 border border-slate-800 rounded-xl shadow-2xl py-2 z-50 divide-y divide-slate-900 overflow-hidden max-h-60 overflow-y-auto">
                      {properties.filter(p => 
                        !p.isArchived && (
                          p.tdNumber?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          p.pin?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          p.ownerName?.toLowerCase().includes(searchQuery.toLowerCase())
                        )
                      ).slice(0, 5).length === 0 ? (
                        <div className="px-4 py-3 text-xs text-slate-500 italic">No matching assessments found in registry matching "{searchQuery}"</div>
                      ) : (
                        properties.filter(p => 
                          !p.isArchived && (
                            p.tdNumber?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                            p.pin?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                            p.ownerName?.toLowerCase().includes(searchQuery.toLowerCase())
                          )
                        ).slice(0, 5).map(prop => (
                          <button
                            key={prop.id}
                            type="button"
                            onClick={() => handleSelectProperty(prop)}
                            className="w-full text-left px-4 py-3 hover:bg-blue-500/5 transition-all text-xs flex flex-col gap-1 cursor-pointer"
                          >
                            <div className="flex justify-between items-center">
                              <span className="font-bold text-white text-xs">{prop.ownerName}</span>
                              <span className="text-[10px] bg-slate-900 border border-slate-800 text-blue-400 font-bold px-1.5 py-0.5 rounded uppercase tracking-wider font-mono">TDN: {prop.tdNumber}</span>
                            </div>
                            <div className="text-[10px] text-slate-400 flex items-center justify-between font-mono">
                              <span>PIN: {prop.pin || "N/A"}</span>
                              <span>Assessed Val: ₱{prop.assessedValue?.toLocaleString()}</span>
                            </div>
                            <span className="text-[10px] text-slate-500 truncate">{prop.detailedLocation || `${prop.barangay}, Dipaculao`}</span>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>

                {selectedProperty && (
                  <div className="mt-3 p-4 bg-blue-500/5 border border-blue-500/20 rounded-xl space-y-3">
                    <div className="flex justify-between items-start">
                      <div>
                        <span className="text-[10px] text-blue-400 font-black uppercase tracking-wider block">Linked property context</span>
                        <h4 className="text-sm font-bold text-white mt-1">{selectedProperty.ownerName}</h4>
                        <p className="text-xs text-slate-400 mt-1">{selectedProperty.detailedLocation || `${selectedProperty.barangay}, Dipaculao`}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSelectedProperty(null)}
                        className="text-xs text-slate-500 hover:text-red-400 font-bold uppercase tracking-wider flex items-center gap-1 border border-slate-800 px-2 py-1 rounded-lg hover:border-red-500/20 bg-slate-950 transition-colors"
                      >
                        Clear
                      </button>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-4 text-[11px] font-mono border-t border-blue-500/10 pt-3 text-slate-400">
                      <div>
                        <span className="text-slate-500 block text-[9px] uppercase font-sans font-black tracking-widest">Tax Declaration No. (TDN)</span>
                        <span className="text-white font-bold">{selectedProperty.tdNumber}</span>
                      </div>
                      <div>
                        <span className="text-slate-500 block text-[9px] uppercase font-sans font-black tracking-widest">Property PIN</span>
                        <span className="text-white font-bold">{selectedProperty.pin || "N/A"}</span>
                      </div>
                      <div>
                        <span className="text-slate-500 block text-[9px] uppercase font-sans font-black tracking-widest">Assessed Valuation</span>
                        <span className="text-emerald-400 font-bold">₱{selectedProperty.assessedValue?.toLocaleString()}</span>
                      </div>
                      <div>
                        <span className="text-slate-500 block text-[9px] uppercase font-sans font-black tracking-widest">Property Class</span>
                        <span className="text-blue-300 font-bold">{selectedProperty.classification}</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Step 2: Account Details */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-slate-800/50">
                <div className="space-y-2">
                  <label className="text-xs font-black text-slate-400 uppercase tracking-wider block">2. Taxpayer Name</label>
                  <input
                    type="text"
                    disabled
                    value={selectedProperty ? selectedProperty.ownerName : ""}
                    placeholder="Auto-filled on selection"
                    className="w-full bg-slate-950/80 border border-slate-800 rounded-xl py-3 px-4 text-xs text-slate-400 outline-none select-none font-medium cursor-not-allowed opacity-80"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-black text-slate-400 uppercase tracking-wider block">3. Assigned Username</label>
                  <input
                    type="text"
                    value={provUsername}
                    onChange={(e) => setProvUsername(e.target.value)}
                    placeholder="Defaults to TDN"
                    className="w-full bg-slate-950 border border-slate-800 hover:border-slate-700 focus:border-blue-500 rounded-xl py-3 px-4 text-xs text-white placeholder-slate-600 outline-none transition-all font-mono"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-black text-slate-400 uppercase tracking-wider block">4. Temporary Password</label>
                  <input
                    type="text"
                    value={provPassword}
                    onChange={(e) => setProvPassword(e.target.value)}
                    placeholder="Minimum 6 characters"
                    className="w-full bg-slate-950 border border-slate-800 hover:border-slate-700 focus:border-blue-500 rounded-xl py-3 px-4 text-xs text-white placeholder-slate-600 outline-none transition-all font-mono"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-black text-slate-400 uppercase tracking-wider block">5. Access Portal Email (Optional)</label>
                  <input
                    type="email"
                    value={provEmail}
                    onChange={(e) => setProvEmail(e.target.value)}
                    placeholder="Leave empty for auto-generated portal mail"
                    className="w-full bg-slate-950 border border-slate-800 hover:border-slate-700 focus:border-blue-500 rounded-xl py-3 px-4 text-xs text-white placeholder-slate-600 outline-none transition-all font-mono"
                  />
                </div>
              </div>

              <div className="pt-4 border-t border-slate-800 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedProperty(null);
                    setProvUsername("");
                    setProvPassword("TempPass123!");
                    setProvEmail("");
                    setActiveSubTab("active");
                  }}
                  className="px-5 py-3 border border-slate-800 text-slate-400 hover:text-white rounded-xl text-xs font-bold uppercase tracking-wider hover:bg-slate-800/40 transition-all cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={provLoading || !selectedProperty}
                  className="px-6 py-3 bg-blue-500 hover:bg-blue-600 text-white disabled:opacity-50 disabled:cursor-not-allowed rounded-xl text-xs font-black uppercase tracking-wider shadow-lg shadow-blue-500/20 transition-all flex items-center justify-center gap-2 cursor-pointer"
                >
                  {provLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Provisioning Account...
                    </>
                  ) : (
                    <>
                      <UserPlus className="w-4 h-4" />
                      Authorize & Provision Resident Access
                    </>
                  )}
                </button>
              </div>
            </form>
          </motion.div>
        ) : (
          <motion.div 
            key="users-table"
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -15 }}
            transition={{ duration: 0.25 }}
            className="bg-slate-900/50 backdrop-blur-sm rounded-xl border border-slate-800 overflow-hidden shadow-xl mt-6 animate-fade-in"
          >
            {activeSubTab === "active" && (
              <div className="px-6 py-4 bg-slate-900/80 border-b border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div>
                  <h4 className="text-sm font-bold text-white tracking-tight flex items-center gap-2">
                    <Shield className="w-4 h-4 text-blue-400" />
                    <span>Active System Accounts ({activeUsers.length})</span>
                  </h4>
                  <p className="text-xs text-slate-400">Registered staff members, encoders, tax officers, residents, and administrators.</p>
                </div>
                <button
                  onClick={() => setActiveSubTab("staff")}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold uppercase tracking-wider transition-all flex items-center gap-2 shrink-0 cursor-pointer shadow-md shadow-blue-600/20"
                >
                  <UserPlus className="w-4 h-4" />
                  <span>+ Register Staff Account</span>
                </button>
              </div>
            )}
            <table className="w-full text-left border-collapse font-sans">
              <thead>
                <tr className="bg-slate-800/50 border-b border-slate-800">
                  <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-widest">Identity Node</th>
                  <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-widest text-center">Status</th>
                  <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-widest">Clearance Level</th>
                  <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-widest text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {(activeSubTab === "active" ? activeUsers : pendingUsers).map((user) => (
                  <tr key={user.uid} className="hover:bg-slate-800/10 group transition-all duration-300">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-2xl bg-slate-800 flex items-center justify-center text-blue-400 font-bold border border-slate-700/50 text-sm shadow-inner group-hover:border-blue-500/30 transition-colors shrink-0">
                          {user.displayName?.charAt(0) || <AlertCircle className="w-4 h-4 text-amber-500/50" />}
                        </div>
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-bold text-white text-sm tracking-tight">
                              {user.displayName || <span className="text-amber-500/50 italic text-[10px]">UNIDENTIFIED_IDENTITY</span>}
                            </p>
                            {user.designation && (
                              <span className="px-2 py-0.5 bg-blue-500/10 border border-blue-500/20 text-blue-300 text-[9px] font-bold rounded-md uppercase tracking-wider">
                                {user.designation}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-500 font-mono opacity-80 flex items-center gap-2 mt-0.5">
                            {user.username && <span className="text-slate-400 font-semibold">@{user.username}</span>}
                            {user.username && user.email && <span>&bull;</span>}
                            <span>{user.email || 'no_email_node@system.local'}</span>
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <span className={`px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-tighter border ${
                        user.status === 'Approved' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
                        user.status === 'Denied' ? 'bg-red-500/10 text-red-500 border-red-500/20' :
                        'bg-amber-500/10 text-amber-500 border-amber-500/20 animate-pulse'
                      }`}>
                        {user.status || 'LEGACY_STATUS'}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      {user.status === "Approved" ? (
                        <select 
                          className={`text-[10px] border border-slate-700 rounded-lg px-3 py-1.5 bg-slate-900 text-white font-bold uppercase tracking-widest outline-none focus:ring-1 focus:ring-blue-500/50 cursor-pointer ${user.role === 'Admin' ? 'text-red-400 border-red-500/20' : user.role === 'Guest' ? 'text-slate-400 border-slate-500/20' : 'text-blue-400 border-blue-500/20'}`}
                          value={user.role || 'User'}
                          onChange={(e) => updateRole(user.uid, e.target.value as UserRole)}
                        >
                          <option value="User">Staff</option>
                          {user.role === 'Admin' && <option value="Admin">Admin</option>}
                          <option value="Resident">Resident</option>
                          <option value="Taxpayer">Taxpayer (Legacy)</option>
                          <option value="Guest">Guest</option>
                          <option value="End-User" className="hidden">End-User</option>
                        </select>
                      ) : (
                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
                          <Shield className="w-3 h-3 opacity-50" />
                          {user.status === 'Denied' ? 'ACCESS_REVOKED' : 'LOCKED_CLEARANCE'}
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      {user.status === "Pending" ? (
                        <div className="table-actions">
                            <button 
                              onClick={() => handleApproval(user.uid, "Denied")}
                              className="btn-action-destructive"
                              title="Reject Request"
                            >
                              <X className="w-4 h-4" /> Reject
                            </button>
                            <button 
                              onClick={() => handleApproval(user.uid, "Approved")}
                              className="btn-action-positive"
                              title="Approve Member"
                            >
                              <Check className="w-4 h-4" /> Approve
                            </button>
                        </div>
                      ) : (
                        <div className="table-actions">
                          <span className="text-[9px] text-slate-500 font-mono italic opacity-50 hidden md:inline">
                            {toISODateSafe(user.createdAt)}
                          </span>
                          {user.email !== profile?.email && user.uid && (
                            <>
                              <motion.button
                                whileHover={{ scale: 1.02 }}
                                whileTap={{ scale: 0.98 }}
                                onClick={() => {
                                  const identifier = user.displayName || user.email || user.username || user.uid || "Unknown Identity";
                                  setConfirmDialog({
                                    isOpen: true,
                                    title: "Archive / Remove Account Identity?",
                                    message: `You are about to deactivate and archive account "${identifier}".\n\nState official remarks or reason. This reason will be displayed to the resident/user when they attempt to log in.`,
                                    type: "danger",
                                    showInput: true,
                                    requiredInput: true,
                                    inputPlaceholder: "e.g., Account archived because property 22-09-001-00054 was permanently archived due to land re-assessment.",
                                    inputLabel: "Remarks / Reason for Account Deletion (Required):",
                                    onConfirm: async (reason?: string) => {
                                      const finalReason = reason || "Account deactivated and archived by Municipal Administrator";
                                      try {
                                        const userRef = doc(db, "users", user.uid);
                                        await setDoc(userRef, {
                                          ...user,
                                          status: "Archived",
                                          deactivationReason: finalReason,
                                          archiveReason: finalReason,
                                          archivedBy: profile?.displayName || profile?.email || "Admin",
                                          archivedAt: new Date().toISOString()
                                        }, { merge: true });

                                        // Save mappings & archived_accounts for lookup
                                        if (user.username) {
                                          await setDoc(doc(db, "user_mappings", user.username.toLowerCase()), {
                                            username: user.username.toLowerCase(),
                                            email: user.email,
                                            status: "Archived",
                                            deactivationReason: finalReason,
                                            archiveReason: finalReason
                                          }, { merge: true });
                                        }
                                        if (user.email) {
                                          await setDoc(doc(db, "user_mappings", user.email.toLowerCase()), {
                                            username: user.username?.toLowerCase() || "",
                                            email: user.email.toLowerCase(),
                                            status: "Archived",
                                            deactivationReason: finalReason,
                                            archiveReason: finalReason
                                          }, { merge: true });
                                        }

                                        await setDoc(doc(db, "archived_accounts", user.uid), {
                                          ...user,
                                          status: "Archived",
                                          deactivationReason: finalReason,
                                          archivedBy: profile?.displayName || profile?.email || "Admin",
                                          archivedAt: new Date().toISOString()
                                        });

                                        try {
                                          await supabase.from("users").update({
                                            status: "Archived",
                                            deactivationReason: finalReason,
                                            archiveReason: finalReason
                                          }).eq("uid", user.uid);
                                        } catch (sbErr) {
                                          console.warn("Supabase profile archive sync warning:", sbErr);
                                        }

                                        await logAudit("DELETE", "USER_DELETE", user.uid, { 
                                          email: user.email || 'SYSTEM_USER', 
                                          role: user.role || 'USER_ROLE',
                                          displayName: user.displayName || 'UNKNOWN_USER',
                                          deactivationReason: finalReason
                                        });
                                      } catch (err: any) {
                                        console.error("Delete Failed:", err);
                                        handleFirestoreError(err, OperationType.DELETE, `users/${user.uid}`);
                                      }
                                    }
                                  });
                                }}
                                className="btn-action-destructive group/btn"
                              >
                                <X className="w-3 h-3 group-hover/btn:rotate-90 transition-transform" />
                                Remove
                              </motion.button>
                            </>
                          )}
                          {user.email === profile?.email && (
                             <span className="px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider text-slate-600 border border-slate-800 bg-slate-900/50">
                               Self (Admin)
                             </span>
                          )}
                          {user.status === "Denied" && user.email !== profile?.email && (
                            <button 
                              onClick={() => handleApproval(user.uid, "Approved")}
                              className="btn-action-positive"
                            >
                              Re-Approve
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
                {activeSubTab === "pending" && pendingUsers.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-6 py-12 text-center">
                      <div className="flex flex-col items-center gap-3 grayscale opacity-30">
                        <Shield className="w-8 h-8 text-slate-400" />
                        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest font-mono">No pending entry requests</p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
};

export default Settings;
