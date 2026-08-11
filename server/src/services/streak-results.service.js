const { prisma } = require("../utils/prisma");

// Admin-only analytics over StreakResult (see streak-sync-scheduler.js's
// captureStreakResults - one row per streak that was shown as an upcoming
// prediction, written the moment its match finished). Every row already has
// a final result (hit/miss/push) by construction - there's no pending/void
// state here, since a row is never created until the match actually has a
// score. "push" is a real resolved outcome (a whole-number line landing
// exactly on the threshold - stake back, no win, no loss in betting terms),
// distinct from a miss - it's excluded from hit-rate/calibration math below
// since it's neither a win nor a loss.

const SORT_MAP = {
    date_desc: [{ match: { kickoff_at: 'desc' } }],
    date_asc: [{ match: { kickoff_at: 'asc' } }],
    streak_desc: [{ streak_count: 'desc' }],
    streak_asc: [{ streak_count: 'asc' }],
    confidence_desc: [{ confidence: 'desc' }],
    confidence_asc: [{ confidence: 'asc' }],
    odds_desc: [{ odds_value: 'desc' }],
    odds_asc: [{ odds_value: 'asc' }]
};

const CONFIDENCE_BANDS = [
    { label: '90-100%', min: 90, max: 101 },
    { label: '80-89%', min: 80, max: 90 },
    { label: '70-79%', min: 70, max: 80 },
    { label: '60-69%', min: 60, max: 70 },
    { label: '<60%', min: 0, max: 60 }
];

function buildWhere(filters) {
    const where = {};

    if (filters.outcome === 'hit' || filters.outcome === 'miss' || filters.outcome === 'push') {
        where.result = filters.outcome;
    }
    if (filters.confidence_min) {
        where.confidence = { gte: Number(filters.confidence_min) };
    }
    if (filters.streak_min) {
        where.streak_count = { gte: Number(filters.streak_min) };
    }
    if (filters.market) {
        where.market = { slug: filters.market };
    }

    const matchWhere = {};
    if (filters.league_id) {
        matchWhere.season = { league_id: Number(filters.league_id) };
    }
    if (filters.from || filters.to) {
        matchWhere.kickoff_at = {};
        if (filters.from) matchWhere.kickoff_at.gte = new Date(filters.from);
        if (filters.to) {
            // Inclusive of the whole "to" day, not just midnight.
            const end = new Date(filters.to);
            end.setHours(23, 59, 59, 999);
            matchWhere.kickoff_at.lte = end;
        }
    }
    if (filters.team_search) {
        matchWhere.OR = [
            { homeTeam: { name: { contains: filters.team_search, mode: 'insensitive' } } },
            { awayTeam: { name: { contains: filters.team_search, mode: 'insensitive' } } }
        ];
    }
    if (Object.keys(matchWhere).length > 0) {
        where.match = matchWhere;
    }

    return where;
}

// "Team goals: Over 1.5 (Santos)" vs "Total goals: Under 2.5" vs "BTTS: No" -
// team-scoped markets (slug starts with "team-") name whose side the number
// belongs to, since the other team in the fixture isn't what this row is
// about; total/match-level markets and the two binary ones don't need that.
function isTeamScopedSlug(slug) {
    return slug.startsWith('team-');
}

function formatPrediction(row) {
    const marketLabel = row.market.name;
    if (row.predicted_outcome) {
        return { market: marketLabel, prediction: row.predicted_outcome.toUpperCase() };
    }
    const dirLabel = row.direction === 'over' ? 'Over' : 'Under';
    const teamSuffix = isTeamScopedSlug(row.market.slug) ? ` (${row.team.name})` : '';
    return { market: marketLabel, prediction: `${dirLabel} ${row.threshold}${teamSuffix}` };
}

function serializeRow(row) {
    const { market: mkt, prediction } = formatPrediction(row);
    const binary = row.predicted_outcome != null;
    const actualOutcome = binary
        ? (Number(row.actual_value) === 1
            ? (row.market.slug === 'oddeven' ? 'odd' : 'yes')
            : (row.market.slug === 'oddeven' ? 'even' : 'no'))
        : null;

    return {
        id: row.id,
        match: {
            id: `match_${row.match.id}`,
            date: row.match.kickoff_at,
            league: row.match.season.league.name,
            matchday: row.match.matchday,
            home: { name: row.match.homeTeam.name, logo_url: row.match.homeTeam.logo_url },
            away: { name: row.match.awayTeam.name, logo_url: row.match.awayTeam.logo_url },
            score: row.match.home_score != null ? `${row.match.home_score}-${row.match.away_score}` : null
        },
        team: row.team.name,
        market: mkt,
        market_slug: row.market.slug,
        prediction,
        streak_count: row.streak_count,
        confidence: row.confidence != null ? Number(row.confidence) : null,
        actual: binary
            ? (row.market.slug === 'both-teams-score'
                ? `${actualOutcome.toUpperCase()} (${row.match.home_score}-${row.match.away_score})`
                : `${actualOutcome.toUpperCase()} (${row.match.home_score + row.match.away_score} goals)`)
            : `${row.actual_value} ${row.market.slug.includes('card') ? (Number(row.actual_value) === 1 ? 'card' : 'cards') : row.market.slug.includes('corner') ? 'corners' : (Number(row.actual_value) === 1 ? 'goal' : 'goals')}`,
        avg_value: row.avg_value != null ? Number(row.avg_value) : null,
        odds_value: row.odds_value != null ? Number(row.odds_value) : null,
        odds_bookmaker: row.odds_bookmaker,
        result: row.result
    };
}

