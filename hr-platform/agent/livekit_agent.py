#!/usr/bin/env python3
import asyncio
import argparse
import sys
import os
import time
import json
import logging
import redis

# Add project root to path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.db.session import SessionLocal
from backend.db.models import Candidate, Job, Interview
from backend.config import settings

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("livekit_agent")

def update_db_status(interview_id: int, candidate_id: int, interview_status: str, candidate_status: str):
    db = SessionLocal()
    try:
        interview = db.query(Interview).filter(Interview.id == interview_id).first()
        candidate = db.query(Candidate).filter(Candidate.id == candidate_id).first()
        if interview:
            if interview.status in ["completed", "failed"]:
                logger.info(f"Skipping DB status update to {interview_status} since current status is {interview.status}")
                return
            interview.status = interview_status
        if candidate:
            if candidate.status in ["interview_completed", "rejected_post_interview", "hired"]:
                logger.info(f"Skipping candidate status update to {candidate_status} since current status is {candidate.status}")
            else:
                candidate.status = candidate_status
        db.commit()
        logger.info(f"Updated DB: interview {interview_id} -> {interview_status}, candidate {candidate_id} -> {candidate_status}")
    except Exception as e:
        logger.error(f"Failed to update DB status: {e}")
        db.rollback()
    finally:
        db.close()

async def end_interview(interview_id: int, candidate_id: int, history, status: str):
    # Parse transcript to list of dicts
    transcript = []
    messages = []
    if history is not None:
        if hasattr(history, "messages"):
            if callable(history.messages):
                messages = history.messages()
            else:
                messages = history.messages
        elif hasattr(history, "items"):
            if callable(history.items):
                messages = history.items()
            else:
                messages = history.items
        elif hasattr(history, "get_messages"):
            if callable(history.get_messages):
                messages = history.get_messages()
        elif callable(history):
            messages = history()
        elif hasattr(history, "__iter__"):
            messages = history

    for msg in messages:
        role = getattr(msg, "role", "user")
        if role != "system":
            text = ""
            if hasattr(msg, "text_content"):
                text = msg.text_content
            elif hasattr(msg, "content"):
                if isinstance(msg.content, str):
                    text = msg.content
                elif isinstance(msg.content, list):
                    text = "\n".join(c for c in msg.content if isinstance(c, str))
            transcript.append({
                "role": role,
                "text": text or ""
            })
            
    db = SessionLocal()
    try:
        interview = db.query(Interview).filter(Interview.id == interview_id).first()
        candidate = db.query(Candidate).filter(Candidate.id == candidate_id).first()
        if interview:
            # Only update status if it is not already in a final state
            if interview.status not in ["completed", "analysis_complete", "recording_ready"]:
                interview.status = status
            interview.transcript = transcript
        if candidate:
            if status == "completed":
                if candidate.status not in ["interview_completed", "rejected_post_interview", "hired", "final_evaluation"]:
                    candidate.status = "interview_completed"
            else:
                if candidate.status not in ["interview_completed", "rejected_post_interview", "hired", "final_evaluation"]:
                    candidate.status = "rejected_post_interview"
        db.commit()
        logger.info(f"Saved transcript and updated interview {interview_id} status (requested: {status}).")
    except Exception as e:
        logger.error(f"Failed to save interview session: {e}")
        db.rollback()
    finally:
        db.close()

