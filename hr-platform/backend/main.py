import os
import redis
import uuid
import requests
from fastapi import FastAPI, Depends, Request
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from sqlalchemy.orm import Session
from sqlalchemy.sql import text
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from backend.config import settings
from backend.db.session import get_db, get_s3_client
from fastapi import File, UploadFile, Form, HTTPException
from fastapi.responses import StreamingResponse
from datetime import datetime
import asyncio
from backend.db.models import Candidate, Interview, Job, UploadBatch, UploadLog, CandidateNote
from backend.workers.tasks import parse_resume, spawn_agent
import base64

# Initialize slowapi limiter
limiter = Limiter(key_func=get_remote_address)
app = FastAPI(title="TalentStream API Gateway")
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

@app.middleware("http")
async def add_no_cache_headers(request: Request, call_next):
    response = await call_next(request)
    path = request.url.path.lower()
    if path.endswith((".js", ".css", ".html")) or path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response

# Phase 9: Sentry SDK integration (no-op when SENTRY_DSN is blank/None)
try:
    import sentry_sdk
    from sentry_sdk.integrations.fastapi import FastApiIntegration
    from sentry_sdk.integrations.starlette import StarletteIntegration
    if settings.SENTRY_DSN:
        sentry_sdk.init(
            dsn=settings.SENTRY_DSN,
            integrations=[StarletteIntegration(), FastApiIntegration()],
            traces_sample_rate=0.2,      # 20% of requests traced
            profiles_sample_rate=0.1,    # 10% profiled
            environment=os.getenv("ENVIRONMENT", "production"),
            release=os.getenv("GIT_SHA", "unknown"),
        )
        print(f"[Sentry] Initialized — DSN configured.")
    else:
        print("[Sentry] SENTRY_DSN not set — error tracking disabled.")
except ImportError:
    print("[Sentry] sentry-sdk not installed — skipping.")

import json
from pydantic import BaseModel
from typing import List, Optional
from openai import OpenAI
from backend.db.models import Job

# Initialize OpenAI client
openai_client = OpenAI(
    api_key=settings.OPENAI_API_KEY,
    base_url=settings.OPENAI_BASE_URL
)

# Pydantic Schemas
class JobCreate(BaseModel):
    title: str
    department: str
    jd: str
    rvc: str
    vic: str
    bc: str

class JobResponse(BaseModel):
    id: int
    title: str
    department: str
    jd: str
    rvc: str
    vic: str
    bc: str
    rubric_json: Optional[dict] = None
    status: str

    class Config:
        from_attributes = True

# Helper to generate rubric_json using GPT-4o-mini
def normalize_weights(criteria_list: list) -> list:
    if not criteria_list:
        return []
    total = sum(int(c.get("weight", 0)) for c in criteria_list)
    if total <= 0:
        # Assign equal weights
        n = len(criteria_list)
        base = 100 // n
        remainder = 100 % n
        for i, c in enumerate(criteria_list):
            c["weight"] = base + (1 if i < remainder else 0)
    elif total != 100:
        # Scale weights
        running_sum = 0
        n = len(criteria_list)
        for i, c in enumerate(criteria_list):
            w = int(c.get("weight", 0))
            if i == n - 1:
                c["weight"] = 100 - running_sum
            else:
                scaled = round((w / total) * 100)
                c["weight"] = scaled
                running_sum += scaled
    return criteria_list

# Helper to generate rubric_json using GPT-4o-mini
def convert_rvc_to_rubric(
    title: str,
    jd: str,
    rvc_text: str,
    vic_text: Optional[str] = None,
    bc_text: Optional[str] = None
) -> dict:
    try:
        # Check if we should generate full rubrics (including voice)
        if vic_text and bc_text:
            prompt = (
                "You are an expert HR recruitment specialist. Analyze the Job Title, Job Description (JD), Resume Verification Criteria (RVC), "
                "Voice Interview Criteria (VIC), and Behavioral Criteria (BC) "
                "and extract a structured JSON object containing three rubrics: 'resume', 'vic', and 'bc'.\n\n"
                
                "1. 'resume' Rubric Rules:\n"
                "- Distribute 100 total points across the four main scoring categories:\n"
                "  * Skills (skills_max)\n"
                "  * Experience (experience_max)\n"
                "  * Education (education_max)\n"
                "  * Certifications (certs_max)\n"
                "- The sum of these 4 values must be exactly 100.\n"
                "- Include a list of criteria under 'criteria', where each has 'name', 'required' (boolean), and 'description'.\n\n"
                
                "2. 'vic' Rubric Rules:\n"
                "- Analyze the Voice Interview Criteria (VIC) and JD to extract 3 to 6 distinct technical evaluation criteria for the live voice interview.\n"
                "- Assign a weight (integer percentage) to each criterion based on its importance to the job role.\n"
                "- The sum of all 'weight' values in the 'vic' rubric MUST be exactly 100.\n"
                "- Each criterion must have 'name', 'description', and 'weight'.\n\n"
                
                "3. 'bc' Rubric Rules:\n"
                "- Analyze the Behavioral Criteria (BC) and JD to extract 2 to 4 distinct behavioral/communication evaluation criteria.\n"
                "- Assign a weight (integer percentage) to each criterion based on its importance to the job role.\n"
                "- The sum of all 'weight' values in the 'bc' rubric MUST be exactly 100.\n"
                "- Each criterion must have 'name', 'description', and 'weight'.\n\n"
                
                "Output MUST be a JSON object with this exact structure:\n"
                "{\n"
                "  \"resume\": {\n"
                "    \"weights\": {\"skills_max\": <int>, \"experience_max\": <int>, \"education_max\": <int>, \"certs_max\": <int>},\n"
                "    \"criteria\": [{\"name\": \"<name>\", \"required\": <bool>, \"description\": \"<desc>\"}]\n"
                "  },\n"
                "  \"vic\": {\n"
                "    \"criteria\": [{\"name\": \"<name>\", \"description\": \"<desc>\", \"weight\": <int>}]\n"
                "  },\n"
                "  \"bc\": {\n"
                "    \"criteria\": [{\"name\": \"<name>\", \"description\": \"<desc>\", \"weight\": <int>}]\n"
                "  }\n"
                "}\n\n"
                f"Job Title: {title}\n"
                f"Job Description: {jd}\n"
                f"RVC Text:\n{rvc_text}\n\n"
                f"VIC Text:\n{vic_text}\n\n"
                f"BC Text:\n{bc_text}"
            )
            
            response = openai_client.chat.completions.create(
                model=settings.OPENAI_MODEL_FORMATTING,
                messages=[
                    {"role": "system", "content": "You output structured JSON objects for recruitment criteria and category weights."},
                    {"role": "user", "content": prompt}
                ],
                response_format={"type": "json_object"}
            )
            
            data = json.loads(response.choices[0].message.content)
            
            # --- 1. Normalize Resume Rubric ---
            resume = data.get("resume", {})
            weights = resume.get("weights", {})
            skills_max = int(weights.get("skills_max", 40))
            experience_max = int(weights.get("experience_max", 30))
            education_max = int(weights.get("education_max", 20))
            certs_max = int(weights.get("certs_max", 10))
            
            if skills_max + experience_max + education_max + certs_max != 100:
                total = skills_max + experience_max + education_max + certs_max
                if total > 0:
                    skills_max = round((skills_max / total) * 100)
                    experience_max = round((experience_max / total) * 100)
                    education_max = round((education_max / total) * 100)
                    certs_max = 100 - (skills_max + experience_max + education_max)
                else:
                    skills_max, experience_max, education_max, certs_max = 40, 30, 20, 10
            
            resume["weights"] = {
                "skills_max": skills_max,
                "experience_max": experience_max,
                "education_max": education_max,
                "certs_max": certs_max
            }
            data["resume"] = resume

            # --- 2. Normalize VIC Rubric ---
            vic = data.get("vic", {})
            vic_criteria = vic.get("criteria", [])
            vic["criteria"] = normalize_weights(vic_criteria)
            data["vic"] = vic

            # --- 3. Normalize BC Rubric ---
            bc = data.get("bc", {})
            bc_criteria = bc.get("criteria", [])
            bc["criteria"] = normalize_weights(bc_criteria)
            data["bc"] = bc

            return data
            
        else:
            # Fallback legacy mode if only rvc is provided
            prompt = (
                "You are an expert HR recruitment specialist. Analyze the Job Title, Job Description (JD), and Resume Verification Criteria (RVC) text "
                "and extract a structured JSON list of specific criteria and dynamic weights for evaluation.\n\n"
                "You must decide how to distribute 100 total points across the four main scoring categories:\n"
                "1. Skills (skills_max)\n"
                "2. Experience (experience_max)\n"
                "3. Education (education_max)\n"
                "4. Certifications (certs_max)\n\n"
                "Rules for Weights:\n"
                "- The values for skills_max, experience_max, education_max, and certs_max must be integers, each >= 0.\n"
                "- The sum of these 4 values must be exactly 100.\n"
                "- Make the distribution based on the job role (e.g. for a senior engineer, experience and skills might be higher; for an entry level role, education might be higher; for a highly regulated field, certifications might be higher).\n\n"
                "Output MUST be a JSON object with keys:\n"
                "- 'weights': an object with keys: 'skills_max', 'experience_max', 'education_max', 'certs_max'.\n"
                "- 'criteria': a list of objects. Each object in the list must have keys:\n"
                "  * 'name': Name of the criterion (e.g. 'Python Programming', 'AWS Cloud Architecture').\n"
                "  * 'required': boolean (true if it's a mandatory requirement, false if preferred/optional).\n"
                "  * 'description': Brief description of what is expected for this criterion.\n\n"
                f"Job Title: {title}\n"
                f"Job Description: {jd}\n"
                f"RVC Text:\n{rvc_text}"
            )
            
            response = openai_client.chat.completions.create(
                model=settings.OPENAI_MODEL_FORMATTING,
                messages=[
                    {"role": "system", "content": "You output structured JSON objects for recruitment criteria and category weights."},
                    {"role": "user", "content": prompt}
                ],
                response_format={"type": "json_object"}
            )
            
            data = json.loads(response.choices[0].message.content)
            # Validation of weights
            weights = data.get("weights", {})
            skills_max = int(weights.get("skills_max", 40))
            experience_max = int(weights.get("experience_max", 30))
            education_max = int(weights.get("education_max", 20))
            certs_max = int(weights.get("certs_max", 10))
            
            # Ensure total is 100
            if skills_max + experience_max + education_max + certs_max != 100:
                total = skills_max + experience_max + education_max + certs_max
                if total > 0:
                    skills_max = round((skills_max / total) * 100)
                    experience_max = round((experience_max / total) * 100)
                    education_max = round((education_max / total) * 100)
                    certs_max = 100 - (skills_max + experience_max + education_max)
                else:
                    skills_max, experience_max, education_max, certs_max = 40, 30, 20, 10
                    
            data["weights"] = {
                "skills_max": skills_max,
                "experience_max": experience_max,
                "education_max": education_max,
                "certs_max": certs_max
            }
            return data
    except Exception as e:
        print(f"Error converting RVC to rubric: {e}")
        return {
            "weights": {
                "skills_max": 40,
                "experience_max": 30,
                "education_max": 20,
                "certs_max": 10
            },
            "criteria": [
                {"name": "General Match", "required": True, "description": "Candidate matches general job profile."}
            ]
        }

