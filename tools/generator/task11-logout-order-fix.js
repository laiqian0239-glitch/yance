'use strict';

const fs = require('node:fs');

const targetPath = 'backend/services/whatsappAdapter.js';
const source = fs.readFileSync(targetPath, 'utf8');
const startMarker = "  async stop(accountId = 'account-a', logout = false) {";
const endMarker = '\n  async restart(';
const start = source.indexOf(startMarker);
const end = source.indexOf(endMarker, start);

if (start < 0 || end <= start) {
  throw new Error('Task 11 stop() boundaries were not found exactly once');
}
if (source.indexOf(startMarker, start + startMarker.length) !== -1) {
  throw new Error('Task 11 stop() boundary is ambiguous');
}

const replacement = `  async stop(accountId = 'account-a', logout = false) {
    accountId = this.resolveAccountKey(accountId);
    this.cancelReconnect(accountId);
    const row = this.accounts.get(accountId);
    this.stoppedAccounts.add(accountId);
    if (!row) {
      this.generations.set(accountId, Number(this.generations.get(accountId) || 0) + 1);
      return { ok: true, state: 'stopped' };
    }

    const terminalReason = logout ? 'WHATSAPP_LOGOUT' : 'WHATSAPP_STOP';
    this.stopping.add(accountId);
    clearStartupWatchdog(row);

    if (logout) {
      try {
        if (row.socket?.logout) await row.socket.logout();
      } catch (error) {
        logger.warn('whatsapp', 'account-stop-failed', {
          operation: 'socket.logout',
          accountId: row.databaseAccountId || accountId,
          reasonCode: error.code || 'WHATSAPP_ACCOUNT_STOP_FAILED',
          httpStatus: Number(error.status || 0),
          attempt: 1,
          nextRetryAt: ''
        });
      } finally {
        await closeWhatsAppAuthLease(row, logout ? 'WHATSAPP_LOGOUT' : 'WHATSAPP_STOP');
      }
    } else {
      this.generations.set(accountId, Number(this.generations.get(accountId) || row.generation || 0) + 1);
      await closeWhatsAppAuthLease(row, logout ? 'WHATSAPP_LOGOUT' : 'WHATSAPP_STOP');
      try {
        row.socket?.end?.(new Error('YANCE_STOP'));
      } catch (error) {
        logger.warn('whatsapp', 'account-stop-failed', {
          operation: 'socket.end',
          accountId: row.databaseAccountId || accountId,
          reasonCode: error.code || 'WHATSAPP_ACCOUNT_STOP_FAILED',
          httpStatus: Number(error.status || 0),
          attempt: 1,
          nextRetryAt: ''
        });
      }
    }

    if (logout) {
      this.generations.set(accountId, Number(this.generations.get(accountId) || row.generation || 0) + 1);
    }
    row.sessionFence?.invalidate?.(terminalReason);
    authChallenges.clear(row.databaseAccountId || accountId);
    this.invalidateCredentialState(row.databaseAccountId || accountId);
    this.accounts.delete(accountId);
    eventBus.publish('whatsapp:state', { accountId, state: 'stopped' });
    return { ok: true, state: 'stopped' };
  }
`;

const next = `${source.slice(0, start)}${replacement}${source.slice(end)}`;
if (next === source) throw new Error('Task 11 generator produced no change');
fs.writeFileSync(targetPath, next, 'utf8');
