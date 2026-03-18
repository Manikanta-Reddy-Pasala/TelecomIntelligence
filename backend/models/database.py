from datetime import datetime, date
from typing import Optional

from sqlalchemy import (
    Column,
    Integer,
    BigInteger,
    String,
    Text,
    Float,
    Boolean,
    DateTime,
    Date,
    JSON,
    ForeignKey,
    Index,
    Enum as SAEnum,
    func,
)
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase, relationship, Mapped, mapped_column

from config import DATABASE_URL

engine = create_async_engine(DATABASE_URL, echo=False, pool_size=20, max_overflow=10)
async_session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncSession:
    async with async_session_factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


async def create_tables():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


# ---------------------------------------------------------------------------
# Core entities
# ---------------------------------------------------------------------------

class Person(Base):
    __tablename__ = "persons"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(256), nullable=False, index=True)
    aliases: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    nationality: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    date_of_birth: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    risk_score: Mapped[float] = mapped_column(Float, default=0.0)
    watchlist_status: Mapped[bool] = mapped_column(Boolean, default=False)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    phone_numbers = relationship("PhoneNumber", back_populates="person", lazy="selectin")
    devices = relationship("Device", back_populates="person", lazy="selectin")


class PhoneNumber(Base):
    __tablename__ = "phone_numbers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    msisdn: Mapped[str] = mapped_column(String(20), nullable=False, index=True, unique=True)
    person_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("persons.id"), nullable=True, index=True)
    activation_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="active")  # active/inactive/suspended
    carrier: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    person = relationship("Person", back_populates="phone_numbers")
    sims = relationship("SIM", back_populates="phone_number", lazy="selectin")


class Device(Base):
    __tablename__ = "devices"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    imei: Mapped[str] = mapped_column(String(20), nullable=False, index=True, unique=True)
    brand: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    model: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    person_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("persons.id"), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    person = relationship("Person", back_populates="devices")
    sims = relationship("SIM", back_populates="device", lazy="selectin")


class SIM(Base):
    __tablename__ = "sims"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    imsi: Mapped[str] = mapped_column(String(20), nullable=False, index=True, unique=True)
    iccid: Mapped[str] = mapped_column(String(22), nullable=False, unique=True)
    phone_number_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("phone_numbers.id"), nullable=True, index=True)
    device_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("devices.id"), nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(20), default="active")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    phone_number = relationship("PhoneNumber", back_populates="sims")
    device = relationship("Device", back_populates="sims")


class Tower(Base):
    __tablename__ = "towers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tower_id: Mapped[str] = mapped_column(String(32), nullable=False, unique=True, index=True)
    latitude: Mapped[float] = mapped_column(Float, nullable=False)
    longitude: Mapped[float] = mapped_column(Float, nullable=False)
    azimuth: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    sector: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    address: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    city: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    region: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    tower_type: Mapped[str] = mapped_column(String(20), default="macro")  # macro/micro/pico
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    __table_args__ = (
        Index("idx_tower_geo", "latitude", "longitude"),
    )


# ---------------------------------------------------------------------------
# Event entities
# ---------------------------------------------------------------------------

class CallRecord(Base):
    __tablename__ = "call_records"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    caller_msisdn: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    callee_msisdn: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    caller_tower_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("towers.id"), nullable=True)
    callee_tower_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("towers.id"), nullable=True)
    start_time: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    end_time: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    duration_seconds: Mapped[int] = mapped_column(Integer, default=0)
    call_type: Mapped[str] = mapped_column(String(10), default="voice")  # voice/video
    status: Mapped[str] = mapped_column(String(10), default="answered")  # answered/missed/rejected
    transcript: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # call transcript/notes
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    caller_tower = relationship("Tower", foreign_keys=[caller_tower_id])
    callee_tower = relationship("Tower", foreign_keys=[callee_tower_id])

    __table_args__ = (
        Index("idx_call_caller_time", "caller_msisdn", "start_time"),
        Index("idx_call_callee_time", "callee_msisdn", "start_time"),
    )


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    sender_msisdn: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    receiver_msisdn: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    message_type: Mapped[str] = mapped_column(String(10), default="sms")  # sms/mms/chat
    content_preview: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    content_summary: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    tower_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("towers.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    tower = relationship("Tower", foreign_keys=[tower_id])

    __table_args__ = (
        Index("idx_msg_sender_time", "sender_msisdn", "timestamp"),
        Index("idx_msg_receiver_time", "receiver_msisdn", "timestamp"),
    )


class LocationEvent(Base):
    __tablename__ = "location_events"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    msisdn: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    tower_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("towers.id"), nullable=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    event_type: Mapped[str] = mapped_column(String(20), default="location_update")  # attach/detach/handover/location_update
    lac: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    cell_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    signal_strength: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    tower = relationship("Tower", foreign_keys=[tower_id])

    __table_args__ = (
        Index("idx_loc_msisdn_time", "msisdn", "timestamp"),
        Index("idx_loc_tower_time", "tower_id", "timestamp"),
    )


class DataSession(Base):
    __tablename__ = "data_sessions"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    msisdn: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    tower_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("towers.id"), nullable=True)
    start_time: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    end_time: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    bytes_uploaded: Mapped[int] = mapped_column(BigInteger, default=0)
    bytes_downloaded: Mapped[int] = mapped_column(BigInteger, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    tower = relationship("Tower", foreign_keys=[tower_id])

    __table_args__ = (
        Index("idx_ds_msisdn_time", "msisdn", "start_time"),
    )


# ---------------------------------------------------------------------------
# Investigation entities
# ---------------------------------------------------------------------------

class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(256), nullable=False)
    full_name: Mapped[str] = mapped_column(String(256), nullable=False)
    role: Mapped[str] = mapped_column(String(20), default="analyst")  # analyst/supervisor/admin/auditor
    email: Mapped[Optional[str]] = mapped_column(String(256), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class Case(Base):
    __tablename__ = "cases"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    case_number: Mapped[str] = mapped_column(String(32), nullable=False, unique=True, index=True)
    title: Mapped[str] = mapped_column(String(512), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="open")  # open/active/closed/archived
    priority: Mapped[str] = mapped_column(String(10), default="medium")  # low/medium/high/critical
    assigned_analyst_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    created_by_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    assigned_analyst = relationship("User", foreign_keys=[assigned_analyst_id])
    created_by = relationship("User", foreign_keys=[created_by_id])
    entities = relationship("CaseEntity", back_populates="case", lazy="selectin")
    insights = relationship("CaseInsight", back_populates="case", lazy="selectin")


class CaseEntity(Base):
    __tablename__ = "case_entities"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    case_id: Mapped[int] = mapped_column(Integer, ForeignKey("cases.id"), nullable=False, index=True)
    entity_type: Mapped[str] = mapped_column(String(20), nullable=False)  # person/phone/device/tower
    entity_id: Mapped[str] = mapped_column(String(64), nullable=False)
    added_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    case = relationship("Case", back_populates="entities")


class CaseInsight(Base):
    __tablename__ = "case_insights"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    case_id: Mapped[int] = mapped_column(Integer, ForeignKey("cases.id"), nullable=False, index=True)
    insight_type: Mapped[str] = mapped_column(String(20), nullable=False)  # fact/inference/model_summary/analyst_note
    content: Mapped[str] = mapped_column(Text, nullable=False)
    confidence_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    evidence_refs: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    created_by: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    case = relationship("Case", back_populates="insights")


# ---------------------------------------------------------------------------
# Audit
# ---------------------------------------------------------------------------

class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    action: Mapped[str] = mapped_column(String(128), nullable=False)
    query_text: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    llm_prompt: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    llm_response: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    data_accessed: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    ip_address: Mapped[Optional[str]] = mapped_column(String(45), nullable=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), index=True)

    user = relationship("User", foreign_keys=[user_id])


