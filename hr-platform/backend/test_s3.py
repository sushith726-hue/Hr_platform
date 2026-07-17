import sys
import os

# Add parent directory to path so we can import backend
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.config import settings
from backend.db.session import get_s3_client

def verify_s3_connection():
    print(f"Connecting to S3 endpoint: {settings.S3_ENDPOINT}")
    print(f"Target Bucket: {settings.S3_BUCKET}")
    
    try:
        s3 = get_s3_client()
        
        # Test 1: List objects in bucket
        print("Testing ListObjects...")
        response = s3.list_objects_v2(Bucket=settings.S3_BUCKET, MaxKeys=5)
        print("ListObjects successful!")
        
        # Test 2: Upload/write a test file
        test_key = "connection_test.txt"
        print(f"Testing PutObject with key '{test_key}'...")
        s3.put_object(
            Bucket=settings.S3_BUCKET,
            Key=test_key,
            Body=b"TalentStream S3 Connection Verification Success!"
        )
        print("PutObject successful!")
        
        # Test 3: Read back test file
        print(f"Testing GetObject with key '{test_key}'...")
        obj = s3.get_object(Bucket=settings.S3_BUCKET, Key=test_key)
        data = obj["Body"].read()
        print(f"Read successful! Content: '{data.decode()}'")
        
        # Test 4: Delete test file
        print(f"Testing DeleteObject with key '{test_key}'...")
        s3.delete_object(Bucket=settings.S3_BUCKET, Key=test_key)
        print("DeleteObject successful!")
        
        print("\n>>> S3 / MINIO CONNECTION VERIFIED SUCCESSFULLY! <<<")
        return True
    except Exception as e:
        print(f"\n>>> S3 CONNECTION FAILED: {str(e)} <<<", file=sys.stderr)
        return False

if __name__ == "__main__":
    success = verify_s3_connection()
    sys.exit(0 if success else 1)
