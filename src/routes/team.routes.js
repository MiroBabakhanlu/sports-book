const express = require('express');
const teamsController = require('../controllers/teams.controller');
const router = express.Router();

router.get('/leagues', teamsController.getLeagues);
router.get('/seasons', teamsController.getSeasonsByLeague);
router.get('/teams', teamsController.getTeamsBySeason);
router.get('/dashboard', teamsController.getTeamDashboard);
router.get('/upcoming-games', teamsController.getUpcomingMatches);

module.exports = router;