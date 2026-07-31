'use strict';

(function bootstrapActiveContactStore(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && !root.YanceActiveContactStore) {
    root.YanceActiveContactStore = api.createActiveContactStore({ eventTarget: root });
  }
})(typeof window !== 'undefined' ? window : globalThis, function createModule() {
  const CANONICAL_EVENT = 'yance:r32-active-contact-changed';
  const LEGACY_EVENT = 'yance:r32-contact-selected';
  const VALID_VIEWS = new Set(['conversation', 'contacts', 'profiles', 'timeline', 'insights', 'ai-workbench']);

  function clean(value) {
    return value == null ? '' : String(value).trim();
  }

  function safeView(value, fallback = 'conversation') {
    const normalized = clean(value);
    return VALID_VIEWS.has(normalized) ? normalized : fallback;
  }

  function cloneState(state) {
    return Object.freeze({ ...state });
  }

  function createEvent(eventTarget, type, detail) {
    const EventCtor = eventTarget?.CustomEvent || globalThis.CustomEvent;
    if (typeof EventCtor === 'function') return new EventCtor(type, { detail });
    return { type, detail };
  }

  function createActiveContactStore(options = {}) {
    const eventTarget = options.eventTarget || null;
    const now = typeof options.now === 'function' ? options.now : () => new Date().toISOString();
    const listeners = new Set();
    let contacts = new Map();
    let state = {
      contactId: '',
      view: 'conversation',
      source: 'bootstrap',
      reason: 'initial',
      revision: 0,
      updatedAt: ''
    };

    function snapshot() {
      return cloneState(state);
    }

    function notify(previous, metadata = {}) {
      const next = snapshot();
      const detail = Object.freeze({
        previous: cloneState(previous),
        current: next,
        contact: metadata.contact || contacts.get(next.contactId)?.contact || null,
        readSynced: metadata.readSynced,
        canonical: true
      });
      for (const listener of [...listeners]) listener(next, detail);
      if (eventTarget?.dispatchEvent) eventTarget.dispatchEvent(createEvent(eventTarget, CANONICAL_EVENT, detail));
      return detail;
    }

    function setAvailableContacts(rows = []) {
      const next = new Map();
      for (const row of Array.isArray(rows) ? rows : []) {
        const id = clean(row?.id || row?.contactId);
        if (!id) continue;
        next.set(id, { archived: row?.archived === true, contact: row });
      }
      contacts = next;
      if (state.contactId && !contacts.has(state.contactId)) {
        const fallback = [...contacts.entries()].find(([, value]) => !value.archived)?.[0] || '';
        setActiveContact(fallback, { source: 'contact-catalog', reason: 'active-contact-removed', allowArchived: false });
      }
      return { size: contacts.size, active: state.contactId };
    }

    function validateContact(id, allowArchived = false, allowUnknown = false) {
      if (!id) return { ok: true, contact: null };
      const row = contacts.get(id);
      if (!row) return { ok: allowUnknown || contacts.size === 0, contact: null, reason: 'unknown-contact' };
      if (row.archived && !allowArchived) return { ok: false, contact: row.contact, reason: 'archived-contact' };
      return { ok: true, contact: row.contact };
    }

    function setActiveContact(value, metadata = {}) {
      const contactId = clean(value);
      const validation = validateContact(contactId, metadata.allowArchived === true, metadata.allowUnknown === true);
      if (!validation.ok) return { changed: false, reason: validation.reason, state: snapshot() };
      const view = safeView(metadata.view, state.view);
      const source = clean(metadata.source) || 'unknown';
      const reason = clean(metadata.reason) || 'selection';
      const changed = contactId !== state.contactId || view !== state.view;
      if (!changed && metadata.force !== true) return { changed: false, reason: 'unchanged', state: snapshot() };
      const previous = state;
      state = {
        contactId,
        view,
        source,
        reason,
        revision: previous.revision + 1,
        updatedAt: now()
      };
      const detail = notify(previous, { ...metadata, contact: metadata.contact || validation.contact });
      if (metadata.emitLegacy === true) announceLegacy({ ...metadata, contact: detail.contact });
      return { changed: true, reason, state: snapshot(), detail };
    }

    function setView(view, metadata = {}) {
      return setActiveContact(state.contactId, { ...metadata, view, allowArchived: true, allowUnknown: true });
    }

    function announceLegacy(metadata = {}) {
      if (!eventTarget?.dispatchEvent) return false;
      const detail = {
        contact: metadata.contact || contacts.get(state.contactId)?.contact || null,
        readSynced: metadata.readSynced,
        contactId: state.contactId,
        canonicalRevision: state.revision
      };
      eventTarget.dispatchEvent(createEvent(eventTarget, LEGACY_EVENT, detail));
      return true;
    }

    function hydrate(value = {}, metadata = {}) {
      if (Array.isArray(value.contacts)) setAvailableContacts(value.contacts);
      const preferred = clean(value.activeContactId || value.activeId || state.contactId);
      const fallback = contacts.has(preferred)
        ? preferred
        : ([...contacts.entries()].find(([, row]) => !row.archived)?.[0] || '');
      return setActiveContact(fallback, {
        source: metadata.source || 'bootstrap',
        reason: metadata.reason || 'hydrate',
        view: value.view || metadata.view || state.view,
        allowArchived: metadata.allowArchived === true,
        allowUnknown: contacts.size === 0,
        force: metadata.force === true
      });
    }

    function subscribe(listener, options = {}) {
      if (typeof listener !== 'function') throw new TypeError('ActiveContactStore listener must be a function');
      listeners.add(listener);
      if (options.fireImmediately === true) listener(snapshot(), { previous: snapshot(), current: snapshot(), canonical: true });
      return () => listeners.delete(listener);
    }

    return Object.freeze({
      CANONICAL_EVENT,
      LEGACY_EVENT,
      setAvailableContacts,
      setActiveContact,
      setView,
      announceLegacy,
      hydrate,
      subscribe,
      getSnapshot: snapshot,
      getContact: id => contacts.get(clean(id))?.contact || null,
      isKnownContact: id => contacts.has(clean(id))
    });
  }

  return Object.freeze({ CANONICAL_EVENT, LEGACY_EVENT, createActiveContactStore });
});
