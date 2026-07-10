# Graph Report - /home/sushith/Desktop/hr_project  (2026-07-10)

## Corpus Check
- 48 files · ~63,557 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 392 nodes · 653 edges · 66 communities detected
- Extraction: 54% EXTRACTED · 46% INFERRED · 0% AMBIGUOUS · INFERRED: 300 edges (avg confidence: 0.52)
- Token cost: 5,033 input · 862 output

## God Nodes (most connected - your core abstractions)
1. `Job` - 35 edges
2. `Candidate` - 35 edges
3. `Interview` - 35 edges
4. `InterviewEvent` - 35 edges
5. `UploadBatch` - 35 edges
6. `UploadLog` - 35 edges
7. `CandidateNote` - 24 edges
8. `TalentStream Implementation Agent` - 13 edges
9. `TalentStream HR Platform` - 13 edges
10. `TalentStream HR Platform` - 13 edges

## Surprising Connections (you probably didn't know these)
- `TalentStream HR Platform` --conceptually_related_to--> `Candidate Status`  [EXTRACTED]
  implementation/implementation-plan.md → architecture/architecture.md
- `TalentStream HR Platform` --references--> `Interview Flow API`  [EXTRACTED]
  implementation/implementation-plan.md → architecture/architecture.md
- `TalentStream HR Platform` --rationale_for--> `Data Flow Security Architecture`  [EXTRACTED]
  implementation/implementation-plan.md → architecture/architecture.md
- `TalentStream HR Platform` --solves--> `Manual Recruitment Process`  [EXTRACTED]
  implementation/implementation-plan.md → docs/bhagavadgeetha.md
- `TalentStream HR Platform` --implements--> `Automated Screening Pipeline`  [EXTRACTED]
  implementation/implementation-plan.md → docs/bhagavadgeetha.md

## Hyperedges (group relationships)
- **API Management** — job_management_api, candidate_management_api, interview_management_api [EXTRACTED 1.00]
- **High Severity Issues** — issue_shortlist_button_not_working, issue_resume_upload_bulk_processing_visibility, issue_lack_of_pagination, issue_dashboard_status_inconsistencies, issue_lack_of_resume_view, issue_upload_resume_button_without_job_context, issue_manual_review_flow [EXTRACTED 1.00]
- **Model Selection Decisions** — adr_001, adr_002 [EXTRACTED 1.00]
- **Resume Upload Design Decisions** — adr_007, adr_011 [EXTRACTED 1.00]
- **Pagination and Progress Decisions** — adr_012, adr_013 [EXTRACTED 1.00]
- **Interview Process Components** — candidate_name, candidate_structured_profile, job_description [EXTRACTED 1.00]
- **API Management** — job_management_api, candidate_management_api, interview_flow_api [EXTRACTED 1.00]
- **Data Flow Pipeline** — FastAPI_Application, PostgreSQL_Database, Redis_Task_Broker, AI_Worker [EXTRACTED 1.00]
- **Candidate Interview Process** — Candidate_Portal, LiveKit_Cloud_Server, AI_Worker [EXTRACTED 1.00]
- **API Management** — job_management_api, candidate_management_api, interview_management_api [INFERRED]
- **High Severity Issues** — issue_shortlist_button_not_working, issue_resume_upload_bulk_processing_visibility, issue_lack_of_pagination, issue_dashboard_status_inconsistencies, issue_lack_of_resume_view, issue_upload_resume_button_without_job_context, issue_manual_review_flow [INFERRED]
- **Model Selection Decisions** — adr_001, adr_002 [INFERRED]
- **Resume Upload Design Decisions** — adr_007, adr_011 [INFERRED]
- **Pagination and Progress Decisions** — adr_012, adr_013 [INFERRED]
- **Interview Process Components** — candidate_name, candidate_structured_profile, job_description [INFERRED]
- **Data Flow Pipeline** — FastAPI_Application, PostgreSQL_Database, Redis_Task_Broker, AI_Worker [INFERRED]
- **Candidate Interview Process** — Candidate_Portal, LiveKit_Cloud_Server, AI_Worker [INFERRED]

## Communities

