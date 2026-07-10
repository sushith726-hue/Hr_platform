# TalentStream HR Platform: The Comprehensive Reference Guide (Bhagavad Geetha) v1.1

This document is the master reference guide for the TalentStream HR Platform. It is written as a clear, complete, and detail-rich explanation of the platform's systems, architectural design choices, database schemas, code signatures, configurations, data flows, and exact LLM prompts. 

---

## 1. The Problem We Are Solving

### 1.1 What HR Managers Do Manually Today
In a standard recruitment department, screening candidates is a highly repetitive, manual, ten-step process:
1. **Inbox Triage:** Open the corporate inbox and scan incoming emails for applications.
2. **Download Attachments:** Download resume files in various formats (PDF, DOCX, TXT) one by one.
3. **Manual Skimming:** Skim each resume, looking for key terms (e.g., "Python", "Docker", "AWS").
4. **Data Entry:** Copy-paste the candidate's name, email, phone, location, skills, and history into a tracking spreadsheet.
5. **Initial Assessment:** Grade the resume's match based on memory of the job description.
6. **Scheduling Coordination:** Draft and email scheduling invitations to candidates, managing calendar conflicts back-and-forth.
7. **The Phone Screen:** Conduct a 15-minute voice interview, asking basic technical questions, validating work history, and manually assessing verbal communication.
8. **Note-Taking:** Transcribe candidate responses manually during the live conversation.
9. **Soft Skills Grading:** Score communication parameters (like hesitation, filler word usage, and vocal confidence) based on personal judgment.
10. **Decision Routing:** Manually update the candidate tracking sheet to mark them as hired, rejected, or scheduled for a next-round panel interview.

### 1.2 Why This Manual Process Fails
This manual process is slow, expensive, and inconsistent:
* **Slow:** Reviewing and scheduling 250 resumes can take an HR manager up to 10 hours. Candidates are lost to faster competitors.
* **Expensive:** Manually screening candidates costs $30–$50 per hour in labor. Spending hours on unqualified candidates wastes capital.
* **Inconsistent:** Human evaluations fluctuate based on fatigue. Vocal biases can also cloud objective technical assessments.

### 1.3 How Our Platform Fixes Each Pain Point
TalentStream replaces these manual steps with an automated, objective, AI-driven screening pipeline:

| Manual Step | Platform Fix | Business Benefit |
| :--- | :--- | :--- |
| Hand-reading resumes | Automated text parsing and validation via LlamaParse and OpenAI | Resume screening takes seconds instead of hours |
| Copy-pasting candidate details | Automatic structured JSON parsing into PostgreSQL | Eliminates human data-entry errors |
| Subjective resume grading | Hard matching against Resume Verification Criteria (RVC) rules | Highly consistent, unbiased scoring |
| Scheduling back-and-forth | Dynamic interview-start trigger and Redis-based tracking tokens | No coordination lag, on-demand starts |
| Conducting phone screens | Live voice call with an interactive WebRTC AI Agent | Standardized, 24/7 screen availability |
| Manual call notes & transcripts | Real-time transcription and database storage | Clean, audit-ready data records |
| Guessing soft skills / filler words | Acoustic analysis using smallest.ai and OpenAI tone analysis | Objective vocal and communication metrics |

---

## 2. The Complete System At 10,000 Feet

### 2.1 System Architecture Block Diagram

```
[ Recruiter Browser ] <====== SSE Events ====== [ FastAPI Gateway (Port 8000) ]
        │                                             │               │
  REST API CRUD                                   SQL DB          Task Queue
        │                                             │               │
        ▼                                             ▼               ▼
┌──────────────────┐                           ┌──────────┐     ┌───────────┐
│ Web UI (App)     │                           │Postgres  │     │Redis Cache│
│                  │                           │(Port 5433│     │(Port 6380)│
└──────────────────┘                           └──────────┘     └───────────┘
                                                                   ▲       ▲
                                                                   │       │
                                                               Task│   Task│
                                                                   │       │
                                                                   ▼       ▼
┌──────────────────┐                           ┌──────────┐   ┌──────────────┐
│ Candidate Portal │ <====== WebRTC Audio ======> │LiveKit   │   │Celery Workers│
│ (Web UI Client)  │                           │Cloud     │   │(AI & Audio)  │
└──────────────────┘                           └──────────┘   └──────────────┘
        │                                           │                 │
    Microphone                                   Save MP4             │
        │                                           │                 │
        ▼                                           ▼                 ▼
┌──────────────────┐                           ┌──────────┐   ┌──────────────┐
│ Candidate Device │                           │S3 Bucket │   │OpenAI GPT API│
└──────────────────┘                           └──────────┘   │smallest.ai   │
                                                              │SendGrid SMTP │
                                                              │LlamaParse API│
                                                              └──────────────┘
```

