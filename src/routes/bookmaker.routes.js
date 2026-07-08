const express = require('express');
const bookmakersController = require('../controllers/bookmakers.controller');
const router = express.Router();


router.get('/bookmakers', bookmakersController.getBookmakersData)

router.post('/affiliate-link', bookmakersController.changeAffiliateLink)

router.post('/set-default', bookmakersController.changeDefault)

router.post('/change-active-status', bookmakersController.changeStatus)

router.post('/change-bookmaker-region', bookmakersController.changeBookmakerRegion)

router.post('/remove-bookmaker-region', bookmakersController.removeBookmakerRegion)

module.exports = router;