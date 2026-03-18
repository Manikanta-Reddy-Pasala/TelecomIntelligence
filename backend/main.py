import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import CORS_ORIGINS
from models.database import create_tables

from api.auth import router as auth_router
from api.entities import router as entities_router
from api.events import router as events_router
from api.investigation import router as investigation_router
from api.analytics import router as analytics_router
from api.copilot import router as copilot_router
from api.audit import router as audit_router
from api.advanced_analytics import router as advanced_router

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting up -- creating database tables")
    await create_tables()
    logger.info("Database tables ready")
    yield
    logger.info("Shutting down")


app = FastAPI(
    title="Telecom Intelligence Analyst Copilot (TIAC)",
    description="Telecom CDR investigation tool with AI copilot",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(entities_router)
app.include_router(events_router)
app.include_router(investigation_router)
app.include_router(analytics_router)
app.include_router(copilot_router)
app.include_router(audit_router)
app.include_router(advanced_router)


@app.get("/health")
async def health_check():
    return {"status": "healthy", "service": "tiac-backend"}