### Community 0 - "Frontend Functions"
Cohesion: 0.06
Nodes (27): checkInviteLock(), closeJobAnyway(), fetchLastBatchForJob(), fetchOlderBatches(), getStatusLabelAndClass(), handleFiles(), loadCandidateNotes(), loadCandidateOriginalResume() (+19 more)

### Community 1 - "Backend Job Management"
Cohesion: 0.05
Nodes (29): add_files_to_batch(), agent_watchdog_loop(), close_job(), convert_rvc_to_rubric(), create_job(), delete_job(), end_interview_by_id(), end_interview_by_token() (+21 more)

### Community 2 - "Data Models"
Cohesion: 0.27
Nodes (42): Base, BaseModel, CandidateStatusUpdate, Config, EndTokenRequest, JobCreate, JobResponse, LogEventRequest (+34 more)

### Community 3 - "Python Technologies"
Cohesion: 0.08
Nodes (32): B.S. in Computer Science, Celery, Email Validator, FastAPI, John Doe, end_interview(), main(), update_db_status() (+24 more)

### Community 4 - "AI Systems"
Cohesion: 0.1
Nodes (28): AI Integrations, AI Worker Container, Anti-Cheat Detection, Audio Worker Container, Automated Recruitment Workflow System, Automated Screening Pipeline, Backend Technology, Candidate Management API (+20 more)

### Community 5 - "Database Migrations"
Cohesion: 0.08
Nodes (9): add candidate notes  Revision ID: 1c4da8e425c2 Revises: c9431e1ffb93 Create Date, initial_schema  Revision ID: b1b47d3a9c16 Revises:  Create Date: 2026-07-06 12:4, add_match_breakdown_and_ai_recommendation  Revision ID: bbea406c0801 Revises: b1, add_upload_batches_and_logs  Revision ID: c9431e1ffb93 Revises: bbea406c0801 Cre, Run migrations in 'offline' mode., Run migrations in 'online' mode., run_migrations_offline(), run_migrations_online() (+1 more)

### Community 6 - "Compliance and Documentation"
Cohesion: 0.14
Nodes (14): Agent Compliance Check, Architecture Documents, Auto-Update Tracking Files, Code Quality Rules, Communication Style, Documentation Rules, External Service Integration Rules, File Structure Reference (+6 more)

### Community 7 - "S3 Integration"
Cohesion: 0.17
Nodes (8): Boto3, Requests, get_db(), get_s3_client(), Dependency provider for database sessions, Returns a configured boto3 client for S3/MinIO bucket operations     using crede, Start Script, Stop Script

### Community 8 - "Development Phases"
Cohesion: 0.2
Nodes (10): Phase 0: Foundation, Phase 1: Job Management, Phase 2: Resume Ingestion & Parsing, Phase 3: Resume Scoring, Phase 4: Interview Setup & Token Generation, Phase 5: Live AI Interview & Dynamic Portal, Phase 6: Audio Processing & Behavioral Analysis, Phase 7: Final Reporting (+2 more)

### Community 9 - "Resume Management"
Cohesion: 0.22
Nodes (9): Candidate Status Transitions, Error Logs Representation, Manual Review Workflow, Mark as Reviewed Action, Resume Failure Pipeline Hardening, Resume Upload API Guardrail, Stabilize Resume Upload Pipeline, Summary Review Banner (+1 more)

### Community 10 - "Interview Scoring"
Cohesion: 0.29
Nodes (7): Resume Verification Criteria to Rubric Generator, Resume Data Extractor, Candidate Scoring, Live Voice Interviewer, Interview VIC Technical Scorer, Interview BC Behavioral Scorer, Hiring Manager Summary Generator

### Community 11 - "AI Research"
Cohesion: 0.33
Nodes (6): AI Engineering, M.S. in Artificial Intelligence, FutureTech, Innovations Lab, Jane Smith, Natural Language Processing

### Community 12 - "AI Infrastructure"
Cohesion: 0.4
Nodes (6): Celery AI Worker, FastAPI Application Gateway, OpenAI GPT API, PostgreSQL Database, Redis Task Broker & Pub/Sub, TalentStream HR Platform

