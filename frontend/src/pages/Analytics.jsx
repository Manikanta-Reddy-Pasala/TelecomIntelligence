import { useState, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { analyticsService } from '../services/analytics';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorMessage from '../components/ErrorMessage';
import ForceGraph2D from 'react-force-graph-2d';
import {
  GitBranch,
  Users,
  MapPin,
  AlertTriangle,
  Search,
  ArrowRight,
} from 'lucide-react';
import { format } from 'date-fns';

function ContactNetworkTab() {
  const [msisdn, setMsisdn] = useState('');
  const [queryMsisdn, setQueryMsisdn] = useState(null);
  const containerRef = useRef(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 500 });

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

  const { data, isLoading, error } = useQuery({
    queryKey: ['contact-network', queryMsisdn],
    queryFn: () => analyticsService.getContactNetwork(queryMsisdn),
    enabled: Boolean(queryMsisdn),
  });

  const handleSearch = (e) => {
    e.preventDefault();
    if (msisdn.trim()) setQueryMsisdn(msisdn.trim());
  };

  const graphData = data
    ? {
        nodes: (data.nodes || []).map((n) => ({
          id: n.id || n.msisdn,
          label: n.label || n.msisdn || n.id,
          val: Math.max(3, Math.min(15, n.call_count || n.weight || 3)),
          color: n.is_target ? '#3b82f6' : n.is_common ? '#f59e0b' : '#64748b',
        })),
        links: (data.edges || data.links || []).map((e) => ({
          source: e.source || e.from,
          target: e.target || e.to,
          value: e.weight || e.call_count || 1,
        })),
      }
    : null;

  return (
    <div className="space-y-4">
      <form onSubmit={handleSearch} className="flex gap-3 max-w-lg">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            value={msisdn}
            onChange={(e) => setMsisdn(e.target.value)}
            placeholder="Enter MSISDN (e.g., +919876543210)"
            className="w-full bg-slate-800 border border-slate-600 text-slate-100 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <button type="submit" className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors">
          Analyze
        </button>
      </form>

      {isLoading && <LoadingSpinner text="Building contact network..." />}
      {error && <ErrorMessage message="Failed to load contact network" />}

      {graphData && graphData.nodes.length > 0 ? (
        <>
          <div ref={containerRef} className="h-[calc(100vh-420px)] rounded-lg overflow-hidden bg-slate-950 border border-slate-700">
            <ForceGraph2D
              graphData={graphData}
              width={dimensions.width}
              height={dimensions.height}
              nodeLabel="label"
              nodeColor={(node) => node.color}
              nodeRelSize={5}
              linkWidth={(link) => Math.min(link.value, 5)}
              linkColor={() => '#334155'}
              linkDirectionalArrowLength={3}
              linkDirectionalArrowRelPos={1}
              backgroundColor="#0f172a"
              nodeCanvasObjectMode={() => 'after'}
              nodeCanvasObject={(node, ctx, globalScale) => {
                const label = node.label;
                const fontSize = 10 / globalScale;
                ctx.font = `${fontSize}px Inter, sans-serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillStyle = '#94a3b8';
                ctx.fillText(label, node.x, node.y + 12 / globalScale);
              }}
            />
          </div>
          {data?.contacts && data.contacts.length > 0 && (
            <div className="bg-slate-800 rounded-lg border border-slate-700 overflow-hidden mt-4">
              <div className="px-4 py-2 border-b border-slate-700 bg-slate-800/80">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Contacts ({data.contacts.length})</span>
              </div>
              <div className="overflow-auto max-h-48">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-slate-800/90">
                    <tr>
                      <th className="text-left px-4 py-2 text-xs font-medium text-slate-500 uppercase">MSISDN</th>
                      <th className="text-left px-4 py-2 text-xs font-medium text-slate-500 uppercase">Call Count</th>
                      <th className="text-left px-4 py-2 text-xs font-medium text-slate-500 uppercase">Total Duration</th>
                      <th className="text-left px-4 py-2 text-xs font-medium text-slate-500 uppercase">Last Contact</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/50">
                    {data.contacts.map((contact, i) => (
                      <tr key={i} className="hover:bg-slate-800/30">
                        <td className="px-4 py-2 font-mono text-slate-300 text-xs">{contact.msisdn || contact.contact || '--'}</td>
                        <td className="px-4 py-2 text-slate-400 text-xs">{contact.call_count ?? contact.total_calls ?? '--'}</td>
                        <td className="px-4 py-2 text-slate-400 text-xs">{contact.total_duration != null ? `${contact.total_duration}s` : '--'}</td>
                        <td className="px-4 py-2 text-slate-500 text-xs">{contact.last_contact ? format(new Date(contact.last_contact), 'MMM d, HH:mm') : '--'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      ) : queryMsisdn && !isLoading ? (
        <div className="bg-slate-800 rounded-lg p-12 text-center border border-slate-700">
          <GitBranch size={36} className="mx-auto text-slate-700 mb-3" />
          <p className="text-sm text-slate-500">No contact network data found</p>
        </div>
      ) : null}

      {!queryMsisdn && (
        <div className="bg-slate-800 rounded-lg p-12 text-center border border-slate-700">
          <GitBranch size={40} className="mx-auto text-slate-700 mb-3" />
          <p className="text-sm text-slate-500">Enter a phone number to view its contact network</p>
          <p className="text-xs text-slate-600 mt-1">Nodes represent contacts, size indicates call frequency</p>
        </div>
      )}
    </div>
  );
}

function CommonContactsTab() {
  const [msisdn1, setMsisdn1] = useState('');
  const [msisdn2, setMsisdn2] = useState('');
  const [query, setQuery] = useState(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['common-contacts', query?.msisdn1, query?.msisdn2],
    queryFn: () => analyticsService.getCommonContacts(query.msisdn1, query.msisdn2),
    enabled: Boolean(query),
  });

  const handleSearch = (e) => {
    e.preventDefault();
    if (msisdn1.trim() && msisdn2.trim()) {
      setQuery({ msisdn1: msisdn1.trim(), msisdn2: msisdn2.trim() });
    }
  };

  const contacts = data?.common_contacts || data?.contacts || data || [];

  return (
    <div className="space-y-4">
      <form onSubmit={handleSearch} className="flex gap-3 items-end flex-wrap">
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs text-slate-500 mb-1">First MSISDN</label>
          <input
            type="text"
            value={msisdn1}
            onChange={(e) => setMsisdn1(e.target.value)}
            placeholder="+919876543210"
            className="w-full bg-slate-800 border border-slate-600 text-slate-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs text-slate-500 mb-1">Second MSISDN</label>
          <input
            type="text"
            value={msisdn2}
            onChange={(e) => setMsisdn2(e.target.value)}
            placeholder="+919123456789"
            className="w-full bg-slate-800 border border-slate-600 text-slate-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <button type="submit" className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors">
          Find Common
        </button>
      </form>

      {isLoading && <LoadingSpinner text="Finding common contacts..." />}
      {error && <ErrorMessage message="Failed to find common contacts" />}

      {query && !isLoading && (
        <div className="bg-slate-800 rounded-lg border border-slate-700 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-700 bg-slate-800/80">
            <div className="flex items-center gap-2 text-sm text-slate-300">
              <span className="font-mono text-blue-400">{query.msisdn1}</span>
              <ArrowRight size={14} className="text-slate-600" />
              <span className="font-mono text-blue-400">{query.msisdn2}</span>
              <span className="text-slate-500 ml-2">
                {contacts.length} shared contact{contacts.length !== 1 ? 's' : ''}
              </span>
            </div>
          </div>
          {contacts.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-sm text-slate-500">No common contacts found between these numbers</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-800/50">
                  <th className="text-left px-4 py-2 text-xs font-medium text-slate-500 uppercase">Contact</th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-slate-500 uppercase">Calls with A</th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-slate-500 uppercase">Calls with B</th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-slate-500 uppercase">Total Calls</th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-slate-500 uppercase">Last Contact</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {contacts.map((contact, i) => (
                  <tr key={i} className="hover:bg-slate-800/30 even:bg-slate-800/20">
                    <td className="px-4 py-3 font-mono text-slate-300">{contact.msisdn || contact.contact || contact.number}</td>
                    <td className="px-4 py-3 text-slate-400">{contact.calls_with_a ?? contact.count_a ?? '--'}</td>
                    <td className="px-4 py-3 text-slate-400">{contact.calls_with_b ?? contact.count_b ?? '--'}</td>
                    <td className="px-4 py-3 text-slate-300 font-medium">{contact.total_calls ?? contact.total ?? '--'}</td>
                    <td className="px-4 py-3 text-slate-500 text-xs">
                      {contact.last_contact ? format(new Date(contact.last_contact), 'MMM d, HH:mm') : '--'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {!query && (
        <div className="bg-slate-800 rounded-lg p-12 text-center border border-slate-700">
          <Users size={40} className="mx-auto text-slate-700 mb-3" />
          <p className="text-sm text-slate-500">Enter two phone numbers to find their shared contacts</p>
        </div>
      )}
    </div>
  );
}

function ColocationTab() {
  const [msisdn1, setMsisdn1] = useState('');
  const [msisdn2, setMsisdn2] = useState('');
  const [windowMinutes, setWindowMinutes] = useState(30);
  const [query, setQuery] = useState(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['colocation', query?.msisdn1, query?.msisdn2, query?.window],
    queryFn: () => analyticsService.getColocation(query.msisdn1, query.msisdn2, query.window),
    enabled: Boolean(query),
  });

  const handleSearch = (e) => {
    e.preventDefault();
    if (msisdn1.trim() && msisdn2.trim()) {
      setQuery({ msisdn1: msisdn1.trim(), msisdn2: msisdn2.trim(), window: windowMinutes });
    }
  };

  const events = data?.colocation_events || data?.events || data || [];

  return (
    <div className="space-y-4">
      <form onSubmit={handleSearch} className="flex gap-3 items-end flex-wrap">
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs text-slate-500 mb-1">First MSISDN</label>
          <input
            type="text"
            value={msisdn1}
            onChange={(e) => setMsisdn1(e.target.value)}
            placeholder="+919876543210"
            className="w-full bg-slate-800 border border-slate-600 text-slate-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs text-slate-500 mb-1">Second MSISDN</label>
          <input
            type="text"
            value={msisdn2}
            onChange={(e) => setMsisdn2(e.target.value)}
            placeholder="+919123456789"
            className="w-full bg-slate-800 border border-slate-600 text-slate-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="w-32">
          <label className="block text-xs text-slate-500 mb-1">Window (min)</label>
          <input
            type="number"
            value={windowMinutes}
            onChange={(e) => setWindowMinutes(Number(e.target.value))}
            min={1}
            max={1440}
            className="w-full bg-slate-800 border border-slate-600 text-slate-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <button type="submit" className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors">
          Detect
        </button>
      </form>

      {isLoading && <LoadingSpinner text="Detecting co-location events..." />}
      {error && <ErrorMessage message="Failed to detect co-location" />}

      {query && !isLoading && (
        <div className="bg-slate-800 rounded-lg border border-slate-700 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-700 bg-slate-800/80">
            <div className="flex items-center gap-2 text-sm text-slate-300">
              <MapPin size={14} className="text-orange-400" />
              <span className="font-mono text-blue-400">{query.msisdn1}</span>
              <span className="text-slate-600">&</span>
              <span className="font-mono text-blue-400">{query.msisdn2}</span>
              <span className="text-slate-500 ml-2">
                {events.length} co-location event{events.length !== 1 ? 's' : ''} (within {query.window} min)
              </span>
            </div>
          </div>
          {events.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-sm text-slate-500">No co-location events detected within the specified window</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-800/50">
                  <th className="text-left px-4 py-2 text-xs font-medium text-slate-500 uppercase">Time A</th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-slate-500 uppercase">Time B</th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-slate-500 uppercase">Tower</th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-slate-500 uppercase">Time Diff</th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-slate-500 uppercase">Location</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {events.map((evt, i) => (
                  <tr key={i} className="hover:bg-slate-800/30 even:bg-slate-800/20">
                    <td className="px-4 py-3 text-slate-400 font-mono text-xs">
                      {evt.time_a ? format(new Date(evt.time_a), 'MMM d HH:mm:ss') : '--'}
                    </td>
                    <td className="px-4 py-3 text-slate-400 font-mono text-xs">
                      {evt.time_b ? format(new Date(evt.time_b), 'MMM d HH:mm:ss') : '--'}
                    </td>
                    <td className="px-4 py-3 text-slate-300 text-xs">{evt.tower_id || evt.tower || '--'}</td>
                    <td className="px-4 py-3 text-slate-400 text-xs">
                      {evt.time_diff_minutes != null ? `${evt.time_diff_minutes} min` : '--'}
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-xs">
                      {evt.latitude && evt.longitude
                        ? `${evt.latitude.toFixed(4)}, ${evt.longitude.toFixed(4)}`
                        : evt.location || '--'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {!query && (
        <div className="bg-slate-800 rounded-lg p-12 text-center border border-slate-700">
          <MapPin size={40} className="mx-auto text-slate-700 mb-3" />
          <p className="text-sm text-slate-500">Enter two phone numbers to detect when they were at the same tower</p>
          <p className="text-xs text-slate-600 mt-1">Adjust the time window to control proximity detection sensitivity</p>
        </div>
      )}
    </div>
  );
}

function AnomaliesTab() {
  const [msisdnFilter, setMsisdnFilter] = useState('');

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['anomalies', msisdnFilter],
    queryFn: () => analyticsService.getAnomalies(msisdnFilter || undefined),
  });

  const anomalies = data?.anomalies || data?.alerts || data || [];

  const severityColors = {
    critical: 'bg-red-500/20 text-red-400 border-red-500/30',
    high: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
    medium: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    low: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-3 max-w-md">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            value={msisdnFilter}
            onChange={(e) => setMsisdnFilter(e.target.value)}
            placeholder="Filter by MSISDN (optional)"
            className="w-full bg-slate-800 border border-slate-600 text-slate-100 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      {isLoading ? (
        <LoadingSpinner text="Loading anomalies..." />
      ) : error ? (
        <ErrorMessage message="Failed to load anomalies" onRetry={refetch} />
      ) : anomalies.length === 0 ? (
        <div className="bg-slate-800 rounded-lg p-12 text-center border border-slate-700">
          <AlertTriangle size={36} className="mx-auto text-slate-700 mb-3" />
          <p className="text-sm text-slate-500">No anomalies detected</p>
        </div>
      ) : (
        <div className="bg-slate-800 rounded-lg border border-slate-700 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-800/50">
                <th className="text-left px-4 py-2 text-xs font-medium text-slate-500 uppercase">Severity</th>
                <th className="text-left px-4 py-2 text-xs font-medium text-slate-500 uppercase">Type</th>
                <th className="text-left px-4 py-2 text-xs font-medium text-slate-500 uppercase">MSISDN</th>
                <th className="text-left px-4 py-2 text-xs font-medium text-slate-500 uppercase">Description</th>
                <th className="text-left px-4 py-2 text-xs font-medium text-slate-500 uppercase">Detected At</th>
                <th className="text-left px-4 py-2 text-xs font-medium text-slate-500 uppercase">Score</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {anomalies.map((anomaly, i) => (
                <tr key={anomaly.id || i} className="hover:bg-slate-800/30 even:bg-slate-800/20">
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-1 text-xs font-medium border ${
                        severityColors[anomaly.severity] || severityColors.low
                      }`}
                    >
                      {anomaly.severity || 'low'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-300 text-xs">{anomaly.anomaly_type || anomaly.type || '--'}</td>
                  <td className="px-4 py-3 font-mono text-slate-400 text-xs">{anomaly.msisdn || '--'}</td>
                  <td className="px-4 py-3 text-slate-400 text-xs max-w-xs truncate">
                    {anomaly.description || anomaly.message || '--'}
                  </td>
                  <td className="px-4 py-3 text-slate-500 text-xs font-mono">
                    {anomaly.detected_at || anomaly.timestamp
                      ? format(new Date(anomaly.detected_at || anomaly.timestamp), 'MMM d, HH:mm:ss')
                      : '--'}
                  </td>
                  <td className="px-4 py-3">
                    {anomaly.score != null && (
                      <span
                        className={`text-xs font-medium ${
                          anomaly.score >= 0.8
                            ? 'text-red-400'
                            : anomaly.score >= 0.5
                            ? 'text-yellow-400'
                            : 'text-slate-400'
                        }`}
                      >
                        {(anomaly.score * 100).toFixed(0)}%
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function Analytics() {
  const [activeTab, setActiveTab] = useState('network');

  const tabs = [
    { key: 'network', label: 'Contact Network', icon: GitBranch },
    { key: 'common', label: 'Common Contacts', icon: Users },
    { key: 'colocation', label: 'Co-location', icon: MapPin },
    { key: 'anomalies', label: 'Anomalies', icon: AlertTriangle },
  ];

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-100">Analytics</h1>
        <p className="text-sm text-slate-500 mt-1">Network analysis, pattern detection, and anomaly alerts</p>
      </div>

      {/* Tabs */}
      <div className="border-b border-slate-700">
        <div className="flex gap-0">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-5 py-3 text-sm font-medium transition-colors border-b-2 ${
                activeTab === tab.key
                  ? 'border-blue-500 text-blue-400'
                  : 'border-transparent text-slate-500 hover:text-slate-300'
              }`}
            >
              <tab.icon size={14} />
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      {activeTab === 'network' && <ContactNetworkTab />}
      {activeTab === 'common' && <CommonContactsTab />}
      {activeTab === 'colocation' && <ColocationTab />}
      {activeTab === 'anomalies' && <AnomaliesTab />}
    </div>
  );
}
