import os
import json
import math
import time
import re
from typing import List, Dict, Any, Optional
from pathlib import Path
from collections import Counter, defaultdict
from datetime import datetime

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from openai import OpenAI

from config import (
    EMBEDDINGS_MODEL,
    CHAT_MODEL,
    TOP_K_RESULTS,
    SYSTEM_PROMPT,
    MAX_HISTORY_TURNS,
    SESSION_TTL_SECONDS,
)

load_dotenv()

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5500",
        "http://127.0.0.1:5500",
        "https://gary-yong.com",
        "https://www.gary-yong.com",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Session memory store
# ---------------------------------------------------------------------------
SESSIONS_DIR = Path("sessions")
SESSIONS_DIR.mkdir(exist_ok=True)

# In-memory cache: session_id -> { history: [...], user_profile: {...}, last_active: timestamp }
session_store: Dict[str, Dict[str, Any]] = {}


def _session_path(session_id: str) -> Path:
    # Sanitize to prevent path traversal
    safe_id = "".join(c for c in session_id if c.isalnum() or c in ("_", "-"))
    return SESSIONS_DIR / f"{safe_id}.json"


def load_session(session_id: str) -> Dict[str, Any]:
    """Load or create a session. Checks in-memory cache first, then disk."""
    now = time.time()

    if session_id in session_store:
        sess = session_store[session_id]
        sess["last_active"] = now
        return sess

    # Try loading from disk
    path = _session_path(session_id)
    if path.exists():
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            sess = {
                "history": data.get("history", []),
                "user_profile": data.get("user_profile", {}),
                "last_active": now,
                "message_count": data.get("message_count", 0),
            }
            session_store[session_id] = sess
            return sess
        except Exception:
            pass

    # New session
    sess = {
        "history": [],
        "user_profile": {},
        "last_active": now,
        "message_count": 0,
    }
    session_store[session_id] = sess
    return sess


def save_session(session_id: str):
    """Persist session to disk."""
    if session_id not in session_store:
        return
    sess = session_store[session_id]
    path = _session_path(session_id)
    try:
        with open(path, "w", encoding="utf-8") as f:
            json.dump({
                "history": sess["history"],
                "user_profile": sess["user_profile"],
                "message_count": sess["message_count"],
            }, f, indent=2)
    except Exception as e:
        print(f"Warning: could not save session {session_id}: {e}")


def cleanup_old_sessions():
    """Remove expired sessions from memory (disk files persist for returning users)."""
    now = time.time()
    expired = [sid for sid, s in session_store.items()
               if now - s["last_active"] > SESSION_TTL_SECONDS]
    for sid in expired:
        save_session(sid)
        del session_store[sid]


def build_user_profile_summary(profile: Dict[str, Any]) -> str:
    """Build a short summary of what we know about this user."""
    parts = []
    if profile.get("name"):
        parts.append(f"Their name is {profile['name']}.")
    if profile.get("role"):
        parts.append(f"They work as/are interested in: {profile['role']}.")
    if profile.get("interests"):
        parts.append(f"They've shown interest in: {', '.join(profile['interests'])}.")
    if profile.get("context"):
        parts.append(f"Additional context: {profile['context']}.")
    return " ".join(parts) if parts else ""


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------
class ChatRequest(BaseModel):
    session_id: str
    message: str


class ChatResponse(BaseModel):
    answer: str
    sources: List[str]
    follow_up: Optional[str] = None  # Suggested follow-up question


# ---------------------------------------------------------------------------
# RAG index
# ---------------------------------------------------------------------------
def load_index() -> List[Dict[str, Any]]:
    path = "indexed_data.json"
    if not os.path.exists(path):
        print("Warning: indexed_data.json not found. Run index_data.py first.")
        return []
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


INDEX = load_index()


def embed_text(text: str) -> List[float]:
    resp = client.embeddings.create(
        model=EMBEDDINGS_MODEL,
        input=text,
    )
    return resp.data[0].embedding


