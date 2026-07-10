# TalentStream HR Platform Workspace

Welcome to the TalentStream repository. This workspace contains the complete codebase, system documentation, and architecture specifications for the AI-driven HR Assessment & Screening Platform.

---

## 📂 Directory Index & Navigation

### 1. Orchestration & Executables (Root)
*   [**`start.sh`**](file:///home/sushith/Desktop/hr_project/start.sh): The main execution script. Initializes `.env`, starts Docker Compose, monitors service health (FastAPI, Redis, Postgres), and outputs clickable URLs.
*   [**`stop.sh`**](file:///home/sushith/Desktop/hr_project/stop.sh): The shutdown script. Stops containers, with support for `./stop.sh --clean` to clear database volumes and prune images.
*   [**`hr-platform/e2e_test.py`**](file:///home/sushith/Desktop/hr_project/hr-platform/e2e_test.py): The 26-case end-to-end integration test validating the entire pipeline (job creation → resume parsing → status transitions → rate limiting → decision matching).

---

### 2. Documentation Index (`/docs` & `/architecture` & `/implementation`)

| Category | File | Description |
| :--- | :--- | :--- |
| **Onboarding** | [**`docs/README.md`**](file:///home/sushith/Desktop/hr_project/docs/README.md) | Technical setup guides, tech stack summaries, and quickstart commands. |
| **Workflows** | [**`docs/bhagavadgeetha.md`**](file:///home/sushith/Desktop/hr_project/docs/bhagavadgeetha.md) | The master system reference guide detailing business logic, database schemas, and data flow. |
| **System Spec** | [**`architecture/architecture.md`**](file:///home/sushith/Desktop/hr_project/architecture/architecture.md) | Locked architecture design specification. |
| **System Spec** | [**`architecture/talentstream_architecture_master.md`**](file:///home/sushith/Desktop/hr_project/architecture/talentstream_architecture_master.md) | Unified systems master specification document. |
| **UI & Pipeline** | [**`architecture/design.md`**](file:///home/sushith/Desktop/hr_project/architecture/design.md) | UI layout grids, interactive components, and pipeline step configurations. |
| **Diagrams** | [**`architecture/mermaid.md`**](file:///home/sushith/Desktop/hr_project/architecture/mermaid.md) | Complete flowchart and sequence diagrams for candidate and recruiter interactions. |
| **Implementation**| [**`implementation/implementation-plan.md`**](file:///home/sushith/Desktop/hr_project/implementation/implementation-plan.md) | Sequential development phases roadmap. |
| **Tasks** | [**`implementation/todo.md`**](file:///home/sushith/Desktop/hr_project/implementation/todo.md) | Granular phase checklists (Phases 1 to 9 fully checked and completed). |

---

### 3. Application Structure (`/hr-platform`)

```
hr-platform/
├── agent/
│   └── livekit_agent.py      # Real-time WebRTC AI interviewer voice bot
├── backend/
│   ├── main.py               # API Gateway & routes (FastAPI)
│   ├── config.py             # Config settings & rate limiting definitions
│   ├── db/
│   │   ├── models.py         # SQLAlchemy schemas (Job, Candidate, Interview)
│   │   └── session.py        # Database session lifecycle managers
│   └── workers/
│       ├── tasks.py          # Celery tasks (LlamaParse, OpenAI, smallest.ai)
│       └── __init__.py
├── frontend/
│   ├── static/
│   │   ├── index.html        # Recruiter Single-Pane Dashboard
│   │   ├── style.css         # Responsive mobile CSS design system
│   │   └── app.js            # Frontend DOM control & LiveKit hook
│   └── templates/
│       └── interview_landing.html  # Mobile-responsive interview portal
├── migrations/               # Alembic database revision files
├── requirements.txt          # Python dependencies
└── docker-compose.yml        # Docker Multi-container setup
```

---

## ⚡ Quickstart Commands

```bash
# 1. Start the entire system in one command (auto-handles .env bootstrap)
./start.sh

# 2. Run the full 26-case test suite to confirm backend and pipeline health
python3 hr-platform/e2e_test.py

# 3. Gracefully stop all containers
./stop.sh

# 4. Stop and delete database volumes for a clean state
./stop.sh --clean
```
