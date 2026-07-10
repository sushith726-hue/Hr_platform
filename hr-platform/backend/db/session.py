import boto3
from botocore.client import Config
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker
from backend.config import settings

# SQLAlchemy database session setup
# connection pool size of 20, max_overflow of 10, pool_pre_ping enabled to avoid stale connections
engine = create_engine(
    settings.DATABASE_URL,
    pool_size=20,
    max_overflow=10,
    pool_pre_ping=True,
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

def get_db():
    """Dependency provider for database sessions"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def get_s3_client():
    """
    Returns a configured boto3 client for S3/MinIO bucket operations
    using credentials and endpoints loaded from settings.
    """
    # Force signature version s3v4 to be fully compatible with MinIO and secure S3 configurations
    s3_client = boto3.client(
        "s3",
        endpoint_url=settings.S3_ENDPOINT,
        aws_access_key_id=settings.S3_ACCESS_KEY,
        aws_secret_access_key=settings.S3_SECRET_KEY,
        config=Config(signature_version="s3v4"),
        region_name=settings.S3_REGION
    )

    # Workaround for proxy path-stripping issue on our S3 endpoint (SignatureDoesNotMatch)
    # We strip '/s3/' from the request path before it is signed, and restore it after signing.
    if settings.S3_ENDPOINT and "/s3" in settings.S3_ENDPOINT:
        def before_sign(request, **kwargs):
            if "/s3/" in request.url:
                request.url = request.url.replace("/s3/", "/")

        def request_created(request, **kwargs):
            import urllib.parse
            parsed = urllib.parse.urlparse(settings.S3_ENDPOINT)
            netloc = parsed.netloc
            parts = request.url.split(netloc + "/")
            if len(parts) == 2 and not parts[1].startswith("s3/"):
                request.url = parts[0] + netloc + "/s3/" + parts[1]

        s3_client.meta.events.register("before-sign.s3", before_sign)
        s3_client.meta.events.register("request-created.s3", request_created)

    return s3_client

