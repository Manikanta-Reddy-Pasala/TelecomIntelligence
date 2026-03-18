import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Crosshair, Radio, Signal, History, BookOpen,
  Search, MapPin, CheckCircle, XCircle, Clock,
  ChevronRight, Play, AlertTriangle, TrendingUp,
  Wifi, Target, Radar, Activity,
} from 'lucide-react';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorMessage from '../components/ErrorMessage';
import { opIntelService } from '../services/opIntel';

const TABS = [
  { id: 'recommendations', label: 'Cell Recommendations', icon: Radio },
  { id: 'location', label: 'Precision Location', icon: MapPin },
  { id: 'rf-coverage', label: 'RF Coverage', icon: Wifi },
  { id: 'captures', label: 'Capture History', icon: History },
  { id: 'playbooks', label: 'Playbooks', icon: BookOpen },
];

// ---------------------------------------------------------------------------
// Dashboard Summary (shown at top)
// ---------------------------------------------------------------------------
function DashboardSummary() {
  const { data, isLoading } = useQuery({
    queryKey: ['ops-dashboard'],
    queryFn: () => opIntelService.getDashboard(),
  });

  if (isLoading) return null;
  if (!data) return null;

  const stats = [
    { label: 'Total Captures', value: data.total_captures, icon: Target, color: 'blue' },
    { label: 'Success Rate', value: `${(data.success_rate * 100).toFixed(0)}%`, icon: TrendingUp, color: 'emerald' },
    { label: 'Active Playbooks', value: data.active_playbooks, icon: Play, color: 'amber' },
    { label: 'RF Profiles', value: data.rf_profiles_count, icon: Signal, color: 'purple' },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      {stats.map((s) => (
        <div key={s.label} className="card p-4">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl bg-${s.color}-500/15 flex items-center justify-center`}>
              <s.icon size={18} className={`text-${s.color}-400`} />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-100">{s.value}</p>
              <p className="text-xs text-slate-500">{s.label}</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 1: Cell Recommendations
// ---------------------------------------------------------------------------
function CellRecommendations() {
  const [msisdn, setMsisdn] = useState('');
  const [searchMsisdn, setSearchMsisdn] = useState('');
  const [days, setDays] = useState(90);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['cell-recommendations', searchMsisdn, days],
    queryFn: () => opIntelService.getRecommendations(searchMsisdn, days),
    enabled: !!searchMsisdn,
  });

  const handleSearch = (e) => {
    e.preventDefault();
    if (msisdn.trim()) setSearchMsisdn(msisdn.trim());
  };

  return (
    <div className="space-y-4">
      <form onSubmit={handleSearch} className="flex gap-3">
        <input
          type="text"
          value={msisdn}
          onChange={(e) => setMsisdn(e.target.value)}
          placeholder="Enter MSISDN (e.g. +919...)"
          className="input-field flex-1"
        />
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="input-field w-32">
          <option value={30}>30 days</option>
          <option value={60}>60 days</option>
          <option value={90}>90 days</option>
          <option value={180}>180 days</option>
        </select>
        <button type="submit" className="btn-primary px-6">
          <Search size={16} className="mr-2" />Analyze
        </button>
      </form>

      {isLoading && <LoadingSpinner text="Analyzing tower patterns..." />}
      {error && <ErrorMessage message="Failed to load recommendations" onRetry={refetch} />}

      {data && (
        <>
          <div className="flex items-center gap-4 text-sm text-slate-400">
            <span>{data.total_towers_analyzed} towers analyzed</span>
            <span>|</span>
            <span>{data.analysis_period_days} day window</span>
          </div>

          {/* Time of day heatmap */}
          {data.time_of_day_heatmap && Object.keys(data.time_of_day_heatmap).length > 0 && (
            <div className="card p-4">
              <h4 className="text-sm font-semibold text-slate-300 mb-3">Activity by Hour</h4>
              <div className="flex gap-0.5">
                {Array.from({ length: 24 }, (_, h) => {
                  const count = data.time_of_day_heatmap[h] || 0;
                  const maxCount = Math.max(...Object.values(data.time_of_day_heatmap), 1);
                  const intensity = count / maxCount;
                  return (
                    <div key={h} className="flex-1 flex flex-col items-center gap-1">
                      <div
                        className="w-full rounded-sm"
                        style={{
                          height: '32px',
                          backgroundColor: `rgba(59, 130, 246, ${0.1 + intensity * 0.9})`,
                        }}
                        title={`${h}:00 — ${count} events`}
                      />
                      {h % 4 === 0 && <span className="text-[9px] text-slate-600">{h}h</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Ranked towers */}
          <div className="space-y-2">
            {data.recommendations?.map((rec, idx) => (
              <div key={rec.tower_id} className="card p-4 flex items-center gap-4">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold ${
                  idx < 3 ? 'bg-blue-500/20 text-blue-400' : 'bg-slate-800 text-slate-400'
                }`}>
                  {idx + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-slate-200">{rec.tower_id}</span>
                    <span className="text-xs text-slate-500">{rec.address}</span>
                  </div>
                  <div className="flex gap-3 mt-1 text-xs text-slate-500">
                    <span>{rec.visit_count} visits</span>
                    {rec.last_seen && (
                      <span>Last: {new Date(rec.last_seen).toLocaleDateString()}</span>
                    )}
                    {rec.recommended_times?.length > 0 && (
                      <span className="text-blue-400">Best: {rec.recommended_times[0]}</span>
                    )}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-lg font-bold text-slate-200">
                    {(rec.total_score * 100).toFixed(0)}
                  </div>
                  <div className="text-[10px] text-slate-500 uppercase">Score</div>
                </div>
                {/* Score breakdown */}
                <div className="hidden lg:flex gap-1">
                  {[
                    { label: 'Use', val: rec.usage_score, color: 'bg-blue-500' },
                    { label: 'Rec', val: rec.recency_score, color: 'bg-emerald-500' },
                    { label: 'Time', val: rec.time_consistency_score, color: 'bg-amber-500' },
                    { label: 'Cap', val: rec.capture_success_score, color: 'bg-purple-500' },
                    { label: 'RF', val: rec.rf_suitability_score, color: 'bg-cyan-500' },
                  ].map((b) => (
                    <div key={b.label} className="w-10 text-center" title={`${b.label}: ${(b.val * 100).toFixed(0)}%`}>
                      <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
                        <div className={`h-full ${b.color} rounded-full`} style={{ width: `${b.val * 100}%` }} />
                      </div>
                      <span className="text-[8px] text-slate-600">{b.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {data.recommendations?.length === 0 && (
              <div className="card p-8 text-center text-slate-500">
                No tower data found for this MSISDN
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 2: Precision Location
// ---------------------------------------------------------------------------
function PrecisionLocation() {
  const [msisdn, setMsisdn] = useState('');
  const [searchMsisdn, setSearchMsisdn] = useState('');
  const [hours, setHours] = useState(24);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['locate', searchMsisdn, hours],
    queryFn: () => opIntelService.locate(searchMsisdn, hours),
    enabled: !!searchMsisdn,
  });

  const { data: validation } = useQuery({
    queryKey: ['ta-validate', searchMsisdn, hours],
    queryFn: () => opIntelService.validateTA(searchMsisdn, hours),
    enabled: !!searchMsisdn,
  });

  const handleSearch = (e) => {
    e.preventDefault();
    if (msisdn.trim()) setSearchMsisdn(msisdn.trim());
  };

  return (
    <div className="space-y-4">
      <form onSubmit={handleSearch} className="flex gap-3">
        <input
          type="text"
          value={msisdn}
          onChange={(e) => setMsisdn(e.target.value)}
          placeholder="Enter MSISDN"
          className="input-field flex-1"
        />
        <select value={hours} onChange={(e) => setHours(Number(e.target.value))} className="input-field w-32">
          <option value={6}>6 hours</option>
          <option value={12}>12 hours</option>
          <option value={24}>24 hours</option>
          <option value={48}>48 hours</option>
          <option value={168}>7 days</option>
        </select>
        <button type="submit" className="btn-primary px-6">
          <Crosshair size={16} className="mr-2" />Locate
        </button>
      </form>

      {isLoading && <LoadingSpinner text="Triangulating position..." />}
      {error && <ErrorMessage message="Location failed" onRetry={refetch} />}

      {data && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Location result */}
          <div className="card p-5">
            <h4 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
              <MapPin size={16} className="text-blue-400" />
              Estimated Position
            </h4>
            {data.location ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-[10px] text-slate-500 uppercase">Latitude</p>
                    <p className="text-lg font-mono text-slate-200">{data.location.latitude}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-slate-500 uppercase">Longitude</p>
                    <p className="text-lg font-mono text-slate-200">{data.location.longitude}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-slate-500 uppercase">Accuracy</p>
                    <p className="text-lg font-mono text-slate-200">{data.location.accuracy_m?.toFixed(0)}m</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-slate-500 uppercase">Method</p>
                    <p className="text-sm text-slate-200">{data.location.method?.replace(/_/g, ' ')}</p>
                  </div>
                </div>
                <div className="pt-2 border-t border-slate-800/50">
                  <p className="text-xs text-slate-400">{data.message}</p>
                </div>
              </div>
            ) : (
              <p className="text-slate-500">{data.message}</p>
            )}
          </div>

          {/* TA readings */}
          <div className="card p-5">
            <h4 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
              <Signal size={16} className="text-emerald-400" />
              TA Readings ({data.ta_readings?.length || 0})
            </h4>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {data.ta_readings?.map((r, i) => (
                <div key={i} className="flex items-center justify-between text-sm p-2 rounded-lg bg-slate-800/40">
                  <div>
                    <span className="text-slate-300 font-mono text-xs">{r.tower_id}</span>
                    <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-400">{r.technology}</span>
                  </div>
                  <div className="text-right">
                    <span className="text-slate-300">TA={r.ta_value}</span>
                    <span className="text-slate-500 ml-2">{r.adjusted_distance_m?.toFixed(0)}m</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Validation summary */}
          {validation && (
            <div className="card p-5 lg:col-span-2">
              <h4 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
                <AlertTriangle size={16} className="text-amber-400" />
                TA Validation — {validation.valid_count} valid, {validation.invalid_count} invalid
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {validation.validations?.map((v, i) => (
                  <div key={i} className={`flex items-center gap-2 p-2 rounded-lg text-sm ${
                    v.is_valid ? 'bg-emerald-500/10 border border-emerald-500/20' : 'bg-red-500/10 border border-red-500/20'
                  }`}>
                    {v.is_valid ? <CheckCircle size={14} className="text-emerald-400" /> : <XCircle size={14} className="text-red-400" />}
                    <span className="text-slate-300 font-mono text-xs">{v.tower_id}</span>
                    <span className="text-slate-500 text-xs ml-auto">{v.reason}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 3: RF Coverage
// ---------------------------------------------------------------------------
function RFCoverage() {
  const [towerId, setTowerId] = useState('');
  const [searchTower, setSearchTower] = useState('');

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['rf-model', searchTower],
    queryFn: () => opIntelService.getRFModel(searchTower),
    enabled: !!searchTower,
  });

  const handleSearch = (e) => {
    e.preventDefault();
    if (towerId.trim()) setSearchTower(towerId.trim());
  };

  return (
    <div className="space-y-4">
      <form onSubmit={handleSearch} className="flex gap-3">
        <input
          type="text"
          value={towerId}
          onChange={(e) => setTowerId(e.target.value)}
          placeholder="Enter Tower ID (e.g. MUM-COL-000-00)"
          className="input-field flex-1"
        />
        <button type="submit" className="btn-primary px-6">
          <Radar size={16} className="mr-2" />Analyze RF
        </button>
      </form>

      {isLoading && <LoadingSpinner text="Computing RF propagation..." />}
      {error && <ErrorMessage message="RF model failed" onRetry={refetch} />}

      {data && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="card p-5">
            <h4 className="text-sm font-semibold text-slate-300 mb-3">Tower Info</h4>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-[10px] text-slate-500 uppercase">Tower ID</p>
                <p className="text-slate-200 font-mono">{data.tower_id}</p>
              </div>
              <div>
                <p className="text-[10px] text-slate-500 uppercase">Environment</p>
                <p className="text-slate-200">{data.environment}</p>
              </div>
              <div>
                <p className="text-[10px] text-slate-500 uppercase">Position</p>
                <p className="text-slate-200 font-mono text-xs">{data.tower_lat?.toFixed(4)}, {data.tower_lng?.toFixed(4)}</p>
              </div>
              <div>
                <p className="text-[10px] text-slate-500 uppercase">Max Range</p>
                <p className="text-slate-200">{data.max_range_m?.toFixed(0)}m</p>
              </div>
              {data.azimuth != null && (
                <div>
                  <p className="text-[10px] text-slate-500 uppercase">Azimuth</p>
                  <p className="text-slate-200">{data.azimuth}°</p>
                </div>
              )}
            </div>
          </div>

          <div className="card p-5">
            <h4 className="text-sm font-semibold text-slate-300 mb-3">Signal Decay</h4>
            <div className="space-y-2">
              {data.coverage_points?.slice(0, 12).map((p, i) => {
                const normalized = Math.max(0, Math.min(1, (p.signal_dbm + 120) / 70));
                return (
                  <div key={i} className="flex items-center gap-3 text-xs">
                    <span className="w-16 text-slate-500 text-right">{p.distance_m.toFixed(0)}m</span>
                    <div className="flex-1 h-2 rounded-full bg-slate-800 overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${normalized * 100}%`,
                          backgroundColor: normalized > 0.6 ? '#22c55e' : normalized > 0.3 ? '#eab308' : '#ef4444',
                        }}
                      />
                    </div>
                    <span className="w-16 text-slate-400">{p.signal_dbm.toFixed(0)} dBm</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Coverage heatmap visualization */}
          <div className="card p-5 lg:col-span-2">
            <h4 className="text-sm font-semibold text-slate-300 mb-3">
              Coverage Grid ({data.coverage_points?.length || 0} points)
            </h4>
            <div className="relative bg-slate-900 rounded-lg overflow-hidden" style={{ height: '300px' }}>
              {data.coverage_points && data.coverage_points.length > 0 && (() => {
                const lats = data.coverage_points.map(p => p.latitude);
                const lngs = data.coverage_points.map(p => p.longitude);
                const minLat = Math.min(...lats, data.tower_lat);
                const maxLat = Math.max(...lats, data.tower_lat);
                const minLng = Math.min(...lngs, data.tower_lng);
                const maxLng = Math.max(...lngs, data.tower_lng);
                const latRange = maxLat - minLat || 0.01;
                const lngRange = maxLng - minLng || 0.01;

                return (
                  <>
                    {/* Tower marker */}
                    <div
                      className="absolute w-4 h-4 bg-red-500 rounded-full border-2 border-white z-10"
                      style={{
                        left: `${((data.tower_lng - minLng) / lngRange) * 100}%`,
                        top: `${(1 - (data.tower_lat - minLat) / latRange) * 100}%`,
                        transform: 'translate(-50%, -50%)',
                      }}
                      title="Tower"
                    />
                    {/* Coverage points */}
                    {data.coverage_points.map((p, i) => {
                      const normalized = Math.max(0, Math.min(1, (p.signal_dbm + 120) / 70));
                      return (
                        <div
                          key={i}
                          className="absolute w-3 h-3 rounded-full opacity-60"
                          style={{
                            left: `${((p.longitude - minLng) / lngRange) * 100}%`,
                            top: `${(1 - (p.latitude - minLat) / latRange) * 100}%`,
                            transform: 'translate(-50%, -50%)',
                            backgroundColor: normalized > 0.6 ? '#22c55e' : normalized > 0.3 ? '#eab308' : '#ef4444',
                          }}
                          title={`${p.distance_m.toFixed(0)}m: ${p.signal_dbm.toFixed(0)} dBm`}
                        />
                      );
                    })}
                  </>
                );
              })()}
              {!data.coverage_points?.length && (
                <div className="flex items-center justify-center h-full text-slate-500">No coverage data</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 4: Capture History
// ---------------------------------------------------------------------------
function CaptureHistoryTab() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    msisdn: '', method: 'targeted_cdr', cells_used: '', success: true,
    duration_hours: 1, time_of_day: 'morning', notes: '',
  });

  const { data: captures, isLoading, error, refetch } = useQuery({
    queryKey: ['captures'],
    queryFn: () => opIntelService.getCaptures(),
  });

  const { data: metrics } = useQuery({
    queryKey: ['capture-metrics'],
    queryFn: () => opIntelService.getCaptureMetrics(),
  });

  const createMutation = useMutation({
    mutationFn: (data) => opIntelService.createCapture(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['captures'] });
      queryClient.invalidateQueries({ queryKey: ['capture-metrics'] });
      queryClient.invalidateQueries({ queryKey: ['ops-dashboard'] });
      setShowForm(false);
    },
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    createMutation.mutate({
      ...form,
      cells_used: form.cells_used ? form.cells_used.split(',').map(s => s.trim()) : [],
    });
  };

  return (
    <div className="space-y-4">
      {/* Metrics */}
      {metrics && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <div className="card p-3 text-center">
            <p className="text-xl font-bold text-slate-200">{metrics.total_captures}</p>
            <p className="text-[10px] text-slate-500">Total Captures</p>
          </div>
          <div className="card p-3 text-center">
            <p className="text-xl font-bold text-emerald-400">{(metrics.success_rate * 100).toFixed(0)}%</p>
            <p className="text-[10px] text-slate-500">Success Rate</p>
          </div>
          <div className="card p-3 text-center">
            <p className="text-xl font-bold text-slate-200">{metrics.avg_duration_hours}h</p>
            <p className="text-[10px] text-slate-500">Avg Duration</p>
          </div>
          <div className="card p-3 text-center">
            <p className="text-sm font-medium text-blue-400">{metrics.most_effective_method?.replace(/_/g, ' ') || 'N/A'}</p>
            <p className="text-[10px] text-slate-500">Best Method</p>
          </div>
          <div className="card p-3 text-center">
            <p className="text-sm font-medium text-amber-400">{metrics.most_effective_time || 'N/A'}</p>
            <p className="text-[10px] text-slate-500">Best Time</p>
          </div>
        </div>
      )}

      {/* Add capture button + form */}
      <div className="flex justify-between items-center">
        <h3 className="text-sm font-semibold text-slate-300">Recent Captures</h3>
        <button onClick={() => setShowForm(!showForm)} className="btn-primary px-4 py-1.5 text-xs">
          {showForm ? 'Cancel' : '+ Record Capture'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="card p-4 grid grid-cols-2 lg:grid-cols-3 gap-3">
          <input
            type="text" placeholder="MSISDN" className="input-field"
            value={form.msisdn} onChange={(e) => setForm({ ...form, msisdn: e.target.value })} required
          />
          <select className="input-field" value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>
            <option value="tower_dump">Tower Dump</option>
            <option value="targeted_cdr">Targeted CDR</option>
            <option value="realtime_intercept">Realtime Intercept</option>
            <option value="location_track">Location Track</option>
            <option value="imsi_catcher">IMSI Catcher</option>
          </select>
          <input
            type="text" placeholder="Cells (comma-separated)" className="input-field"
            value={form.cells_used} onChange={(e) => setForm({ ...form, cells_used: e.target.value })}
          />
          <select className="input-field" value={form.time_of_day} onChange={(e) => setForm({ ...form, time_of_day: e.target.value })}>
            <option value="morning">Morning</option>
            <option value="afternoon">Afternoon</option>
            <option value="evening">Evening</option>
            <option value="night">Night</option>
          </select>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={form.success} onChange={(e) => setForm({ ...form, success: e.target.checked })} />
            Successful
          </label>
          <input
            type="number" placeholder="Duration (hours)" className="input-field" step="0.5" min="0"
            value={form.duration_hours} onChange={(e) => setForm({ ...form, duration_hours: Number(e.target.value) })}
          />
          <textarea
            placeholder="Notes" className="input-field col-span-2"
            value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
          <button type="submit" className="btn-primary" disabled={createMutation.isPending}>
            {createMutation.isPending ? 'Saving...' : 'Save Capture'}
          </button>
        </form>
      )}

      {isLoading && <LoadingSpinner text="Loading captures..." />}
      {error && <ErrorMessage message="Failed to load captures" onRetry={refetch} />}

      {/* Captures table */}
      {captures && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase text-slate-500 border-b border-slate-800/50">
                <th className="p-2">MSISDN</th>
                <th className="p-2">Method</th>
                <th className="p-2">Success</th>
                <th className="p-2">Duration</th>
                <th className="p-2">Time</th>
                <th className="p-2">Cells</th>
                <th className="p-2">Date</th>
              </tr>
            </thead>
            <tbody>
              {captures.map((cap) => (
                <tr key={cap.id} className="border-b border-slate-800/30 hover:bg-slate-800/20">
                  <td className="p-2 font-mono text-xs text-slate-300">{cap.msisdn}</td>
                  <td className="p-2 text-xs text-slate-400">{cap.method?.replace(/_/g, ' ')}</td>
                  <td className="p-2">
                    {cap.success
                      ? <CheckCircle size={14} className="text-emerald-400" />
                      : <XCircle size={14} className="text-red-400" />}
                  </td>
                  <td className="p-2 text-xs text-slate-400">{cap.duration_hours}h</td>
                  <td className="p-2 text-xs text-slate-400">{cap.time_of_day}</td>
                  <td className="p-2 text-xs text-slate-500">{(cap.cells_used || []).length} cells</td>
                  <td className="p-2 text-xs text-slate-500">{new Date(cap.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 5: Playbooks
// ---------------------------------------------------------------------------
function PlaybooksTab() {
  const queryClient = useQueryClient();
  const [selectedPlaybook, setSelectedPlaybook] = useState(null);
  const [executeMsisdn, setExecuteMsisdn] = useState('');
  const [viewExecution, setViewExecution] = useState(null);

  const { data: playbooks, isLoading, error, refetch } = useQuery({
    queryKey: ['playbooks'],
    queryFn: () => opIntelService.getPlaybooks(),
  });

  const { data: executions } = useQuery({
    queryKey: ['executions'],
    queryFn: () => opIntelService.getExecutions(),
  });

  const executeMutation = useMutation({
    mutationFn: (data) => opIntelService.executePlaybook(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['executions'] });
      queryClient.invalidateQueries({ queryKey: ['ops-dashboard'] });
      setSelectedPlaybook(null);
      setExecuteMsisdn('');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => opIntelService.updateExecution(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['executions'] });
      queryClient.invalidateQueries({ queryKey: ['ops-dashboard'] });
    },
  });

  const handleStepUpdate = (executionId, stepNumber, newStatus) => {
    updateMutation.mutate({
      id: executionId,
      data: {
        step_updates: [{ step_number: stepNumber, status: newStatus }],
      },
    });
  };

  const typeColors = {
    drug: 'bg-red-500/15 text-red-400 border-red-500/20',
    fraud: 'bg-amber-500/15 text-amber-400 border-amber-500/20',
    terror: 'bg-orange-500/15 text-orange-400 border-orange-500/20',
    kidnap: 'bg-purple-500/15 text-purple-400 border-purple-500/20',
    organized_crime: 'bg-blue-500/15 text-blue-400 border-blue-500/20',
  };

  return (
    <div className="space-y-4">
      {isLoading && <LoadingSpinner text="Loading playbooks..." />}
      {error && <ErrorMessage message="Failed to load playbooks" onRetry={refetch} />}

      {/* Playbook cards */}
      {playbooks && !selectedPlaybook && !viewExecution && (
        <>
          <h3 className="text-sm font-semibold text-slate-300">Available Playbooks</h3>
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
            {playbooks.map((pb) => (
              <div key={pb.id} className="card p-4 hover:border-blue-500/30 transition-colors cursor-pointer" onClick={() => setSelectedPlaybook(pb)}>
                <div className="flex items-center justify-between mb-2">
                  <span className={`text-[10px] px-2 py-0.5 rounded-full border ${typeColors[pb.target_type] || 'bg-slate-700 text-slate-400'}`}>
                    {pb.target_type?.replace(/_/g, ' ')}
                  </span>
                  {pb.success_rate != null && (
                    <span className="text-xs text-slate-500">{(pb.success_rate * 100).toFixed(0)}% success</span>
                  )}
                </div>
                <h4 className="text-sm font-semibold text-slate-200 mb-1">{pb.name}</h4>
                <p className="text-xs text-slate-500 line-clamp-2">{pb.description}</p>
                <div className="flex items-center gap-3 mt-3 text-[10px] text-slate-500">
                  <span className="flex items-center gap-1"><BookOpen size={10} />{pb.steps?.length || 0} steps</span>
                  <span className="flex items-center gap-1"><Clock size={10} />{pb.estimated_hours}h</span>
                </div>
              </div>
            ))}
          </div>

          {/* Active executions */}
          {executions && executions.length > 0 && (
            <>
              <h3 className="text-sm font-semibold text-slate-300 mt-6">Executions</h3>
              <div className="space-y-2">
                {executions.map((ex) => {
                  const totalSteps = ex.step_progress?.length || 0;
                  const completed = ex.step_progress?.filter(s => s.status === 'completed').length || 0;
                  const progress = totalSteps > 0 ? (completed / totalSteps) * 100 : 0;

                  return (
                    <div
                      key={ex.id}
                      className="card p-4 flex items-center gap-4 cursor-pointer hover:border-blue-500/30 transition-colors"
                      onClick={() => setViewExecution(ex)}
                    >
                      <div className={`w-2 h-2 rounded-full ${
                        ex.status === 'completed' ? 'bg-emerald-400' : ex.status === 'active' ? 'bg-blue-400 animate-pulse' : 'bg-slate-500'
                      }`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-slate-200">{ex.playbook_name}</span>
                          <span className="text-xs text-slate-500 font-mono">{ex.msisdn}</span>
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <div className="flex-1 h-1.5 rounded-full bg-slate-800 overflow-hidden max-w-xs">
                            <div className="h-full bg-blue-500 rounded-full" style={{ width: `${progress}%` }} />
                          </div>
                          <span className="text-[10px] text-slate-500">{completed}/{totalSteps}</span>
                        </div>
                      </div>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                        ex.status === 'completed' ? 'bg-emerald-500/15 text-emerald-400' :
                        ex.status === 'active' ? 'bg-blue-500/15 text-blue-400' : 'bg-slate-700 text-slate-400'
                      }`}>
                        {ex.status}
                      </span>
                      <ChevronRight size={14} className="text-slate-600" />
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}

      {/* Playbook detail / execute */}
      {selectedPlaybook && (
        <div className="space-y-4">
          <button onClick={() => setSelectedPlaybook(null)} className="text-sm text-blue-400 hover:text-blue-300">
            &larr; Back to playbooks
          </button>
          <div className="card p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-semibold text-slate-200">{selectedPlaybook.name}</h3>
              <span className={`text-xs px-2 py-0.5 rounded-full border ${typeColors[selectedPlaybook.target_type] || ''}`}>
                {selectedPlaybook.target_type?.replace(/_/g, ' ')}
              </span>
            </div>
            <p className="text-sm text-slate-400 mb-4">{selectedPlaybook.description}</p>

            <h4 className="text-sm font-semibold text-slate-300 mb-2">Steps</h4>
            <div className="space-y-2">
              {selectedPlaybook.steps?.map((step, i) => (
                <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-slate-800/40">
                  <div className="w-6 h-6 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center text-xs font-bold shrink-0">
                    {step.step_number}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-slate-200">{step.title}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{step.description}</p>
                    <div className="flex gap-3 mt-1 text-[10px] text-slate-600">
                      {step.tool && <span>Tool: {step.tool}</span>}
                      <span>{step.estimated_minutes} min</span>
                      {!step.required && <span className="text-amber-500">Optional</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center gap-3 mt-4 pt-4 border-t border-slate-800/50">
              <input
                type="text" placeholder="Target MSISDN (optional)" className="input-field flex-1"
                value={executeMsisdn} onChange={(e) => setExecuteMsisdn(e.target.value)}
              />
              <button
                className="btn-primary px-6"
                onClick={() => executeMutation.mutate({ playbook_id: selectedPlaybook.id, msisdn: executeMsisdn || null })}
                disabled={executeMutation.isPending}
              >
                <Play size={14} className="mr-2" />
                {executeMutation.isPending ? 'Starting...' : 'Start Execution'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Execution detail */}
      {viewExecution && (
        <div className="space-y-4">
          <button onClick={() => setViewExecution(null)} className="text-sm text-blue-400 hover:text-blue-300">
            &larr; Back to list
          </button>
          <div className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-semibold text-slate-200">{viewExecution.playbook_name}</h3>
                <span className="text-xs text-slate-500 font-mono">{viewExecution.msisdn}</span>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full ${
                viewExecution.status === 'completed' ? 'bg-emerald-500/15 text-emerald-400' :
                viewExecution.status === 'active' ? 'bg-blue-500/15 text-blue-400' : 'bg-slate-700 text-slate-400'
              }`}>
                {viewExecution.status}
              </span>
            </div>

            <div className="space-y-2">
              {viewExecution.step_progress?.map((step) => (
                <div key={step.step_number} className={`flex items-center gap-3 p-3 rounded-lg ${
                  step.status === 'completed' ? 'bg-emerald-500/5 border border-emerald-500/20' :
                  step.status === 'in_progress' ? 'bg-blue-500/5 border border-blue-500/20' :
                  'bg-slate-800/40 border border-transparent'
                }`}>
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${
                    step.status === 'completed' ? 'bg-emerald-500/20' :
                    step.status === 'in_progress' ? 'bg-blue-500/20' : 'bg-slate-700'
                  }`}>
                    {step.status === 'completed' ? <CheckCircle size={14} className="text-emerald-400" /> :
                     step.status === 'in_progress' ? <Activity size={14} className="text-blue-400 animate-pulse" /> :
                     <span className="text-xs text-slate-500">{step.step_number}</span>}
                  </div>
                  <span className="flex-1 text-sm text-slate-300">{step.title}</span>
                  {viewExecution.status === 'active' && step.status !== 'completed' && (
                    <div className="flex gap-1">
                      {step.status === 'pending' && (
                        <button
                          className="text-[10px] px-2 py-0.5 rounded bg-blue-500/20 text-blue-400 hover:bg-blue-500/30"
                          onClick={() => handleStepUpdate(viewExecution.id, step.step_number, 'in_progress')}
                        >
                          Start
                        </button>
                      )}
                      {step.status === 'in_progress' && (
                        <button
                          className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30"
                          onClick={() => handleStepUpdate(viewExecution.id, step.step_number, 'completed')}
                        >
                          Complete
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {viewExecution.status === 'active' && (
              <div className="flex gap-2 mt-4 pt-4 border-t border-slate-800/50">
                <button
                  className="text-xs px-4 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30"
                  onClick={() => {
                    updateMutation.mutate({ id: viewExecution.id, data: { status: 'completed' } });
                    setViewExecution(null);
                  }}
                >
                  Mark Completed
                </button>
                <button
                  className="text-xs px-4 py-1.5 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30"
                  onClick={() => {
                    updateMutation.mutate({ id: viewExecution.id, data: { status: 'aborted' } });
                    setViewExecution(null);
                  }}
                >
                  Abort
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------
export default function OpIntelligence() {
  const [activeTab, setActiveTab] = useState('recommendations');

  const tabContent = {
    recommendations: <CellRecommendations />,
    location: <PrecisionLocation />,
    'rf-coverage': <RFCoverage />,
    captures: <CaptureHistoryTab />,
    playbooks: <PlaybooksTab />,
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            <Crosshair size={22} className="text-blue-400" />
            Operational Intelligence
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Cell recommendations, precision location, RF analysis, and operational playbooks
          </p>
        </div>
      </div>

      <DashboardSummary />

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-slate-900/50 rounded-xl border border-slate-800/50">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              activeTab === tab.id
                ? 'bg-blue-500/15 text-blue-400 shadow-lg shadow-blue-500/5 border border-blue-500/20'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 border border-transparent'
            }`}
          >
            <tab.icon size={14} />
            <span className="hidden sm:inline">{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tabContent[activeTab]}
    </div>
  );
}
