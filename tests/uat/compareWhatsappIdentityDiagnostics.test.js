'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { compareReports } = require('../../tools/uat/compareWhatsappIdentityDiagnostics');

function report(overrides = {}) {
  return {
    source: { dataRoot: 'C:\\Data\\Yance' },
    p0Baseline: { whatsappIdentityContractVersion: 3, whatsappMergeIntegrityContractVersion: 1 },
    summary: {
      duplicateGroups: 1, duplicateActiveConversations: 2, invalidCanonicalAuthorityRows: 0,
      staleMergedReferences: 0, pendingSendPayloadMismatches: 0, sendRouteBlockedConversations: 0,
      avatarProvenanceErrors: 0, whatsappMediaReady: 0, whatsappMediaPending: 0, whatsappMediaFailed: 0, whatsappMediaMissingEnvelope: 0, weakDisplayNameConversations: 0, foreignKeyViolations: 0,
      mergeAuditRows: 0, whatsappConversations: 2, whatsappContacts: 2, whatsappMessages: 20,
      whatsappOutboundMessages: 4, whatsappOutboundMediaMessages: 1, whatsappOutboundAcknowledgedMessages: 3
    },
    mergeIntegrity: { ok: true, blockers: [] },
    allConversationRows: [{ conversationId: 'a', mergedInto: '' }, { conversationId: 'b', mergedInto: '' }],
    ...overrides
  };
}

test('comparison permits real UI UAT only after data gates close', () => {
  const before = report();
  const after = report({
    summary: { ...before.summary, duplicateGroups: 0, duplicateActiveConversations: 0, mergeAuditRows: 1 },
    allConversationRows: [{ conversationId: 'a', mergedInto: 'b' }, { conversationId: 'b', mergedInto: '' }]
  });
  const result = compareReports(before, after);
  assert.equal(result.status, 'READY_FOR_REAL_UI_UAT');
  assert.equal(result.blockers.length, 0);
  assert.equal(result.metrics.activeWhatsappConversations.after, 1);
});

test('comparison blocks stale references and send bindings', () => {
  const before = report();
  const after = report({
    summary: { ...before.summary, duplicateGroups: 0, staleMergedReferences: 2, pendingSendPayloadMismatches: 1 },
    mergeIntegrity: { ok: false, blockers: ['WHATSAPP_MERGED_REFERENCE_LEAK'] }
  });
  const result = compareReports(before, after);
  assert.equal(result.status, 'BLOCKED');
  assert.ok(result.blockers.some(row => row.reasonCode === 'WHATSAPP_MERGED_REFERENCE_LEAK'));
  assert.ok(result.blockers.some(row => row.reasonCode === 'WHATSAPP_PENDING_SEND_BINDING_MISMATCH'));
});


test('comparison blocks unresolved send routes and explicit avatar provenance failures', () => {
  const before = report();
  const after = report({
    summary: {
      ...before.summary,
      duplicateGroups: 0,
      sendRouteBlockedConversations: 1,
      avatarProvenanceErrors: 1
    },
    mergeIntegrity: { ok: false, blockers: ['WHATSAPP_SEND_ROUTE_NOT_READY', 'WHATSAPP_AVATAR_PROVENANCE_ERROR'] }
  });
  const result = compareReports(before, after);
  assert.equal(result.status, 'BLOCKED');
  assert.ok(result.blockers.some(row => row.reasonCode === 'WHATSAPP_SEND_ROUTE_NOT_READY'));
  assert.ok(result.blockers.some(row => row.reasonCode === 'WHATSAPP_AVATAR_PROVENANCE_ERROR'));
});

test('comparison records whether real text and media sends were observed during the Windows run', () => {
  const before = report();
  const after = report({
    summary: {
      ...before.summary,
      duplicateGroups: 0,
      whatsappOutboundMessages: 5,
      whatsappOutboundMediaMessages: 2,
      whatsappOutboundAcknowledgedMessages: 4
    }
  });
  const observed = compareReports(before, after);
  assert.equal(observed.warnings.some(row => row.reasonCode === 'WHATSAPP_REAL_TEXT_SEND_NOT_OBSERVED'), false);
  assert.equal(observed.warnings.some(row => row.reasonCode === 'WHATSAPP_REAL_MEDIA_SEND_NOT_OBSERVED'), false);

  const notObserved = compareReports(before, report({ summary: { ...before.summary, duplicateGroups: 0 } }));
  assert.ok(notObserved.warnings.some(row => row.reasonCode === 'WHATSAPP_REAL_TEXT_SEND_NOT_OBSERVED'));
  assert.ok(notObserved.warnings.some(row => row.reasonCode === 'WHATSAPP_REAL_MEDIA_SEND_NOT_OBSERVED'));
});
