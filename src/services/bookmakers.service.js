const { prisma } = require("../utils/prisma");
const AppError = require("../middlewares/errorMiddleware");



const bookmakerService = {
    getBookmakersData: async () => {
        const bookmakers = await prisma.bookmaker.findMany({
            include: {
                regions: true,
            }
        });
        if (!bookmakers) {
            throw new AppError('leagueIds array is required', 404);
        }

        return bookmakers;
    },
    //setDefault func

    //add/remove region for a bookmaker

    //add affiliate link

    //active/deactive opp for bookmaker
}

module.exports = bookmakerService;

