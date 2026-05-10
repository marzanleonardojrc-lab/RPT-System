import React, { useState } from "react";
import { signInWithEmailAndPassword, auth } from "../lib/firebase";
import { Lock, X } from "lucide-react";

interface AdminAuthDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

export default function AdminAuthDialog({ isOpen, onClose, onConfirm }: AdminAuthDialogProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      // Re-authenticate using the provided credentials
      await signInWithEmailAndPassword(auth, email, password);
      
      // If successful, run the confirm action
      await onConfirm();
      
      // Clear and close
      setEmail("");
      setPassword("");
      onClose();
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Authentication failed. Please check credentials.");
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
            Security policy requires re-authentication to perform this destructive action. Please enter your administrator email and password.
          </p>

          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">Admin Email</label>
            <input 
              type="email" 
              required
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-red-500"
              value={email}
              onChange={e => setEmail(e.target.value)}
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
              {error}
            </div>
          )}

          <div className="flex gap-2 mt-6">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 bg-slate-800 text-slate-300 rounded-xl font-bold hover:bg-slate-700 transition"
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 px-4 py-2 bg-red-600 text-white rounded-xl font-bold hover:bg-red-500 transition disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={loading}
            >
              {loading ? "Verifying..." : "Confirm Deletion"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