### 2.2 System Component Roles
* **FastAPI Gateway (Port 8000):** Acts as the central Middleware Router. It serves the static HTML/JS frontend assets, the dynamic candidate portal (`/interview/{invite_token}`), validates data payloads using Pydantic, executes database transactions, and manages Server-Sent Events (SSE) push streams.
* **PostgreSQL (Port 5433 on Host, Port 5432 internally in container):** The permanent database. It stores the tables for jobs, candidates, interviews, and recruiter notes.
* **Redis (Port 6380 on Host, Port 6379 internally in container):** The key-value store, Celery broker, and token manager. It routes background task payloads to Celery workers, maintains 24h invitation tokens, and runs the Pub/Sub messaging channel for SSE notifications.
* **Celery AI Worker:** A background task processor. It downloads raw resumes from S3, parses them using LlamaParse in agentic mode, structures the profiles using OpenAI, and matches them against job criteria.
* **Celery Audio Worker:** A background task processor. It uses FFmpeg to separate stereo recording channels, uploads the candidate's track to S3, retrieves transcripts via smallest.ai, and scores candidate vocal behavior.
* **S3 Bucket:** S3-compatible cloud storage bucket. It stores raw PDF resumes, mixed interview MP4 files, split candidate `.ogg` voice recordings, and generated PDF reports.
* **LiveKit Cloud:** WebRTC hosted server. It connects candidate browsers to the AI interviewer agent, transcribes conversation streams in real-time, and records audio sessions.

### 2.3 Traffic Flow Walkthrough: From Resume to Verdict
1. **Upload:** Recruiter selects an active job and uploads a candidate's resume (PDF) through the dashboard. Enforces `job_id` association.
2. **Ingestion (BB1):** FastAPI uploads the file to the `resumes/` S3 bucket and saves a database footprint.
3. **Extraction (BB2):** The AI Worker parses the file via LlamaParse. If parsing fails (unreadable, password-locked, S3 error), candidate status becomes `failed`. If extraction succeeds but fails schema validation, candidate status becomes `unable_to_process`. If both succeed, candidate status becomes `structured`.
4. **Scoring (BB3):** For `structured` profiles (or manually corrected `manual_reviewed` entries), the matching engine strips candidate PII, compares the profile against the job's `rubric_json`, saves a match score (0-100%), and transitions status to `new`.
5. **Invitation:** The recruiter invites the candidate. The system generates an invite token, stores it in Redis with 24h TTL, and emails a link `/interview/{invite_token}` via SendGrid.
6. **Voice Screen:** The candidate clicks the link. When they click "START INTERVIEW", the system creates a LiveKit room, generates WebRTC tokens, spawns the LiveKit AI Agent, and starts the interview.
7. **Webhook Trigger:** When the candidate hangs up or 30 minutes pass, LiveKit saves a mixed MP4 file and triggers the `room-closed` webhook callback.
8. **Audio Separation (BB4):** The Audio Worker downloads the MP4, isolates the candidate's channel using FFmpeg, compresses it to an `.ogg` file, and uploads it to S3.
9. **Analysis (BB5):** The worker scores the candidate's technical skills (VIC) via OpenAI, transcribes the voice via smallest.ai, and grades vocal characteristics (BC) via OpenAI tone analysis.
10. **Report (BB6):** The system calculates a weighted overall score, generates an AI verdict, creates a PDF report, and updates the recruiter's dashboard.

---

## 3. Every External Service (Detailed)

### 3.1 LlamaParse Cloud API
* **What It Is:** An agentic document extraction platform built to parse complex PDF layout elements.
* **The Technical Thing It Does:** Accepts PDF files over HTTPS POST in agentic mode and returns parsed markdown formatting.
* **Exact Role:** Invoked in **Black Box 2-A** to convert raw S3 resume files into parsed text blocks.
* **Failure Handling:** If agentic parsing fails, retries once in cost-effective mode. On persistent failure (unreadable PDF, password-protected, encrypted, S3 failure), the candidate status is set to `failed`. If parsing succeeds but schema formatting validation fails persistently, status is set to `unable_to_process`.

### 3.2 OpenAI GPT-4o-mini & GPT-4o
* **What It Is:** Advanced LLM service. We use `gpt-4o-mini` for high-volume text analysis and `gpt-4o` for the voice agent and final report weights.
* **Exact Role:**
  * `gpt-4o-mini`: Used in **BB2-B** (formatting), **BB3** (criteria matching), and **BB5/6** (behavioral grading and reports).
  * `gpt-4o`: Used in **Phase 5** to run the real-time voice agent and for job criteria weight-setting (seed=42).

### 3.3 LiveKit Cloud
* **What It Is:** Hosted real-time WebRTC infrastructure.
* **Exact Role:** Invoked in **Phase 5** to orchestrate WebRTC rooms and generate recruiter monitoring transcripts.
* **Cost Control:** Hard 35-minute limit on room durations.

### 3.4 smallest.ai STT API
* **What It Is:** Audio processing platform specializing in phonetic alignment and acoustic analysis.
* **Exact Role:** Invoked in **Black Box 5** to calculate speech pacing, pauses, and filler word frequencies.

### 3.5 SendGrid SMTP API
* **What It Is:** A cloud-based email delivery service.
* **Exact Role:** Invoked in **Phase 4** to email candidate invitation links `/interview/{invite_token}`.

---

## 4. The 6 Black Boxes (Extreme Detail)

