import React, { useState, useRef } from "react";
import { createPortal } from "react-dom";
import { Property, Delinquency, Payment } from "../types";
import { groupDelinquenciesByPenaltyRule, calculateTotalDue } from "../lib/taxCalculations";
import { formatDate, resolveModernColors } from "../lib/utils";
import { Download } from "lucide-react";

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
  const [isSavingPdf, setIsSavingPdf] = useState(false);
  const printAreaRef = useRef<HTMLDivElement>(null);

  const handlePrint = () => {
    window.print();
  };

  const handleSavePDF = () => {
    const element = printAreaRef.current;
    if (!element) return;

    const cleanOwnerName = property.ownerName.trim().replace(/[^a-zA-Z0-9_\- ]/g, "").replace(/\s+/g, "_");
    const filename = `RPTAR_${cleanOwnerName}.pdf`;

    const opt = {
      margin:       0.25,
      filename:     filename,
      image:        { type: 'jpeg', quality: 0.98 },
      html2canvas:  { 
        scale: 2.5, 
        useCORS: true,
        letterRendering: true,
        logging: false
      },
      jsPDF:        { unit: 'in', format: [8.5, 11], orientation: 'portrait' }
    } as any;

    setIsSavingPdf(true);

    const originalGetComputedStyle = window.getComputedStyle;
    window.getComputedStyle = function(elt, pseudoElt) {
      const originalDecl = originalGetComputedStyle.call(window, elt, pseudoElt);
      return new Proxy(originalDecl, {
        get(target, prop) {
          if (prop === "getPropertyValue") {
            return function(propertyName: string) {
              if (typeof propertyName === "string" && (propertyName.startsWith("text-decoration") || propertyName === "text-decoration-line")) {
                const hasUnderline = (typeof elt.closest === "function") && (elt.closest(".underline") !== null);
                return hasUnderline ? "underline" : "none";
              }
              const val = target.getPropertyValue(propertyName);
              return resolveModernColors(val);
            };
          }
          if (typeof prop === "string" && (prop.startsWith("textDecoration") || prop === "textDecorationLine")) {
            const hasUnderline = (typeof elt.closest === "function") && (elt.closest(".underline") !== null);
            return hasUnderline ? "underline" : "none";
          }
          const val = Reflect.get(target, prop, target);
          if (typeof val === "function") {
            return val.bind(target);
          }
          if (typeof val === "string") {
            return resolveModernColors(val);
          }
          return val;
        }
      });
    };
    
    // @ts-ignore
    import('html2pdf.js').then((html2pdfModule) => {
      const html2pdf = html2pdfModule.default;
      html2pdf().set(opt).from(element).save().then(() => {
        setIsSavingPdf(false);
        window.getComputedStyle = originalGetComputedStyle;
      }).catch((err: any) => {
        console.error("PDF generation failed:", err);
        setIsSavingPdf(false);
        window.getComputedStyle = originalGetComputedStyle;
        window.print();
      });
    }).catch((err) => {
      console.error("Failed to load html2pdf.js dynamically:", err);
      setIsSavingPdf(false);
      window.getComputedStyle = originalGetComputedStyle;
      window.print();
    });
  };

  // Generate Ledger Rows
  const ledgerRows: any[] = [];
  
  // Deduplicate history by year to ensure only one record per tax year is retrieved/processed
  const uniqueHistoryMap = new Map<number, Delinquency>();
  history.forEach(h => {
    const existing = uniqueHistoryMap.get(h.year);
    // Prioritize keeping 'Paid' status or the most recently updated entry
    if (!existing || h.status === 'Paid' || (existing.status !== 'Paid' && h.updatedAt > existing.updatedAt)) {
      uniqueHistoryMap.set(h.year, h);
    }
  });
  const deduplicatedHistory = Array.from(uniqueHistoryMap.values());
  
  // Apply grouping rule to deduplicated history
  const groupedHistory = groupDelinquenciesByPenaltyRule(deduplicatedHistory, property.assessedValue);
  
  // Helpers for payment grouping and sequential year rendering
  const getYearDisplayForPayment = (years: number[]) => {
    if (years.length === 0) return "";
    if (years.length === 1) return years[0].toString();
    
    const sorted = [...years].sort((a, b) => a - b);
    const isSequential = sorted.every((val, idx) => idx === 0 || val === sorted[idx - 1] + 1);
    
    if (isSequential) {
      return `${sorted[0]} - ${sorted[sorted.length - 1]}`;
    } else {
      if (sorted.length <= 3) {
        return sorted.join(", ");
      }
      return `${sorted[0]} - ${sorted[sorted.length - 1]}`;
    }
  };

  groupedHistory.forEach(row => {
    // Collect all payments of years inside this group
    const groupPayments: { year: number; payment: Payment }[] = [];
    row.years.forEach(year => {
      const record = deduplicatedHistory.find(h => h.year === year);
      if (!record) return;

      const recordPayments = payments.filter(p => p.delinquencyId === record.id);
      recordPayments.forEach(p => {
        groupPayments.push({ year, payment: p });
      });
    });

    // Group the collected payments of this group by orNumber and status
    const paymentGroups: {
      [key: string]: {
        years: number[];
        orNumber: string;
        date: string;
        clerk: string;
        status: string;
        basicPaid: number;
        sefPaid: number;
        penaltyPaid: number;
        amountPaid: number;
      };
    } = {};

    groupPayments.forEach(item => {
      const p = item.payment;
      const key = `${p.orNumber}_${p.status}`;
      
      if (!paymentGroups[key]) {
        paymentGroups[key] = {
          years: [item.year],
          orNumber: p.orNumber,
          date: p.paymentDate,
          clerk: (p.deputy ? p.deputy.toUpperCase() + '/' : '') + (p.recordedBy ? (p.recordedBy.includes('@') ? p.recordedBy.split('@')[0].toUpperCase() : p.recordedBy.toUpperCase()) : ''),
          status: p.status,
          basicPaid: p.status === 'Voided' ? 0 : p.basicPaid,
          sefPaid: p.status === 'Voided' ? 0 : p.sefPaid,
          penaltyPaid: p.status === 'Voided' ? 0 : p.penaltyPaid,
          amountPaid: p.status === 'Voided' ? 0 : p.amountPaid,
        };
      } else {
        if (!paymentGroups[key].years.includes(item.year)) {
          paymentGroups[key].years.push(item.year);
        }
        paymentGroups[key].basicPaid += p.status === 'Voided' ? 0 : p.basicPaid;
        paymentGroups[key].sefPaid += p.status === 'Voided' ? 0 : p.sefPaid;
        paymentGroups[key].penaltyPaid += p.status === 'Voided' ? 0 : p.penaltyPaid;
        paymentGroups[key].amountPaid += p.status === 'Voided' ? 0 : p.amountPaid;
      }
    });

    // Sort payment groups within the penalty group chronologically by min year
    const sortedGroups = Object.values(paymentGroups).sort((a, b) => {
      const minA = Math.min(...a.years);
      const minB = Math.min(...b.years);
      if (minA !== minB) return minA - minB;
      return a.orNumber.localeCompare(b.orNumber);
    });

    // If there are no payments, print 1 assessment row showing unpaid balance
    if (sortedGroups.length === 0) {
      ledgerRows.push({
        type: 'assessment',
        year: row.yearDisplay,
        assessedValue: property.assessedValue,
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
        clerk: property.recordedBy ? (property.recordedBy.includes('@') ? property.recordedBy.split('@')[0].toUpperCase() : property.recordedBy.toUpperCase()) : 'ADMIN',
        status: row.years.length > 1 ? "Delinquent" : (deduplicatedHistory.find(h => h.year === row.years[0])?.status || "Delinquent"),
        balBasic: row.totalBasic,
        balSef: row.totalSef,
        balPenalty: row.totalInterest,
        balTotal: row.totalDue
      });
    } else {
      // If there are payments, output a consolidated row for each payment
      let cumulativeBasicPaid = 0;
      let cumulativeSefPaid = 0;
      let cumulativePenaltyPaid = 0;

      // Track previously rendered OR and Year displays to skip duplicate loops
      let lastPrintedOrNum = "";
      let lastPrintedTaxYear = "";

      sortedGroups.forEach(g => {
        const yearDisplay = getYearDisplayForPayment(g.years);
        const orNo = g.status === 'Voided' ? `${g.orNumber} (VOID)` : g.orNumber;

        // SKIP LOOP if current row is a duplicate of the previous one
        if (orNo && orNo === lastPrintedOrNum && yearDisplay === lastPrintedTaxYear) {
          return; // skip/continue
        }

        lastPrintedOrNum = orNo;
        lastPrintedTaxYear = yearDisplay;

        cumulativeBasicPaid += g.basicPaid;
        cumulativeSefPaid += g.sefPaid;
        cumulativePenaltyPaid += g.penaltyPaid;

        const pBalBasic = Math.max(0, row.totalBasic - cumulativeBasicPaid);
        const pBalSef = Math.max(0, row.totalSef - cumulativeSefPaid);
        const pBalPenalty = Math.max(0, row.totalInterest - cumulativePenaltyPaid);
        const pBalTotal = pBalBasic + pBalSef + pBalPenalty;

        // If the tax due is collected, subtract it from the due columns so it reflects in the Collection column.
        // Short tax / discrepancies / quarterly payments will show standard remaining dues or balances.
        const displayedBasicDue = pBalBasic;
        const displayedSefDue = pBalSef;
        const displayedPenaltyDue = pBalPenalty;
        const displayedTotalDue = displayedBasicDue + displayedSefDue + displayedPenaltyDue;

        ledgerRows.push({
          type: 'assessment-and-payment',
          year: yearDisplay,
          assessedValue: property.assessedValue,
          basicDue: displayedBasicDue,
          sefDue: displayedSefDue,
          penaltyDue: displayedPenaltyDue,
          totalDue: displayedTotalDue,
          basicCol: g.basicPaid,
          sefCol: g.sefPaid,
          penaltyCol: g.penaltyPaid,
          totalCol: g.amountPaid,
          orNumber: orNo,
          date: g.date,
          clerk: g.clerk,
          status: g.status,
          balBasic: pBalBasic,
          balSef: pBalSef,
          balPenalty: pBalPenalty,
          balTotal: pBalTotal
        });
      });
    }
  });

  // Automatically append subsequent unpaid years if everything recorded is paid (or we proceed into next tax cycles)
  const currentYear = new Date().getFullYear();
  const maxHistoryYear = history.length > 0 ? Math.max(...history.map(h => h.year)) : 2026;
  const startAutoYear = maxHistoryYear + 1;
  const endAutoYear = Math.max(currentYear, maxHistoryYear + 1);

  for (let y = startAutoYear; y <= endAutoYear; y++) {
    const basicDueAmount = property.assessedValue * 0.01;
    const sefDueAmount = property.assessedValue * 0.01;
    const calc = calculateTotalDue(basicDueAmount, sefDueAmount, y, new Date(), 0, "Full", [], false);

    const isPastOrPresent = y <= currentYear;
    const showBalance = isPastOrPresent || currentYear >= 2028;

    ledgerRows.push({
      type: 'assessment',
      year: y.toString(),
      assessedValue: property.assessedValue,
      basicDue: calc.basicTaxDue,
      sefDue: calc.sefTaxDue,
      penaltyDue: calc.interest,
      totalDue: calc.totalDue,
      basicCol: 0,
      sefCol: 0,
      penaltyCol: 0,
      totalCol: 0,
      orNumber: '',
      date: '',
      clerk: property.recordedBy ? (property.recordedBy.includes('@') ? property.recordedBy.split('@')[0].toUpperCase() : property.recordedBy.toUpperCase()) : 'ADMIN',
      status: 'Delinquent',
      balBasic: showBalance ? calc.basicTaxDue : 0,
      balSef: showBalance ? calc.sefTaxDue : 0,
      balPenalty: showBalance ? calc.interest : 0,
      balTotal: showBalance ? calc.totalDue : 0
    });
  }

  // Already calculated cleanly on a per-row basis above
  const finalRows = ledgerRows;

  // Ensure exactly 13 to 15 rows. Let's use 15 rows total as standard.
  const TOTAL_ROWS = 15;
  const totalDisplayRows = Array.from({ length: TOTAL_ROWS }).map((_, idx) => {
    if (idx < finalRows.length) {
      return {
        isEmpty: false,
        ...finalRows[idx]
      };
    } else {
      return {
        isEmpty: true,
        type: '',
        year: '',
        assessedValue: 0,
        basicDue: 0,
        sefDue: 0,
        penaltyDue: 0,
        totalDue: 0,
        basicCol: 0,
        sefCol: 0,
        penaltyCol: 0,
        totalCol: 0,
        orNumber: '',
        date: '',
        clerk: '',
        status: '',
        balBasic: 0,
        balSef: 0,
        balPenalty: 0,
        balTotal: 0
      };
    }
  });

  const formatValue = (val: number) => {
    if (!val || val <= 0) return "";
    return val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const modalContent = (
    <div className="fixed inset-0 bg-white text-black z-[100000] overflow-auto">
      <style dangerouslySetInnerHTML={{ __html: `
        @media print {
          @page {
            size: 13in 8.5in;
            margin: 0.3in 0.4in;
          }
          body {
            background-color: white !important;
            color: black !important;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .no-print {
            display: none !important;
          }
        }

        /* Set explicit font style for perfect layout */
        .rptar-paper {
          font-family: "Arial", "Helvetica Neue", Helvetica, sans-serif;
          color: black;
          width: 100%;
          max-width: 12.4in;
          margin: 0 auto;
          line-height: 1.15;
          text-transform: uppercase;
        }

        /* Strict thin black borders */
        .border-black-thin {
          border: 1px solid black !important;
        }

        .border-collapse-custom {
          border-collapse: collapse !important;
        }

        /* Form Table styling */
        .rptar-table th, .rptar-table td {
          border: 1px solid black !important;
          padding: 3px 4px !important;
          line-height: normal !important;
        }

        .rptar-table th {
          font-size: 7.5pt !important;
          font-weight: bold !important;
          text-align: center !important;
          background-color: rgba(0, 0, 0, 0.01) !important;
          vertical-align: middle !important;
        }

        .rptar-table td {
          font-size: 7.5pt !important;
          height: 23px !important;
          vertical-align: middle !important;
        }

        /* Ownership table styling */
        .ownership-table th, .ownership-table td {
          border: 1px solid black !important;
          padding: 3px 4px !important;
          font-size: 8pt !important;
        }
        
        .ownership-table th {
          font-weight: bold !important;
          text-align: center !important;
        }

        .ownership-table td {
          height: 24px !important;
          vertical-align: middle !important;
        }
      ` }} />

      {/* Control Navigation Header */}
      <div className="sticky top-0 bg-slate-100 border-b border-slate-300 p-4 flex justify-between items-center no-print z-10 font-sans">
        <div className="flex items-center gap-4">
          <button 
            id="rptar-back-btn"
            onClick={onClose}
            className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded font-medium transition-colors cursor-pointer"
          >
            Back to Application
          </button>
          <span className="text-sm font-semibold text-slate-600">
            Print Preview: Ensure Paper Size is set to "8.5 x 13" or "Legal" with Landscape orientation in Print Dialog.
          </span>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleSavePDF}
            disabled={isSavingPdf}
            className="px-4 py-2 bg-slate-200 hover:bg-slate-300 disabled:bg-slate-100 disabled:text-slate-400 text-slate-800 rounded font-medium transition-colors cursor-pointer flex items-center gap-2"
            title="Saves document as a PDF file"
          >
            <Download className="w-4 h-4" />
            {isSavingPdf ? "Saving PDF..." : "Save PDF"}
          </button>
          <button 
            id="rptar-print-btn"
            onClick={handlePrint}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded font-bold transition-colors shadow-sm cursor-pointer"
          >
            Print Document
          </button>
        </div>
      </div>

      {/* Main Folio Document Frame */}
      <div ref={printAreaRef} className="p-6 rptar-paper printable-page-container">
        
        {/* Header Section (Stacked 5 lines, centered, uppercase, single-spaced) */}
        <div className="text-center mb-5 flex flex-col gap-0.5 leading-tight tracking-wider" id="rptar-header">
          <p className="text-[10pt] font-bold">PROPERTY RECORD FORM</p>
          <p className="text-[9.5pt] font-normal">MUNICIPALITY OF DIPACULAO</p>
          <p className="text-[9.5pt] font-normal">PROVINCE OF AURORA</p>
          <p className="text-[9.5pt] font-bold">OFFICE OF THE MUNICIPAL TREASURER</p>
          <p className="text-[15pt] font-bold mt-1 tracking-wide" style={{ fontFamily: "Georgia, 'Times New Roman', Times, serif" }}>
            REAL PROPERTY TAX ACCOUNT REGISTER
          </p>
        </div>

        {/* Top Section (Split Layout: 50% / 50%) */}
        <div className="grid grid-cols-2 gap-8 mb-4 items-stretch" id="rptar-top-split">
          
          {/* Left Side: Record of Ownership */}
          <div className="flex flex-col justify-start">
            <table className="w-full border-collapse-custom ownership-table border-black-thin">
              <thead>
                <tr className="border-black-thin">
                  <th colSpan={3} className="bg-slate-50/10 tracking-wider py-1 font-bold">
                    RECORD OF OWNERSHIP
                  </th>
                </tr>
                <tr className="border-black-thin bg-slate-50/5 text-[7.5pt]">
                  <th className="w-[42%] text-left" style={{ borderRight: "1px solid black" }}>NAME</th>
                  <th className="w-[40%] text-left" style={{ borderRight: "1px solid black" }}>ADDRESS</th>
                  <th className="w-[18%] text-center">DATE OF TRANSFER</th>
                </tr>
              </thead>
              <tbody>
                {/* Row 1 (Current Active Owner) */}
                <tr className="border-black-thin text-[8pt]" style={{ height: "24px" }}>
                  <td className="font-bold truncate" style={{ borderRight: "1px solid black" }}>
                    {property.ownerName || ""}
                  </td>
                  <td className="truncate" style={{ borderRight: "1px solid black", fontSize: "7.5pt" }}>
                    {property.ownerAddress || ""}
                  </td>
                  <td className="text-center font-mono font-bold" style={{ fontSize: "7.5pt" }}>
                    {property.effectivityDate || ""}
                  </td>
                </tr>
                {/* Rows 2 to 5 (Empty for future transfer) */}
                {Array.from({ length: 4 }).map((_, idx) => (
                  <tr key={idx} className="border-black-thin" style={{ height: "24px" }}>
                    <td style={{ borderRight: "1px solid black" }}></td>
                    <td style={{ borderRight: "1px solid black" }}></td>
                    <td></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Right Side: Property Information (Right-aligned layout with exact inline labels and underlines) */}
          <div className="flex flex-col justify-between pl-4">
            <div className="space-y-1 w-full max-w-[460px] ml-auto">
              <div className="flex items-end w-full" style={{ height: "20px" }}>
                <span className="font-bold text-right pr-2 text-[8pt] shrink-0 w-[190px]">PROPERTY INDEX No. (PIN):</span>
                <span className="flex-1 border-b border-black font-mono px-2 text-[8.5pt] font-bold pb-0.5">{property.pin || "—"}</span>
              </div>
              <div className="flex items-end w-full" style={{ height: "20px" }}>
                <span className="font-bold text-right pr-2 text-[8pt] shrink-0 w-[190px]">LOCATION OF PROPERTY:</span>
                <span className="flex-1 border-b border-black px-2 text-[8.5pt] font-semibold pb-0.5">{property.detailedLocation || "—"}</span>
              </div>
              <div className="flex items-end w-full" style={{ height: "20px" }}>
                <span className="font-bold text-right pr-2 text-[8pt] shrink-0 w-[190px]">STREET:</span>
                <span className="flex-1 border-b border-black px-2 text-[8.5pt] pb-0.5">{property.street || "—"}</span>
              </div>
              <div className="flex items-end w-full" style={{ height: "20px" }}>
                <span className="font-bold text-right pr-2 text-[8pt] shrink-0 w-[190px]">BRGY./MUN./DIST.:</span>
                <span className="flex-1 border-b border-black px-2 text-[8.5pt] font-semibold pb-0.5">{property.barangay || "—"} / {property.municipality || "—"}</span>
              </div>
              <div className="flex items-end w-full" style={{ height: "20px" }}>
                <span className="font-bold text-right pr-2 text-[8pt] shrink-0 w-[190px]">PROVINCE/CITY:</span>
                <span className="flex-1 border-b border-black px-2 text-[8.5pt] pb-0.5">{property.province || "—"}</span>
              </div>
              <div className="flex items-end w-full" style={{ height: "20px" }}>
                <span className="font-bold text-right pr-2 text-[8pt] shrink-0 w-[190px]">KIND OF PROPERTY:</span>
                <span className="flex-1 border-b border-black px-2 text-[8.5pt] pb-0.5">{property.classification || "—"}</span>
              </div>
              <div className="flex items-end w-full" style={{ height: "20px" }}>
                <span className="font-bold text-right pr-2 text-[8pt] shrink-0 w-[190px]">AREA:</span>
                <span className="flex-1 border-b border-black font-mono px-2 text-[8.5pt] pb-0.5">{property.area || "—"} SQM</span>
              </div>
              <div className="flex items-end w-full" style={{ height: "20px" }}>
                <span className="font-bold text-right pr-2 text-[8pt] shrink-0 w-[190px]">LOT NO.:</span>
                <span className="flex-1 border-b border-black px-2 text-[8.5pt] pb-0.5">
                  {property.lotNo ? `LOT ${property.lotNo}` : ""}
                  {property.blkNo ? ` BLK ${property.blkNo}` : ""}
                  {!property.lotNo && !property.blkNo ? "—" : ""}
                </span>
              </div>
            </div>
          </div>

        </div>

        {/* Centered, bold section title enclosed in a border */}
        <div className="border border-black p-1 text-center bg-slate-50/10 mb-2 font-bold text-[9pt] tracking-[0.2em]" id="rptar-ledger-title">
          RECORD OF TAXES DUE AND PAYMENT
        </div>

        {/* Ledger Table Section */}
        <table className="w-full border-collapse-custom rptar-table border-black-thin" id="rptar-ledger-table">
          <thead>
            {/* Header Row 1 (Top Level) */}
            <tr className="border-black-thin">
              <th rowSpan={2} className="w-[8%]">ARP NO/TDN.</th>
              <th colSpan={3} className="w-[15%]">ASSESSED VALUE</th>
              <th rowSpan={2} className="w-[5%]">TAX YEAR</th>
              <th colSpan={4} className="w-[18%]">TAX DUE</th>
              <th colSpan={4} className="w-[18%]">TAX COLLECTION</th>
              <th rowSpan={2} className="w-[11%]">OR No./DATE</th>
              <th colSpan={4} className="w-[18%]">BALANCE</th>
              <th rowSpan={2} className="w-[7%]">CLERK'S INITIAL</th>
            </tr>
            {/* Header Row 2 (Sub-columns) */}
            <tr className="border-black-thin">
              {/* ASSESSED VALUE */}
              <th>LAND</th>
              <th>IMPROV.</th>
              <th>TOTAL</th>
              
              {/* TAX DUE */}
              <th>BASIC</th>
              <th>SEF</th>
              <th>PENALTY</th>
              <th>TOTAL</th>
              
              {/* TAX COLLECTION */}
              <th>BASIC</th>
              <th>SEF</th>
              <th>PENALTY</th>
              <th>TOTAL</th>
              
              {/* BALANCE */}
              <th>BASIC</th>
              <th>SEF</th>
              <th>PENALTY</th>
              <th>TOTAL</th>
            </tr>
          </thead>
          <tbody>
            {totalDisplayRows.map((row, idx) => {
              const isVoided = row.status === 'Voided';
              const hasAssessmentInfo = row.type === 'assessment' || row.type === 'assessment-and-payment';
              return (
                <tr 
                  key={idx} 
                  className={`border-black-thin ${isVoided ? 'bg-slate-100/50 italic text-slate-500 line-through' : ''}`}
                >
                  {/* ARP NO/TDN */}
                  <td className="text-center font-mono font-bold" style={{ whiteSpace: "nowrap" }}>
                    {row.isEmpty ? "" : property.tdNumber}
                  </td>
                  
                  {/* ASSESSED VALUE Sub-columns */}
                  <td className="text-right">
                    {row.isEmpty ? "" : (hasAssessmentInfo && property.classification === 'LAND' ? property.assessedValue.toLocaleString() : "—")}
                  </td>
                  <td className="text-right">
                    {row.isEmpty ? "" : (hasAssessmentInfo && property.classification !== 'LAND' ? property.assessedValue.toLocaleString() : "—")}
                  </td>
                  <td className="text-right font-bold bg-slate-50/5">
                    {row.isEmpty ? "" : (hasAssessmentInfo ? property.assessedValue.toLocaleString() : "")}
                  </td>
                  
                  {/* TAX YEAR */}
                  <td className="text-center font-bold">
                    {row.isEmpty ? "" : row.year}
                  </td>
                  
                  {/* TAX DUE Sub-columns */}
                  <td className="text-right">
                    {row.isEmpty ? "" : formatValue(row.basicDue)}
                  </td>
                  <td className="text-right">
                    {row.isEmpty ? "" : formatValue(row.sefDue)}
                  </td>
                  <td className="text-right text-amber-900 font-medium">
                    {row.isEmpty ? "" : formatValue(row.penaltyDue)}
                  </td>
                  <td className="text-right font-bold bg-slate-50/5">
                    {row.isEmpty ? "" : formatValue(row.totalDue)}
                  </td>
                  
                  {/* TAX COLLECTION Sub-columns */}
                  <td className="text-right">
                    {row.isEmpty ? "" : formatValue(row.basicCol)}
                  </td>
                  <td className="text-right">
                    {row.isEmpty ? "" : formatValue(row.sefCol)}
                  </td>
                  <td className="text-right text-amber-900">
                    {row.isEmpty ? "" : formatValue(row.penaltyCol)}
                  </td>
                  <td className="text-right font-bold bg-slate-50/5 col-total-color">
                    {row.isEmpty ? "" : formatValue(row.totalCol)}
                  </td>
                  
                  {/* OR No. / DATE (Single Unified Column) */}
                  <td className="text-center leading-none px-1" style={{ fontSize: "7.2pt" }}>
                    {row.isEmpty ? "" : (
                      <div className="flex flex-col justify-center items-center gap-0.5 select-all">
                        <span className="font-bold">{row.orNumber || "—"}</span>
                        {row.orNumber && row.date && (
                          <span className="text-[6.5pt] text-slate-700 block font-normal no-print">
                            {formatDate(row.date)}
                          </span>
                        )}
                        {row.orNumber && row.date && (
                          <span className="text-[6.5pt] text-black hidden print:block font-normal">
                            {formatDate(row.date)}
                          </span>
                        )}
                      </div>
                    )}
                  </td>
                  
                  {/* BALANCE Sub-columns */}
                  <td className="text-right">
                    {row.isEmpty ? "" : (row.balBasic > 0 ? formatValue(row.balBasic) : "0.00")}
                  </td>
                  <td className="text-right">
                    {row.isEmpty ? "" : (row.balSef > 0 ? formatValue(row.balSef) : "0.00")}
                  </td>
                  <td className="text-right text-amber-900">
                    {row.isEmpty ? "" : (row.balPenalty > 0 ? formatValue(row.balPenalty) : "0.00")}
                  </td>
                  <td className="text-right font-bold bg-slate-50/10">
                    {row.isEmpty ? "" : (row.balTotal > 0 ? formatValue(row.balTotal) : "0.00")}
                  </td>
                  
                  {/* CLERK'S INITIAL */}
                  <td className="text-center font-mono font-medium text-[7pt]">
                    {row.isEmpty ? "" : (row.clerk || "—")}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Signatures and Certification Footer Area */}
        <div className="mt-6 flex justify-between items-end font-sans">
          <div className="w-1/3 text-center">
            <p className="font-bold text-[8.5pt]">CERTIFIED CORRECT:</p>
            <div className="mt-8 border-b border-black mx-auto w-4/5"></div>
            <p className="mt-1 text-[8pt] text-slate-705 font-medium uppercase tracking-wide">
              LGU TREASURER / AUTHORIZED OFFICER
            </p>
          </div>
          <div className="text-right text-[7.5pt] text-slate-500 font-mono tracking-wider no-print">
            Generated: {new Date().toLocaleString()} // RPTAR-SYSTEM-V3_PRINT
          </div>
          <div className="text-right text-[7.5pt] text-black font-mono tracking-wider hidden print:block">
            Generated: {new Date().toLocaleString()} // RPTAR-SYSTEM-V3_PRINT
          </div>
        </div>

      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
};
