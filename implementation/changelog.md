# TalentStream Changelog

## v0.14.0 — Recruiter-Configurable Interview Invitation Link Validity (2026-07-15)
- [ADDED]: Configurable expiration duration selector (inputs for numeric values and hours/days dropdown) in the recruiter dashboard invitation controls (Panel 3 footer).
- [ADDED]: API support for an optional `expiry_seconds` query parameter in the candidate invite POST endpoint `/api/interviews/{candidate_id}/invite`.
- [ADDED]: Redis TTL management that sets token validity based on the recruiter's chosen duration, falling back to the 24h default.
- [ADDED]: Custom glassmorphic "Link Expired" HTML warning landing page served directly on expired/invalid/missing tokens.
- [ADDED]: Integration tests in `test_platform.py` verifying custom invite expirations, Redis TTL configuration, active landing access, and expired link rendering.
- Files: `hr-platform/backend/main.py`, `hr-platform/frontend/static/app.js`, `hr-platform/frontend/templates/interview_landing.html`, `hr-platform/test_platform.py`, `docs/bhagavadgeetha.md`
- Status: COMPLETED

## v0.13.0 — Comprehensive Candidate Card Scoring Summary & Relative Timestamp (2026-07-15)
- [ADDED]: Multi-Score display tags directly on candidate cards in the middle panel showing CV (Resume), INT (Interview), BEH (Behavioral), and OVR (Overall) scores.
- [ADDED]: Placeholder display (`–`) for uncompleted interview/behavioral stages to ensure professional consistency and clean aesthetics.
- [ADDED]: Relative timestamp display (e.g. "10m ago", "Yesterday") at the top-right of candidate cards, replacing the redundant circular score circle.
- [ADDED]: "Oldest First" sorting option (`date_asc`) to both frontend sort dropdown and backend query filters.
- [MODIFIED]: `.candidate-card-actions` position in `style.css` to `right: 8px;` so it sits perfectly inline with the new layout on hover.
- [MODIFIED]: `/api/candidates` backend endpoint to pre-fetch and include `vic_score` and `bc_score` alongside standard database fields in candidate payloads.
- Files: `hr-platform/backend/main.py`, `hr-platform/frontend/static/index.html`, `hr-platform/frontend/static/app.js`, `hr-platform/frontend/static/style.css`, `docs/bhagavadgeetha.md`
- Status: COMPLETED

## v0.12.1 — Middle Panel Expand & Collapse Controls (2026-07-15)
- [ADDED]: Compact single-row layout (`32px` height) for search input and filter/sort controls at the very top of the middle panel.
- [ADDED]: Fixed position Expand/Collapse button (`#btn-toggle-top-section`) on this top row that stays stationary during toggles.
- [ADDED]: CSS class toggling (`.top-collapsed`) to instantly hide/show both the active job details header and the ingestion progress summary.
- [ADDED]: Persistent state mapping using `localStorage` to preserve recruiter layout preferences.
- Files: `hr-platform/frontend/static/index.html`, `hr-platform/frontend/static/style.css`, `hr-platform/frontend/static/app.js`
- Status: COMPLETED

## v0.12.0 — Interview Tracker Integration & Safety Refinements (2026-07-14)
- [ADDED]: Shopping-app-style vertical timeline stepper showing three interview milestones in the profile detail header.
- [ADDED]: Toggleable collapsible timeline container driven by `#btn-interview-status` click handlers and integrated with candidate selections.
- [FIXED]: CustomVoiceAgent session override properties to prevent read-only attribute mutation exceptions.
- [FIXED]: Refactored violation handling inside CustomVoiceAgent to reference local state dictionaries, ensuring stable WebRTC audio sessions.
- Files: `hr-platform/frontend/static/index.html`, `hr-platform/frontend/static/style.css`, `hr-platform/frontend/static/app.js`, `hr-platform/agent/livekit_agent.py`
- Status: COMPLETED

## v0.11.0 — Adversarial Security Integration & Test Suite Hardening (2026-07-13)
- [ADDED]: Integration validation for all 8 security threat phases of the TalentStream platform.
- [FIXED]: Resolved MagicMock JSON serialization issue by explicitly declaring candidate properties during FastAPI router encoding.
- [FIXED]: Resolved database `NotNullViolation` integrity constraint error by creating job and candidate mock entities prior to Celery audio tasks.
- [FIXED]: Corrected SSE server-sent events connection check path to `/api/sse/batch/{id}` and stream connection management.
- [ADDED]: Fully populated test checklists (`TEST_CHECKLIST.md`), comprehensive audit logs (`TEST_RESULTS.md`), and updated testing guidelines (`TESTING_GUIDE.md`).
- Files: `hr-platform/test_platform.py`, `test_platform.py`, `docs/TEST_RESULTS.md`, `docs/TEST_CHECKLIST.md`, `docs/TESTING_GUIDE.md`
- Reason: Finalize adversarial testing gates, achieve 100% test pass rate, and document audit trails.
- Status: COMPLETED