### 4.1 Black Box 1: Ingest & Storage
* **Purpose:** Accepts resume file uploads, saves them to S3, and creates a database reference.
* **Input:** Multipart form upload containing a file (PDF/DOCX/TXT) and `job_id` UUID.
* **Output:** Candidate database row with an S3 object URL footprint.
* **Internal Steps:**
  1. Recruiter selects a file and submits it to `/api/candidates/upload`.
  2. The gateway validates size < 10MB and streams the file to S3 under `resumes/{job_id}/{candidate_id}/resume.pdf`.
  3. The gateway inserts a candidate row into the database with `status = "uploaded"`, `resume_url = S3 path`.
  4. Triggers `upload_progress` SSE event.

### 4.2 Black Box 2: Parse & Structure (ai-worker)
* **BB2-A (LlamaParse Agentic):** Downloads resume and calls LlamaParse Cloud API in agentic mode. If it fails, retries once in cost-effective mode. On persistent failure (corrupt file, encryption, unsupported format, or API timeout), transitions candidate status to `failed` and writes traceback to `parse_error_log`.
* **BB2-B (GPT-4o-mini Formatter):** Sends LlamaParse Markdown to GPT-4o-mini with temperature=0, seed=42, and `response_format={"type":"json_object"}` to extract structured JSON.
* **BB2-C (Pydantic Validator):** Enforces schema using CandidateSchema. Executes up to 3 progressive attempts on validation failures:
  * Attempt 1: Base prompt, temperature=0.
  * Attempt 2: Base prompt + explicit examples, temperature=0.
  * Attempt 3: Stricter prompt + examples, temperature=0.
  If all attempts fail, transitions candidate `status="unable_to_process"` and sends an SSE alert. On success, transitions candidate `status="structured"` and populates `clean_json`.

**Failure Review & Manual Intervention Workflow:**
If candidate ingestion fails with a `failed` or `unable_to_process` status, a red-dashed border is applied to their candidate card in the UI, indicating a review is required, along with an inline "View Resume" trigger. Clicking the card retrieves a secure presigned S3 URL via `GET /api/candidates/{id}/resume-url` and embeds the candidate's original resume in an iframe within the detail panel's Resume Tab (Panel 3), rendering the exact ingestion error log details. Recruiter can manually review the document and click "Mark as Reviewed" in the footer, which updates the state to `manual_reviewed` via `PATCH /api/candidates/{id}/status` to re-introduce the candidate to the scoring/evaluation pipeline.

### 4.3 Black Box 3: Score & Match (ai-worker)
* **Step 1: Bias Strip:** Removes `name`, `email`, `phone`, `location`, graduation year, and university names. Replaces them with anonymous tokens.
* **Step 2: Score:** Sends bias-stripped profile and `jobs.rubric_json` to GPT-4o-mini (temperature=0, seed=42, structured output) to obtain sub-scores (skills max 40, experience max 30, education max 20, certs max 10), `total_score`, `recommendation`, and `rationale`.
* **Step 3: Validate:** Checks that `total_score` is an integer between 0 and 100, and `recommendation` is one of `strong_hire`, `hire`, `hold`, `manual_review`, or `reject`. If validation fails, retries once, then flags candidate status as `manual_review`.
* **Step 4: Store:** Updates candidate table with `match_score`, `match_breakdown`, and `ai_recommendation`, sets status to `new`, and broadcasts the `candidate_ready` SSE event.

### 4.4 Black Box 4: Audio Processing (audio-worker)
* **Purpose:** Separates candidate track from AI Agent track.
* **Input:** Raw mixed call MP4 recording path from LiveKit.
* **Output:** Candidate mono `.ogg` file saved to S3.
* **Internal Steps:**
  1. Triggered by LiveKit webhook `/api/webhooks/livekit/room-closed` containing the MP4 URL.
  2. Audio Worker downloads the mixed MP4 file.
  3. Worker runs FFmpeg: extracts audio stream, discards Channel 1 (AI Agent), extracts Channel 2 (Candidate) and compresses it to mono `.ogg` (Opus, 32kbps).
  4. Uploads candidate track to S3 under `user_voice/{interview_id}/candidate_voice.ogg` and updates interview record.

### 4.5 Black Box 5: Interview Analysis (audio-worker)
This box performs parallel scoring of Technical (VIC) and Behavioral (BC) dimensions, integrating structured, weight-based calculations in Python when rubrics are present.

* **Branch A (VIC - Technical):**
  * **Structured Weighted Scoring (Job has voice rubrics):** Send the transcript to GPT-4o-mini. The model scores the candidate on a 0-100 scale *for each specific sub-criterion* configured in `rubric_json["vic"]["criteria"]`. After receiving criteria-level scores, the worker performs Python-side weighted aggregation:
    $$\text{VIC Score} = \sum \left( \text{criterion\_score} \times \frac{\text{criterion\_weight}}{100} \right)$$
    This calculation is mathematically precise and verified to sum to 100%.
  * **Legacy Scoring (Fallback):** If no structured criteria are defined, the transcript is sent to the LLM to return a direct overall score from 0-100, along with text rationales.
