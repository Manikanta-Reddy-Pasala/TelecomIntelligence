import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import { entitiesService } from '../services/entities';
import { analyticsService } from '../services/analytics';
import LoadingSpinner from '../components/LoadingSpinner';
import {
  Search,
  Radio,
  MapPin,
  Clock,
  Layers,
  X,
} from 'lucide-react';
import { format } from 'date-fns';

// Fix default marker icon
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

const towerIcon = new L.DivIcon({
  html: `<div style="background:#3b82f6;width:12px;height:12px;border-radius:50%;border:2px solid #1e3a8a;box-shadow:0 0 6px rgba(59,130,246,0.5)"></div>`,
  className: '',
  iconSize: [12, 12],
  iconAnchor: [6, 6],
});

const activeTowerIcon = new L.DivIcon({
  html: `<div style="background:#f59e0b;width:16px;height:16px;border-radius:50%;border:2px solid #92400e;box-shadow:0 0 10px rgba(245,158,11,0.6)"></div>`,
  className: '',
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});

function interpolateColor(ratio) {
  // Green (0) -> Yellow (0.5) -> Red (1)
  const r = ratio < 0.5 ? Math.round(ratio * 2 * 255) : 255;
  const g = ratio < 0.5 ? 255 : Math.round((1 - (ratio - 0.5) * 2) * 255);
  return `rgb(${r},${g},0)`;
}

