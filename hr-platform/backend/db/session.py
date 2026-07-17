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

def get_s3_client(public: bool = False):
    """
    Returns a configured boto3 client for S3/MinIO bucket operations
    using credentials and endpoints loaded from settings.
    By default (public=False), resolves to the internal container endpoint (http://minio:9000)
    when running inside Docker.
    """
    import os
    import socket

    endpoint = settings.S3_ENDPOINT
    verify_ssl = settings.S3_VERIFY_SSL

    if not public:
        # Resolve to internal container if inside Docker network
        try:
            socket.gethostbyname("minio")
            endpoint = "http://minio:9000"
            verify_ssl = False
        except socket.gaierror:
            # If not in Docker but localhost:9000 is open, use localhost
            if endpoint and "localhost" not in endpoint and "127.0.0.1" not in endpoint:
                try:
                    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                    s.settimeout(0.5)
                    s.connect(("127.0.0.1", 9000))
                    s.close()
                    endpoint = "http://127.0.0.1:9000"
                    verify_ssl = False
                except Exception:
                    pass

    # Force signature version s3v4 to be fully compatible with MinIO and secure S3 configurations
    s3_client = boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=settings.S3_ACCESS_KEY,
        aws_secret_access_key=settings.S3_SECRET_KEY,
        config=Config(signature_version="s3v4"),
        region_name=settings.S3_REGION,
        verify=verify_ssl
    )

    # Workaround for proxy path-stripping issue on our S3 endpoint (SignatureDoesNotMatch)
    # We strip '/s3/' from the request path before it is signed, and restore it after signing.
    if endpoint and "/s3" in endpoint:
        def before_sign(request, **kwargs):
            if "/s3/" in request.url:
                request.url = request.url.replace("/s3/", "/")

        def request_created(request, **kwargs):
            import urllib.parse
            parsed = urllib.parse.urlparse(endpoint)
            netloc = parsed.netloc
            parts = request.url.split(netloc + "/")
            if len(parts) == 2 and not parts[1].startswith("s3/"):
                request.url = parts[0] + netloc + "/s3/" + parts[1]

        s3_client.meta.events.register("before-sign.s3", before_sign)
        s3_client.meta.events.register("request-created.s3", request_created)

    return s3_client

