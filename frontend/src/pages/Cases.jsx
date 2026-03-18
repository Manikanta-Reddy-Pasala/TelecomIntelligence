import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { casesService } from '../services/cases';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorMessage from '../components/ErrorMessage';
import Modal from '../components/Modal';
import { Plus, FolderOpen, AlertCircle } from 'lucide-react';
import { format } from 'date-fns';

const statusColors = {
  open: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  active: 'bg-green-500/20 text-green-400 border-green-500/30',
  closed: 'bg-slate-500/20 text-slate-400 border-slate-500/30',
  archived: 'bg-slate-600/20 text-slate-500 border-slate-600/30',
};

export default function Cases() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [createForm, setCreateForm] = useState({ title: '', description: '', status: 'open' });

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['cases', statusFilter],
    queryFn: () => casesService.getCases(statusFilter || undefined),
  });

  const createMutation = useMutation({
    mutationFn: (formData) => {
      const caseNumber = `TIAC-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 900) + 100).padStart(3, '0')}`;
      return casesService.createCase({ ...formData, case_number: caseNumber });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cases'] });
      setShowCreate(false);
      setCreateForm({ title: '', description: '', status: 'open' });
    },
  });

  const cases = data?.cases || data || [];

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Cases</h1>
          <p className="text-sm text-slate-500 mt-1">Investigation case management</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="btn-primary flex items-center gap-2 text-sm">
          <Plus size={16} />
          New Case
        </button>
      </div>

      {/* Status Filters */}
      <div className="flex gap-2">
        {['', 'open', 'active', 'closed', 'archived'].map((status) => (
          <button
            key={status}
            onClick={() => setStatusFilter(status)}
            className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${
              statusFilter === status
                ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30'
                : 'bg-slate-800/50 text-slate-400 border border-slate-700/50 hover:border-slate-600'
            }`}
          >
            {status || 'All'}
          </button>
        ))}
      </div>

      {/* Cases List */}
      {isLoading ? (
        <LoadingSpinner text="Loading cases..." />
      ) : error ? (
        <ErrorMessage message="Failed to load cases" onRetry={refetch} />
      ) : cases.length === 0 ? (
        <div className="card p-12 text-center">
          <FolderOpen size={40} className="mx-auto text-slate-700 mb-3" />
          <p className="text-sm text-slate-500">No cases found</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {cases.map((c) => (
            <div
              key={c.id}
              onClick={() => navigate(`/cases/${c.id}`)}
              className="card p-5 cursor-pointer hover:bg-slate-800/60 hover:border-slate-600 transition-all"
            >
              <div className="flex items-start justify-between mb-2">
                <h3 className="text-sm font-semibold text-slate-200 line-clamp-1">{c.title || 'Untitled'}</h3>
                <span className={`rounded-full px-2 py-1 text-xs font-medium border ${statusColors[c.status] || statusColors.open}`}>
                  {c.status || 'open'}
                </span>
              </div>
              <p className="text-xs text-slate-500 line-clamp-2 mb-3">{c.description || 'No description'}</p>
              <div className="flex items-center justify-between text-[10px] text-slate-600">
                <span>{c.entities?.length || '--'} entities</span>
                {c.priority && (
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      c.priority === 'critical'
                        ? 'bg-red-500/20 text-red-400'
                        : c.priority === 'high'
                        ? 'bg-orange-500/20 text-orange-400'
                        : c.priority === 'medium'
                        ? 'bg-yellow-500/20 text-yellow-400'
                        : 'bg-slate-500/20 text-slate-400'
                    }`}
                  >
                    {c.priority}
                  </span>
                )}
                <span>{c.created_at ? format(new Date(c.created_at), 'MMM d, yyyy') : ''}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Case Modal */}
      <Modal isOpen={showCreate} onClose={() => setShowCreate(false)} title="Create New Case">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            createMutation.mutate(createForm);
          }}
          className="space-y-4"
        >
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1">Title</label>
            <input
              type="text"
              value={createForm.title}
              onChange={(e) => setCreateForm({ ...createForm, title: e.target.value })}
              className="w-full bg-slate-800 border border-slate-600 text-slate-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Case title"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1">Description</label>
            <textarea
              value={createForm.description}
              onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
              className="w-full bg-slate-800 border border-slate-600 text-slate-100 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
              rows={3}
              placeholder="Case description..."
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1">Initial Status</label>
            <select
              value={createForm.status}
              onChange={(e) => setCreateForm({ ...createForm, status: e.target.value })}
              className="w-full bg-slate-800 border border-slate-600 text-slate-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="open">Open</option>
              <option value="active">Active</option>
            </select>
          </div>
          {createMutation.isError && (
            <div className="flex items-center gap-2 text-sm text-red-400">
              <AlertCircle size={14} />
              Failed to create case
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowCreate(false)}
              className="px-4 py-2 text-sm rounded-lg bg-slate-700 text-slate-300 hover:bg-slate-600 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              {createMutation.isPending ? 'Creating...' : 'Create Case'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
