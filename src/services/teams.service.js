const AppError = require("../middlewares/errorMiddleware");
const { prisma } = require("../utils/prisma");


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

        // Format each match using the correct 'stats' property array
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

            // Map over ALL games to capture full matchday data context for this market
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

                // Only add to mathematical totals if the game is actually completed / has scores
                const isFinished = m.home_score !== null && m.away_score !== null;
                if (isFinished) {
                    total_sum += matchValue;
                    if (isHome) {
                        total_sum_home += matchValue;
                    } else {
                        total_sum_away += matchValue;
                    }
                }

                // Return full match layout containing this market's exact value for the audit table
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
                total_sum,
                total_sum_home,
                total_sum_away,
                matchDays // Contains every matchday with its specific raw value for this market row
            };
        });

        // console.log('formattedMatches:', averagesWithTotals);

        return { averages: averagesWithTotals, matches: formattedMatches };
    }
};
module.exports = teamsServices;