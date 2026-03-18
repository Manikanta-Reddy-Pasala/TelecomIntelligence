"""API endpoints for Operational Intelligence module."""

from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import select, func

from api.deps import DB, CurrentUser
from models.database import (
    Tower, TowerRFProfile, TAMeasurement, CaptureHistory,
    OperationalPlaybook, PlaybookExecution,
)
from schemas.operational_intelligence import (
    CellRecommendationResponse, LocateResponse, PrecisionHeatmapResponse,
    TAValidateResponse, RFCoverageResponse, CoveragePoint,
    CaptureHistoryCreate, CaptureHistoryResponse, CaptureMetrics,
    PlaybookResponse, PlaybookExecuteRequest, PlaybookExecutionUpdate,
    PlaybookExecutionResponse, PlaybookSuggestResponse,
    OpIntelDashboard, RFProfileResponse,
)
from services.rf_propagation import (
    generate_coverage_grid, path_loss, signal_at_distance,
    max_range_km, select_model,
)
from services.ta_localization import (
    get_ta_readings_for_msisdn, triangulate, generate_probability_heatmap,
    validate_ta, ta_to_distance,
)
from services.cell_recommendation import recommend_cells
from services import capture_history as capture_svc
from services import operational_playbook as playbook_svc

router = APIRouter(prefix="/api/ops", tags=["operational-intelligence"])


# ---------------------------------------------------------------------------
# Cell Recommendations
# ---------------------------------------------------------------------------

@router.get("/recommend-cells/{msisdn}")
async def get_cell_recommendations(
    msisdn: str,
    db: DB,
    user: CurrentUser,
    days: int = Query(90, ge=1, le=365),
    top_n: int = Query(20, ge=1, le=100),
):
    """Rank towers for a target MSISDN based on usage, recency, and capture history."""
    result = await recommend_cells(db, msisdn, days=days, top_n=top_n)
    return result


# ---------------------------------------------------------------------------
# TA Precision Location
# ---------------------------------------------------------------------------

@router.get("/locate/{msisdn}")
async def locate_msisdn(
    msisdn: str,
    db: DB,
    user: CurrentUser,
    hours: int = Query(24, ge=1, le=720),
    environment: str = Query("urban"),
):
    """Locate a target using TA-based triangulation."""
    readings = await get_ta_readings_for_msisdn(db, msisdn, hours=hours, environment=environment)

    if not readings:
        return LocateResponse(
            msisdn=msisdn,
            location=None,
            ta_readings=[],
            message="No recent location data available",
        )

    # Use adjusted distances for triangulation
    tri_input = [
        {"lat": r["tower_lat"], "lng": r["tower_lng"], "distance_m": r["adjusted_distance_m"]}
        for r in readings[:5]  # Use top 5 most recent
    ]
    location = triangulate(tri_input)

    ta_readings = [
        {
            "tower_id": r["tower_id"],
            "tower_lat": r["tower_lat"],
            "tower_lng": r["tower_lng"],
            "azimuth": r["azimuth"],
            "ta_value": r["ta_value"],
            "technology": r["technology"],
            "distance_m": r["distance_m"],
            "adjusted_distance_m": r["adjusted_distance_m"],
            "timestamp": r["timestamp"],
        }
        for r in readings
    ]

    return LocateResponse(
        msisdn=msisdn,
        location=location,
        ta_readings=ta_readings,
        message=f"Located using {len(tri_input)} tower(s), method: {location['method']}" if location else "Could not triangulate",
    )


@router.get("/precision-heatmap/{msisdn}")
async def get_precision_heatmap(
    msisdn: str,
    db: DB,
    user: CurrentUser,
    hours: int = Query(24, ge=1, le=720),
    grid_size: int = Query(20, ge=5, le=50),
):
    """Generate a probability heatmap for target location."""
    readings = await get_ta_readings_for_msisdn(db, msisdn, hours=hours)

    if not readings:
        return PrecisionHeatmapResponse(
            msisdn=msisdn, center=None, heatmap_points=[], readings_used=0,
        )

    tri_input = [
        {"lat": r["tower_lat"], "lng": r["tower_lng"], "distance_m": r["adjusted_distance_m"]}
        for r in readings[:5]
    ]
    location = triangulate(tri_input)

    if not location:
        return PrecisionHeatmapResponse(
            msisdn=msisdn, center=None, heatmap_points=[], readings_used=0,
        )

    heatmap = generate_probability_heatmap(
        location["latitude"], location["longitude"],
        location["accuracy_m"], tri_input, grid_size=grid_size,
    )

    return PrecisionHeatmapResponse(
        msisdn=msisdn,
        center=location,
        heatmap_points=heatmap,
        readings_used=len(tri_input),
    )


