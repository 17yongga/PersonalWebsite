#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const releaseId = process.argv[2];
if (!/^neon777-\d{8}-r\d+$/.test(releaseId || '')) {
  console.error('Usage: node scripts/build-casino-release.js neon777-YYYYMMDD-rN [output-parent]');
  process.exit(2);
}
const outputParent = path.resolve(process.argv[3] || path.join(os.tmpdir(), 'neon777-releases'));
const installBackendDependencies = process.env.CASINO_BUILD_INSTALL_DEPS !== '0';
const output = path.join(outputParent, releaseId);
if (fs.existsSync(output)) throw new Error(`Refusing to overwrite immutable release: ${output}`);

const backendFiles = [
  'casino-server.js', 'casino-security.js', 'casino-persistence.js', 'casino-games-authoritative.js',
  'casino-ledger.js', 'casino-fairness.js', 'casino-cases.js', 'casino-case-assets.json', 'casino-email.js', 'poker-engine.js',
  'cs2-bo3gg-client.js', 'cs2-market-availability.js', 'cs2-free-result-sources.js', 'cs2-team-rankings.json', 'package.json', 'package-lock.json',
  'scripts/migrate-casino-ledger.js', 'scripts/export-ledger-balances.js', 'scripts/backup-casino-db.js'
];
const frontendFiles = [
  'casino.css', 'casino-debug-logger.js', 'casino-sound.js', 'casino-sound.css', 'main.js', 'casino.js', 'casino-lobby.js',
  'cs2-modern-betting-ui.css', 'cs2-animations.css', 'neon777-cs2-theme.css', 'cs2-desktop-workspace.css', 'cs2-betting-modern.js',
  'vendor/socket.io.min.js', 'css/cs2-modern.css', 'js/cs2-modern.js',
  'games/games.css', 'games/premium-games.css', 'games/blackjack.js', 'games/coinflip-casino.js', 'games/roulette-casino.js',
  'games/cs2-betting-casino.js', 'games/poker-casino.js', 'games/crash-casino.js', 'games/pachinko-casino.js',
  'games/case-opening-casino.js', 'games/case-opening.css'
];
const teamLogoConfig = JSON.parse(fs.readFileSync(path.join(root, 'cs2-team-logos.json'), 'utf8'));
const blackjackImageFiles = walk(path.join(root, 'blackjack', 'images'))
  .filter(file => file.toLowerCase().endsWith('.png'))
  .map(file => path.posix.join('blackjack/images', file));
const caseSkinImageFiles = walk(path.join(root, 'assets', 'cs2-skins'))
  .map(file => path.posix.join('assets/cs2-skins', file));
const frontendRootFiles = [
  'cs2-team-logos.json', 'img/logo-dark.png', 'css/cs2-modern.css',
  ...new Set(Object.values(teamLogoConfig.teams || {})),
  ...blackjackImageFiles,
  ...caseSkinImageFiles
];

function checkedSource(relative) {
  const source = path.join(root, relative);
  const stat = fs.lstatSync(source);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Release source must be a regular file: ${relative}`);
  return source;
}
function copy(relative, destinationRoot) {
  const source = checkedSource(relative);
  const destination = path.join(destinationRoot, relative);
  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o755 });
  fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
  fs.chmodSync(destination, 0o644);
}
function digest(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
function walk(directory, prefix = '') {
  return fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry => {
    const relative = path.posix.join(prefix, entry.name);
    return entry.isDirectory() ? walk(path.join(directory, entry.name), relative) : [relative];
  });
}

const backend = path.join(output, 'backend');
const frontend = path.join(output, 'frontend', 'releases', releaseId);
fs.mkdirSync(backend, { recursive: true, mode: 0o755 });
fs.mkdirSync(frontend, { recursive: true, mode: 0o755 });
backendFiles.forEach(file => copy(file, backend));
frontendFiles.forEach(file => copy(file, frontend));
frontendRootFiles.forEach(file => copy(file, path.join(output, 'frontend')));

if (installBackendDependencies) {
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const install = spawnSync(npmCommand, ['ci', '--omit=dev', '--no-audit', '--no-fund'], {
    cwd: backend,
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'production' }
  });
  if (install.status !== 0) {
    throw new Error(`Backend dependency installation failed with status ${install.status}`);
  }
  // npm command shims are not runtime inputs and are symlinks on Unix.
  fs.rmSync(path.join(backend, 'node_modules', '.bin'), { recursive: true, force: true });
}

const htmlSource = checkedSource('casino.html');
let html = fs.readFileSync(htmlSource, 'utf8');
html = html.replaceAll(/\/releases\/neon777-\d{8}-r\d+\//g, `/releases/${releaseId}/`);
const htmlDestination = path.join(output, 'frontend', 'casino.html');
fs.writeFileSync(htmlDestination, html, { mode: 0o644, flag: 'wx' });

for (const relative of walk(output)) {
  if (fs.lstatSync(path.join(output, relative)).isSymbolicLink()) {
    throw new Error(`Immutable release must not contain symlinks: ${relative}`);
  }
}

const files = walk(output).filter(file => file !== 'manifest.sha256' && file !== 'release.json');
const hashes = files.map(file => `${digest(path.join(output, file))}  ${file}`);
fs.writeFileSync(path.join(output, 'manifest.sha256'), `${hashes.join('\n')}\n`, { mode: 0o644, flag: 'wx' });
const release = {
  releaseId,
  backendEntry: 'backend/casino-server.js',
  frontendEntry: 'frontend/casino.html',
  runtimeDataRequired: ['casino-users.json', 'data/bet-history.json', 'data/balance-ledger.json', 'data/cs2-betting-data.json', 'data/cs2-api-cache.json', 'data/casino.sqlite'],
  runtimeDataIncluded: false,
  backendDependenciesIncluded: installBackendDependencies,
  fileCount: files.length,
  sourceManifestSha256: digest(path.join(output, 'manifest.sha256'))
};
fs.writeFileSync(path.join(output, 'release.json'), `${JSON.stringify(release, null, 2)}\n`, { mode: 0o644, flag: 'wx' });
fs.writeFileSync(path.join(output, 'release.sha256'), `${digest(path.join(output, 'release.json'))}  release.json\n`, { mode: 0o644, flag: 'wx' });

for (const relative of walk(output)) {
  const target = path.join(output, relative);
  if (fs.statSync(target).isFile()) fs.chmodSync(target, 0o444);
}
function sealDirectories(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) sealDirectories(path.join(directory, entry.name));
  }
  fs.chmodSync(directory, 0o555);
}
sealDirectories(output);
console.log(JSON.stringify({ output, ...release }, null, 2));
