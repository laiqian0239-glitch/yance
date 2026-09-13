const UNKEY_VERIFY_URL = 'https://api.unkey.com/v2/keys.verifyKey';

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

function errorJson(code, message, status) {
  return json({ ok: false, code, reasonCode: code, message }, status);
}

async function bodyJson(request) {
  try {
    const value = await request.json();
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch (_) {
    return {};
  }
}

function projectionFromUnkey(payload) {
  const root = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  const data = root.data && typeof root.data === 'object' && !Array.isArray(root.data) ? root.data : root;
  const identity = data.identity && typeof data.identity === 'object' && !Array.isArray(data.identity)
    ? data.identity
    : null;
  const meta = root.meta && typeof root.meta === 'object' && !Array.isArray(root.meta) ? root.meta : {};
  return Object.freeze({
    valid: data.valid === true,
    code: clean(data.code || root.code),
    keyId: clean(data.keyId || data.id),
    enabled: data.enabled !== false,
    expires: clean(data.expires || data.expiresAt),
    identity: identity ? Object.freeze({ externalId: clean(identity.externalId) }) : null,
    requestId: clean(meta.requestId)
  });
}

function createPersonalAccessWorker({ rootKey, fetchImpl = fetch, unkeyVerifyUrl = UNKEY_VERIFY_URL } = {}) {
  const secret = clean(rootKey);
  const verifyUrl = clean(unkeyVerifyUrl) || UNKEY_VERIFY_URL;
  if (!secret) throw new TypeError('UNKEY_ROOT_KEY is required');
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl is required');

  return {
    async fetch(request) {
      const url = new URL(request.url);
      const method = request.method.toUpperCase();
      const path = url.pathname.replace(/\/+$/u, '') || '/';
      if (method !== 'POST' || path !== '/verify') return errorJson('NOT_FOUND', 'Route not found', 404);

      const input = await bodyJson(request);
      const key = clean(input.key);
      if (!key) return errorJson('INVITATION_KEY_REQUIRED', 'Invitation key is required', 400);

      let upstream;
      try {
        upstream = await fetchImpl(verifyUrl, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${secret}`,
            'content-type': 'application/json'
          },
          body: JSON.stringify({ key })
        });
      } catch (_) {
        return errorJson('UNKEY_AUTHORITY_UNAVAILABLE', 'Personal access authority is unavailable', 503);
      }

      let payload = {};
      try {
        payload = await upstream.json();
      } catch (_) {
        payload = {};
      }
      if (!upstream.ok) return errorJson('UNKEY_AUTHORITY_REJECTED', 'Personal access authority rejected verification', Number(upstream.status || 502));
      return json({ ok: true, ...projectionFromUnkey(payload) });
    }
  };
}

function createWorkerFromEnv(env) {
  return createPersonalAccessWorker({ rootKey: env.UNKEY_ROOT_KEY });
}

export {
  UNKEY_VERIFY_URL,
  projectionFromUnkey,
  createPersonalAccessWorker,
  createWorkerFromEnv
};

export default {
  async fetch(request, env) {
    return createWorkerFromEnv(env).fetch(request);
  }
};
