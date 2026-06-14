import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail } from 'firebase/auth';
import { 
  initializeFirestore,
  memoryLocalCache,
  collection, 
  doc, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  getDoc, 
  getDocs, 
  onSnapshot, 
  query, 
  where, 
  orderBy, 
  limit, 
  serverTimestamp, 
  setDoc,
  getDocFromServer,
  writeBatch,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

// Overwrite localStorage.setItem and sessionStorage.setItem to catch and ignore QuotaExceededError
try {
  if (typeof window !== 'undefined') {
    if (window.localStorage) {
      const originalSetItem = window.localStorage.setItem;
      window.localStorage.setItem = function (key, value) {
        try {
          originalSetItem.call(window.localStorage, key, value);
        } catch (err: any) {
          if (err.name === 'QuotaExceededError' || err.code === 22 || err.message?.includes('quota') || err.message?.includes('Storage')) {
            console.warn(`[LocalStorage Patch] Intercepted QuotaExceededError for key: "${key}". Clearing non-essential keys...`);
            try {
              // Clear non-essential items
              const keysToRemove: string[] = [];
              for (let i = 0; i < window.localStorage.length; i++) {
                const k = window.localStorage.key(i);
                if (k && k !== 'theme' && k !== 'rpt_offline_sync_queue') {
                  keysToRemove.push(k);
                }
              }
              keysToRemove.forEach(k => {
                try { window.localStorage.removeItem(k); } catch (e) {}
              });
              // Try again
              originalSetItem.call(window.localStorage, key, value);
            } catch (retryErr) {
              // If it still fails, just swallow the error to prevent crash
              console.warn('[LocalStorage Patch] Storage is completely full or restricted. Ignoring setItem call for:', key);
            }
          } else {
            throw err;
          }
        }
      };
    }

    if (window.sessionStorage) {
      const originalSetSessionItem = window.sessionStorage.setItem;
      window.sessionStorage.setItem = function (key, value) {
        try {
          originalSetSessionItem.call(window.sessionStorage, key, value);
        } catch (err: any) {
          if (err.name === 'QuotaExceededError' || err.code === 22 || err.message?.includes('quota') || err.message?.includes('Storage')) {
            console.warn(`[SessionStorage Patch] Intercepted QuotaExceededError for key: "${key}". Clearing non-essential keys...`);
            try {
              window.sessionStorage.clear();
              originalSetSessionItem.call(window.sessionStorage, key, value);
            } catch (retryErr) {
              console.warn('[SessionStorage Patch] Storage is completely full. Ignoring setItem call for:', key);
            }
          } else {
            throw err;
          }
        }
      };
    }
  }
} catch (err) {
  console.warn('Error applying storage patches:', err);
}

// Clear Firestore-related localStorage metadata that causes QuotaExceededError
try {
  if (typeof window !== 'undefined' && window.localStorage) {
    const keysToRemove: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key && (key.startsWith('firestore_') || key.includes('firestore_mutations') || key.includes('firestore_targets'))) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(k => {
      try {
        window.localStorage.removeItem(k);
      } catch (e) {
        // Ignore
      }
    });
    if (keysToRemove.length > 0) {
      console.log(`[LocalStorage Cleanup] Cleared ${keysToRemove.length} outdated Firestore local-storage sync keys to prevent QuotaExceededError.`);
    }
  }
} catch (err) {
  console.warn('Error clearing Firestore localStorage keys:', err);
}

const app = initializeApp(firebaseConfig);
export const db = initializeFirestore(app, {
  localCache: memoryLocalCache()
}, firebaseConfig.firestoreDatabaseId);

console.log('[Firestore] Local cache is configured to use in-memory storage to completely prevent QuotaExceededError in restricted iframe environments.');

export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

// Export Firebase methods
export {
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
  setDoc,
  getDocFromServer,
  writeBatch,
  GoogleAuthProvider
};

async function testConnection() {
  try {
    // Try to fetch a non-existent doc from the server to verify connectivity
    // Using a timeout-like approach
    await getDocFromServer(doc(db, 'system', 'connection-test')).catch(err => {
      if (err.message?.includes('offline')) throw err;
      // Other errors might mean just "not found" or "no permissions" which is fine for connection test
      return null;
    });
    console.log("Firestore connection verified.");
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.warn("Firestore is currently in offline mode. This is often due to network issues or browser restrictions.");
    }
  }
}

// Only run connection test if in development or specific flag set
if (process.env.NODE_ENV !== 'production') {
  testConnection();
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}
