import React, { useState, useRef } from "react";
import { createPortal } from "react-dom";
import { Property, Delinquency } from "../types";
import { formatCurrency, resolveModernColors } from "../lib/utils";
import { groupDelinquenciesByPenaltyRule } from "../lib/taxCalculations";
import { Download } from "lucide-react";

interface COAReportPrintViewProps {
  filteredData: { props: Property[]; delinq: Delinquency[]; payments: any[] };
  reportType: "delinquency" | "collection" | "masterlist";
  filterBarangay: string;
  filterYear: string;
  reportTitle: string;
  onClose: () => void;
}

export const COAReportPrintView: React.FC<COAReportPrintViewProps> = ({
  filteredData,
  reportType,
  filterBarangay,
  filterYear,
  reportTitle,
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

    const filename = `COA_Report_${reportType}_${new Date().toISOString().split('T')[0]}.pdf`;

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
      jsPDF:        { unit: 'in', format: [8.5, 13], orientation: 'landscape' }
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

  const modalContent = (
    <div className="fixed inset-0 bg-slate-100 text-black z-[100000] overflow-auto font-sans leading-tight">
      <style dangerouslySetInnerHTML={{ __html: `
        @media print {
          @page {
            size: 13in 8.5in; /* Landscape standard */
            margin: 0.5in;
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
        
        .coa-paper {
          font-family: Arial, sans-serif;
          background: white;
          width: 100%;
          max-width: 13in;
          margin: 2rem auto;
          padding: 0.5in;
          box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1);
        }
        
        @media print {
          .coa-paper {
            margin: 0;
            padding: 0;
            box-shadow: none;
            max-width: none;
          }
        }
      ` }} />

      {/* Control Navigation Header */}
      <div className="sticky top-0 bg-slate-100 border-b border-slate-300 p-4 flex justify-between items-center no-print z-10 font-sans">
        <div className="flex items-center gap-4">
          <button 
            onClick={onClose}
            className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded font-medium transition-colors cursor-pointer"
          >
            Back to Application
          </button>
          <span className="text-sm font-semibold text-slate-600">
            Print Preview: Ensure Paper Size is set to "8.5 x 13" or "Folio" with Landscape orientation in Print Dialog.
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
            onClick={handlePrint}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded font-bold transition-colors shadow-sm cursor-pointer"
          >
            Print Document
          </button>
        </div>
      </div>

      <div ref={printAreaRef} className="coa-paper printable-page-container">
        {reportType !== "delinquency" && (
          <div className="text-center mb-10 text-black">
            <h1 className="text-xl font-bold uppercase underline text-black">{reportTitle}</h1>
            <p className="text-sm mt-1 text-gray-700">
              As of {new Date().toLocaleDateString()}
              {filterBarangay !== "All" ? ` • Barangay: ${filterBarangay}` : ""}
              {filterYear !== "All" && reportType !== "masterlist" ? ` • Year: ${filterYear}` : ""}
            </p>
          </div>
        )}

        {reportType === "delinquency" && (
          <div className="text-black font-sans">
            <div className="text-center mb-8">
              <p className="text-sm m-0 leading-tight">Republic of the Philippines</p>
              <p className="text-sm m-0 leading-tight">Province of Aurora</p>
              <p className="text-sm m-0 leading-tight">Municipality of Dipaculao</p>
              <p className="text-base font-bold m-0 mt-2 leading-tight">OFFICE OF THE MUNICIPAL TREASURER</p>
              <p className="text-lg font-bold m-0 mt-6 leading-tight underline uppercase">Notice of Delinquency in the Payment of Real Property Tax</p>
              <p className="text-base m-0 mt-2 leading-tight">CY {new Date().getFullYear()}</p>
              <p className="text-base font-bold m-0 mt-2 leading-tight underline uppercase">BRGY. {filterBarangay === "All" ? "ALL BARANGAYS" : filterBarangay}</p>
            </div>
            
            <p className="italic text-sm mb-4 text-left">
              Based on the records of this office, the real property tax of the following properties have not been paid:
            </p>

            <table className="w-full text-xs border-collapse table-fixed">
              <thead>
                <tr className="bg-[#002060] text-white font-bold">
                  <th className="border border-[#002060] p-2 text-center align-middle w-8">No.</th>
                  <th className="border border-[#002060] p-2 text-center align-middle w-48 break-words">Declared Owners</th>
                  <th className="border border-[#002060] p-2 text-center align-middle w-32 break-words">Tax Declaration Number</th>
                  <th className="border border-[#002060] p-2 text-center align-middle w-32 break-words">Location of Property</th>
                  <th className="border border-[#002060] p-2 text-center align-middle w-24">Kind of Property</th>
                  <th className="border border-[#002060] p-2 text-center align-middle w-24">Assessed Value</th>
                  <th className="border border-[#002060] p-2 text-center align-middle w-24">Year/s of Delinquency</th>
                  <th className="border border-[#002060] p-2 text-center align-middle w-24">Tax Due</th>
                </tr>
              </thead>
              {(() => {
                const validDelinqs = filteredData.delinq.filter(d => filteredData.props.some(p => p.id === d.propertyId));
                const propertiesMap = new Map<string, { prop: Property; years: number[] }>();
                
                validDelinqs.forEach(d => {
                  if (!propertiesMap.has(d.propertyId)) {
                    propertiesMap.set(d.propertyId, {
                      prop: filteredData.props.find(p => p.id === d.propertyId)!,
                      years: []
                    });
                  }
                  if (!propertiesMap.get(d.propertyId)!.years.includes(d.year)) {
                     propertiesMap.get(d.propertyId)!.years.push(d.year);
                  }
                });

                const rows = Array.from(propertiesMap.values()).map((item, idx) => {
                  const yearsOrig = [...item.years].sort((a,b) => a - b);
                  const minYear = yearsOrig[0];
                  const maxYear = yearsOrig[yearsOrig.length - 1];
                  const span = minYear === maxYear ? minYear.toString() : `${minYear}-${maxYear}`;
                  const taxDue = (item.prop.assessedValue * 0.01) * yearsOrig.length;
                  
                  return {
                    idx: idx + 1,
                    ownerName: item.prop.ownerName,
                    tdNumber: item.prop.tdNumber || "",
                    barangay: item.prop.barangay,
                    classification: item.prop.classification,
                    assessedValue: item.prop.assessedValue,
                    span: span,
                    taxDue: taxDue
                  };
                });
                
                const totalAssessedValue = rows.reduce((acc, row) => acc + row.assessedValue, 0);
                const totalTaxDue = rows.reduce((acc, row) => acc + row.taxDue, 0);

                return (
                  <>
                    <tbody className="text-black">
                      {rows.map(row => (
                        <tr key={`${row.tdNumber}-${row.idx}`} className="even:bg-gray-50 border-b border-gray-300">
                          <td className="p-2 text-center border-l border-r border-gray-300 break-words">{row.idx}</td>
                          <td className="p-2 border-r border-gray-300 uppercase break-words">{row.ownerName}</td>
                          <td className="p-2 text-center font-mono border-r border-gray-300 break-words">{row.tdNumber}</td>
                          <td className="p-2 text-center border-r border-gray-300 break-words">{row.barangay}</td>
                          <td className="p-2 text-center border-r border-gray-300 break-words">{row.classification}</td>
                          <td className="p-2 text-right border-r border-gray-300 break-words">{row.assessedValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                          <td className="p-2 text-center font-bold border-r border-gray-300 break-words">{row.span}</td>
                          <td className="p-2 text-right font-bold border-r border-gray-300 break-words">{row.taxDue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-gray-200 font-bold text-black border-b border-gray-300">
                        <td colSpan={5} className="border-l border-r border-gray-300 p-2 text-right uppercase">Grand Total</td>
                        <td className="border-r border-gray-300 p-2 text-right text-black">
                          {totalAssessedValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                        <td className="border-r border-gray-300 p-2 text-center"></td>
                        <td className="border-r border-gray-300 p-2 text-right text-black">
                          {totalTaxDue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                      </tr>
                    </tfoot>
                  </>
                );
              })()}
            </table>
          </div>
        )}

        {reportType === "collection" && (
          <table className="w-full text-xs border-collapse border border-black table-fixed">
            <thead>
              <tr className="bg-gray-100 text-black">
                <th className="border border-black p-2 text-center w-24">OR Number</th>
                <th className="border border-black p-2 text-center w-20">Date</th>
                <th className="border border-black p-2 w-48 break-words">Taxpayer</th>
                <th className="border border-black p-2 text-center w-36 break-words">PIN</th>
                <th className="border border-black p-2 text-center w-20">Year</th>
                <th className="border border-black p-2 text-center w-24">Type</th>
                <th className="border border-black p-2 text-right w-24">Amount Paid</th>
              </tr>
            </thead>
            <tbody className="text-black">
              {(() => {
                const paidDelinq = filteredData.delinq.filter(d => d.paymentDetails && filteredData.props.some(p => p.id === d.propertyId));
                const propertyGroups: Record<string, any[]> = {};
                paidDelinq.forEach(d => {
                  if (!propertyGroups[d.propertyId]) propertyGroups[d.propertyId] = [];
                  propertyGroups[d.propertyId].push(d);
                });

                return Object.entries(propertyGroups).flatMap(([propId, delinqs]) => {
                  const p = filteredData.props.find(prop => prop.id === propId);
                  const grouped = groupDelinquenciesByPenaltyRule(delinqs, p?.assessedValue || 0);
                  
                  return grouped.map(row => (
                    <tr key={`${propId}-${row.ids.join(',')}-${row.quarterLabel || 'full'}`}>
                      <td className="border border-black p-2 text-center font-mono font-bold text-[10px] break-words">
                        {row.records.map((r: any) => r.paymentDetails?.orNumber).filter((v: any, i: any, a: any) => a.indexOf(v) === i).join(', ')}
                      </td>
                      <td className="border border-black p-2 text-center break-words">
                        {row.records[0]?.paymentDetails?.paymentDate ? new Date(row.records[0].paymentDetails.paymentDate).toLocaleDateString() : 'N/A'}
                      </td>
                      <td className="border border-black p-2 uppercase text-[10px] break-words">{row.records[0]?.paymentDetails?.payerName || p?.ownerName}</td>
                      <td className="border border-black p-2 text-center font-mono text-[10px] break-words">{p?.pin}</td>
                      <td className="border border-black p-2 text-center font-bold break-words">{row.yearDisplay}</td>
                      <td className="border border-black p-2 text-center italic text-[9px] break-words">{row.records[0]?.paymentDetails?.paymentType}</td>
                      <td className="border border-black p-2 text-right font-bold text-black break-words">{formatCurrency(row.totalDue).replace('₱', '')}</td>
                    </tr>
                  ));
                });
              })()}
            </tbody>
            <tfoot>
              <tr className="bg-gray-200 font-bold text-black">
                <td colSpan={6} className="border border-black p-2 text-right uppercase">Total Collections</td>
                <td className="border border-black p-2 text-right text-black">
                  {formatCurrency(filteredData.delinq.filter(d => d.paymentDetails && filteredData.props.some(p => p.id === d.propertyId)).reduce((acc, curr) => acc + (curr.paymentDetails?.amountPaid || 0), 0)).replace('₱', '')}
                </td>
              </tr>
            </tfoot>
          </table>
        )}

        {reportType === "masterlist" && (
          <table className="w-full text-xs border-collapse border border-black table-fixed">
            <thead>
              <tr className="bg-gray-100 text-black">
                <th className="border border-black p-2 text-center w-36 break-words">PIN</th>
                <th className="border border-black p-2 w-48 break-words">Owner / Declarant</th>
                <th className="border border-black p-2 text-center w-32 break-words">Barangay</th>
                <th className="border border-black p-2 text-center w-24">Classification</th>
                <th className="border border-black p-2 text-right w-24">Assessed Value</th>
                <th className="border border-black p-2 text-center w-36 break-words">Tax Dec No.</th>
              </tr>
            </thead>
            <tbody className="text-black">
              {filteredData.props.map(p => (
                <tr key={p.id}>
                  <td className="border border-black p-2 text-center font-mono break-words">{p.pin}</td>
                  <td className="border border-black p-2 uppercase break-words">{p.ownerName}</td>
                  <td className="border border-black p-2 text-center break-words">{p.barangay}</td>
                  <td className="border border-black p-2 text-center break-words">{p.classification}</td>
                  <td className="border border-black p-2 text-right break-words">{formatCurrency(p.assessedValue).replace('₱', '')}</td>
                  <td className="border border-black p-2 text-center font-mono break-words">{p.tdNumber}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="mt-16 grid grid-cols-2 gap-20">
          <div className="text-center border-t border-black pt-2 text-black">
            <p className="font-bold uppercase text-black">Prepared By:</p>
            <p className="text-xs text-gray-500 mt-4 italic">Municipal Assessor / Treasurer Staff</p>
          </div>
          <div className="text-center border-t border-black pt-2 text-black">
            <p className="font-bold uppercase text-black">Verified By:</p>
            <p className="text-xs text-gray-500 mt-4 italic">Local Chief Executive / OIC</p>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
};
