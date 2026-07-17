import os
from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import Optional

class Settings(BaseSettings):
    # Core Application
    API_ENV: str = "development"
    API_PORT: int = 8000
    SECRET_KEY: str = "dev-secret-key-replace-in-production"

    # Data Persistence
    DATABASE_URL: str
    REDIS_URL: str

    # S3 Object Storage
    S3_ENDPOINT: str
    S3_ACCESS_KEY: str
    S3_SECRET_KEY: str
    S3_BUCKET: str
    S3_REGION: str = "us-east-1"
    S3_VERIFY_SSL: bool = False

    # OpenAI Cognition
    OPENAI_API_KEY: str
    OPENAI_MODEL_FORMATTING: str = "gpt-4o-mini"
    OPENAI_MODEL_SCORING: str = "gpt-4o-mini"
    OPENAI_MODEL_WEIGHTS: str = "gpt-4o"
    OPENAI_BASE_URL: str = "https://api.openai.com/v1"

    # Third-Party Services
    LLAMAPARSE_API_KEY: str
    LLAMAPARSE_MODE: str = "agentic"

    SMALLEST_AI_API_KEY: str
    SMALLEST_AI_MODEL: str = "stt-1"
    SMALLEST_AI_LANGUAGE: str = "en"

    SENDGRID_API_KEY: str
    EMAIL_FROM_NAME: str = "TalentStream HR"
    EMAIL_FROM_ADDRESS: str = "noreply@yourcompany.com"

    # LiveKit WebRTC
    LIVEKIT_URL: str
    LIVEKIT_API_KEY: str
    LIVEKIT_SECRET: str
    LIVEKIT_API_SECRET: Optional[str] = None
    LIVEKIT_MAX_ROOM_DURATION_MINS: int = 35
    LIVEKIT_EMPTY_TIMEOUT_SEC: int = 600

    # Platform Rules & Limits
    DAILY_RESUME_LIMIT: int = 50
    MAX_INTERVIEW_DURATION_MINS: int = 35
    CELERY_STALE_CHECK_INTERVAL_SEC: int = 1800
    INVITE_TOKEN_TTL_SEC: int = 86400

    # Rate Limiting
    RATE_LIMIT_PUBLIC_INVITE: str = "10/minute"
    RATE_LIMIT_PUBLIC_START: str = "5/minute"
    RATE_LIMIT_PUBLIC_UPLOAD: str = "50/day"
    RATE_LIMIT_AUTH_JOBS: str = "20/minute"
    RATE_LIMIT_AUTH_INVITE: str = "10/minute"
    RATE_LIMIT_SSE_CONCURRENT: int = 5

    # Monitoring
    LOG_LEVEL: str = "INFO"
    ENABLE_AUDIT_LOG: bool = True
    SENTRY_DSN: Optional[str] = None

    # OpenAI Budget Guard (Phase 9)
    OPENAI_BUDGET_USD: float = 50.00           # Monthly hard cap in USD
    OPENAI_BUDGET_ALERT_PCT: float = 0.80      # Alert threshold (80% of cap)

    model_config = SettingsConfigDict(
        env_file=os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"),
        env_file_encoding="utf-8",
        extra="ignore"
    )

settings = Settings()
