#!/usr/bin/env python3
"""
Comprehensive API Testing Script for Budget Backend
Tests all endpoints with various scenarios including edge cases.
"""
import requests
import json
from datetime import datetime, timedelta
import sys

# Base URL for the API
BASE_URL = "http://localhost:8002"

# Test results storage
test_results = []

def log_test(test_name, passed, message=""):
    """Log test result"""
    status = "PASS" if passed else "FAIL"
    test_results.append({
        "test": test_name,
        "status": status,
        "message": message
    })
    print(f"[{status}] {test_name} - {message}")

def test_health_endpoint():
    """Test /health endpoint"""
    try:
        response = requests.get(f"{BASE_URL}/health")
        passed = response.status_code == 200 and response.json() == {"status": "ok"}
        log_test("Health Endpoint", passed, f"Status: {response.status_code}")
        return passed
    except Exception as e:
        log_test("Health Endpoint", False, f"Error: {str(e)}")
        return False

def test_categories_endpoint():
    """Test /categories endpoint"""
    try:
        response = requests.get(f"{BASE_URL}/categories")
        passed = response.status_code == 200 and "categories" in response.json()
        categories = response.json().get("categories", [])
        log_test("Categories Endpoint", passed, f"Categories count: {len(categories)}")
        return passed, categories
    except Exception as e:
        log_test("Categories Endpoint", False, f"Error: {str(e)}")
        return False, []

def test_create_user_valid():
    """Test creating a valid user"""
    user_data = {
        "email": "test@example.com",
        "monthly_income": 5000.0,
        "currency": "USD"
    }
    try:
        response = requests.post(f"{BASE_URL}/users", json=user_data)
        passed = response.status_code == 200
        user = response.json()
        log_test("Create Valid User", passed, f"User ID: {user.get('id', 'N/A')}")
        return passed, user
    except Exception as e:
        log_test("Create Valid User", False, f"Error: {str(e)}")
        return False, {}

def test_create_user_duplicate():
    """Test creating duplicate user (should return existing user)"""
    user_data = {
        "email": "test@example.com",
        "monthly_income": 5000.0,
        "currency": "USD"
    }
    try:
        response = requests.post(f"{BASE_URL}/users", json=user_data)
        passed = response.status_code == 200
        log_test("Create Duplicate User", passed, "Should return existing user")
        return passed
    except Exception as e:
        log_test("Create Duplicate User", False, f"Error: {str(e)}")
        return False

def test_create_user_invalid_email():
    """Test creating user with invalid email"""
    user_data = {
        "email": "invalid-email",
        "monthly_income": 5000.0,
        "currency": "USD"
    }
    try:
        response = requests.post(f"{BASE_URL}/users", json=user_data)
        passed = response.status_code == 422  # Validation error
        log_test("Create User Invalid Email", passed, f"Status: {response.status_code}")
        return passed
    except Exception as e:
        log_test("Create User Invalid Email", False, f"Error: {str(e)}")
        return False

def test_create_user_negative_income():
    """Test creating user with negative income"""
    user_data = {
        "email": "negative@example.com",
        "monthly_income": -1000.0,
        "currency": "USD"
    }
    try:
        response = requests.post(f"{BASE_URL}/users", json=user_data)
        # This should still work as negative income might be valid
        passed = response.status_code == 200
        log_test("Create User Negative Income", passed, f"Status: {response.status_code}")
        return passed, response.json()
    except Exception as e:
        log_test("Create User Negative Income", False, f"Error: {str(e)}")
        return False, {}

def test_get_user_valid(user_id):
    """Test getting a valid user"""
    try:
        response = requests.get(f"{BASE_URL}/users/{user_id}")
        passed = response.status_code == 200 and response.json().get("id") == user_id
        log_test("Get Valid User", passed, f"User ID: {user_id}")
        return passed
    except Exception as e:
        log_test("Get Valid User", False, f"Error: {str(e)}")
        return False

def test_get_user_nonexistent():
    """Test getting a non-existent user"""
    try:
        response = requests.get(f"{BASE_URL}/users/99999")
        passed = response.status_code == 404
        log_test("Get Nonexistent User", passed, f"Status: {response.status_code}")
        return passed
    except Exception as e:
        log_test("Get Nonexistent User", False, f"Error: {str(e)}")
        return False

