from datetime import datetime, timedelta
from typing import List, Dict, Any
from collections import defaultdict
from openai import OpenAI

from database import Transaction, Budget


def calculate_spending_by_category(transactions: List[Transaction]) -> Dict[str, float]:
    """Calculate total spending per category."""
    spending = defaultdict(float)
    for txn in transactions:
        spending[txn.category] += txn.amount
    return dict(spending)


async def get_budget_summary(
    transactions: List[Transaction],
    budgets: Dict[str, float],
    period_start: datetime,
    period_end: datetime,
) -> Dict[str, Any]:
    """Generate a summary of budget status."""
    spending_by_category = calculate_spending_by_category(transactions)
    
    total_budget = sum(budgets.values())
    total_spent = sum(t.amount for t in transactions)
    
    category_summary = {}
    for category in set(list(budgets.keys()) + list(spending_by_category.keys())):
        budget_amount = budgets.get(category, 0)
        spent_amount = spending_by_category.get(category, 0)
        remaining = budget_amount - spent_amount
        percentage_used = (spent_amount / budget_amount * 100) if budget_amount > 0 else 0
        
        category_summary[category] = {
            "budget": budget_amount,
            "spent": spent_amount,
            "remaining": remaining,
            "percentage_used": percentage_used,
            "over_budget": remaining < 0,
        }
    
    return {
        "total_budget": total_budget,
        "total_spent": total_spent,
        "remaining_budget": total_budget - total_spent,
        "by_category": category_summary,
    }


async def generate_adaptive_recommendations(
    transactions: List[Transaction],
    current_budgets: Dict[str, float],
    monthly_income: float,
    client: OpenAI,
) -> Dict[str, Any]:
    """
    Generate adaptive budget recommendations based on historical spending patterns.
    """
    # Calculate average spending per category over the period
    spending_by_category = calculate_spending_by_category(transactions)
    
    # Calculate number of months of data
    if not transactions:
        return {"recommendations": [], "reasoning": "No transaction data available"}
    
    dates = [t.transaction_date for t in transactions]
    min_date = min(dates)
    max_date = max(dates)
    days_diff = (max_date - min_date).days
    num_months = max(1, days_diff / 30.0)
    
    # Average monthly spending per category
    avg_monthly_spending = {
        cat: amount / num_months for cat, amount in spending_by_category.items()
    }
    
    # Prepare data for AI analysis
    budget_data = []
    for category in set(list(current_budgets.keys()) + list(avg_monthly_spending.keys())):
        current_budget = current_budgets.get(category, 0)
        avg_spending = avg_monthly_spending.get(category, 0)
        
        if current_budget > 0 or avg_spending > 0:
            budget_data.append({
                "category": category,
                "current_budget": current_budget,
                "average_monthly_spending": avg_spending,
                "difference": avg_spending - current_budget,
            })
    
    # Generate recommendations using AI
    prompt = f"""Based on the following budget analysis, provide recommendations for adjusting budget allocations.

Current monthly income: ${monthly_income:.2f}

Budget Analysis:
{chr(10).join([f"- {item['category']}: Current budget ${item['current_budget']:.2f}, Average spending ${item['average_monthly_spending']:.2f}, Difference: ${item['difference']:.2f}" for item in budget_data])}

Provide recommendations in the following JSON format:
{{
    "recommendations": [
        {{
            "category": "category_name",
            "current_amount": current_budget_amount,
            "recommended_amount": recommended_budget_amount,
            "reasoning": "explanation for the recommendation"
        }}
    ],
    "summary": "overall summary of budget adjustments"
}}

Focus on categories where average spending differs significantly from the budget. Ensure total recommended budget does not exceed monthly income.
Return ONLY valid JSON."""

    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.7,
            max_tokens=1000,
        )
        
        content = response.choices[0].message.content.strip()
        
        # Parse JSON
        if "```json" in content:
            content = content.split("```json")[1].split("```")[0].strip()
        elif "```" in content:
            content = content.split("```")[1].split("```")[0].strip()
        
        import json
        recommendations = json.loads(content)
        
        return recommendations
        
    except Exception as e:
        # Fallback to simple recommendations
        recommendations = []
        for item in budget_data:
            if abs(item["difference"]) > 50:  # Significant difference
                recommended = max(0, item["current_budget"] + item["difference"] * 0.5)
                recommendations.append({
                    "category": item["category"],
                    "current_amount": item["current_budget"],
                    "recommended_amount": recommended,
                    "reasoning": f"Average spending (${item['average_monthly_spending']:.2f}) differs from current budget (${item['current_budget']:.2f})",
                })
        
        return {
            "recommendations": recommendations,
            "summary": "Recommendations based on historical spending patterns",
        }

