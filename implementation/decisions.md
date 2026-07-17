# TalentStream Architecture Decisions

## ADR-001: Model Selection for Formatting (BB2-B)
- Context: Need strict JSON schema adherence
- Options: GPT-4o-mini, GPT-4.1 mini, Gemini 2.5 Flash
- Decision: GPT-4o-mini
- Rationale: seed=42 documented, 2+ years production validation
- Status: LOCKED

## ADR-002: Model Selection for Scoring (BB3)
- Context: Need deterministic fair evaluation
- Options: GPT-4o-mini, GPT-4.1 mini, Claude 3.5 Haiku
- Decision: GPT-4o-mini
- Rationale: temperature=0 + seed=42 = reproducible scores
- Status: LOCKED

## ADR-003: Room Creation Timing
- Context: 35-min LiveKit hard limit
- Options: At invite send vs at START click
- Decision: START click
- Rationale: No idle costs, fresh window, simpler state machine
- Status: LOCKED

## ADR-004: UI Button Styling
- Context: Buttons invisible to HR
- Decision: Apply border-radius, padding, color-coded states
- Status: LOCKED

## ADR-005: 3-Panel Resizable Layout
- Context: Need adjustable Outlook-style resizable workspace
- Decision: Add mouse-drag event resizing with localStorage persistence
- Status: LOCKED

## ADR-006: Compact Candidate Card Representation
- Context: Dense view of candidate lists under 100px height
- Decision: Render compact row with initials avatar, status dot, candidate name, email, and 32px score badge
- Status: LOCKED

## ADR-007: Modality for Resume Uploads
- Context: Clean up middle workspace from drag-and-drop zone clutter
- Decision: Move drag-and-drop file upload into a modal overlay triggered via button
- Status: LOCKED

## ADR-008: Light Theme Palette
- Context: Dark mode had poor contrast and readability for recruitment specialists.
- Decision: Migrate all global colors to light theme palette (slate-50 background, white cards, slate-100 sidebar, slate-200 borders, blue/green/red highlights).
- Status: LOCKED

## ADR-009: Action Button Refactor
- Context: Footer action buttons were hardcoded and coupled dynamically in JS.
- Decision: Refactor all button bindings to semantic CSS classes (`btn-shortlist`, `btn-invite`, `btn-reject`, `btn-success`) to decouple UI layout from event logic.
- Status: LOCKED

## ADR-010: Empty State Card Redesign
- Context: Replaced bare emoji placeholder inside right panel (Panel 3).
- Decision: Build a high-fidelity card container with a custom SVG vector graphic outline, title description, and colored checklist indicators.
- Status: LOCKED

## ADR-011: Resume Upload Zone Redesign
- Context: Replaced bare emoji placeholder inside resume upload modal.
- Decision: Build a high-fidelity dashed card containing a custom SVG file-upload graphic, clear user text, formatted browse link, and hover animation triggers.
- Status: LOCKED

## ADR-012: Hybrid Pagination Strategy
- Context: Large batches of resume uploads require scalable, performant pagination without losing order stability when active ingestion is running.
- Decision: Implement cursor-based stable querying on the backend, translate page numbers to cursors at the API gateway layer, and present standard page controls on the frontend.
- Status: LOCKED

## ADR-013: SSE-based Batch Upload Progress Ingestion
- Context: Bulk resume ingestion requires real-time feedback for recruiters on the processing status of each file in the batch.
- Decision: Implement a batch-specific EventSource endpoint `/api/sse/batch/{batch_id}` broadcasting state transitions from celery workers to the frontend, updating a progress bar, per-file status cards, and a toggleable inline details panel.
- Status: LOCKED

## ADR-014: Resume Ingestion Failure Hardening & Manual Review Pipeline
- Context: Resume parsing and AI formatting failures can happen because of bad files or validation errors. Recruiters need a clear way to see failed files, review them directly, and manually override/approve them to resume active evaluation.
- Decision: Standardize on 'failed' (unreadable/corrupt files) and 'unable_to_process' (AI validation failure after 3 retries) states. Style failed candidate cards with red dashed borders, display detailed error parsing/ingestion messages in the resume matching report, fetch original resume PDF via S3 presigned URL inside an iframe in Panel 3 for immediate review, and add a 'Mark as Reviewed' action button updating status to 'manual_reviewed' so they can be re-routed into the pipeline.
- Status: LOCKED

