const teamsServices = require('../services/teams.service');

const teamsController = {
    getLeagues: async (req, res, next) => {
        try {
            const data = await teamsServices.getLeagues();
            return res.status(200).json({ success: true, data });
        } catch (error) {
            next(error);
        }
    },

    getSeasonsByLeague: async (req, res, next) => {
        try {
            const { leagueId } = req.query;
            const data = await teamsServices.getSeasonsByLeague(leagueId);
            return res.status(200).json({ success: true, data });
        } catch (error) {
            next(error);
        }
    },

    getTeamsBySeason: async (req, res, next) => {
        try {
            const { seasonId } = req.query;
            const data = await teamsServices.getTeamsBySeason(seasonId);
            return res.status(200).json({ success: true, data });
        } catch (error) {
            next(error);
        }
    },

    getTeamDashboard: async (req, res, next) => {
        try {
            const { teamId, seasonId } = req.query;
            const data = await teamsServices.getTeamDashboard(teamId, seasonId);
            return res.status(200).json({ success: true, data });
        } catch (error) {
            next(error);
        }
    }
};


module.exports = teamsController;