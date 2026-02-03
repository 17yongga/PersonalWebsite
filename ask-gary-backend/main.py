import os
import json
import math
from typing import List, Dict, Any

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from openai import OpenAI

from config import (
    EMBEDDINGS_MODEL,
    CHAT_MODEL,
    TOP_K_RESULTS,
    SYSTEM_PROMPT,
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
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ChatRequest(BaseModel):
    session_id: str
    message: str


class ChatResponse(BaseModel):
    answer: str
    sources: List[str]


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


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/chat", response_model=ChatResponse)
def chat(req: ChatRequest):
    context_text, sources = retrieve_context(req.message)

    messages = [
    {"role": "system", "content": SYSTEM_PROMPT},
    {
        "role": "user",
        "content": (
            f"Context about Gary:\n{context_text}\n\n"
            f"Question: {req.message}\n\n"
            "Remember: Keep your response to 2-3 SHORT sentences. Be casual and friendly!"
        ),
    },
]


    completion = client.chat.completions.create(
        model=CHAT_MODEL,
        messages=messages,
        temperature=0.8,  # More natural, varied responses
        max_tokens=150,   # Limit response length
    )

    answer = completion.choices[0].message.content
    return ChatResponse(answer=answer, sources=sources)
