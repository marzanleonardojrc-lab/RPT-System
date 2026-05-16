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
import { Delinquency, Property } from "../types";
import { calculateTotalDue, groupDelinquenciesByPenaltyRule, GroupedDelinquency } from "../lib/taxCalculations";
import { formatCurrency } from "../lib/utils";
import { Printer, FileSpreadsheet, Settings2 } from "lucide-react";
import { logAudit } from "../lib/audit";
import ConfirmDialog from "./ConfirmDialog";

type ReportType = "delinquency" | "collection" | "masterlist";

const COAReports: React.FC = () => {
  const [data, setData] = useState<{ delinq: Delinquency[]; props: Property[] }>({ delinq: [], props: [] });
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

    return () => {
      unsubDelinq();
      unsubProps();
    };
  }, []);

  const uniqueYears = useMemo(() => {
    const years = new Set(data.delinq.map(d => d.year.toString()));
    return Array.from(years).sort((a: string, b: string) => parseInt(b) - parseInt(a));
  }, [data.delinq]);

  const uniqueBarangays = useMemo(() => {
    const brgys = new Set(data.props.map(p => p.barangay));
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
      if (reportType === "delinquency") return d.status === "Delinquent";
      if (reportType === "collection") return d.status === "Paid";
      return true;
    });

    if (filterYear !== "All") {
      delinq = delinq.filter(d => d.year.toString() === filterYear);
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
          headers = ["Tax Declaration Number", "Owner Name", "Barangay", "Tax Year", "Basic Due", "SEF Due", "Interest", "Total Due"];
          const valid = filteredData.delinq.filter(d => filteredData.props.some(p => p.id === d.propertyId));
          rows = valid.map(d => {
            const p = filteredData.props.find(prop => prop.id === d.propertyId);
            const calc = calculateTotalDue(d.basicTaxDue, d.sefTaxDue, d.year);
            return [p?.pin, p?.ownerName, p?.barangay, d.year, d.basicTaxDue, d.sefTaxDue, calc.interest, calc.totalDue];
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

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-8 print:space-y-0">
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
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-500 transition text-sm font-bold shadow-lg shadow-indigo-600/20"
          >
            <Printer className="w-4 h-4" />
            Print PDF
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 p-6 bg-slate-900 border border-slate-800 rounded-2xl no-print z-10 relative">
        <div className="flex flex-col gap-2">
          <label className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
            <Settings2 className="w-3 h-3" /> Report Type
          </label>
          <select 
            value={reportType} 
            onChange={(e) => setReportType(e.target.value as ReportType)}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-300 focus:outline-none focus:border-indigo-500"
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
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-300 focus:outline-none focus:border-indigo-500"
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
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-300 focus:outline-none focus:border-indigo-500"
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
        <div className="text-center mb-10">
          <h1 className="text-xl font-bold uppercase underline text-white print:text-black">{reportTitle}</h1>
          <p className="text-sm text-slate-400 mt-1 print:text-gray-600">
            As of {new Date().toLocaleDateString()}
            {filterBarangay !== "All" ? ` • Barangay: ${filterBarangay}` : ""}
            {filterYear !== "All" && reportType !== "masterlist" ? ` • Year: ${filterYear}` : ""}
          </p>
        </div>

        {reportType === "delinquency" && (
          <table className="w-full text-xs border-collapse border border-slate-700 print:border-black">
            <thead>
              <tr className="bg-slate-800/50 print:bg-gray-100">
                <th className="border border-slate-700 print:border-black p-2 text-center text-slate-300 print:text-black">PIN</th>
                <th className="border border-slate-700 print:border-black p-2 text-slate-300 print:text-black">Taxpayer/Owner</th>
                <th className="border border-slate-700 print:border-black p-2 text-center text-slate-300 print:text-black">Year</th>
                <th className="border border-slate-700 print:border-black p-2 text-center text-slate-300 print:text-black">Brgy</th>
                <th className="border border-slate-700 print:border-black p-2 text-right text-slate-300 print:text-black">Basic Tax</th>
                <th className="border border-slate-700 print:border-black p-2 text-right text-slate-300 print:text-black">SEF</th>
                <th className="border border-slate-700 print:border-black p-2 text-right text-slate-300 print:text-black">Penalties</th>
                <th className="border border-slate-700 print:border-black p-2 text-right text-slate-300 print:text-black">TOTAL DUE</th>
              </tr>
            </thead>
            <tbody className="text-slate-400 print:text-black">
              {(() => {
                const groupedMap = new Map<string, GroupedDelinquency[]>();
                const validDelinqs = filteredData.delinq.filter(d => filteredData.props.some(p => p.id === d.propertyId));
                
                validDelinqs.forEach(d => {
                  if (!groupedMap.has(d.propertyId)) {
                    const prop = filteredData.props.find(p => p.id === d.propertyId)!;
                    const propDelinqs = validDelinqs.filter(x => x.propertyId === d.propertyId);
                    groupedMap.set(d.propertyId, groupDelinquenciesByPenaltyRule(propDelinqs, prop.assessedValue));
                  }
                });

                const allDisplayRows: { prop: Property; row: GroupedDelinquency }[] = [];
                Array.from(groupedMap.entries()).forEach(([propId, rows]) => {
                  const prop = filteredData.props.find(p => p.id === propId)!;
                  rows.forEach(row => allDisplayRows.push({ prop, row }));
                });

                return allDisplayRows.map(({ prop, row }, idx) => (
                  <tr key={`${prop.id}-${row.ids.join(',')}-${row.quarterLabel || 'full'}`} className="hover:bg-slate-800/30 print:hover:bg-transparent transition-colors">
                    <td className="border border-slate-700 print:border-black p-2 text-center font-mono">{prop.pin}</td>
                    <td className="border border-slate-700 print:border-black p-2 uppercase">{prop.ownerName}</td>
                    <td className="border border-slate-700 print:border-black p-2 text-center font-bold">{row.yearDisplay}</td>
                    <td className="border border-slate-700 print:border-black p-2 text-center">{prop.barangay}</td>
                    <td className="border border-slate-700 print:border-black p-2 text-right">{formatCurrency(row.totalBasic).replace('₱', '')}</td>
                    <td className="border border-slate-700 print:border-black p-2 text-right">{formatCurrency(row.totalSef).replace('₱', '')}</td>
                    <td className="border border-slate-700 print:border-black p-2 text-right font-bold text-red-400 print:text-black">{formatCurrency(row.totalInterest).replace('₱', '')}</td>
                    <td className="border border-slate-700 print:border-black p-2 text-right font-bold text-indigo-400 print:text-black">{formatCurrency(row.totalDue).replace('₱', '')}</td>
                  </tr>
                ));
              })()}
            </tbody>
            <tfoot>
              <tr className="bg-slate-800/80 font-bold print:bg-gray-200 text-white print:text-black">
                <td colSpan={7} className="border border-slate-700 print:border-black p-2 text-right uppercase">Grand Total</td>
                <td className="border border-slate-700 print:border-black p-2 text-right text-indigo-400 print:text-black">
                  {formatCurrency(filteredData.delinq.filter(d => filteredData.props.some(p => p.id === d.propertyId)).reduce((acc, curr) => acc + calculateTotalDue(curr.basicTaxDue, curr.sefTaxDue, curr.year).totalDue, 0)).replace('₱', '')}
                </td>
              </tr>
            </tfoot>
          </table>
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
