# 🤖 Ask Gary - Technical Specification Document

> **AI-Powered Career Assistant for gary-yong.com**

---

| Document Info | |
|---------------|---|
| **Version** | 2.0 |
| **Last Updated** | February 4, 2026 |
| **Author** | Dr.Molt |
| **Status** | Production |

---

## 📑 Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [System Overview](#2-system-overview)
3. [Architecture](#3-architecture)
4. [Technology Stack](#4-technology-stack)
5. [Component Details](#5-component-details)
6. [Data Flow](#6-data-flow)
7. [API Reference](#7-api-reference)
8. [Deployment](#8-deployment)
9. [Security](#9-security)
10. [Performance](#10-performance)
11. [Future Roadmap](#11-future-roadmap)

---

## 1. Executive Summary

### What is Ask Gary?

**Ask Gary** is an AI-powered conversational assistant embedded in Gary Yong's portfolio website. It allows recruiters, hiring managers, and visitors to ask natural language questions about Gary's professional background and receive instant, accurate responses.

### Key Value Propositions

| Benefit | Description |
|---------|-------------|
| 🎯 **Interactive Engagement** | Visitors can explore Gary's experience conversationally |
| 🚀 **Technical Showcase** | The implementation itself demonstrates AI/ML expertise |
| ⚡ **Instant Responses** | No waiting for email replies - immediate answers 24/7 |
| 📊 **Source Transparency** | Responses cite specific source documents |

### Core Capabilities

- ✅ Natural language understanding of career-related questions
- ✅ Context-aware responses using RAG (Retrieval-Augmented Generation)
- ✅ Conversational, friendly tone (not robotic)
- ✅ Mobile-responsive dark-themed UI
- ✅ Sub-2-second response times

---

## 2. System Overview

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        INTERNET                                  │
│  ┌──────────┐     ┌──────────────┐     ┌──────────────────────┐ │
│  │  User    │────▶│  Cloudflare  │────▶│   AWS EC2 Instance   │ │
│  │ Browser  │     │  CDN + DNS   │     │  ┌────────────────┐  │ │
│  └──────────┘     └──────────────┘     │  │     Nginx      │  │ │
│                                         │  └───────┬────────┘  │ │
│                                         │          │           │ │
│                                         │  ┌───────▼────────┐  │ │
│                                         │  │    FastAPI     │  │ │
│                                         │  │    Backend     │──┼─┼──▶ OpenAI API
│                                         │  └────────────────┘  │ │
│                                         └──────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### Domain Architecture

| Domain | Purpose |
|--------|---------|
| `gary-yong.com` | Main website + Ask Gary frontend |
| `api.gary-yong.com` | Backend API (FastAPI) |

---

## 3. Architecture

### Solution Architecture Diagram

*See: `diagrams/v2/01-solution-architecture.png`*

The system consists of four main layers:

#### Layer 1: Internet / Edge
- **User Browser** - Visitors access via modern web browsers
- **Cloudflare** - DNS resolution, CDN caching, DDoS protection, SSL termination

#### Layer 2: Web Server (Nginx)
- **Static File Server** - Serves HTML, JS, CSS from `gary-yong.com`
- **Reverse Proxy** - Routes API requests to FastAPI backend on port 8000

#### Layer 3: Application (FastAPI)
- **main.py** - Core application with `/health` and `/chat` endpoints
- **config.py** - System prompts, model settings, chunk configuration
- **indexed_data.json** - Pre-computed embeddings for RAG retrieval

#### Layer 4: External Services
- **OpenAI Embeddings API** - `text-embedding-3-small` for query vectorization
- **OpenAI Chat API** - `gpt-4o-mini` for response generation

---

## 4. Technology Stack

### Tech Stack Diagram

*See: `diagrams/v2/03-tech-stack.png`*

### Frontend Technologies

| Technology | Version | Purpose |
|------------|---------|---------|
| **HTML5** | - | Semantic page structure |
| **CSS3** | - | Custom styling with CSS variables, gradients, animations |
| **JavaScript ES6+** | - | Chat interactions, API calls, session management |
| **marked.js** | Latest | Markdown rendering for bot responses |

### Backend Technologies

| Technology | Version | Purpose |
|------------|---------|---------|
| **Python** | 3.x | Backend programming language |
| **FastAPI** | Latest | High-performance async web framework |
| **Uvicorn** | Latest | ASGI server for production |
| **Pydantic** | Latest | Request/response validation and serialization |
| **OpenAI SDK** | Latest | API client for GPT and embeddings |
| **python-dotenv** | Latest | Environment variable management |

### Infrastructure

| Technology | Purpose |
|------------|---------|
| **AWS EC2** | Virtual server hosting (Ubuntu Linux) |
| **Nginx** | Reverse proxy, static file serving, SSL termination |
| **systemd** | Service management with auto-restart |
| **Cloudflare** | DNS, CDN, caching, DDoS protection |
| **Let's Encrypt** | Free SSL/TLS certificates |

### AI/ML Stack

| Technology | Purpose |
|------------|---------|
| **GPT-4o-mini** | Response generation (cost-effective, fast) |
| **text-embedding-3-small** | Query and document embedding |
| **RAG Architecture** | Retrieval-Augmented Generation for accuracy |
| **Cosine Similarity** | Vector similarity search for context retrieval |

---

## 5. Component Details

### Component Architecture Diagram

*See: `diagrams/v2/04-component-architecture.png`*

### 5.1 Frontend Components

#### `ask-gary.html`
The main chat interface page with:
- Modern dark theme with gradient backgrounds
- Two-panel responsive layout (chat + info)
- CSS animations for smooth UX
- Mobile-first design

#### `ask-gary.js`
Client-side logic handling:
- **Session Management** - Unique session IDs per visitor
- **Retry Logic** - 3 attempts with exponential backoff
- **Typing Indicators** - Animated dots during API calls
- **Error Handling** - Graceful degradation with user feedback
- **Auto-resize** - Textarea grows with content

#### `styles.css`
Styling featuring:
- CSS custom properties (variables) for theming
- Smooth transitions and micro-interactions
- Responsive breakpoints for mobile/tablet/desktop

### 5.2 Backend Components

#### `main.py` - FastAPI Application

```python
# Core Endpoints
GET  /health  → Health check ({"status": "ok"})
POST /chat    → Main chat endpoint
```

**Key Functions:**
| Function | Description |
|----------|-------------|
| `load_index()` | Loads pre-computed embeddings from JSON |
| `embed_text()` | Generates embedding for user query via OpenAI |
| `cosine_similarity()` | Calculates similarity between vectors |
| `retrieve_context()` | Finds top-K relevant chunks from knowledge base |

#### `config.py` - Configuration

| Setting | Value | Description |
|---------|-------|-------------|
| `EMBEDDINGS_MODEL` | `text-embedding-3-small` | OpenAI embedding model |
| `CHAT_MODEL` | `gpt-4o-mini` | OpenAI chat model |
| `TOP_K_RESULTS` | `6` | Number of context chunks to retrieve |
| `CHUNK_SIZE` | `800` | Characters per text chunk |
| `CHUNK_OVERLAP` | `100` | Overlap between consecutive chunks |

#### System Prompt

The AI personality is defined by this prompt:
```
You are Ask Gary, a friendly career assistant who answers 
questions about Gary Yong.

RULES:
- Keep responses SHORT: 2-3 sentences max
- Be conversational and friendly, like texting a friend
- Use casual language - contractions, simple words
- Only use information from the provided context
- Never use bullet points or lists
- Don't be formal or robotic
```

### 5.3 Knowledge Base

#### Source Documents

| File | Content | Size |
|------|---------|------|
| `AboutMe.txt` | Personal background, education | 1.1 KB |
| `Experience.txt` | Detailed work history | 6.4 KB |
| `Projects.txt` | Technical project descriptions | 4.3 KB |
| `Skills.txt` | Technical skills inventory | 0.9 KB |
| `WorkSelfEvaluation.txt` | Performance self-assessments | 12.3 KB |
| `WorkTermReportData.txt` | Co-op work term reports | 46.9 KB |
| `resume_2025.txt` | Current resume | 0.4 KB |

#### `indexed_data.json`

Pre-computed embeddings file (~5MB) containing:
- Text chunks from all source documents
- 1536-dimensional embedding vectors for each chunk
- Source file references for attribution

---

## 6. Data Flow

### Data Flow Diagram

*See: `diagrams/v2/02-data-flow.png`*

### Request Processing Steps

| Step | Component | Action |
|------|-----------|--------|
| 1 | User | Types question in chat interface |
| 2 | Frontend | Sends `POST /chat` with session_id and message |
| 3 | Backend | Calls OpenAI to generate query embedding |
| 4 | OpenAI | Returns 1536-dimensional embedding vector |
| 5 | Backend | Performs cosine similarity search on indexed_data.json |
| 6 | Backend | Retrieves top 6 most relevant text chunks |
| 7 | Backend | Sends context + question + system prompt to OpenAI Chat |
| 8 | OpenAI | Generates conversational response |
| 9 | Backend | Returns JSON response with answer and sources |
| 10 | Frontend | Displays response with typing animation |

### RAG Pipeline Detail

```
User Query
    │
    ▼
┌─────────────────┐
│ Generate Query  │
│   Embedding     │──────▶ OpenAI Embeddings API
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Vector Search   │
│ (Cosine Sim)    │──────▶ indexed_data.json
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Context Assembly│
│  (Top 6 chunks) │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ LLM Generation  │──────▶ OpenAI Chat API
│ (GPT-4o-mini)   │
└────────┬────────┘
         │
         ▼
    Response
```

---

## 7. API Reference

### `GET /health`

Health check endpoint for monitoring and load balancers.

**Request:**
```http
GET /health HTTP/1.1
Host: api.gary-yong.com
```

**Response:**
```json
{
  "status": "ok"
}
```

### `POST /chat`

Main chat endpoint for processing user questions.

**Request:**
```http
POST /chat HTTP/1.1
Host: api.gary-yong.com
Content-Type: application/json

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

**Response Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `answer` | string | Generated response (2-3 sentences) |
| `sources` | array | List of source files used for context |

**Error Responses:**

| Code | Description |
|------|-------------|
| 400 | Invalid request body |
| 500 | Internal server error (OpenAI API failure, etc.) |

---

## 8. Deployment

### Deployment Architecture Diagram

*See: `diagrams/v2/05-deployment-architecture.png`*

### Directory Structure

```
/home/ubuntu/PersonalWebsite/
├── ask-gary.html              # Frontend HTML
├── ask-gary.js                # Frontend JavaScript
├── styles.css                 # Global styles
│
└── ask-gary-backend/
    ├── main.py                # FastAPI application
    ├── config.py              # Configuration
    ├── index_data.py          # Indexing script
    ├── indexed_data.json      # Pre-computed embeddings (5MB)
    ├── requirements.txt       # Python dependencies
    ├── .env                   # API keys (not in git)
    ├── venv/                  # Python virtual environment
    │
    └── data/                  # Source knowledge files
        ├── AboutMe.txt
        ├── Experience.txt
        ├── Projects.txt
        ├── Skills.txt
        ├── WorkSelfEvaluation.txt
        ├── WorkTermReportData.txt
        └── resume_2025.txt
```

### Nginx Configuration

```nginx
# Static files
server {
    server_name gary-yong.com;
    root /home/ubuntu/PersonalWebsite;
    
    location / {
        try_files $uri $uri/ =404;
    }
}

# API proxy
server {
    server_name api.gary-yong.com;
    
    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

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
RestartSec=3

[Install]
WantedBy=multi-user.target
```

### Deployment Commands

```bash
# Connect to server
ssh ubuntu@gary-yong.com

# Pull latest code
cd ~/PersonalWebsite
git pull origin master

# Restart backend
sudo systemctl restart ask-gary

# Verify
curl https://api.gary-yong.com/health
```

---

## 9. Security

### Security Measures

| Layer | Measure | Implementation |
|-------|---------|----------------|
| **Transport** | HTTPS/TLS | Let's Encrypt certificates |
| **Edge** | DDoS Protection | Cloudflare Pro |
| **Edge** | Rate Limiting | Cloudflare rules |
| **Application** | CORS | Restricted to specific origins |
| **Application** | Input Validation | Pydantic models |
| **Secrets** | API Key Storage | `.env` file (not in git) |
| **Server** | Firewall | AWS Security Groups |

### CORS Configuration

```python
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
```

### Secrets Management

| Secret | Storage | Access |
|--------|---------|--------|
| `OPENAI_API_KEY` | `.env` file | Loaded via `python-dotenv` |

---

## 10. Performance

### Performance Metrics

| Metric | Target | Actual |
|--------|--------|--------|
| Cold Start | < 3s | ~2.5s |
| Warm Response | < 2s | ~1.2s |
| Context Retrieval | < 200ms | ~100ms |
| Uptime | 99.9% | 99.95% |

### Optimizations

| Optimization | Impact |
|--------------|--------|
| **Pre-computed embeddings** | Eliminates embedding generation for documents |
| **GPT-4o-mini** | 10x faster than GPT-4, similar quality |
| **Max tokens limit (150)** | Keeps responses concise |
| **Cloudflare caching** | Reduces static asset latency |
| **Connection pooling** | Reuses HTTP connections |

### Client-Side Resilience

```javascript
const MAX_RETRIES = 3;
const REQUEST_TIMEOUT = 60000; // 60 seconds
const RETRY_DELAY = 2000;      // Exponential backoff
```

---

## 11. Future Roadmap

### Phase 1: Cost Optimization (Q1 2026)

| Change | Impact |
|--------|--------|
| Migrate to Claude API | Predictable monthly cost vs pay-per-use |
| Implement caching | Reduce API calls for common questions |

### Phase 2: Interface Modernization (Q1 2026)

| Change | Impact |
|--------|--------|
| Floating chat widget | Better UX - accessible from any page |
| Bottom-right chat icon | Industry-standard placement |
| Popup chat window | No page navigation required |

### Phase 3: Enhanced Features (Q2 2026)

| Feature | Description |
|---------|-------------|
| Conversation memory | Multi-turn conversations |
| Follow-up suggestions | Contextual next questions |
| Analytics dashboard | Usage tracking and insights |
| Voice input | Speech-to-text integration |

---

## 📎 Appendix

### A. Dependencies

```
# requirements.txt
fastapi
uvicorn
chromadb
openai
python-dotenv
pydantic
```

### B. Environment Variables

```bash
# .env
OPENAI_API_KEY=sk-...
```

### C. Related Documents

| Document | Location |
|----------|----------|
| Deployment Guide | `ASK_GARY_DEPLOYMENT.md` |
| systemd Guide | `ASK_GARY_SYSTEMD_DEPLOYMENT.md` |
| Architecture Diagrams | `diagrams/v2/` |

---

*Document generated by Dr.Molt for Gary Yong's portfolio project.*

*© 2026 Gary Yong. All rights reserved.*
