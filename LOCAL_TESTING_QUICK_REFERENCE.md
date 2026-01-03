# Quick Reference: Testing Budget App Locally

## 🚀 Quick Start (Copy-Paste Commands)

### Terminal 1: Backend Setup

```powershell
# Navigate to backend
cd budget-backend

# Create and activate virtual environment
python -m venv venv
.\venv\Scripts\Activate.ps1

# Install dependencies
pip install -r requirements.txt

# Create .env file (then edit it to add your OpenAI API key)
New-Item -Path .env -ItemType File
notepad .env  # Add: OPENAI_API_KEY=sk-your-key-here

# Create uploads directory
mkdir uploads

# Start server (port 8002 to avoid conflict with Ask-Gary on 8000)
uvicorn main:app --reload --host 0.0.0.0 --port 8002
```

### Terminal 2: Frontend Setup

```powershell
# Go back to project root
cd ..

# Start web server
python -m http.server 5500
```

### Browser

Open: **http://localhost:5500/budget.html**

## ✅ Quick Verification

1. **Backend Health Check**: http://localhost:8002/health
   - Should return: `{"status":"ok"}`
   - Note: Port 8002 (Ask-Gary uses 8000, Casino uses 3001)

2. **Frontend Loads**: http://localhost:5500/budget.html
   - Should show setup modal

3. **Test Transaction**: Add a manual transaction
   - Should appear in dashboard immediately

## 🔧 Common Issues

| Problem | Solution |
|---------|----------|
| Port 8002 in use | Check what's using it: `lsof -i :8002` or `netstat -ano | findstr :8002` |
| Module not found | Activate venv: `.\venv\Scripts\Activate.ps1` |
| OpenAI error | Check `.env` file has correct API key |
| CORS error | Verify backend is running and API_BASE_URL is correct |
| Charts not showing | Check browser console (F12) for errors |

## 📝 Essential Files

- **Backend**: `budget-backend/main.py`
- **Frontend**: `budget.html`, `budget.js`, `budget.css`
- **Config**: `budget-backend/.env` (create this!)
- **Database**: `budget-backend/budget.db` (auto-created)

## 🎯 Testing Checklist

- [ ] Backend running on port 8002 (not 8000 - that's Ask-Gary)
- [ ] Frontend accessible on port 5500
- [ ] Setup modal works
- [ ] Can add manual transaction
- [ ] Can upload receipt (needs OpenAI API key)
- [ ] Charts display
- [ ] Recommendations work

For detailed instructions, see **TEST_LOCALLY.md**

