# TalentStream HR Platform: Detailed Implementation Specification v1.0

This document serves as the master implementation specification for building the TalentStream HR Platform. It outlines the container setup, database schemas, processing pipelines, API routers, real-time channels, session timers, and cheating prevention strategies in maximum operational detail.

---

## SECTION 1: PROJECT IDENTITY & TARGET SCALE
TalentStream is an automated recruitment workflow system. It processes incoming resumes, extracts structured candidate details, performs matching checks, and schedules and monitors real-time voice interviews.
* **Target Scale:** 250–300 resume uploads per day.
* **HR Manager Concurrency:** 1–2 concurrent active recruiters.
* **Core Operating Model:** High-efficiency, automated background processing with manual review gates for parsing failures.
* **Secret Management:** All connection strings and API credentials must be loaded at runtime from environment variables. No secrets are stored in the code.

---

## SECTION 2: THE FOUR CRITERIA SYSTEM
Every job created defines four evaluation parameters, frozen upon creation:
1. **Job Description (JD):** Plain text detailing the job role, duties, and preferences.
2. **Resume Verification Criteria (RVC):** Plain text parsed by `gpt-4o-mini` on job creation into a structured `rubric_json` model.
3. **Voice Interview Criteria (VIC):** Technical categories and target guidelines used for grading the live interview.
4. **Behavioral Criteria (BC):** Target behavioral parameters (speech rate, confidence, pause occurrences, filler counts) used for acoustic analysis.

---

## SECTION 3: 5-CONTAINER TOPOLOGY
The system is built on a 5-container architecture configured in `docker-compose.yml`:
1. **api (FastAPI, Port 8000):** Serves static frontend files, hosts dynamic Jinja2 templates, processes REST API endpoints, handles SSE streams, and processes webhooks.
2. **ai-worker (Celery):** Process tasks for BB2 (resume parsing & structuring), BB3 (scoring & match checks), and BB6 (weighted report generation).
3. **audio-worker (Celery):** Process tasks for BB4 (FFmpeg channel separation) and BB5 (STT + behavioral evaluation).
4. **db (PostgreSQL, Port 5432):** Database backend storing jobs, candidates, interviews, and notes.
5. **redis (Port 6379):** Celery queue broker, SSE message broker, and invite token lifecycle manager.

---

## SECTION 4: THE 6 BLACK BOXES PIPELINE

### Black Box 1: Ingest & Storage
* **Endpoint:** `POST /api/candidates/upload`
* **Flow:** Gateway accepts file upload (< 10MB) -> Streams to S3 under `resumes/{job_id}/{candidate_id}/resume.pdf` -> Inserts row in `candidates` table (`status="uploaded"`, `resume_url=S3 Path`) -> Enqueues Celery task `tasks.parse_resume` -> Dispatches `upload_progress` SSE event.

### Black Box 2: Parse & Structure (ai-worker)
* **BB2-A (LlamaParse Agentic):** Downloads file from S3 -> Calls LlamaParse Cloud API in agentic mode. If failed, retries once in cost-effective mode. On persistent failure (corrupt file, encryption, unsupported format, or S3/API timeout), transitions candidate status to `failed` and writes traceback to `parse_error_log`.
* **BB2-B (GPT-4o-mini Formatter):** Sends Markdown output to GPT-4o-mini (temperature=0, seed=42, response_format={"type":"json_object"}) to extract structured JSON.
* **BB2-C (Pydantic Validator):** Validates payload against CandidateSchema. Up to 3 progressive attempts on validation failures:
  * Attempt 1: Base prompt, temperature=0.
  * Attempt 2: Base prompt + explicit examples, temperature=0.
  * Attempt 3: Stricter prompt + examples, temperature=0.
  If all attempts fail, sets status to `unable_to_process` and publishes a `parse_failed` SSE event. On success, transitions candidate `status="structured"` and writes to `clean_json`.

### Black Box 3: Score & Match (ai-worker)
* **Step 1 (Bias Strip):** Strips `name`, `email`, `phone`, `location`, graduation year, and university names. Replaces them with anonymous tokens (`anon_id`, `years_since_degree`, `degree_level`).
* **Step 2 (Score):** Sends bias-stripped JSON and job `rubric_json` to GPT-4o-mini (temperature=0, seed=42, structured output) returning sub-scores (skills max 40, experience max 30, education max 20, certs max 10), `total_score`, `recommendation`, and `rationale`.
* **Step 3 (Validate):** Verifies `total_score` is an integer (0-100) and recommendation is in enum. Retries once on failure, then flags candidate status as `manual_review`.
* **Step 4 (Store):** Updates `match_score`, `match_breakdown`, `ai_recommendation` in candidate record, sets status to `new`, and broadcasts the `candidate_ready` SSE event.

