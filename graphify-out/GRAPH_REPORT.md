# Graph Report - .  (2026-07-10)

## Corpus Check
- 22 files · ~0 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 215 nodes · 428 edges · 20 communities detected
- Extraction: 50% EXTRACTED · 50% INFERRED · 0% AMBIGUOUS · INFERRED: 214 edges (avg confidence: 0.5)
- Token cost: 0 input · 0 output

## God Nodes (most connected - your core abstractions)
1. `Job` - 24 edges
2. `Candidate` - 24 edges
3. `Interview` - 24 edges
4. `InterviewEvent` - 24 edges
5. `UploadBatch` - 24 edges
6. `UploadLog` - 24 edges
7. `CandidateNote` - 24 edges
8. `JobCreate` - 9 edges
9. `JobResponse` - 9 edges
10. `CandidateStatusUpdate` - 9 edges

## Surprising Connections (you probably didn't know these)
- `JobCreate` --uses--> `Candidate`  [INFERRED]
  hr-platform/backend/main.py → /home/sushith/Desktop/hr_project/hr-platform/backend/db/models.py
- `JobCreate` --uses--> `Interview`  [INFERRED]
  hr-platform/backend/main.py → /home/sushith/Desktop/hr_project/hr-platform/backend/db/models.py
- `JobCreate` --uses--> `Job`  [INFERRED]
  hr-platform/backend/main.py → /home/sushith/Desktop/hr_project/hr-platform/backend/db/models.py
- `JobCreate` --uses--> `UploadBatch`  [INFERRED]
  hr-platform/backend/main.py → /home/sushith/Desktop/hr_project/hr-platform/backend/db/models.py
- `JobCreate` --uses--> `UploadLog`  [INFERRED]
  hr-platform/backend/main.py → /home/sushith/Desktop/hr_project/hr-platform/backend/db/models.py

## Communities

### Community 0 - "Community 0"
Cohesion: 0.06
Nodes (27): checkInviteLock(), closeJobAnyway(), fetchLastBatchForJob(), fetchOlderBatches(), getStatusLabelAndClass(), handleFiles(), loadCandidateNotes(), loadCandidateOriginalResume() (+19 more)

### Community 1 - "Community 1"
Cohesion: 0.05
Nodes (29): add_files_to_batch(), agent_watchdog_loop(), close_job(), convert_rvc_to_rubric(), create_job(), delete_job(), end_interview_by_id(), end_interview_by_token() (+21 more)

### Community 2 - "Community 2"
Cohesion: 0.09
Nodes (29): BaseModel, Config, PaginationSchema, UploadBatchSchema, UploadLogSchema, analyze_interview(), _calculate_experience_years(), EducationItem (+21 more)

### Community 3 - "Community 3"
Cohesion: 0.36
Nodes (30): Base, CandidateStatusUpdate, Config, EndTokenRequest, JobCreate, JobResponse, LogEventRequest, NoteCreate (+22 more)

### Community 4 - "Community 4"
Cohesion: 0.4
Nodes (4): Run migrations in 'offline' mode., Run migrations in 'online' mode., run_migrations_offline(), run_migrations_online()

### Community 5 - "Community 5"
Cohesion: 0.4
Nodes (4): get_db(), get_s3_client(), Dependency provider for database sessions, Returns a configured boto3 client for S3/MinIO bucket operations     using crede

### Community 6 - "Community 6"
Cohesion: 0.5
Nodes (1): initial_schema  Revision ID: b1b47d3a9c16 Revises:  Create Date: 2026-07-06 12:4

### Community 7 - "Community 7"
Cohesion: 0.5
Nodes (1): add candidate notes  Revision ID: 1c4da8e425c2 Revises: c9431e1ffb93 Create Date

### Community 8 - "Community 8"
Cohesion: 0.5
Nodes (1): add_upload_batches_and_logs  Revision ID: c9431e1ffb93 Revises: bbea406c0801 Cre

### Community 9 - "Community 9"
Cohesion: 0.5
Nodes (1): add_match_breakdown_and_ai_recommendation  Revision ID: bbea406c0801 Revises: b1

### Community 10 - "Community 10"
Cohesion: 0.83
Nodes (3): end_interview(), main(), update_db_status()

### Community 11 - "Community 11"
Cohesion: 1.0
Nodes (2): main(), process_file_semantic()

### Community 12 - "Community 12"
Cohesion: 0.67
Nodes (0): 

### Community 13 - "Community 13"
Cohesion: 0.67
Nodes (2): BaseSettings, Settings

### Community 14 - "Community 14"
Cohesion: 1.0
Nodes (0): 

### Community 15 - "Community 15"
Cohesion: 1.0
Nodes (0): 

### Community 16 - "Community 16"
Cohesion: 1.0
Nodes (0): 

### Community 17 - "Community 17"
Cohesion: 1.0
Nodes (0): 

### Community 18 - "Community 18"
Cohesion: 1.0
Nodes (0): 

### Community 19 - "Community 19"
Cohesion: 1.0
Nodes (0): 

## Knowledge Gaps
- **17 isolated node(s):** `Run migrations in 'offline' mode.`, `Run migrations in 'online' mode.`, `initial_schema  Revision ID: b1b47d3a9c16 Revises:  Create Date: 2026-07-06 12:4`, `add candidate notes  Revision ID: 1c4da8e425c2 Revises: c9431e1ffb93 Create Date`, `add_upload_batches_and_logs  Revision ID: c9431e1ffb93 Revises: bbea406c0801 Cre` (+12 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 14`** (2 nodes): `label_communities.py`, `main()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 15`** (2 nodes): `query_db.py`, `scratch_query_interview.py`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 16`** (2 nodes): `verify.py`, `verify_platform()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 17`** (2 nodes): `test_s3.py`, `verify_s3_connection()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 18`** (2 nodes): `pipeline_logger.py`, `log_pipeline_event()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 19`** (1 nodes): `__init__.py`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Are the 22 inferred relationships involving `Job` (e.g. with `JobCreate` and `JobResponse`) actually correct?**
  _`Job` has 22 INFERRED edges - model-reasoned connections that need verification._
- **Are the 22 inferred relationships involving `Candidate` (e.g. with `JobCreate` and `JobResponse`) actually correct?**
  _`Candidate` has 22 INFERRED edges - model-reasoned connections that need verification._
- **Are the 22 inferred relationships involving `Interview` (e.g. with `JobCreate` and `JobResponse`) actually correct?**
  _`Interview` has 22 INFERRED edges - model-reasoned connections that need verification._
- **Are the 22 inferred relationships involving `InterviewEvent` (e.g. with `JobCreate` and `JobResponse`) actually correct?**
  _`InterviewEvent` has 22 INFERRED edges - model-reasoned connections that need verification._
- **Are the 22 inferred relationships involving `UploadBatch` (e.g. with `JobCreate` and `JobResponse`) actually correct?**
  _`UploadBatch` has 22 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Run migrations in 'offline' mode.`, `Run migrations in 'online' mode.`, `initial_schema  Revision ID: b1b47d3a9c16 Revises:  Create Date: 2026-07-06 12:4` to the rest of the system?**
  _17 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.06 - nodes in this community are weakly interconnected._