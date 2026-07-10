# TalentStream: AI-Driven HR Assessment & Screening Platform

TalentStream is an automated recruitment system designed to streamline high-volume hiring pipelines. The platform ingests resumes, analyzes them against semantic match requirements, manages live voice calls, evaluates speech patterns, and generates comprehensive candidate reports.

---

## 1. Tech Stack Summary

* **Frontend:** Vanilla HTML5, Vanilla JavaScript (ES6+), CSS, HSL design system.
* **Backend Gateway:** FastAPI (Python 3.11+), Pydantic validation, SQLAlchemy.
* **Task Queuing & Async Workers:** Celery with Redis Broker.
* **Database & Caching:** PostgreSQL, Redis (Key-value cache & Pub/Sub).
* **Object Store:** MinIO/S3 Cloud (boto3 integration).
* **AI Integrations:** OpenAI (GPT-4o/GPT-4o-mini), smallest.ai (STT & tone analysis), LlamaParse Cloud API.
* **Live Communications:** LiveKit Cloud.

---

## 2. Repository Folder Structure

```
/
├── architecture/
│   ├── architecture.md                  # Locked system specification
│   ├── design.md                        # UI layouts & pipeline blocks
│   ├── mermaid.md                       # System diagrams & flows
│   └── talentstream_architecture_master.md # Comprehensive master architecture
├── docs/
│   ├── README.md                        # Project read-me & startup instructions
│   └── bhagavadgeetha.md                # System workflows & detailed guides
├── hr-platform/                         # Web Application codebase (backend & frontend)
└── implementation/
    ├── implementation-plan.md           # Development phase guidelines
    └── todo.md                          # Granular task lists per phase
```

---

## 3. How to Run Locally

### Prerequisites
* Install Docker and Docker Compose on your system.
* Configure your local environment variables in a `.env` file at the root:
  ```env
  API_ENV=production
  API_PORT=8000
  SECRET_KEY=your_secret_key
  DATABASE_URL=postgresql://postgres:pass@db:5432/talentstream
  REDIS_URL=redis://redis:6379/0
  S3_ENDPOINT=your_s3_endpoint
  S3_ACCESS_KEY=your_s3_access_key
  S3_SECRET_KEY=your_s3_secret_key
  S3_BUCKET_NAME=hr-talentstream-storage
  LIVEKIT_URL=wss://livekit.provided.com
  LIVEKIT_API_KEY=your_livekit_key
  LIVEKIT_SECRET=your_livekit_secret
  OPENAI_API_KEY=sk-your_openai_key
  LLAMAPARSE_API_KEY=your_llamaparse_key
  SMALLEST_AI_API_KEY=your_smallest_key
  SENDGRID_API_KEY=SG.your_sendgrid_key
  DAILY_RESUME_LIMIT=50
  MAX_INTERVIEW_DURATION_MINS=35
  CELERY_STALE_CHECK_INTERVAL_SEC=1800
  ```

### Start the Services
1. Compile and start the containers using Docker Compose:
   ```bash
   docker-compose up --build -d
   ```
2. Verify all 5 services start successfully.
3. Access the web interface at `http://localhost:8000` (served directly by FastAPI).
4. Monitor FastAPI API Swagger docs at `http://localhost:8000/docs`.

---

## 4. Contributing & Development Flow
* **Phase Alignment:** The project is locked down to sequential development phases. Do not implement code for any phase until the preceding phase's verification checks have passed.
* **No Spec Edits:** Do not modify the files in `/architecture/` without approval.
* **Verification (Smoke Testing):** Follow the smoke testing script at the end of each phase implementation step. Run it locally and log the results before moving ahead.

