# Ask Gary - Technical Specification Document

**Version:** 1.0  
**Last Updated:** February 4, 2026  
**Author:** Dr.Molt

---

## 1. Overview

**Ask Gary** is an AI-powered career assistant chatbot embedded in Gary Yong's personal portfolio website (gary-yong.com). It enables visitors to ask questions about Gary's professional background, work experience, projects, and skills through a conversational interface.

### Purpose
- Provide interactive engagement for recruiters and visitors
- Showcase Gary's technical capabilities through the AI implementation itself
- Answer questions about Gary's career in a conversational, friendly manner

### Key Features
- Natural language question-answering about Gary's career
- Context-aware responses using RAG (Retrieval-Augmented Generation)
- Conversational tone with short, engaging responses
- Source attribution for transparency

---

## 2. Solution Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              INTERNET                                        │
│                                                                              │
│   ┌──────────────────────────────────────────────────────────────────────┐  │
│   │                         VISITORS / RECRUITERS                         │  │
│   │                          (Web Browser)                                │  │
│   └────────────────────────────────┬─────────────────────────────────────┘  │
│                                    │                                         │
│                                    ▼                                         │
│   ┌──────────────────────────────────────────────────────────────────────┐  │
│   │                       gary-yong.com (HTTPS)                          │  │
│   │                         Cloudflare CDN                               │  │
│   └────────────────────────────────┬─────────────────────────────────────┘  │
│                                    │                                         │
└────────────────────────────────────┼─────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            AWS EC2 INSTANCE                                  │
│                         (Ubuntu Linux Server)                                │
│                                                                              │
│   ┌──────────────────────────────────────────────────────────────────────┐  │
│   │                           NGINX                                       │  │
│   │                      (Reverse Proxy)                                  │  │
│   │                                                                       │  │
│   │   ┌─────────────────────┐    ┌─────────────────────────────────────┐ │  │
│   │   │  Static File Server │    │      API Proxy                      │ │  │
│   │   │  gary-yong.com/*    │    │  api.gary-yong.com → localhost:8000 │ │  │
│   │   └─────────────────────┘    └─────────────────────────────────────┘ │  │
│   └──────────────────────────────────────────────────────────────────────┘  │
│                    │                              │                          │
│                    ▼                              ▼                          │
│   ┌──────────────────────────┐    ┌─────────────────────────────────────┐   │
│   │       FRONTEND           │    │          BACKEND                    │   │
│   │                          │    │      (FastAPI + Python)             │   │
│   │  ┌────────────────────┐  │    │                                     │   │
│   │  │  ask-gary.html     │  │    │   ┌─────────────────────────────┐   │   │
│   │  │  (Chat Interface)  │  │    │   │        main.py              │   │   │
│   │  └────────────────────┘  │    │   │   ┌──────────────────────┐  │   │   │
│   │  ┌────────────────────┐  │    │   │   │  /health endpoint    │  │   │   │
│   │  │  ask-gary.js       │  │    │   │   │  /chat endpoint      │  │   │   │
│   │  │  (Chat Logic)      │──┼────┼──▶│   └──────────────────────┘  │   │   │
│   │  └────────────────────┘  │    │   └─────────────────────────────┘   │   │
│   │  ┌────────────────────┐  │    │   ┌─────────────────────────────┐   │   │
│   │  │  styles.css        │  │    │   │      config.py              │   │   │
│   │  │  (Styling)         │  │    │   │  (Prompts & Settings)       │   │   │
│   │  └────────────────────┘  │    │   └─────────────────────────────┘   │   │
│   └──────────────────────────┘    │   ┌─────────────────────────────┐   │   │
│                                   │   │   indexed_data.json         │   │   │
│                                   │   │  (Embedded Knowledge Base)  │   │   │
│                                   │   └─────────────────────────────┘   │   │
│                                   └─────────────────────────────────────┘   │
│                                                    │                         │
└────────────────────────────────────────────────────┼─────────────────────────┘
                                                     │
                                                     ▼
                                   ┌─────────────────────────────────────────┐
                                   │            OPENAI API                   │
                                   │                                         │
                                   │  ┌─────────────────────────────────┐   │
                                   │  │   Embeddings API                │   │
                                   │  │   (text-embedding-3-small)      │   │
                                   │  └─────────────────────────────────┘   │
                                   │  ┌─────────────────────────────────┐   │
                                   │  │   Chat Completions API          │   │
                                   │  │   (gpt-4o-mini)                 │   │
                                   │  └─────────────────────────────────┘   │
                                   └─────────────────────────────────────────┘
```

---

## 3. Tech Stack

### Frontend
| Component | Technology | Purpose |
|-----------|------------|---------|
| Structure | HTML5 | Page layout and semantic structure |
| Styling | CSS3 | Custom styling with CSS variables |
| Logic | Vanilla JavaScript | Chat interactions, API calls, animations |
| Markdown | marked.js | Rendering markdown in bot responses |

### Backend
| Component | Technology | Version | Purpose |
|-----------|------------|---------|---------|
| Framework | FastAPI | Latest | High-performance async API framework |
| Runtime | Python | 3.x | Backend language |
| Server | Uvicorn | Latest | ASGI server for FastAPI |
| Validation | Pydantic | Latest | Request/response validation |
| AI Client | OpenAI SDK | Latest | API client for GPT and embeddings |
| Config | python-dotenv | Latest | Environment variable management |

### Infrastructure
| Component | Technology | Purpose |
|-----------|------------|---------|
| Cloud | AWS EC2 | Virtual server hosting |
| OS | Ubuntu Linux | Server operating system |
| Web Server | Nginx | Reverse proxy, static file serving, SSL termination |
| Process Manager | systemd | Service management and auto-restart |
| DNS/CDN | Cloudflare | DNS, caching, DDoS protection |
| SSL | Let's Encrypt | HTTPS certificates |

### AI/ML
| Component | Technology | Purpose |
|-----------|------------|---------|
| LLM | GPT-4o-mini | Response generation |
| Embeddings | text-embedding-3-small | Semantic search for context retrieval |
| Technique | RAG (Retrieval-Augmented Generation) | Context-aware responses |

---

## 4. Component Details

### 4.1 Frontend Components

#### ask-gary.html
- Modern, dark-themed chat interface
- Two-panel layout: chat window + info panel
- Responsive design (mobile + desktop)
- CSS animations for smooth UX

#### ask-gary.js
- Session management with unique session IDs
- Fetch with timeout and retry logic (3 retries, exponential backoff)
- Auto-resize textarea for user input
- Typing indicator animation during API calls
- Backend health check on page load

### 4.2 Backend Components

#### main.py - FastAPI Application
```
Endpoints:
├── GET  /health    → Health check (returns {"status": "ok"})
└── POST /chat      → Chat endpoint (accepts message, returns answer + sources)
```

**Core Functions:**
- `load_index()` - Loads pre-computed embeddings from JSON
- `embed_text()` - Generates embeddings for user queries
- `cosine_similarity()` - Calculates similarity between vectors
- `retrieve_context()` - RAG retrieval: finds top-K relevant chunks

#### config.py - Configuration
| Setting | Value | Description |
|---------|-------|-------------|
| EMBEDDINGS_MODEL | text-embedding-3-small | OpenAI embedding model |
| CHAT_MODEL | gpt-4o-mini | OpenAI chat model |
| TOP_K_RESULTS | 6 | Number of context chunks to retrieve |
| CHUNK_SIZE | 800 | Characters per chunk |
| CHUNK_OVERLAP | 100 | Overlap between chunks |

#### SYSTEM_PROMPT
Defines the chatbot personality:
- Friendly, conversational tone
- 2-3 sentence responses
- No bullet points or lists
- Casual language (like texting a friend)

### 4.3 Knowledge Base

#### Source Data Files
| File | Content |
|------|---------|
| AboutMe.txt | Personal background |
| Experience.txt | Work history details |
| Projects.txt | Technical project descriptions |
| Skills.txt | Technical skills list |
| WorkSelfEvaluation.txt | Self-assessment content |
| WorkTermReportData.txt | Detailed work term reports |
| resume_2025.txt | Current resume |

#### index_data.py
Pre-processes source files:
1. Reads all .txt files from `/data` directory
2. Chunks text into 800-character segments with 100-char overlap
3. Generates embeddings for each chunk via OpenAI API
4. Saves to `indexed_data.json` with metadata

---

## 5. Data Flow

### User Query Flow

```
┌─────────┐      ┌─────────────┐      ┌──────────────────┐      ┌───────────┐
│  User   │──1──▶│  Frontend   │──2──▶│    Backend       │──3──▶│  OpenAI   │
│         │      │  (JS)       │      │    (FastAPI)     │      │  API      │
└─────────┘      └─────────────┘      └──────────────────┘      └───────────┘
                                               │                       │
                                               │◀──────────4───────────┘
                                               │
                                               ▼
                                      ┌──────────────────┐
                                      │  Context + Query │
                                      │  → OpenAI Chat   │
                                      │  → Response      │
                                      └────────┬─────────┘
                                               │
                  ┌─────────────┐               │
     ┌─────────◀──│  Frontend   │◀──────5──────┘
     │            │  (Display)  │
     ▼            └─────────────┘
┌─────────┐
│  User   │
│  Sees   │
│ Answer  │
└─────────┘
```

### Step-by-Step Flow

1. **User Input** → User types question in chat interface
2. **API Request** → Frontend sends POST to `/chat` with session_id and message
3. **Embedding** → Backend generates embedding for user query
4. **Retrieval** → Cosine similarity search finds top-6 relevant chunks from `indexed_data.json`
5. **Context Assembly** → Relevant chunks concatenated into context string
6. **LLM Call** → Context + user question sent to GPT-4o-mini with system prompt
7. **Response** → LLM generates conversational answer
8. **Return** → Backend returns `{answer, sources}` to frontend
9. **Display** → Frontend renders response with typing animation

---

## 6. Deployment Architecture

### Directory Structure (EC2)
```
/home/ubuntu/PersonalWebsite/
├── ask-gary.html              # Frontend HTML
├── ask-gary.js                # Frontend JavaScript
├── styles.css                 # Global styles
├── ask-gary-backend/
│   ├── main.py                # FastAPI application
│   ├── config.py              # Configuration
│   ├── index_data.py          # Indexing script
│   ├── indexed_data.json      # Pre-computed embeddings
│   ├── requirements.txt       # Python dependencies
│   ├── .env                   # API keys (not in git)
│   ├── venv/                  # Python virtual environment
│   └── data/                  # Source knowledge files
│       ├── AboutMe.txt
│       ├── Experience.txt
│       ├── Projects.txt
│       ├── Skills.txt
│       └── ...
```

### Nginx Configuration
- `gary-yong.com` → Serves static files from `/home/ubuntu/PersonalWebsite`
- `api.gary-yong.com` → Proxies to `localhost:8000` (FastAPI)

### systemd Service
```ini
[Unit]
Description=Ask Gary Backend
After=network.target

[Service]
User=ubuntu
WorkingDirectory=/home/ubuntu/PersonalWebsite/ask-gary-backend
ExecStart=/home/ubuntu/PersonalWebsite/ask-gary-backend/venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000
Restart=always

[Install]
WantedBy=multi-user.target
```

---

## 7. API Reference

### GET /health
Health check endpoint for monitoring.

**Response:**
```json
{
  "status": "ok"
}
```

### POST /chat
Main chat endpoint.

**Request:**
```json
{
  "session_id": "session_1707071234_abc123",
  "message": "What did Gary do at Capco?"
}
```

**Response:**
```json
{
  "answer": "Gary spent 3 years at Capco working on digital transformation for banks. He led some cool automation projects there!",
  "sources": ["Experience.txt", "WorkTermReportData.txt"]
}
```

---

## 8. Security Considerations

| Aspect | Implementation |
|--------|----------------|
| HTTPS | SSL/TLS via Let's Encrypt |
| CORS | Restricted to specific origins |
| API Keys | Stored in `.env`, not in repository |
| Rate Limiting | Handled by Cloudflare |
| Input Validation | Pydantic models in FastAPI |

---

## 9. Performance Characteristics

| Metric | Value |
|--------|-------|
| Cold Start | ~2-3 seconds (first request) |
| Warm Response | ~1-2 seconds |
| Context Retrieval | ~100ms |
| Token Limit | 150 max tokens per response |
| Retry Logic | 3 attempts with exponential backoff |
| Request Timeout | 60 seconds |

---

## 10. Planned Improvements

Based on the refinement roadmap:

### Phase 1: Cost Optimization
- Migrate from OpenAI API (pay-per-use) to Claude Max subscription
- Benefit: Predictable fixed monthly cost

### Phase 2: Interface Modernization
- Convert from dedicated page to floating chatbot widget
- Bottom-right chat icon with popup window
- E-commerce style chat experience

### Phase 3: Conversation Enhancement
- Further tune response length and tone
- Add contextual follow-up suggestions
- Improve knowledge base with more content

---

## 11. Appendix

### A. Environment Variables
```bash
OPENAI_API_KEY=sk-...  # Required for embeddings and chat
```

### B. Dependencies (requirements.txt)
```
fastapi
uvicorn
chromadb
openai
python-dotenv
pydantic
```

### C. Deployment Commands
```bash
# Deploy updates
ssh ubuntu@gary-yong.com
cd ~/PersonalWebsite
git pull origin master
sudo systemctl restart ask-gary

# Verify deployment
curl https://api.gary-yong.com/health
```

---

*Document generated by Dr.Molt for Gary Yong's portfolio project.*
