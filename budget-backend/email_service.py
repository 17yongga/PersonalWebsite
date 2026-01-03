import aiosmtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from datetime import datetime, timedelta
from typing import Dict, Any, List
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_

from config import SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, EMAIL_FROM
from database import User, Transaction, Budget
from budget_analyzer import get_budget_summary, calculate_spending_by_category
from openai import OpenAI


async def send_weekly_report(user_id: int, db: AsyncSession, client: OpenAI):
    """Send weekly budget report email to user."""
    # Get user
    user_result = await db.execute(select(User).where(User.id == user_id))
    user = user_result.scalar_one_or_none()
    
    if not user or not user.email:
        return
    
    # Get transactions from the past week
    week_ago = datetime.now() - timedelta(days=7)
    txn_result = await db.execute(
        select(Transaction).where(
            and_(
                Transaction.user_id == user_id,
                Transaction.transaction_date >= week_ago,
            )
        ).order_by(Transaction.transaction_date.desc())
    )
    transactions = txn_result.scalars().all()
    
    # Get current month budgets
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
    
    # Calculate weekly budget (assuming monthly budget, divide by ~4.33)
    weekly_budgets = {cat: amount / 4.33 for cat, amount in budgets.items()}
    
    # Calculate spending
    spending_by_category = calculate_spending_by_category(transactions)
    total_spent = sum(t.amount for t in transactions)
    total_weekly_budget = sum(weekly_budgets.values())
    
    # Generate natural language summary using AI
    summary = await generate_weekly_summary(
        transactions,
        spending_by_category,
        weekly_budgets,
        user.currency,
        client,
    )
    
    # Create email
    subject = f"Weekly Budget Report - {current_date.strftime('%B %d, %Y')}"
    
    html_body = f"""
    <html>
    <head>
        <style>
            body {{ font-family: Arial, sans-serif; line-height: 1.6; color: #333; }}
            .container {{ max-width: 600px; margin: 0 auto; padding: 20px; }}
            .header {{ background-color: #4CAF50; color: white; padding: 20px; border-radius: 5px 5px 0 0; }}
            .content {{ background-color: #f9f9f9; padding: 20px; border-radius: 0 0 5px 5px; }}
            .summary {{ background-color: white; padding: 15px; margin: 15px 0; border-radius: 5px; }}
            .category {{ margin: 10px 0; padding: 10px; background-color: #fff; border-left: 4px solid #4CAF50; }}
            .over-budget {{ border-left-color: #f44336; }}
            .amount {{ font-weight: bold; font-size: 1.1em; }}
            .footer {{ margin-top: 20px; padding-top: 20px; border-top: 1px solid #ddd; font-size: 0.9em; color: #666; }}
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>Weekly Budget Report</h1>
                <p>Week of {week_ago.strftime('%B %d')} - {current_date.strftime('%B %d, %Y')}</p>
            </div>
            <div class="content">
                <div class="summary">
                    <h2>Quick Summary</h2>
                    <p><strong>Total Spent:</strong> {user.currency} ${total_spent:.2f}</p>
                    <p><strong>Weekly Budget:</strong> {user.currency} ${total_weekly_budget:.2f}</p>
                    <p><strong>Remaining:</strong> {user.currency} ${total_weekly_budget - total_spent:.2f}</p>
                </div>
                
                <div class="summary">
                    <h2>AI-Generated Insights</h2>
                    <p>{summary}</p>
                </div>
                
                <div class="summary">
                    <h2>Spending by Category</h2>
                    {generate_category_html(spending_by_category, weekly_budgets, user.currency)}
                </div>
                
                <div class="footer">
                    <p>This is an automated weekly budget report from your Budget Assistant.</p>
                    <p>Visit your dashboard to view more details and manage your budgets.</p>
                </div>
            </div>
        </div>
    </body>
    </html>
    """
    
    text_body = f"""
Weekly Budget Report
Week of {week_ago.strftime('%B %d')} - {current_date.strftime('%B %d, %Y')}

Quick Summary:
- Total Spent: {user.currency} ${total_spent:.2f}
- Weekly Budget: {user.currency} ${total_weekly_budget:.2f}
- Remaining: {user.currency} ${total_weekly_budget - total_spent:.2f}

AI-Generated Insights:
{summary}

Spending by Category:
{generate_category_text(spending_by_category, weekly_budgets, user.currency)}

This is an automated weekly budget report from your Budget Assistant.
Visit your dashboard to view more details and manage your budgets.
    """
    
    # Send email
    if SMTP_USER and SMTP_PASSWORD:
        try:
            message = MIMEMultipart("alternative")
            message["Subject"] = subject
            message["From"] = EMAIL_FROM
            message["To"] = user.email
            
            part1 = MIMEText(text_body, "plain")
            part2 = MIMEText(html_body, "html")
            
            message.attach(part1)
            message.attach(part2)
            
            await aiosmtplib.send(
                message,
                hostname=SMTP_HOST,
                port=SMTP_PORT,
                start_tls=True,
                username=SMTP_USER,
                password=SMTP_PASSWORD,
            )
        except Exception as e:
            print(f"Error sending email: {e}")
    else:
        print("Email not configured. Skipping email send.")


