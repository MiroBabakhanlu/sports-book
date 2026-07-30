const AppError = require("../../middlewares/AppError");
const bookmakersServices = require("../../services/main/bookmakers.service");

const bookmakersController = {

    getBookMakerInfo: async (req, res, next) => {
        try {
            const { region } = req.params;
            console.log(region)
            if (!region) {
                throw new AppError('Bookmaker region parameters must be supplied', 400);
            }
            const response = await bookmakersServices.getBookMakerInfo(region);
            res.status(200).json({
                success: true,
                data: response
            })

        } catch (error) {
            next(error);
        }
    }

};
module.exports = bookmakersController;