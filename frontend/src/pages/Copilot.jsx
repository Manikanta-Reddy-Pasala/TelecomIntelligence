import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { copilotService } from '../services/copilot';
import { casesService } from '../services/cases';
import {
  Send,
  Bot,
  User,
  ChevronDown,
  ChevronRight,
  FileText,
  Clock,
  MapPin,
  GitBranch,
  UserCircle,
  Loader2,
  Sparkles,
  Copy,
  Check,
  Calendar,
  Navigation,
  Shield,
  Phone,
  Smartphone,
  AlertTriangle,
  Eye,
  Database,
  Radio,
  MessageSquare,
  Activity,
  Target,
  Search,
  Zap,
  ArrowRight,
  Users,
} from 'lucide-react';
import { format } from 'date-fns';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Cell,
} from 'recharts';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
// ForceGraph2D removed - replaced with contacts table

// ---------------------------------------------------------------------------
// Leaflet icon fix
// ---------------------------------------------------------------------------
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------
function formatBoldText(text) {
  if (!text) return null;
  const parts = text.split(/(\*\*.*?\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <span key={i} className="font-semibold text-slate-100">
          {part.slice(2, -2)}
        </span>
      );
    }
    return part;
  });
}

function safeFormat(dateVal, fmt, fallback = '--') {
  try {
    const d = new Date(dateVal);
    if (isNaN(d.getTime())) return fallback;
    return format(d, fmt);
  } catch {
    return fallback;
  }
}

function interpolateColor(ratio) {
  const r = ratio < 0.5 ? Math.round(ratio * 2 * 255) : 255;
  const g = ratio < 0.5 ? 255 : Math.round((1 - (ratio - 0.5) * 2) * 255);
  return `rgb(${r},${g},0)`;
}

