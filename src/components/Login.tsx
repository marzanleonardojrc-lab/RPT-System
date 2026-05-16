import React, { useState } from "react";
import { useAuth } from "../AuthContext";
import { Database, ShieldCheck, Mail, Lock, User, ArrowRight, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

import municipalHallBg from "./municipal_hall.png";

const Login: React.FC = () => {
  const { signIn, signInWithEmail, signUpWithEmail, resetPassword } = useAuth();
  const [isRegistering, setIsRegistering] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    email: "",
    username: "",
    password: "",
    name: ""
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setMsg(null);
    try {
      if (isResetting) {
        await resetPassword(formData.email);
        setMsg("Password reset email sent. Please check your inbox.");
        setIsResetting(false);
      } else if (isRegistering) {
        await signUpWithEmail(formData.email, formData.password, formData.name, formData.username);
      } else {
        await signInWithEmail(formData.email, formData.password); // Using formData.email for the emailOrUsername field
      }
    } catch (err: any) {
      console.error(err);
      const errorCode = err.code || "";
      const errorMsg = err.message || "";
      
      if (errorCode === "auth/email-already-in-use" || errorMsg.includes("email-already-in-use")) {
        setError("This email is already registered. Please try logging in instead.");
      } else if (errorCode === "auth/weak-password" || errorMsg.includes("weak-password")) {
        setError("Password is too weak. Please use at least 6 characters.");
      } else if (errorCode === "auth/invalid-credential" || errorCode === "auth/wrong-password" || errorCode === "auth/user-not-found" || errorMsg.includes("invalid-credential") || errorMsg.includes("wrong-password") || errorMsg.includes("user-not-found")) {
        setError("Invalid email or password. Please check your credentials.");
      } else if (errorCode === "auth/missing-email" || errorMsg.includes("missing-email")) {
        setError("Please enter a valid email address.");
      } else {
        setError(errorMsg || "Authentication failed. Check your connection.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4 md:p-8 selection:bg-indigo-500/30 overflow-hidden relative w-full">
      {/* Background Image */}
      <div 
        className="absolute inset-0 z-0 overflow-hidden bg-cover bg-center bg-no-repeat opacity-60 pointer-events-none"
        style={{ backgroundImage: `url(${municipalHallBg})` }}
      >
        <div className="absolute inset-0 bg-slate-950/40 mix-blend-multiply" />
      </div>

      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-5xl relative z-10"
      >
        <div className="bg-slate-800/40 backdrop-blur-xl rounded-[2.5rem] shadow-[0_8px_32px_0_rgba(0,0,0,0.5)] p-8 md:p-12 border border-white/20 flex flex-col md:flex-row items-center gap-12">
          
          <div className="w-full md:w-1/2 relative z-20">
            <div className="text-center mb-10">
              <h1 className="text-4xl font-black text-white tracking-tight leading-none">Real Property Tax Delinquency Tracker</h1>
            </div>

          <AnimatePresence mode="wait">
            <motion.form 
              key={isRegistering ? "register" : "login"}
              initial={{ opacity: 0, x: isRegistering ? 10 : -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: isRegistering ? -10 : 10 }}
              onSubmit={handleSubmit} 
              className="space-y-4"
            >
              {isRegistering && (
                <>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest ml-1">Full Name</label>
                    <div className="relative">
                      <User className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                      <input
                        required
                        type="text"
                        className="w-full bg-slate-950 border border-slate-800 rounded-2xl py-4 pl-12 pr-4 text-sm text-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all outline-none placeholder:text-slate-700"
                        placeholder="e.g. Juan Dela Cruz"
                        value={formData.name}
                        onChange={e => setFormData(p => ({ ...p, name: e.target.value }))}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest ml-1">Username</label>
                    <div className="relative">
                      <User className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                      <input
                        required
                        type="text"
                        className="w-full bg-slate-950 border border-slate-800 rounded-2xl py-4 pl-12 pr-4 text-sm text-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all outline-none placeholder:text-slate-700"
                        placeholder="e.g. juandelacruz"
                        value={formData.username}
                        onChange={e => setFormData(p => ({ ...p, username: e.target.value.replace(/\s+/g, '').toLowerCase() }))}
                      />
                    </div>
                  </div>
                </>
              )}

              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest ml-1">{isRegistering || isResetting ? "Work Email" : "Email or Username"}</label>
                <div className="relative">
                  <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <input
                    required
                    type="text"
                    className="w-full bg-slate-950 border border-slate-800 rounded-2xl py-4 pl-12 pr-4 text-sm text-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all outline-none placeholder:text-slate-700"
                    placeholder={isRegistering || isResetting ? "Enter your email" : "Email or username"}
                    value={formData.email}
                    onChange={e => setFormData(p => ({ ...p, email: e.target.value }))}
                  />
                </div>
              </div>

              {!isResetting && (
                <div className="space-y-2">
                  <div className="flex justify-between items-center px-1">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest font-sans">Secure Password</label>
                    {!isRegistering && (
                      <button 
                        type="button" 
                        onClick={() => { setIsResetting(true); setError(null); setMsg(null); }}
                        className="text-[10px] text-indigo-400 hover:text-indigo-300 font-bold uppercase tracking-widest"
                      >
                        Forgot?
                      </button>
                    )}
                  </div>
                  <div className="relative">
                    <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <input
                      required
                      type="password"
                      className="w-full bg-slate-950 border border-slate-800 rounded-2xl py-4 pl-12 pr-4 text-sm text-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all outline-none placeholder:text-slate-700 font-mono"
                      placeholder="••••••••"
                      value={formData.password}
                      onChange={e => setFormData(p => ({ ...p, password: e.target.value }))}
                    />
                  </div>
                </div>
              )}

              {error && (
                <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-2xl flex items-start gap-3">
                  <ShieldCheck className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                  <p className="text-[11px] text-red-400 leading-relaxed">{error}</p>
                </div>
              )}

              {msg && (
                <div className="p-4 bg-indigo-500/10 border border-indigo-500/20 rounded-2xl flex items-start gap-3">
                  <ShieldCheck className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
                  <p className="text-[11px] text-indigo-300 leading-relaxed">{msg}</p>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full group relative overflow-hidden bg-white text-slate-950 py-4 rounded-2xl font-bold text-sm transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 shadow-xl shadow-white/5 flex items-center justify-center gap-2"
              >
                {loading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    {isResetting ? "Send Reset Link" : isRegistering ? "Confirm Registration" : "Log In to Dashboard"}
                    <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                  </>
                )}
              </button>

              {!isRegistering && !isResetting && (
                <>
                  <div className="flex items-center gap-4 py-2">
                    <div className="flex-1 h-px bg-slate-800" />
                    <span className="text-[10px] font-bold text-slate-600 uppercase tracking-widest whitespace-nowrap">Trusted Authentication</span>
                    <div className="flex-1 h-px bg-slate-800" />
                  </div>

                  <button
                    type="button"
                    onClick={async () => {
                      setLoading(true);
                      setError(null);
                      try {
                        await signIn();
                      } catch (err: any) {
                        setError(err.message || "Google sign-in failed.");
                      } finally {
                        setLoading(false);
                      }
                    }}
                    disabled={loading}
                    className="w-full bg-slate-950 border border-slate-800 text-white py-4 rounded-2xl font-bold text-sm transition-all hover:bg-slate-900 active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-3"
                  >
                    <Mail className="w-4 h-4 text-indigo-400" />
                    Sign in with Google
                  </button>
                </>
              )}
            </motion.form>
          </AnimatePresence>

          <div className="mt-8 text-center text-xs font-bold text-slate-400">
            {isResetting ? (
              <>
                Remember your password?{" "}
                <button 
                  onClick={() => { setIsResetting(false); setError(null); setMsg(null); }}
                  className="text-indigo-400 font-black hover:text-indigo-300 transition-colors"
                >
                  LOGIN HERE
                </button>
              </>
            ) : (
              <>
                {isRegistering ? (
                  <>
                    Already have an account?{" "}
                    <button 
                      onClick={() => setIsRegistering(false)}
                      className="text-indigo-400 font-black hover:text-indigo-300 transition-colors"
                    >
                      LOGIN HERE
                    </button>
                  </>
                ) : (
                  <>
                    Don't have an access key?{" "}
                    <button 
                      onClick={() => setIsRegistering(true)}
                      className="text-indigo-400 font-black hover:text-indigo-300 transition-colors"
                    >
                      REGISTER HERE
                    </button>
                  </>
                )}
              </>
            )}
          </div>
          </div>
          
          <div className="hidden md:flex flex-col items-center justify-center w-full md:w-1/2 transition-all duration-300 hover:scale-105 hover:drop-shadow-[0_20px_40px_rgba(99,102,241,0.2)]">
             <img src="/logo.png" alt="Logo" className="w-full max-w-[320px] object-contain drop-shadow-2xl" />
          </div>

        </div>
      </motion.div>
    </div>
  );
};

export default Login;
