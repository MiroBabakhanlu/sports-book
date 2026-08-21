const { prisma } = require("../../utils/prisma");
const { MARKET_MAP, BINARY_MARKET_OUTCOMES } = require("./streaks.service");
const leaguesService = require("./leagues.service");

// Combined reference/lookup payload - lets a consumer (e.g. AssuredBets) check
// sports/leagues/markets against their own local tables BEFORE requesting
// streak changes, inserting anything missing first instead of discovering a
// new/unrecognized value only by seeing it inside a live streak.
const generalInfoService = {
    getGeneralInfo: async () => {
        const [sports, leagues] = await Promise.all([
            prisma.sport.findMany({
                where: { is_active: true },
                select: { slug: true, name: true }
            }),
            prisma.league.findMany({
                where: { is_visible: true },
                select: {
                    id: true,
                    name: true,
                    country: true,
                    sport: { select: { slug: true } }
                },
                orderBy: { id: 'asc' }
            })
        ]);

        const formattedLeagues = await Promise.all(
            leagues.map(async (league) => ({
                id: league.id,
                name: league.name,
                country: league.country,
                aimed_sport: league.sport.slug,
                flag: await leaguesService.getFlag(league.country)
            }))
        );

        const markets = Object.entries(MARKET_MAP).map(([slug, { key, label }]) => ({
            key,
            label,
            is_boolean: Object.prototype.hasOwnProperty.call(BINARY_MARKET_OUTCOMES, slug)
        }));

        return {
            sports: sports.map(s => ({ key: s.slug, label: s.name })),
            leagues: formattedLeagues,
            markets
        };
    }
};

module.exports = generalInfoService;
