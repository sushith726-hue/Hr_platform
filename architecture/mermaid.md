# TalentStream HR Platform: Mermaid Diagrams

This document contains Mermaid diagrams visualizing the architecture, database schema, pipelines, and state transitions of the TalentStream HR Platform.

---

## 1. System Architecture Diagram

```mermaid
graph TD
    classDef client fill:#dbeafe,stroke:#2563eb,stroke-width:2px;
    classDef server fill:#fef3c7,stroke:#d97706,stroke-width:2px;
    classDef storage fill:#d1fae5,stroke:#059669,stroke-width:2px;
    classDef ext fill:#f3e8ff,stroke:#7c3aed,stroke-width:2px;

    %% Elements
    API[FastAPI Gateway Container]:::server
    AIWorker[AI Worker Container]:::server
    AudioWorker[Audio Worker Container]:::server
    Postgres[(PostgreSQL DB)]:::storage
    Redis[(Redis DB/Queue/PubSub)]:::storage
    S3[(MinIO/S3 Cloud Storage)]:::storage
    OpenAI[OpenAI API]:::ext
    SmallestAI[Smallest.ai STT API]:::ext
    LiveKit[LiveKit Cloud]:::ext
    LlamaParse[LlamaParse Cloud API]:::ext
    SendGrid[SendGrid Email API]:::ext

    %% Connections
    API -->|Read/Write Metadata| Postgres
    API -->|Write Jobs / Store Cache| Redis
    API -->|Write/Read Audio & PDF Files| S3
    
    API -->|Trigger Task| Redis
    Redis -->|Dispatch Task| AIWorker
    Redis -->|Dispatch Task| AudioWorker

    AIWorker -->|BB2-A: Parse Resume| LlamaParse
    AIWorker -->|BB2-B & BB3: Format & Score| OpenAI
    AIWorker -->|Update Status| Postgres

    AudioWorker -->|BB5: Transcribe & Metrics| SmallestAI
    AudioWorker -->|BB5: Tone Analysis| OpenAI
    AudioWorker -->|Save Scores| Postgres
    AudioWorker -->|Read Raw/Write Split| S3

    API <-->|WebRTC Signaling| LiveKit
    API -->|Send Invite| SendGrid
```

---

## 2. Database Entity-Relationship Diagram

```mermaid
erDiagram
    jobs ||--o{ candidates : "has"
    candidates ||--o{ interviews : "undergoes"
    candidates ||--o{ notes : "receives"
    jobs ||--o{ interviews : "spawns"
    jobs ||--o{ notes : "references"

    jobs {
        uuid id PK
        varchar title
        varchar department
        text jd
        text rvc
        text vic
        text bc
        jsonb rubric_json
        varchar status
        timestamp created_at
    }

    candidates {
        uuid id PK
        uuid job_id FK
        varchar name
        varchar email
        varchar phone
        varchar location
        jsonb skills
        integer experience_years
        jsonb education
        varchar resume_url
        jsonb raw_json
        jsonb clean_json
        text parse_error_log
        decimal match_score
        jsonb match_breakdown
        varchar ai_recommendation
        decimal overall_score
        varchar ai_verdict
        varchar report_pdf_url
        varchar status
        timestamp created_at
        timestamp updated_at
    }

    interviews {
        uuid id PK
        uuid candidate_id FK
        uuid job_id FK
        uuid invite_token
        timestamp invite_expires_at
        varchar room_id
        varchar room_url
        varchar token
        varchar status
        varchar recording_url
        varchar voice_ogg_url
        text transcript
        jsonb transcript_json
        jsonb vic_scores
        jsonb bc_scores
        decimal overall_score
        varchar ai_verdict
        timestamp scheduled_at
        timestamp started_at
        timestamp completed_at
    }

    notes {
        uuid id PK
        uuid candidate_id FK
        uuid job_id FK
        uuid hr_user_id
        text text
        timestamp created_at
    }
```

---

## 3. Resume Ingestion & Parsing Flow

```mermaid
flowchart TD
    A[HR Drops Resume File] --> B[POST /api/candidates/upload]
    B --> C[Save File to S3 Bucket resumes/]
    C --> D[Create Candidate Row status=uploaded]
    D --> E[Enqueue Celery Job]
    E --> F[Worker: BB2-A LlamaParse Agentic parsing]
    F --> G{Success?}
    G -->|Yes| H[BB2-B GPT-4o-mini JSON Formatter & BB2-C Pydantic check]
    H -->|Success: status=structured| I[BB3 Score & Match: bias stripping + rubric_json scoring]
    I --> J[Update Candidate match_score, status=new]
    J --> K[Broadcast SSE Event: candidate_ready]
    G -->|No| L[Set status=failed, save parse_error_log]
    H -->|Fail 3 times| M[Set status=unable_to_process, save parse_error_log]
    L --> N[Broadcast SSE Event: parse_failed]
    M --> N
    N --> O[HR selects card & reviews original resume PDF in iframe]
    O --> P[HR clicks Mark as Reviewed in detail footer]
    P --> Q[PATCH /api/candidates/{id}/status status=manual_reviewed]
    Q --> R[Update Candidate status=manual_reviewed & re-route into pipeline]
```

