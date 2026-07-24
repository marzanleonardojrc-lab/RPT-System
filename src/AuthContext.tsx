import React, { createContext, useContext, useEffect, useState } from "react";
import { UserProfile, UserRole } from "./types";
import { 
  getCurrentSession, 
  getCurrentUser, 
  onSessionStateChange, 
  signInWithEmail as sbSignInWithEmail, 
  signUpWithEmail as sbSignUpWithEmail, 
  signInWithGoogle, 
  resetPassword as sbResetPassword, 
  updateUserName as sbUpdateUserName, 
  updateUserUsername as sbUpdateUserUsername, 
  updateUserPassword as sbUpdateUserPassword, 
  getUserProfile, 
  logout as sbLogout 
} from "./lib/auth-helpers";
import { supabase } from "./lib/supabase";
import { initializeAutoSync } from "./lib/offlineSync";

const createAuthError = (code: string, message?: string) => {
  const err = new Error(message || code) as any;
  err.code = code;
  return err;
};

interface AuthContextType {
  user: any | null;
  profile: UserProfile | null;
  loading: boolean;
  signIn: () => Promise<void>;
  signInWithEmail: (emailOrUsername: string, pass: string) => Promise<void>;
  signUpWithEmail: (email: string, pass: string, name: string, username: string, role?: UserRole, linkedPropertyIds?: string[], designation?: string) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  updateUserName: (name: string) => Promise<void>;
  updateUserUsername: (username: string) => Promise<void>;
  updateUserPassword: (pass: string) => Promise<void>;
  logout: () => Promise<void>;
  isAdmin: boolean;
  isEncoder: boolean;
  isGuest: boolean;
  isTaxpayer: boolean;
  isOffline: boolean;
  isQuotaExceeded: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<any | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [isOffline, setIsOffline] = useState(typeof navigator !== "undefined" ? !navigator.onLine : false);
  const [isQuotaExceeded, setIsQuotaExceeded] = useState(false);

  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    const handleQuotaExceeded = () => setIsQuotaExceeded(true);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    window.addEventListener("rpt-quota-exceeded", handleQuotaExceeded);

