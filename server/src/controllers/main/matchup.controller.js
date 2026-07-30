const AppError = require("../../middlewares/AppError");
const matchupService = require("../../services/main/matchup.service");

const matchupController = {
    getMatchup: async (req, res, next) => {
        try {
            const { streakId } = req.params;
            if (!streakId) {
                throw new AppError('streakId is required', 400);
            }
            const response = await matchupService.getMatchup(streakId);
            res.status(200).json({
                success: true,
                data: response
            });
        } catch (error) {
            next(error);
        }
    }
};

module.exports = matchupController;
