const express = require('express');
const bookmakersController = require('../controllers/bookmakers.controller');
const router = express.Router();


router.get('/bookmakers', bookmakersController.getBookmakersData)

module.exports = router;