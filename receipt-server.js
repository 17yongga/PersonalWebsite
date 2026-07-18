// Dr.Molt Receipt Scanner — server-side vision processing
// Runs on port 3002, proxied via nginx at api.gary-yong.com/receipt

const http = require('http');
const https = require('https');

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const VISION_MODEL = process.env.GROQ_VISION_MODEL || 'qwen/qwen3.6-27b';
const PORT = process.env.RECEIPT_PORT || 3002;
const MAX_BODY_SIZE = 15 * 1024 * 1024;

const ALLOWED_ORIGINS = [
  'https://gary-yong.com',
  'https://www.gary-yong.com',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
];

const CATEGORIES = [
  '🍕 Food/Dining', '🛒 Groceries', '🏠 Rent/Mortgage', '🚗 Transportation',
  '🎬 Entertainment', '💡 Utilities', '🛍️ Shopping', '💊 Healthcare',
  '📱 Subscriptions', '✈️ Travel', '🐾 Pet', '💰 Investments', '📦 Other',
  '🛡️ Insurance', '📚 Education', '💄 Personal Care', '🔧 Home Maintenance',
  '🍺 Alcohol/Bars', '☕ Coffee/Cafe', '💪 Fitness/Gym', '👗 Clothing',
  '💻 Electronics', '❤️ Charity/Donations', '🅿️ Parking', '📱 Phone/Internet', '🎁 Gifts'
];

const PROMPT = `You are a receipt analyzer. Analyze this receipt/transaction image and extract ALL individual line items.

Return ONLY a valid JSON object (no markdown, no fences, no extra text):
{
  "merchant": "store name",
  "date": "YYYY-MM-DD",
  "currency": "CAD",
  "items": [
    { "description": "item name", "amount": 12.99, "category": "suggested category", "date": "YYYY-MM-DD" }
  ],
  "total": 45.99
}

Categories: ${CATEGORIES.join(', ')}

Rules:
- Extract every individual line item with its price
- If it's a bank/credit card statement, extract each transaction separately with its OWN date
- Each item MUST have its own "date" field. If individual dates exist per line item (e.g. bank statements), use those. If only one date appears (e.g. receipt header), apply it to all items.
- Dates must be in YYYY-MM-DD format. Use the current year (${new Date().getFullYear()}) if the year is not visible.
- Amounts should be positive numbers
- Pick the most fitting category from the list above (use the EXACT category name including emoji)
- If date is not visible at all, use null
- Return ONLY the JSON object`;

function corsHeaders(req) {
  const origin = req.headers.origin || '';
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function sendJSON(res, statusCode, data, req) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json', ...corsHeaders(req) });
  res.end(JSON.stringify(data));
}

function callVisionAPI(imageDataUrl) {
  return new Promise((resolve, reject) => {
    const match = imageDataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
    if (!match) { reject(new Error('Invalid image data URL')); return; }
    const mimeType = 'image/' + match[1];
    const base64Data = match[2];

    const body = JSON.stringify({
      model: VISION_MODEL,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: PROMPT },
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Data}` } }
        ]
      }],
      temperature: 0.1,
      max_completion_tokens: 3000,
      response_format: { type: 'json_object' },
    });

    const options = {
      hostname: 'api.groq.com',
      path: '/openai/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode !== 200) {
            reject(new Error(parsed.error?.message || `Groq API returned ${res.statusCode}`));
            return;
          }
          const text = parsed.choices?.[0]?.message?.content || '';
          resolve(text.trim());
        } catch (e) {
          reject(new Error('Failed to parse Groq response'));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Request timeout')); });
    req.write(body);
    req.end();
  });
}

function parseAIResponse(content) {
  try { return JSON.parse(content); } catch (_) {}
  let cleaned = content.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  try { return JSON.parse(cleaned); } catch (_) {}
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch (_) {} }
  throw new Error('Could not parse response');
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders(req));
    res.end();
    return;
  }

  if (req.method === 'GET' && req.url === '/receipt/health') {
    sendJSON(res, 200, { status: 'ok', engine: 'groq-vision', model: VISION_MODEL }, req);
    return;
  }

  if (req.method === 'POST' && req.url === '/receipt/scan') {
    let body = '';
    let size = 0;

    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY_SIZE) { sendJSON(res, 413, { error: 'Image too large' }, req); req.destroy(); return; }
      body += chunk;
    });

    req.on('end', async () => {
      try {
        const { image } = JSON.parse(body);
        if (!image || !image.startsWith('data:image/')) {
          sendJSON(res, 400, { error: 'Invalid image data' }, req);
          return;
        }

        console.log(`[${new Date().toISOString()}] Scanning receipt via Groq ${VISION_MODEL}...`);
        const aiResponse = await callVisionAPI(image);
        const parsed = parseAIResponse(aiResponse);

        if (!parsed.items || !Array.isArray(parsed.items) || parsed.items.length === 0) {
          sendJSON(res, 200, { success: false, error: 'No transactions found in the image' }, req);
          return;
        }

        parsed.items = parsed.items.map(item => ({
          description: String(item.description || item.name || 'Unknown'),
          amount: Math.abs(parseFloat(item.amount) || 0),
          category: String(item.category || 'Other'),
          date: item.date || parsed.date || null,
        }));

        console.log(`[${new Date().toISOString()}] ✓ ${parsed.items.length} items found`);
        sendJSON(res, 200, { success: true, data: parsed }, req);
      } catch (err) {
        console.error(`[${new Date().toISOString()}] ✗`, err.message);
        sendJSON(res, 500, { error: err.message }, req);
      }
    });
    return;
  }

  sendJSON(res, 404, { error: 'Not found' }, req);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Dr.Molt Receipt Scanner on port ${PORT} (Groq ${VISION_MODEL})`);
});
