// ─────────────────────────────────────────────────────────────────────────
// One-off backfill: reconstructs StreakResult rows for matches that already
// finished in the last N days, using the average/streak state as it
// genuinely stood AT THAT TIME - not today's current average/streak - so
// the reproduced prediction (direction, threshold, streak length, odds) is
// what would actually have been shown to a user back then.
//
// Not wired to run automatically - require()'d and called (commented out by
// default) from server.js, same toggle-via-comment convention as every
// other pipeline. Uncomment, restart the server once to run it, then
// re-comment.
//
// Safe to re-run: existing StreakResult rows are never touched, only
// (match, team, market) combos that don't already have one get inserted.
// The final write is one createMany inside a single transaction, so a
// failure partway through never leaves a partial backfill.
//
// How the point-in-time average/streak is derived (mirrors the live
// pop-db.js / streak-tracker.js formulas exactly, just date-bounded):
//   - avg_value  = mean of that team's MatchTeamStat value in that market,
//                  across every finished match strictly BEFORE the one
//                  being graded (same arithmetic-mean formula
//                  generateSeasonAverages uses, just excluding matches from
//                  the target match onward instead of using all of them).
//   - streak     = starting from the match immediately before the target
//                  match and walking backward, count consecutive matches on
//                  the same side (above/below that point-in-time average)
//                  as calculateLeagueStreaks does - just against the
//                  point-in-time average instead of today's.
//   - odds       = whatever is currently stored in MatchOdds for that
//                  match. Odds are never touched again once a match
//                  finishes (the odds pipeline only targets NS/PST
//                  matches), so what's there is already frozen at
//                  effectively "last known before kickoff" - genuinely
//                  historical, not today's odds.
// ─────────────────────────────────────────────────────────────────────────

const { prisma } = require('./src/utils/prisma');
const { SLUG_MAP } = require('./src/services/teams.service');

const FINISHED_STATUSES = ['FT', 'AET', 'PEN'];
const LOOKBACK_DAYS = 30;

const STREAK_ELIGIBLE_MARKET_SLUGS = [
    'team-goals', 'total-goals', 'team-yellow-cards', 'total-yellow-cards',
    'team-red-cards', 'total-red-cards', 'team-corner-kicks', 'total-corner-kicks',
    'total-goals-1st-half', 'total-goals-2nd-half', 'oddeven', 'both-teams-score'
];

const BINARY_MARKET_OUTCOMES = {
    oddeven: { positive: 'odd', negative: 'even' },
    'both-teams-score': { positive: 'yes', negative: 'no' }
};

const CANONICAL_TO_RAW = {};
for (const [rawSlug, canonicalSlug] of Object.entries(SLUG_MAP)) {
    if (!CANONICAL_TO_RAW[canonicalSlug]) CANONICAL_TO_RAW[canonicalSlug] = {};
    if (rawSlug.includes('away')) {
        CANONICAL_TO_RAW[canonicalSlug].away = rawSlug;
    } else if (rawSlug.includes('home')) {
        CANONICAL_TO_RAW[canonicalSlug].home = rawSlug;
    } else {
        CANONICAL_TO_RAW[canonicalSlug].home = rawSlug;
        CANONICAL_TO_RAW[canonicalSlug].away = rawSlug;
    }
}

// Same formulas as streak-tracker.js's calculateLeagueStreaks, so a
// backfilled row and a live-graded row are computed identically.
function suggestedThreshold(avg) {
    return (avg % 1 === 0) ? avg : Math.floor(avg) + 0.5;
}

function calcStreakConfidence(n, avg, threshold) {
    if (!n || n <= 0 || !threshold || threshold <= 0) return 0;
    const S = 1 - Math.exp(-n / 5);
    const A = Math.max(0, 1 - Math.abs(threshold - avg) / threshold);
    return 100 * Math.pow(S, 0.6) * Math.pow(A, 0.4);
}