## v0.10.0 — Deterministic LLM Inference Configuration Lock (2026-07-10)
- [ADDED]: Hardcoded finalized model parameters (`temperature` and `seed`) across all LLM call sites (BB1-BB6, LiveKit).
- [ADDED]: Mandatory architect-review comment blocks directly above LLM call sites to prevent configuration drift.
- [MODIFIED]: Indentation and code formatting cleanups in `backend/workers/tasks.py` and `backend/main.py`.
- [MODIFIED]: Synchronized prompts library definitions in `prompts/` and `docs/bhagavadgeetha.md` Section 13 & Section 4.
- [ADDED]: ADR-015 in `implementation/decisions.md` documenting LLM configuration lock.
- Files: `hr-platform/backend/main.py`, `hr-platform/backend/workers/tasks.py`, `hr-platform/agent/livekit_agent.py`, `docs/bhagavadgeetha.md`, `prompts/*`, `implementation/decisions.md`
- Reason: Enforce deterministic pipelines and guarantee reproducible candidate evaluations.
- Status: COMPLETED

## v0.9.0 — Resume Failure Pipeline Hardening & Manual Review Workflow (2026-07-09)
- [ADDED]: Secure endpoint `GET /api/candidates/{id}/resume-url` to generate presigned S3 URLs for viewing original resumes.
- [ADDED]: Candidate status transitions for `failed` and `manual_reviewed` in status updating endpoint.
- [ADDED]: Red-dashed visual indicator styling for `failed` (`failed-card`) and `unable_to_process` (`unable-to-process-card`) candidate states.
- [ADDED]: Inline "View Resume" button on card layouts for ingestion-failed candidates to directly review their resumes.
- [ADDED]: Safe original resume viewer container inside Resume Tab in Panel 3, dynamically fetching presigned URLs and embedding them in frames.
- [ADDED]: Ingestion error logs representation in Resume Tab detailing parsing errors and raw LlamaParse extracts.
- [ADDED]: "Mark as Reviewed" action button for failed and unable-to-process candidates updating their status to `manual_reviewed`.
- [ADDED]: Custom overall summary review banner and verdict metrics for review states.
- [ADDED]: Server-side job association guardrail on resume upload API.
- Files: `hr-platform/backend/main.py`, `hr-platform/frontend/static/index.html`, `hr-platform/frontend/static/style.css`, `hr-platform/frontend/static/app.js`
- Reason: Stabilize resume upload pipeline, provide granular error diagnosis, and allow manual intervention for unparsed candidates.
- Status: COMPLETED

## v0.8.0 — Hybrid Pagination & Batch Ingestion Monitoring (2026-07-07)
- [ADDED]: Hybrid pagination bar below Panel 2 (candidate list) with previous, page numbers, ellipsis pagination, next, page status info, "Jump to page" direct input, and "Show All" toggle.
- [ADDED]: Real-time SSE batch upload progress monitoring inside upload modal (percent progress bar, files list status labels for uploading, parsing, scoring, success/failed states).
- [ADDED]: Persistence and retrieval of last batch status for active job with details panel toggle.
- [ADDED]: Success/failure reporting endpoint `/api/uploads/batches/{batch_id}/log-failure` and batch log ingestion updates.
- [ADDED]: Post-modal close summary toast reporting ingestion counts (processed, failed, processing).
- - Files: `hr-platform/frontend/static/app.js`, `hr-platform/frontend/static/index.html`, `hr-platform/backend/main.py`
- - Reason: Enable large resume corpus ingestion visibility and easy list navigating for HR recruiters.
- - Status: COMPLETED

## v0.7.2 — Resume Upload Zone Redesign (2026-07-07)
- [MODIFIED]: Replaced simple emoji placeholder file upload zone in the upload modal with a premium, matured dashed upload card featuring a custom SVG upload icon, clear file format instructions, and a hover translation/color scale effect.
- Files: `hr-platform/frontend/static/index.html`, `hr-platform/frontend/static/style.css`
- Reason: Improve UI visual appeal and user guidance during resume uploads.
- Status: COMPLETED

## v0.7.1 — Empty State Card Redesign (2026-07-07)
- [MODIFIED]: Replaced simple emoji placeholder empty state in the detail panel (Panel 3) with a premium, matured card layout containing an SVG graphic, clear typography, and key action checklist highlights.
- Files: `hr-platform/frontend/static/index.html`, `hr-platform/frontend/static/style.css`
- Reason: Modernize Empty Panel visual presentation and improve user guidelines.
- Status: COMPLETED

