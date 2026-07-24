import React, { useState } from "react";
import { useAuth } from "../AuthContext";
import { 
  Mail, 
  Lock, 
  User, 
  ArrowRight, 
  Loader2, 
  ShieldCheck, 
  Building2, 
  Users, 
  Fingerprint, 
  FileText, 
  AlertCircle, 
  CheckCircle,
  Eye,
  EyeOff
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { supabase } from "../lib/supabase";

type AccessRole = "Resident" | "Staff" | "Administrator";

const Login: React.FC = () => {
  const { signInWithEmail, signUpWithEmail, resetPassword, logout } = useAuth();
  
  // Tab & role states
  const [selectedRole, setSelectedRole] = useState<AccessRole>("Resident");
  const [isRegistering, setIsRegistering] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Status/error feedback
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  // Login form values
  const [loginData, setLoginData] = useState({
    usernameOrEmail: "",
    password: ""
  });

  // Resident/Staff registration form values
  const [regData, setRegData] = useState({
    fullName: "",
    email: "",
    username: "",
    password: "",
    designation: "Treasury Tax Encoder",
    tdNumber: "",
    pin: "",
    assessedValue: ""
  });

  const handleRoleChange = (role: AccessRole) => {
    setSelectedRole(role);
    setIsRegistering(false);
    setIsResetting(false);
    setError(null);
    setMsg(null);
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setMsg(null);

    try {
      if (isResetting) {
        await resetPassword(loginData.usernameOrEmail);
        setMsg("Password reset email sent. Please check your inbox / spam folder.");
        setIsResetting(false);
      } else {
        // Authenticate the user
        await signInWithEmail(loginData.usernameOrEmail, loginData.password);
        
        // Retrieve newly logged-in user details to verify role authorization strictly
        const { data: { session } } = await supabase.auth.getSession();
        const currentUser = session?.user;
        if (currentUser) {
          const isAdminEmail = currentUser.email === "marzanleonardojrc@gmail.com" || currentUser.email === "marzan.leonardo04@gmail.com";
          
          const { data: profileData, error: profileError } = await supabase
            .from("users")
            .select("*")
            .eq("uid", currentUser.id)
            .maybeSingle();

          if (profileError) throw profileError;

          if (profileData) {
            const realRole = profileData.role;

            // Strict alignment validation of chosen Role Selector vs actual identity database role
            if (selectedRole === "Administrator" && realRole !== "Admin" && !isAdminEmail) {
              await logout();
              throw new Error("Access Blocked: This account is not registered with Administrator level credentials.");
            } else if (selectedRole === "Staff" && realRole !== "User" && realRole !== "End-User" && !isAdminEmail) {
              await logout();
              throw new Error("Access Blocked: This account is not registered as normal Staff.");
            } else if (selectedRole === "Resident" && realRole !== "Taxpayer" && realRole !== "Resident") {
              await logout();
              throw new Error("Access Blocked: This account is not registered as a Taxpayer Resident.");
            }
          } else if (!isAdminEmail) {
            await logout();
            throw new Error("Access Blocked: User profile record was not found in the tax database.");
          }
        }
      }
    } catch (err: any) {
      console.error(err);
      const errorMsg = err.message || "";
      setError(errorMsg || "Authentication failed. Clear your session and retry.");
    } finally {
      setLoading(false);
    }
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setMsg(null);

    try {
      if (!regData.fullName.trim()) {
        throw new Error("Full name is required.");
      }
      if (!regData.username.trim()) {
        throw new Error("Username is required.");
      }
      if (!regData.email.trim()) {
        throw new Error("Work email is required.");
      }
      if (!regData.password || regData.password.length < 6) {
        throw new Error("Password must be at least 6 characters.");
      }

      // 1. Register staff profile via our standard signUpWithEmail helper
      // This will automatically put them as 'Pending' and also create their staff_profiles entry.
      await signUpWithEmail(
        regData.email.trim(),
        regData.password,
        regData.fullName.trim(),
        regData.username.trim().toLowerCase(),
        "User", // Standard User role for Staff
        [], // No linked properties for Staff
        regData.designation || "Treasury Tax Encoder"
      );

      // 2. Build secure Audit log entry for tracking staff registrations
      const { error: auditError } = await supabase.from("audit_logs").insert({
        action: "CREATE",
        user_id: null,
        entity_id: regData.username.trim().toLowerCase(),
        entity_type: "StaffRegistration",
        new_value: {
          email: regData.email.trim(),
          displayName: regData.fullName.trim(),
          designation: regData.designation || "Treasury Tax Encoder",
          role: "User",
          status: "Pending"
        },
        timestamp: new Date().toISOString()
      });

      if (auditError) {
        console.warn("Failed to create audit log during staff registration:", auditError);
      }

      setMsg(`Success! Your Staff Account request has been submitted and is currently PENDING. An Administrator must review and approve your account before you can log in.`);
      
    } catch (err: any) {
      console.error(err);
      setError(err.message || "An unexpected registration error occurred. Verify inputs and try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0B1528] text-slate-100 flex items-center justify-center p-4 md:p-10 relative overflow-hidden w-full select-none">
      {/* Dynamic Background visual ornaments */}
      <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-blue-500/5 blur-[120px] rounded-full pointer-events-none z-0" />
      <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-emerald-500/5 blur-[120px] rounded-full pointer-events-none z-0" />

      <motion.div 
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-6xl relative z-10"
      >
        <div className="bg-slate-900/80 border border-slate-800 backdrop-blur-2xl rounded-[3rem] shadow-2xl p-6 md:p-12 flex flex-col lg:flex-row items-stretch gap-12">
          
          {/* Left panel: Info Hub */}
          <div className="w-full lg:w-[45%] flex flex-col justify-between py-2">
            <div>
              <div className="flex items-center gap-3 mb-6">
                <div className="w-12 h-12 bg-slate-900 border border-slate-800 rounded-full flex items-center justify-center shrink-0 shadow-lg shadow-black/40 overflow-hidden p-1">
                  <img src="/logo.png" alt="Dipaculao Logo" className="w-10 h-10 object-contain" referrerPolicy="no-referrer" />
                </div>
                <div>
                  <h4 className="text-[11px] font-extrabold tracking-[0.18em] text-blue-400 uppercase font-mono">LGU-DIPACULAO, AURORA</h4>
                  <h2 className="text-[13px] font-semibold text-slate-200 tracking-wide mt-1 leading-snug">Municipal Treasury Office RPT Portal</h2>
                </div>
              </div>

              <h1 className="text-3xl md:text-[2.2rem] font-black text-white tracking-tight leading-[1.15] mb-6">
                Web-Based <span className="text-blue-400">Real Property</span> Tax Collection and Digital Ledger System
              </h1>

              <p className="text-slate-400 text-xs md:text-sm leading-relaxed max-w-md mb-8">
                Modernizing transaction recording and records management for LGU-Dipaculao.
              </p>
            </div>

            <div className="space-y-4">
              <div className="flex items-start gap-4 p-4 rounded-2xl bg-slate-950/40 border border-slate-800/80">
                <ShieldCheck className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-xs font-bold text-white uppercase tracking-wider mb-0.5">Strict Ledger Isolation</h4>
                  <p className="text-[10px] text-slate-500 leading-normal">
                    Taxpayer profile linkages are validated using physical Assessor Tax Declarations to guarantee strict citizen data privacy.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-4 p-4 rounded-2xl bg-slate-950/40 border border-slate-800/80">
                <Fingerprint className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-xs font-bold text-white uppercase tracking-wider mb-0.5">Automated Audits</h4>
                  <p className="text-[10px] text-slate-500 leading-normal">
                    System collection activities, user revisions, and account changes are fully audited in real-time.
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-8 pt-6 border-t border-slate-800/50 flex flex-col sm:flex-row items-center justify-between font-mono text-[9.5px] text-slate-500 gap-2 uppercase tracking-wider">
              <span>Presented by <strong className="text-slate-300 font-bold">Leonardo C. Marzan, Jr.</strong></span>
              <span className="hidden sm:inline text-slate-800">|</span>
              <span className="text-slate-450 text-center sm:text-right">© 2026 Master in Public Administration Capstone Project</span>
            </div>
          </div>

          {/* Right panel: Active Auth Module */}
          <div className="w-full lg:w-[55%] bg-slate-950/80 border border-slate-850 p-6 md:p-8 rounded-[2.5rem] flex flex-col justify-start relative">
            
            {/* 1. ACCESS LEVEL ROLE CARD SELECTOR */}
            <div className="grid grid-cols-3 gap-2 bg-slate-900 border border-slate-800 p-1.5 rounded-2xl mb-8">
              {(["Resident", "Staff", "Administrator"] as AccessRole[]).map((role) => {
                const isActive = selectedRole === role;
                return (
                  <button
                    key={role}
                    type="button"
                    onClick={() => handleRoleChange(role)}
                    className={`py-3 px-2 rounded-xl text-[10px] md:text-xs font-black uppercase tracking-wider transition-all duration-300 relative overflow-hidden flex flex-col items-center gap-1 cursor-pointer ${
                      isActive 
                        ? "bg-white text-slate-950 font-black shadow-lg" 
                        : "text-slate-400 hover:text-white hover:bg-slate-800/10"
                    }`}
                  >
                    {role === "Resident" && <User className="w-4 h-4 mb-0.5" />}
                    {role === "Staff" && <Users className="w-4 h-4 mb-0.5" />}
                    {role === "Administrator" && <ShieldCheck className="w-4 h-4 mb-0.5" />}
                    <span>{role}</span>
                  </button>
                );
              })}
            </div>

            <AnimatePresence mode="wait">              {isRegistering ? (
                /* STAFF ACCOUNT REGISTRATION */
                <motion.form 
                  key="registration"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  onSubmit={handleRegisterSubmit}
                  className="space-y-4"
                >
                  <div className="border-b border-slate-800 pb-3 mb-2">
                    <h3 className="text-sm font-black text-white uppercase tracking-wider">Staff Account Registration</h3>
                    <p className="text-[10px] text-slate-500 mt-1">Provide your details to submit a Staff registration request. Accounts remain Pending until Administrator approval.</p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest block font-sans">Full Name *</label>
                      <input
                        required
                        type="text"
                        placeholder="e.g. Maria Santos"
                        className="w-full bg-slate-900 border border-slate-800 rounded-xl py-3 px-3.5 text-xs text-white focus:outline-none focus:border-blue-500 transition-colors"
                        value={regData.fullName}
                        onChange={e => setRegData(p => ({ ...p, fullName: e.target.value }))}
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest block font-sans">Work Email *</label>
                      <input
                        required
                        type="email"
                        placeholder="e.g. maria.santos@dipaculao.gov"
                        className="w-full bg-slate-900 border border-slate-800 rounded-xl py-3 px-3.5 text-xs text-white focus:outline-none focus:border-blue-500 transition-colors"
                        value={regData.email}
                        onChange={e => setRegData(p => ({ ...p, email: e.target.value }))}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest block font-sans">Preferred Username *</label>
                      <input
                        required
                        type="text"
                        placeholder="e.g. maria_santos"
                        className="w-full bg-slate-900 border border-slate-800 rounded-xl py-3 px-3.5 text-xs text-white focus:outline-none focus:border-blue-500 transition-colors"
                        value={regData.username}
                        onChange={e => setRegData(p => ({ ...p, username: e.target.value.replace(/\s+/g, '') }))}
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest block font-sans">Set Password *</label>
                      <input
                        required
                        type="password"
                        placeholder="Must exceed 6 characters"
                        className="w-full bg-slate-900 border border-slate-800 rounded-xl py-3 px-3.5 text-xs text-white focus:outline-none focus:border-blue-500 transition-colors font-mono"
                        value={regData.password}
                        onChange={e => setRegData(p => ({ ...p, password: e.target.value }))}
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest block font-sans">Municipal Office / Staff Designation *</label>
                    <select
                      value={regData.designation}
                      onChange={e => setRegData(p => ({ ...p, designation: e.target.value }))}
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl py-3 px-3.5 text-xs text-white focus:outline-none focus:border-blue-500 transition-colors cursor-pointer font-sans"
                    >
                      <option value="Treasury Tax Encoder">Treasury Tax Encoder (Default)</option>
                      <option value="Revenue Collection Officer">Revenue Collection Officer</option>
                      <option value="Assessor Assessment Staff">Assessor Assessment Staff</option>
                      <option value="Real Property Examiner">Real Property Examiner</option>
                      <option value="Municipal Treasurer / Deputy">Municipal Treasurer / Deputy</option>
                      <option value="COA Resident Auditor">COA Resident Auditor</option>
                      <option value="IT & Records Administrator">IT & Records Administrator</option>
                      <option value="General Municipal Staff">General Municipal Staff</option>
                    </select>
                  </div>

                  {error && (
                    <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-2xl flex items-start gap-3">
                      <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                      <p className="text-[10px] text-red-400 leading-normal font-semibold">{error}</p>
                    </div>
                  )}

                  {msg && (
                    <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl flex items-start gap-3">
                      <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                      <p className="text-[10px] text-emerald-400 leading-normal font-semibold">{msg}</p>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full h-12 bg-white text-slate-950 rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-slate-100 transition-all disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-white/5 mt-4"
                  >
                    {loading ? (
                      <Loader2 className="w-4 h-4 animate-spin text-slate-950" />
                    ) : (
                      <>
                        <span>Submit Staff Registration</span>
                        <ArrowRight className="w-4 h-4" />
                      </>
                    )}
                  </button>

                  <div className="text-center pt-2">
                    <button
                      type="button"
                      onClick={() => { setIsRegistering(false); setError(null); setMsg(null); }}
                      className="text-blue-400 hover:text-blue-300 font-bold text-[10px] uppercase tracking-widest"
                    >
                      &larr; Return to Login
                    </button>
                  </div>
                </motion.form>
              ) : (
                /* STANDALONE LOGIN FORM */
                <motion.form 
                  key="login"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  onSubmit={handleLoginSubmit} 
                  className="space-y-5"
                >
                  <div className="border-b border-slate-800 pb-3 mb-2">
                    <h3 className="text-sm font-black text-white uppercase tracking-wider flex items-center gap-2">
                      {selectedRole === "Resident" && <User className="w-4 h-4 text-blue-400" />}
                      {selectedRole === "Staff" && <Users className="w-4 h-4 text-blue-400" />}
                      {selectedRole === "Administrator" && <ShieldCheck className="w-4 h-4 text-blue-400" />}
                      {selectedRole} Access Validation
                    </h3>
                    <p className="text-[10px] text-slate-500 mt-1">
                      {selectedRole === "Resident" 
                        ? "Verify your identity using your secure login email, preferred username, or verified TDN."
                        : `Provide authorized credentials corresponding directly to authenticated ${selectedRole} records.`}
                    </p>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest ml-1 font-mono">
                      {selectedRole === "Resident" ? "Taxpayer Email / Username / Verified TDN" : "Work Email or Official Username"}
                    </label>
                    <div className="relative">
                      <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                      <input
                        required
                        type="text"
                        className="w-full bg-slate-900 border border-slate-800 rounded-2xl py-3.5 pl-12 pr-4 text-xs text-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all outline-none placeholder:text-slate-700"
                        placeholder={selectedRole === "Resident" ? "Email, username, or e.g. TD-2025-0012" : "Email address or username"}
                        value={loginData.usernameOrEmail}
                        onChange={e => setLoginData(p => ({ ...p, usernameOrEmail: e.target.value }))}
                      />
                    </div>
                  </div>

                  {!isResetting && (
                    <div className="space-y-2">
                      <div className="flex justify-between items-center px-1">
                        <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest font-mono">Secure Access Password</label>
                        <button 
                          type="button" 
                          onClick={() => { setIsResetting(true); setError(null); setMsg(null); }}
                          className="text-[9px] text-blue-400 hover:text-blue-300 font-bold uppercase tracking-wider"
                        >
                          Reset?
                        </button>
                      </div>
                      <div className="relative font-mono">
                        <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                        <input
                          required
                          type={showPassword ? "text" : "password"}
                          className="w-full bg-slate-900 border border-slate-800 rounded-2xl py-3.5 pl-12 pr-12 text-xs text-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all outline-none placeholder:text-slate-700"
                          placeholder="••••••••"
                          value={loginData.password}
                          onChange={e => setLoginData(p => ({ ...p, password: e.target.value }))}
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white transition-colors"
                        >
                          {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>
                  )}

                  {error && (
                    <div className="p-4 bg-red-400/5 border border-red-500/15 rounded-2xl flex items-start gap-3">
                      <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                      <p className="text-[10px] text-red-400 leading-normal font-semibold">{error}</p>
                    </div>
                  )}

                  {msg && (
                    <div className="p-4 bg-blue-500/10 border border-blue-500/10 rounded-2xl flex items-start gap-3">
                      <CheckCircle className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
                      <p className="text-[10px] text-blue-300 leading-normal font-semibold">{msg}</p>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full h-12 bg-white text-slate-950 font-bold text-xs uppercase tracking-widest rounded-xl hover:bg-slate-100 transition-all disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-white/5"
                  >
                    {loading ? (
                      <Loader2 className="w-4 h-4 animate-spin text-slate-950" />
                    ) : (
                      <>
                        <span>{isResetting ? "Send Reset Email" : `Sign In as ${selectedRole}`}</span>
                        {!isResetting && <ArrowRight className="w-4 h-4" />}
                      </>
                    )}
                  </button>

                  {selectedRole === "Staff" && !isResetting && (
                    <div className="text-center pt-2">
                      <p className="text-[10px] text-slate-400">
                        New Staff Member?{" "}
                        <button
                          type="button"
                          onClick={() => {
                            setIsRegistering(true);
                            setError(null);
                            setMsg(null);
                          }}
                          className="text-blue-400 hover:text-blue-300 font-bold uppercase tracking-wider cursor-pointer"
                        >
                          Register Staff Account &rarr;
                        </button>
                      </p>
                    </div>
                  )}



                  {isResetting && (
                    <div className="text-center pt-2">
                      <button
                        type="button"
                        onClick={() => { setIsResetting(false); setError(null); setMsg(null); }}
                        className="text-blue-400 hover:text-blue-300 font-bold text-[10px] uppercase tracking-widest"
                      >
                        Return to Validate
                      </button>
                    </div>
                  )}
                </motion.form>
              )}
            </AnimatePresence>

          </div>

        </div>
      </motion.div>
    </div>
  );
};

export default Login;
