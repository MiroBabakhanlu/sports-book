const express = require('express');
const bookmakersController = require('../../controllers/main/bookmakers.controller');
const route = express.Router();

route.get('/bookmaker/:region', bookmakersController.getBookMakerInfo)


module.exports = route;