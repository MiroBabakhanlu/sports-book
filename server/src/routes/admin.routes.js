const express = require('express');
const cors = require('cors');
const { corsOptions } = require('../utils/cors');
const adminController = require('../controllers/admin.controller');
const router = express.Router();

router.get('/leagues', adminController.getAllLeagues)
router.post('/change-visibility', adminController.changeVisibility)
router.post('/change-order', adminController.changeLeagueOrder)
router.post('/change-pin-status', adminController.changePinStatus)

// Manage API - the shared Bearer token external frontend clients authenticate
// with. Called cross-origin by the separately-hosted React client AND
// same-origin by the admin panel - cors() needed here specifically, unlike
// the routes above which are admin-panel-only.
router.get('/api-token', cors(corsOptions), adminController.getApiToken)
router.post('/api-token/regenerate', adminController.regenerateApiToken)

// Admin-panel-only (unlike api-token above) - the public site never reads its
// own error log, so no cors() needed here.
router.get('/errors', adminController.getErrorLogs)

// Admin-panel-only - historical hit/miss record of every settled streak
// (see streak-sync-scheduler.js's captureStreakResults / StreakResult model).
router.get('/streak-results', adminController.getStreakResults)
router.get('/streak-results/summary', adminController.getStreakResultsSummary)

module.exports = router;