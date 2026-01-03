import base64
from typing import Dict, Any, List
from openai import OpenAI


async def process_receipt_image(file_path: str, client: OpenAI) -> Dict[str, Any]:
    """
    Process receipt image using OpenAI Vision API to extract transaction data.
    """
    # Read and encode image
    with open(file_path, "rb") as image_file:
        base64_image = base64.b64encode(image_file.read()).decode("utf-8")
    
    # Prepare prompt for receipt extraction
    prompt = """Analyze this receipt image and extract the following information in JSON format:
{
    "merchant": "store/restaurant name",
    "total": total_amount_as_number,
    "currency": "currency_code (e.g., USD, CAD)",
    "date": "date if visible (YYYY-MM-DD format)",
    "items": [
        {"name": "item name", "price": price_as_number, "quantity": quantity_as_number}
    ],
    "description": "brief description of the purchase"
}

Extract as much information as possible. If something is not visible, use null for that field.
Return ONLY valid JSON, no additional text."""

    try:
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": prompt,
                        },
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:image/jpeg;base64,{base64_image}",
                            },
                        },
                    ],
                }
            ],
            max_tokens=1000,
            temperature=0.1,
        )
        
        content = response.choices[0].message.content.strip()
        
        # Parse JSON response
        # Sometimes the model returns JSON wrapped in code blocks
        if "```json" in content:
            content = content.split("```json")[1].split("```")[0].strip()
        elif "```" in content:
            content = content.split("```")[1].split("```")[0].strip()
        
        import json
        extracted_data = json.loads(content)
        
        # Ensure required fields
        if "total" not in extracted_data or extracted_data["total"] is None:
            raise ValueError("Could not extract total amount from receipt")
        
        # Default values
        extracted_data.setdefault("merchant", "Unknown Merchant")
        extracted_data.setdefault("currency", "USD")
        extracted_data.setdefault("items", [])
        extracted_data.setdefault("description", f"Purchase at {extracted_data.get('merchant', 'Unknown')}")
        
        return extracted_data
        
    except Exception as e:
        raise Exception(f"Error processing receipt image: {str(e)}")


async def categorize_transaction(
    merchant: str,
    items: List[Dict],
    amount: float,
    client: OpenAI,
) -> str:
    """
    Use AI to categorize a transaction based on merchant and items.
    """
    from config import DEFAULT_CATEGORIES
    
    categories_str = ", ".join(DEFAULT_CATEGORIES)
    
    items_description = ""
    if items:
        items_list = [item.get("name", "") for item in items[:5]]  # Limit to first 5 items
        items_description = f"Items purchased: {', '.join(items_list)}"
    
    prompt = f"""Based on the following transaction information, categorize it into one of these categories:
{categories_str}

Merchant: {merchant}
Amount: ${amount:.2f}
{items_description}

Respond with ONLY the category name, nothing else."""

    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3,
            max_tokens=50,
        )
        
        category = response.choices[0].message.content.strip()
        
        # Validate category
        if category not in DEFAULT_CATEGORIES:
            # Try to find a close match
            category_lower = category.lower()
            for cat in DEFAULT_CATEGORIES:
                if cat.lower() in category_lower or category_lower in cat.lower():
                    return cat
            return "Other"
        
        return category
        
    except Exception as e:
        # Fallback to "Other" on error
        return "Other"