## ADR-015: Deterministic LLM Inference Configuration Lock
- Context: Ensure highly reproducible scoring and evaluation outcomes across all engine-specific LLM calls.
- Decision: Hardcode model parameter configurations (temperature, seed, model type) as defined in the master architectural table:
  - BB1 Job Rubric: temperature=0.1, seed=42
  - BB2-B Resume Parser: temperature=0, seed=42
  - BB3 Resume Scorer: temperature=0.1, seed=42
  - LiveKit Voice Agent: temperature=0.3, seed=none
  - BB5-A Technical Scorer: temperature=0.1, seed=42
  - BB5-B Behavioral Scorer: temperature=0.2, seed=42
  - BB6 Summary Generator: temperature=0.4, seed=42
  To enforce this, insert standardized architect-review comments directly above each call block.
- Status: LOCKED

## ADR-016: Test Suite Hardening & Integration Integrity Controls
- Context: Ensure the test suite handles database constraint validations, Pydantic response JSON serialization boundaries, and correct streaming content types without crashes or false positives.
- Decision: Apply the following architectural rules in test suites:
  1. *Relational Linkage:* Always instantiate and link mock parent models (`Job` and `Candidate`) inside PostgreSQL before creating dependent child records (such as `Interview`) to prevent relational database constraint exceptions.
  2. *Strict Mock Attribute Assignment:* Explicitly declare properties on mock objects passed through API serialization endpoints to bypass JSON encoding errors on unconfigured `MagicMock` instances.
  3. *Socket stream connection checks:* Validate stream connection checks against `/api/sse/batch/{id}` using stream-friendly configurations to check response headers without locking client request ports.
- Status: LOCKED

## ADR-017: Interview Status Tracker & CustomVoiceAgent Safety Refinements
- Context:
  1. Recruiters need a visual timeline in the candidate detail panel's header to track candidate progress (Invite Link Sent, Interview Started or No Show, and Interview Completed).
  2. The custom voice agent needs to run safely without read-only attribute errors on `session` and without crashing WebRTC rooms during violation warnings.
- Decision:
  1. Implement a collapsible vertical stepper (`.status-tracker`) in the candidate profile header toggled by a new "#btn-interview-status" button. The tracker maps the candidate's database statuses (`interview_invited`, `interview_ongoing`, `interview_completed`, `rejected_post_interview`, `hired`) to 3 distinct visual milestones, highlighting "No Show" if they haven't started.
  2. Override `session` in the custom agent using a private getter referencing a private attribute to prevent read-only property mutation errors during instantiation. Execute warnings and termination checks against a local state dictionary instead of calling violation tracker state to maintain connection safety.
- Status: LOCKED

## ADR-018: Middle Panel Top Section Expand & Collapse Toggling
- Context:
  1. Recruiter feedback indicated that when multiple resumes are being uploaded, parsed, or evaluated, the active job details header (`#active-job-info`) and the ingestion progress summary (`#upload-batch-summary`) occupy a large amount of vertical space.
  2. This pushes the candidate card list downward, reducing overall visibility.
  3. Furthermore, when the search header shifts up or down during toggles, it displaces the Collapse/Expand button, forcing recruiters to scan the screen to relocate it.
- Decision:
  1. Statically declare `<header class="search-header">` at the very top of the middle panel, with `#active-job-info` and `#upload-batch-summary` positioned directly below it.
  2. Shrink search input and filter/sorting controls to a compact `32px` row layout to maximize the screen real estate allocated to candidate cards.
  3. Place the Expand/Collapse button (`#btn-toggle-top-section`) in a fixed position on this top row, so it remains in the exact same location regardless of the collapsed/expanded state.
  4. Use a CSS-driven approach: when collapsed, append the class `.top-collapsed` to `#middle-panel` to hide both `#active-job-info` and `#upload-batch-summary` and rotate the chevron icon.
  5. Store the collapsed/expanded state in `localStorage` (`middle-top-collapsed`).
- Status: LOCKED



