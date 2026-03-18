import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { entitiesService } from '../services/entities';
import { eventsService } from '../services/events';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorMessage from '../components/ErrorMessage';
import {
  ArrowLeft,
  UserCircle,
  Phone,
  Smartphone,
  CreditCard,
  Shield,
  Activity,
  Clock,
  MapPin,
  AlertTriangle,
} from 'lucide-react';
import { format } from 'date-fns';

function PhoneCard({ phone, onSelect }) {
  return (
    <div
      className="flex items-center justify-between p-4 rounded-lg bg-slate-800/50 border border-slate-700 hover:border-slate-600 transition-colors cursor-pointer"
      onClick={() => onSelect(phone.msisdn || phone)}
    >
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-green-500/10 border border-green-500/20 flex items-center justify-center">
          <Phone size={16} className="text-green-400" />
        </div>
        <div>
          <div className="text-sm font-mono text-slate-200">{phone.msisdn || phone}</div>
          <div className="flex items-center gap-2 mt-0.5">
            {phone.carrier && <span className="text-xs text-slate-500">{phone.carrier}</span>}
            {phone.imei && <span className="text-xs text-slate-600 font-mono">IMEI: {phone.imei}</span>}
          </div>
        </div>
      </div>
      {phone.status && (
        <span
          className={`rounded-full px-2 py-1 text-xs font-medium ${
            phone.status === 'active'
              ? 'bg-green-500/20 text-green-400'
              : 'bg-slate-500/20 text-slate-400'
          }`}
        >
          {phone.status}
        </span>
      )}
    </div>
  );
}

