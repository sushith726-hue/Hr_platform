import os
import json
import fcntl
from datetime import datetime, timezone

def log_pipeline_event(step: str, interview_id: int, status: str, details: dict):
    log_paths = [
        "/mnt/agents/output/interview_pipeline_logs.json",
        "/app/interview_pipeline_logs.json"
    ]
    
    # Ensure details is JSON serializable and handle potential exceptions gracefully
    serializable_details = {}
    if isinstance(details, dict):
        for k, v in details.items():
            try:
                json.dumps({k: v})
                serializable_details[k] = v
            except Exception:
                serializable_details[k] = str(v)
    else:
        serializable_details = {"raw": str(details)}

    entry = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "step": step,
        "interview_id": interview_id,
        "status": status,
        "details": serializable_details
    }
    
    for path in log_paths:
        try:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            # Open file in read/write/create mode
            fd = os.open(path, os.O_RDWR | os.O_CREAT)
            try:
                # Acquire exclusive lock
                fcntl.flock(fd, fcntl.LOCK_EX)
                # Read existing logs
                size = os.lseek(fd, 0, os.SEEK_END)
                if size == 0:
                    logs = []
                else:
                    os.lseek(fd, 0, os.SEEK_SET)
                    content = os.read(fd, size).decode("utf-8").strip()
                    try:
                        logs = json.loads(content)
                        if not isinstance(logs, list):
                            logs = []
                    except Exception:
                        logs = []
                
                # Append new entry
                logs.append(entry)
                
                # Truncate and write back
                os.lseek(fd, 0, os.SEEK_SET)
                os.ftruncate(fd, 0)
                os.write(fd, json.dumps(logs, indent=2).encode("utf-8"))
            finally:
                # Release lock and close
                fcntl.flock(fd, fcntl.LOCK_UN)
                os.close(fd)
        except Exception as e:
            print(f"Failed to write to log path {path}: {e}")