* **Branch B (BC - Behavioral & Voice Integrity):**
  * Candidate `.ogg` file is analyzed by smallest.ai STT to extract speech rate (WPM), filler word count, and hesitation/pause metrics.
  * **Structured Weighted Scoring (Job has voice rubrics):** Send the transcript and metrics to GPT-4o-mini. The model scores the candidate on a 0-100 scale *for each specific behavioral sub-criterion* configured in `rubric_json["bc"]["criteria"]` and checks for cheat indicators (integrity flagging). The worker performs Python-side weighted aggregation:
    $$\text{BC Score} = \sum \left( \text{criterion\_score} \times \frac{\text{criterion\_weight}}{100} \right)$$
  * **Legacy Scoring (Fallback):** If no structured criteria are defined, the transcript and metrics are sent to the LLM to return a direct overall score from 0-100, checking for cheat indicators.

### 4.6 Black Box 6: Final Report (ai-worker)
* **Flow:**
  * **Weighting:** `overall_score = (match_score * 0.40) + (vic_score * 0.35) + (bc_score * 0.25)`.
  * **AI Verdict:** Maps overall score to recommendation categories:
    * `Strong Hire` (90–100)
    * `Hire` (75–89)
    * `Hold` (60–74)
    * `Needs Review` (45–59)
    * `Reject` (0–44)
  * **Report Generation:** Generates a PDF report using ReportLab, uploads it to S3 under `reports/{candidate_id}.pdf`, updates candidate (`overall_score`, `ai_verdict`, `report_pdf_url`, `status="completed"`), and broadcasts `analysis_complete` SSE event.

---

## 5. The Database (Field-by-Field)

### 5.1 Table: `jobs`
* `id` UUID PRIMARY KEY DEFAULT uuid_generate_v4()
* `title` VARCHAR(255) NOT NULL
* `department` VARCHAR(100) NOT NULL
* `jd` TEXT NOT NULL
* `rvc` TEXT NOT NULL
* `vic` TEXT NOT NULL
* `bc` TEXT NOT NULL
* `rubric_json` JSONB (holds structured nested weights for resume, vic, and bc)
* `status` VARCHAR(20) DEFAULT 'open'
* `created_at` TIMESTAMP DEFAULT NOW()

### 5.2 Table: `candidates`
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
* `status` VARCHAR(50) -- uploaded, parsing, structured, scored, new, shortlisted, rejected, interview_invited, interview_scheduled, interview_ongoing, interview_completed, final_evaluation, hired, rejected_post_interview, failed, unable_to_process, manual_reviewed
* `latest_interview_id` UUID (FK -> interviews.id ON DELETE SET NULL)
* `latest_invite_token` UUID (stores most recent invite for quick HR view)
* `created_at` TIMESTAMP DEFAULT NOW()
* `updated_at` TIMESTAMP DEFAULT NOW()

### 5.3 Table: `interviews`
* `id` UUID PRIMARY KEY DEFAULT uuid_generate_v4()
* `candidate_id` UUID REFERENCES candidates(id) ON DELETE CASCADE
* `job_id` UUID REFERENCES jobs(id) ON DELETE CASCADE
* `invite_token` UUID UNIQUE
* `invite_expires_at` TIMESTAMP
* `room_id` VARCHAR(100)
* `room_url` VARCHAR(500)
* `token` VARCHAR(500)
* `status` VARCHAR(50) DEFAULT 'scheduled' -- 'scheduled', 'ongoing', 'reconnecting', 'completed', 'cancelled', 'failed' (reconnecting status handles 10-min WebRTC grace window)
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

### 5.4 Table: `notes`
* `id` UUID PRIMARY KEY DEFAULT uuid_generate_v4()
* `candidate_id` UUID REFERENCES candidates(id) ON DELETE CASCADE
* `job_id` UUID REFERENCES jobs(id) ON DELETE CASCADE
* `hr_user_id` UUID
* `text` TEXT NOT NULL
* `created_at` TIMESTAMP DEFAULT NOW()

---

## 6. The API Endpoints (Complete)

### 6.1 `POST /api/jobs`
* **Workflow:** Inserts a row in the `jobs` table. Calls `convert_rvc_to_rubric` with `title`, `jd`, `rvc`, `vic`, and `bc` text parameters. Calls GPT-4o-mini to convert text inputs into structured, nested `rubric_json`.

### 6.2 `POST /api/candidates/upload`
* **Workflow:** Saves file to S3, inserts row in `candidates` table (status: `uploaded`), and enqueues parsing task (BB2). Enforces a job association guardrail where a valid `job_id` must be provided in the request payload. If absent, the server rejects the upload request.

### 6.3 `PATCH /api/candidates/{candidate_id}/status`
* **Workflow:** Updates candidate status field. Validates new status against system-allowed values. Enables transitioning unparsed candidates to `manual_reviewed`.

### 6.4 `GET /api/candidates/{candidate_id}/resume-url`
* **Workflow:** Generates a secure, expiring presigned S3 URL for retrieving the candidate's original PDF/DOCX/TXT resume to render inside browser viewframes safely.

### 6.5 `POST /api/interviews/{candidate_id}/invite`
* **Workflow:** Generates `invite_token` UUID, stores in Redis with 24h TTL, emails link `/interview/{invite_token}` via SendGrid, sets candidate status to `interview_invited`. Updates candidate record in PostgreSQL: `latest_interview_id = new_interview_id`, `latest_invite_token = new_invite_token`.

### 6.6 `GET /interview/{invite_token}`
* **Workflow:** Validates invite token. Serves candidate portal dynamic Jinja2 template (`interview_landing.html`) showing candidate name, job title, company, JD, and VIC details.

