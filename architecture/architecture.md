# TalentStream HR Platform: Locked Architecture Specification v1.0

This document defines the final locked system architecture, components, schemas, endpoints, and workflows for the TalentStream HR Platform. This specification replaces all previous architectural versions.

---

## 1. System Overview & Scale
TalentStream is an AI-powered automated hiring and candidate screening platform built for small teams. The platform automates resume ingestion, match scoring, live WebRTC voice interviews, behavioral voice analysis, and consolidated evaluations.
* **Target Scale:** 250–300 resumes processed per day.
* **Concurrency:** 1–2 active HR managers.
* **Operating Model:** High-efficiency automated pipeline with human-in-the-loop validation for processing failures.

---

## 2. The Four Criteria (Frozen Per Job)
Every job role created within the system defines a set of criteria fields that remain frozen throughout the candidate lifecycle:

| Criteria | Code | What It Defines | When Used |
| :--- | :--- | :--- | :--- |
| **Job Description** | **JD** | The actual job posting text and responsibilities | Resume matching, interview questions |
| **Resume Verification Criteria** | **RVC** | Hard filters and rules for scoring resumes | Converted to rubric_json on job creation |
| **Voice Interview Criteria** | **VIC** | Technical parameters and guidelines for the interview | Post-interview technical scoring |
| **Behavioral Criteria** | **BC** | Voice, acoustic, and behavioral target parameters | Post-interview behavioral scoring of the `.ogg` voice recording |

---

## 3. Frontend Layout & User Interface

### Desktop Grid Layout (Resolutions >= 1024px)
* **Left Panel (20% Width):**
  * `[+ Post Job]` action button.
  * Collapsible job list tree showing "Open Jobs" and "Closed Jobs".
* **Middle Panel (50% Width):**
  * Search input bar with active query button.
  * Filters, sorting triggers, and drag-and-drop resume upload zone.
  * Scrolling candidates list displaying cards with names, scores, status badges, and action triggers (e.g., `[Shortlist]`, `[Reject]`, `[Invite]`).
  * Special states, such as `⚠️ Unknown (Parse Failed)` with action buttons `[Review]` and `[Delete]`.
* **Right Panel (30% Width):**
  * Expanded candidate profile details.
  * Tabs navigation bar: `[Resume]`, `[Resume Rpt]`, `[Interview]`, `[Behavioral]`, `[Overall]`, and `[HR Notes]`.
  * Action panel footer with `[Shortlist]`, `[Reject]`, and `[Invite]` buttons.

### Mobile Responsive Layout (Resolutions < 768px)
* Single-column container stack.
* Collapsible hamburger menu `(=)` for the Left Panel.
* Slide-in overlay drawer for the Right Panel details view.
* Persistent bottom navigation bar with touch targets measuring a minimum of `48px`.

### Candidate Status states
Candidates follow a strict state transition model:
`uploaded`, `parsing`, `structured`, `scored`, `new`, `shortlisted`, `rejected`, `interview_invited`, `interview_scheduled`, `interview_ongoing`, `interview_completed`, `final_evaluation`, `hired`, `rejected_post_interview`, `failed`, `unable_to_process`, `manual_reviewed`.
* **failed**: LlamaParse cannot read the file (PDF corrupted, password-protected, encrypted, unsupported format, S3 upload failed, LlamaParse API error).
* **unable_to_process**: LlamaParse succeeded, but GPT parsing / Pydantic validation failed 3 times.
* **manual_reviewed**: A failed or unable_to_process candidate that has been manually inspected and marked as reviewed by the recruiter, allowing re-entry into the scoring pipeline.

---

## 4. Platform Infrastructure (5 Containers + External Services)
The local runtime architecture is composed of exactly 5 containers defined in `docker-compose.yml`:

