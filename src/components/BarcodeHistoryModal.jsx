import React, { useState } from 'react';
import { X, Barcode as BarcodeIcon, Clock, Check, Copy, Printer } from 'lucide-react';

export const BarcodeHistoryModal = ({
  isOpen,
  onClose,
  reads = [],
  onReprint,
}) => {
  const [copiedId, setCopiedId] = useState(null);

  if (!isOpen) return null;

  const copyText = (id, text) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-850">
          <div className="flex items-center gap-2">
            <BarcodeIcon className="w-5 h-5 text-amber-400" />
            <h3 className="font-bold text-white text-sm">
              Cognex DM 262X Barcode Scan Archive ({reads.length})
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content list */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
          {reads.length === 0 ? (
            <div className="text-center py-12 text-slate-500 text-xs italic">
              No scans recorded yet. Trigger the Cognex DM 262X to populate the log.
            </div>
          ) : (
            reads.map((read) => (
              <div
                key={read.id}
                className="bg-slate-950 border border-slate-800 rounded-lg p-3 flex items-center justify-between gap-3 text-xs"
              >
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-emerald-400 text-sm truncate">
                      {read.data}
                    </span>
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-800 text-slate-300 border border-slate-700">
                      {read.symbology}
                    </span>
                    <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-amber-950 text-amber-300 border border-amber-800/60">
                      Grade {read.qualityGrade}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-slate-500 font-mono text-[11px]">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {read.decodeTimeMs} ms
                    </span>
                    <span>•</span>
                    <span>{new Date(read.timestamp).toLocaleString()}</span>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => copyText(read.id, read.data)}
                    className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
                    title="Copy Barcode"
                  >
                    {copiedId === read.id ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                  <button
                    onClick={() => onReprint(read.data)}
                    className="px-2.5 py-1.5 rounded bg-cyan-600 hover:bg-cyan-500 text-white font-medium text-xs flex items-center gap-1 transition-colors"
                  >
                    <Printer className="w-3 h-3" />
                    <span>Print Label</span>
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-800 bg-slate-850 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
