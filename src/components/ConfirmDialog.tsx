import React from "react";
import { motion, AnimatePresence } from "motion/react";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";

interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  type?: "danger" | "warning" | "info" | "success";
  confirmText?: string;
  cancelText?: string;
}

const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  type = "warning",
  confirmText = "Confirm Action",
  cancelText = "Cancel"
}) => {
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isOpen && e.key === "Enter") {
        e.preventDefault();
        onConfirm();
        onClose();
      }
    };
    if (isOpen) {
      window.addEventListener("keydown", handleKeyDown);
    }
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onConfirm, onClose]);

  const getIcon = () => {
    switch (type) {
      case "danger": return <AlertCircle className="w-8 h-8 text-red-500" />;
      case "warning": return <AlertCircle className="w-8 h-8 text-amber-500" />;
      case "success": return <CheckCircle2 className="w-8 h-8 text-emerald-500" />;
      default: return <Info className="w-8 h-8 text-blue-500" />;
    }
  };

  const getColors = () => {
    switch (type) {
      case "danger": return "bg-red-600 hover:bg-red-500 shadow-red-600/20";
      case "warning": return "bg-amber-600 hover:bg-amber-500 shadow-amber-600/20";
      case "success": return "bg-emerald-600 hover:bg-emerald-500 shadow-emerald-600/20";
      default: return "bg-blue-600 hover:bg-blue-500 shadow-blue-600/20";
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            initial={{ scale: 0.95, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 20 }}
            className="relative bg-slate-900 border border-slate-800 rounded-3xl shadow-3xl w-full max-w-md overflow-hidden p-8"
          >
            <div className="flex flex-col items-center text-center">
              <div className="p-3 bg-slate-800 rounded-2xl mb-6 border border-slate-700">
                {getIcon()}
              </div>
              <h3 className="text-xl font-bold text-white mb-2">{title}</h3>
              <p className="text-sm text-slate-400 mb-8 whitespace-pre-wrap">{message}</p>
              
              <div className="flex gap-3 w-full">
                <button
                  onClick={onClose}
                  className="flex-1 py-3 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-sm font-bold transition-all border border-slate-700"
                >
                  {cancelText}
                </button>
                <button
                  onClick={() => {
                    onConfirm();
                    onClose();
                  }}
                  className={`flex-1 py-3 text-white rounded-xl text-sm font-bold transition-all shadow-lg ${getColors()}`}
                >
                  {confirmText}
                </button>
              </div>
            </div>
            <button
              onClick={onClose}
              className="absolute top-4 right-4 p-2 text-slate-500 hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

export default ConfirmDialog;