1. **api (FastAPI, Port 8000):** Serves static frontend assets, runs the REST API, manages SSE event streams, and handles webhooks.
2. **ai-worker (Celery):** Handles BB2 (parse & structure), BB3 (score & match), and BB6 (final report generation).
3. **audio-worker (Celery):** Handles BB4 (FFmpeg channel separation) and BB5 (STT + behavioral evaluation).
4. **db (PostgreSQL, Port 5432):** Relational storage for schemas.
5. **redis (Port 6379):** Message broker for Celery queues and Pub/Sub manager for Server-Sent Events (SSE).

### External Services (DO NOT build local equivalents)
* **LiveKit Cloud:** Video/audio WebRTC interview rooms.
* **MinIO/S3 Cloud:** S3-compatible cloud object storage.
* **OpenAI GPT API:** `gpt-4o-mini` (parsing and scoring), `gpt-4o` (voice agent).
* **smallest.ai STT API:** Speech transcription and acoustic metrics (WPM, filler counts, pauses).
* **SendGrid / AWS SES:** Email service for invitation delivery.
* **LlamaParse Cloud API:** Document parsing in agentic mode.

---

## 5. Caddy Server (Production Only)
* **Development:** Uvicorn runs directly on port 8000.
* **Production:** Caddy handles reverse-proxying and Let's Encrypt TLS automation.

---

## 6. The 6 Black Boxes & Middleware Router

### BB1: Ingest & Storage
* **FastAPI endpoint:** `POST /api/candidates/upload`
* **Flow:** Accepts multipart PDF/DOCX/TXT and `job_id`. Validates file size is < 10MB. Streams the file directly to S3 under `resumes/{job_id}/{candidate_id}/resume.pdf`. Inserts candidate row (`status="uploaded"`, `resume_url=S3 Path`). Enqueues Celery task for BB2 and broadcasts `upload_progress` SSE event.

### BB2: Parse & Structure (ai-worker)
* **BB2-A (LlamaParse Agentic):** Downloads resume and calls LlamaParse Cloud API in agentic mode. If it fails, retries once in cost-effective mode. On persistent failure, sets candidate `status="unable_to_process"` and populates `parse_error_log`.
* **BB2-B (GPT-4o-mini Formatter):** Sends LlamaParse Markdown to GPT-4o-mini with temperature=0, seed=42, and `response_format={"type":"json_object"}` to extract structured fields (`name`, `email`, `phone`, `location`, `skills[]`, `experience_years`, `education[{degree, institution}]`).
* **BB2-C (Pydantic Validator):** Enforces schema using CandidateSchema. Executes up to 3 progressive attempts on validation failures:
  * Attempt 1: Base prompt, temperature=0.
  * Attempt 2: Base prompt + explicit examples, temperature=0.
  * Attempt 3: Stricter prompt + examples, temperature=0.
  If all attempts fail, transitions candidate `status="unable_to_process"` and sends an SSE alert. On success, transitions candidate `status="structured"` and populates `clean_json`.

### BB3: Score & Match (ai-worker)
* **Step 1: Bias Strip:** Removes `name`, `email`, `phone`, `location`, graduation year, and university names. Replaces them with `anon_id`, `years_since_degree`, and `degree_level`.
* **Step 2: Score:** Sends bias-stripped profile and `jobs.rubric_json` to GPT-4o-mini (temperature=0, seed=42, structured output) to obtain sub-scores (skills max 40, experience max 30, education max 20, certs max 10), `total_score`, `recommendation`, and `rationale`.
* **Step 3: Validate:** Checks that `total_score` is an integer between 0 and 100, and `recommendation` is one of `strong_hire`, `hire`, `hold`, `manual_review`, or `reject`. If validation fails, retries once, then flags candidate status as `manual_review`.
* **Step 4: Store:** Updates candidate table with `match_score`, `match_breakdown`, and `ai_recommendation`, sets status to `new`, and broadcasts the `candidate_ready` SSE event.