async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--room", required=True)
    parser.add_argument("--candidate-id", type=int, required=True)
    parser.add_argument("--job-id", type=int, required=True)
    parser.add_argument("--interview-id", type=int, required=True)
    args = parser.parse_args()
    
    room_name = args.room
    candidate_id = args.candidate_id
    job_id = args.job_id
    interview_id = args.interview_id
    
    # 1. START Phase: Fetch candidate and job info
    db = SessionLocal()
    try:
        candidate = db.query(Candidate).filter(Candidate.id == candidate_id).first()
        job = db.query(Job).filter(Job.id == job_id).first()
        interview = db.query(Interview).filter(Interview.id == interview_id).first()
        
        if not candidate or not job or not interview:
            logger.error("DB records not found for starting agent.")
            sys.exit(1)
            
        candidate_name = candidate.name or "Candidate"
        clean_json = candidate.structured_profile or {}
        jd = job.jd
        vic = job.vic
        bc = job.bc
    finally:
        db.close()
        
    system_prompt = (
        f"You are a professional, friendly AI recruiter conducting a live voice interview.\n"
        f"Candidate Name: {candidate_name}\n"
        f"Candidate Profile: {json.dumps(clean_json)}\n"
        f"Job Description: {jd}\n"
        f"Resume Verification Criteria: {vic}\n"
        f"Behavioral Criteria: {bc}\n\n"
        "Instructions:\n"
        "1. Welcome the candidate by name.\n"
        "2. Conduct a structured, natural interview assessing their skills, verification criteria, and behavioral alignment.\n"
        "3. Keep your questions clear and concise.\n"
        "4. Be encouraging, professional, and conversational. Do not reveal any grading rubric or internal scores.\n"
        "5. Keep the conversation moving."
    )
    
    from livekit import rtc
    from livekit.agents.voice import AgentSession, Agent
    from livekit.agents.llm import ChatContext, ChatMessage
    from livekit.plugins import openai
    
    # Generate livekit WebRTC Token for the Agent itself
    from livekit import api
    agent_token = api.AccessToken(settings.LIVEKIT_API_KEY, settings.LIVEKIT_API_SECRET or settings.LIVEKIT_SECRET) \
        .with_identity(f"agent_{interview_id}") \
        .with_name("AI Interviewer") \
        .with_grants(api.VideoGrants(
            room_join=True,
            room=room_name,
        )) \
        .to_jwt()
        
    r = redis.from_url(settings.REDIS_URL)
    
    room = rtc.Room()
    
    state = {
        "status": "WAITING",
        "timer_task": None,
        "elapsed_seconds": 0,
        "paused": True,
        "last_disconnect_time": None,
        "terminated": False
    }
    
    # Initialize Agent components
    stt = openai.STT()
    llm = openai.LLM(model=settings.OPENAI_MODEL_WEIGHTS) # gpt-4o as specified in agent.md
    tts = openai.TTS(voice="alloy")
    
    sys_msg = ChatMessage(role="system", content=[system_prompt])
    chat_ctx = ChatContext(items=[sys_msg])
    
    agent = Agent(
        instructions=system_prompt,
        chat_ctx=chat_ctx,
        stt=stt,
        llm=llm,
        tts=tts
    )
    
    session = AgentSession()
    
    # Heartbeat loop
    async def heartbeat_loop():
        while not state["terminated"]:
            try:
                r.set(f"room:{room_name}:last_heartbeat", str(int(time.time())), ex=120)
            except Exception as he:
                logger.error(f"Heartbeat logging failed: {he}")
            await asyncio.sleep(30)
            
    hb_task = asyncio.create_task(heartbeat_loop())
    
    # Interview Timer loop
    async def interview_timer_loop():
        # Wait until candidate joins (unpaused)
        while state["paused"] and not state["terminated"]:
            await asyncio.sleep(1)
            
        while state["elapsed_seconds"] < 1800 and not state["terminated"]:
            await asyncio.sleep(1)
            if not state["paused"]:
                state["elapsed_seconds"] += 1
                
                if state["elapsed_seconds"] == 1500: # 25 minutes
                    await session.say("We have 5 minutes remaining in our interview today. Let's make the most of it.")
                elif state["elapsed_seconds"] == 1680: # 28 minutes
                    await session.say("We have time for one final question.")
                    
        if not state["terminated"]:
            state["terminated"] = True
            logger.info("Timer expired. Wrapping up interview...")
            # Say goodbye and wait for it to finish
            await session.say("Thank you for your time. The interview is now complete. I will submit your answers for evaluation. Goodbye.").wait_for_playout()
            await end_interview(interview_id, candidate_id, session.history, "completed")
            
            # Close Room
            from livekit.api import LiveKitAPI, DeleteRoomRequest
            lk_api = LiveKitAPI(
                settings.LIVEKIT_URL,
                settings.LIVEKIT_API_KEY,
                settings.LIVEKIT_API_SECRET or settings.LIVEKIT_SECRET
            )
            try:
                await lk_api.room.delete_room(DeleteRoomRequest(room=room_name))
            except Exception as le:
                logger.error(f"Failed to delete room: {le}")
            finally:
                await lk_api.aclose()
                
            try:
                await session.aclose()
            except Exception as se:
                logger.error(f"Failed to close session: {se}")
                
            sys.exit(0)
            
    # Timeout for reconnecting
    async def wait_for_rejoin_timeout(disconnect_time):
        await asyncio.sleep(600) # 10 minutes
        if state["paused"] and state["last_disconnect_time"] == disconnect_time and not state["terminated"]:
            state["terminated"] = True
            logger.warning("Candidate failed to rejoin within 10 minutes. Terminating session.")
            await end_interview(interview_id, candidate_id, session.history, "failed")
            
            # Delete room
            from livekit.api import LiveKitAPI, DeleteRoomRequest
            lk_api = LiveKitAPI(
                settings.LIVEKIT_URL,
                settings.LIVEKIT_API_KEY,
                settings.LIVEKIT_API_SECRET or settings.LIVEKIT_SECRET
            )
            try:
                await lk_api.room.delete_room(DeleteRoomRequest(room=room_name))
            except Exception as le:
                logger.error(f"Failed to delete room on timeout: {le}")
            finally:
                await lk_api.aclose()
                
            try:
                await session.aclose()
            except Exception as se:
                logger.error(f"Failed to close session: {se}")
                
            sys.exit(2)

    @room.on("participant_connected")
    def on_participant_connected(participant: rtc.RemoteParticipant):
        logger.info(f"Participant connected: {participant.identity}")
        if participant.identity.startswith("candidate_"):
            if state["status"] == "WAITING":
                state["paused"] = False
                state["status"] = "INTERVIEWING"
                update_db_status(interview_id, candidate_id, "ongoing", "interview_ongoing")
                # session.say() returns a SpeechHandle (not a coroutine) — call directly
                session.say(f"Hello {candidate_name}, welcome to your interview. Let's begin.")
            elif state["status"] == "RECONNECTING":
                state["paused"] = False
                state["status"] = "INTERVIEWING"
                update_db_status(interview_id, candidate_id, "ongoing", "interview_ongoing")
                
                if state["last_disconnect_time"] is not None:
                    duration = time.time() - state["last_disconnect_time"]
                    offline_ms = int(duration * 1000)
                    r.delete(f"room:{room_name}:disconnect_time")
                    state["last_disconnect_time"] = None
                    
                    # Anti-Cheat Layer 2: flag SUSPICIOUS_RECONNECT if offline > 90 seconds
                    if duration > 90:
                        try:
                            from backend.db.models import InterviewEvent
                            event_db = SessionLocal()
                            try:
                                suspicious_event = InterviewEvent(
                                    interview_id=interview_id,
                                    event_type="SUSPICIOUS_RECONNECT",
                                    event_data={
                                        "offline_ms": offline_ms,
                                        "disconnect_reason": "CLIENT_INITIATED",
                                        "threshold_seconds": 90
                                    }
                                )
                                event_db.add(suspicious_event)
                                event_db.commit()
                                logger.warning(f"Anti-Cheat Layer 2: SUSPICIOUS_RECONNECT logged. Offline {duration:.0f}s for interview {interview_id}")
                            finally:
                                event_db.close()
                        except Exception as ace:
                            logger.error(f"Failed to log SUSPICIOUS_RECONNECT event: {ace}")
                    
                    if duration > 30:
                        # session.say() returns a SpeechHandle — call directly, no create_task
                        session.say(
                            "Welcome back. Let's continue — you were explaining your previous response."
                        )
                    else:
                        logger.info("Candidate reconnected within 30 seconds, resuming seamlessly.")
                        

    @room.on("participant_disconnected")
    def on_participant_disconnected(participant: rtc.RemoteParticipant):
        logger.info(f"Participant disconnected: {participant.identity}")
        if participant.identity.startswith("candidate_"):
            state["paused"] = True
            state["status"] = "RECONNECTING"
            state["last_disconnect_time"] = time.time()
            r.set(f"room:{room_name}:disconnect_time", str(int(state["last_disconnect_time"])), ex=600)
            update_db_status(interview_id, candidate_id, "reconnecting", "interview_ongoing")
            asyncio.create_task(wait_for_rejoin_timeout(state["last_disconnect_time"]))

    @room.on("disconnected")
    def on_disconnected():
        logger.info("Room disconnected event received.")
        if not state["terminated"]:
            state["terminated"] = True
            asyncio.create_task(end_interview(interview_id, candidate_id, session.history, "completed"))

    try:
        await room.connect(settings.LIVEKIT_URL, agent_token)
        logger.info(f"Agent connected to room {room_name}")
        
        await session.start(agent=agent, room=room)
        
        # Check if candidate is already in room
        candidate_already_in = False
        for identity in room.remote_participants.keys():
            if identity.startswith("candidate_"):
                candidate_already_in = True
                break
                
        if candidate_already_in:
            logger.info("Candidate is already in the room. Starting immediately.")
            state["paused"] = False
            state["status"] = "INTERVIEWING"
            update_db_status(interview_id, candidate_id, "ongoing", "interview_ongoing")
            # session.say() returns SpeechHandle — fire-and-forget, call directly
            session.say(f"Hello {candidate_name}, welcome to your interview. Let's begin.")
            
        state["timer_task"] = asyncio.create_task(interview_timer_loop())
        
        # Keep process running
        while not state["terminated"]:
            await asyncio.sleep(1)
            
    except Exception as e:
        logger.error(f"Error in running agent: {e}")
        state["terminated"] = True
        await end_interview(interview_id, candidate_id, session.history, "failed")
        sys.exit(1)

if __name__ == "__main__":
    asyncio.run(main())
