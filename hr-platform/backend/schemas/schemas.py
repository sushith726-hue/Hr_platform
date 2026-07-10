from pydantic import BaseModel
from typing import List, Optional
from uuid import UUID
from datetime import datetime

class PaginationSchema(BaseModel):
    page: int
    limit: int
    total: int
    total_pages: int
    has_next: bool
    has_prev: bool
    next_cursor: Optional[str] = None
    prev_cursor: Optional[str] = None

class UploadLogSchema(BaseModel):
    id: UUID
    batch_id: UUID
    file_name: str
    file_size_bytes: Optional[int] = None
    status: str
    error_message: Optional[str] = None
    candidate_id: Optional[int] = None
    created_at: datetime
    completed_at: Optional[datetime] = None

    class Config:
        from_attributes = True

class UploadBatchSchema(BaseModel):
    id: UUID
    job_id: int
    hr_user_id: Optional[UUID] = None
    total_files: int
    processed_count: int
    failed_count: int
    processing_count: int
    status: str
    created_at: datetime
    completed_at: Optional[datetime] = None
    logs: List[UploadLogSchema] = []

    class Config:
        from_attributes = True
