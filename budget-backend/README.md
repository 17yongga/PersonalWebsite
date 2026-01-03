# Budget Assistant Backend

AI-powered personal budget application backend built with FastAPI.

## Features

- **Receipt Scanning**: Upload receipt images and automatically extract transaction details using OpenAI Vision API
- **AI Categorization**: Automatically categorize transactions using AI
- **Budget Management**: Set and track budgets by category
- **Weekly Email Reports**: Receive natural language summaries of your spending
- **Adaptive Recommendations**: Get AI-powered budget allocation recommendations based on historical spending
- **Multi-currency Support**: Support for USD, CAD, EUR, GBP, and more

## Setup

### 1. Install Dependencies

```bash
cd budget-backend
pip install -r requirements.txt
```

### 2. Configure Environment Variables

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

Required:
- `OPENAI_API_KEY`: Your OpenAI API key (required for receipt OCR and categorization)

Optional (for email reports):
- `SMTP_HOST`: SMTP server hostname (default: smtp.gmail.com)
- `SMTP_PORT`: SMTP port (default: 587)
- `SMTP_USER`: Your email address
- `SMTP_PASSWORD`: Your email password or app password
- `EMAIL_FROM`: Email address to send from

### 3. Create Upload Directory

```bash
mkdir uploads
```

### 4. Run the Server

```bash
uvicorn main:app --reload --host 0.0.0.0 --port 8002
```

The API will be available at `http://localhost:8002`

**Note**: Budget app uses port 8002 to avoid conflicts:
- Ask-Gary backend uses port 8000
- Casino games use port 3001
- Budget app uses port 8002

## API Endpoints

### Health Check
- `GET /health` - Check if the API is running

### Users
- `POST /users` - Create a new user
- `GET /users/{user_id}` - Get user details

### Transactions
- `POST /users/{user_id}/transactions` - Create a manual transaction
- `POST /users/{user_id}/receipts/upload` - Upload and process a receipt image
- `GET /users/{user_id}/transactions` - Get user transactions (supports query params: start_date, end_date, category, limit)

### Budgets
- `POST /users/{user_id}/budgets` - Create a budget
- `GET /users/{user_id}/budgets` - Get budgets for a month/year
- `PUT /users/{user_id}/budgets/{budget_id}` - Update a budget

### Analytics
- `GET /users/{user_id}/summary` - Get spending summary with budget breakdown
- `GET /users/{user_id}/recommendations` - Get AI-powered budget recommendations
- `POST /users/{user_id}/send-weekly-report` - Trigger a weekly email report

### Utilities
- `GET /categories` - Get list of available categories

## Database

The application uses SQLite by default (stored in `budget.db`). The database is automatically created on first run.

To use a different database, update `DATABASE_URL` in `config.py`.

## Production Deployment

### On EC2

1. Install dependencies in a virtual environment
2. Set up environment variables
3. Use a process manager like systemd or PM2
4. Configure nginx as a reverse proxy
5. Set up SSL certificates

Example systemd service file:

```ini
[Unit]
Description=Budget Assistant API
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/PersonalWebsite/budget-backend
Environment="PATH=/home/ubuntu/PersonalWebsite/budget-backend/venv/bin"
ExecStart=/home/ubuntu/PersonalWebsite/budget-backend/venv/bin/uvicorn main:app --host 0.0.0.0 --port 8002
Restart=always

[Install]
WantedBy=multi-user.target
```

### Nginx Configuration

```nginx
location /api/budget/ {
    proxy_pass http://localhost:8002/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

## Notes

- Receipt images are stored in the `uploads/` directory
- The application supports multiple users (each user has their own budgets and transactions)
- Weekly email reports can be triggered manually or set up as a scheduled task (cron/systemd timer)
- For production, consider using a more robust database (PostgreSQL) and file storage (S3)