### 6.7 `POST /api/interviews/start`
* **Workflow:** Validates invite token. Implements three duplicate prevention layers (Redis NX token lock, ongoing status verification, and LiveKit room participant cap). Uses Redis room tracking keys (`room:{room_id}:created_at`, `room:{room_id}:candidate_id`, `room:{room_id}:interview_id`) to verify room status in 1ms. If the session is already active or in `reconnecting` status and WebRTC room remains active within a 10-minute grace window, returns the same WebRTC credentials to reconnect the candidate. If the session has expired (empty > 10m), marks status "failed" and returns 410. Spawns Celery `spawn_agent` task, marks invite token as USED, and returns room credentials.

---

## 7. Real-Time Communication (Deep Dive)

### 7.1 Server-Sent Events (SSE)
* **Client Setup (JavaScript):**
  ```javascript
  const eventSource = new EventSource('/api/sse/uploads/upload-uuid');
  eventSource.onmessage = (event) => {
      const payload = JSON.parse(event.data);
      console.log("Status update received:", payload.status);
  };
  ```

### 7.2 Celery Fallback Safety Net
* **Schedule:** Configured to run every 30 minutes:
* **Execution Logic:**
  1. Query PostgreSQL for interviews in the `ongoing` state that started > 40 minutes ago.
  2. Call LiveKit API to force-close the room.
  3. Download available audio and proceed with BB4 splitting.

---

## 8. The Interview Timer (Frame-by-Frame)
* **00:00 (Start):** Candidate joins the WebRTC room.
* **00:01 - 25:00:** AI Agent conducts the technical screen (VIC).
* **25:00:** Agent warns: *"We have about 5 minutes remaining."*
* **28:00:** Agent warns: *"One final question."* (short VIC prompt).
* **30:00:** Agent says goodbye, calls backend `/end` API, and disconnects.
* **35:00 (Limit):** LiveKit safety net force-closes room if agent crashed.

### 8.1 Reconnection Lifecycle Flow & State Transitions
* Candidate disconnects → LiveKit fires `participant_disconnected` event. This updates `interviews.status` to `reconnecting`.
* When status = "reconnecting", agent pauses the question timer, logs `disconnect_timestamp`, and preserves `conversation_history` in process memory.
* Room stays active for a 10-minute grace period (`empty_timeout`).
* If candidate re-connects (updates status to `ongoing`):
  * **Disconnect < 30 seconds:** Continue seamlessly without acknowledgment.
  * **Disconnect > 30 seconds:** *"Welcome back. Let's continue — you were explaining..."*
  * Agent resumes timer and continues dialog from the last question.
* If candidate fails to return in 10 minutes, the room closes, interview status transitions to `failed`, the agent exits, and BB4 is skipped.

### 8.2 Redis Room Tracking
* When starting an interview, the system tracks room creation and connections in Redis:
  * `SET room:{room_id}:created_at {timestamp} EX 2100`  # 35 min TTL
  * `SET room:{room_id}:candidate_id {candidate_id} EX 2100`
  * `SET room:{room_id}:interview_id {interview_id} EX 2100`
* On disconnect: `SET room:{room_id}:disconnect_time {timestamp} EX 600`  # 10 min grace period TTL
* On reconnect: Check Redis `GET room:{room_id}:created_at`. If exists, allow reconnect immediately (1ms check).
* On room end: `DEL room:{room_id}:created_at room:{room_id}:disconnect_time room:{room_id}:candidate_id room:{room_id}:interview_id`

---

