import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { casesService } from '../services/cases';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorMessage from '../components/ErrorMessage';
import Modal from '../components/Modal';
import {
  ArrowLeft,
  Users,
  Lightbulb,
  Plus,
  Trash2,
  Tag,
  Clock,
  AlertCircle,
  Activity,
} from 'lucide-react';
import { format } from 'date-fns';

const statusColors = {
  open: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  active: 'bg-green-500/20 text-green-400 border-green-500/30',
  closed: 'bg-slate-500/20 text-slate-400 border-slate-500/30',
  archived: 'bg-slate-600/20 text-slate-500 border-slate-600/30',
};

const priorityColors = {
  critical: 'bg-red-500/20 text-red-400',
  high: 'bg-orange-500/20 text-orange-400',
  medium: 'bg-yellow-500/20 text-yellow-400',
  low: 'bg-blue-500/20 text-blue-400',
};

const insightTypeColors = {
  fact: 'bg-green-500/20 text-green-400',
  inference: 'bg-yellow-500/20 text-yellow-400',
  model_summary: 'bg-blue-500/20 text-blue-400',
  analyst_note: 'bg-slate-500/20 text-slate-400',
};

export default function CaseDetail() {
  const { id: caseId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('entities');
  const [showAddEntity, setShowAddEntity] = useState(false);
  const [showAddInsight, setShowAddInsight] = useState(false);
  const [entityForm, setEntityForm] = useState({ entity_type: 'phone', identifier: '' });
  const [insightForm, setInsightForm] = useState({ type: 'analyst_note', title: '', content: '' });

  const { data: caseData, isLoading, error, refetch } = useQuery({
    queryKey: ['case', caseId],
    queryFn: () => casesService.getCase(caseId),
  });

  const { data: notebookData } = useQuery({
    queryKey: ['case-notebook', caseId],
    queryFn: () => casesService.getCaseNotebook(caseId),
  });

  const addEntityMutation = useMutation({
    mutationFn: (data) => casesService.addCaseEntity(caseId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['case', caseId] });
      setShowAddEntity(false);
      setEntityForm({ entity_type: 'phone', identifier: '' });
    },
  });

  const addInsightMutation = useMutation({
    mutationFn: (data) => casesService.addCaseInsight(caseId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['case-notebook', caseId] });
      setShowAddInsight(false);
      setInsightForm({ type: 'analyst_note', title: '', content: '' });
    },
  });

  if (isLoading) return <LoadingSpinner text="Loading case..." />;
  if (error) return <ErrorMessage message="Failed to load case" onRetry={refetch} />;

  const caseInfo = caseData?.case || caseData || {};
  const entities = caseInfo.entities || [];
  const insights = notebookData?.insights || notebookData || [];
  const timeline = caseInfo.timeline || caseInfo.activity || [];

  const tabs = [
    { key: 'entities', label: 'Entities', icon: Users, count: entities.length },
    { key: 'notebook', label: 'Notebook', icon: Lightbulb, count: insights.length },
    { key: 'timeline', label: 'Timeline', icon: Activity, count: timeline.length },
  ];

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Back button */}
      <button
        onClick={() => navigate('/cases')}
        className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-200 transition-colors"
      >
        <ArrowLeft size={14} />
        Back to cases
      </button>

      {/* Case Header */}
      <div className="bg-slate-800 rounded-lg shadow-lg p-6 border border-slate-700">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <h1 className="text-xl font-bold text-slate-100">{caseInfo.title || 'Untitled Case'}</h1>
            <p className="text-sm text-slate-400 mt-1">{caseInfo.description || 'No description'}</p>
            <div className="flex items-center gap-3 mt-4 flex-wrap">
              <span className={`rounded-full px-2 py-1 text-xs font-medium border ${statusColors[caseInfo.status] || statusColors.open}`}>
                {caseInfo.status || 'open'}
              </span>
              {caseInfo.priority && (
                <span className={`rounded-full px-2 py-1 text-xs font-medium ${priorityColors[caseInfo.priority] || priorityColors.low}`}>
                  {caseInfo.priority} priority
                </span>
              )}
              {caseInfo.assigned_to && (
                <span className="text-xs text-slate-500">
                  Assigned to: <span className="text-slate-300">{caseInfo.assigned_to}</span>
                </span>
              )}
              {caseInfo.created_at && (
                <span className="text-xs text-slate-600 flex items-center gap-1">
                  <Clock size={11} />
                  Created {format(new Date(caseInfo.created_at), 'MMM d, yyyy HH:mm')}
                </span>
              )}
            </div>
          </div>
          <span className="text-xs font-mono text-slate-600">{caseId}</span>
        </div>
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
              <span className="text-xs bg-slate-800 rounded-full px-1.5 py-0.5 text-slate-500">
                {tab.count}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      <div>
        {/* Entities Tab */}
        {activeTab === 'entities' && (
          <div className="space-y-4">
            <div className="flex justify-end">
              <button
                onClick={() => setShowAddEntity(true)}
                className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors"
              >
                <Plus size={14} />
                Add Entity
              </button>
            </div>
            {entities.length === 0 ? (
              <div className="bg-slate-800 rounded-lg p-12 text-center border border-slate-700">
                <Users size={36} className="mx-auto text-slate-700 mb-3" />
                <p className="text-sm text-slate-500">No entities linked to this case</p>
                <p className="text-xs text-slate-600 mt-1">Add persons, phones, or devices to track</p>
              </div>
            ) : (
              <div className="space-y-2">
                {entities.map((entity, i) => (
                  <div
                    key={entity.id || i}
                    className="flex items-center justify-between p-4 rounded-lg bg-slate-800 border border-slate-700 hover:border-slate-600 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <span
                        className={`rounded-full px-2 py-1 text-xs font-medium ${
                          entity.entity_type === 'person'
                            ? 'bg-blue-500/20 text-blue-400'
                            : entity.entity_type === 'phone'
                            ? 'bg-green-500/20 text-green-400'
                            : entity.entity_type === 'device'
                            ? 'bg-purple-500/20 text-purple-400'
                            : 'bg-slate-500/20 text-slate-400'
                        }`}
                      >
                        {entity.entity_type || entity.type || 'unknown'}
                      </span>
                      <div>
                        <span className="text-sm text-slate-200 font-mono">
                          {entity.identifier || entity.name || entity.msisdn || 'Unknown'}
                        </span>
                        {entity.label && (
                          <span className="text-xs text-slate-500 ml-2">{entity.label}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {entity.added_at && (
                        <span className="text-xs text-slate-600">
                          {format(new Date(entity.added_at), 'MMM d, HH:mm')}
                        </span>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (entity.entity_type === 'person' && entity.id) {
                            navigate(`/entities/${entity.id}`);
                          }
                        }}
                        className="text-xs text-blue-400 hover:text-blue-300 transition-colors px-2 py-1"
                      >
                        View
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Notebook Tab */}
        {activeTab === 'notebook' && (
          <div className="space-y-4">
            <div className="flex justify-end">
              <button
                onClick={() => setShowAddInsight(true)}
                className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors"
              >
                <Plus size={14} />
                Add Insight
              </button>
            </div>
            {insights.length === 0 ? (
              <div className="bg-slate-800 rounded-lg p-12 text-center border border-slate-700">
                <Lightbulb size={36} className="mx-auto text-slate-700 mb-3" />
                <p className="text-sm text-slate-500">No insights saved yet</p>
                <p className="text-xs text-slate-600 mt-1">Save facts, inferences, and notes as you investigate</p>
              </div>
            ) : (
              <div className="space-y-3">
                {insights.map((insight, i) => (
                  <div
                    key={insight.id || i}
                    className="p-4 rounded-lg bg-slate-800 border border-slate-700"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className={`rounded-full px-2 py-1 text-xs font-medium flex items-center gap-1 ${insightTypeColors[insight.insight_type] || insightTypeColors.analyst_note}`}>
                          <Tag size={10} />
                          {(insight.insight_type || 'note').replace(/_/g, ' ')}
                        </span>
                        <span className="text-sm font-medium text-slate-200">{insight.content ? insight.content.substring(0, 60) + (insight.content.length > 60 ? '...' : '') : ''}</span>
                      </div>
                      <button
                        onClick={() => {
                          if (insight.id) {
                            casesService.addCaseInsight(caseId, { ...insight, deleted: true }).then(() => {
                              queryClient.invalidateQueries({ queryKey: ['case-notebook', caseId] });
                            });
                          }
                        }}
                        className="text-slate-600 hover:text-red-400 transition-colors"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <p className="text-sm text-slate-400 leading-relaxed">{insight.content}</p>
                    {insight.created_at && (
                      <p className="text-[10px] text-slate-600 mt-2">
                        {format(new Date(insight.created_at), 'MMM d, yyyy HH:mm')}
                        {insight.created_by && ` by ${insight.created_by}`}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Timeline Tab */}
        {activeTab === 'timeline' && (
          <div className="space-y-0">
            {timeline.length === 0 ? (
              <div className="bg-slate-800 rounded-lg p-12 text-center border border-slate-700">
                <Activity size={36} className="mx-auto text-slate-700 mb-3" />
                <p className="text-sm text-slate-500">No timeline activity yet</p>
              </div>
            ) : (
              <div className="relative pl-8">
                {/* Vertical line */}
                <div className="absolute left-3 top-0 bottom-0 w-px bg-slate-700" />
                {timeline.map((event, i) => (
                  <div key={i} className="relative pb-6">
                    {/* Dot */}
                    <div
                      className={`absolute left-[-21px] top-1.5 w-3 h-3 rounded-full border-2 ${
                        event.type === 'entity_added'
                          ? 'bg-blue-500 border-blue-800'
                          : event.type === 'insight_added'
                          ? 'bg-green-500 border-green-800'
                          : event.type === 'status_change'
                          ? 'bg-amber-500 border-amber-800'
                          : 'bg-slate-500 border-slate-700'
                      }`}
                    />
                    <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-800 ml-2">
                      <div className="flex items-center justify-between">
                        <p className="text-sm text-slate-300">{event.description || event.action || 'Activity'}</p>
                        {event.type && (
                          <span className="rounded-full px-2 py-0.5 text-[10px] font-medium bg-slate-700 text-slate-400">
                            {event.type.replace(/_/g, ' ')}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-1">
                        {event.timestamp && (
                          <span className="text-xs text-slate-600">
                            {format(new Date(event.timestamp), 'MMM d, yyyy HH:mm:ss')}
                          </span>
                        )}
                        {event.user && (
                          <span className="text-xs text-slate-600">by {event.user}</span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Add Entity Modal */}
      <Modal isOpen={showAddEntity} onClose={() => setShowAddEntity(false)} title="Add Entity to Case">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            addEntityMutation.mutate({ entity_type: entityForm.entity_type, entity_id: entityForm.identifier });
          }}
          className="space-y-4"
        >
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1">Entity Type</label>
            <select
              value={entityForm.entity_type}
              onChange={(e) => setEntityForm({ ...entityForm, entity_type: e.target.value })}
              className="w-full bg-slate-800 border border-slate-600 text-slate-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="phone">Phone (MSISDN)</option>
              <option value="person">Person</option>
              <option value="device">Device (IMEI)</option>
              <option value="tower">Tower</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1">Identifier</label>
            <input
              type="text"
              value={entityForm.identifier}
              onChange={(e) => setEntityForm({ ...entityForm, identifier: e.target.value })}
              className="w-full bg-slate-800 border border-slate-600 text-slate-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Phone number, person ID, IMEI, or tower ID"
              required
            />
          </div>
          {addEntityMutation.isError && (
            <div className="flex items-center gap-2 text-sm text-red-400">
              <AlertCircle size={14} />
              Failed to add entity
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowAddEntity(false)}
              className="px-4 py-2 text-sm rounded-lg bg-slate-700 text-slate-300 hover:bg-slate-600 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={addEntityMutation.isPending}
              className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              {addEntityMutation.isPending ? 'Adding...' : 'Add Entity'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Add Insight Modal */}
      <Modal isOpen={showAddInsight} onClose={() => setShowAddInsight(false)} title="Add Insight">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            addInsightMutation.mutate({ insight_type: insightForm.type, content: insightForm.content });
          }}
          className="space-y-4"
        >
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1">Type</label>
            <select
              value={insightForm.type}
              onChange={(e) => setInsightForm({ ...insightForm, type: e.target.value })}
              className="w-full bg-slate-800 border border-slate-600 text-slate-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="fact">Fact</option>
              <option value="inference">Inference</option>
              <option value="model_summary">Model Summary</option>
              <option value="analyst_note">Analyst Note</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1">Title</label>
            <input
              type="text"
              value={insightForm.title}
              onChange={(e) => setInsightForm({ ...insightForm, title: e.target.value })}
              className="w-full bg-slate-800 border border-slate-600 text-slate-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Brief title"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1">Content</label>
            <textarea
              value={insightForm.content}
              onChange={(e) => setInsightForm({ ...insightForm, content: e.target.value })}
              className="w-full bg-slate-800 border border-slate-600 text-slate-100 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
              rows={4}
              placeholder="Describe the insight..."
              required
            />
          </div>
          {addInsightMutation.isError && (
            <div className="flex items-center gap-2 text-sm text-red-400">
              <AlertCircle size={14} />
              Failed to add insight
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowAddInsight(false)}
              className="px-4 py-2 text-sm rounded-lg bg-slate-700 text-slate-300 hover:bg-slate-600 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={addInsightMutation.isPending}
              className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              {addInsightMutation.isPending ? 'Adding...' : 'Add Insight'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