### Black Box 4: Audio Processing (audio-worker)
* **Trigger:** LiveKit Webhook callback `/api/webhooks/livekit/room-closed`.
* **Flow:** Audio Worker downloads mixed room MP4 from LiveKit -> Runs FFmpeg to separate channels:
  ```bash
  ffmpeg -i mixed_input.mp4 \
    -filter_complex '[0:a]channelsplit=channel_layout=stereo[left][right]' \
    -map '[right]' -ac 1 -c:a libopus -b:a 32k candidate_voice.ogg
  ```
  * Discards agent track (left channel), extracts candidate track (right channel), and compresses candidate track to mono `.ogg` (Opus codec, 32kbps).
  * **Validation:** After FFmpeg, checks output file duration matches input (±1 second). If mismatch: retries once, then flags as `audio_processing_failed`.
  * **Upload:** Uploads `.ogg` to S3 under `user_voice/{interview_id}/candidate_voice.ogg` -> Updates interview record (`voice_ogg_url`, `status="recording_ready"`).

### Black Box 5: Interview Analysis (audio-worker)
* **Branch A (VIC):** Transcript text is sent to GPT-4o-mini to grade candidate answers against technical VIC guidelines. Saves outputs to `vic_scores`.
* **Branch B (BC):** Candidate `.ogg` file is analyzed by smallest.ai STT to extract speech rate (WPM), filler word count (um, uh, like), and hesitation/pause metrics. GPT-4o-mini tone analysis evaluates vocal parameters against BC guidelines. Saves results to `bc_scores`.

### Black Box 6: Final Report (ai-worker)
* **Flow:**
  * **Weighting:** `overall_score = (match_score * 0.40) + (vic_score * 0.35) + (bc_score * 0.25)`.
  * **Verdict mapping:** 90-100=Strong Hire, 75-89=Hire, 60-74=Hold, 45-59=Needs Review, 0-44=Reject.
  * **Report PDF:** Compiles ReportLab PDF containing evaluation summaries, metrics, and radar charts. Uploads report to S3 under `reports/{candidate_id}.pdf`, updates candidate (`overall_score`, `ai_verdict`, `report_pdf_url`, `status="completed"`), and broadcasts `analysis_complete` SSE event.

---

## SECTION 5: DATABASE SCHEMA & MIGRATIONS

### Table: `jobs`
* `id` UUID PRIMARY KEY DEFAULT uuid_generate_v4()
* `title` VARCHAR(255) NOT NULL
* `department` VARCHAR(100) NOT NULL
* `jd` TEXT NOT NULL
* `rvc` TEXT NOT NULL
* `vic` TEXT NOT NULL
* `bc` TEXT NOT NULL
* `rubric_json` JSONB
* `status` VARCHAR(20) DEFAULT 'open'
* `created_at` TIMESTAMP DEFAULT NOW()

### Table: `candidates`
* `id` UUID PRIMARY KEY DEFAULT uuid_generate_v4()
* `job_id` UUID REFERENCES jobs(id) ON DELETE CASCADE
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
* `status` VARCHAR(50) -- uploaded, parsing, structured, scored, new, shortlisted, rejected, interview_invited, interview_scheduled, interview_ongoing, interview_completed, final_evaluation, hired, rejected_post_interview
* `latest_interview_id` UUID (FK -> interviews.id ON DELETE SET NULL)
* `latest_invite_token` UUID (stores most recent invite for quick HR view)
* `created_at` TIMESTAMP DEFAULT NOW()
* `updated_at` TIMESTAMP DEFAULT NOW()

### Table: `interviews`
* `id` UUID PRIMARY KEY DEFAULT uuid_generate_v4()
* `candidate_id` UUID REFERENCES candidates(id) ON DELETE CASCADE
* `job_id` UUID REFERENCES jobs(id) ON DELETE CASCADE
* `invite_token` UUID UNIQUE
* `invite_expires_at` TIMESTAMP
* `room_id` VARCHAR(100)
* `room_url` VARCHAR(500)
* `token` VARCHAR(500)
* `status` VARCHAR(50) DEFAULT 'scheduled' -- scheduled, ongoing, reconnecting, completed, cancelled, failed
* `recording_url` VARCHAR(500)
* `voice_ogg_url` VARCHAR(500)
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
* `id` UUID PRIMARY KEY DEFAULT uuid_generate_v4()
* `candidate_id` UUID REFERENCES candidates(id) ON DELETE CASCADE
* `job_id` UUID REFERENCES jobs(id) ON DELETE CASCADE
* `hr_user_id` UUID
* `text` TEXT NOT NULL
* `created_at` TIMESTAMP DEFAULT NOW()

