import React from 'react';
import { CheckCircle2 } from 'lucide-react';

export const LabelVisualizer = ({
  barcodeData = 'DM-SAMPLE-12345',
  symbology = 'DataMatrix',
  operatorId = 'OP-449',
  timestamp = new Date().toLocaleTimeString(),
  qualityGrade = 'A',
  modelName = 'Zebra ZT411',
  isPrinting = false,
}) => {
  // Generate pseudo DataMatrix pattern based on barcode string
  const getMatrixDots = () => {
    const dots = [];
    const size = 12;
    for (let r = 0; r < size; r++) {
      const row = [];
      for (let c = 0; c < size; c++) {
        // DataMatrix standard finder pattern: bottom row & left col are solid
        if (r === size - 1 || c === 0) {
          row.push(true);
        } else if (r === 0 || c === size - 1) {
          // Top & right alternate (timing pattern)
          row.push(c % 2 === 0 || r % 2 === 0);
        } else {
          // Data cells derived deterministically
          const charCode = barcodeData.charCodeAt((r * size + c) % barcodeData.length) || 42;
          row.push((charCode + r + c) % 2 === 0);
        }
      }
      dots.push(row);
    }
    return dots;
  };

  const matrix = getMatrixDots();

  return (
    <div className="relative group">
      {/* Label container mimicking 4x2 inch thermal label */}
      <div
        className={`w-full bg-white text-black p-4 rounded-md shadow-lg border-2 border-slate-300 font-mono select-none transition-all duration-300 ${
          isPrinting ? 'animate-pulse ring-2 ring-cyan-500 scale-[0.99]' : ''
        }`}
        style={{ aspectRatio: '2 / 1', minHeight: '190px' }}
      >
        {/* Label Header */}
        <div className="border-b-2 border-black pb-1 mb-2 flex items-center justify-between">
          <div className="flex items-center gap-1.5 font-bold text-xs tracking-wider text-black">
            <span className="bg-black text-white px-1 py-0.2 text-[10px]">PASS</span>
            <span>COGNEX DM 262X VERIFIED</span>
          </div>
          <span className="text-[10px] text-neutral-600 font-sans">
            300 DPI • {modelName.split(' ')[0]}
          </span>
        </div>

        {/* Label Content Grid */}
        <div className="flex items-start gap-4">
          {/* Simulated 2D DataMatrix */}
          <div className="border-2 border-black p-1 bg-white shrink-0 shadow-sm">
            <div className="grid grid-cols-12 gap-[1px] w-20 h-20 bg-neutral-200">
              {matrix.map((row, ri) =>
                row.map((val, ci) => (
                  <div
                    key={`${ri}-${ci}`}
                    className={`${val ? 'bg-black' : 'bg-white'} w-full h-full`}
                  />
                ))
              )}
            </div>
            <div className="text-[8px] font-bold text-center mt-0.5 tracking-tighter text-black">
              ECC200 2D
            </div>
          </div>

          {/* Barcode details & metadata */}
          <div className="flex-1 min-w-0 space-y-1">
            <div>
              <div className="text-[9px] text-neutral-500 uppercase tracking-tight">
                Decoded Payload ({symbology})
              </div>
              <div className="text-xs font-black truncate tracking-wide text-black bg-neutral-100 px-1 py-0.5 border border-neutral-300">
                {barcodeData || 'NO READ'}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-1 text-[10px] text-neutral-800 pt-0.5">
              <div>
                <span className="text-neutral-500 block text-[8px]">TIMESTAMP</span>
                <span className="font-semibold">{timestamp}</span>
              </div>
              <div>
                <span className="text-neutral-500 block text-[8px]">OPERATOR</span>
                <span className="font-semibold">{operatorId}</span>
              </div>
              <div>
                <span className="text-neutral-500 block text-[8px]">ISO GRADE</span>
                <span className="font-bold text-black flex items-center gap-0.5">
                  <CheckCircle2 className="w-2.5 h-2.5 text-neutral-900" />
                  Grade {qualityGrade}
                </span>
              </div>
              <div>
                <span className="text-neutral-500 block text-[8px]">FORMAT</span>
                <span className="font-semibold">ZPL II</span>
              </div>
            </div>
          </div>
        </div>

        {/* 1D Barcode Footer Accent */}
        <div className="mt-2 pt-1 border-t border-black flex items-center justify-between">
          <div className="flex items-center gap-1">
            <div className="flex items-center space-x-[2px] h-4">
              {[3, 1, 2, 4, 1, 3, 2, 1, 3, 4, 2, 1, 3, 1, 4, 2, 1].map((w, i) => (
                <div key={i} className="bg-black h-full" style={{ width: `${w}px` }} />
              ))}
            </div>
            <span className="text-[8px] text-neutral-700 tracking-wider">
              *{barcodeData.slice(0, 10)}*
            </span>
          </div>
          <span className="text-[8px] font-sans font-bold text-neutral-600">
            INDUSTRIAL THERMAL
          </span>
        </div>
      </div>
    </div>
  );
};