@router.get("/ta-validate/{msisdn}")
async def validate_ta_readings(
    msisdn: str,
    db: DB,
    user: CurrentUser,
    hours: int = Query(24, ge=1, le=720),
):
    """Validate TA readings for a target MSISDN."""
    readings = await get_ta_readings_for_msisdn(db, msisdn, hours=hours)

    validations = []
    for r in readings:
        # Get RF profile for tower if available
        rf_stmt = select(TowerRFProfile).where(TowerRFProfile.tower_id == r["tower_id"])
        rf_result = await db.execute(rf_stmt)
        rf = rf_result.scalar_one_or_none()
        max_range = rf.max_range_m if rf else 35000
        env = rf.environment if rf else "urban"

        is_valid, reason = validate_ta(r["ta_value"], r["technology"], env, max_range)
        validations.append({
            "tower_id": r["tower_id"],
            "ta_value": r["ta_value"],
            "distance_m": r["distance_m"],
            "expected_environment": env,
            "is_valid": is_valid,
            "reason": reason,
        })

    valid_count = sum(1 for v in validations if v["is_valid"])
    return TAValidateResponse(
        msisdn=msisdn,
        validations=validations,
        valid_count=valid_count,
        invalid_count=len(validations) - valid_count,
    )


# ---------------------------------------------------------------------------
# RF Model
# ---------------------------------------------------------------------------

@router.get("/rf-model/{tower_id}")
async def get_rf_model(
    tower_id: str,
    db: DB,
    user: CurrentUser,
):
    """Get RF propagation model and coverage for a tower."""
    # Find tower
    tower_stmt = select(Tower).where(Tower.tower_id == tower_id)
    tower_result = await db.execute(tower_stmt)
    tower = tower_result.scalar_one_or_none()
    if not tower:
        raise HTTPException(status_code=404, detail="Tower not found")

    # Get RF profile
    rf_stmt = select(TowerRFProfile).where(TowerRFProfile.tower_id == tower_id)
    rf_result = await db.execute(rf_stmt)
    rf = rf_result.scalar_one_or_none()

    # Defaults
    freq = rf.frequency_mhz if rf else 900.0
    power = rf.power_dbm if rf else 43.0
    height = rf.antenna_height_m if rf else 30.0
    gain = rf.antenna_gain_dbi if rf else 15.0
    env = rf.environment if rf else "urban"

    model_name, _ = select_model(freq)
    max_r = max_range_km(power, gain, freq, height, environment=env)

    # Path loss at various distances
    distances = [100, 250, 500, 1000, 1500, 2000, 3000, 5000]
    path_losses = {}
    for d in distances:
        loss = path_loss(freq, height, 1.5, d / 1000, env)
        path_losses[d] = round(loss, 1)

    # Generate coverage
    coverage = generate_coverage_grid(
        tower.latitude, tower.longitude, tower.azimuth,
        power, gain, freq, height, env,
    )

    return RFCoverageResponse(
        tower_id=tower_id,
        tower_lat=tower.latitude,
        tower_lng=tower.longitude,
        azimuth=tower.azimuth,
        environment=env,
        coverage_points=[CoveragePoint(**p) for p in coverage],
        max_range_m=round(max_r * 1000, 0),
    )


# ---------------------------------------------------------------------------
# Capture History
# ---------------------------------------------------------------------------