### Table: `interview_events`
* `id` UUID PRIMARY KEY DEFAULT uuid_generate_v4()
* `interview_id` UUID REFERENCES interviews(id) ON DELETE CASCADE
* `event_type` VARCHAR(50) NOT NULL -- tab_intentionally_closed, disconnect, reconnect, suspicious_reconnect, focus_lost, focus_restored
* `disconnect_reason` VARCHAR(50) -- CLIENT_INITIATED, NETWORK_ERROR, etc.
* `duration_ms` INTEGER
* `question_at_event` TEXT
* `created_at` TIMESTAMP DEFAULT NOW()

---

## SECTION 6: API ENDPOINTS SPECIFICATION

### 6.1 Job Management
* `POST /api/jobs` - Create a job. Calls GPT-4o-mini to convert RVC text -> rubric_json, saves database row.
* `GET /api/jobs?status=open|closed` - List jobs.
* `GET /api/jobs/{id}` - Fetch job details.
* `PATCH /api/jobs/{id}/close` - Update job status to 'closed'.
* `PATCH /api/jobs/{id}/reopen` - Update job status to 'open'.
* `DELETE /api/jobs/{id}` - Cascade delete all associated candidate files and database records.

### 6.2 Candidate Management
* `POST /api/candidates/upload` - Stream multipart resume PDF to S3, returns `uploadId`.
* `GET /api/candidates?jobId={id}&status={filter}&sort={field}` - List candidate cards. Returns `latest_interview_id` and `latest_invite_token` for each candidate card (no JOIN needed).
* `GET /api/candidates/{id}` - Fetch candidate details.
* `PATCH /api/candidates/{id}/status` - Modify status field (supports transitions to manual_reviewed).
* `POST /api/candidates/{id}/notes` - Add recruiter comment note.
* `GET /api/candidates/{id}/reports` - Return presigned S3 URL of the generated evaluation PDF.
* `GET /api/candidates/{id}/resume-url` - Generate S3 presigned URL for candidate's resume (available for all states).

### 6.3 Interview & Reconnection Actions
* `POST /api/interviews/{candidate_id}/invite` - Generates invite UUID token, stores in Redis with 24h TTL, dispatches SendGrid invitation containing link `/interview/{invite_token}`, updates candidate status to `interview_invited`. After creating interview, updates candidate table: `UPDATE candidates SET latest_interview_id = new_interview_id, latest_invite_token = new_invite_token`.
* `GET /interview/{invite_token}` - Validates invite token in Redis. Fetches candidate name, job title, company, JD, and VIC details. Serves dynamic `interview_landing.html` template.
* `POST /api/interviews/start` - Validates invite token.
  
  **Duplicate Prevention Layers:**
  * **Layer 1 — Redis Atomic Token Lock:**
    * POST `/api/interviews/start` uses Redis `SET invite:{token} "used" NX EX 2100`.
    * NX = only set if not exists (atomic, prevents race conditions).
    * If SET returns False (already used): return `409 Conflict`.
    * This prevents two devices from both passing validation in the same millisecond.
  * **Layer 2 — Interview Status Check:**
    * Before creating room, check `interviews.status != "ongoing"`.
    * If status is already "ongoing": proceed to Reconnection checks below.
  * **Layer 3 — LiveKit Room Participant Cap:**
    * Room created with `maxParticipants = 2` (agent + candidate only).
    * If somehow bypassed Layer 1+2, LiveKit rejects third connection.

  **Reconnection Check:**
  * If the candidate disconnects and clicks start again, and the system verifies:
    * `invite_token` status = "used"
    * `interviews.status` = "ongoing" or "reconnecting"
    * LiveKit room still exists (not expired)
  * Return SAME `room_url` + SAME connection `token` to reconnect the candidate.
  * If room expired (empty > 10 min): mark interview as "failed", return `410 Gone`.