def test_create_transaction_valid(user_id, categories):
    """Test creating a valid transaction"""
    transaction_data = {
        "amount": 25.99,
        "currency": "USD",
        "merchant": "Test Store",
        "category": categories[0] if categories else "Groceries",
        "description": "Test purchase",
        "is_shared": True
    }
    try:
        response = requests.post(f"{BASE_URL}/users/{user_id}/transactions", json=transaction_data)
        passed = response.status_code == 200
        transaction = response.json()
        log_test("Create Valid Transaction", passed, f"Transaction ID: {transaction.get('id', 'N/A')}")
        return passed, transaction
    except Exception as e:
        log_test("Create Valid Transaction", False, f"Error: {str(e)}")
        return False, {}

def test_create_transaction_negative_amount(user_id, categories):
    """Test creating a transaction with negative amount"""
    transaction_data = {
        "amount": -10.0,
        "currency": "USD",
        "merchant": "Refund Store",
        "category": categories[0] if categories else "Groceries",
        "description": "Refund"
    }
    try:
        response = requests.post(f"{BASE_URL}/users/{user_id}/transactions", json=transaction_data)
        passed = response.status_code == 200  # Negative amounts might be valid (refunds)
        log_test("Create Negative Amount Transaction", passed, f"Status: {response.status_code}")
        return passed
    except Exception as e:
        log_test("Create Negative Amount Transaction", False, f"Error: {str(e)}")
        return False

def test_create_transaction_zero_amount(user_id, categories):
    """Test creating a transaction with zero amount"""
    transaction_data = {
        "amount": 0.0,
        "currency": "USD",
        "merchant": "Free Store",
        "category": categories[0] if categories else "Groceries",
        "description": "Free item"
    }
    try:
        response = requests.post(f"{BASE_URL}/users/{user_id}/transactions", json=transaction_data)
        passed = response.status_code == 200
        log_test("Create Zero Amount Transaction", passed, f"Status: {response.status_code}")
        return passed
    except Exception as e:
        log_test("Create Zero Amount Transaction", False, f"Error: {str(e)}")
        return False

def test_create_transaction_large_amount(user_id, categories):
    """Test creating a transaction with very large amount"""
    transaction_data = {
        "amount": 999999.99,
        "currency": "USD",
        "merchant": "Expensive Store",
        "category": categories[0] if categories else "Groceries",
        "description": "Very expensive item"
    }
    try:
        response = requests.post(f"{BASE_URL}/users/{user_id}/transactions", json=transaction_data)
        passed = response.status_code == 200
        log_test("Create Large Amount Transaction", passed, f"Status: {response.status_code}")
        return passed
    except Exception as e:
        log_test("Create Large Amount Transaction", False, f"Error: {str(e)}")
        return False

def test_create_transaction_individual(user_id, categories):
    """Test creating an individual (non-shared) transaction"""
    transaction_data = {
        "amount": 15.50,
        "currency": "USD",
        "merchant": "Personal Store",
        "category": categories[1] if len(categories) > 1 else "Dining",
        "description": "Personal purchase",
        "is_shared": False
    }
    try:
        response = requests.post(f"{BASE_URL}/users/{user_id}/transactions", json=transaction_data)
        passed = response.status_code == 200
        transaction = response.json()
        is_individual = not transaction.get('is_shared', True)
        log_test("Create Individual Transaction", passed and is_individual, 
                f"Transaction ID: {transaction.get('id', 'N/A')}, Is Individual: {is_individual}")
        return passed and is_individual
    except Exception as e:
        log_test("Create Individual Transaction", False, f"Error: {str(e)}")
        return False

def test_create_transaction_invalid_category(user_id):
    """Test creating a transaction with invalid category"""
    transaction_data = {
        "amount": 25.99,
        "currency": "USD",
        "merchant": "Test Store",
        "category": "InvalidCategory12345",
        "description": "Test purchase"
    }
    try:
        response = requests.post(f"{BASE_URL}/users/{user_id}/transactions", json=transaction_data)
        passed = response.status_code == 200  # API might allow any category string
        log_test("Create Invalid Category Transaction", passed, f"Status: {response.status_code}")
        return passed
    except Exception as e:
        log_test("Create Invalid Category Transaction", False, f"Error: {str(e)}")
        return False

