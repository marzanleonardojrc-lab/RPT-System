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
  getDocs
} from "../lib/firebase";
import { UserProfile, UserRole, Property } from "../types";
import { initializeApp, getApps } from "firebase/app";
import { getAuth as getSecondaryAuth, createUserWithEmailAndPassword as createSecondaryUserWithEmail } from "firebase/auth";
import firebaseConfig from "../../firebase-applet-config.json";
import { Shield, User, Check, X, Lock, Save, Loader2, AlertCircle, UserPlus, Eye, EyeOff, Sun, Moon } from "lucide-react";
import { logAudit } from "../lib/audit";
import ConfirmDialog from "./ConfirmDialog";
import { useAuth } from "../AuthContext";
import { motion, AnimatePresence } from "motion/react";
import { toISODateSafe } from "../lib/utils";

const Settings: React.FC = () => {
  const { profile, updateUserName, updateUserUsername, updateUserPassword } = useAuth();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [activeSubTab, setActiveSubTab] = useState<"active" | "pending" | "provision">("active");
  
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
  };
  
  // Remove security form from settings
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    type?: "danger" | "warning" | "info" | "success";
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
    let secondaryApp;
    const existingApps = getApps();
    const secondaryName = "secondaryAppProvision";
    secondaryApp = existingApps.find(app => app.name === secondaryName);
    if (!secondaryApp) {
      secondaryApp = initializeApp(firebaseConfig, secondaryName);
    }
    const secondaryAuth = getSecondaryAuth(secondaryApp);
    const userCredential = await createSecondaryUserWithEmail(secondaryAuth, email, pass);
    await secondaryAuth.signOut();
    return userCredential.user.uid;
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
        : `You are about to DENY ${user?.displayName}'s request to join the system. \n\nThis action will prevent them from accessing any data nodes.`,
      type: status === "Approved" ? "success" : "danger",
      onConfirm: async () => {
        try {
          const old = users.find(u => u.uid === uid);
          await updateDoc(doc(db, "users", uid), { 
            status,
            role: "User" // Default role upon approval
          });
          await logAudit("UPDATE", "UserStatus", uid, old, { status });
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
      />
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-2xl font-bold text-white tracking-tight">System Authorization</h2>
          <p className="text-slate-400 text-sm">Control administrative hierarchies and approve new user entry requests.</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex bg-slate-900 border border-slate-800 p-1 rounded-xl">
            <button 
              onClick={() => setActiveSubTab("active")}
              className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${activeSubTab === "active" ? "bg-indigo-500 text-white shadow-lg shadow-indigo-500/20" : "text-slate-400 hover:text-white"}`}
            >
              Registered Users
            </button>
            <button 
              onClick={() => setActiveSubTab("pending")}
              className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-2 ${activeSubTab === "pending" ? "bg-indigo-500 text-white shadow-lg shadow-indigo-500/20" : "text-slate-400 hover:text-white"}`}
            >
              Pending Requests
              {pendingUsers.length > 0 && (
                <span className="w-4 h-4 bg-red-400 text-slate-950 text-[8px] font-black rounded-full flex items-center justify-center animate-pulse">
                  {pendingUsers.length}
                </span>
              )}
            </button>
            <button 
              onClick={() => setActiveSubTab("provision")}
              className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-2 ${activeSubTab === "provision" ? "bg-indigo-500 text-white shadow-lg shadow-indigo-500/20" : "text-slate-400 hover:text-white"}`}
            >
              <UserPlus className="w-3.5 h-3.5" />
              Provision Resident
            </button>
          </div>
        </div>
      </div>

      {/* Accessibility & Visual Themes Card */}
      <div className="p-6 bg-slate-900/40 rounded-2xl border border-slate-800/80 backdrop-blur-sm flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="space-y-1">
          <h3 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
            <Sun className="w-4 h-4 text-amber-500" />
            <span>Accessibility & Visual Themes</span>
          </h3>
          <p className="text-slate-400 text-xs leading-relaxed max-w-xl">
            Allows administrators to toggle between the default dark mode and a high-contrast light mode for better screen clarity and readability during bright daylight office hours.
          </p>
        </div>
        <div className="flex items-center gap-2 bg-slate-950 p-1 rounded-xl border border-slate-800 shrink-0 w-fit">
          <button
            onClick={() => handleThemeChange("dark")}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-bold transition-all ${
              theme === "dark" 
                ? "bg-slate-800 text-indigo-400 border border-slate-700 shadow-md" 
                : "text-slate-500 hover:text-slate-300"
            }`}
          >
            <Moon className="w-3.5 h-3.5 text-indigo-400" />
            <span>Default Dark</span>
          </button>
          <button
            onClick={() => handleThemeChange("light")}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-bold transition-all ${
              theme === "light" 
                ? "bg-amber-500/10 text-amber-500 border border-amber-500/20 shadow-md" 
                : "text-slate-500 hover:text-slate-300"
            }`}
          >
            <Sun className="w-3.5 h-3.5 text-amber-500" />
            <span>High Contrast Light</span>
          </button>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {activeSubTab === "provision" ? (
          <motion.div 
            key="provision-form"
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -15 }}
            transition={{ duration: 0.25 }}
            className="bg-slate-900/50 backdrop-blur-sm rounded-xl border border-slate-800 p-6 md:p-8 shadow-xl mt-6 max-w-4xl mx-auto"
          >
            <div className="flex items-center gap-3 border-b border-slate-800 pb-4 mb-6">
              <UserPlus className="w-5 h-5 text-indigo-400" />
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
                    className="w-full bg-slate-950 border border-slate-800 hover:border-slate-700 focus:border-indigo-500 rounded-xl py-3 px-4 text-xs text-white placeholder-slate-600 outline-none transition-all"
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
                            className="w-full text-left px-4 py-3 hover:bg-indigo-500/5 transition-all text-xs flex flex-col gap-1 cursor-pointer"
                          >
                            <div className="flex justify-between items-center">
                              <span className="font-bold text-white text-xs">{prop.ownerName}</span>
                              <span className="text-[10px] bg-slate-900 border border-slate-800 text-indigo-400 font-bold px-1.5 py-0.5 rounded uppercase tracking-wider font-mono">TDN: {prop.tdNumber}</span>
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
                  <div className="mt-3 p-4 bg-indigo-500/5 border border-indigo-500/20 rounded-xl space-y-3">
                    <div className="flex justify-between items-start">
                      <div>
                        <span className="text-[10px] text-indigo-400 font-black uppercase tracking-wider block">Linked property context</span>
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
                    
                    <div className="grid grid-cols-2 gap-4 text-[11px] font-mono border-t border-indigo-500/10 pt-3 text-slate-400">
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
                        <span className="text-indigo-300 font-bold">{selectedProperty.classification}</span>
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
                    className="w-full bg-slate-950 border border-slate-800 hover:border-slate-700 focus:border-indigo-500 rounded-xl py-3 px-4 text-xs text-white placeholder-slate-600 outline-none transition-all font-mono"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-black text-slate-400 uppercase tracking-wider block">4. Temporary Password</label>
                  <input
                    type="text"
                    value={provPassword}
                    onChange={(e) => setProvPassword(e.target.value)}
                    placeholder="Minimum 6 characters"
                    className="w-full bg-slate-950 border border-slate-800 hover:border-slate-700 focus:border-indigo-500 rounded-xl py-3 px-4 text-xs text-white placeholder-slate-600 outline-none transition-all font-mono"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-black text-slate-400 uppercase tracking-wider block">5. Access Portal Email (Optional)</label>
                  <input
                    type="email"
                    value={provEmail}
                    onChange={(e) => setProvEmail(e.target.value)}
                    placeholder="Leave empty for auto-generated portal mail"
                    className="w-full bg-slate-950 border border-slate-800 hover:border-slate-700 focus:border-indigo-500 rounded-xl py-3 px-4 text-xs text-white placeholder-slate-600 outline-none transition-all font-mono"
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
                  className="px-6 py-3 bg-indigo-500 hover:bg-indigo-600 text-white disabled:opacity-50 disabled:cursor-not-allowed rounded-xl text-xs font-black uppercase tracking-wider shadow-lg shadow-indigo-500/20 transition-all flex items-center justify-center gap-2 cursor-pointer"
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
                        <div className="w-10 h-10 rounded-2xl bg-slate-800 flex items-center justify-center text-indigo-400 font-bold border border-slate-700/50 text-sm shadow-inner group-hover:border-indigo-500/30 transition-colors">
                          {user.displayName?.charAt(0) || <AlertCircle className="w-4 h-4 text-amber-500/50" />}
                        </div>
                        <div>
                          <p className="font-bold text-white text-sm tracking-tight">
                            {user.displayName || <span className="text-amber-500/50 italic text-[10px]">UNIDENTIFIED_IDENTITY</span>}
                          </p>
                          <p className="text-xs text-slate-500 font-mono opacity-80">
                            {user.email || <span className="text-slate-600 italic">no_email_node@system.local</span>}
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
                          className={`text-[10px] border border-slate-700 rounded-lg px-3 py-1.5 bg-slate-900 text-white font-bold uppercase tracking-widest outline-none focus:ring-1 focus:ring-indigo-500/50 cursor-pointer ${user.role === 'Admin' ? 'text-red-400 border-red-500/20' : user.role === 'Guest' ? 'text-slate-400 border-slate-500/20' : 'text-indigo-400 border-indigo-500/20'}`}
                          value={user.role || 'User'}
                          onChange={(e) => updateRole(user.uid, e.target.value as UserRole)}
                        >
                          <option value="User">Staff</option>
                          <option value="Admin">Admin</option>
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
                        <div className="flex justify-end gap-2">
                            <button 
                              onClick={() => handleApproval(user.uid, "Denied")}
                              className="p-2 text-slate-500 hover:text-red-500 hover:bg-red-500/10 rounded-xl transition-all"
                              title="Reject Request"
                            >
                              <X className="w-5 h-5" />
                            </button>
                            <button 
                              onClick={() => handleApproval(user.uid, "Approved")}
                              className="p-2 text-slate-500 hover:text-emerald-500 hover:bg-emerald-500/10 rounded-xl transition-all border border-transparent hover:border-emerald-500/30"
                              title="Approve Member"
                            >
                              <Check className="w-5 h-5" />
                            </button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-end gap-3">
                          <span className="text-[9px] text-slate-500 font-mono italic opacity-50 hidden md:inline">
                            {toISODateSafe(user.createdAt)}
                          </span>
                          {user.email !== profile?.email && user.uid && (
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => updateRole(user.uid, user.role === 'Admin' ? 'User' : 'Admin')}
                                className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all border ${
                                  user.role === 'Admin' 
                                    ? 'bg-red-500/10 text-red-500 border-red-500/20 hover:bg-red-500/20' 
                                    : 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20 hover:bg-indigo-500/20'
                                }`}
                              >
                                {user.role === 'Admin' ? 'Revoke Admin' : 'Grant Admin'}
                              </button>
                              
                              <motion.button
                                whileHover={{ scale: 1.02 }}
                                whileTap={{ scale: 0.98 }}
                                onClick={() => {
                                  const identifier = user.displayName || user.email || user.uid || "Unknown Identity";
                                  setConfirmDialog({
                                    isOpen: true,
                                    title: "Are you sure you want to permanently remove this user?",
                                    message: `You are about to permanently remove ${identifier} from the system. This action is irreversible and will revoke all access instantly.`,
                                    type: "danger",
                                    onConfirm: async () => {
                                      try {
                                        const userRef = doc(db, "users", user.uid);
                                        await deleteDoc(userRef);
                                        await logAudit("DELETE", "USER_DELETE", user.uid, { 
                                          email: user.email || 'SYSTEM_USER', 
                                          role: user.role || 'USER_ROLE',
                                          displayName: user.displayName || 'UNKNOWN_USER'
                                        });
                                      } catch (err: any) {
                                        console.error("Delete Failed:", err);
                                        handleFirestoreError(err, OperationType.DELETE, `users/${user.uid}`);
                                      }
                                    }
                                  });
                                }}
                                className="px-3 py-1.5 bg-rose-500/10 text-rose-500 border border-rose-500/20 rounded-lg text-[10px] font-black uppercase tracking-wider hover:bg-rose-500/20 group/btn transition-all font-sans flex items-center gap-2"
                              >
                                <X className="w-3 h-3 group-hover/btn:rotate-90 transition-transform" />
                                Remove
                              </motion.button>
                            </div>
                          )}
                          {user.email === profile?.email && (
                             <span className="px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider text-slate-600 border border-slate-800 bg-slate-900/50">
                               Self (Admin)
                             </span>
                          )}
                          {user.status === "Denied" && user.email !== profile?.email && (
                            <button 
                              onClick={() => handleApproval(user.uid, "Approved")}
                              className="px-3 py-1.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-lg text-[10px] font-black uppercase tracking-wider hover:bg-emerald-500/20 transition-all"
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
