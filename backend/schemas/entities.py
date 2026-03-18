from datetime import datetime, date
from typing import Optional

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Person
# ---------------------------------------------------------------------------

class PersonCreate(BaseModel):
    name: str = Field(max_length=256)
    aliases: Optional[list[str]] = None
    nationality: Optional[str] = None
    date_of_birth: Optional[date] = None
    risk_score: float = 0.0
    watchlist_status: bool = False
    notes: Optional[str] = None


class PersonUpdate(BaseModel):
    name: Optional[str] = None
    aliases: Optional[list[str]] = None
    nationality: Optional[str] = None
    date_of_birth: Optional[date] = None
    risk_score: Optional[float] = None
    watchlist_status: Optional[bool] = None
    notes: Optional[str] = None


class PhoneNumberBrief(BaseModel):
    id: int
    msisdn: str
    status: str
    carrier: Optional[str] = None
    model_config = {"from_attributes": True}


class DeviceBrief(BaseModel):
    id: int
    imei: str
    brand: Optional[str] = None
    model: Optional[str] = None
    model_config = {"from_attributes": True}


class PersonResponse(BaseModel):
    id: int
    name: str
    aliases: Optional[list[str]] = None
    nationality: Optional[str] = None
    date_of_birth: Optional[date] = None
    risk_score: float
    watchlist_status: bool
    notes: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    phone_numbers: list[PhoneNumberBrief] = []
    devices: list[DeviceBrief] = []

    model_config = {"from_attributes": True}


class PersonListResponse(BaseModel):
    id: int
    name: str
    nationality: Optional[str] = None
    risk_score: float
    watchlist_status: bool
    created_at: datetime

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# PhoneNumber
# ---------------------------------------------------------------------------

class PhoneNumberCreate(BaseModel):
    msisdn: str = Field(max_length=20)
    person_id: Optional[int] = None
    activation_date: Optional[date] = None
    status: str = "active"
    carrier: Optional[str] = None


class PhoneNumberResponse(BaseModel):
    id: int
    msisdn: str
    person_id: Optional[int] = None
    activation_date: Optional[date] = None
    status: str
    carrier: Optional[str] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class PhoneDetailResponse(PhoneNumberResponse):
    person: Optional[PersonListResponse] = None
    call_count: int = 0
    message_count: int = 0
    first_seen: Optional[datetime] = None
    last_seen: Optional[datetime] = None


# ---------------------------------------------------------------------------
# Device
# ---------------------------------------------------------------------------

class DeviceCreate(BaseModel):
    imei: str = Field(max_length=20)
    brand: Optional[str] = None
    model: Optional[str] = None
    person_id: Optional[int] = None


class DeviceResponse(BaseModel):
    id: int
    imei: str
    brand: Optional[str] = None
    model: Optional[str] = None
    person_id: Optional[int] = None
    created_at: datetime

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# SIM
# ---------------------------------------------------------------------------

class SIMCreate(BaseModel):
    imsi: str = Field(max_length=20)
    iccid: str = Field(max_length=22)
    phone_number_id: Optional[int] = None
    device_id: Optional[int] = None
    status: str = "active"


class SIMResponse(BaseModel):
    id: int
    imsi: str
    iccid: str
    phone_number_id: Optional[int] = None
    device_id: Optional[int] = None
    status: str
    created_at: datetime

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# Tower
# ---------------------------------------------------------------------------

class TowerCreate(BaseModel):
    tower_id: str = Field(max_length=32)
    latitude: float
    longitude: float
    azimuth: Optional[float] = None
    sector: Optional[int] = None
    address: Optional[str] = None
    city: Optional[str] = None
    region: Optional[str] = None
    tower_type: str = "macro"


class TowerResponse(BaseModel):
    id: int
    tower_id: str
    latitude: float
    longitude: float
    azimuth: Optional[float] = None
    sector: Optional[int] = None
    address: Optional[str] = None
    city: Optional[str] = None
    region: Optional[str] = None
    tower_type: str
    created_at: datetime

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# Unified search
# ---------------------------------------------------------------------------

class SearchResult(BaseModel):
    entity_type: str
    entity_id: str
    label: str
    detail: Optional[str] = None
    score: float = 1.0
