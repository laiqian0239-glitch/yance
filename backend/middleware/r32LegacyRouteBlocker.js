'use strict';

function createR32LegacyRouteBlocker(options = {}) {
  const enabled = options.enabled ?? process.env.YANCE_ENABLE_R31_COMPAT === '1';
  const sunset = options.sunset || process.env.YANCE_R31_COMPAT_SUNSET || 'disabled';

  return function r32LegacyRouteBlocker(req, res, next) {
    const pathname = String(req.path || req.url || '').split('?')[0];
    if (!pathname.startsWith('/api/r31/')) return next();
    if (enabled) {
      res.setHeader('Deprecation', 'true');
      res.setHeader('Sunset', sunset);
      res.setHeader('Link', '</api/r32/>; rel="successor-version"');
      return next();
    }
    return res.status(410).json({
      ok: false,
      code: 'R31_API_RETIRED',
      error: 'R31 compatibility API is disabled in the R32 production runtime.',
      successor: '/api/r32/',
      enableForMigrationOnly: 'YANCE_ENABLE_R31_COMPAT=1'
    });
  };
}

module.exports = { createR32LegacyRouteBlocker };
