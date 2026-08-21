'use strict';

const MINIMAL_PATHS = new Set([
  'GET /api/r32/personal-access/status',
  'POST /api/r32/personal-access/submit-request',
  'POST /api/r32/personal-access/refresh-request'
]);

function normalizePath(reqOrPath) {
  const raw = typeof reqOrPath === 'string' ? reqOrPath : (reqOrPath?.path || reqOrPath?.originalUrl || '');
  return String(raw || '').split('?')[0].replace(/\/+$/u, '') || '/';
}

function isMinimalPersonalAccessPath(method, route) {
  return MINIMAL_PATHS.has(`${String(method || '').toUpperCase()} ${normalizePath(route)}`);
}

function isProductApiPath(pathname) {
  const path = normalizePath(pathname);
  if (!path.startsWith('/api/')) return false;
  if (path === '/api/health' || path === '/api/ready') return false;
  if (path.startsWith('/api/desktop/') || path.startsWith('/api/wp4/')) return false;
  return true;
}

function createPersonalAccessGuard({ personalAccessService } = {}) {
  if (!personalAccessService || typeof personalAccessService.authorizeProductRequest !== 'function') throw new TypeError('personalAccessService.authorizeProductRequest is required');
  return async function personalAccessGuard(req, res, next) {
    const path = normalizePath(req);
    if (!isProductApiPath(path) || isMinimalPersonalAccessPath(req?.method, path)) return next();
    try {
      const entitlement = await personalAccessService.authorizeProductRequest({ method: req?.method, path });
      if (entitlement?.usable === true) {
        req.personalAccess = entitlement;
        return next();
      }
      return res.status(403).json({
        ok: false,
        error: 'PERSONAL_ACCESS_REQUIRED',
        code: 'PERSONAL_ACCESS_REQUIRED',
        reasonCode: entitlement?.reasonCode || 'PERSONAL_ACCESS_REQUIRED',
        role: entitlement?.role || 'TESTER',
        requestState: entitlement?.requestState || entitlement?.remoteState?.requestState || null,
        grantState: entitlement?.grantState || entitlement?.remoteState?.grantState || null
      });
    } catch (error) {
      return res.status(403).json({
        ok: false,
        error: 'PERSONAL_ACCESS_REQUIRED',
        code: 'PERSONAL_ACCESS_REQUIRED',
        reasonCode: error?.reasonCode || error?.code || 'REMOTE_AUTHORITY_UNAVAILABLE',
        role: 'TESTER'
      });
    }
  };
}

module.exports = { MINIMAL_PATHS, isMinimalPersonalAccessPath, isProductApiPath, createPersonalAccessGuard };
