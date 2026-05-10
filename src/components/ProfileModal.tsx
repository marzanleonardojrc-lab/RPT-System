import React, { useState } from "react";
import { User, Lock, Save, Loader2, AlertCircle, X, Shield, Check } from "lucide-react";
import { useAuth } from "../AuthContext";
import ConfirmDialog from "./ConfirmDialog";

interface ProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const ProfileModal: React.FC<ProfileModalProps> = ({ isOpen, onClose }) => {
  const { profile, updateUserName, updateUserUsername, updateUserPassword } = useAuth();
  
  const [securityForm, setSecurityForm] = useState({
    name: profile?.displayName || "",
    username: profile?.username || "",
    newPassword: "",
    confirmPassword: ""
  });
  
  const [isUpdating, setIsUpdating] = useState(false);
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [securityError, setSecurityError] = useState<string | null>(null);
  const [securitySuccess, setSecuritySuccess] = useState<string | null>(null);
  
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

  if (!isOpen) return null;

  const performSecurityUpdate = async () => {
    setIsUpdating(true);
    setSecurityError(null);
    setSecuritySuccess(null);

    try {
      if (securityForm.name !== profile?.displayName) {
        try {
          await updateUserName(securityForm.name);
        } catch (err: any) {
          throw new Error(`Profile Name Error: ${err.message}`);
        }
      }

      if (securityForm.username !== profile?.username) {
        try {
          await updateUserUsername(securityForm.username);
        } catch (err: any) {
          throw new Error(`Username Error: ${err.message}`);
        }
      }

      if (securityForm.newPassword) {
        if (securityForm.newPassword !== securityForm.confirmPassword) {
          throw new Error("Passwords do not match.");
        }
        if (securityForm.newPassword.length < 6) {
          throw new Error("Password must be at least 6 characters.");
        }
        await updateUserPassword(securityForm.newPassword);
        setSecurityForm(p => ({ ...p, newPassword: "", confirmPassword: "" }));
      }

      setSecuritySuccess("Account security updated successfully.");
      setIsEditingProfile(false);
      setTimeout(() => setSecuritySuccess(null), 3000);
    } catch (err: any) {
      setSecurityError(err.message || "Failed to update security credentials.");
    } finally {
      setIsUpdating(false);
    }
  };

  const handleSecurityUpdate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isEditingProfile) {
      setConfirmDialog({
        isOpen: true,
        title: "Edit Profile?",
        message: "Are you sure you want to enable profile editing?",
        type: "info",
        onConfirm: () => {
          setIsEditingProfile(true);
          setConfirmDialog(p => ({ ...p, isOpen: false }));
        }
      });
      return;
    }

    setConfirmDialog({
      isOpen: true,
      title: "Save Profile?",
      message: "Are you sure you want to save these profile changes?",
      type: "warning",
      onConfirm: async () => {
        setConfirmDialog(p => ({ ...p, isOpen: false }));
        await performSecurityUpdate();
      }
    });
  };

  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <ConfirmDialog 
        isOpen={confirmDialog.isOpen}
        onClose={() => setConfirmDialog(prev => ({ ...prev, isOpen: false }))}
        onConfirm={confirmDialog.onConfirm}
        title={confirmDialog.title}
        message={confirmDialog.message}
        type={confirmDialog.type}
      />
      <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-2xl overflow-hidden shadow-2xl relative">
        <button 
          onClick={onClose}
          className="absolute right-4 top-4 text-slate-500 hover:text-white transition-colors z-20 bg-slate-800 p-2 rounded-full hover:bg-slate-700"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="absolute top-0 right-0 p-6 opacity-5 pointer-events-none">
           <Shield className="w-48 h-48" />
        </div>
        
        <div className="p-8 relative z-10">
          <h3 className="text-2xl font-bold text-white mb-2">Update Profile</h3>
          <p className="text-sm text-slate-400 mb-8">Synchronize your profile details and update access credentials.</p>

          {securityError && (
            <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-red-200 leading-relaxed font-mono">{securityError}</p>
            </div>
          )}
          {securitySuccess && (
            <div className="mb-6 p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl flex items-center gap-3">
              <div className="w-5 h-5 bg-emerald-500 rounded-full flex items-center justify-center flex-shrink-0">
                <Check className="w-3 h-3 text-white" />
              </div>
              <p className="text-sm font-bold text-emerald-400">{securitySuccess}</p>
            </div>
          )}

          <form onSubmit={handleSecurityUpdate} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest ml-1">Profile Name</label>
                <div className="relative">
                  <User className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <input 
                    className={`w-full bg-slate-950 border border-slate-800 rounded-2xl py-4 pl-12 pr-4 text-sm text-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all outline-none ${!isEditingProfile ? "opacity-60 cursor-not-allowed" : ""}`}
                    value={securityForm.name}
                    onChange={e => setSecurityForm(p => ({ ...p, name: e.target.value }))}
                    readOnly={!isEditingProfile}
                  />
                </div>
              </div>
              
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest ml-1">Username</label>
                <div className="relative">
                  <User className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <input 
                    className={`w-full bg-slate-950 border border-slate-800 rounded-2xl py-4 pl-12 pr-4 text-sm text-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all outline-none ${!isEditingProfile ? "opacity-60 cursor-not-allowed" : ""}`}
                    value={securityForm.username}
                    onChange={e => setSecurityForm(p => ({ ...p, username: e.target.value.replace(/\s+/g, '').toLowerCase() }))}
                    placeholder="Add a username"
                    readOnly={!isEditingProfile}
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest ml-1">New Password</label>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <input 
                    type="password"
                    placeholder="Keep current"
                    className={`w-full bg-slate-950 border border-slate-800 rounded-2xl py-4 pl-12 pr-4 text-sm text-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all outline-none placeholder:text-slate-800 font-mono ${!isEditingProfile ? "opacity-60 cursor-not-allowed" : ""}`}
                    value={securityForm.newPassword}
                    onChange={e => setSecurityForm(p => ({ ...p, newPassword: e.target.value }))}
                    readOnly={!isEditingProfile}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest ml-1">Confirm Password</label>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <input 
                    type="password"
                    placeholder="••••••••"
                    className={`w-full bg-slate-950 border border-slate-800 rounded-2xl py-4 pl-12 pr-4 text-sm text-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all outline-none placeholder:text-slate-800 font-mono ${!isEditingProfile ? "opacity-60 cursor-not-allowed" : ""}`}
                    value={securityForm.confirmPassword}
                    onChange={e => setSecurityForm(p => ({ ...p, confirmPassword: e.target.value }))}
                    readOnly={!isEditingProfile}
                  />
                </div>
              </div>
            </div>

            <button 
              type="submit"
              disabled={isUpdating}
              className={`w-full py-4 rounded-2xl text-sm font-bold transition-all shadow-lg flex items-center justify-center gap-2 ${
                isEditingProfile 
                  ? "bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-500/25" 
                  : "bg-white text-slate-900 hover:bg-slate-100"
              }`}
            >
              {isUpdating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Updating...
                </>
              ) : isEditingProfile ? (
                <>
                  <Save className="w-4 h-4" />
                  Save Changes
                </>
              ) : (
                <>
                  <User className="w-4 h-4" />
                  Edit Profile
                </>
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default ProfileModal;
