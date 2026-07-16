const express = require('express');
const adminController = require('../controllers/admin.controller');
const router = express.Router();

router.get('/leagues', adminController.getAllLeagues)
router.post('/change-visibility', adminController.changeVisibility)
router.post('/change-order', adminController.changeLeagueOrder)
router.post('/change-pin-status', adminController.changePinStatus)

module.exports = router;