* `POST /api/interviews/{id}/end` - Command LiveKit to close the room.
* `GET /api/interviews/{id}/transcript` - Fetch conversation transcripts.
* `GET /api/interviews/{id}/audio` - presigned S3 URL of the candidate voice track.

### 6.4 Webhooks
* `POST /api/webhooks/livekit/room-closed` - Webhook callback from LiveKit Cloud. Triggers BB4 audio isolation.
* `POST /api/webhooks/email/delivered` - SendGrid delivery status callback.
* `POST /api/webhooks/email/bounced` - SendGrid bounce status callback.

### 6.5 Rate Limiting Rules
* **Public endpoints (no auth required):**
  * `GET /interview/{invite_token}`: 10 requests per IP per minute
  * `POST /api/interviews/start`: 5 requests per IP per minute
  * `POST /api/candidates/upload`: 50 requests per IP per day (matches `DAILY_RESUME_LIMIT`)
* **Authenticated endpoints:**
  * `POST /api/jobs`: 20 per minute per user
  * `POST /api/interviews/{candidate_id}/invite`: 10 per minute per user
  * `GET /api/sse/*`: 5 concurrent connections per user
* **Implementation:** Use `slowapi` (FastAPI rate limiter) with Redis backend using the key format `ratelimit:{endpoint}:{client_ip}`. Return `429 Too Many Requests` on exceed, with a `Retry-After` header. Webhooks (`/api/webhooks/*`) are exempt and rely on JWT signature verification.

---

## SECTION 7: INTERVIEW SESSION LIFECYCLE & TIMERS
The AI agent conducts the interview inside the LiveKit room, tracking elapsed duration:
* **0-25 mins:** Conducting normal question flow based on resume and job VIC guidelines.
* **25 mins:** Agent states: *"We have about 5 minutes remaining. Let's wrap up with our final areas."*
* **28 mins:** Agent states: *"One final question for you before we conclude."* (quick-response question)
* **30 mins:** Agent says: *"Thank you. That concludes our interview today. Goodbye."*, submits `POST /api/interviews/{id}/end` to the gateway, and disconnects.
* **35 mins:** LiveKit Room hard limit.
* **Celery Safety Daemon:** Periodic task runs every 30 minutes, auditing ongoing interviews active > 40 minutes. Calls LiveKit API to close the room, downloads partial audio, and triggers BB4.

### Candidate Reconnection Flow & State Transitions
* Candidate disconnects → LiveKit fires `participant_disconnected` event. This updates `interviews.status` to `reconnecting`.
* When status = "reconnecting", agent pauses the question timer, logs `disconnect_timestamp`, and preserves `conversation_history` in process memory.
* Room stays active for a 10-minute grace period (`empty_timeout`).
* If candidate re-connects (updates status to `ongoing`):
  * **Disconnect < 30 seconds:** Continue conversation seamlessly without acknowledgment.
  * **Disconnect > 30 seconds:** *"Welcome back. Let's continue — you were explaining..."* (Agent resumes timer and continues dialog from the last question).
* If candidate fails to return in 10 minutes, the room closes, interview status transitions to `failed`, the agent exits, and BB4 is skipped.

### Redis Room Tracking
* When starting an interview, the system tracks room creation and connections in Redis:
  * `SET room:{room_id}:created_at {timestamp} EX 2100`  # 35 min TTL
  * `SET room:{room_id}:candidate_id {candidate_id} EX 2100`
  * `SET room:{room_id}:interview_id {interview_id} EX 2100`
* On disconnect: `SET room:{room_id}:disconnect_time {timestamp} EX 600`  # 10 min grace period TTL
* On reconnect: Check Redis `GET room:{room_id}:created_at`. If exists, allow reconnect immediately (1ms check).
* On room end: `DEL room:{room_id}:created_at room:{room_id}:disconnect_time room:{room_id}:candidate_id room:{room_id}:interview_id`

---

## SECTION 8: AGENT MEMORY & DATA BOUNDARY
* The LiveKit AI agent (`livekit_agent.py`) is a Python process connecting to LiveKit Cloud.
* When Celery dispatches the agent task, it passes ONLY: `candidate_id`, `job_id`, `room_id`.
* The agent queries PostgreSQL DIRECTLY at startup (before joining room) using the same `DATABASE_URL` as the API:
  * `SELECT clean_json FROM candidates WHERE id = :candidate_id`
  * `SELECT jd, vic, bc FROM jobs WHERE id = :job_id`