# ---------------------------------------------------------------------------
# Anomaly
# ---------------------------------------------------------------------------

class AnomalyAlert(Base):
    __tablename__ = "anomaly_alerts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    msisdn: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    anomaly_type: Mapped[str] = mapped_column(String(64), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    severity: Mapped[str] = mapped_column(String(10), default="medium")  # low/medium/high/critical
    detected_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    resolved: Mapped[bool] = mapped_column(Boolean, default=False)
    resolved_by: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    resolved_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    __table_args__ = (
        Index("idx_anomaly_msisdn_time", "msisdn", "detected_at"),
    )


# ---------------------------------------------------------------------------
# Operational Intelligence
# ---------------------------------------------------------------------------

class TowerRFProfile(Base):
    __tablename__ = "tower_rf_profiles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tower_id: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    frequency_mhz: Mapped[float] = mapped_column(Float, nullable=False)
    power_dbm: Mapped[float] = mapped_column(Float, default=43.0)
    antenna_height_m: Mapped[float] = mapped_column(Float, default=30.0)
    antenna_gain_dbi: Mapped[float] = mapped_column(Float, default=15.0)
    environment: Mapped[str] = mapped_column(String(20), default="urban")  # urban/suburban/rural
    propagation_model: Mapped[str] = mapped_column(String(32), default="okumura_hata")
    max_range_m: Mapped[float] = mapped_column(Float, default=2000.0)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class TAMeasurement(Base):
    __tablename__ = "ta_measurements"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    msisdn: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    tower_id: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    ta_value: Mapped[int] = mapped_column(Integer, nullable=False)
    technology: Mapped[str] = mapped_column(String(10), default="GSM")  # GSM/LTE
    ground_truth_lat: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    ground_truth_lng: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    measured_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    __table_args__ = (
        Index("idx_ta_msisdn_tower", "msisdn", "tower_id"),
    )


class CaptureHistory(Base):
    __tablename__ = "capture_history"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    msisdn: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    method: Mapped[str] = mapped_column(String(32), nullable=False)  # tower_dump/targeted_cdr/realtime_intercept/location_track/imsi_catcher
    cells_used: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    success: Mapped[bool] = mapped_column(Boolean, default=False)
    duration_hours: Mapped[float] = mapped_column(Float, default=0.0)
    time_of_day: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)  # morning/afternoon/evening/night
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    case_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("cases.id"), nullable=True)
    analyst_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    __table_args__ = (
        Index("idx_capture_msisdn_method", "msisdn", "method"),
    )


class CellRecommendation(Base):
    __tablename__ = "cell_recommendations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    msisdn: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    tower_id: Mapped[str] = mapped_column(String(32), nullable=False)
    score: Mapped[float] = mapped_column(Float, nullable=False)
    reasoning: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    generated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class OperationalPlaybook(Base):
    __tablename__ = "operational_playbooks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(256), nullable=False)
    target_type: Mapped[str] = mapped_column(String(32), nullable=False, index=True)  # drug/fraud/terror/kidnap/organized_crime
    description: Mapped[str] = mapped_column(Text, nullable=False)
    steps: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    estimated_hours: Mapped[float] = mapped_column(Float, default=8.0)
    success_rate: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class PlaybookExecution(Base):
    __tablename__ = "playbook_executions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    playbook_id: Mapped[int] = mapped_column(Integer, ForeignKey("operational_playbooks.id"), nullable=False, index=True)
    msisdn: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    case_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("cases.id"), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="active")  # active/completed/aborted
    step_progress: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    started_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    analyst_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    playbook = relationship("OperationalPlaybook", foreign_keys=[playbook_id])
