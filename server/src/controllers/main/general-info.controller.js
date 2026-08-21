const generalInfoService = require("../../services/main/general-info.service");

const generalInfoController = {
    getGeneralInfo: async (req, res, next) => {
        try {
            const response = await generalInfoService.getGeneralInfo();
            res.status(200).json({
                success: true,
                data: response
            });
        } catch (error) {
            next(error);
        }
    }
};

module.exports = generalInfoController;
