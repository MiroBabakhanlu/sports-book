const express = require('express');
const leaguesController = require('../../controllers/main/leagues.controller');
const route = express.Router();

route.get('/all', leaguesController.getAllInfo)


module.exports = route;