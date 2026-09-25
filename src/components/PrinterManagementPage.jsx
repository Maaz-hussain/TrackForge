import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  CheckCircle2,
  FileText,
  List,
  Loader2,
  RefreshCw,
  Send,
  Settings2,
  Terminal,
} from 'lucide-react';

const requestJson = async (url, options = {}) => {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(new Error(value.error || `Request failed (${response.status})`), { value });
  }
  return value;
};

const formatJson = (value) => JSON.stringify(value, null, 2);

const fieldKey = (field) => `${field.type}:${field.id}`;

const formatPrinterTime = (seconds) => {
  if (!seconds) return 'Modification time unavailable';
  return new Date(seconds * 1000).toLocaleString();
};

export const PrinterManagementPage = ({ printer, onRefreshState, setNotice }) => {
  const [activeTab, setActiveTab] = useState('messages');
  const [messages, setMessages] = useState([]);
  const [selectedMessage, setSelectedMessage] = useState(null);
  const [fields, setFields] = useState([]);
  const [fieldValues, setFieldValues] = useState({});
  const [recipes, setRecipes] = useState([]);
  const [editingRecipeId, setEditingRecipeId] = useState(null);
  const [recipeName, setRecipeName] = useState('');
  const [recipeDescription, setRecipeDescription] = useState('');
  const [recipeFields, setRecipeFields] = useState([]);
  const [latest, setLatest] = useState(null);
  const [busy, setBusy] = useState('');
  const [command, setCommand] = useState({
    method: 'GET',
    path: '/info/heart_beat',
    query: '{}',
    body: '{}',
  });

  const wirePreview = useMemo(() => {
    try {
      return `${JSON.stringify({
        request_type: command.method.toLowerCase(),
        path: command.path,
        ...JSON.parse(command.query || '{}'),
        ...JSON.parse(command.body || '{}'),
      })}\\r\\n`;
    } catch {
      return 'Fix query/body JSON to preview the TCP frame.';
    }
  }, [command]);

  const setResponse = (label, value) => {
    setLatest({ label, value });
  };

  const loadStatus = useCallback(async () => {
    setBusy('status');
    try {
      const value = await requestJson('/api/printer/status');
      setResponse('PRINTER STATUS', value);
      onRefreshState?.();
    } catch (error) {
      setResponse('STATUS ERROR', { error: error.message, details: error.value });
    } finally {
      setBusy('');
    }
  }, [onRefreshState]);

  const loadMessages = useCallback(async () => {
    setBusy('messages');
    try {
      const value = await requestJson('/api/printer/messages?offset=0&num=50');
      const list = value.data?.data_list || value.data?.dataList || [];
      setMessages(list);
      setResponse('MESSAGE LIST', value);
      if (!list.some((message) => String(message.id) === String(selectedMessage?.id))) {
        setSelectedMessage(null);
        setFields([]);
        setFieldValues({});
      }
    } catch (error) {
      setResponse('MESSAGE LIST ERROR', { error: error.message, details: error.value });
    } finally {
      setBusy('');
    }
  }, [selectedMessage?.id]);

  const loadFields = useCallback(async (message = selectedMessage) => {
    if (!message) return;
    setBusy('fields');
    try {
      const value = await requestJson(`/api/printer/fields?messageId=${encodeURIComponent(message.id)}`);
      setFields(value.fields || []);
      setFieldValues(
        Object.fromEntries(
          (value.fields || []).map((field) => [
            fieldKey(field),
            field.runtimeValue ?? field.value ?? '',
          ]),
        ),
      );
      setResponse('FIELD INSPECTION', value);
    } catch (error) {
      setFields([]);
      setResponse('FIELD ERROR', { error: error.message, details: error.value });
    } finally {
      setBusy('');
    }
  }, [selectedMessage]);

  const loadRecipes = useCallback(async (message = selectedMessage) => {
    setBusy('recipes');
    try {
      const query = message ? `?messageId=${encodeURIComponent(message.id)}` : '';
      const value = await requestJson(`/api/printer/recipes${query}`);
      setRecipes(value.recipes || []);
      setResponse('RECIPES', value);
    } catch (error) {
      setResponse('RECIPE LOAD ERROR', { error: error.message, details: error.value });
    } finally {
      setBusy('');
    }
  }, [selectedMessage]);

  const selectMessage = async (message) => {
    setSelectedMessage(message);
    setNotice?.(`Selected printer message "${message.name || `Message ${message.id}`}"`);
    await requestJson('/api/printer/config', {
      method: 'POST',
      body: JSON.stringify({ messageName: message.name || '' }),
    }).catch(() => null);
    onRefreshState?.();
    loadFields(message);
    loadRecipes(message);
  };

  const startNewRecipe = () => {
    if (!selectedMessage || fields.length === 0) {
      setNotice?.('Select a message and load its fields before creating a recipe.');
      return;
    }
    setEditingRecipeId(null);
    setRecipeName(`${selectedMessage.name || 'Message'} Recipe`);
    setRecipeDescription('');
    setRecipeFields(fields.map((field) => ({
      fieldId: field.id,
      fieldType: field.type,
      fieldName: field.name || '',
      mode: field.gs1Identifier === '21' ? 'serial' : 'recipe',
      value: fieldValues[fieldKey(field)] ?? field.runtimeValue ?? field.value ?? '',
      serialPrefix: field.gs1Identifier === '21' ? '21' : '',
      serialLength: 14,
    })));
    setActiveTab('recipes');
  };

  const editRecipe = async (recipeId) => {
    setBusy(`recipe:${recipeId}`);
    try {
      const value = await requestJson(`/api/printer/recipes/${recipeId}`);
      const recipe = value.recipe;
      setEditingRecipeId(recipe.id);
      setRecipeName(recipe.name || '');
      setRecipeDescription(recipe.description || '');
      setRecipeFields((recipe.fields || []).map((field) => ({
        fieldId: field.fieldId,
        fieldType: field.fieldType,
        fieldName: field.fieldName,
        mode: field.mode,
        value: field.value || '',
        serialPrefix: field.serialPrefix || '',
        serialLength: field.serialLength || 14,
      })));
      setSelectedMessage({ id: recipe.messageId, name: recipe.messageName });
      setActiveTab('recipes');
      setResponse('RECIPE DETAIL', value);
    } catch (error) {
      setNotice?.(error.message);
    } finally {
      setBusy('');
    }
  };

  const updateRecipeField = (index, patch) => {
    setRecipeFields((current) => current.map((field, fieldIndex) => (
      fieldIndex === index ? { ...field, ...patch } : field
    )));
  };

  const saveRecipe = async () => {
    if (!selectedMessage) {
      setNotice?.('Select a printer message first.');
      return;
    }
    setBusy('saveRecipe');
    try {
      const payload = {
        name: recipeName,
        description: recipeDescription,
        messageId: selectedMessage.id,
        messageName: selectedMessage.name || `Message ${selectedMessage.id}`,
        fields: recipeFields,
      };
      const value = await requestJson(editingRecipeId ? `/api/printer/recipes/${editingRecipeId}` : '/api/printer/recipes', {
        method: editingRecipeId ? 'PUT' : 'POST',
        body: JSON.stringify(payload),
      });
      setEditingRecipeId(value.recipe?.id || editingRecipeId);
      setResponse('RECIPE SAVED', value);
      setNotice?.('Recipe saved.');
      await loadRecipes(selectedMessage);
    } catch (error) {
      setResponse('RECIPE SAVE ERROR', { error: error.message, details: error.value });
      setNotice?.(error.message);
    } finally {
      setBusy('');
    }
  };

  const applyRecipe = async (recipeId) => {
    setBusy(`apply:${recipeId}`);
    try {
      const value = await requestJson(`/api/printer/recipes/${recipeId}/apply`, {
        method: 'POST',
        body: JSON.stringify({ printMode: 'single' }),
      });
      setResponse('RECIPE APPLIED', value);
      setNotice?.(value.ok ? 'Recipe applied to printer.' : value.error || 'Recipe apply failed.');
      await loadRecipes(selectedMessage);
      onRefreshState?.();
    } catch (error) {
      setResponse('RECIPE APPLY ERROR', { error: error.message, details: error.value });
      setNotice?.(error.message);
    } finally {
      setBusy('');
    }
  };

  const selectRecipe = async (recipeId) => {
    setBusy(`select:${recipeId}`);
    try {
      const value = await requestJson(`/api/printer/recipes/${recipeId}/select`, {
        method: 'POST',
        body: JSON.stringify({ sendToPrinter: true, printMode: 'single' }),
      });
      setResponse('RECIPE SELECTED', value);
      setNotice?.(value.ok ? 'Recipe selected and fixed fields sent.' : value.error || 'Recipe selection failed.');
      await loadRecipes(selectedMessage);
      onRefreshState?.();
    } catch (error) {
      setResponse('RECIPE SELECT ERROR', { error: error.message, details: error.value });
      setNotice?.(error.message);
    } finally {
      setBusy('');
    }
  };

  const deleteRecipe = async (recipeId) => {
    if (!window.confirm('Delete this recipe?')) return;
    setBusy(`recipe:${recipeId}`);
    try {
      await requestJson(`/api/printer/recipes/${recipeId}`, { method: 'DELETE' });
      if (editingRecipeId === recipeId) setEditingRecipeId(null);
      await loadRecipes(selectedMessage);
      setNotice?.('Recipe deleted.');
    } catch (error) {
      setNotice?.(error.message);
    } finally {
      setBusy('');
    }
  };

  const sendAllFields = async () => {
    if (!selectedMessage || !fields.length) return;
    setBusy('sendAll');
    try {
      const payload = {
        messageId: selectedMessage.id,
        messageName: selectedMessage.name,
        printMode: 'single',
        fields: fields.map((field) => ({
          fieldId: field.id,
          fieldType: field.type,
          fieldName: field.name,
          value: fieldValues[fieldKey(field)] ?? field.runtimeValue ?? field.value ?? '',
        })),
      };
      const value = await requestJson('/api/printer/dynamic', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setResponse('DYNAMIC FIELD UPDATE', value);
      setNotice?.(value.ok ? `${value.updatedCount} printer fields accepted.` : value.error || 'Printer rejected field data.');
      await loadFields(selectedMessage);
    } catch (error) {
      setResponse('DYNAMIC FIELD ERROR', { error: error.message, details: error.value });
      setNotice?.(error.message);
    } finally {
      setBusy('');
    }
  };

  const sendSingleField = async (field) => {
    if (!selectedMessage) return;
    setBusy(`field:${fieldKey(field)}`);
    try {
      const value = await requestJson('/api/printer/dynamic', {
        method: 'POST',
        body: JSON.stringify({
          messageId: selectedMessage.id,
          messageName: selectedMessage.name,
          fieldId: field.id,
          fieldType: field.type,
          fieldName: field.name,
          value: fieldValues[fieldKey(field)] ?? '',
          printMode: 'single',
        }),
      });
      setResponse(`FIELD ${field.id}`, value);
      await loadFields(selectedMessage);
    } catch (error) {
      setResponse('FIELD UPDATE ERROR', { error: error.message, details: error.value });
      setNotice?.(error.message);
    } finally {
      setBusy('');
    }
  };

  const sendCommand = async (confirmDangerous = false) => {
    let query;
    let body;
    try {
      query = JSON.parse(command.query || '{}');
      body = JSON.parse(command.body || '{}');
    } catch {
      setNotice?.('Query or body JSON is invalid.');
      return;
    }

    setBusy('command');
    try {
      const value = await requestJson('/api/printer/command', {
        method: 'POST',
        body: JSON.stringify({
          method: command.method,
          path: command.path.trim(),
          query,
          body,
          confirmDangerous,
        }),
      });
      setResponse(`${command.method} ${command.path}`, value);
    } catch (error) {
      if (error.value?.confirmationRequired && !confirmDangerous) {
        const confirmed = window.confirm(`${command.method} ${command.path} can change printer state. Send it anyway?`);
        if (confirmed) await sendCommand(true);
      } else {
        setResponse('COMMAND ERROR', { error: error.message, details: error.value });
        setNotice?.(error.message);
      }
    } finally {
      setBusy('');
    }
  };

  useEffect(() => {
    if (activeTab === 'messages' && messages.length === 0) loadMessages();
  }, [activeTab, loadMessages, messages.length]);

  const tabs = [
    { id: 'messages', label: 'Messages', icon: List },
    { id: 'recipes', label: 'Recipes', icon: Settings2 },
    { id: 'status', label: 'Status', icon: Activity },
    { id: 'command', label: 'Command', icon: Terminal },
    { id: 'logs', label: 'Logs', icon: FileText },
  ];

  return (
    <div className="space-y-4">
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs font-mono text-cyan-300">
            <Settings2 className="w-3.5 h-3.5" />
            <span>{printer?.config?.host}:{printer?.config?.port}</span>
            <span className="text-slate-600">|</span>
            <span>{printer?.config?.protocol}</span>
          </div>
          <h2 className="text-lg font-semibold text-white mt-1">Printer Management</h2>
          <p className="text-xs text-slate-400 mt-1">
            Browse printer messages, inspect dynamic fields, and send TCP-JSON commands.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`px-2.5 py-1 rounded-md text-xs font-mono border ${
            printer?.status === 'connected'
              ? 'bg-cyan-950/50 text-cyan-300 border-cyan-500/40'
              : 'bg-rose-950/50 text-rose-300 border-rose-500/40'
          }`}>
            {printer?.status || 'offline'}
          </span>
          <button
            onClick={loadStatus}
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs text-slate-200 flex items-center gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${busy === 'status' ? 'animate-spin text-cyan-300' : ''}`} />
            Check Status
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-slate-800 pb-2">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 border transition-colors ${
                activeTab === tab.id
                  ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30'
                  : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === 'messages' && (
        <div className="grid grid-cols-1 xl:grid-cols-[360px_1fr] gap-4">
          <section className="bg-slate-900/70 border border-slate-800 rounded-xl overflow-hidden">
            <div className="p-3 border-b border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-white">Printer Messages</h3>
                <p className="text-[11px] text-slate-500">Loaded from /data/list</p>
              </div>
              <button
                onClick={loadMessages}
                className="px-2.5 py-1 rounded bg-cyan-600 hover:bg-cyan-500 text-white text-xs flex items-center gap-1.5"
              >
                {busy === 'messages' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                Refresh
              </button>
            </div>
            <div className="max-h-[560px] overflow-y-auto p-2 space-y-2">
              {messages.length === 0 ? (
                <div className="text-xs text-slate-500 p-4 text-center">No messages loaded.</div>
              ) : (
                messages.map((message) => (
                  <button
                    key={message.id}
                    onClick={() => selectMessage(message)}
                    className={`w-full text-left p-3 rounded-lg border transition-colors ${
                      String(selectedMessage?.id) === String(message.id)
                        ? 'bg-cyan-500/15 border-cyan-500/40'
                        : 'bg-slate-950 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <strong className="text-sm text-white truncate">{message.name || `Message ${message.id}`}</strong>
                      <span className="text-[10px] text-cyan-300 font-mono bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5">
                        ID {message.id}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500 mt-1">{formatPrinterTime(message.attribute?.modified_time)}</div>
                  </button>
                ))
              )}
            </div>
          </section>

          <section className="bg-slate-900/70 border border-slate-800 rounded-xl overflow-hidden">
            <div className="p-3 border-b border-slate-800 flex flex-col md:flex-row md:items-center md:justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-white">
                  {selectedMessage ? `${selectedMessage.name || 'Message'} Fields` : 'Dynamic Fields'}
                </h3>
                <p className="text-[11px] text-slate-500">Source references from /data/data and /data/source</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => loadFields()}
                  disabled={!selectedMessage}
                  className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs text-slate-200 disabled:opacity-50"
                >
                  Reload Values
                </button>
                <button
                  onClick={sendAllFields}
                  disabled={!selectedMessage || fields.length === 0}
                  className="px-2.5 py-1 rounded bg-cyan-600 hover:bg-cyan-500 text-white text-xs disabled:opacity-50 flex items-center gap-1.5"
                >
                  {busy === 'sendAll' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                  Update All
                </button>
                <button
                  onClick={startNewRecipe}
                  disabled={!selectedMessage || fields.length === 0}
                  className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs text-slate-200 disabled:opacity-50"
                >
                  Create Recipe
                </button>
              </div>
            </div>
            <div className="p-3 space-y-3 max-h-[560px] overflow-y-auto">
              {!selectedMessage ? (
                <div className="text-xs text-slate-500 text-center py-10">Select a message to inspect its fields.</div>
              ) : fields.length === 0 ? (
                <div className="text-xs text-slate-500 text-center py-10">No dynamic source fields found.</div>
              ) : (
                fields.map((field) => {
                  const key = fieldKey(field);
                  return (
                    <div key={key} className="bg-slate-950 border border-slate-800 rounded-lg p-3">
                      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-2">
                            <strong className="text-sm text-white">{field.name || `${field.type} field`}</strong>
                            {field.available && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />}
                          </div>
                          <div className="text-[11px] text-slate-500 font-mono mt-1">
                            ID {field.id} | {field.type}
                            {field.gs1Identifier ? ` | GS1 (${field.gs1Identifier}) ${field.gs1Label || ''}` : ''}
                          </div>
                        </div>
                        <button
                          onClick={() => sendSingleField(field)}
                          className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs text-slate-200 flex items-center gap-1.5"
                        >
                          {busy === `field:${key}` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                          Update
                        </button>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-[1fr_220px] gap-3 mt-3">
                        <input
                          value={fieldValues[key] ?? ''}
                          onChange={(event) => setFieldValues((current) => ({ ...current, [key]: event.target.value }))}
                          className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-2 text-xs text-white font-mono focus:border-cyan-500 focus:outline-none"
                          placeholder="Enter runtime value"
                        />
                        <div className="text-[11px] text-slate-500 space-y-1">
                          <div>Template: <code className="text-slate-300">{String(field.value ?? '(empty)')}</code></div>
                          <div>Runtime: <code className="text-cyan-300">{String(field.runtimeValue ?? '(not sent)')}</code></div>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </section>
        </div>
      )}

      {activeTab === 'recipes' && (
        <div className="grid grid-cols-1 xl:grid-cols-[360px_1fr] gap-4">
          <section className="bg-slate-900/70 border border-slate-800 rounded-xl overflow-hidden">
            <div className="p-3 border-b border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-white">Recipes</h3>
                <p className="text-[11px] text-slate-500">Stored in MySQL by printer message</p>
              </div>
              <button
                onClick={() => loadRecipes()}
                className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs text-slate-200 flex items-center gap-1.5"
              >
                {busy === 'recipes' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                Refresh
              </button>
            </div>
            <div className="p-2 space-y-2 max-h-[620px] overflow-y-auto">
              {recipes.length === 0 ? (
                <div className="text-xs text-slate-500 text-center p-6">
                  No recipes saved for this message yet.
                </div>
              ) : (
                recipes.map((recipe) => (
                  <div key={recipe.id} className="bg-slate-950 border border-slate-800 rounded-lg p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <strong className="text-sm text-white">{recipe.name}</strong>
                          {Boolean(recipe.isActive) && (
                            <span className="text-[10px] text-emerald-300 bg-emerald-950 border border-emerald-800 rounded px-1.5 py-0.5">ACTIVE</span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-500 mt-1">Message: {recipe.messageName} | ID {recipe.messageId}</div>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 mt-3">
                      <button
                        onClick={() => selectRecipe(recipe.id)}
                        className="px-2.5 py-1 rounded bg-emerald-700 hover:bg-emerald-600 text-white text-xs flex items-center gap-1.5"
                      >
                        {busy === `select:${recipe.id}` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                        Select
                      </button>
                      <button
                        onClick={() => applyRecipe(recipe.id)}
                        className="px-2.5 py-1 rounded bg-cyan-600 hover:bg-cyan-500 text-white text-xs flex items-center gap-1.5"
                      >
                        {busy === `apply:${recipe.id}` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                        Apply
                      </button>
                      <button
                        onClick={() => editRecipe(recipe.id)}
                        className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => deleteRecipe(recipe.id)}
                        className="px-2.5 py-1 rounded bg-rose-950/50 hover:bg-rose-900/70 border border-rose-800 text-rose-300 text-xs"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="bg-slate-900/70 border border-slate-800 rounded-xl overflow-hidden">
            <div className="p-3 border-b border-slate-800 flex flex-col md:flex-row md:items-center md:justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-white">{editingRecipeId ? 'Edit Recipe' : 'Create Recipe'}</h3>
                <p className="text-[11px] text-slate-500">Fixed values, recipe-selection values, and dynamic serials</p>
              </div>
              <button
                onClick={saveRecipe}
                disabled={!selectedMessage || recipeFields.length === 0}
                className="px-3 py-1.5 rounded bg-cyan-600 hover:bg-cyan-500 text-white text-xs disabled:opacity-50"
              >
                Save Recipe
              </button>
            </div>
            <div className="p-3 space-y-3 max-h-[620px] overflow-y-auto">
              {!selectedMessage ? (
                <div className="text-xs text-slate-500 text-center py-10">Select a message first, then create a recipe.</div>
              ) : recipeFields.length === 0 ? (
                <div className="text-xs text-slate-500 text-center py-10">
                  Load message fields and click Create Recipe.
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <label className="text-xs text-slate-400">
                      Recipe Name
                      <input
                        value={recipeName}
                        onChange={(event) => setRecipeName(event.target.value)}
                        className="mt-1 w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-2 text-white"
                      />
                    </label>
                    <label className="text-xs text-slate-400">
                      Message
                      <input
                        value={`${selectedMessage.name || 'Message'} (${selectedMessage.id})`}
                        readOnly
                        className="mt-1 w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-2 text-slate-400"
                      />
                    </label>
                    <label className="text-xs text-slate-400 md:col-span-2">
                      Description
                      <input
                        value={recipeDescription}
                        onChange={(event) => setRecipeDescription(event.target.value)}
                        className="mt-1 w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-2 text-white"
                        placeholder="Optional production context"
                      />
                    </label>
                  </div>

                  <div className="space-y-3">
                    {recipeFields.map((field, index) => (
                      <div key={`${field.fieldType}:${field.fieldId}`} className="bg-slate-950 border border-slate-800 rounded-lg p-3">
                        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                          <div>
                            <strong className="text-sm text-white">{field.fieldName || `${field.fieldType} ${field.fieldId}`}</strong>
                            <div className="text-[11px] text-slate-500 font-mono">ID {field.fieldId} | {field.fieldType}</div>
                          </div>
                          <select
                            value={field.mode}
                            onChange={(event) => updateRecipeField(index, { mode: event.target.value })}
                            className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-white"
                          >
                            <option value="fixed">Fixed</option>
                            <option value="recipe">Set on recipe selection</option>
                            <option value="serial">Dynamic serial number</option>
                          </select>
                        </div>

                        {field.mode === 'serial' ? (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                            <label className="text-xs text-slate-400">
                              Serial Prefix
                              <input
                                value={field.serialPrefix || ''}
                                onChange={(event) => updateRecipeField(index, { serialPrefix: event.target.value })}
                                className="mt-1 w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-2 text-white font-mono"
                                placeholder="e.g. 21"
                              />
                            </label>
                            <label className="text-xs text-slate-400">
                              Serial Length
                              <input
                                type="number"
                                min="1"
                                max="32"
                                value={field.serialLength || 14}
                                onChange={(event) => updateRecipeField(index, { serialLength: Number(event.target.value) })}
                                className="mt-1 w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-2 text-white font-mono"
                              />
                            </label>
                          </div>
                        ) : (
                          <div className={`grid grid-cols-1 ${field.mode === 'recipe' ? 'md:grid-cols-[180px_1fr]' : ''} gap-3 mt-3`}>
                            {field.mode === 'recipe' && (
                              <label className="block text-xs text-slate-400">
                                Fixed Prefix
                                <input
                                  value={field.serialPrefix || ''}
                                  onChange={(event) => updateRecipeField(index, { serialPrefix: event.target.value })}
                                  className="mt-1 w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-2 text-white font-mono"
                                  placeholder="Locked prefix"
                                />
                              </label>
                            )}
                            <label className="block text-xs text-slate-400">
                              {field.mode === 'fixed' ? 'Fixed Field Value' : 'Editable Selection Value'}
                              <input
                                value={field.value || ''}
                                onChange={(event) => updateRecipeField(index, { value: event.target.value })}
                                className="mt-1 w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-2 text-white font-mono"
                                placeholder={field.mode === 'recipe' ? 'Value after prefix' : 'Value to send when recipe is applied'}
                              />
                            </label>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </section>
        </div>
      )}

      {activeTab === 'status' && (
        <section className="bg-slate-900/70 border border-slate-800 rounded-xl p-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
            <div className="bg-slate-950 border border-slate-800 rounded-lg p-3">
              <div className="text-slate-500 uppercase">Connection</div>
              <div className="text-lg font-mono text-white mt-1">{printer?.status || 'offline'}</div>
            </div>
            <div className="bg-slate-950 border border-slate-800 rounded-lg p-3">
              <div className="text-slate-500 uppercase">Address</div>
              <div className="text-lg font-mono text-cyan-300 mt-1">{printer?.config?.host}:{printer?.config?.port}</div>
            </div>
            <div className="bg-slate-950 border border-slate-800 rounded-lg p-3">
              <div className="text-slate-500 uppercase">Selected Message</div>
              <div className="text-lg font-mono text-white mt-1">{printer?.config?.messageName || 'none'}</div>
            </div>
          </div>
        </section>
      )}

      {activeTab === 'command' && (
        <section className="bg-slate-900/70 border border-slate-800 rounded-xl p-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-[120px_1fr] gap-3">
            <label className="text-xs text-slate-400">
              Method
              <select
                value={command.method}
                onChange={(event) => setCommand((current) => ({ ...current, method: event.target.value }))}
                className="mt-1 w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-2 text-white"
              >
                <option>GET</option>
                <option>POST</option>
                <option>PUT</option>
                <option>DELETE</option>
              </select>
            </label>
            <label className="text-xs text-slate-400">
              API Path
              <input
                value={command.path}
                onChange={(event) => setCommand((current) => ({ ...current, path: event.target.value }))}
                className="mt-1 w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-2 text-white font-mono"
              />
            </label>
            <label className="text-xs text-slate-400 md:col-span-2">
              Query JSON
              <textarea
                value={command.query}
                onChange={(event) => setCommand((current) => ({ ...current, query: event.target.value }))}
                rows={4}
                className="mt-1 w-full bg-slate-950 border border-slate-700 rounded p-2.5 text-cyan-300 font-mono"
              />
            </label>
            <label className="text-xs text-slate-400 md:col-span-2">
              Body JSON
              <textarea
                value={command.body}
                onChange={(event) => setCommand((current) => ({ ...current, body: event.target.value }))}
                rows={6}
                className="mt-1 w-full bg-slate-950 border border-slate-700 rounded p-2.5 text-cyan-300 font-mono"
              />
            </label>
          </div>
          <div className="bg-slate-950 border border-slate-800 rounded-lg p-3">
            <div className="text-[11px] text-slate-500 uppercase mb-1">Wire Preview</div>
            <code className="text-xs text-cyan-300 break-all">{wirePreview}</code>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => sendCommand(false)} className="px-3 py-1.5 rounded bg-cyan-600 hover:bg-cyan-500 text-white text-xs flex items-center gap-1.5">
              {busy === 'command' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              Send Command
            </button>
            <button onClick={() => setCommand({ method: 'GET', path: '/info/heart_beat', query: '{}', body: '{}' })} className="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs">Heartbeat</button>
            <button onClick={() => setCommand({ method: 'GET', path: '/data/list', query: '{\"offset\":0,\"num\":10}', body: '{}' })} className="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs">Messages</button>
          </div>
        </section>
      )}

      {activeTab === 'logs' && (
        <section className="bg-slate-950 border border-slate-800 rounded-xl p-3 font-mono text-[11px] max-h-[560px] overflow-y-auto space-y-1">
          {!printer?.logs?.length ? (
            <div className="text-slate-600 italic">No printer activity logged.</div>
          ) : (
            printer.logs.map((log) => (
              <div key={log.id} className={log.direction === 'error' ? 'text-rose-400' : log.direction === 'out' ? 'text-cyan-400' : log.direction === 'in' ? 'text-emerald-400' : 'text-slate-400'}>
                <span className="text-slate-600">[{new Date(log.timestamp).toLocaleTimeString()}]</span>{' '}
                <span>{log.direction.toUpperCase()}</span>{' '}
                <span>{log.message}</span>
              </div>
            ))
          )}
        </section>
      )}

      <section className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden">
        <div className="px-3 py-2 border-b border-slate-800 flex items-center justify-between">
          <div className="text-xs text-slate-400 font-mono">{latest?.label || 'LATEST RESPONSE'}</div>
        </div>
        <pre className="p-3 text-[11px] text-slate-300 overflow-auto max-h-[260px]">{latest ? formatJson(latest.value) : 'No printer management request sent yet.'}</pre>
      </section>
    </div>
  );
};