### Community 13 - "Recruitment Automation"
Cohesion: 0.33
Nodes (6): Automated Screening Pipeline, Candidate Status, Data Flow Security Architecture, Interview Flow API, Manual Recruitment Process, TalentStream HR Platform

### Community 14 - "Candidate Scoring"
Cohesion: 0.4
Nodes (5): Anonymous Candidate Profile, Candidate Scoring Process, Job Scoring Rubric, Score Breakdown, Scoring Recommendation

### Community 15 - "Semantic Processing"
Cohesion: 1.0
Nodes (2): main(), process_file_semantic()

### Community 16 - "Configuration Settings"
Cohesion: 0.67
Nodes (2): BaseSettings, Settings

### Community 17 - "UI Iterations"
Cohesion: 0.67
Nodes (3): Iteration 1 — Initial Layout, Iteration 2 — Button Visibility & Styling, Iteration 3 — Job Tree Accordion

### Community 18 - "UI Enhancements"
Cohesion: 0.67
Nodes (3): Iteration 4 — Panel Resizing & Compact Cards, Iteration 5 — Light Theme Migration, Iteration 8 — Hybrid Pagination & Batch Ingestion UI

### Community 19 - "Model Selection"
Cohesion: 1.0
Nodes (3): Model Selection for Formatting (BB2-B), Model Selection for Scoring (BB3), Room Creation Timing

### Community 20 - "Upload Strategies"
Cohesion: 0.67
Nodes (3): Hybrid Pagination Strategy, SSE-based Batch Upload Progress Ingestion, Resume Ingestion Failure Hardening & Manual Review Pipeline

### Community 21 - "Candidate Information"
Cohesion: 0.67
Nodes (3): Candidate Name, Candidate Structured Profile, Job Description

### Community 22 - "Interview Analysis"
Cohesion: 1.0
Nodes (3): Interview Evaluation Process, Interview Transcript Analysis, Voice Interview Criteria

### Community 23 - "Labeling Scripts"
Cohesion: 1.0
Nodes (0): 

### Community 24 - "Platform Verification"
Cohesion: 1.0
Nodes (0): 

### Community 25 - "S3 Testing"
Cohesion: 1.0
Nodes (0): 

### Community 26 - "Logging Pipeline"
Cohesion: 1.0
Nodes (0): 

### Community 27 - "Documentation"
Cohesion: 1.0
Nodes (2): Bhagavad Geetha Documentation, Onboarding Documentation

### Community 28 - "Architecture Overview"
Cohesion: 1.0
Nodes (2): Architecture Specification, TalentStream Architecture Master

### Community 29 - "Design Documentation"
Cohesion: 1.0
Nodes (2): Design Documentation, Mermaid Diagrams

### Community 30 - "Implementation Planning"
Cohesion: 1.0
Nodes (2): Implementation Plan, To-Do List

### Community 31 - "UI Redesign Iterations"
Cohesion: 1.0
Nodes (2): Iteration 6 — Empty State Card Redesign, Iteration 7 — Resume Upload Zone Redesign

### Community 32 - "UI Issues"
Cohesion: 1.0
Nodes (2): Buttons look like 'stool rectangles', Shortlist button not working

### Community 33 - "Dashboard Issues"
Cohesion: 1.0
Nodes (2): Dashboard status inconsistencies for failed / unable_to_process states, Lack of pagination for high candidate volume

### Community 34 - "Resume Upload Issues"
Cohesion: 1.0
Nodes (2): Lack of resume view for failed ingestion states, Upload resume button allowed uploading without an active job context

### Community 35 - "Candidate Card Design"
Cohesion: 1.0
Nodes (2): Compact Candidate Card Representation, Empty State Card Redesign

### Community 36 - "Resume Upload Modality"
Cohesion: 1.0
Nodes (2): Modality for Resume Uploads, Resume Upload Zone Redesign

### Community 37 - "Evaluation Criteria"
Cohesion: 1.0
Nodes (2): Behavioral Criteria, Resume Verification Criteria

### Community 38 - "Candidate Portal"
Cohesion: 1.0
Nodes (2): Candidate Portal, LiveKit Cloud WebRTC Server

