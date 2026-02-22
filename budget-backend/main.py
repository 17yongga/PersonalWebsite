import os
import base64
import json
from datetime import datetime, timedelta
from typing import List, Optional, Dict, Any
from io import BytesIO

from fastapi import FastAPI, UploadFile, File, Depends, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, or_
from sqlalchemy.orm import selectinload
from pydantic import BaseModel, EmailStr
from openai import OpenAI
from PIL import Image
import aiofiles

from config import (
    OPENAI_API_KEY,
    CHAT_MODEL,
    VISION_MODEL,
    UPLOAD_DIR,
    MAX_UPLOAD_SIZE,
    DEFAULT_CATEGORIES,
    DEFAULT_BUDGET_ALLOCATION,
)
from database import (
    init_db,
    get_db,
    User,
    Transaction,
    Budget,
)
from receipt_processor import process_receipt_image, categorize_transaction
from budget_analyzer import (
    get_budget_summary,
    generate_adaptive_recommendations,
    calculate_spending_by_category,
)
from email_service import send_weekly_report

# Ensure upload directory exists
os.makedirs(UPLOAD_DIR, exist_ok=True)

app = FastAPI(title="Budget API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5500",
        "http://127.0.0.1:5500",
        "https://gary-yong.com",
        "http://localhost:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize OpenAI client with error handling
if not OPENAI_API_KEY:
    print("WARNING: OPENAI_API_KEY not found in environment variables.")
    print("Please create a .env file in budget-backend/ with: OPENAI_API_KEY=sk-your-key-here")
    print("Receipt scanning and AI features will not work without an API key.")
    client = None
else:
    client = OpenAI(api_key=OPENAI_API_KEY)

# Port configuration - Budget app uses port 8002 to avoid conflicts:
# - Ask-Gary uses port 8000
# - Casino Games use port 3001
# - Budget App uses port 8002
BUDGET_PORT = int(os.getenv("BUDGET_PORT", "8002"))


# Pydantic models
class TransactionCreate(BaseModel):
    amount: float
    currency: str = "USD"
    merchant: Optional[str] = None
    category: str
    description: Optional[str] = None
    is_shared: bool = True
    transaction_date: Optional[datetime] = None


class TransactionResponse(BaseModel):
    id: int
    amount: float
    currency: str
    merchant: Optional[str]
    category: str
    description: Optional[str]
    items: Optional[List[Dict]]
    is_shared: bool
    transaction_date: datetime

    model_config = {"from_attributes": True}


class BudgetCreate(BaseModel):
    category: str
    amount: float
    period: str = "monthly"


class BudgetResponse(BaseModel):
    id: int
    category: str
    amount: float
    period: str
    month: Optional[int]
    year: Optional[int]

    model_config = {"from_attributes": True}


class UserCreate(BaseModel):
    email: EmailStr
    monthly_income: float = 0.0
    currency: str = "USD"


class UserResponse(BaseModel):
    id: int
    email: str
    monthly_income: float
    currency: str

    model_config = {"from_attributes": True}


class SpendingSummary(BaseModel):
    total_spent: float
    shared_spent: float
    individual_spent: float
    total_budget: float
    remaining_budget: float
    by_category: Dict[str, Dict[str, float]]


class ReceiptUploadResponse(BaseModel):
    transaction: TransactionResponse
    extracted_data: Dict[str, Any]


@app.on_event("startup")
async def startup_event():
    await init_db()


@app.get("/health")
async def health():
    return {"status": "ok"}


# User endpoints
@app.post("/users", response_model=UserResponse)
async def create_user(user_data: UserCreate, db: AsyncSession = Depends(get_db)):
    # Check if user exists
    result = await db.execute(select(User).where(User.email == user_data.email))
    existing_user = result.scalar_one_or_none()
    
    if existing_user:
        return existing_user
    
    user = User(
        email=user_data.email,
        monthly_income=user_data.monthly_income,
        currency=user_data.currency,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    
    # Create default budgets
    current_date = datetime.now()
    for category, percentage in DEFAULT_BUDGET_ALLOCATION.items():
        budget_amount = (user_data.monthly_income * percentage / 100) if user_data.monthly_income > 0 else 0
        budget = Budget(
            user_id=user.id,
            category=category,
            amount=budget_amount,
            period="monthly",
            month=current_date.month,
            year=current_date.year,
        )
        db.add(budget)
    
    await db.commit()
    return user


@app.get("/users/{user_id}", response_model=UserResponse)
async def get_user(user_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


# Transaction endpoints
@app.post("/users/{user_id}/transactions", response_model=TransactionResponse)
async def create_transaction(
    user_id: int,
    transaction: TransactionCreate,
    db: AsyncSession = Depends(get_db),
):
    user_result = await db.execute(select(User).where(User.id == user_id))
    user = user_result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    txn = Transaction(
        user_id=user_id,
        amount=transaction.amount,
        currency=transaction.currency or user.currency,
        merchant=transaction.merchant,
        category=transaction.category,
        description=transaction.description,
        is_shared=transaction.is_shared,
        transaction_date=transaction.transaction_date or datetime.utcnow(),
    )
    db.add(txn)
    await db.commit()
    await db.refresh(txn)
    return txn


@app.post("/users/{user_id}/receipts/upload", response_model=ReceiptUploadResponse)
async def upload_receipt(
    user_id: int,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    if not client:
        raise HTTPException(
            status_code=503, 
            detail="OpenAI API key not configured. Please set OPENAI_API_KEY in .env file"
        )
    
    user_result = await db.execute(select(User).where(User.id == user_id))
    user = user_result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Validate file size
    contents = await file.read()
    if len(contents) > MAX_UPLOAD_SIZE:
        raise HTTPException(status_code=400, detail="File too large")
    
    # Save file
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    file_ext = os.path.splitext(file.filename)[1] or ".jpg"
    file_path = os.path.join(UPLOAD_DIR, f"{user_id}_{timestamp}{file_ext}")
    
    async with aiofiles.open(file_path, "wb") as f:
        await f.write(contents)
    
    try:
        # Process receipt with AI
        extracted_data = await process_receipt_image(file_path, client)
        
        # Categorize transaction
        category = await categorize_transaction(
            extracted_data.get("merchant", ""),
            extracted_data.get("items", []),
            extracted_data.get("total", 0),
            client,
        )
        
        # Create transaction
        txn = Transaction(
            user_id=user_id,
            amount=float(extracted_data.get("total", 0)),
            currency=extracted_data.get("currency", user.currency),
            merchant=extracted_data.get("merchant"),
            category=category,
            description=extracted_data.get("description"),
            receipt_image_path=file_path,
            items=extracted_data.get("items", []),
            is_shared=True,  # Default to shared for receipt uploads
            transaction_date=extracted_data.get("date") or datetime.utcnow(),
        )
        db.add(txn)
        await db.commit()
        await db.refresh(txn)
        
        return ReceiptUploadResponse(
            transaction=TransactionResponse.model_validate(txn),
            extracted_data=extracted_data,
        )
    except Exception as e:
        # Clean up file on error
        if os.path.exists(file_path):
            os.remove(file_path)
        raise HTTPException(status_code=500, detail=f"Error processing receipt: {str(e)}")


@app.get("/users/{user_id}/transactions", response_model=List[TransactionResponse])
async def get_transactions(
    user_id: int,
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
    category: Optional[str] = None,
    is_shared: Optional[bool] = None,
    limit: int = 100,
    db: AsyncSession = Depends(get_db),
):
    query = select(Transaction).where(Transaction.user_id == user_id)
    
    if start_date:
        query = query.where(Transaction.transaction_date >= start_date)
    if end_date:
        query = query.where(Transaction.transaction_date <= end_date)
    if category:
        query = query.where(Transaction.category == category)
    if is_shared is not None:
        query = query.where(Transaction.is_shared == is_shared)
    
    query = query.order_by(Transaction.transaction_date.desc()).limit(limit)
    
    result = await db.execute(query)
    transactions = result.scalars().all()
    return transactions


# Budget endpoints
@app.post("/users/{user_id}/budgets", response_model=BudgetResponse)
async def create_budget(
    user_id: int,
    budget: BudgetCreate,
    db: AsyncSession = Depends(get_db),
):
    user_result = await db.execute(select(User).where(User.id == user_id))
    user = user_result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    current_date = datetime.now()
    budget_obj = Budget(
        user_id=user_id,
        category=budget.category,
        amount=budget.amount,
        period=budget.period,
        month=current_date.month,
        year=current_date.year,
    )
    db.add(budget_obj)
    await db.commit()
    await db.refresh(budget_obj)
    return budget_obj


@app.get("/users/{user_id}/budgets", response_model=List[BudgetResponse])
async def get_budgets(
    user_id: int,
    month: Optional[int] = None,
    year: Optional[int] = None,
    db: AsyncSession = Depends(get_db),
):
    query = select(Budget).where(Budget.user_id == user_id)
    
    current_date = datetime.now()
    if not month:
        month = current_date.month
    if not year:
        year = current_date.year
    
    query = query.where(
        and_(Budget.month == month, Budget.year == year)
    )
    
    result = await db.execute(query)
    budgets = result.scalars().all()
    return budgets


@app.put("/users/{user_id}/budgets/{budget_id}", response_model=BudgetResponse)
async def update_budget(
    user_id: int,
    budget_id: int,
    amount: float,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Budget).where(
            and_(Budget.id == budget_id, Budget.user_id == user_id)
        )
    )
    budget = result.scalar_one_or_none()
    if not budget:
        raise HTTPException(status_code=404, detail="Budget not found")
    
    budget.amount = amount
    budget.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(budget)
    return budget


# Analytics endpoints
@app.get("/users/{user_id}/summary", response_model=SpendingSummary)
async def get_spending_summary(
    user_id: int,
    month: Optional[int] = None,
    year: Optional[int] = None,
    db: AsyncSession = Depends(get_db),
):
    current_date = datetime.now()
    if not month:
        month = current_date.month
    if not year:
        year = current_date.year
    
    start_date = datetime(year, month, 1)
    if month == 12:
        end_date = datetime(year + 1, 1, 1)
    else:
        end_date = datetime(year, month + 1, 1)
    
    # Get budgets
    budget_result = await db.execute(
        select(Budget).where(
            and_(
                Budget.user_id == user_id,
                Budget.month == month,
                Budget.year == year,
            )
        )
    )
    budgets = {b.category: b.amount for b in budget_result.scalars().all()}
    
    # Get transactions
    txn_result = await db.execute(
        select(Transaction).where(
            and_(
                Transaction.user_id == user_id,
                Transaction.transaction_date >= start_date,
                Transaction.transaction_date < end_date,
            )
        )
    )
    transactions = txn_result.scalars().all()
    
    # Calculate spending by category and shared/individual split
    spending_by_category = calculate_spending_by_category(transactions)
    
    total_budget = sum(budgets.values())
    total_spent = sum(t.amount for t in transactions)
    shared_spent = sum(t.amount for t in transactions if t.is_shared)
    individual_spent = sum(t.amount for t in transactions if not t.is_shared)
    
    by_category = {}
    for category in set(list(budgets.keys()) + list(spending_by_category.keys())):
        budget_amount = budgets.get(category, 0)
        spent_amount = spending_by_category.get(category, 0)
        by_category[category] = {
            "budget": budget_amount,
            "spent": spent_amount,
            "remaining": budget_amount - spent_amount,
        }
    
    return SpendingSummary(
        total_spent=total_spent,
        shared_spent=shared_spent,
        individual_spent=individual_spent,
        total_budget=total_budget,
        remaining_budget=total_budget - total_spent,
        by_category=by_category,
    )


@app.get("/users/{user_id}/recommendations")
async def get_recommendations(
    user_id: int,
    db: AsyncSession = Depends(get_db),
):
    if not client:
        raise HTTPException(
            status_code=503, 
            detail="OpenAI API key not configured. Please set OPENAI_API_KEY in .env file"
        )
    
    # Get user
    user_result = await db.execute(select(User).where(User.id == user_id))
    user = user_result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Get last 3 months of transactions
    three_months_ago = datetime.now() - timedelta(days=90)
    txn_result = await db.execute(
        select(Transaction).where(
            and_(
                Transaction.user_id == user_id,
                Transaction.transaction_date >= three_months_ago,
            )
        )
    )
    transactions = txn_result.scalars().all()
    
    # Get current budgets
    current_date = datetime.now()
    budget_result = await db.execute(
        select(Budget).where(
            and_(
                Budget.user_id == user_id,
                Budget.month == current_date.month,
                Budget.year == current_date.year,
            )
        )
    )
    budgets = {b.category: b.amount for b in budget_result.scalars().all()}
    
    recommendations = await generate_adaptive_recommendations(
        transactions, budgets, user.monthly_income, client
    )
    
    return recommendations


@app.post("/users/{user_id}/send-weekly-report")
async def trigger_weekly_report(
    user_id: int,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    user_result = await db.execute(select(User).where(User.id == user_id))
    user = user_result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Schedule email in background
    background_tasks.add_task(send_weekly_report_task, user_id)
    
    return {"message": "Weekly report email scheduled"}


async def send_weekly_report_task(user_id: int):
    # This will run in background
    if not client:
        print("WARNING: Cannot send weekly report - OpenAI API key not configured")
        return
    
    # Create a new session for background task
    from database import AsyncSessionLocal
    async_db = AsyncSessionLocal()
    try:
        await send_weekly_report(user_id, async_db, client)
    finally:
        await async_db.close()


@app.get("/categories")
async def get_categories():
    return {"categories": DEFAULT_CATEGORIES}

