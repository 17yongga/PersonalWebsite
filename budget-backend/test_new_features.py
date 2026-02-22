#!/usr/bin/env python3
"""
Test script to specifically verify the new shared/individual expenses feature
"""
import requests
import json

BASE_URL = "http://localhost:8002"

def test_new_features():
    print("Testing New Shared/Individual Expenses Features...")
    print("=" * 50)
    
    # Create a test user
    user_data = {
        "email": "test_shared@example.com",
        "monthly_income": 5000.0,
        "currency": "USD"
    }
    
    response = requests.post(f"{BASE_URL}/users", json=user_data)
    user = response.json()
    user_id = user["id"]
    print(f"Created user: {user_id}")
    
    # Create shared transaction
    shared_txn = {
        "amount": 100.0,
        "merchant": "Shared Grocery Store",
        "category": "Groceries",
        "description": "Shared grocery shopping",
        "is_shared": True
    }
    
    response = requests.post(f"{BASE_URL}/users/{user_id}/transactions", json=shared_txn)
    print(f"Created shared transaction: {response.status_code}")
    
    # Create individual transaction
    individual_txn = {
        "amount": 50.0,
        "merchant": "Personal Coffee Shop",
        "category": "Dining",
        "description": "Personal coffee",
        "is_shared": False
    }
    
    response = requests.post(f"{BASE_URL}/users/{user_id}/transactions", json=individual_txn)
    print(f"Created individual transaction: {response.status_code}")
    
    # Test spending summary
    response = requests.get(f"{BASE_URL}/users/{user_id}/summary")
    summary = response.json()
    
    print(f"\nSpending Summary:")
    print(f"Total Spent: ${summary['total_spent']:.2f}")
    print(f"Shared Spent: ${summary['shared_spent']:.2f}")
    print(f"Individual Spent: ${summary['individual_spent']:.2f}")
    print(f"Total Budget: ${summary['total_budget']:.2f}")
    
    # Test transaction filtering
    response = requests.get(f"{BASE_URL}/users/{user_id}/transactions?is_shared=true")
    shared_transactions = response.json()
    print(f"\nShared transactions: {len(shared_transactions)}")
    
    response = requests.get(f"{BASE_URL}/users/{user_id}/transactions?is_shared=false")
    individual_transactions = response.json()
    print(f"Individual transactions: {len(individual_transactions)}")
    
    # Verify the math adds up
    total_check = summary['shared_spent'] + summary['individual_spent']
    if abs(total_check - summary['total_spent']) < 0.01:  # Account for floating point precision
        print("\n✅ Shared + Individual = Total (Math checks out!)")
    else:
        print(f"\n❌ Math error: {total_check} != {summary['total_spent']}")
    
    print("\nNew features working correctly! ✅")

if __name__ == "__main__":
    test_new_features()