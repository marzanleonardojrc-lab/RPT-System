import React, { createContext, useContext, useEffect, useState } from "react";
import { UserProfile } from "./types";
import { 
  auth, 
  db, 
  onAuthStateChanged, 
  signInWithPopup, 
  googleProvider, 
  signOut, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  collection,
  getDocs,
  query,
  where
} from "./lib/firebase";
import { updateProfile, updatePassword } from "firebase/auth";
import { initializeAutoSync } from "./lib/offlineSync";

interface AuthContextType {
  user: any | null;
  profile: UserProfile | null;
  loading: boolean;
  signIn: () => Promise<void>;
  signInWithEmail: (emailOrUsername: string, pass: string) => Promise<void>;
  signUpWithEmail: (email: string, pass: string, name: string, username: string) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  updateUserName: (name: string) => Promise<void>;
  updateUserUsername: (username: string) => Promise<void>;
  updateUserPassword: (pass: string) => Promise<void>;
  logout: () => Promise<void>;
  isAdmin: boolean;
  isEncoder: boolean;
  isGuest: boolean;
  isOffline: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<any | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [isOffline, setIsOffline] = useState(typeof navigator !== "undefined" ? !navigator.onLine : false);

  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    const cleanupAutoSync = initializeAutoSync();

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      if (cleanupAutoSync) cleanupAutoSync();
    };
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      try {
        if (firebaseUser) {
          setUser(firebaseUser);
          
          // Try to fetch profile, if offline use cache
          let userDoc;
          try {
            // First try normal getDoc (which uses cache if available)
            userDoc = await getDoc(doc(db, "users", firebaseUser.uid));
            setIsOffline(false);
          } catch (docErr: any) {
            console.error("Profile Fetch Error:", docErr);
            if (docErr.message?.includes('offline')) {
              setIsOffline(true);
              // We might still want to try to get from cache if it fails with offline
              // but getDoc usually does that. If it throws here, it means cache missed too.
            }
            setLoading(false);
            return;
          }

          if (userDoc.exists()) {
            setProfile(userDoc.data() as UserProfile);
          } else {
            // Handle case where user exists in Auth but not in Firestore (e.g., first Google login)
            const baseUsername = firebaseUser.email?.split("@")[0].toLowerCase().replace(/[^a-z0-9]/g, '') || "user";
            let username = baseUsername;
            
            // Basic conflict check
            const mappingDoc = await getDoc(doc(db, "user_mappings", username));
            if (mappingDoc.exists()) {
              username = `${baseUsername}${Math.floor(Math.random() * 1000)}`;
            }

            const newProfile: any = {
              uid: firebaseUser.uid,
              email: firebaseUser.email || "",
              displayName: firebaseUser.displayName || firebaseUser.email?.split("@")[0] || "User",
              username: username,
              role: (firebaseUser.email === "marzanleonardojrc@gmail.com" || firebaseUser.email === "marzan.leonardo04@gmail.com") ? "Admin" : "User",
              status: (firebaseUser.email === "marzanleonardojrc@gmail.com" || firebaseUser.email === "marzan.leonardo04@gmail.com") ? "Approved" : "Pending",
              createdAt: serverTimestamp()
            };
            await setDoc(doc(db, "users", firebaseUser.uid), newProfile);
            await setDoc(doc(db, "user_mappings", username), {
              username: username,
              email: firebaseUser.email
            });
            setProfile({ ...newProfile, createdAt: new Date().toISOString() } as UserProfile);
          }
        } else {
          setUser(null);
          setProfile(null);
        }
      } catch (err) {
        console.error("Auth Listener Error:", err);
        // If we can't fetch profile, we might still have the user
        // but the app should handle profile being null
      } finally {
        setLoading(false);
      }
    });
    return () => unsubscribe();
  }, []);

  const signIn = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err: any) {
      console.error("Login Error:", err);
      throw err;
    }
  };

  const signInWithEmail = async (emailOrUsername: string, pass: string) => {
    let emailToUse = emailOrUsername;
    if (!emailOrUsername.includes("@")) {
      const q = query(collection(db, "user_mappings"), where("username", "==", emailOrUsername.toLowerCase()));
      const snap = await getDocs(q);
      if (!snap.empty) {
        emailToUse = snap.docs[0].data().email;
      } else {
        throw new Error("auth/user-not-found");
      }
    }
    await signInWithEmailAndPassword(auth, emailToUse, pass);
  };

  const signUpWithEmail = async (email: string, pass: string, name: string, username: string) => {
    const q = query(collection(db, "user_mappings"), where("username", "==", username.toLowerCase()));
    const snap = await getDocs(q);
    if (!snap.empty) {
      throw new Error("auth/username-already-in-use");
    }

    const cred = await createUserWithEmailAndPassword(auth, email, pass);
    const newProfile: any = {
      uid: cred.user.uid,
      email,
      displayName: name,
      username: username.toLowerCase(),
      role: (email === "marzanleonardojrc@gmail.com" || email === "marzan.leonardo04@gmail.com") ? "Admin" : "User",
      status: (email === "marzanleonardojrc@gmail.com" || email === "marzan.leonardo04@gmail.com") ? "Approved" : "Pending",
      createdAt: serverTimestamp()
    };
    await setDoc(doc(db, "users", cred.user.uid), newProfile);
    await setDoc(doc(db, "user_mappings", username.toLowerCase()), {
      username: username.toLowerCase(),
      email: email
    });
    await updateProfile(cred.user, { displayName: name });
  };
  
  const updateUserName = async (name: string) => {
    if (!auth.currentUser) return;
    await updateProfile(auth.currentUser, { displayName: name });
    await updateDoc(doc(db, "users", auth.currentUser.uid), { displayName: name });
    // Profile will be updated by onAuthStateChanged/doc listener if we use a listener, 
    // but here we just manually update for immediate feedback
    setProfile(p => p ? { ...p, displayName: name } : null);
  };

  const updateUserUsername = async (username: string) => {
    if (!auth.currentUser || !profile) return;
    
    const formattedUsername = username.replace(/\s+/g, '').toLowerCase();
    
    // Check if new username is available
    let snap;
    try {
      const q = query(collection(db, "user_mappings"), where("username", "==", formattedUsername));
      snap = await getDocs(q);
    } catch(err: any) {
      console.error("user_mappings getDocs failed:", err);
      throw new Error(`getDocs user_mappings: ${err.message}`);
    }
    if (!snap.empty && snap.docs[0].id !== formattedUsername) {
      throw new Error("auth/username-already-in-use");
    }

    // Delete old mapping if exists
    if (profile.username) {
       try {
         await deleteDoc(doc(db, "user_mappings", profile.username));
       } catch(err: any) {
         console.error("deleteDoc on user_mappings failed:", err);
         throw new Error(`deleteDoc user_mappings: ${err.message}`);
       }
    }
    
    // Add new mapping
    try {
      await setDoc(doc(db, "user_mappings", formattedUsername), {
        username: formattedUsername,
        email: auth.currentUser.email
      });
    } catch(err: any) {
      console.error("setDoc on user_mappings failed:", err);
      throw new Error(`setDoc user_mappings: ${err.message}`);
    }
    
    // Update users doc
    try {
      await updateDoc(doc(db, "users", auth.currentUser.uid), { username: formattedUsername });
    } catch(err: any) {
      console.error("updateDoc on users failed:", err);
      throw new Error(`updateDoc users: ${err.message}`);
    }
    
    setProfile(p => p ? { ...p, username: formattedUsername } : null);
  };

  const updateUserPassword = async (pass: string) => {
    if (!auth.currentUser) return;
    await updatePassword(auth.currentUser, pass);
  };

  const resetPassword = async (emailOrUsername: string) => {
    let emailToUse = emailOrUsername;
    if (!emailOrUsername.includes("@")) {
      const q = query(collection(db, "user_mappings"), where("username", "==", emailOrUsername.toLowerCase()));
      const snap = await getDocs(q);
      if (!snap.empty) {
        emailToUse = snap.docs[0].data().email;
      } else {
        throw new Error("auth/user-not-found");
      }
    }
    await sendPasswordResetEmail(auth, emailToUse);
  };

  const logout = async () => {
    await signOut(auth);
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
      isAdmin: (isApproved && profile?.role === "Admin") || isAdminEmail,
      isEncoder: (isApproved && (profile?.role === "Admin" || profile?.role === "User" || profile?.role === "End-User")) || isAdminEmail,
      isGuest: isApproved && profile?.role === "Guest" && !isAdminEmail
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
