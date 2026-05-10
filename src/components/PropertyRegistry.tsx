import React, { useState, useEffect } from "react";
import { 
  collection, 
  query,
  onSnapshot, 
  addDoc, 
  updateDoc,
  deleteDoc,
  getDocs,
  where,
  doc,
  serverTimestamp,
  db,
  handleFirestoreError,
  OperationType 
} from "../lib/firebase";
import { Property, PropertyType, Delinquency } from "../types";
import { cn, formatCurrency } from "../lib/utils";
import { DIPACULAO_BARANGAYS } from "../constants";
import { Plus, Search, Filter, Edit2, Check, X, Building2, Upload, Eye, ChevronDown, ChevronRight, Receipt, Trash2, RotateCcw } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { logAudit } from "../lib/audit";
import ExcelImporter from "./ExcelImporter";
import PropertyDetails from "./PropertyDetails";
import ConfirmDialog from "./ConfirmDialog";
import DelinquencyActions from "./DelinquencyActions";

import AdminAuthDialog from "./AdminAuthDialog";

const PropertyRegistry: React.FC<{ isEncoder: boolean; isAdmin?: boolean }> = ({ isEncoder, isAdmin = false }) => {
  const [properties, setProperties] = useState<Property[]>([]);
  const [delinquencies, setDelinquencies] = useState<Delinquency[]>([]);
  const [activeDelinquency, setActiveDelinquency] = useState<Delinquency | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"Active" | "Archived">("Active");
  const [viewingProperty, setViewingProperty] = useState<Property | null>(null);
  const [adminAuthDialog, setAdminAuthDialog] = useState<{isOpen: boolean, property: Property | null}>({isOpen: false, property: null});


  // Dialog state
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

  // Form state
  const [formData, setFormData] = useState<Partial<Property>>({
    pin: "",
    ownerName: "",
    assessedValue: 0,
    barangay: "",
    propertyType: "Residential"
  });

  useEffect(() => {
    return onSnapshot(collection(db, "properties"), (snapshot) => {
      setProperties(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Property)));
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, "properties");
    });
  }, []);

  useEffect(() => {
    const q = query(collection(db, "delinquencies"));
    return onSnapshot(q, (snapshot) => {
      setDelinquencies(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Delinquency)));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, "delinquencies");
    });
  }, []);

  const handleSave = async () => {
    try {
      if (editingId) {
        const oldVal = properties.find(p => p.id === editingId);
        await updateDoc(doc(db, "properties", editingId), {
          ...formData,
          updatedAt: serverTimestamp()
        });
        await logAudit("UPDATE", "Property", editingId, oldVal, formData);
        setEditingId(null);
      } else {
        const docRef = await addDoc(collection(db, "properties"), {
          ...formData,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
        await logAudit("CREATE", "Property", docRef.id, null, formData);
        setIsAdding(false);
      }
      setFormData({ pin: "", ownerName: "", assessedValue: 0, barangay: "", propertyType: "Residential" });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, "properties");
    }
  };

  const handleDeleteProperty = async (property: Property) => {
    if (activeTab === 'Active') {
      setConfirmDialog({
        isOpen: true,
        title: "Archive Property?",
        message: `You are about to archive the property "${property.pin}" belonging to "${property.ownerName}".\n\nIt will be moved to the Archive tab and its delinquencies will be hidden from the ledger. Are you sure you want to proceed?`,
        type: "warning",
        onConfirm: async () => {
          try {
            await updateDoc(doc(db, "properties", property.id), {
              isArchived: true,
              archivedAt: new Date().toISOString(),
              updatedAt: serverTimestamp()
            });
            await logAudit("UPDATE", "Property", property.id, property, { isArchived: true });
          } catch (err) {
            handleFirestoreError(err, OperationType.UPDATE, "properties");
          }
        }
      });
    } else {
      setAdminAuthDialog({
        isOpen: true,
        property,
      });
    }
  };

  const handlePermanentDeleteConfirm = async () => {
    if (!adminAuthDialog.property) return;
    const property = adminAuthDialog.property;
    try {
      // Find delinquencies and delete them
      const delinqQuery = query(collection(db, "delinquencies"), where("propertyId", "==", property.id));
      const delinqSnap = await getDocs(delinqQuery);
      for (const d of delinqSnap.docs) {
        await deleteDoc(doc(db, "delinquencies", d.id));
        await logAudit("DELETE", "Delinquency", d.id, d.data(), null);
      }
      // Delete property
      await deleteDoc(doc(db, "properties", property.id));
      await logAudit("DELETE", "Property", property.id, property, null);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, "properties");
    }
  };

  const handleRestoreProperty = async (property: Property) => {
    setConfirmDialog({
      isOpen: true,
      title: "Restore Property?",
      message: `You are about to restore the property "${property.pin}" belonging to "${property.ownerName}".\n\nIt will be moved back to the Active tab. Are you sure you want to proceed?`,
      type: "info",
      onConfirm: async () => {
        try {
          await updateDoc(doc(db, "properties", property.id), {
            isArchived: false,
            archivedAt: null,
            updatedAt: serverTimestamp()
          });
          await logAudit("UPDATE", "Property", property.id, property, { isArchived: false });
        } catch (err) {
          handleFirestoreError(err, OperationType.UPDATE, "properties");
        }
      }
    });
  };

  const preSubmitCheck = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.pin || !formData.ownerName || !formData.barangay) return;

    // Synchronous duplicate check to rigidly enforce uniqueness.
    const isDuplicate = properties.some(p => 
      p.pin.trim().toLowerCase() === formData.pin?.trim().toLowerCase() && p.id !== editingId
    );

    if (isDuplicate) {
      const existing = properties.find(p => p.pin.trim().toLowerCase() === formData.pin?.trim().toLowerCase());
      setConfirmDialog({
        isOpen: true,
        title: "Duplicate Record Violation",
        message: `CRITICAL: The Tax Declaration Number (PIN) "${formData.pin}" already exists in the registry.\n\nRegistered Owner: ${existing?.ownerName}\nLocation: Brgy. ${existing?.barangay}\n\nTo prevent data pollution, the system prevents multiple registrations of the same legal PIN. Please verify your input or update the original record.`,
        type: "danger",
        onConfirm: () => {
          setConfirmDialog(prev => ({ ...prev, isOpen: false }));
        }
      });
      return;
    }

    setConfirmDialog({
      isOpen: true,
      title: editingId ? "Update Property Record?" : "Register New Property?",
      message: editingId 
        ? `You are about to modify the registered electronic record for PIN: ${formData.pin}. \n\nThis will synchronize changes across all linked tax entities. Do you wish to continue?`
        : `You are about to register a new property entity to the central tax database. \n\nPIN: ${formData.pin}\nOwner: ${formData.ownerName}\n\nPlease confirm these details are accurate.`,
      type: "info",
      onConfirm: handleSave
    });
  };

  const sortedAndFiltered = React.useMemo(() => {
    let filteredProps = properties;
    if (activeTab === 'Archived') {
      filteredProps = properties.filter(p => p.isArchived);
    } else {
      filteredProps = properties.filter(p => !p.isArchived);
    }
    
    if (!searchTerm.trim()) return filteredProps;

    const lowerSearchTerm = searchTerm.trim().toLowerCase();

    const exactMatches: (Property & { exactPin?: boolean; exactOwner?: boolean })[] = [];
    const partialMatches: (Property & { exactPin?: boolean; exactOwner?: boolean })[] = [];

    filteredProps.forEach(p => {
      if (activeTab === 'Archived') {
        if (!p.isArchived) return;
      } else {
        if (p.isArchived) return;
      }

      const pinLower = p.pin.trim().toLowerCase();
      const ownerLower = p.ownerName.trim().toLowerCase();
      const brgyLower = p.barangay.trim().toLowerCase();

      const exactPin = pinLower === lowerSearchTerm;
      const exactOwner = ownerLower === lowerSearchTerm;

      if (exactPin || exactOwner) {
        exactMatches.push({ ...p, exactPin, exactOwner });
      } else if (
        pinLower.includes(lowerSearchTerm) || 
        ownerLower.includes(lowerSearchTerm) ||
        brgyLower.includes(lowerSearchTerm)
      ) {
        partialMatches.push({ ...p });
      }
    });

    return [...exactMatches, ...partialMatches];
  }, [properties, searchTerm, activeTab]);

  return (
    <div className="space-y-6">
      <ConfirmDialog 
        isOpen={confirmDialog.isOpen}
        onClose={() => setConfirmDialog(prev => ({ ...prev, isOpen: false }))}
        onConfirm={confirmDialog.onConfirm}
        title={confirmDialog.title}
        message={confirmDialog.message}
        type={confirmDialog.type}
      />
      <AdminAuthDialog 
        isOpen={adminAuthDialog.isOpen}
        onClose={() => setAdminAuthDialog({ isOpen: false, property: null })}
        onConfirm={handlePermanentDeleteConfirm}
      />
      {activeDelinquency && (
        <DelinquencyActions 
          delinquency={activeDelinquency}
          property={properties.find(p => p.id === activeDelinquency.propertyId)!}
          onClose={() => setActiveDelinquency(null)}
          isEncoder={isEncoder}
          isAdmin={isAdmin}
        />
      )}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white tracking-tight">Property Registry</h2>
          <p className="text-slate-500 text-sm mt-1">Central node for all registered real estate identifiers.</p>
        </div>
        {isEncoder && !isAdding && (
          <div className="flex gap-3">
             <button 
              onClick={() => setIsImporting(true)}
              className="flex items-center gap-2 px-4 py-2 border border-indigo-500/30 text-indigo-400 rounded-lg hover:bg-indigo-500/10 transition font-bold text-xs uppercase tracking-wider"
            >
              <Upload className="w-4 h-4" />
              Migrate Data
            </button>
            <button 
              onClick={() => setIsAdding(true)}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-500 transition shadow-lg shadow-indigo-500/20 font-bold text-xs uppercase tracking-wider"
            >
              <Plus className="w-4 h-4" />
              Register Property
            </button>
          </div>
        )}
      </div>

      {isImporting && <ExcelImporter onClose={() => setIsImporting(false)} />}

      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl">
        <div className="p-4 border-b border-slate-800 bg-slate-900/50 flex flex-col md:flex-row justify-between gap-4">
          <div className="flex gap-2">
            <button
              onClick={() => setActiveTab('Active')}
              className={cn(
                "px-4 py-2 rounded-xl text-sm font-bold transition-all",
                activeTab === 'Active' 
                  ? "bg-indigo-600 text-white shadow-lg shadow-indigo-500/20" 
                  : "bg-slate-800 text-slate-400 hover:text-slate-200"
              )}
            >
              Active
            </button>
            <button
              onClick={() => setActiveTab('Archived')}
              className={cn(
                "px-4 py-2 rounded-xl text-sm font-bold transition-all",
                activeTab === 'Archived' 
                  ? "bg-indigo-600 text-white shadow-lg shadow-indigo-500/20" 
                  : "bg-slate-800 text-slate-400 hover:text-slate-200"
              )}
            >
              Archive
            </button>
          </div>
          <div className="relative flex-1 md:max-w-md">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input 
              type="text" 
              placeholder="Search topology by PIN, Owner, or Barangay..." 
              className="w-full pl-10 pr-4 py-2 border border-slate-800 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-slate-950 text-slate-300 text-sm transition-all"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-950/50">
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Entity Signature</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Ownership Block</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Barangay</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Assessment</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest text-right">Ops</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              <AnimatePresence mode="popLayout">
                {isAdding && (
                  <motion.tr 
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="bg-indigo-500/5"
                  >
                    <td colSpan={5} className="p-6">
                      <form onSubmit={preSubmitCheck} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4 p-4 border border-indigo-500/20 rounded-xl bg-slate-900">
                        <input 
                          autoFocus
                          placeholder="Tax Dec / Unique PIN"
                          className="px-3 py-2 border border-slate-700 bg-slate-950 rounded-lg text-sm text-slate-200 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                          value={formData.pin}
                          onChange={e => setFormData({...formData, pin: e.target.value})}
                          required
                        />
                        <input 
                          placeholder="Owner Full Name"
                          className="px-3 py-2 border border-slate-700 bg-slate-950 rounded-lg text-sm text-slate-200 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                          value={formData.ownerName}
                          onChange={e => setFormData({...formData, ownerName: e.target.value})}
                          required
                        />
                        <div className="relative">
                          <select 
                            className="w-full px-3 py-2 border border-slate-700 bg-slate-950 rounded-lg text-sm text-slate-200 focus:ring-1 focus:ring-indigo-500 focus:outline-none appearance-none"
                            value={formData.barangay}
                            onChange={e => setFormData({...formData, barangay: e.target.value})}
                            required
                          >
                            <option value="" disabled>Select Barangay</option>
                            {DIPACULAO_BARANGAYS.map(brgy => (
                              <option key={brgy} value={brgy}>{brgy}</option>
                            ))}
                          </select>
                          <ChevronDown className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
                        </div>
                        <input 
                          placeholder="Assessed Value"
                          type="number"
                          className="px-3 py-2 border border-slate-700 bg-slate-950 rounded-lg text-sm text-slate-200 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                          value={Number.isNaN(formData.assessedValue) ? "" : formData.assessedValue}
                          onChange={e => setFormData({...formData, assessedValue: parseFloat(e.target.value) || 0})}
                          required
                        />
                        <div className="flex items-center gap-2 px-3 py-2 border border-slate-700 bg-slate-950 rounded-lg">
                          <label className="text-[10px] font-bold text-slate-400 uppercase">Idle Land?</label>
                          <input 
                            type="checkbox"
                            className="w-4 h-4 rounded border-slate-700 bg-slate-950 text-indigo-600 focus:ring-indigo-500"
                            checked={formData.isIdle || false}
                            onChange={e => setFormData({...formData, isIdle: e.target.checked})}
                          />
                        </div>
                        <div className="flex gap-2">
                          <button type="submit" className="flex-1 p-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-500 transition shadow-lg shadow-indigo-600/20"><Check className="w-4 h-4 mx-auto"/></button>
                          <button type="button" onClick={() => {setIsAdding(false); setEditingId(null);}} className="p-2 bg-slate-800 text-slate-400 rounded-lg hover:bg-slate-700 hover:text-slate-200 transition"><X className="w-4 h-4"/></button>
                        </div>
                      </form>
                    </td>
                  </motion.tr>
                )}
              </AnimatePresence>
              
              {sortedAndFiltered.map(property => {
                const latestDelinq = delinquencies.filter(d => d.propertyId === property.id).sort((a,b) => b.year - a.year)[0];
                const exactPin = (property as any).exactPin;
                const exactOwner = (property as any).exactOwner;
                const isExact = exactPin || exactOwner;
                return (
                <tr key={property.id} className={cn("transition-colors group", isExact ? "bg-amber-500/10 hover:bg-amber-500/20" : "hover:bg-indigo-500/[0.02]")}>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className={cn("p-2 rounded-xl border transition-all", isExact ? "bg-amber-500/20 border-amber-500/30 group-hover:bg-amber-500/30" : "bg-slate-800 group-hover:bg-slate-700 border-slate-700 group-hover:border-slate-600")}>
                        <Building2 className={cn("w-4 h-4", isExact ? "text-amber-500" : "text-indigo-400")} />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-mono text-xs font-bold text-white tracking-tight">
                            {exactPin ? <span className="bg-amber-500/20 text-amber-500 px-1 rounded">{property.pin}</span> : property.pin}
                          </p>
                          {exactPin && (
                            <span className="px-1.5 py-0.5 bg-amber-500 text-slate-900 rounded-[4px] text-[8px] font-bold uppercase tracking-widest shadow-sm shadow-amber-500/20 flex-shrink-0">Exact Match</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">{property.propertyType}</p>
                          {property.isIdle && (
                            <span className="px-1.5 py-0.5 bg-red-500/10 text-red-500 border border-red-500/20 rounded text-[8px] font-bold uppercase tracking-widest">Idle Land</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm font-semibold text-slate-200">
                    <div className="flex items-center gap-2">
                      <span>{exactOwner ? <span className="bg-amber-500/20 text-amber-500 px-1 rounded">{property.ownerName}</span> : property.ownerName}</span>
                      {exactOwner && (
                        <span className="px-1.5 py-0.5 bg-amber-500 text-slate-900 rounded-[4px] text-[8px] font-bold uppercase tracking-widest shadow-sm shadow-amber-500/20 flex-shrink-0">Exact Match</span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-400">{property.barangay}</td>
                  <td className="px-6 py-4 text-sm font-bold text-emerald-400">{formatCurrency(property.assessedValue)}</td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {activeTab === 'Active' ? (
                        <>
                          <button 
                            onClick={() => setViewingProperty(property)}
                            className="p-2 text-slate-500 hover:text-indigo-400 hover:bg-indigo-500/10 rounded-xl transition-all"
                            title="View Intelligence"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          {isEncoder && (
                            <button 
                              onClick={() => {
                                setEditingId(property.id);
                                setFormData(property);
                                setIsAdding(true);
                              }}
                              className="p-2 text-slate-500 hover:text-indigo-400 hover:bg-indigo-500/10 rounded-xl transition-all"
                              title="Modify Record"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                          )}
                          {isAdmin && (
                            <button 
                              onClick={() => handleDeleteProperty(property)}
                              className="p-2 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded-xl transition-all"
                              title="Archive Property"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                          {(isEncoder || isAdmin) && (
                            <button 
                              onClick={() => {
                                if (latestDelinq) {
                                  setActiveDelinquency(latestDelinq);
                                } else {
                                  const newId = doc(collection(db, "delinquencies")).id;
                                  const currentYear = new Date().getFullYear();
                                  setActiveDelinquency({
                                    id: newId,
                                    propertyId: property.id,
                                    year: currentYear,
                                    basicTaxDue: property.assessedValue * 0.01,
                                    sefTaxDue: property.assessedValue * 0.01,
                                    penalty: 0,
                                    interest: 0,
                                    totalDue: property.assessedValue * 0.02,
                                    status: "Pending",
                                    createdAt: new Date().toISOString()
                                  });
                                }
                              }}
                              className={cn(
                                "p-2 rounded-xl transition-all",
                                latestDelinq?.status === "Delinquent" || (!latestDelinq)
                                  ? "text-slate-500 hover:text-emerald-400 hover:bg-emerald-500/10" 
                                  : "text-slate-700 hover:text-indigo-400 hover:bg-indigo-500/10"
                              )}
                              title={latestDelinq ? "View Actions & Lifecycle" : "Issue Delinquency"}
                            >
                              <ChevronRight className="w-4 h-4" />
                            </button>
                          )}
                        </>
                      ) : (
                        <>
                          <button 
                            onClick={() => handleRestoreProperty(property)}
                            className="px-3 py-1 font-bold text-xs text-emerald-500 bg-emerald-500/10 hover:bg-emerald-500/20 rounded-lg transition-all"
                            title="Restore Property"
                          >
                            RESTORE
                          </button>
                          {isAdmin && (
                            <button 
                              onClick={() => handleDeleteProperty(property)}
                              className="px-3 py-1 font-bold text-xs text-red-500 bg-red-500/10 hover:bg-red-500/20 rounded-lg transition-all"
                              title="Permanently Delete"
                            >
                              DELETE
                            </button>
                          )}
                        </>
                      )}
                    </div>
                    {activeTab === 'Active' && latestDelinq && latestDelinq.status === "Paid" && latestDelinq.paymentDetails && (
                      <div className="flex flex-col items-end text-[9px] font-mono text-emerald-500/60 group-hover:text-emerald-500 transition-colors mt-2">
                        <div className="flex items-center gap-1">
                          <Receipt className="w-3 h-3" />
                          <span>OR: {latestDelinq.paymentDetails.orNumber}</span>
                        </div>
                        <span>{latestDelinq.paymentDetails.paymentDate}</span>
                      </div>
                    )}
                  </td>
                </tr>
              )})}
            </tbody>
          </table>
        </div>
      </div>

      <AnimatePresence>
        {viewingProperty && (
          <PropertyDetails 
            property={viewingProperty} 
            onClose={() => setViewingProperty(null)} 
          />
        )}
      </AnimatePresence>
    </div>
  );
};

export default PropertyRegistry;