### BB4: Audio Processing (audio-worker)
* **Trigger:** `POST /api/webhooks/livekit/room-closed`
* **Flow:** Downloads the mixed MP4 recording from LiveKit. Runs FFmpeg to separate channels:
  ```bash
  ffmpeg -i mixed_input.mp4 \
    -filter_complex '[0:a]channelsplit=channel_layout=stereo[left][right]' \
    -map '[right]' -ac 1 -c:a libopus -b:a 32k candidate_voice.ogg
  ```
  * **Explanation:** `-map_channel` is deprecated and unreliable. `-filter_complex channelsplit` properly separates stereo channels. The `[right]` channel represents candidate voice (AI is on left channel in LiveKit mixed recording). `-ac 1` outputs mono, `-c:a libopus` uses the Opus codec, and `-b:a 32k` sets the bitrate to 32kbps.
  * **Validation:** After FFmpeg, checks output file duration matches input (±1 second). If mismatch: retries once, then flags as `audio_processing_failed`.
  * **Upload:** Uploads the file to S3 under `user_voice/{interview_id}/candidate_voice.ogg`. Updates the interview record (`voice_ogg_url`, `status="recording_ready"`).

### BB5: Interview Analysis (audio-worker)
* **Flow:** Input is candidate `.ogg` voice recording + transcript + job's VIC and BC criteria.
  * **Branch A (VIC):** GPT-4o-mini grades candidate transcript against VIC technical criteria, saving outputs to `vic_scores`.
  * **Branch B (BC):** Calls smallest.ai STT API to extract speech rate (WPM), filler word count, and hesitation/pause metrics. GPT-4o-mini tone analysis evaluates vocal parameters against Job's BC guidelines. Saves results to `bc_scores`.

### BB6: Final Report (ai-worker)
* **Flow:** Aggregates scores using formula: `overall_score = (match_score * 0.40) + (vic_score * 0.35) + (bc_score * 0.25)`.
* **Verdict mapping:** 90-100=Strong Hire, 75-89=Hire, 60-74=Hold, 45-59=Needs Review, 0-44=Reject.
* **Report Generation:** Compiles a professional PDF report using ReportLab, uploads it to S3 under `reports/{candidate_id}.pdf`, updates the candidate record (`overall_score`, `ai_verdict`, `report_pdf_url`, `status="completed"`), and broadcasts `analysis_complete` SSE event.

---

## 7. Database Schema

### Table: `jobs`
* `id` UUID (PK)
* `title` VARCHAR(255)
* `department` VARCHAR(100)
* `jd` TEXT
* `rvc` TEXT
* `vic` TEXT
* `bc` TEXT
* `rubric_json` JSONB (Structured scoring criteria rules)
* `status` VARCHAR(20) (open, closed)
* `created_at` TIMESTAMP

### Table: `candidates`
* `id` UUID (PK)
* `job_id` UUID (FK -> jobs.id CASCADE DELETE)
* `name` VARCHAR(255) DEFAULT 'Unknown (Parse Failed)'
* `email` VARCHAR(255)
* `phone` VARCHAR(20)
* `location` VARCHAR(100)
* `skills` JSONB
* `experience_years` INTEGER
* `education` JSONB
* `resume_url` VARCHAR(500)
* `raw_json` JSONB
* `clean_json` JSONB
* `parse_error_log` TEXT
* `match_score` DECIMAL(5,2)
* `match_breakdown` JSONB
* `ai_recommendation` VARCHAR(50)
* `overall_score` DECIMAL(5,2)
* `ai_verdict` VARCHAR(50)
* `report_pdf_url` VARCHAR(500)
* `status` VARCHAR(50) (uploaded, parsing, structured, scored, new, shortlisted, rejected, interview_invited, interview_scheduled, interview_ongoing, interview_completed, final_evaluation, hired, rejected_post_interview)
* `latest_interview_id` UUID (FK -> interviews.id ON DELETE SET NULL)
* `latest_invite_token` UUID (stores most recent invite for quick HR view)
* `created_at` TIMESTAMP
* `updated_at` TIMESTAMP

