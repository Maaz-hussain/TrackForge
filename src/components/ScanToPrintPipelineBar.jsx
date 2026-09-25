import React, { useState } from 'react';
import {
  ArrowRight,
  Zap,
  SlidersHorizontal,
  Filter,
  User,
  Hash,
} from 'lucide-react';

export const ScanToPrintPipelineBar = ({
  pipeline,
  onUpdatePipeline,
  isTriggering,
  isPrinting,
}) => {
  const [showFilters, setShowFilters] = useState(false);
  const [prefixInput, setPrefixInput] = useState(pipeline?.barcodePrefixFilter || '');
  const [minLengthInput, setMinLengthInput] = useState((pipeline?.minBarcodeLength || 1).toString());
  const [operatorInput, setOperatorInput] = useState(pipeline?.operatorId || 'OP-449');

  const handleApplyRules = (e) => {
    e.preventDefault();
    onUpdatePipeline({
      barcodePrefixFilter: prefixInput,
      minBarcodeLength: parseInt(minLengthInput, 10) || 1,
      operatorId: operatorInput || 'OP-449',
    });
    setShowFilters(false);
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 shadow-lg">
     
      {/* Filter drawer */}
      {showFilters && (
        <form onSubmit={handleApplyRules} className="mt-3 pt-3 border-t border-slate-800 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          <div>
            <label className="block text-slate-400 mb-1 flex items-center gap-1">
              <Filter className="w-3 h-3 text-amber-400" />
              Barcode Prefix Filter (Optional)
            </label>
            <input
              id="prefix-filter-input"
              type="text"
              value={prefixInput}
              onChange={(e) => setPrefixInput(e.target.value)}
              placeholder="e.g. DM- or PKG- (leave empty for all)"
              className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-white font-mono focus:border-amber-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-slate-400 mb-1 flex items-center gap-1">
              <Hash className="w-3 h-3 text-amber-400" />
              Minimum Barcode Length
            </label>
            <input
              id="min-length-input"
              type="number"
              value={minLengthInput}
              onChange={(e) => setMinLengthInput(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-white font-mono focus:border-amber-500 focus:outline-none"
            />
          </div>

          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label className="block text-slate-400 mb-1 flex items-center gap-1">
                <User className="w-3 h-3 text-amber-400" />
                Operator Badge ID
              </label>
              <input
                id="operator-id-input"
                type="text"
                value={operatorInput}
                onChange={(e) => setOperatorInput(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-white font-mono focus:border-amber-500 focus:outline-none"
              />
            </div>
            <button
              type="submit"
              className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded text-xs transition-colors h-[34px]"
            >
              Apply
            </button>
          </div>
        </form>
      )}
    </div>
  );
};