// ---------------------------------------------------------------------------
// ConfidenceBadge
// ---------------------------------------------------------------------------
function ConfidenceBadge({ confidence }) {
  const map = {
    high: { cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25', label: 'High' },
    medium: { cls: 'bg-amber-500/15 text-amber-400 border-amber-500/25', label: 'Medium' },
    low: { cls: 'bg-red-500/15 text-red-400 border-red-500/25', label: 'Low' },
  };
  const style = map[confidence] || map.medium;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold border ${style.cls}`}>
      <Shield size={9} />
      {style.label} confidence
    </span>
  );
}

// ---------------------------------------------------------------------------
// QueryPlan (collapsible)
// ---------------------------------------------------------------------------
function QueryPlan({ plan }) {
  const [open, setOpen] = useState(false);
  if (!plan) return null;

  // Handle both object and array formats
  const isObj = plan && typeof plan === 'object' && !Array.isArray(plan);
  const steps = isObj ? [plan] : (Array.isArray(plan) ? plan : []);
  if (steps.length === 0) return null;

  return (
    <div className="mt-2">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-[11px] text-slate-500 hover:text-slate-400 transition-colors"
      >
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        <Database size={10} />
        {isObj ? `Intent: ${plan.intent || 'unknown'}` : `Query Plan (${steps.length})`}
      </button>
      {open && (
        <div className="mt-1.5 space-y-1 ml-5">
          {isObj ? (
            <div className="text-[11px] font-mono text-slate-500 bg-slate-800/40 rounded-md px-2.5 py-1.5 border border-slate-700/30">
              <span className="text-blue-400 font-semibold">[{plan.intent}]</span>{' '}
              <span className="text-slate-400">{plan.description}</span>
              {plan.parameters && Object.keys(plan.parameters).length > 0 && (
                <div className="mt-1 text-slate-600">
                  {Object.entries(plan.parameters).map(([k, v]) => (
                    <span key={k} className="mr-2">{k}=<span className="text-emerald-400">{String(v)}</span></span>
                  ))}
                </div>
              )}
            </div>
          ) : (
            steps.map((step, i) => (
              <div key={i} className="text-[11px] font-mono text-slate-500 bg-slate-800/40 rounded-md px-2.5 py-1.5 border border-slate-700/30">
                <span className="text-blue-400 font-semibold">[{step.source || step.intent || 'query'}]</span>{' '}
                <span className="text-slate-400">{step.description || JSON.stringify(step)}</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// JSON Tree Viewer with syntax highlighting
// ---------------------------------------------------------------------------
function JsonValue({ value, depth = 0 }) {
  const indent = depth * 16;
  if (value === null) return <span className="text-purple-400 italic">null</span>;
  if (value === undefined) return <span className="text-slate-600 italic">undefined</span>;
  if (typeof value === 'boolean') return <span className="text-purple-400">{value ? 'true' : 'false'}</span>;
  if (typeof value === 'number') return <span className="text-amber-400">{value}</span>;
  if (typeof value === 'string') return <span className="text-emerald-400">&quot;{value}&quot;</span>;

  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-slate-500">{'[ ]'}</span>;
    return (
      <span>
        <span className="text-slate-500">{'['}</span>
        <div>
          {value.map((item, i) => (
            <div key={i} style={{ paddingLeft: indent + 16 }} className="leading-relaxed">
              <JsonValue value={item} depth={depth + 1} />
              {i < value.length - 1 && <span className="text-slate-600">,</span>}
            </div>
          ))}
        </div>
        <span style={{ paddingLeft: indent }} className="text-slate-500">{']'}</span>
      </span>
    );
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length === 0) return <span className="text-slate-500">{'{  }'}</span>;
    return (
      <span>
        <span className="text-slate-500">{'{'}</span>
        <div>
          {entries.map(([key, val], i) => (
            <div key={key} style={{ paddingLeft: indent + 16 }} className="leading-relaxed">
              <span className="text-blue-300">&quot;{key}&quot;</span>
              <span className="text-slate-600">: </span>
              <JsonValue value={val} depth={depth + 1} />
              {i < entries.length - 1 && <span className="text-slate-600">,</span>}
            </div>
          ))}
        </div>
        <span style={{ paddingLeft: indent }} className="text-slate-500">{'}'}</span>
      </span>
    );
  }

  return <span className="text-slate-400">{String(value)}</span>;
}

// ---------------------------------------------------------------------------
// Evidence Tab - shows structured data, not raw JSON
// ---------------------------------------------------------------------------
function RecordTable({ records, columns }) {
  if (!records || records.length === 0) return <p className="text-xs text-slate-600 py-2">No records</p>;
  const cols = columns || Object.keys(records[0]).filter(k => records[0][k] !== null);
  return (
    <div className="overflow-auto max-h-60">
      <table className="w-full text-[11px]">
        <thead className="sticky top-0 bg-slate-800/90">
          <tr>{cols.map(c => <th key={c} className="text-left px-2 py-1.5 text-slate-500 uppercase tracking-wider font-semibold border-b border-slate-700/30">{c.replace(/_/g, ' ')}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-slate-800/20">
          {records.slice(0, 30).map((r, i) => (
            <tr key={i} className="hover:bg-slate-800/30">
              {cols.map(c => <td key={c} className="px-2 py-1.5 text-slate-300 max-w-[180px] truncate">{typeof r[c] === 'object' ? JSON.stringify(r[c]) : String(r[c] ?? '--')}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      {records.length > 30 && <p className="text-[10px] text-slate-600 text-center py-1">Showing 30 of {records.length}</p>}
    </div>
  );
}

// Tools execute directly on click - no modal needed
function _removed() { // placeholder to maintain line structure
  const [msisdn, setMsisdn] = useState(defaultMsisdn || '');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [searchText, setSearchText] = useState('');
  const [days, setDays] = useState('30');
  const [towerId, setTowerId] = useState('');
  const [msisdn2, setMsisdn2] = useState('');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const TIcon = tool.icon;

  const buildQuery = () => {
    const dateStr = dateFrom ? ` from ${dateFrom}` : '';
    const dateStr2 = dateTo ? ` to ${dateTo}` : '';
    const timeRange = dateStr + dateStr2;
    switch (tool.id) {
      case 'full': return `give all info about ${msisdn}${timeRange}`;
      case 'pol': return `pattern of life for ${msisdn} last ${days} days`;
      case 'contacts': return `show contact network for ${msisdn}${timeRange}`;
      case 'movement': return `show movement trail for ${msisdn}${timeRange}`;
      case 'anomalies': return `check anomalies for ${msisdn}`;
      case 'night': return `night activity for ${msisdn}${timeRange}`;
      case 'identity': return `identity changes for ${msisdn}`;
      case 'top': return `top contacts for ${msisdn}${timeRange}`;
      case 'stats': return `activity stats for ${msisdn}`;
      case 'report': return `generate report for ${msisdn}`;
      case 'search_msg': return `search messages containing "${searchText}"${msisdn ? ' for ' + msisdn : ''}${timeRange}`;
      case 'search_call': return `search calls mentioning "${searchText}"${msisdn ? ' for ' + msisdn : ''}${timeRange}`;
      case 'tower_dump': return `tower dump for ${towerId}${timeRange}`;
      case 'colocation': return `co-location check ${msisdn} and ${msisdn2}${timeRange}`;
      case 'common': return `common contacts between ${msisdn} and ${msisdn2}`;
      case 'chain': return `call chain from ${msisdn} to ${msisdn2}`;
      default: return `${tool.label} for ${msisdn}`;
    }
  };

  const handleRun = async () => {
    const query = buildQuery().trim();
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const resp = await copilotService.chat(query, null, []);
      setResult(resp);
    } catch (err) {
      setError(err.response?.data?.detail || err.message || 'Analysis failed');
    } finally {
      setRunning(false);
    }
  };

  const handleSendToChat = () => {
    onRun(buildQuery().trim());
    onClose();
  };

  const needsMsisdn = !['search_msg', 'search_call', 'tower_dump'].includes(tool.id);
  const needsMsisdn2 = ['colocation', 'common', 'chain'].includes(tool.id);
  const needsSearch = ['search_msg', 'search_call'].includes(tool.id);
  const needsTower = tool.id === 'tower_dump';
  const needsDays = tool.id === 'pol';
  const needsDates = ['full', 'contacts', 'movement', 'night', 'top', 'search_msg', 'search_call', 'tower_dump'].includes(tool.id);

  const inputCls = "w-full bg-slate-900/80 border border-slate-600/40 rounded-lg px-3 py-2 text-sm text-slate-200 font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/40";
  const labelCls = "text-[10px] text-slate-400 uppercase tracking-wider font-semibold block mb-1";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className={`bg-slate-800 border border-slate-700/50 rounded-2xl shadow-2xl mx-4 animate-fade-in flex flex-col ${result ? 'w-full max-w-3xl max-h-[85vh]' : 'w-full max-w-md'}`} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-700/40 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-500/15 flex items-center justify-center">
              <TIcon size={18} className="text-blue-400" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-100">{tool.label}</h3>
              <p className="text-[10px] text-slate-500">{tool.desc}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 text-lg leading-none px-2">&times;</button>
        </div>

        <div className={`flex ${result ? 'flex-row flex-1 overflow-hidden' : 'flex-col'}`}>
          {/* Form panel */}
          <div className={`px-5 py-4 space-y-3 shrink-0 ${result ? 'w-72 border-r border-slate-700/30 overflow-auto' : ''}`}>
            {needsMsisdn && (
              <div>
                <label className={labelCls}>MSISDN</label>
                <input type="text" value={msisdn} onChange={e => setMsisdn(e.target.value)} placeholder="+919656152900" className={inputCls} />
              </div>
            )}
            {needsMsisdn2 && (
              <div>
                <label className={labelCls}>Second MSISDN</label>
                <input type="text" value={msisdn2} onChange={e => setMsisdn2(e.target.value)} placeholder="+919590122159" className={inputCls} />
              </div>
            )}
            {needsTower && (
              <div>
                <label className={labelCls}>Tower ID</label>
                <input type="text" value={towerId} onChange={e => setTowerId(e.target.value)} placeholder="MUM-COL-000-01" className={inputCls} />
              </div>
            )}
            {needsSearch && (
              <div>
                <label className={labelCls}>Search Text</label>
                <input type="text" value={searchText} onChange={e => setSearchText(e.target.value)} placeholder="transfer completed" className={inputCls.replace('font-mono', '')} />
              </div>
            )}
            {needsDays && (
              <div>
                <label className={labelCls}>Period (days)</label>
                <input type="number" value={days} onChange={e => setDays(e.target.value)} min="1" max="365" className={inputCls.replace('font-mono', '')} />
              </div>
            )}
            {needsDates && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-slate-500 block mb-1">From</label>
                  <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-full bg-slate-900/80 border border-slate-600/40 rounded-lg px-2.5 py-1.5 text-xs text-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500/40" />
                </div>
                <div>
                  <label className="text-[10px] text-slate-500 block mb-1">To</label>
                  <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="w-full bg-slate-900/80 border border-slate-600/40 rounded-lg px-2.5 py-1.5 text-xs text-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500/40" />
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2 pt-2">
              <button onClick={handleRun} disabled={running}
                className="flex-1 px-4 py-2 text-xs font-semibold text-white bg-gradient-to-r from-blue-600 to-blue-500 rounded-lg shadow-lg shadow-blue-500/20 hover:from-blue-500 hover:to-blue-400 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                {running ? <><Loader2 size={12} className="animate-spin" /> Running...</> : 'Run Analysis'}
              </button>
              {result && (
                <button onClick={handleSendToChat} className="px-3 py-2 text-xs text-blue-400 border border-blue-500/30 rounded-lg hover:bg-blue-500/10 transition-colors" title="Send to chat">
                  <Send size={12} />
                </button>
              )}
            </div>
          </div>

          {/* Results panel */}
          {(result || running || error) && (
            <div className="flex-1 overflow-auto p-4">
              {running && (
                <div className="flex flex-col items-center justify-center h-full gap-3">
                  <Loader2 size={24} className="text-blue-400 animate-spin" />
                  <p className="text-xs text-slate-500">Analyzing...</p>
                </div>
              )}
              {error && (
                <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs">{error}</div>
              )}
              {result && !running && (
                <div className="space-y-3">
                  {/* LLM Response */}
                  <div className="text-xs text-slate-200 leading-relaxed whitespace-pre-wrap bg-slate-900/40 rounded-lg p-3 border border-slate-700/30">
                    {formatBoldText(result.response || 'No response')}
                  </div>

                  {/* Data summary */}
                  <div className="grid grid-cols-3 gap-2">
                    {result.evidence?.length > 0 && <div className="text-center p-2 rounded-lg bg-slate-800/40"><div className="text-lg font-bold text-slate-100">{result.evidence.length}</div><div className="text-[9px] text-slate-500">Evidence</div></div>}
                    {result.timeline?.length > 0 && <div className="text-center p-2 rounded-lg bg-slate-800/40"><div className="text-lg font-bold text-blue-400">{result.timeline.length}</div><div className="text-[9px] text-slate-500">Timeline</div></div>}
                    {result.locations?.length > 0 && <div className="text-center p-2 rounded-lg bg-slate-800/40"><div className="text-lg font-bold text-green-400">{result.locations.length}</div><div className="text-[9px] text-slate-500">Locations</div></div>}
                    {result.graph?.nodes?.length > 0 && <div className="text-center p-2 rounded-lg bg-slate-800/40"><div className="text-lg font-bold text-violet-400">{result.graph.nodes.length}</div><div className="text-[9px] text-slate-500">Contacts</div></div>}
                    {result.entity && <div className="text-center p-2 rounded-lg bg-slate-800/40"><div className="text-sm font-bold text-amber-400 truncate">{result.entity.name || '--'}</div><div className="text-[9px] text-slate-500">Target</div></div>}
                    {result.pattern_of_life && <div className="text-center p-2 rounded-lg bg-slate-800/40"><div className="text-lg font-bold text-indigo-400">{((result.pattern_of_life.routine_score || 0) * 100).toFixed(0)}%</div><div className="text-[9px] text-slate-500">Routine</div></div>}
                  </div>

                  {/* Evidence sections */}
                  {result.evidence?.map((ev, i) => (
                    <details key={i} className="rounded-lg border border-slate-700/30 bg-slate-800/20">
                      <summary className="px-3 py-2 text-[11px] text-slate-300 font-semibold cursor-pointer hover:bg-slate-800/40 transition-colors flex items-center justify-between">
                        <span>{ev.source}</span>
                        <span className="text-[9px] text-slate-600">{Math.round(ev.relevance * 100)}%</span>
                      </summary>
                      <div className="px-3 py-2 border-t border-slate-700/20">
                        <pre className="text-[10px] text-slate-400 font-mono overflow-auto max-h-48 whitespace-pre-wrap">
                          {JSON.stringify(ev.data, null, 2)}
                        </pre>
                      </div>
                    </details>
                  ))}

                  {/* Send to chat button */}
                  <button onClick={handleSendToChat}
                    className="w-full py-2 text-xs text-blue-400 border border-blue-500/20 rounded-lg hover:bg-blue-500/10 transition-colors flex items-center justify-center gap-2">
                    <Send size={11} /> Open in Copilot Chat
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ToolsTab({ evidence, entity, onQuery }) {
  const msisdn = entity?.msisdn || '';

  const tools = [
    { id: 'full', label: 'Full Investigation', icon: Search, desc: 'All data', query: `give all info about ${msisdn}`, needsMsisdn: true },
    { id: 'pol', label: 'Pattern of Life', icon: Clock, desc: 'Daily routine', query: `pattern of life for ${msisdn}`, needsMsisdn: true },
    { id: 'contacts', label: 'Contact Network', icon: Users, desc: 'Communication links', query: `show contact network for ${msisdn}`, needsMsisdn: true },
    { id: 'movement', label: 'Movement Trail', icon: MapPin, desc: 'Location history', query: `show movement trail for ${msisdn}`, needsMsisdn: true },
    { id: 'anomalies', label: 'Anomaly Check', icon: AlertTriangle, desc: 'Suspicious patterns', query: `check anomalies for ${msisdn}`, needsMsisdn: true },
    { id: 'night', label: 'Night Activity', icon: Eye, desc: '11PM-5AM comms', query: `night activity for ${msisdn}`, needsMsisdn: true },
    { id: 'identity', label: 'Identity Changes', icon: Shield, desc: 'SIM/IMEI swaps', query: `identity changes for ${msisdn}`, needsMsisdn: true },
    { id: 'top', label: 'Top Contacts', icon: Phone, desc: 'Most frequent', query: `top contacts for ${msisdn}`, needsMsisdn: true },
    { id: 'stats', label: 'Activity Stats', icon: Activity, desc: 'Quick summary', query: `activity stats for ${msisdn}`, needsMsisdn: true },
    { id: 'report', label: 'Full Report', icon: FileText, desc: 'Dossier', query: `generate report for ${msisdn}`, needsMsisdn: true },
  ];

  return (
    <div className="overflow-auto max-h-[calc(100vh-260px)] p-1">
      {/* Active target */}
      {msisdn && (
        <div className="mb-3 px-3 py-2 rounded-lg bg-blue-500/5 border border-blue-500/20 flex items-center justify-between">
          <div>
            <div className="text-[10px] text-blue-400/70 uppercase tracking-wider font-semibold">Active Target</div>
            <div className="text-sm font-mono text-blue-300">{msisdn}
              {entity?.name && <span className="text-slate-400 font-sans ml-2 text-xs">{entity.name}</span>}
            </div>
          </div>
          {entity?.carrier && <span className="text-[10px] text-slate-500 bg-slate-800/50 px-2 py-0.5 rounded">{entity.carrier}</span>}
        </div>
      )}

      {/* Tools Grid - click to run immediately */}
      <div className="grid grid-cols-2 gap-2">
        {tools.map((tool) => {
          const TIcon = tool.icon;
          const disabled = tool.needsMsisdn && !msisdn;
          return (
            <button
              key={tool.id}
              disabled={disabled}
              onClick={() => !disabled && onQuery(tool.query)}
              className={`text-left p-3 rounded-xl border transition-all duration-200 group ${
                disabled
                  ? 'border-slate-800/20 bg-slate-800/10 opacity-30 cursor-not-allowed'
                  : 'border-slate-700/30 bg-slate-800/20 hover:bg-blue-500/10 hover:border-blue-500/30 cursor-pointer active:scale-[0.97]'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-slate-700/30 group-hover:bg-blue-500/15 flex items-center justify-center shrink-0 transition-colors">
                  <TIcon size={14} className="text-slate-400 group-hover:text-blue-400 transition-colors" />
                </div>
                <div className="min-w-0">
                  <div className="text-[11px] font-semibold text-slate-200 group-hover:text-white transition-colors">{tool.label}</div>
                  <div className="text-[9px] text-slate-500 truncate">{tool.desc}</div>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Evidence summary */}
      {evidence && evidence.length > 0 && (
        <div className="mt-3 space-y-1">
          <div className="text-[9px] text-slate-500 uppercase tracking-wider font-semibold px-1">Last Query Results</div>
          {evidence.map((item, i) => {
            const d = item.data || {};
            const count = d.total || d.total_contacts || d.total_anomalies || d.total_messages || d.total_calls || d.total_points || '';
            return (
              <div key={i} className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-slate-800/20 text-[10px]">
                <span className="text-slate-400">{item.source}</span>
                {count && <span className="text-slate-500">{count}</span>}
              </div>
            );
          })}
        </div>
      )}

      {!msisdn && (
        <div className="text-center py-6 mt-2">
          <Search size={28} className="mx-auto text-slate-700 mb-2" />
          <p className="text-xs text-slate-500">Ask about a phone number first</p>
          <p className="text-[10px] text-slate-600 mt-0.5">e.g. "give all info about +919656152900"</p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Timeline Tab
// ---------------------------------------------------------------------------
function TimelineTab({ events }) {
  const [typeFilter, setTypeFilter] = useState('all');

  if (!events || events.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-600">
        <Clock size={36} className="mb-3 opacity-20" />
        <p className="text-sm">No timeline data available</p>
      </div>
    );
  }

  const colorMap = { call: '#3b82f6', sms: '#22c55e', location: '#a855f7', data: '#f59e0b' };
  const typeLevel = { call: 3, sms: 2, location: 1, data: 0 };

  // Filter events
  const filtered = typeFilter === 'all' ? events : events.filter(e => e.type === typeFilter);

  // Count by type
  const typeCounts = {};
  events.forEach(e => { typeCounts[e.type] = (typeCounts[e.type] || 0) + 1; });

  // Chart data
  const chartData = filtered.map((evt, i) => {
    const ts = new Date(evt.timestamp || evt.time || Date.now()).getTime();
    return { x: isNaN(ts) ? Date.now() : ts, y: typeLevel[evt.type] ?? 0, ...evt, index: i };
  });

  // Determine if events span multiple days
  const timestamps = filtered.map(e => new Date(e.timestamp || 0).getTime()).filter(t => !isNaN(t) && t > 0);
  const minTs = Math.min(...timestamps);
  const maxTs = Math.max(...timestamps);
  const spanDays = (maxTs - minTs) / (1000 * 60 * 60 * 24);
  const xTickFormat = spanDays > 2 ? 'MMM d' : spanDays > 0.5 ? 'MMM d HH:mm' : 'HH:mm';

  // Group events by date for the list
  const grouped = {};
  filtered.forEach(evt => {
    const dateKey = evt.timestamp ? safeFormat(evt.timestamp, 'yyyy-MM-dd', 'Unknown') : 'Unknown';
    if (!grouped[dateKey]) grouped[dateKey] = [];
    grouped[dateKey].push(evt);
  });
  const sortedDates = Object.keys(grouped).sort().reverse();

  // Date range display
  const dateRange = timestamps.length > 0
    ? safeFormat(minTs, 'MMM d, yyyy') + ' — ' + safeFormat(maxTs, 'MMM d, yyyy')
    : '';

  return (
    <div className="h-[calc(100vh-260px)] flex flex-col">
      {/* Header: filters + stats */}
      <div className="flex items-center justify-between mb-3 px-1">
        <div className="flex items-center gap-2">
          {['all', ...Object.keys(typeCounts)].map(t => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-semibold transition-all ${
                typeFilter === t
                  ? 'bg-blue-500/15 text-blue-400 border border-blue-500/30'
                  : 'text-slate-500 hover:text-slate-300 border border-transparent'
              }`}
            >
              {t !== 'all' && <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: colorMap[t] || '#64748b' }} />}
              <span className="capitalize">{t}</span>
              <span className="text-slate-600">{t === 'all' ? events.length : typeCounts[t] || 0}</span>
            </button>
          ))}
        </div>
        {dateRange && <span className="text-[10px] text-slate-600 font-mono">{dateRange}</span>}
      </div>

      {/* Chart */}
      <div className="flex-shrink-0" style={{ height: '40%' }}>
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 10, right: 16, bottom: 30, left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" strokeOpacity={0.7} />
            <XAxis
              dataKey="x"
              type="number"
              domain={['dataMin', 'dataMax']}
              tickFormatter={(val) => safeFormat(val, xTickFormat, '')}
              stroke="#334155"
              tick={{ fill: '#64748b', fontSize: 10 }}
              name="Time"
            />
            <YAxis
              dataKey="y" type="number" domain={[-0.5, 3.5]} ticks={[0, 1, 2, 3]}
              tickFormatter={(val) => ['data', 'location', 'sms', 'call'][val] || ''}
              stroke="#334155" tick={{ fill: '#64748b', fontSize: 10 }} width={50}
            />
            <Tooltip
              content={({ payload }) => {
                if (!payload || payload.length === 0) return null;
                const d = payload[0].payload;
                return (
                  <div className="glass-card rounded-xl p-3 text-xs shadow-2xl border border-slate-600/30 max-w-xs">
                    <div className="font-semibold text-slate-100 mb-1 capitalize flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: colorMap[d.type] || '#64748b' }} />
                      {d.type}
                    </div>
                    <div className="text-slate-300 font-mono">{d.timestamp ? safeFormat(d.timestamp, 'MMM d, yyyy  HH:mm:ss') : '--'}</div>
                    {d.from && <div className="text-slate-400 mt-1">From: <span className="font-mono">{d.from}</span></div>}
                    {d.to && <div className="text-slate-400">To: <span className="font-mono">{d.to}</span></div>}
                    {d.duration > 0 && <div className="text-slate-400">Duration: {Math.floor(d.duration / 60)}m {d.duration % 60}s</div>}
                    {d.transcript && <div className="text-slate-500 mt-1 text-[10px] italic truncate">{d.transcript.slice(0, 80)}...</div>}
                    {d.preview && <div className="text-slate-500 mt-1 text-[10px] italic">{d.preview}</div>}
                  </div>
                );
              }}
            />
            <Scatter data={chartData} fill="#3b82f6" shape={(props) => {
              const { cx, cy, payload } = props;
              const color = colorMap[payload.type] || '#64748b';
              return (<g><circle cx={cx} cy={cy} r={7} fill={color} fillOpacity={0.1} /><circle cx={cx} cy={cy} r={4} fill={color} fillOpacity={0.85} /></g>);
            }} />
          </ScatterChart>
        </ResponsiveContainer>
      </div>

      {/* Event list grouped by date */}
      <div className="flex-1 overflow-auto mt-2 pr-1">
        {sortedDates.map(dateKey => (
          <div key={dateKey} className="mb-3">
            {/* Date header */}
            <div className="sticky top-0 z-10 bg-slate-900/95 backdrop-blur-sm px-2 py-1.5 mb-1 flex items-center gap-2">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                {dateKey !== 'Unknown' ? safeFormat(dateKey, 'EEEE, MMM d, yyyy') : 'Unknown Date'}
              </div>
              <span className="text-[9px] text-slate-600">{grouped[dateKey].length} events</span>
              <div className="flex-1 h-px bg-slate-800" />
            </div>
            {/* Events for this date */}
            <div className="space-y-0.5">
              {grouped[dateKey].map((evt, i) => (
                <div key={i} className="flex items-start gap-2.5 text-xs px-2.5 py-2 rounded-lg bg-slate-800/15 hover:bg-slate-800/40 transition-colors group">
                  <div className="w-2 h-2 rounded-full shrink-0 mt-1.5" style={{ backgroundColor: colorMap[evt.type] || '#64748b' }} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-slate-400 font-mono text-[11px] shrink-0">
                        {evt.timestamp ? safeFormat(evt.timestamp, 'HH:mm:ss') : '--:--:--'}
                      </span>
                      <span className="text-slate-500 capitalize text-[10px] font-semibold shrink-0 w-8">{evt.type}</span>
                      <span className="text-slate-200 truncate text-[11px]">
                        {evt.description || (evt.from && evt.to ? evt.from + ' → ' + evt.to : '--')}
                      </span>
                    </div>
                    {/* Extra details on hover */}
                    {(evt.transcript || evt.preview) && (
                      <div className="text-[10px] text-slate-500 mt-0.5 truncate italic opacity-60 group-hover:opacity-100 transition-opacity">
                        {evt.transcript || evt.preview}
                      </div>
                    )}
                  </div>
                  {evt.duration > 0 && (
                    <span className="text-[9px] text-slate-600 font-mono shrink-0 mt-1">{Math.floor(evt.duration / 60)}:{String(evt.duration % 60).padStart(2, '0')}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Map helpers
// ---------------------------------------------------------------------------
function FitBounds({ bounds }) {
  const map = useMap();
  useEffect(() => {
    if (bounds && bounds.length > 0) {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
    }
  }, [map, bounds]);
  return null;
}

// ---------------------------------------------------------------------------
// Map Tab
// ---------------------------------------------------------------------------
function MapTab({ locations }) {
  const [selectedStop, setSelectedStop] = useState(null);

  if (!locations || locations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-600">
        <MapPin size={36} className="mb-3 opacity-20" />
        <p className="text-sm">No location data available</p>
      </div>
    );
  }

  const validLocations = locations.filter(
    (loc) => loc.latitude != null && loc.longitude != null && !isNaN(loc.latitude) && !isNaN(loc.longitude)
  );
  if (validLocations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-600">
        <MapPin size={36} className="mb-3 opacity-20" />
        <p className="text-sm">No valid coordinates in data</p>
      </div>
    );
  }

  // Build movement stops
  const stops = [];
  let currentTower = null;
  let stopStart = null;
  let stopEnd = null;
  let stopLoc = null;

  for (const loc of validLocations) {
    const towerId = loc.tower_id || `${loc.latitude.toFixed(3)},${loc.longitude.toFixed(3)}`;
    if (towerId !== currentTower) {
      if (currentTower && stopLoc) {
        const dwellMs = stopEnd && stopStart ? new Date(stopEnd) - new Date(stopStart) : 0;
        stops.push({
          ...stopLoc,
          tower: currentTower,
          arriveTime: stopStart,
          departTime: stopEnd,
          dwellMinutes: Math.round(dwellMs / 60000),
        });
      }
      currentTower = towerId;
      stopStart = loc.timestamp;
      stopEnd = loc.timestamp;
      stopLoc = loc;
    } else {
      stopEnd = loc.timestamp;
    }
  }
  if (currentTower && stopLoc) {
    const dwellMs = stopEnd && stopStart ? new Date(stopEnd) - new Date(stopStart) : 0;
    stops.push({
      ...stopLoc,
      tower: currentTower,
      arriveTime: stopStart,
      departTime: stopEnd,
      dwellMinutes: Math.round(dwellMs / 60000),
    });
  }

  const displayStops =
    stops.length > 30
      ? stops.filter((_, i) => i === 0 || i === stops.length - 1 || i % Math.ceil(stops.length / 28) === 0)
      : stops;

  const bounds = displayStops.map((s) => [s.latitude, s.longitude]);

  const makeStopIcon = (index, total) => {
    let bg, border, label, size;
    if (index === 0) {
      bg = '#22c55e'; border = '#166534'; label = 'A'; size = 30;
    } else if (index === total - 1) {
      bg = '#ef4444'; border = '#991b1b'; label = 'Z'; size = 30;
    } else {
      const ratio = total > 1 ? index / (total - 1) : 0;
      bg = interpolateColor(ratio); border = '#0f172a'; label = `${index + 1}`; size = 24;
    }
    return new L.DivIcon({
      html: `<div style="background:${bg};width:${size}px;height:${size}px;border-radius:50%;border:2.5px solid ${border};display:flex;align-items:center;justify-content:center;font-size:${size > 26 ? 12 : 9}px;font-weight:700;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,0.9);box-shadow:0 0 12px ${bg}50,0 2px 8px rgba(0,0,0,0.4)">${label}</div>`,
      className: '',
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
    });
  };

  const segments = [];
  for (let i = 0; i < displayStops.length - 1; i++) {
    const ratio = displayStops.length > 2 ? i / (displayStops.length - 2) : 0;
    segments.push({
      positions: [
        [displayStops[i].latitude, displayStops[i].longitude],
        [displayStops[i + 1].latitude, displayStops[i + 1].longitude],
      ],
      color: interpolateColor(ratio),
    });
  }

  return (
    <div className="h-[calc(100vh-260px)] flex rounded-xl overflow-hidden border border-slate-700/30">
      {/* Journey sidebar */}
      <div className="w-[250px] bg-slate-900/95 backdrop-blur-sm border-r border-slate-800/50 overflow-auto shrink-0">
        <div className="px-4 py-3 border-b border-slate-800/50 bg-slate-800/20">
          <div className="flex items-center gap-2">
            <Navigation size={13} className="text-blue-400" />
            <span className="text-xs font-bold text-slate-200 uppercase tracking-wider">Movement Flow</span>
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            {displayStops.length} stops from {stops.length} events
          </div>
        </div>
        <div className="p-2 space-y-0">
          {displayStops.map((stop, i) => (
            <div key={i}>
              <button
                onClick={() => setSelectedStop(i)}
                className={`w-full text-left px-3 py-2.5 rounded-lg transition-all text-xs ${
                  selectedStop === i
                    ? 'bg-blue-500/15 border border-blue-500/30 shadow-lg shadow-blue-500/5'
                    : 'hover:bg-slate-800/60 border border-transparent'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <div
                    className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0 shadow-md"
                    style={{
                      background: i === 0 ? '#22c55e' : i === displayStops.length - 1 ? '#ef4444' : interpolateColor(displayStops.length > 1 ? i / (displayStops.length - 1) : 0),
                    }}
                  >
                    {i === 0 ? 'A' : i === displayStops.length - 1 ? 'Z' : i + 1}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-slate-200 font-medium truncate text-[12px]">
                      {stop.tower_id || stop.tower || `Location ${i + 1}`}
                    </div>
                    <div className="text-slate-500 text-[10px] mt-0.5">
                      {stop.arriveTime ? safeFormat(stop.arriveTime, 'MMM d, HH:mm') : '--'}
                      {stop.dwellMinutes > 0 && (
                        <span className="text-amber-400/80 ml-1.5 font-semibold">
                          {stop.dwellMinutes}m dwell
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </button>
              {i < displayStops.length - 1 && (
                <div className="flex items-center justify-center py-0.5 ml-5">
                  <div className="w-px h-3 bg-slate-700/40" />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Map */}
      <div className="flex-1">
        <MapContainer
          center={bounds.length > 0 ? bounds[0] : [19.076, 72.8777]}
          zoom={12}
          className="h-full w-full"
          scrollWheelZoom={true}
        >
          <TileLayer
            attribution="&copy; CARTO"
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          />
          {bounds.length > 1 && <FitBounds bounds={bounds} />}
          {segments.map((seg, i) => (
            <Polyline
              key={`seg-${i}`}
              positions={seg.positions}
              pathOptions={{ color: seg.color, weight: 4, opacity: 0.85, dashArray: '12 6' }}
            />
          ))}
          {displayStops.map((stop, i) => (
            <Marker key={`stop-${i}`} position={[stop.latitude, stop.longitude]} icon={makeStopIcon(i, displayStops.length)}>
              <Popup>
                <div className="text-xs min-w-[200px]">
                  <div className="font-bold text-sm mb-1.5">
                    Stop {i + 1}: {stop.tower_id || stop.tower}
                  </div>
                  {stop.city && (
                    <div>
                      <span className="text-slate-400">Area:</span> {stop.city}
                    </div>
                  )}
                  <div>
                    <span className="text-slate-400">Arrived:</span>{' '}
                    {stop.arriveTime ? safeFormat(stop.arriveTime, 'MMM d, HH:mm:ss') : '--'}
                  </div>
                  {stop.dwellMinutes > 0 && (
                    <div>
                      <span className="text-slate-400">Dwell time:</span> <strong>{stop.dwellMinutes} min</strong>
                    </div>
                  )}
                  {stop.signal_strength != null && (
                    <div>
                      <span className="text-slate-400">Signal:</span> {stop.signal_strength} dBm
                    </div>
                  )}
                  <div className="text-slate-500 mt-1">
                    {stop.latitude.toFixed(5)}, {stop.longitude.toFixed(5)}
                  </div>
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Graph Tab
// ---------------------------------------------------------------------------
function ContactsTab({ graphData, timeline }) {
  const [expandedMsisdn, setExpandedMsisdn] = useState(null);
  const [sortBy, setSortBy] = useState('weight');
  const [sortDir, setSortDir] = useState('desc');

  if (!graphData || !graphData.nodes || graphData.nodes.length <= 1) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-600">
        <Users size={36} className="mb-3 opacity-20" />
        <p className="text-sm">No contact data available</p>
      </div>
    );
  }

  const target = graphData.nodes.find(n => n.is_target);
  const contacts = graphData.nodes
    .filter(n => !n.is_target)
    .map(n => ({
      msisdn: n.msisdn || n.id,
      calls: n.call_count || 0,
      total: n.weight || 0,
    }))
    .sort((a, b) => {
      const key = sortBy === 'calls' ? 'calls' : 'total';
      return sortDir === 'desc' ? b[key] - a[key] : a[key] - b[key];
    });

  const maxTotal = Math.max(...contacts.map(c => c.total), 1);
  const totalCalls = contacts.reduce((s, c) => s + c.calls, 0);

  // Build conversation lookup from timeline
  const convos = {};
  if (timeline) {
    timeline.forEach(evt => {
      const other = evt.from === target?.msisdn ? evt.to : evt.from;
      if (!other) return;
      if (!convos[other]) convos[other] = [];
      convos[other].push(evt);
    });
  }

  const handleSort = (col) => {
    if (sortBy === col) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortBy(col); setSortDir('desc'); }
  };

  return (
    <div className="h-[calc(100vh-260px)] flex flex-col overflow-hidden">
      {/* Summary */}
      <div className="flex items-center gap-5 px-4 py-2.5 bg-slate-800/30 border-b border-slate-700/30 shrink-0">
        <div className="text-[10px] text-slate-500">Target: <span className="text-blue-400 font-mono font-semibold">{target?.msisdn || '--'}</span></div>
        <div className="text-[10px] text-slate-500">{contacts.length} contacts</div>
        <div className="text-[10px] text-slate-500">{totalCalls} calls</div>
      </div>

      {/* Contact list */}
      <div className="flex-1 overflow-auto">
        {contacts.map((c, i) => {
          const pct = Math.round((c.total / maxTotal) * 100);
          const barColor = pct > 70 ? 'bg-red-500' : pct > 40 ? 'bg-amber-500' : pct > 20 ? 'bg-green-500' : 'bg-slate-600';
          const isExpanded = expandedMsisdn === c.msisdn;
          const contactEvents = convos[c.msisdn] || [];
          const hasContent = contactEvents.some(e => e.transcript || e.preview || e.description);

          return (
            <div key={c.msisdn} className="border-b border-slate-800/20">
              {/* Contact row */}
              <button
                onClick={() => setExpandedMsisdn(isExpanded ? null : c.msisdn)}
                className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-slate-800/30 transition-colors text-left"
              >
                <span className="text-[10px] text-slate-600 font-mono w-5 shrink-0">{i + 1}</span>
                <span className="text-xs text-slate-200 font-mono font-medium flex-1">{c.msisdn}</span>
                <span className="text-[10px] text-blue-400 font-semibold w-12 text-right">{c.calls} calls</span>
                <div className="w-24 flex items-center gap-1.5">
                  <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                    <div className={`h-full ${barColor} rounded-full`} style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-[9px] text-slate-600 w-6 text-right">{pct}%</span>
                </div>
                <ChevronDown size={12} className={`text-slate-600 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
              </button>

              {/* Expanded: conversation/messages */}
              {isExpanded && (
                <div className="bg-slate-900/40 border-t border-slate-800/30 px-4 py-3">
                  {contactEvents.length === 0 ? (
                    <p className="text-[11px] text-slate-600 italic">No conversation data available for this contact</p>
                  ) : (
                    <div className="space-y-1.5 max-h-60 overflow-auto">
                      {contactEvents.slice(0, 30).map((evt, j) => (
                        <div key={j} className="flex items-start gap-2 text-[11px]">
                          {/* Direction indicator */}
                          <div className={`w-1 h-full min-h-[20px] rounded-full shrink-0 mt-0.5 ${
                            evt.from === target?.msisdn ? 'bg-blue-500' : 'bg-green-500'
                          }`} />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-slate-500 font-mono text-[10px] shrink-0">
                                {evt.timestamp ? safeFormat(evt.timestamp, 'MMM d HH:mm') : '--'}
                              </span>
                              <span className={`text-[9px] font-semibold uppercase ${evt.type === 'call' ? 'text-blue-400' : 'text-green-400'}`}>
                                {evt.type}
                              </span>
                              {evt.duration > 0 && (
                                <span className="text-[9px] text-slate-600">{Math.floor(evt.duration / 60)}:{String(evt.duration % 60).padStart(2, '0')}</span>
                              )}
                              <span className="text-[9px] text-slate-600">
                                {evt.from === target?.msisdn ? '→ outgoing' : '← incoming'}
                              </span>
                            </div>
                            {/* Message/transcript content */}
                            {(evt.transcript || evt.preview) && (
                              <div className="mt-0.5 text-slate-300 text-[11px] leading-relaxed bg-slate-800/40 rounded-lg px-2.5 py-1.5 border-l-2 border-slate-600/50">
                                {evt.transcript || evt.preview}
                              </div>
                            )}
                            {!evt.transcript && !evt.preview && evt.description && (
                              <div className="mt-0.5 text-slate-500 text-[10px]">{evt.description}</div>
                            )}
                          </div>
                        </div>
                      ))}
                      {contactEvents.length > 30 && (
                        <p className="text-[10px] text-slate-600 text-center pt-1">Showing 30 of {contactEvents.length} events</p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Entity Card Tab
// ---------------------------------------------------------------------------
function EntityCardTab({ entity }) {
  if (!entity) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-600">
        <UserCircle size={36} className="mb-3 opacity-20" />
        <p className="text-sm">No entity data available</p>
      </div>
    );
  }

  const rawRisk = entity.risk_score ?? entity.riskScore ?? null;
  // Normalize: API may return 0-1 float or 0-100 integer
  const riskScore = rawRisk !== null ? (rawRisk <= 1 ? Math.round(rawRisk * 100) : Math.round(rawRisk)) : null;
  const isWatchlisted = entity.watchlist || entity.is_watchlisted;
  const initial = (entity.name || 'U')[0].toUpperCase();

  return (
    <div className="p-4 space-y-5 max-h-[calc(100vh-260px)] overflow-auto pr-2">
      {/* Profile header */}
      <div className="relative p-5 rounded-xl bg-gradient-to-br from-slate-800/60 to-slate-800/30 border border-slate-700/40 backdrop-blur-sm overflow-hidden">
        <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/5 rounded-full -translate-y-1/2 translate-x-1/2" />
        <div className="flex items-center gap-4 relative">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-600/30 to-blue-500/10 border border-blue-500/30 flex items-center justify-center shadow-lg shadow-blue-500/10">
            <span className="text-2xl font-bold text-blue-400">{initial}</span>
          </div>
          <div className="flex-1">
            <h3 className="text-xl font-bold text-slate-100">{entity.name || 'Unknown'}</h3>
            {entity.id && (
              <p className="text-xs font-mono text-slate-500 mt-0.5 flex items-center gap-1.5">
                <span className="badge-info text-[9px]">ID</span>
                {entity.id}
              </p>
            )}
            <div className="flex items-center gap-2 mt-2">
              {entity.type && (
                <span className="badge-info text-[10px] uppercase">{entity.type}</span>
              )}
              {isWatchlisted && (
                <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold bg-red-500/15 text-red-400 border border-red-500/25 animate-pulse">
                  <Eye size={10} />
                  WATCHLISTED
                </span>
              )}
            </div>
          </div>
          {/* Risk score gauge */}
          {riskScore !== null && (
            <div className="flex flex-col items-center">
              <div className="relative w-14 h-14">
                <svg viewBox="0 0 36 36" className="w-14 h-14 -rotate-90">
                  <circle cx="18" cy="18" r="15.9" fill="none" stroke="#1e293b" strokeWidth="3" />
                  <circle
                    cx="18"
                    cy="18"
                    r="15.9"
                    fill="none"
                    stroke={riskScore >= 70 ? '#ef4444' : riskScore >= 40 ? '#f59e0b' : '#22c55e'}
                    strokeWidth="3"
                    strokeDasharray={`${riskScore} ${100 - riskScore}`}
                    strokeLinecap="round"
                  />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-sm font-bold text-slate-200">{riskScore}</span>
                </div>
              </div>
              <span className="text-[9px] text-slate-500 mt-1 uppercase tracking-wider font-semibold">Risk</span>
            </div>
          )}
        </div>
      </div>

      {/* Linked Phones */}
      {entity.phones && entity.phones.length > 0 && (
        <div>
          <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-2">
            <Phone size={12} />
            Linked Phones
          </h4>
          <div className="space-y-2">
            {entity.phones.map((phone, i) => (
              <div key={i} className="flex items-center justify-between p-3.5 rounded-xl bg-slate-800/30 border border-slate-700/30 hover:bg-slate-800/50 transition-colors">
                <div>
                  <div className="text-sm font-mono text-slate-200 font-medium">{phone.msisdn}</div>
                  <div className="flex items-center gap-3 mt-1 text-[11px] text-slate-500">
                    {phone.carrier && <span>{phone.carrier}</span>}
                    {phone.imei && <span className="font-mono">IMEI: {phone.imei}</span>}
                  </div>
                </div>
                {phone.status && (
                  <span className={phone.status === 'active' ? 'badge-low' : 'badge-medium'}>
                    {phone.status}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Devices */}
      {entity.devices && entity.devices.length > 0 && (
        <div>
          <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-2">
            <Smartphone size={12} />
            Devices
          </h4>
          <div className="grid grid-cols-2 gap-2">
            {entity.devices.map((device, i) => (
              <div key={i} className="p-3.5 rounded-xl bg-slate-800/30 border border-slate-700/30">
                <div className="text-sm text-slate-200 font-medium">
                  {device.brand && <span className="text-slate-400 mr-1">{device.brand}</span>}
                  {device.model || 'Unknown'}
                </div>
                {device.imei && <div className="text-[11px] font-mono text-slate-500 mt-1">IMEI: {device.imei}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent Activity */}
      {entity.recent_activity && entity.recent_activity.length > 0 && (
        <div>
          <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-2">
            <Activity size={12} />
            Recent Activity
          </h4>
          <div className="space-y-1">
            {entity.recent_activity.map((act, i) => (
              <div key={i} className="flex items-center gap-3 text-xs p-2.5 rounded-lg bg-slate-800/20 hover:bg-slate-800/40 transition-colors">
                <span className="text-slate-500 font-mono w-20 shrink-0">
                  {act.timestamp ? safeFormat(act.timestamp, 'MMM d HH:mm') : '--'}
                </span>
                <span className="text-slate-300">{act.description || act.type}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Metadata */}
      {entity.metadata && Object.keys(entity.metadata).length > 0 && (
        <div>
          <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-2">
            <Database size={12} />
            Metadata
          </h4>
          <div className="p-4 rounded-xl bg-slate-800/30 border border-slate-700/30 space-y-2">
            {Object.entries(entity.metadata).map(([key, val]) => (
              <div key={key} className="flex items-center justify-between py-1 text-xs">
                <span className="text-slate-500 capitalize">{key.replace(/_/g, ' ')}</span>
                <span className="text-slate-200 font-mono text-right max-w-[60%] truncate">{String(val)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Copilot Component
// ---------------------------------------------------------------------------
function PatternOfLifeTab({ data, entity }) {
  if (!data) {
    return <div className="text-sm text-slate-600 text-center py-8">No pattern of life data available</div>;
  }

  const hourLabels = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}:00`);
  const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  const hourlyData = Array.from({ length: 24 }, (_, i) => ({
    hour: hourLabels[i],
    calls: (data.hourly_calls || [])[i] || 0,
    messages: (data.hourly_messages || [])[i] || 0,
    total: ((data.hourly_calls || [])[i] || 0) + ((data.hourly_messages || [])[i] || 0),
  }));

  const weeklyData = dayLabels.map((day, i) => ({
    day,
    calls: (data.weekly_calls || [])[i] || 0,
    messages: (data.weekly_messages || [])[i] || 0,
    total: ((data.weekly_calls || [])[i] || 0) + ((data.weekly_messages || [])[i] || 0),
  }));

  const routineScore = data.routine_score || 0;
  const routineColor = routineScore > 0.6 ? '#22c55e' : routineScore > 0.3 ? '#f59e0b' : '#ef4444';
  const routineLabel = routineScore > 0.6 ? 'Highly Predictable' : routineScore > 0.3 ? 'Moderately Predictable' : 'Unpredictable';

  const LocationCard = ({ label, icon, color, location }) => {
    if (!location || !location.tower_id) return null;
    return (
      <div className={`p-4 rounded-xl bg-slate-800/40 border border-${color}-500/20`}>
        <div className="flex items-center gap-2 mb-2">
          <div className={`w-8 h-8 rounded-lg bg-${color}-500/15 flex items-center justify-center`}>
            {icon}
          </div>
          <div>
            <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">{label}</div>
            <div className="text-sm font-medium text-slate-200">{location.tower_id}</div>
          </div>
        </div>
        <div className="space-y-1 text-xs text-slate-400">
          {location.city && <div>Area: {location.city}</div>}
          {location.confidence != null && (
            <div className="flex items-center gap-2">
              <span>Confidence:</span>
              <div className="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                <div
                  className={`h-full bg-${color}-500 rounded-full`}
                  style={{ width: `${Math.max(location.confidence * 100, 5)}%` }}
                />
              </div>
              <span className="text-slate-500">{(location.confidence * 100).toFixed(0)}%</span>
            </div>
          )}
          {location.latitude != null && location.longitude != null && (
            <div className="text-[10px] text-slate-600 font-mono">
              {Number(location.latitude).toFixed(4)}, {Number(location.longitude).toFixed(4)}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="overflow-auto max-h-[calc(100vh-280px)] space-y-5 p-1 animate-fade-in">
      {/* Header with entity name, stats, and routine score */}
      <div className="flex items-center justify-between p-4 rounded-xl bg-gradient-to-r from-slate-800/60 to-slate-800/30 border border-slate-700/40">
        <div>
          <h3 className="text-lg font-bold text-slate-100">
            {entity?.name || 'Unknown'} — Pattern of Life
          </h3>
          <p className="text-xs text-slate-500 mt-1">
            {data.analysis_days || 30} days | {data.total_calls || 0} calls | {data.total_messages || 0} messages
            {data.peak_hour && <span> | Peak: {data.peak_hour}</span>}
            {data.peak_day && <span> ({data.peak_day})</span>}
            {data.avg_call_duration_sec != null && <span> | Avg call: {Math.round(data.avg_call_duration_sec / 60)}min</span>}
          </p>
        </div>
        <div className="text-right">
          <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Routine Score</div>
          <div className="flex items-center gap-2">
            <div className="w-16 h-16 relative">
              <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
                <path
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                  fill="none" stroke="#1e293b" strokeWidth="3"
                />
                <path
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                  fill="none" stroke={routineColor} strokeWidth="3"
                  strokeDasharray={`${routineScore * 100}, 100`}
                  strokeLinecap="round"
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-sm font-bold" style={{ color: routineColor }}>
                  {(routineScore * 100).toFixed(0)}%
                </span>
              </div>
            </div>
            <span className="text-xs text-slate-400">{routineLabel}</span>
          </div>
        </div>
      </div>

      {/* Key Locations */}
      <div>
        <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
          <MapPin size={12} /> Key Locations
        </h4>
        <div className="grid grid-cols-3 gap-3">
          <LocationCard
            label="Sleep Location"
            icon={<Clock size={14} className="text-indigo-400" />}
            color="indigo"
            location={data.sleep_location}
          />
          <LocationCard
            label="Work Location"
            icon={<Activity size={14} className="text-green-400" />}
            color="green"
            location={data.work_location}
          />
          <LocationCard
            label="Weekend Location"
            icon={<Calendar size={14} className="text-purple-400" />}
            color="purple"
            location={data.weekend_location}
          />
        </div>
      </div>

      {/* Hourly Communication Pattern */}
      <div>
        <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
          <Phone size={12} /> Hourly Communication (Calls + Messages)
        </h4>
        <div className="flex items-center gap-4 mb-2">
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-blue-500" />
            <span className="text-[10px] text-slate-500">Calls</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-emerald-500" />
            <span className="text-[10px] text-slate-500">Messages</span>
          </div>
        </div>
        <div className="bg-slate-800/30 rounded-xl p-3 border border-slate-700/30">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={hourlyData} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="hour" tick={{ fontSize: 9, fill: '#64748b' }} interval={2} />
              <YAxis tick={{ fontSize: 9, fill: '#64748b' }} width={30} />
              <Tooltip
                contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: '10px', fontSize: '11px' }}
                labelStyle={{ color: '#94a3b8', fontWeight: 600 }}
              />
              <Bar dataKey="calls" stackId="a" fill="#3b82f6" fillOpacity={0.85} radius={[0, 0, 0, 0]} name="Calls" />
              <Bar dataKey="messages" stackId="a" fill="#10b981" fillOpacity={0.85} radius={[3, 3, 0, 0]} name="Messages" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Weekly Communication Pattern */}
      <div>
        <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
          <Calendar size={12} /> Weekly Communication
        </h4>
        <div className="bg-slate-800/30 rounded-xl p-3 border border-slate-700/30">
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={weeklyData} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="day" tick={{ fontSize: 10, fill: '#64748b' }} />
              <YAxis tick={{ fontSize: 9, fill: '#64748b' }} width={30} />
              <Tooltip
                contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: '10px', fontSize: '11px' }}
              />
              <Bar dataKey="calls" stackId="a" fill="#3b82f6" fillOpacity={0.85} name="Calls" />
              <Bar dataKey="messages" stackId="a" fill="#10b981" fillOpacity={0.85} radius={[3, 3, 0, 0]} name="Messages" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Top Contacts */}
      {data.top_contacts && data.top_contacts.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
            <Users size={12} /> Top Contacts
          </h4>
          <div className="space-y-2">
            {data.top_contacts.map((c, i) => (
              <div key={i} className="flex items-center gap-3 p-3 rounded-xl bg-slate-800/30 border border-slate-700/30">
                <div className="w-8 h-8 rounded-lg bg-blue-500/15 flex items-center justify-center text-xs font-bold text-blue-400">
                  #{i + 1}
                </div>
                <div className="flex-1">
                  <div className="text-sm font-mono text-slate-200">{c.msisdn}</div>
                  <div className="text-[10px] text-slate-500">
                    {c.calls} calls | {Math.round((c.duration_sec || 0) / 60)} min total
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Regular Routes */}
      {data.regular_routes && data.regular_routes.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
            <Navigation size={12} /> Regular Routes
          </h4>
          <div className="space-y-2">
            {data.regular_routes.map((route, i) => (
              <div key={i} className="flex items-center gap-3 p-3 rounded-xl bg-slate-800/30 border border-slate-700/30">
                <div className="flex items-center gap-2 flex-1">
                  <span className="text-xs font-mono text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded">
                    {route.from_tower || '?'}
                  </span>
                  <ArrowRight size={12} className="text-slate-600" />
                  <span className="text-xs font-mono text-green-400 bg-green-500/10 px-2 py-0.5 rounded">
                    {route.to_tower || '?'}
                  </span>
                </div>
                <div className="text-right">
                  <div className="text-xs text-slate-300 font-medium">{route.frequency}x</div>
                  {route.typical_time && (
                    <div className="text-[10px] text-slate-500">~{route.typical_time}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function Copilot() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('pol');
  const [selectedCaseId, setSelectedCaseId] = useState(null);
  const [activeEvidence, setActiveEvidence] = useState(null);
  const [copiedIdx, setCopiedIdx] = useState(null);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const chatEndRef = useRef(null);
  const inputRef = useRef(null);

  const { data: casesData } = useQuery({
    queryKey: ['cases-list'],
    queryFn: () => casesService.getCases(),
  });

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = useCallback(async (directMessage) => {
    const text = (directMessage || input).trim();
    if (!text || loading) return;

    const userMsg = { role: 'user', content: text, timestamp: new Date().toISOString() };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const conversationHistory = messages.map((m) => ({ role: m.role, content: m.content }));
      const response = await copilotService.chat(text, null, conversationHistory);

      const aiMsg = {
        role: 'assistant',
        content: response.response || response.message || '',
        confidence: typeof response.confidence === 'number'
          ? (response.confidence >= 0.7 ? 'high' : response.confidence >= 0.4 ? 'medium' : 'low')
          : (response.confidence || 'medium'),
        evidence: response.evidence || [],
        timeline: response.timeline || [],
        locations: response.locations || [],
        graph: response.graph || null,
        entity: response.entity || null,
        pattern_of_life: response.pattern_of_life || null,
        query_plan: response.query_plan || [],
        suggestions: response.suggestions || [],
        timestamp: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, aiMsg]);
      setActiveEvidence(aiMsg);

      if (aiMsg.pattern_of_life) setActiveTab('pol');
      else if (aiMsg.entity) setActiveTab('pol');
      else if (aiMsg.timeline && aiMsg.timeline.length > 0) setActiveTab('timeline');
      else if (aiMsg.locations && aiMsg.locations.length > 0) setActiveTab('map');
      else if (aiMsg.graph && aiMsg.graph.nodes?.length > 0) setActiveTab('contacts');
      else if (aiMsg.evidence && aiMsg.evidence.length > 0) setActiveTab('tools');
    } catch (err) {
      const errMsg = {
        role: 'assistant',
        content: `Error: ${err.response?.data?.detail || err.message || 'Failed to get response'}`,
        confidence: 'low',
        evidence: [],
        timeline: [],
        locations: [],
        graph: null,
        entity: null,
        query_plan: [],
        suggestions: [],
        timestamp: new Date().toISOString(),
        isError: true,
      };
      setMessages((prev) => [...prev, errMsg]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }, [input, loading, messages]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSuggestionClick = (suggestion) => {
    setInput(suggestion);
    inputRef.current?.focus();
  };

  const handleCopy = (text, idx) => {
    navigator.clipboard.writeText(text);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 2000);
  };

  const targetName = activeEvidence?.entity?.name;
  const tabs = [
    { key: 'pol', label: 'Pattern of Life', icon: Activity },
    { key: 'tools', label: 'Tools', icon: Search },
    { key: 'timeline', label: 'Timeline', icon: Clock },
    { key: 'map', label: 'Map', icon: MapPin },
    { key: 'contacts', label: 'Contacts', icon: Users },
    { key: 'entity', label: targetName || 'Target', icon: Target },
  ];

  const suggestions = [
    { text: 'Give all info about +919656152900', icon: Search },
    { text: 'Show contact network for +919590122159', icon: GitBranch },
    { text: 'Check anomalies for +919845122940', icon: AlertTriangle },
    { text: 'Pattern of life for +919656152900', icon: Clock },
    { text: 'Night activity for +919845122940', icon: Eye },
    { text: 'Search messages containing "transfer completed"', icon: MessageSquare },
    { text: 'Identity changes for +919378304807', icon: Shield },
    { text: 'Generate report for +919656152900', icon: FileText },
  ];

  const evidenceCounts = useMemo(() => {
    if (!activeEvidence) return {};
    return {
      tools: activeEvidence.evidence?.length || 0,
      timeline: activeEvidence.timeline?.length || 0,
      map: activeEvidence.locations?.length || 0,
      graph: activeEvidence.graph?.nodes?.length || 0,
      entity: activeEvidence.entity ? 1 : 0,
      pol: activeEvidence.pattern_of_life ? 1 : 0,
    };
  }, [activeEvidence]);

  return (
    <div className="flex h-[calc(100vh-56px)]">
      {/* ================================================================== */}
      {/* LEFT PANEL - Chat (40%)                                            */}
      {/* ================================================================== */}
      <div className="w-[40%] flex flex-col border-r border-slate-800/60 glass">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-800/50 shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500/20 to-violet-500/20 border border-blue-500/20 flex items-center justify-center">
                <Sparkles size={16} className="text-blue-400" />
              </div>
              <div>
                <h1 className="text-sm font-bold text-slate-100 tracking-tight">TIAC Copilot</h1>
                <p className="text-[10px] text-slate-500">Intelligence Analysis Assistant</p>
              </div>
            </div>
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-green-500/10 border border-green-500/20">
              <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              <span className="text-[10px] text-green-400 font-medium">Online</span>
            </div>
          </div>
        </div>

        {/* Messages area */}
        <div className="flex-1 overflow-auto px-5 py-5 space-y-5">
          {/* Welcome state */}
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center px-4 animate-fade-in">
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-blue-600/15 to-violet-600/15 border border-blue-500/20 flex items-center justify-center mb-5 glow-blue">
                <Zap size={34} className="text-blue-400" />
              </div>
              <h3 className="text-xl font-bold gradient-text mb-2">Intelligence Copilot</h3>
              <p className="text-sm text-slate-500 max-w-xs leading-relaxed">
                Query telecom intelligence data, investigate phone numbers, analyze call patterns, and trace movement with AI-powered analysis.
              </p>
              <div className="mt-6 grid grid-cols-2 gap-2 w-full max-w-lg">
                {suggestions.map(({ text, icon: SIcon }) => (
                  <button
                    key={text}
                    onClick={() => handleSuggestionClick(text)}
                    className="text-left p-3 rounded-xl glass-card hover:bg-slate-700/40 hover:border-slate-600/50 transition-all duration-200 group"
                  >
                    <div className="flex items-start gap-2">
                      <SIcon size={13} className="text-blue-400/60 mt-0.5 shrink-0 group-hover:text-blue-400 transition-colors" />
                      <span className="text-[11px] text-slate-400 group-hover:text-slate-200 transition-colors leading-relaxed">
                        {text}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Chat messages */}
          {messages.map((msg, i) => (
            <div key={i} className={`flex gap-3 animate-fade-in ${msg.role === 'user' ? 'justify-end' : ''}`}>
              {/* Assistant avatar */}
              {msg.role === 'assistant' && (
                <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-600/20 to-blue-500/10 border border-blue-500/25 flex items-center justify-center shrink-0 mt-0.5 shadow-lg shadow-blue-500/5">
                  <Bot size={15} className="text-blue-400" />
                </div>
              )}

              <div
                className={`max-w-[85%] ${
                  msg.role === 'user'
                    ? 'bg-gradient-to-r from-blue-600/25 to-blue-500/15 border border-blue-500/20 rounded-2xl rounded-tr-sm px-4 py-3 shadow-lg shadow-blue-500/5'
                    : 'flex-1'
                }`}
              >
                {msg.role === 'user' ? (
                  <p className="text-sm text-slate-100 whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                ) : (
                  <div>
                    <div
                      className={`text-[13px] leading-relaxed whitespace-pre-wrap ${
                        msg.isError ? 'text-red-400' : 'text-slate-300'
                      }`}
                    >
                      {formatBoldText(msg.content)}
                    </div>

                    {/* Confidence + Copy */}
                    <div className="flex items-center gap-2.5 mt-2.5">
                      {msg.confidence && <ConfidenceBadge confidence={msg.confidence} />}
                      <button
                        onClick={() => handleCopy(msg.content, i)}
                        className="text-slate-600 hover:text-slate-300 transition-colors p-1 rounded hover:bg-slate-800/50"
                        title="Copy response"
                      >
                        {copiedIdx === i ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                      </button>
                    </div>

                    {/* Query Plan */}
                    <QueryPlan plan={msg.query_plan} />

                    {/* Evidence link */}
                    {msg.evidence && msg.evidence.length > 0 && (
                      <button
                        onClick={() => {
                          setActiveEvidence(msg);
                          setActiveTab('tools');
                        }}
                        className="mt-3 text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-500/8 border border-blue-500/15 hover:bg-blue-500/15 transition-all"
                      >
                        <Eye size={12} />
                        View {msg.evidence.length} evidence {msg.evidence.length === 1 ? 'record' : 'records'}
                      </button>
                    )}

                    {/* Suggestions */}
                    {msg.suggestions && msg.suggestions.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-3">
                        {msg.suggestions.map((sug, j) => (
                          <button
                            key={j}
                            onClick={() => handleSuggestionClick(sug)}
                            className="text-xs px-3 py-1.5 rounded-full bg-slate-800/60 border border-slate-700/40 text-slate-400 hover:text-blue-400 hover:border-blue-500/30 hover:bg-blue-500/8 transition-all duration-200"
                          >
                            {sug}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                <div className="text-[10px] text-slate-700 mt-1.5 font-mono">
                  {msg.timestamp ? safeFormat(msg.timestamp, 'HH:mm:ss', '') : ''}
                </div>
              </div>

              {/* User avatar */}
              {msg.role === 'user' && (
                <div className="w-8 h-8 rounded-xl bg-slate-700/40 border border-slate-600/30 flex items-center justify-center shrink-0 mt-0.5">
                  <User size={15} className="text-slate-400" />
                </div>
              )}
            </div>
          ))}

          {/* Loading indicator */}
          {loading && (
            <div className="flex gap-3 animate-fade-in">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-600/20 to-blue-500/10 border border-blue-500/25 flex items-center justify-center shrink-0 animate-pulse-glow">
                <Bot size={15} className="text-blue-400" />
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-blue-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                  <div className="w-2 h-2 rounded-full bg-blue-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                  <div className="w-2 h-2 rounded-full bg-blue-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
                <span className="text-sm text-slate-500">Analyzing intelligence data...</span>
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Input area */}
        <div className="p-4 border-t border-slate-800/50 shrink-0 bg-slate-950/50 backdrop-blur-sm">
          <div className="flex gap-2.5 items-end">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about any phone number, person, or pattern..."
              className="input-field resize-none text-sm leading-relaxed"
              rows={2}
              disabled={loading}
            />
            <button
              onClick={() => handleSend()}
              disabled={!input.trim() || loading}
              className="btn-primary px-3.5 py-2.5 rounded-xl"
            >
              <Send size={16} />
            </button>
          </div>
          <div className="text-[10px] text-slate-600 mt-1.5 ml-1">
            Press Enter to send, Shift+Enter for newline
          </div>
        </div>
      </div>

      {/* ================================================================== */}
      {/* RIGHT PANEL - Evidence (60%)                                       */}
      {/* ================================================================== */}
      <div className="w-[60%] flex flex-col bg-slate-900/20">
        {/* Tab bar */}
        <div className="flex items-center border-b border-slate-800/50 px-2 shrink-0 bg-slate-900/30 backdrop-blur-sm">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.key;
            const count = evidenceCounts[tab.key] || 0;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`relative flex items-center gap-2 px-5 py-3.5 text-sm font-medium transition-all duration-200 ${
                  isActive
                    ? 'text-blue-400 border-b-2 border-blue-500'
                    : 'text-slate-500 border-b-2 border-transparent hover:text-slate-300'
                }`}
              >
                {isActive && (
                  <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-8 h-1 bg-blue-500/30 rounded-full blur-sm" />
                )}
                <tab.icon size={15} />
                {tab.label}
                {count > 0 && (
                  <span className={`text-[9px] font-bold rounded-full px-1.5 py-0.5 min-w-[18px] text-center ${
                    isActive ? 'bg-blue-500/20 text-blue-400' : 'bg-slate-800/60 text-slate-500'
                  }`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-hidden p-4">
          {!activeEvidence ? (
            <div className="flex flex-col items-center justify-center h-full text-slate-600">
              <div className="w-16 h-16 rounded-2xl bg-slate-800/30 border border-slate-700/30 flex items-center justify-center mb-4">
                <Target size={28} className="opacity-20" />
              </div>
              <p className="text-sm text-slate-500">Evidence will appear here when you ask a question</p>
              <p className="text-xs text-slate-600 mt-1">Ask the copilot to investigate a phone number or pattern</p>
            </div>
          ) : (
            <>
              {activeTab === 'tools' && <ToolsTab evidence={activeEvidence.evidence} entity={activeEvidence.entity} onQuery={(q) => handleSend(q)} />}
              {activeTab === 'timeline' && <TimelineTab events={activeEvidence.timeline} />}
              {activeTab === 'map' && <MapTab locations={activeEvidence.locations} />}
              {activeTab === 'contacts' && <ContactsTab graphData={activeEvidence.graph} timeline={activeEvidence.timeline} />}
              {activeTab === 'entity' && <EntityCardTab entity={activeEvidence.entity} />}
              {activeTab === 'pol' && <PatternOfLifeTab data={activeEvidence.pattern_of_life} entity={activeEvidence.entity} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
