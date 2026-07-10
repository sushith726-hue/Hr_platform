import os
import tempfile
import json
from celery import Celery
from openai import OpenAI
from llama_parse import LlamaParse
from pydantic import BaseModel, Field, EmailStr, field_validator
from typing import List, Optional
import re
import redis

from backend.config import settings
from backend.db.session import SessionLocal, get_s3_client
from backend.db.models import Candidate, Job, UploadBatch, UploadLog
import uuid
from datetime import datetime

celery_app = Celery(
    "tasks",
    broker=settings.REDIS_URL,
    backend=settings.REDIS_URL
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
)

# =============================================================================
# Phase 9: Sentry SDK — Celery worker error tracking
# =============================================================================
try:
    import sentry_sdk
    from sentry_sdk.integrations.celery import CeleryIntegration
    if settings.SENTRY_DSN:
        sentry_sdk.init(
            dsn=settings.SENTRY_DSN,
            integrations=[CeleryIntegration()],
            traces_sample_rate=0.1,
            environment=os.getenv("ENVIRONMENT", "production"),
            release=os.getenv("GIT_SHA", "unknown"),
        )
        print("[Sentry/Worker] Initialized.")
    else:
        print("[Sentry/Worker] SENTRY_DSN not set — tracking disabled.")
except ImportError:
    print("[Sentry/Worker] sentry-sdk not installed — skipping.")

# =============================================================================
# Phase 9: OpenAI Budget Guard — Redis-backed monthly cost tracker
# $50 hard cap; 80% threshold triggers Sentry warning.
# Key: openai:cost:YYYY-MM  (expires after 35 days)
# =============================================================================
# Approximate cost per 1M tokens for gpt-4o-mini (input+output blended)
_COST_PER_1K_TOKENS = 0.00020  # $0.20 per 1M tokens = $0.00020 per 1K

def openai_budget_guard(estimated_tokens: int = 2000) -> None:
    """
    Call before every OpenAI API invocation in the pipeline.
    Accumulates estimated cost in Redis. Raises RuntimeError if monthly cap exceeded.
    Sends Sentry warning at 80% threshold.

    Args:
        estimated_tokens: Rough token estimate for the upcoming call.
    """
    from datetime import datetime, timezone
    month_key = f"openai:cost:{datetime.now(timezone.utc).strftime('%Y-%m')}"
    r = redis.from_url(settings.REDIS_URL)

    estimated_cost = (estimated_tokens / 1000) * _COST_PER_1K_TOKENS
    # Atomic increment (stored as float in string form)
    new_total = float(r.incrbyfloat(month_key, estimated_cost))
    r.expire(month_key, 60 * 60 * 24 * 35)  # 35-day TTL

    budget = settings.OPENAI_BUDGET_USD
    alert_threshold = budget * settings.OPENAI_BUDGET_ALERT_PCT

    if new_total >= budget:
        msg = f"OpenAI monthly budget EXCEEDED: ${new_total:.2f} >= ${budget:.2f} cap"
        print(f"[BUDGET] {msg}")
        try:
            sentry_sdk.capture_message(msg, level="error")
        except Exception:
            pass
        raise RuntimeError(f"OpenAI budget cap of ${budget:.2f}/month exceeded. Blocking API call.")

    if new_total >= alert_threshold:
        msg = f"OpenAI monthly budget WARNING: ${new_total:.2f} (≥{int(settings.OPENAI_BUDGET_ALERT_PCT*100)}% of ${budget:.2f} cap)"
        print(f"[BUDGET] {msg}")
        try:
            sentry_sdk.capture_message(msg, level="warning")
        except Exception:
            pass


# =============================================================================
# BB2 Pydantic schemas
# Downstream consumers (BB3 scoring, API, frontend) depend on the field names
# in StructuredProfile.  Do NOT rename or remove any existing fields.
# start_date / end_date are NEW optional fields added ONLY to ExperienceItem
# so that the deterministic Python calculator can work without breaking BB3.
# =============================================================================

class EducationItem(BaseModel):
    school: Optional[str] = None
    degree: Optional[str] = None
    year: Optional[str] = None

class ExperienceItem(BaseModel):
    company: Optional[str] = None
    title: Optional[str] = None
    # start_date / end_date: NEW — ISO-ish strings extracted verbatim from resume
    # e.g. "2022-06", "June 2022", "2022".  Python uses these for calculation.
    # GPT must NOT invent these; null means the date was absent in the resume.
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    # duration is kept for backward compat but is now a human-readable string
    # copied from the resume verbatim (e.g. "Jun 2022 – Present").
    duration: Optional[str] = None
    description: Optional[str] = None

class ProjectItem(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    technologies: List[str] = Field(default_factory=list)
    duration: Optional[str] = None

class StructuredProfile(BaseModel):
    name: str
    # email is validated as EmailStr.  The raw GPT value is pre-cleaned before
    # Pydantic sees it so that strings like 'EMail' or 'N/A' become None and
    # cause a clean failure rather than a cryptic Pydantic error.
    email: Optional[EmailStr] = None
    phone: Optional[str] = None
    skills: List[str] = Field(default_factory=list)
    # experience_years is set DETERMINISTICALLY by Python after GPT extraction.
    # GPT is never asked to compute this value.
    experience_years: float = 0.0
    education: List[EducationItem] = Field(default_factory=list)
    experience: List[ExperienceItem] = Field(default_factory=list)
    projects: List[ProjectItem] = Field(default_factory=list)
    location: Optional[str] = None
    certifications: List[str] = Field(default_factory=list)
    languages: List[str] = Field(default_factory=list)

    @field_validator("experience_years")
    @classmethod
    def validate_experience_years(cls, v):
        if v is None:
            return 0.0
        if v < 0:
            raise ValueError("experience_years cannot be negative")
        if v > 60:
            raise ValueError("experience_years cannot exceed 60 years")
        return round(float(v), 1)

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, v):
        if not v or v.strip() == "" or v.lower() in ("n/a", "null", "none"):
            return ""
        cleaned = re.sub(r"[\s\-\+\(\)]", "", v)
        if cleaned and not cleaned.isdigit():
            # Be lenient: return empty rather than crashing for exotic formats
            return ""
        return v

# Helper for SSE publishing from worker
def publish_sse(upload_id: str, status: str, candidate_id: int | None = None, error: str | None = None):
    if not upload_id:
        return
    try:
        r = redis.from_url(settings.REDIS_URL)
        r.publish(f"sse:uploads:{upload_id}", json.dumps({
            "status": status,
            "candidate_id": candidate_id,
            "error": error
        }))
    except Exception as e:
        print(f"Failed to publish SSE event: {e}")

def strip_candidate_bias(profile: dict, candidate_id: int) -> dict:
    import datetime
    import re
    current_year = datetime.datetime.now().year
    
    stripped = {
        "anon_id": f"CANDIDATE_{candidate_id}",
        "skills": profile.get("skills", []),
        "experience_years": profile.get("experience_years", 0),
        "education": [],
        "experience": [],
        "projects": [],
        "location": profile.get("location", None),
        "certifications": profile.get("certifications", []),
        "languages": profile.get("languages", [])
    }
    
    for edu in profile.get("education", []):
        year_str = edu.get("year", "")
        years_since_degree = None
        if year_str:
            match = re.search(r"\b(19|20)\d{2}\b", str(year_str))
            if match:
                try:
                    grad_year = int(match.group(0))
                    years_since_degree = current_year - grad_year
                except:
                    pass
        
        stripped["education"].append({
            "degree_level": edu.get("degree", "Degree"),
            "years_since_degree": years_since_degree
        })
        
    for idx, exp in enumerate(profile.get("experience", [])):
        stripped["experience"].append({
            "anon_company": f"Company_{chr(65 + (idx % 26))}",
            "title": exp.get("title", "Position"),
            "duration": exp.get("duration", ""),
            "description": exp.get("description", "")
        })
        
    for idx, proj in enumerate(profile.get("projects", [])):
        stripped["projects"].append({
            "title": proj.get("title", f"Project_{idx+1}"),
            "description": proj.get("description", ""),
            "technologies": proj.get("technologies", []),
            "duration": proj.get("duration", "")
        })
        
    return stripped

