"""
Quick script to check if .env file is configured correctly
Run this before starting the server: python check_env.py
"""
import os
from dotenv import load_dotenv

# Load .env file
env_path = os.path.join(os.path.dirname(__file__), '.env')
load_dotenv(dotenv_path=env_path)

print("Checking .env configuration...")
print(f".env file path: {env_path}")
print(f".env file exists: {os.path.exists(env_path)}")

api_key = os.getenv("OPENAI_API_KEY")
if api_key:
    api_key = api_key.strip()
    if api_key and api_key.startswith("sk-"):
        print("✅ OPENAI_API_KEY is set correctly")
        print(f"   Key starts with: {api_key[:7]}...")
    else:
        print("❌ OPENAI_API_KEY is set but doesn't look valid (should start with 'sk-')")
        print(f"   Current value: {api_key[:20] if len(api_key) > 20 else api_key}...")
else:
    print("❌ OPENAI_API_KEY is not set")
    print("   Please create a .env file with: OPENAI_API_KEY=sk-your-key-here")

# Check other optional settings
smtp_user = os.getenv("SMTP_USER")
if smtp_user:
    print("✅ SMTP_USER is set (email reports will work)")
else:
    print("ℹ️  SMTP_USER is not set (email reports will be disabled)")

print("\nIf OPENAI_API_KEY is not set, create/edit .env file:")
print("OPENAI_API_KEY=sk-your-actual-key-here")

