# TalentStream Platform System Prompts Review

This directory contains the exact LLM system and user prompts used across the TalentStream HR Platform. 

## Prompts Directory Index

| File | Purpose | Location in Codebase |
| --- | --- | --- |
| [01_rvc_to_rubric_generator.txt](file:///home/sushith/Desktop/hr_project/prompts/01_rvc_to_rubric_generator.txt) | Converts Resume Verification Criteria text to structured JSON | `backend/main.py` |
| [02_resume_data_extractor.txt](file:///home/sushith/Desktop/hr_project/prompts/02_resume_data_extractor.txt) | Extracts clean structured JSON profile from resume raw text | `backend/workers/tasks.py` |
| [03_candidate_scoring.txt](file:///home/sushith/Desktop/hr_project/prompts/03_candidate_scoring.txt) | Scores candidate profile against job criteria rubric | `backend/workers/tasks.py` |
| [04_live_voice_interviewer.txt](file:///home/sushith/Desktop/hr_project/prompts/04_live_voice_interviewer.txt) | Real-time voice agent role, context, and conversation rules | `agent/livekit_agent.py` |
| [05_interview_vic_technical_scorer.txt](file:///home/sushith/Desktop/hr_project/prompts/05_interview_vic_technical_scorer.txt) | Technical evaluation of interview transcripts | `backend/workers/tasks.py` |
| [06_interview_bc_behavioral_scorer.txt](file:///home/sushith/Desktop/hr_project/prompts/06_interview_bc_behavioral_scorer.txt) | Behavioral evaluation and fraud/anomaly integrity checks | `backend/workers/tasks.py` |
| [07_hiring_manager_summary_generator.txt](file:///home/sushith/Desktop/hr_project/prompts/07_hiring_manager_summary_generator.txt) | Generates executive 2-3 sentence recruiter recommendation summary | `backend/workers/tasks.py` |
