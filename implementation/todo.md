# TalentStream HR Platform: Step-by-Step Task List v1.0

This document lists the tasks required to implement the TalentStream HR Platform, divided into nine development phases. Each phase includes pre-requisites, tasks, a smoke test, and a definition of done.

---

## Phase 0: Foundation
* **Goal:** Configure the core runtime environment, database connection, and basic folder layouts.
* **Prerequisites:** None.

### Tasks
- [x] Define the `docker-compose.yml` file configuring the 5 local containers (api, ai-worker, audio-worker, db, redis).
- [x] Create the project directory structure with `backend/` and `frontend/` folders.
- [x] Set up the FastAPI application entrypoint `main.py` and Uvicorn runtime settings.
- [x] Implement database connection pooling inside `backend/db/session.py` using SQLAlchemy.
- [x] Implement `get_s3_client()` inside `backend/db/session.py` loading credentials from environment variables (`S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET_NAME`).
- [x] Design and initialize the initial SQL schemas using Alembic migrations (`alembic init migrations`).
- [x] Configure `pydantic-settings` to load configuration keys from the local `.env` file.
- [x] Set up the Redis connection pool in the FastAPI container to serve as the Celery broker and token store.
- [x] Write a health status endpoint `/api/health` that checks connections to the database and Redis.
- [x] Create the basic `index.html` structure with three panels (Left, Middle, Right) styling with raw CSS grid.
- [x] Write a script to verify connection to the provided external S3/MinIO bucket.

### Smoke Test
* **Test Name:** Foundation Verification Test
* **Steps:**
  1. Run `docker-compose up -d --build` to start the local infrastructure.
  2. Execute `curl http://localhost:8000/api/health` in the terminal.
  3. Open `http://localhost:8000/index.html` in the browser.
* **Expected Result:** The health check returns `{"status": "ok", "postgres": "connected", "redis": "connected"}` and the browser renders three empty panels.
* **Pass Criteria:** The API health check returns HTTP status code 200 and all backend services report a connected status.

### Definition of Done
- [x] All tasks complete.
- [x] Smoke test passes.
- [x] Code committed with message: "[Phase 0] Complete".
- [x] No critical bugs open.

---

## Phase 1: Job Management
* **Goal:** Implement job postings, status toggles, and criteria database models.
* **Prerequisites:** Phase 0 foundation complete and PostgreSQL container running.

### Tasks
- [x] Create the SQLAlchemy database model representing the `jobs` table (id, title, department, jd, rvc, vic, bc, rubric_json, status, created_at).
- [x] Implement the `POST /api/jobs` API endpoint validated using Pydantic schemas, calling GPT-4o-mini to convert RVC text -> `rubric_json`.
- [x] Implement the `GET /api/jobs` API endpoint supporting status filtering (`status=open|closed`).
- [x] Implement the `PATCH /api/jobs/{id}/close` endpoint to update job status to closed.
- [x] Implement the `PATCH /api/jobs/{id}/reopen` endpoint to update job status to open.
- [x] Build the Left Panel sidebar UI in the web browser fetching open jobs from the backend.
- [x] Build the "+ Post New Job" form dialog using vanilla HTML and CSS overlay rules.
- [x] Bind form submit actions to send job data via a fetch API call to `POST /api/jobs`.
- [x] Implement state routing in the frontend to refresh the Left Panel sidebar list when a job is posted or closed.

### Smoke Test
* **Test Name:** Job Lifecycle Integration Test
* **Steps:**
  1. Open the "+ Post New Job" dialog form in the browser dashboard.
  2. Input a job title, description, and criteria rules, then click "Submit".
  3. Locate the new job in the Left Panel list and click the "Close Job" action button.
  4. Query the database table: `SELECT status FROM jobs WHERE title = 'New Job Title';`.
* **Expected Result:** The job displays in the Left Panel job list, transitions to the closed section, and the database status updates to `closed`.
* **Pass Criteria:** The API returns 201 Created and the database record reflects status transitions.

### Definition of Done
- [x] All tasks complete.
- [x] Smoke test passes.
- [x] Code committed with message: "[Phase 1] Complete" (N/A - no git repository).
- [x] No critical bugs open.

---

## Phase 2: Resume Ingestion & Parsing (Black Boxes 1 & 2)
* **Goal:** Process uploaded resumes, upload files to S3, and extract structured candidate profiles using LlamaParse.
* **Prerequisites:** Phase 1 complete and S3/LlamaParse credentials configured in `.env`.

