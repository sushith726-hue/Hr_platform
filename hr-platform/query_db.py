import os
import sys
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from backend.config import settings
from backend.db.models import Candidate, Interview, Job

engine = create_engine(settings.DATABASE_URL)
SessionLocal = sessionmaker(bind=engine)
db = SessionLocal()

print("--- JOBS ---")
jobs = db.query(Job).all()
for j in jobs:
    print(f"Job {j.id}: {j.title}")

print("\n--- CANDIDATES ---")
cands = db.query(Candidate).all()
for c in cands:
    print(f"Candidate {c.id}: {c.name} (Job: {c.job_id}) - Status: {c.status} - Overall: {c.overall_score} - Verdict: {c.ai_verdict}")

print("\n--- INTERVIEWS ---")
interviews = db.query(Interview).all()
for i in interviews:
    print(f"Interview {i.id} (Candidate: {i.candidate_id}): Status: {i.status} - room_id: {i.room_id} - voice_ogg_url: {i.voice_ogg_url} - vic: {i.vic_score} - bc: {i.bc_score}")
