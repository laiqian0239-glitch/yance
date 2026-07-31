'use strict';

const { getStore } = require('./storeProvider');

function recoverStale(ms) { return getStore().recoverStaleSends(Number(ms || 0)); }
function recoverInterrupted() { return getStore().recoverInterruptedSends(); }
function claimNext() { return getStore().claimNextSend(); }
function persistOutboxCommand(id, command, metadata = {}, claim) { return getStore().persistSendQueueOutboxCommand(id, command, metadata, claim); }
function get(id) { return getStore().getSendQueueItem(id); }
function list(options = {}) { return getStore().listSendQueue(options); }
function summary(options = {}) { return getStore().summarizeSendQueue(options); }
function markResult(id, result, claim) { return getStore().markSendResult(id, result, claim); }
function markPlatformAcceptedLocalPending(id, result, claim) { return getStore().markPlatformAcceptedLocalPending(id, result, claim); }
function markOutcomeUnknown(id, result, claim) { return getStore().markSendOutcomeUnknown(id, result, claim); }
function resolveOutcomeUnknown(id, resolution, result) { return getStore().resolveSendOutcomeUnknown(id, resolution, result); }
function defer(id, result, claim) { return getStore().deferSend(id, result, claim); }
function checkpointDelivery(input) { return getStore().checkpointLocalDeliveryTx(input); }
function retry(id, options = {}) { return getStore().retrySend(id, options); }
function cancel(id, options = {}) { return getStore().cancelSend(id, options); }

module.exports = { recoverStale, recoverInterrupted, claimNext, persistOutboxCommand, get, list, summary, markResult, markPlatformAcceptedLocalPending, markOutcomeUnknown, resolveOutcomeUnknown, defer, checkpointDelivery, retry, cancel };
