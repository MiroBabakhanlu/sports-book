const AppError = require("../../middlewares/AppError");
const streaksService = require("../../services/main/streaks.service");

const streaksController = {

    getStreaks: async (req, res, next) => {
        try {
            console.log('/////////////////new//////////////////////')
            console.log(req.query)
            const response = await streaksService.listStreaks(req.query);
            res.status(200).json({
                success: true,
                data: response
            });
        } catch (error) {
            next(error);
        }
    },

    getSummary: async (req, res, next) => {
        try {
            const response = await streaksService.getSummary(req.query);
            res.status(200).json({
                success: true,
                data: response
            });
        } catch (error) {
            next(error);
        }
    },

    getStreakById: async (req, res, next) => {
        try {
            const { id } = req.params;
            if (!id) {
                throw new AppError('Streak id is required', 400);
            }
            const response = await streaksService.getStreakById(id);
            res.status(200).json({
                success: true,
                data: response
            });
        } catch (error) {
            next(error);
        }
    }

};

module.exports = streaksController;