### Community 39 - "Interview Process"
Cohesion: 1.0
Nodes (2): Candidate Interview Process, MinIO/S3 Cloud Storage

### Community 40 - "Evaluation Summary"
Cohesion: 1.0
Nodes (1): Candidate Evaluation Summary

### Community 41 - "Behavioral Scoring"
Cohesion: 1.0
Nodes (1): BB5 Behavioral Scorer

### Community 42 - "Initialization"
Cohesion: 1.0
Nodes (0): 

### Community 43 - "Template Engine"
Cohesion: 1.0
Nodes (1): Jinja2

### Community 44 - "UI Issues"
Cohesion: 1.0
Nodes (1): Job tree not accordion dropdown

### Community 45 - "CSS Warnings"
Cohesion: 1.0
Nodes (1): CSS background-clip compatibility warning

### Community 46 - "Bulk Processing Visibility"
Cohesion: 1.0
Nodes (1): Resume upload bulk processing visibility

### Community 47 - "Manual Review Process"
Cohesion: 1.0
Nodes (1): Manual review flow for parsed-failed candidates

### Community 48 - "Button Styling"
Cohesion: 1.0
Nodes (1): UI Button Styling

### Community 49 - "Resizable Layout"
Cohesion: 1.0
Nodes (1): 3-Panel Resizable Layout

### Community 50 - "Theme Palette"
Cohesion: 1.0
Nodes (1): Light Theme Palette

### Community 51 - "Button Refactoring"
Cohesion: 1.0
Nodes (1): Action Button Refactor

### Community 52 - "Rubric Generation"
Cohesion: 1.0
Nodes (1): RVC to Rubric Generator

### Community 53 - "Data Extraction"
Cohesion: 1.0
Nodes (1): Resume Data Extractor

### Community 54 - "Candidate"
Cohesion: 1.0
Nodes (1): Candidate

### Community 55 - "Job"
Cohesion: 1.0
Nodes (1): Job

### Community 56 - "Interview"
Cohesion: 1.0
Nodes (1): Interview

### Community 57 - "Note"
Cohesion: 1.0
Nodes (1): Note

### Community 58 - "Job"
Cohesion: 1.0
Nodes (1): Job

### Community 59 - "Candidate"
Cohesion: 1.0
Nodes (1): Candidate

### Community 60 - "Interview"
Cohesion: 1.0
Nodes (1): Interview

### Community 61 - "Interview Event"
Cohesion: 1.0
Nodes (1): InterviewEvent

### Community 62 - "Upload Batch"
Cohesion: 1.0
Nodes (1): UploadBatch

### Community 63 - "Upload Log"
Cohesion: 1.0
Nodes (1): UploadLog

### Community 64 - "Candidate Note"
Cohesion: 1.0
Nodes (1): CandidateNote

### Community 65 - "Implementation Agent"
Cohesion: 1.0
Nodes (1): TalentStream Implementation Agent