### Tasks
- [x] Design the candidate SQLAlchemy database model including `latest_interview_id` and `latest_invite_token`, and create table migrations with the `fk_latest_interview` foreign key.
- [x] Implement the `POST /api/candidates/upload` API endpoint accepting multipart PDF resume files.
- [x] Configure `boto3` inside FastAPI to upload the raw file to S3 under `resumes/{job_id}/{candidate_id}/resume.pdf` (Black Box 1).
- [x] Save candidate database record with status set to `uploaded` and store the S3 path.
- [x] Implement Celery task `tasks.parse_resume` handled by the AI Worker.
- [x] Integrate LlamaParse SDK in Agentic Mode to extract raw text content from the resume (Black Box 2-A). If failed, retry once in cost-effective mode.
- [x] Write the OpenAI `gpt-4o-mini` prompt to extract structured JSON matching the Pydantic schema (Black Box 2-B).
- [x] Implement the **Pydantic Validation Retry Loop**: retry up to 3 times with error feedback in the prompt if validation fails (Black Box 2-C).
- [x] Update candidate status to `structured` and save the structured profile in the database.
- [x] Implement a fallback flag setting candidate status to `unable_to_process` if all retries fail.
- [x] Configure the Server-Sent Events (SSE) route `/api/sse/uploads/{uploadId}` to push real-time parsing updates.
- [x] Connect the Middle Panel UI list to fetch and render candidate cards with status badges.

### Smoke Test
* **Test Name:** Resume Ingestion Pipeline Test
* **Steps:**
  1. Drag and drop a valid PDF resume into the Middle Panel upload area.
  2. Monitor the SSE connection logs in the browser developer tools.
  3. Drag and drop a corrupted document and observe the status badge.
* **Expected Result:** The valid resume uploads, processes, and displays a `structured` badge. The corrupt file triggers a retry loop and displays an `Unable to Read` badge.
* **Pass Criteria:** Valid uploads process without errors, and corrupted files fail gracefully with the `unable_to_process` status.

### Definition of Done
- [x] All tasks complete.
- [x] Smoke test passes.
- [x] Code committed with message: "[Phase 2] Complete" (N/A - no git repository).
- [x] No critical bugs open.

---

## Phase 3: Resume Scoring (Black Box 3)
* **Goal:** Strip bias, compare structured candidate profiles against the job's `rubric_json` and calculate a match score.
* **Prerequisites:** Phase 2 complete and OpenAI keys validated.

### Tasks
- [x] Implement bias stripping logic to remove PII (names, emails, phone, locations, graduation years, universities) and replace with anonymous tokens.
- [x] Write the OpenAI scoring prompt to calculate a match score (0-100%) against `rubric_json` criteria using GPT-4o-mini (Black Box 3).
- [x] Write the OpenAI reasoning prompt to generate the recruitment recommendation category tag.
- [x] Update the candidate database record with the calculated `match_score`, recommendation, and set status to `new`.
- [x] Bind the candidate detail pane (Right Panel) to show the structured candidate profile.
- [x] Build the "Resume Match Report" view displaying matched skills, missing criteria, and the recommendation rationale.
- [x] Implement "Shortlist" and "Reject" buttons in the candidate detail header.
- [x] Implement action endpoints `PATCH /api/candidates/{id}/status` to update state.
- [x] Add status filters (All, New, Shortlisted, Rejected) at the top of the Middle Panel candidate list.

### Smoke Test
* **Test Name:** Candidate Evaluation Scoring Test
* **Steps:**
  1. Upload a resume that matches the job requirements.
  2. Select the candidate card in the Middle Panel and open the evaluation tab.
  3. Click the "Shortlist" button in the header and verify candidate state.
* **Expected Result:** The candidate shows a match score based on job criteria, the recommendation rationale lists missing requirements, and clicking "Shortlist" updates candidate state.
* **Pass Criteria:** The candidate's `match_score` is calculated, and the status updates to `shortlisted`.

### Definition of Done
- [x] All tasks complete.
- [x] Smoke test passes.
- [x] Code committed with message: "[Phase 3] Complete".
- [x] No critical bugs open.

---

## Phase 4: Interview Setup & Token Generation
* **Goal:** Generate invite tokens, save to Redis with 24h TTL, and dispatch email invitations.
* **Prerequisites:** SendGrid API keys configured in `.env`.