### Table: `interviews`
* `id` UUID (PK)
* `candidate_id` UUID (FK -> candidates.id CASCADE DELETE)
* `job_id` UUID (FK -> jobs.id)
* `invite_token` UUID (UNIQUE)
* `invite_expires_at` TIMESTAMP
* `room_id` VARCHAR(100)
* `room_url` VARCHAR(500)
* `token` VARCHAR(500) (LiveKit join token)
* `status` VARCHAR(50) (scheduled, ongoing, reconnecting, completed, cancelled, failed)
  * `scheduled`: invite sent, room not created
  * `ongoing`: candidate in room, interview active
  * `reconnecting`: candidate disconnected, room alive (within 10-min window)
  * `completed`: normal end
  * `cancelled`: HR cancelled
  * `failed`: room expired, candidate never joined, or safety net closed
* `recording_url` VARCHAR(500) (LiveKit cloud MP4 URL)
* `voice_ogg_url` VARCHAR(500) (S3 candidate voice path)
* `transcript` TEXT
* `transcript_json` JSONB
* `vic_scores` JSONB
* `bc_scores` JSONB
* `overall_score` DECIMAL(5,2)
* `ai_verdict` VARCHAR(50)
* `scheduled_at` TIMESTAMP
* `started_at` TIMESTAMP
* `completed_at` TIMESTAMP

### Table: `notes`
* `id` UUID (PK)
* `candidate_id` UUID (FK -> candidates.id)
* `job_id` UUID (FK -> jobs.id)
* `hr_user_id` UUID
* `text` TEXT
* `created_at` TIMESTAMP

---

## 8. API Endpoints

### Job Management
* `POST /api/jobs` - Create job (converts RVC text -> rubric_json via GPT-4o-mini)
* `GET /api/jobs?status=open|closed` - List jobs
* `GET /api/jobs/{id}` - Get job
* `PATCH /api/jobs/{id}/close` - Close job
* `PATCH /api/jobs/{id}/reopen` - Reopen job
* `DELETE /api/jobs/{id}` - Delete job

### Candidate Management
* `POST /api/candidates/upload` - Multipart upload, triggers BB1
* `GET /api/candidates?jobId={id}&status={filter}&sort={field}` - List candidate cards. Returns `latest_interview_id` and `latest_invite_token` for each candidate card (no JOIN needed).
* `GET /api/candidates/{id}` - Full profile with match_breakdown
* `PATCH /api/candidates/{id}/status` - Update status (supports transitions to manual_reviewed)
* `POST /api/candidates/{id}/notes` - Add HR evaluation comment
* `GET /api/candidates/{id}/reports` - presigned S3 URL
* `GET /api/candidates/{id}/resume-url` - Generate S3 presigned URL for candidate's resume (available for all states)

### Interview Flow
* `POST /api/interviews/{candidate_id}/invite` - Generates invite_token, stores in Redis with 24h TTL, triggers SendGrid invitation containing tracking link `/interview/{invite_token}`, updates candidate status to `interview_invited`. After creating interview, `UPDATE candidates SET latest_interview_id = new_interview_id, latest_invite_token = new_invite_token`.
* `GET /interview/{invite_token}` - Validates invite token in Redis. Fetches candidate name, job title, company, JD, and VIC details. Serves dynamic `interview_landing.html` template.
* `POST /api/interviews/start` - Validates invite token. Creates LiveKit room on the fly. Generates candidate WebRTC token. Spawns Celery `spawn_agent` task. Inserts interview record, marks invite token as USED, and returns room details.
  
  **Duplicate Prevention Layers:**
  * **Layer 1 — Redis Atomic Token Lock:**
    * POST `/api/interviews/start` uses Redis `SET invite:{token} "used" NX EX 2100`.
    * NX = only set if not exists (atomic, prevents race conditions).
    * If SET returns False (already used): return `409 Conflict`.
    * This prevents two devices from both passing validation in the same millisecond.
  * **Layer 2 — Interview Status Check:**
    * Before creating room, check `interviews.status != "ongoing"`.
    * If status is already "ongoing": return `409 Conflict` (interview already active).
  * **Layer 3 — LiveKit Room Participant Cap:**
    * Room created with `maxParticipants = 2` (agent + candidate only).
    * If somehow bypassed Layer 1+2, LiveKit rejects third connection.