## Knowledge Gaps
- **115 isolated node(s):** `Run migrations in 'offline' mode.`, `Run migrations in 'online' mode.`, `initial_schema  Revision ID: b1b47d3a9c16 Revises:  Create Date: 2026-07-06 12:4`, `add candidate notes  Revision ID: 1c4da8e425c2 Revises: c9431e1ffb93 Create Date`, `add_upload_batches_and_logs  Revision ID: c9431e1ffb93 Revises: bbea406c0801 Cre` (+110 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Labeling Scripts`** (2 nodes): `label_communities.py`, `main()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Platform Verification`** (2 nodes): `verify.py`, `verify_platform()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `S3 Testing`** (2 nodes): `test_s3.py`, `verify_s3_connection()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Logging Pipeline`** (2 nodes): `pipeline_logger.py`, `log_pipeline_event()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Documentation`** (2 nodes): `Bhagavad Geetha Documentation`, `Onboarding Documentation`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Architecture Overview`** (2 nodes): `Architecture Specification`, `TalentStream Architecture Master`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Design Documentation`** (2 nodes): `Design Documentation`, `Mermaid Diagrams`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Implementation Planning`** (2 nodes): `Implementation Plan`, `To-Do List`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `UI Redesign Iterations`** (2 nodes): `Iteration 6 — Empty State Card Redesign`, `Iteration 7 — Resume Upload Zone Redesign`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `UI Issues`** (2 nodes): `Buttons look like 'stool rectangles'`, `Shortlist button not working`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Dashboard Issues`** (2 nodes): `Dashboard status inconsistencies for failed / unable_to_process states`, `Lack of pagination for high candidate volume`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Resume Upload Issues`** (2 nodes): `Lack of resume view for failed ingestion states`, `Upload resume button allowed uploading without an active job context`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Candidate Card Design`** (2 nodes): `Compact Candidate Card Representation`, `Empty State Card Redesign`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Resume Upload Modality`** (2 nodes): `Modality for Resume Uploads`, `Resume Upload Zone Redesign`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Evaluation Criteria`** (2 nodes): `Behavioral Criteria`, `Resume Verification Criteria`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Candidate Portal`** (2 nodes): `Candidate Portal`, `LiveKit Cloud WebRTC Server`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Interview Process`** (2 nodes): `Candidate Interview Process`, `MinIO/S3 Cloud Storage`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Evaluation Summary`** (1 nodes): `Candidate Evaluation Summary`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Behavioral Scoring`** (1 nodes): `BB5 Behavioral Scorer`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Initialization`** (1 nodes): `__init__.py`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Template Engine`** (1 nodes): `Jinja2`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `UI Issues`** (1 nodes): `Job tree not accordion dropdown`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `CSS Warnings`** (1 nodes): `CSS background-clip compatibility warning`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Bulk Processing Visibility`** (1 nodes): `Resume upload bulk processing visibility`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Manual Review Process`** (1 nodes): `Manual review flow for parsed-failed candidates`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Button Styling`** (1 nodes): `UI Button Styling`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Resizable Layout`** (1 nodes): `3-Panel Resizable Layout`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Theme Palette`** (1 nodes): `Light Theme Palette`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Button Refactoring`** (1 nodes): `Action Button Refactor`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Rubric Generation`** (1 nodes): `RVC to Rubric Generator`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Data Extraction`** (1 nodes): `Resume Data Extractor`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Candidate`** (1 nodes): `Candidate`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Job`** (1 nodes): `Job`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Interview`** (1 nodes): `Interview`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Note`** (1 nodes): `Note`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Job`** (1 nodes): `Job`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Candidate`** (1 nodes): `Candidate`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Interview`** (1 nodes): `Interview`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Interview Event`** (1 nodes): `InterviewEvent`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Upload Batch`** (1 nodes): `UploadBatch`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Upload Log`** (1 nodes): `UploadLog`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Candidate Note`** (1 nodes): `CandidateNote`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Implementation Agent`** (1 nodes): `TalentStream Implementation Agent`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `SQLAlchemy` connect `Database Migrations` to `Data Models`, `Python Technologies`, `S3 Integration`?**
  _High betweenness centrality (0.051) - this node is a cross-community bridge._
- **Why does `Redis` connect `Python Technologies` to `Backend Job Management`, `S3 Integration`?**
  _High betweenness centrality (0.038) - this node is a cross-community bridge._
- **Why does `Celery` connect `Python Technologies` to `Database Migrations`?**
  _High betweenness centrality (0.028) - this node is a cross-community bridge._
- **Are the 33 inferred relationships involving `Job` (e.g. with `JobCreate` and `JobResponse`) actually correct?**
  _`Job` has 33 INFERRED edges - model-reasoned connections that need verification._
- **Are the 33 inferred relationships involving `Candidate` (e.g. with `JobCreate` and `JobResponse`) actually correct?**
  _`Candidate` has 33 INFERRED edges - model-reasoned connections that need verification._
- **Are the 33 inferred relationships involving `Interview` (e.g. with `JobCreate` and `JobResponse`) actually correct?**
  _`Interview` has 33 INFERRED edges - model-reasoned connections that need verification._
- **Are the 33 inferred relationships involving `InterviewEvent` (e.g. with `JobCreate` and `JobResponse`) actually correct?**
  _`InterviewEvent` has 33 INFERRED edges - model-reasoned connections that need verification._