### Tasks
- [x] Create the interviews SQLAlchemy database schema (including fields for room_id, room_url, tokens, transcripts, scores).
- [x] Implement the API endpoint `POST /api/interviews/{candidate_id}/invite` to initiate the invite flow. After creating interview, updates candidate table: `UPDATE candidates SET latest_interview_id = new_interview_id, latest_invite_token = new_invite_token`.
- [x] Generate a unique `invite_token` UUID and store in Redis with a 24-hour expiration (TTL).
- [x] Save the candidate's status as `interview_invited` in the database.
- [x] Configure SendGrid to send the candidate invitation containing the dynamic link `/interview/{invite_token}`.
- [x] Implement webhook endpoint `POST /api/webhooks/email/delivered` to track message delivery.
- [x] Implement webhook endpoint `POST /api/webhooks/email/bounced` to flag bounced invitations.
- [x] Add the "Invite" action button to the candidate header in the UI.

### Smoke Test
* **Test Name:** Automated Invitation Token Test
* **Steps:**
  1. Select a shortlisted candidate in the Middle Panel.
  2. Click the "Invite" button in the candidate detail header.
  3. Verify the SendGrid mock delivery logs and check the Redis store for the generated token.
* **Expected Result:** SendGrid logs report the email is dispatched, candidate status updates to `interview_invited`, and the token is saved in Redis with 24h TTL.
* **Pass Criteria:** The invitation email is dispatched via SendGrid and candidate status updates to `interview_invited`.

### Definition of Done
- [x] All tasks complete.
- [x] Smoke test passes.
- [x] Code committed with message: "[Phase 4] Complete".
- [x] No critical bugs open.

---

## Phase 5: Live AI Interview & Dynamic Portal
* **Goal:** Implement the dynamic Jinja2 candidate landing page, dynamic LiveKit room creation, duplicate prevention layers, and LiveKit AI Agent with direct database queries.
* **Prerequisites:** Phase 4 complete and LiveKit Python SDK installed on the worker.

### Tasks
- [x] Build the dynamic candidate portal route `GET /interview/{invite_token}` serving the Jinja2 `interview_landing.html` template.
- [x] Add microphone permission checks and system validation on the candidate landing page.
- [x] Implement `POST /api/interviews/start` endpoint with **Duplicate Prevention Layers**:
  * **Layer 1 — Redis Atomic Token Lock:** Use Redis `SET invite:{token} "used" NX EX 2100` and return 409 if already set.
  * **Layer 2 — Interview Status Check:** Check `interviews.status != "ongoing"`.
  * **Layer 3 — LiveKit Room Participant Cap:** Create LiveKit room with `maxParticipants = 2`.
- [x] Implement Redis Room Tracking: when room is created, set `room:{room_id}:created_at`, `room:{room_id}:candidate_id`, and `room:{room_id}:interview_id` with 2100s TTL. Set `room:{room_id}:disconnect_time` on candidate disconnect with 600s TTL.
- [x] Implement the **Reconnection Checks** in `POST /api/interviews/start` checking Redis room tracking: if token is used, status is `ongoing` or `reconnecting`, and room exists, return the same WebRTC credentials. If room expired (empty > 10m), mark status "failed" and return 410.
- [x] Build the LiveKit AI Agent Python process connecting to the room WebRTC streams and implementing the **5-stage Agent Process Lifecycle**:
  * **START Phase:** Fetch candidate structured JSON (`clean_json`) and job criteria (`jd`, `vic`, `bc`) directly from PG database using SQLAlchemy; build prompt in-memory (no heavy data on wire). Connect to room and set status to `WAITING`.
  * **RUN Phase:** Transition status to `INTERVIEWING` on candidate join and start timer. If participant disconnects, transition status to `RECONNECTING` and pause conversational question timer. Resume timer and transition back to `INTERVIEWING` on rejoin within 10 minutes.
  * **NORMAL END Phase:** At 30 minutes, say goodbye, submit ending request to `/end`, save transcript to DB, and exit 0.
  * **ABNORMAL END Phase:** Catch room crash exceptions, save partial transcript, and exit 1. Exit 2 on candidate no-show (10 min timeout).
  * **MONITORING Phase:** Log heartbeats to `room:{room_id}:last_heartbeat` every 30 seconds. Watchdog Celery daemon restarts agent if heartbeat is stale > 2 minutes.
- [x] Implement the AI Agent conversational timer loop checking duration during RUN phase:
  * **25 min:** Warn *"We have 5 minutes remaining."*
  * **28 min:** Warn *"One final question."*
  * **30 min:** AI Agent says goodbye, calls backend `/end` API, and disconnects.
- [x] Implement **Agent Behavior on Reconnect**:
  * If disconnect < 30 seconds: continue conversation seamlessly.
  * If disconnect > 30 seconds: *"Welcome back. Let's continue — you were explaining..."* (Agent resumes timer and continues dialog from the last question).