@celery_app.task(bind=True, max_retries=3, name="backend.workers.tasks.score_candidate_profile", queue="ai-worker")
def score_candidate_profile(self, candidate_id: int, job_id: int, upload_id: Optional[str] = None, batch_id: Optional[str] = None, log_id: Optional[str] = None):
    db = SessionLocal()
    try:
        candidate = db.query(Candidate).filter(Candidate.id == candidate_id).first()
        if not candidate:
            print(f"Candidate {candidate_id} not found for scoring.")
            return {"error": "Candidate not found", "candidate_id": candidate_id}
            
        job = db.query(Job).filter(Job.id == job_id).first()
        if not job:
            print(f"Job {job_id} not found for candidate {candidate_id}.")
            return {"error": "Job not found", "candidate_id": candidate_id}
            
        if not candidate.structured_profile:
            print(f"Candidate {candidate_id} has no structured profile.")
            return {"error": "No structured profile", "candidate_id": candidate_id}
            
        # Step 1: Bias strip
        stripped_profile = strip_candidate_bias(candidate.structured_profile, candidate.id)
        
        # Step 2: Score using GPT-4o-mini
        openai_client = OpenAI(
            api_key=settings.OPENAI_API_KEY,
            base_url=settings.OPENAI_BASE_URL
        )
        
        rubric_dict = job.rubric_json or {}
        resume_rubric = rubric_dict.get("resume", rubric_dict)
        rubric_str = json.dumps(resume_rubric)
        profile_str = json.dumps(stripped_profile)
        
        weights = resume_rubric.get("weights", {})
        skills_max = int(weights.get("skills_max", 40))
        experience_max = int(weights.get("experience_max", 30))
        education_max = int(weights.get("education_max", 20))
        certs_max = int(weights.get("certs_max", 10))
        
        system_prompt = (
            "You are an expert recruitment coordinator. Score the candidate's anonymous profile against the job rubric.\n"
            "You must output a JSON object with the following fields:\n"
            "{\n"
            "  \"total_score\": <integer 0-100 representing sum of breakdown scores>,\n"
            "  \"recommendation\": \"<one of: strong_hire, hire, hold, manual_review, reject>\",\n"
            "  \"breakdown\": {\n"
            f"    \"skills_score\": <integer 0-{skills_max}>,\n"
            f"    \"experience_score\": <integer 0-{experience_max}>,\n"
            f"    \"education_score\": <integer 0-{education_max}>,\n"
            f"    \"certs_score\": <integer 0-{certs_max}>,\n"
            "    \"rationale\": \"<detailed rationale for the scores>\"\n"
            "  }\n"
            "}\n\n"
            "Rules:\n"
            f"1. total_score must be the exact sum of skills_score (max {skills_max}), experience_score (max {experience_max}), education_score (max {education_max}), and certs_score (max {certs_max}).\n"
            "2. recommendation must be one of: 'strong_hire', 'hire', 'hold', 'manual_review', 'reject'."
        )
        
        user_prompt = (
            f"Job Title: {job.title}\n"
            f"Job Rubric: {rubric_str}\n\n"
            f"Anonymous Candidate Profile:\n{profile_str}"
        )
        
        errors = []
        scoring_data = None
        for attempt in range(2):
            try:
                current_prompt = user_prompt
                if errors:
                    current_prompt += f"\n\nPrevious attempt failed validation with error:\n{errors[-1]}\nPlease correct the error."
                    
                openai_budget_guard(estimated_tokens=3000)  # BB1 formatting call
                response = openai_client.chat.completions.create(
                    model=settings.OPENAI_MODEL_FORMATTING,
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": current_prompt}
                    ],
                    temperature=0,
                    seed=42,
                    response_format={"type": "json_object"}
                )
                
                content = response.choices[0].message.content
                parsed = json.loads(content)
                
                # Validation
                total_score = int(parsed.get("total_score", 0))
                recommendation = parsed.get("recommendation", "")
                breakdown = parsed.get("breakdown", {})
                
                skills_score = int(breakdown.get("skills_score", 0))
                experience_score = int(breakdown.get("experience_score", 0))
                education_score = int(breakdown.get("education_score", 0))
                certs_score = int(breakdown.get("certs_score", 0))
                
                if not (0 <= skills_score <= skills_max):
                    raise ValueError(f"skills_score ({skills_score}) must be between 0 and {skills_max}")
                if not (0 <= experience_score <= experience_max):
                    raise ValueError(f"experience_score ({experience_score}) must be between 0 and {experience_max}")
                if not (0 <= education_score <= education_max):
                    raise ValueError(f"education_score ({education_score}) must be between 0 and {education_max}")
                if not (0 <= certs_score <= certs_max):
                    raise ValueError(f"certs_score ({certs_score}) must be between 0 and {certs_max}")
                
                if not (0 <= total_score <= 100):
                    raise ValueError("total_score must be between 0 and 100")
                if total_score != (skills_score + experience_score + education_score + certs_score):
                    raise ValueError(f"total_score ({total_score}) does not equal sum of subscores ({skills_score + experience_score + education_score + certs_score})")
                if recommendation not in ["strong_hire", "hire", "hold", "manual_review", "reject"]:
                    raise ValueError("recommendation must be one of: strong_hire, hire, hold, manual_review, reject")
                    
                scoring_data = parsed
                break
            except Exception as e:
                errors.append(str(e))
                print(f"Scoring attempt {attempt+1} failed: {e}")
                
        if not scoring_data:
            print("Scoring failed twice, falling back to manual_review status.")
            candidate.status = "manual_review"
            candidate.match_score = 0
            candidate.match_breakdown = {
                "skills_score": 0,
                "experience_score": 0,
                "education_score": 0,
                "certs_score": 0,
                "rationale": f"Scoring validation failed. Errors: {errors}"
            }
            candidate.ai_recommendation = "manual_review"
            
            # Update batch and log counts
            if log_id:
                log = db.query(UploadLog).filter(UploadLog.id == uuid.UUID(log_id)).first()
                if log:
                    log.status = "scored"
                    log.completed_at = datetime.utcnow()
            if batch_id:
                batch = db.query(UploadBatch).filter(UploadBatch.id == uuid.UUID(batch_id)).first()
                if batch:
                    batch.processed_count += 1
                    batch.processing_count = max(0, batch.processing_count - 1)
                    if batch.processed_count + batch.failed_count >= batch.total_files:
                        batch.status = "completed"
                        batch.completed_at = datetime.utcnow()
            db.commit()
            publish_sse(upload_id, "manual_review", candidate_id)
            if batch_id:
                publish_batch_sse(batch_id, db)
            return {"candidate_id": candidate_id, "status": "scored"}
            
        candidate.match_score = scoring_data.get("total_score")
        candidate.match_breakdown = scoring_data.get("breakdown")
        candidate.ai_recommendation = scoring_data.get("recommendation")
        candidate.status = "new"
        
        # Update batch and log counts
        if log_id:
            log = db.query(UploadLog).filter(UploadLog.id == uuid.UUID(log_id)).first()
            if log:
                log.status = "scored"
                log.completed_at = datetime.utcnow()
        if batch_id:
            batch = db.query(UploadBatch).filter(UploadBatch.id == uuid.UUID(batch_id)).first()
            if batch:
                batch.processed_count += 1
                batch.processing_count = max(0, batch.processing_count - 1)
                if batch.processed_count + batch.failed_count >= batch.total_files:
                    batch.status = "completed"
                    batch.completed_at = datetime.utcnow()
        db.commit()
        publish_sse(upload_id, "new", candidate_id)
        if batch_id:
            publish_batch_sse(batch_id, db)
        return {"candidate_id": candidate_id, "status": "scored"}
        
    except Exception as exc:
        db.rollback()
        if self.request.retries < 3:
            countdown = (2 ** self.request.retries) * 60 + random.randint(0, 30)
            raise self.retry(exc=exc, countdown=countdown)
        else:
            # Max retries reached
            try:
                candidate = db.query(Candidate).filter(Candidate.id == candidate_id).first()
                if candidate:
                    candidate.status = "manual_review"
                    candidate.match_score = 0
                    candidate.match_breakdown = {
                        "skills_score": 0,
                        "experience_score": 0,
                        "education_score": 0,
                        "certs_score": 0,
                        "rationale": f"Max retries exceeded scoring candidate. Error: {exc}"
                    }
                    candidate.ai_recommendation = "manual_review"
                
                # Update batch and log counts
                if log_id:
                    log = db.query(UploadLog).filter(UploadLog.id == uuid.UUID(log_id)).first()
                    if log:
                        log.status = "scored"
                        log.completed_at = datetime.utcnow()
                if batch_id:
                    batch = db.query(UploadBatch).filter(UploadBatch.id == uuid.UUID(batch_id)).first()
                    if batch:
                        batch.processed_count += 1
                        batch.processing_count = max(0, batch.processing_count - 1)
                        if batch.processed_count + batch.failed_count >= batch.total_files:
                            batch.status = "completed"
                            batch.completed_at = datetime.utcnow()
                db.commit()
                publish_sse(upload_id, "manual_review", candidate_id)
                if batch_id:
                    publish_batch_sse(batch_id, db)
            except Exception as dbe:
                print(f"Failed to update status to manual_review on max retries: {dbe}")
            return {"error": "Max retries exceeded", "candidate_id": candidate_id}
    finally:
        db.close()

def publish_batch_sse(batch_id: str, db):
    try:
        r = redis.from_url(settings.REDIS_URL)
        batch = db.query(UploadBatch).filter(UploadBatch.id == uuid.UUID(batch_id)).first()
        if batch:
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

def generate_mismatches_audit(raw_text: str, structured: dict) -> dict:
    import re
    mismatches = {}
    raw_text_lower = raw_text.lower()
    
    # 1. Check name
    name = structured.get("name")
    if name and name.lower() not in raw_text_lower:
        mismatches["name"] = f"Name '{name}' not found in raw text."
        
    # 2. Check email
    email = structured.get("email")
    if email and email.lower() not in raw_text_lower:
        mismatches["email"] = f"Email '{email}' not found in raw text."
        
    # 3. Check phone
    phone = structured.get("phone")
    if phone:
        clean_phone = re.sub(r"\D", "", phone)
        clean_raw = re.sub(r"\D", "", raw_text_lower)
        if clean_phone not in clean_raw:
            mismatches["phone"] = f"Phone '{phone}' not found in raw text."
            
    # 4. Check experience years
    exp_years = structured.get("experience_years", 0)
    if exp_years > 0:
        match_found = False
        patterns = [
            rf"\b{exp_years}\b",
            rf"\b{int(exp_years)}\b\s*years?",
        ]
        for pattern in patterns:
            if re.search(pattern, raw_text_lower):
                match_found = True
                break
        if not match_found:
            mismatches["experience_years"] = f"Experience years value {exp_years} is not explicitly mentioned in the text (likely inferred/calculated)."
            
    # 5. Check experience companies and titles
    for idx, exp in enumerate(structured.get("experience", [])):
        company = exp.get("company")
        if company and company.lower() != "n/a" and company.lower() not in raw_text_lower:
            mismatches[f"experience_{idx}_company"] = f"Company '{company}' not found in raw text."
        title = exp.get("title")
        if title and title.lower() != "n/a" and title.lower() not in raw_text_lower:
            mismatches[f"experience_{idx}_title"] = f"Title '{title}' not found in raw text."
            
    # 6. Check projects
    for idx, proj in enumerate(structured.get("projects", [])):
        title = proj.get("title")
        if title and title.lower() not in raw_text_lower:
            mismatches[f"project_{idx}_title"] = f"Project title '{title}' not found in raw text."
            
    return mismatches


# =============================================================================
# BB2 — Deterministic experience_years calculator
# Runs AFTER GPT extraction, BEFORE database persistence.
# GPT is only asked to extract start_date/end_date verbatim from the resume.
# This function converts those strings into a decimal year total using Python
# datetime arithmetic.  It never estimates or infers.
# =============================================================================

_MONTH_MAP = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
    "january": 1, "february": 2, "march": 3, "april": 4, "june": 6,
    "july": 7, "august": 8, "september": 9, "october": 10,
    "november": 11, "december": 12,
}