* The agent builds its `system_prompt` from DB data in memory.
* Heavy data (resume JSON, job criteria) NEVER travels over HTTP or Redis.
* Only 36-character UUIDs pass between API → Celery → Agent.

### SECTION 8.1: AGENT PROCESS LIFECYCLE
The LiveKit agent (`livekit_agent.py`) follows a strictly managed execution lifecycle to handle session setups, active dialog, unexpected disconnects, and clean exits:
* **START:** Worker receives `spawn_agent` task with only: `candidate_id`, `job_id`, and `room_id`. Agent process starts and establishes a direct connection to the PostgreSQL database. Queries PostgreSQL directly using SQL parameter binding to fetch the candidate's structured profile (`clean_json`) and job description details (`jd`, `vic`, `bc`). In-memory, the agent constructs the personalized `system_prompt` outlining criteria directives. Connects to LiveKit room via `ctx.connect()`. Status set to `WAITING`.
* **RUN:** Candidate joins. Status transitions to `INTERVIEWING` and conversational timer starts. If disconnect happens, status transitions to `RECONNECTING` and timer pauses. If reconnect within 10 minutes, status transitions back to `INTERVIEWING` and timer resumes.
* **NORMAL END:** At 30 minutes, agent says goodbye, calls `POST /api/interviews/{id}/end` to gateway, persists transcript to PostgreSQL, and exits with code `0`.
* **ABNORMAL END:** On crash, saves partial transcript, exits with code `1`. Safety daemon watchdog kills at >40 mins. If candidate no-show for 10 minutes, exits with code `2` (status → `failed`).
* **MONITORING:** Heartbeat updated every 30 seconds to `room:{room_id}:last_heartbeat`. Watchdog restarts agent if heartbeat stale > 2 minutes.

---

## SECTION 9: ANTI-CHEAT DETECTION (5 LAYERS)

* **Layer 1 — Tab Close Detection:**
  * Browser fires `beforeunload` event → logs `tab_intentionally_closed` with timestamp.
  * LiveKit reports disconnect reason: `CLIENT_INITIATED` vs `NETWORK_ERROR`.
  * Both stored in `interview_events` table.
* **Layer 2 — Offline Duration Flagging:**
  * On reconnect, calculate: `offline_duration = reconnect_time - disconnect_time`.
  * If `disconnect_reason = CLIENT_INITIATED` AND `offline_duration > 90 seconds`:
    * Flag as `SUSPICIOUS_RECONNECT` in `interview_events` table.
    * Store: `{offline_ms, disconnect_reason, question_at_disconnect}`.
* **Layer 3 — Agent Follow-Up Pivot:**
  * On reconnect after suspicious disconnect (>90s, `CLIENT_INITIATED`):
    * Agent does NOT repeat the last question.
    * Instead asks unpredictable follow-up based on candidate's previous answer.
    * Example: *"Before we continue, you mentioned X. How would you handle that under 10x load?"* (Prevents pre-Googling).
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
  * Flag stored in `bc_scores.integrity_flag` (true/false) and rationale stored in `bc_scores.integrity_rationale` (string).

### Recruiter Report Integrity Section
* Panel 3 → Interview tab → "Interview Integrity Events" subsection.
* Displays timeline: disconnects, tab switches, offline durations, speech anomalies.
* Does NOT affect `overall_score` — purely informational for HR review.
* HR can click `[Flag for Review]` if integrity events are concerning.

---

## SECTION 10: COST CONTROL & ERROR HANDLING

### Cost Controls
* OpenAI Monthly Budget spending limits set at $50.00.
* `gpt-4o-mini` is used for high-volume parsing and matching.
* `gpt-4o` is reserved for live voice agent processing and job weight-setting (seed=42).
* Upload limits: max 50 resumes/day per recruiter.

### Error Handling Protocols
* **`PDF_DECRYPTION_FAILED`:** In BB2, if PDF is password-protected, candidate `status` is set to `unable_to_process` and `parse_error_log` is populated. Recruiter UI shows orange warning badge. Recruiter can manually review or delete.
* **`OPENAI_API_TIMEOUT`:** If OpenAI API fails to return response within 15 seconds, task retries up to 3 times using exponential backoff. If all fail, candidate status is set to `unable_to_process`.
* **`FFMPEG_CHANNEL_SPLIT_FAILED`:** If FFmpeg fails to isolate candidate track, interview `status` is set to `audio_failed`. Recruiter UI shows warning, and recruiter can click "Retry Audio Processing".
