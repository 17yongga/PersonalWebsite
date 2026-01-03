# Budget Assistant - Quick Start Guide

## Prerequisites

- Python 3.8+
- OpenAI API key
- (Optional) Email account for weekly reports

## Quick Setup (5 minutes)

### 1. Backend Setup

```bash
# Navigate to backend directory
cd budget-backend

# Create virtual environment
python -m venv venv

# Activate virtual environment
# On Windows:
venv\Scripts\activate
# On Mac/Linux:
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Create .env file
copy .env.example .env  # Windows
# or
cp .env.example .env    # Mac/Linux

# Edit .env and add your OPENAI_API_KEY
# OPENAI_API_KEY=sk-...

# Create uploads directory
mkdir uploads

# Start the server (port 8002 to avoid conflict with Ask-Gary on 8000)
uvicorn main:app --reload --host 0.0.0.0 --port 8002
```

Backend should now be running at `http://localhost:8002`

**Port Note**: Budget app uses port 8002 (Ask-Gary uses 8000, Casino uses 3001)

### 2. Frontend Setup

The frontend files are already in the root directory:
- `budget.html` - Main application page
- `budget.css` - Styles
- `budget.js` - Application logic

**Option A: Direct file access**
- Simply open `budget.html` in your browser
- Update the API URL in `budget.js` line 4 if needed

**Option B: Local server (recommended)**
```bash
# Using Python
python -m http.server 5500

# Using Node.js
npx http-server -p 5500

# Then open http://localhost:5500/budget.html
```

### 3. First Use

1. Open `budget.html` in your browser
2. You'll see a setup modal - enter:
   - Your email address
   - Monthly income
   - Currency preference
3. Click "Get Started"
4. The dashboard will load with default budgets based on your income

### 4. Test Features

**Upload a Receipt:**
1. Click "Scan Receipt" button
2. Upload an image of a receipt (or take a photo on mobile)
3. Wait for AI processing (10-30 seconds)
4. Review the extracted transaction details
5. The transaction is automatically categorized and added

**Add Manual Transaction:**
1. Click "Add Manual" button
2. Fill in amount, merchant, category, and description
3. Click "Add Transaction"

**View Recommendations:**
1. Click "Recommendations" button
2. See AI-powered budget adjustment suggestions based on your spending patterns

**Weekly Email Report:**
1. Click the API endpoint: `POST /users/{user_id}/send-weekly-report`
2. Or set up a cron job/systemd timer for automatic weekly emails

## Testing Tips

1. **Test Receipt Upload**: Use a clear, well-lit photo of a receipt. The AI works best with:
   - Clear text
   - Complete receipt (including totals)
   - Common merchants (grocery stores, restaurants, etc.)

2. **Test Categories**: Try transactions in different categories to see the categorization in action

3. **Test Budget Tracking**: Add several transactions to see the charts and progress bars update

4. **Test Recommendations**: After adding 10+ transactions, check recommendations for personalized suggestions

## Troubleshooting

**Backend won't start:**
- Check that port 8002 is available (8000 is for Ask-Gary, 3001 is for Casino)
- Verify virtual environment is activated
- Check that all dependencies are installed: `pip install -r requirements.txt`

**Receipt processing fails:**
- Verify OpenAI API key is set correctly in `.env`
- Check that the image file is valid (jpg, png, etc.)
- Ensure image is not too large (max 10MB)

**Frontend can't connect to backend:**
- Check that backend is running on port 8002 (see `PORT_ASSIGNMENTS.md` for port allocations)
- Update `API_BASE_URL` in `budget.js` if backend is on different port
- Check browser console for CORS errors

**Email reports not sending:**
- Verify SMTP settings in `.env`
- For Gmail, use an App Password (not your regular password)
- Check backend logs for email errors

## Next Steps

- Review `BUDGET_APP_README.md` for detailed documentation
- Check `budget-backend/README.md` for API documentation
- Customize categories in `budget-backend/config.py`
- Set up production deployment (see main README)

## Production Deployment

For deployment to gary-yong.com:

1. **Backend (EC2)**:
   - Set up systemd service (see `budget-backend/README.md`)
   - Configure nginx reverse proxy
   - Set environment variables securely
   - Use PostgreSQL for production (optional but recommended)

2. **Frontend (S3)**:
   - Upload `budget.html`, `budget.css`, `budget.js` to S3
   - Update `API_BASE_URL` in `budget.js` to production URL
   - Enable static website hosting on S3 bucket

3. **Security**:
   - Add authentication (currently single-user via localStorage)
   - Use environment variables for secrets
   - Enable HTTPS
   - Set up proper CORS policies

## Support

For issues or questions:
- Check the main README files
- Review API documentation in `budget-backend/README.md`
- Check browser console and backend logs for errors

