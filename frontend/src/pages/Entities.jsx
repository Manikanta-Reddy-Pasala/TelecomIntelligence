import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { entitiesService } from '../services/entities';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorMessage from '../components/ErrorMessage';
import {
  Search,
  ChevronDown,
  ChevronRight,
  Phone,
  Smartphone,
  CreditCard,
  ExternalLink,
} from 'lucide-react';

function PersonRow({ person, onViewPhone }) {
  const [expanded, setExpanded] = useState(false);
  const navigate = useNavigate();

  return (
    <>
      <tr
        className="hover:bg-slate-800/30 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <td className="px-4 py-3">
          <span className="text-slate-500">
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </span>
        </td>
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-300">{person.name || 'Unknown'}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/entities/${person.id}`);
              }}
              className="text-slate-600 hover:text-blue-400 transition-colors"
              title="View full details"
            >
              <ExternalLink size={12} />
            </button>
          </div>
        </td>
        <td className="px-4 py-3 text-sm text-slate-400">
          {person.phone_numbers?.map((p) => p.msisdn || p).join(', ') || '--'}
        </td>
        <td className="px-4 py-3">
          {person.risk_score != null ? (
            <span
              className={`text-sm font-medium ${
                person.risk_score >= 0.7
                  ? 'text-red-400'
                  : person.risk_score >= 0.4
                  ? 'text-yellow-400'
                  : 'text-green-400'
              }`}
            >
              {(person.risk_score * 100).toFixed(0)}%
            </span>
          ) : (
            <span className="text-slate-600">--</span>
          )}
        </td>
        <td className="px-4 py-3">
          {person.watchlist_status ? (
            <span className="rounded-full px-2 py-1 text-xs font-medium bg-red-500/20 text-red-400">{person.watchlist_status}</span>
          ) : (
            <span className="text-xs text-slate-600">No</span>
          )}
        </td>
        <td className="px-4 py-3">
          <span className="text-xs text-slate-600">--</span>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={6} className="px-4 py-3 bg-slate-800/20">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pl-8">
              {/* Phones */}
              <div>
                <h4 className="text-xs font-semibold text-slate-500 uppercase mb-2 flex items-center gap-1">
                  <Phone size={12} /> Phones
                </h4>
                {person.phone_numbers && person.phone_numbers.length > 0 ? (
                  <div className="space-y-1.5">
                    {person.phone_numbers.map((phone, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-2 text-sm p-2 rounded bg-slate-800/50 cursor-pointer hover:bg-slate-700/50 transition-colors"
                        onClick={(e) => {
                          e.stopPropagation();
                          onViewPhone(phone.msisdn || phone);
                        }}
                      >
                        <span className="font-mono text-slate-300">{phone.msisdn || phone}</span>
                        {phone.carrier && <span className="text-xs text-slate-600">{phone.carrier}</span>}
                        <ExternalLink size={10} className="text-slate-600 ml-auto" />
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-600">No phones linked</p>
                )}
              </div>

              {/* Devices */}
              <div>
                <h4 className="text-xs font-semibold text-slate-500 uppercase mb-2 flex items-center gap-1">
                  <Smartphone size={12} /> Devices
                </h4>
                {person.devices && person.devices.length > 0 ? (
                  <div className="space-y-1.5">
                    {person.devices.map((dev, i) => (
                      <div key={i} className="flex items-center gap-2 text-sm p-2 rounded bg-slate-800/50">
                        <span className="text-slate-300">{dev.model || dev.imei || 'Unknown'}</span>
                        {dev.imei && <span className="text-xs font-mono text-slate-600">IMEI: {dev.imei}</span>}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-600">No devices linked</p>
                )}
              </div>

              {/* SIMs */}
              <div>
                <h4 className="text-xs font-semibold text-slate-500 uppercase mb-2 flex items-center gap-1">
                  <CreditCard size={12} /> SIM Cards
                </h4>
                {person.sims && person.sims.length > 0 ? (
                  <div className="space-y-1.5">
                    {person.sims.map((sim, i) => (
                      <div key={i} className="text-sm p-2 rounded bg-slate-800/50">
                        <span className="font-mono text-slate-300">{sim.iccid || sim.imsi || 'Unknown'}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-600">No SIM cards linked</p>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default function Entities() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['persons', page, search],
    queryFn: () => entitiesService.getPersons(search, page, 50),
  });

  const handleViewPhone = (msisdn) => {
    navigate(`/copilot`, { state: { prefill: `Show CDR summary for ${msisdn}` } });
  };

  const persons = data?.persons || data || [];

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Entities</h1>
          <p className="text-sm text-slate-500 mt-1">Persons, phones, devices, and SIMs</p>
        </div>
      </div>

      {/* Search */}
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search by name, MSISDN, or IMEI..."
            className="w-full bg-slate-800 border border-slate-600 text-slate-100 rounded-lg pl-10 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* Table */}
      <div className="bg-slate-800 rounded-lg shadow-lg border border-slate-700 overflow-hidden">
        {isLoading ? (
          <LoadingSpinner text="Loading entities..." />
        ) : error ? (
          <ErrorMessage message="Failed to load entities" onRetry={refetch} />
        ) : (
          <>
            <div className="overflow-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-slate-800/80">
                    <th className="w-10 px-4 py-3" />
                    <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider">Name</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider">Phone Numbers</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider">Risk Score</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider">Watchlist</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/50">
                  {persons.map((person, i) => (
                    <PersonRow key={person.id || i} person={person} onViewPhone={handleViewPhone} />
                  ))}
                </tbody>
              </table>
            </div>
            {persons.length === 0 && (
              <p className="text-sm text-slate-600 text-center py-8">No entities found</p>
            )}
          </>
        )}
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-600">Page {page}</span>
        <div className="flex gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-3 py-1.5 text-xs rounded-lg bg-slate-800 text-slate-400 border border-slate-700 hover:border-slate-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Previous
          </button>
          <button
            onClick={() => setPage((p) => p + 1)}
            disabled={persons.length < 50}
            className="px-3 py-1.5 text-xs rounded-lg bg-slate-800 text-slate-400 border border-slate-700 hover:border-slate-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
