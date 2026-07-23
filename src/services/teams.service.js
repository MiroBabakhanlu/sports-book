const AppError = require("../middlewares/errorMiddleware");
const { prisma } = require("../utils/prisma");
const fs = require('fs');
const path = require('path');

const SLUG_MAP = {
    'corners-over-under': 'total-corner-kicks',
    'goals-overunder': 'total-goals',
    'red-cards-over-under': 'total-red-cards',
    'yellow-overunder': 'total-yellow-cards',
    'total-home': 'team-goals',
    'total-away': 'team-goals',
    'home-corners-overunder': 'team-corner-kicks',
    'away-corners-overunder': 'team-corner-kicks',
    'home-team-yellow-cards': 'team-yellow-cards',
    'away-team-yellow-cards': 'team-yellow-cards',
    'team-red-cards': 'team-red-cards'
};

const STREAK_CHECK_SLUGS = [
    'team-goals',
    'total-goals',
    'team-yellow-cards',
    'total-yellow-cards',
    'team-red-cards',
    'total-red-cards',
    'team-corner-kicks',
    'total-corner-kicks'
];

const teamsServices = {
    getLeagues: async () => {
        return await prisma.league.findMany({
            orderBy: {
                display_order: 'asc'
            }
        });
    },

    getSeasonsByLeague: async (leagueId) => {
        if (!leagueId) {
            throw new AppError('League ID selection is required', 400);
        }
        return await prisma.season.findMany({
            where: { league_id: parseInt(leagueId, 10) },
            orderBy: { year: 'desc' }
        });
    },

    getTeamsBySeason: async (seasonId) => {
        if (!seasonId) {
            throw new AppError('Season ID selection is required', 400);
        }

        const matches = await prisma.match.findMany({
            where: { season_id: parseInt(seasonId, 10) },
            include: { homeTeam: true, awayTeam: true }
        });

        const teamMap = new Map();
        matches.forEach(m => {
            if (m.homeTeam) teamMap.set(m.homeTeam.id, m.homeTeam);
            if (m.awayTeam) teamMap.set(m.awayTeam.id, m.awayTeam);
        });

        console.log('Unique teams for season', Array.from(teamMap.values()).map(t => t.name));
        return Array.from(teamMap.values()).sort((a, b) => a.name.localeCompare(b.name));
    },

    getTeamDashboard: async (teamId, seasonId) => {
        if (!teamId || !seasonId) {
            throw new AppError('Missing mandatory analytical parameter matrices', 400);
        }

        const tId = parseInt(teamId, 10);
        const sId = parseInt(seasonId, 10);

        const averages = await prisma.teamSeasonAverage.findMany({
            where: { team_id: tId, season_id: sId },
            include: { market: true }
        });

        const matches = await prisma.match.findMany({
            where: {
                season_id: sId,
                OR: [
                    { home_team_id: tId },
                    { away_team_id: tId }
                ]
            },
            include: {
                homeTeam: { select: { name: true, logo_url: true } },
                awayTeam: { select: { name: true, logo_url: true } },
                stats: {
                    include: {
                        market: { select: { slug: true } }
                    }
                }
            },
            orderBy: { kickoff_at: 'asc' }
        });

        // ✅ ONLY ADDITION: fetch streaks once
        const streaks = await prisma.teamStreak.findMany({
            where: {
                team_id: tId,
                season_id: sId
            }
        });

        const formattedMatches = matches.map(m => {
            const matchStats = m.stats || [];

            const getStatValue = (slug, side) => {
                const found = matchStats.find(s => s.market?.slug === slug && s.side === side);
                return found ? (Number(found.value) || 0) : 0;
            };

            return {
                id: m.id,
                id_api: m.id_api,
                status: m.status,
                kickoff_at: m.kickoff_at,
                home_score: m.home_score,
                away_score: m.away_score,
                home_team_id: m.home_team_id,
                away_team_id: m.away_team_id,
                homeTeam: m.homeTeam,
                awayTeam: m.awayTeam,
                home_yellows: getStatValue('team-yellow-cards', 'home'),
                away_yellows: getStatValue('team-yellow-cards', 'away'),
                home_reds: getStatValue('team-red-cards', 'home'),
                away_reds: getStatValue('team-red-cards', 'away'),
                home_corners: getStatValue('team-corner-kicks', 'home'),
                away_corners: getStatValue('team-corner-kicks', 'away')
            };
        });

        const averagesWithTotals = averages.map(avg => {
            const slug = avg.market.slug.toLowerCase();
            let total_sum = 0;
            let total_sum_home = 0;
            let total_sum_away = 0;

            // ✅ ONLY ADDITION: match streak for this market
            const streak = streaks.find(
                s => s.market_id === avg.market_id
            );

            const matchDays = formattedMatches.map(m => {
                const isHome = m.home_team_id === tId;
                let matchValue = 0;

                switch (slug) {
                    case 'team-goals':
                        matchValue = isHome ? (m.home_score ?? 0) : (m.away_score ?? 0);
                        break;
                    case 'total-goals':
                        matchValue = (m.home_score ?? 0) + (m.away_score ?? 0);
                        break;
                    case 'team-yellow-cards':
                        matchValue = isHome ? m.home_yellows : m.away_yellows;
                        break;
                    case 'total-yellow-cards':
                        matchValue = m.home_yellows + m.away_yellows;
                        break;
                    case 'team-red-cards':
                        matchValue = isHome ? m.home_reds : m.away_reds;
                        break;
                    case 'total-red-cards':
                        matchValue = m.home_reds + m.away_reds;
                        break;
                    case 'team-corner-kicks':
                        matchValue = isHome ? m.home_corners : m.away_corners;
                        break;
                    case 'total-corner-kicks':
                        matchValue = m.home_corners + m.away_corners;
                        break;
                    default:
                        matchValue = 0;
                }

                const isFinished = m.home_score !== null && m.away_score !== null;
                if (isFinished) {
                    total_sum += matchValue;
                    if (isHome) {
                        total_sum_home += matchValue;
                    } else {
                        total_sum_away += matchValue;
                    }
                }

                return {
                    id: m.id,
                    status: m.status,
                    kickoff_at: m.kickoff_at,
                    venue: isHome ? 'Home' : 'Away',
                    opponent: isHome ? m.awayTeam : m.homeTeam,
                    score: isFinished ? `${m.home_score} - ${m.away_score}` : 'vs',
                    rawValue: matchValue
                };
            });

            return {
                ...avg,

                // ✅ ONLY CHANGE: add streak object
                streak: streak
                    ? {
                        length: streak.streak_length,
                        direction: streak.streak_direction
                    }
                    : null,

                total_sum,
                total_sum_home,
                total_sum_away,
                matchDays,
            };
        });

        return {
            averages: averagesWithTotals,
            matches: formattedMatches,
            teamLogo: formattedMatches.length > 0
                ? (formattedMatches[0].home_team_id === tId
                    ? formattedMatches[0].homeTeam.logo_url
                    : formattedMatches[0].awayTeam.logo_url)
                : null,
            teamName: formattedMatches.length > 0
                ? (formattedMatches[0].home_team_id === tId
                    ? formattedMatches[0].homeTeam.name
                    : formattedMatches[0].awayTeam.name)
                : null
        };
    },


    getUpcomingMatches: async ({ leagueIds, teamId, seasonYear }) => {
        const now = new Date();

        // ─── NEW: READ MEDIA DIRECTORY UPFRONT FOR BOOKMAKER LOGOS ─────────
        let logoMap = new Map();
        try {
            const mediaPath = path.join(__dirname, '../.././public/media');
            const mediaFiles = fs.readdirSync(mediaPath);

            // Build a lowercase lookup map: { 'bet365': '../media/bet365.png' }
            mediaFiles.forEach(file => {
                const fileName = path.parse(file).name.toLowerCase();
                logoMap.set(fileName, `../media/${file}`);
            });
        } catch (error) {
            console.error("⚠️ Error reading bookmaker media directory:", error);
        }
        // ───────────────────────────────────────────────────────────────────

        const matchWhereClause = {
            status: { in: ['NS', 'PST'] },
            kickoff_at: { gte: now },
            season: {
                year: seasonYear.toString()
            }
        };

        if (leagueIds && leagueIds.length > 0) {
            matchWhereClause.season.league_id = { in: leagueIds };
        }

        if (teamId) {
            matchWhereClause.OR = [
                { home_team_id: parseInt(teamId) },
                { away_team_id: parseInt(teamId) }
            ];
        }

        const matches = await prisma.match.findMany({
            where: matchWhereClause,
            include: {
                homeTeam: { select: { id: true, name: true, logo_url: true } },
                awayTeam: { select: { id: true, name: true, logo_url: true } },
                season: {
                    include: {
                        league: { select: { id: true, name: true } }
                    }
                },
                matchOdds: {
                    where: {
                        market: { slug: { in: [...Object.keys(SLUG_MAP), 'match-winner'] } }
                    },
                    select: {
                        market: { select: { slug: true } },
                        slug: true,
                        odd: true,
                        bookmaker: { select: { id: true, name: true } }
                    }
                }
            },
            orderBy: { kickoff_at: 'asc' },
            ...(teamId ? { take: 1 } : {})
        });

        console.log(`Found ${matches.length} total upcoming matches in database query.`);
        if (matches.length === 0) return [];

        const validMatches = [];
        // Tracks, for the "all teams" aggregate view, which match is each team's OWN
        // absolute next fixture. A match can end up in validMatches solely because
        // it's team A's next match, while also featuring team B as the other side -
        // even though this ISN'T team B's own next match (B's real next match is a
        // different, earlier fixture with its own entry in validMatches). We need
        // this map below so B's streak doesn't get incorrectly attached to A's match.
        let teamNextMatches = null;
        if (teamId) {
            validMatches.push(matches[0]);
        } else {
            teamNextMatches = new Map();
            for (const match of matches) {
                if (!teamNextMatches.has(match.home_team_id)) teamNextMatches.set(match.home_team_id, match);
                if (!teamNextMatches.has(match.away_team_id)) teamNextMatches.set(match.away_team_id, match);
            }
            validMatches.push(...Array.from(new Set(teamNextMatches.values())));
        }

        const allMarkets = await prisma.market.findMany({
            where: { slug: { in: STREAK_CHECK_SLUGS } }
        });
        const streakMarketIds = allMarkets.map(m => m.id);

        const uniqueTeamIds = [...new Set(validMatches.flatMap(m => [m.home_team_id, m.away_team_id]))];
        const uniqueSeasonIds = [...new Set(validMatches.map(m => m.season_id))];

        // ─── ABSOLUTE NEXT MATCH MAP (works for BOTH teamId mode and "all teams"
        // mode) ──────────────────────────────────────────────────────────────
        // A team's streak/prediction data must only ever be attached to a match
        // that is genuinely that team's own next unplayed fixture - never
        // "borrowed" onto a match that's actually the opponent's next fixture.
        // teamNextMatches (above) can't be reused for this: in teamId mode it's
        // null (query is scoped only to the requested team, so it has no
        // visibility into the opponent's other matches), and even in "all teams"
        // mode it's restricted by leagueIds. So we compute a separate,
        // unrestricted map here (no leagueIds/teamId filter) covering every team
        // that appears in validMatches, to find each one's TRUE absolute next
        // match regardless of league/team scoping.
        const absoluteNextMatchByTeam = new Map();
        {
            const candidateMatches = await prisma.match.findMany({
                where: {
                    status: { in: ['NS', 'PST'] },
                    kickoff_at: { gte: now },
                    season: { year: seasonYear.toString() },
                    OR: [
                        { home_team_id: { in: uniqueTeamIds } },
                        { away_team_id: { in: uniqueTeamIds } }
                    ]
                },
                select: { id: true, home_team_id: true, away_team_id: true },
                orderBy: { kickoff_at: 'asc' }
            });
            for (const m of candidateMatches) {
                if (uniqueTeamIds.includes(m.home_team_id) && !absoluteNextMatchByTeam.has(m.home_team_id)) {
                    absoluteNextMatchByTeam.set(m.home_team_id, m.id);
                }
                if (uniqueTeamIds.includes(m.away_team_id) && !absoluteNextMatchByTeam.has(m.away_team_id)) {
                    absoluteNextMatchByTeam.set(m.away_team_id, m.id);
                }
            }
        }

        const [allAverages, allStreaks] = await Promise.all([
            prisma.teamSeasonAverage.findMany({
                where: {
                    team_id: { in: uniqueTeamIds },
                    market_id: { in: streakMarketIds },
                    season_id: { in: uniqueSeasonIds }
                }
            }),
            prisma.teamStreak.findMany({
                where: {
                    team_id: { in: uniqueTeamIds },
                    market_id: { in: streakMarketIds },
                    season_id: { in: uniqueSeasonIds }
                }
            })
        ]);

        const averageMap = new Map();
        allAverages.forEach(avg => {
            averageMap.set(`${avg.team_id}-${avg.market_id}-${avg.season_id}`, avg);
        });

        const streakMap = new Map();
        allStreaks.forEach(str => {
            streakMap.set(`${str.team_id}-${str.market_id}-${str.season_id}`, str);
        });

        const result = validMatches.map((match) => {
            // A side is only "eligible" for its streak/prediction data if this match
            // is genuinely that team's own absolute next fixture - true in BOTH
            // teamId mode and "all teams" mode (see absoluteNextMatchByTeam above).
            const isHomeTeamsNextMatch = absoluteNextMatchByTeam.get(match.home_team_id) === match.id;
            const isAwayTeamsNextMatch = absoluteNextMatchByTeam.get(match.away_team_id) === match.id;

            const hasOddsRecords = match.matchOdds.length > 0;

            if (!hasOddsRecords) {
                const matchHasHighStreak = allStreaks.some(str =>
                    str.season_id === match.season_id &&
                    str.streak_length >= 3 &&
                    ((isHomeTeamsNextMatch && str.team_id === match.home_team_id) ||
                        (isAwayTeamsNextMatch && str.team_id === match.away_team_id))
                );
                if (!matchHasHighStreak) return null;
            }

            const oddsByMarket = {};
            match.matchOdds.forEach(o => {
                const slug = o.market.slug;
                if (!oddsByMarket[slug]) oddsByMarket[slug] = [];

                // ─── NEW: LOOKUP THE LOGO URL FROM OUR IN-MEMORY MAP ───────────
                const bookmakerName = o.bookmaker?.name || '';
                const logoUrl = logoMap.get(bookmakerName.toLowerCase()) || null;
                // ───────────────────────────────────────────────────────────────

                oddsByMarket[slug].push({
                    bookmaker: {
                        id: o.bookmaker?.id,
                        name: bookmakerName,
                        logo_url: logoUrl // ⭐ Logo added here
                    },
                    selection: o.slug,
                    odd: Number(o.odd)
                });
            });

            const marketData = [];

            for (const [rawSlug, canonicalSlug] of Object.entries(SLUG_MAP)) {
                const marketRecord = allMarkets.find(m => m.slug === canonicalSlug);
                if (!marketRecord) continue;

                const getTeamDataFromMemory = (teamId) => {
                    const mapKey = `${teamId}-${marketRecord.id}-${match.season_id}`;
                    const avg = averageMap.get(mapKey);
                    const streak = streakMap.get(mapKey);

                    const val = avg ? Number(avg.avg_value) : 0;
                    return {
                        avg_value: val,
                        suggestedValue: (val % 1 === 0) ? val : Math.floor(val) + 0.5,
                        streak: streak ? {
                            length: streak.streak_length,
                            direction: streak.streak_direction,
                            confidence: streak.confidence != null ? Number(streak.confidence) : null  // ⭐ NEW
                        } : null
                    };
                };

                // Don't attach a team's streak/average to this match unless it's
                // actually that team's own next fixture - see isHomeTeamsNextMatch/
                // isAwayTeamsNextMatch above. Otherwise a team whose real next match
                // is fixture #1497 would also incorrectly surface a streak insight
                // against fixture #1512 just because it happens to be their opponent's
                // next match, double-counting the same team+market pair.
                const homeTeamData = isHomeTeamsNextMatch
                    ? getTeamDataFromMemory(match.home_team_id)
                    : { avg_value: 0, suggestedValue: 0.5, streak: null };
                const awayTeamData = isAwayTeamsNextMatch
                    ? getTeamDataFromMemory(match.away_team_id)
                    : { avg_value: 0, suggestedValue: 0.5, streak: null };

                const currentMarketOdds = oddsByMarket[rawSlug] || [];
                const homeStreakLen = homeTeamData.streak?.length || 0;
                const awayStreakLen = awayTeamData.streak?.length || 0;

                if (currentMarketOdds.length > 0 || homeStreakLen >= 3 || awayStreakLen >= 3) {
                    marketData.push({
                        marketSlug: rawSlug,
                        odds: currentMarketOdds,
                        home: homeTeamData,
                        away: awayTeamData
                    });
                }
            }

            if (!oddsByMarket['match-winner'] && marketData.length === 0) {
                return null;
            }

            return {
                id: match.id,
                kickoff_at: match.kickoff_at,
                league_id: match.season.league.id,
                season_id: match.season.id,
                league_name: match.season.league.name,
                homeTeam: match.homeTeam,
                awayTeam: match.awayTeam,
                matchWinnerOdds: oddsByMarket['match-winner'] || [],
                marketData
            };
        });

        const filteredResult = result.filter(Boolean);
        console.log(`📊 Pipeline finished. Returning ${filteredResult.length} absolute next matches.`);

        return filteredResult;
    }
};

