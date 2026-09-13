'use strict';

const express = require('express');

function createPersonalAccessRouter({ personalAccessService } = {}) {
  if (!personalAccessService) throw new TypeError('personalAccessService is required');
  const router = express.Router();

  router.post('/status', async (req, res, next) => {
    try {
      res.json(await personalAccessService.status(req.body || {}));
    } catch (error) {
      next(error);
    }
  });

  router.post('/activate', async (req, res, next) => {
    try {
      res.json(await personalAccessService.activate(req.body || {}));
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = { createPersonalAccessRouter };
