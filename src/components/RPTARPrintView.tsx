import React from "react";
import { Property, Delinquency, Payment } from "../types";
import { calculateTotalDue, groupDelinquenciesByPenaltyRule, BASIC_TAX_RATE } from "../lib/taxCalculations";
import { formatCurrency, formatDate } from "../lib/utils";

interface RPTARPrintViewProps {
  property: Property;
  history: Delinquency[];
  payments: Payment[];
  onClose: () => void;
}

export const RPTARPrintView: React.FC<RPTARPrintViewProps> = ({
  property,
  history,
  payments,
  onClose,
}) => {
  const handlePrint = () => {
    window.print();
  };

  // Generate Ledger Rows
  const ledgerRows: any[] = [];
  
  // Apply grouping rule to history
  const groupedHistory = groupDelinquenciesByPenaltyRule(history, property.assessedValue);
  
  groupedHistory.forEach(row => {
    // 1. Add Assessment Row (Initial Tax Due)
    // For grouped rows, we use the display year and aggregated values
    ledgerRows.push({
      type: 'assessment',
      year: row.yearDisplay,
      assessedValue: property.assessedValue, // For grouped rows, we assume uniform A.V. as per rule
      basicDue: row.totalBasic,
      sefDue: row.totalSef,
      penaltyDue: row.totalInterest,
      totalDue: row.totalDue,
      basicCol: 0,
      sefCol: 0,
      penaltyCol: 0,
      totalCol: 0,
      orNumber: '',
      date: '',
      clerk: property.recordedBy || '',
      status: row.years.length > 1 ? "Delinquent" : (history.find(h => h.year === row.years[0])?.status || "Delinquent")
    });

    // 2. Add Payment Rows for each year in the group if they exist
    row.years.forEach(year => {
      const record = history.find(h => h.year === year);
      if (!record) return;

      const recordPayments = payments.filter(p => p.delinquencyId === record.id)
        .sort((a,b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime());
      
      recordPayments.forEach(p => {
        ledgerRows.push({
          type: 'payment',
          year: year,
          basicDue: 0,
          sefDue: 0,
          penaltyDue: 0,
          totalDue: 0,
          basicCol: p.status === 'Voided' ? 0 : p.basicPaid,
          sefCol: p.status === 'Voided' ? 0 : p.sefPaid,
          penaltyCol: p.status === 'Voided' ? 0 : p.penaltyPaid,
          totalCol: p.status === 'Voided' ? 0 : p.amountPaid,
          orNumber: p.status === 'Voided' ? `${p.orNumber} (VOID)` : p.orNumber,
          date: p.paymentDate,
          clerk: p.recordedBy ? (p.recordedBy.includes('@') ? p.recordedBy.split('@')[0].toUpperCase() : p.recordedBy.toUpperCase()) : '',
          status: p.status
        });
      });
    });
  });

  // Calculate Running Balances
  let runningBasic = 0;
  let runningSef = 0;
  let runningPenalty = 0;
  let runningTotal = 0;

  const finalRows = ledgerRows.map(row => {
    runningBasic += row.basicDue - row.basicCol;
    runningSef += row.sefDue - row.sefCol;
    runningPenalty += row.penaltyDue - row.penaltyCol;
    runningTotal += row.totalDue - row.totalCol;

    return {
      ...row,
      balBasic: runningBasic,
      balSef: runningSef,
      balPenalty: runningPenalty,
      balTotal: runningTotal
    };
  });

  return (
    <div className="fixed inset-0 bg-white text-black z-[9999] overflow-auto text-[11px] font-sans">
      <style dangerouslySetInnerHTML={{ __html: `
        @media print {
          @page {
            size: 14in 8.5in;
            margin: 0.5in;
          }
          body {
            print-color-adjust: exact;
            -webkit-print-color-adjust: exact;
          }
        }
      ` }} />
      <div className="sticky top-0 bg-slate-100 border-b border-slate-300 p-4 flex justify-between items-center print:hidden z-10">
        <div className="flex items-center gap-4">
          <button 
            onClick={onClose}
            className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded font-medium transition-colors"
          >
            Back
          </button>
          <span className="text-sm font-semibold text-slate-600">Print Preview: If printing fails, please open a new tab.</span>
        </div>
        <button 
          onClick={handlePrint}
          className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded font-bold transition-colors shadow-sm"
        >
          Print Document
        </button>
      </div>

      <div className="p-8 max-w-[1300px] mx-auto text-black uppercase">
        <h1 className="text-center font-bold text-xl mb-4">
          REAL PROPERTY TAX ACCOUNT REGISTER
        </h1>

        <div className="grid grid-cols-2 border border-black overflow-hidden mb-0">
          {/* Left Panel: Records of Ownership */}
          <div className="border-r border-black">
            <table className="w-full border-collapse text-[9px]">
              <thead>
                <tr className="border-b border-black">
                  <th colSpan={3} className="p-1 font-bold text-center tracking-widest text-[10px]">RECORDS OF OWNERSHIP</th>
                </tr>
                <tr className="border-b border-black bg-slate-50">
                  <th className="border-r border-black p-1 font-bold w-1/3">Name</th>
                  <th className="border-r border-black p-1 font-bold w-1/3">Address</th>
                  <th className="p-1 font-bold w-1/3">Date of Transfer</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-black/10">
                  <td className="border-r border-black p-1 h-16 align-top">
                    <span className="font-bold">{property.ownerName}</span>
                  </td>
                  <td className="border-r border-black p-1 h-16 align-top text-[8px] leading-tight">
                    {property.ownerAddress}
                  </td>
                  <td className="p-1 h-16 align-top text-center font-bold">
                    {property.effectivityDate}
                  </td>
                </tr>
                {/* Empty rows for future transfers */}
                {[...Array(3)].map((_, i) => (
                  <tr key={i} className="border-b border-black/10 last:border-0 font-mono">
                    <td className="border-r border-black p-1 h-6"></td>
                    <td className="border-r border-black p-1 h-6"></td>
                    <td className="p-1 h-6"></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Right Panel: Property Info */}
          <div className="p-4 space-y-3 text-[10px]">
            <div className="flex items-baseline gap-2">
              <span className="whitespace-nowrap">Property Index Card No.</span>
              <span className="flex-1 border-b border-black font-bold font-mono pl-2">{property.pin}</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="whitespace-nowrap">Loc. of Property</span>
              <span className="flex-1 border-b border-black font-bold italic pl-2">{property.detailedLocation}</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="whitespace-nowrap">Brgy./Mun./District</span>
              <span className="flex-1 border-b border-black font-bold pl-2">{property.barangay} / {property.municipality}</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="whitespace-nowrap">Province/City</span>
              <span className="flex-1 border-b border-black font-bold pl-2">{property.province}</span>
            </div>
          </div>
        </div>

        <div className="border-x border-b border-black p-2 bg-slate-50/50">
          <h2 className="text-center font-bold text-sm tracking-[0.3em]">
            RECORD OF TAXES AND PAYMENTS
          </h2>
        </div>


        <table className="w-full border-collapse border border-black text-center text-[9px]">
          <thead>
            <tr>
              <th rowSpan={2} className="border border-black font-normal p-1">ARP NO.</th>
              <th colSpan={3} className="border border-black font-normal p-1">ASSESSED VALUE</th>
              <th rowSpan={2} className="border border-black font-normal p-1">TAX YEAR</th>
              <th colSpan={4} className="border border-black font-normal p-1">TAX DUE</th>
              <th colSpan={4} className="border border-black font-normal p-1">TAX COLLECTED</th>
              <th rowSpan={2} className="border border-black font-normal p-1">OR. NO</th>
              <th rowSpan={2} className="border border-black font-normal p-1">DATE</th>
              <th colSpan={4} className="border border-black font-normal p-1">BALANCE</th>
              <th rowSpan={2} className="border border-black font-normal p-1">CLERK</th>
            </tr>
            <tr className="text-[8px]">
              <th className="border border-black font-normal p-0.5">LAND</th>
              <th className="border border-black font-normal p-0.5">IMPR.</th>
              <th className="border border-black font-normal p-0.5">TOTAL</th>

              <th className="border border-black font-normal p-0.5">BASIC</th>
              <th className="border border-black font-normal p-0.5">SEF</th>
              <th className="border border-black font-normal p-0.5">PENAL</th>
              <th className="border border-black font-normal p-0.5">TOTAL</th>

              <th className="border border-black font-normal p-0.5">BASIC</th>
              <th className="border border-black font-normal p-0.5">SEF</th>
              <th className="border border-black font-normal p-0.5">PENAL</th>
              <th className="border border-black font-normal p-0.5">TOTAL</th>

              <th className="border border-black font-normal p-0.5">BASIC</th>
              <th className="border border-black font-normal p-0.5">SEF</th>
              <th className="border border-black font-normal p-0.5">PENAL</th>
              <th className="border border-black font-normal p-0.5">TOTAL</th>
            </tr>
          </thead>
          <tbody>
            {finalRows.map((row, idx) => (
              <tr key={idx} className={row.status === 'Voided' ? 'bg-slate-50 italic opacity-80' : ''}>
                <td className="border border-black p-1 h-6 truncate font-mono text-[8px]">{property.tdNumber}</td>
                <td className="border border-black p-1 text-right">{row.type === 'assessment' ? (property.classification === "LAND" ? row.assessedValue.toLocaleString() : "") : ""}</td>
                <td className="border border-black p-1 text-right">{row.type === 'assessment' ? (property.classification !== "LAND" ? row.assessedValue.toLocaleString() : "") : ""}</td>
                <td className="border border-black p-1 text-right font-bold">{row.type === 'assessment' ? row.assessedValue.toLocaleString() : ""}</td>
                <td className="border border-black p-1">{row.type === 'assessment' ? row.year : ''}</td>

                {/* TAX DUE */}
                <td className="border border-black p-1 text-right">{row.basicDue > 0 ? row.basicDue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ""}</td>
                <td className="border border-black p-1 text-right">{row.sefDue > 0 ? row.sefDue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ""}</td>
                <td className="border border-black p-1 text-right">{row.penaltyDue > 0 ? row.penaltyDue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ""}</td>
                <td className="border border-black p-1 text-right font-bold">{row.totalDue > 0 ? row.totalDue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ""}</td>

                {/* TAX COLLECTED */}
                <td className="border border-black p-1 text-right">{row.basicCol > 0 ? row.basicCol.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ""}</td>
                <td className="border border-black p-1 text-right">{row.sefCol > 0 ? row.sefCol.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ""}</td>
                <td className="border border-black p-1 text-right">{row.penaltyCol > 0 ? row.penaltyCol.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ""}</td>
                <td className="border border-black p-1 text-right font-bold">{row.totalCol > 0 ? row.totalCol.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ""}</td>

                <td className="border border-black p-1 font-bold">{row.orNumber}</td>
                <td className="border border-black p-1 text-[8px]">{row.date ? formatDate(row.date) : ""}</td>

                {/* BALANCE */}
                <td className="border border-black p-1 text-right">{row.balBasic > 0 ? row.balBasic.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "0.00"}</td>
                <td className="border border-black p-1 text-right">{row.balSef > 0 ? row.balSef.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "0.00"}</td>
                <td className="border border-black p-1 text-right">{row.balPenalty > 0 ? row.balPenalty.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "0.00"}</td>
                <td className="border border-black p-1 text-right font-bold">{row.balTotal > 0 ? row.balTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "0.00"}</td>

                <td className="border border-black p-1 text-[8px] font-bold">{row.clerk}</td>
              </tr>
            ))}
            {Array.from({ length: Math.max(0, 15 - finalRows.length) }).map((_, i) => (
              <tr key={`empty-${i}`}>
                <td className="border border-black p-1 h-6"></td>
                <td className="border border-black p-1"></td>
                <td className="border border-black p-1"></td>
                <td className="border border-black p-1"></td>
                <td className="border border-black p-1"></td>
                <td className="border border-black p-1"></td>
                <td className="border border-black p-1"></td>
                <td className="border border-black p-1"></td>
                <td className="border border-black p-1"></td>
                <td className="border border-black p-1"></td>
                <td className="border border-black p-1"></td>
                <td className="border border-black p-1"></td>
                <td className="border border-black p-1"></td>
                <td className="border border-black p-1"></td>
                <td className="border border-black p-1"></td>
                <td className="border border-black p-1"></td>
                <td className="border border-black p-1"></td>
                <td className="border border-black p-1"></td>
                <td className="border border-black p-1"></td>
                <td className="border border-black p-1"></td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-8 flex justify-between">
          <div className="w-1/3 border-t border-black text-center pt-2">
            <p className="font-bold text-[9px]">CERTIFIED CORRECT</p>
            <p className="mt-4 text-[10px]">LGU TREASURER / AUTHORIZED OFFICER</p>
          </div>
          <p className="text-[8px] font-mono self-end">Generated: {new Date().toLocaleString()} // RPTAR-SYSTEM-V2</p>
        </div>
      </div>
    </div>
  );
};
