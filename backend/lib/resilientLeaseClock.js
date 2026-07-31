'use strict';

// Persistent leases need wall-clock timestamps for cross-process recovery, but
// a live process must not double-claim work merely because Windows resumes from
// sleep or NTP moves the wall clock. Project wall time from monotonic elapsed
// time for the lifetime of this process and expose jump telemetry separately.
class ResilientLeaseClock {
  constructor(options = {}) {
    this.wall = typeof options.wall === 'function' ? options.wall : () => Date.now();
    this.monotonic = typeof options.monotonic === 'function'
      ? options.monotonic
      : () => Number(process.hrtime.bigint() / 1_000_000n);
    this.jumpThresholdMs = Math.max(1_000, Number(options.jumpThresholdMs || 5 * 60_000));
    this.baseWallMs = Number(this.wall());
    this.baseMonoMs = Number(this.monotonic());
    this.lastMs = this.baseWallMs;
    this.lastJump = null;
  }

  sample() {
    const mono = Number(this.monotonic());
    const observedWall = Number(this.wall());
    const projectedWall = this.baseWallMs + Math.max(0, mono - this.baseMonoMs);
    const deltaMs = observedWall - projectedWall;
    const jumped = Math.abs(deltaMs) >= this.jumpThresholdMs;
    if (jumped) {
      this.lastJump = {
        direction: deltaMs > 0 ? 'forward' : 'backward',
        deltaMs,
        observedWall,
        projectedWall,
        detectedAt: new Date(Math.max(this.lastMs, projectedWall)).toISOString()
      };
    }
    // Monotonic projected wall is authoritative while this process is alive.
    // Never move backwards even if a custom monotonic source is imperfect.
    const value = Math.max(this.lastMs, projectedWall);
    this.lastMs = value;
    return { value, observedWall, projectedWall, deltaMs, jumped, lastJump: this.lastJump };
  }

  now() { return this.sample().value; }
  iso() { return new Date(this.now()).toISOString(); }
  status() { return { lastMs: this.lastMs, lastJump: this.lastJump }; }
}

const singleton = new ResilientLeaseClock();
module.exports = { ResilientLeaseClock, singleton, now: () => singleton.now(), iso: () => singleton.iso(), status: () => singleton.status() };
