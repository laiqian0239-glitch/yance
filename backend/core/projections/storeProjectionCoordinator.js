'use strict';

const { getStoreManager } = require('../../store/storeManagerSingleton');
const contactContextAuthority = require('../../services/contactContextAuthority');
const messageSpeakerAuthority = require('../../services/messageSpeakerAuthority');
const { normalizeAccountRuntime } = require('../../services/accountRuntimeAuthority');

function clean(value) { return String(value == null ? '' : value).trim(); }
function shouldCancelAiForAccountState(event = {}) {
  if (event?.eventType !== 'auth.accountState.updated') return false;
  const payload = event.payload || {};
  return payload.canAttemptSend === false || (payload.canAttemptSend == null && payload.canSend === false);
}

class StoreProjectionCoordinator {
  constructor({ eventBus, logger, workspaceData, modelRegistry, aiTaskRuntimeRegistry }) {
    this.eventBus = eventBus;
    this.logger = logger;
    this.workspaceData = workspaceData;
    this.modelRegistry = modelRegistry;
    this.aiTaskRuntimeRegistry = aiTaskRuntimeRegistry;
    this.unsubscribers = [];
    this.started = false;
    this.projected = 0;
    this.failed = 0;
  }

  bindBus(type, listener) {
    this.eventBus.on(type, listener);
    this.unsubscribers.push(() => this.eventBus.off(type, listener));
  }

  async dispatch(storeManager, command) {
    try {
      const result = await storeManager.dispatch(command);
      this.projected += 1;
      return result;
    } catch (error) {
      this.failed += 1;
      this.logger.warn('store-projection', 'projection-command-failed', {
        type: command.type,
        source: command.source,
        code: error.code || '',
        error: error.message
      });
      return null;
    }
  }

  async ensureCustomerContext(storeManager, conversationId, contactIdHint = '') {
    let contactId = clean(contactIdHint);
    let resolved = null;
    if (!contactId || !storeManager.select(state => state.customers.byId[contactId] || null)) {
      resolved = this.workspaceData.resolveContactForConversation(conversationId);
      contactId = clean(resolved.contact?.id || resolved.contact?.contactId || resolved.conversation?.contact_id);
    }
    if (!contactId) {
      const error = new Error('Unable to resolve stable contact for social ingestion');
      error.code = 'SOCIAL_CONTACT_RESOLUTION_FAILED';
      throw error;
    }
    const exists = storeManager.select(state => Boolean(state.customers.byId[contactId]));
    if (!exists) {
      const context = this.workspaceData.getContactContext(contactId);
      await storeManager.dispatch({
        type: 'SYNC_CUSTOMER_CONTEXT',
        source: 'workspace-repository-projection',
        payload: { context }
      });
    }
    return contactId;
  }