## 9. Agent Memory & Data Boundary
* The LiveKit agent process (`livekit_agent.py`) is spawned with ONLY database IDs (`candidate_id`, `job_id`, `room_id`).
* The agent queries the database directly at startup via SQLAlchemy using `DATABASE_URL` (fetching candidate's structured JSON profile and job criteria tables).
* Heavy resume JSON and job criteria never travel over the HTTP or Redis network layers between FastAPI, Celery, and the Agent container, ensuring minimal memory footprints on Redis and low payload transit overhead.

---

## 10. Anti-Cheat Detection System (5-Layer Integrity Model)
To ensure interview integrity without proctoring hardware, the platform employs a multi-layered detection strategy:
1. **Layer 1 — Tab Close Detection:** Browser `beforeunload` event captures browser shutdowns. LiveKit webhook provides the disconnect reason (client-initiated disconnect vs network drop). Both are logged in the `interview_events` table.
2. **Layer 2 — Offline Duration Flagging:** Reconnection calculates offline duration. If the disconnect was client-initiated and offline duration > 90 seconds, the event is flagged as `SUSPICIOUS_RECONNECT`.
3. **Layer 3 — Agent Follow-Up Pivot:** After a suspicious disconnect (>90s, CLIENT_INITIATED), the agent skips the last question and asks a highly unpredictable, contextual follow-up based on the candidate's prior responses to prevent Googling answers.
4. **Layer 4 — Tab Visibility API:** The browser Page Visibility API logs when the candidate switches tabs or minimizes the window. The occurrences and duration are stored in the database.
5. **Layer 5 — Speech Pattern Analysis:** Post-interview, GPT-4o-mini scans candidate transcript metrics (words per minute, filler words count, zero hesitation durations) to flag potential cheating indicators (like reading a script vs thinking naturally). These are logged in `bc_scores.integrity_flag` and `bc_scores.integrity_rationale`.

All integrity alerts are compiled in a dedicated "Interview Integrity Events" timeline in Panel 3 for recruiter review.

---

## 11. Agent Process Lifecycle
The LiveKit agent (`livekit_agent.py`) follows a strictly managed execution lifecycle to handle session setups, active dialog, unexpected disconnects, and clean exits:
* **START:** Worker receives `spawn_agent` task with only: `candidate_id`, `job_id`, and `room_id`. Agent process starts and establishes a direct connection to the PostgreSQL database. Queries PostgreSQL directly using SQL parameter binding to fetch the candidate's structured profile (`clean_json`) and job description details (`jd`, `vic`, `bc`). In-memory, the agent constructs the personalized `system_prompt` outlining criteria directives. Connects to LiveKit room via `ctx.connect()`. Status set to `WAITING`.
* **RUN:** Candidate joins. Status transitions to `INTERVIEWING` and conversational timer starts. If disconnect happens, status transitions to `RECONNECTING` and timer pauses. If reconnect within 10 minutes, status transitions back to `INTERVIEWING` and timer resumes.
* **NORMAL END:** At 30 minutes, agent says goodbye, calls `POST /api/interviews/{id}/end` to gateway, persists transcript to PostgreSQL, and exits with code `0`.
* **ABNORMAL END:** On crash, saves partial transcript, exits with code `1`. Safety daemon watchdog kills at >40 mins. If candidate no-show for 10 minutes, exits with code `2` (status → `failed`).
* **MONITORING:** Heartbeat updated every 30 seconds to `room:{room_id}:last_heartbeat`. Watchdog restarts agent if heartbeat stale > 2 minutes.

---

## 12. API Rate Limiting Rules
* **Public endpoints (no auth required):**
  * `GET /interview/{invite_token}`: 10 requests per IP per minute
  * `POST /api/interviews/start`: 5 requests per IP per minute
  * `POST /api/candidates/upload`: 50 requests per IP per day (matches `DAILY_RESUME_LIMIT`)
* **Authenticated endpoints:**
  * `POST /api/jobs`: 20 per minute per user
  * `POST /api/interviews/{candidate_id}/invite`: 10 per minute per user
  * `GET /api/sse/*`: 5 concurrent connections per user
* **Implementation:** Slowapi with Redis backend. Exceeding requests get `429 Too Many Requests` with a `Retry-After` header. Webhooks are exempt and rely on JWT signature verification instead.

---

## 13. The Complete LLM Prompt Library (Verbatim)

Below is the complete catalog of exact, unedited system and user prompts used within the system.

### 13.1 Job Rubric Generator Prompts

#### 13.1.1 Full Mode Prompt (RVC + VIC + BC Supplied)
This prompt runs when creating a job where the recruiter has specified criteria for the Resume, Voice Technical round, and Behavioral Round.

**System Message Content:**
```
You output structured JSON objects for recruitment criteria and category weights.
```

**User Message Template:**
```
You are an expert HR recruitment specialist. Analyze the Job Title, Job Description (JD), Resume Verification Criteria (RVC), Voice Interview Criteria (VIC), and Behavioral Criteria (BC) and extract a structured JSON object containing three rubrics: 'resume', 'vic', and 'bc'.

1. 'resume' Rubric Rules:
- Distribute 100 total points across the four main scoring categories:
  * Skills (skills_max)
  * Experience (experience_max)
  * Education (education_max)
  * Certifications (certs_max)
- The sum of these 4 values must be exactly 100.
- Include a list of criteria under 'criteria', where each has 'name', 'required' (boolean), and 'description'.

2. 'vic' Rubric Rules:
- Analyze the Voice Interview Criteria (VIC) and JD to extract 3 to 6 distinct technical evaluation criteria for the live voice interview.
- Assign a weight (integer percentage) to each criterion based on its importance to the job role.
- The sum of all 'weight' values in the 'vic' rubric MUST be exactly 100.
- Each criterion must have 'name', 'description', and 'weight'.

3. 'bc' Rubric Rules:
- Analyze the Behavioral Criteria (BC) and JD to extract 2 to 4 distinct behavioral/communication evaluation criteria.
- Assign a weight (integer percentage) to each criterion based on its importance to the job role.
- The sum of all 'weight' values in the 'bc' rubric MUST be exactly 100.
- Each criterion must have 'name', 'description', and 'weight'.

Output MUST be a JSON object with this exact structure:
{
  "resume": {
    "weights": {"skills_max": <int>, "experience_max": <int>, "education_max": <int>, "certs_max": <int>},
    "criteria": [{"name": "<name>", "required": <bool>, "description": "<desc>"}]
  },
  "vic": {
    "criteria": [{"name": "<name>", "description": "<desc>", "weight": <int>}]
  },
  "bc": {
    "criteria": [{"name": "<name>", "description": "<desc>", "weight": <int>}]
  }
}

Job Title: {title}
Job Description: {jd}
RVC Text:
{rvc_text}

VIC Text:
{vic_text}

BC Text:
{bc_text}
```

#### 13.1.2 Legacy Fallback Mode Prompt (Only RVC Supplied)
This runs if only RVC is provided at job creation.

**System Message Content:**
```
You output structured JSON objects for recruitment criteria and category weights.
```

**User Message Template:**
```
You are an expert HR recruitment specialist. Analyze the Job Title, Job Description (JD), and Resume Verification Criteria (RVC) text and extract a structured JSON list of specific criteria and dynamic weights for evaluation.

You must decide how to distribute 100 total points across the four main scoring categories:
1. Skills (skills_max)
2. Experience (experience_max)
3. Education (education_max)
4. Certifications (certs_max)

Rules for Weights:
- The values for skills_max, experience_max, education_max, and certs_max must be integers, each >= 0.
- The sum of these 4 values must be exactly 100.
- Make the distribution based on the job role (e.g. for a senior engineer, experience and skills might be higher; for an entry level role, education might be higher; for a highly regulated field, certifications might be higher).

Output MUST be a JSON object with keys:
- 'weights': an object with keys: 'skills_max', 'experience_max', 'education_max', 'certs_max'.
- 'criteria': a list of objects. Each object in the list must have keys:
  * 'name': Name of the criterion (e.g. 'Python Programming', 'AWS Cloud Architecture').
  * 'required': boolean (true if it's a mandatory requirement, false if preferred/optional).
  * 'description': Brief description of what is expected for this criterion.

Job Title: {title}
Job Description: {jd}
RVC Text:
{rvc_text}
```

---

### 13.2 Resume Parser / Structuring Prompts (BB2 Step 2)

**System Message Content:**
```
You are a resume data extractor. Your ONLY job is to copy information verbatim from the resume text into the JSON fields described below. You must NEVER infer, estimate, calculate, guess, or fabricate anything.

CRITICAL RULES:
1. EXTRACT ONLY — copy words/numbers exactly as they appear. If a field is absent from the resume, return null or [].
2. EXPERIENCE vs PROJECTS — the 'experience' array is for PAID PROFESSIONAL EMPLOYMENT ONLY (a real company paid the person a salary/wage for their work). University capstone projects, personal side-projects, open-source contributions, hackathons, research papers, internships at college, and club activities are NOT professional experience. Place them in 'projects' instead.
3. DO NOT INVENT COMPANY NAMES — if a role has no employer name written on the resume, set company to null. Never use a project title or technology name as a company name.
4. DATE FIELDS — for each experience entry, extract start_date and end_date exactly as written (e.g. 'June 2022', '2022-06', 'Present'). If a date is absent, set it to null. Do NOT calculate or estimate duration.
5. DO NOT SET experience_years — set it to 0. The system calculates this automatically from dates. Never compute it.
6. EMAIL — extract the literal email address if present. If the text says 'EMail', 'N/A', or no email exists, return null.
7. PHONE — extract only the literal phone number string. If absent, return null.
8. NO DEFAULTS — never fill a field with a placeholder value. Unknown = null or []. Do not guess.
```

**User Message Template:**
```
Extract the following JSON from the resume text below.
Return ONLY a valid JSON object with these exact keys. Do not add any text outside the JSON.

{
  "name": null,
  "email": null,
  "phone": null,
  "location": null,
  "skills": [],
  "experience_years": 0,
  "education": [
    {"school": null, "degree": null, "year": null}
  ],
  "experience": [
    {
      "company": null,
      "title": null,
      "start_date": null,
      "end_date": null,
      "duration": null,
      "description": null
    }
  ],
  "projects": [
    {
      "title": null,
      "description": null,
      "technologies": [],
      "duration": null
    }
  ],
  "certifications": [],
  "languages": []
}

RULES REMINDER:
- experience[] = PAID EMPLOYMENT ONLY (salary/wage from a real employer).
- projects[] = everything else: university capstones, personal projects, hackathons, open-source, internships listed without company, etc.
- experience_years = always 0 (Python calculates this, not you).
- If experience[] is empty (no paid employment found), that is correct.
- Do NOT invent company names. If no employer name exists for a role, set company to null and move the entry to projects[].
- start_date and end_date: copy the exact text from the resume (e.g. 'Jan 2023', '2023-01', 'Present'). null if not written.

Resume text:
{raw_text}
```

---

### 13.3 Resume Scoring Prompt (BB3)

**System Message Content:**
```
You are an expert recruitment coordinator. Score the candidate's anonymous profile against the job rubric.
You must output a JSON object with the following fields:
{
  "total_score": <integer 0-100 representing sum of breakdown scores>,
  "recommendation": "<one of: strong_hire, hire, hold, manual_review, reject>",
  "breakdown": {
    "skills_score": <integer 0-{skills_max}>,
    "experience_score": <integer 0-{experience_max}>,
    "education_score": <integer 0-{education_max}>,
    "certs_score": <integer 0-{certs_max}>,
    "rationale": "<detailed rationale for the scores>"
  }
}

Rules:
1. total_score must be the exact sum of skills_score (max {skills_max}), experience_score (max {experience_max}), education_score (max {education_max}), and certs_score (max {certs_max}).
2. recommendation must be one of: 'strong_hire', 'hire', 'hold', 'manual_review', 'reject'.
```

**User Message Template:**
```
Job Title: {job.title}
Job Rubric: {rubric_str}

Anonymous Candidate Profile:
{profile_str}
```

---

### 13.4 LiveKit Voice Agent system_prompt

**System Instructions Prompt:**
```
You are a professional, friendly AI recruiter conducting a live voice interview.
Candidate Name: {candidate_name}
Candidate Profile: {json.dumps(clean_json)}
Job Description: {jd}
Resume Verification Criteria: {vic}
Behavioral Criteria: {bc}

Instructions:
1. Welcome the candidate by name.
2. Conduct a structured, natural interview assessing their skills, verification criteria, and behavioral alignment.
3. Keep your questions clear and concise.
4. Be encouraging, professional, and conversational. Do not reveal any grading rubric or internal scores.
5. Keep the conversation moving.
```

---

### 13.5 Voice Interview Technical Scorer Prompts (BB5 VIC)

#### 13.5.1 Structured Weights Mode
This runs when structured sub-criteria are present in the job's rubric.

**User Message Template:**
```
You are a strict technical interviewer evaluating a candidate.
Job VIC Criteria:
{criteria_str}

Interview Transcript:
{transcript_text[:6000]}

Score the candidate strictly against each of the criteria listed above. Scale all criteria scores to a 0-100 scale (integer 0-100).
Output ONLY valid JSON:
{
  "criteria_scores": [{"criterion": "<exact name of criterion>", "score": <int 0-100>, "rationale": "<brief>"}],
  "summary": "<2-3 sentence technical assessment>"
}
```

#### 13.5.2 Legacy Fallback Mode
This runs if the job does not have a structured VIC rubric.

**User Message Template:**
```
You are a strict technical interviewer evaluating a candidate.
Job VIC Criteria:
{job.vic}

Interview Transcript:
{transcript_text[:6000]}

Score strictly against the VIC criteria. Scale all criteria scores to a 0-100 scale (integer 0-100), even if the Job VIC Criteria specifies a 0-10 scale.
Output ONLY valid JSON:
{
  "overall_score": <int 0-100>,
  "criteria_scores": [{"criterion": "<name>", "score": <int 0-100>, "rationale": "<brief>"}],
  "summary": "<2-3 sentence technical assessment>"
}
```

---

### 13.6 Behavioral Scorer Prompts (BB5 BC)

#### 13.6.1 Structured Weights Mode
This runs when structured sub-criteria are present in the job's rubric.

**User Message Template:**
```
You are an expert behavioral interviewer and speech analyst.
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
{
  "criteria_scores": [{"criterion": "<exact name of criterion>", "score": <int 0-100>, "rationale": "<brief>"}],
  "speech_metrics_summary": "<1 sentence summary>",
  "integrity_flag": <true if anomaly detected>,
  "integrity_rationale": "<explanation if flagged, else empty string>",
  "summary": "<2-3 sentence behavioral assessment>"
}
```

#### 13.6.2 Legacy Fallback Mode
This runs if the job does not have a structured BC rubric.

**User Message Template:**
```
You are an expert behavioral interviewer and speech analyst.
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
{
  "overall_score": <int 0-100>,
  "criteria_scores": [{"criterion": "<name>", "score": <int 0-100>, "rationale": "<brief>"}],
  "speech_metrics_summary": "<1 sentence summary>",
  "integrity_flag": <true if anomaly detected>,
  "integrity_rationale": "<explanation if flagged, else empty string>",
  "summary": "<2-3 sentence behavioral assessment>"
}
```

---

### 13.7 Recruiter Hiring Recommendation Summary Prompt (BB6)

**User Message Template:**
```
You are a senior recruiter summarising a candidate evaluation for a hiring manager.

Candidate: {candidate.name}
Job: {job.title} ({job.department})
Scores: Resume Match {match_score}/100 | Technical VIC {vic_score}/100 | Behavioral BC {bc_score}/100 | Overall {overall_score}/100
AI Verdict: {verdict}

Technical Assessment: {vic_summary or 'Not available'}
Behavioral Assessment: {bc_summary or 'Not available'}

Write a concise, professional 2-3 sentence hiring recommendation summary. Be direct and specific.
```

---

## 14. Graphify Integration Rules for Antigravity

### 14.1 Context Hierarchy (Priority Order)
1. **Graphify Knowledge Graph** (compressed, structured)
2. **File Tree Summary** (filenames + sizes only)
3. **Specific File Snippets** (only when user asks)
4. **Full File Contents** (last resort, requires approval)

### 14.2 Graphify Query Rules
- ALWAYS query Graphify before reading raw files.
- Query format: `"Find [entity] related to [user intent]"`
- Max nodes to retrieve: 20 per query.
- Max relationships to traverse: 3 hops.
- Exclude: comments, docstrings, test files (unless asked).

### 14.3 Token Budget
- Graphify context: max 4000 tokens.
- If exceeded: switch to file-tree-only mode.
- Log every query: tokens saved vs baseline.

### 14.4 Auto-Indexing
- Trigger: file save, file create, file delete.
- Debounce: 5 seconds.
- Background: yes (non-blocking).
- Scope: current workspace only.

### 14.5 Fallback Rules
- If Graphify is not installed: use current file-only context.
- If Graphify query fails: use file-tree context.
- If user says "show me the full file": bypass Graphify, show raw content.

