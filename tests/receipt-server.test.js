const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  analyzeImage,
  callVisionForJson,
  isStatementResult,
  mergeScanResults,
  normalizeScanResult,
} = require('../receipt-server');

function scan(items, extra = {}) {
  return normalizeScanResult({
    document_type: 'statement',
    merchant: 'Bank Statement',
    currency: 'CAD',
    items,
    ...extra,
  });
}

test('disables Qwen thinking so extraction tokens are reserved for JSON', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'receipt-server.js'), 'utf8');
  assert.match(source, /reasoning_effort: 'none'/);
});

test('recognizes multi-date transaction lists as statements', () => {
  const result = scan([
    { description: 'A', amount: 1, date: '2026-07-04' },
    { description: 'B', amount: 2, date: '2026-07-03' },
    { description: 'C', amount: 3, date: '2026-07-02' },
    { description: 'D', amount: 4, date: '2026-07-01' },
  ], { document_type: undefined, merchant: 'Unknown' });
  assert.equal(isStatementResult(result), true);
});

test('merges bottom-pass omissions without duplicating OCR variants', () => {
  const primary = scan([
    { description: 'PAYMENT THANK YOU/PAIEMENT T MERCI', amount: -241.78, date: '2026-07-05' },
    { description: 'KOODO PREPAID SELF-SER EDMONTON, AB', amount: 18.31, date: '2026-07-04' },
  ]);
  const verification = scan([
    { description: 'PAYMENT THANK YOU PAIEMENT T MERCI', amount: 241.78, date: '2026-07-05' },
    { description: 'KOODO PREPAID SELF-SER EDMONTON AB', amount: 18.31, date: '2026-07-04' },
    { description: 'Amazon Web Services www.amazon.ca, ON', amount: 58.99, date: '2026-07-02' },
    { description: 'SQUARE ONE INSURANCE S VANCOUVER, BC', amount: 22.22, date: '2026-07-01' },
    { description: 'LELABO CAD ONLINE TORONTO, ON', amount: 88.14, date: '2026-07-01' },
  ]);

  const merged = mergeScanResults(primary, verification);
  assert.equal(merged.items.length, 5);
  assert.deepEqual(merged.items.map(item => item.amount), [241.78, 18.31, 58.99, 22.22, 88.14]);
});

test('runs an independent statement completeness pass and merges it', async () => {
  const responses = [
    JSON.stringify({
      document_type: 'statement', merchant: 'Bank Statement', items: [
        { description: 'PAYMENT THANK YOU', amount: 241.78, date: '2026-07-05' },
      ],
    }),
    JSON.stringify({
      document_type: 'statement', merchant: 'Bank Statement', items: [
        { description: 'PAYMENT THANK YOU', amount: 241.78, date: '2026-07-05' },
        { description: 'LELABO CAD ONLINE TORONTO, ON', amount: 88.14, date: '2026-07-01' },
      ],
    }),
  ];
  const prompts = [];
  const result = await analyzeImage('data:image/jpeg;base64,test', async (_image, prompt) => {
    prompts.push(prompt);
    return responses.shift();
  });

  assert.equal(prompts.length, 2);
  assert.match(prompts[1], /BOTTOM of this bank/);
  assert.equal(result.items.length, 2);
  assert.equal(result.items[1].description, 'LELABO CAD ONLINE TORONTO, ON');
});

test('does not double-call vision for a normal single-date receipt', async () => {
  let calls = 0;
  const result = await analyzeImage('data:image/jpeg;base64,test', async () => {
    calls += 1;
    return JSON.stringify({
      document_type: 'receipt', merchant: 'Cafe', date: '2026-07-01', items: [
        { description: 'Coffee', amount: 4.5, date: '2026-07-01' },
      ],
    });
  });

  assert.equal(calls, 1);
  assert.equal(result.items.length, 1);
});

test('retries a transient provider JSON-generation failure once', async () => {
  let calls = 0;
  const modes = [];
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    const content = await callVisionForJson('image', 'prompt', async (_image, _prompt, options) => {
      calls += 1;
      modes.push(options.jsonMode);
      if (calls === 1) throw new Error('Failed to validate JSON');
      return '{"items":[]}';
    });
    assert.equal(calls, 2);
    assert.deepEqual(modes, [true, false]);
    assert.deepEqual(content, { items: [] });
  } finally {
    console.warn = originalWarn;
  }
});

test('does not retry non-JSON provider failures', async () => {
  let calls = 0;
  await assert.rejects(
    callVisionForJson('image', 'prompt', async () => {
      calls += 1;
      throw new Error('Request timeout');
    }),
    /Request timeout/
  );
  assert.equal(calls, 1);
});

test('retries malformed successful model output without strict JSON mode', async () => {
  const modes = [];
  const result = await callVisionForJson('image', 'prompt', async (_image, _prompt, options) => {
    modes.push(options.jsonMode);
    return modes.length === 1 ? 'not json' : '{"items":[{"amount":1}]}';
  });
  assert.deepEqual(modes, [true, false]);
  assert.equal(result.items.length, 1);
});

test('returns the primary statement result if the completeness pass fails', async () => {
  let calls = 0;
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    const result = await analyzeImage('data:image/jpeg;base64,test', async () => {
      calls += 1;
      if (calls === 2) throw new Error('temporary provider failure');
      return JSON.stringify({
        document_type: 'statement', merchant: 'Bank Statement', items: [
          { description: 'Visible transaction', amount: 9.99, date: '2026-07-01' },
        ],
      });
    });

    assert.equal(calls, 2);
    assert.equal(result.items.length, 1);
  } finally {
    console.warn = originalWarn;
  }
});
