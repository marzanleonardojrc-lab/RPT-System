import React, { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Property, Delinquency } from "../types";
import { calculateTotalDue } from "../lib/taxCalculations";
import { formatCurrency, formatDate, resolveModernColors } from "../lib/utils";
import { Printer, ArrowLeft, Download } from "lucide-react";
import lguSeal from "../assets/images/regenerated_image_1779511364288.jpg";

const convertAmountToWords = (num: number): string => {
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

  let numFloor = Math.floor(Math.round(num * 100) / 100);
  let cents = Math.round((num - numFloor) * 100);
  if (cents === 100) {
    numFloor += 1;
    cents = 0;
  }

  const helper = (n: number): string => {
    if (n < 20) return ones[n];
    if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 !== 0 ? " " + ones[n % 10] : "");
    if (n < 1000) return ones[Math.floor(n / 100)] + " Hundred" + (n % 100 !== 0 ? " " + helper(n % 100) : "");
    if (n < 1000000) return helper(Math.floor(n / 1000)) + " Thousand" + (n % 1000 !== 0 ? " " + helper(n % 1000) : "");
    if (n < 1000000000) return helper(Math.floor(n / 1000000)) + " Million" + (n % 1000000 !== 0 ? " " + helper(n % 1000000) : "");
    return "";
  };

  const integerWords = numFloor === 0 ? "Zero" : helper(numFloor);
  const centsText = cents > 0 ? `${cents}/100` : "00/100";
  const cleanedWords = integerWords.replace(/\s+/g, " ").trim();

  return `${cleanedWords} & ${centsText} Pesos Only`;
};

interface NoticeOfDelinquencyPrintViewProps {
  property: Property;
  delinquencies: Delinquency[];
  onClose: () => void;
}

