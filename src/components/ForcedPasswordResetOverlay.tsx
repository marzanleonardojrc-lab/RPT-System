import React, { useState } from "react";
import { useAuth } from "../AuthContext";
import { doc, updateDoc, db } from "../lib/firebase";
import { Lock, Eye, EyeOff, Loader2, ShieldCheck, AlertCircle } from "lucide-react";
import { motion } from "motion/react";

interface ForcedPasswordResetOverlayProps {
  profile: any;
  logout: () => Promise<void>;
}

const ForcedPasswordResetOverlay: React.FC<ForcedPasswordResetOverlayProps> = ({ profile, logout }) => {
  const { updateUserPassword } = useAuth();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < 6) {
      setError("Password must be at least 6 characters long.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match. Please try again.");
      return;
    }

    setLoading(true);
    try {
      // 1. Update password in Firebase Auth via client-side Auth Context
      await updateUserPassword(password);

      // 2. Set requiresPasswordReset to false in Firestore
      await updateDoc(doc(db, "users", profile.uid), {
        requiresPasswordReset: false,
        updatedAt: new Date().toISOString()
      });

      setSuccess(true);
      // Let the change persist, causing immediate component reload on state propagation
      setTimeout(() => {
        window.location.reload();
      }, 1500);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to update security credentials. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0B1528] flex items-center justify-center p-4 md:p-8 relative selection:bg-blue-500/30">
      <div className="absolute -top-40 -left-40 w-96 h-96 bg-blue-500/10 blur-[120px] rounded-full" />
      <div className="absolute -bottom-40 -right-40 w-96 h-96 bg-cyan-500/10 blur-[120px] rounded-full" />

      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-lg bg-slate-900/60 backdrop-blur-xl border border-white/10 rounded-[2.5rem] p-8 md:p-12 shadow-[0_8px_32px_0_rgba(0,0,0,0.5)] z-10"
      >
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-blue-500/10 border border-blue-500/20 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <ShieldCheck className="w-8 h-8 text-blue-400" />
          </div>
          <h1 className="text-2xl font-black text-white tracking-tight">First-Time Setup required</h1>
          <p className="text-slate-400 text-xs mt-2 leading-relaxed">
            Welcome, <span className="text-white font-bold">{profile.displayName}</span>. Your account has been provisioned internally. Please update your temporary login credentials to establish clearance.
          </p>
        </div>

        {success ? (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-6 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl text-center space-y-3"
          >
            <ShieldCheck className="w-8 h-8 text-emerald-400 mx-auto" />
            <p className="text-sm font-bold text-emerald-400">Security Clearance Credentials Verified!</p>
            <p className="text-xs text-slate-400">Your profile is active. Syncing session dashboard...</p>
          </motion.div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest ml-1">New Personal Password</label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input
                  required
                  type={showPass ? "text" : "password"}
                  className="w-full bg-slate-950 border border-slate-800 rounded-2xl py-4 pl-12 pr-12 text-sm text-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all outline-none placeholder:text-slate-700 font-mono"
                  placeholder="At least 6 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setShowPass(!showPass)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white transition-colors"
                >
                  {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest ml-1">Confirm Personal Password</label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input
                  required
                  type={showPass ? "text" : "password"}
                  className="w-full bg-slate-950 border border-slate-800 rounded-2xl py-4 pl-12 pr-12 text-sm text-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all outline-none placeholder:text-slate-700 font-mono"
                  placeholder="Re-enter your new password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </div>
            </div>

            {error && (
              <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-2xl flex items-start gap-3">
                <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                <p className="text-[11px] text-red-400 leading-relaxed">{error}</p>
              </div>
            )}

            <div className="pt-2 flex flex-col gap-3">
              <button
                type="submit"
                disabled={loading}
                className="w-full py-4 bg-white hover:scale-[1.01] active:scale-[0.99] hover:bg-slate-100 text-slate-950 rounded-2xl text-sm font-bold transition-all shadow-xl shadow-white/5 flex items-center justify-center gap-2"
              >
                {loading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    Confirm Security Authorization
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={logout}
                className="w-full py-4 bg-slate-950 hover:bg-slate-900 border border-slate-800 text-slate-400 hover:text-white rounded-2xl text-sm font-bold transition-all"
              >
                Cancel and Log Out
              </button>
            </div>
          </form>
        )}
      </motion.div>
    </div>
  );
};

export default ForcedPasswordResetOverlay;
