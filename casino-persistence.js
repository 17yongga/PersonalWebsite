'use strict';

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

class AtomicJsonStore {
  constructor(filePath, { mode = 0o600 } = {}) {
    this.filePath = filePath;
    this.mode = mode;
    this.writeQueue = Promise.resolve();
  }

  async read(defaultValue) {
    try {
      return JSON.parse(await fs.readFile(this.filePath, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT' && defaultValue !== undefined) return defaultValue;
      throw error;
    }
  }

  write(value) {
    // Capture the caller's state now. Serializing inside the queued operation
    // would allow later in-memory mutations to leak into an earlier write.
    const payload = JSON.stringify(value, null, 2);
    const operation = async () => {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o750 });
      const tempPath = `${this.filePath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
      let handle;
      try {
        handle = await fs.open(tempPath, 'wx', this.mode);
        await handle.writeFile(payload, 'utf8');
        await handle.sync();
        await handle.close();
        handle = null;
        await fs.rename(tempPath, this.filePath);
        await fs.chmod(this.filePath, this.mode).catch(() => {});
        const directory = await fs.open(path.dirname(this.filePath), 'r');
        try { await directory.sync(); } finally { await directory.close(); }
      } catch (error) {
        await handle?.close().catch(() => {});
        await fs.unlink(tempPath).catch(() => {});
        throw error;
      }
    };
    const result = this.writeQueue.then(operation, operation);
    this.writeQueue = result.catch(() => {});
    return result;
  }

  async flush() {
    await this.writeQueue;
  }
}

class KeyedLock {
  constructor() {
    this.tails = new Map();
  }

  run(key, operation) {
    const previous = this.tails.get(key) || Promise.resolve();
    const current = previous.then(operation);
    let tail;
    tail = current.catch(() => {}).finally(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    this.tails.set(key, tail);
    return current;
  }

  wait(key) {
    return (this.tails.get(key) || Promise.resolve()).catch(() => {});
  }
}

module.exports = { AtomicJsonStore, KeyedLock };
