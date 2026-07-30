const leaguesServices = require("../../services/main/leagues.service");

const leaguesController = {

    getAllInfo: async (req, res, next) => {
        try {

            const response = await leaguesServices.getAllInfor();
            res.status(200).json({
                success: true,
                data: response
            })

        } catch (error) {
            next(error);
        }
    }

};
module.exports = leaguesController;