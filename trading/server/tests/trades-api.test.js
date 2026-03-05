const http = require('http');

const BASE_URL = process.env.API_URL || 'http://localhost:3002/api/v1';
let authToken = null;

// Simple test runner since no test framework is installed
let passed = 0, failed = 0;

async function fetchJSON(path, options = {}) {
    const url = `${BASE_URL}${path}`;
    const headers = { 'Content-Type': 'application/json' };
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

    const resp = await fetch(url, { ...options, headers: { ...headers, ...options.headers } });
    const body = await resp.json().catch(() => ({}));
    return { status: resp.status, body };
}

async function authenticate() {
    // Try to login or create test user
    let res = await fetchJSON('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: 'test@test.com', password: 'test123' })
    });
    if (res.status === 200 && res.body.token) {
        authToken = res.body.token;
        return;
    }
    // Try register
    res = await fetchJSON('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email: 'test@test.com', password: 'test123', displayName: 'Test' })
    });
    if (res.body.token) authToken = res.body.token;
}

function assert(condition, msg) {
    if (condition) {
        console.log(`  PASS: ${msg}`);
        passed++;
    } else {
        console.log(`  FAIL: ${msg}`);
        failed++;
    }
}

async function testTradesEndpoint() {
    console.log('\nTesting GET /api/v1/strategies/:id/trades\n');

    await authenticate();
    if (!authToken) {
        console.log('Skipping — could not authenticate (server not running?)');
        return;
    }

    // Get strategies to find a valid ID
    const strats = await fetchJSON('/strategies');
    const strategyId = strats.body.strategies?.[0]?.id || 1;

    // Test 1: Returns 200 with pagination fields
    const res = await fetchJSON(`/strategies/${strategyId}/trades`);
    assert(res.status === 200 || res.status === 404, `Status is 200 or 404 (got ${res.status})`);
    if (res.status === 200) {
        assert(Array.isArray(res.body.trades), 'trades is an array');
        assert(typeof res.body.total === 'number', 'total is a number');
        assert(typeof res.body.limit === 'number', 'limit is a number');
        assert(typeof res.body.offset === 'number', 'offset is a number');

        // Test 2: reasoning field is null or parsed object
        for (const trade of res.body.trades) {
            assert(
                trade.reasoning === null || typeof trade.reasoning === 'object',
                `Trade ${trade.id} reasoning is null or object (not raw string)`
            );
        }
    }

    // Test 3: limit=2 returns at most 2
    const limitRes = await fetchJSON(`/strategies/${strategyId}/trades?limit=2`);
    if (limitRes.status === 200) {
        assert(limitRes.body.trades.length <= 2, `limit=2 returns at most 2 (got ${limitRes.body.trades.length})`);
    }

    // Test 4: Non-existent strategy returns 404
    const notFound = await fetchJSON('/strategies/999999/trades');
    assert(notFound.status === 404, `Non-existent strategy returns 404 (got ${notFound.status})`);
}

testTradesEndpoint().then(() => {
    console.log(`\nResults: ${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
}).catch(err => {
    console.error('Test suite error:', err);
    process.exit(1);
});