    const cleanupAutoSync = initializeAutoSync();

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("rpt-quota-exceeded", handleQuotaExceeded);
      if (cleanupAutoSync) cleanupAutoSync();
    };
  }, []);

  useEffect(() => {
    // Check initial session
    const checkInitialSession = async () => {
      try {
        const session = await getCurrentSession();
        if (session?.user) {
          const sbUser = session.user;
          setUser(sbUser);
          
          let userProfile = await getUserProfile(sbUser.id);
          if (!userProfile) {
            // Create user profile if it doesn't exist (e.g. Google Sign In)
            const baseUsername = sbUser.email?.split("@")[0].toLowerCase().replace(/[^a-z0-9]/g, '') || "user";
            let username = baseUsername;
            
            // Check username availability
            const { data: existingUser } = await supabase
              .from('users')
              .select('uid')
              .eq('username', username)
              .maybeSingle();
              
            if (existingUser) {
              username = `${baseUsername}${Math.floor(Math.random() * 1000)}`;
            }
            
            const isAdminEmail = sbUser.email === "marzanleonardojrc@gmail.com" || sbUser.email === "marzan.leonardo04@gmail.com";
            const assignedRole = isAdminEmail ? "Admin" : "User";
            const assignedStatus = isAdminEmail ? "Approved" : "Pending";
            
            const newProfile: UserProfile = {
              uid: sbUser.id,
              email: sbUser.email || "",
              displayName: sbUser.user_metadata?.displayName || sbUser.user_metadata?.full_name || sbUser.email?.split("@")[0] || "User",
              username: username,
              role: assignedRole,
              status: assignedStatus as any,
              createdAt: new Date().toISOString()
            };
            
            const { error: insertError } = await supabase
              .from('users')
              .upsert(newProfile);
              
            if (insertError) {
              console.error("Supabase: Failed to auto-provision user profile:", insertError);
            }
            userProfile = newProfile;
          }
          setProfile(userProfile);
        } else {
          setUser(null);
          setProfile(null);
        }
      } catch (err) {
        console.error("Initial Session Check Error:", err);
      } finally {
        setLoading(false);
      }
    };

    checkInitialSession();

    // Listen to changes
    const subscription = onSessionStateChange(async (session, sbUser) => {
      try {
        if (sbUser) {
          setUser(sbUser);
          let userProfile = await getUserProfile(sbUser.id);
          if (!userProfile) {
            // Provision user profile
            const baseUsername = sbUser.email?.split("@")[0].toLowerCase().replace(/[^a-z0-9]/g, '') || "user";
            let username = baseUsername;
            const { data: existingUser } = await supabase
              .from('users')
              .select('uid')
              .eq('username', username)
              .maybeSingle();
              
            if (existingUser) {
              username = `${baseUsername}${Math.floor(Math.random() * 1000)}`;
            }
            
            const isAdminEmail = sbUser.email === "marzanleonardojrc@gmail.com" || sbUser.email === "marzan.leonardo04@gmail.com";
            const assignedRole = isAdminEmail ? "Admin" : "User";
            const assignedStatus = isAdminEmail ? "Approved" : "Pending";
            
            const newProfile: UserProfile = {
              uid: sbUser.id,
              email: sbUser.email || "",
              displayName: sbUser.user_metadata?.displayName || sbUser.user_metadata?.full_name || sbUser.email?.split("@")[0] || "User",
              username: username,
              role: assignedRole,
              status: assignedStatus as any,
              createdAt: new Date().toISOString()
            };
            
            const { error: insertError } = await supabase
              .from('users')
              .upsert(newProfile);
              
            if (insertError) {
              console.error("Supabase: Failed to auto-provision user profile on state change:", insertError);
            }
            userProfile = newProfile;
          }
          setProfile(userProfile);
        } else {
          setUser(null);
          setProfile(null);
        }
      } catch (err) {
        console.error("Session State Change Handler Error:", err);
      } finally {
        setLoading(false);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const signIn = async () => {
    try {
      await signInWithGoogle();
    } catch (err: any) {
      console.error("Login Error:", err);
      throw err;
    }
  };

  const signInWithEmail = async (emailOrUsername: string, pass: string) => {
    try {
      await sbSignInWithEmail(emailOrUsername, pass);
    } catch (err: any) {
      console.error("Sign in with email error:", err);
      if (err.message?.includes('not found') || err.message?.includes('Invalid login credentials')) {
        throw createAuthError("auth/user-not-found", "Invalid email/username or password.");
      }
      throw err;
    }
  };

  const signUpWithEmail = async (
    email: string,
    pass: string,
    name: string,
    username: string,
    targetRole: UserRole = "User",
    linkedPropertyIds?: string[],
    designation?: string
  ) => {
    try {
      await sbSignUpWithEmail(email, pass, name, username, targetRole, linkedPropertyIds, designation);
    } catch (err: any) {
      if (err.message === "Username already in use.") {
        throw createAuthError("auth/username-already-in-use", err.message);
      }
      throw err;
    }
  };
  
  const updateUserName = async (name: string) => {
    await sbUpdateUserName(name);
    setProfile(p => p ? { ...p, displayName: name } : null);
  };

  const updateUserUsername = async (username: string) => {
    const formattedUsername = username.replace(/\s+/g, '').toLowerCase();
    await sbUpdateUserUsername(formattedUsername);
    setProfile(p => p ? { ...p, username: formattedUsername } : null);
  };

  const updateUserPassword = async (pass: string) => {
    await sbUpdateUserPassword(pass);
  };

  const resetPassword = async (emailOrUsername: string) => {
    try {
      await sbResetPassword(emailOrUsername);
    } catch (err: any) {
      if (err.message === "User with this username not found.") {
        throw createAuthError("auth/user-not-found", err.message);
      }
      throw err;
    }
  };

  const logout = async () => {
    await sbLogout();
    setUser(null);
    setProfile(null);
  };

  const isAdminEmail = user?.email === "marzanleonardojrc@gmail.com" || user?.email === "marzan.leonardo04@gmail.com";
  const isApproved = profile?.status === "Approved" || isAdminEmail;

  return (
    <AuthContext.Provider value={{ 
      user, 
      profile, 
      loading, 
      signIn, 
      signInWithEmail,
      signUpWithEmail,
      resetPassword,
      updateUserName,
      updateUserUsername,
      updateUserPassword,
      logout,
      isOffline,
      isQuotaExceeded,
      isAdmin: (isApproved && profile?.role === "Admin") || isAdminEmail,
      isEncoder: (isApproved && (profile?.role === "Admin" || profile?.role === "User" || profile?.role === "End-User")) || isAdminEmail,
      isGuest: isApproved && profile?.role === "Guest" && !isAdminEmail,
      isTaxpayer: profile?.role === "Taxpayer" || profile?.role === "Resident"
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
