import os
from datetime import timedelta


DATABASE_URL: str = os.getenv(
    "DATABASE_URL",
    "postgresql+asyncpg://tiac:tiac123@localhost:5432/tiac",
)

OLLAMA_URL: str = os.getenv("OLLAMA_URL", "http://localhost:11434")
OLLAMA_MODEL: str = os.getenv("OLLAMA_MODEL", "tinyllama")

SECRET_KEY: str = os.getenv(
    "SECRET_KEY",
    "a9f84c2e7b3d1056e8f9a2c4d6b8e0f1234567890abcdef1234567890abcdef",
)
ALGORITHM: str = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES: int = 480

CORS_ORIGINS: list[str] = os.getenv(
    "CORS_ORIGINS",
    "http://localhost:3000,http://localhost:5173,http://localhost:5174",
).split(",")
