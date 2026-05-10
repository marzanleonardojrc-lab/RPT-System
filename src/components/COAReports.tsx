import React, { useState, useEffect } from "react";
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
import { calculateTotalDue } from "../lib/taxCalculations";
import { formatCurrency } from "../lib/utils";
import { Download, Printer, PieChart, FileSpreadsheet } from "lucide-react";
import { logAudit } from "../lib/audit";
import ConfirmDialog from "./ConfirmDialog";

const COAReports: React.FC = () => {
  const [data, setData] = useState<{ delinq: Delinquency[]; props: Property[] }>({ delinq: [], props: [] });
  const [loading, setLoading] = useState(true);
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

  const exportToCSV = async () => {
    setConfirmDialog({
      isOpen: true,
      title: "Export Official Ledger?",
      message: `You are about to generate a downloadable spreadsheet containing ${data.delinq.length} records. \n\nThis data is used for official COA reporting and audit trails. Continue with export?`,
      type: "success",
      onConfirm: async () => {
        const headers = ["Tax Declaration Number", "Owner Name", "Barangay", "Tax Year", "Basic Due", "SEF Due", "Interest", "Total Due", "Status"];
        const validDelinquencies = data.delinq.filter(d => data.props.some(p => p.id === d.propertyId));
        const rows = validDelinquencies.map(d => {
          const p = data.props.find(prop => prop.id === d.propertyId);
          const calc = calculateTotalDue(d.basicTaxDue, d.sefTaxDue, d.year);
          return [
            p?.pin || "",
            p?.ownerName || "",
            p?.barangay || "",
            d.year,
            d.basicTaxDue,
            d.sefTaxDue,
            calc.interest,
            calc.totalDue,
            d.status
          ];
        });

        const csvContent = "data:text/csv;charset=utf-8," 
          + headers.join(",") + "\n"
          + rows.map(e => e.join(",")).join("\n");

        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", `COA_RPT_Report_${new Date().toISOString().split('T')[0]}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        await logAudit("EXPORT", "Report", "all", null, { format: "CSV" });
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
      <div className="flex items-center justify-between no-print">
        <div className="flex flex-col gap-1">
          <h2 className="text-2xl font-bold text-white tracking-tight">COA Compliance Reporting</h2>
          <p className="text-slate-400 text-sm">Generate and export official delinquency reports for audit purposes.</p>
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

      <div className="bg-slate-900/50 backdrop-blur-sm p-8 rounded-2xl border border-slate-800 shadow-xl print:bg-white print:text-black print:shadow-none print:border-none print:p-0">
        <div className="text-center mb-10">
          <h1 className="text-xl font-bold uppercase underline text-white print:text-black">Report on Delinquent Real Property Taxes</h1>
          <p className="text-sm text-slate-400 mt-1 print:text-gray-600">As of {new Date().toLocaleDateString()}</p>
        </div>

        <table className="w-full text-xs border-collapse border border-slate-700 print:border-black">
          <thead>
            <tr className="bg-slate-800/50 print:bg-gray-100">
              <th className="border border-slate-700 print:border-black p-2 text-center text-slate-300 print:text-black">Tax Declaration Number</th>
              <th className="border border-slate-700 print:border-black p-2 text-slate-300 print:text-black">Taxpayer/Owner</th>
              <th className="border border-slate-700 print:border-black p-2 text-center text-slate-300 print:text-black">Year</th>
              <th className="border border-slate-700 print:border-black p-2 text-right text-slate-300 print:text-black">Basic Tax</th>
              <th className="border border-slate-700 print:border-black p-2 text-right text-slate-300 print:text-black">SEF</th>
              <th className="border border-slate-700 print:border-black p-2 text-right text-slate-300 print:text-black">Penalties/Interest</th>
              <th className="border border-slate-700 print:border-black p-2 text-right text-slate-300 print:text-black">TOTAL DUE</th>
            </tr>
          </thead>
          <tbody className="text-slate-400 print:text-black">
            {data.delinq.filter(d => d.status === "Delinquent" && data.props.some(p => p.id === d.propertyId)).map(d => {
              const p = data.props.find(prop => prop.id === d.propertyId);
              const calc = calculateTotalDue(d.basicTaxDue, d.sefTaxDue, d.year);
              return (
                <tr key={d.id} className="hover:bg-slate-800/30 print:hover:bg-transparent transition-colors">
                  <td className="border border-slate-700 print:border-black p-2 text-center font-mono">{p?.pin}</td>
                  <td className="border border-slate-700 print:border-black p-2 uppercase">{p?.ownerName}</td>
                  <td className="border border-slate-700 print:border-black p-2 text-center">{d.year}</td>
                  <td className="border border-slate-700 print:border-black p-2 text-right">{formatCurrency(d.basicTaxDue).replace('₱', '')}</td>
                  <td className="border border-slate-700 print:border-black p-2 text-right">{formatCurrency(d.sefTaxDue).replace('₱', '')}</td>
                  <td className="border border-slate-700 print:border-black p-2 text-right font-bold text-red-400 print:text-black">{formatCurrency(calc.interest).replace('₱', '')}</td>
                  <td className="border border-slate-700 print:border-black p-2 text-right font-bold text-indigo-400 print:text-black">{formatCurrency(calc.totalDue).replace('₱', '')}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-slate-800/80 font-bold print:bg-gray-200 text-white print:text-black">
              <td colSpan={6} className="border border-slate-700 print:border-black p-2 text-right uppercase">Grand Total</td>
              <td className="border border-slate-700 print:border-black p-2 text-right text-indigo-400 print:text-black">
                {formatCurrency(data.delinq.filter(d => d.status === "Delinquent" && data.props.some(p => p.id === d.propertyId)).reduce((acc, curr) => acc + calculateTotalDue(curr.basicTaxDue, curr.sefTaxDue, curr.year).totalDue, 0)).replace('₱', '')}
              </td>
            </tr>
          </tfoot>
        </table>

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
