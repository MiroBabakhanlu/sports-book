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

    getInUseRegions: async (req, res, next) => {
        try {
            const result = await bookmakerService.getInUseRegions();
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
            const result = await bookmakerService.changeAffiliateLink(req.body.id, req.body.value);
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
    },

    addBookmaker: async (req, res, next) => {
        try {
            // Data comes from FormData, so all values are strings
            const { name, affiliate_link, is_active } = req.body;

            // Basic validation
            if (!name) {
                // Adjust your error handler here if you aren't using AppError
                return res.status(400).json({ success: false, message: 'Bookmaker name is required' });
            }

            // Parse the string "true" or "false" back into a real boolean
            const isActiveBool = is_active === 'true';

            // Catch the file uploaded by Multer and build the public path
            let logo_url = null;
            if (req.file) {
                // Points to the public/media folder where Multer saved it
                logo_url = `/media/${req.file.filename}`;
            }

            // Call the service with the correctly formatted data
            const newBookmaker = await bookmakerService.createBookmaker({
                name,
                affiliate_link,
                is_active: isActiveBool,
                logo_url
            });

            res.status(201).json({
                success: true,
                data: newBookmaker,
                message: 'Bookmaker created successfully'
            });
        } catch (error) {
            next(error);
        }
    },

    deleteBookmaker: async (req, res, next) => {
        try {
            const { id } = req.params;

            if (!id) {
                throw new AppError('Bookmaker ID identifier parameters must be supplied', 400);
            }

            await bookmakerService.removeBookmakerEntirely(id);

            res.status(200).json({
                success: true,
                message: 'Bookmaker profile and associated operational configuration cleared'
            });
        } catch (error) {
            next(error);
        }
    }

}

module.exports = bookmakersController;