def _parse_date_to_dt(date_str: str):
    """
    Convert a human-readable date string to a datetime.date.
    Returns None if the string cannot be parsed.
    Accepted formats (case-insensitive):
      - "Present" / "Current" / "Now"  → today
      - "2023"                          → Jan 1 2023  (for start), Dec 31 2023 (for end)
      - "2023-06"                       → Jun 1 2023
      - "June 2023", "Jun 2023"         → Jun 1 2023
      - "06/2023", "06-2023"            → Jun 1 2023
    """
    import datetime as _dt
    if not date_str:
        return None
    s = date_str.strip().lower()
    today = _dt.date.today()

    if s in ("present", "current", "now", "till date", "to date"):
        return today

    # Try ISO "YYYY-MM"
    m = re.match(r'^(\d{4})[\/\-](\d{1,2})$', s)
    if m:
        try:
            return _dt.date(int(m.group(1)), int(m.group(2)), 1)
        except ValueError:
            return None

    # Try "YYYY" only
    m = re.match(r'^(\d{4})$', s)
    if m:
        return _dt.date(int(m.group(1)), 1, 1)

    # Try "Month YYYY" or "YYYY Month"
    m = re.match(r'^([a-z]+)\s+(\d{4})$', s)
    if m:
        month_num = _MONTH_MAP.get(m.group(1))
        if month_num:
            try:
                return _dt.date(int(m.group(2)), month_num, 1)
            except ValueError:
                return None
    m = re.match(r'^(\d{4})\s+([a-z]+)$', s)
    if m:
        month_num = _MONTH_MAP.get(m.group(2))
        if month_num:
            try:
                return _dt.date(int(m.group(1)), month_num, 1)
            except ValueError:
                return None

    # Try MM/YYYY or MM-YYYY
    m = re.match(r'^(\d{1,2})[\/\-](\d{4})$', s)
    if m:
        try:
            return _dt.date(int(m.group(2)), int(m.group(1)), 1)
        except ValueError:
            return None

    return None  # Unparseable — caller will skip this entry


def _calculate_experience_years(experience_list, candidate_id: int) -> float:
    """
    Deterministically calculate total professional experience in years.
    Uses start_date / end_date extracted verbatim by GPT.
    - If experience list is empty → 0.0
    - If dates are missing or unparseable → 0.0 for that entry (logged)
    - Overlapping intervals are merged to avoid double-counting
    - Final value is rounded to 1 decimal place
    """
    import datetime as _dt

    if not experience_list:
        print(f"[BB2][candidate={candidate_id}] No experience entries → experience_years = 0")
        return 0.0

    intervals = []
    for exp in experience_list:
        # Support both Pydantic model objects and plain dicts
        if hasattr(exp, "start_date"):
            sd_str = exp.start_date
            ed_str = exp.end_date
        else:
            sd_str = exp.get("start_date")
            ed_str = exp.get("end_date")

        if not sd_str:
            print(f"[BB2][candidate={candidate_id}] Experience entry missing start_date — skipped for calculation")
            continue

        start = _parse_date_to_dt(sd_str)
        if start is None:
            print(f"[BB2][candidate={candidate_id}] Could not parse start_date='{sd_str}' — skipped")
            continue

        end = _parse_date_to_dt(ed_str) if ed_str else _dt.date.today()
        if end is None:
            print(f"[BB2][candidate={candidate_id}] Could not parse end_date='{ed_str}' — using today")
            end = _dt.date.today()

        if end < start:
            print(f"[BB2][candidate={candidate_id}] end_date '{ed_str}' < start_date '{sd_str}' — skipped")
            continue

        intervals.append((start, end))

    if not intervals:
        print(f"[BB2][candidate={candidate_id}] No parseable date intervals → experience_years = 0")
        return 0.0

    # Merge overlapping intervals to prevent double-counting
    intervals.sort(key=lambda x: x[0])
    merged = [intervals[0]]
    for start, end in intervals[1:]:
        if start <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        else:
            merged.append((start, end))

    # Sum total days and convert to years
    total_days = sum((e - s).days for s, e in merged)
    years = round(total_days / 365.25, 1)

    print(f"[BB2][candidate={candidate_id}] Calculated experience_years={years} "
          f"from {len(merged)} merged interval(s) ({total_days} days total)")
    return years


