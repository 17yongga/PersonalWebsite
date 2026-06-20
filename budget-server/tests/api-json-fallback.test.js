const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const repoDir = path.resolve(__dirname, '..');

async function waitForHealth(baseUrl, timeoutMs = 10000) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw lastError || new Error('server did not become healthy');
}

async function withServer(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowt-api-json-'));
  const port = String(3320 + Math.floor(Math.random() * 500));
  const env = {
    ...process.env,
    BUDGET_DB_PATH: path.join(dir, 'api-json.db'),
    PORT: port,
    JWT_SECRET: 'api-json-fallback-test-secret',
  };
  const server = spawn(process.execPath, ['server.js'], { cwd: repoDir, env, stdio: ['ignore', 'ignore', 'ignore'] });
  try {
    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForHealth(baseUrl);
    await fn(baseUrl);
  } finally {
    server.kill('SIGTERM');
    await new Promise((resolve) => server.once('exit', resolve));
  }
}

test('missing API routes return JSON instead of Express HTML errors', async () => {
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/households/12345/invite-email`, { method: 'GET' });
    assert.equal(res.status, 404);
    assert.match(res.headers.get('content-type') || '', /application\/json/);
    const body = await res.json();
    assert.match(body.error, /API route not found/);
  });
});

test('invite email legacy aliases authenticate before route handling', async () => {
  await withServer(async (baseUrl) => {
    for (const path of [
      '/api/households/12345/invitations/email',
      '/api/households/12345/invite-email',
      '/api/households/12345/invites/email',
    ]) {
      const res = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'test@example.com' }),
      });
      assert.equal(res.status, 401, path);
      assert.match(res.headers.get('content-type') || '', /application\/json/, path);
      const body = await res.json();
      assert.equal(body.error, 'No token provided', path);
    }
  });
});
