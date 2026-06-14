import React, { useEffect, useState, useMemo } from "react";
import { 
  collection, 
  onSnapshot,
  db,
  handleFirestoreError,
  OperationType 
} from "../lib/firebase";
import { Payment, Property } from "../types";
import { formatCurrency, cn } from "../lib/utils";
import { DIPACULAO_BARANGAYS } from "../constants";
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  Legend
} from "recharts";
import { Landmark, TrendingUp, DollarSign, Percent, ShieldCheck, Filter } from "lucide-react";
import { motion } from "motion/react";

export const CollectionChart: React.FC = () => {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [selectedBarangay, setSelectedBarangay] = useState<string>("all");

  // Subscribe to real-time streams
  useEffect(() => {
    const unsubPayments = onSnapshot(collection(db, "payments"), (snapshot) => {
      const fetched = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Payment));
      setPayments(fetched);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, "payments");
      setLoading(false);
    });

    const unsubProps = onSnapshot(collection(db, "properties"), (snapshot) => {
      const fetched = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Property));
      setProperties(fetched);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, "properties");
    });

    return () => {
      unsubPayments();
      unsubProps();
    };
  }, []);

  // Use the 25 standard barangays of Dipaculao plus any custom ones from registered properties
  const uniqueBarangays = useMemo(() => {
    const brgys = new Set<string>(DIPACULAO_BARANGAYS);
    properties.forEach(p => {
      if (p.isArchived) return;
      if (p.barangay && p.barangay.trim()) {
        brgys.add(p.barangay.trim());
      }
    });
    return Array.from(brgys).sort();
  }, [properties]);

  // Aggregate active collection data by taxYear, filtered by barangay
  const chartData = useMemo(() => {
    const groups: { [year: string]: { basic: number; sef: number; penalty: number; total: number } } = {};

    const filtered = payments.filter(pmt => {
      // Only visualize Active (non-voided) collections
      if (pmt.status !== "Active") return false;

      const prop = properties.find(p => p.id === pmt.propertyId);
      if (!prop || prop.isArchived) return false;

      if (selectedBarangay === "all") return true;
      return prop?.barangay === selectedBarangay;
    });

    filtered.forEach(pmt => {
      const year = pmt.taxYear?.toString() || "Unknown";
      if (!groups[year]) {
        groups[year] = { basic: 0, sef: 0, penalty: 0, total: 0 };
      }
      groups[year].basic += pmt.basicPaid || 0;
      groups[year].sef += pmt.sefPaid || 0;
      groups[year].penalty += pmt.penaltyPaid || 0;
      groups[year].total += pmt.amountPaid || 0;
    });

    return Object.keys(groups).map(year => ({
      year,
      basic: groups[year].basic,
      sef: groups[year].sef,
      penalty: groups[year].penalty,
      total: groups[year].total
    })).sort((a, b) => a.year.localeCompare(b.year));
  }, [payments, properties, selectedBarangay]);

  // Total summary statistics for the selected sub-scope
  const metrics = useMemo(() => {
    let totalPaid = 0;
    let totalBasic = 0;
    let totalSef = 0;
    let totalPenalty = 0;
    let transactionCount = 0;

    payments.forEach(pmt => {
      if (pmt.status !== "Active") return;

      const prop = properties.find(p => p.id === pmt.propertyId);
      if (!prop || prop.isArchived) return;

      if (selectedBarangay !== "all") {
        if (prop?.barangay !== selectedBarangay) return;
      }

      totalPaid += pmt.amountPaid || 0;
      totalBasic += pmt.basicPaid || 0;
      totalSef += pmt.sefPaid || 0;
      totalPenalty += pmt.penaltyPaid || 0;
      transactionCount++;
    });

    return {
      totalPaid,
      totalBasic,
      totalSef,
      totalPenalty,
      transactionCount
    };
  }, [payments, properties, selectedBarangay]);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      className="p-8 bg-[#0f172b] border border-slate-800 rounded-2xl shadow-2xl relative overflow-hidden flex flex-col justify-between"
    >
      {/* Decorative background logo */}
      <div className="absolute top-0 right-0 p-8 opacity-5">
        <Landmark className="w-32 h-32 text-blue-500" />
      </div>

      {/* Header controls section */}
      <div className="mb-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4 z-10">
        <div>
          <h3 className="text-lg font-bold text-white tracking-tight">Revenue Collection Trend</h3>
          <p className="text-slate-500 text-sm">Realized tax receipts from payments grouped by taxable period.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-500 text-xs font-bold">
            <Filter className="w-3.5 h-3.5 text-blue-400" />
            <span className="uppercase tracking-wider text-[9px]">Brgy:</span>
          </div>
          <select
            value={selectedBarangay}
            onChange={e => setSelectedBarangay(e.target.value)}
            className="px-4 py-1.5 bg-slate-950 border border-slate-800 hover:border-slate-700 rounded-xl text-xs font-bold text-slate-200 focus:ring-2 focus:ring-blue-500 outline-none cursor-pointer transition-all min-w-[150px] shadow-lg leading-relaxed justify-between flex items-center"
          >
            <option value="all" className="bg-slate-950">All Barangays</option>
            {uniqueBarangays.map(b => (
              <option key={b} value={b} className="bg-slate-950">{b}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Mini metrics cards block */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6 z-10 font-mono text-xs">
        <div className="p-3 bg-slate-950/40 border border-slate-800/80 rounded-xl">
          <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest block">Collected Net</span>
          <span className="text-sm font-black text-emerald-400 mt-1 block">{formatCurrency(metrics.totalPaid)}</span>
        </div>
        <div className="p-3 bg-slate-950/40 border border-slate-800/80 rounded-xl">
          <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest block">Basic Portions</span>
          <span className="text-sm font-bold text-slate-300 mt-1 block">{formatCurrency(metrics.totalBasic)}</span>
        </div>
        <div className="p-3 bg-slate-950/40 border border-slate-800/80 rounded-xl">
          <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest block">SEF Levy Portions</span>
          <span className="text-sm font-bold text-slate-300 mt-1 block">{formatCurrency(metrics.totalSef)}</span>
        </div>
        <div className="p-3 bg-slate-950/40 border border-slate-800/80 rounded-xl">
          <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest block">Surcharges / Interest</span>
          <span className="text-sm font-bold text-amber-500/90 mt-1 block">{formatCurrency(metrics.totalPenalty)}</span>
        </div>
      </div>

      {/* Chart container */}
      <div className="h-[400px] w-full flex-1 min-h-[300px] z-10">
        {loading ? (
          <div className="w-full h-full flex flex-col items-center justify-center text-slate-500 gap-2">
            <div className="w-8 h-8 border-2 border-blue-500/20 border-t-blue-500 rounded-full animate-spin" />
            <span className="text-[10px] uppercase tracking-widest font-bold">Querying receipts dataset...</span>
          </div>
        ) : chartData.length === 0 ? (
          <div className="w-full h-full flex flex-col items-center justify-center text-slate-500 text-center p-8 bg-slate-950/20 rounded-xl border border-dashed border-slate-800/60">
            <p className="font-bold text-sm text-slate-400">No Realized Collections</p>
            <p className="text-[10px] text-slate-600 mt-1 max-w-sm font-medium">There are no documented active payments recorded in the database for the selected barangay scope.</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1e293b" />
              <XAxis 
                dataKey="year" 
                axisLine={false} 
                tickLine={false} 
                tick={{ fontSize: 11, fill: '#64748b', fontWeight: 'bold' }}
                dy={10}
              />
              <YAxis 
                axisLine={false} 
                tickLine={false} 
                tick={{ fontSize: 11, fill: '#64748b' }}
                tickFormatter={(val) => `₱${val/1000}k`}
              />
              <Tooltip 
                cursor={{ fill: '#ffffff05' }}
                contentStyle={{ 
                  backgroundColor: '#0f172a', 
                  borderRadius: '12px', 
                  border: '1px solid #1e293b', 
                  boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.5)',
                  color: '#f1f5f9'
                }}
                formatter={(value: any, name: string) => {
                  const label = name === "basic" ? "Basic Tax" : name === "sef" ? "SEF Levy" : name === "penalty" ? "Interest / Penalties" : "Subtotal";
                  return [formatCurrency(Number(value)), label];
                }}
              />
              <Legend 
                verticalAlign="bottom" 
                height={36}
                iconType="circle"
                wrapperStyle={{ fontSize: '10px', fontWeight: 'black', paddingTop: '15px' }}
                formatter={(value) => {
                  return <span className="text-slate-400 uppercase tracking-widest text-[9px]">{value === "basic" ? "Basic Levy" : value === "sef" ? "SEF General" : "Late Penalties"}</span>;
                }}
              />
              {/* Stacked Bars representing different elements of RPT */}
              <Bar dataKey="basic" stackId="a" fill="#3b82f6" radius={[0, 0, 0, 0]} fillOpacity={0.8} />
              <Bar dataKey="sef" stackId="a" fill="#6366f1" radius={[0, 0, 0, 0]} fillOpacity={0.80} />
              <Bar dataKey="penalty" stackId="a" fill="#f59e0b" radius={[4, 4, 0, 0]} fillOpacity={0.85} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </motion.div>
  );
};