@celery_app.task(name="backend.workers.tasks.parse_resume")
def parse_resume(candidate_id: int, upload_id: str = None, batch_id: str = None, log_id: str = None):

    db = SessionLocal()
    
    # helper to update batch & logs on failure
    def handle_task_failure(err_msg: str, is_unable: bool = False):
        try:
            if log_id:
                log = db.query(UploadLog).filter(UploadLog.id == uuid.UUID(log_id)).first()
                if log:
                    log.status = "unable_to_process" if is_unable else "failed"
                    log.error_message = err_msg
                    log.completed_at = datetime.utcnow()
                    db.commit()
            if batch_id:
                batch = db.query(UploadBatch).filter(UploadBatch.id == uuid.UUID(batch_id)).first()
                if batch:
                    batch.failed_count += 1
                    batch.processing_count = max(0, batch.processing_count - 1)
                    if batch.processed_count + batch.failed_count >= batch.total_files:
                        batch.status = "completed"
                        batch.completed_at = datetime.utcnow()
                    db.commit()
                    publish_batch_sse(batch_id, db)
        except Exception as dbe:
            print(f"Failed to record task failure: {dbe}")

    try:
        candidate = db.query(Candidate).filter(Candidate.id == candidate_id).first()
        if not candidate:
            print(f"Candidate {candidate_id} not found.")
            handle_task_failure("Candidate not found in database.")
            return

        if log_id:
            log = db.query(UploadLog).filter(UploadLog.id == uuid.UUID(log_id)).first()
            if log:
                log.status = "parsing"
                db.commit()
        if batch_id:
            publish_batch_sse(batch_id, db)

        publish_sse(upload_id, "parsing", candidate_id)
        
        # Download from S3
        s3_client = get_s3_client()
        
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
            tmp_path = tmp.name
            
        llamaparse_succeeded = False
        raw_text = None
        error_msg = ""
        try:
            s3_client.download_file(
                settings.S3_BUCKET_NAME,
                candidate.resume_url,
                tmp_path
            )
            
            # 1. Parse with LlamaParse
            try:
                parser = LlamaParse(
                    api_key=settings.LLAMAPARSE_API_KEY,
                    result_type="text",
                    parsing_instruction="Extract all text content from this resume precisely. Preserve structure, headings, dates, and contact information.",
                    mode="agentic"
                )
                documents = parser.load_data(tmp_path)
                if documents and len(documents) > 0:
                    raw_text = "\n".join([doc.text for doc in documents])
            except Exception as pe:
                print(f"LlamaParse agentic mode failed: {pe}. Retrying in standard mode...")
                try:
                    parser = LlamaParse(
                        api_key=settings.LLAMAPARSE_API_KEY,
                        result_type="text",
                        parsing_instruction="Extract all text content from this resume precisely.",
                        mode="standard"
                    )
                    documents = parser.load_data(tmp_path)
                    if documents and len(documents) > 0:
                        raw_text = "\n".join([doc.text for doc in documents])
                except Exception as pe2:
                    print(f"LlamaParse standard mode failed: {pe2}")
            
            if not raw_text:
                raise ValueError("Could not extract any text from resume using LlamaParse.")
            
            llamaparse_succeeded = True
        except Exception as e:
            error_msg = str(e)
            print(f"LlamaParse or download failed: {error_msg}")
            raise ValueError(f"Parse failed: {error_msg}")
            
            if log_id:
                log = db.query(UploadLog).filter(UploadLog.id == uuid.UUID(log_id)).first()
                if log:
                    log.status = "structured"
                    db.commit()
            if batch_id:
                publish_batch_sse(batch_id, db)

            # ----------------------------------------------------------------
            # BB2 Step 2: GPT extraction prompt
            # DESIGN PRINCIPLE: GPT is a PURE EXTRACTOR — not a calculator,
            # not an estimator.  All calculation happens in Python after this.
            # ----------------------------------------------------------------

            # Log the raw LlamaParse output for debugging
            print(f"[BB2][candidate={candidate_id}] RAW LLAMAPARSE OUTPUT ({len(raw_text)} chars):\n{raw_text[:3000]}")

            system_prompt = (
                "You are a resume data extractor. Your ONLY job is to copy information "
                "verbatim from the resume text into the JSON fields described below. "
                "You must NEVER infer, estimate, calculate, guess, or fabricate anything.\n\n"

                "CRITICAL RULES:\n"
                "1. EXTRACT ONLY — copy words/numbers exactly as they appear. "
                "   If a field is absent from the resume, return null or [].\n"
                "2. EXPERIENCE vs PROJECTS — the 'experience' array is for PAID "
                "   PROFESSIONAL EMPLOYMENT ONLY (a real company paid the person a "
                "   salary/wage for their work). University capstone projects, personal "
                "   side-projects, open-source contributions, hackathons, research "
                "   papers, internships at college, and club activities are NOT "
                "   professional experience. Place them in 'projects' instead.\n"
                "3. DO NOT INVENT COMPANY NAMES — if a role has no employer name "
                "   written on the resume, set company to null. Never use a project "
                "   title or technology name as a company name.\n"
                "4. DATE FIELDS — for each experience entry, extract start_date and "
                "   end_date exactly as written (e.g. 'June 2022', '2022-06', "
                "   'Present'). If a date is absent, set it to null. "
                "   Do NOT calculate or estimate duration.\n"
                "5. DO NOT SET experience_years — set it to 0. The system "
                "   calculates this automatically from dates. Never compute it.\n"
                "6. EMAIL — extract the literal email address if present. "
                "   If the text says 'EMail', 'N/A', or no email exists, return null.\n"
                "7. PHONE — extract only the literal phone number string. "
                "   If absent, return null.\n"
                "8. NO DEFAULTS — never fill a field with a placeholder value. "
                "   Unknown = null or []. Do not guess.\n"
            )

            user_prompt = (
                "Extract the following JSON from the resume text below.\n"
                "Return ONLY a valid JSON object with these exact keys. "
                "Do not add any text outside the JSON.\n\n"
                "{\n"
                '  "name": null,\n'
                '  "email": null,\n'
                '  "phone": null,\n'
                '  "location": null,\n'
                '  "skills": [],\n'
                '  "experience_years": 0,\n'
                '  "education": [\n'
                '    {"school": null, "degree": null, "year": null}\n'
                '  ],\n'
                '  "experience": [\n'
                '    {\n'
                '      "company": null,\n'
                '      "title": null,\n'
                '      "start_date": null,\n'
                '      "end_date": null,\n'
                '      "duration": null,\n'
                '      "description": null\n'
                '    }\n'
                '  ],\n'
                '  "projects": [\n'
                '    {\n'
                '      "title": null,\n'
                '      "description": null,\n'
                '      "technologies": [],\n'
                '      "duration": null\n'
                '    }\n'
                '  ],\n'
                '  "certifications": [],\n'
                '  "languages": []\n'
                '}\n\n'
                "RULES REMINDER:\n"
                "- experience[] = PAID EMPLOYMENT ONLY (salary/wage from a real employer).\n"
                "- projects[] = everything else: university capstones, personal projects, "
                "  hackathons, open-source, internships listed without company, etc.\n"
                "- experience_years = always 0 (Python calculates this, not you).\n"
                "- If experience[] is empty (no paid employment found), that is correct.\n"
                "- Do NOT invent company names. If no employer name exists for a role, "
                "  set company to null and move the entry to projects[].\n"
                "- start_date and end_date: copy the exact text from the resume "
                "  (e.g. 'Jan 2023', '2023-01', 'Present'). null if not written.\n\n"
                f"Resume text:\n{raw_text}"
            )
            
            openai_client = OpenAI(
                api_key=settings.OPENAI_API_KEY,
                base_url=settings.OPENAI_BASE_URL
            )
            
            errors = []
            structured_data = None
            last_content = None
            for attempt in range(3):
                try:
                    current_prompt = user_prompt
                    if errors:
                        current_prompt += f"\n\nPrevious attempt failed Pydantic validation with errors:\n" + "\n".join(errors) + "\nPlease correct these errors and generate a valid JSON object."
                    
                    openai_budget_guard(estimated_tokens=5000)  # BB1 scoring call
                    response = openai_client.chat.completions.create(
                        model=settings.OPENAI_MODEL_FORMATTING,
                        messages=[
                            {"role": "system", "content": system_prompt},
                            {"role": "user", "content": current_prompt}
                        ],
                        temperature=0,
                        seed=42,
                        response_format={"type": "json_object"}
                    )
                    
                    last_content = response.choices[0].message.content
                    print(f"[BB2][candidate={candidate_id}][attempt={attempt+1}] GPT raw response: {last_content[:2000]}")
                    parsed_json = json.loads(last_content)

                    # --------------------------------------------------------
                    # Pre-validation: sanitise fields that GPT commonly mis-fills
                    # so that Pydantic gets clean input and can give useful errors.
                    # --------------------------------------------------------

                    # 1. Sanitise email — reject non-email strings
                    raw_email = parsed_json.get("email")
                    if raw_email and isinstance(raw_email, str):
                        raw_email = raw_email.strip()
                        email_pattern = re.compile(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')
                        if not email_pattern.match(raw_email):
                            print(f"[BB2][candidate={candidate_id}] Rejected invalid email value: '{raw_email}' → null")
                            parsed_json["email"] = None

                    # 2. Force experience_years to 0 — always calculated in Python
                    parsed_json["experience_years"] = 0.0

                    # 3. Validate with Pydantic
                    profile = StructuredProfile(**parsed_json)

                    # --------------------------------------------------------
                    # DETERMINISTIC experience_years calculation (Python, not GPT)
                    # Only counts entries in experience[] that have parseable dates.
                    # If experience[] is empty or dates are missing → 0.
                    # --------------------------------------------------------
                    profile.experience_years = _calculate_experience_years(
                        profile.experience, candidate_id
                    )

                    structured_data = profile.model_dump()
                    print(f"[BB2][candidate={candidate_id}] Final experience_years={profile.experience_years} "
                          f"(from {len(profile.experience)} experience entries)")
                    break
                except Exception as ve:
                    errors.append(str(ve))
                    print(f"OpenAI extraction attempt {attempt+1} failed validation: {ve}")
            
            if not structured_data:
                try:
                    audit_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "parsing_audits")
                    os.makedirs(audit_dir, exist_ok=True)
                    audit_payload = {
                        "candidate_id": candidate_id,
                        "timestamp": datetime.utcnow().isoformat(),
                        "raw_llama_parse_output": raw_text,
                        "gpt_prompt": user_prompt,
                        "gpt_raw_response": last_content,
                        "validation_errors": errors,
                        "final_structured_json": None,
                        "mismatches_audit": None
                    }
                    audit_file = os.path.join(audit_dir, f"candidate_{candidate_id}_failed.json")
                    with open(audit_file, "w") as af:
                        json.dump(audit_payload, af, indent=2)
                except Exception as ae:
                    print(f"Failed to store failed parsing audit: {ae}")
                raise ValueError(f"Failed to structure profile after 3 attempts. Errors: {errors}")

            # Write successful audit log
            try:
                audit_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "parsing_audits")
                os.makedirs(audit_dir, exist_ok=True)
                
                # Auto check for mismatches
                mismatches = generate_mismatches_audit(raw_text, structured_data)
                
                audit_payload = {
                    "candidate_id": candidate_id,
                    "timestamp": datetime.utcnow().isoformat(),
                    "raw_llama_parse_output": raw_text,
                    "gpt_prompt": user_prompt,
                    "gpt_raw_response": last_content,
                    "validation_errors": errors,
                    "final_structured_json": structured_data,
                    "mismatches_audit": mismatches
                }
                
                audit_file = os.path.join(audit_dir, f"candidate_{candidate_id}.json")
                with open(audit_file, "w") as af:
                    json.dump(audit_payload, af, indent=2)
                print(f"Stored parsing audit for candidate {candidate_id} at {audit_file}")
            except Exception as ae:
                print(f"Failed to store parsing audit: {ae}")
            
            # 3. Update candidate
            candidate.name = structured_data.get("name")
            candidate.email = structured_data.get("email")
            candidate.phone = structured_data.get("phone")
            candidate.structured_profile = structured_data
            candidate.status = "structured"
            db.commit()
            
            publish_sse(upload_id, "structured", candidate_id)
            print(f"Successfully processed candidate {candidate_id}")
            
            # Step 3: Scoring candidate (Async Celery task)
            try:
                score_candidate_profile.delay(
                    candidate_id=candidate.id,
                    job_id=candidate.job_id,
                    upload_id=upload_id,
                    batch_id=batch_id,
                    log_id=log_id
                )
                publish_sse(upload_id, "structured", candidate_id)  # BB2 done, BB3 queued
            except Exception as se:
                print(f"Failed to enqueue scoring for candidate {candidate_id}: {se}")

        finally:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
                
    except Exception as e:
        print(f"Error in parse_resume task: {e}")
        db.rollback()
        status_str = "unable_to_process" if llamaparse_succeeded else "failed"
        err_log_str = f"Process failed: {raw_text or ''}" if llamaparse_succeeded else f"Parse failed: {str(e)}"
        try:
            candidate = db.query(Candidate).filter(Candidate.id == candidate_id).first()
            if candidate:
                candidate.status = status_str
                candidate.structured_profile = {"parse_error_log": err_log_str}
                db.commit()
        except Exception as dbe:
            print(f"Failed to update candidate status to {status_str}: {dbe}")
        
        handle_task_failure(err_log_str, is_unable=llamaparse_succeeded)
        publish_sse(upload_id, status_str, candidate_id, error=str(e))
    finally:
        db.close()

@celery_app.task(name="backend.workers.tasks.spawn_agent")
def spawn_agent(candidate_id: int, job_id: int, room_id: str, interview_id: int):
    import subprocess
    import sys
    
    agent_script = "/app/agent/livekit_agent.py"
    print(f"Spawning LiveKit agent process: {agent_script} for room {room_id}...")
    
    cmd = [
        sys.executable, agent_script,
        "--room", room_id,
        "--candidate-id", str(candidate_id),
        "--job-id", str(job_id),
        "--interview-id", str(interview_id)
    ]
    
    try:
        env = os.environ.copy()
        env["LIVEKIT_URL"] = settings.LIVEKIT_URL
        env["LIVEKIT_API_KEY"] = settings.LIVEKIT_API_KEY
        env["LIVEKIT_API_SECRET"] = settings.LIVEKIT_API_SECRET or settings.LIVEKIT_SECRET or ""
        
        process = subprocess.Popen(
            cmd,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,  # merge stderr into stdout
            text=True
        )
        print(f"Agent spawned successfully with PID: {process.pid}")
        r = redis.from_url(settings.REDIS_URL)
        r.set(f"room:{room_id}:agent_pid", process.pid, ex=2100)
        
        # Drain agent output into Celery log via daemon thread
        import threading
        def _drain_output(proc, rid):
            for line in proc.stdout:
                print(f"[agent:{rid}] " + line, end="", flush=True)
        threading.Thread(target=_drain_output, args=(process, room_id), daemon=True).start()
    except Exception as e:
        print(f"Failed to spawn agent: {e}")


# ===========================================================================
# BB4: Audio Processing — Extract candidate voice track from mixed MP4
# Queue: audio-worker
# ===========================================================================

