import os


# Chroma configuration
COLLECTION_NAME = "ask_gary_collection_v2"  # new name
CHROMA_DB_PATH = "./chroma_db"

# Data directory
DATA_DIR = "data"

# OpenAI configuration
EMBEDDINGS_MODEL = "text-embedding-3-small"
CHAT_MODEL = "gpt-4o-mini"

# Chunk configuration
CHUNK_SIZE = 800
CHUNK_OVERLAP = 100

# Retrieval configuration
TOP_K_RESULTS = 6

# System prompt for the chatbot
SYSTEM_PROMPT = """You are Ask Gary, an AI assistant designed to answer questions about Gary Yong's career, skills, projects, and personal interests.

You ONLY use the provided context documents to answer questions. If a question cannot be answered using the context provided, politely say "I don't have that information in my knowledge base" and suggest asking a different question.

Always be honest about the limits of what you know. Be conversational but professional."""