function CDRTable({ msisdn }) {
  const { data, isLoading } = useQuery({
    queryKey: ['cdr', msisdn],
    queryFn: () => eventsService.getCalls(msisdn, null, null, 1, 50),
    enabled: Boolean(msisdn),
  });

  if (isLoading) return <LoadingSpinner size="sm" text="Loading CDR..." />;

  const records = data?.records || data?.calls || data || [];

  if (records.length === 0) {
    return <p className="text-sm text-slate-600 text-center py-4">No call records found</p>;
  }

  return (
    <div className="overflow-auto max-h-80">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-slate-900">
          <tr>
            <th className="text-left px-3 py-2 text-xs font-medium text-slate-500 uppercase border-b border-slate-800">Time</th>
            <th className="text-left px-3 py-2 text-xs font-medium text-slate-500 uppercase border-b border-slate-800">Type</th>
            <th className="text-left px-3 py-2 text-xs font-medium text-slate-500 uppercase border-b border-slate-800">Other Party</th>
            <th className="text-left px-3 py-2 text-xs font-medium text-slate-500 uppercase border-b border-slate-800">Duration</th>
            <th className="text-left px-3 py-2 text-xs font-medium text-slate-500 uppercase border-b border-slate-800">Tower</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800/50">
          {records.map((rec, i) => (
            <tr key={i} className="hover:bg-slate-800/30 even:bg-slate-800/20">
              <td className="px-3 py-2 text-slate-400 font-mono text-xs">
                {rec.start_time || rec.timestamp ? format(new Date(rec.start_time || rec.timestamp), 'MMM d HH:mm:ss') : '--'}
              </td>
              <td className="px-3 py-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    rec.call_type === 'incoming' || rec.type === 'call'
                      ? 'bg-blue-500/20 text-blue-400'
                      : rec.call_type === 'outgoing'
                      ? 'bg-green-500/20 text-green-400'
                      : 'bg-slate-500/20 text-slate-400'
                  }`}
                >
                  {rec.call_type || rec.type || 'call'}
                </span>
              </td>
              <td className="px-3 py-2 text-slate-300 font-mono text-xs">{rec.callee_msisdn || rec.caller_msisdn || rec.other_party || rec.to || '--'}</td>
              <td className="px-3 py-2 text-slate-400 text-xs">{rec.duration_seconds != null ? `${rec.duration_seconds}s` : rec.duration ? `${rec.duration}s` : '--'}</td>
              <td className="px-3 py-2 text-slate-500 text-xs">{rec.status || rec.tower_id || '--'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function EntityDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [selectedPhoneMsisdn, setSelectedPhoneMsisdn] = useState(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['person', id],
    queryFn: () => entitiesService.getPerson(id),
  });

  if (isLoading) return <LoadingSpinner text="Loading entity details..." />;
  if (error) return <ErrorMessage message="Failed to load entity" onRetry={refetch} />;

  const person = data?.person || data || {};
  const phones = person.phone_numbers || person.phones || [];
  const devices = person.devices || [];
  const aliases = person.aliases || [];
  const recentActivity = person.recent_activity || [];

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Back */}
      <button
        onClick={() => navigate('/entities')}
        className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-200 transition-colors"
      >
        <ArrowLeft size={14} />
        Back to entities
      </button>

      {/* Profile Header */}
      <div className="bg-slate-800 rounded-lg shadow-lg p-6 border border-slate-700">
        <div className="flex items-start gap-5">
          <div className="w-16 h-16 rounded-xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center shrink-0">
            <UserCircle size={32} className="text-blue-400" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-xl font-bold text-slate-100">{person.name || 'Unknown Person'}</h1>
              {person.watchlist_status && (
                <span className="rounded-full px-2 py-1 text-xs font-medium bg-red-500/20 text-red-400 flex items-center gap-1">
                  <AlertTriangle size={10} />
                  {person.watchlist_status}
                </span>
              )}
              {person.risk_score != null && (
                <span
                  className={`rounded-full px-2 py-1 text-xs font-medium ${
                    person.risk_score >= 0.7
                      ? 'bg-red-500/20 text-red-400'
                      : person.risk_score >= 0.4
                      ? 'bg-yellow-500/20 text-yellow-400'
                      : 'bg-green-500/20 text-green-400'
                  }`}
                >
                  {person.risk_score >= 0.7 ? 'high' : person.risk_score >= 0.4 ? 'medium' : 'low'} risk
                </span>
              )}
            </div>
            <p className="text-xs font-mono text-slate-500 mt-1">ID: {person.id || id}</p>
            {aliases.length > 0 && (
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <span className="text-xs text-slate-500">Aliases:</span>
                {aliases.map((alias, i) => (
                  <span key={i} className="rounded-full px-2 py-0.5 text-xs bg-slate-700 text-slate-300">
                    {alias}
                  </span>
                ))}
              </div>
            )}
          </div>
          {person.risk_score !== undefined && (
            <div className="text-right shrink-0">
              <div className="text-xs text-slate-500 uppercase tracking-wider">Risk Score</div>
              <div
                className={`text-3xl font-bold mt-1 ${
                  person.risk_score >= 0.7
                    ? 'text-red-400'
                    : person.risk_score >= 0.4
                    ? 'text-yellow-400'
                    : 'text-green-400'
                }`}
              >
                {(person.risk_score * 100).toFixed(0)}%
              </div>
            </div>
          )}
        </div>

        {/* Summary Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
          <div className="bg-slate-900/50 rounded-lg p-3 border border-slate-800">
            <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
              <Phone size={12} />
              Phones
            </div>
            <div className="text-lg font-semibold text-slate-200">{phones.length}</div>
          </div>
          <div className="bg-slate-900/50 rounded-lg p-3 border border-slate-800">
            <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
              <Smartphone size={12} />
              Devices
            </div>
            <div className="text-lg font-semibold text-slate-200">{devices.length}</div>
          </div>
          <div className="bg-slate-900/50 rounded-lg p-3 border border-slate-800">
            <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
              <Activity size={12} />
              Recent Events
            </div>
            <div className="text-lg font-semibold text-slate-200">{recentActivity.length}</div>
          </div>
          <div className="bg-slate-900/50 rounded-lg p-3 border border-slate-800">
            <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
              <Shield size={12} />
              Status
            </div>
            <div className="text-lg font-semibold text-slate-200 capitalize">{person.status || 'active'}</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Linked Phones */}
        <div className="bg-slate-800 rounded-lg shadow-lg p-5 border border-slate-700">
          <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-4 flex items-center gap-2">
            <Phone size={14} className="text-green-400" />
            Linked Phones ({phones.length})
          </h2>
          {phones.length === 0 ? (
            <p className="text-sm text-slate-600 text-center py-6">No phones linked</p>
          ) : (
            <div className="space-y-2">
              {phones.map((phone, i) => (
                <PhoneCard key={i} phone={phone} onSelect={setSelectedPhoneMsisdn} />
              ))}
            </div>
          )}
        </div>

        {/* Linked Devices */}
        <div className="bg-slate-800 rounded-lg shadow-lg p-5 border border-slate-700">
          <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-4 flex items-center gap-2">
            <Smartphone size={14} className="text-purple-400" />
            Devices ({devices.length})
          </h2>
          {devices.length === 0 ? (
            <p className="text-sm text-slate-600 text-center py-6">No devices linked</p>
          ) : (
            <div className="space-y-2">
              {devices.map((device, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between p-4 rounded-lg bg-slate-800/50 border border-slate-700"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center justify-center">
                      <Smartphone size={16} className="text-purple-400" />
                    </div>
                    <div>
                      <div className="text-sm text-slate-200">{device.model || 'Unknown Device'}</div>
                      {device.imei && (
                        <div className="text-xs font-mono text-slate-500">IMEI: {device.imei}</div>
                      )}
                      {device.imsi && (
                        <div className="text-xs font-mono text-slate-600">IMSI: {device.imsi}</div>
                      )}
                    </div>
                  </div>
                  {device.first_seen && (
                    <span className="text-xs text-slate-600">
                      Since {format(new Date(device.first_seen), 'MMM yyyy')}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* CDR for selected phone */}
      {selectedPhoneMsisdn && (
        <div className="bg-slate-800 rounded-lg shadow-lg p-5 border border-slate-700">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-2">
              <CreditCard size={14} />
              CDR for {selectedPhoneMsisdn}
            </h2>
            <button
              onClick={() => setSelectedPhoneMsisdn(null)}
              className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
            >
              Close
            </button>
          </div>
          <CDRTable msisdn={selectedPhoneMsisdn} />
        </div>
      )}

      {/* Recent Activity */}
      <div className="bg-slate-800 rounded-lg shadow-lg p-5 border border-slate-700">
        <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-4 flex items-center gap-2">
          <Clock size={14} />
          Recent Activity
        </h2>
        {recentActivity.length === 0 ? (
          <p className="text-sm text-slate-600 text-center py-6">No recent activity</p>
        ) : (
          <div className="space-y-2 max-h-80 overflow-auto">
            {recentActivity.map((act, i) => (
              <div
                key={i}
                className="flex items-start gap-3 p-3 rounded-lg bg-slate-800/30 border border-slate-800/50"
              >
                <div
                  className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${
                    act.type === 'call'
                      ? 'bg-blue-500'
                      : act.type === 'sms'
                      ? 'bg-green-500'
                      : act.type === 'location'
                      ? 'bg-purple-500'
                      : 'bg-slate-500'
                  }`}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-slate-300">{act.description || act.type || 'Event'}</p>
                  <div className="flex items-center gap-3 mt-0.5">
                    {act.timestamp && (
                      <span className="text-xs text-slate-600">
                        {format(new Date(act.timestamp), 'MMM d, HH:mm:ss')}
                      </span>
                    )}
                    {act.location && (
                      <span className="text-xs text-slate-600 flex items-center gap-1">
                        <MapPin size={10} />
                        {act.location}
                      </span>
                    )}
                  </div>
                </div>
                {act.type && (
                  <span className="rounded-full px-2 py-0.5 text-[10px] font-medium bg-slate-700 text-slate-400">
                    {act.type}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
