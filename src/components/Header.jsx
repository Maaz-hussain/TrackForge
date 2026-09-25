import React from 'react';
import { Camera, Printer, Activity, RefreshCw, Volume2, VolumeX, Cpu, Radio } from 'lucide-react';

export const Header = ({ state, onRefresh, isPolling, onToggleSound }) => {
  const cognexConnected = state?.cognex?.status === 'connected';
  const printerConnected = state?.printer?.status === 'connected';
  const isSimulatedMode = state?.cognex?.config?.isSimulated || state?.printer?.config?.isSimulated;

  return (
    <header className="bg-slate-900 border-b border-slate-800 px-4 lg:px-6 py-3 sticky top-0 z-30 shadow-md">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        {/* Brand & Device Title */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-lg shadow-orange-500/20 text-white font-bold tracking-wider">
            <Radio className="w-5 h-5 text-white animate-pulse" />
          </div>
          <div>
             
            <p className="text-xs text-slate-400">
              Camera &amp;  Printer Controller
            </p>
          </div>
        </div>

        {/* Live Device Status Pills & Controls */}
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          {/* Cognex Telnet Status Pill */}
          <div
            id="cognex-status-badge"
            className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-mono border transition-all ${
              cognexConnected
                ? 'bg-emerald-950/40 text-emerald-300 border-emerald-500/40 shadow-sm shadow-emerald-950'
                : state?.cognex?.status === 'connecting'
                ? 'bg-amber-950/40 text-amber-300 border-amber-500/40 animate-pulse'
                : 'bg-rose-950/40 text-rose-300 border-rose-500/40'
            }`}
          >
            <Camera className="w-3.5 h-3.5" />
            <div className="flex items-center gap-1.5">
              <span
                className={`w-2 h-2 rounded-full ${
                  cognexConnected ? 'bg-emerald-400 shadow-[0_0_8px_#34d399]' : 'bg-rose-400'
                }`}
              />
              <span className="font-medium">Camera:</span>
              <span className="uppercase">{state?.cognex?.status || 'Offline'}</span>
            </div>
          </div>

          {/* Printer Socket Status Pill */}
          <div
            id="printer-status-badge"
            className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-mono border transition-all ${
              printerConnected
                ? 'bg-cyan-950/40 text-cyan-300 border-cyan-500/40 shadow-sm shadow-cyan-950'
                : state?.printer?.status === 'connecting'
                ? 'bg-amber-950/40 text-amber-300 border-amber-500/40 animate-pulse'
                : 'bg-rose-950/40 text-rose-300 border-rose-500/40'
            }`}
          >
            <Printer className="w-3.5 h-3.5" />
            <div className="flex items-center gap-1.5">
              <span
                className={`w-2 h-2 rounded-full ${
                  printerConnected ? 'bg-cyan-400 shadow-[0_0_8px_#22d3ee]' : 'bg-rose-400'
                }`}
              />
              <span className="font-medium">Printer:</span>
              <span className="uppercase">{state?.printer?.status || 'Offline'}</span>
            </div>
          </div>

          {/* Mode Pill */}
          <div
            className={`px-2.5 py-1 rounded text-xs font-mono flex items-center gap-1.5 border ${
              isSimulatedMode
                ? 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                : 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
            }`}
            title={isSimulatedMode ? 'Simulator active: virtual hardware emulation enabled' : 'Physical TCP Socket active'}
          >
            <Cpu className="w-3 h-3" />
            <span>{isSimulatedMode ? 'Simulator Active' : 'Real Hardware'}</span>
          </div>

          {/* Sound Toggle */}
          <button
            id="sound-toggle-btn"
            onClick={onToggleSound}
            className={`p-2 rounded-md border text-xs transition-colors ${
              state?.pipeline?.soundEnabled
                ? 'bg-slate-800 text-slate-200 border-slate-700 hover:bg-slate-700'
                : 'bg-slate-800/50 text-slate-500 border-slate-800 line-through'
            }`}
            title={state?.pipeline?.soundEnabled ? 'Audio alerts enabled' : 'Audio alerts muted'}
          >
            {state?.pipeline?.soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>

          {/* Refresh Button */}
          <button
            id="refresh-sync-btn"
            onClick={onRefresh}
            className="p-2 rounded-md bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700 transition-colors"
            title="Poll device status"
          >
            <RefreshCw className={`w-4 h-4 ${isPolling ? 'animate-spin text-amber-400' : ''}`} />
          </button>
        </div>
      </div>
    </header>
  );
};
