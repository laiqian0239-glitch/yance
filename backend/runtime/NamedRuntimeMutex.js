'use strict';

const crypto = require('node:crypto');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { AppRuntimeError } = require('./errors');

function dataPathHash(pathIdentity) {
  return crypto.createHash('sha256').update(String(pathIdentity || '')).digest('hex').slice(0, 24);
}

function runtimeMutexName(pathIdentity) {
  return `Local\\Yance.AppRuntime.${dataPathHash(pathIdentity)}`;
}

function legacyRuntimeMutexName(pathIdentity) {
  return `Local\\Yance29.AppRuntime.${dataPathHash(pathIdentity)}`;
}

function portableDigest(name) {
  return crypto.createHash('sha256').update(String(name || '')).digest();
}

function portablePortForName(name) {
  const digest = portableDigest(name);
  return 41000 + (digest.readUInt32BE(0) % 7000);
}

function portableHostForName(name) {
  const digest = portableDigest(name);
  // The whole 127/8 block is reserved for loopback. Combining a hashed loopback
  // address with the historical port range avoids false ownership denials when
  // unrelated mutex names happen to hash to the same one of 7,000 ports.
  return `127.${1 + (digest[4] % 254)}.${digest[5]}.${1 + (digest[6] % 254)}`;
}

function portableEndpointForName(name) {
  return Object.freeze({ host: portableHostForName(name), port: portablePortForName(name) });
}

class NamedRuntimeMutex {
  constructor(options = {}) {
    this.name = options.name || runtimeMutexName(options.dataRoot);
    this.platform = options.platform || process.platform;
    this.acquireTimeoutMs = Math.max(500, Number(options.acquireTimeoutMs || 5000));
    this._server = null;
    this._child = null;
    this._held = false;
    this.provider = this.platform === 'win32' ? 'WINDOWS_SYSTEM_THREADING_MUTEX' : 'PORTABLE_LOOPBACK_KERNEL_LOCK';
  }

  get held() { return this._held; }

  async acquire() {
    if (this._held) return this.snapshot();
    if (this.platform === 'win32') await this._acquireWindows();
    else await this._acquirePortable();
    this._held = true;
    return this.snapshot();
  }