* `POST /api/interviews/{id}/end` - Command LiveKit Cloud to close the room.
* `GET /api/interviews/{id}/transcript` - Fetch transcript details.
* `GET /api/interviews/{id}/audio` - presigned S3 URL for candidate voice.

### Real-Time Update Streams (SSE only)
* `GET /api/sse/uploads/{uploadId}`
* `GET /api/sse/jobs/{jobId}/candidates`
* `GET /api/sse/analysis/{interviewId}`

### Webhook Listeners
* `POST /api/webhooks/livekit/room-closed` - Webhook receiver, validates JWT, triggers BB4.
* `POST /api/webhooks/email/delivered` - SendGrid delivery logger.
* `POST /api/webhooks/email/bounced` - SendGrid bounce logger.

### Rate Limiting Rules
Public endpoints (no auth required):
* `GET /interview/{invite_token}`: 10 requests per IP per minute
* `POST /api/interviews/start`: 5 requests per IP per minute
* `POST /api/candidates/upload`: 50 requests per IP per day (matches `DAILY_RESUME_LIMIT`)

Authenticated endpoints:
* `POST /api/jobs`: 20 per minute per user
* `POST /api/interviews/{candidate_id}/invite`: 10 per minute per user
* `GET /api/sse/*`: 5 concurrent connections per user

Implementation:
* Use `slowapi` (FastAPI rate limiter) with Redis backend.
* Key format: `ratelimit:{endpoint}:{client_ip}`.
* On exceed: return `429 Too Many Requests` with `Retry-After` header.
* Exempt: webhooks (`/api/webhooks/*`) — they use JWT signature validation instead.

---

## 9. Interview Timer & AI Agent Logic
The AI voice agent conducts the interview inside the LiveKit room, tracking elapsed time:
* **0-25 mins:** Conducting normal question flow based on resume and job VIC guidelines.
* **25 mins:** Agent states: *"We have about 5 minutes remaining. Let's wrap up with our final areas."*
* **28 mins:** Agent states: *"One final question for you before we conclude."* (quick-response question)
* **30 mins:** Agent says: *"Thank you. That concludes our interview today. Goodbye."*, submits `POST /api/interviews/{id}/end` to the gateway, and disconnects.

### Safety Nets
* **LiveKit Room Expiry:** Hard-limited to 35 minutes (LiveKit cloud force-closes).
* **Celery Safety Daemon:** Runs every 30 minutes, auditing ongoing interviews active > 40 minutes. Calls LiveKit API to close the room, downloads partial audio, and triggers BB4.

### Agent Memory Architecture
* The LiveKit AI agent (`livekit_agent.py`) is a Python script connecting to LiveKit Cloud.
* When Celery dispatches the agent task, it passes ONLY: `candidate_id`, `job_id`, `room_id`.
* The agent queries PostgreSQL DIRECTLY at startup (before joining room):
  * `SELECT clean_json FROM candidates WHERE id = :candidate_id`
  * `SELECT jd, vic, bc FROM jobs WHERE id = :job_id`
* The agent builds its `system_prompt` from DB data in memory.
* Heavy data (resume JSON, job criteria) NEVER travels over HTTP or Redis.
* Only 36-character UUIDs pass between API → Celery → Agent.
* The agent connects to PostgreSQL using the same `DATABASE_URL` as the API.

### Reconnection Flow & State Transitions
* **ongoing → reconnecting:** LiveKit fires `participant_disconnected` event. This updates `interviews.status` to `reconnecting`.
* **reconnecting → ongoing:** Candidate rejoins within 10 min.
* **reconnecting → failed:** 10 min passes, room expires, candidate never rejoined, or safety net closed.
* **reconnecting → completed:** Agent ends interview before reconnect (rare).