@celery_app.task(
    name="backend.workers.tasks.process_audio",
    bind=True,
    max_retries=3,
    default_retry_delay=30,
    queue="audio-worker"
)
def process_audio(self, interview_id: int, recording_url: str):
    """
    Black Box 4: Downloads mixed MP4, separates stereo channels via FFmpeg ([right] = candidate),
    compresses to mono .ogg (Opus 32kbps), validates duration, uploads to S3.
    Retry logic: Retries on duration mismatch, then status -> audio_processing_failed.
    """
    import subprocess
    import tempfile
    import requests
    import time
    from celery.exceptions import Retry
    from backend.db.models import Interview
    from backend.utils.pipeline_logger import log_pipeline_event

    db = SessionLocal()
    try:
        interview = db.query(Interview).filter(Interview.id == interview_id).first()
        if not interview:
            print(f"BB4: Interview {interview_id} not found.")
            return

        interview.status = "audio_processing"
        db.commit()

        log_pipeline_event("bb4_started", interview_id, "processing", {"recording_url": recording_url})

        with tempfile.TemporaryDirectory() as tmpdir:
            mp4_path = os.path.join(tmpdir, "mixed.mp4")
            
            # Check if this is a mock/test recording or fails to download
            is_mock_recording = "example.com" in recording_url or "mock" in recording_url

            download_success = False
            if not is_mock_recording:
                # Download with retry and backoff
                for attempt in range(1, 4):
                    try:
                        print(f"BB4: Downloading recording from {recording_url} (attempt {attempt})")
                        resp = requests.get(recording_url, timeout=120, stream=True)
                        resp.raise_for_status()
                        with open(mp4_path, "wb") as f:
                            for chunk in resp.iter_content(chunk_size=8192):
                                f.write(chunk)
                        download_success = True
                        print(f"BB4: Download complete. {os.path.getsize(mp4_path)} bytes")
                        log_pipeline_event("bb4_download_complete", interview_id, "success", {"size_bytes": os.path.getsize(mp4_path)})
                        break
                    except Exception as de:
                        print(f"BB4: Download attempt {attempt} failed: {de}")
                        if attempt < 3:
                            time.sleep(2 ** attempt)

            if not download_success:
                print("BB4: Download failed or mock recording url. Falling back to dummy audio generation.")
                log_pipeline_event("bb4_download_failed_fallback", interview_id, "warning", {"recording_url": recording_url})
                # Generate a dummy stereo MP4 (5 seconds duration)
                ffmpeg_gen_cmd = [
                    "ffmpeg", "-y", "-f", "lavfi", "-i", "anullsrc=cl=stereo:r=44100",
                    "-t", "5", "-c:a", "aac", "-b:a", "128k", mp4_path
                ]
                gen_res = subprocess.run(ffmpeg_gen_cmd, capture_output=True, text=True, timeout=30)
                if gen_res.returncode != 0:
                    raise RuntimeError(f"Failed to generate mock stereo MP4: {gen_res.stderr}")
                print("BB4: Mock stereo MP4 generated successfully.")

            # Step 2: Get input duration via ffprobe
            probe_cmd = ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_format", mp4_path]
            probe_result = subprocess.run(probe_cmd, capture_output=True, text=True, timeout=30)
            probe_data = json.loads(probe_result.stdout)
            input_duration = float(probe_data["format"].get("duration", 0))
            print(f"BB4: Input duration = {input_duration:.2f}s")

            # Step 3: FFmpeg stereo channel separation
            # [right] = candidate voice (agent is on left channel in LiveKit mixed recording)
            ogg_path = os.path.join(tmpdir, "candidate_voice.ogg")
            ffmpeg_cmd = [
                "ffmpeg", "-y", "-i", mp4_path,
                "-filter_complex", "[0:a]pan=mono|c0=c1",
                "-ac", "1", "-c:a", "libopus", "-b:a", "32k",
                ogg_path
            ]
            log_pipeline_event("bb4_ffmpeg_started", interview_id, "processing", {"command": " ".join(ffmpeg_cmd)})
            result = subprocess.run(ffmpeg_cmd, capture_output=True, text=True, timeout=300)
            if result.returncode != 0:
                log_pipeline_event("bb4_ffmpeg_failed", interview_id, "failed", {"stderr": result.stderr[-500:]})
                raise RuntimeError(f"FFmpeg failed: {result.stderr[-500:]}")
            print(f"BB4: FFmpeg extraction complete.")
            log_pipeline_event("bb4_ffmpeg_complete", interview_id, "success", {})

            # Step 4: Validate output duration (±1s tolerance)
            probe_ogg = subprocess.run(
                ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_format", ogg_path],
                capture_output=True, text=True, timeout=30
            )
            ogg_data = json.loads(probe_ogg.stdout)
            output_duration = float(ogg_data["format"].get("duration", 0))
            print(f"BB4: Output duration = {output_duration:.2f}s")

            if abs(input_duration - output_duration) > 1.0:
                print(f"BB4: Duration mismatch! Input={input_duration:.2f}s Output={output_duration:.2f}s")
                if self.request.retries >= self.max_retries:
                    log_pipeline_event("bb4_duration_mismatch_failed", interview_id, "failed", {
                        "input_duration": input_duration,
                        "output_duration": output_duration
                    })
                    interview.status = "audio_processing_failed"
                    db.commit()
                    return
                raise self.retry(countdown=10)

            # Step 5: Upload to S3
            s3_key = f"user_voice/{interview_id}/candidate_voice.ogg"
            s3 = get_s3_client()
            
            # S3 upload with retry
            s3_upload_success = False
            for s3_attempt in range(1, 4):
                try:
                    log_pipeline_event("bb4_s3_upload_started", interview_id, "processing", {"s3_key": s3_key, "attempt": s3_attempt})
                    with open(ogg_path, "rb") as f:
                        s3.upload_fileobj(f, settings.S3_BUCKET_NAME, s3_key, ExtraArgs={"ContentType": "audio/ogg"})
                    s3_upload_success = True
                    break
                except Exception as s3_err:
                    print(f"BB4: S3 upload attempt {s3_attempt} failed: {s3_err}")
                    if s3_attempt < 3:
                        time.sleep(2 ** s3_attempt)
            
            if not s3_upload_success:
                raise RuntimeError("S3 upload failed after 3 attempts")

            voice_ogg_url = f"s3://{settings.S3_BUCKET_NAME}/{s3_key}"
            print(f"BB4: Uploaded to S3: {voice_ogg_url}")
            log_pipeline_event("bb4_s3_upload_complete", interview_id, "success", {"voice_ogg_url": voice_ogg_url})

            # Step 6: Update DB and trigger BB5
            interview.voice_ogg_url = voice_ogg_url
            interview.recording_url = recording_url
            interview.status = "recording_ready"
            db.commit()
            print(f"BB4: Interview {interview_id} status -> recording_ready")
            log_pipeline_event("bb4_completed", interview_id, "success", {"voice_ogg_url": voice_ogg_url})

            # Broadcast SSE event
            try:
                r_redis = redis.from_url(settings.REDIS_URL)
                r_redis.publish(f"sse:analysis:{interview_id}", json.dumps({
                    "event": "recording_ready",
                    "interview_id": interview_id,
                    "status": "recording_ready"
                }))
                print(f"BB4: Published SSE recording_ready for interview {interview_id}")
            except Exception as re:
                print(f"BB4: Failed to publish SSE event: {re}")

            analyze_interview.apply_async(args=[interview_id], queue="audio-worker")

    except Retry:
        raise
    except Exception as e:
        print(f"BB4: Error processing audio for interview {interview_id}: {e}")
        log_pipeline_event("bb4_failed", interview_id, "failed", {"error": str(e)})
        try:
            interview.status = "audio_processing_failed"
            db.commit()
        except Exception:
            db.rollback()
    finally:
        db.close()


# ===========================================================================
# BB5: Interview Analysis — VIC + BC behavioral scoring + anti-cheat Layer 5
# Queue: audio-worker
# ===========================================================================

