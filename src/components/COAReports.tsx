import React, { useState, useEffect, useMemo } from "react";
import { 
  collection, 
  onSnapshot, 
  query, 
  orderBy,
  db,
  handleFirestoreError,
  OperationType
} from "../lib/firebase";
import { Delinquency, Property, Payment } from "../types";
import { calculateTotalDue, groupDelinquenciesByPenaltyRule, GroupedDelinquency } from "../lib/taxCalculations";
import { formatCurrency } from "../lib/utils";
import { Printer, FileSpreadsheet, Settings2 } from "lucide-react";
import { logAudit } from "../lib/audit";
import ConfirmDialog from "./ConfirmDialog";
import { COAReportPrintView } from "./COAReportPrintView";

type ReportType = "delinquency" | "collection" | "masterlist";

const COAReports: React.FC = () => {
  const [data, setData] = useState<{ delinq: Delinquency[]; props: Property[]; payments: Payment[] }>({ delinq: [], props: [], payments: [] });
  const [loading, setLoading] = useState(true);
  
  const [reportType, setReportType] = useState<ReportType>("delinquency");
  const [filterYear, setFilterYear] = useState<string>("All");
  const [filterBarangay, setFilterBarangay] = useState<string>("All");

  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    type?: "danger" | "warning" | "info" | "success";
  }>({
    isOpen: false,
    title: "",
    message: "",
    onConfirm: () => {},
  });

  useEffect(() => {
    const unsubDelinq = onSnapshot(query(collection(db, "delinquencies"), orderBy("year", "desc")), (snapshot) => {
      const delinqData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Delinquency));
      setData(prev => ({ ...prev, delinq: delinqData }));
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, "delinquencies");
    });

    const unsubProps = onSnapshot(collection(db, "properties"), (snapshot) => {
      const propData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Property));
      setData(prev => ({ ...prev, props: propData }));
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, "properties");
    });

    const unsubPayments = onSnapshot(collection(db, "payments"), (snapshot) => {
      const paymentsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Payment));
      setData(prev => ({ ...prev, payments: paymentsData }));
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, "payments");
    });

    return () => {
      unsubDelinq();
      unsubProps();
      unsubPayments();
    };
  }, []);

  const uniqueYears = useMemo(() => {
    const years = new Set(
      data.delinq
        .filter(d => {
          if (!d || d.year === undefined || d.year === null) return false;
          const prop = data.props.find(p => p.id === d.propertyId);
          return prop && !prop.isArchived;
        })
        .map(d => d.year.toString())
    );
    return Array.from(years).sort((a: string, b: string) => parseInt(b) - parseInt(a));
  }, [data.delinq, data.props]);

  const uniqueBarangays = useMemo(() => {
    const brgys = new Set(data.props.filter(p => !p.isArchived).map(p => p.barangay));
    return Array.from(brgys).sort();
  }, [data.props]);

  const reportTitle = useMemo(() => {
    switch (reportType) {
      case "delinquency": return "Report on Delinquent Real Property Taxes";
      case "collection": return "Report on Real Property Tax Collections/Payments";
      case "masterlist": return "Masterlist of Registered Real Properties";
      default: return "";
    }
  }, [reportType]);

  // Derived filtered data
  const filteredData = useMemo(() => {
    if (reportType === "masterlist") {
      let props = data.props.filter(p => !p.isArchived);
      if (filterBarangay !== "All") {
        props = props.filter(p => p.barangay === filterBarangay);
      }
      return { props, delinq: [] };
    }

    let delinq = data.delinq.filter(d => {
      const prop = data.props.find(p => p.id === d.propertyId);
      if (!prop || prop.isArchived) return false;

      const hasPayment = data.payments.some(p => p.propertyId === d.propertyId && p.taxYear === d.year && p.status === "Active");
      const isPaid = d.status === "Paid" || hasPayment;

      if (reportType === "delinquency") return !isPaid && d.year !== new Date().getFullYear();
      if (reportType === "collection") return isPaid;
      return true;
    });

    if (filterYear !== "All") {
      delinq = delinq.filter(d => d && d.year !== undefined && d.year !== null && d.year.toString() === filterYear);
    }

    if (filterBarangay !== "All") {
      delinq = delinq.filter(d => {
        const p = data.props.find(prop => prop.id === d.propertyId);
        return p?.barangay === filterBarangay;
      });
    }

    return { delinq, props: data.props };
  }, [data, reportType, filterYear, filterBarangay]);

  const exportToCSV = async () => {
    setConfirmDialog({
      isOpen: true,
      title: "Export Official Ledger?",
      message: `You are about to generate a downloadable spreadsheet. \n\nThis data is used for official COA reporting and audit trails. Continue with export?`,
      type: "success",
      onConfirm: async () => {
        let headers: string[] = [];
        let rows: any[][] = [];

        if (reportType === "delinquency") {
          headers = ["No.", "Declared Owners", "Tax Declaration Number", "Location of Property", "Kind of Property", "Assessed Value", "Year/s of Delinquency", "Tax Due"];
          const valid = filteredData.delinq.filter(d => filteredData.props.some(p => p.id === d.propertyId));
          const propertiesMap = new Map<string, { prop: Property; years: number[] }>();
          valid.forEach(d => {
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
          rows = Array.from(propertiesMap.values()).map((item, idx) => {
            const yearsOrig = [...item.years].sort((a,b) => a - b);
            const minYear = yearsOrig[0];
            const maxYear = yearsOrig[yearsOrig.length - 1];
            const span = minYear === maxYear ? minYear.toString() : `${minYear}-${maxYear}`;
            const taxDue = (item.prop.assessedValue * 0.01) * yearsOrig.length;
            return [
              idx + 1,
              item.prop.ownerName,
              item.prop.tdNumber || "",
              item.prop.barangay,
              item.prop.classification,
              item.prop.assessedValue,
              span,
              taxDue.toFixed(2)
            ];
          });
        } else if (reportType === "collection") {
          headers = ["OR Number", "Payment Date", "Taxpayer/Owner", "PIN", "Tax Year", "Amount Paid", "Payment Type"];
          const valid = filteredData.delinq.filter(d => d.paymentDetails && filteredData.props.some(p => p.id === d.propertyId));
          rows = valid.map(d => {
            const p = filteredData.props.find(prop => prop.id === d.propertyId);
            return [d.paymentDetails?.orNumber, d.paymentDetails?.paymentDate, d.paymentDetails?.payerName, p?.pin, d.year, d.paymentDetails?.amountPaid, d.paymentDetails?.paymentType];
          });
        } else if (reportType === "masterlist") {
          headers = ["PIN", "Tax Declaration No.", "Owner Name", "Classification", "Assessed Value", "Barangay"];
          rows = filteredData.props.map(p => [
            p.pin, p.tdNumber || "", p.ownerName, p.classification, p.assessedValue, p.barangay
          ]);
        }

        const csvContent = "data:text/csv;charset=utf-8," 
          + headers.join(",") + "\n"
          + rows.map(e => e.map(item => `"${item}"`).join(",")).join("\n");

        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", `COA_${reportType.toUpperCase()}_Report_${new Date().toISOString().split('T')[0]}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        await logAudit("EXPORT", "Report", "all", null, { format: "CSV", reportType, filterYear, filterBarangay });
      }
    });
  };

  const [isPrintPreviewOpen, setIsPrintPreviewOpen] = useState(false);

  const handlePrint = () => {
    setIsPrintPreviewOpen(true);
  };

  return (
    <div className="space-y-8 print:space-y-0">
      {isPrintPreviewOpen && (
        <COAReportPrintView
          filteredData={filteredData}
          reportType={reportType}
          filterBarangay={filterBarangay}
          filterYear={filterYear}
          reportTitle={reportTitle}
          onClose={() => setIsPrintPreviewOpen(false)}
        />
      )}
      <ConfirmDialog 
        isOpen={confirmDialog.isOpen}
        onClose={() => setConfirmDialog(prev => ({ ...prev, isOpen: false }))}
        onConfirm={confirmDialog.onConfirm}
        title={confirmDialog.title}
        message={confirmDialog.message}
        type={confirmDialog.type}
      />
      
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 no-print">
        <div className="flex flex-col gap-1">
          <h2 className="text-2xl font-bold text-white tracking-tight">Report Generation</h2>
          <p className="text-slate-400 text-sm">Generate compliant reports according to the RPT checklist specifications.</p>
        </div>
        <div className="flex gap-3">
          <button 
            onClick={exportToCSV}
            className="flex items-center gap-2 px-4 py-2 border border-slate-800 rounded-lg hover:bg-slate-800 transition text-sm font-medium text-slate-300"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
            Export Excel
          </button>
          <button 
            onClick={handlePrint}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-500 transition text-sm font-bold shadow-lg shadow-blue-600/20"
          >
            <Printer className="w-4 h-4" />
            Print Report
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 p-6 bg-slate-900 border border-slate-800 rounded-2xl no-print">
        <div className="flex flex-col gap-2">
          <label className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
            <Settings2 className="w-3 h-3" /> Report Type
          </label>
          <select 
            value={reportType} 
            onChange={(e) => setReportType(e.target.value as ReportType)}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-300 focus:outline-none focus:border-blue-500"
          >
            <option value="delinquency">Delinquency Report</option>
            <option value="collection">Collections & Payments Report</option>
            <option value="masterlist">Property Masterlist</option>
          </select>
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-xs font-bold text-slate-400 uppercase tracking-widest">Barangay Coverage</label>
          <select 
            value={filterBarangay} 
            onChange={(e) => setFilterBarangay(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-300 focus:outline-none focus:border-blue-500"
          >
            <option value="All">All Barangays</option>
            {uniqueBarangays.map(b => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>
        </div>

        {reportType !== "masterlist" && (
          <div className="flex flex-col gap-2">
            <label className="text-xs font-bold text-slate-400 uppercase tracking-widest">Tax Year</label>
            <select 
              value={filterYear} 
              onChange={(e) => setFilterYear(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-300 focus:outline-none focus:border-blue-500"
            >
              <option value="All">All Years</option>
              {uniqueYears.map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="bg-slate-900/50 backdrop-blur-sm p-8 rounded-2xl border border-slate-800 shadow-xl print:bg-white print:text-black print:shadow-none print:border-none print:p-0">
        {reportType !== "delinquency" && (
          <div className="text-center mb-10">
            <h1 className="text-xl font-bold uppercase underline text-white print:text-black">{reportTitle}</h1>
            <p className="text-sm text-slate-400 mt-1 print:text-gray-600">
              As of {new Date().toLocaleDateString()}
              {filterBarangay !== "All" ? ` • Barangay: ${filterBarangay}` : ""}
              {filterYear !== "All" && reportType !== "masterlist" ? ` • Year: ${filterYear}` : ""}
            </p>
          </div>
        )}

        {reportType === "delinquency" && (
          <div className="text-white print:text-black font-sans">
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

            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-[#002060] text-white font-bold print:bg-[#002060]">
                  <th className="border border-slate-700 print:border-[#002060] p-2 text-center align-middle">No.</th>
                  <th className="border border-slate-700 print:border-[#002060] p-2 text-center align-middle">Declared Owners</th>
                  <th className="border border-slate-700 print:border-[#002060] p-2 text-center align-middle">Tax Declaration Number</th>
                  <th className="border border-slate-700 print:border-[#002060] p-2 text-center align-middle">Location of Property</th>
                  <th className="border border-slate-700 print:border-[#002060] p-2 text-center align-middle">Kind of Property</th>
                  <th className="border border-slate-700 print:border-[#002060] p-2 text-center align-middle">Assessed Value</th>
                  <th className="border border-slate-700 print:border-[#002060] p-2 text-center align-middle">Year/s of Delinquency</th>
                  <th className="border border-slate-700 print:border-[#002060] p-2 text-center align-middle">Tax Due</th>
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
                    <tbody className="text-slate-300 print:text-black">
                      {rows.map(row => (
                        <tr key={`${row.tdNumber}-${row.idx}`} className="hover:bg-slate-800/30 print:hover:bg-transparent transition-colors even:bg-slate-900/30 print:even:bg-gray-50 border-b border-slate-700 print:border-gray-300">
                          <td className="p-2 text-center border-r border-slate-700 print:border-gray-300">{row.idx}</td>
                          <td className="p-2 border-r border-slate-700 print:border-gray-300 uppercase">{row.ownerName}</td>
                          <td className="p-2 text-center font-mono border-r border-slate-700 print:border-gray-300">{row.tdNumber}</td>
                          <td className="p-2 text-center border-r border-slate-700 print:border-gray-300">{row.barangay}</td>
                          <td className="p-2 text-center border-r border-slate-700 print:border-gray-300">{row.classification}</td>
                          <td className="p-2 text-right border-r border-slate-700 print:border-gray-300">{row.assessedValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                          <td className="p-2 text-center font-bold border-r border-slate-700 print:border-gray-300">{row.span}</td>
                          <td className="p-2 text-right font-bold">{row.taxDue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-slate-800/80 font-bold print:bg-gray-200 text-white print:text-black">
                        <td colSpan={5} className="border border-slate-700 print:border-black p-2 text-right uppercase">Grand Total</td>
                        <td className="border border-slate-700 print:border-black p-2 text-right text-blue-400 print:text-black">
                          {totalAssessedValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                        <td className="border border-slate-700 print:border-black p-2 text-center"></td>
                        <td className="border border-slate-700 print:border-black p-2 text-right text-red-400 print:text-black">
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
          <table className="w-full text-xs border-collapse border border-slate-700 print:border-black">
            <thead>
              <tr className="bg-slate-800/50 print:bg-gray-100">
                <th className="border border-slate-700 print:border-black p-2 text-center text-slate-300 print:text-black">OR Number</th>
                <th className="border border-slate-700 print:border-black p-2 text-center text-slate-300 print:text-black">Date</th>
                <th className="border border-slate-700 print:border-black p-2 text-slate-300 print:text-black">Taxpayer</th>
                <th className="border border-slate-700 print:border-black p-2 text-center text-slate-300 print:text-black">PIN</th>
                <th className="border border-slate-700 print:border-black p-2 text-center text-slate-300 print:text-black">Year</th>
                <th className="border border-slate-700 print:border-black p-2 text-center text-slate-300 print:text-black">Type</th>
                <th className="border border-slate-700 print:border-black p-2 text-right text-slate-300 print:text-black">Amount Paid</th>
              </tr>
            </thead>
            <tbody className="text-slate-400 print:text-black">
              {(() => {
                const paidDelinq = filteredData.delinq.filter(d => d.paymentDetails && filteredData.props.some(p => p.id === d.propertyId));
                // We group by Property ID first, then apply the rule
                const propertyGroups: Record<string, any[]> = {};
                paidDelinq.forEach(d => {
                  if (!propertyGroups[d.propertyId]) propertyGroups[d.propertyId] = [];
                  propertyGroups[d.propertyId].push(d);
                });

                return Object.entries(propertyGroups).flatMap(([propId, delinqs]) => {
                  const p = filteredData.props.find(prop => prop.id === propId);
                  const grouped = groupDelinquenciesByPenaltyRule(delinqs, p?.assessedValue || 0);
                  
                  return grouped.map(row => (
                    <tr key={`${propId}-${row.ids.join(',')}-${row.quarterLabel || 'full'}`} className="hover:bg-slate-800/30 print:hover:bg-transparent transition-colors">
                      <td className="border border-slate-700 print:border-black p-2 text-center font-mono font-bold text-[10px]">
                        {row.records.map(r => r.paymentDetails?.orNumber).filter((v, i, a) => a.indexOf(v) === i).join(', ')}
                      </td>
                      <td className="border border-slate-700 print:border-black p-2 text-center">
                        {row.records[0]?.paymentDetails?.paymentDate ? new Date(row.records[0].paymentDetails.paymentDate).toLocaleDateString() : 'N/A'}
                      </td>
                      <td className="border border-slate-700 print:border-black p-2 uppercase text-[10px]">{row.records[0]?.paymentDetails?.payerName || p?.ownerName}</td>
                      <td className="border border-slate-700 print:border-black p-2 text-center font-mono text-[10px]">{p?.pin}</td>
                      <td className="border border-slate-700 print:border-black p-2 text-center font-bold">{row.yearDisplay}</td>
                      <td className="border border-slate-700 print:border-black p-2 text-center italic text-[9px]">{row.records[0]?.paymentDetails?.paymentType}</td>
                      <td className="border border-slate-700 print:border-black p-2 text-right font-bold text-emerald-400 print:text-black">{formatCurrency(row.totalDue).replace('₱', '')}</td>
                    </tr>
                  ));
                });
              })()}
            </tbody>
            <tfoot>
              <tr className="bg-slate-800/80 font-bold print:bg-gray-200 text-white print:text-black">
                <td colSpan={6} className="border border-slate-700 print:border-black p-2 text-right uppercase">Total Collections</td>
                <td className="border border-slate-700 print:border-black p-2 text-right text-emerald-400 print:text-black">
                  {formatCurrency(filteredData.delinq.filter(d => d.paymentDetails && filteredData.props.some(p => p.id === d.propertyId)).reduce((acc, curr) => acc + (curr.paymentDetails?.amountPaid || 0), 0)).replace('₱', '')}
                </td>
              </tr>
            </tfoot>
          </table>
        )}

        {reportType === "masterlist" && (
          <table className="w-full text-xs border-collapse border border-slate-700 print:border-black">
            <thead>
              <tr className="bg-slate-800/50 print:bg-gray-100">
                <th className="border border-slate-700 print:border-black p-2 text-center text-slate-300 print:text-black">PIN</th>
                <th className="border border-slate-700 print:border-black p-2 text-slate-300 print:text-black">Owner / Declarant</th>
                <th className="border border-slate-700 print:border-black p-2 text-center text-slate-300 print:text-black">Barangay</th>
                <th className="border border-slate-700 print:border-black p-2 text-center text-slate-300 print:text-black">Classification</th>
                <th className="border border-slate-700 print:border-black p-2 text-right text-slate-300 print:text-black">Assessed Value</th>
                <th className="border border-slate-700 print:border-black p-2 text-center text-slate-300 print:text-black">Tax Dec No.</th>
              </tr>
            </thead>
            <tbody className="text-slate-400 print:text-black">
              {filteredData.props.map(p => (
                <tr key={p.id} className="hover:bg-slate-800/30 print:hover:bg-transparent transition-colors">
                  <td className="border border-slate-700 print:border-black p-2 text-center font-mono">{p.pin}</td>
                  <td className="border border-slate-700 print:border-black p-2 uppercase">{p.ownerName}</td>
                  <td className="border border-slate-700 print:border-black p-2 text-center">{p.barangay}</td>
                  <td className="border border-slate-700 print:border-black p-2 text-center">{p.classification}</td>
                  <td className="border border-slate-700 print:border-black p-2 text-right">{formatCurrency(p.assessedValue).replace('₱', '')}</td>
                  <td className="border border-slate-700 print:border-black p-2 text-center font-mono">{p.tdNumber}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="mt-16 grid grid-cols-2 gap-20">
          <div className="text-center border-t border-slate-800 print:border-black pt-2">
            <p className="font-bold uppercase text-white print:text-black">Prepared By:</p>
            <p className="text-xs text-slate-500 mt-4 italic print:text-gray-500">Municipal Assessor / Treasurer Staff</p>
          </div>
          <div className="text-center border-t border-slate-800 print:border-black pt-2">
            <p className="font-bold uppercase text-white print:text-black">Verified By:</p>
            <p className="text-xs text-slate-500 mt-4 italic print:text-gray-500">Local Chief Executive / OIC</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default COAReports;
