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
    },

    getUpcomingMatches: async (req, res, next) => {
        try {
            const { leagueIds, teamId, season } = req.query;

            if (!season) {
                return res.status(400).json({ error: "Season parameter is required." });
            }

            // Parse comma-separated string into an array of integers
            let parsedLeagueIds = undefined;
            if (leagueIds) {
                parsedLeagueIds = leagueIds.split(',').map(id => parseInt(id, 10)).filter(Boolean);
            } else if (req.query.leagueId) {
                parsedLeagueIds = [parseInt(req.query.leagueId, 10)];
            }

            const data = await teamsServices.getUpcomingMatches({
                leagueIds: parsedLeagueIds,
                teamId: teamId ? parseInt(teamId, 10) : undefined,
                seasonYear: season
            });

            return res.status(200).json({ success: true, data });
        } catch (error) {
            next(error);
        }
    }
};


module.exports = teamsController;