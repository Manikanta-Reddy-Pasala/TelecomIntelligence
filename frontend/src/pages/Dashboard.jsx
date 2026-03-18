import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { analyticsService } from '../services/analytics';
import { entitiesService } from '../services/entities';
import { eventsService } from '../services/events';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorMessage from '../components/ErrorMessage';
import {
  Users,
  FolderOpen,
  Phone,
  AlertTriangle,
  Search,
  Activity,
  Clock,
  ArrowRight,
  TrendingUp,
} from 'lucide-react';
import { format } from 'date-fns';

export default function Dashboard() {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [searching, setSearching] = useState(false);

  const { data: stats, isLoading, error, refetch } = useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: () => analyticsService.getDashboardStats(),
  });

  const { data: recentActivity } = useQuery({
    queryKey: ['recent-activity'],
    queryFn: () => eventsService.getRecentActivity(10),
  });

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const results = await entitiesService.searchEntities(searchQuery);
      setSearchResults(results);
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  };

  const statCards = [
    {
      label: 'Total Persons',
      value: stats?.total_persons ?? '--',
      icon: Users,
      color: 'text-blue-400',
      bg: 'bg-blue-500/10',
      border: 'border-blue-500/20',
    },
    {
      label: 'Active Cases',
      value: stats?.active_cases ?? '--',
      icon: FolderOpen,
      color: 'text-emerald-400',
      bg: 'bg-emerald-500/10',
      border: 'border-emerald-500/20',
    },
    {
      label: 'Calls Today',
      value: stats?.calls_today ?? '--',
      icon: Phone,
      color: 'text-purple-400',
      bg: 'bg-purple-500/10',
      border: 'border-purple-500/20',
    },
    {
      label: 'Alerts',
      value: stats?.alerts ?? '--',
      icon: AlertTriangle,
      color: 'text-amber-400',
      bg: 'bg-amber-500/10',
      border: 'border-amber-500/20',
    },
  ];

  if (isLoading) return <LoadingSpinner text="Loading dashboard..." />;
  if (error) return <ErrorMessage message="Failed to load dashboard" onRetry={refetch} />;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Dashboard</h1>
          <p className="text-sm text-slate-500 mt-1">Intelligence overview and quick access</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-600">
          <Activity size={12} className="text-green-500" />
          <span>System operational</span>
        </div>
      </div>

      {/* Quick Search */}
      <div className="card p-4">
        <form onSubmit={handleSearch} className="flex gap-3">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by name, MSISDN, IMEI, or case ID..."
              className="input-field pl-10"
            />
          </div>
          <button type="submit" disabled={searching} className="btn-primary">
            {searching ? 'Searching...' : 'Search'}
          </button>
        </form>

        {/* Search Results */}
        {searchResults && (
          <div className="mt-4 border-t border-slate-800 pt-4">
            {searchResults?.length === 0 ? (
              <p className="text-sm text-slate-500 text-center py-2">No results found</p>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-slate-500 mb-2">
                  {searchResults?.length || 0} result(s) found
                </p>
                {searchResults?.map?.((result, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between p-3 rounded-lg bg-slate-800/50 hover:bg-slate-800 transition-colors cursor-pointer"
                    onClick={() => {
                      if (result.entity_type === 'person') navigate(`/entities/${result.entity_id}`);
                      else if (result.entity_type === 'phone') navigate(`/copilot`, { state: { prefill: `Show details for ${result.label}` } });
                      else if (result.entity_type === 'tower') navigate(`/map`);
                    }}
                  >
                    <div className="flex items-center gap-3">
                      <span className="badge-info text-[10px] uppercase">{result.entity_type}</span>
                      <span className="text-sm text-slate-200">{result.label}</span>
                      {result.detail && <span className="text-xs text-slate-500">{result.detail}</span>}
                    </div>
                    <ArrowRight size={14} className="text-slate-600" />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((card) => (
          <div key={card.label} className={`card p-5 border ${card.border}`}>
            <div className="flex items-center justify-between mb-3">
              <div className={`p-2 rounded-lg ${card.bg}`}>
                <card.icon size={18} className={card.color} />
              </div>
              <TrendingUp size={14} className="text-slate-700" />
            </div>
            <div className="text-2xl font-bold text-slate-100">{card.value}</div>
            <div className="text-xs text-slate-500 mt-1">{card.label}</div>
          </div>
        ))}
      </div>

      {/* Recent Activity + Quick Actions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Activity Feed */}
        <div className="lg:col-span-2 card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
              Recent Activity
            </h2>
            <Clock size={14} className="text-slate-600" />
          </div>
          <div className="space-y-3">
            {(Array.isArray(recentActivity) ? recentActivity : recentActivity?.events || []).length > 0 ? (
              (Array.isArray(recentActivity) ? recentActivity : recentActivity?.events || []).map((event, i) => (
                <div
                  key={i}
                  className="flex items-start gap-3 p-3 rounded-lg bg-slate-800/30 border border-slate-800/50"
                >
                  <div
                    className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${
                      event.type === 'call'
                        ? 'bg-blue-500'
                        : event.type === 'sms'
                        ? 'bg-green-500'
                        : event.type === 'location'
                        ? 'bg-purple-500'
                        : 'bg-slate-500'
                    }`}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-slate-300 truncate">
                      {event.description || `${event.type} event`}
                    </p>
                    <p className="text-xs text-slate-600 mt-0.5">
                      {event.timestamp
                        ? format(new Date(event.timestamp), 'MMM d, yyyy HH:mm:ss')
                        : 'Unknown time'}
                    </p>
                  </div>
                  <span className="badge-info text-[10px]">{event.type}</span>
                </div>
              ))
            ) : (
              <p className="text-sm text-slate-600 text-center py-8">No recent activity</p>
            )}
          </div>
        </div>

        {/* Quick Actions */}
        <div className="card p-5">
          <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-4">
            Quick Actions
          </h2>
          <div className="space-y-2">
            <button
              onClick={() => navigate('/copilot')}
              className="w-full text-left p-3 rounded-lg bg-blue-600/10 border border-blue-500/20 hover:bg-blue-600/20 transition-colors"
            >
              <div className="text-sm font-medium text-blue-400">Open Copilot</div>
              <div className="text-xs text-slate-500 mt-0.5">Start an investigation query</div>
            </button>
            <button
              onClick={() => navigate('/cases')}
              className="w-full text-left p-3 rounded-lg bg-slate-800/50 border border-slate-700/50 hover:bg-slate-800 transition-colors"
            >
              <div className="text-sm font-medium text-slate-300">New Case</div>
              <div className="text-xs text-slate-500 mt-0.5">Create investigation case</div>
            </button>
            <button
              onClick={() => navigate('/map')}
              className="w-full text-left p-3 rounded-lg bg-slate-800/50 border border-slate-700/50 hover:bg-slate-800 transition-colors"
            >
              <div className="text-sm font-medium text-slate-300">Tower Map</div>
              <div className="text-xs text-slate-500 mt-0.5">View tower network</div>
            </button>
            <button
              onClick={() => navigate('/analytics')}
              className="w-full text-left p-3 rounded-lg bg-slate-800/50 border border-slate-700/50 hover:bg-slate-800 transition-colors"
            >
              <div className="text-sm font-medium text-slate-300">Anomaly Detection</div>
              <div className="text-xs text-slate-500 mt-0.5">Review alerts</div>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