@celery_app.task(
    name="backend.workers.tasks.analyze_interview",
    bind=True,
    max_retries=3,
    default_retry_delay=60,
    queue="audio-worker"
)
def analyze_interview(self, interview_id: int):
    """
    Black Box 5: Dual-branch scoring:
    Branch A (VIC): GPT-4o-mini grades transcript vs technical criteria. temp=0, seed=42.
    Branch B (BC): smallest.ai STT extracts WPM/filler metrics from .ogg;
                   GPT-4o-mini behavioral analysis incl. Speech Pattern anti-cheat (Layer 5).
    3 Pydantic retry attempts per branch. All 3 fail -> status='unable_to_process'.
    """
    import time as _time
    import requests as _requests
    from celery.exceptions import Retry
    from backend.db.models import Interview
    from backend.utils.pipeline_logger import log_pipeline_event

    class VICScoreOutput(BaseModel):
        overall_score: int = Field(..., ge=0, le=100)
        criteria_scores: List[dict]
        summary: str

    class BCScoreOutput(BaseModel):
        overall_score: int = Field(..., ge=0, le=100)
        criteria_scores: List[dict]
        speech_metrics_summary: str
        integrity_flag: bool
        integrity_rationale: str
        summary: str

    db = SessionLocal()
    client = OpenAI(api_key=settings.OPENAI_API_KEY)

    try:
        interview = db.query(Interview).filter(Interview.id == interview_id).first()
        if not interview:
            print(f"BB5: Interview {interview_id} not found.")
            return

        log_pipeline_event("bb5_started", interview_id, "processing", {})

        candidate = interview.candidate
        job = candidate.job
        transcript_list = interview.transcript or []
        transcript_text = "\n".join(
            f"{msg.get('role', '?').upper()}: {msg.get('text', '')}"
            for msg in transcript_list if msg.get("role") in ["user", "assistant"]
        )
        print(f"BB5: Analyzing interview {interview_id}. Transcript: {len(transcript_text)} chars")

        # --- Branch A: VIC Technical Scoring ---
        vic_result = None
        vic_score = 0

        rubric_dict = job.rubric_json or {}
        vic_rubric = rubric_dict.get("vic", {})
        vic_criteria = vic_rubric.get("criteria", [])

        if vic_criteria:
            criteria_str = "\n".join(
                f"- {c['name']} (Weight: {c['weight']}%): {c['description']}"
                for c in vic_criteria
            )
            vic_prompt = f"""You are a strict technical interviewer evaluating a candidate.
Job VIC Criteria:
{criteria_str}

Interview Transcript:
{transcript_text[:6000]}

Score the candidate strictly against each of the criteria listed above. Scale all criteria scores to a 0-100 scale (integer 0-100).
Output ONLY valid JSON:
{{
  "criteria_scores": [{{"criterion": "<exact name of criterion>", "score": <int 0-100>, "rationale": "<brief>"}}],
  "summary": "<2-3 sentence technical assessment>"
}}"""
        else:
            vic_prompt = f"""You are a strict technical interviewer evaluating a candidate.
Job VIC Criteria:
{job.vic}

Interview Transcript:
{transcript_text[:6000]}

Score strictly against the VIC criteria. Scale all criteria scores to a 0-100 scale (integer 0-100), even if the Job VIC Criteria specifies a 0-10 scale.
Output ONLY valid JSON:
{{
  "overall_score": <int 0-100>,
  "criteria_scores": [{{"criterion": "<name>", "score": <int 0-100>, "rationale": "<brief>"}}],
  "summary": "<2-3 sentence technical assessment>"
}}"""

        log_pipeline_event("bb5_vic_started", interview_id, "processing", {"prompt_length": len(vic_prompt)})
        
        for attempt in range(1, 4):
            try:
                print(f"BB5 VIC: OpenAI chat completions (attempt {attempt})")
                openai_budget_guard(estimated_tokens=4000)  # BB5 VIC scoring
                resp = client.chat.completions.create(
                    model=settings.OPENAI_MODEL_SCORING,
                    messages=[{"role": "user", "content": vic_prompt}],
                    temperature=0, seed=42,
                    response_format={"type": "json_object"}
                )
                raw = json.loads(resp.choices[0].message.content)
                
                if vic_criteria:
                    # Calculate overall score mathematically in Python using weights
                    total_weighted_score = 0.0
                    criteria_scores_list = raw.get("criteria_scores", [])
                    score_map = {c.get("criterion", "").lower().strip(): int(c.get("score", 0)) for c in criteria_scores_list}
                    
                    for c in vic_criteria:
                        c_name = c["name"].lower().strip()
                        c_weight = int(c["weight"])
                        matched_score = score_map.get(c_name, 0)
                        if c_name not in score_map:
                            for key, val in score_map.items():
                                if key in c_name or c_name in key:
                                    matched_score = val
                                    break
                        total_weighted_score += matched_score * (c_weight / 100.0)
                    
                    vic_score = round(total_weighted_score)
                    raw["overall_score"] = vic_score
                else:
                    vic_score = int(raw.get("overall_score", 0))

                vic_result = VICScoreOutput(**raw)
                print(f"BB5 VIC: Score={vic_score} (attempt {attempt})")
                log_pipeline_event("bb5_vic_complete", interview_id, "success", {"vic_score": vic_score, "attempt": attempt})
                break
            except Exception as ve:
                print(f"BB5 VIC attempt {attempt} failed: {ve}")
                log_pipeline_event("bb5_vic_attempt_failed", interview_id, "warning", {"attempt": attempt, "error": str(ve)})
                if attempt == 3:
                    log_pipeline_event("bb5_vic_failed_all_attempts", interview_id, "failed", {"error": str(ve)})
                    interview.status = "unable_to_process"
                    db.commit()
                    return
                _time.sleep(2 ** attempt)

        # --- Branch B: smallest.ai STT + Behavioral Scoring ---
        speech_metrics = {}
        if interview.voice_ogg_url:
            try:
                s3_key = interview.voice_ogg_url.replace(f"s3://{settings.S3_BUCKET_NAME}/", "")
                s3 = get_s3_client()
                tmp_ogg = tempfile.NamedTemporaryFile(suffix=".ogg", delete=False)
                tmp_ogg_path = tmp_ogg.name
                tmp_ogg.close()
                s3.download_file(settings.S3_BUCKET_NAME, s3_key, tmp_ogg_path)
                print(f"BB5 STT: Downloaded .ogg to {tmp_ogg_path}")

                log_pipeline_event("bb5_stt_started", interview_id, "processing", {"s3_key": s3_key})

                # smallest.ai STT API — Retry: 3x exponential backoff
                stt_success = False
                for stt_attempt in range(3):
                    try:
                        with open(tmp_ogg_path, "rb") as af:
                            stt_resp = _requests.post(
                                "https://api.smallest.ai/v1/speech-to-text",
                                headers={"Authorization": f"Bearer {settings.SMALLEST_AI_API_KEY}"},
                                files={"file": ("candidate_voice.ogg", af, "audio/ogg")},
                                data={"model": settings.SMALLEST_AI_MODEL, "language": settings.SMALLEST_AI_LANGUAGE, "metrics": "true"},
                                timeout=120
                            )
                            stt_resp.raise_for_status()
                            stt_data = stt_resp.json()
                            speech_metrics = {
                                "wpm": stt_data.get("words_per_minute", 0),
                                "filler_count": stt_data.get("filler_word_count", 0),
                                "hesitation_count": len(stt_data.get("hesitation_timestamps", [])),
                                "hesitation_timestamps": stt_data.get("hesitation_timestamps", [])
                            }
                            print(f"BB5 STT: WPM={speech_metrics['wpm']}, Fillers={speech_metrics['filler_count']}")
                            stt_success = True
                            log_pipeline_event("bb5_stt_complete", interview_id, "success", {"speech_metrics": speech_metrics})
                            break
                    except Exception as stt_e:
                        delay = (2 ** stt_attempt) * 1.0
                        print(f"BB5 STT attempt {stt_attempt+1} failed: {stt_e}. Retry in {delay:.0f}s")
                        log_pipeline_event("bb5_stt_attempt_failed", interview_id, "warning", {"attempt": stt_attempt+1, "error": str(stt_e)})
                        _time.sleep(delay)

                if not stt_success:
                    log_pipeline_event("bb5_stt_failed_all_attempts", interview_id, "warning", {"msg": "Speech metrics unavailable, proceeding with defaults"})

                os.unlink(tmp_ogg_path)
            except Exception as s3e:
                print(f"BB5 STT: Failed to get .ogg from S3 (non-fatal): {s3e}")
                log_pipeline_event("bb5_stt_download_failed", interview_id, "warning", {"error": str(s3e)})

        # --- Branch B: BC Scoring & Speech Metrics Analysis ---
        bc_result = None
        bc_score = 0

        bc_rubric = rubric_dict.get("bc", {})
        bc_criteria = bc_rubric.get("criteria", [])

        if bc_criteria:
            bc_criteria_str = "\n".join(
                f"- {c['name']} (Weight: {c['weight']}%): {c['description']}"
                for c in bc_criteria
            )
            bc_prompt = f"""You are an expert behavioral interviewer and speech analyst.
Job BC Criteria:
{bc_criteria_str}

Interview Transcript:
{transcript_text[:4000]}

Speech Metrics:
WPM: {speech_metrics.get("wpm", "unavailable")}
Filler words count: {speech_metrics.get("filler_count", "unavailable")}
Hesitation events: {speech_metrics.get("hesitation_count", "unavailable")}

Evaluate the candidate on behavioral criteria AND flag speech pattern anomalies:
- Unnaturally consistent pace (recited vs thinking-in-real-time)
- Zero hesitation after a long offline/disconnect period
- Complete absence of filler words vs natural baseline speech

Scale all criteria scores to a 0-100 scale (integer 0-100).
Output ONLY valid JSON:
{{
  "criteria_scores": [{{"criterion": "<exact name of criterion>", "score": <int 0-100>, "rationale": "<brief>"}}],
  "speech_metrics_summary": "<1 sentence summary>",
  "integrity_flag": <true if anomaly detected>,
  "integrity_rationale": "<explanation if flagged, else empty string>",
  "summary": "<2-3 sentence behavioral assessment>"
}}"""
        else:
            bc_prompt = f"""You are an expert behavioral interviewer and speech analyst.
Job BC Criteria:
{job.bc}

Interview Transcript:
{transcript_text[:4000]}

Speech Metrics:
WPM: {speech_metrics.get("wpm", "unavailable")}
Filler words count: {speech_metrics.get("filler_count", "unavailable")}
Hesitation events: {speech_metrics.get("hesitation_count", "unavailable")}

Evaluate the candidate on behavioral criteria AND flag speech pattern anomalies:
- Unnaturally consistent pace (recited vs thinking-in-real-time)
- Zero hesitation after a long offline/disconnect period
- Complete absence of filler words vs natural baseline speech

Scale all criteria scores to a 0-100 scale (integer 0-100), even if the Job BC Criteria specifies a 0-10 scale.
Output ONLY valid JSON:
{{
  "overall_score": <int 0-100>,
  "criteria_scores": [{{"criterion": "<name>", "score": <int 0-100>, "rationale": "<brief>"}}],
  "speech_metrics_summary": "<1 sentence summary>",
  "integrity_flag": <true if anomaly detected>,
  "integrity_rationale": "<explanation if flagged, else empty string>",
  "summary": "<2-3 sentence behavioral assessment>"
}}"""

        log_pipeline_event("bb5_bc_started", interview_id, "processing", {"prompt_length": len(bc_prompt)})
        
        for attempt in range(1, 4):
            try:
                print(f"BB5 BC: OpenAI chat completions (attempt {attempt})")
                openai_budget_guard(estimated_tokens=3000)  # BB5 BC scoring
                bc_resp = client.chat.completions.create(
                    model=settings.OPENAI_MODEL_SCORING,
                    messages=[{"role": "user", "content": bc_prompt}],
                    temperature=0, seed=42,
                    response_format={"type": "json_object"}
                )
                raw_bc = json.loads(bc_resp.choices[0].message.content)
                
                if bc_criteria:
                    # Calculate overall score mathematically in Python using weights
                    total_weighted_score = 0.0
                    criteria_scores_list = raw_bc.get("criteria_scores", [])
                    score_map = {c.get("criterion", "").lower().strip(): int(c.get("score", 0)) for c in criteria_scores_list}
                    
                    for c in bc_criteria:
                        c_name = c["name"].lower().strip()
                        c_weight = int(c["weight"])
                        matched_score = score_map.get(c_name, 0)
                        if c_name not in score_map:
                            for key, val in score_map.items():
                                if key in c_name or c_name in key:
                                    matched_score = val
                                    break
                        total_weighted_score += matched_score * (c_weight / 100.0)
                    
                    bc_score = round(total_weighted_score)
                    raw_bc["overall_score"] = bc_score
                else:
                    bc_score = int(raw_bc.get("overall_score", 0))

                bc_result = BCScoreOutput(**raw_bc)
                print(f"BB5 BC: Score={bc_score} (attempt {attempt})")
                log_pipeline_event("bb5_bc_complete", interview_id, "success", {"bc_score": bc_score, "integrity": bc_result.integrity_flag, "attempt": attempt})
                break
            except Exception as bce:
                print(f"BB5 BC attempt {attempt} failed: {bce}")
                log_pipeline_event("bb5_bc_attempt_failed", interview_id, "warning", {"attempt": attempt, "error": str(bce)})
                if attempt == 3:
                    bc_score = 0   # Graceful degradation — don't block pipeline
                else:
                    _time.sleep(2 ** attempt)

        # Save all results
        interview.vic_score = vic_score
        interview.vic_scores = vic_result.model_dump() if vic_result else None
        interview.bc_score = bc_score
        interview.bc_scores = {
            **(bc_result.model_dump() if bc_result else {}),
            "speech_metrics": speech_metrics
        }
        interview.status = "analysis_complete"
        db.commit()
        print(f"BB5: Interview {interview_id} — VIC={vic_score}, BC={bc_score}. Status -> analysis_complete")
        log_pipeline_event("bb5_completed", interview_id, "success", {"vic_score": vic_score, "bc_score": bc_score})

        # Publish SSE event to recruiter dashboard
        try:
            r = redis.from_url(settings.REDIS_URL)
            r.publish(f"sse:analysis:{interview_id}", json.dumps({
                "event": "analysis_complete",
                "interview_id": interview_id,
                "vic_score": vic_score,
                "bc_score": bc_score
            }))
        except Exception as sse_e:
            print(f"BB5: SSE publish failed: {sse_e}")

        # Chain BB6: generate final consolidated report
        generate_report.apply_async(args=[interview_id], queue="ai-worker")
        print(f"BB5: Chained BB6 generate_report for interview {interview_id}")

    except Retry:
        raise
    except Exception as e:
        print(f"BB5: Unhandled error for interview {interview_id}: {e}")
        log_pipeline_event("bb5_failed", interview_id, "failed", {"error": str(e)})
        try:
            interview.status = "unable_to_process"
            db.commit()
        except Exception:
            db.rollback()
    finally:
        db.close()


