const AppError = require("../../middlewares/AppError");
const { prisma } = require("../../utils/prisma");
const streaksService = require("./streaks.service");

// ─────────────────────────────────────────────────────────────────────────
// GET /matchup/{streakId} - the detail view is a proof-of-one-prediction page
// (see getStreakById), but doesn't show BOTH teams for the market. This
// endpoint fills that gap: given a streak, resolve which match/teams it's
// actually about (via the same candidate cache streaks.service.js already
// maintains) and return each side's season average, current streak (if any),
// and every finished match's raw value for that one market - the same shape
// the internal admin team-dashboard already computes per-team
// (teams.service.js's getTeamDashboard), just scoped to one market and both
// teams at once instead of one team and all 8 markets.
// ─────────────────────────────────────────────────────────────────────────

const FINISHED_STATUSES = ['FT', 'AET', 'PEN'];

async function buildTeamSide(teamId, seasonId, marketId, teamInfo) {
    const [avgRow, streakRow, statRows] = await Promise.all([
        prisma.teamSeasonAverage.findFirst({
            where: { team_id: teamId, season_id: seasonId, market_id: marketId },
            select: { avg_value: true }
        }),
        prisma.teamStreak.findFirst({
            where: { team_id: teamId, season_id: seasonId, market_id: marketId },
            select: { streak_length: true, streak_direction: true }
        }),
        prisma.matchTeamStat.findMany({
            where: {
                team_id: teamId,
                market_id: marketId,
                match: { status: { in: FINISHED_STATUSES } }
            },
            orderBy: { match: { kickoff_at: 'desc' } }, // most recent first
            select: {
                value: true,
                match: {
                    select: {
                        id: true, kickoff_at: true, home_score: true, away_score: true,
                        home_team_id: true,
                        homeTeam: { select: { id: true, name: true } },
                        awayTeam: { select: { id: true, name: true } }
                    }
                }
            }
        })
    ]);

    const matches = statRows
        .filter(row => row.match?.kickoff_at)
        .map(row => {
            const m = row.match;
            const isHome = m.home_team_id === teamId;
            const opponent = isHome ? m.awayTeam : m.homeTeam;
            return {
                match_id: `match_${m.id}`,
                date: m.kickoff_at.toISOString().slice(0, 10),
                venue: isHome ? 'home' : 'away',
                opponent: { id: `team_${opponent.id}`, name: opponent.name },
                score: `${m.home_score}-${m.away_score}`,
                value: Number(row.value)
            };
        });

    return {
        team: teamInfo,
        season_avg: avgRow ? Math.round(Number(avgRow.avg_value) * 100) / 100 : null,
        // Present regardless of length (even a 1-2 match streak, below the
        // >=3 floor that gets a team onto /streaks at all) - this is
        // supporting context for a matchup view, not a listing filter, so
        // the frontend decides whether/how to badge it.
        streak: streakRow ? { count: streakRow.streak_length, direction: streakRow.streak_direction } : null,
        matches
    };
}

const matchupService = {
    getMatchup: async (streakId) => {
        const base = await streaksService.resolveCandidateByStreakId(streakId);

        const match = await prisma.match.findUnique({
            where: { id: base._matchId },
            select: { home_team_id: true, away_team_id: true, season_id: true }
        });
        if (!match) {
            throw new AppError('Streak not found', 404);
        }

        const [home, away] = await Promise.all([
            buildTeamSide(match.home_team_id, match.season_id, base._marketId, base.match.home),
            buildTeamSide(match.away_team_id, match.season_id, base._marketId, base.match.away)
        ]);

        return {
            streak_id: base.id,
            market: base.market,
            match: base.match,
            home,
            away
        };
    }
};

module.exports = matchupService;
