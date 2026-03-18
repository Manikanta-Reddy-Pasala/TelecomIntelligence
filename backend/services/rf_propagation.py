"""RF Propagation models: Free-space, Okumura-Hata, COST-231."""

import math


def free_space_path_loss(frequency_mhz: float, distance_km: float) -> float:
    """Free-space path loss (FSPL) in dB."""
    if distance_km <= 0 or frequency_mhz <= 0:
        return 0.0
    return 20 * math.log10(distance_km) + 20 * math.log10(frequency_mhz) + 32.44


def hata_mobile_correction(frequency_mhz: float, mobile_height_m: float, environment: str) -> float:
    """Hata mobile antenna height correction factor a(h_m)."""
    if environment == "urban_large":
        if frequency_mhz >= 400:
            return 3.2 * (math.log10(11.75 * mobile_height_m)) ** 2 - 4.97
        return 8.29 * (math.log10(1.54 * mobile_height_m)) ** 2 - 1.1
    # Small/medium city
    return (1.1 * math.log10(frequency_mhz) - 0.7) * mobile_height_m - (1.56 * math.log10(frequency_mhz) - 0.8)


def okumura_hata(
    frequency_mhz: float,
    base_height_m: float,
    mobile_height_m: float,
    distance_km: float,
    environment: str = "urban",
) -> float:
    """
    Okumura-Hata path loss model (dB).
    Valid: 150-1500 MHz, 1-20 km, base 30-200m, mobile 1-10m.
    """
    if distance_km <= 0:
        return 0.0
    distance_km = max(distance_km, 0.01)

    f = frequency_mhz
    h_b = max(base_height_m, 1.0)
    h_m = max(mobile_height_m, 1.0)
    d = distance_km

    a_hm = hata_mobile_correction(f, h_m, environment)

    L = (
        69.55
        + 26.16 * math.log10(f)
        - 13.82 * math.log10(h_b)
        - a_hm
        + (44.9 - 6.55 * math.log10(h_b)) * math.log10(d)
    )

    if environment == "suburban":
        L -= 2 * (math.log10(f / 28)) ** 2 - 5.4
    elif environment == "rural":
        L -= 4.78 * (math.log10(f)) ** 2 + 18.33 * math.log10(f) - 40.94

    return L


def cost231_hata(
    frequency_mhz: float,
    base_height_m: float,
    mobile_height_m: float,
    distance_km: float,
    environment: str = "urban",
) -> float:
    """
    COST-231 Hata model (dB). Extension of Okumura-Hata to 1500-2000 MHz.
    """
    if distance_km <= 0:
        return 0.0
    distance_km = max(distance_km, 0.01)

    f = frequency_mhz
    h_b = max(base_height_m, 1.0)
    h_m = max(mobile_height_m, 1.0)
    d = distance_km

    a_hm = hata_mobile_correction(f, h_m, environment)
    C_m = 3.0 if environment in ("urban", "urban_large") else 0.0

    L = (
        46.3
        + 33.9 * math.log10(f)
        - 13.82 * math.log10(h_b)
        - a_hm
        + (44.9 - 6.55 * math.log10(h_b)) * math.log10(d)
        + C_m
    )

    return L


def select_model(frequency_mhz: float):
    """Select best propagation model based on frequency."""
    if frequency_mhz <= 1500:
        return "okumura_hata", okumura_hata
    return "cost231_hata", cost231_hata


def path_loss(
    frequency_mhz: float,
    base_height_m: float,
    mobile_height_m: float,
    distance_km: float,
    environment: str = "urban",
) -> float:
    """Calculate path loss using the best model for the frequency."""
    _, model_fn = select_model(frequency_mhz)
    return model_fn(frequency_mhz, base_height_m, mobile_height_m, distance_km, environment)


def signal_at_distance(
    tx_power_dbm: float,
    antenna_gain_dbi: float,
    frequency_mhz: float,
    base_height_m: float,
    mobile_height_m: float,
    distance_km: float,
    environment: str = "urban",
) -> float:
    """Received signal strength (dBm) at a given distance."""
    loss = path_loss(frequency_mhz, base_height_m, mobile_height_m, distance_km, environment)
    return tx_power_dbm + antenna_gain_dbi - loss


def max_range_km(
    tx_power_dbm: float,
    antenna_gain_dbi: float,
    frequency_mhz: float,
    base_height_m: float,
    mobile_height_m: float = 1.5,
    environment: str = "urban",
    sensitivity_dbm: float = -110.0,
) -> float:
    """Estimate max range where signal > sensitivity threshold."""
    # Binary search
    lo, hi = 0.01, 50.0
    for _ in range(50):
        mid = (lo + hi) / 2
        sig = signal_at_distance(tx_power_dbm, antenna_gain_dbi, frequency_mhz, base_height_m, mobile_height_m, mid, environment)
        if sig > sensitivity_dbm:
            lo = mid
        else:
            hi = mid
    return round(lo, 3)


def generate_coverage_grid(
    tower_lat: float,
    tower_lng: float,
    azimuth: float | None,
    tx_power_dbm: float,
    antenna_gain_dbi: float,
    frequency_mhz: float,
    base_height_m: float,
    environment: str = "urban",
    grid_points: int = 36,
    max_dist_km: float | None = None,
) -> list[dict]:
    """Generate coverage points around a tower for heatmap visualization."""
    if max_dist_km is None:
        max_dist_km = max_range_km(tx_power_dbm, antenna_gain_dbi, frequency_mhz, base_height_m, environment=environment)

    points = []
    # Generate points at multiple distances and bearings
    bearings = range(0, 360, 360 // max(grid_points, 1)) if grid_points > 0 else [0]
    distances = [max_dist_km * f for f in [0.1, 0.25, 0.5, 0.75, 1.0]]

    for bearing_deg in bearings:
        # If azimuth is set, only show within ~60 degrees of sector
        if azimuth is not None:
            angle_diff = abs(bearing_deg - azimuth)
            if angle_diff > 180:
                angle_diff = 360 - angle_diff
            if angle_diff > 60:
                continue

        bearing_rad = math.radians(bearing_deg)
        for dist_km in distances:
            # Approximate lat/lng offset
            dlat = (dist_km / 111.0) * math.cos(bearing_rad)
            dlng = (dist_km / (111.0 * math.cos(math.radians(tower_lat)))) * math.sin(bearing_rad)

            sig = signal_at_distance(
                tx_power_dbm, antenna_gain_dbi, frequency_mhz, base_height_m, 1.5, dist_km, environment,
            )
            if sig > -120:  # Only include points with some signal
                points.append({
                    "latitude": round(tower_lat + dlat, 6),
                    "longitude": round(tower_lng + dlng, 6),
                    "signal_dbm": round(sig, 1),
                    "distance_m": round(dist_km * 1000, 0),
                })

    return points
