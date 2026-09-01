const REQUEST_STATES = Object.freeze(['PENDING', 'ASSIGNED', 'APPROVED', 'REJECTED']);
const GRANT_STATES = Object.freeze(['ACTIVE', 'SUSPENDED', 'REVOKED']);

function clean(value) { return String(value == null ? '' : value).trim(); }
function transitionRequestState(current, action) {
  const key = `${clean(current).toUpperCase()}:${clean(action).toUpperCase()}`;
  const next = { 'PENDING:ASSIGN': 'ASSIGNED', 'ASSIGNED:APPROVE': 'APPROVED', 'ASSIGNED:REJECT': 'REJECTED' }[key];
  if (!next) throw new Error(`INVALID_REQUEST_TRANSITION:${key}`);
  return next;
}
function transitionGrantState(current, action) {
  const key = `${clean(current).toUpperCase()}:${clean(action).toUpperCase()}`;
  const next = { 'ACTIVE:SUSPEND': 'SUSPENDED', 'ACTIVE:REVOKE': 'REVOKED', 'SUSPENDED:REVOKE': 'REVOKED' }[key];
  if (!next) throw new Error(`INVALID_GRANT_TRANSITION:${key}`);
  return next;
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}
function errorJson(code, message, status) { return json({ ok: false, code, reasonCode: code, message }, status); }
async function bodyJson(request) { try { return await request.json(); } catch (_) { return {}; } }

function createD1Repository(db) {
  if (!db || typeof db.prepare !== 'function') throw new TypeError('D1 binding is required');
  return {
    async submitRequest({ installationId, displayName }) {
      const now = new Date().toISOString();
      const existing = await db.prepare("SELECT * FROM personal_access_requests WHERE installation_id = ?1 AND state IN ('PENDING','ASSIGNED','APPROVED') ORDER BY created_at DESC LIMIT 1").bind(installationId).first();
      if (existing) return existing;
      const id = crypto.randomUUID();
      await db.prepare('INSERT INTO personal_access_requests (id, installation_id, display_name, state, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)')
        .bind(id, installationId, displayName || '', 'PENDING', now).run();
      return db.prepare('SELECT * FROM personal_access_requests WHERE id = ?1').bind(id).first();
    },
    async getTesterStatus({ requestId, installationId }) {
      const request = await db.prepare('SELECT * FROM personal_access_requests WHERE id = ?1 AND installation_id = ?2').bind(requestId, installationId).first();
      if (!request) return { role: 'TESTER', requestState: 'PENDING', grantState: null, installationId };
      const grant = await db.prepare('SELECT * FROM personal_access_grants WHERE request_id = ?1 AND installation_id = ?2 ORDER BY created_at DESC LIMIT 1').bind(requestId, installationId).first();
      return { role: 'TESTER', requestState: request.state, grantState: grant?.state || null, installationId: request.installation_id, requestId: request.id, grantId: grant?.id || null };
    },
    async listRequests() {
      const result = await db.prepare(`SELECT r.*, g.id AS grant_id, g.state AS grant_state
        FROM personal_access_requests r LEFT JOIN personal_access_grants g ON g.request_id = r.id
        ORDER BY r.created_at DESC LIMIT 500`).all();
      return result.results || [];
    },
    async mutateRequest({ requestId, action }) {
      const current = await db.prepare('SELECT * FROM personal_access_requests WHERE id = ?1').bind(requestId).first();
      if (!current) throw Object.assign(new Error('REQUEST_NOT_FOUND'), { status: 404 });
      const next = transitionRequestState(current.state, action);
      const now = new Date().toISOString();
      if (next === 'APPROVED') {
        const grantId = crypto.randomUUID();
        await db.batch([
          db.prepare("UPDATE personal_access_requests SET state = ?2, updated_at = ?3, decided_at = ?3 WHERE id = ?1").bind(requestId, next, now),
          db.prepare("INSERT INTO personal_access_grants (id, request_id, installation_id, state, created_at, updated_at) VALUES (?1, ?2, ?3, 'ACTIVE', ?4, ?4) ON CONFLICT(request_id) DO UPDATE SET state = 'ACTIVE', installation_id = excluded.installation_id, updated_at = excluded.updated_at").bind(grantId, requestId, current.installation_id, now)
        ]);
      } else {
        const timestampColumn = next === 'ASSIGNED' ? 'assigned_at' : 'decided_at';
        await db.prepare(`UPDATE personal_access_requests SET state = ?2, updated_at = ?3, ${timestampColumn} = ?3 WHERE id = ?1`).bind(requestId, next, now).run();
      }
      return this.getTesterStatus({ requestId, installationId: current.installation_id });
    },
    async mutateGrant({ grantId, action }) {
      const grant = await db.prepare('SELECT * FROM personal_access_grants WHERE id = ?1').bind(grantId).first();
      if (!grant) throw Object.assign(new Error('GRANT_NOT_FOUND'), { status: 404 });
      const next = transitionGrantState(grant.state, action);
      const now = new Date().toISOString();
      await db.prepare('UPDATE personal_access_grants SET state = ?2, updated_at = ?3 WHERE id = ?1').bind(grantId, next, now).run();
      return this.getTesterStatus({ requestId: grant.request_id, installationId: grant.installation_id });
    }
  };
}

