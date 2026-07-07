const adminService = require("../services/admin.service");

const adminController = {

    getAllLeagues: async (req, res, next) => {
        try {
            const result = await adminService.getALlLeagues();
            return res.status(200).json({
                success: true,
                data: result
            })
        } catch (error) {
            next(error);
        }
    },
    changeVisibility: async (req, res, next) => {
        try {
            const result = await adminService.changeVisibility(req.body?.leagueId);
            return res.status(200).json({
                success: true,
                data: result
            })
        } catch (error) {
            next(error)
        }
    },
    changeLeagueOrder: async (req, res, next) => {
        try {
            const result = await adminService.changeLeagueOrder(req.body?.leagueIds);
            return res.status(200).json({
                success: true,
                data: result
            })

        } catch (error) {
            next(error)
        }
    },

}

module.exports = adminController;