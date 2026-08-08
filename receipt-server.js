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

const STATEMENT_VERIFICATION_PROMPT = `Inspect the BOTTOM of this bank or credit-card statement image. Extract the bottommost 8 visible dated transaction rows, or all remaining rows if fewer than 8.

Start at the bottom image edge and work upward. Include rows below a payment or credit. Include a partially clipped final row only when its date, description, and amount are readable. Return the rows once in visual top-to-bottom order. Do not invent hidden text.

Return ONLY valid JSON:
{"items":[{"description":"transaction description","amount":12.99,"category":"📦 Other","date":"YYYY-MM-DD"}]}

Use positive numeric amounts.`;

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

function callVisionAPI(imageDataUrl, prompt = PROMPT, options = {}) {
  return new Promise((resolve, reject) => {
    const match = imageDataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
    if (!match) { reject(new Error('Invalid image data URL')); return; }
    const mimeType = 'image/' + match[1];
    const base64Data = match[2];

    const requestData = {
      model: VISION_MODEL,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Data}` } }
        ]
      }],
      temperature: 0.1,
      reasoning_effort: 'none',
      max_completion_tokens: 3000,
    };
    if (options.jsonMode !== false) requestData.response_format = { type: 'json_object' };
    const body = JSON.stringify(requestData);

    const requestOptions = {
      hostname: 'api.groq.com',
      path: '/openai/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(requestOptions, (res) => {
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
  const cleaned = content.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  try { return JSON.parse(cleaned); } catch (_) {}
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (match) { try { return JSON.parse(match[0]); } catch (_) {} }
  throw new Error('Could not parse response');
}

function normalizeScanResult(parsed) {
  const result = { ...parsed };
  result.items = Array.isArray(parsed.items) ? parsed.items.map(item => ({
    description: String(item.description || item.name || 'Unknown'),
    amount: Math.abs(parseFloat(item.amount) || 0),
    category: String(item.category || '📦 Other'),
    date: item.date || parsed.date || null,
  })) : [];
  return result;
}

function normalizeDescription(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

function descriptionsMatch(left, right) {
  const a = normalizeDescription(left);
  const b = normalizeDescription(right);
  if (!a || !b) return false;
  if (a === b || a.includes(b) || b.includes(a)) return true;
  const aTokens = new Set(a.split(/\s+/).filter(token => token.length > 1));
  const bTokens = new Set(b.split(/\s+/).filter(token => token.length > 1));
  const union = new Set([...aTokens, ...bTokens]);
  const overlap = [...aTokens].filter(token => bTokens.has(token)).length;
  return union.size > 0 && overlap / union.size >= 0.6;
}

function sameTransaction(left, right) {
  return left.date === right.date
    && Number(left.amount) === Number(right.amount)
    && descriptionsMatch(left.description, right.description);
}

function mergeScanResults(primary, verification) {
  const merged = { ...primary, items: [...primary.items] };
  for (const candidate of verification.items) {
    if (!merged.items.some(existing => sameTransaction(existing, candidate))) {
      merged.items.push(candidate);
    }
  }
  return merged;
}

function isStatementResult(result) {
  if (String(result.document_type || '').toLowerCase() === 'statement') return true;
  if (/bank|credit\s*card|card\s*statement/i.test(String(result.merchant || ''))) return true;
  const datedItems = result.items.filter(item => item.date);
  return result.items.length >= 4 && new Set(datedItems.map(item => item.date)).size >= 2;
}

function isJsonGenerationError(error) {
  return /validate JSON|parse.*response|could not parse|json/i.test(String(error?.message || ''));
}

async function callVisionForJson(imageDataUrl, prompt, visionCaller, { strictFirst = true } = {}) {
  const modes = strictFirst ? [true, false] : [false, false];
  let lastError;
  for (let attempt = 0; attempt < modes.length; attempt += 1) {
    try {
      const content = await visionCaller(imageDataUrl, prompt, { jsonMode: modes[attempt] });
      try {
        return parseAIResponse(content);
      } catch (error) {
        if (process.env.DEBUG_RECEIPT_SCAN === '1') {
          console.warn(`[receipt-debug] Unparsed model output: ${String(content).slice(0, 4000)}`);
        }
        throw error;
      }
    } catch (error) {
      lastError = error;
      if (attempt === modes.length - 1 || !isJsonGenerationError(error)) throw error;
      console.warn(
        `[${new Date().toISOString()}] Vision JSON generation failed; retrying once without strict JSON mode`
      );
    }
  }
  throw lastError;
}

async function analyzeImage(imageDataUrl, visionCaller = callVisionAPI) {
  const primary = normalizeScanResult(
    await callVisionForJson(imageDataUrl, PROMPT, visionCaller, { strictFirst: true })
  );
  if (!isStatementResult(primary)) return primary;

  try {
    const verification = normalizeScanResult(
      await callVisionForJson(imageDataUrl, STATEMENT_VERIFICATION_PROMPT, visionCaller, {
        strictFirst: false,
      })
    );
    return mergeScanResults(primary, verification);
  } catch (error) {
    console.warn(`[${new Date().toISOString()}] Statement completeness pass failed: ${error.message}`);
    return primary;
  }
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
        const parsed = await analyzeImage(image);

        if (!parsed.items || !Array.isArray(parsed.items) || parsed.items.length === 0) {
          sendJSON(res, 200, { success: false, error: 'No transactions found in the image' }, req);
          return;
        }

        console.log(`[${new Date().toISOString()}] ✓ ${parsed.items.length} items found`);
        sendJSON(res, 200, { success: true, data: parsed }, req);
      } catch (err) {
        console.error(`[${new Date().toISOString()}] ✗`, err.message);
        sendJSON(res, 502, {
          success: false,
          code: 'SCAN_PROCESSING_FAILED',
          retryable: true,
          error: "We couldn't read that image. Please try again or choose a clearer photo.",
        }, req);
      }
    });
    return;
  }

  sendJSON(res, 404, { error: 'Not found' }, req);
});

if (require.main === module) {
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`Dr.Molt Receipt Scanner on port ${PORT} (Groq ${VISION_MODEL})`);
  });
}

module.exports = {
  PROMPT,
  STATEMENT_VERIFICATION_PROMPT,
  analyzeImage,
  callVisionForJson,
  descriptionsMatch,
  isStatementResult,
  mergeScanResults,
  normalizeScanResult,
  parseAIResponse,
  server,
};