  _acquirePortable() {
    return new Promise((resolve, reject) => {
      const server = net.createServer();
      let settled = false;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        server.removeAllListeners('error');
        if (error) {
          try { server.close(); } catch (_) {}
          reject(error);
        } else {
          this._server = server;
          server.unref?.();
          resolve();
        }
      };
      server.once('error', error => {
        if (error.code === 'EADDRINUSE') {
          finish(new AppRuntimeError('BOOT_RUNTIME_MUTEX_HELD', 'Another backend still owns the AppRuntime mutex', {
            status: 409,
            failedPhase: 'runtime_ownership',
            details: { mutexName: this.name, provider: this.provider }
          }));
        } else {
          finish(new AppRuntimeError('BOOT_RUNTIME_MUTEX_UNAVAILABLE', error.message, {
            failedPhase: 'runtime_ownership',
            details: { mutexName: this.name, provider: this.provider, code: error.code || '' }
          }));
        }
      });
      server.listen({ ...portableEndpointForName(this.name), exclusive: true }, () => finish());
    });
  }

  _acquireWindows() {
    return new Promise((resolve, reject) => {
      const script = [
        "$ErrorActionPreference='Stop'",
        "$created=$false",
        "$mutex=[System.Threading.Mutex]::new($false,$env:YANCE_RUNTIME_MUTEX_NAME,[ref]$created)",
        "$abandoned=$false",
        "try{$acquired=$mutex.WaitOne(0)}catch [System.Threading.AbandonedMutexException]{$acquired=$true;$abandoned=$true}",
        "if(-not $acquired){[Console]::Out.WriteLine('DENIED');[Console]::Out.Flush();$mutex.Dispose();exit 73}",
        "[Console]::Out.WriteLine($(if($abandoned){'ACQUIRED_ABANDONED'}else{'ACQUIRED'}));[Console]::Out.Flush()",
        "$line=[Console]::In.ReadLine()",
        "try{$mutex.ReleaseMutex()}catch{}",
        "$mutex.Dispose()"
      ].join(';');
      const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        env: { ...process.env, YANCE_RUNTIME_MUTEX_NAME: this.name }
      });
      let stdout = '';
      let stderr = '';
      let settled = false;
      const timer = setTimeout(() => finish(new AppRuntimeError('BOOT_RUNTIME_MUTEX_UNAVAILABLE', 'Timed out acquiring Windows runtime mutex', {
        failedPhase: 'runtime_ownership', details: { mutexName: this.name }
      })), this.acquireTimeoutMs);
      const finish = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) {
          try { child.kill(); } catch (_) {}
          reject(error);
        } else {
          this._child = child;
          child.unref?.();
          resolve();
        }
      };
      child.stdout.on('data', chunk => {
        stdout += chunk.toString('utf8');
        if (stdout.includes('ACQUIRED')) finish();
        if (stdout.includes('DENIED')) finish(new AppRuntimeError('BOOT_RUNTIME_MUTEX_HELD', 'Another backend still owns the AppRuntime mutex', {
          status: 409, failedPhase: 'runtime_ownership', details: { mutexName: this.name, provider: this.provider }
        }));
      });
      child.stderr.on('data', chunk => { stderr += chunk.toString('utf8'); });
      child.once('error', error => finish(new AppRuntimeError('BOOT_RUNTIME_MUTEX_UNAVAILABLE', error.message, {
        failedPhase: 'runtime_ownership', details: { mutexName: this.name, provider: this.provider, code: error.code || '' }
      })));
      child.once('exit', code => {
        if (!settled) finish(new AppRuntimeError(code === 73 ? 'BOOT_RUNTIME_MUTEX_HELD' : 'BOOT_RUNTIME_MUTEX_UNAVAILABLE',
          code === 73 ? 'Another backend still owns the AppRuntime mutex' : `Windows runtime mutex helper exited: ${stderr.trim() || code}`,
          { status: code === 73 ? 409 : 500, failedPhase: 'runtime_ownership', details: { mutexName: this.name, code } }));
        else if (this._held) this._held = false;
      });
    });
  }

  async release() {
    if (!this._held) return;
    if (this._child) {
      const child = this._child;
      this._child = null;
      const exited = new Promise(resolve => {
        if (child.exitCode !== null) return resolve(true);
        child.once('exit', () => resolve(true));
      });
      try { child.stdin.end('release\n'); } catch (_) { try { child.kill(); } catch (_) {} }
      const graceful = await Promise.race([exited, new Promise(resolve => setTimeout(() => resolve(false), this.acquireTimeoutMs))]);
      if (!graceful && child.exitCode === null) {
        try { child.kill(); } catch (_) {}
        await Promise.race([exited, new Promise(resolve => setTimeout(resolve, this.acquireTimeoutMs))]);
      }
      this._held = false;
      return;
    }
    if (this._server) {
      const server = this._server;
      this._server = null;
      await new Promise(resolve => {
        try { server.close(() => resolve()); } catch (_) { resolve(); }
      });
    }
    this._held = false;
  }

  snapshot() {
    return Object.freeze({ name: this.name, provider: this.provider, held: this._held });
  }
}

class RuntimeMutexSet {
  constructor(options = {}) {
    const names = [...new Set((options.names || []).map(value => String(value || '').trim()).filter(Boolean))];
    if (!names.length) throw new TypeError('At least one runtime mutex name is required');
    this.mutexes = names.map(name => new NamedRuntimeMutex({
      name,
      platform: options.platform,
      acquireTimeoutMs: options.acquireTimeoutMs
    }));
    this.name = names[0];
    this.provider = this.mutexes[0].provider;
    this._held = false;
  }

  get held() { return this._held; }

  async acquire() {
    if (this._held) return this.snapshot();
    const acquired = [];
    try {
      for (const mutex of this.mutexes) {
        await mutex.acquire();
        acquired.push(mutex);
      }
      this._held = true;
      return this.snapshot();
    } catch (error) {
      for (const mutex of acquired.reverse()) await mutex.release().catch(() => {});
      this._held = false;
      throw error;
    }
  }

  async release() {
    for (const mutex of [...this.mutexes].reverse()) await mutex.release().catch(() => {});
    this._held = false;
  }

  snapshot() {
    const members = this.mutexes.map(mutex => mutex.snapshot());
    return Object.freeze({
      name: this.name,
      provider: this.provider,
      held: this._held,
      compatibilityNames: members.slice(1).map(row => row.name),
      members
    });
  }
}

module.exports = {
  NamedRuntimeMutex,
  RuntimeMutexSet,
  dataPathHash,
  portableEndpointForName,
  portableHostForName,
  portablePortForName,
  runtimeMutexName,
  legacyRuntimeMutexName
};