// Exposed so other services (e.g. main/streaks.service.js) that need to resolve
// MatchOdds against these same raw provider slugs don't have to duplicate/drift
// from this mapping.
teamsServices.SLUG_MAP = SLUG_MAP;

module.exports = teamsServices;



// getUpcomingMatches: async (leagueId, seasonYear) => {
//     const now = new Date();

//     console.log(`\n🔍 Searching for League ID: ${leagueId}, Season: ${seasonYear}`);

//     const matches = await prisma.match.findMany({
//         where: {
//             status: 'NS',
//             kickoff_at: { gte: now },
//             season: {
//                 league_id: parseInt(leagueId),
//                 year: seasonYear.toString()
//             }
//         },
//         include: {
//             homeTeam: { select: { id: true, name: true, logo_url: true } },
//             awayTeam: { select: { id: true, name: true, logo_url: true } },
//             season: {
//                 include: {
//                     league: { select: { id: true, name: true } }
//                 }
//             },
//             matchOdds: {
//                 where: {
//                     bookmaker_name: 'Bet365',
//                     market: { slug: { in: [...Object.keys(SLUG_MAP), 'match-winner'] } }
//                 },
//                 select: {
//                     market: { select: { slug: true } },
//                     slug: true,
//                     odd: true
//                 }
//             }
//         },
//         orderBy: { kickoff_at: 'asc' }
//     });