@app.get("/api/health")
def health_check(db: Session = Depends(get_db)):
    """
    Health check endpoint that verifies connectivity to PostgreSQL and Redis.
    """
    health = {
        "status": "ok",
        "postgres": "disconnected",
        "redis": "disconnected"
    }

    # 1. Check PostgreSQL connection status
    try:
        db.execute(text("SELECT 1"))
        health["postgres"] = "connected"
    except Exception as e:
        health["status"] = "error"
        health["postgres"] = f"error: {str(e)}"

    # 2. Check Redis connection
    try:
        r = redis.from_url(settings.REDIS_URL, socket_timeout=3.0)
        r.ping()
        health["redis"] = "connected"
    except Exception as e:
        health["status"] = "error"
        health["redis"] = f"error: {str(e)}"

    return health

@app.post("/api/jobs", response_model=JobResponse, status_code=201)
@limiter.limit(settings.RATE_LIMIT_AUTH_JOBS)
def create_job(request: Request, job_data: JobCreate, db: Session = Depends(get_db)):
    """
    Creates a new job posting, parses RVC into structured rubric_json via GPT-4o-mini.
    """
    rubric = convert_rvc_to_rubric(job_data.title, job_data.jd, job_data.rvc, job_data.vic, job_data.bc)
    
    db_job = Job(
        title=job_data.title,
        department=job_data.department,
        jd=job_data.jd,
        rvc=job_data.rvc,
        vic=job_data.vic,
        bc=job_data.bc,
        rubric_json=rubric,
        status="open"
    )
    db.add(db_job)
    db.commit()
    db.refresh(db_job)
    return db_job

@app.get("/api/jobs", response_model=List[JobResponse])
def get_jobs(status: Optional[str] = None, db: Session = Depends(get_db)):
    """
    List jobs, optionally filtered by status ('open' or 'closed').
    """
    query = db.query(Job)
    if status:
        query = query.filter(Job.status == status)
    return query.all()

@app.patch("/api/jobs/{job_id}/close", response_model=JobResponse)
def close_job(job_id: int, db: Session = Depends(get_db)):
    """
    Marks a job posting as closed.
    """
    job = db.query(Job).filter(Job.id == job_id).first()
    if not job:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Job not found")
    
    # Check for undecided candidates (interview_completed status)
    undecided_count = db.query(Candidate).filter(Candidate.job_id == job_id, Candidate.status == "interview_completed").count()
    if undecided_count > 0:
        from fastapi import HTTPException
        raise HTTPException(
            status_code=400,
            detail=f"Cannot close job. {undecided_count} candidate(s) have completed interviews but no hire/reject decision. Please review in Panel 3 → Overall tab before closing."
        )

    job.status = "closed"
    db.commit()
    db.refresh(job)
    return job

@app.patch("/api/jobs/{job_id}/reopen", response_model=JobResponse)
def reopen_job(job_id: int, db: Session = Depends(get_db)):
    """
    Marks a closed job posting as open again.
    """
    job = db.query(Job).filter(Job.id == job_id).first()
    if not job:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Job not found")
    job.status = "open"
    db.commit()
    db.refresh(job)
    return job

