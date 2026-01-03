import os
from dotenv import load_dotenv

# Load .env file from the same directory as this config file
env_path = os.path.join(os.path.dirname(__file__), '.env')
load_dotenv(dotenv_path=env_path)

# OpenAI configuration
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
if OPENAI_API_KEY:
    # Remove any whitespace
    OPENAI_API_KEY = OPENAI_API_KEY.strip()
CHAT_MODEL = "gpt-4o-mini"
VISION_MODEL = "gpt-4o"

# Database configuration
DATABASE_URL = "sqlite+aiosqlite:///./budget.db"

# Email configuration
SMTP_HOST = os.getenv("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
EMAIL_FROM = os.getenv("EMAIL_FROM", SMTP_USER)

# File upload configuration
UPLOAD_DIR = "./uploads"
MAX_UPLOAD_SIZE = 10 * 1024 * 1024  # 10MB

# Budget categories
DEFAULT_CATEGORIES = [
    "Groceries",
    "Dining",
    "Transportation",
    "Utilities",
    "Entertainment",
    "Shopping",
    "Healthcare",
    "Education",
    "Travel",
    "Other"
]

# Default budget allocation (percentages)
DEFAULT_BUDGET_ALLOCATION = {
    "Groceries": 20,
    "Dining": 15,
    "Transportation": 10,
    "Utilities": 10,
    "Entertainment": 10,
    "Shopping": 15,
    "Healthcare": 5,
    "Education": 5,
    "Travel": 5,
    "Other": 5
}

