const AppError = require("../../middlewares/AppError");
const { prisma } = require("../../utils/prisma");
const streaksService = require("./streaks.service");
const standingsService = require("./standings.service");

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
const CHART_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// season_avg is a literal per-game average for every numeric market (goals,
// corners, cards...), which needs no explanation. For the two boolean markets
// it's actually an occurrence RATE of whichever side got encoded as 1 (see
// pop-db.js) - 0.61 means nothing on its own without saying "61% odd" vs "61%
// even". Keyed by streaksService's MARKET_MAP key (base.market.key), not the
// raw db slug, since that's what's already resolved by the time this runs.
const AVG_FOR_BY_MARKET_KEY = {
    odd_even: 'odd',
    both_teams_score: 'yes'
};

// Team Statistics widget - comparison stats only, deliberately NOT part of
// STREAK_CHECK_SLUGS/TARGET_SLUGS (teams.service.js / streak-tracker.js), so
// none of these ever get evaluated for streaks. team-clean-sheets stores a
// plain 1/0 per match (see pop-db.js), same as every other market here -
// generateSeasonAverages() doesn't care what the values mean, so its avg_value
// naturally comes out as the clean-sheet RATE. Converting that rate back into
// the whole-number COUNT the widget displays is the one thing that needs
// special handling below, since it's the only stat shown as a count rather
// than a per-game average.
const STATS_MARKETS = [
    { slug: 'team-goals', key: 'goals_scored' },
    { slug: 'team-goals-conceded', key: 'goals_conceded' },
    { slug: 'team-goals-1st-half', key: 'goals_1st_half' },
    { slug: 'team-goals-2nd-half', key: 'goals_2nd_half' },
    { slug: 'team-corner-kicks', key: 'corners' },
    { slug: 'team-yellow-cards', key: 'yellow_cards' },
    { slug: 'team-possession', key: 'possession' },
    { slug: 'team-shots', key: 'shots' },
    { slug: 'team-clean-sheets', key: 'clean_sheets' }
];

// Market rows rarely change - memoized the same way streaks.service.js's own
// getMarketIndex() is, so this doesn't re-query on every /matchup request.
let statsMarketIndexPromise = null;
async function getStatsMarketIndex() {
    if (!statsMarketIndexPromise) {
        statsMarketIndexPromise = (async () => {
            const rows = await prisma.market.findMany({
                where: { slug: { in: STATS_MARKETS.map(m => m.slug) } }
            });
            console.log('rows', rows)
            return new Map(rows.map(r => [r.slug, r.id]));
        })().catch((err) => {
            statsMarketIndexPromise = null;
            throw err;
        });
    }
    return statsMarketIndexPromise;
}

function roundOrNull(val) {
    return val === null || val === undefined ? null : Math.round(Number(val) * 100) / 100;
}

// Builds the Team Statistics widget: both teams' season averages for each stat,
// plus the league-wide average for each (computed on request via groupBy/avg
// on TeamSeasonAverage - cheap single aggregate query, no separate stored
// table needed the way standings needed one).
async function buildStatistics(homeTeamId, awayTeamId, seasonId) {
    const marketBySlug = await getStatsMarketIndex();
    const marketIds = STATS_MARKETS.map(m => marketBySlug.get(m.slug)).filter(Boolean);
    console.log('marketIds', marketIds)
    const cleanSheetsMarketId = marketBySlug.get('team-clean-sheets');

    const [averages, leagueRows] = await Promise.all([
        prisma.teamSeasonAverage.findMany({
            where: { season_id: seasonId, market_id: { in: marketIds }, team_id: { in: [homeTeamId, awayTeamId] } },
            select: { team_id: true, market_id: true, avg_value: true, matches_played: true }
        }),
        // Every team's row for every stat market this season - used both for the
        // simple AVG() aggregates below and, for clean-sheets specifically, to
        // convert each team's rate to a count before averaging those counts.
        prisma.teamSeasonAverage.findMany({
            where: { season_id: seasonId, market_id: { in: marketIds } },
            select: { market_id: true, avg_value: true, matches_played: true }
        })
    ]);
    console.log('leagueRows', leagueRows)
    // rate * matches_played, rounded - only meaningful for clean_sheets (a count),
    // everything else just wants the rate/average itself, rounded to 2dp.
    const toDisplayValue = (marketId, avgValue, matchesPlayed) =>
        marketId === cleanSheetsMarketId
            ? Math.round(Number(avgValue) * matchesPlayed)
            : roundOrNull(avgValue);

    const avgByTeamMarket = new Map(averages.map(a => [`${a.team_id}-${a.market_id}`, a]));
    console.log('avgByTeamMarket', avgByTeamMarket)

    const buildSide = (teamId) => {
        const side = {};
        for (const { slug, key } of STATS_MARKETS) {
            const marketId = marketBySlug.get(slug);
            const row = marketId ? avgByTeamMarket.get(`${teamId}-${marketId}`) : undefined;
            side[key] = row ? toDisplayValue(marketId, row.avg_value, row.matches_played) : null;
        }
        console.log("side", side)
        return side;
    };

    // League average: plain mean of avg_value for every stat except clean_sheets,
    // which needs each team's rate converted to a count first (rate * matches_played
    // isn't linear across teams with different matches_played, so it can't just
    // reuse the same avg_value mean the other stats use).
    const byMarket = new Map();
    for (const row of leagueRows) {
        if (!byMarket.has(row.market_id)) byMarket.set(row.market_id, []);
        byMarket.get(row.market_id).push(row);
    }
    console.log('byMarket', byMarket)
    const leagueAvg = {};
    for (const { slug, key } of STATS_MARKETS) {
        const marketId = marketBySlug.get(slug);
        const rows = marketId ? byMarket.get(marketId) : undefined;
        if (!rows || !rows.length) {
            leagueAvg[key] = null;
            continue;
        }
        if (marketId === cleanSheetsMarketId) {
            const counts = rows.map(r => Number(r.avg_value) * r.matches_played);
            leagueAvg[key] = Math.round((counts.reduce((s, v) => s + v, 0) / counts.length) * 10) / 10;
        } else {
            const values = rows.map(r => Number(r.avg_value));
            leagueAvg[key] = roundOrNull(values.reduce((s, v) => s + v, 0) / values.length);
        }
    }

    return { home: buildSide(homeTeamId), away: buildSide(awayTeamId), league_avg: leagueAvg };
}

