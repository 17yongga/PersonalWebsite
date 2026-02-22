from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import declarative_base, relationship
from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, Text, JSON, Boolean
from datetime import datetime
from typing import Optional

from config import DATABASE_URL

Base = declarative_base()

engine = create_async_engine(DATABASE_URL, echo=False)
AsyncSessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class User(Base):
    __tablename__ = "users"
    
    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    monthly_income = Column(Float, default=0.0)
    currency = Column(String, default="USD")
    created_at = Column(DateTime, default=datetime.utcnow)
    
    transactions = relationship("Transaction", back_populates="user")
    budgets = relationship("Budget", back_populates="user")


class Transaction(Base):
    __tablename__ = "transactions"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    amount = Column(Float, nullable=False)
    currency = Column(String, default="USD")
    merchant = Column(String)
    category = Column(String, nullable=False)
    description = Column(Text)
    receipt_image_path = Column(String)
    items = Column(JSON)  # List of items from receipt
    is_shared = Column(Boolean, default=True)  # True for shared expenses, False for individual
    transaction_date = Column(DateTime, default=datetime.utcnow)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    user = relationship("User", back_populates="transactions")


class Budget(Base):
    __tablename__ = "budgets"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    category = Column(String, nullable=False)
    amount = Column(Float, nullable=False)
    period = Column(String, default="monthly")  # monthly, weekly
    month = Column(Integer)  # 1-12
    year = Column(Integer)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    user = relationship("User", back_populates="budgets")


async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def close_db():
    await engine.dispose()


async def get_db():
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()

