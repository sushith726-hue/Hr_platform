from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, JSON, UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from backend.db.session import Base
import uuid

class Job(Base):
    __tablename__ = "jobs"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(255), nullable=False)
    department = Column(String(255), nullable=False)
    jd = Column(Text, nullable=False)
    rvc = Column(Text, nullable=False)
    vic = Column(Text, nullable=False)
    bc = Column(Text, nullable=False)
    rubric_json = Column(JSON, nullable=True)
    status = Column(String(50), default="open", nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    candidates = relationship("Candidate", back_populates="job", cascade="all, delete-orphan")


class Candidate(Base):
    __tablename__ = "candidates"

    id = Column(Integer, primary_key=True, index=True)
    job_id = Column(Integer, ForeignKey("jobs.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(255), nullable=True)
    email = Column(String(255), nullable=True)
    phone = Column(String(50), nullable=True)
    resume_url = Column(String(1024), nullable=True)
    status = Column(String(50), default="uploaded", nullable=False)
    match_score = Column(Integer, nullable=True)
    recommendation = Column(String(100), nullable=True)
    match_breakdown = Column(JSON, nullable=True)
    ai_recommendation = Column(String(100), nullable=True)
    structured_profile = Column(JSON, nullable=True)
    latest_interview_id = Column(
        Integer,
        ForeignKey("interviews.id", use_alter=True, name="fk_latest_interview"),
        nullable=True
    )
    latest_invite_token = Column(String(255), nullable=True)

    # BB6: Final Report fields
    overall_score = Column(Integer, nullable=True)           # Weighted: match*0.4 + vic*0.35 + bc*0.25
    ai_verdict = Column(String(50), nullable=True)           # 'Strong Hire', 'Hire', 'Hold', 'Needs Review', 'Reject'
    report_pdf_url = Column(String(1024), nullable=True)     # S3 URL for the generated PDF report

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    job = relationship("Job", back_populates="candidates")
    interviews = relationship("Interview", foreign_keys="[Interview.candidate_id]", back_populates="candidate", cascade="all, delete-orphan")
    latest_interview = relationship("Interview", foreign_keys=[latest_interview_id], post_update=True)
    notes = relationship("CandidateNote", back_populates="candidate", cascade="all, delete-orphan")


class Interview(Base):
    __tablename__ = "interviews"

    id = Column(Integer, primary_key=True, index=True)
    candidate_id = Column(Integer, ForeignKey("candidates.id", ondelete="CASCADE"), nullable=False)
    room_id = Column(String(255), nullable=True)
    room_url = Column(String(1024), nullable=True)
    status = Column(String(50), default="scheduled", nullable=False)
    invite_token = Column(String(255), nullable=True)
    transcript = Column(JSON, default=list, nullable=True)

    # BB4: Audio Processing
    recording_url = Column(String(1024), nullable=True)     # LiveKit mixed MP4 URL
    voice_ogg_url = Column(String(1024), nullable=True)     # Candidate-only .ogg in S3

    # BB5: Interview Analysis
    vic_score = Column(Integer, nullable=True)              # Technical score 0-100
    bc_score = Column(Integer, nullable=True)               # Behavioral score 0-100
    vic_scores = Column(JSON, nullable=True)                # Detailed VIC breakdown JSONB
    bc_scores = Column(JSON, nullable=True)                 # Detailed BC breakdown + integrity JSONB

    # BB6: Final Report
    overall_score = Column(Integer, nullable=True)
    ai_verdict = Column(String(50), nullable=True)          # 'Strong Hire', 'Hire', 'Hold', etc.
    report_url = Column(String(1024), nullable=True)        # S3 PDF report URL

    # Timestamps
    started_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    candidate = relationship("Candidate", foreign_keys=[candidate_id], back_populates="interviews")
    events = relationship("InterviewEvent", back_populates="interview", cascade="all, delete-orphan")


class InterviewEvent(Base):
    __tablename__ = "interview_events"

    id = Column(Integer, primary_key=True, index=True)
    interview_id = Column(Integer, ForeignKey("interviews.id", ondelete="CASCADE"), nullable=False)
    event_type = Column(String(100), nullable=False)        # 'tab_hidden', 'tab_visible', 'SUSPICIOUS_RECONNECT', etc.
    event_data = Column(JSON, nullable=True)                # Anti-cheat payload: offline_ms, disconnect_reason, etc.
    timestamp = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    interview = relationship("Interview", back_populates="events")


class UploadBatch(Base):
    __tablename__ = "upload_batches"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    job_id = Column(Integer, ForeignKey("jobs.id", ondelete="CASCADE"), nullable=False)
    hr_user_id = Column(UUID(as_uuid=True), nullable=True)
    total_files = Column(Integer, default=0)
    processed_count = Column(Integer, default=0)
    failed_count = Column(Integer, default=0)
    processing_count = Column(Integer, default=0)
    status = Column(String(20), default="uploading")  # uploading, processing, completed
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    completed_at = Column(DateTime(timezone=True), nullable=True)

    job = relationship("Job")
    logs = relationship("UploadLog", back_populates="batch", cascade="all, delete-orphan")


class UploadLog(Base):
    __tablename__ = "upload_logs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    batch_id = Column(UUID(as_uuid=True), ForeignKey("upload_batches.id", ondelete="CASCADE"), nullable=False)
    file_name = Column(String(255), nullable=False)
    file_size_bytes = Column(Integer, nullable=True)
    status = Column(String(50), default="uploaded")  # uploaded, parsing, structured, scored, failed, unable_to_process
    error_message = Column(Text, nullable=True)
    candidate_id = Column(Integer, ForeignKey("candidates.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    completed_at = Column(DateTime(timezone=True), nullable=True)

    batch = relationship("UploadBatch", back_populates="logs")
    candidate = relationship("Candidate")


class CandidateNote(Base):
    __tablename__ = "candidate_notes"

    id = Column(Integer, primary_key=True, index=True)
    candidate_id = Column(Integer, ForeignKey("candidates.id", ondelete="CASCADE"), nullable=False)
    text = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    candidate = relationship("Candidate", back_populates="notes")