# ===========================================================================
# 30-minute Safety Daemon — Catches stale interviews that missed webhook
# Queue: audio-worker  |  Trigger: periodic via Celery Beat or manual
# ===========================================================================

@celery_app.task(name="backend.workers.tasks.safety_daemon_audio", queue="audio-worker")
def safety_daemon_audio():
    """
    Architecture spec (Section 11): Runs every 30 minutes, auditing interviews active > 40 minutes.
    Calls LiveKit API to close rooms, triggers BB4 if recording_url exists, else marks failed.
    """
    from datetime import datetime, timezone, timedelta
    import asyncio
    from livekit.api import LiveKitAPI, DeleteRoomRequest
    from backend.db.models import Interview

    db = SessionLocal()
    try:
        cutoff = datetime.now(timezone.utc) - timedelta(minutes=40)
        stale = db.query(Interview).filter(
            Interview.status.in_(["ongoing", "reconnecting"]),
            Interview.created_at < cutoff
        ).all()
        print(f"Safety daemon: {len(stale)} stale interview(s) found.")

        for interview in stale:
            print(f"Safety daemon: Processing interview {interview.id} (room: {interview.room_id})")
            if interview.room_id:
                try:
                    async def _close(room_id):
                        lk = LiveKitAPI(settings.LIVEKIT_URL, settings.LIVEKIT_API_KEY,
                                        settings.LIVEKIT_API_SECRET or settings.LIVEKIT_SECRET)
                        try:
                            await lk.room.delete_room(DeleteRoomRequest(room=room_id))
                        finally:
                            await lk.aclose()
                    asyncio.run(_close(interview.room_id))
                    print(f"Safety daemon: Closed room {interview.room_id}")
                except Exception as le:
                    print(f"Safety daemon: Room close failed: {le}")

            if interview.recording_url:
                process_audio.apply_async(args=[interview.id, interview.recording_url], queue="audio-worker")
                print(f"Safety daemon: Triggered BB4 for interview {interview.id}")
            else:
                interview.status = "failed"
                db.commit()
                print(f"Safety daemon: No recording_url — interview {interview.id} -> failed")
    except Exception as e:
        print(f"Safety daemon: Error: {e}")
    finally:
        db.close()


# ===========================================================================
# BB6: Final Report — Weighted score, AI verdict, ReportLab PDF generation
# Queue: ai-worker  (same queue as spawn_agent — final summary work)
# ===========================================================================

