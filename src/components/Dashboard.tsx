import React, { useEffect, useState } from "react";
import { 
  collection, 
  onSnapshot,
  db,
  handleFirestoreError,
  OperationType 
} from "../lib/firebase";
import { Delinquency, Payment } from "../types";
import { formatCurrency, cn } from "../lib/utils";
import { calculateTotalDue } from "../lib/taxCalculations";
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  Cell
} from "recharts";
import { TrendingUp, Users, AlertCircle, CheckCircle2 } from "lucide-react";
import { motion } from "motion/react";
import { useAuth } from "../AuthContext";
import { TaxCalculator } from "./TaxCalculator";
import { CollectionChart } from "./CollectionChart";

const Dashboard: React.FC = () => {
  const { profile, user, isAdmin } = useAuth();
  const firstName = isAdmin ? "Admin" : (profile?.displayName || user?.displayName || "User").split(" ")[0];

  const [activeChartTab, setActiveChartTab] = useState<"collections" | "delinquencies">("collections");

  const [stats, setStats] = useState({
    totalDelinquent: 0,
    totalPaid: 0,
    totalAmountDue: 0,
    propertyCount: 0
  });
  const [chartData, setChartData] = useState<any[]>([]);

  const [rawDelinq, setRawDelinq] = useState<Delinquency[]>([]);
  const [rawProps, setRawProps] = useState<{ id: string }[]>([]);
  const [rawPayments, setRawPayments] = useState<Payment[]>([]);

  useEffect(() => {
    const unsubDelinq = onSnapshot(collection(db, "delinquencies"), (snapshot) => {
      setRawDelinq(snapshot.docs.map(doc => doc.data() as Delinquency));
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, "delinquencies");
    });

    const unsubProp = onSnapshot(collection(db, "properties"), (snapshot) => {
      setRawProps(snapshot.docs.map(doc => ({ id: doc.id })));
      setStats(prev => ({ ...prev, propertyCount: snapshot.size }));
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, "properties");
    });

    const unsubPayments = onSnapshot(collection(db, "payments"), (snapshot) => {
      setRawPayments(snapshot.docs.map(doc => doc.data() as Payment));
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, "payments");
    });

    return () => {
      unsubDelinq();
      unsubProp();
      unsubPayments();
    };
  }, []);

  useEffect(() => {
    const validRecords = rawDelinq.filter(d => rawProps.some(p => p.id === d.propertyId));
    
    const computedStats = validRecords.reduce((acc, curr) => {
      const hasPayment = rawPayments.some(p => p.propertyId === curr.propertyId && p.taxYear === curr.year && p.status === "Active");
      const isPaid = curr.status === "Paid" || hasPayment;

      if (!isPaid) {
        acc.delinquentProps.add(curr.propertyId);
        // Receivables = Full Assessed Value (Basic Tax Due / 0.01)
        const assessedValue = curr.basicTaxDue / 0.01;
        acc.totalAmountDue += assessedValue;
      } else {
        acc.paidProps.add(curr.propertyId);
      }
      return acc;
    }, { delinquentProps: new Set<string>(), paidProps: new Set<string>(), totalAmountDue: 0 });

    const yearGroups = validRecords.reduce((acc: any, curr) => {
      const hasPayment = rawPayments.some(p => p.propertyId === curr.propertyId && p.taxYear === curr.year && p.status === "Active");
      const isPaid = curr.status === "Paid" || hasPayment;

      if (!isPaid) {
        const year = curr.year?.toString() || "Unknown";
        const assessedValue = (curr.basicTaxDue || 0) / 0.01;
        acc[year] = (acc[year] || 0) + assessedValue;
      }
      return acc;
    }, {});

    const newChartData = Object.keys(yearGroups).map(year => ({
      year,
      amount: yearGroups[year]
    })).sort((a, b) => a.year.localeCompare(b.year));

    setStats(prev => ({
      ...prev,
      totalDelinquent: computedStats.delinquentProps.size,
      totalPaid: computedStats.paidProps.size,
      totalAmountDue: computedStats.totalAmountDue
    }));
    setChartData(newChartData);
  }, [rawDelinq, rawProps, rawPayments]);

  const statCards = [
    { label: "Accounts Delinquent", value: stats.totalDelinquent, icon: AlertCircle, color: "text-red-400", bg: "bg-red-500/5", border: "border-red-500/20" },
    { label: "Total Receivables", value: formatCurrency(stats.totalAmountDue), icon: TrendingUp, color: "text-indigo-400", bg: "bg-indigo-500/5", border: "border-indigo-500/20" },
    { label: "Registered Properties", value: stats.propertyCount, icon: Users, color: "text-blue-400", bg: "bg-blue-500/5", border: "border-blue-500/20" },
    { label: "Paid This Year", value: stats.totalPaid, icon: CheckCircle2, color: "text-emerald-400", bg: "bg-emerald-500/5", border: "border-emerald-500/20" },
  ];

  return (
    <div className="space-y-8">
      <div className="mb-4">
        <h1 className="text-3xl font-black text-white tracking-tight">Welcome, {firstName}!</h1>
      </div>
      <div className="flex items-end justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white tracking-tight">Executive Control</h2>
          <p className="text-slate-500 text-sm mt-1">Real-time financial status across all property jurisdictions.</p>
        </div>
        <div className="text-right">
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Status Code</p>
          <div className="px-3 py-1 bg-indigo-500/10 border border-indigo-500/20 rounded text-[10px] font-mono text-indigo-400">
            HEALTH_OPTIMAL_V2
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {statCards.map((card, idx) => (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.1 }}
            key={card.label}
            className={cn("p-6 rounded-2xl border bg-slate-900/40 backdrop-blur-sm shadow-xl transition-all hover:translate-y-[-4px]", card.border)}
          >
            <div className="flex items-center justify-between mb-4">
              <div className={cn("p-2 rounded-lg bg-slate-800 border", card.border)}>
                <card.icon className={cn("w-5 h-5", card.color)} />
              </div>
            </div>
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">{card.label}</p>
            <p className="text-2xl font-bold text-white tracking-tight">{card.value}</p>
          </motion.div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-stretch">
        <div className="lg:col-span-2 flex flex-col gap-4">
          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between border-b border-slate-800/40 pb-3">
            <div className="flex bg-slate-950 border border-slate-800 rounded-xl p-0.5">
              <button
                type="button"
                onClick={() => setActiveChartTab("collections")}
                className={cn(
                  "px-4 py-1.5 text-[9px] font-black uppercase tracking-wider rounded-lg transition-all cursor-pointer",
                  activeChartTab === "collections"
                    ? "bg-indigo-600 text-white shadow-lg"
                    : "text-slate-400 hover:text-slate-200"
                )}
              >
                Collection Analytics
              </button>
              <button
                type="button"
                onClick={() => setActiveChartTab("delinquencies")}
                className={cn(
                  "px-4 py-1.5 text-[9px] font-black uppercase tracking-wider rounded-lg transition-all cursor-pointer",
                  activeChartTab === "delinquencies"
                    ? "bg-indigo-600 text-white shadow-lg"
                    : "text-slate-400 hover:text-slate-200"
                )}
              >
                Delinquency Topology
              </button>
            </div>
            <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest leading-relaxed pr-1">
              Select Chart Perspective
            </span>
          </div>

          <div className="flex-1">
            {activeChartTab === "collections" ? (
              <CollectionChart />
            ) : (
              <motion.div
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                className="p-8 bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl relative overflow-hidden flex flex-col justify-between h-full"
              >
                <div className="absolute top-0 right-0 p-8 opacity-5">
                   <TrendingUp className="w-32 h-32 text-indigo-500" />
                </div>
                <div className="mb-8 flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-bold text-white tracking-tight">Financial Topology</h3>
                    <p className="text-slate-500 text-sm">Historical delinquency accumulation by taxable year.</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-indigo-500"></span>
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Growth Metric</span>
                  </div>
                </div>
                <div className="h-[400px] w-full flex-1 min-h-[300px]">
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
                        itemStyle={{ color: '#818cf8', fontWeight: 'bold' }}
                        formatter={(val: number) => [formatCurrency(val), "Receivable Amount"]}
                      />
                      <Bar dataKey="amount" radius={[4, 4, 0, 0]}>
                        {chartData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={index % 2 === 0 ? '#6366f1' : '#4f46e5'} fillOpacity={0.8} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </motion.div>
            )}
          </div>
        </div>

        <div className="lg:col-span-1">
          <TaxCalculator />
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