@app.delete("/api/jobs/{job_id}")
def delete_job(job_id: int, db: Session = Depends(get_db)):
    """
    Permanently deletes a job and all associated candidates and interviews (cascade).
    """
    from fastapi import HTTPException
    job = db.query(Job).filter(Job.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    db.delete(job)
    db.commit()
    return {"detail": f"Job '{job.title}' deleted successfully"}


def _format_log_dict(log_dict: dict) -> dict:
    """Format a log dictionary to add the computed file_progress field and friendly status."""
    status = log_dict.get("status") or "uploaded"
    file_progress = 10
    display_status = status

    if status.startswith("uploading:"):
        try:
            pct = int(status.split(":")[1])
            file_progress = int(pct * 0.5)  # 0 to 50%
            display_status = "uploading"
        except:
            file_progress = 10
            display_status = "uploading"
    elif status == "uploaded":
        file_progress = 70  # 50 to 90% range for Waiting for Celery
        display_status = "waiting"
    elif status in ("parsing", "processing"):
        file_progress = 92  # 90 to 99% range for parsing
        display_status = "parsing"
    elif status == "structured":
        file_progress = 97  # 90 to 99% range for structuring
        display_status = "structuring"
    elif status in ("scored", "completed"):
        file_progress = 100
        display_status = "completed"
    elif status in ("failed", "unable_to_process"):
        file_progress = 100
        display_status = "failed"

    log_dict["status"] = display_status
    log_dict["file_progress"] = file_progress
    return log_dict


def _log_to_dict(log) -> dict:
    """Serialize an UploadLog to a dict with a computed file_progress field."""
    raw_dict = {
        "id": str(log.id),
        "file_name": log.file_name,
        "file_size_bytes": log.file_size_bytes,
        "status": log.status or "uploaded",
        "error_message": log.error_message,
        "candidate_id": log.candidate_id,
        "completed_at": log.completed_at.isoformat() if log.completed_at else None,
    }
    return _format_log_dict(raw_dict)

def publish_batch_sse(batch_id: str, db: Session):
    try:
        r = redis.from_url(settings.REDIS_URL)
        batch = db.query(UploadBatch).filter(UploadBatch.id == uuid.UUID(batch_id)).first()
        if batch:
            logs_list = []
            for log in batch.logs:
                log_dict = _log_to_dict(log)
                if log.candidate_id:
                    cand = db.query(Candidate).filter(Candidate.id == log.candidate_id).first()
                    if cand:
                        log_dict["match_score"] = cand.match_score
                logs_list.append(log_dict)

            data = {
                "id": str(batch.id),
                "job_id": batch.job_id,
                "total_files": batch.total_files,
                "processed_count": batch.processed_count,
                "failed_count": batch.failed_count,
                "processing_count": batch.processing_count,
                "status": batch.status,
                "logs": logs_list
            }
            r.publish(f"sse:batch:{batch_id}", json.dumps(data))
    except Exception as e:
        print(f"Failed to publish batch SSE: {e}")

@app.post("/api/uploads/batches", status_code=201)
def create_upload_batch(payload: dict, db: Session = Depends(get_db)):
    job_id = payload.get("job_id")
    total_files = payload.get("total_files", 0)
    if not job_id:
        raise HTTPException(status_code=400, detail="job_id is required")
    
    batch = UploadBatch(
        job_id=job_id,
        total_files=total_files,
        status="uploading"
    )
    db.add(batch)
    db.commit()
    db.refresh(batch)
    return {
        "id": str(batch.id),
        "job_id": batch.job_id,
        "total_files": batch.total_files,
        "status": batch.status
    }

@app.get("/api/uploads/batches/{batch_id}")
def get_upload_batch(batch_id: str, db: Session = Depends(get_db)):
    try:
        batch_uuid = uuid.UUID(batch_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid batch_id UUID")
        
    batch = db.query(UploadBatch).filter(UploadBatch.id == batch_uuid).first()
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")
        
    logs_list = []
    for log in batch.logs:
        score = None
        if log.candidate_id:
            cand = db.query(Candidate).filter(Candidate.id == log.candidate_id).first()
            if cand:
                score = cand.match_score
        logs_list.append({
            "id": str(log.id),
            "file_name": log.file_name,
            "status": log.status,
            "error_message": log.error_message,
            "candidate_id": log.candidate_id,
            "match_score": score,
            "completed_at": log.completed_at.isoformat() if log.completed_at else None
        })
        
    return {
        "id": str(batch.id),
        "job_id": batch.job_id,
        "total_files": batch.total_files,
        "processed_count": batch.processed_count,
        "failed_count": batch.failed_count,
        "processing_count": batch.processing_count,
        "status": batch.status,
        "logs": logs_list
    }

@app.get("/api/uploads/{batch_id}")
def get_upload_batch_alias(batch_id: str, db: Session = Depends(get_db)):
    return get_upload_batch(batch_id, db)

@app.get("/api/upload-batches/{job_id}")
def get_upload_batches(job_id: int, db: Session = Depends(get_db)):
    batches = db.query(UploadBatch).filter(UploadBatch.job_id == job_id).order_by(UploadBatch.created_at.desc()).all()
    res = []
    for batch in batches:
        logs_list = []
        for log in batch.logs:
            score = None
            if log.candidate_id:
                cand = db.query(Candidate).filter(Candidate.id == log.candidate_id).first()
                if cand:
                    score = cand.match_score
            logs_list.append(_format_log_dict({
                "id": str(log.id),
                "file_name": log.file_name,
                "status": log.status,
                "error_message": log.error_message,
                "candidate_id": log.candidate_id,
                "match_score": score,
                "completed_at": log.completed_at.isoformat() if log.completed_at else None
            }))
        res.append({
            "id": str(batch.id),
            "job_id": batch.job_id,
            "total_files": batch.total_files,
            "processed_count": batch.processed_count,
            "failed_count": batch.failed_count,
            "processing_count": batch.processing_count,
            "status": batch.status,
            "logs": logs_list
        })
    return res

@app.patch("/api/uploads/batches/{batch_id}/add-files")
def add_files_to_batch(batch_id: str, payload: dict, db: Session = Depends(get_db)):
    try:
        batch_uuid = uuid.UUID(batch_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid batch_id UUID")
    batch = db.query(UploadBatch).filter(UploadBatch.id == batch_uuid).first()
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")
    count = payload.get("count", 0)
    batch.total_files += count
    db.commit()
    publish_batch_sse(batch_id, db)
    return {"id": str(batch.id), "total_files": batch.total_files}


@app.post("/api/uploads/batches/{batch_id}/log-failure")
def log_batch_file_failure(batch_id: str, payload: dict, db: Session = Depends(get_db)):
    try:
        batch_uuid = uuid.UUID(batch_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid batch_id UUID")
        
    batch = db.query(UploadBatch).filter(UploadBatch.id == batch_uuid).first()
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")
        
    log = UploadLog(
        batch_id=batch.id,
        file_name=payload.get("file_name", "unknown"),
        file_size_bytes=payload.get("file_size", 0),
        status="failed",
        error_message=payload.get("error_message", "Upload request failed"),
        completed_at=datetime.utcnow()
    )
    db.add(log)
    batch.failed_count += 1
    
    # If this was the last file in the batch, update batch status to completed
    total_completed = batch.processed_count + batch.failed_count
    if total_completed >= batch.total_files:
        batch.status = "completed"
        batch.completed_at = datetime.utcnow()
        
    db.commit()
    db.refresh(batch)
    publish_batch_sse(batch_id, db)
    return {"status": "ok"}

@app.get("/api/sse/batch/{batch_id}")
async def sse_batch(batch_id: str, request: Request, db: Session = Depends(get_db)):
    async def event_generator():
        r = redis.from_url(settings.REDIS_URL)
        pubsub = r.pubsub()
        pubsub.subscribe(f"sse:batch:{batch_id}")
        
        # Send initial message immediately
        try:
            batch_uuid = uuid.UUID(batch_id)
            from backend.db.session import SessionLocal
            with SessionLocal() as local_db:
                batch = local_db.query(UploadBatch).filter(UploadBatch.id == batch_uuid).first()
                if batch:
                    logs_list = [_log_to_dict(log) for log in batch.logs]
                    initial_data = {
                        "id": str(batch.id),
                        "job_id": batch.job_id,
                        "total_files": batch.total_files,
                        "processed_count": batch.processed_count,
                        "failed_count": batch.failed_count,
                        "processing_count": batch.processing_count,
                        "status": batch.status,
                        "logs": logs_list
                    }
                    yield f"data: {json.dumps(initial_data)}\n\n"
        except Exception as e:
            print(f"Error yielding initial SSE state: {e}")

        heartbeat_counter = 0
        try:
            while True:
                if await request.is_disconnected():
                    break
                message = pubsub.get_message(ignore_subscribe_messages=True)
                if message:
                    raw_data = message["data"].decode("utf-8")
                    try:
                        data_dict = json.loads(raw_data)
                        if "logs" in data_dict:
                            data_dict["logs"] = [_format_log_dict(l) for l in data_dict["logs"]]
                        yield f"data: {json.dumps(data_dict)}\n\n"
                    except Exception as e:
                        yield f"data: {raw_data}\n\n"

                heartbeat_counter += 1
                if heartbeat_counter >= 30:  # every 15s (30 × 0.5s)
                    yield f": heartbeat\n\n"
                    heartbeat_counter = 0
                await asyncio.sleep(0.5)
        except asyncio.CancelledError:
            pass
        finally:
            pubsub.unsubscribe()
            pubsub.close()
            
    return StreamingResponse(event_generator(), media_type="text/event-stream")

@app.post("/api/candidates/upload", status_code=201)
@limiter.limit("500/day")
def upload_candidate_resume(
    request: Request,
    job_id: int = Form(...),
    file: UploadFile = File(...),
    upload_id: Optional[str] = Form(None),
    batch_id: Optional[str] = Form(None),
    db: Session = Depends(get_db)
):
    # 1. Verify job exists
    job = db.query(Job).filter(Job.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    # 2. Check file size (< 10MB)
    MAX_SIZE = 10 * 1024 * 1024
    content = file.file.read()
    if len(content) > MAX_SIZE:
        raise HTTPException(status_code=400, detail="File too large. Maximum size is 10MB.")
    file.file.seek(0)

    # Initialize batch logs variables
    batch = None
    log_id = None
    if batch_id:
        try:
            batch_uuid = uuid.UUID(batch_id)
            batch = db.query(UploadBatch).filter(UploadBatch.id == batch_uuid).first()
        except ValueError:
            pass

    # Create log if batch exists
    if batch:
        log = UploadLog(
            batch_id=batch.id,
            file_name=file.filename,
            file_size_bytes=len(content),
            status="uploading:0"
        )
        db.add(log)
        db.commit()
        db.refresh(log)
        log_id = str(log.id)
        
        # Update batch status and counts
        batch.processing_count += 1
        if batch.status == "uploading":
            batch.status = "processing"
        db.commit()

    # 3. Create candidate entry with status = "uploaded"
    candidate = Candidate(
        job_id=job_id,
        status="uploaded"
    )
    db.add(candidate)
    db.commit()
    db.refresh(candidate)

    # Update log with candidate ID
    if log_id:
        log = db.query(UploadLog).filter(UploadLog.id == uuid.UUID(log_id)).first()
        if log:
            log.candidate_id = candidate.id
            db.commit()

    # 4. Upload to S3 with progress tracking
    import io
    fileobj = io.BytesIO(content)
    total_bytes = len(content)
    uploaded_bytes = 0
    last_reported_pct = 0

    def upload_callback(bytes_amount):
        nonlocal uploaded_bytes, last_reported_pct
        uploaded_bytes += bytes_amount
        if total_bytes > 0:
            pct = int((uploaded_bytes / total_bytes) * 100)
            if pct >= last_reported_pct + 10 or pct == 100:
                last_reported_pct = pct
                if log_id:
                    try:
                        log_top = db.query(UploadLog).filter(UploadLog.id == uuid.UUID(log_id)).first()
                        if log_top:
                            log_top.status = f"uploading:{pct}"
                            db.commit()
                            publish_batch_sse(batch_id, db)
                    except Exception as ex:
                        print(f"Error in upload callback: {ex}")

    s3_path = f"resumes/{job_id}/{candidate.id}/resume.pdf"
    s3_client = get_s3_client()

    S3_MAX_RETRIES = 3
    s3_uploaded = False
    last_s3_error = None
    for s3_attempt in range(1, S3_MAX_RETRIES + 1):
        try:
            fileobj.seek(0)  # reset stream on each retry
            s3_client.upload_fileobj(
                fileobj,
                Bucket=settings.S3_BUCKET_NAME,
                Key=s3_path,
                ExtraArgs={"ContentType": file.content_type or "application/pdf"},
                Callback=upload_callback
            )
            s3_uploaded = True
            break
        except Exception as e:
            last_s3_error = e
            print(f"[S3 Upload] attempt {s3_attempt}/{S3_MAX_RETRIES} failed for candidate {candidate.id}: {e}")
            if s3_attempt < S3_MAX_RETRIES:
                import time; time.sleep(s3_attempt * 1)  # 1s, 2s back-off

    if not s3_uploaded:
        # Clean up the orphaned candidate row on permanent failure
        db.delete(candidate)
        if log_id:
            log = db.query(UploadLog).filter(UploadLog.id == uuid.UUID(log_id)).first()
            if log:
                log.status = "failed"
                log.error_message = f"S3 upload failed after {S3_MAX_RETRIES} attempts: {last_s3_error}"
                if batch:
                    batch.processing_count = max(0, batch.processing_count - 1)
        db.commit()
        raise HTTPException(status_code=500, detail=f"S3 upload failed after {S3_MAX_RETRIES} attempts: {last_s3_error}")

    if log_id:
        log = db.query(UploadLog).filter(UploadLog.id == uuid.UUID(log_id)).first()
        if log:
            log.status = "uploaded"
            db.commit()

    # Update candidate with resume path
    candidate.resume_url = s3_path
    db.commit()
    db.refresh(candidate)

    # 5. Trigger SSE and Celery task
    if upload_id:
        r = redis.from_url(settings.REDIS_URL)
        r.publish(f"sse:uploads:{upload_id}", json.dumps({
            "status": "uploaded",
            "candidate_id": candidate.id
        }))

    if batch_id:
        publish_batch_sse(batch_id, db)

    # Dispatch celery task
    parse_resume.apply_async(
        args=[candidate.id, upload_id, batch_id, log_id],
        queue="ai-worker"
    )

    return {
        "id": candidate.id,
        "job_id": candidate.job_id,
        "status": candidate.status,
        "resume_url": candidate.resume_url
    }

@app.get("/api/jobs/{job_id}/last-batch")
def get_last_batch(job_id: int, db: Session = Depends(get_db)):
    batch = db.query(UploadBatch).filter(UploadBatch.job_id == job_id).order_by(UploadBatch.created_at.desc()).first()
    if not batch:
        return None
    
    logs_list = []
    for log in batch.logs:
        score = None
        if log.candidate_id:
            cand = db.query(Candidate).filter(Candidate.id == log.candidate_id).first()
            if cand:
                score = cand.match_score
        logs_list.append({
            "id": str(log.id),
            "file_name": log.file_name,
            "status": log.status,
            "error_message": log.error_message,
            "candidate_id": log.candidate_id,
            "match_score": score,
            "completed_at": log.completed_at.isoformat() if log.completed_at else None
        })
        
    return {
        "id": str(batch.id),
        "job_id": batch.job_id,
        "total_files": batch.total_files,
        "processed_count": batch.processed_count,
        "failed_count": batch.failed_count,
        "processing_count": batch.processing_count,
        "status": batch.status,
        "logs": logs_list
    }

@app.get("/api/candidates")
def get_candidates(
    job_id: Optional[int] = None,
    jobId: Optional[int] = None,
    status: Optional[str] = None,
    sort: Optional[str] = None,
    q: Optional[str] = None,
    page: int = 1,
    limit: int = 20,
    db: Session = Depends(get_db)
):
    """
    List candidates for a specific job, with support for filtering, sorting, and cursor-based/hybrid pagination.
    """
    actual_job_id = job_id if job_id is not None else jobId
    if actual_job_id is None:
        raise HTTPException(status_code=400, detail="job_id or jobId is required")

    query = db.query(Candidate).filter(Candidate.job_id == actual_job_id)

    # Search filter
    if q and q.strip():
        search_term = f"%{q.strip()}%"
        query = query.filter(
            (Candidate.name.ilike(search_term)) |
            (Candidate.email.ilike(search_term)) |
            (Candidate.phone.ilike(search_term))
        )

    # Status filter (comma separated or single)
    if status and status.strip():
        if status == "all":
            pass
        else:
            status_list = [s.strip() for s in status.split(",") if s.strip()]
            if status_list:
                query = query.filter(Candidate.status.in_(status_list))
    else:
        # Default: all except failed/unable_to_process
        query = query.filter(~Candidate.status.in_(["failed", "unable_to_process"]))

    # Sorting
    if sort == "score_desc" or sort == "match_score":
        query = query.order_by(Candidate.match_score.desc().nullslast(), Candidate.id.desc())
    elif sort == "score_asc":
        query = query.order_by(Candidate.match_score.asc().nullslast(), Candidate.id.asc())
    elif sort == "overall_score":
        query = query.order_by(Candidate.overall_score.desc().nullslast(), Candidate.id.desc())
    elif sort == "name" or sort == "name_asc":
        query = query.order_by(Candidate.name.asc().nullslast(), Candidate.id.asc())
    elif sort == "date_desc" or sort == "newest":
        query = query.order_by(Candidate.created_at.desc(), Candidate.id.desc())
    else:
        # Default sort: created_at desc
        query = query.order_by(Candidate.created_at.desc(), Candidate.id.desc())

    # Default limit: 20, max limit: 100
    limit = min(max(1, limit), 100)

    total = query.count()
    total_pages = max(1, (total + limit - 1) // limit)
    page = max(1, min(page, total_pages))
    
    offset = (page - 1) * limit
    candidates_list = query.offset(offset).limit(limit).all()

    has_next = page < total_pages
    has_prev = page > 1

    # Base64 helper for stable cursors
    def encode_cursor(p: int) -> str:
        return base64.b64encode(str(p).encode("utf-8")).decode("utf-8")

    next_cursor = encode_cursor(page + 1) if has_next else None
    prev_cursor = encode_cursor(page - 1) if has_prev else None

    # Fetch last batch
    last_batch = db.query(UploadBatch).filter(UploadBatch.job_id == actual_job_id).order_by(UploadBatch.created_at.desc()).first()
    last_batch_data = None
    if last_batch:
        logs_list = []
        for log in last_batch.logs:
            score = None
            if log.candidate_id:
                cand = db.query(Candidate).filter(Candidate.id == log.candidate_id).first()
                if cand:
                    score = cand.match_score
            logs_list.append({
                "id": str(log.id),
                "file_name": log.file_name,
                "status": log.status,
                "error_message": log.error_message,
                "candidate_id": log.candidate_id,
                "match_score": score,
                "completed_at": log.completed_at.isoformat() if log.completed_at else None
            })
        last_batch_data = {
            "id": str(last_batch.id),
            "job_id": last_batch.job_id,
            "total_files": last_batch.total_files,
            "processed_count": last_batch.processed_count,
            "failed_count": last_batch.failed_count,
            "processing_count": last_batch.processing_count,
            "status": last_batch.status,
            "logs": logs_list
        }

    # Return paginated response structure
    return {
        "candidates": candidates_list,
        "last_batch": last_batch_data,
        "pagination": {
            "page": page,
            "limit": limit,
            "total": total,
            "total_pages": total_pages,
            "has_next": has_next,
            "has_prev": has_prev,
            "next_cursor": next_cursor,
            "prev_cursor": prev_cursor
        }
    }

@app.get("/api/sse/uploads/{upload_id}")
@limiter.limit("5/minute")
async def sse_uploads(upload_id: str, request: Request):
    async def event_generator():
        r = redis.from_url(settings.REDIS_URL)
        pubsub = r.pubsub()
        pubsub.subscribe(f"sse:uploads:{upload_id}")
        
        # Send initial message to establish connection
        yield "event: connect\ndata: connected\n\n"
        
        try:
            while True:
                # Use a non-blocking check with sleep
                message = pubsub.get_message(ignore_subscribe_messages=True)
                if message:
                    data = message["data"].decode("utf-8")
                    yield f"event: update\ndata: {data}\n\n"
                await asyncio.sleep(0.5)
        except asyncio.CancelledError:
            pubsub.unsubscribe()
            pubsub.close()
            
    return StreamingResponse(event_generator(), media_type="text/event-stream")

class CandidateStatusUpdate(BaseModel):
    status: str

@app.patch("/api/candidates/{candidate_id}/status")
def update_candidate_status(candidate_id: int, status_data: CandidateStatusUpdate, db: Session = Depends(get_db)):
    candidate = db.query(Candidate).filter(Candidate.id == candidate_id).first()
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")
        
    status = status_data.status.lower()
    valid_statuses = [
        "new", "shortlisted", "rejected", "manual_review",
        "interview_invited", "interview_scheduled",
        "completed", "unable_to_process", "failed", "manual_reviewed",
        # Phase 7 final hiring actions
        "hired", "rejected_post_interview", "final_evaluation"
    ]
    if status not in valid_statuses:
        raise HTTPException(status_code=400, detail=f"Invalid status. Must be one of {valid_statuses}")
        
    candidate.status = status
    db.commit()
    db.refresh(candidate)
    return candidate

@app.get("/api/candidates/{candidate_id}/resume-url")
def get_candidate_resume_url(candidate_id: int, db: Session = Depends(get_db)):
    candidate = db.query(Candidate).filter(Candidate.id == candidate_id).first()
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")
    if not candidate.resume_url:
        raise HTTPException(status_code=404, detail="Resume URL not found for candidate")

    s3_client = get_s3_client()
    try:
        presigned_url = s3_client.generate_presigned_url(
            'get_object',
            Params={
                'Bucket': settings.S3_BUCKET_NAME,
                'Key': candidate.resume_url
            },
            ExpiresIn=3600
        )
        filename = candidate.resume_url.split('/')[-1]
        return {
            "url": presigned_url,
            "filename": filename,
            "content_type": "application/pdf"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate presigned S3 URL: {str(e)}")

@app.delete("/api/candidates/{candidate_id}")
def delete_candidate(candidate_id: int, db: Session = Depends(get_db)):
    candidate = db.query(Candidate).filter(Candidate.id == candidate_id).first()
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")
    db.delete(candidate)
    db.commit()
    return {"detail": "Candidate deleted successfully"}

class NoteCreate(BaseModel):
    text: str

class NoteUpdate(BaseModel):
    text: str

@app.get("/api/candidates/{candidate_id}/notes")
def get_candidate_notes(candidate_id: int, db: Session = Depends(get_db)):
    candidate = db.query(Candidate).filter(Candidate.id == candidate_id).first()
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")
    notes = db.query(CandidateNote).filter(CandidateNote.candidate_id == candidate_id).order_by(CandidateNote.created_at.desc()).all()
    return notes

@app.post("/api/candidates/{candidate_id}/notes")
def create_candidate_note(candidate_id: int, note_data: NoteCreate, db: Session = Depends(get_db)):
    candidate = db.query(Candidate).filter(Candidate.id == candidate_id).first()
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")
    note = CandidateNote(candidate_id=candidate_id, text=note_data.text)
    db.add(note)
    db.commit()
    db.refresh(note)
    return note

@app.patch("/api/notes/{note_id}")
def update_candidate_note(note_id: int, note_data: NoteUpdate, db: Session = Depends(get_db)):
    note = db.query(CandidateNote).filter(CandidateNote.id == note_id).first()
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    note.text = note_data.text
    db.commit()
    db.refresh(note)
    return note

@app.delete("/api/notes/{note_id}")
def delete_candidate_note(note_id: int, db: Session = Depends(get_db)):
    note = db.query(CandidateNote).filter(CandidateNote.id == note_id).first()
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    db.delete(note)
    db.commit()
    return {"detail": "Note deleted successfully"}

# Initialize Jinja2 templates directory
templates_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "frontend", "templates")
if not os.path.exists(templates_dir):
    os.makedirs(templates_dir, exist_ok=True)
templates = Jinja2Templates(directory=templates_dir)

@app.get("/api/candidates/{candidate_id}/report")
def get_candidate_report(candidate_id: int, db: Session = Depends(get_db)):
    """
    Phase 7: Returns a 1-hour presigned S3 URL to download the candidate's PDF report.
    """
    candidate = db.query(Candidate).filter(Candidate.id == candidate_id).first()
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")
    if not candidate.report_pdf_url:
        raise HTTPException(status_code=404, detail="Report not yet generated")

    # Parse s3://bucket/key
    s3_uri = candidate.report_pdf_url
    if s3_uri.startswith("s3://"):
        parts = s3_uri[5:].split("/", 1)
        bucket, key = parts[0], parts[1]
    else:
        raise HTTPException(status_code=500, detail="Invalid report URL format")

    s3 = get_s3_client()
    try:
        presigned_url = s3.generate_presigned_url(
            "get_object",
            Params={"Bucket": bucket, "Key": key},
            ExpiresIn=3600
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate download URL: {e}")

    return {
        "report_url": presigned_url,
        "expires_in": 3600,
        "candidate_id": candidate_id,
        "overall_score": candidate.overall_score,
        "ai_verdict": candidate.ai_verdict
    }

@app.post("/api/interviews/{interview_id}/report/trigger")
def trigger_report_generation(interview_id: int, db: Session = Depends(get_db)):
    """
    Phase 7: Manually trigger BB6 report generation for a completed interview.
    Useful for recruiter-initiated re-runs or testing.
    """
    from backend.workers.tasks import generate_report
    interview = db.query(Interview).filter(Interview.id == interview_id).first()
    if not interview:
        raise HTTPException(status_code=404, detail="Interview not found")
    if interview.status not in ["analysis_complete", "final_evaluation", "completed"]:
        raise HTTPException(status_code=400, detail=f"Interview status '{interview.status}' is not eligible for report generation")

    generate_report.apply_async(args=[interview_id], queue="ai-worker")
    return {"status": "queued", "interview_id": interview_id}

@app.get("/api/interviews/{candidate_id}/detail")
def get_interview_detail(candidate_id: int, db: Session = Depends(get_db)):
    """
    Returns the latest interview's full data for the recruiter UI Right Panel.
    Powers: Interview Report tab (transcript, vic_scores) + Behavioral Report tab (bc_scores, integrity, events).
    """
    candidate = db.query(Candidate).filter(Candidate.id == candidate_id).first()
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")

    # Get latest interview (most recent by created_at)
    interview = db.query(Interview).filter(
        Interview.candidate_id == candidate_id
    ).order_by(Interview.created_at.desc()).first()

    if not interview:
        return {"interview": None, "events": []}

    # Serialize events for the integrity timeline
    events = []
    for ev in interview.events:
        events.append({
            "event_type": ev.event_type,
            "event_data": ev.event_data,
            "timestamp": ev.timestamp.isoformat() if ev.timestamp else None
        })

    return {
        "interview": {
            "id": interview.id,
            "status": interview.status,
            "room_id": interview.room_id,
            "transcript": interview.transcript or [],
            "vic_score": interview.vic_score,
            "bc_score": interview.bc_score,
            "vic_scores": interview.vic_scores,
            "bc_scores": interview.bc_scores,
            "overall_score": interview.overall_score,
            "ai_verdict": interview.ai_verdict,
            "voice_ogg_url": interview.voice_ogg_url,
            "recording_url": interview.recording_url,
            "started_at": interview.started_at.isoformat() if interview.started_at else None,
            "completed_at": interview.completed_at.isoformat() if interview.completed_at else None,
            "created_at": interview.created_at.isoformat() if interview.created_at else None
        },
        "events": events
    }

@app.get("/api/interviews/{interview_id}/recording-url")
def get_interview_recording_url(interview_id: int, db: Session = Depends(get_db)):
    """
    Returns a 1-hour presigned S3 URL to play/download the interview recording.
    """
    interview = db.query(Interview).filter(Interview.id == interview_id).first()
    if not interview:
        raise HTTPException(status_code=404, detail="Interview not found")
    if not interview.recording_url:
        raise HTTPException(status_code=404, detail="Recording not yet available")

    url = interview.recording_url
    if url.startswith("s3://"):
        parts = url[5:].split("/", 1)
        bucket, key = parts[0], parts[1]
        s3 = get_s3_client()
        try:
            presigned_url = s3.generate_presigned_url(
                "get_object",
                Params={"Bucket": bucket, "Key": key},
                ExpiresIn=3600
            )
            url = presigned_url
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to generate signed URL: {e}")

    return {
        "recording_url": url,
        "expires_in": 3600 if interview.recording_url.startswith("s3://") else None
    }

@app.post("/api/interviews/{candidate_id}/invite")

@limiter.limit(settings.RATE_LIMIT_AUTH_INVITE)
def invite_candidate(candidate_id: int, request: Request, db: Session = Depends(get_db)):
    candidate = db.query(Candidate).filter(Candidate.id == candidate_id).first()
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")
        
    if candidate.status in ["uploaded", "parsing", "unable_to_process"]:
        raise HTTPException(status_code=400, detail=f"Candidate in status {candidate.status} cannot be invited yet.")

    invite_token = str(uuid.uuid4())
    
    try:
        r = redis.from_url(settings.REDIS_URL)
        r.setex(f"invite:{invite_token}", settings.INVITE_TOKEN_TTL_SEC, str(candidate.id))
    except Exception as re:
        print(f"Redis token storage failed: {re}")
        raise HTTPException(status_code=500, detail="Redis connection failed: cannot store invite token")

    new_interview = Interview(
        candidate_id=candidate.id,
        invite_token=invite_token,
        status="scheduled"
    )
    db.add(new_interview)
    db.commit()
    db.refresh(new_interview)

    candidate.status = "interview_invited"
    candidate.latest_interview_id = new_interview.id
    candidate.latest_invite_token = invite_token
    db.commit()
    db.refresh(candidate)

    job = candidate.job
    job_title = job.title if job else "AI Voice Interviewer Role"
    
    email_success = False
    sendgrid_error = None
    if settings.SENDGRID_API_KEY:
        try:
            url = "https://api.sendgrid.com/v3/mail/send"
            headers = {
                "Authorization": f"Bearer {settings.SENDGRID_API_KEY}",
                "Content-Type": "application/json"
            }
            interview_link = f"http://localhost:8000/interview/{invite_token}"
            email_body = f"""
            <html>
            <body style="font-family: 'Inter', sans-serif; background-color: #0b0f19; color: #f3f4f6; padding: 2rem;">
                <div style="max-width: 600px; margin: 0 auto; background-color: #111827; border: 1px solid #1f2937; border-radius: 8px; padding: 2rem; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
                    <h2 style="color: #6366f1; margin-top: 0;">TalentStream Interview Invitation</h2>
                    <p>Dear {candidate.name or 'Candidate'},</p>
                    <p>We are excited to invite you to complete a real-time AI voice interview for the position of <strong>{job_title}</strong>.</p>
                    <p>This automated interview will assess your technical skills, experience, and behavioral alignment. You will be speaking directly with our interactive AI voice assistant.</p>
                    <div style="margin: 2rem 0; text-align: center;">
                        <a href="{interview_link}" style="background-color: #6366f1; color: #ffffff; padding: 0.75rem 1.5rem; text-decoration: none; border-radius: 6px; font-weight: 600; display: inline-block;">Start AI Voice Interview</a>
                    </div>
                    <p style="font-size: 0.85rem; color: #9ca3af;">Please note: This invite link is valid for 24 hours. Make sure you are in a quiet room and have a working microphone before beginning.</p>
                    <hr style="border: 0; border-top: 1px solid #1f2937; margin: 1.5rem 0;" />
                    <p style="font-size: 0.8rem; color: #6b7280; text-align: center;">Powered by TalentStream HR Platform</p>
                </div>
            </body>
            </html>
            """
            
            payload = {
                "personalizations": [
                    {
                        "to": [{"email": candidate.email, "name": candidate.name or "Candidate"}],
                        "subject": f"Invitation: AI Voice Interview for {job_title}"
                    }
                ],
                "from": {
                    "email": settings.EMAIL_FROM_ADDRESS,
                    "name": settings.EMAIL_FROM_NAME
                },
                "content": [
                    {
                        "type": "text/html",
                        "value": email_body
                    }
                ]
            }
            res = requests.post(url, headers=headers, json=payload, timeout=10)
            if res.status_code in [200, 201, 202]:
                email_success = True
                print(f"Invitation email successfully sent to {candidate.email}")
            else:
                sendgrid_error = f"Status code: {res.status_code}, body: {res.text}"
                print(f"SendGrid returned error: {sendgrid_error}")
        except Exception as se:
            sendgrid_error = str(se)
            print(f"Failed to dispatch SendGrid email: {se}")

    return {
        "status": "invited",
        "candidate_id": candidate.id,
        "interview_id": new_interview.id,
        "invite_token": invite_token,
        "email_sent": email_success,
        "email_error": sendgrid_error
    }

@app.get("/interview/{invite_token}")
@limiter.limit(settings.RATE_LIMIT_PUBLIC_INVITE)
def interview_landing_page(invite_token: str, request: Request, db: Session = Depends(get_db)):
    try:
        r = redis.from_url(settings.REDIS_URL)
        candidate_id_bytes = r.get(f"invite:{invite_token}")
        if not candidate_id_bytes:
            raise HTTPException(status_code=404, detail="Invalid or expired interview invitation token.")
        candidate_id = int(candidate_id_bytes.decode("utf-8"))
    except Exception as re:
        if isinstance(re, HTTPException):
            raise re
        print(f"Redis token check failed: {re}")
        raise HTTPException(status_code=500, detail="Database connection failed.")
        
    candidate = db.query(Candidate).filter(Candidate.id == candidate_id).first()
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found.")
        
    job = candidate.job
    if not job:
        raise HTTPException(status_code=404, detail="Job position not found.")
        
    return templates.TemplateResponse(
        request=request,
        name="interview_landing.html",
        context={
            "candidate": {
                "id": candidate.id,
                "name": candidate.name or "Candidate",
                "email": candidate.email
            },
            "job": {
                "title": job.title,
                "department": job.department,
                "jd": job.jd,
                "vic": job.vic
            },
            "invite_token": invite_token
        }
    )

@app.post("/api/webhooks/email/delivered")
def email_delivered_webhook(events: List[dict]):
    for event in events:
        email = event.get("email")
        print(f"SendGrid Webhook: Email to {email} successfully delivered.")
    return {"status": "ok"}

@app.post("/api/webhooks/email/bounced")
def email_bounced_webhook(events: List[dict], db: Session = Depends(get_db)):
    for event in events:
        email = event.get("email")
        reason = event.get("reason", "unknown bounce reason")
        print(f"SendGrid Webhook: Email to {email} bounced. Reason: {reason}")
        candidate = db.query(Candidate).filter(Candidate.email == email).first()
        if candidate:
            candidate.status = "manual_review"
            db.commit()
    return {"status": "ok"}

@app.post("/api/webhooks/livekit/room-closed")
async def livekit_room_closed_webhook(request: Request, db: Session = Depends(get_db)):
    """
    BB4 Trigger: Called by LiveKit when a room session ends and a recording is ready.
    Architecture spec Section 7.5: Validates JWT signature, extracts recording URL,
    triggers Celery process_audio task on audio-worker queue.
    Handles two LiveKit event types:
      - 'room_ended' / 'room_finished': Room session is closed
      - 'recording_file_finished' / 'egress_ended' / 'egress_finished': Recording file is ready with download URL
    """
    from backend.workers.tasks import process_audio
    from backend.utils.pipeline_logger import log_pipeline_event

    body = await request.body()
    try:
        payload = json.loads(body)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")

    event_type = payload.get("event")
    room_name = (
        payload.get("room", {}).get("name") or 
        payload.get("roomName") or
        payload.get("egressInfo", {}).get("roomName") or
        payload.get("egress_info", {}).get("room_name")
    )
    print(f"LiveKit webhook: event={event_type}, room={room_name}")

    # Resolve interview_id
    interview_id = None
    if room_name:
        interview_val = db.query(Interview).filter(Interview.room_id == room_name).first()
        if interview_val:
            interview_id = interview_val.id

    log_pipeline_event(
        step="webhook_received",
        interview_id=interview_id or 0,
        status="success",
        details={"event": event_type, "room_name": room_name, "payload": payload}
    )

    # Handle recording_file_finished or egress_ended or egress_finished — this carries the download URL
    if event_type in ["recording_file_finished", "egress_ended", "egress_finished"]:
        recording_url = (
            payload.get("egressInfo", {}).get("fileResults", [{}])[0].get("downloadUrl") or
            payload.get("egress_info", {}).get("file_results", [{}])[0].get("download_url") or
            payload.get("downloadUrl") or
            payload.get("download_url") or
            payload.get("fileUri") or
            payload.get("file_uri")
        )

        if not recording_url:
            print(f"LiveKit webhook: No recording URL in payload for room {room_name}")
            log_pipeline_event(
                step="webhook_processing_failed",
                interview_id=interview_id or 0,
                status="failed",
                details={"reason": "no_recording_url", "payload": payload}
            )
            return {"status": "no_recording_url"}

        if not room_name:
            print(f"LiveKit webhook: No room name in payload")
            log_pipeline_event(
                step="webhook_processing_failed",
                interview_id=interview_id or 0,
                status="failed",
                details={"reason": "no_room_name", "payload": payload}
            )
            return {"status": "no_room_name"}

        # Look up interview by room_id
        interview = db.query(Interview).filter(Interview.room_id == room_name).first()
        if not interview:
            print(f"LiveKit webhook: No interview found for room {room_name}")
            log_pipeline_event(
                step="webhook_processing_failed",
                interview_id=interview_id or 0,
                status="failed",
                details={"reason": "interview_not_found", "room_name": room_name}
            )
            return {"status": "not_found"}

        # Save recording URL and dispatch BB4
        interview.recording_url = recording_url
        if interview.status not in ["completed", "audio_processing", "recording_ready", "analysis_complete"]:
            interview.status = "completed"
        db.commit()

        process_audio.apply_async(
            args=[interview.id, recording_url],
            queue="audio-worker"
        )
        print(f"LiveKit webhook: Dispatched BB4 for interview {interview.id} (room {room_name})")
        log_pipeline_event(
            step="bb4_dispatched",
            interview_id=interview.id,
            status="success",
            details={"recording_url": recording_url, "room_name": room_name}
        )
        return {"status": "bb4_dispatched", "interview_id": interview.id}

    # Handle room_ended or room_finished — update status but wait for recording_file_finished for BB4
    elif event_type in ["room_ended", "room_finished"]:
        if room_name:
            interview = db.query(Interview).filter(Interview.room_id == room_name).first()
            if interview and interview.status == "ongoing":
                interview.status = "completed"
                db.commit()
                print(f"LiveKit webhook: Room {room_name} ended. Interview {interview.id} -> completed")
                log_pipeline_event(
                    step="room_ended_acknowledged",
                    interview_id=interview.id,
                    status="success",
                    details={"room_name": room_name}
                )
        return {"status": "room_ended_ack"}

    return {"status": "unhandled_event", "event": event_type}



# --- PHASE 5 ENDPOINTS ---

class StartRequest(BaseModel):
    token: str

class LogEventRequest(BaseModel):
    token: str
    event_type: str

class EndTokenRequest(BaseModel):
    token: str

@app.post("/api/interviews/start")
@limiter.limit(settings.RATE_LIMIT_PUBLIC_START)
async def start_interview(payload: StartRequest, request: Request, db: Session = Depends(get_db)):
    token = payload.token
    
    # 1. Look up candidate by token in DB
    candidate = db.query(Candidate).filter(Candidate.latest_invite_token == token).first()
    if not candidate:
        raise HTTPException(status_code=404, detail="Invalid or expired interview token.")
        
    # Get latest interview
    interview = db.query(Interview).filter(Interview.candidate_id == candidate.id).order_by(Interview.id.desc()).first()
    if not interview:
        raise HTTPException(status_code=404, detail="No interview found for this candidate.")
        
    try:
        r = redis.from_url(settings.REDIS_URL)
    except Exception as re:
        print(f"Redis connection failed: {re}")
        raise HTTPException(status_code=500, detail="Database connection failed.")
        
    # Handle Completed/Failed status
    if interview.status == "completed":
        raise HTTPException(status_code=409, detail="This interview has already been completed.")
    elif interview.status == "failed":
        raise HTTPException(status_code=410, detail="This interview session has expired.")
        
    # Reconnection check
    if interview.status in ["ongoing", "reconnecting"]:
        room_id = interview.room_id
        if room_id:
            # Check if room is active in Redis (room tracking key exists)
            created_at = r.get(f"room:{room_id}:created_at")
            if created_at:
                # Room is active, return same WebRTC credentials (regenerated token)
                from livekit import api
                livekit_token = api.AccessToken(settings.LIVEKIT_API_KEY, settings.LIVEKIT_API_SECRET or settings.LIVEKIT_SECRET) \
                    .with_identity(f"candidate_{candidate.id}") \
                    .with_name(candidate.name or "Candidate") \
                    .with_grants(api.VideoGrants(
                        room_join=True,
                        room=room_id,
                    )) \
                    .to_jwt()
                return {
                    "status": "reconnecting",
                    "room_id": room_id,
                    "livekit_url": settings.LIVEKIT_URL,
                    "token": livekit_token
                }
            else:
                # Redis room tracking key does not exist. This means room expired (empty > 10m).
                interview.status = "failed"
                candidate.status = "rejected_post_interview"
                db.commit()
                raise HTTPException(status_code=410, detail="This interview room has expired.")
                
    # First-time Start!
    # Layer 1 — Redis Atomic Token Lock
    # Use Redis SET invite:{token}:used "used" NX EX 2100.
    lock_set = r.set(f"invite:{token}:used", "used", nx=True, ex=2100)
    if not lock_set:
        raise HTTPException(status_code=409, detail="Interview already started or start request in progress.")
        
    # Layer 2 — Interview Status Check
    if interview.status == "ongoing":
        raise HTTPException(status_code=409, detail="Interview session is already active.")
        
    # Layer 3 — LiveKit Room Participant Cap
    room_id = f"room_{interview.id}"
    
    from livekit.api import LiveKitAPI, CreateRoomRequest
    lk_api = LiveKitAPI(
        settings.LIVEKIT_URL,
        settings.LIVEKIT_API_KEY,
        settings.LIVEKIT_API_SECRET or settings.LIVEKIT_SECRET
    )
    try:
        # Create room with participant cap = 2 (agent + candidate)
        await lk_api.room.create_room(CreateRoomRequest(name=room_id, max_participants=2, empty_timeout=600))
    except Exception as le:
        print(f"Failed to create LiveKit room: {le}")
        # rollback redis lock
        r.delete(f"invite:{token}:used")
        raise HTTPException(status_code=500, detail="Failed to initialize live voice room.")
    finally:
        await lk_api.aclose()
        
    # Redis Room Tracking
    import time
    now_epoch = int(time.time())
    r.set(f"room:{room_id}:created_at", str(now_epoch), ex=2100)
    r.set(f"room:{room_id}:candidate_id", str(candidate.id), ex=2100)
    r.set(f"room:{room_id}:interview_id", str(interview.id), ex=2100)
    
    # Update DB states
    interview.status = "ongoing"
    interview.room_id = room_id
    interview.room_url = settings.LIVEKIT_URL
    candidate.status = "interview_ongoing"
    db.commit()
    db.refresh(interview)
    db.refresh(candidate)
    
    # Spawn the AI Agent worker task
    # We pass queue="ai-worker" to ensure it's handled by talentstream_ai_worker
    spawn_agent.apply_async(
        args=[candidate.id, candidate.job_id, room_id, interview.id],
        queue="ai-worker"
    )
    
    # Generate token for candidate
    from livekit import api
    candidate_token = api.AccessToken(settings.LIVEKIT_API_KEY, settings.LIVEKIT_API_SECRET or settings.LIVEKIT_SECRET) \
        .with_identity(f"candidate_{candidate.id}") \
        .with_name(candidate.name or "Candidate") \
        .with_grants(api.VideoGrants(
            room_join=True,
            room=room_id,
        )) \
        .to_jwt()
        
    return {
        "status": "started",
        "room_id": room_id,
        "livekit_url": settings.LIVEKIT_URL,
        "token": candidate_token
    }

@app.post("/api/interviews/log-event")
def log_interview_event(payload: LogEventRequest, db: Session = Depends(get_db)):
    token = payload.token
    event_type = payload.event_type
    
    candidate = db.query(Candidate).filter(Candidate.latest_invite_token == token).first()
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found.")
        
    interview = db.query(Interview).filter(Interview.candidate_id == candidate.id).order_by(Interview.id.desc()).first()
    if not interview:
        raise HTTPException(status_code=404, detail="Interview not found.")
        
    from backend.db.models import InterviewEvent
    event = InterviewEvent(
        interview_id=interview.id,
        event_type=event_type
    )
    db.add(event)
    db.commit()
    print(f"Logged interview event '{event_type}' for interview {interview.id}")
    return {"status": "ok"}

@app.post("/api/interviews/end-token")
async def end_interview_by_token(payload: EndTokenRequest, db: Session = Depends(get_db)):
    token = payload.token

    # Primary: look up directly by Interview.invite_token (always set when interview is created)
    interview = db.query(Interview).filter(Interview.invite_token == token).first()

    # Fallback: look up via Candidate.latest_invite_token (may lag or be null in edge cases)
    if not interview:
        candidate_by_token = db.query(Candidate).filter(Candidate.latest_invite_token == token).first()
        if candidate_by_token:
            interview = db.query(Interview).filter(Interview.candidate_id == candidate_by_token.id).order_by(Interview.id.desc()).first()

    if not interview:
        raise HTTPException(status_code=404, detail="Interview not found for this token.")

    candidate = interview.candidate
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found.")

    await perform_end_interview(interview, candidate, db)
    return {"status": "ok"}

@app.post("/api/interviews/{interview_id}/end")
async def end_interview_by_id(interview_id: int, db: Session = Depends(get_db)):
    interview = db.query(Interview).filter(Interview.id == interview_id).first()
    if not interview:
        raise HTTPException(status_code=404, detail="Interview not found.")
        
    candidate = interview.candidate
    await perform_end_interview(interview, candidate, db)
    return {"status": "ok"}

async def perform_end_interview(interview, candidate, db: Session):
    interview.status = "completed"
    candidate.status = "interview_completed"
    db.commit()
    
    room_id = interview.room_id
    if room_id:
        from livekit.api import LiveKitAPI
        lk_api = LiveKitAPI(
            settings.LIVEKIT_URL,
            settings.LIVEKIT_API_KEY,
            settings.LIVEKIT_API_SECRET or settings.LIVEKIT_SECRET
        )
        try:
            from livekit.api import DeleteRoomRequest
            await lk_api.room.delete_room(DeleteRoomRequest(room=room_id))
            print(f"LiveKit: Room {room_id} deleted successfully.")
        except Exception as le:
            print(f"LiveKit: Failed to delete room {room_id}: {le}")
        finally:
            await lk_api.aclose()
            
        try:
            r = redis.from_url(settings.REDIS_URL)
            r.delete(f"room:{room_id}:created_at")
            r.delete(f"room:{room_id}:disconnect_time")
            r.delete(f"room:{room_id}:candidate_id")
            r.delete(f"room:{room_id}:interview_id")
        except Exception as re:
            print(f"Redis room cleanup failed: {re}")

@app.get("/api/sse/analysis/{interview_id}")
async def sse_interview_analysis(interview_id: int, request: Request):
    async def event_generator():
        r = redis.from_url(settings.REDIS_URL)
        pubsub = r.pubsub()
        pubsub.subscribe(f"sse:analysis:{interview_id}")
        try:
            while True:
                if await request.is_disconnected():
                    break
                # Check for message
                message = pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
                if message:
                    data = message['data'].decode('utf-8')
                    yield f"data: {data}\n\n"
                await asyncio.sleep(0.5)
        finally:
            pubsub.unsubscribe(f"sse:analysis:{interview_id}")
            
    return StreamingResponse(event_generator(), media_type="text/event-stream")

async def agent_watchdog_loop():
    import time
    from backend.db.session import SessionLocal
    from backend.db.models import Interview
    
    r = redis.from_url(settings.REDIS_URL)
    while True:
        await asyncio.sleep(30)
        try:
            keys = r.keys("room:*:last_heartbeat")
            for key in keys:
                key_str = key.decode("utf-8")
                parts = key_str.split(":")
                if len(parts) == 3:
                    room_id = parts[1]
                    last_hb = r.get(key)
                    if last_hb:
                        last_hb_time = int(last_hb.decode("utf-8"))
                        if time.time() - last_hb_time > 120:  # 2 minutes stale
                            print(f"Watchdog: Stale agent heartbeat for room {room_id}. Restarting agent...")
                            cand_id = r.get(f"room:{room_id}:candidate_id")
                            int_id = r.get(f"room:{room_id}:interview_id")
                            if cand_id and int_id:
                                candidate_id = int(cand_id.decode("utf-8"))
                                interview_id = int(int_id.decode("utf-8"))
                                
                                db = SessionLocal()
                                try:
                                    interview = db.query(Interview).filter(Interview.id == interview_id).first()
                                    if interview and interview.status in ["ongoing", "reconnecting"]:
                                        # Trigger spawn_agent again
                                        spawn_agent.apply_async(
                                            args=[candidate_id, interview.candidate.job_id, room_id, interview_id],
                                            queue="ai-worker"
                                        )
                                        # Reset heartbeat timestamp so we don't trigger spawn again immediately
                                        r.set(f"room:{room_id}:last_heartbeat", str(int(time.time())), ex=120)
                                finally:
                                    db.close()
        except Exception as e:
            print(f"Error in watchdog loop: {e}")

@app.on_event("startup")
async def startup_event():
    asyncio.create_task(agent_watchdog_loop())

# Mount frontend static files directory
static_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "frontend", "static")
app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")