// matches[].date is already "YYYY-MM-DD" (see buildTeamSide) - chartData needs the
// shorter "Nov 23" display form instead, so this just reformats rather than re-deriving.
function formatChartDate(isoDateStr) {
    const d = new Date(`${isoDateStr}T00:00:00Z`);
    return `${CHART_MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

async function buildTeamSide(teamId, seasonId, marketId, teamInfo, avgFor) {
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
                        home_team_id: true, matchday: true,
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
                matchday: m.matchday,
                venue: isHome ? 'home' : 'away',
                opponent: { id: `team_${opponent.id}`, name: opponent.name },
                score: `${m.home_score}-${m.away_score}`,
                value: Number(row.value)
            };
        });

    return {
        team: teamInfo,
        season_avg: avgRow ? Math.round(Number(avgRow.avg_value) * 100) / 100 : null,
        // null for every numeric market (goals, corners, cards...) where
        // season_avg is self-explanatory. Set only for oddeven/both-teams-score,
        // where season_avg is an occurrence rate that's meaningless without
        // saying which outcome it's the rate of - see AVG_FOR_BY_MARKET_KEY.
        avg_for: avgFor ?? null,
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
        console.log('base', base)

        const match = await prisma.match.findUnique({
            where: { id: base._matchId },
            select: { home_team_id: true, away_team_id: true, season_id: true }
        });
        if (!match) {
            throw new AppError('Streak not found', 404);
        }

        const avgFor = AVG_FOR_BY_MARKET_KEY[base.market.key];

        const [home, away, allOdds, similarStreaks, standingRows, statistics, leagueStandings] = await Promise.all([
            buildTeamSide(match.home_team_id, match.season_id, base._marketId, base.match.home, avgFor),
            buildTeamSide(match.away_team_id, match.season_id, base._marketId, base.match.away, avgFor),
            streaksService.getAllOddsForStreak(base),
            streaksService.getSimilarStreaks(base),
            prisma.teamStanding.findMany({
                where: { season_id: match.season_id, team_id: { in: [match.home_team_id, match.away_team_id] } },
                select: { team_id: true, position: true }
            }),
            buildStatistics(match.home_team_id, match.away_team_id, match.season_id),
            standingsService.getStandingsWindow(match.season_id, [match.home_team_id, match.away_team_id])
        ]);

        // base.match is shared with every other endpoint reading from the same
        // cached candidate (getStreakById, /streaks, /streaks/summary) - position
        // is only wanted here, so build a matchup-local copy rather than mutating
        // the shared object or adding a DB lookup to every candidate everywhere else.
        const positionByTeam = new Map(standingRows.map(r => [r.team_id, r.position]));
        const matchWithPositions = {
            ...base.match,
            home: { ...base.match.home, position: positionByTeam.get(match.home_team_id) ?? null },
            away: { ...base.match.away, position: positionByTeam.get(match.away_team_id) ?? null }
        };

        // chartData is single-team (whichever side the streak actually belongs to),
        // not both teams like home/away above - mirrors the mockup's
        // "<Team> - last N games" bar chart, which only ever shows one team's trend.
        const isHomeStreak = base.streak_side === 'home';
        const streakSide = isHomeStreak ? home : away;
        const streakTeamName = isHomeStreak ? base.match.home.name : base.match.away.name;

        // streakSide.matches is most-recent-first and unlimited (every finished match
        // this season) - take streak_count*2 so the chart shows the streak itself plus
        // an equal number of games right before it started (context: what the pattern
        // looked like beforehand, including the game that would have broken an earlier
        // streak). .slice() naturally caps this at however many matches actually exist
        // if the team hasn't played that many games yet. Left as most-recent-first so
        // the chart's left-to-right x-axis reads latest match first.
        const chartMatches = streakSide.matches.slice(0, base.streak_count * 2);
        const chartData = {
            title: `${base.market.label} per match`,
            subtitle: `${streakTeamName} - last ${chartMatches.length} games`,
            avg: streakSide.season_avg,
            data: chartMatches.map(m => ({ date: formatChartDate(m.date), value: m.value }))
        };

        // Available bookmakers widget only needs "who to visit", not the price itself.
        const availableBookmakers = allOdds.map(({ value, ...rest }) => rest);

        return {
            streak_id: base.id,
            streak_count: base.streak_count,
            market: base.market,
            prediction: base.prediction,
            confidence: base.confidence,
            confidence_label: base.confidence_label,
            status: base.status,
            odds: base.odds,
            match: matchWithPositions,
            // Which side (home/away) this streak/prediction is actually about -
            // both teams are shown side by side, but only one of them is the
            // subject; the frontend needs this to highlight the right one.
            streak_side: isHomeStreak ? 'home' : 'away',
            home,
            away,
            chartData,
            availableBookmakers,
            similarStreaks,
            statistics,
            leagueStandings
        };
    }
};

module.exports = matchupService;