def test_create_transaction_missing_required_fields(user_id):
    """Test creating a transaction with missing required fields"""
    transaction_data = {
        "currency": "USD",
        "merchant": "Test Store",
        # Missing amount and category
    }
    try:
        response = requests.post(f"{BASE_URL}/users/{user_id}/transactions", json=transaction_data)
        passed = response.status_code == 422  # Validation error
        log_test("Create Transaction Missing Fields", passed, f"Status: {response.status_code}")
        return passed
    except Exception as e:
        log_test("Create Transaction Missing Fields", False, f"Error: {str(e)}")
        return False

def test_create_transaction_nonexistent_user():
    """Test creating a transaction for non-existent user"""
    transaction_data = {
        "amount": 25.99,
        "currency": "USD",
        "merchant": "Test Store",
        "category": "Groceries",
        "description": "Test purchase"
    }
    try:
        response = requests.post(f"{BASE_URL}/users/99999/transactions", json=transaction_data)
        passed = response.status_code == 404
        log_test("Create Transaction Nonexistent User", passed, f"Status: {response.status_code}")
        return passed
    except Exception as e:
        log_test("Create Transaction Nonexistent User", False, f"Error: {str(e)}")
        return False

def test_get_transactions(user_id):
    """Test getting user transactions"""
    try:
        response = requests.get(f"{BASE_URL}/users/{user_id}/transactions")
        passed = response.status_code == 200 and isinstance(response.json(), list)
        transactions = response.json()
        log_test("Get Transactions", passed, f"Transactions count: {len(transactions)}")
        return passed, transactions
    except Exception as e:
        log_test("Get Transactions", False, f"Error: {str(e)}")
        return False, []

def test_get_transactions_with_filters(user_id):
    """Test getting transactions with filters"""
    # Test date filter
    start_date = (datetime.now() - timedelta(days=30)).isoformat()
    end_date = datetime.now().isoformat()
    
    params = {
        "start_date": start_date,
        "end_date": end_date,
        "limit": 50
    }
    
    try:
        response = requests.get(f"{BASE_URL}/users/{user_id}/transactions", params=params)
        passed = response.status_code == 200
        log_test("Get Transactions With Filters", passed, f"Status: {response.status_code}")
        return passed
    except Exception as e:
        log_test("Get Transactions With Filters", False, f"Error: {str(e)}")
        return False

def test_get_transactions_filter_by_shared(user_id):
    """Test getting transactions filtered by shared status"""
    # Test shared transactions
    params = {"is_shared": True}
    try:
        response = requests.get(f"{BASE_URL}/users/{user_id}/transactions", params=params)
        passed = response.status_code == 200
        log_test("Get Shared Transactions", passed, f"Status: {response.status_code}")
        
        # Test individual transactions  
        params = {"is_shared": False}
        response = requests.get(f"{BASE_URL}/users/{user_id}/transactions", params=params)
        passed = response.status_code == 200
        log_test("Get Individual Transactions", passed, f"Status: {response.status_code}")
        return passed
    except Exception as e:
        log_test("Get Transactions Filter by Shared", False, f"Error: {str(e)}")
        return False

def test_get_transactions_nonexistent_user():
    """Test getting transactions for non-existent user"""
    try:
        response = requests.get(f"{BASE_URL}/users/99999/transactions")
        passed = response.status_code == 200 and response.json() == []  # Empty list for nonexistent user
        log_test("Get Transactions Nonexistent User", passed, f"Status: {response.status_code}")
        return passed
    except Exception as e:
        log_test("Get Transactions Nonexistent User", False, f"Error: {str(e)}")
        return False

def test_create_budget(user_id, categories):
    """Test creating a budget"""
    budget_data = {
        "category": categories[0] if categories else "Groceries",
        "amount": 500.0,
        "period": "monthly"
    }
    try:
        response = requests.post(f"{BASE_URL}/users/{user_id}/budgets", json=budget_data)
        passed = response.status_code == 200
        budget = response.json()
        log_test("Create Budget", passed, f"Budget ID: {budget.get('id', 'N/A')}")
        return passed, budget
    except Exception as e:
        log_test("Create Budget", False, f"Error: {str(e)}")
        return False, {}

