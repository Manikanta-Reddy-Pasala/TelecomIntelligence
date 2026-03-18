import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { advancedService } from '../services/advanced';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorMessage from '../components/ErrorMessage';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import {
  Search,
  Radio,
  MapPin,
  Shield,
  Users,
  GitBranch,
  Moon,
  Star,
  FileText,
  BarChart3,
  Phone,
  MessageSquare,
  Clock,
  AlertTriangle,
  ChevronDown,
  Plus,
  Minus,
  Copy,
  Check,
} from 'lucide-react';
import { format } from 'date-fns';

/* ─── Tab Definitions ─── */
const tabs = [
  { key: 'tower-dump', label: 'Tower Dump', icon: Radio },
  { key: 'geofence', label: 'Geofence', icon: MapPin },
  { key: 'pattern-of-life', label: 'Pattern of Life', icon: Clock },
  { key: 'identity', label: 'Identity Changes', icon: Shield },
  { key: 'common', label: 'Common Numbers', icon: Users },
  { key: 'call-chain', label: 'Call Chain', icon: GitBranch },
  { key: 'night', label: 'Night Activity', icon: Moon },
  { key: 'top-contacts', label: 'Top Contacts', icon: Star },
  { key: 'report', label: 'Report', icon: FileText },
  { key: 'stats', label: 'Stats', icon: BarChart3 },
];

/* ─── Shared Helpers ─── */
function EmptyState({ icon: Icon, text, subtext }) {
  return (
    <div className="bg-slate-800 rounded-lg p-12 text-center border border-slate-700">
      <Icon size={40} className="mx-auto text-slate-700 mb-3" />
      <p className="text-sm text-slate-500">{text}</p>
      {subtext && <p className="text-xs text-slate-600 mt-1">{subtext}</p>}
    </div>
  );
}

function StatCard({ label, value, icon: Icon, color = 'blue' }) {
  const colorMap = {
    blue: 'from-blue-500/20 to-blue-600/10 border-blue-500/20 text-blue-400',
    green: 'from-green-500/20 to-green-600/10 border-green-500/20 text-green-400',
    amber: 'from-amber-500/20 to-amber-600/10 border-amber-500/20 text-amber-400',
    purple: 'from-purple-500/20 to-purple-600/10 border-purple-500/20 text-purple-400',
    red: 'from-red-500/20 to-red-600/10 border-red-500/20 text-red-400',
    slate: 'from-slate-500/20 to-slate-600/10 border-slate-500/20 text-slate-400',
  };
  return (
    <div className={`rounded-lg border bg-gradient-to-br p-4 ${colorMap[color] || colorMap.blue}`}>
      <div className="flex items-center gap-2 mb-2">
        {Icon && <Icon size={14} />}
        <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">{label}</span>
      </div>
      <div className="text-2xl font-bold">{value ?? '--'}</div>
    </div>
  );
}

