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
    },
    changeAffiliateLink: async (req, res, next) => {
        try {
            const result = await bookmakerService.changeAffiliateLink(req.body.name, req.body.value);
            res.status(200).json({
                success: true,
                data: result,
            })
        } catch (error) {
            next(error);
        }
    },
    changeDefault: async (req, res, next) => {
        try {
            const result = await bookmakerService.changeDefault(req.body.id);
            res.status(200).json({
                success: true,
                data: result,
            })
        } catch (error) {
            next(error);
        }
    },
    changeStatus: async (req, res, next) => {
        try {
            const result = await bookmakerService.changeStatus(
                req.body.id, req.body.status);
            res.status(200).json({
                success: true,
                data: result,
            })
        } catch (error) {
            next(error);
        }
    },
    changeBookmakerRegion: async (req, res, next) => {
        try {
            const result = await bookmakerService.changeBookmakerRegion(
                req.body.id, req.body.regionCode);
            res.status(200).json({
                success: true,
                data: result,
            })
        } catch (error) {
            next(error);
        }
    },

    removeBookmakerRegion: async (req, res, next) => {
        try {
            const result = await bookmakerService.removeBookmakerRegion(
                req.body.id, req.body.regionCode);
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