def test_create_budget_negative_amount(user_id, categories):
    """Test creating a budget with negative amount"""
    budget_data = {
        "category": categories[1] if len(categories) > 1 else "Dining",
        "amount": -100.0,
        "period": "monthly"
    }
    try:
        response = requests.post(f"{BASE_URL}/users/{user_id}/budgets", json=budget_data)
        passed = response.status_code == 200  # Might be allowed
        log_test("Create Budget Negative Amount", passed, f"Status: {response.status_code}")
        return passed
    except Exception as e:
        log_test("Create Budget Negative Amount", False, f"Error: {str(e)}")
        return False

def test_create_budget_zero_amount(user_id, categories):
    """Test creating a budget with zero amount"""
    budget_data = {
        "category": categories[2] if len(categories) > 2 else "Entertainment",
        "amount": 0.0,
        "period": "monthly"
    }
    try:
        response = requests.post(f"{BASE_URL}/users/{user_id}/budgets", json=budget_data)
        passed = response.status_code == 200
        log_test("Create Budget Zero Amount", passed, f"Status: {response.status_code}")
        return passed
    except Exception as e:
        log_test("Create Budget Zero Amount", False, f"Error: {str(e)}")
        return False

def test_create_budget_nonexistent_user():
    """Test creating a budget for non-existent user"""
    budget_data = {
        "category": "Groceries",
        "amount": 500.0,
        "period": "monthly"
    }
    try:
        response = requests.post(f"{BASE_URL}/users/99999/budgets", json=budget_data)
        passed = response.status_code == 404
        log_test("Create Budget Nonexistent User", passed, f"Status: {response.status_code}")
        return passed
    except Exception as e:
        log_test("Create Budget Nonexistent User", False, f"Error: {str(e)}")
        return False

def test_get_budgets(user_id):
    """Test getting user budgets"""
    try:
        response = requests.get(f"{BASE_URL}/users/{user_id}/budgets")
        passed = response.status_code == 200 and isinstance(response.json(), list)
        budgets = response.json()
        log_test("Get Budgets", passed, f"Budgets count: {len(budgets)}")
        return passed, budgets
    except Exception as e:
        log_test("Get Budgets", False, f"Error: {str(e)}")
        return False, []

def test_get_budgets_with_filters(user_id):
    """Test getting budgets with month/year filters"""
    current_date = datetime.now()
    params = {
        "month": current_date.month,
        "year": current_date.year
    }
    try:
        response = requests.get(f"{BASE_URL}/users/{user_id}/budgets", params=params)
        passed = response.status_code == 200
        log_test("Get Budgets With Filters", passed, f"Status: {response.status_code}")
        return passed
    except Exception as e:
        log_test("Get Budgets With Filters", False, f"Error: {str(e)}")
        return False

def test_update_budget(user_id, budget_id):
    """Test updating a budget"""
    new_amount = 750.0
    try:
        response = requests.put(f"{BASE_URL}/users/{user_id}/budgets/{budget_id}", 
                               params={"amount": new_amount})
        passed = response.status_code == 200
        updated_budget = response.json()
        amount_updated = updated_budget.get("amount") == new_amount
        log_test("Update Budget", passed and amount_updated, 
                f"Status: {response.status_code}, Amount: {updated_budget.get('amount')}")
        return passed and amount_updated
    except Exception as e:
        log_test("Update Budget", False, f"Error: {str(e)}")
        return False

def test_update_budget_nonexistent(user_id):
    """Test updating a non-existent budget"""
    try:
        response = requests.put(f"{BASE_URL}/users/{user_id}/budgets/99999", 
                               params={"amount": 100.0})
        passed = response.status_code == 404
        log_test("Update Nonexistent Budget", passed, f"Status: {response.status_code}")
        return passed
    except Exception as e:
        log_test("Update Nonexistent Budget", False, f"Error: {str(e)}")
        return False

def test_get_spending_summary(user_id):
    """Test getting spending summary"""
    try:
        response = requests.get(f"{BASE_URL}/users/{user_id}/summary")
        passed = response.status_code == 200
        summary = response.json()
        
        # Check required fields including new shared/individual fields
        required_fields = ["total_spent", "shared_spent", "individual_spent", 
                          "total_budget", "remaining_budget", "by_category"]
        has_all_fields = all(field in summary for field in required_fields)
        
        # Validate that shared + individual = total
        total_matches = (summary.get("shared_spent", 0) + summary.get("individual_spent", 0) 
                        == summary.get("total_spent", 0))
        
        log_test("Get Spending Summary", passed and has_all_fields and total_matches, 
                f"Status: {response.status_code}, Fields: {has_all_fields}, Total matches: {total_matches}")
        return passed and has_all_fields and total_matches
    except Exception as e:
        log_test("Get Spending Summary", False, f"Error: {str(e)}")
        return False

