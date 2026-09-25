import React, { useState } from 'react';
import {
  Printer,
  Settings2,
  FileText,
  Layers,
  Terminal,
  Trash2,
  RotateCcw,
  Sliders,
} from 'lucide-react';
import { LabelVisualizer } from './LabelVisualizer';

export const PrinterPanel = ({
  device,
  onConnect,
  onDisconnect,
  onPrintTest,
  onPrintCustom,
  onClearLogs,
  lastScannedBarcode,
  isPrinting,
}) => {
  const [showConfig, setShowConfig] = useState(false);
  const [activeTab, setActiveTab] = useState('preview');
  const [hostInput, setHostInput] = useState(device?.config?.host || '192.168.1.5');
  const [portInput, setPortInput] = useState((device?.config?.port || 9944).toString());
  const [protocolInput, setProtocolInput] = useState(device?.config?.protocol || 'TCP_JSON');
  const [simulatedInput, setSimulatedInput] = useState(Boolean(device?.config?.isSimulated));
  const [messageNameInput, setMessageNameInput] = useState(device?.config?.messageName || '');
  const [dynamicFieldInput, setDynamicFieldInput] = useState(device?.config?.dynamicFieldName || 'dynamic_text');
  const [manualBarcodeInput, setManualBarcodeInput] = useState('');
  const [rawZplInput, setRawZplInput] = useState('DM-TEST-MANUAL');

  const handleSaveConfig = (e) => {
    e.preventDefault();
    onConnect({
      ...device.config,
      host: hostInput,
      port: parseInt(portInput, 10) || 9944,
      protocol: protocolInput,
      isSimulated: simulatedInput,
      messageName: messageNameInput.trim(),
      dynamicFieldName: dynamicFieldInput.trim() || 'dynamic_text',
    });
    setShowConfig(false);
  };

  const currentBarcode =
    lastScannedBarcode || (device?.history?.length > 0 ? device.history[0].barcodeData : 'SAMPLE-DM262X');

  return (
    <div className="bg-slate-900/90 rounded-xl border border-slate-800 shadow-xl overflow-hidden flex flex-col h-full">
      {/* Panel Header */}
      <div className="bg-slate-850 px-4 py-3 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
            <Printer className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-white tracking-wide">
                INDUSTRIAL PRINTER
              </h2>
              <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-slate-800 text-cyan-300 border border-slate-700">
                {device?.config?.protocol || 'TCP_JSON'}
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs font-mono text-slate-400">
              <span>{device?.config?.host}:{device?.config?.port}</span>
              <span className="text-slate-600">•</span>
              <span className="text-slate-500">TCP-JSON Socket</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            id="printer-config-toggle"
            onClick={() => setShowConfig(!showConfig)}
            className={`p-1.5 rounded-lg border text-xs transition-colors ${
              showConfig
                ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-slate-200'
            }`}
            title="Configure Printer IP & Port"
          >
            <Settings2 className="w-4 h-4" />
          </button>

          {device?.status === 'connected' ? (
            <button
              id="printer-disconnect-btn"
              onClick={onDisconnect}
              className="px-2.5 py-1 text-xs font-medium bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border border-rose-800/60 rounded-lg transition-colors"
            >
              Disconnect
            </button>
          ) : (
            <button
              id="printer-connect-btn"
              onClick={() => onConnect(device?.config)}
              className="px-2.5 py-1 text-xs font-medium bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg shadow-sm transition-colors"
            >
              Connect TCP
            </button>
          )}
        </div>
      </div>

      {/* Config Drawer */}
      {showConfig && (
        <form onSubmit={handleSaveConfig} className="bg-slate-950 p-4 border-b border-slate-800 space-y-3">
          <div className="text-xs font-semibold text-cyan-400 uppercase tracking-wider flex items-center gap-1.5">
            <Settings2 className="w-3.5 h-3.5" />
            Printer Network Socket Settings
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div>
              <label className="block text-slate-400 mb-1">Printer IP Address</label>
              <input
                id="printer-ip-input"
                type="text"
                value={hostInput}
                onChange={(e) => setHostInput(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-white font-mono focus:border-cyan-500 focus:outline-none"
                placeholder="192.168.1.6"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Socket Port (TCP-JSON: 9944)</label>
              <input
                id="printer-port-input"
                type="number"
                value={portInput}
                onChange={(e) => setPortInput(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-white font-mono focus:border-cyan-500 focus:outline-none"
                placeholder="9944"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Protocol Standard</label>
              <select
                id="printer-protocol-select"
                value={protocolInput}
                onChange={(e) => setProtocolInput(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-white font-mono focus:border-cyan-500 focus:outline-none"
              >
                <option value="TCP_JSON">TCP-JSON (Sojet documented)</option>
                <option value="ZPL">ZPL II (Zebra Industrial)</option>
                <option value="ESC-POS">ESC/POS (Thermal Receipt)</option>
                <option value="RAW_TEXT">Raw Plain Text</option>
              </select>
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Message Name (optional)</label>
              <input
                id="printer-message-name-input"
                type="text"
                value={messageNameInput}
                onChange={(e) => setMessageNameInput(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-white font-mono focus:border-cyan-500 focus:outline-none"
                placeholder="Msg"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Dynamic Text Field</label>
              <input
                id="printer-dynamic-field-input"
                type="text"
                value={dynamicFieldInput}
                onChange={(e) => setDynamicFieldInput(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-white font-mono focus:border-cyan-500 focus:outline-none"
                placeholder="dynamic_text"
              />
            </div>
            <div className="flex items-center justify-between pt-5">
              <label className="flex items-center gap-2 cursor-pointer text-slate-300">
                <input
                  id="printer-simulated-checkbox"
                  type="checkbox"
                  checked={simulatedInput}
                  onChange={(e) => setSimulatedInput(e.target.checked)}
                  className="rounded border-slate-700 text-cyan-500 focus:ring-cyan-500 bg-slate-900"
                />
                <span>Virtual Printer Engine</span>
              </label>
              <button
                type="submit"
                className="px-3 py-1 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold rounded text-xs transition-colors"
              >
                Save &amp; Connect
              </button>
            </div>
          </div>
        </form>
      )}

      {/* Main Body */}
      <div className="p-4 space-y-4 flex-1 flex flex-col overflow-y-auto">
        {/* Navigation Tabs */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-2">
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setActiveTab('preview')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors ${
                activeTab === 'preview'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Live Label Preview</span>
            </button>
            <button
              onClick={() => setActiveTab('zpl')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors ${
                activeTab === 'zpl'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>TCP Payload</span>
            </button>
            <button
              onClick={() => setActiveTab('queue')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors ${
                activeTab === 'queue'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Print Queue ({device?.history?.length || 0})</span>
            </button>
          </div>

          <button
            id="print-calibration-btn"
            onClick={onPrintTest}
            disabled={device?.status !== 'connected'}
            className="px-2.5 py-1 text-xs font-mono rounded bg-slate-800 hover:bg-slate-700 text-cyan-400 border border-cyan-500/30 disabled:opacity-50 transition-colors"
          >
            Test Alignment
          </button>
        </div>

        {/* Tab 1: Live Physical Label Visualizer */}
        {activeTab === 'preview' && (
          <div className="space-y-3">
            <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
              <div className="text-xs text-slate-400 mb-2 flex items-center justify-between">
                <span>Thermal Print Head Output (Synchronized with Cognex)</span>
                {isPrinting && (
                  <span className="text-cyan-400 animate-pulse font-mono font-bold">
                    PRINTING TO TCP SOCKET...
                  </span>
                )}
              </div>
              <LabelVisualizer
                barcodeData={currentBarcode}
                symbology="DataMatrix"
                modelName={device?.printerModel || 'Zebra ZT411'}
                isPrinting={isPrinting}
              />
            </div>

            {/* Quick Manual Print input */}
            <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 flex items-center gap-2">
              <input
                id="manual-barcode-input"
                type="text"
                value={manualBarcodeInput}
                onChange={(e) => setManualBarcodeInput(e.target.value)}
                placeholder="Print custom barcode / SN (e.g. PKG-99201)..."
                className="flex-1 bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-white font-mono focus:border-cyan-500 focus:outline-none"
              />
              <button
                id="manual-print-btn"
                onClick={() => {
                  if (manualBarcodeInput.trim()) {
                    onPrintCustom(manualBarcodeInput.trim());
                    setManualBarcodeInput('');
                  }
                }}
                disabled={device?.status !== 'connected' || !manualBarcodeInput.trim()}
                className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded font-medium text-xs transition-colors disabled:opacity-50 flex items-center gap-1.5"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Print</span>
              </button>
            </div>
          </div>
        )}

        {/* Tab 2: TCP dynamic-data payload */}
        {activeTab === 'zpl' && (
          <div className="space-y-2 flex-1 flex flex-col">
            <div className="text-xs text-slate-400 flex items-center justify-between">
              <span>Dynamic data content (sent through TCP-JSON /engine/dynamic)</span>
              <button
                onClick={() => onPrintCustom(rawZplInput, rawZplInput)}
                disabled={device?.status !== 'connected'}
                className="px-2.5 py-1 bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold rounded transition-colors disabled:opacity-50"
              >
                Send Dynamic Data
              </button>
            </div>
            <textarea
              id="raw-zpl-textarea"
              value={rawZplInput}
              onChange={(e) => setRawZplInput(e.target.value)}
              rows={7}
              className="w-full bg-slate-950 border border-slate-800 rounded p-2.5 font-mono text-xs text-cyan-300 focus:outline-none focus:border-cyan-500 resize-none"
            />
          </div>
        )}

        {/* Tab 3: Print Queue & History */}
        {activeTab === 'queue' && (
          <div className="space-y-2 flex-1 overflow-y-auto max-h-[220px]">
            {!device?.history || device.history.length === 0 ? (
              <div className="text-center py-6 text-xs text-slate-500 italic">
                No print jobs dispatched yet.
              </div>
            ) : (
              device.history.map((job) => (
                <div
                  key={job.id}
                  className="bg-slate-950 p-2.5 rounded border border-slate-800 flex items-center justify-between text-xs"
                >
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-white">{job.barcodeData}</span>
                      <span
                        className={`text-[10px] px-1.5 py-0.2 rounded uppercase font-mono ${
                          job.status === 'completed'
                            ? 'bg-emerald-950 text-emerald-300 border border-emerald-800/60'
                            : job.status === 'printing'
                            ? 'bg-cyan-950 text-cyan-300 border border-cyan-800/60 animate-pulse'
                            : 'bg-rose-950 text-rose-300 border border-rose-800/60'
                        }`}
                      >
                        {job.status}
                      </span>
                    </div>
                    <div className="text-[10px] text-slate-500 font-mono flex items-center gap-2">
                      <span>{job.title}</span>
                      <span>•</span>
                      <span>{new Date(job.timestamp).toLocaleTimeString()}</span>
                    </div>
                  </div>

                  <button
                    onClick={() => onPrintCustom(job.barcodeData, job.rawPayload)}
                    className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
                    title="Reprint Job"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>
        )}

        {/* Socket Logs Viewer */}
        <div className="flex-1 min-h-[140px] bg-slate-950 rounded-lg border border-slate-800 flex flex-col overflow-hidden">
          <div className="px-3 py-1.5 bg-slate-900 border-b border-slate-800 flex items-center justify-between text-xs">
            <div className="flex items-center gap-1.5 text-slate-400 font-mono">
              <Terminal className="w-3.5 h-3.5 text-cyan-400" />
              <span>Printer Socket Stream (Port {device?.config?.port || 9944})</span>
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
              <div className="text-slate-600 italic">No printer socket activity logged.</div>
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
                      : 'text-slate-400'
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
        </div>

        {/* Telemetry Stats */}
        <div className="grid grid-cols-3 gap-2 text-center text-xs">
          <div className="bg-slate-950 p-2 rounded border border-slate-800">
            <div className="text-slate-500 text-[10px] uppercase">Labels Printed</div>
            <div className="font-mono text-sm font-bold text-white">{device?.totalJobsPrinted || 0}</div>
          </div>
          <div className="bg-slate-950 p-2 rounded border border-slate-800">
            <div className="text-slate-500 text-[10px] uppercase">Print Head</div>
            <div className="font-mono text-sm font-bold text-emerald-400">
              {device?.isHeadOpen ? 'HEAD OPEN' : 'READY / CLOSED'}
            </div>
          </div>
          <div className="bg-slate-950 p-2 rounded border border-slate-800">
            <div className="text-slate-500 text-[10px] uppercase">Media Sensor</div>
            <div className="font-mono text-sm font-bold text-cyan-400">
              {device?.isPaperOut ? 'MEDIA OUT' : 'PAPER OK'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