**Agent behavior on reconnect/disconnect:**
* When status = "reconnecting", agent pauses question timer.
* Agent monitors room for `participant_connected` event.
* If reconnect: resume from last question.
  * If disconnect < 30 seconds: continue seamlessly, no acknowledgment.
  * If disconnect > 30 seconds: *"Welcome back. Let's continue — you were explaining..."*
* If 10-minute grace window timeout: agent exits, status → `failed`.
* Agent retains full `conversation_history` in process memory.

### Redis Room Tracking
* When `POST /api/interviews/start` creates room:
  ```
  SET room:{room_id}:created_at {timestamp} EX 2100  # 35 min TTL
  SET room:{room_id}:candidate_id {candidate_id} EX 2100
  SET room:{room_id}:interview_id {interview_id} EX 2100
  ```
* When candidate disconnects:
  ```
  SET room:{room_id}:disconnect_time {timestamp} EX 600  # 10 min grace
  ```
* On reconnect attempt:
  1. Check Redis `GET room:{room_id}:created_at` (1ms, no LiveKit API call).
  2. If exists and not expired: allow reconnect to SAME room.
  3. If missing or expired: call LiveKit API to verify, then decide.
* On room close (webhook or agent end):
  ```
  DEL room:{room_id}:created_at room:{room_id}:disconnect_time room:{room_id}:candidate_id room:{room_id}:interview_id
  ```

---

## 10. Cost Controls & Audit Logs
* **OpenAI budget rules:** Limit spending, using `gpt-4o-mini` for parsing/scoring. `gpt-4o` is reserved for live voice processing and deterministic weight generation (seed=42).
* **Upload Limits:** Max 50 resume uploads/day per HR manager.
* **Audit Trail:** Every database write must log timestamped updates. All external APIs must implement exponential backoff retry policies.

---

## 11. Anti-Cheat Detection
The system implements a multi-layered integrity verification model:

* **Layer 1 — Tab Close Detection:**
  * Browser fires `beforeunload` event → logs `tab_intentionally_closed` with timestamp.
  * LiveKit reports disconnect reason: `CLIENT_INITIATED` vs `NETWORK_ERROR`.
  * Both stored in `interview_events` table.
* **Layer 2 — Offline Duration Flagging:**
  * On reconnect, calculate: `offline_duration = reconnect_time - disconnect_time`.
  * If `disconnect_reason = CLIENT_INITIATED` AND `offline_duration > 90 seconds`:
    * Flag as `SUSPICIOUS_RECONNECT` in `interview_events`.
    * Store: `{offline_ms, disconnect_reason, question_at_disconnect}`.
* **Layer 3 — Agent Follow-Up Pivot:**
  * On reconnect after suspicious disconnect (>90s, `CLIENT_INITIATED`):
    * Agent does NOT repeat the last question.
    * Instead asks unpredictable follow-up based on candidate's previous answer.
    * Example: *"Before we continue, you mentioned X. How would you handle that under 10x load?"*
    * This cannot be pre-Googled because it depends on their own prior response.
* **Layer 4 — Tab Visibility API:**
  * Browser `visibilitychange` event detects tab switching mid-interview.
  * Logs: `focus_lost` (timestamp), `focus_restored` (timestamp), duration.
  * Stored in `interview_events` table.
  * Appears in recruiter's final report as *"Tab focus lost N times, avg X seconds"*.
* **Layer 5 — Speech Pattern Analysis:**
  * `smallest.ai` STT provides: WPM, `filler_word_count`, `hesitation_timestamps`.
  * Post-interview, GPT-4o-mini behavioral analysis flags anomalies:
    * Unnaturally consistent pace (recited answer vs thinking).
    * Zero hesitation after long offline period.
    * Absence of filler words ("um", "uh") vs baseline.
  * Flag stored in `bc_scores.integrity_flag`: true/false.
  * Rationale stored in `bc_scores.integrity_rationale`: "string".

