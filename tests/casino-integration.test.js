'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { io } = require('socket.io-client');

async function waitForServer(url, child) {
  for (let i = 0; i < 80; i += 1) {
    if (child.exitCode !== null) throw new Error(`server exited ${child.exitCode}`);
    try { const response = await fetch(`${url}/health`); if (response.ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('server startup timed out');
}

function getCookie(response) {
  const raw = response.headers.get('set-cookie');
  return raw ? raw.split(';', 1)[0] : '';
}

function emitAck(socket, event, payload, timeoutMs = 2500) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event} acknowledgement timed out`)), timeoutMs);
    socket.emit(event, payload, result => {
      clearTimeout(timer);
      resolve(result);
    });
  });
}

test('authenticated casino boundary and authoritative games', { timeout: 30000 }, async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'neon777-integration-'));
  const port = 33117;
  const url = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['casino-server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, PORT: String(port), NODE_ENV: 'test', CASINO_EMAIL_PROVIDER: 'test', CASINO_DATA_DIR: dataDir, CS2_SYNC_DISABLED: '1', CASINO_ADMIN_TOKEN: 'integration-admin-secret' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let logs = '';
  let socket;
  let socket2;
  let restartChild;
  let pendingCaseBattleId;
  child.stdout.on('data', chunk => { logs += chunk; });
  child.stderr.on('data', chunk => { logs += chunk; });
  t.after(async () => {
    if (socket) socket.close();
    if (socket2) socket2.close();
    if (restartChild?.exitCode === null) restartChild.kill('SIGKILL');
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await Promise.race([
        new Promise(resolve => child.once('exit', resolve)),
        new Promise(resolve => setTimeout(resolve, 3000))
      ]);
      if (child.exitCode === null) child.kill('SIGKILL');
    }
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  await waitForServer(url, child);
  let response = await fetch(`${url}/api/session`);
  assert.equal(response.status, 401);

  response = await fetch(`${url}/api/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'Integration_User', email: 'integration@example.com', password: 'correct-horse-77' })
  });
  assert.equal(response.status, 200, await response.text());

  response = await fetch(`${url}/api/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'Integration_User', password: 'correct-horse-77' })
  });
  const login = await response.json();
  assert.equal(response.status, 200, JSON.stringify(login));
  assert.ok(login.csrfToken);
  const cookie = getCookie(response);
  assert.match(cookie, /^casino_sid=/);
  const authHeaders = { cookie, 'x-csrf-token': login.csrfToken, 'content-type': 'application/json' };

  response = await fetch(`${url}/api/session`, { headers: { cookie } });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).username, 'Integration_User');

  response = await fetch(`${url}/api/cs2/admin/sync`, {
    method: 'POST', headers: authHeaders, body: '{}'
  });
  assert.equal(response.status, 403, 'ordinary users cannot invoke CS2 administration');

  response = await fetch(`${url}/api/session`, {
    method: 'OPTIONS', headers: {
      origin: 'https://attacker.invalid',
      'access-control-request-method': 'GET'
    }
  });
  assert.equal(response.status, 403, 'untrusted browser origins are rejected');

  response = await fetch(`${url}/api/games/pachinko/drop`, {
    method: 'POST', headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ risk: 'low', bet: 10, count: 1, requestId: 'missing_csrf_123' })
  });
  assert.equal(response.status, 403);

  const pachinkoBody = { risk: 'medium', bet: 10, count: 2, requestId: 'pachinko_request_123' };
  const [pachinkoResponseA, pachinkoResponseB] = await Promise.all([
    fetch(`${url}/api/games/pachinko/drop`, { method: 'POST', headers: authHeaders, body: JSON.stringify(pachinkoBody) }),
    fetch(`${url}/api/games/pachinko/drop`, { method: 'POST', headers: authHeaders, body: JSON.stringify(pachinkoBody) })
  ]);
  const pachinko = await pachinkoResponseA.json();
  const concurrentRetry = await pachinkoResponseB.json();
  assert.equal(pachinkoResponseA.status, 200, JSON.stringify(pachinko));
  assert.equal(pachinkoResponseB.status, 200, JSON.stringify(concurrentRetry));
  assert.equal(pachinko.results.length, 2);
  assert.deepEqual(concurrentRetry, pachinko, 'concurrent idempotent retry must settle once');
  response = await fetch(`${url}/api/games/pachinko/drop`, { method: 'POST', headers: authHeaders, body: JSON.stringify(pachinkoBody) });
  assert.deepEqual(await response.json(), pachinko, 'later idempotent retry must not settle twice');

  response = await fetch(`${url}/api/games/blackjack/start`, {
    method: 'POST', headers: authHeaders, body: JSON.stringify({ bet: 25 })
  });
  let blackjack = await response.json();
  assert.equal(response.status, 200, JSON.stringify(blackjack));
  for (let actions = 0; !blackjack.state.settled && actions < 4; actions += 1) {
    const action = blackjack.state.phase === 'insurance' ? 'declineInsurance' : 'stand';
    response = await fetch(`${url}/api/games/blackjack/action`, {
      method: 'POST', headers: authHeaders,
      body: JSON.stringify({ roundId: blackjack.state.roundId, action })
    });
    blackjack = await response.json();
    assert.equal(response.status, 200, JSON.stringify(blackjack));
  }
  assert.equal(blackjack.state.settled, true);

  const unauthenticatedSocket = io(url, { transports: ['websocket'], reconnection: false, timeout: 2000 });
  await new Promise((resolve, reject) => {
    unauthenticatedSocket.once('connect', () => reject(new Error('unauthenticated socket connected')));
    unauthenticatedSocket.once('connect_error', resolve);
  });
  unauthenticatedSocket.close();

  socket = io(url, { transports: ['websocket'], extraHeaders: { Cookie: cookie }, auth: { csrfToken: login.csrfToken } });
  const rouletteStatePromise = new Promise(resolve => socket.once('rouletteState', resolve));
  await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
  const playerDataPromise = new Promise(resolve => socket.once('playerData', resolve));
  await new Promise(resolve => socket.emit('joinCasino', { username: 'Forged_Identity', credits: 999999999 }, resolve));
  assert.equal((await playerDataPromise).username, 'Integration_User', 'socket identity comes from the session');
  const rejection = new Promise(resolve => socket.once('mutationRejected', resolve));
  socket.emit('syncBalance', { credits: 999999999 });
  assert.equal((await rejection).event, 'syncBalance');
  response = await fetch(`${url}/api/session`, { headers: { cookie } });
  assert.notEqual((await response.json()).credits, 999999999);

  const rouletteState = await rouletteStatePromise;
  const rouletteBalanceBefore = (await (await fetch(`${url}/api/session`, { headers: { cookie } })).json()).credits;
  const redIntent = { roundId: rouletteState.roundId, color: 'red', amount: 100, requestId: 'roulette_integration_red_1' };
  const redBet = await emitAck(socket, 'setRouletteBet', redIntent);
  assert.deepEqual({ success: redBet.success, action: redBet.action, color: redBet.bet?.color, amount: redBet.bet?.amount },
    { success: true, action: 'placed', color: 'red', amount: 100 });
  assert.equal(redBet.balance, rouletteBalanceBefore - 100);
  socket2 = io(url, { transports: ['websocket'], extraHeaders: { Cookie: cookie }, auth: { csrfToken: login.csrfToken } });
  await new Promise((resolve, reject) => { socket2.once('connect', resolve); socket2.once('connect_error', reject); });
  const secondPlayerData = new Promise(resolve => socket2.once('playerData', resolve));
  socket2.emit('joinCasino');
  await secondPlayerData;
  const blackIntent = { roundId: rouletteState.roundId, color: 'black', amount: 250, requestId: 'roulette_integration_black_1' };
  const blackBet = await emitAck(socket2, 'setRouletteBet', blackIntent);
  assert.deepEqual({ success: blackBet.success, action: blackBet.action, color: blackBet.bet?.color, amount: blackBet.bet?.amount },
    { success: true, action: 'replaced', color: 'black', amount: 250 });
  assert.equal(blackBet.balance, rouletteBalanceBefore - 250);
  const blackReplay = await emitAck(socket2, 'setRouletteBet', blackIntent);
  assert.equal(blackReplay.success, true);
  assert.equal(blackReplay.replayed, true);
  assert.equal(blackReplay.balance, rouletteBalanceBefore - 250);
  const changedReplay = await emitAck(socket2, 'setRouletteBet', { ...blackIntent, color: 'green' });
  assert.equal(changedReplay.success, false);
  assert.match(changedReplay.error, /different bet/i);
  const [racingClear, racingSet] = await Promise.all([
    emitAck(socket, 'clearRouletteBet', { roundId: rouletteState.roundId, requestId: 'roulette_integration_race_clear' }),
    emitAck(socket2, 'setRouletteBet', { color: 'green', amount: 175, roundId: rouletteState.roundId, requestId: 'roulette_integration_race_set' })
  ]);
  assert.equal(racingClear.success, true);
  assert.equal(racingSet.success, true);
  const normalizedBet = await emitAck(socket, 'setRouletteBet', {
    color: 'red', amount: 80, roundId: rouletteState.roundId, requestId: 'roulette_integration_set_3'
  });
  assert.equal(normalizedBet.success, true);
  assert.equal(normalizedBet.balance, rouletteBalanceBefore - 80);
  const clearedBet = await emitAck(socket, 'clearRouletteBet', {
    roundId: rouletteState.roundId, requestId: 'roulette_integration_clear_1'
  });
  assert.equal(clearedBet.success, true);
  assert.equal(clearedBet.bet, null);
  assert.equal(clearedBet.balance, rouletteBalanceBefore);
  const spinStarted = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('roulette spin did not start')), 17000);
    socket.once('rouletteSpinStart', data => { clearTimeout(timer); resolve(data); });
  });
  await spinStarted;
  const lockedBet = await emitAck(socket, 'setRouletteBet', {
    roundId: rouletteState.roundId, color: 'green', amount: 25, requestId: 'roulette_integration_locked_1'
  });
  assert.equal(lockedBet.success, false);
  assert.match(lockedBet.error, /closed|round/i);

  response = await fetch(`${url}/api/session`, { headers: { cookie } });
  const balanceBeforeCoinflip = (await response.json()).credits;
  const coinflipJoined = new Promise(resolve => socket.once('playerData', resolve));
  socket.emit('joinGame');
  await coinflipJoined;
  const roomCreated = new Promise(resolve => socket.once('roomCreated', resolve));
  const duplicateRoomRejected = new Promise(resolve => socket.once('error', resolve));
  socket.emit('createRoom', { betAmount: 10, choice: 'Heads' });
  socket.emit('createRoom', { betAmount: 10, choice: 'Heads' });
  const room = await roomCreated;
  assert.match(String(await duplicateRoomRejected), /current room|Unable to create room/i);
  response = await fetch(`${url}/api/session`, { headers: { cookie } });
  assert.equal((await response.json()).credits, balanceBeforeCoinflip - 10, 'duplicate coinflip create debits once');
  const leftRoom = new Promise(resolve => socket.once('leftRoom', resolve));
  socket.emit('leaveRoom');
  await leftRoom;
  response = await fetch(`${url}/api/session`, { headers: { cookie } });
  assert.equal((await response.json()).credits, balanceBeforeCoinflip, 'unmatched coinflip room refunds once');

  response = await fetch(`${url}/api/daily-bonus`, { method: 'POST', headers: authHeaders });
  assert.equal(response.status, 200, await response.text());
  response = await fetch(`${url}/api/daily-bonus`, { method: 'POST', headers: authHeaders });
  assert.equal(response.status, 429);

  response = await fetch(`${url}/api/cases/catalog`);
  const caseCatalog = await response.json();
  assert.equal(response.status, 200, JSON.stringify(caseCatalog));
  assert.equal(caseCatalog.cases.length, 6);

  response = await fetch(`${url}/api/cases/prepare`, {
    method: 'POST', headers: authHeaders,
    body: JSON.stringify({ game: 'case_battle', requestId: 'integration_case_prepare_1', clientSeed: 'integration-creator-seed' })
  });
  const preparedBattle = await response.json();
  assert.equal(response.status, 200, JSON.stringify(preparedBattle));
  response = await fetch(`${url}/api/cases/battles`, {
    method: 'POST', headers: authHeaders,
    body: JSON.stringify({
      opponent: 'human', caseIds: ['legacy-dust'], requestId: 'integration_case_battle_1',
      fairRoundId: preparedBattle.prepared.roundId, clientSeed: 'integration-creator-seed'
    })
  });
  const waitingBattle = await response.json();
  assert.equal(response.status, 200, JSON.stringify(waitingBattle));
  assert.equal(waitingBattle.battle.status, 'waiting');

  response = await fetch(`${url}/api/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'Battle_Opponent', email: 'battle-opponent@example.com', password: 'correct-horse-88' })
  });
  assert.equal(response.status, 200, await response.text());
  response = await fetch(`${url}/api/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'Battle_Opponent', password: 'correct-horse-88' })
  });
  const opponentLogin = await response.json();
  const opponentCookie = getCookie(response);
  const opponentHeaders = { cookie: opponentCookie, 'x-csrf-token': opponentLogin.csrfToken, 'content-type': 'application/json' };
  const joinBody = {
    requestId: 'integration_case_join_1', clientSeed: 'integration-opponent-seed'
  };
  response = await fetch(`${url}/api/cases/battles/${waitingBattle.battle.battleId}/join`, {
    method: 'POST', headers: { cookie: opponentCookie, 'content-type': 'application/json' }, body: JSON.stringify(joinBody)
  });
  assert.equal(response.status, 403, 'case battle join requires CSRF');
  response = await fetch(`${url}/api/cases/battles/${waitingBattle.battle.battleId}/join`, {
    method: 'POST', headers: opponentHeaders, body: JSON.stringify(joinBody)
  });
  const settledBattle = await response.json();
  assert.equal(response.status, 200, JSON.stringify(settledBattle));
  assert.equal(settledBattle.battle.status, 'settled');
  assert.equal(settledBattle.battle.proof.clientSeed, settledBattle.battle.clientSeeds.combinedClientSeed);
  assert.deepEqual(new Set(settledBattle.battle.participants.map(item => item.id)), new Set(['Integration_User', 'Battle_Opponent']));

  response = await fetch(`${url}/api/cases/prepare`, {
    method: 'POST', headers: authHeaders,
    body: JSON.stringify({ game: 'case_battle', requestId: 'integration_case_prepare_restart', clientSeed: 'integration-restart-seed' })
  });
  const restartPrepared = await response.json();
  assert.equal(response.status, 200, JSON.stringify(restartPrepared));
  response = await fetch(`${url}/api/cases/battles`, {
    method: 'POST', headers: authHeaders,
    body: JSON.stringify({
      opponent: 'human', caseIds: ['legacy-dust'], requestId: 'integration_case_battle_restart',
      fairRoundId: restartPrepared.prepared.roundId, clientSeed: 'integration-restart-seed'
    })
  });
  const restartWaiting = await response.json();
  assert.equal(response.status, 200, JSON.stringify(restartWaiting));
  pendingCaseBattleId = restartWaiting.battle.battleId;

  const users = JSON.parse(await fs.readFile(path.join(dataDir, 'casino-users.json'), 'utf8'));
  assert.ok(Number.isSafeInteger(users.Integration_User.credits));
  const files = await fs.readdir(dataDir);
  assert.equal(files.some(file => file.includes('.tmp-')), false, `orphan temp files: ${files.join(', ')}\n${logs}`);

  const disconnectedAfterLogout = new Promise(resolve => socket.once('disconnect', resolve));
  response = await fetch(`${url}/api/logout`, { method: 'POST', headers: authHeaders });
  assert.equal(response.status, 200, await response.text());
  await disconnectedAfterLogout;
  const revokedSocket = io(url, {
    transports: ['websocket'], reconnection: false, timeout: 2000,
    extraHeaders: { Cookie: cookie }, auth: { csrfToken: login.csrfToken }
  });
  await new Promise((resolve, reject) => {
    revokedSocket.once('connect', () => reject(new Error('revoked session socket connected')));
    revokedSocket.once('connect_error', resolve);
  });
  revokedSocket.close();

  socket.close();
  socket = null;
  child.kill('SIGTERM');
  await new Promise(resolve => child.once('exit', resolve));

  const restartUrl = 'http://127.0.0.1:33119';
  restartChild = spawn(process.execPath, ['casino-server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, PORT: '33119', NODE_ENV: 'test', CASINO_DATA_DIR: dataDir, CS2_SYNC_DISABLED: '1' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  restartChild.stdout.on('data', chunk => { logs += chunk; });
  restartChild.stderr.on('data', chunk => { logs += chunk; });
  await waitForServer(restartUrl, restartChild);
  const restartLoginResponse = await fetch(`${restartUrl}/api/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'Integration_User', password: 'correct-horse-77' })
  });
  const restartLogin = await restartLoginResponse.json();
  assert.equal(restartLoginResponse.status, 200, JSON.stringify(restartLogin));
  assert.equal(restartLogin.credits, users.Integration_User.credits, 'persisted balance survives restart');
  const restartCookie = getCookie(restartLoginResponse);
  const restartHeaders = { cookie: restartCookie, 'x-csrf-token': restartLogin.csrfToken, 'content-type': 'application/json' };
  response = await fetch(`${restartUrl}/api/cases/battles/${pendingCaseBattleId}`, { headers: { cookie: restartCookie } });
  const restoredBattle = await response.json();
  assert.equal(response.status, 200, JSON.stringify(restoredBattle));
  assert.equal(restoredBattle.battle.status, 'waiting', 'unmatched battle and reserved entry survive restart');
  response = await fetch(`${restartUrl}/api/cases/battles/${pendingCaseBattleId}/cancel`, {
    method: 'POST', headers: restartHeaders, body: JSON.stringify({ requestId: 'integration_restart_cancel' })
  });
  const cancelledBattle = await response.json();
  assert.equal(response.status, 200, JSON.stringify(cancelledBattle));
  assert.equal(cancelledBattle.battle.status, 'cancelled');
  assert.equal(cancelledBattle.balance, users.Integration_User.credits + 100, 'restart cancellation refunds the held entry exactly once');
  restartChild.kill('SIGTERM');
  await new Promise(resolve => restartChild.once('exit', resolve));
});

