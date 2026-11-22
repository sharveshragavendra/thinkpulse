import React from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'primary';
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'primary',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#141033]/45 backdrop-blur-md p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="tp-confirm-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) onCancel();
          }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="w-full max-w-md rounded-3xl tp-modal-glass p-6 space-y-5"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3.5">
                <div
                  className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 ${
                    tone === 'danger'
                      ? 'bg-rose-500/12 text-rose-600 ring-1 ring-rose-500/20'
                      : 'bg-[#6334E8]/12 text-[#6334E8] ring-1 ring-[#6334E8]/20'
                  }`}
                >
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div>
                  <h3 id="tp-confirm-title" className="font-display font-bold text-base text-[#17143A]">
                    {title}
                  </h3>
                  <p className="text-sm text-[#433E68] mt-1 leading-relaxed">{description}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={onCancel}
                aria-label="Close confirmation dialog"
                className="p-1.5 rounded-xl text-[#5B617A] hover:text-[#17143A] hover:bg-white/80 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-[#17143A]/8">
              <button
                type="button"
                onClick={onCancel}
                className="tp-glass-btn px-4 py-2 rounded-xl text-xs font-semibold text-[#433E68] cursor-pointer"
              >
                {cancelLabel}
              </button>
              <button
                type="button"
                onClick={onConfirm}
                className={`px-4 py-2 rounded-xl text-xs font-semibold text-white cursor-pointer transition-all ${
                  tone === 'danger'
                    ? 'bg-rose-600 hover:bg-rose-700 shadow-sm shadow-rose-600/25'
                    : 'tp-gradient-btn'
                }`}
              >
                {confirmLabel}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