def cosine_similarity(a: List[float], b: List[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)


def retrieve_context(query: str):
    if not INDEX:
        return "", []

    query_emb = embed_text(query)

    scored = []
    for item in INDEX:
        score = cosine_similarity(query_emb, item["embedding"])
        scored.append((score, item))

    scored.sort(key=lambda x: x[0], reverse=True)
    top = scored[:TOP_K_RESULTS]

    context_chunks = [item["text"] for score, item in top]
    sources = sorted({item["source"] for score, item in top})

    context_text = "\n\n---\n\n".join(context_chunks)
    return context_text, sources


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@app.get("/health")
def health():
    cleanup_old_sessions()
    return {"status": "ok", "active_sessions": len(session_store)}


@app.get("/admin/analytics")
def get_analytics(key: str = Query(...)):
    """Analytics endpoint for admin dashboard"""
    # Simple API key protection
    if key != "gary2026":
        raise HTTPException(status_code=401, detail="Invalid API key")
    
    try:
        analytics_data = generate_analytics()
        return analytics_data
    except Exception as e:
        print(f"Analytics error: {e}")
        raise HTTPException(status_code=500, detail="Failed to generate analytics")


def generate_analytics() -> Dict[str, Any]:
    """Generate analytics by reading all session files"""
    session_files = list(SESSIONS_DIR.glob("*.json"))
    
    total_conversations = len(session_files)
    all_messages = []
    message_counts = []
    first_questions = []
    topics = []
    time_hours = []
    
    for session_file in session_files:
        try:
            with open(session_file, 'r', encoding='utf-8') as f:
                session_data = json.load(f)
            
            history = session_data.get('history', [])
            message_count = session_data.get('message_count', len([msg for msg in history if msg.get('role') == 'user']))
            
            if message_count > 0:
                message_counts.append(message_count)
            
            # Extract user messages
            user_messages = [msg['content'] for msg in history if msg.get('role') == 'user']
            all_messages.extend(user_messages)
            
            # First question (first user message)
            if user_messages:
                first_questions.append(user_messages[0])
            
            # Extract timestamp from filename or file mtime for time analysis
            file_time = session_file.stat().st_mtime
            hour = datetime.fromtimestamp(file_time).hour
            time_hours.append(hour)
            
            # Topic extraction (simple keyword matching)
            for msg in user_messages:
                topics.extend(extract_topics(msg))
                
        except (json.JSONDecodeError, FileNotFoundError, KeyError):
            # Skip malformed session files
            continue
    
    # Calculate metrics
    avg_messages = sum(message_counts) / len(message_counts) if message_counts else 0
    completion_rate = (len([c for c in message_counts if c >= 5]) / len(message_counts)) * 100 if message_counts else 0
    
    # Time distribution (group into 4 periods)
    time_distribution = {
        "0-6": len([h for h in time_hours if 0 <= h < 6]),
        "6-12": len([h for h in time_hours if 6 <= h < 12]),
        "12-18": len([h for h in time_hours if 12 <= h < 18]),
        "18-24": len([h for h in time_hours if 18 <= h < 24])
    }
    
    # Message distribution
    message_distribution = {
        "1": len([c for c in message_counts if c == 1]),
        "2-3": len([c for c in message_counts if 2 <= c <= 3]),
        "4-5": len([c for c in message_counts if 4 <= c <= 5]),
        "6-10": len([c for c in message_counts if 6 <= c <= 10]),
        "11+": len([c for c in message_counts if c > 10])
    }
    
    # Popular topics (top 15)
    topic_counter = Counter(topics)
    popular_topics = [{"topic": topic, "count": count} 
                     for topic, count in topic_counter.most_common(15)]
    
    # Common first questions (top 10)
    question_counter = Counter(first_questions)
    common_first_questions = [{"question": q, "count": c} 
                             for q, c in question_counter.most_common(10)]
    
    # Recent conversations (last 20 by file modification time)
    recent_sessions = []
    sorted_files = sorted(session_files, key=lambda f: f.stat().st_mtime, reverse=True)
    
    for session_file in sorted_files[:20]:
        try:
            with open(session_file, 'r', encoding='utf-8') as f:
                session_data = json.load(f)
            
            history = session_data.get('history', [])
            user_messages = [msg['content'] for msg in history if msg.get('role') == 'user']
            first_message = user_messages[0] if user_messages else None
            message_count = session_data.get('message_count', len(user_messages))
            last_active = session_file.stat().st_mtime
            
            recent_sessions.append({
                "first_message": first_message,
                "message_count": message_count,
                "last_active": last_active
            })
        except:
            continue
    
    return {
        "total_conversations": total_conversations,
        "avg_messages": avg_messages,
        "completion_rate": completion_rate,
        "time_distribution": time_distribution,
        "message_distribution": message_distribution,
        "popular_topics": popular_topics,
        "first_questions": common_first_questions,
        "recent_conversations": recent_sessions
    }


def extract_topics(message: str) -> List[str]:
    """Extract topics/keywords from a message using simple keyword matching"""
    message_lower = message.lower()
    
    # Define topic keywords
    topic_keywords = {
        "experience": ["experience", "work", "job", "career", "worked", "role"],
        "ai": ["ai", "artificial intelligence", "machine learning", "ml", "automation"],
        "projects": ["project", "build", "built", "created", "developed", "work on"],
        "skills": ["skill", "technology", "tech", "programming", "code", "languages"],
        "capco": ["capco", "consulting"],
        "leadership": ["lead", "manage", "team", "leadership", "manager"],
        "education": ["education", "university", "degree", "study", "learn"],
        "python": ["python", "django", "flask"],
        "javascript": ["javascript", "js", "react", "node"],
        "data": ["data", "database", "sql", "analytics"],
        "cloud": ["cloud", "aws", "azure", "docker"],
        "finance": ["finance", "financial", "banking", "fintech"]
    }
    
    found_topics = []
    for topic, keywords in topic_keywords.items():
        if any(keyword in message_lower for keyword in keywords):
            found_topics.append(topic)
    
    return found_topics


@app.post("/chat", response_model=ChatResponse)
def chat(req: ChatRequest):
    # Load session
    sess = load_session(req.session_id)
    sess["message_count"] += 1
    msg_count = sess["message_count"]

    # Retrieve relevant context from RAG index
    context_text, sources = retrieve_context(req.message)

    # Build the profile summary
    profile_summary = build_user_profile_summary(sess["user_profile"])

    # Build conversation messages for the LLM
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]

    # Inject profile context if we know anything about the user
    if profile_summary:
        messages.append({
            "role": "system",
            "content": f"What you know about this visitor so far: {profile_summary}"
        })

    # Add conversation history (last N turns)
    history = sess["history"][-(MAX_HISTORY_TURNS * 2):]
    messages.extend(history)

    # Build the user message with RAG context
    user_content = f"Context about Gary:\n{context_text}\n\nUser message: {req.message}"

    # Progressive engagement hints based on conversation depth
    if msg_count == 1:
        user_content += (
            "\n\n[INSTRUCTION: This is the user's first message. Be warm and welcoming! "
            "After answering, naturally ask what brings them here or what they're most "
            "curious about regarding Gary. Keep it casual.]"
        )
    elif msg_count <= 3:
        user_content += (
            "\n\n[INSTRUCTION: Still early in the conversation. Build rapport. "
            "If appropriate, ask a casual question to learn more about what they need "
            "(e.g., are they a recruiter? a fellow dev? just curious?). "
            "Tailor your tone to what you're learning about them.]"
        )
    elif msg_count <= 6:
        user_content += (
            "\n\n[INSTRUCTION: You're getting to know this person. Reference earlier "
            "parts of the conversation if relevant. Offer deeper insights about Gary "
            "that connect to their interests. Be proactively helpful — suggest topics "
            "they might find interesting based on what you know about them.]"
        )
    else:
        user_content += (
            "\n\n[INSTRUCTION: You have a good rapport with this person now. Be a "
            "great conversationalist — reference the full conversation, make connections, "
            "proactively share relevant insights. You're not just answering questions, "
            "you're having a real conversation about Gary's career and experience.]"
        )

    messages.append({"role": "user", "content": user_content})

    # Also ask the model to extract profile info and a follow-up suggestion
    messages.append({
        "role": "system",
        "content": (
            "After your response, on a NEW LINE, output a JSON block wrapped in "
            "```json``` with two optional fields:\n"
            '- "profile_updates": an object with any new info you learned about the visitor '
            '(keys: "name", "role", "interests" (array), "context"). Only include fields you actually learned.\n'
            '- "follow_up": a short suggested follow-up question the user might want to ask next. '
            "Make it specific and interesting based on the conversation so far.\n"
            "If you have nothing to add, still include the json block with empty values.\n"
            "Example:\n```json\n"
            '{"profile_updates": {"interests": ["AI", "automation"]}, '
            '"follow_up": "Want to hear about Gary\'s craziest automation project?"}\n```'
        )
    })

    completion = client.chat.completions.create(
        model=CHAT_MODEL,
        messages=messages,
        temperature=0.85,
        max_tokens=350,
    )

    raw_answer = completion.choices[0].message.content

    # Parse the response: separate the visible answer from the JSON metadata
    answer = raw_answer
    follow_up = None

    if "```json" in raw_answer:
        parts = raw_answer.split("```json")
        answer = parts[0].strip()
        try:
            json_str = parts[1].split("```")[0].strip()
            meta = json.loads(json_str)

            # Apply profile updates
            if "profile_updates" in meta and isinstance(meta["profile_updates"], dict):
                pu = meta["profile_updates"]
                profile = sess["user_profile"]
                if pu.get("name"):
                    profile["name"] = pu["name"]
                if pu.get("role"):
                    profile["role"] = pu["role"]
                if pu.get("interests"):
                    existing = set(profile.get("interests", []))
                    existing.update(pu["interests"])
                    profile["interests"] = list(existing)
                if pu.get("context"):
                    profile["context"] = pu["context"]

            follow_up = meta.get("follow_up")
        except (json.JSONDecodeError, IndexError):
            pass  # If parsing fails, just use the raw answer

    # Update conversation history
    sess["history"].append({"role": "user", "content": req.message})
    sess["history"].append({"role": "assistant", "content": answer})

    # Trim history to prevent unbounded growth
    if len(sess["history"]) > MAX_HISTORY_TURNS * 2:
        sess["history"] = sess["history"][-(MAX_HISTORY_TURNS * 2):]

    # Persist
    save_session(req.session_id)

    return ChatResponse(answer=answer, sources=sources, follow_up=follow_up)
