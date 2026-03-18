import { useState, useRef, useEffect, useCallback } from 'react';
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
  ArrowRight,
} from 'lucide-react';
import { format } from 'date-fns';
import {
  ResponsiveContainer,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import ForceGraph2D from 'react-force-graph-2d';

// Fix leaflet default marker icons
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

const towerIcon = new L.Icon({
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

function ConfidenceBadge({ confidence }) {
  const styles = {
    high: 'badge-low',
    medium: 'badge-medium',
    low: 'badge-high',
  };
  return (
    <span className={styles[confidence] || 'badge-info'}>
      {confidence} confidence
    </span>
  );
}

function QueryPlan({ plan }) {
  const [open, setOpen] = useState(false);
  if (!plan || plan.length === 0) return null;

  return (
    <div className="mt-2">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-400 transition-colors"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        Query Plan ({plan.length} queries)
      </button>
      {open && (
        <div className="mt-2 space-y-1 ml-4">
          {plan.map((step, i) => (
            <div key={i} className="text-xs font-mono text-slate-600 bg-slate-800/50 rounded px-2 py-1">
              <span className="text-blue-500">[{step.source || 'query'}]</span>{' '}
              {step.description || step.query || JSON.stringify(step)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EvidenceTab({ evidence }) {
  const [expandedIdx, setExpandedIdx] = useState(null);

  if (!evidence || evidence.length === 0) {
    return <div className="text-sm text-slate-600 text-center py-8">No evidence data available</div>;
  }

  const relevanceColor = (r) => {
    if (r >= 0.9) return 'text-red-400 bg-red-500/10 border-red-500/20';
    if (r >= 0.8) return 'text-amber-400 bg-amber-500/10 border-amber-500/20';
    return 'text-blue-400 bg-blue-500/10 border-blue-500/20';
  };

  return (
    <div className="overflow-auto max-h-[calc(100vh-280px)] space-y-3 p-1">
      {evidence.map((item, i) => (
        <div key={i} className="rounded-xl border border-slate-700/50 bg-slate-800/40 overflow-hidden animate-fade-in">
          {/* Header */}
          <button
            onClick={() => setExpandedIdx(expandedIdx === i ? null : i)}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-800/60 transition-colors"
          >
            <div className="flex items-center gap-3">
              <span className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase border ${relevanceColor(item.relevance)}`}>
                {item.source}
              </span>
              <span className="text-xs text-slate-400">
                {item.data?.total || item.data?.total_contacts || item.data?.total_anomalies || item.data?.total_points || ''}
                {item.data?.records ? ` records` : item.data?.top_contacts ? ` contacts` : item.data?.alerts ? ` alerts` : item.data?.sample_locations ? ` points` : ''}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-slate-600">relevance: {(item.relevance * 100).toFixed(0)}%</span>
              <ChevronDown size={14} className={`text-slate-500 transition-transform duration-200 ${expandedIdx === i ? 'rotate-180' : ''}`} />
            </div>
          </button>

          {/* Expanded JSON content */}
          {expandedIdx === i && (
            <div className="border-t border-slate-700/30">
              <pre className="p-4 text-xs font-mono text-slate-300 overflow-auto max-h-96 leading-relaxed whitespace-pre-wrap">
                {JSON.stringify(item.data, null, 2)}
              </pre>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function TimelineTab({ events }) {
  if (!events || events.length === 0) {
    return <div className="text-sm text-slate-600 text-center py-8">No timeline data available</div>;
  }

  const colorMap = { call: '#3b82f6', sms: '#22c55e', location: '#a855f7', data: '#f59e0b' };

  const chartData = events.map((evt, i) => ({
    x: new Date(evt.timestamp || evt.time || Date.now()).getTime(),
    y: evt.type === 'call' ? 3 : evt.type === 'sms' ? 2 : evt.type === 'location' ? 1 : 0,
    ...evt,
    index: i,
  }));

  return (
    <div className="h-[calc(100vh-280px)]">
      <div className="flex items-center gap-4 mb-3">
        {Object.entries(colorMap).map(([type, color]) => (
          <div key={type} className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
            <span className="text-xs text-slate-500 capitalize">{type}</span>
          </div>
        ))}
      </div>
      <ResponsiveContainer width="100%" height="85%">
        <ScatterChart margin={{ top: 10, right: 10, bottom: 30, left: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis
            dataKey="x"
            type="number"
            domain={['dataMin', 'dataMax']}
            tickFormatter={(val) => format(new Date(val), 'HH:mm')}
            stroke="#475569"
            fontSize={11}
            name="Time"
          />
          <YAxis
            dataKey="y"
            type="number"
            domain={[-0.5, 3.5]}
            ticks={[0, 1, 2, 3]}
            tickFormatter={(val) => ['data', 'location', 'sms', 'call'][val] || ''}
            stroke="#475569"
            fontSize={11}
            width={60}
          />
          <Tooltip
            content={({ payload }) => {
              if (!payload || payload.length === 0) return null;
              const d = payload[0].payload;
              return (
                <div className="card p-3 text-xs shadow-lg">
                  <div className="font-medium text-slate-200 mb-1 capitalize">{d.type} Event</div>
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
              return <circle cx={cx} cy={cy} r={5} fill={color} fillOpacity={0.8} stroke={color} strokeWidth={1} />;
            }}
          />
        </ScatterChart>
      </ResponsiveContainer>

      {/* Event list below chart */}
      <div className="mt-2 max-h-40 overflow-auto space-y-1">
        {events.map((evt, i) => (
          <div key={i} className="flex items-center gap-2 text-xs px-2 py-1 rounded bg-slate-800/30">
            <div
              className="w-1.5 h-1.5 rounded-full shrink-0"
              style={{ backgroundColor: colorMap[evt.type] || '#64748b' }}
            />
            <span className="text-slate-500 font-mono w-16 shrink-0">
              {evt.timestamp ? format(new Date(evt.timestamp), 'HH:mm:ss') : '--:--:--'}
            </span>
            <span className="text-slate-400 capitalize w-14 shrink-0">{evt.type}</span>
            <span className="text-slate-300 truncate">{evt.description || `${evt.from || ''} -> ${evt.to || ''}`}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function FitBounds({ bounds }) {
  const map = useMap();
  useEffect(() => {
    if (bounds && bounds.length > 0) {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
    }
  }, [map, bounds]);
  return null;
}

function interpolateColor(ratio) {
  // Green (0) -> Yellow (0.5) -> Red (1)
  const r = ratio < 0.5 ? Math.round(ratio * 2 * 255) : 255;
  const g = ratio < 0.5 ? 255 : Math.round((1 - (ratio - 0.5) * 2) * 255);
  return `rgb(${r},${g},0)`;
}

function MapTab({ locations }) {
  const [selectedStop, setSelectedStop] = useState(null);

  if (!locations || locations.length === 0) {
    return <div className="text-sm text-slate-600 text-center py-8">No location data available</div>;
  }

  const validLocations = locations.filter(
    (loc) => loc.latitude && loc.longitude && !isNaN(loc.latitude) && !isNaN(loc.longitude)
  );
  if (validLocations.length === 0) {
    return <div className="text-sm text-slate-600 text-center py-8">No valid coordinates in data</div>;
  }

  // Build movement STOPS - consolidate consecutive events at the same tower into stops with dwell time
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
          eventCount: 1,
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
  // Push last stop
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

  // Limit to manageable number of stops
  const displayStops = stops.length > 30 ? stops.filter((_, i) => i === 0 || i === stops.length - 1 || i % Math.ceil(stops.length / 28) === 0) : stops;

  const bounds = displayStops.map(s => [s.latitude, s.longitude]);

  const makeStopIcon = (index, total) => {
    let bg, border, label, size;
    if (index === 0) {
      bg = '#22c55e'; border = '#166534'; label = 'A'; size = 28;
    } else if (index === total - 1) {
      bg = '#ef4444'; border = '#991b1b'; label = 'Z'; size = 28;
    } else {
      const ratio = index / (total - 1);
      bg = interpolateColor(ratio); border = '#1e293b'; label = `${index + 1}`; size = 24;
    }
    return new L.DivIcon({
      html: `<div style="background:${bg};width:${size}px;height:${size}px;border-radius:50%;border:2px solid ${border};display:flex;align-items:center;justify-content:center;font-size:${size > 26 ? 11 : 9}px;font-weight:bold;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,0.9);box-shadow:0 0 8px ${bg}40">${label}</div>`,
      className: '',
      iconSize: [size, size],
      iconAnchor: [size/2, size/2],
    });
  };

  // Build directional segments
  const segments = [];
  for (let i = 0; i < displayStops.length - 1; i++) {
    const ratio = displayStops.length > 2 ? i / (displayStops.length - 2) : 0;
    segments.push({
      positions: [
        [displayStops[i].latitude, displayStops[i].longitude],
        [displayStops[i+1].latitude, displayStops[i+1].longitude],
      ],
      color: interpolateColor(ratio),
    });
  }

  return (
    <div className="h-[calc(100vh-280px)] flex rounded-lg overflow-hidden">
      {/* Journey log sidebar */}
      <div className="w-64 bg-slate-900/90 border-r border-slate-800/50 overflow-auto shrink-0">
        <div className="px-3 py-2 border-b border-slate-800/50 bg-slate-800/30">
          <div className="flex items-center gap-1.5">
            <Navigation size={12} className="text-blue-400" />
            <span className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider">Movement Flow</span>
          </div>
          <div className="text-[10px] text-slate-500 mt-1">{displayStops.length} stops from {stops.length} location events</div>
        </div>
        <div className="p-2 space-y-0">
          {displayStops.map((stop, i) => (
            <div key={i}>
              <button
                onClick={() => setSelectedStop(i)}
                className={`w-full text-left px-2.5 py-2 rounded-lg transition-all text-[11px] ${
                  selectedStop === i ? 'bg-blue-500/15 border border-blue-500/30' : 'hover:bg-slate-800/60 border border-transparent'
                }`}
              >
                <div className="flex items-center gap-2">
                  <div
                    className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white shrink-0"
                    style={{ background: i === 0 ? '#22c55e' : i === displayStops.length - 1 ? '#ef4444' : interpolateColor(i / (displayStops.length - 1)) }}
                  >
                    {i === 0 ? 'A' : i === displayStops.length - 1 ? 'Z' : i + 1}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-slate-300 font-medium truncate">{stop.tower_id || stop.tower || `Location ${i+1}`}</div>
                    <div className="text-slate-500 text-[10px]">
                      {stop.arriveTime ? format(new Date(stop.arriveTime), 'MMM d, HH:mm') : '--'}
                      {stop.dwellMinutes > 0 && <span className="text-amber-400/70 ml-1">({stop.dwellMinutes}m)</span>}
                    </div>
                  </div>
                </div>
              </button>
              {/* Arrow between stops */}
              {i < displayStops.length - 1 && (
                <div className="flex items-center justify-center py-0.5">
                  <div className="w-px h-3 bg-slate-700/50" />
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
            attribution='&copy; CARTO'
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          />
          {bounds.length > 1 && <FitBounds bounds={bounds} />}

          {/* Direction segments with gradient */}
          {segments.map((seg, i) => (
            <Polyline
              key={`seg-${i}`}
              positions={seg.positions}
              pathOptions={{
                color: seg.color,
                weight: 4,
                opacity: 0.85,
                dashArray: '12 6',
              }}
            />
          ))}

          {/* Stop markers */}
          {displayStops.map((stop, i) => (
            <Marker
              key={`stop-${i}`}
              position={[stop.latitude, stop.longitude]}
              icon={makeStopIcon(i, displayStops.length)}
            >
              <Popup>
                <div className="text-xs min-w-[200px]">
                  <div className="font-bold text-sm mb-1.5">
                    Stop {i + 1}: {stop.tower_id || stop.tower}
                  </div>
                  {stop.city && <div><span className="text-slate-400">Area:</span> {stop.city}</div>}
                  <div><span className="text-slate-400">Arrived:</span> {stop.arriveTime ? format(new Date(stop.arriveTime), 'MMM d, HH:mm:ss') : '--'}</div>
                  {stop.dwellMinutes > 0 && (
                    <div><span className="text-slate-400">Dwell time:</span> <strong>{stop.dwellMinutes} min</strong></div>
                  )}
                  {stop.signal_strength != null && (
                    <div><span className="text-slate-400">Signal:</span> {stop.signal_strength} dBm</div>
                  )}
                  <div className="text-slate-500 mt-1">{stop.latitude.toFixed(5)}, {stop.longitude.toFixed(5)}</div>
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>
    </div>
  );
}

function GraphTab({ graphData }) {
  const containerRef = useRef(null);
  const [dimensions, setDimensions] = useState({ width: 600, height: 400 });
  const graphRef = useRef(null);

  useEffect(() => {
    if (containerRef.current) {
      const resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          setDimensions({
            width: entry.contentRect.width,
            height: entry.contentRect.height,
          });
        }
      });
      resizeObserver.observe(containerRef.current);
      return () => resizeObserver.disconnect();
    }
  }, []);

  if (!graphData || !graphData.nodes || graphData.nodes.length === 0) {
    return <div className="text-sm text-slate-600 text-center py-8">No graph data available</div>;
  }

  // Normalize weights for proper sizing
  const allWeights = graphData.nodes.filter(n => !n.is_target).map(n => n.weight || n.call_count || 1);
  const maxWeight = Math.max(...allWeights, 1);
  const minWeight = Math.min(...allWeights, 1);

  // Color palette for contacts based on interaction strength
  const getNodeColor = (node) => {
    if (node.is_target) return '#3b82f6'; // blue - target
    const ratio = maxWeight > minWeight ? (node.rawWeight - minWeight) / (maxWeight - minWeight) : 0.5;
    if (ratio > 0.7) return '#ef4444'; // red - heavy contact
    if (ratio > 0.4) return '#f59e0b'; // amber - medium contact
    if (ratio > 0.2) return '#22c55e'; // green - light contact
    return '#64748b'; // slate - minimal contact
  };

  const data = {
    nodes: graphData.nodes.map((n) => {
      const rawWeight = n.weight || n.call_count || 1;
      const normalizedSize = n.is_target
        ? 12
        : 3 + (maxWeight > minWeight ? ((rawWeight - minWeight) / (maxWeight - minWeight)) * 9 : 3);
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

  // Assign colors after node creation
  data.nodes.forEach(n => { n.color = getNodeColor(n); });

  return (
    <div className="h-[calc(100vh-280px)] flex flex-col">
      {/* Legend */}
      <div className="flex items-center gap-4 px-3 py-2 bg-slate-900/50 rounded-t-lg border-b border-slate-800/50">
        <span className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Network</span>
        <div className="flex items-center gap-3 ml-2">
          {[
            { color: '#3b82f6', label: 'Target' },
            { color: '#ef4444', label: 'Heavy contact' },
            { color: '#f59e0b', label: 'Medium' },
            { color: '#22c55e', label: 'Light' },
            { color: '#64748b', label: 'Minimal' },
          ].map(l => (
            <div key={l.label} className="flex items-center gap-1">
              <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: l.color }} />
              <span className="text-[10px] text-slate-500">{l.label}</span>
            </div>
          ))}
        </div>
        <span className="ml-auto text-[10px] text-slate-600">{data.nodes.length} nodes, {data.links.length} links</span>
      </div>

      <div ref={containerRef} className="flex-1 rounded-b-lg overflow-hidden bg-slate-950">
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
            const alpha = 0.15 + ratio * 0.5;
            return `rgba(100, 116, 139, ${alpha})`;
          }}
          linkDirectionalArrowLength={4}
          linkDirectionalArrowRelPos={0.9}
          linkDirectionalArrowColor={(link) => {
            const ratio = maxWeight > 0 ? link.rawWeight / maxWeight : 0;
            return ratio > 0.5 ? 'rgba(239, 68, 68, 0.6)' : 'rgba(100, 116, 139, 0.4)';
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

            // Glow effect for target
            if (node.is_target) {
              ctx.beginPath();
              ctx.arc(node.x, node.y, r + 6, 0, 2 * Math.PI);
              ctx.fillStyle = 'rgba(59, 130, 246, 0.15)';
              ctx.fill();

              ctx.beginPath();
              ctx.arc(node.x, node.y, r + 3, 0, 2 * Math.PI);
              ctx.fillStyle = 'rgba(59, 130, 246, 0.25)';
              ctx.fill();
            }

            // Node circle
            ctx.beginPath();
            ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
            ctx.fillStyle = node.color;
            ctx.fill();

            // Border
            ctx.strokeStyle = node.is_target ? '#60a5fa' : 'rgba(255,255,255,0.15)';
            ctx.lineWidth = node.is_target ? 2 : 0.5;
            ctx.stroke();

            // Label
            ctx.font = `${node.is_target ? 'bold ' : ''}${fontSize}px Inter, sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = node.is_target ? '#ffffff' : '#cbd5e1';
            ctx.fillText(node.label, node.x, node.y + r + fontSize * 0.8);

            // Call count badge for high-contact nodes
            if (!node.is_target && node.callCount > 50) {
              const badgeText = String(node.callCount);
              ctx.font = `bold ${Math.max(7, 9 / globalScale)}px Inter, sans-serif`;
              const tw = ctx.measureText(badgeText).width;
              ctx.fillStyle = 'rgba(0,0,0,0.6)';
              ctx.fillRect(node.x - tw/2 - 2, node.y - r - fontSize * 0.6 - 4, tw + 4, fontSize * 0.7);
              ctx.fillStyle = '#fbbf24';
              ctx.fillText(badgeText, node.x, node.y - r - fontSize * 0.3);
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

function EntityCardTab({ entity }) {
  if (!entity) {
    return <div className="text-sm text-slate-600 text-center py-8">No entity data available</div>;
  }

  return (
    <div className="p-4 space-y-4 max-h-[calc(100vh-280px)] overflow-auto">
      {/* Profile header */}
      <div className="flex items-center gap-4 p-4 rounded-lg bg-slate-800/50 border border-slate-700/50">
        <div className="w-14 h-14 rounded-full bg-blue-600/20 border border-blue-500/30 flex items-center justify-center">
          <UserCircle size={28} className="text-blue-400" />
        </div>
        <div>
          <h3 className="text-lg font-semibold text-slate-200">{entity.name || 'Unknown'}</h3>
          {entity.id && <p className="text-xs font-mono text-slate-500">ID: {entity.id}</p>}
          {entity.type && <span className="badge-info text-[10px] uppercase mt-1">{entity.type}</span>}
        </div>
      </div>

      {/* Linked phones */}
      {entity.phones && entity.phones.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Linked Phones</h4>
          <div className="space-y-2">
            {entity.phones.map((phone, i) => (
              <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-slate-800/30 border border-slate-800/50">
                <div>
                  <span className="text-sm font-mono text-slate-300">{phone.msisdn}</span>
                  {phone.imei && <span className="text-xs text-slate-600 ml-2">IMEI: {phone.imei}</span>}
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
          <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Devices</h4>
          <div className="space-y-2">
            {entity.devices.map((device, i) => (
              <div key={i} className="p-3 rounded-lg bg-slate-800/30 border border-slate-800/50">
                <div className="text-sm text-slate-300">{device.model || device.imei || 'Unknown device'}</div>
                {device.imei && <div className="text-xs font-mono text-slate-600">IMEI: {device.imei}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent Activity */}
      {entity.recent_activity && entity.recent_activity.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Recent Activity</h4>
          <div className="space-y-1">
            {entity.recent_activity.map((act, i) => (
              <div key={i} className="flex items-center gap-2 text-xs p-2 rounded bg-slate-800/20">
                <span className="text-slate-500 font-mono">
                  {act.timestamp ? format(new Date(act.timestamp), 'MMM d HH:mm') : '--'}
                </span>
                <span className="text-slate-400">{act.description || act.type}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Additional fields */}
      {entity.metadata && (
        <div>
          <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Metadata</h4>
          <div className="p-3 rounded-lg bg-slate-800/30 border border-slate-800/50">
            {Object.entries(entity.metadata).map(([key, val]) => (
              <div key={key} className="flex items-center justify-between py-1 text-xs">
                <span className="text-slate-500">{key}</span>
                <span className="text-slate-300 font-mono">{String(val)}</span>
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
    queryFn: () => casesService.getCases(1, 100),
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
      const conversationHistory = messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const response = await copilotService.chat(text, selectedCaseId, conversationHistory, dateFrom || undefined, dateTo || undefined);

      const aiMsg = {
        role: 'assistant',
        content: response.response || response.message || '',
        confidence: response.confidence || 'medium',
        evidence: response.evidence || [],
        timeline: response.timeline || [],
        locations: response.locations || [],
        graph: response.graph || null,
        entity: response.entity || null,
        query_plan: response.query_plan || [],
        suggestions: response.suggestions || [],
        timestamp: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, aiMsg]);
      setActiveEvidence(aiMsg);

      // Auto-switch to most relevant tab
      if (aiMsg.graph && aiMsg.graph.nodes?.length > 0) setActiveTab('graph');
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
  }, [input, loading, messages, selectedCaseId, dateFrom, dateTo]);

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
    { key: 'entity', label: 'Entity Card', icon: UserCircle },
  ];

  return (
    <div className="flex h-[calc(100vh-56px)]">
      {/* Left Panel - Chat (40%) */}
      <div className="w-[40%] flex flex-col border-r border-slate-800 bg-slate-950">
        {/* Chat header */}
        <div className="px-4 py-3 border-b border-slate-800 shrink-0 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles size={16} className="text-blue-400" />
              <span className="text-sm font-semibold text-slate-200">Investigation Copilot</span>
            </div>
            <select
              value={selectedCaseId || ''}
              onChange={(e) => setSelectedCaseId(e.target.value || null)}
              className="text-xs bg-slate-800 border border-slate-700 rounded px-2 py-1 text-slate-300 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="">No case selected</option>
              {(Array.isArray(casesData) ? casesData : casesData?.cases || []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title || c.id}
                </option>
              ))}
            </select>
          </div>
          {/* Date range selector */}
          <div className="flex items-center gap-2">
            <Calendar size={12} className="text-slate-500 shrink-0" />
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="flex-1 bg-slate-800/80 border border-slate-700/50 rounded-lg px-2 py-1 text-[11px] text-slate-300 focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="From"
            />
            <span className="text-slate-600 text-[10px]">to</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="flex-1 bg-slate-800/80 border border-slate-700/50 rounded-lg px-2 py-1 text-[11px] text-slate-300 focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="To"
            />
            {(dateFrom || dateTo) && (
              <button
                onClick={() => { setDateFrom(''); setDateTo(''); }}
                className="text-[10px] text-slate-500 hover:text-slate-300 px-1"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-auto px-4 py-4 space-y-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center px-6">
              <div className="w-16 h-16 rounded-2xl bg-blue-600/10 border border-blue-500/20 flex items-center justify-center mb-4">
                <Bot size={28} className="text-blue-500" />
              </div>
              <h3 className="text-lg font-semibold text-slate-300 mb-2">TIAC Copilot</h3>
              <p className="text-sm text-slate-500 max-w-sm">
                Ask questions about telecom data, investigate phone numbers, analyze call patterns,
                or trace movement. I will query the intelligence database and present findings with evidence.
              </p>
              <div className="mt-6 space-y-2 w-full max-w-sm">
                {[
                  'Give all info about +919656152900',
                  'Show contact network for +919590122159',
                  'Check anomalies for +919845122940',
                  'Were +919620332086 and +919866162966 at the same tower?',
                ].map((suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => handleSuggestionClick(suggestion)}
                    className="w-full text-left text-xs p-2.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700 transition-colors"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : ''}`}>
              {msg.role === 'assistant' && (
                <div className="w-7 h-7 rounded-lg bg-blue-600/20 border border-blue-500/30 flex items-center justify-center shrink-0 mt-0.5">
                  <Bot size={14} className="text-blue-400" />
                </div>
              )}
              <div
                className={`max-w-[85%] ${
                  msg.role === 'user'
                    ? 'bg-blue-600/20 border border-blue-500/20 rounded-2xl rounded-tr-md px-4 py-2.5'
                    : 'flex-1'
                }`}
              >
                {msg.role === 'user' ? (
                  <p className="text-sm text-slate-200 whitespace-pre-wrap">{msg.content}</p>
                ) : (
                  <div>
                    <div
                      className={`text-sm leading-relaxed whitespace-pre-wrap ${
                        msg.isError ? 'text-red-400' : 'text-slate-300'
                      }`}
                    >
                      {msg.content}
                    </div>

                    {/* Confidence + Copy */}
                    <div className="flex items-center gap-2 mt-2">
                      {msg.confidence && <ConfidenceBadge confidence={msg.confidence} />}
                      <button
                        onClick={() => handleCopy(msg.content, i)}
                        className="text-slate-600 hover:text-slate-400 transition-colors"
                      >
                        {copiedIdx === i ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}
                      </button>
                    </div>

                    {/* Query Plan */}
                    <QueryPlan plan={msg.query_plan} />

                    {/* Evidence references */}
                    {msg.evidence && msg.evidence.length > 0 && (
                      <button
                        onClick={() => {
                          setActiveEvidence(msg);
                          setActiveTab('evidence');
                        }}
                        className="mt-2 text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
                      >
                        <FileText size={11} />
                        View {msg.evidence.length} evidence record(s)
                      </button>
                    )}

                    {/* Suggestions */}
                    {msg.suggestions && msg.suggestions.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-3">
                        {msg.suggestions.map((sug, j) => (
                          <button
                            key={j}
                            onClick={() => handleSuggestionClick(sug)}
                            className="text-xs px-2.5 py-1 rounded-full bg-slate-800 border border-slate-700 text-slate-400 hover:text-blue-400 hover:border-blue-500/30 transition-colors"
                          >
                            {sug}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                <div className="text-[10px] text-slate-700 mt-1">
                  {msg.timestamp ? format(new Date(msg.timestamp), 'HH:mm:ss') : ''}
                </div>
              </div>
              {msg.role === 'user' && (
                <div className="w-7 h-7 rounded-lg bg-slate-700/50 border border-slate-600/30 flex items-center justify-center shrink-0 mt-0.5">
                  <User size={14} className="text-slate-400" />
                </div>
              )}
            </div>
          ))}

          {loading && (
            <div className="flex gap-3">
              <div className="w-7 h-7 rounded-lg bg-blue-600/20 border border-blue-500/30 flex items-center justify-center shrink-0">
                <Bot size={14} className="text-blue-400" />
              </div>
              <div className="flex items-center gap-2 text-sm text-slate-500">
                <Loader2 size={14} className="animate-spin" />
                Analyzing...
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Input */}
        <div className="p-4 border-t border-slate-800 shrink-0">
          <div className="flex gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about any phone number, person, or pattern..."
              className="input-field resize-none text-sm"
              rows={2}
              disabled={loading}
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || loading}
              className="btn-primary px-3 self-end"
            >
              <Send size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* Right Panel - Evidence (60%) */}
      <div className="w-[60%] flex flex-col bg-slate-900/30">
        {/* Tabs */}
        <div className="flex items-center border-b border-slate-800 px-4 shrink-0">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1.5 px-4 py-3 text-sm font-medium transition-colors ${
                activeTab === tab.key ? 'tab-active' : 'tab-inactive'
              }`}
            >
              <tab.icon size={14} />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-hidden p-4">
          {!activeEvidence ? (
            <div className="flex flex-col items-center justify-center h-full text-slate-600">
              <FileText size={40} className="mb-3 opacity-30" />
              <p className="text-sm">Evidence will appear here when you ask a question</p>
            </div>
          ) : (
            <>
              {activeTab === 'evidence' && <EvidenceTab evidence={activeEvidence.evidence} />}
              {activeTab === 'timeline' && <TimelineTab events={activeEvidence.timeline} />}
              {activeTab === 'map' && <MapTab locations={activeEvidence.locations} />}
              {activeTab === 'graph' && <GraphTab graphData={activeEvidence.graph} />}
              {activeTab === 'entity' && <EntityCardTab entity={activeEvidence.entity} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