test('committed SQLite balance succeeds during JSON projection failure and repairs on restart', { timeout: 20000 }, async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'neon777-projection-'));
  let child;
  let restartChild;
  let logs = '';
  t.after(async () => {
    await fs.chmod(dataDir, 0o700).catch(() => {});
    for (const process of [child, restartChild]) {
      if (process?.exitCode === null) process.kill('SIGKILL');
    }
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  const launch = port => {
    const spawned = spawn(process.execPath, ['casino-server.js'], {
      cwd: path.resolve(__dirname, '..'),
      env: { ...process.env, PORT: String(port), NODE_ENV: 'test', CASINO_EMAIL_PROVIDER: 'test', CASINO_DATA_DIR: dataDir, CS2_SYNC_DISABLED: '1' },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    spawned.stdout.on('data', chunk => { logs += chunk; });
    spawned.stderr.on('data', chunk => { logs += chunk; });
    return spawned;
  };

  child = launch(33120);
  const url = 'http://127.0.0.1:33120';
  await waitForServer(url, child);
  let response = await fetch(`${url}/api/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'Projection_User', email: 'projection@example.com', password: 'correct-horse-77' })
  });
  assert.equal(response.status, 200, await response.text());
  response = await fetch(`${url}/api/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'Projection_User', password: 'correct-horse-77' })
  });
  const login = await response.json();
  const cookie = getCookie(response);
  const headers = { cookie, 'x-csrf-token': login.csrfToken, 'content-type': 'application/json' };

  await fs.chmod(dataDir, 0o500);
  response = await fetch(`${url}/api/daily-bonus`, { method: 'POST', headers });
  const bonus = await response.json();
  assert.equal(response.status, 200, JSON.stringify(bonus));
  assert.ok(bonus.balance > 10000);
  response = await fetch(`${url}/health`);
  assert.equal((await response.json()).projection.status, 'repair-pending');

  await fs.chmod(dataDir, 0o700);
  child.kill('SIGTERM');
  await new Promise(resolve => child.once('exit', resolve));
  restartChild = launch(33121);
  const restartUrl = 'http://127.0.0.1:33121';
  await waitForServer(restartUrl, restartChild);
  response = await fetch(`${restartUrl}/api/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'Projection_User', password: 'correct-horse-77' })
  });
  const repaired = await response.json();
  assert.equal(response.status, 200, JSON.stringify(repaired));
  assert.equal(repaired.credits, bonus.balance);
  response = await fetch(`${restartUrl}/health`);
  assert.equal((await response.json()).projection.status, 'ok');
  assert.match(logs, /projection write failed/i);
  restartChild.kill('SIGTERM');
  await new Promise(resolve => restartChild.once('exit', resolve));
});

test('server refuses to start with corrupted user persistence', { timeout: 10000 }, async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'neon777-corrupt-'));
  await fs.writeFile(path.join(dataDir, 'casino-users.json'), '{not valid json', { mode: 0o600 });
  const child = spawn(process.execPath, ['casino-server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, PORT: '33118', NODE_ENV: 'test', CASINO_DATA_DIR: dataDir, CS2_SYNC_DISABLED: '1' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let logs = '';
  child.stdout.on('data', chunk => { logs += chunk; });
  child.stderr.on('data', chunk => { logs += chunk; });
  const exitCode = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('corrupted-state server did not exit')), 7000);
    child.once('exit', code => { clearTimeout(timer); resolve(code); });
  });
  await fs.rm(dataDir, { recursive: true, force: true });
  assert.notEqual(exitCode, 0, logs);
  assert.match(logs, /refusing to start|failed to start/i);
});