  start() {
    if (this.started) return this.snapshot();
    const storeManager = getStoreManager();

    const removeStoreProjection = storeManager.onEvent(event => {
      this.eventBus.publish('store:event', event);
      this.eventBus.publish(`store:${event.eventType}`, event);
    });
    this.unsubscribers.push(removeStoreProjection);

    const removeAiCancellationProjection = storeManager.onEvent(event => {
      const contactId = clean(event?.payload?.contactId || event?.entityId);
      if ([
        'customer.socialState.updated',
        'relationshipTrail.updated',
        'socialInference.corrected',
        'customer.archived'
      ].includes(event?.eventType) && contactId) {
        this.aiTaskRuntimeRegistry.cancelForContact(contactId, event.eventType === 'customer.archived'
          ? 'CUSTOMER_ARCHIVED'
          : 'SOCIAL_CONTEXT_CHANGED');
      }
      if (event?.eventType === 'models.registry.synced') this.aiTaskRuntimeRegistry.cancelAll('MODEL_ROUTING_CHANGED');
      if (shouldCancelAiForAccountState(event)) this.aiTaskRuntimeRegistry.cancelAll('ACCOUNT_DISCONNECTED');
    });
    this.unsubscribers.push(removeAiCancellationProjection);

    this.bindBus('message:inserted', async event => {
      const message = event?.payload?.message || {};
      const conversation = event?.payload?.conversation || {};
      const conversationId = clean(message.conversationId || message.sessionKey || conversation.id || conversation.sessionKey);
      if (!conversationId || !message.id || !messageSpeakerAuthority.isSocialMessage(message)) return;
      try {
        const contactId = await this.ensureCustomerContext(storeManager, conversationId, message.contactId || conversation.contactId);
        await contactContextAuthority.recordSocialSignal(contactId, {
          kind: 'message',
          conversationId,
          message: { ...message, conversationId, sessionKey: conversationId }
        });
      } catch (error) {
        this.failed += 1;
        this.logger.warn('store-projection', 'social-message-projection-failed', {
          conversationId,
          messageId: message.id,
          code: error.code || '',
          error: error.message
        });
        this.eventBus.publish('store:social-ingestion-failed', {
          conversationId,
          messageId: message.id,
          code: error.code || 'SOCIAL_INGESTION_FAILED',
          error: error.message
        });
      }
    });

    const accountProjection = event => {
      const payload = event?.payload || {};
      const accountId = clean(payload.accountId || payload.id);
      if (!accountId) return;
      const previous = storeManager.select(state => state.auth.accountsById[accountId] || {});
      const authority = normalizeAccountRuntime(previous, payload);
      void this.dispatch(storeManager, {
        type: 'SYNC_ACCOUNT_STATE',
        source: event.type || 'account-domain-projection',
        payload: { ...payload, ...authority, accountId }
      });
    };
    // Raw adapter state is allowed to update connectivity/receive state, but the
    // authoritative account projection is the only source of send-attempt and
    // real-ACK truth.
    for (const type of ['account:state', 'whatsapp:state', 'account:authority-state']) this.bindBus(type, accountProjection);

    const modelProjection = event => {
      const registry = event?.payload?.registry || this.modelRegistry.read();
      void this.dispatch(storeManager, {
        type: 'SYNC_MODEL_REGISTRY',
        source: event.type || 'model-domain-projection',
        payload: { registry }
      });
    };
    for (const type of ['models:scanned', 'models:test-completed', 'models:routes-updated', 'model:test-started', 'model:test-progress', 'model:test-complete', 'ai:job-model-failed']) this.bindBus(type, modelProjection);

    const archiveProjection = event => {
      const payload = event?.payload || {};
      if (!payload.contactId) return;
      void this.dispatch(storeManager, {
        type: 'SYNC_CUSTOMER_ARCHIVE',
        source: event.type || 'workspace-domain-projection',
        payload
      });
    };
    for (const type of ['workspace:customer-archived', 'workspace:customer-restored']) this.bindBus(type, archiveProjection);

    const workspaceContextProjection = async event => {
      const payload = event?.payload || {};
      const conversationId = clean(payload.conversationId || payload.sessionKey);
      let contactId = clean(payload.contactId || payload.canonicalContactId);
      try {
        if (!contactId && conversationId) {
          const resolved = this.workspaceData.resolveContactForConversation(conversationId);
          contactId = clean(resolved.contact?.id || resolved.contact?.contactId || resolved.conversation?.contact_id);
        }
        if (!contactId) return;
        const context = this.workspaceData.getContactContext(contactId);
        const projection = await this.dispatch(storeManager, {
          type: 'SYNC_CUSTOMER_CONTEXT',
          source: event.type || 'workspace-context-projection',
          payload: { context }
        });
        if (!projection) {
          const projectionError = new Error('Workspace context projection did not commit');
          projectionError.code = 'WORKSPACE_CONTEXT_PROJECTION_FAILED';
          throw projectionError;
        }
        this.aiTaskRuntimeRegistry.cancelForContact(contactId, 'WORKSPACE_CONTEXT_CHANGED');
        this.eventBus.publish('store:workspace-context-synced', {
          contactId,
          conversationId,
          sourceEvent: clean(event.type)
        });
      } catch (error) {
        this.failed += 1;
        this.logger.warn('store-projection', 'workspace-context-refresh-failed', {
          contactId,
          conversationId,
          sourceEvent: clean(event.type),
          code: error.code || '',
          error: error.message
        });
      }
    };
    for (const type of ['workspace.analysis.completed', 'workspace.profile.updated', 'workspace.insights.updated']) {
      this.bindBus(type, workspaceContextProjection);
    }

    this.bindBus('conversation:merged', async event => {
      const payload = event?.payload || {};
      const contactId = clean(payload.contactId);
      if (!contactId) return;
      try {
        const context = this.workspaceData.getContactContext(contactId);
        await this.dispatch(storeManager, {
          type: 'SYNC_CUSTOMER_CONTEXT',
          source: 'whatsapp-conversation-merge',
          payload: { context }
        });
        for (const sourceContactId of Array.isArray(payload.sourceContactIds) ? payload.sourceContactIds : []) {
          this.aiTaskRuntimeRegistry.cancelForContact(clean(sourceContactId), 'CONTACT_IDENTITY_MERGED');
        }
        this.aiTaskRuntimeRegistry.cancelForContact(contactId, 'CONTACT_IDENTITY_MERGED');
      } catch (error) {
        this.failed += 1;
        this.logger.warn('store-projection', 'conversation-merge-context-refresh-failed', {
          conversationId: clean(payload.conversationId),
          contactId,
          code: error.code || '',
          error: error.message
        });
      }
    });

    this.started = true;
    this.logger.info('store-projection', 'projection-coordinator-started', { subscriptions: this.unsubscribers.length });
    return this.snapshot();
  }

  stop() {
    for (const unsubscribe of this.unsubscribers.splice(0)) {
      try { unsubscribe(); } catch (_) {}
    }
    this.started = false;
    return this.snapshot();
  }

  beforeUpdate() { return this.stop(); }
  snapshot() {
    return { module: 'StoreProjectionCoordinator', started: this.started, subscriptions: this.unsubscribers.length, projected: this.projected, failed: this.failed };
  }
}

module.exports = { StoreProjectionCoordinator, shouldCancelAiForAccountState };
