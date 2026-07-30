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

module.exports = router;