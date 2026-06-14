import React, { useState, useEffect } from "react";
import { useAuth } from "../AuthContext";
import { 
  BASIC_TAX_RATE, 
  SEF_TAX_RATE, 
  IDLE_LAND_RATE,
  calculateTotalDue 
} from "../lib/taxCalculations";
import { formatCurrency, cn } from "../lib/utils";
import { Calculator, Percent, ShieldCheck, AlertCircle, Info, CalendarClock } from "lucide-react";
import { motion } from "motion/react";

type TimingType = "advance" | "prompt" | "standard" | "delinquent";

export const TaxCalculator: React.FC = () => {
  const [assessedValueInput, setAssessedValueInput] = useState<string>("150000");
  const [classification, setClassification] = useState<"LAND" | "BUILDING" | "MACHINERY">("LAND");
  const [isIdleLand, setIsIdleLand] = useState<boolean>(false);
  const [timing, setTiming] = useState<TimingType>("standard");
  const [monthsDelinquent, setMonthsDelinquent] = useState<number>(12);
  const [paymentMode, setPaymentMode] = useState<"Full" | "Installment">("Full");
  const [selectedQuarter, setSelectedQuarter] = useState<string>("1st Qtr");

  // Calculated state
  const [results, setResults] = useState({
    basicTax: 0,
    sefTax: 0,
    idleSurcharge: 0,
    combinedBase: 0,
    discount: 0,
    interest: 0,
    totalDue: 0,
    interestRatePercent: 0,
    discountRatePercent: 0,
  });

  // Handle classification change - force idle land false if not land
  useEffect(() => {
    if (classification !== "LAND") {
      setIsIdleLand(false);
    }
  }, [classification]);

  useEffect(() => {
    const assessedVal = Math.max(0, parseFloat(assessedValueInput.replace(/,/g, "")) || 0);
    const basicTax = assessedVal * BASIC_TAX_RATE;
    const sefTax = assessedVal * SEF_TAX_RATE;
    const idleSurcharge = isIdleLand ? (assessedVal * IDLE_LAND_RATE) : 0;
    const combinedBase = basicTax + sefTax + idleSurcharge;

    const currentYear = new Date().getFullYear();
    let yearArg = currentYear;
    let timingDate = new Date();
    let isAdvanceArg = false;

    // Simulate dates based on timing
    if (timing === "advance") {
      yearArg = currentYear + 1; // Future year triggers 20% discount
      isAdvanceArg = true;
    } else if (timing === "prompt") {
      // Current year, but dated in February (Q1) to trigger 10% Prompt Discount
      yearArg = currentYear;
      timingDate = new Date(currentYear, 1, 15);
    } else if (timing === "standard") {
      // Current year, dated in June (Q2+) to avoid both prompt discount and penalties
      yearArg = currentYear;
      timingDate = new Date(currentYear, 5, 20);
    } else if (timing === "delinquent") {
      // Current year, but we will mock a penalty computation
      yearArg = currentYear;
    }

    // Call official calculator
    const qList = paymentMode === "Installment" ? [selectedQuarter] : [];
    const calc = calculateTotalDue(
      basicTax,
      sefTax,
      yearArg,
      timingDate,
      idleSurcharge,
      paymentMode,
      qList,
      isAdvanceArg
    );

    // If delinquent and payment mode is standard, mock manual delinquency month entry
    let finalInterest = calc.interest;
    let finalInterestRate = (calc.interestRate || 0) * 100;

    if (timing === "delinquent" && paymentMode === "Full") {
      // Back-calculate manual delinquency rate (2% per month up to 36 months / 72%)
      const cappedMonths = Math.min(36, monthsDelinquent);
      const customRate = cappedMonths * 0.02;
      finalInterest = combinedBase * customRate;
      finalInterestRate = customRate * 100;
    }

    const calculatedTotal = combinedBase + finalInterest - (timing === "delinquent" ? 0 : calc.discount);

    setResults({
      basicTax,
      sefTax,
      idleSurcharge,
      combinedBase,
      discount: timing === "delinquent" ? 0 : calc.discount,
      interest: finalInterest,
      totalDue: calculatedTotal,
      interestRatePercent: finalInterestRate,
      discountRatePercent: timing === "advance" ? 20 : timing === "prompt" ? 10 : 0,
    });
  }, [assessedValueInput, classification, isIdleLand, timing, monthsDelinquent, paymentMode, selectedQuarter]);

  const handleValueChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Sanitize input to only allows numbers and periods
    const val = e.target.value.replace(/[^0-9.]/g, "");
    setAssessedValueInput(val);
  };

  const handleBlur = () => {
    const parsed = parseFloat(assessedValueInput) || 0;
    setAssessedValueInput(parsed.toLocaleString("en-US", { maximumFractionDigits: 2 }));
  };

  const handleFocus = () => {
    setAssessedValueInput(prev => prev.replace(/,/g, ""));
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="bg-slate-900 border border-slate-800 rounded-3xl p-6 lg:p-8 shadow-2xl relative overflow-hidden h-full flex flex-col justify-between"
    >
      <div>
        {/* Header */}
        <div className="flex items-center gap-3.5 mb-6 border-b border-slate-800/60 pb-5">
          <div className="w-11 h-11 bg-blue-500/10 rounded-2xl flex items-center justify-center border border-blue-500/20">
            <Calculator className="w-5 h-5 text-blue-400" />
          </div>
          <div>
            <h3 className="text-base font-black text-white uppercase tracking-tighter">Tax Simulator</h3>
            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Simulate Estimated Annual Tax Due</p>
          </div>
        </div>

        {/* Inputs container */}
        <div className="space-y-4">
          {/* Assessed Value input */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block pl-1">
              Assessed Property Value (₱)
            </label>
            <div className="relative">
              <span className="absolute left-4 top-2.5 text-sm font-bold text-slate-600">₱</span>
              <input
                type="text"
                className="w-full pl-8 pr-4 py-2 bg-slate-950 border border-slate-800 rounded-xl text-slate-200 focus:ring-2 focus:ring-blue-500 outline-none transition-all font-mono text-sm leading-relaxed"
                value={assessedValueInput}
                onChange={handleValueChange}
                onBlur={handleBlur}
                onFocus={handleFocus}
                placeholder="e.g. 150,000"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Classification */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block pl-1">
                Classification
              </label>
              <select
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-slate-200 focus:ring-2 focus:ring-blue-500 outline-none transition-all cursor-pointer text-xs"
                value={classification}
                onChange={e => setClassification(e.target.value as any)}
              >
                <option value="LAND" className="bg-slate-950">LAND</option>
                <option value="BUILDING" className="bg-slate-950">BUILDING</option>
                <option value="MACHINERY" className="bg-slate-950">MACHINERY</option>
              </select>
            </div>

            {/* Timing */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block pl-1">
                Payment Timing
              </label>
              <select
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-slate-200 focus:ring-2 focus:ring-blue-500 outline-none transition-all cursor-pointer text-xs"
                value={timing}
                onChange={e => setTiming(e.target.value as TimingType)}
              >
                <option value="advance">Advance (20% Disc)</option>
                <option value="prompt">Prompt Q1 (10% Disc)</option>
                <option value="standard">Standard Rate</option>
                <option value="delinquent">Delinquent / Late</option>
              </select>
            </div>
          </div>

          {/* Conditional Input block for Delinquent Months */}
          {timing === "delinquent" && paymentMode === "Full" && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              className="space-y-1.5 pb-2 origin-top border-t border-dashed border-slate-800/60 pt-3"
            >
              <div className="flex justify-between items-center px-1">
                <label className="text-[10px] font-black text-rose-500 uppercase tracking-widest">
                  Months Delinquent
                </label>
                <span className="text-[11px] font-bold text-rose-400 font-mono">
                  {monthsDelinquent} mos ({Math.min(72, monthsDelinquent * 2)}% penalty)
                </span>
              </div>
              <input
                type="range"
                min="1"
                max="36"
                className="w-full h-1.5 bg-slate-950 rounded-lg appearance-none cursor-pointer accent-rose-500 border border-slate-800"
                value={monthsDelinquent}
                onChange={e => setMonthsDelinquent(parseInt(e.target.value))}
              />
            </motion.div>
          )}

          {/* Extra options box */}
          <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800 space-y-3">
            {/* Payment Mode toggles */}
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Payment Mode</span>
              <div className="flex bg-slate-900 border border-slate-800 rounded-lg p-0.5">
                {(["Full", "Installment"] as const).map(mode => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setPaymentMode(mode)}
                    className={cn(
                      "px-2.5 py-1 text-[9px] font-black uppercase rounded-md tracking-wider transition-all",
                      paymentMode === mode
                        ? "bg-blue-600 text-white"
                        : "text-slate-400 hover:text-slate-200"
                    )}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </div>

            {/* Installment configuration details */}
            {paymentMode === "Installment" && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                className="flex items-center justify-between border-t border-slate-800/60 pt-2.5"
              >
                <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Selected Installment</span>
                <select
                  value={selectedQuarter}
                  onChange={e => setSelectedQuarter(e.target.value)}
                  className="px-2.5 py-1 bg-slate-900 border border-slate-800 rounded text-[10px] font-bold text-slate-300 pointer-events-auto"
                >
                  <option value="1st Qtr">1st Quarter (25%)</option>
                  <option value="2nd Qtr">2nd Quarter (25%)</option>
                  <option value="3rd Qtr">3rd Quarter (25%)</option>
                  <option value="4th Qtr">4th Quarter (25%)</option>
                </select>
              </motion.div>
            )}

            {/* Surcharge Option for LAND */}
            {classification === "LAND" && (
              <div className="flex items-center justify-between border-t border-slate-800/60 pt-2.5">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Is Idle Land?</span>
                  <span className="text-[9px] text-amber-500/80 bg-amber-500/10 border border-amber-500/20 px-1 py-0.2 rounded font-mono">+5%</span>
                </div>
                <input
                  type="checkbox"
                  checked={isIdleLand}
                  onChange={e => setIsIdleLand(e.target.checked)}
                  className="w-4 h-4 rounded bg-slate-900 border-slate-800 text-blue-600 focus:ring-0 cursor-pointer"
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Audit-grade Calculation Breakdown Panel */}
      <div className="mt-6 border-t border-slate-800/60 pt-4 space-y-3.5">
        <h4 className="text-[10px] font-black text-blue-400 uppercase tracking-widest block mb-2 pl-0.5">
          Tax Computation Details
        </h4>
        
        <div className="space-y-2 font-mono text-[11px] text-slate-400">
          <div className="flex justify-between items-center">
            <span>Basic Tax (1% Rate)</span>
            <span className="text-slate-200">{formatCurrency(results.basicTax)}</span>
          </div>
          
          <div className="flex justify-between items-center">
            <span>SEF General Levy (1% Rate)</span>
            <span className="text-slate-200">{formatCurrency(results.sefTax)}</span>
          </div>

          {results.idleSurcharge > 0 && (
            <div className="flex justify-between items-center text-amber-400/90">
              <span className="flex items-center gap-1">Idle Surcharge (5% Rate)</span>
              <span>{formatCurrency(results.idleSurcharge)}</span>
            </div>
          )}

          {results.discount > 0 && (
            <div className="flex justify-between items-center text-emerald-400 font-bold bg-emerald-500/5 px-2.5 py-1 rounded-lg border border-emerald-500/10">
              <span className="flex items-center gap-1">
                <Percent className="w-3.5 h-3.5" />
                {results.discountRatePercent}% timing deduction
              </span>
              <span>-{formatCurrency(results.discount)}</span>
            </div>
          )}

          {results.interest > 0 && (
            <div className="flex justify-between items-center text-rose-400 font-bold bg-rose-500/5 px-2.5 py-1 rounded-lg border border-rose-500/10">
              <span className="flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5 text-rose-500" />
                +{results.interestRatePercent}% penalty delinquency
              </span>
              <span>+{formatCurrency(results.interest)}</span>
            </div>
          )}
        </div>

        {/* Summed Total box */}
        <div className="p-4 bg-blue-500/5 border border-blue-500/15 rounded-2xl flex flex-col items-center justify-center space-y-1 mt-1 text-center">
          <span className="text-[9px] font-black text-blue-400 uppercase tracking-widest flex items-center gap-1">
            <ShieldCheck className="w-3.5 h-3.5" />
            Estimated Simulated Due
          </span>
          <span className="text-2xl font-black text-white font-mono tracking-tight">
            {formatCurrency(results.totalDue)}
          </span>
          {paymentMode === "Installment" && (
            <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mt-0.5">
              Corresponds to {selectedQuarter} only
            </span>
          )}
        </div>
      </div>
    </motion.div>
  );
};
