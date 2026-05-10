import React, { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X, CreditCard, Calendar, User, FileText, CheckCircle2 } from "lucide-react";
import { Delinquency, Property, PaymentDetails } from "../types";
import { formatCurrency } from "../lib/utils";

interface PaymentFormProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (details: Omit<PaymentDetails, "recordedBy" | "recordedAt">) => void;
  delinquency: Delinquency;
  property: Property;
}

const PaymentForm: React.FC<PaymentFormProps> = ({ isOpen, onClose, onConfirm, delinquency, property }) => {
  const [formData, setFormData] = useState({
    orNumber: "",
    paymentDate: new Date().toISOString().split("T")[0],
    payerName: property.ownerName,
    paymentType: "Full" as "Full" | "Partial" | "Installment",
    amountPaid: delinquency.totalDue
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.orNumber || !formData.payerName || !formData.amountPaid) return;
    onConfirm(formData);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-slate-950/80 backdrop-blur-md"
            onClick={onClose}
          />
          <motion.div
            initial={{ scale: 0.95, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 20 }}
            className="relative bg-slate-900 border border-slate-800 rounded-3xl shadow-3xl w-full max-w-xl overflow-hidden"
          >
            <div className="p-6 border-b border-slate-800 flex items-center justify-between bg-emerald-500/5">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-emerald-500/10 rounded-xl">
                  <CreditCard className="w-5 h-5 text-emerald-400" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white">Payment Verification</h3>
                  <p className="text-xs text-slate-400">Authorize tax clearance for FY{delinquency.year}</p>
                </div>
              </div>
              <button onClick={onClose} className="p-2 hover:bg-slate-800 rounded-xl transition-colors">
                <X className="w-5 h-5 text-slate-500" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-1">Official Receipt (OR#)</label>
                  <div className="relative">
                    <FileText className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <input
                      required
                      value={formData.orNumber}
                      onChange={e => setFormData(p => ({ ...p, orNumber: e.target.value }))}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl py-3 pl-10 pr-4 text-sm text-white focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all outline-none"
                      placeholder="e.g. 1234567-A"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-1">Payment Date</label>
                  <div className="relative">
                    <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <input
                      type="date"
                      required
                      value={formData.paymentDate}
                      onChange={e => setFormData(p => ({ ...p, paymentDate: e.target.value }))}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl py-3 pl-10 pr-4 text-sm text-white focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all outline-none"
                    />
                  </div>
                </div>

                <div className="space-y-2 md:col-span-2">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-1">Payer Name</label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <input
                      required
                      value={formData.payerName}
                      onChange={e => setFormData(p => ({ ...p, payerName: e.target.value }))}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl py-3 pl-10 pr-4 text-sm text-white focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all outline-none"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-1">Payment Type</label>
                  <select
                    value={formData.paymentType}
                    onChange={e => setFormData(p => ({ ...p, paymentType: e.target.value as any }))}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl py-3 px-4 text-sm text-white focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all outline-none"
                  >
                    <option value="Full">Full Payment</option>
                    <option value="Partial">Partial Payment</option>
                    <option value="Installment">Installment</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-1">Amount Paid</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm font-bold">₱</span>
                    <input
                      type="number"
                      required
                      value={formData.amountPaid}
                      onChange={e => setFormData(p => ({ ...p, amountPaid: Number(e.target.value) }))}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl py-3 pl-8 pr-4 text-sm text-white font-mono focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all outline-none"
                    />
                  </div>
                </div>
              </div>

              <div className="p-4 bg-slate-950/50 rounded-2xl border border-slate-800 space-y-2">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-500 uppercase font-bold tracking-widest">Total Liability (FY{delinquency.year})</span>
                  <span className="text-white font-bold font-mono">{formatCurrency(delinquency.totalDue)}</span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-500 uppercase font-bold tracking-widest">Accumulated Penalties</span>
                  <span className="text-red-400 font-bold font-mono">{formatCurrency(delinquency.penalty)}</span>
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 py-4 bg-slate-800 hover:bg-slate-700 text-white rounded-2xl text-sm font-bold transition-all"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-[2] py-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-2xl text-sm font-bold transition-all shadow-lg shadow-emerald-600/20 flex items-center justify-center gap-2"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  Finalize Tax Settlement
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

export default PaymentForm;
