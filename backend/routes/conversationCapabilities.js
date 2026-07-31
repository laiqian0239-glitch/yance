'use strict';

const express = require('express');
const mediaIntelligence = require('../services/mediaIntelligenceService');
const systemPolicy = require('../services/systemPolicy');

const router = express.Router();
const rawMedia = express.raw({ type: '*/*', limit: process.env.YANCE_MEDIA_ANALYSIS_LIMIT || '32mb' });

router.get('/media/:messageId/analysis', (req, res) => {
  const result = mediaIntelligence.getAnalysis(req.params.messageId);
  res.json({ ok: true, analysis: result });
});
router.post('/media/:messageId/analyze', async (req, res, next) => {
  try {
    systemPolicy.assertWriteAllowed('media-analysis');
    const analysis = await mediaIntelligence.analyzeMessage({ sessionKey: req.body?.sessionKey, messageId: req.params.messageId });
    res.json({ ok: true, analysis });
  } catch (error) { next(error); }
});
router.post('/media/analyze-stream', rawMedia, async (req, res, next) => {
  try {
    systemPolicy.assertWriteAllowed('media-analysis');
    const analysis = await mediaIntelligence.analyzeBuffer({
      buffer: Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || ''),
      kind: req.headers['x-yance-media-kind'] || req.query.kind,
      mimeType: req.headers['content-type'] || req.headers['x-yance-mime-type'] || '',
      caption: decodeURIComponent(String(req.headers['x-yance-caption'] || '')),
      key: req.headers['x-yance-message-id'] || ''
    });
    res.json({ ok: true, analysis });
  } catch (error) { next(error); }
});

module.exports = router;
