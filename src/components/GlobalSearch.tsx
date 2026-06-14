import React, { useState, useEffect, useRef } from "react";
import { 
  collection, 
  onSnapshot, 
  db, 
  handleFirestoreError, 
  OperationType 
} from "../lib/firebase";
import { Property } from "../types";
import { Search, MapPin, Building2, AlertCircle, Loader2, X } from "lucide-react";
import { formatCurrency } from "../lib/utils";

interface GlobalSearchProps {
  onSelectProperty: (property: Property) => void;
}

export const GlobalSearch: React.FC<GlobalSearchProps> = ({ onSelectProperty }) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [properties, setProperties] = useState<Property[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Listen to property collections to make searching dynamic, real-time, and ultra-fast
    const unsubscribe = onSnapshot(collection(db, "properties"), (snapshot) => {
      const list = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      } as Property));
      setProperties(list);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, "properties");
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // Handle clicking outside to close the dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const cleanQuery = searchTerm.trim().toLowerCase();

  const filteredProperties = cleanQuery 
    ? properties.filter(p => {
        if (p.isArchived) return false;
        const owner = (p.ownerName || "").toLowerCase();
        const pin = (p.pin || "").toLowerCase();
        const td = (p.tdNumber || "").toLowerCase();
        const docId = (p.id || "").toLowerCase();

        return owner.includes(cleanQuery) || 
               pin.includes(cleanQuery) || 
               td.includes(cleanQuery) || 
               docId.includes(cleanQuery);
      })
    : [];

  return (
    <div ref={containerRef} className="relative w-80 md:w-96 select-none z-40">
      <div className="relative" style={{ paddingLeft: '-1px', paddingTop: '0px', marginLeft: '0px', marginRight: '18px' }}>
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" style={{ paddingLeft: '0px', marginLeft: '28px', paddingTop: '0px' }} />
        <input
          style={{ paddingLeft: '44px', paddingTop: '8px', paddingBottom: '8px', marginLeft: '24px' }}
          type="text"
          value={searchTerm}
          onChange={(e) => {
            setSearchTerm(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          placeholder="Search owner name, PIN, TDN..."
          className="w-full bg-slate-900/60 border border-slate-800/85 focus:border-blue-500/80 rounded-2xl py-2 pl-11 pr-10 text-xs text-white placeholder:text-slate-500 transition-all outline-none focus:ring-2 focus:ring-blue-500/10"
        />
        {searchTerm && (
          <button 
            type="button"
            onClick={() => {
              setSearchTerm("");
              setIsOpen(false);
            }}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {isOpen && (searchTerm.trim().length > 0 || loading) && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-slate-900/95 border border-slate-800/90 backdrop-blur-xl rounded-2xl shadow-2xl max-h-96 overflow-y-auto overflow-x-hidden p-2 z-50">
          {loading ? (
            <div className="flex items-center justify-center p-6 gap-2 text-xs text-slate-400">
              <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
              <span>Indexing properties...</span>
            </div>
          ) : filteredProperties.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-6 text-center text-xs text-slate-500">
              <AlertCircle className="w-6 h-6 text-slate-600 mb-2" />
              <p className="font-bold uppercase tracking-wider text-[10px] text-slate-300">No Match Found</p>
              <p className="text-[10px] text-slate-500 mt-0.5">Could not find any owner name or property matching your query.</p>
            </div>
          ) : (
            <div className="space-y-1">
              <div className="px-3 py-1.5 text-[9px] font-bold text-slate-400 uppercase tracking-widest border-b border-slate-800/45 mb-1 flex justify-between">
                <span>Matching Records</span>
                <span>{filteredProperties.length} found</span>
              </div>
              {filteredProperties.slice(0, 15).map((p) => {
                const isLand = p.classification === "LAND";
                const isBuilding = p.classification === "BUILDING";
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      onSelectProperty(p);
                      setIsOpen(false);
                      setSearchTerm("");
                    }}
                    className="w-full text-left p-3 rounded-xl hover:bg-slate-800/50 transition-colors flex items-start gap-3 border border-transparent hover:border-slate-800/60"
                  >
                    <div className={`p-2 rounded-xl shrink-0 mt-0.5 border ${
                      isLand 
                        ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" 
                        : isBuilding
                        ? "bg-blue-500/10 border-blue-500/20 text-blue-400"
                        : "bg-purple-500/10 border-purple-500/20 text-purple-400"
                    }`}>
                      {isLand ? <MapPin className="w-4 h-4" /> : <Building2 className="w-4 h-4" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-black text-xs text-white truncate max-w-[200px]" title={p.ownerName}>
                          {p.ownerName}
                        </span>
                        <span className={`text-[8px] font-mono px-1.5 py-0.5 rounded-full font-bold uppercase ${
                          isLand 
                            ? "bg-emerald-500/10 text-emerald-400" 
                            : isBuilding
                            ? "bg-blue-500/10 text-blue-400"
                            : "bg-purple-500/10 text-purple-400"
                        }`}>
                          {p.classification}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-slate-400 mt-1 font-mono">
                        <span className="text-[10px] font-bold text-blue-300">{p.tdNumber || "No TDN"}</span>
                        <span className="text-slate-600">•</span>
                        <span>PIN: {p.pin || "N/A"}</span>
                      </div>
                      <div className="text-[9px] text-slate-500 mt-0.5 flex justify-between items-center">
                        <span className="truncate text-slate-400">Brgy. {p.barangay || "---"}</span>
                        <span className="font-bold text-blue-400 font-mono">{formatCurrency(p.assessedValue)}</span>
                      </div>
                    </div>
                  </button>
                );
              })}
              {filteredProperties.length > 15 && (
                <div className="text-center py-2 text-[9px] font-bold text-blue-400 uppercase tracking-wider border-t border-slate-800/40">
                  Showing top 15 results. Refine search to see more.
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
