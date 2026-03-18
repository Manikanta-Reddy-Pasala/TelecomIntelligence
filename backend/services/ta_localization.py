"""Timing Advance based localization and triangulation."""

import math
from datetime import datetime, timedelta

from sqlalchemy import select, desc, and_
from sqlalchemy.ext.asyncio import AsyncSession

from models.database import Tower, LocationEvent, CallRecord


# TA distance constants
TA_GSM_STEP_M = 550   # GSM: 1 TA unit = 550m
TA_LTE_STEP_M = 78    # LTE: 1 TA unit = 78m

# Environment adjustment factors
ENV_FACTORS = {
    "urban": 0.7,
    "urban_large": 0.65,
    "suburban": 0.85,
    "rural": 1.0,
}


def ta_to_distance(ta_value: int, technology: str = "GSM", environment: str = "urban") -> tuple[float, float]:
    """
    Convert TA value to distance in meters.
    Returns (raw_distance, adjusted_distance).
    """
    if technology.upper() == "LTE":
        raw = ta_value * TA_LTE_STEP_M
    else:
        raw = ta_value * TA_GSM_STEP_M

    factor = ENV_FACTORS.get(environment, 0.7)
    adjusted = raw * factor
    return raw, adjusted


def validate_ta(ta_value: int, technology: str, environment: str, max_range_m: float = 35000) -> tuple[bool, str]:
    """Validate a TA reading."""
    raw, _ = ta_to_distance(ta_value, technology, environment)

    if ta_value < 0:
        return False, "Negative TA value"
    if technology.upper() == "GSM" and ta_value > 63:
        return False, "GSM TA max is 63"
    if technology.upper() == "LTE" and ta_value > 1282:
        return False, "LTE TA max is 1282"
    if raw > max_range_m:
        return False, f"Distance {raw:.0f}m exceeds max range {max_range_m:.0f}m"

    return True, "Valid"


