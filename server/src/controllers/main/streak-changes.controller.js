const streakChangesService = require("../../services/main/streak-changes.service");

const streakChangesController = {

    getChanges: async (req, res, next) => {
        try {
            const response = await streakChangesService.getChanges();
            res.status(200).json({
                success: true,
                data: response
            });
        } catch (error) {
            next(error);
        }
    },

    ackChanges: async (req, res, next) => {
        try {
            const response = await streakChangesService.ackChanges(req.body?.ids);
            res.status(200).json({
                success: true,
                data: response
            });
        } catch (error) {
            next(error);
        }
    }

};

module.exports = streakChangesController;
