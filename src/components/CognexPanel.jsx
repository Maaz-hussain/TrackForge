import React, { useState, useEffect } from 'react';
import {
  Camera,
  Crosshair,
  Terminal,
  Zap,
  Play,
  Square,
  Settings2,
  Copy,
  Check,
  Barcode as BarcodeIcon,
  Clock,
  Image,
  Send,
  Trash2,
} from 'lucide-react';

export const CognexPanel = ({
  device,
  onTrigger,
  onConnect,
  onDisconnect,
  onSendCommand,
  onClearLogs,
  isTriggering,
}) => {
  const [showConfig, setShowConfig] = useState(false);
  const [customCmd, setCustomCmd] = useState('||>get device.name');
  const [hostInput, setHostInput] = useState(device?.config?.host || '169.254.76.4');
  const [portInput, setPortInput] = useState((device?.config?.port || 23).toString());
  const [userInput, setUserInput] = useState(device?.config?.user || 'admin');
  const [simulatedInput, setSimulatedInput] = useState(Boolean(device?.config?.isSimulated));
  const [copied, setCopied] = useState(false);
  const [autoTrigger, setAutoTrigger] = useState(false);
  const [triggerInterval, setTriggerInterval] = useState(3000);
  const [latestFtpImage, setLatestFtpImage] = useState(null);

  // Auto trigger interval effect
  useEffect(() => {
    let timer = null;
    if (autoTrigger && device?.status === 'connected') {
      timer = setInterval(() => {
        onTrigger();
      }, triggerInterval);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [autoTrigger, triggerInterval, device?.status, onTrigger]);

  useEffect(() => {
    let cancelled = false;
    let timer = null;

    const loadLatestImage = async () => {
      try {
        const res = await fetch('/api/cognex/images?limit=1');
        const value = await res.json();
        if (!cancelled && res.ok) {
          setLatestFtpImage(value.latest || null);
        }
      } catch {
        if (!cancelled) setLatestFtpImage(null);
      }
    };

    loadLatestImage();
    timer = setInterval(loadLatestImage, 2500);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, []);

  const handleSaveConfig = (e) => {
    e.preventDefault();
    onConnect({
      ...device.config,
      host: hostInput,
      port: parseInt(portInput, 10) || 23,
      user: userInput,
      isSimulated: simulatedInput,
    });
    setShowConfig(false);
  };

  const handleCopyBarcode = () => {
    if (device?.lastRead?.data) {
      navigator.clipboard.writeText(device.lastRead.data);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const quickDmccCommands = [
    { label: 'Trigger On', cmd: '||>trigger on\r\n' },
    { label: 'Device Name', cmd: '||>get device.name\r\n' },
    { label: 'Serial No.', cmd: '||>get system.serial-number\r\n' },
    { label: 'Exposure', cmd: '||>get camera.exposure\r\n' },
    { label: 'Beep', cmd: '||>beep 1\r\n' },
  ];

  return (
    <div className="bg-slate-900/90 rounded-xl border border-slate-800 shadow-xl overflow-hidden flex flex-col h-full lg:h-[calc(100vh-7rem)] lg:max-h-[900px]">
      {/* Panel Header */}
      <div className="bg-slate-850 px-4 py-3 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400">
            <Camera className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-white tracking-wide">
                COGNEX DataMan 262X
              </h2>
              <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                PoE Camera
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs font-mono text-slate-400">
              <span>{device?.config?.host}:{device?.config?.port}</span>
              <span className="text-slate-600">•</span>
              <span className="text-slate-500">Telnet Port 23</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            id="cognex-config-toggle"
            onClick={() => setShowConfig(!showConfig)}
            className={`p-1.5 rounded-lg border text-xs transition-colors ${
              showConfig
                ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-slate-200'
            }`}
            title="Configure Telnet IP & Credentials"
          >
            <Settings2 className="w-4 h-4" />
          </button>

          {device?.status === 'connected' ? (
            <button
              id="cognex-disconnect-btn"
              onClick={onDisconnect}
              className="px-2.5 py-1 text-xs font-medium bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border border-rose-800/60 rounded-lg transition-colors"
            >
              Disconnect
            </button>
          ) : (
            <button
              id="cognex-connect-btn"
              onClick={() => onConnect(device?.config)}
              className="px-2.5 py-1 text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg shadow-sm transition-colors"
            >
              Connect Telnet
            </button>
          )}
        </div>
      </div>

      {/* Config Drawer */}
      {showConfig && (
        <form onSubmit={handleSaveConfig} className="bg-slate-950 p-4 border-b border-slate-800 space-y-3">
          <div className="text-xs font-semibold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
            <Settings2 className="w-3.5 h-3.5" />
            Telnet Connection Parameters
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div>
              <label className="block text-slate-400 mb-1">Camera IP Address</label>
              <input
                id="cognex-ip-input"
                type="text"
                value={hostInput}
                onChange={(e) => setHostInput(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-white font-mono focus:border-amber-500 focus:outline-none"
                placeholder="169.254.76.4"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Telnet Port (Default 23)</label>
              <input
                id="cognex-port-input"
                type="number"
                value={portInput}
                onChange={(e) => setPortInput(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-white font-mono focus:border-amber-500 focus:outline-none"
                placeholder="23"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Telnet User (DMCC)</label>
              <input
                id="cognex-user-input"
                type="text"
                value={userInput}
                onChange={(e) => setUserInput(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-white font-mono focus:border-amber-500 focus:outline-none"
                placeholder="admin"
              />
            </div>
            <div className="flex items-center justify-between pt-5">
              <label className="flex items-center gap-2 cursor-pointer text-slate-300">
                <input
                  id="cognex-simulated-checkbox"
                  type="checkbox"
                  checked={simulatedInput}
                  onChange={(e) => setSimulatedInput(e.target.checked)}
                  className="rounded border-slate-700 text-amber-500 focus:ring-amber-500 bg-slate-900"
                />
                <span>Hardware Simulator</span>
              </label>
              <button
                type="submit"
                className="px-3 py-1 bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold rounded text-xs transition-colors"
              >
                Apply &amp; Reconnect
              </button>
            </div>
          </div>
        </form>
      )}

      {/* Main Body */}
      <div className="p-4 space-y-4 flex-1 min-h-0 flex flex-col overflow-y-auto overscroll-contain">
        {/* Optical Aiming Field & Trigger Controller */}
        <div className="relative bg-slate-950 rounded-lg border border-slate-800 p-4 overflow-hidden group">
          {/* Aiming Reticle Canvas simulation */}
          <div className="absolute inset-0 opacity-15 pointer-events-none bg-[radial-gradient(#f59e0b_1px,transparent_1px)] [background-size:16px_16px]" />
          
          {/* Visual Flash on Trigger */}
          {isTriggering && (
            <div className="absolute inset-0 bg-red-500/20 animate-ping pointer-events-none" />
          )}

          <div className="relative z-10 flex flex-col items-center justify-center text-center py-5">
            {/* Camera Reticle Target */}
            <div
              className={`w-24 h-24 rounded-full border-2 flex items-center justify-center relative transition-all duration-300 ${
                isTriggering
                  ? 'border-red-500 shadow-[0_0_20px_#ef4444] scale-95'
                  : 'border-amber-500/60 shadow-[0_0_12px_rgba(245,158,11,0.25)]'
              }`}
            >
              {/* Laser crosshair line */}
              <div className="absolute w-full h-[1.5px] bg-red-500/80 shadow-[0_0_6px_#ef4444]" />
              <div className="absolute h-full w-[1.5px] bg-red-500/40" />
              <div className="w-10 h-10 rounded-full border border-dashed border-amber-400/80 animate-spin-slow" />
              <Crosshair className={`w-6 h-6 ${isTriggering ? 'text-red-400' : 'text-amber-400'}`} />
            </div>

            <div className="mt-3">
              <span className="text-xs font-mono font-medium text-slate-300 uppercase tracking-wider">
                DM 262X Liquid Lens Optic
              </span>
              <p className="text-[11px] text-slate-500">
                1280x960 CMOS • Exposure: {device?.exposureUs || 1200} μs • Focus: {device?.focusPosition || 85}mm
              </p>
            </div>

            {/* Trigger Button & Controls */}
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2.5">
              <button
                id="cognex-manual-trigger-btn"
                onClick={onTrigger}
                disabled={device?.status !== 'connected'}
                className={`flex items-center gap-2 px-5 py-2 rounded-lg font-semibold text-xs tracking-wider uppercase transition-all shadow-md active:scale-95 ${
                  device?.status === 'connected'
                    ? 'bg-gradient-to-r from-red-600 to-rose-700 hover:from-red-500 hover:to-rose-600 text-white shadow-red-950/50 cursor-pointer'
                    : 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700'
                }`}
              >
                <Zap className="w-4 h-4 text-amber-300 fill-amber-300" />
                <span>Trigger Camera (Spacebar)</span>
              </button>

              <button
                id="cognex-auto-trigger-toggle"
                onClick={() => setAutoTrigger(!autoTrigger)}
                disabled={device?.status !== 'connected'}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-mono border transition-colors ${
                  autoTrigger
                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                    : 'bg-slate-900 text-slate-400 border-slate-800 hover:bg-slate-800'
                }`}
              >
                {autoTrigger ? <Square className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                <span>{autoTrigger ? 'Auto Loop ON' : 'Auto Loop'}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Latest Decoded Barcode Display */}
        <div className="bg-slate-950 rounded-lg border border-slate-800 p-3.5 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-400 font-medium flex items-center gap-1.5">
              <BarcodeIcon className="w-3.5 h-3.5 text-amber-400" />
              Latest Decoded Barcode
            </span>
            {device?.lastRead && (
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-emerald-950 text-emerald-300 border border-emerald-800/60">
                  {device.lastRead.symbology}
                </span>
                <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-amber-950 text-amber-300 border border-amber-800/60">
                  Grade {device.lastRead.qualityGrade}
                </span>
              </div>
            )}
          </div>

          {device?.lastRead ? (
            <div className="flex items-center justify-between bg-slate-900/90 rounded-md p-3 border border-slate-800">
              <div className="space-y-1 overflow-hidden">
                <div className="font-mono text-base font-bold text-emerald-400 truncate select-all tracking-wider">
                  {device.lastRead.data}
                </div>
                <div className="flex items-center gap-3 text-[11px] text-slate-400 font-mono">
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3 text-slate-500" />
                    {device.lastRead.decodeTimeMs} ms
                  </span>
                  <span>•</span>
                  <span>{new Date(device.lastRead.timestamp).toLocaleTimeString()}</span>
                </div>
              </div>

              <button
                id="copy-barcode-btn"
                onClick={handleCopyBarcode}
                className="p-2 rounded hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
                title="Copy Barcode to Clipboard"
              >
                {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
          ) : (
            <div className="py-4 text-center text-xs text-slate-500 italic">
              No barcode captured yet. Press 'Trigger Camera' to fire DMCC read.
            </div>
          )}
        </div>

        <div className="bg-slate-950 rounded-lg border border-slate-800 p-3.5 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-400 font-medium flex items-center gap-1.5">
              <Image className="w-3.5 h-3.5 text-amber-400" />
              Latest FTP Image
            </span>
            {latestFtpImage && (
              <span className="text-[10px] text-slate-500 font-mono">
                {new Date(latestFtpImage.modifiedAt).toLocaleTimeString()}
              </span>
            )}
          </div>
          {latestFtpImage ? (
            <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
              <img
                src={`${latestFtpImage.url}?t=${Math.floor(latestFtpImage.modifiedAt)}`}
                alt="Latest Cognex FTP capture"
                className="w-full max-h-64 object-contain bg-black"
              />
              <div className="px-2.5 py-1.5 text-[10px] text-slate-500 font-mono border-t border-slate-800 truncate">
                {latestFtpImage.filename}
              </div>
            </div>
          ) : (
            <div className="py-6 text-center text-xs text-slate-500">
              No FTP images found yet. Configure Cognex image logging to upload into the configured folder.
            </div>
          )}
        </div>

        {/* Quick DMCC Command Palette */}
        <div className="space-y-1.5">
          <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider flex items-center justify-between">
            <span>Cognex DMCC Commands</span>
            <span className="text-slate-600 font-mono">Telnet Syntax: ||&gt;cmd</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {quickDmccCommands.map((item) => (
              <button
                key={item.label}
                onClick={() => onSendCommand(item.cmd)}
                disabled={device?.status !== 'connected'}
                className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs font-mono transition-colors disabled:opacity-50"
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {/* Telnet Terminal Logs */}
        <div className="flex-1 min-h-[160px] bg-slate-950 rounded-lg border border-slate-800 flex flex-col overflow-hidden">
          <div className="px-3 py-1.5 bg-slate-900 border-b border-slate-800 flex items-center justify-between text-xs">
            <div className="flex items-center gap-1.5 text-slate-400 font-mono">
              <Terminal className="w-3.5 h-3.5 text-amber-400" />
              <span>Telnet I/O Console (Port {device?.config?.port || 23})</span>
            </div>
            <button
              onClick={onClearLogs}
              className="text-slate-500 hover:text-slate-300 transition-colors p-1"
              title="Clear Console"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex-1 p-2.5 font-mono text-[11px] overflow-y-auto space-y-1">
            {!device?.logs || device.logs.length === 0 ? (
              <div className="text-slate-600 italic">No Telnet logs yet.</div>
            ) : (
              device.logs.map((log) => (
                <div
                  key={log.id}
                  className={`leading-relaxed break-all ${
                    log.direction === 'out'
                      ? 'text-cyan-400'
                      : log.direction === 'in'
                      ? 'text-emerald-400'
                      : log.direction === 'error'
                      ? 'text-rose-400'
                      : 'text-amber-400/80'
                  }`}
                >
                  <span className="text-slate-600 mr-1.5">
                    [{new Date(log.timestamp).toLocaleTimeString()}]
                  </span>
                  <span className="font-bold mr-1.5">
                    {log.direction === 'out'
                      ? 'TX >'
                      : log.direction === 'in'
                      ? 'RX <'
                      : log.direction === 'error'
                      ? 'ERR !'
                      : 'SYS *'}
                  </span>
                  <span>{log.message}</span>
                </div>
              ))
            )}
          </div>

          {/* Direct Telnet command input */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (customCmd.trim()) {
                onSendCommand(customCmd);
              }
            }}
            className="p-1.5 bg-slate-900 border-t border-slate-800 flex items-center gap-1.5"
          >
            <input
              id="cognex-command-input"
              type="text"
              value={customCmd}
              onChange={(e) => setCustomCmd(e.target.value)}
              placeholder="||>trigger on"
              className="flex-1 bg-slate-950 border border-slate-700 rounded px-2.5 py-1 text-xs text-white font-mono focus:outline-none focus:border-amber-500"
            />
            <button
              id="cognex-send-command-btn"
              type="submit"
              disabled={device?.status !== 'connected'}
              className="px-2.5 py-1 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs rounded transition-colors disabled:opacity-50 flex items-center gap-1"
            >
              <Send className="w-3 h-3" />
              <span>Send</span>
            </button>
          </form>
        </div>

        {/* Telemetry Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs">
          <div className="bg-slate-950 p-2 rounded border border-slate-800">
            <div className="text-slate-500 text-[10px] uppercase">Triggers</div>
            <div className="font-mono text-sm font-bold text-white">{device?.totalTriggers || 0}</div>
          </div>
          <div className="bg-slate-950 p-2 rounded border border-slate-800">
            <div className="text-slate-500 text-[10px] uppercase">Good Reads</div>
            <div className="font-mono text-sm font-bold text-emerald-400">{device?.goodReads || 0}</div>
          </div>
          <div className="bg-slate-950 p-2 rounded border border-slate-800">
            <div className="text-slate-500 text-[10px] uppercase">No Reads</div>
            <div className="font-mono text-sm font-bold text-rose-400">{device?.noReads || 0}</div>
          </div>
          <div className="bg-slate-950 p-2 rounded border border-slate-800">
            <div className="text-slate-500 text-[10px] uppercase">Read Rate</div>
            <div className="font-mono text-sm font-bold text-amber-400">
              {(device?.goodReads || 0) + (device?.noReads || 0) > 0
                ? `${Math.round(((device?.goodReads || 0) / ((device?.goodReads || 0) + (device?.noReads || 0))) * 100)}%`
                : '100%'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