def test_get_spending_summary_with_filters(user_id):
    """Test getting spending summary with month/year filters"""
    current_date = datetime.now()
    params = {
        "month": current_date.month,
        "year": current_date.year
    }
    try:
        response = requests.get(f"{BASE_URL}/users/{user_id}/summary", params=params)
        passed = response.status_code == 200
        log_test("Get Spending Summary With Filters", passed, f"Status: {response.status_code}")
        return passed
    except Exception as e:
        log_test("Get Spending Summary With Filters", False, f"Error: {str(e)}")
        return False

def test_get_spending_summary_nonexistent_user():
    """Test getting spending summary for non-existent user"""
    try:
        response = requests.get(f"{BASE_URL}/users/99999/summary")
        # This might return empty data or 404 depending on implementation
        passed = response.status_code in [200, 404]
        log_test("Get Summary Nonexistent User", passed, f"Status: {response.status_code}")
        return passed
    except Exception as e:
        log_test("Get Summary Nonexistent User", False, f"Error: {str(e)}")
        return False

def run_all_tests():
    """Run all tests in sequence"""
    print("Starting Comprehensive API Tests...")
    print("=" * 60)
    
    # Basic endpoint tests
    if not test_health_endpoint():
        print("Health endpoint failed - server might not be running")
        return False
    
    categories_success, categories = test_categories_endpoint()
    
    # User tests
    user_success, user = test_create_user_valid()
    if not user_success:
        print("Failed to create test user - stopping tests")
        return False
    
    user_id = user.get("id")
    
    test_create_user_duplicate()
    test_create_user_invalid_email()
    neg_income_success, neg_user = test_create_user_negative_income()
    
    test_get_user_valid(user_id)
    test_get_user_nonexistent()
    
    # Transaction tests
    test_create_transaction_valid(user_id, categories)
    test_create_transaction_individual(user_id, categories)
    test_create_transaction_negative_amount(user_id, categories)
    test_create_transaction_zero_amount(user_id, categories)
    test_create_transaction_large_amount(user_id, categories)
    test_create_transaction_invalid_category(user_id)
    test_create_transaction_missing_required_fields(user_id)
    test_create_transaction_nonexistent_user()
    
    transactions_success, transactions = test_get_transactions(user_id)
    test_get_transactions_with_filters(user_id)
    test_get_transactions_filter_by_shared(user_id)
    test_get_transactions_nonexistent_user()
    
    # Budget tests
    budget_success, budget = test_create_budget(user_id, categories)
    budget_id = budget.get("id") if budget_success else 1
    
    test_create_budget_negative_amount(user_id, categories)
    test_create_budget_zero_amount(user_id, categories)
    test_create_budget_nonexistent_user()
    
    budgets_success, budgets = test_get_budgets(user_id)
    test_get_budgets_with_filters(user_id)
    
    if budget_id:
        test_update_budget(user_id, budget_id)
    test_update_budget_nonexistent(user_id)
    
    # Summary tests
    test_get_spending_summary(user_id)
    test_get_spending_summary_with_filters(user_id)
    test_get_spending_summary_nonexistent_user()
    
    # Print summary
    print("\n" + "=" * 60)
    print("TEST SUMMARY")
    print("=" * 60)
    
    passed_count = sum(1 for result in test_results if result["status"] == "PASS")
    total_count = len(test_results)
    
    print(f"Total Tests: {total_count}")
    print(f"Passed: {passed_count}")
    print(f"Failed: {total_count - passed_count}")
    print(f"Success Rate: {(passed_count/total_count)*100:.1f}%")
    
    # Show failed tests
    failed_tests = [result for result in test_results if result["status"] == "FAIL"]
    if failed_tests:
        print(f"\nFailed Tests ({len(failed_tests)}):")
        for test in failed_tests:
            print(f"  - {test['test']}: {test['message']}")
    
    return passed_count == total_count

if __name__ == "__main__":
    success = run_all_tests()
    sys.exit(0 if success else 1)