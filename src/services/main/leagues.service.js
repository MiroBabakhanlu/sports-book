const { prisma } = require("../../utils/prisma");

let countryIndexPromise = null;

const normalize = (s) =>
    s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Fetch the countries dataset once and build a lookup keyed by every
// known identifier (common/official name, cca2, cca3, cioc, altSpellings) -> cca2 code.
const getCountryIndex = () => {
    if (!countryIndexPromise) {
        countryIndexPromise = (async () => {
            const res = await fetch('https://cdn.jsdelivr.net/npm/world-countries@4.0.0/countries.json');
            const data = await res.json();

            const index = new Map();
            for (const c of data) {
                const keys = [
                    c.name.common,
                    c.name.official,
                    c.cca2,
                    c.cca3,
                    c.cioc,
                    ...(c.altSpellings || []),
                ];
                for (const k of keys) {
                    if (k) index.set(normalize(k), c.cca2);
                }
            }
            return index;
        })().catch((err) => {
            countryIndexPromise = null; // allow retry on next call
            throw err;
        });
    }
    return countryIndexPromise;
};

// flagcdn serves GB subdivision flags. These aren't ISO countries,
// so they can't be resolved via the dataset and need an explicit fallback.
const UK_SUBDIVISIONS = {
    england: 'gb-eng',
    scotland: 'gb-sct',
    wales: 'gb-wls',
    'northern ireland': 'gb-nir',
};

const getFlag = async (countryName) => {
    if (!countryName) return undefined;
    const key = normalize(countryName);

    const sub = UK_SUBDIVISIONS[key];
    if (sub) return `https://flagcdn.com/w20/${sub}.png`;

    const index = await getCountryIndex();
    const code = index.get(key);
    return code ? `https://flagcdn.com/w20/${code.toLowerCase()}.png` : undefined;
};

const leaguesServices = {
    getAllInfor: async () => {
        const rawLeagues = await prisma.league.findMany({
            where: {
                is_visible: true
            },
            orderBy: [
                {
                    is_pinned: 'desc',
                },
                {
                    display_order: 'asc',
                },
            ],
            // FIXED: 'seasons' query is now nested directly inside 'select'. 
            // There is no top-level 'include' keyword.
            select: {
                id: true,
                name: true,
                country: true,
                is_pinned: true,
                is_active: true,
                seasons: {
                    where: {
                        is_current: true // Only count streaks for the active season
                    },
                    select: {
                        _count: {
                            select: {
                                teamStreaks: {
                                    where: {
                                        streak_length: { gte: 3 } // Only length 3 or higher
                                    }
                                }
                            }
                        }
                    }
                }
            }
        });

        const formattedLeagues = await Promise.all(
            rawLeagues.map(async (league) => {
                // Safely extract the count from the current season
                const currentSeason = league.seasons?.[0];
                const streakCount = currentSeason?._count?.teamStreaks || 0;

                // Destructure to remove the raw nested 'seasons' object from the API response
                const { seasons, ...leagueData } = league;

                return {
                    ...leagueData,
                    streak_count: streakCount,
                    flag: await getFlag(league.country),
                };
            })
        );

        return formattedLeagues;
    },
};

module.exports = leaguesServices;