import React, { useState } from "react";
import { auth, signInWithPopup, googleProvider } from "../lib/firebase";
import { useAuth } from "../AuthContext";
import { Lock, X, Mail } from "lucide-react";

interface AdminAuthDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

export default function AdminAuthDialog({ isOpen, onClose, onConfirm }: AdminAuthDialogProps) {
  const { signInWithEmail } = useAuth();
  const [emailOrUsername, setEmailOrUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleGoogleReAuth = async () => {
    setError("");
    setLoading(true);
    try {
      // Re-authenticate using Google
      await signInWithPopup(auth, googleProvider);
      
      // Check if the current user is an admin
      const isAdmin = auth.currentUser?.email === "marzanleonardojrc@gmail.com" || auth.currentUser?.email === "marzan.leonardo04@gmail.com";
      if (!isAdmin) {
        throw new Error("Insufficient permissions. You are not an administrator.");
      }

      await onConfirm();
      onClose();
    } catch (err: any) {
      setError(err.message || "Google authentication failed.");
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      // Re-authenticate using the provided credentials
      await signInWithEmail(emailOrUsername, password);
      
      // If successful, run the confirm action
      await onConfirm();
      
      // Clear and close
      setEmailOrUsername("");
      setPassword("");
      onClose();
    } catch (err: any) {
      console.error("Admin verification error:", err);
      const errorCode = err.code || "";
      const errorMsg = err.message || "";

      if (
        errorCode === 'auth/invalid-credential' || 
        errorCode === 'auth/wrong-password' || 
        errorCode === 'auth/user-not-found' || 
        errorMsg.includes('invalid-credential') ||
        errorMsg.includes('wrong-password') ||
        errorMsg.includes('user-not-found')
      ) {
        setError("Invalid email/username or password. If you signed in with Google, please use the button below.");
      } else {
        setError(errorMsg || "Authentication failed. Please check credentials.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
      <div className="bg-slate-900 border border-slate-700/50 rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl relative">
        <div className="p-4 border-b border-slate-800 bg-red-500/10 flex items-center justify-between">
          <div className="flex flex-row items-center gap-3">
            <Lock className="w-5 h-5 text-red-500" />
            <h3 className="font-bold text-red-500 tracking-tight">Admin Authorization Required</h3>
          </div>
          <button onClick={onClose} className="p-2 -mr-2 text-slate-500 hover:text-slate-300 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <p className="text-sm text-slate-400 mb-4">
            Security policy requires re-authentication to perform this destructive action. Please enter your administrator credentials.
          </p>

          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">Email or Username</label>
            <input 
              type="text" 
              required
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-red-500"
              value={emailOrUsername}
              onChange={e => setEmailOrUsername(e.target.value)}
              placeholder="Admin email or username"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">Password</label>
            <input 
              type="password" 
              required
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-red-500"
              value={password}
              onChange={e => setPassword(e.target.value)}
            />
          </div>

          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-xs text-red-400 font-bold">
              {error.replace('Firebase: ', '')}
            </div>
          )}


          <div className="flex flex-col gap-2 mt-6">
            <button
              type="submit"
              className="w-full px-4 py-3 bg-red-600 text-white rounded-xl font-bold hover:bg-red-500 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              disabled={loading}
            >
              {loading ? "Verifying..." : "Confirm with Password"}
            </button>
            <div className="flex items-center gap-2 py-2">
              <div className="flex-1 h-px bg-slate-800" />
              <span className="text-[10px] font-bold text-slate-600 uppercase tracking-widest">OR</span>
              <div className="flex-1 h-px bg-slate-800" />
            </div>
            <button
              type="button"
              onClick={handleGoogleReAuth}
              className="w-full px-4 py-3 bg-slate-950 border border-slate-800 text-slate-300 rounded-xl font-bold hover:bg-slate-900 transition disabled:opacity-50 flex items-center justify-center gap-2"
              disabled={loading}
            >
              <Mail className="w-4 h-4 text-blue-400" />
              Verify with Google Account
            </button>
            <button
              type="button"
              onClick={onClose}
              className="w-full px-4 py-2 mt-2 text-slate-500 hover:text-slate-300 text-xs font-bold transition"
              disabled={loading}
            >
              Cancel Operation
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
