from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class CallRecordResponse(BaseModel):
    id: int
    caller_msisdn: str
    callee_msisdn: str
    caller_tower_id: Optional[int] = None
    callee_tower_id: Optional[int] = None
    start_time: datetime
    end_time: Optional[datetime] = None
    duration_seconds: int
    call_type: str
    status: str
    transcript: Optional[str] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class MessageResponse(BaseModel):
    id: int
    sender_msisdn: str
    receiver_msisdn: str
    timestamp: datetime
    message_type: str
    content_preview: Optional[str] = None
    content_summary: Optional[str] = None
    tower_id: Optional[int] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class LocationEventResponse(BaseModel):
    id: int
    msisdn: str
    tower_id: Optional[int] = None
    timestamp: datetime
    event_type: str
    lac: Optional[int] = None
    cell_id: Optional[int] = None
    signal_strength: Optional[float] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class DataSessionResponse(BaseModel):
    id: int
    msisdn: str
    tower_id: Optional[int] = None
    start_time: datetime
    end_time: Optional[datetime] = None
    bytes_uploaded: int
    bytes_downloaded: int
    created_at: datetime

    model_config = {"from_attributes": True}


class TimelineEvent(BaseModel):
    event_type: str  # call/message/location/data
    timestamp: datetime
    msisdn: str
    detail: dict
