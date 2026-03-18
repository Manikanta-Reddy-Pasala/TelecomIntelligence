"""Pydantic schemas for advanced analytics endpoints."""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class GeofenceRequest(BaseModel):
    lat_min: float = Field(..., description="Minimum latitude of bounding box")
    lat_max: float = Field(..., description="Maximum latitude of bounding box")
    lng_min: float = Field(..., description="Minimum longitude of bounding box")
    lng_max: float = Field(..., description="Maximum longitude of bounding box")
    date_from: Optional[datetime] = None
    date_to: Optional[datetime] = None


class CommonNumbersRequest(BaseModel):
    msisdns: list[str] = Field(..., min_length=2, max_length=10, description="List of MSISDNs to find common contacts for")


class ReportRequest(BaseModel):
    include_pattern_of_life: bool = True
    include_identity_changes: bool = True
    include_top_contacts: bool = True
    include_night_activity: bool = True
    include_stats: bool = True
    days: int = Field(30, ge=1, le=365)