function makeTrailWaypointIcon(index, total) {
  let bg, border, label;
  if (index === 0) {
    bg = '#22c55e'; border = '#166534'; label = 'S';
  } else if (index === total - 1) {
    bg = '#ef4444'; border = '#991b1b'; label = 'E';
  } else {
    const ratio = index / (total - 1);
    bg = interpolateColor(ratio); border = '#334155'; label = `${index}`;
  }
  return new L.DivIcon({
    html: `<div style="background:${bg};width:24px;height:24px;border-radius:50%;border:2px solid ${border};display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:bold;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,0.8)">${label}</div>`,
    className: '',
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
}

function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
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

export default function MapView() {
  const [msisdn, setMsisdn] = useState('');
  const [trailMsisdn, setTrailMsisdn] = useState(null);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedTower, setSelectedTower] = useState(null);
  const [showHeatmap, setShowHeatmap] = useState(false);

  const { data: towersData, isLoading: towersLoading } = useQuery({
    queryKey: ['towers'],
    queryFn: () => entitiesService.getTowers(),
  });

  const { data: movementData, isLoading: movementLoading } = useQuery({
    queryKey: ['movement', trailMsisdn, startDate, endDate],
    queryFn: () => analyticsService.getMovement(trailMsisdn, startDate || undefined, endDate || undefined),
    enabled: Boolean(trailMsisdn),
  });

  const { data: towerActivity } = useQuery({
    queryKey: ['tower-activity', selectedTower],
    queryFn: () => analyticsService.getTowerActivity(selectedTower),
    enabled: Boolean(selectedTower),
  });

  const towers = towersData?.towers || towersData || [];
  const movement = movementData?.locations || movementData?.trail || movementData || [];

  const handleSearchTrail = (e) => {
    e.preventDefault();
    if (msisdn.trim()) {
      setTrailMsisdn(msisdn.trim());
    }
  };

  const trailPositions = movement
    .filter((p) => p.latitude && p.longitude)
    .map((p) => [p.latitude, p.longitude]);

  const fitBounds = trailPositions.length > 0
    ? trailPositions
    : towers.filter((t) => t.latitude && t.longitude).slice(0, 100).map((t) => [t.latitude, t.longitude]);

  const defaultCenter = fitBounds.length > 0
    ? [fitBounds[0][0], fitBounds[0][1]]
    : [20.5937, 78.9629]; // India center as fallback

  return (
    <div className="h-[calc(100vh-56px)] flex flex-col">
      {/* Controls Bar */}
      <div className="flex items-center gap-4 px-4 py-3 bg-slate-900/80 border-b border-slate-800 backdrop-blur-sm z-10 shrink-0">
        <form onSubmit={handleSearchTrail} className="flex gap-2 flex-1 max-w-lg">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              value={msisdn}
              onChange={(e) => setMsisdn(e.target.value)}
              placeholder="Enter MSISDN for movement trail..."
              className="input-field pl-9 text-sm py-1.5"
            />
          </div>
          <button type="submit" className="btn-primary text-xs py-1.5">
            Track
          </button>
        </form>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <Clock size={12} className="text-slate-500" />
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-300 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <span className="text-slate-600 text-xs">to</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-300 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <button
            onClick={() => setShowHeatmap(!showHeatmap)}
            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition-colors ${
              showHeatmap
                ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                : 'bg-slate-800 text-slate-400 border border-slate-700 hover:border-slate-600'
            }`}
          >
            <Layers size={12} />
            Heatmap
          </button>

          {trailMsisdn && (
            <button
              onClick={() => {
                setTrailMsisdn(null);
                setMsisdn('');
              }}
              className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 px-2 py-1.5"
            >
              <X size={12} />
              Clear trail
            </button>
          )}
        </div>
      </div>

      {/* Map */}
      <div className="flex-1 relative">
        {towersLoading && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-slate-950/50">
            <LoadingSpinner text="Loading tower data..." />
          </div>
        )}

        <MapContainer center={defaultCenter} zoom={10} className="h-full w-full" scrollWheelZoom={true}>
          <TileLayer
            attribution='&copy; <a href="https://carto.com">CARTO</a>'
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          />

          {fitBounds.length > 1 && <FitBounds bounds={fitBounds} />}

          {/* Tower markers - limited to 100 */}
          {towers
            .filter((t) => t.latitude && t.longitude)
            .slice(0, 100)
            .map((tower, i) => (
              <Marker
                key={tower.id || i}
                position={[tower.latitude, tower.longitude]}
                icon={selectedTower === tower.id ? activeTowerIcon : towerIcon}
                eventHandlers={{
                  click: () => setSelectedTower(tower.id),
                }}
              >
                <Popup>
                  <div className="text-xs min-w-[180px]">
                    <div className="font-semibold text-sm mb-1">{tower.tower_id || tower.name || tower.id}</div>
                    <div className="space-y-0.5 text-slate-300">
                      {tower.tower_id && <div><span className="text-slate-500">Tower ID:</span> {tower.tower_id}</div>}
                      {tower.address && <div><span className="text-slate-500">Address:</span> {tower.address}</div>}
                      {tower.city && <div><span className="text-slate-500">City:</span> {tower.city}</div>}
                      {tower.type && <div><span className="text-slate-500">Type:</span> {tower.type}</div>}
                      {tower.azimuth && <div><span className="text-slate-500">Azimuth:</span> {tower.azimuth}</div>}
                      <div>
                        <span className="text-slate-500">Coords:</span>{' '}
                        {tower.latitude.toFixed(5)}, {tower.longitude.toFixed(5)}
                      </div>
                      {towerActivity && selectedTower === tower.id && (
                        <div className="mt-1 pt-1 border-t border-slate-700">
                          <span className="text-slate-500">Activity:</span>{' '}
                          {towerActivity.total_events || towerActivity.count || 0} events
                        </div>
                      )}
                    </div>
                  </div>
                </Popup>
              </Marker>
            ))}

          {/* Movement trail - gradient polyline + key waypoints only */}
          {(() => {
            const validMovement = movement.filter((p) => p.latitude && p.longitude);
            if (validMovement.length === 0) return null;

            const totalPoints = validMovement.length;
            const skipN = Math.max(5, Math.floor(totalPoints / 10));
            const keyWaypoints = validMovement.filter((_, i) => i === 0 || i === totalPoints - 1 || i % skipN === 0);

            // Build gradient segments
            const segments = [];
            for (let i = 0; i < trailPositions.length - 1; i++) {
              const ratio = trailPositions.length > 2 ? i / (trailPositions.length - 2) : 0;
              segments.push(
                <Polyline
                  key={`seg-${i}`}
                  positions={[trailPositions[i], trailPositions[i + 1]]}
                  pathOptions={{ color: interpolateColor(ratio), weight: 3, opacity: 0.85 }}
                />
              );
            }

            return (
              <>
                {segments}
                {keyWaypoints.map((point, i) => {
                  const origIndex = validMovement.indexOf(point);
                  return (
                    <Marker
                      key={`trail-${i}`}
                      position={[point.latitude, point.longitude]}
                      icon={makeTrailWaypointIcon(i, keyWaypoints.length)}
                    >
                      <Popup>
                        <div className="text-xs">
                          <div className="font-semibold text-sm mb-1">
                            {i === 0 ? 'Start' : i === keyWaypoints.length - 1 ? 'Last seen' : `Waypoint ${i}`}
                            <span className="text-slate-400 font-normal ml-1">(#{origIndex + 1} of {totalPoints})</span>
                          </div>
                          {point.timestamp && (
                            <div>{format(new Date(point.timestamp), 'MMM d, HH:mm:ss')}</div>
                          )}
                          {point.tower_id && <div>Tower: {point.tower_id}</div>}
                          {point.city && <div>City: {point.city}</div>}
                          {point.signal_strength != null && <div>Signal: {point.signal_strength} dBm</div>}
                          <div>
                            {point.latitude.toFixed(5)}, {point.longitude.toFixed(5)}
                          </div>
                        </div>
                      </Popup>
                    </Marker>
                  );
                })}
              </>
            );
          })()}
        </MapContainer>

        {/* Movement loading overlay */}
        {movementLoading && (
          <div className="absolute bottom-4 left-4 z-20 card p-3 flex items-center gap-2 text-sm text-slate-400">
            <div className="w-4 h-4 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
            Loading movement trail...
          </div>
        )}

        {/* Trail info panel */}
        {trailMsisdn && movement.length > 0 && (() => {
          const validPts = movement.filter((p) => p.latitude && p.longitude);
          let totalDist = 0;
          for (let i = 1; i < validPts.length; i++) {
            totalDist += haversineDistance(validPts[i - 1].latitude, validPts[i - 1].longitude, validPts[i].latitude, validPts[i].longitude);
          }
          const uniqueTowers = new Set(movement.filter((p) => p.tower_id).map((p) => p.tower_id)).size;
          const firstTs = movement[0]?.timestamp ? new Date(movement[0].timestamp) : null;
          const lastTs = movement[movement.length - 1]?.timestamp ? new Date(movement[movement.length - 1].timestamp) : null;
          let timeSpan = '';
          if (firstTs && lastTs) {
            const diffMs = Math.abs(lastTs - firstTs);
            const hours = Math.floor(diffMs / 3600000);
            const mins = Math.floor((diffMs % 3600000) / 60000);
            timeSpan = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
          }

          return (
            <div className="absolute top-4 right-4 z-20 card p-4 w-64">
              <div className="flex items-center gap-2 mb-2">
                <MapPin size={14} className="text-green-400" />
                <span className="text-sm font-semibold text-slate-200">Movement Trail</span>
              </div>
              <div className="space-y-1 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-500">MSISDN</span>
                  <span className="text-slate-300 font-mono">{trailMsisdn}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Points</span>
                  <span className="text-slate-300">{movement.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Distance</span>
                  <span className="text-slate-300">{totalDist < 1 ? `${(totalDist * 1000).toFixed(0)} m` : `${totalDist.toFixed(1)} km`}</span>
                </div>
                {timeSpan && (
                  <div className="flex justify-between">
                    <span className="text-slate-500">Time span</span>
                    <span className="text-slate-300">{timeSpan}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-slate-500">Unique towers</span>
                  <span className="text-slate-300">{uniqueTowers}</span>
                </div>
                {firstTs && (
                  <div className="flex justify-between">
                    <span className="text-slate-500">First</span>
                    <span className="text-slate-300">{format(firstTs, 'MMM d HH:mm')}</span>
                  </div>
                )}
                {lastTs && (
                  <div className="flex justify-between">
                    <span className="text-slate-500">Last</span>
                    <span className="text-slate-300">{format(lastTs, 'MMM d HH:mm')}</span>
                  </div>
                )}
              </div>
            </div>
          );
        })()}

        {/* Legend */}
        <div className="absolute bottom-4 right-4 z-20 card p-3">
          <div className="space-y-1.5 text-xs">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-blue-500 border border-blue-800" />
              <span className="text-slate-400">Cell Tower</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-amber-500 border border-amber-800" />
              <span className="text-slate-400">Selected Tower</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-green-500 border border-green-800" />
              <span className="text-slate-400">Start point</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-red-500 border border-red-800" />
              <span className="text-slate-400">Last seen</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-1 rounded" style={{ background: 'linear-gradient(to right, #22c55e, #eab308, #ef4444)' }} />
              <span className="text-slate-400">Trail (time)</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
