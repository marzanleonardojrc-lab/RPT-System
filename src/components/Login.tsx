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
import { db, auth } from "../lib/firebase";
import { collection, getDocs, query, where, setDoc, doc, getDoc } from "firebase/firestore";

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

  // Resident registration form values
  const [regData, setRegData] = useState({
    fullName: "",
    email: "",
    username: "",
    password: "",
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
        const currentUser = auth.currentUser;
        if (currentUser) {
          const isAdminEmail = currentUser.email === "marzanleonardojrc@gmail.com" || currentUser.email === "marzan.leonardo04@gmail.com";
          const userDoc = await getDoc(doc(db, "users", currentUser.uid));
          if (userDoc.exists()) {
            const profileData = userDoc.data();
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
      const errorCode = err.code || "";
      const errorMsg = err.message || "";
      
      if (
        errorCode === "auth/invalid-credential" || 
        errorCode === "auth/wrong-password" || 
        errorCode === "auth/user-not-found" || 
        errorMsg.includes("invalid-credential") || 
        errorMsg.includes("wrong-password") || 
        errorMsg.includes("user-not-found")
      ) {
        setError("Invalid credentials. Please verify your email/username and password.");
      } else {
        setError(errorMsg || "Authentication failed. Clear your session and retry.");
      }
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
      // 1. Validation checks
      const assessedValNum = parseFloat(regData.assessedValue);
      if (isNaN(assessedValNum) || assessedValNum <= 0) {
        throw new Error("Invalid Assessed Value. Please specify a positive number as indicated in your official Assessor's Tax Declaration sheet.");
      }

      if (!regData.tdNumber && !regData.pin) {
        throw new Error("Verification requires either an official PIN (Property Index Number) or TDN (Tax Declaration Number).");
      }

      // 2. Query Firestore properties collection
      const propertiesRef = collection(db, "properties");
      const snapProps = await getDocs(propertiesRef);

      // Clean inputs for flexible, typo-tolerant, yet highly secure assessment matches
      const cleanInputName = regData.fullName.toLowerCase().replace(/[^a-z0-9]/g, "");

      const matchedProp = snapProps.docs.find(doc => {
        const p = doc.data();
        if (p.isArchived) return false;

        // Match assessment exact values
        const matchesAssessedVal = Math.abs(p.assessedValue - assessedValNum) < 1; // absolute tolerance within 1 peso
        
        // Clean database strings
        const cleanDbOwnerName = (p.ownerName || "").toLowerCase().replace(/[^a-z0-9]/g, "");
        const matchesOwner = cleanDbOwnerName.includes(cleanInputName) || cleanInputName.includes(cleanDbOwnerName);

        // Verification numbers matching (one or both must match if provided)
        const matchesTdn = regData.tdNumber && p.tdNumber
          ? p.tdNumber.trim().toLowerCase() === regData.tdNumber.trim().toLowerCase()
          : false;

        const matchesPin = regData.pin && p.pin
          ? p.pin.trim().toLowerCase() === regData.pin.trim().toLowerCase()
          : false;

        return matchesOwner && matchesAssessedVal && (matchesTdn || matchesPin);
      });

      if (!matchedProp) {
        throw new Error(
          "Security Verification Failed. The provided combination of Taxpayer Name, TDN/PIN, and Assessed Value does not match any official property record in our active registry database. Registration blocked."
        );
      }

      const pData = matchedProp.data();

      // 3. Register user profile via standard signUpWithEmail
      const emailToUse = regData.email.trim() 
        ? regData.email.trim() 
        : `${regData.username.trim().toLowerCase()}@rpt.dipaculao.gov`;

      await signUpWithEmail(
        emailToUse,
        regData.password,
        regData.fullName.trim(),
        regData.username.trim().toLowerCase(),
        "Taxpayer",
        [matchedProp.id]
      );

      // 4. Record dynamic login identifier / mapping for TDN logins
      if (regData.tdNumber) {
        await setDoc(doc(db, "user_mappings", regData.tdNumber.trim().toLowerCase()), {
          username: regData.tdNumber.trim().toLowerCase(),
          email: emailToUse
        });
      }

      // 5. Build secure Audit log entry for tracking links
      const auditId = Math.random().toString(36).substring(2, 15);
      await setDoc(doc(db, "audit_logs", auditId), {
        id: auditId,
        userId: "system-registration",
        userEmail: emailToUse,
        action: "CREATE",
        entityId: matchedProp.id,
        entityType: "TaxpayerRegistration",
        newValue: {
          email: emailToUse,
          displayName: regData.fullName.trim(),
          role: "Taxpayer",
          linkedPropertyId: matchedProp.id,
          verifiedTdn: regData.tdNumber,
          verifiedPin: regData.pin,
          verifiedAssessedVal: assessedValNum
        },
        timestamp: new Date().toISOString()
      });

      setMsg(`Success! Welcome ${regData.fullName}. Your resident portal account is fully registered and linked to Property TDN: ${pData.tdNumber}! Establishing secure node...`);
      
      // Auto redirect triggers via profile observer
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
                  <h4 className="text-[10px] font-black tracking-[0.2em] text-blue-500 uppercase font-mono">Dipaculao Aurora</h4>
                  <h2 className="text-sm font-bold text-slate-300 leading-none">Government RPT Network</h2>
                </div>
              </div>

              <h1 className="text-3xl md:text-5xl font-black text-white tracking-tight leading-none mb-6">
                Web-Based <br className="hidden md:block"/>
                <span className="text-blue-400">Real Property</span> <br />
                Tax System
              </h1>

              <p className="text-slate-400 text-xs md:text-sm leading-relaxed max-w-md mb-8">
                Access official administrative modules, register secure resident taxpayer accounts, or complete read-only financial ledger audits securely.
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

            <div className="mt-8 pt-6 border-t border-slate-800/50 flex items-center justify-between font-mono text-[9px] text-slate-600 uppercase">
              <span>Secure Connection: AES-GCM</span>
              <span>Dipaculao Finance Node</span>
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

            <AnimatePresence mode="wait">
              {isRegistering ? (
                /* RESIDENT PORTAL REGISTRATION */
                <motion.form 
                  key="registration"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  onSubmit={handleRegisterSubmit}
                  className="space-y-4"
                >
                  <div className="border-b border-slate-800 pb-3 mb-2">
                    <h3 className="text-sm font-black text-white uppercase tracking-wider">Resident Real Property Link Registration</h3>
                    <p className="text-[10px] text-slate-500 mt-1">Provide your details and Assessed values to link your tax profile seamlessly.</p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest block font-sans">Full Name *</label>
                      <input
                        required
                        type="text"
                        placeholder="Taxpayer Registered Name"
                        className="w-full bg-slate-900 border border-slate-800 rounded-xl py-3 px-3.5 text-xs text-white focus:outline-none focus:border-blue-500 transition-colors"
                        value={regData.fullName}
                        onChange={e => setRegData(p => ({ ...p, fullName: e.target.value }))}
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest block font-sans">Email Address (Optional / Gmail not required)</label>
                      <input
                        type="email"
                        placeholder="Offline: system will auto-generate if empty"
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

                  <div className="p-4 bg-slate-900 border border-slate-800 rounded-2xl space-y-4">
                    <h3 className="text-[10px] font-black text-blue-400 uppercase tracking-widest flex items-center gap-2">
                      <FileText className="w-3.5 h-3.5" />
                      Tax Registry Match Inputs
                    </h3>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pb-1">
                      <div className="space-y-1.5">
                        <label className="text-[9px] font-black text-slate-550 uppercase tracking-wider block font-mono">Tax Decl. Number (TDN)</label>
                        <input
                          type="text"
                          placeholder="e.g. TD-2025-0012"
                          className="w-full bg-slate-950 border border-slate-850 rounded-xl py-2.5 px-3 text-xs text-white focus:outline-none focus:border-blue-500 transition-colors"
                          value={regData.tdNumber}
                          onChange={e => setRegData(p => ({ ...p, tdNumber: e.target.value }))}
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-[9px] font-black text-slate-550 uppercase tracking-wider block font-mono">Property Index No. (PIN)</label>
                        <input
                          type="text"
                          placeholder="e.g. 012-04-001..."
                          className="w-full bg-slate-950 border border-slate-850 rounded-xl py-2.5 px-3 text-xs text-white focus:outline-none focus:border-blue-500 transition-colors"
                          value={regData.pin}
                          onChange={e => setRegData(p => ({ ...p, pin: e.target.value }))}
                        />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex justify-between items-center pr-1">
                        <label className="text-[9px] font-black text-slate-550 uppercase tracking-wider block font-sans">Official Assessed Value (₱) *</label>
                        <span className="text-[8px] text-blue-400 font-bold uppercase block tracking-wider">Strict Security Check Target</span>
                      </div>
                      <input
                        required
                        type="number"
                        placeholder="Exact number from Assessor's Declaration (e.g., 24000)"
                        className="w-full bg-slate-950 border border-slate-850 rounded-xl py-3 px-3 text-xs text-white font-mono focus:outline-none focus:border-blue-500 transition-colors"
                        value={regData.assessedValue}
                        onChange={e => setRegData(p => ({ ...p, assessedValue: e.target.value }))}
                      />
                    </div>
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
                        <span>Verify registry & Link profile</span>
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
                      &larr; Already Registered? Return to Login
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
