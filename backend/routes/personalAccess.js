'use strict';

const express = require('express');

function createPersonalAccessRouter({ personalAccessService } = {}) {
  if (!personalAccessService) throw new TypeError('personalAccessService is required');
  const router = express.Router();

  router.get('/status', async (_req, res, next) => {
    try { res.json(await personalAccessService.status()); } catch (error) { next(error); }
  });
  router.post('/submit-request', async (req, res, next) => {
    try { res.status(201).json(await personalAccessService.submitRequest(req.body || {})); } catch (error) { next(error); }
  });
  router.post('/refresh-request', async (_req, res, next) => {
    try { res.json(await personalAccessService.refreshRequest()); } catch (error) { next(error); }
  });

  router.get('/owner/requests', async (_req, res, next) => {
    try { res.json(await personalAccessService.listOwnerRequests()); } catch (error) { next(error); }
  });
  for (const action of ['assign', 'approve', 'reject']) {
    router.post(`/owner/requests/:requestId/${action}`, async (req, res, next) => {
      try { res.json(await personalAccessService.mutateOwnerRequest(req.params.requestId, action)); } catch (error) { next(error); }
    });
  }
  for (const action of ['suspend', 'revoke']) {
    router.post(`/owner/grants/:grantId/${action}`, async (req, res, next) => {
      try { res.json(await personalAccessService.mutateOwnerGrant(req.params.grantId, action)); } catch (error) { next(error); }
    });
  }

  return router;
}

module.exports = { createPersonalAccessRouter };