const streakResultsService = {
    getStreakResults: async (filters) => {
        const where = buildWhere(filters);
        const page = Math.max(1, Number(filters.page) || 1);
        const perPage = Math.min(50, Number(filters.per_page) || 10);
        const orderBy = SORT_MAP[filters.sort] || SORT_MAP.date_desc;

        const include = {
            team: true,
            market: true,
            match: { include: { homeTeam: true, awayTeam: true, season: { include: { league: true } } } }
        };

        const [total, rows] = await Promise.all([
            prisma.streakResult.count({ where }),
            prisma.streakResult.findMany({ where, include, orderBy, skip: (page - 1) * perPage, take: perPage })
        ]);

        return {
            items: rows.map(serializeRow),
            meta: { page, per_page: perPage, total, total_pages: Math.max(1, Math.ceil(total / perPage)) }
        };
    },

    // KPIs + calibration + market-performance all read the same filtered set,
    // matching the admin mockup's "Filters applied to table and KPIs above" -
    // one call computes everything so the UI never has to reconcile 4
    // separately-filtered responses.
    getStreakResultsSummary: async (filters) => {
        const where = buildWhere(filters);

        const [settledCount, hitCount, pushCount, avgConfidence, longestStreak] = await Promise.all([
            prisma.streakResult.count({ where }),
            prisma.streakResult.count({ where: { ...where, result: 'hit' } }),
            prisma.streakResult.count({ where: { ...where, result: 'push' } }),
            prisma.streakResult.aggregate({ where, _avg: { confidence: true } }),
            prisma.streakResult.findFirst({
                where,
                orderBy: { streak_count: 'desc' },
                include: { team: true, market: true }
            })
        ]);

        // Pushes are neither a win nor a loss, so they come out of the
        // decided-outcomes denominator entirely rather than counting against
        // the hit rate the way a miss does.
        const decidedCount = settledCount - pushCount;
        const hitRate = decidedCount > 0 ? (hitCount / decidedCount) * 100 : 0;
        const predictedConfidence = avgConfidence._avg.confidence != null ? Number(avgConfidence._avg.confidence) : 0;

        const calibration = await Promise.all(CONFIDENCE_BANDS.map(async (band) => {
            const bandWhere = { ...where, confidence: { gte: band.min, lt: band.max } };
            const [count, hits, pushes, avgPredicted] = await Promise.all([
                prisma.streakResult.count({ where: bandWhere }),
                prisma.streakResult.count({ where: { ...bandWhere, result: 'hit' } }),
                prisma.streakResult.count({ where: { ...bandWhere, result: 'push' } }),
                prisma.streakResult.aggregate({ where: bandWhere, _avg: { confidence: true } })
            ]);
            const bandDecided = count - pushes;
            return {
                label: band.label,
                count,
                predicted: avgPredicted._avg.confidence != null ? Number(avgPredicted._avg.confidence) : null,
                actual: bandDecided > 0 ? (hits / bandDecided) * 100 : null
            };
        }));

        const marketTotals = await prisma.streakResult.groupBy({ by: ['market_id'], where, _count: true });
        const marketHits = await prisma.streakResult.groupBy({ by: ['market_id'], where: { ...where, result: 'hit' }, _count: true });
        const marketPushes = await prisma.streakResult.groupBy({ by: ['market_id'], where: { ...where, result: 'push' }, _count: true });
        const hitsByMarket = new Map(marketHits.map(m => [m.market_id, m._count]));
        const pushesByMarket = new Map(marketPushes.map(m => [m.market_id, m._count]));
        const marketRows = marketTotals.length
            ? await prisma.market.findMany({ where: { id: { in: marketTotals.map(m => m.market_id) } } })
            : [];
        const marketById = new Map(marketRows.map(m => [m.id, m]));

        const marketPerformance = marketTotals
            .map(m => {
                const decided = m._count - (pushesByMarket.get(m.market_id) ?? 0);
                return {
                    market: marketById.get(m.market_id)?.name ?? 'Unknown',
                    count: m._count,
                    hit_rate: decided > 0 ? ((hitsByMarket.get(m.market_id) ?? 0) / decided) * 100 : 0
                };
            })
            .sort((a, b) => b.hit_rate - a.hit_rate);

        return {
            settled_count: settledCount,
            push_count: pushCount,
            hit_rate: Math.round(hitRate * 10) / 10,
            predicted_confidence: Math.round(predictedConfidence * 10) / 10,
            calibration_gap: Math.round((hitRate - predictedConfidence) * 10) / 10,
            longest_streak: longestStreak ? {
                streak_count: longestStreak.streak_count,
                team: longestStreak.team.name,
                market: longestStreak.market.name
            } : null,
            calibration: calibration.map(c => ({
                ...c,
                predicted: c.predicted != null ? Math.round(c.predicted * 10) / 10 : null,
                actual: c.actual != null ? Math.round(c.actual * 10) / 10 : null
            })),
            market_performance: marketPerformance.map(m => ({ ...m, hit_rate: Math.round(m.hit_rate * 10) / 10 }))
        };
    }
};

module.exports = streakResultsService;
