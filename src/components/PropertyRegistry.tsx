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
import { useAuth } from "../AuthContext";
import { Property, PropertyClassification, Delinquency } from "../types";
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
  const { profile } = useAuth();
  const [properties, setProperties] = useState<Property[]>([]);
  const [delinquencies, setDelinquencies] = useState<Delinquency[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"Active" | "Archived">("Active");
  const [viewingProperty, setViewingProperty] = useState<Property | null>(null);
  const [adminAuthDialog, setAdminAuthDialog] = useState<{isOpen: boolean, property: Property | null}>({isOpen: false, property: null});
  const [errors, setErrors] = useState<Record<string, string>>({});


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
    ownerAddress: "",
    administratorName: "",
    administratorAddress: "",
    effectivityDate: new Date().getFullYear().toString(),
    tdNumber: "",
    detailedLocation: "",
    street: "",
    barangay: "",
    municipality: "Dipaculao",
    province: "Aurora",
    lotNo: "",
    blkNo: "",
    octTct: "",
    cctCloa: "",
    classification: "LAND",
    area: "",
    assessedValue: 0,
    previousTdNo: "",
    previousOwner: "",
    previousAssessedValue: 0,
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
      const userName = profile?.username || profile?.displayName || "System";

      const saveData: any = {
        ...formData,
        tdNumber: formData.tdNumber?.trim() || "",
        pin: formData.pin?.trim() || "",
        updatedAt: serverTimestamp()
      };

      if (editingId) {
        const oldVal = properties.find(p => p.id === editingId);
        const { id: _, ...restData } = saveData;
        
        // Ensure isArchived is preserved or set if missing
        if (restData.isArchived === undefined) restData.isArchived = false;

        // If recordedBy is System or Imported, update it to the current user
        if (!restData.recordedBy || restData.recordedBy === "System" || restData.recordedBy === "Imported") {
          restData.recordedBy = userName;
        }

        await updateDoc(doc(db, "properties", editingId), restData);
        await logAudit("UPDATE", "Property", editingId, oldVal, restData);
        setEditingId(null);
      } else {
        const { id: _, ...restData } = saveData;
        const docRef = await addDoc(collection(db, "properties"), {
          ...restData,
          isArchived: false,
          recordedBy: userName,
          createdAt: serverTimestamp()
        });
        await logAudit("CREATE", "Property", docRef.id, null, restData);
        setIsAdding(false);
      }
      setFormData({
        pin: "",
        ownerName: "",
        ownerAddress: "",
        administratorName: "",
        administratorAddress: "",
        effectivityDate: new Date().getFullYear().toString(),
        tdNumber: "",
        detailedLocation: "",
        street: "",
        barangay: "",
        municipality: "Dipaculao",
        province: "Aurora",
        lotNo: "",
        blkNo: "",
        octTct: "",
        cctCloa: "",
        classification: "LAND",
        area: "",
        assessedValue: 0,
        previousTdNo: "",
        previousOwner: "",
        previousAssessedValue: 0,
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, "properties");
    }
  };

  const handleDeleteProperty = async (property: Property) => {
    if (activeTab === 'Active') {
      setConfirmDialog({
        isOpen: true,
        title: "Archive Property?",
        message: `You are about to archive the property with Tax Dec No: "${property.tdNumber}" belonging to "${property.ownerName}".\n\nIt will be moved to the Archive tab and its delinquencies will be hidden from the ledger. Are you sure you want to proceed?`,
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
      message: `You are about to restore the property with Tax Dec No: "${property.tdNumber}" belonging to "${property.ownerName}".\n\nIt will be moved back to the Active tab. Are you sure you want to proceed?`,
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
    
    // Clear previous errors
    const newErrors: Record<string, string> = {};

    // Validate Required Fields
    if (!formData.tdNumber) newErrors.tdNumber = "Tax Declaration Number is required";
    if (!formData.ownerName) newErrors.ownerName = "Owner name is required";
    if (!formData.barangay) newErrors.barangay = "Barangay is required";
    if (!formData.detailedLocation) newErrors.detailedLocation = "Detailed location is required";

    // Validate Area - Ensure it starts with or is a valid number
    if (formData.area) {
      const areaMatch = (formData.area as string).match(/^(\d+\.?\d*)/);
      if (!areaMatch) {
        newErrors.area = "Area must be a valid number (e.g., 500 or 1.2)";
      }
    } else {
      newErrors.area = "Area is required";
    }

    // Validate Assessed Values
    if (formData.assessedValue === undefined || formData.assessedValue < 0) {
      newErrors.assessedValue = "Valid assessed value is required";
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      // Scroll to first error? For now, just show them.
      return;
    }

    setErrors({});

    // Synchronous duplicate check to rigidly enforce uniqueness.
    const isDuplicate = properties.some(p => 
      p.tdNumber?.trim().toLowerCase() === formData.tdNumber?.trim().toLowerCase() && p.id !== editingId
    );

    if (isDuplicate) {
      const existing = properties.find(p => p.tdNumber?.trim().toLowerCase() === formData.tdNumber?.trim().toLowerCase());
      setConfirmDialog({
        isOpen: true,
        title: "Duplicate Record Violation",
        message: `CRITICAL: The Tax Declaration Number "${formData.tdNumber}" already exists in the registry.\n\nRegistered Owner: ${existing?.ownerName}\nLocation: Brgy. ${existing?.barangay}\n\nTo prevent data pollution, the system prevents multiple registrations of the same legal TD Number. Please verify your input or update the original record.`,
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
        ? `You are about to modify the registered electronic record for Tax Dec No: ${formData.tdNumber}. \n\nThis will synchronize changes across all linked tax entities. Do you wish to continue?`
        : `You are about to register a new property entity to the central tax database. \n\nTax Dec No: ${formData.tdNumber}\nOwner: ${formData.ownerName}\n\nPlease confirm these details are accurate.`,
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
      const tdLower = (p.tdNumber || "").trim().toLowerCase();
      const ownerLower = p.ownerName.trim().toLowerCase();
      const brgyLower = p.barangay.trim().toLowerCase();

      const exactTd = tdLower === lowerSearchTerm;
      const exactPin = pinLower === lowerSearchTerm;
      const exactOwner = ownerLower === lowerSearchTerm;

      if (exactTd || exactPin || exactOwner) {
        exactMatches.push({ ...p, exactTd, exactPin, exactOwner } as any);
      } else if (
        tdLower.includes(lowerSearchTerm) ||
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
              placeholder="Search by Tax Dec, PIN, Owner, or Barangay..." 
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
              {sortedAndFiltered.map(property => {
                const latestDelinq = delinquencies.filter(d => d.propertyId === property.id).sort((a,b) => b.year - a.year)[0];
                const exactTd = (property as any).exactTd;
                const exactPin = (property as any).exactPin;
                const exactOwner = (property as any).exactOwner;
                const isExact = exactTd || exactPin || exactOwner;
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
                            {exactTd ? <span className="bg-amber-500/20 text-amber-500 px-1 rounded">{property.tdNumber}</span> : property.tdNumber}
                          </p>
                          {(exactTd || exactPin) && (
                            <span className="px-1.5 py-0.5 bg-amber-500 text-slate-900 rounded-[4px] text-[8px] font-bold uppercase tracking-widest shadow-sm shadow-amber-500/20 flex-shrink-0">Exact Match</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">{property.classification} <span className="text-slate-700 mx-1">•</span> PIN: {property.pin}</p>
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
                            title="View RPTAR"
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
                  </td>
                </tr>
              )})}
            </tbody>
          </table>
        </div>
      </div>

      <AnimatePresence mode="popLayout">
        {isAdding && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-[60] flex items-center justify-center p-4 overflow-y-auto"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl w-full max-w-4xl overflow-hidden"
            >
              <div className="p-6 border-b border-slate-800 flex items-center justify-between bg-slate-950/50">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-indigo-500/10 rounded-xl">
                    <Building2 className="w-5 h-5 text-indigo-400" />
                  </div>
                  <h3 className="text-xl font-bold text-white tracking-tight">
                    {editingId ? "Modify Property Record" : "Property Registration Form"}
                  </h3>
                </div>
                <button 
                  onClick={() => {setIsAdding(false); setEditingId(null);}}
                  className="p-2 hover:bg-slate-800 rounded-xl text-slate-400 transition-colors"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              <form onSubmit={preSubmitCheck} className="p-8 space-y-8 max-h-[70vh] overflow-y-auto">
                {/* Section I */}
                <div className="space-y-4">
                  <h4 className="text-xs font-black text-indigo-400 uppercase tracking-[0.2em] flex items-center gap-2">
                     <div className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
                     I. RECORD OF OWNERSHIP
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-1">Complete Name of Owner</label>
                      <input 
                        className={cn(
                          "w-full px-4 py-2 bg-slate-950 border rounded-xl text-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none transition-all",
                          errors.ownerName ? "border-red-500/50 bg-red-500/5" : "border-slate-800"
                        )}
                        value={formData.ownerName}
                        onChange={e => {
                          setFormData({...formData, ownerName: e.target.value});
                          if (errors.ownerName) setErrors(prev => ({ ...prev, ownerName: "" }));
                        }}
                        required
                      />
                      {errors.ownerName && <p className="text-[9px] text-red-400 font-bold ml-1 uppercase">{errors.ownerName}</p>}
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-1">Address</label>
                      <input 
                        className="w-full px-4 py-2 bg-slate-950 border border-slate-800 rounded-xl text-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                        value={formData.ownerAddress}
                        onChange={e => setFormData({...formData, ownerAddress: e.target.value})}
                        required
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-1">Administrator/Beneficial User</label>
                      <input 
                        className="w-full px-4 py-2 bg-slate-950 border border-slate-800 rounded-xl text-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                        value={formData.administratorName}
                        onChange={e => setFormData({...formData, administratorName: e.target.value})}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-1">Administrator Address</label>
                      <input 
                        className="w-full px-4 py-2 bg-slate-950 border border-slate-800 rounded-xl text-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                        value={formData.administratorAddress}
                        onChange={e => setFormData({...formData, administratorAddress: e.target.value})}
                      />
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center justify-between px-1">
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Effectivity (Date of Transfer)</label>
                        <div className="flex items-center gap-2">
                          <input 
                            type="checkbox" 
                            id="yearOnly"
                            className="w-3 h-3 rounded bg-slate-950 border-slate-800 text-indigo-500 focus:ring-offset-0 focus:ring-0"
                            checked={!formData.effectivityDate?.includes('-')}
                            onChange={e => {
                              if (e.target.checked) {
                                setFormData({...formData, effectivityDate: new Date().getFullYear().toString()});
                              } else {
                                setFormData({...formData, effectivityDate: new Date().toISOString().split('T')[0]});
                              }
                            }}
                          />
                          <label htmlFor="yearOnly" className="text-[9px] text-slate-400 font-bold uppercase cursor-pointer select-none">Year Only</label>
                        </div>
                      </div>
                      {!formData.effectivityDate?.includes('-') ? (
                        <select 
                          className="w-full px-4 py-2 bg-slate-950 border border-slate-800 rounded-xl text-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none transition-all cursor-pointer"
                          value={formData.effectivityDate}
                          onChange={e => setFormData({...formData, effectivityDate: e.target.value})}
                          required
                        >
                          <option value="" disabled>Select Year</option>
                          {Array.from({length: 40}, (_, i) => (new Date().getFullYear() + 1 - i).toString()).map(y => (
                            <option key={y} value={y} className="bg-slate-950 text-slate-200">{y}</option>
                          ))}
                        </select>
                      ) : (
                        <input 
                          type="date"
                          className="w-full px-4 py-2 bg-slate-950 border border-slate-800 rounded-xl text-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none transition-all [color-scheme:dark]"
                          value={formData.effectivityDate}
                          onChange={e => setFormData({...formData, effectivityDate: e.target.value})}
                          required
                        />
                      )}
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-1">Tax Declaration Number</label>
                      <input 
                        className={cn(
                          "w-full px-4 py-2 bg-slate-950 border rounded-xl text-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-mono",
                          errors.tdNumber ? "border-red-500/50 bg-red-500/5" : "border-slate-800"
                        )}
                        value={formData.tdNumber}
                        onChange={e => {
                          setFormData({...formData, tdNumber: e.target.value});
                          if (errors.tdNumber) setErrors(prev => ({ ...prev, tdNumber: "" }));
                        }}
                        required
                      />
                      {errors.tdNumber && <p className="text-[9px] text-red-400 font-bold ml-1 uppercase">{errors.tdNumber}</p>}
                    </div>
                  </div>
                </div>

                {/* Section II */}
                <div className="space-y-4">
                  <h4 className="text-xs font-black text-indigo-400 uppercase tracking-[0.2em] flex items-center gap-2">
                     <div className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
                     II. TECHNICAL PROPERTY DESCRIPTION
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-1">Property Index No. (PIN) <span className="text-slate-700 italic">(Optional)</span></label>
                      <input 
                        className="w-full px-4 py-2 bg-slate-950 border border-slate-800 rounded-xl text-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-mono"
                        value={formData.pin}
                        onChange={e => setFormData({...formData, pin: e.target.value})}
                      />
                    </div>
                    <div className="col-span-1 md:col-span-2 space-y-1">
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-1">Detailed Location</label>
                      <input 
                        className={cn(
                          "w-full px-4 py-2 bg-slate-950 border rounded-xl text-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none transition-all",
                          errors.detailedLocation ? "border-red-500/50 bg-red-500/5" : "border-slate-800"
                        )}
                        value={formData.detailedLocation}
                        onChange={e => {
                          setFormData({...formData, detailedLocation: e.target.value});
                          if (errors.detailedLocation) setErrors(prev => ({ ...prev, detailedLocation: "" }));
                        }}
                        required
                      />
                      {errors.detailedLocation && <p className="text-[9px] text-red-400 font-bold ml-1 uppercase">{errors.detailedLocation}</p>}
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-1">Street</label>
                      <input 
                        className="w-full px-4 py-2 bg-slate-950 border border-slate-800 rounded-xl text-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                        value={formData.street}
                        onChange={e => setFormData({...formData, street: e.target.value})}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-1">Barangay</label>
                      <select 
                        className="w-full px-4 py-2 bg-slate-950 border border-slate-800 rounded-xl text-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none transition-all cursor-pointer"
                        value={formData.barangay}
                        onChange={e => setFormData({...formData, barangay: e.target.value})}
                        required
                      >
                        <option value="" disabled className="bg-slate-950 text-slate-200">Select Barangay</option>
                        {DIPACULAO_BARANGAYS.map(brgy => (
                          <option key={brgy} value={brgy} className="bg-slate-950 text-slate-200">{brgy}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-1">Municipality</label>
                      <input 
                        className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-xl text-slate-400 outline-none cursor-not-allowed"
                        value="Dipaculao"
                        readOnly
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-1">Province</label>
                      <input 
                        className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-xl text-slate-400 outline-none cursor-not-allowed"
                        value="Aurora"
                        readOnly
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-1">Lot No.</label>
                      <input 
                        className="w-full px-4 py-2 bg-slate-950 border border-slate-800 rounded-xl text-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                        value={formData.lotNo}
                        onChange={e => setFormData({...formData, lotNo: e.target.value})}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-1">Blk. No.</label>
                      <input 
                        className="w-full px-4 py-2 bg-slate-950 border border-slate-800 rounded-xl text-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                        value={formData.blkNo}
                        onChange={e => setFormData({...formData, blkNo: e.target.value})}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-1">OCT / TCT</label>
                      <input 
                        className="w-full px-4 py-2 bg-slate-950 border border-slate-800 rounded-xl text-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                        value={formData.octTct}
                        onChange={e => setFormData({...formData, octTct: e.target.value})}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-1">CCT / CLOA</label>
                      <input 
                        className="w-full px-4 py-2 bg-slate-950 border border-slate-800 rounded-xl text-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                        value={formData.cctCloa}
                        onChange={e => setFormData({...formData, cctCloa: e.target.value})}
                      />
                    </div>
                  </div>
                </div>

                {/* Section III */}
                <div className="space-y-4">
                  <h4 className="text-xs font-black text-indigo-400 uppercase tracking-[0.2em] flex items-center gap-2">
                     <div className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
                     III. KIND OF PROPERTY ASSESSED
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-1">Classification</label>
                      <select 
                        className="w-full px-4 py-2 bg-slate-950 border border-slate-800 rounded-xl text-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none transition-all cursor-pointer"
                        value={formData.classification}
                        onChange={e => setFormData({...formData, classification: e.target.value as any})}
                        required
                      >
                        <option value="LAND" className="bg-slate-950">LAND</option>
                        <option value="BUILDING" className="bg-slate-950">BUILDING</option>
                        <option value="MACHINERY" className="bg-slate-950">MACHINERY</option>
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-1">Area (sqm / ha)</label>
                      <input 
                        placeholder="e.g. 500 or 1.2 ha"
                        className={cn(
                          "w-full px-4 py-2 bg-slate-950 border rounded-xl text-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none transition-all",
                          errors.area ? "border-red-500/50 bg-red-500/5" : "border-slate-800"
                        )}
                        value={formData.area}
                        onChange={e => {
                          setFormData({...formData, area: e.target.value});
                          if (errors.area) {
                            const val = e.target.value.trim();
                            if (/^(\d+\.?\d*)/.test(val)) {
                              setErrors(prev => ({ ...prev, area: "" }));
                            }
                          }
                        }}
                        required
                      />
                      {errors.area && <p className="text-[9px] text-red-400 font-bold ml-1 uppercase">{errors.area}</p>}
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-1">Assessed Value (₱)</label>
                      <div className="relative">
                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 font-bold">₱</span>
                        <input 
                          type="text"
                          className={cn(
                            "w-full pl-8 pr-4 py-2 bg-slate-950 border rounded-xl text-emerald-400 font-bold focus:ring-2 focus:ring-indigo-500 outline-none transition-all",
                            errors.assessedValue ? "border-red-500/50 bg-red-500/5" : "border-slate-800"
                          )}
                          value={formData.assessedValue ? formData.assessedValue.toLocaleString(undefined, { maximumFractionDigits: 2 }) : ""}
                          onChange={e => {
                            const val = e.target.value.replace(/,/g, '');
                            if (/^\d*\.?\d*$/.test(val) || val === "") {
                              const numVal = parseFloat(val) || 0;
                              setFormData({...formData, assessedValue: numVal});
                              if (errors.assessedValue && numVal >= 0) {
                                setErrors(prev => ({ ...prev, assessedValue: "" }));
                              }
                            }
                          }}
                          required
                        />
                      </div>
                      {errors.assessedValue && <p className="text-[9px] text-red-400 font-bold ml-1 uppercase">{errors.assessedValue}</p>}
                    </div>
                  </div>
                </div>

                {/* Section IV */}
                <div className="space-y-4">
                  <h4 className="text-xs font-black text-indigo-400 uppercase tracking-[0.2em] flex items-center gap-2">
                     <div className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
                     IV. REMARKS
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-1">Previous TD / ARP No.</label>
                      <input 
                        className="w-full px-4 py-2 bg-slate-950 border border-slate-800 rounded-xl text-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                        value={formData.previousTdNo}
                        onChange={e => setFormData({...formData, previousTdNo: e.target.value})}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-1">Previous Owner</label>
                      <input 
                        className="w-full px-4 py-2 bg-slate-950 border border-slate-800 rounded-xl text-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                        value={formData.previousOwner}
                        onChange={e => setFormData({...formData, previousOwner: e.target.value})}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-1">Previous A.V. (₱)</label>
                      <div className="relative">
                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 font-bold">₱</span>
                        <input 
                          type="text"
                          className={cn(
                            "w-full pl-8 pr-4 py-2 bg-slate-950 border rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-bold",
                            errors.previousAssessedValue ? "border-red-500/50 bg-red-500/5 text-red-400" : "border-slate-800 text-slate-400"
                          )}
                          value={formData.previousAssessedValue ? formData.previousAssessedValue.toLocaleString(undefined, { maximumFractionDigits: 2 }) : ""}
                          onChange={e => {
                            const val = e.target.value.replace(/,/g, '');
                            if (/^\d*\.?\d*$/.test(val) || val === "") {
                              const numVal = parseFloat(val) || 0;
                              setFormData({...formData, previousAssessedValue: numVal});
                              if (errors.previousAssessedValue && numVal >= 0) {
                                setErrors(prev => ({ ...prev, previousAssessedValue: "" }));
                              }
                            }
                          }}
                        />
                      </div>
                      {errors.previousAssessedValue && <p className="text-[9px] text-red-400 font-bold ml-1 uppercase">{errors.previousAssessedValue}</p>}
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-1">Recorded By</label>
                      <input 
                        className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-xl text-slate-400 outline-none cursor-not-allowed font-medium italic"
                        value={formData.recordedBy || profile?.username || profile?.displayName || "..."}
                        readOnly
                      />
                    </div>
                  </div>
                </div>

                <div className="pt-6 flex gap-4">
                  <button 
                    type="button" 
                    onClick={() => {setIsAdding(false); setEditingId(null);}} 
                    className="flex-1 px-6 py-3 bg-slate-800 text-slate-300 rounded-xl hover:bg-slate-700 transition font-bold text-xs uppercase tracking-widest"
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit" 
                    className="flex-[2] px-6 py-3 bg-indigo-600 text-white rounded-xl hover:bg-indigo-500 transition shadow-xl shadow-indigo-600/20 font-bold text-xs uppercase tracking-widest flex items-center justify-center gap-2"
                  >
                    <Check className="w-4 h-4" />
                    {editingId ? "Update Registry Record" : "Finalize Registration"}
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

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
