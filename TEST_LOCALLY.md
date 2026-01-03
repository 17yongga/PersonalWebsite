# Testing Budget App Locally - Step by Step

## Prerequisites Check

Before starting, make sure you have:
- Python 3.8 or higher installed
- An OpenAI API key (get one at https://platform.openai.com/api-keys)
- A web browser (Chrome, Firefox, Safari, etc.)

## Step 1: Set Up Backend

### 1.1 Navigate to Backend Directory

```bash
cd budget-backend
```

### 1.2 Create Virtual Environment

**Windows (PowerShell):**
```powershell
python -m venv venv
.\venv\Scripts\Activate.ps1
```

**Windows (Command Prompt):**
```cmd
python -m venv venv
venv\Scripts\activate
```

**Mac/Linux:**
```bash
python3 -m venv venv
source venv/bin/activate
```

You should see `(venv)` in your terminal prompt.

### 1.3 Install Dependencies

```bash
pip install -r requirements.txt
```

This will install:
- FastAPI
- Uvicorn (web server)
- OpenAI
- SQLAlchemy
- And other required packages

### 1.4 Configure Environment Variables

Create a `.env` file in the `budget-backend` directory:

**Windows (PowerShell):**
```powershell
New-Item -Path .env -ItemType File
```

**Windows (Command Prompt):**
```cmd
type nul > .env
```

**Mac/Linux:**
```bash
touch .env
```

Then edit `.env` and add your OpenAI API key:
```
OPENAI_API_KEY=sk-your-actual-api-key-here
```

**Important:** Replace `sk-your-actual-api-key-here` with your real OpenAI API key.

### 1.5 Create Uploads Directory

**Windows:**
```cmd
mkdir uploads
```

**Mac/Linux:**
```bash
mkdir uploads
```

### 1.6 Start the Backend Server

```bash
# Note: Budget app uses port 8002 to avoid conflicts with Ask-Gary (8000) and Casino (3001)
uvicorn main:app --reload --host 0.0.0.0 --port 8002
```

You should see output like:
```
INFO:     Uvicorn running on http://0.0.0.0:8002 (Press CTRL+C to quit)
INFO:     Started reloader process
INFO:     Started server process
INFO:     Waiting for application startup.
INFO:     Application startup complete.
```

**Keep this terminal window open!** The backend needs to keep running.

### 1.7 Test Backend is Working

Open a new terminal/command prompt and test:

**Windows (PowerShell):**
```powershell
Invoke-WebRequest -Uri http://localhost:8000/health
```

**Mac/Linux:**
```bash
curl http://localhost:8000/health
```

Or simply open in browser: http://localhost:8002/health

You should see: `{"status":"ok"}`

**Note**: Budget app uses port 8002 (not 8000) to avoid conflicts with Ask-Gary backend.

## Step 2: Set Up Frontend

### 2.1 Open a New Terminal

Keep the backend running in the first terminal, open a new one.

### 2.2 Navigate to Project Root

```bash
cd ..  # Go back to PersonalWebsite directory
```

### 2.3 Verify API URL

The `budget.js` file automatically detects local vs production. For local development, it uses:
```javascript
const API_BASE_URL = 'http://localhost:8002';
```

**Note**: Port 8002 is used to avoid conflicts with Ask-Gary (port 8000) and Casino games (port 3001).

### 2.4 Start a Local Web Server

You have several options:

**Option A: Python HTTP Server (Easiest)**
```bash
python -m http.server 5500
```

**Option B: Node.js HTTP Server**
```bash
npx http-server -p 5500
```

**Option C: VS Code Live Server**
- Install "Live Server" extension in VS Code
- Right-click on `budget.html` → "Open with Live Server"

**Option D: Direct File Access (Limited)**
- Just open `budget.html` directly in browser
- Note: Some features may not work due to CORS restrictions

### 2.5 Open the Application

Open your browser and go to:
```
http://localhost:5500/budget.html
```

Or if using Live Server, it should open automatically.

## Step 3: Test the Application

### 3.1 Initial Setup

1. You'll see a setup modal when you first open the app
2. Enter:
   - **Email**: Your email address (e.g., `test@example.com`)
   - **Monthly Income**: Any number (e.g., `5000`)
   - **Currency**: Select from dropdown (e.g., `USD`)
3. Click "Get Started"
4. The dashboard should load with default budgets

### 3.2 Test Receipt Upload

1. Click the **"Scan Receipt"** button
2. In the modal, either:
   - Click the upload area and select an image file, OR
   - Drag and drop a receipt image
3. You should see a preview of the image
4. Click **"Process Receipt"**
5. Wait 10-30 seconds for AI processing
6. The transaction should appear in your dashboard

**Tip:** Use a clear photo of a receipt. You can find sample receipts online or take a photo of any real receipt.

### 3.3 Test Manual Transaction

1. Click **"Add Manual"** button (next to Recent Transactions)
2. Fill in the form:
   - **Amount**: e.g., `25.50`
   - **Merchant**: e.g., `Starbucks`
   - **Category**: Select from dropdown (e.g., `Dining`)
   - **Description**: Optional (e.g., `Morning coffee`)
3. Click **"Add Transaction"**
4. The transaction should appear immediately

### 3.4 Test Dashboard Features

1. **Summary Cards**: Should show total budget, spent, and remaining
2. **Charts**: 
   - Pie chart showing spending by category
   - Bar chart comparing budget vs spending
3. **Category Breakdown**: Scroll down to see each category with progress bars
4. **Recent Transactions**: See your transactions listed

### 3.5 Test Recommendations

1. Add at least 3-5 transactions (mix of categories)
2. Click **"Recommendations"** button
3. You should see AI-powered budget suggestions
4. Each recommendation includes reasoning

### 3.6 Test Weekly Report (Optional)

If you configured email in `.env`:

1. Note your user ID from the browser's localStorage or backend logs
2. Send a POST request:
```bash
curl -X POST http://localhost:8000/users/1/send-weekly-report
```
(Replace `1` with your actual user ID)

Or use a tool like Postman, or add a button in the UI.

## Step 4: Verify Everything Works

### Checklist:

- [ ] Backend server is running on port 8000
- [ ] Frontend is accessible in browser
- [ ] Setup modal appears and creates user
- [ ] Dashboard loads with summary cards
- [ ] Charts display (may be empty initially)
- [ ] Can upload and process a receipt
- [ ] Can add manual transaction
- [ ] Transactions appear in the list
- [ ] Category breakdown updates
- [ ] Recommendations work (after adding transactions)

## Troubleshooting

### Backend Issues

**Problem: "Module not found" error**
```bash
# Make sure virtual environment is activated
# Reinstall dependencies
pip install -r requirements.txt
```

**Problem: "Port 8002 already in use"**
```bash
# Check what's using the port
sudo lsof -i :8002  # Mac/Linux
netstat -ano | findstr :8002  # Windows

# Use a different port if needed
uvicorn main:app --reload --port 8003
# Then update API_BASE_URL in budget.js if needed
```

**Note**: If port 8000 is in use, that's likely Ask-Gary. Budget app uses port 8002 by default.

**Problem: "OpenAI API error"**
- Check your `.env` file has the correct API key
- Make sure the key starts with `sk-`
- Verify you have credits in your OpenAI account

**Problem: "Database error"**
- Delete `budget.db` file and restart the server (it will recreate)
- Make sure you have write permissions in the directory

### Frontend Issues

**Problem: "Cannot connect to backend"**
- Check backend is running: Open http://localhost:8002/health in browser
- Check browser console (F12) for CORS errors
- Verify `API_BASE_URL` in `budget.js` matches backend URL (should be port 8002)

**Problem: "Charts not showing"**
- Check browser console for errors
- Make sure Chart.js is loading (check Network tab)
- Try refreshing the page

**Problem: "Receipt upload fails"**
- Check backend logs for errors
- Verify image file is valid (jpg, png, etc.)
- Check file size (max 10MB)
- Make sure `uploads/` directory exists

**Problem: "Setup modal doesn't appear"**
- Check browser console for errors
- Clear browser localStorage: Open console (F12) and type `localStorage.clear()`
- Refresh the page

### General Debugging

1. **Check Backend Logs**: Look at the terminal where uvicorn is running
2. **Check Browser Console**: Press F12 → Console tab
3. **Check Network Tab**: Press F12 → Network tab to see API requests
4. **Check Database**: The `budget.db` file contains all your data

## Quick Test Script

Run this to verify backend is working:

**Windows (PowerShell):**
```powershell
# Test health endpoint (note: port 8002, not 8000)
Invoke-WebRequest -Uri http://localhost:8002/health

# Test categories endpoint
Invoke-WebRequest -Uri http://localhost:8002/categories

# Create a test user (replace email)
$body = @{email="test@example.com";monthly_income=5000;currency="USD"} | ConvertTo-Json
Invoke-WebRequest -Uri http://localhost:8002/users -Method POST -Body $body -ContentType "application/json"
```

**Mac/Linux:**
```bash
# Test health endpoint (note: port 8002, not 8000)
curl http://localhost:8002/health

# Test categories endpoint
curl http://localhost:8002/categories

# Create a test user (replace email)
curl -X POST http://localhost:8002/users \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","monthly_income":5000,"currency":"USD"}'
```

## Visual Testing Flow

1. **Start Backend** → Terminal 1: `uvicorn main:app --reload --port 8002`
2. **Start Frontend Server** → Terminal 2: `python -m http.server 5500`
3. **Open Browser** → http://localhost:5500/budget.html
4. **Complete Setup** → Enter email, income, currency
5. **Add Transactions** → Upload receipt or add manually
6. **View Dashboard** → See charts, categories, transactions
7. **Get Recommendations** → Click recommendations button

## Next Steps

Once local testing works:
1. Review the code and customize as needed
2. Add more features
3. Set up production deployment (see `BUDGET_APP_README.md`)
4. Configure email for weekly reports
5. Consider adding authentication

## Getting Help

If something doesn't work:
1. Check the error messages in backend terminal
2. Check browser console (F12)
3. Verify all steps were followed correctly
4. Check that ports 8002 and 5500 are available (8000 is for Ask-Gary, 3001 is for Casino)
5. Make sure all dependencies are installed

Happy testing! 🎉