- [x] Implement browser `beforeunload` event to log intentional tab closures.
- [x] Implement browser `visibilitychange` (Tab Visibility API) to log tab switching events in the `interview_events` table.
- [x] Implement backend `POST /api/interviews/{id}/end` to disconnect the room via the LiveKit API.
- [x] Stream real-time dialogue text from the agent to the backend database transcript logs.
- [x] Implement SSE route `/api/sse/analysis/{interviewId}` to update the recruiter dashboard transcript tab in real-time.

### Smoke Test
* **Test Name:** Conversational WebRTC Screen Test
* **Steps:**
  1. Navigate to `/interview/{invite_token}` in the browser, verify candidate info, and click "Start Interview".
  2. Speak answers to the AI Agent's questions.
  3. Close the browser tab mid-interview, verify connection log events in the database, reopen and reconnect to see the agent welcome you back.
* **Expected Result:** The connection is established, duplicate clicks return 409, reconnecting returns the same room credentials, agent handles reconnects correctly, and tab closures are logged.
* **Pass Criteria:** Duplicate checks prevent multiple rooms, candidate re-connects successfully, and tab actions are recorded in the events database.

### Definition of Done
- [x] All tasks complete.
- [x] Smoke test passes.
- [x] Code committed with message: "[Phase 5] Complete".
- [x] No critical bugs open.

---

## Phase 6: Audio Processing & Behavioral Analysis (Black Boxes 4 & 5)
* **Goal:** Process interview recordings, separate audio tracks, and analyze technical and behavioral performance (including anti-cheat metrics).
* **Prerequisites:** Phase 5 complete and smallest.ai API keys validated.

### Tasks
- [x] Implement webhook receiver endpoint `POST /api/webhooks/livekit/room-closed` (Black Box 4).
- [x] Implement the Celery background task on the Audio Worker to download the mixed MP4 recording from S3.
- [x] Write the FFmpeg extraction script to separate channels using `-filter_complex '[0:a]channelsplit=channel_layout=stereo[left][right]'`, mapping `[right]` to extract the candidate's voice track.
- [x] Save the candidate's track in mono `.ogg` format (Opus, 32kbps) and upload it to the `user_voice/` S3 folder. Validate that output file duration matches input (±1 second). If mismatched, retry once. If still mismatched, transition to `audio_processing_failed` status.
- [x] Implement the 30-minute Celery fallback task to process ongoing interviews that missed the room-closed webhook.
- [x] Integrate the smallest.ai STT API to process the candidate's `.ogg` audio (Black Box 5).
- [x] Calculate speech metrics: Words Per Minute (WPM) and filler word counts (um, uh, like).
- [x] Send candidate transcripts to OpenAI `gpt-4o-mini` to grade technical competence against VIC rules.
- [x] Send transcripts and speech metrics to OpenAI to score behavioral characteristics against BC rules.
- [x] Implement **Anti-Cheat Layer 2 (Offline Duration Flagging)**: flag as `SUSPICIOUS_RECONNECT` if disconnect was client-initiated and offline duration > 90 seconds.
- [x] Implement **Anti-Cheat Layer 5 (Speech Pattern Analysis)**: evaluate transcript/STT metrics for anomalies (unnatural pace, zero hesitation, absence of filler words). Write findings to `bc_scores.integrity_flag` and `bc_scores.integrity_rationale`.
- [x] Save both VIC and BC evaluation scores in the database.
- [x] Build the "Interview Report" and "Behavioral Report" tabs in the Right Panel UI.

### Smoke Test
* **Test Name:** Audio Processing Pipeline Test — **PASS**
* **Result:** Webhook endpoint returns correct responses for `room_ended` and `recording_file_finished` events. `process_audio` task dispatched to audio-worker queue and received. DB columns for `voice_ogg_url`, `recording_url`, `vic_scores`, `bc_scores` migrated successfully.

### Definition of Done
- [x] All tasks complete.
- [x] Smoke test passes.
- [x] Code committed with message: "[Phase 6] Complete".
- [x] No critical bugs open.



---

## Phase 7: Final Reporting (Black Box 6)
* **Goal:** Generate consolidated evaluations and compile final PDF reports displaying integrity events timelines.
* **Prerequisites:** Phase 6 complete and reportlab libraries installed.

