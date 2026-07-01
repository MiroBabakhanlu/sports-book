const AppError = require("../middlewares/errorMiddleware");
const { prisma } = require("../utils/prisma");


const SLUG_MAP = {
    'corners-over-under': 'total-corner-kicks',
    'goals-overunder': 'total-goals',
    'red-cards-over-under': 'total-red-cards',
    'yellow-cards-over-under': 'total-yellow-cards'
};

const teamsServices = {
    getLeagues: async () => {
        return await prisma.league.findMany({
            orderBy: { name: 'asc' }
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

    getUpcomingMatches: async (leagueId, seasonYear) => {
        const now = new Date();

        console.log(`\n🔍 Searching for League ID: ${leagueId}, Season: ${seasonYear}`);

        const matches = await prisma.match.findMany({
            where: {
                status: 'NS',
                kickoff_at: { gte: now },
                season: {
                    league_id: parseInt(leagueId),
                    year: seasonYear.toString()
                }
            },
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
                        bookmaker_name: 'Bet365',
                        market: { slug: { in: [...Object.keys(SLUG_MAP), 'match-winner'] } }
                    },
                    select: {
                        market: { select: { slug: true } },
                        slug: true,
                        odd: true
                    }
                }
            },
            orderBy: { kickoff_at: 'asc' }
        });

        console.log(`Found ${matches.length} upcoming matches.`);

        if (matches.length === 0) {
            return [];
        }

        const allMarkets = await prisma.market.findMany({
            where: { slug: { in: Object.values(SLUG_MAP) } }
        });

        const result = await Promise.all(matches.map(async (match) => {
            const oddsByMarket = {};
            match.matchOdds.forEach(o => {
                const slug = o.market.slug;
                if (!oddsByMarket[slug]) oddsByMarket[slug] = [];
                oddsByMarket[slug].push({
                    selection: o.slug,
                    odd: Number(o.odd)
                });
            });

            const marketData = [];

            for (const [rawSlug, canonicalSlug] of Object.entries(SLUG_MAP)) {
                if (!oddsByMarket[rawSlug] || oddsByMarket[rawSlug].length === 0) continue;

                const marketRecord = allMarkets.find(m => m.slug === canonicalSlug);
                if (!marketRecord) continue;

                const getTeamData = async (teamId) => {
                    const avg = await prisma.teamSeasonAverage.findFirst({
                        where: {
                            team_id: teamId,
                            market_id: marketRecord.id,
                            season_id: match.season_id
                        }
                    });

                    const streak = await prisma.teamStreak.findFirst({
                        where: {
                            team_id: teamId,
                            market_id: marketRecord.id,
                            season_id: match.season_id
                        }
                    });

                    const val = avg ? Number(avg.avg_value) : 0;
                    return {
                        avg_value: val,
                        suggestedValue: (val % 1 === 0) ? val : Math.floor(val) + 0.5,
                        streak: streak ? {
                            length: streak.streak_length,
                            direction: streak.streak_direction
                        } : null
                    };
                };

                marketData.push({
                    marketSlug: rawSlug,
                    odds: oddsByMarket[rawSlug],
                    home: await getTeamData(match.home_team_id),
                    away: await getTeamData(match.away_team_id)
                });
            }

            if (!oddsByMarket['match-winner'] && marketData.length === 0) {
                return null;
            }

            return {
                id: match.id,
                kickoff_at: match.kickoff_at,
                league_id: match.season.league.id,
                league_name: match.season.league.name,
                homeTeam: match.homeTeam,
                awayTeam: match.awayTeam,
                matchWinnerOdds: oddsByMarket['match-winner'] || [],
                marketData
            };
        }));

        const filteredResult = result.filter(Boolean);


        console.log(` Pipeline finished. Returning ${filteredResult.length} matches.`);

        return filteredResult;
    }
};
module.exports = teamsServices;