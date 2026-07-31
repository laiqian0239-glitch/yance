'use strict';

class BackendShutdownError extends Error {
  constructor(reasonCode, message, details = {}) {
    super(message);
    this.name = 'BackendShutdownError';
    this.reasonCode = reasonCode;
    this.details = details;
  }
}

function childIsAlive(child, killProbe = process.kill.bind(process)) {
  if (!child) return false;
  if (child.__desktopHostExited === true || child.exitCode !== null || child.signalCode) return false;
  if (!Number.isInteger(child.pid) || child.pid < 1) return true;
  try { killProbe(child.pid, 0); return true; }
  catch (error) { return error?.code === 'EPERM'; }
}

function backendAuthority(desktopHost) {
  const processHost = desktopHost?.backendProcessHost || null;
  const direct = processHost?.snapshot?.() || null;
  const backend = direct || desktopHost?.snapshot?.()?.backend || {};
  const child = processHost?.getOwnedChild?.() || null;
  const state = String(backend.state || 'NOT_STARTED');
  const pending = backend.startupPending === true || backend.shutdownPending === true;
  const activeState = ['STARTING', 'RUNNING', 'STOPPING'].includes(state);
  const ownershipPresent = backend.ownershipPresent === true || Boolean(child) || Number(backend.backendPid || 0) > 0 || pending || activeState;
  return { backend, child, state, pending, ownershipPresent };
}

function validateStoppedBackend({ result, snapshot, child, killProbe }) {
  const backend = snapshot?.backend || snapshot || {};
  const alive = childIsAlive(child, killProbe);
  const pending = backend.startupPending === true || backend.shutdownPending === true;
  const ownershipPresent = backend.ownershipPresent === true || backend.ownedChildPresent === true || Number(backend.backendPid || 0) > 0 || pending || ['STARTING', 'RUNNING', 'STOPPING'].includes(String(backend.state || ''));
  const ok = result?.stopped === true && !result?.reasonCode && result?.exitConfirmed === true && !ownershipPresent && !alive;
  return {
    ok,
    alive,
    ownershipPresent,
    backendPid: Number(backend.backendPid || 0),
    state: backend.state || '',
    reasonCode: ok ? null : (result?.reasonCode || (alive ? 'DESKTOP_BACKEND_STILL_ALIVE' : ownershipPresent ? 'DESKTOP_BACKEND_OWNERSHIP_RETAINED' : 'DESKTOP_BACKEND_STOP_NOT_CONFIRMED'))
  };
}

async function stopBackendAuthoritatively({ desktopHost, timeoutMs = 7000, killProbe }) {
  if (!desktopHost) throw new BackendShutdownError('DESKTOP_HOST_NOT_INITIALIZED', 'DesktopHost is required for authoritative backend shutdown');
  const before = backendAuthority(desktopHost);
  if (!before.ownershipPresent) {
    return { stopped: true, exitConfirmed: true, alreadyStopped: true, backendPid: 0, state: before.state };
  }
  const result = await desktopHost.stopBackend({ timeoutMs });
  const afterSnapshot = desktopHost.snapshot();
  const validation = validateStoppedBackend({ result, snapshot: afterSnapshot, child: before.child, killProbe });
  if (!validation.ok) {
    throw new BackendShutdownError(validation.reasonCode, 'Backend shutdown was not confirmed; process ownership must be retained', {
      result,
      snapshot: afterSnapshot?.backend || afterSnapshot,
      alive: validation.alive,
      ownershipPresent: validation.ownershipPresent
    });
  }
  return { ...result, validation };
}

async function stopOwnedBackend({ desktopHost, getChild, clearReferences, timeoutMs = 7000, killProbe }) {
  const before = backendAuthority(desktopHost);
  const observationChild = getChild?.() || before.child;
  if (!before.ownershipPresent) return { stopped: true, exitConfirmed: true, alreadyStopped: true, backendPid: 0, state: before.state };
  const result = await stopBackendAuthoritatively({ desktopHost, timeoutMs, killProbe });
  clearReferences?.(observationChild, result);
  return result;
}

async function restartOwnedBackend({ stop, start, canStart = () => true }) {
  const stopped = await stop();
  if (stopped?.stopped !== true || stopped?.exitConfirmed !== true) {
    throw new BackendShutdownError(stopped?.reasonCode || 'DESKTOP_BACKEND_RESTART_BLOCKED', 'Restart requires confirmed backend exit');
  }
  if (!canStart()) throw new BackendShutdownError('DESKTOP_BACKEND_RESTART_BLOCKED', 'DesktopHost still owns a backend or shutdown is pending');
  return start();
}

async function completeElectronQuit({ stop, appExit, onFailure }) {
  try {
    const result = await stop();
    if (result?.stopped !== true || result?.exitConfirmed !== true) throw new BackendShutdownError(result?.reasonCode || 'DESKTOP_BACKEND_STOP_NOT_CONFIRMED', 'Electron exit requires confirmed backend shutdown');
    appExit(0);
    return { exited: true };
  } catch (error) {
    onFailure?.(error);
    return { exited: false, reasonCode: error.reasonCode || 'DESKTOP_BACKEND_STOP_FAILED' };
  }
}

async function restartElectronApp({ setRelaunchIntent, clearRelaunchIntent, stop, authoritySnapshot, appRelaunch, appExit, onFailure }) {
  setRelaunchIntent?.();
  try {
    const result = await stop();
    const authority = authoritySnapshot?.() || { ownershipPresent: false, backendPid: 0, startupPending: false, shutdownPending: false };
    const blocked = authority.ownershipPresent === true || Number(authority.backendPid || 0) > 0 || authority.startupPending === true || authority.shutdownPending === true;
    if (result?.stopped !== true || result?.exitConfirmed !== true || blocked) {
      throw new BackendShutdownError(result?.reasonCode || 'DESKTOP_RELAUNCH_BACKEND_STOP_NOT_CONFIRMED', 'Application relaunch requires confirmed backend exit and released DesktopHost ownership', { result, authority });
    }
    appRelaunch();
    appExit(0);
    return { restarted: true, stopped: true, exitConfirmed: true };
  } catch (error) {
    clearRelaunchIntent?.();
    onFailure?.(error);
    throw error;
  }
}

module.exports = {
  BackendShutdownError,
  childIsAlive,
  backendAuthority,
  validateStoppedBackend,
  stopBackendAuthoritatively,
  stopOwnedBackend,
  restartOwnedBackend,
  completeElectronQuit,
  restartElectronApp
};
