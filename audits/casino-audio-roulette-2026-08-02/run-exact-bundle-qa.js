'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { io } = require('socket.io-client');

const backend = process.argv[2];
if (!backend) throw new Error('Usage: node run-exact-bundle-qa.js /absolute/path/to/backend');
const port = 33145;
const url = `http://127.0.0.1:${port}`;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitForHealth(child) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`packaged backend exited ${child.exitCode}`);
    try {
      const response = await fetch(`${url}/health`);
      if (response.ok) return;
    } catch {}
    await sleep(100);
  }
  throw new Error('packaged backend health timeout');
}
function start(dataDir) {
  const child = spawn(process.execPath, ['casino-server.js'], {
    cwd: backend,
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'test',
      CASINO_EMAIL_PROVIDER: 'test',
      CASINO_DATA_DIR: dataDir,
      CS2_SYNC_DISABLED: '1',
      CASINO_ADMIN_TOKEN: 'exact-bundle-qa-only'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let logs = '';
  child.stdout.on('data', chunk => { logs += chunk; });
  child.stderr.on('data', chunk => { logs += chunk; });
  child.qaLogs = () => logs;
  return child;
}
async function stop(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([new Promise(resolve => child.once('exit', resolve)), sleep(3000)]);
  if (child.exitCode === null) child.kill('SIGKILL');
}
function cookie(response) {
  return (response.headers.get('set-cookie') || '').split(';', 1)[0];
}
function emitAck(socket, event, payload) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event} acknowledgement timeout`)), 3000);
    socket.emit(event, payload, response => { clearTimeout(timer); resolve(response); });
  });
}

(async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'neon777-r45-exact-'));
  let child = start(dataDir);
  let socket;
  try {
    await waitForHealth(child);
    let response = await fetch(`${url}/api/register`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'Exact_Bundle_QA', email: 'qa@example.invalid', password: 'correct-horse-77' })
    });
    assert.equal(response.status, 200, await response.text());
    response = await fetch(`${url}/api/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'Exact_Bundle_QA', password: 'correct-horse-77' })
    });
    const login = await response.json();
    assert.equal(response.status, 200, JSON.stringify(login));
    const sessionCookie = cookie(response);
    socket = io(url, { transports: ['websocket'], extraHeaders: { Cookie: sessionCookie }, auth: { csrfToken: login.csrfToken } });
    const statePromise = new Promise(resolve => socket.once('rouletteState', resolve));
    await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
    const playerPromise = new Promise(resolve => socket.once('playerData', resolve));
    socket.emit('joinCasino');
    const [state, player] = await Promise.all([statePromise, playerPromise]);
    const initialBalance = player.credits;
    const red = await emitAck(socket, 'setRouletteBet', { roundId: state.roundId, color: 'red', amount: 100, requestId: 'exact_bundle_red_1' });
    assert.deepEqual([red.success, red.action, red.bet.color, red.balance], [true, 'placed', 'red', initialBalance - 100]);
    const blackIntent = { roundId: state.roundId, color: 'black', amount: 250, requestId: 'exact_bundle_black_1' };
    const black = await emitAck(socket, 'setRouletteBet', blackIntent);
    assert.deepEqual([black.success, black.action, black.bet.color, black.balance], [true, 'replaced', 'black', initialBalance - 250]);
    const replay = await emitAck(socket, 'setRouletteBet', blackIntent);
    assert.equal(replay.replayed, true);
    const conflict = await emitAck(socket, 'setRouletteBet', { ...blackIntent, color: 'green' });
    assert.equal(conflict.success, false);
    const cleared = await emitAck(socket, 'clearRouletteBet', { roundId: state.roundId, requestId: 'exact_bundle_clear_1' });
    assert.deepEqual([cleared.success, cleared.action, cleared.balance], [true, 'cleared', initialBalance]);
    socket.close();
    socket = null;
    await stop(child);
    child = start(dataDir);
    await waitForHealth(child);
    response = await fetch(`${url}/api/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'Exact_Bundle_QA', password: 'correct-horse-77' })
    });
    const afterRestart = await response.json();
    assert.equal(response.status, 200, JSON.stringify(afterRestart));
    assert.equal(afterRestart.credits, initialBalance);
    console.log(JSON.stringify({ pass: true, releaseBackend: backend, initialBalance, finalBalance: afterRestart.credits, roulette: ['placed', 'replaced', 'replayed', 'conflict-rejected', 'cleared'], restart: 'healthy' }, null, 2));
  } catch (error) {
    console.error(child.qaLogs());
    throw error;
  } finally {
    if (socket) socket.close();
    await stop(child);
    await fs.rm(dataDir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exit(1); });