function createPersonalAccessWorker({ repository, ownerAdminSecret }) {
  if (!repository) throw new TypeError('repository is required');
  const configuredOwnerSecret = clean(ownerAdminSecret);
  function ownerAuthorized(request) {
    const value = clean(request.headers.get('authorization'));
    return configuredOwnerSecret && value === `Bearer ${configuredOwnerSecret}`;
  }
  return {
    async fetch(request) {
      const url = new URL(request.url);
      const method = request.method.toUpperCase();
      const path = url.pathname.replace(/\/+$/u, '') || '/';
      try {
        if (method === 'POST' && path === '/requests') {
          const input = await bodyJson(request);
          const installationId = clean(input.installationId);
          if (!installationId || installationId.length > 200) return errorJson('INSTALLATION_ID_REQUIRED', 'installationId is required', 400);
          const row = await repository.submitRequest({ installationId, displayName: clean(input.displayName).slice(0, 120) });
          return json({ ok: true, id: row.id, requestId: row.id, requestState: row.state, installationId: row.installation_id || row.installationId || installationId }, 201);
        }
        if (method === 'GET' && path === '/status') {
          const requestId = clean(url.searchParams.get('requestId'));
          const installationId = clean(url.searchParams.get('installationId'));
          if (!requestId || !installationId) return errorJson('STATUS_KEYS_REQUIRED', 'requestId and installationId are required', 400);
          return json({ ok: true, ...(await repository.getTesterStatus({ requestId, installationId })) });
        }
        if (path.startsWith('/owner/')) {
          if (!ownerAuthorized(request)) return errorJson('OWNER_AUTH_REQUIRED', 'OWNER authorization is required', 401);
          if (method === 'GET' && path === '/owner/requests') return json({ ok: true, requests: await repository.listRequests() });
          let match = path.match(/^\/owner\/requests\/([^/]+)\/(assign|approve|reject)$/u);
          if (method === 'POST' && match) return json({ ok: true, ...(await repository.mutateRequest({ requestId: decodeURIComponent(match[1]), action: match[2].toUpperCase() })) });
          match = path.match(/^\/owner\/grants\/([^/]+)\/(suspend|revoke)$/u);
          if (method === 'POST' && match) return json({ ok: true, ...(await repository.mutateGrant({ grantId: decodeURIComponent(match[1]), action: match[2].toUpperCase() })) });
          return errorJson('OWNER_ROUTE_NOT_FOUND', 'Owner route not found', 404);
        }
        return errorJson('NOT_FOUND', 'Route not found', 404);
      } catch (error) {
        const code = clean(error?.message).split(':')[0] || 'INTERNAL_ERROR';
        return errorJson(code, code, Number(error?.status || 409));
      }
    }
  };
}

function createWorkerFromEnv(env) {
  return createPersonalAccessWorker({ repository: createD1Repository(env.DB), ownerAdminSecret: env.OWNER_ADMIN_SECRET });
}

export {
  REQUEST_STATES,
  GRANT_STATES,
  transitionRequestState,
  transitionGrantState,
  createD1Repository,
  createPersonalAccessWorker,
  createWorkerFromEnv
};

export default {
  async fetch(request, env) {
    return createWorkerFromEnv(env).fetch(request);
  }
};