export const NoticeOfDelinquencyPrintView: React.FC<NoticeOfDelinquencyPrintViewProps> = ({
  property,
  delinquencies,
  onClose,
}) => {
  const currentDate = new Date();

  const cellLabelStyle: React.CSSProperties = {
    width: "14%",
    fontWeight: "bold",
    verticalAlign: "bottom",
    height: "25px",
    minHeight: "25px",
    boxSizing: "border-box",
    paddingBottom: "4px",
    lineHeight: "1.25",
  };

  const cellValueStyle: React.CSSProperties = {
    width: "32%",
    borderBottom: "1px solid black",
    verticalAlign: "bottom",
    height: "25px",
    minHeight: "25px",
    boxSizing: "border-box",
    paddingBottom: "4px",
    paddingLeft: "4px",
    paddingRight: "4px",
    lineHeight: "1.25",
  };

  const cellSpacerStyle1: React.CSSProperties = {
    width: "4%",
    height: "25px",
    minHeight: "25px",
  };

  const cellLabel2Style: React.CSSProperties = {
    width: "14%",
    fontWeight: "bold",
    verticalAlign: "bottom",
    height: "25px",
    minHeight: "25px",
    boxSizing: "border-box",
    paddingBottom: "4px",
    lineHeight: "1.25",
  };

  const cellValue2Style: React.CSSProperties = {
    width: "32%",
    borderBottom: "1px solid black",
    verticalAlign: "bottom",
    height: "25px",
    minHeight: "25px",
    boxSizing: "border-box",
    paddingBottom: "4px",
    paddingLeft: "4px",
    paddingRight: "4px",
    lineHeight: "1.25",
  };

  const cellSpacerStyle2: React.CSSProperties = {
    width: "4%",
    height: "25px",
    minHeight: "25px",
  };

  const trRowStyle: React.CSSProperties = {
    height: "25px",
    minHeight: "25px",
    lineHeight: "1.25",
  };

  const thCompStyle: React.CSSProperties = {
    padding: "4px",
    lineHeight: "1.25",
    verticalAlign: "middle",
    height: "22px",
    minHeight: "22px",
    fontWeight: "bold",
    boxSizing: "border-box",
  };

  const tdCompStyle: React.CSSProperties = {
    padding: "4px",
    lineHeight: "1.25",
    verticalAlign: "middle",
    height: "22px",
    minHeight: "22px",
    boxSizing: "border-box",
  };

  const trCompStyle: React.CSSProperties = {
    height: "24px",
    minHeight: "24px",
  };

  const printAreaRef = React.useRef<HTMLDivElement>(null);
  const [isSavingPdf, setIsSavingPdf] = React.useState(false);

  // Find the latest payment to populate Last Payment details if available
  const latestPayment = useMemo(() => {
    if (!delinquencies) return null;
    const paymentsList = delinquencies.flatMap(d => d.payments || []).filter(p => p.status === "Active");
    if (paymentsList.length === 0) return null;
    return [...paymentsList].sort((a, b) => new Date(b.paymentDate).getTime() - new Date(a.paymentDate).getTime())[0];
  }, [delinquencies]);

  // Compute breakdown rows grouped by consecutive years with same assessed value and same penalty calculation
  const breakdownRows = useMemo(() => {
    const individualRows = delinquencies.map(d => {
      const calc = calculateTotalDue(d.basicTaxDue, d.sefTaxDue, d.year, currentDate, (d as any).idleSurcharge || 0);
      const rowAssessedValue = d.basicTaxDue > 0 ? (d.basicTaxDue / 0.01) : property.assessedValue;
      return {
        year: d.year,
        assessedValue: rowAssessedValue,
        basic: d.basicTaxDue,
        sef: d.sefTaxDue,
        penalty: calc.interest,
        subtotal: calc.totalDue
      };
    }).sort((a, b) => a.year - b.year);

    if (individualRows.length === 0) return [];

    const grouped: {
      year: string;
      assessedValue: number;
      basic: number;
      sef: number;
      penalty: number;
      subtotal: number;
    }[] = [];

    let currentGroup: {
      startYear: number;
      endYear: number;
      assessedValue: number;
      basicPerYear: number;
      sefPerYear: number;
      penaltyPerYear: number;
      basicSum: number;
      sefSum: number;
      penaltySum: number;
      subtotalSum: number;
    } | null = null;

    for (const r of individualRows) {
      if (!currentGroup) {
        currentGroup = {
          startYear: r.year,
          endYear: r.year,
          assessedValue: r.assessedValue,
          basicPerYear: r.basic,
          sefPerYear: r.sef,
          penaltyPerYear: r.penalty,
          basicSum: r.basic,
          sefSum: r.sef,
          penaltySum: r.penalty,
          subtotalSum: r.subtotal
        };
      } else {
        const isSameAssessed = Math.abs(r.assessedValue - currentGroup.assessedValue) < 0.01;
        const isSameBasic = Math.abs(r.basic - currentGroup.basicPerYear) < 0.01;
        const isSameSef = Math.abs(r.sef - currentGroup.sefPerYear) < 0.01;
        const isSamePenalty = Math.abs(r.penalty - currentGroup.penaltyPerYear) < 0.01;
        const isConsecutive = r.year === currentGroup.endYear + 1;

        if (isSameAssessed && isSameBasic && isSameSef && isSamePenalty && isConsecutive) {
          currentGroup.endYear = r.year;
          currentGroup.basicSum += r.basic;
          currentGroup.sefSum += r.sef;
          currentGroup.penaltySum += r.penalty;
          currentGroup.subtotalSum += r.subtotal;
        } else {
          grouped.push({
            year: currentGroup.startYear === currentGroup.endYear
              ? `${currentGroup.startYear}`
              : `${currentGroup.startYear} - ${currentGroup.endYear}`,
            assessedValue: currentGroup.assessedValue,
            basic: currentGroup.basicSum,
            sef: currentGroup.sefSum,
            penalty: currentGroup.penaltySum,
            subtotal: currentGroup.subtotalSum
          });

          currentGroup = {
            startYear: r.year,
            endYear: r.year,
            assessedValue: r.assessedValue,
            basicPerYear: r.basic,
            sefPerYear: r.sef,
            penaltyPerYear: r.penalty,
            basicSum: r.basic,
            sefSum: r.sef,
            penaltySum: r.penalty,
            subtotalSum: r.subtotal
          };
        }
      }
    }

    if (currentGroup) {
      grouped.push({
        year: currentGroup.startYear === currentGroup.endYear
          ? `${currentGroup.startYear}`
          : `${currentGroup.startYear} - ${currentGroup.endYear}`,
        assessedValue: currentGroup.assessedValue,
        basic: currentGroup.basicSum,
        sef: currentGroup.sefSum,
        penalty: currentGroup.penaltySum,
        subtotal: currentGroup.subtotalSum
      });
    }

    return grouped;
  }, [delinquencies, property.assessedValue, currentDate]);

  const grandPrincipalBasic = useMemo(() => breakdownRows.reduce((sum, r) => sum + r.basic, 0), [breakdownRows]);
  const grandPrincipalSef = useMemo(() => breakdownRows.reduce((sum, r) => sum + r.sef, 0), [breakdownRows]);
  const grandPenalty = useMemo(() => breakdownRows.reduce((sum, r) => sum + r.penalty, 0), [breakdownRows]);
  const grandTotalDue = useMemo(() => breakdownRows.reduce((sum, r) => sum + r.subtotal, 0), [breakdownRows]);

  const amountInWords = useMemo(() => convertAmountToWords(grandTotalDue), [grandTotalDue]);

  const minYear = useMemo(() => {
    if (!delinquencies || delinquencies.length === 0) return new Date().getFullYear();
    return Math.min(...delinquencies.map(d => d.year));
  }, [delinquencies]);

  const maxYear = useMemo(() => {
    if (!delinquencies || delinquencies.length === 0) return new Date().getFullYear();
    return Math.max(...delinquencies.map(d => d.year));
  }, [delinquencies]);

  const formattedTotal = formatCurrency(grandTotalDue).replace("₱", "");

  const computationDateLabel = currentDate.toLocaleDateString("en-US", { month: "long", year: "numeric" }).toUpperCase();

  const handlePrint = () => {
    const originalTitle = document.title;
    document.title = "Notice of Delinquency";
    window.print();
    setTimeout(() => {
      document.title = originalTitle;
    }, 500);
  };

  const handleSavePDF = () => {
    const element = printAreaRef.current;
    if (!element) return;

    const cleanOwnerName = property.ownerName.trim().replace(/[^a-zA-Z0-9_\- ]/g, "").replace(/\s+/g, "_");
    const filename = `Notice_of_Delinquency_${cleanOwnerName}.pdf`;

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
      jsPDF:        { unit: 'in', format: [8, 13], orientation: 'portrait' }
    } as any;

    setIsSavingPdf(true);

    // Patch window.getComputedStyle to translate any OKLCH/OKLAB colors to standard RGB/RGBA for html2canvas
    // and override text-decoration to eliminate unwanted library-inherited strikethroughs
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
        window.getComputedStyle = originalGetComputedStyle; // Restore original helper
      }).catch((err: any) => {
        console.error("PDF generation failed:", err);
        setIsSavingPdf(false);
        window.getComputedStyle = originalGetComputedStyle; // Restore original helper
        // Fallback to window.print() if html2pdf fails
        window.print();
      });
    }).catch((err) => {
      console.error("Failed to load html2pdf.js dynamically:", err);
      setIsSavingPdf(false);
      window.getComputedStyle = originalGetComputedStyle; // Restore original helper
      window.print();
    });
  };

  // Compute dynamic page chunks to fit maximum rows per page and avoid wasted space
  const pageChunks = useMemo(() => {
    if (breakdownRows.length === 0) return [[]];

    const SINGLE_PAGE_MAX = 16;
    if (breakdownRows.length <= SINGLE_PAGE_MAX) {
      return [breakdownRows];
    }

    const FIRST_PAGE_CAP = 22;
    const MIDDLE_PAGE_CAP = 30;
    const LAST_PAGE_CAP = 22;

    const chunks: (typeof breakdownRows)[] = [];
    let remaining = [...breakdownRows];

    // Page 1: take up to FIRST_PAGE_CAP, leaving at least 1 row for subsequent page(s)
    const p1Count = Math.min(FIRST_PAGE_CAP, remaining.length - 1);
    chunks.push(remaining.slice(0, p1Count));
    remaining = remaining.slice(p1Count);

    while (remaining.length > 0) {
      if (remaining.length <= LAST_PAGE_CAP) {
        chunks.push(remaining);
        remaining = [];
      } else {
        let midCount: number;
        if (remaining.length <= MIDDLE_PAGE_CAP + LAST_PAGE_CAP) {
          midCount = Math.ceil(remaining.length / 2);
        } else {
          midCount = MIDDLE_PAGE_CAP;
        }
        chunks.push(remaining.slice(0, midCount));
        remaining = remaining.slice(midCount);
      }
    }

    return chunks;
  }, [breakdownRows]);

  const totalPages = pageChunks.length;

  const renderSheet = (pageRows: typeof breakdownRows, pageIdx: number) => {
    const isFirstPage = pageIdx === 0;
    const isLastPage = pageIdx === totalPages - 1;
    const sheetNum = pageIdx + 1;

    return (
      <div 
        key={`sheet-${pageIdx}`}
        className="printable-page-container bg-white border-2 border-black p-[12px] w-[7.5in] min-h-[12.5in] flex flex-col justify-between shadow-2xl relative box-border mb-8 print:mb-0 print:border-2 print:border-black print:w-[7.5in] print:h-[12.5in] print:max-h-[12.5in]" 
        style={{ textDecoration: "none", pageBreakAfter: isLastPage ? "auto" : "always", breakAfter: isLastPage ? "auto" : "page" }}
      >
        <div>
          {/* Header section */}
          <div className="flex items-center justify-between w-full font-sans border-collapse px-2">
            <img 
              src="/Hi-Res-BAGONG-PILIPINAS-LOGO-1474x1536-1.png" 
              style={{ marginLeft: "100px", width: "100px", height: "100px", minWidth: "100px", minHeight: "100px", objectFit: "contain", display: "block" }}
              className="object-contain shrink-0" 
              alt="Bagong Pilipinas" 
              onError={(e) => { (e.target as HTMLImageElement).src = '/logo.png'; }} 
            />
            <div className="text-center flex-1 mx-4">
              <p className="font-bold text-[10px] leading-tight text-black tracking-wide">REPUBLIC OF THE PHILIPPINES</p>
              <p className="font-bold text-[10px] leading-tight text-black tracking-wide">PROVINCE OF AURORA</p>
              <p className="font-bold text-[10px] leading-tight text-black tracking-wide">MUNICIPALITY OF DIPACULAO</p>
              <p className="text-[9px] leading-tight tracking-[0.1em] text-black font-bold my-0.5">oo0oo</p>
              <p className="text-[#0a429c] text-[21px] font-bold leading-none mt-1 select-none" style={{ fontFamily: "Pristina, 'Lucida Calligraphy', cursive" }}>
                Office of the Municipal Treasurer
              </p>
            </div>
            <img 
              src={lguSeal} 
              style={{ marginLeft: "0px", marginRight: "100px", width: "100px", height: "75px", minWidth: "100px", minHeight: "75px", objectFit: "contain", display: "block" }}
              className="object-contain shrink-0" 
              alt="LGU Seal" 
              onError={(e) => { (e.target as HTMLImageElement).src = '/logo.png'; }}
            />
          </div>

          {/* Thick double line */}
          <div className="w-full flex flex-col gap-[2px] mt-1.5 mb-2.5">
            <div className="w-full border-t-[4.5px] border-[#808080]"></div>
            <div className="w-full border-t-[1.5px] border-[#808080]"></div>
          </div>

          {/* Title */}
          <h2 className="text-center font-bold text-sm tracking-wide text-black uppercase my-2">
            NOTICE OF REAL PROPERTY TAX DELINQUENCY {totalPages > 1 ? `(SHEET ${sheetNum} OF ${totalPages})` : ""}
          </h2>

          {/* First Page Specific Header */}
          {isFirstPage ? (
            <>
              {/* Date, Name, and Address block */}
              <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "12px", fontSize: "12px", color: "black" }} className="font-sans">
                <tbody>
                  <tr>
                    <td colSpan={2} style={{ width: "70%", paddingBottom: "12px" }}></td>
                    <td colSpan={2} style={{ width: "30%", verticalAlign: "bottom", paddingBottom: "12px" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse" }}>
                        <tbody>
                          <tr>
                            <td style={{ width: "25%", fontWeight: "bold", verticalAlign: "bottom", paddingBottom: "4px" }}>Date:</td>
                            <td style={{ borderBottom: "1px solid black", width: "75%", fontWeight: "semibold", verticalAlign: "bottom", paddingBottom: "4px", paddingLeft: "4px", textAlign: "center" }}>
                              {formatDate(currentDate.toISOString())}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </td>
                  </tr>
                  <tr>
                    <td colSpan={1} style={{ width: "12%", fontWeight: "bold", verticalAlign: "bottom", paddingBottom: "4px" }}>Name:</td>
                    <td colSpan={3} style={{ borderBottom: "1px solid black", width: "88%", fontWeight: "bold", textTransform: "uppercase", verticalAlign: "bottom", paddingBottom: "4px", paddingLeft: "4px" }}>
                      {property.ownerName}
                    </td>
                  </tr>
                  <tr>
                    <td colSpan={1} style={{ width: "12%", fontWeight: "bold", verticalAlign: "bottom", paddingBottom: "4px", paddingTop: "8px" }}>Address:</td>
                    <td colSpan={3} style={{ borderBottom: "1px solid black", width: "88%", verticalAlign: "bottom", paddingBottom: "4px", paddingLeft: "4px", paddingTop: "8px" }}>
                      {property.ownerAddress || `Brgy. ${property.barangay}, Dipaculao`}
                    </td>
                  </tr>
                </tbody>
              </table>

              {/* Salutation & Compliance clause */}
              <div className="mt-3.5 text-[11px] text-justify leading-snug font-sans text-black">
                <p className="font-bold mb-1">Dear Sir/ Madam:</p>
                <p>
                  In compliance to the requirement of Sec. 254 R. A. 7160 (Local Government Code of 1991) you are hereby informed of the tax delinquency on your property described as follows:
                </p>
              </div>

              {/* 2-Column Data Grid */}
              <table style={{ width: "100%", borderCollapse: "collapse", margin: "8px 0", fontSize: "10.5px", color: "black", tableLayout: "fixed" }} className="font-sans">
                <tbody>
                  <tr style={trRowStyle}>
                    <td style={cellLabelStyle}><div style={{ display: "block", minHeight: "18px", lineHeight: "1.25" }}>Classification:</div></td>
                    <td style={{ ...cellValueStyle, fontWeight: "semibold", textTransform: "uppercase" }}><div style={{ display: "block", minHeight: "18px", lineHeight: "1.25" }}>{property.classification}</div></td>
                    <td style={cellSpacerStyle1}></td>
                    <td style={cellLabel2Style}><div style={{ display: "block", minHeight: "18px", lineHeight: "1.25" }}>Lot No.:</div></td>
                    <td style={{ ...cellValue2Style, fontWeight: "semibold" }}><div style={{ display: "block", minHeight: "18px", lineHeight: "1.25" }}>{property.lotNo || "N/A"}</div></td>
                    <td style={cellSpacerStyle2}></td>
                  </tr>
                  <tr style={trRowStyle}>
                    <td style={cellLabelStyle}><div style={{ display: "block", minHeight: "18px", lineHeight: "1.25" }}>PIN/TDN:</div></td>
                    <td style={{ ...cellValueStyle, fontWeight: "semibold" }}><div style={{ display: "block", minHeight: "18px", lineHeight: "1.25" }}>{property.pin || property.tdNumber}</div></td>
                    <td style={cellSpacerStyle1}></td>
                    <td style={cellLabel2Style}><div style={{ display: "block", minHeight: "18px", lineHeight: "1.25" }}>Block No.:</div></td>
                    <td style={{ ...cellValue2Style, fontWeight: "semibold" }}><div style={{ display: "block", minHeight: "18px", lineHeight: "1.25" }}>{property.blkNo || "N/A"}</div></td>
                    <td style={cellSpacerStyle2}></td>
                  </tr>
                  <tr style={trRowStyle}>
                    <td style={cellLabelStyle}><div style={{ display: "block", minHeight: "18px", lineHeight: "1.25" }}>Location:</div></td>
                    <td style={{ ...cellValueStyle, fontWeight: "medium" }}><div style={{ display: "block", minHeight: "18px", lineHeight: "1.25" }}>Brgy. {property.barangay}, Dipaculao, Aurora</div></td>
                    <td style={cellSpacerStyle1}></td>
                    <td style={cellLabel2Style}><div style={{ display: "block", minHeight: "18px", lineHeight: "1.25" }}>TCT No.:</div></td>
                    <td style={{ ...cellValue2Style, fontWeight: "semibold" }}><div style={{ display: "block", minHeight: "18px", lineHeight: "1.25" }}>{property.octTct || property.cctCloa || "N/A"}</div></td>
                    <td style={cellSpacerStyle2}></td>
                  </tr>
                  <tr style={trRowStyle}>
                    <td style={cellLabelStyle}><div style={{ display: "block", minHeight: "18px", lineHeight: "1.25" }}>Assessed Value:</div></td>
                    <td style={{ ...cellValueStyle, fontWeight: "semibold", color: "#065f46" }}><div style={{ display: "block", minHeight: "18px", lineHeight: "1.25" }}>{formatCurrency(property.assessedValue)}</div></td>
                    <td style={cellSpacerStyle1}></td>
                    <td style={cellLabel2Style}><div style={{ display: "block", minHeight: "18px", lineHeight: "1.25" }}>Area:</div></td>
                    <td style={{ ...cellValue2Style, fontWeight: "semibold" }}><div style={{ display: "block", minHeight: "18px", lineHeight: "1.25" }}>{property.area || "N/A"}</div></td>
                    <td style={cellSpacerStyle2}></td>
                  </tr>
                  <tr style={trRowStyle}>
                    <td style={cellLabelStyle}><div style={{ display: "block", minHeight: "18px", lineHeight: "1.25" }}>Last Payment:</div></td>
                    <td style={{ ...cellValueStyle, fontWeight: "medium" }}><div style={{ display: "block", minHeight: "18px", lineHeight: "1.25" }}>{latestPayment ? formatDate(latestPayment.paymentDate) : "N/A"}</div></td>
                    <td style={cellSpacerStyle1}></td>
                    <td style={cellLabel2Style}><div style={{ display: "block", minHeight: "18px", lineHeight: "1.25" }}>Date:</div></td>
                    <td style={{ ...cellValue2Style, fontWeight: "medium" }}><div style={{ display: "block", minHeight: "18px", lineHeight: "1.25" }}>{latestPayment ? formatDate(latestPayment.paymentDate) : "N/A"}</div></td>
                    <td style={cellSpacerStyle2}></td>
                  </tr>
                  <tr style={trRowStyle}>
                    <td style={cellLabelStyle}><div style={{ display: "block", minHeight: "18px", lineHeight: "1.25" }}>Collector:</div></td>
                    <td style={{ ...cellValueStyle, fontWeight: "medium" }}><div style={{ display: "block", minHeight: "18px", lineHeight: "1.25" }}>{latestPayment?.approvedBy || "MUNICIPAL TREASURER"}</div></td>
                    <td style={cellSpacerStyle1}></td>
                    <td style={cellLabel2Style}><div style={{ display: "block", minHeight: "18px", lineHeight: "1.25" }}>OR No.:</div></td>
                    <td style={{ ...cellValue2Style, fontWeight: "semibold" }}><div style={{ display: "block", minHeight: "18px", lineHeight: "1.25" }}>{latestPayment?.orNumber || "N/A"}</div></td>
                    <td style={cellSpacerStyle2}></td>
                  </tr>
                </tbody>
              </table>

              {/* Summary sentence */}
              <div style={{ margin: "10px 0 6px 0", fontSize: "11px", color: "black", lineHeight: "1.4" }} className="font-sans">
                For the year(s) <u className="underline font-bold">{minYear}</u> to <u className="underline font-bold">{maxYear}</u> in the total amount of Php <u className="underline font-bold text-red-600" style={{ color: "#b91c1c" }}>{formattedTotal}</u> including penalties computed as follows:
              </div>
            </>
          ) : (
            /* Subsequent Page Reference Header */
            <div className="my-2.5 p-2 bg-slate-50 border border-black text-[10.5px] font-sans flex justify-between items-center text-black font-bold uppercase">
              <span>Taxpayer: {property.ownerName}</span>
              <span>PIN/TDN: {property.pin || property.tdNumber}</span>
              <span>Location: Brgy. {property.barangay}, Dipaculao</span>
            </div>
          )}

          {/* Data Table for current sheet chunk */}
          <table className="w-full text-[10.5px] border-collapse border border-black font-sans my-2 text-black" style={{ tableLayout: "fixed" }}>
            <thead>
              <tr className="bg-slate-50 border-b border-black text-center font-bold" style={trCompStyle}>
                <th className="border-r border-black text-left w-[15%]" style={thCompStyle}>
                  <div style={{ display: "block", minHeight: "14px", lineHeight: "1.25" }}>Assessed Value</div>
                </th>
                <th className="border-r border-black w-[12%]" style={thCompStyle}>
                  <div style={{ display: "block", minHeight: "14px", lineHeight: "1.25" }}>Tax Year</div>
                </th>
                <th className="border-r border-black w-[8%]" style={thCompStyle}>
                  <div style={{ display: "block", minHeight: "14px", lineHeight: "1.25" }}>QTR</div>
                </th>
                <th className="border-r border-black text-right w-[15%]" style={thCompStyle}>
                  <div style={{ display: "block", minHeight: "14px", lineHeight: "1.25" }}>Basic Tax</div>
                </th>
                <th className="border-r border-black text-right w-[15%]" style={thCompStyle}>
                  <div style={{ display: "block", minHeight: "14px", lineHeight: "1.25" }}>SEF Tax</div>
                </th>
                <th className="border-r border-black text-right w-[15%]" style={thCompStyle}>
                  <div style={{ display: "block", minHeight: "14px", lineHeight: "1.25" }}>Penalty</div>
                </th>
                <th className="text-right w-[20%]" style={thCompStyle}>
                  <div style={{ display: "block", minHeight: "14px", lineHeight: "1.25" }}>Total Tax Due</div>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/40 font-mono text-center text-[10px]">
              {pageRows.map(row => (
                <tr key={row.year} className="hover:bg-slate-50/20" style={trCompStyle}>
                  <td className="border-r border-black text-left" style={tdCompStyle}>
                    <div style={{ display: "block", minHeight: "14px", lineHeight: "1.25" }}>{formatCurrency(row.assessedValue).replace("₱", "")}</div>
                  </td>
                  <td className="border-r border-black font-semibold" style={tdCompStyle}>
                    <div style={{ display: "block", minHeight: "14px", lineHeight: "1.25" }}>{row.year}</div>
                  </td>
                  <td className="border-r border-black" style={tdCompStyle}>
                    <div style={{ display: "block", minHeight: "14px", lineHeight: "1.25" }}>Full</div>
                  </td>
                  <td className="border-r border-black text-right" style={tdCompStyle}>
                    <div style={{ display: "block", minHeight: "14px", lineHeight: "1.25" }}>{formatCurrency(row.basic).replace("₱", "")}</div>
                  </td>
                  <td className="border-r border-black text-right" style={tdCompStyle}>
                    <div style={{ display: "block", minHeight: "14px", lineHeight: "1.25" }}>{formatCurrency(row.sef).replace("₱", "")}</div>
                  </td>
                  <td className="border-r border-black text-right text-red-700" style={tdCompStyle}>
                    <div style={{ display: "block", minHeight: "14px", lineHeight: "1.25" }}>+{formatCurrency(row.penalty).replace("₱", "")}</div>
                  </td>
                  <td className="text-right font-bold" style={tdCompStyle}>
                    <div style={{ display: "block", minHeight: "14px", lineHeight: "1.25" }}>{formatCurrency(row.subtotal).replace("₱", "")}</div>
                  </td>
                </tr>
              ))}
              {/* Grand Computation Row on Last Sheet */}
              {isLastPage && (
                <tr className="bg-slate-50 border-t border-black font-sans font-bold text-right text-[10px]" style={trCompStyle}>
                  <td colSpan={3} className="border-r border-black text-center font-bold uppercase tracking-wider text-black" style={tdCompStyle}>
                    <div style={{ display: "block", minHeight: "14px", lineHeight: "1.25" }}>COMPUTATION AS OF {computationDateLabel}</div>
                  </td>
                  <td className="border-r border-black font-mono" style={tdCompStyle}>
                    <div style={{ display: "block", minHeight: "14px", lineHeight: "1.25" }}>{formatCurrency(grandPrincipalBasic).replace("₱", "")}</div>
                  </td>
                  <td className="border-r border-black font-mono" style={tdCompStyle}>
                    <div style={{ display: "block", minHeight: "14px", lineHeight: "1.25" }}>{formatCurrency(grandPrincipalSef).replace("₱", "")}</div>
                  </td>
                  <td className="border-r border-black font-mono text-red-700" style={tdCompStyle}>
                    <div style={{ display: "block", minHeight: "14px", lineHeight: "1.25" }}>+{formatCurrency(grandPenalty).replace("₱", "")}</div>
                  </td>
                  <td className="p-1 font-mono font-black text-rose-800 underline decoration-double" style={tdCompStyle}>
                    <div style={{ display: "block", minHeight: "14px", lineHeight: "1.25" }}>{formattedTotal}</div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          {/* Continuation banner if not last page */}
          {!isLastPage && (
            <div className="my-3 p-2 border-2 border-dashed border-black text-center font-bold text-[10.5px] uppercase tracking-wider text-black font-sans bg-slate-50">
              [ SHEET {sheetNum} OF {totalPages} — CONTINUED ON SHEET {sheetNum + 1} ]
            </div>
          )}

          {/* Instruction block on last sheet */}
          {isLastPage && (
            <div className="space-y-1 mt-3 px-1.5 text-black">
              <p className="text-[10px] text-justify leading-[1.3] font-sans">
                In case any of the above stated taxes has already been paid, please furnish us with the number of Official Receipts and the date of payment or Xerox copy of your receipt, otherwise we shall appreciate very much your early remittance of the aforestated total amount of
              </p>
              <p className="text-center text-[10.5px] font-bold italic underline tracking-wide font-sans py-0.5">
                {amountInWords}
              </p>
              <p className="text-[10px] text-justify leading-[1.3] font-sans">
                If after fifteen (15) days from your receipt hereof, you failed to remit or pay the said amount, the remedies provided for under the law for the collection of delinquent taxes shall be applied to enforce collection.
              </p>
              <p className="text-center text-[10px] leading-[1.3] font-sans mt-1">
                Kindly <span className="text-red-650 font-bold underline">DISREGARD THIS NOTICE</span> if settlement of your real property tax due has been made.
              </p>
            </div>
          )}
        </div>

        {/* Footer block on last sheet */}
        {isLastPage ? (
          <div>
            {/* Signatory block */}
            <div className="grid grid-cols-2 gap-4 my-2 font-sans text-[11px] text-black">
              <div className="space-y-4">
                <p>Prepared by:</p>
                <div className="pt-2">
                  <span className="block border-b border-black w-[180px] text-center font-bold uppercase h-4">MARZAN LEONARDO JR. C.</span>
                  <span className="block text-[8.5px] text-gray-500 font-semibold uppercase mt-0.5">Revenue Collection Clerk II</span>
                </div>
              </div>
              <div className="space-y-4 pl-4">
                <p>Very truly yours,</p>
                <div className="pt-2">
                  <span className="block border-b border-black w-[180px] text-center font-bold uppercase h-4">OFFICE OF THE MUNICIPAL TREASURER</span>
                  <span className="block text-[8.5px] text-gray-500 font-semibold uppercase mt-0.5">Municipal Treasurer</span>
                </div>
              </div>
            </div>

            {/* Bottom double panel */}
            <div className="grid grid-cols-5 gap-3 border-t border-black/30 pt-2 font-sans text-black">
              {/* Left Panel: Acknowledgment */}
              <div className="col-span-3 space-y-1 text-[9px]">
                <h5 className="font-extrabold text-[9px] uppercase tracking-wide">ACKNOWLEDGMENT:</h5>
                <div className="flex items-center">
                  <span className="w-24 font-bold shrink-0">Received by:</span>
                  <span className="border-b border-black flex-1 h-3.5"></span>
                </div>
                <div className="flex items-center">
                  <span className="w-24 font-bold shrink-0">Name & Signature:</span>
                  <span className="border-b border-black flex-1 h-3.5"></span>
                </div>
                <div className="flex items-center">
                  <span className="w-24 font-bold shrink-0">Position/Designation:</span>
                  <span className="border-b border-black flex-1 h-3.5"></span>
                </div>
                <div className="flex items-center">
                  <span className="w-24 font-bold shrink-0">Date:</span>
                  <span className="border-b border-black flex-1 h-3.5"></span>
                </div>
                <div className="flex items-center">
                  <span className="w-24 font-bold shrink-0">Telephone No.:</span>
                  <span className="border-b border-black flex-1 h-3.5"></span>
                </div>
              </div>

              {/* Right Panel: Boxed MTO Personnel notes */}
              <div className="col-span-2 border border-black p-2 rounded bg-slate-50/50 flex flex-col justify-between text-[9px]">
                <div>
                  <h5 className="font-extrabold uppercase text-[9px] leading-tight mb-1">To be filled-out by MTO personnel:</h5>
                  <div className="flex items-center gap-4 my-1.5">
                    <label className="flex items-center gap-1 cursor-pointer font-bold select-none">
                      <input type="checkbox" className="w-3 h-3 accent-black cursor-pointer" />
                      <span>Served</span>
                    </label>
                    <label className="flex items-center gap-1 cursor-pointer font-bold select-none">
                      <input type="checkbox" className="w-3 h-3 accent-black cursor-pointer" />
                      <span>Unserved</span>
                    </label>
                  </div>
                </div>
                <div className="flex items-center mt-1">
                  <span className="font-bold mr-1 shrink-0">Reason:</span>
                  <span className="border-b border-black flex-1 h-3.5"></span>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-center font-bold text-[9px] uppercase tracking-widest text-slate-500 font-sans py-1">
            OFFICE OF THE MUNICIPAL TREASURER • MUNICIPALITY OF DIPACULAO
          </div>
        )}
      </div>
    );
  };

  const modalContent = (
    <div className="fixed inset-0 bg-slate-100 text-black z-[100000] overflow-auto font-sans leading-tight">
      <style dangerouslySetInnerHTML={{ __html: `
        /* Prevent html2canvas / jsPDF from rendering unwanted strikethroughs */
        .printable-page-container,
        .printable-page-container * {
          text-decoration: none !important;
          text-decoration-line: none !important;
        }
        /* Preserve legitimate underlines */
        .printable-page-container .underline,
        .printable-page-container .underline *,
        .printable-page-container u,
        .printable-page-container u * {
          text-decoration: underline !important;
          text-decoration-line: underline !important;
        }
        .pdf-underline {
          display: inline-block !important;
          border-bottom: 1px solid black !important;
          padding-bottom: 1px !important;
          line-height: 1.2 !important;
          text-align: center !important;
          text-decoration: none !important;
        }
        @media print {
          @page {
            size: 8.5in 13in;
            margin: 0.25in;
          }
          body {
            background-color: white !important;
            color: black !important;
            margin: 0 !important;
            padding: 0 !important;
          }
          .no-print {
            display: none !important;
          }
          .print-overlay-container {
            background-color: transparent !important;
            padding: 0 !important;
            min-height: auto !important;
          }
          .printable-page-container {
            border: 2px solid black !important;
            width: 7.5in !important;
            height: 12.5in !important;
            max-height: 12.5in !important;
            margin: 0 auto !important;
            padding: 12px !important;
            box-sizing: border-box !important;
            display: flex !important;
            flex-direction: column !important;
            justify-content: space-between !important;
            page-break-after: always !important;
            break-after: page !important;
            background-color: white !important;
          }
          .printable-page-container:last-child {
            page-break-after: auto !important;
            break-after: auto !important;
          }
        }
      ` }} />

      {/* Control panel (Non-printable) */}
      <div className="sticky top-0 bg-slate-100 border-b border-slate-300 p-4 flex justify-between items-center no-print z-10 font-sans shadow-sm">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded font-medium transition-colors cursor-pointer"
          >
            Back to Application
          </button>
        </div>
        
        <span className="text-sm font-semibold text-slate-600 text-center">
          Print Preview {totalPages > 1 ? `(${totalPages} Sheets)` : ""}: Ensure Paper Size is set to "8.5 x 13" or "Folio" with Portrait orientation.
        </span>

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
            type="button"
            onClick={handlePrint}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded font-bold transition-colors shadow-sm cursor-pointer"
          >
            Print Document
          </button>
        </div>
      </div>

      {/* Document page simulated frame (On-screen) */}
      <div className="print-overlay-container min-h-[calc(100vh-73px)] bg-slate-100 py-10 px-4 flex flex-col items-center no-print">
        <div ref={printAreaRef} className="flex flex-col items-center">
          {pageChunks.map((chunk, idx) => renderSheet(chunk, idx))}
        </div>
      </div>

      {/* Screen layout print sheet container for print output */}
      <div className="hidden print:block print-only-container">
        {pageChunks.map((chunk, idx) => renderSheet(chunk, idx))}
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
};