async function backfillStreakResults(daysBack = LOOKBACK_DAYS) {
    console.log(`[backfill] Starting StreakResult backfill for the last ${daysBack} day(s)...`);

    const targetMarkets = await prisma.market.findMany({ where: { slug: { in: STREAK_ELIGIBLE_MARKET_SLUGS } } });
    const targetMarketIds = targetMarkets.map(m => m.id);

    const cutoff = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);

    const targetMatches = await prisma.match.findMany({
        where: { status: { in: FINISHED_STATUSES }, kickoff_at: { gte: cutoff } },
        include: { homeTeam: true, awayTeam: true, season: { include: { league: true } } },
        orderBy: { kickoff_at: 'asc' }
    });
    console.log(`[backfill] Found ${targetMatches.length} finished match(es) in the last ${daysBack} day(s).`);
    if (targetMatches.length === 0) {
        console.log('[backfill] Nothing to do.');
        return;
    }

    const seasonIds = [...new Set(targetMatches.map(m => m.season_id))];

    // Every finished match's stat, for every team, in the streak-eligible
    // markets, across the WHOLE season (not just the lookback window) - a
    // match 3 days ago needs its team's full season-to-date history before
    // it, which usually reaches back further than `daysBack`.
    console.log(`[backfill] Loading full season stat history for ${seasonIds.length} season(s)...`);
    const allStats = await prisma.matchTeamStat.findMany({
        where: {
            market_id: { in: targetMarketIds },
            match: { season_id: { in: seasonIds }, status: { in: FINISHED_STATUSES } }
        },
        include: { match: { select: { id: true, kickoff_at: true } } }
    });

    const statsByTeamMarket = new Map();
    for (const s of allStats) {
        const key = `${s.team_id}-${s.market_id}`;
        if (!statsByTeamMarket.has(key)) statsByTeamMarket.set(key, []);
        statsByTeamMarket.get(key).push({ value: Number(s.value), kickoff_at: s.match.kickoff_at, match_id: s.match_id });
    }
    for (const arr of statsByTeamMarket.values()) arr.sort((a, b) => a.kickoff_at - b.kickoff_at);

    const matchIds = targetMatches.map(m => m.id);

    const existing = await prisma.streakResult.findMany({
        where: { match_id: { in: matchIds } },
        select: { match_id: true, team_id: true, market_id: true }
    });
    const existingKeys = new Set(existing.map(e => `${e.match_id}-${e.team_id}-${e.market_id}`));

    const allOdds = await prisma.matchOdds.findMany({
        where: { match_id: { in: matchIds } },
        include: { bookmaker: true }
    });
    const oddsByMatch = new Map();
    for (const o of allOdds) {
        if (!oddsByMatch.has(o.match_id)) oddsByMatch.set(o.match_id, []);
        oddsByMatch.get(o.match_id).push(o);
    }

    const rawMarkets = await prisma.market.findMany({ where: { slug: { in: Object.keys(SLUG_MAP) } } });
    const rawMarketBySlug = new Map(rawMarkets.map(m => [m.slug, m.id]));

    const records = [];
    let skippedDup = 0, skippedNoHistory = 0, skippedBelowThreshold = 0;

    for (const match of targetMatches) {
        const sides = [
            { team: match.homeTeam, isHome: true },
            { team: match.awayTeam, isHome: false }
        ];

        for (const { team, isHome } of sides) {
            for (const market of targetMarkets) {
                const key = `${team.id}-${market.id}`;
                const history = statsByTeamMarket.get(key) || [];
                const priorEntries = history.filter(h => h.kickoff_at < match.kickoff_at);

                if (priorEntries.length === 0) {
                    skippedNoHistory++;
                    continue;
                }

                const avgValue = priorEntries.reduce((sum, e) => sum + e.value, 0) / priorEntries.length;
                const mostRecent = priorEntries[priorEntries.length - 1];
                const pointInTimeDirection = mostRecent.value > avgValue ? 'above' : 'below';

                let streakLength = 0;
                for (let i = priorEntries.length - 1; i >= 0; i--) {
                    const v = priorEntries[i].value;
                    const isAbove = v > avgValue;
                    const isBelow = v < avgValue;
                    if ((pointInTimeDirection === 'above' && isAbove) || (pointInTimeDirection === 'below' && isBelow)) {
                        streakLength++;
                    } else {
                        break;
                    }
                }

                if (streakLength < 3) {
                    skippedBelowThreshold++;
                    continue;
                }

                const dedupeKey = `${match.id}-${team.id}-${market.id}`;
                if (existingKeys.has(dedupeKey)) {
                    skippedDup++;
                    continue;
                }

                const actualEntry = history.find(h => h.match_id === match.id);
                if (!actualEntry) continue; // this match's own stat row is missing - can't grade it
                const actualValue = actualEntry.value;

                const threshold = suggestedThreshold(avgValue);
                const confidence = calcStreakConfidence(streakLength, avgValue, threshold);
                const direction = pointInTimeDirection === 'below' ? 'over' : 'under';
                const binary = BINARY_MARKET_OUTCOMES[market.slug];

                let predictedOutcome = null;
                let result;
                if (binary) {
                    predictedOutcome = pointInTimeDirection === 'below' ? binary.positive : binary.negative;
                    const actualOutcome = actualValue === 1 ? binary.positive : binary.negative;
                    result = actualOutcome === predictedOutcome ? 'hit' : 'miss';
                } else {
                    result = direction === 'over' ? (actualValue > threshold ? 'hit' : 'miss') : (actualValue < threshold ? 'hit' : 'miss');
                }

                const side = isHome ? 'home' : 'away';
                const rawSlug = CANONICAL_TO_RAW[market.slug]?.[side];
                const rawMarketId = rawSlug ? rawMarketBySlug.get(rawSlug) : null;
                const selectionSlug = binary ? predictedOutcome : `${direction}-${threshold}`;
                const matchOddsRows = oddsByMatch.get(match.id) || [];
                const oddRow = rawMarketId
                    ? matchOddsRows.filter(o => o.market_id === rawMarketId && o.slug === selectionSlug).sort((a, b) => Number(b.odd) - Number(a.odd))[0]
                    : null;

                records.push({
                    match_id: match.id,
                    team_id: team.id,
                    market_id: market.id,
                    streak_count: streakLength,
                    confidence,
                    direction,
                    threshold: binary ? null : threshold,
                    predicted_outcome: predictedOutcome,
                    avg_value: avgValue,
                    odds_value: oddRow ? Number(oddRow.odd) : null,
                    odds_bookmaker: oddRow?.bookmaker?.name ?? null,
                    actual_value: actualValue,
                    result
                });
            }
        }
    }

    console.log(`[backfill] Reconstructed ${records.length} eligible streak result(s). Skipped: ${skippedDup} already recorded, ${skippedNoHistory} no prior history, ${skippedBelowThreshold} streak <3.`);

    if (records.length === 0) {
        console.log('[backfill] Nothing new to write.');
        return;
    }

    await prisma.$transaction(async (tx) => {
        await tx.streakResult.createMany({ data: records });
    }, { timeout: 60000 });

    console.log(`[backfill] Done - wrote ${records.length} StreakResult row(s).`);
}

module.exports = { backfillStreakResults };
