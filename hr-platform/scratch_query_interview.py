from query_db import SessionLocal
from backend.db.models import Interview

db = SessionLocal()
interviews = db.query(Interview).all()
found = False
for i in interviews:
    if i.transcript:
        print(f"Interview {i.id} (Candidate {i.candidate_id}) has transcript with {len(i.transcript)} messages.")
        found = True
if not found:
    print("No interviews have any messages in transcript.")
