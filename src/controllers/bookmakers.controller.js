const bookmakerService = require("../services/bookmakers.service");


const bookmakersController = {
    getBookmakersData: async (req, res, next) => {
        try {
            const result = await bookmakerService.getBookmakersData();
            res.status(200).json({
                success: true,
                data: result,
            })
        } catch (error) {
            next(error);
        }
    }
}

module.exports = bookmakersController;