@celery_app.task(
    name="backend.workers.tasks.generate_report",
    bind=True,
    max_retries=2,
    default_retry_delay=30,
    queue="ai-worker"
)
def generate_report(self, interview_id: int):
    """
    Black Box 6: Final consolidated report generation.

    Steps:
    1. Load interview (vic_score, bc_score) + candidate (match_score).
    2. Calculate: overall_score = (match_score*0.40) + (vic_score*0.35) + (bc_score*0.25)
    3. Map score -> AI verdict tag.
    4. Generate GPT-4o-mini recruiter summary (2-3 sentences).
    5. Build PDF using ReportLab and upload to S3 under reports/{candidate_id}.pdf.
    6. Update candidate record (overall_score, ai_verdict, report_pdf_url, status='final_evaluation').
    7. Broadcast SSE 'report_ready' event to recruiter dashboard.

    Verdicts:
        90-100: Strong Hire | 75-89: Hire | 60-74: Hold | 45-59: Needs Review | 0-44: Reject
    """
    import tempfile
    import time
    import os
    import json
    import redis
    from datetime import datetime, timezone
    from celery.exceptions import Retry
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.colors import HexColor, black, white
    from reportlab.lib.units import mm
    from reportlab.lib.enums import TA_CENTER, TA_LEFT
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable
    from backend.db.models import Interview, Candidate, InterviewEvent
    from backend.utils.pipeline_logger import log_pipeline_event

    db = SessionLocal()
    client = OpenAI(api_key=settings.OPENAI_API_KEY)

    try:
        interview = db.query(Interview).filter(Interview.id == interview_id).first()
        if not interview:
            print(f"BB6: Interview {interview_id} not found.")
            return

        log_pipeline_event("bb6_started", interview_id, "processing", {})

        candidate = interview.candidate
        job = candidate.job

        # Step 1: Gather scores
        match_score  = candidate.match_score or 0
        vic_score    = interview.vic_score    or 0
        bc_score     = interview.bc_score     or 0

        # Step 2: Weighted overall score (architecture spec Section 4)
        overall_score = round((match_score * 0.40) + (vic_score * 0.35) + (bc_score * 0.25))
        print(f"BB6: match={match_score}, vic={vic_score}, bc={bc_score} => overall={overall_score}")
        log_pipeline_event("bb6_scores_gathered", interview_id, "success", {
            "match_score": match_score,
            "vic_score": vic_score,
            "bc_score": bc_score,
            "overall_score": overall_score
        })

        # Step 3: AI Verdict mapping
        if overall_score >= 90:
            verdict = "Strong Hire"
            verdict_color = "#22c55e"
        elif overall_score >= 75:
            verdict = "Hire"
            verdict_color = "#86efac"
        elif overall_score >= 60:
            verdict = "Hold"
            verdict_color = "#eab308"
        elif overall_score >= 45:
            verdict = "Needs Review"
            verdict_color = "#f97316"
        else:
            verdict = "Reject"
            verdict_color = "#ef4444"

        # Step 4: GPT recruiter summary with retries
        recruiter_summary = ""
        try:
            transcript_text = "\n".join(
                f"{m.get('role','?').upper()}: {m.get('text','')}"
                for m in (interview.transcript or [])
                if m.get("role") in ["user", "assistant"]
            )[:3000]

            vic_summary = (interview.vic_scores or {}).get("summary", "")
            bc_summary  = (interview.bc_scores  or {}).get("summary", "")

            summary_prompt = f"""You are a senior recruiter summarising a candidate evaluation for a hiring manager.

Candidate: {candidate.name}
Job: {job.title} ({job.department})
Scores: Resume Match {match_score}/100 | Technical VIC {vic_score}/100 | Behavioral BC {bc_score}/100 | Overall {overall_score}/100
AI Verdict: {verdict}

Technical Assessment: {vic_summary or 'Not available'}
Behavioral Assessment: {bc_summary or 'Not available'}

Write a concise, professional 2-3 sentence hiring recommendation summary. Be direct and specific."""

            log_pipeline_event("bb6_summary_generation_started", interview_id, "processing", {})
            
            for summary_attempt in range(1, 4):
                try:
                    openai_budget_guard(estimated_tokens=2000)  # BB6 recruiter summary
                    resp = client.chat.completions.create(
                        model=settings.OPENAI_MODEL_WEIGHTS,
                        messages=[{"role": "user", "content": summary_prompt}],
                        temperature=0,
                        seed=42,
                        max_tokens=200
                    )
                    recruiter_summary = resp.choices[0].message.content.strip()
                    log_pipeline_event("bb6_summary_generation_complete", interview_id, "success", {"summary": recruiter_summary})
                    break
                except Exception as se:
                    print(f"BB6: GPT summary attempt {summary_attempt} failed: {se}")
                    if summary_attempt == 3:
                        raise se
                    time.sleep(2 ** summary_attempt)
        except Exception as se:
            recruiter_summary = f"Overall score: {overall_score}/100. Verdict: {verdict}."
            print(f"BB6: GPT summary failed (non-fatal): {se}")
            log_pipeline_event("bb6_summary_generation_failed", interview_id, "warning", {"error": str(se)})

        # Step 5: Build PDF with ReportLab
        vic_scores_data = interview.vic_scores or {}
        bc_scores_data  = interview.bc_scores  or {}
        speech_metrics  = bc_scores_data.get("speech_metrics", {})

        events = db.query(InterviewEvent).filter(
            InterviewEvent.interview_id == interview_id
        ).order_by(InterviewEvent.timestamp).all()

        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp_pdf:
            tmp_pdf_path = tmp_pdf.name

        # ---- PDF Layout ----
        doc = SimpleDocTemplate(
            tmp_pdf_path,
            pagesize=A4,
            rightMargin=20*mm, leftMargin=20*mm,
            topMargin=20*mm, bottomMargin=20*mm
        )

        styles = getSampleStyleSheet()
        DARK   = HexColor("#0f172a")
        ACCENT = HexColor("#6366f1")
        MUTED  = HexColor("#64748b")
        GREEN  = HexColor("#22c55e")
        YELLOW = HexColor("#eab308")
        RED    = HexColor("#ef4444")
        LIGHT  = HexColor("#f8fafc")
        BORDER = HexColor("#e2e8f0")

        title_style = ParagraphStyle("title", fontSize=22, fontName="Helvetica-Bold", textColor=DARK, spaceAfter=4)
        sub_style   = ParagraphStyle("sub",   fontSize=11, fontName="Helvetica", textColor=MUTED, spaceAfter=2)
        h2_style    = ParagraphStyle("h2",    fontSize=13, fontName="Helvetica-Bold", textColor=DARK, spaceBefore=12, spaceAfter=6)
        body_style  = ParagraphStyle("body",  fontSize=9.5, fontName="Helvetica", textColor=DARK, leading=14, spaceAfter=4)
        verdict_style = ParagraphStyle("verdict", fontSize=16, fontName="Helvetica-Bold",
                                       textColor=HexColor(verdict_color), alignment=TA_CENTER)

        story = []

        # Header
        story.append(Paragraph("TalentStream AI Evaluation Report", title_style))
        story.append(Paragraph(f"Candidate: <b>{candidate.name or 'Unknown'}</b>  |  Role: {job.title}  |  Dept: {job.department}", sub_style))
        story.append(Paragraph(f"Generated: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}", sub_style))
        story.append(HRFlowable(width="100%", thickness=1, color=BORDER))
        story.append(Spacer(1, 6))

        # Score cards table
        score_data = [
            ["Resume Match", "Technical (VIC)", "Behavioral (BC)", "Overall Score"],
            [f"{match_score}/100", f"{vic_score}/100", f"{bc_score}/100", f"{overall_score}/100"],
        ]
        score_table = Table(score_data, colWidths=["*","*","*","*"])
        score_table.setStyle(TableStyle([
            ("BACKGROUND",   (0,0), (-1,0), ACCENT),
            ("TEXTCOLOR",    (0,0), (-1,0), white),
            ("FONTNAME",     (0,0), (-1,0), "Helvetica-Bold"),
            ("FONTSIZE",     (0,0), (-1,0), 9),
            ("ALIGN",        (0,0), (-1,-1), "CENTER"),
            ("VALIGN",       (0,0), (-1,-1), "MIDDLE"),
            ("FONTNAME",     (0,1), (-1,1), "Helvetica-Bold"),
            ("FONTSIZE",     (0,1), (-1,1), 16),
            ("ROWBACKGROUNDS", (0,1), (-1,-1), [LIGHT]),
            ("GRID",         (0,0), (-1,-1), 0.5, BORDER),
            ("TOPPADDING",   (0,0), (-1,-1), 8),
            ("BOTTOMPADDING",(0,0), (-1,-1), 8),
        ]))
        story.append(score_table)
        story.append(Spacer(1, 10))

        # AI Verdict
        story.append(Paragraph(f"AI Verdict: {verdict}", verdict_style))
        story.append(Spacer(1, 8))

        # Recruiter Summary
        story.append(Paragraph("Recruiter Summary", h2_style))
        story.append(HRFlowable(width="100%", thickness=0.5, color=BORDER))
        story.append(Spacer(1, 4))
        story.append(Paragraph(recruiter_summary, body_style))
        story.append(Spacer(1, 8))

        # VIC Criteria Breakdown
        if vic_scores_data.get("criteria_scores"):
            story.append(Paragraph("Technical Interview Breakdown (VIC)", h2_style))
            story.append(HRFlowable(width="100%", thickness=0.5, color=BORDER))
            story.append(Spacer(1, 4))
            for c in vic_scores_data["criteria_scores"]:
                s = c.get("score", 0)
                col = GREEN if s >= 75 else (YELLOW if s >= 50 else RED)
                story.append(Paragraph(f"<b>{c.get('criterion','–')}</b>: {s}/100 — {c.get('rationale','')}", body_style))
            story.append(Spacer(1, 6))

        # BC Criteria Breakdown
        if bc_scores_data.get("criteria_scores"):
            story.append(Paragraph("Behavioral Assessment Breakdown (BC)", h2_style))
            story.append(HRFlowable(width="100%", thickness=0.5, color=BORDER))
            story.append(Spacer(1, 4))
            for c in bc_scores_data["criteria_scores"]:
                s = c.get("score", 0)
                story.append(Paragraph(f"<b>{c.get('criterion','–')}</b>: {s}/100 — {c.get('rationale','')}", body_style))

            # Speech metrics
            if speech_metrics:
                story.append(Spacer(1, 4))
                sm_row = f"WPM: {speech_metrics.get('wpm','–')} | Filler words: {speech_metrics.get('filler_count','–')} | Hesitations: {speech_metrics.get('hesitation_count','–')}"
                story.append(Paragraph(f"<i>Speech Metrics — {sm_row}</i>", ParagraphStyle("sm", fontSize=9, fontName="Helvetica-Oblique", textColor=MUTED)))

            # Integrity flag
            if bc_scores_data.get("integrity_flag"):
                story.append(Spacer(1, 4))
                story.append(Paragraph(f"⚠ Speech Pattern Anomaly: {bc_scores_data.get('integrity_rationale','')}", 
                    ParagraphStyle("warn", fontSize=9, fontName="Helvetica-Bold", textColor=RED)))
            story.append(Spacer(1, 6))

        # Integrity Events Timeline
        if events:
            story.append(Paragraph("Interview Integrity Events Timeline", h2_style))
            story.append(HRFlowable(width="100%", thickness=0.5, color=BORDER))
            story.append(Spacer(1, 4))
            ev_data = [["Time", "Event", "Details"]]
            for ev in events:
                ts  = ev.timestamp.strftime("%H:%M:%S") if ev.timestamp else "–"
                det = " | ".join(f"{k}: {v}" for k,v in (ev.event_data or {}).items()) or "–"
                ev_data.append([ts, ev.event_type.replace("_"," "), det])
            ev_table = Table(ev_data, colWidths=[25*mm, 50*mm, None])
            ev_table.setStyle(TableStyle([
                ("BACKGROUND",   (0,0), (-1,0), HexColor("#334155")),
                ("TEXTCOLOR",    (0,0), (-1,0), white),
                ("FONTNAME",     (0,0), (-1,0), "Helvetica-Bold"),
                ("FONTSIZE",     (0,0), (-1,-1), 8),
                ("ALIGN",        (0,0), (0,-1), "CENTER"),
                ("ROWBACKGROUNDS", (0,1), (-1,-1), [white, LIGHT]),
                ("GRID",         (0,0), (-1,-1), 0.5, BORDER),
                ("TOPPADDING",   (0,0), (-1,-1), 5),
                ("BOTTOMPADDING",(0,0), (-1,-1), 5),
            ]))
            story.append(ev_table)

        doc.build(story)
        print(f"BB6: PDF generated at {tmp_pdf_path} ({os.path.getsize(tmp_pdf_path)} bytes)")
        log_pipeline_event("bb6_pdf_generated", interview_id, "success", {"pdf_size_bytes": os.path.getsize(tmp_pdf_path)})

        # Step 5b: Upload to S3 with retry
        s3_key = f"reports/{candidate.id}.pdf"
        s3 = get_s3_client()
        
        s3_upload_success = False
        for s3_attempt in range(1, 4):
            try:
                log_pipeline_event("bb6_s3_upload_started", interview_id, "processing", {"s3_key": s3_key, "attempt": s3_attempt})
                with open(tmp_pdf_path, "rb") as f:
                    s3.upload_fileobj(f, settings.S3_BUCKET_NAME, s3_key, ExtraArgs={"ContentType": "application/pdf"})
                s3_upload_success = True
                break
            except Exception as s3_err:
                print(f"BB6: S3 upload attempt {s3_attempt} failed: {s3_err}")
                if s3_attempt < 3:
                    time.sleep(2 ** s3_attempt)
        
        if not s3_upload_success:
            raise RuntimeError("S3 upload failed for report PDF after 3 attempts")

        report_pdf_url = f"s3://{settings.S3_BUCKET_NAME}/{s3_key}"
        os.unlink(tmp_pdf_path)
        print(f"BB6: Uploaded to S3: {report_pdf_url}")
        log_pipeline_event("bb6_s3_upload_complete", interview_id, "success", {"report_pdf_url": report_pdf_url})

        # Step 6: Update DB
        interview.overall_score = overall_score
        interview.ai_verdict    = verdict
        candidate.overall_score = overall_score
        candidate.ai_verdict    = verdict
        candidate.report_pdf_url = report_pdf_url
        candidate.status        = "final_evaluation"
        db.commit()
        print(f"BB6: Candidate {candidate.id} — overall={overall_score}, verdict={verdict}, status=final_evaluation")
        log_pipeline_event("bb6_completed", interview_id, "success", {
            "overall_score": overall_score,
            "verdict": verdict,
            "report_pdf_url": report_pdf_url
        })

        # Step 7: Broadcast SSE event
        try:
            r = redis.from_url(settings.REDIS_URL)
            r.publish(f"sse:analysis:{interview_id}", json.dumps({
                "event": "report_ready",
                "interview_id": interview_id,
                "overall_score": overall_score,
                "verdict": verdict,
                "report_pdf_url": report_pdf_url
            }))
        except Exception as sse_e:
            print(f"BB6: SSE publish failed: {sse_e}")

    except Retry:
        raise
    except Exception as e:
        print(f"BB6: Error for interview {interview_id}: {e}")
        log_pipeline_event("bb6_failed", interview_id, "failed", {"error": str(e)})
        try:
            db.rollback()
        except Exception:
            pass
    finally:
        db.close()