def _haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Haversine distance in meters."""
    R = 6371000
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlng / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _offset_lat_lng(lat: float, lng: float, dist_m: float, bearing_deg: float) -> tuple[float, float]:
    """Offset a lat/lng by distance and bearing."""
    R = 6371000
    bearing_rad = math.radians(bearing_deg)
    lat_rad = math.radians(lat)
    lng_rad = math.radians(lng)
    d = dist_m / R

    new_lat = math.asin(math.sin(lat_rad) * math.cos(d) + math.cos(lat_rad) * math.sin(d) * math.cos(bearing_rad))
    new_lng = lng_rad + math.atan2(
        math.sin(bearing_rad) * math.sin(d) * math.cos(lat_rad),
        math.cos(d) - math.sin(lat_rad) * math.sin(new_lat),
    )
    return math.degrees(new_lat), math.degrees(new_lng)


def triangulate(readings: list[dict]) -> dict | None:
    """
    Triangulate position from multiple TA readings.
    Each reading: {lat, lng, distance_m}
    Returns {latitude, longitude, accuracy_m} or None.
    """
    if not readings:
        return None

    if len(readings) == 1:
        r = readings[0]
        # Single tower: position at tower with accuracy = TA distance
        return {
            "latitude": r["lat"],
            "longitude": r["lng"],
            "accuracy_m": r["distance_m"],
            "method": "single_tower",
        }

    if len(readings) == 2:
        # Two towers: midpoint of intersection area
        r1, r2 = readings[0], readings[1]
        tower_dist = _haversine_m(r1["lat"], r1["lng"], r2["lat"], r2["lng"])

        if tower_dist == 0:
            return {
                "latitude": r1["lat"],
                "longitude": r1["lng"],
                "accuracy_m": (r1["distance_m"] + r2["distance_m"]) / 2,
                "method": "two_tower",
            }

        # Weighted average by inverse distance
        w1 = 1.0 / max(r1["distance_m"], 1)
        w2 = 1.0 / max(r2["distance_m"], 1)
        wt = w1 + w2
        lat = (r1["lat"] * w1 + r2["lat"] * w2) / wt
        lng = (r1["lng"] * w1 + r2["lng"] * w2) / wt

        # Accuracy: overlap area
        accuracy = min(r1["distance_m"], r2["distance_m"]) * 0.7
        return {
            "latitude": round(lat, 6),
            "longitude": round(lng, 6),
            "accuracy_m": round(accuracy, 1),
            "method": "two_tower",
        }

    # 3+ towers: least-squares minimization (iterative)
    # Start from centroid
    lat_est = sum(r["lat"] for r in readings) / len(readings)
    lng_est = sum(r["lng"] for r in readings) / len(readings)

    for _ in range(100):
        grad_lat = 0.0
        grad_lng = 0.0
        for r in readings:
            dist = _haversine_m(lat_est, lng_est, r["lat"], r["lng"])
            err = dist - r["distance_m"]
            if dist > 0:
                grad_lat += err * (lat_est - r["lat"]) / dist
                grad_lng += err * (lng_est - r["lng"]) / dist

        step = 0.00001
        lat_est -= step * grad_lat
        lng_est -= step * grad_lng

    # Compute accuracy as RMS error
    errors = []
    for r in readings:
        dist = _haversine_m(lat_est, lng_est, r["lat"], r["lng"])
        errors.append((dist - r["distance_m"]) ** 2)
    rms = math.sqrt(sum(errors) / len(errors)) if errors else 500

    return {
        "latitude": round(lat_est, 6),
        "longitude": round(lng_est, 6),
        "accuracy_m": round(min(rms, 5000), 1),
        "method": "triangulation",
    }


def generate_probability_heatmap(
    center_lat: float,
    center_lng: float,
    accuracy_m: float,
    readings: list[dict],
    grid_size: int = 20,
) -> list[dict]:
    """Generate a probability heatmap around the estimated location."""
    points = []
    step_m = max(accuracy_m / (grid_size / 2), 10)

    for i in range(-grid_size // 2, grid_size // 2 + 1):
        for j in range(-grid_size // 2, grid_size // 2 + 1):
            dlat = (i * step_m) / 111000
            dlng = (j * step_m) / (111000 * math.cos(math.radians(center_lat)))
            plat = center_lat + dlat
            plng = center_lng + dlng

            # Probability based on consistency with all TA readings
            prob = 1.0
            for r in readings:
                dist = _haversine_m(plat, plng, r["lat"], r["lng"])
                err = abs(dist - r["distance_m"])
                # Gaussian-like probability
                sigma = r["distance_m"] * 0.3
                prob *= math.exp(-(err ** 2) / (2 * max(sigma, 1) ** 2))

            if prob > 0.001:
                points.append({
                    "latitude": round(plat, 6),
                    "longitude": round(plng, 6),
                    "probability": round(prob, 4),
                })

    # Normalize
    max_prob = max((p["probability"] for p in points), default=1)
    if max_prob > 0:
        for p in points:
            p["probability"] = round(p["probability"] / max_prob, 4)

    return points


async def get_ta_readings_for_msisdn(
    db: AsyncSession,
    msisdn: str,
    hours: int = 24,
    environment: str = "urban",
) -> list[dict]:
    """Fetch recent location events and synthesize TA readings."""
    cutoff = datetime.utcnow() - timedelta(hours=hours)

    stmt = (
        select(LocationEvent, Tower)
        .join(Tower, LocationEvent.tower_id == Tower.id)
        .where(
            and_(
                LocationEvent.msisdn == msisdn,
                LocationEvent.timestamp >= cutoff,
                LocationEvent.signal_strength.isnot(None),
            )
        )
        .order_by(desc(LocationEvent.timestamp))
        .limit(50)
    )
    result = await db.execute(stmt)
    rows = result.all()

    readings = []
    seen_towers = set()

    for loc_event, tower in rows:
        if tower.tower_id in seen_towers:
            continue
        seen_towers.add(tower.tower_id)

        # Derive TA from signal strength (approximation when real TA not available)
        # Signal strength to approximate distance: stronger = closer
        signal = loc_event.signal_strength or -85
        # Rough mapping: -50 dBm ~ 100m, -110 dBm ~ 5000m
        approx_distance = max(50, min(10000, 100 * (10 ** ((-50 - signal) / 30))))

        technology = "LTE" if tower.tower_type == "micro" else "GSM"
        if technology == "LTE":
            ta_val = max(0, min(1282, int(approx_distance / TA_LTE_STEP_M)))
        else:
            ta_val = max(0, min(63, int(approx_distance / TA_GSM_STEP_M)))

        raw_dist, adj_dist = ta_to_distance(ta_val, technology, environment)

        readings.append({
            "tower_id": tower.tower_id,
            "tower_lat": tower.latitude,
            "tower_lng": tower.longitude,
            "azimuth": tower.azimuth,
            "ta_value": ta_val,
            "technology": technology,
            "distance_m": raw_dist,
            "adjusted_distance_m": adj_dist,
            "timestamp": loc_event.timestamp,
            "lat": tower.latitude,
            "lng": tower.longitude,
        })

    return readings