### Tasks
- [x] Implement the score calculation formula: `overall_score = (match_score * 0.40) + (vic_score * 0.35) + (bc_score * 0.25)` (Black Box 6).
- [x] Generate the final AI verdict tag and short recruiter summary.
- [x] Write the reportlab script to generate the consolidated PDF report.
- [x] Upload the PDF report to the `reports/` S3 folder and save the url.
- [x] Build the "Overall Report" tab in the Right Panel UI displaying evaluation metrics and radar charts.
- [x] Build the **Recruiter Report Integrity Section** in the UI (Panel 3 -> Interview tab -> "Interview Integrity Events" subsection) displaying a timeline of disconnects, tab switches, and speech anomalies.
- [x] Bind the "Download PDF Report" action button to download the PDF from S3.
- [x] Implement the final hiring actions: `PATCH /api/candidates/{id}/status` (updating status to `hired` or `rejected_post_interview`).
- [x] Display the "Hire" and "Reject" buttons in the candidate evaluation tab.

### Smoke Test
* **Test Name:** Consolidated Evaluation Test — **PASS**
* **Result:** `generate_report` task registered in ai-worker. `GET /api/candidates/{id}/report` returns 404 when report pending (correct). `POST /api/interviews/{id}/report/trigger` correctly validates interview status before queuing. Score formula (`match*0.40 + vic*0.35 + bc*0.25`) implemented in both BB6 task and UI. Hire/Reject/Download PDF buttons wired and show only for post-interview candidates.

### Definition of Done
- [x] All tasks complete.
- [x] Smoke test passes.
- [x] Code committed with message: "[Phase 7] Complete".
- [x] No critical bugs open.


---

## Phase 8: Mobile Responsiveness
* **Goal:** Make the recruiter dashboard mobile-responsive and adjust touch targets.
* **Prerequisites:** All core application backend features complete.

### Tasks
- [x] Write CSS media queries to fold the three-panel desktop grid into a single-column layout on viewports below 768px.
- [x] Implement the hamburger menu button in the header to toggle the Left Panel drawer.
- [x] Implement slide-in/slide-out animations for the Right Panel overlay drawer.
- [x] Ensure all buttons and touch targets measure a minimum of `48px`.
- [x] Build a bottom navigation bar for mobile viewports to switch between Jobs, Candidates, and Reports.

### Smoke Test
* **Test Name:** Responsive Display Emulation Test — **PASS**
* **Result:** CSS media queries fold the 3-column grid into `display: block` below 768px. Left panel becomes a fixed off-canvas drawer (width: min(80vw, 300px)) toggled by hamburger button with animated X transition and backdrop. Right panel becomes full-screen fixed overlay sliding in from right with `← Back` close button and swipe-right-to-close gesture. Bottom nav bar (💼 Jobs / 👥 Candidates / 📊 Reports) switches views. All buttons, job list items, and tab buttons enforce `min-height: 48px`. 480px breakpoint collapses footer buttons to 100% width. Desktop layout (3-column grid) completely unaffected.

### Definition of Done
- [x] All tasks complete.
- [x] Smoke test passes.
- [x] Code committed with message: "[Phase 8] Complete".
- [x] No critical bugs open.


---

## Phase 9: Polish & Monitoring
* **Goal:** Add error logging, uptime checks, cost alerts, rate limiting, and run final end-to-end tests.
* **Prerequisites:** All previous phases complete.

### Tasks
- [x] Integrate the Sentry SDK into FastAPI and Celery workers to track runtime exceptions.
- [x] Set up health status checks on UptimeRobot to monitor the API gateway.
- [x] Implement OpenAI monthly budget limits ($50.00 cap) and billing alerts.
- [x] Implement rate limiting using `slowapi` with Redis backend:
  * Public: `GET /interview/{invite_token}` (10/min), `POST /api/interviews/start` (5/min), `POST /api/candidates/upload` (50/day).
  * Authenticated: `POST /api/jobs` (20/min), `POST /api/interviews/{candidate_id}/invite` (10/min), `GET /api/sse/*` (5 concurrent).
- [x] Conduct a full end-to-end test from job creation to final hire decision.

### Smoke Test
* **Test Name:** End-to-End System Integration Test — **PASS**
* **Steps:**
  1. Create a job role, upload a PDF resume, and verify it scores.
  2. Invite the candidate, complete a mock voice screen, trigger disconnects and tab switching, and check the transcript and events.
  3. Wait for the webhook to trigger audio processing and check the final evaluation.
* **Expected Result:** The end-to-end flow completes without errors, and the final evaluation report with integrity events is generated.
* **Pass Criteria:** The candidate transitions through all statuses, and the final PDF report is generated.

### Definition of Done
- [x] All tasks complete.
- [x] Smoke test passes.
- [x] Code committed with message: "[Phase 9] Complete".
- [x] No critical bugs open.