## v0.7.0 — Light Theme Migration (2026-07-07)
- [MODIFIED]: Migrated global theme variables in `style.css` to a high-contrast professional light theme palette (slate-50 background, white panels/cards, slate-100 sidebar).
- [MODIFIED]: Replaced hardcoded dark-mode hex values in `app.js` with semantic CSS class bindings and standard light theme color mappings (e.g. blue/green/red score values and SVG rings).
- [MODIFIED]: Standardized bottom footer action buttons (Shortlist, Invite, Reject, Hire) into semantic classes (`btn-shortlist`, `btn-invite`, `btn-reject`, `btn-success`) in `app.js` and `index.html`.
- [MODIFIED]: Updated tab navigation (active/inactive states, active top border highlight) and scrollbars to match the light theme design system.
- Files: `hr-platform/frontend/static/index.html`, `hr-platform/frontend/static/style.css`, `hr-platform/frontend/static/app.js`
- Reason: Modernize visual look, improve usability and text contrast for HR users.
- Status: COMPLETED

## v0.6.1 — UI Refinements & Layout Persistence (2026-07-07)
- [ADDED]: 3-panel drag resizing with hover state highlight borders and localStorage persistence across reloads.
- [ADDED]: "Upload Resumes" secondary button in candidate list filters opening a dedicated resume upload modal.
- [MODIFIED]: Candidates list drag-and-drop zone moved into the Upload Resumes modal to clean up primary workspace.
- [MODIFIED]: Candidate cards redesigned to be compact (<100px height) featuring name initials avatars, status dots, and 32px score circles.
- [MODIFIED]: Theme variables, input text colors, active job item background, active tab states, and detail empty states styled using Slate theme.
- [FIXED]: Fixed css background-clip compatibility warning.
- Files: `hr-platform/frontend/static/index.html`, `hr-platform/frontend/static/style.css`, `hr-platform/frontend/static/app.js`
- Reason: Improve usability, reduce visual clutter, allow customizable panel sizes, and align dashboard with defined dark mode palette.
- Status: COMPLETED

## v0.5.1 — Agent Standards Update (2026-07-07)
- [ADDED]: Section 13 (MANDATORY: Auto-Update Tracking Files) and Section 14 (Compliance Checks) in `agent.md`
- [MODIFIED]: `.gitignore` to include env, cache, and build files
- Files: `hr-platform/agent/agent.md`, `.gitignore`
- Reason: Enforce tracking documentation and agent behavior constraints.
- Status: COMPLETED

## v0.1.0 — Initial Architecture Lock (2026-07-06)
- Locked 6 Black Box pipeline (BB1-BB6)
- Locked 5-container docker-compose topology
- Locked database schema (jobs, candidates, interviews, notes)
- Locked model assignments: GPT-4o-mini (formatting+scoring), GPT-4o (weights)

## v0.2.0 — Model Comparative Study (2026-07-06)
- Compared GPT-4o-mini vs GPT-4.1 mini vs Gemini 2.5 Flash
- Decision: KEEP GPT-4o-mini for formatting+scoring (seed=42 determinism)
- Decision: GPT-4o for weight setting (seed=42 + strong reasoning)

## v0.3.0 — Edge Cases Audit & Fixes (2026-07-07)
- Audited 10 edge cases against architecture
- Fixed 6 issues: latest_interview_id, reconnecting status, Redis room timestamp, FFmpeg command, agent lifecycle, rate limiting
- Updated architecture.md and talentstream_architecture_master.md

## v0.4.0 — Agent Coding Standards (2026-07-07)
- Created agent/agent.md with implementation rules
- Phase-by-phase protocol locked
- Forbidden actions defined

## v0.5.0 — Environment & DevEx (2026-07-07)
- Created .env.example with all 13 sections
- Created start.sh / stop.sh with docker compose auto-detection

## v0.6.0 — UI Improvements (2026-07-07)
- [FIXED]: Fixed button visibility, hover states, disabled states, and styling.
- [FIXED]: Fixed Shortlist/Invite/Reject/Hire pipeline, including dynamic footer buttons, button spinners, loading states, and 5-min invitation lockout.
- [FIXED]: Fixed sidebar Job Tree to support collapsable accordion folders for Open/Closed jobs with counts and rotation animation.
- [FIXED]: Added color-coded circular candidate score badges.
- [FIXED]: Polished Panel 3 tab layout and active tab borders.
- Files: `hr-platform/frontend/static/index.html`, `hr-platform/frontend/static/style.css`, `hr-platform/frontend/static/app.js`
- Status: COMPLETED
