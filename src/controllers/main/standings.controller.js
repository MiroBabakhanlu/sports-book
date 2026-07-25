const AppError = require("../../middlewares/AppError");
const standingsService = require("../../services/main/standings.service");

const standingsController = {
    getStandings: async (req, res, next) => {
        try {
            const { leagueId } = req.params;
            if (!leagueId) {
                throw new AppError('leagueId is required', 400);
            }
            const response = await standingsService.getStandings(leagueId);
            res.status(200).json({
                success: true,
                data: response
            });
        } catch (error) {
            next(error);
        }
    }
};

module.exports = standingsController;