async def generate_weekly_summary(
    transactions: List[Transaction],
    spending_by_category: Dict[str, float],
    weekly_budgets: Dict[str, float],
    currency: str,
    client: OpenAI,
) -> str:
    """Generate natural language summary of weekly spending."""
    if not transactions:
        return "No transactions recorded this week. Great job staying on budget!"
    
    # Prepare data for AI
    category_data = []
    for category in set(list(spending_by_category.keys()) + list(weekly_budgets.keys())):
        spent = spending_by_category.get(category, 0)
        budget = weekly_budgets.get(category, 0)
        if spent > 0 or budget > 0:
            category_data.append({
                "category": category,
                "spent": spent,
                "budget": budget,
                "over": spent > budget,
            })
    
    total_spent = sum(spending_by_category.values())
    total_budget = sum(weekly_budgets.values())
    
    prompt = f"""Generate a natural, friendly weekly budget summary in 2-3 paragraphs. Write as if you're a helpful financial assistant.

Total spent this week: {currency} ${total_spent:.2f}
Weekly budget: {currency} ${total_budget:.2f}

Spending by category:
{chr(10).join([f"- {item['category']}: Spent ${item['spent']:.2f} / Budget ${item['budget']:.2f} ({'OVER BUDGET' if item['over'] else 'within budget'})" for item in category_data if item['spent'] > 0 or item['budget'] > 0])}

Highlight:
- Areas where spending is over budget
- Areas where spending is well within budget
- Overall performance and actionable insights
- Be encouraging but honest about areas that need attention

Write in a warm, conversational tone. Keep it concise (2-3 paragraphs)."""

    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.8,
            max_tokens=400,
        )
        return response.choices[0].message.content.strip()
    except Exception as e:
        # Fallback summary
        over_budget_cats = [
            item["category"] for item in category_data if item["over"] and item["spent"] > 0
        ]
        if over_budget_cats:
            return f"You spent {currency} ${total_spent:.2f} this week, which is {'over' if total_spent > total_budget else 'within'} your weekly budget of {currency} ${total_budget:.2f}. You're over budget in: {', '.join(over_budget_cats)}. Consider reducing spending in these categories."
        else:
            return f"Great job! You spent {currency} ${total_spent:.2f} this week, staying within your weekly budget of {currency} ${total_budget:.2f}. Keep up the good work!"


def generate_category_html(
    spending: Dict[str, float],
    budgets: Dict[str, float],
    currency: str,
) -> str:
    """Generate HTML for category breakdown."""
    html = ""
    for category in set(list(spending.keys()) + list(budgets.keys())):
        spent = spending.get(category, 0)
        budget = budgets.get(category, 0)
        if spent > 0 or budget > 0:
            remaining = budget - spent
            over_class = "over-budget" if remaining < 0 else ""
            html += f"""
            <div class="category {over_class}">
                <strong>{category}</strong><br>
                Spent: {currency} ${spent:.2f} / Budget: {currency} ${budget:.2f}<br>
                <span class="amount">Remaining: {currency} ${remaining:.2f}</span>
            </div>
            """
    return html


def generate_category_text(
    spending: Dict[str, float],
    budgets: Dict[str, float],
    currency: str,
) -> str:
    """Generate plain text for category breakdown."""
    text = ""
    for category in set(list(spending.keys()) + list(budgets.keys())):
        spent = spending.get(category, 0)
        budget = budgets.get(category, 0)
        if spent > 0 or budget > 0:
            remaining = budget - spent
            text += f"\n{category}: Spent {currency} ${spent:.2f} / Budget {currency} ${budget:.2f} / Remaining {currency} ${remaining:.2f}"
    return text