/* ─── Tab 1: Tower Dump ─── */
function TowerDumpTab() {
  const [towerId, setTowerId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [query, setQuery] = useState(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['tower-dump', query?.towerId, query?.from, query?.to],
    queryFn: () => advancedService.towerDump(query.towerId, query.from || undefined, query.to || undefined),
    enabled: Boolean(query),
  });

  const handleSearch = (e) => {
    e.preventDefault();
    if (towerId.trim()) setQuery({ towerId: towerId.trim(), from, to });
  };

  const results = data?.results || data?.records || data || [];
  const sorted = [...(Array.isArray(results) ? results : [])].sort(
    (a, b) => (b.event_count ?? b.events ?? 0) - (a.event_count ?? a.events ?? 0)
  );

  return (
    <div className="space-y-4">
      <form onSubmit={handleSearch} className="flex gap-3 items-end flex-wrap">
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs text-slate-500 mb-1">Tower ID</label>
          <input
            type="text"
            value={towerId}
            onChange={(e) => setTowerId(e.target.value)}
            placeholder="Enter Tower ID"
            className="w-full bg-slate-800 border border-slate-600 text-slate-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="w-44">
          <label className="block text-xs text-slate-500 mb-1">From</label>
          <input
            type="datetime-local"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="w-full bg-slate-800 border border-slate-600 text-slate-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="w-44">
          <label className="block text-xs text-slate-500 mb-1">To</label>
          <input
            type="datetime-local"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="w-full bg-slate-800 border border-slate-600 text-slate-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <button type="submit" className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors">
          Search
        </button>
      </form>

      {isLoading && <LoadingSpinner text="Loading tower dump..." />}
      {error && <ErrorMessage message="Failed to load tower dump" />}

      {query && !isLoading && sorted.length > 0 && (
        <div className="bg-slate-800 rounded-lg border border-slate-700 overflow-hidden">
          <div className="px-4 py-2 border-b border-slate-700 bg-slate-800/80">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Results ({sorted.length})
            </span>
          </div>
          <div className="overflow-auto max-h-[60vh]">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-800/90">
                <tr>
                  <th className="text-left px-4 py-2 text-xs font-medium text-slate-500 uppercase">MSISDN</th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-slate-500 uppercase">Events</th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-slate-500 uppercase">First Seen</th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-slate-500 uppercase">Last Seen</th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-slate-500 uppercase">Dwell Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {sorted.map((r, i) => (
                  <tr key={i} className="hover:bg-slate-800/30 even:bg-slate-800/20">
                    <td className="px-4 py-2 font-mono text-slate-300 text-xs">{r.msisdn || '--'}</td>
                    <td className="px-4 py-2 text-slate-300 text-xs font-medium">{r.event_count ?? r.events ?? '--'}</td>
                    <td className="px-4 py-2 text-slate-400 text-xs">
                      {r.first_seen ? format(new Date(r.first_seen), 'MMM d, HH:mm') : '--'}
                    </td>
                    <td className="px-4 py-2 text-slate-400 text-xs">
                      {r.last_seen ? format(new Date(r.last_seen), 'MMM d, HH:mm') : '--'}
                    </td>
                    <td className="px-4 py-2 text-slate-400 text-xs">{r.dwell_time ?? r.dwell_minutes ? `${r.dwell_time ?? r.dwell_minutes} min` : '--'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {query && !isLoading && sorted.length === 0 && (
        <EmptyState icon={Radio} text="No records found for this tower" />
      )}

      {!query && (
        <EmptyState icon={Radio} text="Enter a Tower ID to retrieve all MSISDNs observed at that tower" subtext="Results sorted by event count descending" />
      )}
    </div>
  );
}

/* ─── Tab 2: Geofence ─── */
function GeofenceTab() {
  const [latMin, setLatMin] = useState('');
  const [latMax, setLatMax] = useState('');
  const [lngMin, setLngMin] = useState('');
  const [lngMax, setLngMax] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [query, setQuery] = useState(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['geofence', query],
    queryFn: () =>
      advancedService.geofence({
        lat_min: parseFloat(query.latMin),
        lat_max: parseFloat(query.latMax),
        lng_min: parseFloat(query.lngMin),
        lng_max: parseFloat(query.lngMax),
        from: query.from || undefined,
        to: query.to || undefined,
      }),
    enabled: Boolean(query),
  });

  const handleSearch = (e) => {
    e.preventDefault();
    if (latMin && latMax && lngMin && lngMax) {
      setQuery({ latMin, latMax, lngMin, lngMax, from, to });
    }
  };

  const results = data?.results || data?.records || data || [];
  const items = Array.isArray(results) ? results : [];

  return (
    <div className="space-y-4">
      <form onSubmit={handleSearch} className="space-y-3">
        <div className="flex gap-3 flex-wrap">
          <div className="w-36">
            <label className="block text-xs text-slate-500 mb-1">Lat Min</label>
            <input type="number" step="any" value={latMin} onChange={(e) => setLatMin(e.target.value)} placeholder="28.40"
              className="w-full bg-slate-800 border border-slate-600 text-slate-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="w-36">
            <label className="block text-xs text-slate-500 mb-1">Lat Max</label>
            <input type="number" step="any" value={latMax} onChange={(e) => setLatMax(e.target.value)} placeholder="28.80"
              className="w-full bg-slate-800 border border-slate-600 text-slate-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="w-36">
            <label className="block text-xs text-slate-500 mb-1">Lng Min</label>
            <input type="number" step="any" value={lngMin} onChange={(e) => setLngMin(e.target.value)} placeholder="77.00"
              className="w-full bg-slate-800 border border-slate-600 text-slate-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="w-36">
            <label className="block text-xs text-slate-500 mb-1">Lng Max</label>
            <input type="number" step="any" value={lngMax} onChange={(e) => setLngMax(e.target.value)} placeholder="77.40"
              className="w-full bg-slate-800 border border-slate-600 text-slate-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="w-44">
            <label className="block text-xs text-slate-500 mb-1">From</label>
            <input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)}
              className="w-full bg-slate-800 border border-slate-600 text-slate-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="w-44">
            <label className="block text-xs text-slate-500 mb-1">To</label>
            <input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)}
              className="w-full bg-slate-800 border border-slate-600 text-slate-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button type="submit" className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors">
            Search Zone
          </button>
          <span className="text-xs text-slate-600">Draw on Map support coming soon</span>
        </div>
      </form>

      {isLoading && <LoadingSpinner text="Searching geofence zone..." />}
      {error && <ErrorMessage message="Failed to search geofence" />}

      {query && !isLoading && items.length > 0 && (
        <div className="bg-slate-800 rounded-lg border border-slate-700 overflow-hidden">
          <div className="px-4 py-2 border-b border-slate-700 bg-slate-800/80">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              MSISDNs in zone ({items.length})
            </span>
          </div>
          <div className="overflow-auto max-h-[60vh]">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-800/90">
                <tr>
                  <th className="text-left px-4 py-2 text-xs font-medium text-slate-500 uppercase">MSISDN</th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-slate-500 uppercase">Events</th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-slate-500 uppercase">First Seen</th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-slate-500 uppercase">Last Seen</th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-slate-500 uppercase">Tower</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {items.map((r, i) => (
                  <tr key={i} className="hover:bg-slate-800/30 even:bg-slate-800/20">
                    <td className="px-4 py-2 font-mono text-slate-300 text-xs">{r.msisdn || '--'}</td>
                    <td className="px-4 py-2 text-slate-400 text-xs">{r.event_count ?? r.events ?? '--'}</td>
                    <td className="px-4 py-2 text-slate-400 text-xs">
                      {r.first_seen ? format(new Date(r.first_seen), 'MMM d, HH:mm') : '--'}
                    </td>
                    <td className="px-4 py-2 text-slate-400 text-xs">
                      {r.last_seen ? format(new Date(r.last_seen), 'MMM d, HH:mm') : '--'}
                    </td>
                    <td className="px-4 py-2 text-slate-500 text-xs">{r.tower_id || r.tower || '--'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {query && !isLoading && items.length === 0 && (
        <EmptyState icon={MapPin} text="No MSISDNs found in this zone" />
      )}

      {!query && (
        <EmptyState icon={MapPin} text="Define a geographic bounding box to find all MSISDNs in the zone" subtext="Enter latitude/longitude bounds for the area of interest" />
      )}
    </div>
  );
}

/* ─── Tab 3: Pattern of Life ─── */
function PatternOfLifeTab() {
  const [msisdn, setMsisdn] = useState('');
  const [days, setDays] = useState(30);
  const [queryMsisdn, setQueryMsisdn] = useState(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['pattern-of-life', queryMsisdn, days],
    queryFn: () => advancedService.patternOfLife(queryMsisdn, days),
    enabled: Boolean(queryMsisdn),
  });

  const handleSearch = (e) => {
    e.preventDefault();
    if (msisdn.trim()) setQueryMsisdn(msisdn.trim());
  };

  const hourlyData = (data?.hourly_activity || data?.hourly || []).map((v, i) => ({
    hour: `${String(i).padStart(2, '0')}:00`,
    count: typeof v === 'number' ? v : v?.count ?? 0,
  }));

  const weeklyData = (data?.weekly_activity || data?.weekly || []).map((v, i) => {
    const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    return {
      day: typeof v === 'object' ? v?.day || dayNames[i] : dayNames[i],
      count: typeof v === 'number' ? v : v?.count ?? 0,
    };
  });

  const routes = data?.regular_routes || data?.routes || [];

  return (
    <div className="space-y-4">
      <form onSubmit={handleSearch} className="flex gap-3 items-end">
        <div className="flex-1 max-w-sm">
          <label className="block text-xs text-slate-500 mb-1">MSISDN</label>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input type="text" value={msisdn} onChange={(e) => setMsisdn(e.target.value)} placeholder="+919876543210"
              className="w-full bg-slate-800 border border-slate-600 text-slate-100 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        </div>
        <div className="w-24">
          <label className="block text-xs text-slate-500 mb-1">Days</label>
          <input type="number" value={days} onChange={(e) => setDays(Number(e.target.value))} min={1} max={365}
            className="w-full bg-slate-800 border border-slate-600 text-slate-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <button type="submit" className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors">
          Analyze
        </button>
      </form>

      {isLoading && <LoadingSpinner text="Analyzing pattern of life..." />}
      {error && <ErrorMessage message="Failed to load pattern of life" />}

      {data && !isLoading && (
        <div className="space-y-6">
          {/* Location cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {data.sleep_location && (
              <div className="bg-slate-800 rounded-lg border border-slate-700 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Moon size={14} className="text-indigo-400" />
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Sleep Location</span>
                </div>
                <p className="text-sm text-slate-200 font-mono">{data.sleep_location.tower_id || data.sleep_location.tower || '--'}</p>
                {data.sleep_location.address && <p className="text-xs text-slate-500 mt-1">{data.sleep_location.address}</p>}
                {data.sleep_location.confidence != null && (
                  <span className="text-xs text-indigo-400 mt-1 inline-block">Confidence: {(data.sleep_location.confidence * 100).toFixed(0)}%</span>
                )}
              </div>
            )}
            {data.work_location && (
              <div className="bg-slate-800 rounded-lg border border-slate-700 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Clock size={14} className="text-amber-400" />
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Work Location</span>
                </div>
                <p className="text-sm text-slate-200 font-mono">{data.work_location.tower_id || data.work_location.tower || '--'}</p>
                {data.work_location.address && <p className="text-xs text-slate-500 mt-1">{data.work_location.address}</p>}
                {data.work_location.confidence != null && (
                  <span className="text-xs text-amber-400 mt-1 inline-block">Confidence: {(data.work_location.confidence * 100).toFixed(0)}%</span>
                )}
              </div>
            )}
            {data.routine_score != null && (
              <div className="bg-slate-800 rounded-lg border border-slate-700 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <BarChart3 size={14} className="text-green-400" />
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Routine Score</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-2xl font-bold text-slate-100">{(data.routine_score * 100).toFixed(0)}%</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full border ${
                    data.routine_score >= 0.7 ? 'bg-green-500/20 text-green-400 border-green-500/30' :
                    data.routine_score >= 0.4 ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' :
                    'bg-red-500/20 text-red-400 border-red-500/30'
                  }`}>
                    {data.routine_score >= 0.7 ? 'Predictable' : data.routine_score >= 0.4 ? 'Moderate' : 'Irregular'}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Hourly activity chart */}
          {hourlyData.length > 0 && (
            <div className="bg-slate-800 rounded-lg border border-slate-700 p-4">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">Hourly Activity</h3>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={hourlyData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="hour" tick={{ fontSize: 10, fill: '#64748b' }} interval={2} />
                  <YAxis tick={{ fontSize: 10, fill: '#64748b' }} />
                  <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px', fontSize: '12px' }} />
                  <Bar dataKey="count" fill="#3b82f6" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Weekly activity chart */}
          {weeklyData.length > 0 && (
            <div className="bg-slate-800 rounded-lg border border-slate-700 p-4">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">Weekly Activity</h3>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={weeklyData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="day" tick={{ fontSize: 10, fill: '#64748b' }} />
                  <YAxis tick={{ fontSize: 10, fill: '#64748b' }} />
                  <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px', fontSize: '12px' }} />
                  <Bar dataKey="count" fill="#8b5cf6" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Regular routes */}
          {routes.length > 0 && (
            <div className="bg-slate-800 rounded-lg border border-slate-700 overflow-hidden">
              <div className="px-4 py-2 border-b border-slate-700 bg-slate-800/80">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Regular Routes ({routes.length})</span>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-800/50">
                    <th className="text-left px-4 py-2 text-xs font-medium text-slate-500 uppercase">From Tower</th>
                    <th className="text-left px-4 py-2 text-xs font-medium text-slate-500 uppercase">To Tower</th>
                    <th className="text-left px-4 py-2 text-xs font-medium text-slate-500 uppercase">Frequency</th>
                    <th className="text-left px-4 py-2 text-xs font-medium text-slate-500 uppercase">Typical Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/50">
                  {routes.map((r, i) => (
                    <tr key={i} className="hover:bg-slate-800/30 even:bg-slate-800/20">
                      <td className="px-4 py-2 text-slate-300 text-xs font-mono">{r.from_tower || r.from || '--'}</td>
                      <td className="px-4 py-2 text-slate-300 text-xs font-mono">{r.to_tower || r.to || '--'}</td>
                      <td className="px-4 py-2 text-slate-400 text-xs">{r.frequency ?? r.count ?? '--'}</td>
                      <td className="px-4 py-2 text-slate-500 text-xs">{r.typical_time || r.time || '--'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {!queryMsisdn && (
        <EmptyState icon={Clock} text="Enter an MSISDN to analyze behavioral patterns" subtext="Identifies sleep/work locations, routine activity, and regular routes" />
      )}
    </div>
  );
}

/* ─── Tab 4: Identity Changes ─── */
function IdentityChangesTab() {
  const [msisdn, setMsisdn] = useState('');
  const [queryMsisdn, setQueryMsisdn] = useState(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['identity-changes', queryMsisdn],
    queryFn: () => advancedService.identityChanges(queryMsisdn),
    enabled: Boolean(queryMsisdn),
  });

  const handleSearch = (e) => {
    e.preventDefault();
    if (msisdn.trim()) setQueryMsisdn(msisdn.trim());
  };

  const riskColors = {
    high: 'bg-red-500/20 text-red-400 border-red-500/30',
    medium: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    low: 'bg-green-500/20 text-green-400 border-green-500/30',
  };

  const changes = data?.changes || data?.events || [];
  const riskLevel = data?.risk_level || data?.risk || null;

  return (
    <div className="space-y-4">
      <form onSubmit={handleSearch} className="flex gap-3 max-w-lg">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input type="text" value={msisdn} onChange={(e) => setMsisdn(e.target.value)} placeholder="Enter MSISDN"
            className="w-full bg-slate-800 border border-slate-600 text-slate-100 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <button type="submit" className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors">
          Check
        </button>
      </form>

      {isLoading && <LoadingSpinner text="Checking identity changes..." />}
      {error && <ErrorMessage message="Failed to check identity changes" />}

      {data && !isLoading && (
        <div className="space-y-4">
          {/* Risk badge */}
          {riskLevel && (
            <div className="flex items-center gap-3">
              <AlertTriangle size={16} className={riskLevel === 'high' ? 'text-red-400' : riskLevel === 'medium' ? 'text-yellow-400' : 'text-green-400'} />
              <span className={`rounded-full px-3 py-1 text-xs font-medium border ${riskColors[riskLevel] || riskColors.low}`}>
                Risk: {riskLevel.toUpperCase()}
              </span>
              {data.summary && <span className="text-sm text-slate-400">{data.summary}</span>}
            </div>
          )}

          {/* Stats cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {data.unique_imeis != null && (
              <StatCard label="Unique IMEIs" value={data.unique_imeis} icon={Phone} color={data.unique_imeis > 2 ? 'red' : 'blue'} />
            )}
            {data.unique_sims != null && (
              <StatCard label="Unique SIMs" value={data.unique_sims} icon={Shield} color={data.unique_sims > 2 ? 'red' : 'blue'} />
            )}
            {data.total_changes != null && (
              <StatCard label="Total Changes" value={data.total_changes} icon={AlertTriangle} color="amber" />
            )}
          </div>

          {/* Changes list */}
          {changes.length > 0 && (
            <div className="bg-slate-800 rounded-lg border border-slate-700 overflow-hidden">
              <div className="px-4 py-2 border-b border-slate-700 bg-slate-800/80">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Change History ({changes.length})</span>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-800/50">
                    <th className="text-left px-4 py-2 text-xs font-medium text-slate-500 uppercase">Type</th>
                    <th className="text-left px-4 py-2 text-xs font-medium text-slate-500 uppercase">Old Value</th>
                    <th className="text-left px-4 py-2 text-xs font-medium text-slate-500 uppercase">New Value</th>
                    <th className="text-left px-4 py-2 text-xs font-medium text-slate-500 uppercase">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/50">
                  {changes.map((c, i) => (
                    <tr key={i} className="hover:bg-slate-800/30 even:bg-slate-800/20">
                      <td className="px-4 py-2 text-slate-300 text-xs font-medium">{c.change_type || c.type || '--'}</td>
                      <td className="px-4 py-2 font-mono text-slate-400 text-xs">{c.old_value || c.old || '--'}</td>
                      <td className="px-4 py-2 font-mono text-slate-300 text-xs">{c.new_value || c.new || '--'}</td>
                      <td className="px-4 py-2 text-slate-500 text-xs">
                        {c.detected_at || c.date ? format(new Date(c.detected_at || c.date), 'MMM d, yyyy HH:mm') : '--'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {!queryMsisdn && (
        <EmptyState icon={Shield} text="Enter an MSISDN to detect IMEI/SIM changes" subtext="Identifies device swaps and SIM changes with risk assessment" />
      )}
    </div>
  );
}

/* ─── Tab 5: Common Numbers ─── */
function CommonNumbersTab() {
  const [msisdns, setMsisdns] = useState(['', '']);
  const [query, setQuery] = useState(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['common-numbers', query],
    queryFn: () => advancedService.commonNumbers(query),
    enabled: Boolean(query),
  });

  const addField = () => setMsisdns([...msisdns, '']);
  const removeField = (idx) => {
    if (msisdns.length <= 2) return;
    setMsisdns(msisdns.filter((_, i) => i !== idx));
  };
  const updateField = (idx, val) => {
    const copy = [...msisdns];
    copy[idx] = val;
    setMsisdns(copy);
  };

  const handleSearch = (e) => {
    e.preventDefault();
    const valid = msisdns.map((m) => m.trim()).filter(Boolean);
    if (valid.length >= 2) setQuery(valid);
  };

  const results = data?.common_numbers || data?.common || data?.results || [];
  const items = Array.isArray(results) ? results : [];

  return (
    <div className="space-y-4">
      <form onSubmit={handleSearch} className="space-y-3">
        {msisdns.map((m, i) => (
          <div key={i} className="flex gap-2 items-center max-w-md">
            <input type="text" value={m} onChange={(e) => updateField(i, e.target.value)}
              placeholder={`MSISDN ${i + 1}`}
              className="flex-1 bg-slate-800 border border-slate-600 text-slate-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            {msisdns.length > 2 && (
              <button type="button" onClick={() => removeField(i)} className="p-2 text-slate-500 hover:text-red-400 transition-colors">
                <Minus size={14} />
              </button>
            )}
          </div>
        ))}
        <div className="flex gap-3">
          <button type="button" onClick={addField} className="flex items-center gap-1 px-3 py-2 text-xs rounded-lg border border-slate-600 text-slate-400 hover:text-slate-200 hover:border-slate-500 transition-colors">
            <Plus size={12} /> Add MSISDN
          </button>
          <button type="submit" className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors">
            Find Common
          </button>
        </div>
      </form>

      {isLoading && <LoadingSpinner text="Finding common numbers..." />}
      {error && <ErrorMessage message="Failed to find common numbers" />}

      {query && !isLoading && items.length > 0 && (
        <div className="bg-slate-800 rounded-lg border border-slate-700 overflow-hidden">
          <div className="px-4 py-2 border-b border-slate-700 bg-slate-800/80">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Common Numbers ({items.length})</span>
          </div>
          <div className="overflow-auto max-h-[60vh]">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-800/90">
                <tr>
                  <th className="text-left px-4 py-2 text-xs font-medium text-slate-500 uppercase">Contact</th>
                  {query.map((m, i) => (
                    <th key={i} className="text-left px-4 py-2 text-xs font-medium text-slate-500 uppercase">Calls w/ {m.slice(-4)}</th>
                  ))}
                  <th className="text-left px-4 py-2 text-xs font-medium text-slate-500 uppercase">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {items.map((r, i) => (
                  <tr key={i} className="hover:bg-slate-800/30 even:bg-slate-800/20">
                    <td className="px-4 py-2 font-mono text-slate-300 text-xs">{r.msisdn || r.number || '--'}</td>
                    {query.map((_, j) => (
                      <td key={j} className="px-4 py-2 text-slate-400 text-xs">
                        {r.counts?.[j] ?? r[`calls_${j}`] ?? r.call_counts?.[j] ?? '--'}
                      </td>
                    ))}
                    <td className="px-4 py-2 text-slate-300 text-xs font-medium">{r.total_calls ?? r.total ?? '--'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {query && !isLoading && items.length === 0 && (
        <EmptyState icon={Users} text="No common numbers found between the provided MSISDNs" />
      )}

      {!query && (
        <EmptyState icon={Users} text="Enter multiple MSISDNs to find numbers they all contacted" subtext="Minimum 2 MSISDNs required" />
      )}
    </div>
  );
}

/* ─── Tab 6: Call Chain ─── */
function CallChainTab() {
  const [source, setSource] = useState('');
  const [target, setTarget] = useState('');
  const [maxHops, setMaxHops] = useState(4);
  const [query, setQuery] = useState(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['call-chain', query?.source, query?.target, query?.maxHops],
    queryFn: () => advancedService.callChain(query.source, query.target, query.maxHops),
    enabled: Boolean(query),
  });

  const handleSearch = (e) => {
    e.preventDefault();
    if (source.trim() && target.trim()) {
      setQuery({ source: source.trim(), target: target.trim(), maxHops });
    }
  };

  const chain = data?.chain || data?.path || [];
  const hops = data?.hops ?? chain.length - 1;

  return (
    <div className="space-y-4">
      <form onSubmit={handleSearch} className="flex gap-3 items-end flex-wrap">
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs text-slate-500 mb-1">Source MSISDN</label>
          <input type="text" value={source} onChange={(e) => setSource(e.target.value)} placeholder="+919876543210"
            className="w-full bg-slate-800 border border-slate-600 text-slate-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs text-slate-500 mb-1">Target MSISDN</label>
          <input type="text" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="+919123456789"
            className="w-full bg-slate-800 border border-slate-600 text-slate-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div className="w-28">
          <label className="block text-xs text-slate-500 mb-1">Max Hops</label>
          <input type="number" value={maxHops} onChange={(e) => setMaxHops(Number(e.target.value))} min={1} max={10}
            className="w-full bg-slate-800 border border-slate-600 text-slate-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <button type="submit" className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors">
          Trace
        </button>
      </form>

      {isLoading && <LoadingSpinner text="Tracing call chain..." />}
      {error && <ErrorMessage message="Failed to trace call chain" />}

      {query && !isLoading && chain.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm text-slate-400">
            <GitBranch size={14} className="text-blue-400" />
            <span>Chain found: {hops} hop{hops !== 1 ? 's' : ''}</span>
          </div>

          {/* Visual chain */}
          <div className="bg-slate-800 rounded-lg border border-slate-700 p-6 overflow-x-auto">
            <div className="flex items-center gap-2 min-w-max">
              {chain.map((node, i) => (
                <div key={i} className="flex items-center gap-2">
                  <div className={`rounded-lg px-4 py-3 border ${
                    i === 0 ? 'bg-blue-500/20 border-blue-500/30' :
                    i === chain.length - 1 ? 'bg-green-500/20 border-green-500/30' :
                    'bg-slate-700/50 border-slate-600'
                  }`}>
                    <p className="font-mono text-xs text-slate-200">{node.msisdn || node.number || node}</p>
                    {node.call_count != null && (
                      <p className="text-[10px] text-slate-500 mt-1">{node.call_count} calls</p>
                    )}
                    {node.last_call && (
                      <p className="text-[10px] text-slate-600 mt-0.5">{format(new Date(node.last_call), 'MMM d')}</p>
                    )}
                  </div>
                  {i < chain.length - 1 && (
                    <div className="flex items-center text-slate-600">
                      <div className="w-8 h-px bg-slate-600" />
                      <ChevronDown size={12} className="rotate-[-90deg]" />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {query && !isLoading && chain.length === 0 && (
        <EmptyState icon={GitBranch} text={`No call chain found between ${query.source} and ${query.target} within ${query.maxHops} hops`} />
      )}

      {!query && (
        <EmptyState icon={GitBranch} text="Enter source and target MSISDNs to trace the call chain" subtext="Finds the shortest path of calls connecting two numbers" />
      )}
    </div>
  );
}

/* ─── Tab 7: Night Activity ─── */
function NightActivityTab() {
  const [msisdn, setMsisdn] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [queryMsisdn, setQueryMsisdn] = useState(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['night-activity', queryMsisdn, from, to],
    queryFn: () => advancedService.nightActivity(queryMsisdn, from || undefined, to || undefined),
    enabled: Boolean(queryMsisdn),
  });

  const handleSearch = (e) => {
    e.preventDefault();
    if (msisdn.trim()) setQueryMsisdn(msisdn.trim());
  };

  const records = data?.records || data?.activities || data?.results || [];
  const items = Array.isArray(records) ? records : [];

  return (
    <div className="space-y-4">
      <form onSubmit={handleSearch} className="flex gap-3 items-end flex-wrap">
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs text-slate-500 mb-1">MSISDN</label>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input type="text" value={msisdn} onChange={(e) => setMsisdn(e.target.value)} placeholder="+919876543210"
              className="w-full bg-slate-800 border border-slate-600 text-slate-100 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        </div>
        <div className="w-44">
          <label className="block text-xs text-slate-500 mb-1">From</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            className="w-full bg-slate-800 border border-slate-600 text-slate-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div className="w-44">
          <label className="block text-xs text-slate-500 mb-1">To</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
            className="w-full bg-slate-800 border border-slate-600 text-slate-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <button type="submit" className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors">
          Search
        </button>
      </form>

      {isLoading && <LoadingSpinner text="Loading night activity..." />}
      {error && <ErrorMessage message="Failed to load night activity" />}

      {queryMsisdn && !isLoading && items.length > 0 && (
        <div className="bg-slate-800 rounded-lg border border-slate-700 overflow-hidden">
          <div className="px-4 py-2 border-b border-slate-700 bg-slate-800/80">
            <div className="flex items-center gap-2">
              <Moon size={14} className="text-indigo-400" />
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Night Activity ({items.length} records)
              </span>
            </div>
          </div>
          <div className="overflow-auto max-h-[60vh]">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-800/90">
                <tr>
                  <th className="text-left px-4 py-2 text-xs font-medium text-slate-500 uppercase">Time</th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-slate-500 uppercase">Type</th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-slate-500 uppercase">Other Party</th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-slate-500 uppercase">Duration</th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-slate-500 uppercase">Tower</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {items.map((r, i) => {
                  const time = r.timestamp || r.time || r.datetime;
                  const hour = time ? new Date(time).getHours() : null;
                  const isLateNight = hour != null && (hour >= 0 && hour < 5);
                  return (
                    <tr key={i} className={`hover:bg-slate-800/30 ${isLateNight ? 'bg-indigo-500/5' : 'even:bg-slate-800/20'}`}>
                      <td className={`px-4 py-2 font-mono text-xs ${isLateNight ? 'text-indigo-300' : 'text-slate-400'}`}>
                        {time ? format(new Date(time), 'MMM d, HH:mm:ss') : '--'}
                      </td>
                      <td className="px-4 py-2 text-slate-300 text-xs">{r.type || r.event_type || '--'}</td>
                      <td className="px-4 py-2 font-mono text-slate-400 text-xs">{r.other_party || r.other_msisdn || r.contact || '--'}</td>
                      <td className="px-4 py-2 text-slate-400 text-xs">{r.duration != null ? `${r.duration}s` : '--'}</td>
                      <td className="px-4 py-2 text-slate-500 text-xs">{r.tower_id || r.tower || '--'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {queryMsisdn && !isLoading && items.length === 0 && (
        <EmptyState icon={Moon} text="No night activity found for this MSISDN" />
      )}

      {!queryMsisdn && (
        <EmptyState icon={Moon} text="Enter an MSISDN to view night-time communication activity" subtext="Highlights calls and messages during late-night hours" />
      )}
    </div>
  );
}

/* ─── Tab 8: Top Contacts ─── */
function TopContactsTab() {
  const [msisdn, setMsisdn] = useState('');
  const [limit, setLimit] = useState('');
  const [queryMsisdn, setQueryMsisdn] = useState(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['top-contacts', queryMsisdn, limit],
    queryFn: () => advancedService.topContacts(queryMsisdn, limit ? parseInt(limit) : undefined),
    enabled: Boolean(queryMsisdn),
  });

  const handleSearch = (e) => {
    e.preventDefault();
    if (msisdn.trim()) setQueryMsisdn(msisdn.trim());
  };

  const contacts = data?.contacts || data?.top_contacts || data?.results || [];
  const heatmap = data?.hourly_heatmap || data?.heatmap || null;

  return (
    <div className="space-y-4">
      <form onSubmit={handleSearch} className="flex gap-3 items-end">
        <div className="flex-1 max-w-sm">
          <label className="block text-xs text-slate-500 mb-1">MSISDN</label>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input type="text" value={msisdn} onChange={(e) => setMsisdn(e.target.value)} placeholder="+919876543210"
              className="w-full bg-slate-800 border border-slate-600 text-slate-100 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        </div>
        <div className="w-24">
          <label className="block text-xs text-slate-500 mb-1">Limit</label>
          <input type="number" value={limit} onChange={(e) => setLimit(e.target.value)} placeholder="10" min={1}
            className="w-full bg-slate-800 border border-slate-600 text-slate-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <button type="submit" className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors">
          Search
        </button>
      </form>

      {isLoading && <LoadingSpinner text="Loading top contacts..." />}
      {error && <ErrorMessage message="Failed to load top contacts" />}

      {queryMsisdn && !isLoading && (Array.isArray(contacts) ? contacts : []).length > 0 && (
        <div className="space-y-4">
          <div className="bg-slate-800 rounded-lg border border-slate-700 overflow-hidden">
            <div className="px-4 py-2 border-b border-slate-700 bg-slate-800/80">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Top Contacts ({contacts.length})
              </span>
            </div>
            <div className="overflow-auto max-h-[40vh]">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-slate-800/90">
                  <tr>
                    <th className="text-left px-4 py-2 text-xs font-medium text-slate-500 uppercase">#</th>
                    <th className="text-left px-4 py-2 text-xs font-medium text-slate-500 uppercase">Contact</th>
                    <th className="text-left px-4 py-2 text-xs font-medium text-slate-500 uppercase">Calls</th>
                    <th className="text-left px-4 py-2 text-xs font-medium text-slate-500 uppercase">Messages</th>
                    <th className="text-left px-4 py-2 text-xs font-medium text-slate-500 uppercase">Total Duration</th>
                    <th className="text-left px-4 py-2 text-xs font-medium text-slate-500 uppercase">Last Contact</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/50">
                  {contacts.map((c, i) => (
                    <tr key={i} className="hover:bg-slate-800/30 even:bg-slate-800/20">
                      <td className="px-4 py-2 text-slate-600 text-xs">{i + 1}</td>
                      <td className="px-4 py-2 font-mono text-slate-300 text-xs">{c.msisdn || c.contact || '--'}</td>
                      <td className="px-4 py-2 text-slate-400 text-xs">{c.call_count ?? c.calls ?? '--'}</td>
                      <td className="px-4 py-2 text-slate-400 text-xs">{c.message_count ?? c.messages ?? '--'}</td>
                      <td className="px-4 py-2 text-slate-400 text-xs">{c.total_duration != null ? `${c.total_duration}s` : '--'}</td>
                      <td className="px-4 py-2 text-slate-500 text-xs">
                        {c.last_contact ? format(new Date(c.last_contact), 'MMM d, HH:mm') : '--'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Hourly heatmap grid */}
          {heatmap && Array.isArray(heatmap) && heatmap.length > 0 && (
            <div className="bg-slate-800 rounded-lg border border-slate-700 p-4">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Hourly Communication Heatmap</h3>
              <div className="overflow-x-auto">
                <div className="flex gap-1 min-w-max">
                  {heatmap.map((val, hour) => {
                    const intensity = typeof val === 'number' ? val : val?.count ?? 0;
                    const max = Math.max(...heatmap.map((v) => (typeof v === 'number' ? v : v?.count ?? 0)), 1);
                    const opacity = intensity / max;
                    return (
                      <div key={hour} className="flex flex-col items-center gap-1">
                        <div
                          className="w-8 h-8 rounded"
                          style={{ backgroundColor: `rgba(59, 130, 246, ${Math.max(0.05, opacity)})` }}
                          title={`${String(hour).padStart(2, '0')}:00 - ${intensity} events`}
                        />
                        <span className="text-[9px] text-slate-600">{String(hour).padStart(2, '0')}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {queryMsisdn && !isLoading && (Array.isArray(contacts) ? contacts : []).length === 0 && (
        <EmptyState icon={Star} text="No top contacts found for this MSISDN" />
      )}

      {!queryMsisdn && (
        <EmptyState icon={Star} text="Enter an MSISDN to view its most frequent contacts" subtext="Shows call/message frequency and optional hourly heatmap" />
      )}
    </div>
  );
}

/* ─── Tab 9: Report Generator ─── */
function ReportTab() {
  const [msisdn, setMsisdn] = useState('');
  const [copied, setCopied] = useState(false);
  const [expandedSections, setExpandedSections] = useState({});

  const { mutate, data, isPending, error } = useMutation({
    mutationFn: (m) => advancedService.generateReport(m),
  });

  const handleGenerate = (e) => {
    e.preventDefault();
    if (msisdn.trim()) mutate(msisdn.trim());
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(JSON.stringify(data, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const toggleSection = (key) => {
    setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const renderReportSections = (obj) => {
    if (!obj || typeof obj !== 'object') return null;
    return Object.entries(obj).map(([key, value]) => {
      const isExpandable = typeof value === 'object' && value !== null;
      const isExpanded = expandedSections[key];
      return (
        <div key={key} className="border border-slate-700 rounded-lg overflow-hidden">
          <button
            onClick={() => isExpandable && toggleSection(key)}
            className={`w-full flex items-center justify-between px-4 py-3 text-left text-sm ${
              isExpandable ? 'hover:bg-slate-700/50 cursor-pointer' : 'cursor-default'
            } bg-slate-800/80`}
          >
            <span className="font-medium text-slate-300">{key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}</span>
            {isExpandable ? (
              <ChevronDown size={14} className={`text-slate-500 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
            ) : (
              <span className="text-slate-400 font-mono text-xs">{String(value)}</span>
            )}
          </button>
          {isExpandable && isExpanded && (
            <div className="px-4 py-3 bg-slate-900/50 border-t border-slate-700">
              <pre className="text-xs text-slate-400 font-mono whitespace-pre-wrap overflow-auto max-h-60">
                {JSON.stringify(value, null, 2)}
              </pre>
            </div>
          )}
        </div>
      );
    });
  };

  return (
    <div className="space-y-4">
      <form onSubmit={handleGenerate} className="flex gap-3 max-w-lg">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input type="text" value={msisdn} onChange={(e) => setMsisdn(e.target.value)} placeholder="Enter MSISDN"
            className="w-full bg-slate-800 border border-slate-600 text-slate-100 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <button type="submit" disabled={isPending}
          className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-50">
          {isPending ? 'Generating...' : 'Generate Report'}
        </button>
      </form>

      {isPending && <LoadingSpinner text="Generating comprehensive report..." />}
      {error && <ErrorMessage message="Failed to generate report" />}

      {data && !isPending && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-400">Report generated</span>
            <button onClick={handleCopy}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-slate-600 text-slate-400 hover:text-slate-200 hover:border-slate-500 transition-colors">
              {copied ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
              {copied ? 'Copied' : 'Copy JSON'}
            </button>
          </div>
          <div className="space-y-2">
            {renderReportSections(data)}
          </div>
        </div>
      )}

      {!data && !isPending && (
        <EmptyState icon={FileText} text="Enter an MSISDN and click Generate to create a full investigation dossier" subtext="Report includes all available intelligence in structured format" />
      )}
    </div>
  );
}

/* ─── Tab 10: Activity Stats ─── */
function ActivityStatsTab() {
  const [msisdn, setMsisdn] = useState('');
  const [queryMsisdn, setQueryMsisdn] = useState(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['activity-stats', queryMsisdn],
    queryFn: () => advancedService.activityStats(queryMsisdn),
    enabled: Boolean(queryMsisdn),
  });

  const handleSearch = (e) => {
    e.preventDefault();
    if (msisdn.trim()) setQueryMsisdn(msisdn.trim());
  };

  return (
    <div className="space-y-4">
      <form onSubmit={handleSearch} className="flex gap-3 max-w-lg">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input type="text" value={msisdn} onChange={(e) => setMsisdn(e.target.value)} placeholder="Enter MSISDN"
            className="w-full bg-slate-800 border border-slate-600 text-slate-100 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <button type="submit" className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors">
          Get Stats
        </button>
      </form>

      {isLoading && <LoadingSpinner text="Loading activity stats..." />}
      {error && <ErrorMessage message="Failed to load activity stats" />}

      {data && !isLoading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <StatCard label="Total Calls" value={data.total_calls ?? data.calls} icon={Phone} color="blue" />
          <StatCard label="Total Messages" value={data.total_messages ?? data.messages} icon={MessageSquare} color="green" />
          <StatCard label="Unique Contacts" value={data.unique_contacts} icon={Users} color="purple" />
          <StatCard label="Active Days" value={data.active_days} icon={Clock} color="amber" />
          <StatCard label="Avg Daily Activity" value={data.avg_daily != null ? data.avg_daily.toFixed(1) : data.average_daily} icon={BarChart3} color="slate" />
          <StatCard label="Most Active Hour" value={data.most_active_hour != null ? `${String(data.most_active_hour).padStart(2, '0')}:00` : data.peak_hour} icon={Clock} color="blue" />
          <StatCard label="Most Active Day" value={data.most_active_day ?? data.peak_day} icon={Star} color="green" />
          {data.first_activity && (
            <StatCard label="First Activity" value={format(new Date(data.first_activity), 'MMM d, yyyy')} icon={Clock} color="slate" />
          )}
          {data.last_activity && (
            <StatCard label="Last Activity" value={format(new Date(data.last_activity), 'MMM d, yyyy')} icon={Clock} color="slate" />
          )}
        </div>
      )}

      {!queryMsisdn && (
        <EmptyState icon={BarChart3} text="Enter an MSISDN to view activity statistics" subtext="Shows call/message totals, active days, and peak activity periods" />
      )}
    </div>
  );
}

/* ─── Main Page Component ─── */
export default function AdvancedAnalytics() {
  const [activeTab, setActiveTab] = useState('tower-dump');

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-100">Investigation Tools</h1>
        <p className="text-sm text-slate-500 mt-1">Advanced analysis features for telecom investigations</p>
      </div>

      {/* Tabs - scrollable */}
      <div className="border-b border-slate-700">
        <div className="flex gap-0 overflow-x-auto scrollbar-hide">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-5 py-3 text-sm font-medium transition-colors border-b-2 whitespace-nowrap shrink-0 ${
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
      {activeTab === 'tower-dump' && <TowerDumpTab />}
      {activeTab === 'geofence' && <GeofenceTab />}
      {activeTab === 'pattern-of-life' && <PatternOfLifeTab />}
      {activeTab === 'identity' && <IdentityChangesTab />}
      {activeTab === 'common' && <CommonNumbersTab />}
      {activeTab === 'call-chain' && <CallChainTab />}
      {activeTab === 'night' && <NightActivityTab />}
      {activeTab === 'top-contacts' && <TopContactsTab />}
      {activeTab === 'report' && <ReportTab />}
      {activeTab === 'stats' && <ActivityStatsTab />}
    </div>
  );
}
