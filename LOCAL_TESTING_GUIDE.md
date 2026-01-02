# Local Testing Guide for Ask Gary

This guide will help you test the Ask Gary chatbot locally on your machine.

## Prerequisites

- Python 3.8+ installed
- Node.js (optional, for serving the frontend - or use any static file server)
- OpenAI API key

## Step 1: Set Up the Backend

### 1.1 Navigate to the backend directory

```bash
cd ask-gary-backend
```

### 1.2 Activate the virtual environment

**Windows (PowerShell):**
```powershell
.\venv\Scripts\Activate.ps1
```

**Windows (Command Prompt):**
```cmd
venv\Scripts\activate.bat
```

**Mac/Linux:**
```bash
source venv/bin/activate
```

### 1.3 Install dependencies (if not already installed)

```bash
pip install -r requirements.txt
```

### 1.4 Create a `.env` file

Create a `.env` file in the `ask-gary-backend` directory:

```bash
# Windows PowerShell
New-Item -Path .env -ItemType File

# Or manually create a file named .env
```

Add your OpenAI API key to the `.env` file:

```
OPENAI_API_KEY=your-api-key-here
```

### 1.5 Verify indexed data exists

The backend requires `indexed_data.json` to be present. If it doesn't exist, you'll need to generate it:

```bash
python index_data.py
```

This will read all files in the `data/` directory and create embeddings.

### 1.6 Start the backend server

```bash
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

The `--reload` flag enables auto-reload on code changes (useful for development).

You should see output like:
```
INFO:     Uvicorn running on http://0.0.0.0:8000 (Press CTRL+C to quit)
INFO:     Started reloader process
INFO:     Started server process
INFO:     Waiting for application startup.
INFO:     Application startup complete.
```

### 1.7 Test the backend

Open a new terminal and test the health endpoint:

```bash
# Windows PowerShell
curl http://localhost:8000/health

# Or visit in browser:
# http://localhost:8000/health
```

You should see: `{"status":"ok"}`

## Step 2: Set Up the Frontend

### 2.1 Update the API URL for local testing

Edit `ask-gary.js` and change the API_BASE_URL:

```javascript
const API_BASE_URL = "http://localhost:8000"; // Changed for local testing
```

**Note:** You can also make this dynamic based on environment (see tips below).

### 2.2 Serve the frontend

You have several options:

#### Option A: Using Python's built-in HTTP server (simple)

Navigate to the project root directory and run:

```bash
# Python 3
python -m http.server 5500

# Or Python 2
python -m SimpleHTTPServer 5500
```

#### Option B: Using Node.js http-server

```bash
# Install globally (one time)
npm install -g http-server

# Run the server
http-server -p 5500
```

#### Option C: Using VS Code Live Server extension

1. Install the "Live Server" extension in VS Code
2. Right-click on `ask-gary.html`
3. Select "Open with Live Server"

#### Option D: Using PHP's built-in server

```bash
php -S localhost:5500
```

### 2.3 Access the application

Open your browser and navigate to:
```
http://localhost:5500/ask-gary.html
```

## Step 3: Test the Chatbot

1. You should see the welcome message from Ask Gary
2. Try asking a question like: "What did Gary do at Capco?"
3. You should see the typing indicator, then a narrative response
4. Check the browser console (F12) for any errors

## Troubleshooting

### Backend Issues

**Issue: Module not found errors**
```bash
# Make sure virtual environment is activated
# Reinstall dependencies
pip install -r requirements.txt
```

**Issue: OpenAI API key error**
- Verify your `.env` file exists in `ask-gary-backend/`
- Check that the API key is correct (no extra spaces)
- Make sure you're running from the `ask-gary-backend` directory

**Issue: indexed_data.json not found**
```bash
# Generate the index file
python index_data.py
```

**Issue: Port 8000 already in use**
```bash
# Windows: Find what's using the port
netstat -ano | findstr :8000

# Or use a different port
uvicorn main:app --reload --host 0.0.0.0 --port 8001
# Then update API_BASE_URL in ask-gary.js to http://localhost:8001
```

### Frontend Issues

**Issue: CORS errors in browser console**
- Make sure the backend CORS middleware includes your frontend URL
- The backend is already configured for `http://localhost:5500`
- If using a different port, you may need to update `main.py` CORS settings

**Issue: 404 errors for API calls**
- Verify the backend is running on the correct port
- Check that `API_BASE_URL` in `ask-gary.js` matches your backend URL
- Open browser DevTools Network tab to see the actual request URL

**Issue: Static files not loading (CSS, images)**
- Make sure you're serving from the project root directory
- Check that paths in HTML are correct (relative paths should work)

## Development Tips

### Making API URL dynamic

You can make the API URL switch automatically based on the host:

```javascript
// In ask-gary.js
const API_BASE_URL = window.location.hostname === 'localhost' 
  ? "http://localhost:8000"
  : "https://api.gary-yong.com";
```

### Hot Reload

- **Backend**: Already configured with `--reload` flag
- **Frontend**: If using Live Server or http-server, changes should auto-refresh
- **Browser**: Hard refresh (Ctrl+Shift+R / Cmd+Shift+R) to clear cache

### Testing Changes

1. Make changes to backend code → server auto-reloads
2. Make changes to frontend → refresh browser (or auto-refresh if using Live Server)
3. Test the changes immediately

### Viewing Logs

**Backend logs:**
- Check the terminal where uvicorn is running
- Errors and request logs appear there

**Frontend logs:**
- Open browser DevTools (F12)
- Check Console tab for JavaScript errors
- Check Network tab for API requests/responses

## Quick Start Summary

```bash
# Terminal 1: Backend
cd ask-gary-backend
.\venv\Scripts\Activate.ps1  # Windows PowerShell
python -m pip install -r requirements.txt  # If needed
# Create .env file with OPENAI_API_KEY=your-key
uvicorn main:app --reload --host 0.0.0.0 --port 8000

# Terminal 2: Frontend (from project root)
# Option 1: Python
python -m http.server 5500

# Option 2: Node.js
npx http-server -p 5500

# Then open: http://localhost:5500/ask-gary.html
```

## Next Steps

Once everything is working locally:
1. Test your UI/UX improvements
2. Test the narrative response format
3. Make any adjustments
4. Deploy to production when ready

