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
import ForceGraph2D from 'react-force-graph-2d';

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
  if (!plan || plan.length === 0) return null;
  return (
    <div className="mt-2">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-[11px] text-slate-500 hover:text-slate-400 transition-colors"
      >
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        <Database size={10} />
        Query Plan ({plan.length} {plan.length === 1 ? 'query' : 'queries'})
      </button>
      {open && (
        <div className="mt-1.5 space-y-1 ml-5">
          {plan.map((step, i) => (
            <div key={i} className="text-[11px] font-mono text-slate-500 bg-slate-800/40 rounded-md px-2.5 py-1.5 border border-slate-700/30">
              <span className="text-blue-400 font-semibold">[{step.source || 'query'}]</span>{' '}
              <span className="text-slate-400">{step.description || step.query || JSON.stringify(step)}</span>
            </div>
          ))}
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
// Evidence Tab
// ---------------------------------------------------------------------------
function EvidenceTab({ evidence }) {
  const [expandedIdx, setExpandedIdx] = useState(null);

  if (!evidence || evidence.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-600">
        <Database size={36} className="mb-3 opacity-20" />
        <p className="text-sm">No evidence data available</p>
      </div>
    );
  }

  const sourceIcons = {
    'Entity Profile': UserCircle,
    CDR: Phone,
    Messages: MessageSquare,
    Contacts: GitBranch,
    Anomalies: AlertTriangle,
    Locations: MapPin,
  };

  const sourceColors = {
    'Entity Profile': 'text-blue-400 bg-blue-500/10 border-blue-500/25',
    CDR: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/25',
    Messages: 'text-green-400 bg-green-500/10 border-green-500/25',
    Contacts: 'text-violet-400 bg-violet-500/10 border-violet-500/25',
    Anomalies: 'text-red-400 bg-red-500/10 border-red-500/25',
    Locations: 'text-amber-400 bg-amber-500/10 border-amber-500/25',
  };

  const defaultColor = 'text-slate-400 bg-slate-500/10 border-slate-500/25';

  const relevanceBar = (r) => {
    const pct = Math.round(r * 100);
    let barColor = 'bg-blue-500';
    if (pct >= 90) barColor = 'bg-red-500';
    else if (pct >= 75) barColor = 'bg-amber-500';
    return { pct, barColor };
  };

  return (
    <div className="overflow-auto max-h-[calc(100vh-260px)] space-y-3 pr-1">
      {evidence.map((item, i) => {
        const Icon = sourceIcons[item.source] || FileText;
        const colorCls = sourceColors[item.source] || defaultColor;
        const { pct, barColor } = relevanceBar(item.relevance);
        const isExpanded = expandedIdx === i;

        return (
          <div key={i} className="rounded-xl border border-slate-700/40 bg-slate-800/30 backdrop-blur-sm overflow-hidden animate-fade-in">
            <button
              onClick={() => setExpandedIdx(isExpanded ? null : i)}
              className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-slate-800/50 transition-colors group"
            >
              <div className="flex items-center gap-3">
                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wide border ${colorCls}`}>
                  <Icon size={11} />
                  {item.source}
                </span>
                <span className="text-xs text-slate-500">
                  {item.data?.total || item.data?.total_contacts || item.data?.total_anomalies || item.data?.total_points || ''}
                  {item.data?.records ? ' records' : item.data?.top_contacts ? ' contacts' : item.data?.alerts ? ' alerts' : item.data?.sample_locations ? ' points' : ''}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <div className="w-20 h-1.5 bg-slate-700/50 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${barColor} transition-all`} style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-[10px] text-slate-500 font-mono w-8 text-right">{pct}%</span>
                </div>
                <ChevronDown
                  size={14}
                  className={`text-slate-500 transition-transform duration-200 group-hover:text-slate-400 ${isExpanded ? 'rotate-180' : ''}`}
                />
              </div>
            </button>
            {isExpanded && (
              <div className="border-t border-slate-700/30 bg-slate-900/40">
                <div className="p-4 text-[12px] font-mono leading-relaxed overflow-auto max-h-[400px]">
                  <JsonValue value={item.data} depth={0} />
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Timeline Tab
// ---------------------------------------------------------------------------
function TimelineTab({ events }) {
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

  const chartData = events.map((evt, i) => ({
    x: new Date(evt.timestamp || evt.time || Date.now()).getTime(),
    y: typeLevel[evt.type] ?? 0,
    ...evt,
    index: i,
  }));

  return (
    <div className="h-[calc(100vh-260px)] flex flex-col">
      {/* Legend */}
      <div className="flex items-center gap-5 mb-4 px-1">
        {Object.entries(colorMap).map(([type, color]) => (
          <div key={type} className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full ring-2 ring-offset-1 ring-offset-slate-900" style={{ backgroundColor: color, boxShadow: `0 0 8px ${color}60` }} />
            <span className="text-xs text-slate-400 capitalize font-medium">{type}</span>
          </div>
        ))}
      </div>

      {/* Chart */}
      <div className="flex-shrink-0" style={{ height: '45%' }}>
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 10, right: 16, bottom: 30, left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" strokeOpacity={0.7} />
            <XAxis
              dataKey="x"
              type="number"
              domain={['dataMin', 'dataMax']}
              tickFormatter={(val) => format(new Date(val), 'HH:mm')}
              stroke="#334155"
              tick={{ fill: '#64748b', fontSize: 11 }}
              name="Time"
            />
            <YAxis
              dataKey="y"
              type="number"
              domain={[-0.5, 3.5]}
              ticks={[0, 1, 2, 3]}
              tickFormatter={(val) => ['data', 'location', 'sms', 'call'][val] || ''}
              stroke="#334155"
              tick={{ fill: '#64748b', fontSize: 11 }}
              width={60}
            />
            <Tooltip
              content={({ payload }) => {
                if (!payload || payload.length === 0) return null;
                const d = payload[0].payload;
                return (
                  <div className="glass-card rounded-xl p-3 text-xs shadow-2xl border border-slate-600/30">
                    <div className="font-semibold text-slate-100 mb-1 capitalize flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: colorMap[d.type] || '#64748b' }} />
                      {d.type} Event
                    </div>
                    <div className="text-slate-400">
                      {d.timestamp ? format(new Date(d.timestamp), 'MMM d, HH:mm:ss') : 'N/A'}
                    </div>
                    {d.from && <div className="text-slate-500 mt-1">From: {d.from}</div>}
                    {d.to && <div className="text-slate-500">To: {d.to}</div>}
                    {d.tower_id && <div className="text-slate-500">Tower: {d.tower_id}</div>}
                    {d.duration && <div className="text-slate-500">Duration: {d.duration}s</div>}
                  </div>
                );
              }}
            />
            <Scatter
              data={chartData}
              fill="#3b82f6"
              shape={(props) => {
                const { cx, cy, payload } = props;
                const color = colorMap[payload.type] || '#64748b';
                return (
                  <g>
                    <circle cx={cx} cy={cy} r={8} fill={color} fillOpacity={0.1} />
                    <circle cx={cx} cy={cy} r={5} fill={color} fillOpacity={0.85} stroke={color} strokeWidth={1.5} strokeOpacity={0.4} />
                  </g>
                );
              }}
            />
          </ScatterChart>
        </ResponsiveContainer>
      </div>

      {/* Event list */}
      <div className="flex-1 overflow-auto mt-3 space-y-0.5 pr-1">
        {events.map((evt, i) => (
          <div
            key={i}
            className="flex items-center gap-3 text-xs px-3 py-2 rounded-lg bg-slate-800/20 hover:bg-slate-800/40 transition-colors border border-transparent hover:border-slate-700/30"
          >
            <div
              className="w-2 h-2 rounded-full shrink-0 ring-2 ring-offset-1 ring-offset-slate-900"
              style={{ backgroundColor: colorMap[evt.type] || '#64748b' }}
            />
            <span className="text-slate-500 font-mono w-16 shrink-0">
              {evt.timestamp ? format(new Date(evt.timestamp), 'HH:mm:ss') : '--:--:--'}
            </span>
            <span className="text-slate-400 capitalize w-14 shrink-0 font-medium">{evt.type}</span>
            <span className="text-slate-300 truncate">{evt.description || `${evt.from || ''} -> ${evt.to || ''}`}</span>
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
    (loc) => loc.latitude && loc.longitude && !isNaN(loc.latitude) && !isNaN(loc.longitude)
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
      const ratio = index / (total - 1);
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
                      background: i === 0 ? '#22c55e' : i === displayStops.length - 1 ? '#ef4444' : interpolateColor(i / (displayStops.length - 1)),
                    }}
                  >
                    {i === 0 ? 'A' : i === displayStops.length - 1 ? 'Z' : i + 1}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-slate-200 font-medium truncate text-[12px]">
                      {stop.tower_id || stop.tower || `Location ${i + 1}`}
                    </div>
                    <div className="text-slate-500 text-[10px] mt-0.5">
                      {stop.arriveTime ? format(new Date(stop.arriveTime), 'MMM d, HH:mm') : '--'}
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
                    {stop.arriveTime ? format(new Date(stop.arriveTime), 'MMM d, HH:mm:ss') : '--'}
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
function GraphTab({ graphData }) {
  const containerRef = useRef(null);
  const [dimensions, setDimensions] = useState({ width: 600, height: 400 });
  const graphRef = useRef(null);

  useEffect(() => {
    if (containerRef.current) {
      const obs = new ResizeObserver((entries) => {
        for (const entry of entries) {
          setDimensions({ width: entry.contentRect.width, height: entry.contentRect.height });
        }
      });
      obs.observe(containerRef.current);
      return () => obs.disconnect();
    }
  }, []);

  if (!graphData || !graphData.nodes || graphData.nodes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-600">
        <GitBranch size={36} className="mb-3 opacity-20" />
        <p className="text-sm">No graph data available</p>
      </div>
    );
  }

  const allWeights = graphData.nodes.filter((n) => !n.is_target).map((n) => n.weight || n.call_count || 1);
  const maxWeight = Math.max(...allWeights, 1);
  const minWeight = Math.min(...allWeights, 1);

  const getNodeColor = (node) => {
    if (node.is_target) return '#3b82f6';
    const ratio = maxWeight > minWeight ? (node.rawWeight - minWeight) / (maxWeight - minWeight) : 0.5;
    if (ratio > 0.7) return '#ef4444';
    if (ratio > 0.4) return '#f59e0b';
    if (ratio > 0.2) return '#22c55e';
    return '#64748b';
  };

  const data = {
    nodes: graphData.nodes.map((n) => {
      const rawWeight = n.weight || n.call_count || 1;
      const normalizedSize = n.is_target
        ? 14
        : 3 + (maxWeight > minWeight ? ((rawWeight - minWeight) / (maxWeight - minWeight)) * 10 : 3);
      return {
        id: n.id || n.msisdn,
        label: n.label || (n.msisdn || n.id || '').slice(-6),
        val: normalizedSize,
        rawWeight,
        is_target: n.is_target,
        callCount: n.call_count || 0,
        msisdn: n.msisdn || n.id,
      };
    }),
    links: (graphData.edges || graphData.links || []).map((e) => {
      const w = e.weight || e.call_count || 1;
      return {
        source: e.source || e.from,
        target: e.target || e.to,
        rawWeight: w,
        value: 0.5 + (maxWeight > 0 ? (w / maxWeight) * 4 : 1),
      };
    }),
  };
  data.nodes.forEach((n) => { n.color = getNodeColor(n); });

  const legendItems = [
    { color: '#3b82f6', label: 'Target' },
    { color: '#ef4444', label: 'Heavy' },
    { color: '#f59e0b', label: 'Medium' },
    { color: '#22c55e', label: 'Light' },
    { color: '#64748b', label: 'Minimal' },
  ];

  return (
    <div className="h-[calc(100vh-260px)] flex flex-col">
      {/* Legend */}
      <div className="flex items-center gap-4 px-4 py-2.5 bg-slate-900/60 rounded-t-xl border-b border-slate-800/40 backdrop-blur-sm">
        <span className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">Contact Network</span>
        <div className="flex items-center gap-3 ml-3">
          {legendItems.map((l) => (
            <div key={l.label} className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-full shadow-sm" style={{ backgroundColor: l.color, boxShadow: `0 0 6px ${l.color}40` }} />
              <span className="text-[10px] text-slate-500">{l.label}</span>
            </div>
          ))}
        </div>
        <span className="ml-auto text-[10px] text-slate-600 font-mono">
          {data.nodes.length} nodes / {data.links.length} links
        </span>
      </div>

      <div ref={containerRef} className="flex-1 rounded-b-xl overflow-hidden bg-slate-950/80">
        <ForceGraph2D
          ref={graphRef}
          graphData={data}
          width={dimensions.width}
          height={dimensions.height}
          nodeLabel={(node) => `${node.msisdn}\n${node.callCount} calls`}
          nodeRelSize={4}
          nodeVal="val"
          linkWidth={(link) => link.value}
          linkColor={(link) => {
            const ratio = maxWeight > 0 ? link.rawWeight / maxWeight : 0;
            const alpha = 0.12 + ratio * 0.45;
            return `rgba(100, 116, 139, ${alpha})`;
          }}
          linkDirectionalArrowLength={4}
          linkDirectionalArrowRelPos={0.9}
          linkDirectionalArrowColor={(link) => {
            const ratio = maxWeight > 0 ? link.rawWeight / maxWeight : 0;
            return ratio > 0.5 ? 'rgba(239, 68, 68, 0.6)' : 'rgba(100, 116, 139, 0.35)';
          }}
          linkCurvature={0.1}
          backgroundColor="transparent"
          cooldownTicks={80}
          d3AlphaDecay={0.03}
          d3VelocityDecay={0.3}
          nodeCanvasObjectMode={() => 'replace'}
          nodeCanvasObject={(node, ctx, globalScale) => {
            const r = Math.sqrt(node.val) * 4;
            const fontSize = Math.max(9, 11 / globalScale);

            if (node.is_target) {
              ctx.beginPath();
              ctx.arc(node.x, node.y, r + 8, 0, 2 * Math.PI);
              ctx.fillStyle = 'rgba(59, 130, 246, 0.08)';
              ctx.fill();
              ctx.beginPath();
              ctx.arc(node.x, node.y, r + 4, 0, 2 * Math.PI);
              ctx.fillStyle = 'rgba(59, 130, 246, 0.18)';
              ctx.fill();
            }

            ctx.beginPath();
            ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
            ctx.fillStyle = node.color;
            ctx.fill();
            ctx.strokeStyle = node.is_target ? '#60a5fa' : 'rgba(255,255,255,0.12)';
            ctx.lineWidth = node.is_target ? 2.5 : 0.5;
            ctx.stroke();

            ctx.font = `${node.is_target ? 'bold ' : ''}${fontSize}px Inter, sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = node.is_target ? '#ffffff' : '#cbd5e1';
            ctx.fillText(node.label, node.x, node.y + r + fontSize * 0.9);

            if (!node.is_target && node.callCount > 50) {
              const badgeText = String(node.callCount);
              const badgeFontSize = Math.max(7, 9 / globalScale);
              ctx.font = `bold ${badgeFontSize}px Inter, sans-serif`;
              const tw = ctx.measureText(badgeText).width;
              const bx = node.x - tw / 2 - 3;
              const by = node.y - r - badgeFontSize * 0.7 - 3;
              ctx.fillStyle = 'rgba(0,0,0,0.7)';
              ctx.beginPath();
              ctx.roundRect(bx, by, tw + 6, badgeFontSize + 4, 3);
              ctx.fill();
              ctx.fillStyle = '#fbbf24';
              ctx.textBaseline = 'middle';
              ctx.fillText(badgeText, node.x, by + (badgeFontSize + 4) / 2);
            }
          }}
          onNodeClick={(node) => {
            if (graphRef.current) {
              graphRef.current.centerAt(node.x, node.y, 500);
              graphRef.current.zoom(2.5, 500);
            }
          }}
        />
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

  const riskScore = entity.risk_score ?? entity.riskScore ?? null;
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
                  {act.timestamp ? format(new Date(act.timestamp), 'MMM d HH:mm') : '--'}
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

  const hourLabels = Array.from({ length: 24 }, (_, i) => `${i}:00`);
  const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  const hourlyData = (data.hourly_activity || []).map((val, i) => ({
    hour: hourLabels[i],
    events: val,
    fill: i >= 23 || i < 6 ? '#6366f1' : i >= 9 && i < 18 ? '#22c55e' : '#f59e0b',
  }));

  const weeklyData = (data.weekly_activity || []).map((val, i) => ({
    day: dayLabels[i],
    events: val,
    fill: i >= 5 ? '#a855f7' : '#3b82f6',
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
          {location.latitude && (
            <div className="text-[10px] text-slate-600 font-mono">
              {location.latitude.toFixed(4)}, {location.longitude.toFixed(4)}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="overflow-auto max-h-[calc(100vh-280px)] space-y-5 p-1 animate-fade-in">
      {/* Header with entity name and routine score */}
      <div className="flex items-center justify-between p-4 rounded-xl bg-gradient-to-r from-slate-800/60 to-slate-800/30 border border-slate-700/40">
        <div>
          <h3 className="text-lg font-bold text-slate-100">
            {entity?.name || 'Unknown'} — Pattern of Life
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Analysis period: {data.analysis_days || 30} days
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

      {/* Hourly Activity Chart */}
      <div>
        <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
          <Clock size={12} /> Hourly Activity (24h)
        </h4>
        <div className="flex items-center gap-4 mb-2">
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-indigo-500" />
            <span className="text-[10px] text-slate-500">Night (11PM-6AM)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-green-500" />
            <span className="text-[10px] text-slate-500">Work hours (9AM-6PM)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-amber-500" />
            <span className="text-[10px] text-slate-500">Other</span>
          </div>
        </div>
        <div className="bg-slate-800/30 rounded-xl p-3 border border-slate-700/30">
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={hourlyData} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="hour" tick={{ fontSize: 9, fill: '#64748b' }} interval={2} />
              <YAxis tick={{ fontSize: 9, fill: '#64748b' }} width={30} />
              <Tooltip
                contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: '8px', fontSize: '11px' }}
                labelStyle={{ color: '#94a3b8' }}
              />
              <Bar dataKey="events" radius={[3, 3, 0, 0]}>
                {hourlyData.map((entry, i) => (
                  <Cell key={i} fill={entry.fill} fillOpacity={0.8} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Weekly Activity Chart */}
      <div>
        <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
          <Calendar size={12} /> Weekly Activity
        </h4>
        <div className="flex items-center gap-4 mb-2">
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-blue-500" />
            <span className="text-[10px] text-slate-500">Weekday</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-purple-500" />
            <span className="text-[10px] text-slate-500">Weekend</span>
          </div>
        </div>
        <div className="bg-slate-800/30 rounded-xl p-3 border border-slate-700/30">
          <ResponsiveContainer width="100%" height={140}>
            <BarChart data={weeklyData} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="day" tick={{ fontSize: 10, fill: '#64748b' }} />
              <YAxis tick={{ fontSize: 9, fill: '#64748b' }} width={30} />
              <Tooltip
                contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: '8px', fontSize: '11px' }}
              />
              <Bar dataKey="events" radius={[3, 3, 0, 0]}>
                {weeklyData.map((entry, i) => (
                  <Cell key={i} fill={entry.fill} fillOpacity={0.8} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

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
  const [activeTab, setActiveTab] = useState('evidence');
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

  const handleSend = useCallback(async () => {
    const text = input.trim();
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
        confidence: response.confidence || 'medium',
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
      else if (aiMsg.graph && aiMsg.graph.nodes?.length > 0) setActiveTab('graph');
      else if (aiMsg.locations && aiMsg.locations.length > 0) setActiveTab('map');
      else if (aiMsg.timeline && aiMsg.timeline.length > 0) setActiveTab('timeline');
      else if (aiMsg.evidence && aiMsg.evidence.length > 0) setActiveTab('evidence');
      else if (aiMsg.entity) setActiveTab('entity');
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

  const tabs = [
    { key: 'evidence', label: 'Evidence', icon: FileText },
    { key: 'timeline', label: 'Timeline', icon: Clock },
    { key: 'map', label: 'Map', icon: MapPin },
    { key: 'graph', label: 'Graph', icon: GitBranch },
    { key: 'entity', label: 'Entity', icon: UserCircle },
    { key: 'pol', label: 'Pattern of Life', icon: Activity },
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
      evidence: activeEvidence.evidence?.length || 0,
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
                          setActiveTab('evidence');
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
                  {msg.timestamp ? format(new Date(msg.timestamp), 'HH:mm:ss') : ''}
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
              onClick={handleSend}
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
              {activeTab === 'evidence' && <EvidenceTab evidence={activeEvidence.evidence} />}
              {activeTab === 'timeline' && <TimelineTab events={activeEvidence.timeline} />}
              {activeTab === 'map' && <MapTab locations={activeEvidence.locations} />}
              {activeTab === 'graph' && <GraphTab graphData={activeEvidence.graph} />}
              {activeTab === 'entity' && <EntityCardTab entity={activeEvidence.entity} />}
              {activeTab === 'pol' && <PatternOfLifeTab data={activeEvidence.pattern_of_life} entity={activeEvidence.entity} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