---

## 4. Live AI Interview Flow

```mermaid
sequenceDiagram
    autonumber
    actor Cand as Candidate
    participant UI as Candidate Screen
    participant API as FastAPI Gateway
    participant Redis as Redis Cache
    participant LK as LiveKit Cloud
    participant AI as AI Agent Process

    Cand->>UI: Opens /interview/{invite_token}
    API->>UI: Serve Jinja2 templates (Candidate name, job details)
    Cand->>UI: Clicks [START INTERVIEW]
    UI->>API: POST /api/interviews/start (invite_token)
    API->>Redis: Validate & mark invite_token as USED
    API->>LK: Create room, generate connection token
    API->>API: Spawns AI Agent (room_id, candidate_id, job_id)
    API-->>UI: Return room_url & LiveKit token
    UI->>LK: Join WebRTC room
    LK-->>UI: Connect media channels (Audio exchange)
    
    %% Real-time QA Loop
    Loop Interview Questions (max 30 mins)
        AI->>LK: Speak next question
        LK->>UI: Stream audio to candidate
        Cand->>LK: Voice response
        LK->>AI: Stream candidate audio
    End

    Cand->>UI: Hangs up or timer expires (30 min AI wrap, 35 min LiveKit hard limit)
    LK->>API: Webhook (room-closed)
```

---

## 5. Audio Processing & Behavioral Analysis Pipeline

```mermaid
flowchart TD
    A[LiveKit Recording Saved] --> B[Webhook: room-closed]
    B --> C[Trigger Audio-Worker task]
    C --> D[FFmpeg: Isolate candidate track, compress to mono candidate_voice.ogg]
    D --> E[Upload Candidate-Only track to S3 user_voice/]
    E --> F[Call smallest.ai STT API on isolated candidate track]
    F --> G[Extract Transcript, WPM, pauses, and filler word count]
    G --> H[Call OpenAI GPT-4o-mini with transcript & audio metrics]
    H --> I[Assess Vocal Tone, Hesitation, Confidence & VIC accuracy]
    I --> J[Compute Final VIC & BC scores]
    J --> K[Write to Database interviews table]
    K --> L[Trigger BB6 Final Report Task]
    L --> M[Generate ReportLab PDF, upload to S3 reports/]
    M --> N[Update Candidate status=completed, overall_score, ai_verdict]
    N --> O[Broadcast SSE Event: analysis_complete]
```

---

## 6. Real-Time Communication Strategy (SSE vs WebSockets vs Webhook)

```mermaid
flowchart TD
    subgraph Client [Frontend UI]
        SSE_Listener[EventSource SSE]
        HTTP_RPC[HTTP POST RPC Client]
    end

    subgraph Backend [FastAPI Server]
        SSE_End[SSE /api/sse/*]
        RPC_End[RPC /api/jobs or /api/candidates]
        PubSub[Redis Pub/Sub Channel]
    end

    subgraph Workers [Background Workers]
        WorkerA[AI Worker Celery]
        WorkerB[Audio Worker Celery]
    end

    HTTP_RPC -->|Trigger actions e.g. upload resume| RPC_End
    RPC_End -->|Publish Event| PubSub
    WorkerA -->|Publish Event when done| PubSub
    WorkerB -->|Publish Event when done| PubSub
    PubSub -->|Stream Events| SSE_End
    SSE_End -.->|Push Notifications| SSE_Listener
```

---

## 7. Responsive Layout State Diagram

```mermaid
stateDiagram-v2
    [*] --> Desktop : Resolution >= 1024px
    Desktop --> Tablet : Resize < 1024px
    Tablet --> Mobile : Resize < 768px

    state Desktop {
        [*] --> ThreePanels
        ThreePanels : Panel 1: Sidebar tree always visible
        ThreePanels : Panel 2: Candidates list always visible
        ThreePanels : Panel 3: Details tabs main display
    }

    state Tablet {
        [*] --> CollapsedSidebar
        CollapsedSidebar --> ExpandedSidebar : Click Menu / Hamburger
        ExpandedSidebar --> CollapsedSidebar : Click Outside / Close
        CollapsedSidebar : Panel 1: Collapsed to Hamburger
        CollapsedSidebar : Panels 2 & 3: Visible side-by-side
    }

    state Mobile {
        [*] --> CandidateListView
        CandidateListView --> DetailView : Select Candidate card
        DetailView --> CandidateListView : Click Back Button
        CandidateListView : Single-column displaying candidate list
        DetailView : Single-column candidate resume details
    }
```