//     console.log(`Found ${matches.length} upcoming matches.`);

//     if (matches.length === 0) {
//         return [];
//     }

//     const allMarkets = await prisma.market.findMany({
//         where: { slug: { in: Object.values(SLUG_MAP) } }
//     });

//     const result = await Promise.all(matches.map(async (match) => {
//         const oddsByMarket = {};
//         match.matchOdds.forEach(o => {
//             const slug = o.market.slug;
//             if (!oddsByMarket[slug]) oddsByMarket[slug] = [];
//             oddsByMarket[slug].push({
//                 selection: o.slug,
//                 odd: Number(o.odd)
//             });
//         });

//         const marketData = [];

//         for (const [rawSlug, canonicalSlug] of Object.entries(SLUG_MAP)) {
//             if (!oddsByMarket[rawSlug] || oddsByMarket[rawSlug].length === 0) continue;

//             const marketRecord = allMarkets.find(m => m.slug === canonicalSlug);
//             if (!marketRecord) continue;

//             const getTeamData = async (teamId) => {
//                 const avg = await prisma.teamSeasonAverage.findFirst({
//                     where: {
//                         team_id: teamId,
//                         market_id: marketRecord.id,
//                         season_id: match.season_id
//                     }
//                 });

//                 const streak = await prisma.teamStreak.findFirst({
//                     where: {
//                         team_id: teamId,
//                         market_id: marketRecord.id,
//                         season_id: match.season_id
//                     }
//                 });

//                 const val = avg ? Number(avg.avg_value) : 0;
//                 return {
//                     avg_value: val,
//                     suggestedValue: (val % 1 === 0) ? val : Math.floor(val) + 0.5,
//                     streak: streak ? {
//                         length: streak.streak_length,
//                         direction: streak.streak_direction
//                     } : null
//                 };
//             };

//             marketData.push({
//                 marketSlug: rawSlug,
//                 odds: oddsByMarket[rawSlug],
//                 home: await getTeamData(match.home_team_id),
//                 away: await getTeamData(match.away_team_id)
//             });
//         }

//         if (!oddsByMarket['match-winner'] && marketData.length === 0) {
//             return null;
//         }

//         return {
//             id: match.id,
//             kickoff_at: match.kickoff_at,
//             league_id: match.season.league.id,
//             league_name: match.season.league.name,
//             homeTeam: match.homeTeam,
//             awayTeam: match.awayTeam,
//             matchWinnerOdds: oddsByMarket['match-winner'] || [],
//             marketData
//         };
//     }));

//     const filteredResult = result.filter(Boolean);


//     console.log(` Pipeline finished. Returning ${filteredResult.length} matches.`);

//     return filteredResult;
// },