@router.get("/capture-history")
async def list_captures(
    db: DB,
    user: CurrentUser,
    msisdn: Optional[str] = Query(None),
    method: Optional[str] = Query(None),
    success: Optional[bool] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    captures = await capture_svc.get_captures(db, msisdn=msisdn, method=method, success=success, limit=limit, offset=offset)
    return [CaptureHistoryResponse.model_validate(c) for c in captures]


@router.post("/capture-history")
async def create_capture(
    body: CaptureHistoryCreate,
    db: DB,
    user: CurrentUser,
):
    cap = await capture_svc.create_capture(
        db, body.msisdn, body.method, body.cells_used, body.success,
        body.duration_hours, body.time_of_day, body.notes, body.case_id, user.id,
    )
    return CaptureHistoryResponse.model_validate(cap)


@router.get("/capture-history/similar/{msisdn}")
async def find_similar_captures(
    msisdn: str,
    db: DB,
    user: CurrentUser,
    limit: int = Query(10, ge=1, le=50),
):
    results = await capture_svc.find_similar(db, msisdn, limit=limit)
    return [
        {
            "capture": CaptureHistoryResponse.model_validate(r["capture"]),
            "similarity_score": r["similarity_score"],
            "common_cells": r["common_cells"],
        }
        for r in results
    ]


@router.get("/capture-history/metrics")
async def get_capture_metrics(db: DB, user: CurrentUser):
    return await capture_svc.get_metrics(db)


# ---------------------------------------------------------------------------
# Playbooks
# ---------------------------------------------------------------------------

@router.get("/playbooks")
async def list_playbooks(
    db: DB,
    user: CurrentUser,
    target_type: Optional[str] = Query(None),
):
    playbooks = await playbook_svc.get_playbooks(db, target_type=target_type)
    return [PlaybookResponse.model_validate(p) for p in playbooks]


@router.get("/playbooks/{playbook_id}")
async def get_playbook(
    playbook_id: int,
    db: DB,
    user: CurrentUser,
):
    pb = await playbook_svc.get_playbook(db, playbook_id)
    if not pb:
        raise HTTPException(status_code=404, detail="Playbook not found")
    return PlaybookResponse.model_validate(pb)


@router.post("/playbooks/execute")
async def execute_playbook(
    body: PlaybookExecuteRequest,
    db: DB,
    user: CurrentUser,
):
    try:
        execution = await playbook_svc.start_execution(
            db, body.playbook_id, body.msisdn, body.case_id, user.id, body.notes,
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return {
        "id": execution.id,
        "playbook_id": execution.playbook_id,
        "status": execution.status,
        "step_progress": execution.step_progress,
        "started_at": execution.started_at,
    }


@router.put("/playbooks/executions/{execution_id}")
async def update_execution(
    execution_id: int,
    body: PlaybookExecutionUpdate,
    db: DB,
    user: CurrentUser,
):
    step_updates = [u.model_dump() for u in body.step_updates] if body.step_updates else None
    execution = await playbook_svc.update_execution(db, execution_id, step_updates, body.status)
    if not execution:
        raise HTTPException(status_code=404, detail="Execution not found")
    return {
        "id": execution.id,
        "status": execution.status,
        "step_progress": execution.step_progress,
        "completed_at": execution.completed_at,
    }


@router.get("/playbooks/executions")
async def list_executions(
    db: DB,
    user: CurrentUser,
    status: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    return await playbook_svc.get_executions(db, status=status, limit=limit, offset=offset)


@router.post("/playbooks/suggest")
async def suggest_playbook(
    db: DB,
    user: CurrentUser,
    msisdn: str = Query(...),
):
    result = await playbook_svc.suggest_playbook(db, msisdn)
    return {
        "suggested_playbook": PlaybookResponse.model_validate(result["suggested_playbook"]) if result["suggested_playbook"] else None,
        "confidence": result["confidence"],
        "reason": result["reason"],
        "alternative_playbooks": [PlaybookResponse.model_validate(p) for p in result["alternative_playbooks"]],
    }


# ---------------------------------------------------------------------------
# Dashboard
# ---------------------------------------------------------------------------

@router.get("/dashboard")
async def get_dashboard(db: DB, user: CurrentUser):
    """Operational intelligence dashboard summary."""
    # Capture stats
    from sqlalchemy import select, func
    total_cap = (await db.execute(select(func.count(CaptureHistory.id)))).scalar() or 0
    success_cap = (await db.execute(
        select(func.count(CaptureHistory.id)).where(CaptureHistory.success == True)
    )).scalar() or 0
    success_rate = round(success_cap / max(total_cap, 1), 3)

    # Active playbook executions
    active_pb = (await db.execute(
        select(func.count(PlaybookExecution.id)).where(PlaybookExecution.status == "active")
    )).scalar() or 0

    # RF profiles count
    rf_count = (await db.execute(select(func.count(TowerRFProfile.id)))).scalar() or 0

    # TA measurements count
    ta_count = (await db.execute(select(func.count(TAMeasurement.id)))).scalar() or 0

    # Recent captures
    recent_caps = await capture_svc.get_captures(db, limit=5)

    # Recent executions
    recent_execs = await playbook_svc.get_executions(db, limit=5)

    # Top methods
    metrics = await capture_svc.get_metrics(db)

    return {
        "total_captures": total_cap,
        "success_rate": success_rate,
        "active_playbooks": active_pb,
        "rf_profiles_count": rf_count,
        "ta_measurements_count": ta_count,
        "recent_captures": [CaptureHistoryResponse.model_validate(c) for c in recent_caps],
        "recent_executions": recent_execs,
        "top_methods": metrics.get("by_method", {}),
    }