### Recruiter Report Integrity Section
* Panel 3 → Interview tab → "Interview Integrity Events" subsection.
* Displays timeline: disconnects, tab switches, offline durations, speech anomalies.
* Does NOT affect `overall_score` — purely informational for HR review.
* HR can click `[Flag for Review]` if integrity events are concerning.

---

## 12. Data Flow Security Architecture
* Heavy data (such as parsed resume JSON, job criteria, and raw text transcripts) NEVER travels over the HTTP/Redis wire between services.
* Only lightweight 36-character UUIDs (`candidate_id`, `job_id`, `interview_id`, `room_id`) are permitted to pass over the wire between the API gateway, Celery broker, and background workers/agents.
* Background Celery workers and LiveKit agents must read heavy payload files (resumes, audio recordings) directly from S3/MinIO and query PostgreSQL metadata tables directly using the `candidate_id`/`job_id`/`interview_id` as lookup keys.
* This ensures minimal memory footprint on the queue broker, eliminates HTTP transit overhead, and secures sensitive candidate details within Postgres/S3 boundaries.

---

## 13. Agent Process Lifecycle

The LiveKit agent (`livekit_agent.py`) follows a strictly managed execution lifecycle to handle session setups, active dialog, unexpected disconnects, and clean exits:

### 13.1 START Phase
* **Celery Dispatch:** The worker receives a `spawn_agent` task with only: `candidate_id`, `job_id`, and `room_id`.
* **Database Connection:** The agent process starts and establishes a direct connection to the PostgreSQL database.
* **Context Fetching:** It queries PostgreSQL directly using SQL parameter binding to fetch the candidate's structured profile (`clean_json`) and the job description details (`jd`, `vic`, `bc`).
* **Prompt Assembly:** In-memory, the agent constructs the personalized `system_prompt` outlining criteria directives.
* **Join Attempt:** The agent connects to the LiveKit room using `ctx.connect()`.
* **Initial State:** The agent status is set to `WAITING` (room is empty, awaiting candidate connection).

### 13.2 RUN Phase
* **Candidate Join Event:** Once the candidate joins the WebRTC room, the agent transitions status to `INTERVIEWING` and starts the conversational question timer.
* **Interview Loop:** The agent conducts the interview sequentially, evaluating candidate answers against the VIC guidelines. The agent maintains the complete `conversation_history` list in-process memory.
* **Disconnection Event:** On `participant_disconnected`, the agent transitions status to `RECONNECTING` and pauses the question timer.
* **Reconnection Event:** On `participant_connected` (within the 10-minute timeout window), the agent transitions status back to `INTERVIEWING` and resumes the timer.

### 13.3 NORMAL END Phase
* **Conclusion:** Upon reaching the 30-minute mark, the agent says goodbye and initiates the ending sequence.
* **Session Close:** Submits a `POST /api/interviews/{id}/end` API call to the gateway.
* **Transcript Save:** Persists the complete text transcript to the `interviews` database table.
* **Clean Termination:** The agent exits with code `0` (success). Celery marks the worker task as `SUCCESS`.

### 13.4 ABNORMAL END Phase
* **Room Crash:** If LiveKit room crashes or network connection fails catastrophically, the agent catches the exception, saves the partial transcript to PostgreSQL, and exits with code `1`.
* **Safety Timeout:** If the interview continues past 40 minutes, the Celery safety watchdog daemon forcibly terminates the agent process and saves the partial transcript.
* **Candidate No-Show:** If the candidate fails to join within 10 minutes, the agent exits with code `2` and updates status to `failed`.

### 13.5 MONITORING Phase
* **Heartbeat Logger:** Every 30 seconds, the agent updates Redis key `room:{room_id}:last_heartbeat` with the current epoch timestamp.
* **Watchdog Check:** If the heartbeat timestamp is missing or stale > 2 minutes, the Celery daemon assumes the agent process has died and spawns a replacement agent task.
