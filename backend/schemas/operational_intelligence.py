"""Pydantic request/response models for Operational Intelligence module."""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# RF Propagation
# ---------------------------------------------------------------------------

class RFProfileResponse(BaseModel):
    tower_id: str
    frequency_mhz: float
    power_dbm: float
    antenna_height_m: float
    antenna_gain_dbi: float
    environment: str
    propagation_model: str
    max_range_m: float
    path_loss_at_distances: dict  # {distance_m: loss_db}

    model_config = {"from_attributes": True}


class CoveragePoint(BaseModel):
    latitude: float
    longitude: float
    signal_dbm: float
    distance_m: float


class RFCoverageResponse(BaseModel):
    tower_id: str
    tower_lat: float
    tower_lng: float
    azimuth: Optional[float]
    environment: str
    coverage_points: list[CoveragePoint]
    max_range_m: float


# ---------------------------------------------------------------------------
# TA Localization
# ---------------------------------------------------------------------------

class TAReading(BaseModel):
    tower_id: str
    tower_lat: float
    tower_lng: float
    azimuth: Optional[float]
    ta_value: int
    technology: str  # GSM or LTE
    distance_m: float
    adjusted_distance_m: float
    timestamp: datetime


class LocationEstimate(BaseModel):
    latitude: float
    longitude: float
    accuracy_m: float
    method: str  # single_tower, two_tower, triangulation
    readings_used: int
    confidence: float


class LocateResponse(BaseModel):
    msisdn: str
    location: Optional[LocationEstimate]
    ta_readings: list[TAReading]
    message: str


class PrecisionHeatmapPoint(BaseModel):
    latitude: float
    longitude: float
    probability: float


class PrecisionHeatmapResponse(BaseModel):
    msisdn: str
    center: Optional[LocationEstimate]
    heatmap_points: list[PrecisionHeatmapPoint]
    readings_used: int


class TAValidationResult(BaseModel):
    tower_id: str
    ta_value: int
    distance_m: float
    expected_environment: str
    is_valid: bool
    reason: str


class TAValidateResponse(BaseModel):
    msisdn: str
    validations: list[TAValidationResult]
    valid_count: int
    invalid_count: int


# ---------------------------------------------------------------------------
# Cell Recommendation
# ---------------------------------------------------------------------------

class CellScore(BaseModel):
    tower_id: str
    tower_db_id: int
    latitude: float
    longitude: float
    address: Optional[str]
    total_score: float
    usage_score: float
    recency_score: float
    time_consistency_score: float
    capture_success_score: float
    rf_suitability_score: float
    visit_count: int
    last_seen: Optional[datetime]
    recommended_times: list[str]  # e.g. ["22:00-02:00", "06:00-08:00"]


class CellRecommendationResponse(BaseModel):
    msisdn: str
    recommendations: list[CellScore]
    analysis_period_days: int
    total_towers_analyzed: int
    time_of_day_heatmap: dict  # {hour: count}


# ---------------------------------------------------------------------------
# Capture History
# ---------------------------------------------------------------------------

class CaptureHistoryCreate(BaseModel):
    msisdn: str
    method: str  # tower_dump, targeted_cdr, realtime_intercept, location_track, imsi_catcher
    cells_used: list[str] = Field(default_factory=list)
    success: bool
    duration_hours: float = 0.0
    time_of_day: Optional[str] = None  # morning, afternoon, evening, night
    notes: Optional[str] = None
    case_id: Optional[int] = None


class CaptureHistoryResponse(BaseModel):
    id: int
    msisdn: str
    method: str
    cells_used: list
    success: bool
    duration_hours: float
    time_of_day: Optional[str]
    notes: Optional[str]
    case_id: Optional[int]
    analyst_id: Optional[int]
    created_at: datetime

    model_config = {"from_attributes": True}


class CaptureMetrics(BaseModel):
    total_captures: int
    success_rate: float
    by_method: dict  # {method: {total, success, rate}}
    by_time_of_day: dict  # {time: {total, success, rate}}
    avg_duration_hours: float
    most_effective_method: Optional[str]
    most_effective_time: Optional[str]


class SimilarCapture(BaseModel):
    capture: CaptureHistoryResponse
    similarity_score: float
    common_cells: list[str]


# ---------------------------------------------------------------------------
# Operational Playbooks
# ---------------------------------------------------------------------------

class PlaybookStep(BaseModel):
    step_number: int
    title: str
    description: str
    tool: Optional[str] = None  # which TIAC feature to use
    estimated_minutes: int = 30
    required: bool = True


class PlaybookResponse(BaseModel):
    id: int
    name: str
    target_type: str  # drug, fraud, terror, kidnap, organized_crime
    description: str
    steps: list
    estimated_hours: float
    success_rate: Optional[float]
    created_at: datetime

    model_config = {"from_attributes": True}


class PlaybookExecuteRequest(BaseModel):
    playbook_id: int
    msisdn: Optional[str] = None
    case_id: Optional[int] = None
    notes: Optional[str] = None


class StepUpdate(BaseModel):
    step_number: int
    status: str  # pending, in_progress, completed, skipped
    notes: Optional[str] = None
    result: Optional[str] = None


class PlaybookExecutionUpdate(BaseModel):
    step_updates: list[StepUpdate] = Field(default_factory=list)
    status: Optional[str] = None  # active, completed, aborted


class PlaybookExecutionResponse(BaseModel):
    id: int
    playbook_id: int
    playbook_name: Optional[str] = None
    msisdn: Optional[str]
    case_id: Optional[int]
    status: str
    step_progress: list
    started_at: datetime
    completed_at: Optional[datetime]
    analyst_id: Optional[int]
    notes: Optional[str]

    model_config = {"from_attributes": True}


class PlaybookSuggestResponse(BaseModel):
    suggested_playbook: Optional[PlaybookResponse]
    confidence: float
    reason: str
    alternative_playbooks: list[PlaybookResponse]


# ---------------------------------------------------------------------------
# Dashboard
# ---------------------------------------------------------------------------

class OpIntelDashboard(BaseModel):
    total_captures: int
    success_rate: float
    active_playbooks: int
    rf_profiles_count: int
    ta_measurements_count: int
    recent_captures: list[CaptureHistoryResponse]
    recent_executions: list[PlaybookExecutionResponse]
    top_methods: dict
