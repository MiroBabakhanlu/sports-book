const AppError = require("../../middlewares/AppError");
const { prisma } = require("../../utils/prisma");
const { resolveBookmakerLogo, formatBookmakerResponse } = require("../../utils/bookmakerHelper");

const bookmakersServices = {
    getBookMakerInfo: async (region) => {
        if (!region) {
            throw new AppError("region is required", 400);
        }

        // Regional bookmaker
        const regionalMatch = await prisma.bookmakerRegion.findFirst({
            where: {
                region_code: region,
                is_active: true,
                bookmaker: {
                    is_active: true
                }
            },
            include: {
                bookmaker: true
            }
        });

        let bookmaker = null;
        if (regionalMatch && regionalMatch.bookmaker) {
            bookmaker = await resolveBookmakerLogo(regionalMatch.bookmaker);
        } else {
            // Default bookmaker
            const defaultBookmaker = await prisma.bookmaker.findFirst({
                where: {
                    is_default: true,
                    is_active: true
                }
            });

            if (!defaultBookmaker) {
                throw new AppError("No bookmaker available.", 404);
            }

            bookmaker = await resolveBookmakerLogo(defaultBookmaker);
        }

        // Format and return the response
        return formatBookmakerResponse(bookmaker);
    }
};

module.exports = bookmakersServices;