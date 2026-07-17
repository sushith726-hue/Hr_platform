"""
s3_utils.py
===========
Centralised S3/MinIO client factory for TalentStream.

All configuration is read from environment variables (loaded via .env):
    S3_ENDPOINT     — full HTTPS endpoint, e.g. https://aiyoo.in:4443/s3
    S3_ACCESS_KEY   — MinIO / AWS access key
    S3_SECRET_KEY   — MinIO / AWS secret key
    S3_REGION       — region string, e.g. us-east-1
    S3_BUCKET       — target bucket, e.g. livekit-bucket
    S3_VERIFY_SSL   — "true" to verify TLS cert, "false" to skip (default)

Usage:
    from backend.s3_utils import get_s3_client, get_s3_resource, generate_presigned_url
"""

import os
import boto3
from botocore.client import Config


def _ssl_verify() -> bool:
    """Return True only when S3_VERIFY_SSL is explicitly set to 'true'."""
    return os.getenv("S3_VERIFY_SSL", "false").lower() == "true"


def get_s3_client():
    """
    Return a configured boto3 S3 client.

    Uses SigV4 signing, path-style access, and the unified HTTPS endpoint
    defined in S3_ENDPOINT.  SSL verification is controlled by S3_VERIFY_SSL.
    """
    return boto3.client(
        "s3",
        endpoint_url=os.getenv("S3_ENDPOINT"),
        aws_access_key_id=os.getenv("S3_ACCESS_KEY"),
        aws_secret_access_key=os.getenv("S3_SECRET_KEY"),
        config=Config(signature_version="s3v4"),
        region_name=os.getenv("S3_REGION", "us-east-1"),
        verify=_ssl_verify(),
    )


def get_s3_resource():
    """
    Return a configured boto3 S3 resource (high-level API).

    Mirrors get_s3_client() settings so both can be used interchangeably
    depending on whether you need low-level client methods or OO bucket/object access.
    """
    return boto3.resource(
        "s3",
        endpoint_url=os.getenv("S3_ENDPOINT"),
        aws_access_key_id=os.getenv("S3_ACCESS_KEY"),
        aws_secret_access_key=os.getenv("S3_SECRET_KEY"),
        config=Config(signature_version="s3v4"),
        region_name=os.getenv("S3_REGION", "us-east-1"),
        verify=_ssl_verify(),
    )


def generate_presigned_url(object_key: str, expiration: int = 3600) -> str:
    """
    Generate a time-limited presigned GET URL for an S3 object.

    Args:
        object_key: S3 key of the object (without the bucket prefix).
        expiration: URL validity in seconds (default 1 hour).

    Returns:
        A presigned URL string that allows unauthenticated GET access
        to the object for the specified duration.
    """
    s3 = get_s3_client()
    return s3.generate_presigned_url(
        "get_object",
        Params={"Bucket": os.getenv("S3_BUCKET"), "Key": object_key},
        ExpiresIn=expiration,
    )
