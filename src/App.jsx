import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Header } from './components/Header';
import { CognexPanel } from './components/CognexPanel';
import { PrinterManagementPage } from './components/PrinterManagementPage';
import { ScanToPrintPipelineBar } from './components/ScanToPrintPipelineBar';
import { BarcodeHistoryModal } from './components/BarcodeHistoryModal';
import { playGoodReadBeep, playPrintDoneSound } from './utils/audio';
import {
  Database,
  LayoutDashboard,
  Loader2,
  Printer as PrinterIcon,
  RefreshCw,
  Send,
  Settings2,
  Terminal,
  X,
  Zap,
  History,
  Radio,
  Info,
} from 'lucide-react';

export default function App() {
  const [state, setState] = useState(null);
  const [isPolling, setIsPolling] = useState(false);
  const [isTriggering, setIsTriggering] = useState(false);
  const [isPrinting, setIsPrinting] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [notice, setNotice] = useState(null);
  const [activeView, setActiveView] = useState('overview');
  const [overviewRecipes, setOverviewRecipes] = useState([]);
  const [selectedRecipeId, setSelectedRecipeId] = useState('');
  const [selectedRecipeDetail, setSelectedRecipeDetail] = useState(null);
  const [recipeSelectionValues, setRecipeSelectionValues] = useState({});
  const [recipeSerials, setRecipeSerials] = useState([]);
  const [recipeBatchSize, setRecipeBatchSize] = useState('1');
  const [printExistingOnly, setPrintExistingOnly] = useState(true);
  const [recipeBusy, setRecipeBusy] = useState('');
  const [printerQueue, setPrinterQueue] = useState(null);
  const [printerQueueBusy, setPrinterQueueBusy] = useState(false);
  const [showPrinterSettings, setShowPrinterSettings] = useState(false);
  const [printerHostInput, setPrinterHostInput] = useState('');
  const [printerPortInput, setPrinterPortInput] = useState('9944');
  const [printerTimeoutInput, setPrinterTimeoutInput] = useState('4000');
  const [cameraHostInput, setCameraHostInput] = useState('');
  const [cameraPortInput, setCameraPortInput] = useState('23');
  const [cameraUserInput, setCameraUserInput] = useState('admin');
  const [cameraPasswordInput, setCameraPasswordInput] = useState('');
  const [cameraTimeoutInput, setCameraTimeoutInput] = useState('4000');
  const [cameraFtpDirInput, setCameraFtpDirInput] = useState('');

  const prevLastReadId = useRef(null);
  const prevJobCount = useRef(0);

  // Fetch state from server
  const fetchState = useCallback(async () => {
    try {
      setIsPolling(true);
      const res = await fetch('/api/system/state');
      if (res.ok) {
        const data = await res.json();
        setState(data);

        // Sound trigger on new barcode read
        if (data.cognex?.lastRead && data.cognex.lastRead.id !== prevLastReadId.current) {
          if (prevLastReadId.current !== null && data.pipeline?.soundEnabled) {
            playGoodReadBeep();
          }
          prevLastReadId.current = data.cognex.lastRead.id;
        }

        // Sound trigger on new print job completion
        if (data.printer?.totalJobsPrinted > prevJobCount.current) {
          if (prevJobCount.current !== 0 && data.pipeline?.soundEnabled) {
            playPrintDoneSound();
          }
          prevJobCount.current = data.printer.totalJobsPrinted;
        }
      }
    } catch (err) {
      console.error('Error fetching state:', err);
    } finally {
      setIsPolling(false);
    }
  }, []);

  // Polling loop
  useEffect(() => {
    fetchState();
    const interval = setInterval(fetchState, 1200);
    return () => clearInterval(interval);
  }, [fetchState]);

  // Spacebar hotkey to trigger Cognex camera
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Ignore if user is typing inside an input or textarea
      const target = e.target;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }
      if (e.code === 'Space') {
        e.preventDefault();
        handleTriggerCognex();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [state]);

  // Trigger Cognex Camera
  const handleTriggerCognex = async () => {
    setIsTriggering(true);
    try {
      const res = await fetch('/api/cognex/trigger', { method: 'POST' });
      const value = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(value.error || 'Could not trigger Cognex camera');
      if (res.ok) {
        setTimeout(fetchState, 150);
        setTimeout(fetchState, 450);
      }
    } catch (err) {
      setNotice(err.message);
    } finally {
      setTimeout(() => setIsTriggering(false), 500);
    }
  };

  // Cognex Connect
  const handleConnectCognex = async (config) => {
    try {
      const res = await fetch('/api/cognex/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      if (res.ok) {
        setNotice(`Connecting to Cognex at ${config.host}:${config.port}...`);
        setTimeout(fetchState, 300);
      }
    } catch (err) {
      console.error('Failed to connect Cognex:', err);
    }
  };

  // Cognex Disconnect
  const handleDisconnectCognex = async () => {
    try {
      await fetch('/api/cognex/disconnect', { method: 'POST' });
      fetchState();
    } catch (err) {
      console.error('Failed to disconnect Cognex:', err);
    }
  };

  // Cognex Send Command
  const handleSendCognexCommand = async (command) => {
    try {
      const res = await fetch('/api/cognex/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command }),
      });
      const value = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(value.error || 'Could not send Cognex command');
      setTimeout(fetchState, 200);
    } catch (err) {
      setNotice(err.message);
    }
  };

  // Printer Connect
  const handleConnectPrinter = async (config) => {
    try {
      const res = await fetch('/api/printer/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      if (res.ok) {
        setNotice(`Connecting to Printer socket at ${config.host}:${config.port}...`);
        setTimeout(fetchState, 300);
      }
    } catch (err) {
      console.error('Failed to connect Printer:', err);
    }
  };

  // Printer Disconnect
  const handleDisconnectPrinter = async () => {
    try {
      await fetch('/api/printer/disconnect', { method: 'POST' });
      fetchState();
    } catch (err) {
      console.error('Failed to disconnect Printer:', err);
    }
  };

  const openPrinterSettings = () => {
    const printerConfig = state?.printer?.config || {};
    const cameraConfig = state?.cognex?.config || {};
    setPrinterHostInput(printerConfig.host || '192.168.1.6');
    setPrinterPortInput(String(printerConfig.port || 9944));
    setPrinterTimeoutInput(String(printerConfig.timeoutMs || 4000));
    setCameraHostInput(cameraConfig.host || '169.254.76.4');
    setCameraPortInput(String(cameraConfig.port || 23));
    setCameraUserInput(cameraConfig.user || 'admin');
    setCameraPasswordInput(cameraConfig.password || '');
    setCameraTimeoutInput(String(cameraConfig.timeoutMs || 4000));
    setCameraFtpDirInput(cameraConfig.ftpImageDirectory || 'data/cognex-ftp-images');
    setShowPrinterSettings(true);
  };

  const handleSavePrinterSettings = async (connectAfterSave = false) => {
    const config = {
      ...state?.printer?.config,
      host: printerHostInput.trim(),
      port: Number(printerPortInput) || 9944,
      timeoutMs: Number(printerTimeoutInput) || 4000,
      protocol: state?.printer?.config?.protocol || 'TCP_JSON',
      isSimulated: false,
    };

    try {
      const endpoint = connectAfterSave ? '/api/printer/connect' : '/api/printer/config';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      const value = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(value.error || 'Could not save printer settings');
      setNotice(connectAfterSave ? `Connecting to printer at ${config.host}:${config.port}...` : 'Printer settings saved.');
      setShowPrinterSettings(false);
      setTimeout(fetchState, 250);
    } catch (err) {
      setNotice(err.message);
    }
  };

  const handleSaveCameraSettings = async (connectAfterSave = false) => {
    const config = {
      ...state?.cognex?.config,
      host: cameraHostInput.trim(),
      port: Number(cameraPortInput) || 23,
      user: cameraUserInput,
      password: cameraPasswordInput,
      timeoutMs: Number(cameraTimeoutInput) || 4000,
      isSimulated: false,
      ftpImageDirectory: cameraFtpDirInput.trim(),
    };

    try {
      const endpoint = connectAfterSave ? '/api/cognex/connect' : '/api/cognex/config';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      const value = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(value.error || 'Could not save camera settings');
      setNotice(connectAfterSave ? `Connecting to camera at ${config.host}:${config.port}...` : 'Camera settings saved.');
      setTimeout(fetchState, 250);
    } catch (err) {
      setNotice(err.message);
    }
  };

  // Print Test Label
  const handlePrintTest = async () => {
    setIsPrinting(true);
    try {
      await fetch('/api/printer/test-print', { method: 'POST' });
      setTimeout(fetchState, 400);
      setTimeout(fetchState, 1000);
    } catch (err) {
      console.error('Failed to test print:', err);
    } finally {
      setTimeout(() => setIsPrinting(false), 900);
    }
  };

  // Print Custom / Manual Barcode
  const handlePrintCustom = async (barcodeData, rawPayload) => {
    setIsPrinting(true);
    try {
      await fetch('/api/printer/print', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          barcodeData,
          rawPayload,
          title: `Manual Print: ${barcodeData}`,
        }),
      });
      setTimeout(fetchState, 400);
      setTimeout(fetchState, 1000);
    } catch (err) {
      console.error('Failed to print custom job:', err);
    } finally {
      setTimeout(() => setIsPrinting(false), 900);
    }
  };

  // Update Pipeline Settings
  const handleUpdatePipeline = async (partial) => {
    try {
      await fetch('/api/pipeline/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(partial),
      });
      fetchState();
    } catch (err) {
      console.error('Failed to update pipeline:', err);
    }
  };

  // Toggle Sound
  const handleToggleSound = () => {
    if (state) {
      handleUpdatePipeline({ soundEnabled: !state.pipeline.soundEnabled });
    }
  };

  // Clear Logs
  const handleClearLogs = async (target) => {
    try {
      await fetch('/api/logs/clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target }),
      });
      fetchState();
    } catch (err) {
      console.error('Failed to clear logs:', err);
    }
  };

  const loadPrinterQueue = useCallback(async () => {
    setPrinterQueueBusy(true);
    try {
      const res = await fetch('/api/printer/status');
      const value = await res.json();
      if (!res.ok) throw new Error(value.error || 'Could not read printer queue');
      setPrinterQueue(value.queue || null);
    } catch (err) {
      setPrinterQueue({ available: false, error: err.message });
    } finally {
      setPrinterQueueBusy(false);
    }
  }, []);

  const loadOverviewRecipes = useCallback(async () => {
    setRecipeBusy('recipes');
    try {
      const res = await fetch('/api/printer/recipes');
      const value = await res.json();
      if (!res.ok) throw new Error(value.error || 'Could not load recipes');
      setOverviewRecipes(value.recipes || []);
      if (!selectedRecipeId && value.recipes?.length) {
        const firstId = String(value.recipes[0].id);
        setSelectedRecipeId(firstId);
        await loadOverviewRecipeDetail(firstId);
        loadRecipeSerials(firstId);
      }
    } catch (err) {
      setNotice(err.message);
    } finally {
      setRecipeBusy('');
    }
  }, [selectedRecipeId]);

  const loadRecipeSerials = async (recipeId = selectedRecipeId) => {
    if (!recipeId) return;
    setRecipeBusy('serials');
    try {
      const res = await fetch(`/api/printer/recipes/${recipeId}/serials?limit=50`);
      const value = await res.json();
      if (!res.ok) throw new Error(value.error || 'Could not load recipe serials');
      setRecipeSerials(value.serials || []);
    } catch (err) {
      setNotice(err.message);
    } finally {
      setRecipeBusy('');
    }
  };

  const loadOverviewRecipeDetail = async (recipeId) => {
    if (!recipeId) {
      setSelectedRecipeDetail(null);
      setRecipeSelectionValues({});
      return null;
    }
    const res = await fetch(`/api/printer/recipes/${recipeId}`);
    const value = await res.json();
    if (!res.ok) throw new Error(value.error || 'Could not load recipe');
    setSelectedRecipeDetail(value.recipe);
    setRecipeSelectionValues(Object.fromEntries(
      (value.recipe?.fields || [])
        .filter((field) => field.mode === 'recipe')
        .map((field) => [`${field.fieldType}:${field.fieldId}`, field.value || '']),
    ));
    return value.recipe;
  };

  const handleSelectOverviewRecipe = async (recipeId) => {
    setSelectedRecipeId(recipeId);
    setSelectedRecipeDetail(null);
    setRecipeSelectionValues({});
    if (!recipeId) {
      setRecipeSerials([]);
      return;
    }
    setRecipeBusy('selectRecipe');
    try {
      await loadOverviewRecipeDetail(recipeId);
      setNotice('Recipe loaded. Set selection fields, then print.');
      await loadRecipeSerials(recipeId);
    } catch (err) {
      setNotice(err.message);
      await loadRecipeSerials(recipeId);
    } finally {
      setRecipeBusy('');
    }
  };

  const handleGenerateRecipeBatch = async () => {
    if (!selectedRecipeId) return;
    setRecipeBusy('generate');
    try {
      const res = await fetch(`/api/printer/recipes/${selectedRecipeId}/generate-batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quantity: Number(recipeBatchSize) || 1,
          fieldOverrides: recipeSelectionValues,
        }),
      });
      const value = await res.json();
      if (!res.ok) throw new Error(value.error || 'Could not generate batch');
      setNotice(`Generated ${value.generated} serials.`);
      await loadRecipeSerials(selectedRecipeId);
    } catch (err) {
      setNotice(err.message);
    } finally {
      setRecipeBusy('');
    }
  };

  const handlePrintRecipeBatch = async () => {
    if (!selectedRecipeId) return;
    setRecipeBusy('print');
    try {
      const res = await fetch(`/api/printer/recipes/${selectedRecipeId}/print-batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quantity: Number(recipeBatchSize) || 1,
          useExistingOnly: printExistingOnly,
          fieldOverrides: recipeSelectionValues,
        }),
      });
      const value = await res.json();
      if (!res.ok) throw new Error(value.error || 'Could not print batch');
      setNotice(`Printed ${value.printed}/${value.requested} recipe messages.`);
      await loadRecipeSerials(selectedRecipeId);
      await loadPrinterQueue();
      fetchState();
    } catch (err) {
      setNotice(err.message);
    } finally {
      setRecipeBusy('');
    }
  };

  useEffect(() => {
    if (activeView === 'overview') {
      loadOverviewRecipes();
      loadPrinterQueue();
    }
  }, [activeView, loadOverviewRecipes, loadPrinterQueue]);

  useEffect(() => {
    if (activeView !== 'overview' || !selectedRecipeId) return undefined;
    const refreshSerials = async () => {
      try {
        const res = await fetch(`/api/printer/recipes/${selectedRecipeId}/serials?limit=50`);
        const value = await res.json();
        if (res.ok) setRecipeSerials(value.serials || []);
      } catch {
        // The normal action handlers surface API errors; background refresh stays silent.
      }
    };
    const timer = setInterval(refreshSerials, 2000);
    return () => clearInterval(timer);
  }, [activeView, selectedRecipeId]);

  const selectedRecipe = overviewRecipes.find((recipe) => String(recipe.id) === String(selectedRecipeId));

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex font-sans selection:bg-amber-500 selection:text-black">
      <aside className="hidden lg:flex w-64 shrink-0 border-r border-slate-800 bg-slate-950/95 flex-col sticky top-0 h-screen">
        <div className="p-4 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-300">
              <Radio className="w-4 h-4" />
            </div>
            <div>
              <div className="text-sm font-semibold text-white">Track &amp; Trace</div>
              <div className="text-[11px] text-slate-500 font-mono">Device Console</div>
            </div>
          </div>
        </div>

        <nav className="p-3 space-y-1">
          <button
            onClick={() => setActiveView('overview')}
            className={`w-full px-3 py-2 rounded-lg text-sm flex items-center gap-2 border transition-colors ${
              activeView === 'overview'
                ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                : 'text-slate-400 border-transparent hover:bg-slate-900 hover:text-slate-200'
            }`}
          >
            <LayoutDashboard className="w-4 h-4" />
            Overview
          </button>
          <button
            onClick={() => setActiveView('printer')}
            className={`w-full px-3 py-2 rounded-lg text-sm flex items-center gap-2 border transition-colors ${
              activeView === 'printer'
                ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30'
                : 'text-slate-400 border-transparent hover:bg-slate-900 hover:text-slate-200'
            }`}
          >
            <PrinterIcon className="w-4 h-4" />
            Printer
          </button>
          <button
            onClick={() => setActiveView('logs')}
            className={`w-full px-3 py-2 rounded-lg text-sm flex items-center gap-2 border transition-colors ${
              activeView === 'logs'
                ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                : 'text-slate-400 border-transparent hover:bg-slate-900 hover:text-slate-200'
            }`}
          >
            <Terminal className="w-4 h-4" />
            Logs
          </button>
        </nav>

        <div className="mt-auto p-3">
          <div className="rounded-lg border border-slate-800 bg-slate-900 p-3 text-xs">
            <div className="text-slate-500 uppercase font-mono text-[10px]">Printer Endpoint</div>
            <div className="text-cyan-300 font-mono mt-1">
              {state?.printer?.config?.host || '192.168.1.6'}:{state?.printer?.config?.port || 9944}
            </div>
            <button
              onClick={openPrinterSettings}
              className="mt-3 w-full px-2.5 py-1.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 flex items-center justify-center gap-1.5"
            >
              <Settings2 className="w-3.5 h-3.5" />
              Device Settings
            </button>
          </div>
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top System Bar */}
        <Header
          state={state}
          onRefresh={fetchState}
          isPolling={isPolling}
          onToggleSound={handleToggleSound}
        />

      {/* Main Workspace */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 space-y-5">
        <div className="lg:hidden flex gap-2 overflow-x-auto pb-1">
          <button
            onClick={() => setActiveView('overview')}
            className={`px-3 py-1.5 rounded-lg text-xs border flex items-center gap-1.5 ${
              activeView === 'overview' ? 'bg-amber-500/15 text-amber-300 border-amber-500/30' : 'bg-slate-900 text-slate-400 border-slate-800'
            }`}
          >
            <LayoutDashboard className="w-3.5 h-3.5" />
            Overview
          </button>
          <button
            onClick={() => setActiveView('printer')}
            className={`px-3 py-1.5 rounded-lg text-xs border flex items-center gap-1.5 ${
              activeView === 'printer' ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30' : 'bg-slate-900 text-slate-400 border-slate-800'
            }`}
          >
            <PrinterIcon className="w-3.5 h-3.5" />
            Printer
          </button>
          <button
            onClick={() => setActiveView('logs')}
            className={`px-3 py-1.5 rounded-lg text-xs border flex items-center gap-1.5 ${
              activeView === 'logs' ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' : 'bg-slate-900 text-slate-400 border-slate-800'
            }`}
          >
            <Terminal className="w-3.5 h-3.5" />
            Logs
          </button>
        </div>

        {/* Notice alert */}
        {notice && (
          <div className="bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs px-4 py-2.5 rounded-lg flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Info className="w-4 h-4 text-amber-400" />
              <span>{notice}</span>
            </div>
            <button
              onClick={() => setNotice(null)}
              className="text-slate-400 hover:text-white"
            >
              ×
            </button>
          </div>
        )}

        {activeView === 'overview' ? (
          <> 

        {/* Quick Station Stats & Action Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900/60 p-3 rounded-xl border border-slate-800 text-xs">
          {/* <div className="flex items-center gap-4 text-slate-300">
            <span className="flex items-center gap-1.5 font-mono">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
              <strong className="text-white">Active Line:</strong> Station #1 (Packaging)
            </span>
            <span className="hidden sm:inline text-slate-600">|</span>
            <span className="hidden sm:flex items-center gap-1 font-mono text-slate-400">
              Protocol: DMCC Telnet / Printer TCP-JSON 9944
            </span>
          </div> */}

          <div className="flex items-center gap-2">
            <button
              id="home-printer-settings-btn"
              onClick={openPrinterSettings}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 flex items-center gap-1.5 transition-colors"
            >
              <Settings2 className="w-3.5 h-3.5 text-cyan-300" />
              <span>Device Settings</span>
            </button>
            <button
              id="view-scan-archive-btn"
              onClick={() => setShowHistoryModal(true)}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 flex items-center gap-1.5 transition-colors"
            >
              <History className="w-3.5 h-3.5 text-amber-400" />
              <span>Scan Archive ({state?.cognex?.readHistory?.length || 0})</span>
            </button>

            <button
              id="test-full-cycle-btn"
              onClick={handleTriggerCognex}
              disabled={state?.cognex?.status !== 'connected'}
              className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 text-slate-950 font-bold flex items-center gap-1.5 transition-all shadow-sm active:scale-95 disabled:opacity-50"
            >
              <Zap className="w-3.5 h-3.5 fill-slate-950" />
              <span>Trigger Camera</span>
            </button>
          </div>
        </div>

        <div className="bg-slate-900/70 rounded-xl border border-slate-800 overflow-hidden">
          <div className="p-4 border-b border-slate-800 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-xs font-mono text-cyan-300">
                <Database className="w-3.5 h-3.5" />
                <span>Recipe Batch Printing</span>
              </div>
              <h2 className="text-base font-semibold text-white mt-1">Select Recipe &amp; Print Dynamic Serials</h2>
              <p className="text-xs text-slate-500 mt-1">
                Generated serials are stored with print and verification status before printer dispatch.
              </p>
            </div>
            <button
              onClick={loadOverviewRecipes}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs text-slate-200 flex items-center gap-1.5 w-fit"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${recipeBusy === 'recipes' ? 'animate-spin text-cyan-300' : ''}`} />
              Refresh Recipes
            </button>
          </div>

          <div className="p-4 grid grid-cols-1 xl:grid-cols-[360px_1fr] gap-4">
            <div className="space-y-3">
              <label className="block text-xs text-slate-400">
                Recipe
                <select
                  value={selectedRecipeId}
                  onChange={(event) => handleSelectOverviewRecipe(event.target.value)}
                  className="mt-1 w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-2 text-white text-sm focus:border-cyan-500 focus:outline-none"
                >
                  <option value="">Select recipe</option>
                  {overviewRecipes.map((recipe) => (
                    <option key={recipe.id} value={recipe.id}>
                      {recipe.name} - {recipe.messageName}
                    </option>
                  ))}
                </select>
              </label>

              <div className="grid grid-cols-[1fr_auto] gap-2">
                <label className="block text-xs text-slate-400">
                  Batch Size
                  <input
                    type="number"
                    min="1"
                    max="500"
                    value={recipeBatchSize}
                    onChange={(event) => setRecipeBatchSize(event.target.value)}
                    className="mt-1 w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-2 text-white font-mono focus:border-cyan-500 focus:outline-none"
                  />
                </label>
                <div className="flex items-end gap-2">
                  <button
                    onClick={handleGenerateRecipeBatch}
                    disabled={!selectedRecipeId}
                    className="px-3 py-2 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs text-slate-200 disabled:opacity-50 flex items-center gap-1.5"
                  >
                    {recipeBusy === 'generate' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Database className="w-3.5 h-3.5" />}
                    Generate
                  </button>
                  <button
                    onClick={handlePrintRecipeBatch}
                    disabled={!selectedRecipeId || !selectedRecipeDetail || state?.printer?.status !== 'connected'}
                    className="px-3 py-2 rounded bg-cyan-600 hover:bg-cyan-500 text-white text-xs disabled:opacity-50 flex items-center gap-1.5"
                  >
                    {recipeBusy === 'print' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                    Print
                  </button>
                </div>
              </div>

              <label className="flex items-center gap-2 text-xs text-slate-300 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2">
                <input
                  type="checkbox"
                  checked={printExistingOnly}
                  onChange={(event) => setPrintExistingOnly(event.target.checked)}
                  className="rounded border-slate-700 bg-slate-900 text-cyan-500 focus:ring-cyan-500"
                />
                <span>Print only serials already in generated status</span>
              </label>

              {selectedRecipeDetail && (
                <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 space-y-3">
                  <div>
                    <div className="text-slate-500 uppercase text-[10px] font-mono">Fields Set On Print</div>
                    <div className="text-[11px] text-slate-400 mt-1">
                      These values replace the recipe-selection fields when Print is clicked.
                    </div>
                  </div>
                  {selectedRecipeDetail.fields?.filter((field) => field.mode === 'recipe').length === 0 ? (
                    <div className="text-xs text-slate-500">
                      This recipe has no fields marked as Set on recipe selection.
                    </div>
                  ) : (
                    selectedRecipeDetail.fields
                      .filter((field) => field.mode === 'recipe')
                      .map((field) => {
                      const key = `${field.fieldType}:${field.fieldId}`;
                      return (
                        <label key={key} className="block text-xs text-slate-400">
                          {field.fieldName || `${field.fieldType} ${field.fieldId}`}
                          <div className={`mt-1 grid ${field.serialPrefix ? 'grid-cols-[auto_1fr]' : 'grid-cols-1'} gap-2`}>
                            {field.serialPrefix && (
                              <div className="bg-slate-800 border border-slate-700 rounded px-2.5 py-2 text-cyan-300 font-mono">
                                {field.serialPrefix}
                              </div>
                            )}
                            <input
                              value={recipeSelectionValues[key] ?? ''}
                              onChange={(event) => setRecipeSelectionValues((current) => ({
                                ...current,
                                [key]: event.target.value,
                              }))}
                              className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-2 text-white font-mono focus:border-cyan-500 focus:outline-none"
                              placeholder={field.serialPrefix ? 'Value after prefix' : 'Value to send when printing'}
                            />
                          </div>
                        </label>
                      );
                    })
                  )}
                </div>
              )}

              <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 text-xs">
                <div className="text-slate-500 uppercase text-[10px] font-mono">Selected Recipe</div>
                {selectedRecipe ? (
                  <div className="mt-2 space-y-1">
                    <div className="font-semibold text-white">{selectedRecipe.name}</div>
                    <div className="text-slate-400">Message: {selectedRecipe.messageName}</div>
                    <div className="text-slate-500">ID {selectedRecipe.id}</div>
                  </div>
                ) : (
                  <div className="mt-2 text-slate-500">No recipe selected.</div>
                )}
              </div>

              <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-slate-500 uppercase text-[10px] font-mono">Printer Queue</div>
                  <button
                    onClick={loadPrinterQueue}
                    disabled={printerQueueBusy}
                    className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[11px] text-slate-200 disabled:opacity-50 flex items-center gap-1"
                  >
                    <RefreshCw className={`w-3 h-3 ${printerQueueBusy ? 'animate-spin text-cyan-300' : ''}`} />
                    Refresh
                  </button>
                </div>
                {printerQueue?.error ? (
                  <div className="mt-2 text-rose-300 break-words">{printerQueue.error}</div>
                ) : (
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <div className="bg-slate-900 border border-slate-800 rounded p-2">
                      <div className="text-[10px] uppercase text-slate-500 font-mono">Queue / Output</div>
                      <div className="mt-1 text-lg font-semibold text-cyan-300 font-mono">
                        {printerQueue?.queued ?? printerQueue?.output ?? (printerQueue?.available ? 'Not returned' : 'Unavailable')}
                      </div>
                    </div>
                    <div className="bg-slate-900 border border-slate-800 rounded p-2">
                      <div className="text-[10px] uppercase text-slate-500 font-mono">Engine State</div>
                      <div className="mt-1 text-sm font-mono text-white truncate">
                        {printerQueue?.state ?? (printerQueue?.available ? 'Not returned' : 'Unavailable')}
                      </div>
                    </div>
                    <div className="bg-slate-900 border border-slate-800 rounded p-2">
                      <div className="text-[10px] uppercase text-slate-500 font-mono">Active Message</div>
                      <div className="mt-1 text-sm font-mono text-white truncate">
                        {printerQueue?.dataName || printerQueue?.dataId || (printerQueue?.available ? 'Not returned' : 'Unavailable')}
                      </div>
                    </div>
                    <div className="bg-slate-900 border border-slate-800 rounded p-2">
                      <div className="text-[10px] uppercase text-slate-500 font-mono">Transfer Ready</div>
                      <div className="mt-1 text-sm font-mono text-white truncate">
                        {printerQueue?.transReady === true ? 'Yes' : printerQueue?.transReady === false ? 'No' : (printerQueue?.available ? 'Not returned' : 'Unavailable')}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="bg-slate-950 border border-slate-800 rounded-lg overflow-x-auto">
              <div className="grid grid-cols-[1fr_2fr_1fr_1fr] gap-2 px-3 py-2 bg-slate-900 border-b border-slate-800 text-[10px] uppercase text-slate-500 font-mono min-w-[720px]">
                <span>Serial Number</span>
                <span>Complete Code</span>
                <span>Print Status</span>
                <span>Verification Status</span>
              </div>
              <div className="max-h-[260px] overflow-y-auto divide-y divide-slate-900 min-w-[720px]">
                {recipeBusy === 'serials' ? (
                  <div className="p-4 text-xs text-slate-500 flex items-center gap-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Loading serials...
                  </div>
                ) : recipeSerials.length === 0 ? (
                  <div className="p-4 text-xs text-slate-500">No serials generated for this recipe yet.</div>
                ) : (
                  recipeSerials.map((serial) => (
                    <div key={serial.id} className="grid grid-cols-[1fr_2fr_1fr_1fr] gap-2 px-3 py-2 text-xs items-center">
                      <span className="font-mono text-white truncate">{serial.serialValue}</span>
                      <span className="font-mono text-cyan-100 truncate" title={serial.completeCode || ''}>
                        {serial.completeCode || '-'}
                      </span>
                      <span className={`font-mono ${
                        serial.printStatus === 'printed'
                          ? 'text-emerald-400'
                          : serial.printStatus === 'failed'
                          ? 'text-rose-400'
                          : serial.printStatus === 'printing_pending'
                          ? 'text-amber-300'
                          : 'text-cyan-300'
                      }`}>
                        {serial.printStatus}
                      </span>
                      <span className={`font-mono ${
                        serial.verificationStatus === 'verified'
                          ? 'text-emerald-400'
                          : serial.verificationStatus === 'scanned'
                          ? 'text-cyan-300'
                          : serial.verificationStatus === 'failed'
                          ? 'text-rose-400'
                          : 'text-slate-400'
                      }`}>
                        {serial.verificationStatus}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Cognex DM 262X Camera */}
        {state ? (
          <div className="grid grid-cols-1 gap-5">
            <CognexPanel
              device={state.cognex}
              onTrigger={handleTriggerCognex}
              onConnect={handleConnectCognex}
              onDisconnect={handleDisconnectCognex}
              onSendCommand={handleSendCognexCommand}
              onClearLogs={() => handleClearLogs('cognex')}
              isTriggering={isTriggering}
            />
          </div>
        ) : (
          <div className="py-20 text-center space-y-3">
            <Radio className="w-8 h-8 text-amber-400 animate-spin mx-auto" />
            <p className="text-slate-400 text-sm">
              Connecting to Cognex DM 262X Telnet &amp; Printer socket driver...
            </p>
          </div>
        )}

        {/* Industrial Integration Guide Callout */}
        <div className="bg-slate-900/40 rounded-xl border border-slate-800/80 p-4 text-xs text-slate-400 space-y-2">
          <div className="font-semibold text-slate-300 flex items-center gap-1.5">
            <Info className="w-4 h-4 text-amber-400" />
            <span>Industrial Hardware Connection Notes</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-[11px] text-slate-400">
            <div>
              <strong className="text-amber-300 block mb-0.5">Cognex DataMan 262X via Telnet:</strong>
              Configure the DM 262X with DataMan Setup Tool (Communications &gt; Ethernet &gt; Telnet / DMCC on port 23 or 21102). When triggering over Telnet, standard DMCC commands like <code className="text-amber-300 font-mono">||&gt;trigger on\r\n</code> fire the liquid lens and return decoded barcodes or DataMatrix strings.
            </div>
            <div>
              <strong className="text-cyan-300 block mb-0.5">Industrial Printer via TCP-JSON:</strong>
              The Sojet printer protocol uses one-line JSON frames over TCP port 9944, terminated with CRLF. The driver checks heartbeat/status and sends scan values as dynamic runtime data to the active print engine.
            </div>
          </div>
        </div>
          </>
        ) : activeView === 'printer' && state ? (
          <PrinterManagementPage
            printer={state.printer}
            onRefreshState={fetchState}
            setNotice={setNotice}
          />
        ) : activeView === 'logs' && state ? (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {[
              { title: 'Camera Telnet Logs', target: 'cognex', logs: state.cognex?.logs || [], accent: 'amber' },
              { title: 'Printer TCP Logs', target: 'printer', logs: state.printer?.logs || [], accent: 'cyan' },
            ].map((panel) => (
              <section key={panel.target} className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden">
                <div className="px-3 py-2 bg-slate-900 border-b border-slate-800 flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs text-slate-300 font-mono">
                    <Terminal className={`w-3.5 h-3.5 ${panel.accent === 'amber' ? 'text-amber-400' : 'text-cyan-400'}`} />
                    <span>{panel.title}</span>
                  </div>
                  <button
                    onClick={() => handleClearLogs(panel.target)}
                    className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px]"
                  >
                    Clear
                  </button>
                </div>
                <div className="p-3 font-mono text-[11px] max-h-[620px] overflow-y-auto space-y-1">
                  {panel.logs.length === 0 ? (
                    <div className="text-slate-600 italic">No logs available.</div>
                  ) : (
                    panel.logs.map((log) => (
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
                        <span className="text-slate-600 mr-1.5">[{new Date(log.timestamp).toLocaleTimeString()}]</span>
                        <span className="font-bold mr-1.5">{log.direction.toUpperCase()}</span>
                        <span>{log.message}</span>
                      </div>
                    ))
                  )}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div className="py-20 text-center space-y-3">
            <Radio className="w-8 h-8 text-amber-400 animate-spin mx-auto" />
            <p className="text-slate-400 text-sm">Connecting to printer management API...</p>
          </div>
        )}
      </main>

      {/* Barcode History Modal */}
      {state && (
        <BarcodeHistoryModal
          isOpen={showHistoryModal}
          onClose={() => setShowHistoryModal(false)}
          reads={state.cognex?.readHistory || []}
          onReprint={(barcode) => {
            handlePrintCustom(barcode);
            setShowHistoryModal(false);
          }}
        />
      )}

      {showPrinterSettings && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-4xl bg-slate-900 border border-slate-800 rounded-xl shadow-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
              <div>
                <div className="text-xs text-cyan-300 font-mono uppercase">Hardware Network</div>
                <h2 className="text-base font-semibold text-white mt-0.5">Device Settings</h2>
              </div>
              <button
                onClick={() => setShowPrinterSettings(false)}
                className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300"
                title="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
              <section className="bg-slate-950 border border-slate-800 rounded-lg p-3 space-y-3">
                <div>
                  <div className="text-xs text-amber-300 font-mono uppercase">Camera Telnet</div>
                  <div className="text-[11px] text-slate-500 mt-1">Cognex DMCC over Telnet.</div>
                </div>
                <label className="block text-xs text-slate-400">
                  Camera IP Address
                  <input
                    value={cameraHostInput}
                    onChange={(event) => setCameraHostInput(event.target.value)}
                    className="mt-1 w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-2 text-white font-mono focus:border-cyan-500 focus:outline-none"
                    placeholder="192.168.1.101"
                  />
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block text-xs text-slate-400">
                    Telnet Port
                    <input
                      type="number"
                      value={cameraPortInput}
                      onChange={(event) => setCameraPortInput(event.target.value)}
                      className="mt-1 w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-2 text-white font-mono focus:border-cyan-500 focus:outline-none"
                      placeholder="23"
                    />
                  </label>
                  <label className="block text-xs text-slate-400">
                    Timeout ms
                    <input
                      type="number"
                      value={cameraTimeoutInput}
                      onChange={(event) => setCameraTimeoutInput(event.target.value)}
                      className="mt-1 w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-2 text-white font-mono focus:border-cyan-500 focus:outline-none"
                      placeholder="4000"
                    />
                  </label>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block text-xs text-slate-400">
                    User
                    <input
                      value={cameraUserInput}
                      onChange={(event) => setCameraUserInput(event.target.value)}
                      className="mt-1 w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-2 text-white font-mono focus:border-cyan-500 focus:outline-none"
                      placeholder="admin"
                    />
                  </label>
                  <label className="block text-xs text-slate-400">
                    Password
                    <input
                      type="password"
                      value={cameraPasswordInput}
                      onChange={(event) => setCameraPasswordInput(event.target.value)}
                      className="mt-1 w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-2 text-white font-mono focus:border-cyan-500 focus:outline-none"
                    />
                  </label>
                </div>
                <label className="block text-xs text-slate-400">
                  FTP Image Upload Folder
                  <input
                    value={cameraFtpDirInput}
                    onChange={(event) => setCameraFtpDirInput(event.target.value)}
                    className="mt-1 w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-2 text-white font-mono focus:border-cyan-500 focus:outline-none"
                    placeholder="D:\\Images\\Cognex"
                  />
                  <span className="block mt-1 text-[10px] text-slate-500">
                    Configure the Cognex FTP/image logging target to write into this folder.
                  </span>
                </label>
                <div className="text-[11px] text-slate-500">
                  Current: <span className="text-amber-300 font-mono">{state?.cognex?.config?.host}:{state?.cognex?.config?.port}</span>
                </div>
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => handleSaveCameraSettings(false)}
                    className="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs text-slate-200"
                  >
                    Save Camera
                  </button>
                  <button
                    onClick={() => handleSaveCameraSettings(true)}
                    className="px-3 py-1.5 rounded bg-amber-600 hover:bg-amber-500 text-slate-950 font-semibold text-xs"
                  >
                    Save &amp; Connect
                  </button>
                </div>
              </section>

              <section className="bg-slate-950 border border-slate-800 rounded-lg p-3 space-y-3">
                <div>
                  <div className="text-xs text-cyan-300 font-mono uppercase">Printer TCP-JSON</div>
                  <div className="text-[11px] text-slate-500 mt-1">Sojet TCP-JSON service.</div>
                </div>
                <label className="block text-xs text-slate-400">
                  Printer IP Address
                  <input
                    value={printerHostInput}
                    onChange={(event) => setPrinterHostInput(event.target.value)}
                    className="mt-1 w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-2 text-white font-mono focus:border-cyan-500 focus:outline-none"
                    placeholder="192.168.1.6"
                  />
                </label>

                <div className="grid grid-cols-2 gap-3">
                  <label className="block text-xs text-slate-400">
                    TCP Port
                    <input
                      type="number"
                      value={printerPortInput}
                      onChange={(event) => setPrinterPortInput(event.target.value)}
                      className="mt-1 w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-2 text-white font-mono focus:border-cyan-500 focus:outline-none"
                      placeholder="9944"
                    />
                  </label>
                  <label className="block text-xs text-slate-400">
                    Timeout ms
                    <input
                      type="number"
                      value={printerTimeoutInput}
                      onChange={(event) => setPrinterTimeoutInput(event.target.value)}
                      className="mt-1 w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-2 text-white font-mono focus:border-cyan-500 focus:outline-none"
                      placeholder="4000"
                    />
                  </label>
                </div>

                <div className="text-[11px] text-slate-500">
                  Current: <span className="text-cyan-300 font-mono">{state?.printer?.config?.host}:{state?.printer?.config?.port}</span>
                </div>
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => handleSavePrinterSettings(false)}
                    className="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs text-slate-200"
                  >
                    Save Printer
                  </button>
                  <button
                    onClick={() => handleSavePrinterSettings(true)}
                    className="px-3 py-1.5 rounded bg-cyan-600 hover:bg-cyan-500 text-white text-xs"
                  >
                    Save &amp; Connect
                  </button>
                </div>
              </section>
            </div>

            <div className="px-4 py-3 border-t border-slate-800 flex items-center justify-end gap-2">
              <button
                onClick={() => setShowPrinterSettings(false)}
                className="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs text-slate-200"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
