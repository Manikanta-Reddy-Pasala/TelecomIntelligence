import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { auditService } from '../services/audit';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorMessage from '../components/ErrorMessage';
import { ScrollText, Search, ChevronLeft, ChevronRight, Filter } from 'lucide-react';
import { format } from 'date-fns';

const actionColors = {
  login: 'bg-green-500/20 text-green-400',
  logout: 'bg-slate-500/20 text-slate-400',
  query: 'bg-blue-500/20 text-blue-400',
  search: 'bg-blue-500/20 text-blue-400',
  export: 'bg-purple-500/20 text-purple-400',
  create: 'bg-emerald-500/20 text-emerald-400',
  update: 'bg-yellow-500/20 text-yellow-400',
  delete: 'bg-red-500/20 text-red-400',
  view: 'bg-slate-500/20 text-slate-400',
  copilot_query: 'bg-indigo-500/20 text-indigo-400',
};

export default function AuditLog() {
  const [userFilter, setUserFilter] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [page, setPage] = useState(1);
  const limit = 50;

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['audit-logs', userFilter, actionFilter, fromDate, toDate, page],
    queryFn: () =>
      auditService.getAuditLogs(
        userFilter || undefined,
        actionFilter || undefined,
        fromDate || undefined,
        toDate || undefined,
        page,
        limit
      ),
  });

  const logs = data?.logs || data?.audit_logs || data || [];
  const totalCount = data?.total || data?.count || 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / limit));

  const handleReset = () => {
    setUserFilter('');
    setActionFilter('');
    setFromDate('');
    setToDate('');
    setPage(1);
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Audit Log</h1>
          <p className="text-sm text-slate-500 mt-1">Session monitoring and data access audit trail</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-600">
          <ScrollText size={14} className="text-slate-500" />
          {totalCount > 0 && <span>{totalCount} total entries</span>}
        </div>
      </div>

      {/* Filters */}
      <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
        <div className="flex items-center gap-2 mb-3">
          <Filter size={14} className="text-slate-500" />
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Filters</span>
        </div>
        <div className="flex gap-3 items-end flex-wrap">
          <div className="flex-1 min-w-[180px]">
            <label className="block text-xs text-slate-500 mb-1">User</label>
            <div className="relative">
              <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                value={userFilter}
                onChange={(e) => {
                  setUserFilter(e.target.value);
                  setPage(1);
                }}
                placeholder="Filter by username..."
                className="w-full bg-slate-900 border border-slate-600 text-slate-100 rounded-lg pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
          <div className="w-48">
            <label className="block text-xs text-slate-500 mb-1">Action Type</label>
            <select
              value={actionFilter}
              onChange={(e) => {
                setActionFilter(e.target.value);
                setPage(1);
              }}
              className="w-full bg-slate-900 border border-slate-600 text-slate-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All actions</option>
              <option value="login">Login</option>
              <option value="logout">Logout</option>
              <option value="query">Query</option>
              <option value="search">Search</option>
              <option value="copilot_query">Copilot Query</option>
              <option value="export">Export</option>
              <option value="create">Create</option>
              <option value="update">Update</option>
              <option value="delete">Delete</option>
              <option value="view">View</option>
            </select>
          </div>
          <div className="w-40">
            <label className="block text-xs text-slate-500 mb-1">From</label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => {
                setFromDate(e.target.value);
                setPage(1);
              }}
              className="w-full bg-slate-900 border border-slate-600 text-slate-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="w-40">
            <label className="block text-xs text-slate-500 mb-1">To</label>
            <input
              type="date"
              value={toDate}
              onChange={(e) => {
                setToDate(e.target.value);
                setPage(1);
              }}
              className="w-full bg-slate-900 border border-slate-600 text-slate-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <button
            onClick={handleReset}
            className="px-3 py-2 text-sm rounded-lg bg-slate-700 text-slate-400 hover:bg-slate-600 hover:text-slate-200 transition-colors"
          >
            Reset
          </button>
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <LoadingSpinner text="Loading audit logs..." />
      ) : error ? (
        <ErrorMessage message="Failed to load audit logs" onRetry={refetch} />
      ) : logs.length === 0 ? (
        <div className="bg-slate-800 rounded-lg p-12 text-center border border-slate-700">
          <ScrollText size={40} className="mx-auto text-slate-700 mb-3" />
          <p className="text-sm text-slate-500">No audit log entries found</p>
          <p className="text-xs text-slate-600 mt-1">Adjust filters or date range to see entries</p>
        </div>
      ) : (
        <div className="bg-slate-800 rounded-lg border border-slate-700 overflow-hidden">
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-800/80">
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider">Timestamp</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider">User</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider">Action</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider">Query / Details</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider">Data Accessed</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider">IP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {logs.map((log, i) => (
                  <tr key={log.id || i} className="hover:bg-slate-800/30 even:bg-slate-800/20">
                    <td className="px-4 py-3 text-slate-400 font-mono text-xs whitespace-nowrap">
                      {log.timestamp
                        ? format(new Date(log.timestamp), 'MMM d, yyyy HH:mm:ss')
                        : '--'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-slate-700 flex items-center justify-center text-[10px] text-slate-400 font-medium">
                          {(log.user_id || log.username || log.user || 'U').toString().charAt(0).toUpperCase()}
                        </div>
                        <span className="text-sm text-slate-300">{log.user_id || log.username || log.user || 'Unknown'}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-1 text-xs font-medium ${
                          actionColors[log.action] || 'bg-slate-600/20 text-slate-400'
                        }`}
                      >
                        {(log.action || 'unknown').replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-400 text-xs max-w-[300px]">
                      <div className="truncate" title={log.query_text || log.query || log.details || ''}>
                        {log.query_text || log.query || log.details || log.description || '--'}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-xs max-w-[200px]">
                      <div className="truncate" title={typeof log.data_accessed === 'object' ? JSON.stringify(log.data_accessed) : (log.data_accessed || '')}>
                        {typeof log.data_accessed === 'object' ? JSON.stringify(log.data_accessed) : (log.data_accessed || log.resource || log.entities_accessed || '--')}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-600 font-mono text-xs">
                      {log.ip_address || log.ip || '--'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Pagination */}
      {logs.length > 0 && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-600">
            Page {page} of {totalPages}
            {totalCount > 0 && ` (${totalCount} entries)`}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg bg-slate-800 text-slate-400 border border-slate-700 hover:border-slate-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft size={12} />
              Previous
            </button>
            <div className="flex gap-1">
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                let pageNum;
                if (totalPages <= 5) {
                  pageNum = i + 1;
                } else if (page <= 3) {
                  pageNum = i + 1;
                } else if (page >= totalPages - 2) {
                  pageNum = totalPages - 4 + i;
                } else {
                  pageNum = page - 2 + i;
                }
                return (
                  <button
                    key={pageNum}
                    onClick={() => setPage(pageNum)}
                    className={`w-8 h-8 text-xs rounded-lg transition-colors ${
                      page === pageNum
                        ? 'bg-blue-600 text-white'
                        : 'bg-slate-800 text-slate-400 border border-slate-700 hover:border-slate-600'
                    }`}
                  >
                    {pageNum}
                  </button>
                );
              })}
            </div>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg bg-slate-800 text-slate-400 border border-slate-700 hover:border-slate-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Next
              <ChevronRight size={12} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
