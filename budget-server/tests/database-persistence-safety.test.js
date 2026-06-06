const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoDir = path.resolve(__dirname, '..');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'flowt-db-safe-'));
}

test('database module does not start an autosave interval just by being imported', () => {
  const script = `
    require('./database');
    const handles = process._getActiveHandles()
      .map((handle) => handle.constructor && handle.constructor.name)
      .filter(Boolean);
    console.log(JSON.stringify(handles));
  `;
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: repoDir,
    encoding: 'utf8',
    timeout: 1000,
  });

  assert.equal(result.status, 0, result.stderr);
  const handles = JSON.parse(result.stdout.trim());
  assert.equal(handles.includes('Timeout'), false, `import left active handles: ${handles.join(', ')}`);
});

test('generate-promo-codes --db writes only to the requested database path', () => {
  const dir = tempDir();
  const targetDb = path.join(dir, 'target-promo.db');
  const defaultDb = path.join(repoDir, 'finsync.db');
  const defaultBefore = fs.existsSync(defaultDb) ? fs.statSync(defaultDb).mtimeMs : null;

  const result = spawnSync(process.execPath, [
    'scripts/generate-promo-codes.js',
    '--count', '1',
    '--label', 'safe temp db test',
    '--output-dir', path.join(dir, 'out'),
    '--db', targetDb,
  ], {
    cwd: repoDir,
    encoding: 'utf8',
    timeout: 10000,
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(targetDb), true, 'expected requested --db file to be created');
  const defaultAfter = fs.existsSync(defaultDb) ? fs.statSync(defaultDb).mtimeMs : null;
  assert.equal(defaultAfter, defaultBefore, 'default finsync.db should not be touched by --db generation');
});
