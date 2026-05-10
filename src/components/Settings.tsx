import React, { useEffect, useState } from "react";
import { 
  collection, 
  onSnapshot, 
  updateDoc, 
  deleteDoc,
  doc,
  db,
  handleFirestoreError,
  OperationType 
} from "../lib/firebase";
import { UserProfile, UserRole } from "../types";
import { Shield, User, Check, X, Lock, Save, Loader2, AlertCircle } from "lucide-react";
import { logAudit } from "../lib/audit";
import ConfirmDialog from "./ConfirmDialog";
import { useAuth } from "../AuthContext";
import { motion, AnimatePresence } from "motion/react";
import { toISODateSafe } from "../lib/utils";

const Settings: React.FC = () => {
  const { profile, updateUserName, updateUserUsername, updateUserPassword } = useAuth();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [activeSubTab, setActiveSubTab] = useState<"active" | "pending">("active");
  
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
        ? `You are about to VALIDATE ${user?.displayName} for system use. \n\nThey will be granted END-USER privileges by default. Proceed?`
        : `You are about to DENY ${user?.displayName}'s request to join the system. \n\nThis action will prevent them from accessing any data nodes.`,
      type: status === "Approved" ? "success" : "danger",
      onConfirm: async () => {
        try {
          const old = users.find(u => u.uid === uid);
          await updateDoc(doc(db, "users", uid), { 
            status,
            role: "End-User" // Default role upon approval
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
              <span className="w-4 h-4 bg-red-500 text-white text-[8px] rounded-full flex items-center justify-center animate-pulse">
                {pendingUsers.length}
              </span>
            )}
          </button>

        </div>
      </div>

      <div className="bg-slate-900/50 backdrop-blur-sm rounded-xl border border-slate-800 overflow-hidden shadow-xl mt-6">
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
                          className={`text-[10px] border border-slate-700 rounded-lg px-3 py-1.5 bg-slate-900 text-white font-bold uppercase tracking-widest outline-none focus:ring-1 focus:ring-indigo-500/50 cursor-pointer ${user.role === 'Admin' ? 'text-red-400 border-red-500/20' : 'text-indigo-400 border-indigo-500/20'}`}
                          value={user.role || 'End-User'}
                          onChange={(e) => updateRole(user.uid, e.target.value as UserRole)}
                        >
                          <option value="End-User">End-User</option>
                          <option value="Admin">Admin</option>
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
                                onClick={() => updateRole(user.uid, user.role === 'Admin' ? 'End-User' : 'Admin')}
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
      </div>
    </div>
  );
};

export default Settings;
