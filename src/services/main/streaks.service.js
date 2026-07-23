const fs = require('fs');
const path = require('path');
const AppError = require("../../middlewares/AppError");
const { prisma } = require("../../utils/prisma");
const leaguesService = require("./leagues.service");
const teamsService = require("../teams.service");
const getFlag = leaguesService.getFlag;

// ─────────────────────────────────────────────────────────────────────────
// BOOKMAKER LOGOS (base64) - every bookmaker odd we return (home_win/away_win/
// recommended/all_odds) should carry its logo inline so the frontend never has
// to make a second request or guess a static path. Images live in
// public/media/<Bookmaker Name>.<ext> - the filename (including spaces) is an
// exact, case-insensitive match for Bookmaker.name, same convention already
// used by teams.service.js's getUpcomingMatches (which returns a relative URL
// instead - here we inline the actual bytes as a data: URI). Read once and
// memoized (mirrors getMarketIndex() below) since re-reading + re-encoding
// every image on every request would be wasteful disk/CPU work.
const MIME_BY_EXT = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml' };
let bookmakerLogoMap = null;
function getBookmakerLogoMap() {
    if (bookmakerLogoMap) return bookmakerLogoMap;
    bookmakerLogoMap = new Map();
    try {
        const mediaPath = path.join(__dirname, '../../../public/media');
        const mediaFiles = fs.readdirSync(mediaPath);
        mediaFiles.forEach(file => {
            const ext = path.extname(file).toLowerCase();
            const mime = MIME_BY_EXT[ext];
            if (!mime) return; // skip non-image files if any ever end up in the folder
            const key = path.parse(file).name.toLowerCase();
            const base64 = fs.readFileSync(path.join(mediaPath, file)).toString('base64');
            bookmakerLogoMap.set(key, `data:${mime};base64,${base64}`);
        });
    } catch (error) {
        console.error('⚠️ Error reading bookmaker media directory:', error);
    }
    return bookmakerLogoMap;
}
function getBookmakerLogo(name) {
    if (!name) return null;
    return getBookmakerLogoMap().get(name.toLowerCase()) || null;
}

// Raw odds-provider market slugs -> canonical TeamStreak/TeamSeasonAverage market
// slugs (e.g. MatchOdds for "team goals" is actually stored under 'total-home'/
// 'total-away', not 'team-goals'). Single source of truth lives in teams.service.js -
// duplicating it here would silently drift the moment that pipeline's mapping changes.
const SLUG_MAP = teamsService.SLUG_MAP;

// ─────────────────────────────────────────────────────────────────────────
// The AssuredBets spec (assuredbets-api-requirements.pdf) lists a market
// list for GET /streaks that does not match what this codebase actually
// tracks (it mixes in 1st/2nd-half goals and btts, which we never compute
// TeamStreak/TeamSeasonAverage rows for). Per explicit instruction, the
// canonical 8 markets already used everywhere else in the app (see
// STREAK_CHECK_SLUGS in teams.service.js) are the source of truth here.
// ─────────────────────────────────────────────────────────────────────────
const MARKET_MAP = {
    'team-goals': { key: 'team_goals', label: 'Team Goals' },
    'total-goals': { key: 'total_goals', label: 'Total Goals' },
    'team-yellow-cards': { key: 'team_yellow_cards', label: 'Team Yellow Cards' },
    'total-yellow-cards': { key: 'total_yellow_cards', label: 'Total Yellow Cards' },
    'team-red-cards': { key: 'team_red_cards', label: 'Team Red Cards' },
    'total-red-cards': { key: 'total_red_cards', label: 'Total Red Cards' },
    'team-corner-kicks': { key: 'team_corners', label: 'Team Corners' },
    'total-corner-kicks': { key: 'total_corners', label: 'Total Corners' }
};
const DB_MARKET_SLUGS = Object.keys(MARKET_MAP);
const PUBLIC_MARKET_KEYS = Object.values(MARKET_MAP).map(m => m.key);

// Derive canonical slug -> { home: rawSlug, away: rawSlug } from SLUG_MAP.
// Side-specific raw slugs (total-home/total-away, home-corners-overunder/
// away-corners-overunder) only apply to that one side of the match (the
// consistency issue documented in teams.service.js's getUpcomingMatches).
// Side-independent raw slugs (goals-overunder, team-yellow-cards, etc.) apply
// to both sides identically.
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
const RAW_MARKET_SLUGS = Object.keys(SLUG_MAP);

// Matches produced by the odds/pop pipelines carry raw API-Football status
// codes. This bucket mirrors the one already established client-side in
// render_stats.js (finished = FT/AET/PEN, live = 1H/2H/HT/ET).
const LIVE_STATUSES = ['1H', '2H', 'HT', 'ET'];
const SOON_WINDOW_MS = 2 * 60 * 60 * 1000; // PDF: status = "soon" if kickoff < 2h away

const DATE_RANGE_MS = {
    today: 24 * 60 * 60 * 1000,
    '2days': 2 * 24 * 60 * 60 * 1000,
    '7days': 7 * 24 * 60 * 60 * 1000,
    '30days': 30 * 24 * 60 * 60 * 1000
};
// Small backward grace window so a match that already kicked off (live) doesn't
// fall out of the "today" bucket just because its kickoff_at is technically in the past.
const LIVE_GRACE_MS = 6 * 60 * 60 * 1000;

// Candidate streaks are cheap to filter/sort/paginate in memory once assembled,
// so the expensive DB assembly is cached briefly and shared across /streaks and
// /streaks/summary (which accept the same filters and would otherwise redo the
// exact same joins twice per page load).
const RAW_CACHE_TTL_MS = 60 * 1000;
let rawCache = { data: null, ts: 0 };

// Market rows rarely change, so memoize them the same way leagues.service.js
// memoizes the country index. Need both the canonical markets (TeamStreak/
// TeamSeasonAverage live here) and the raw provider markets (MatchOdds lives here).
let marketIndexPromise = null;
async function getMarketIndex() {
    if (!marketIndexPromise) {
        marketIndexPromise = (async () => {
            const rows = await prisma.market.findMany({
                where: { slug: { in: [...DB_MARKET_SLUGS, ...RAW_MARKET_SLUGS, 'match-winner'] } }
            });
            const bySlug = new Map(rows.map(r => [r.slug, r]));
            const matchWinner = bySlug.get('match-winner');
            return {
                bySlug,
                matchWinnerId: matchWinner ? matchWinner.id : null,
                canonicalIds: DB_MARKET_SLUGS.map(s => bySlug.get(s)?.id).filter(Boolean),
                rawIds: RAW_MARKET_SLUGS.map(s => bySlug.get(s)?.id).filter(Boolean)
            };
        })().catch((err) => {
            marketIndexPromise = null;
            throw err;
        });
    }
    return marketIndexPromise;
}

// Given a canonical market slug (e.g. 'team-goals') and which side of the match
// the team is on, resolve the raw Market id that MatchOdds actually lives under.
function resolveRawMarketId(bySlug, canonicalSlug, isHome) {
    const sides = CANONICAL_TO_RAW[canonicalSlug];
    if (!sides) return null;
    const rawSlug = isHome ? sides.home : sides.away;
    const row = rawSlug ? bySlug.get(rawSlug) : null;
    return row ? row.id : null;
}

function abbreviate(name) {
    if (!name) return '';
    const words = name.split(/\s+/).filter(Boolean);
    if (words.length >= 2) {
        return words.slice(0, 3).map(w => w[0]).join('').toUpperCase();
    }
    return name.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase();
}

function formatDateDisplay(date) {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const day = date.getUTCDate();
    const month = months[date.getUTCMonth()];
    const hh = String(date.getUTCHours()).padStart(2, '0');
    const mm = String(date.getUTCMinutes()).padStart(2, '0');
    return `${day} ${month} · ${hh}:${mm}`;
}

function deriveStatus(match) {
    if (LIVE_STATUSES.includes(match.status)) return 'live';
    const diff = match.kickoff_at.getTime() - Date.now();
    if (diff < SOON_WINDOW_MS) return 'soon';
    return 'upcoming';
}

function confidenceLabel(confidence) {
    if (confidence >= 80) return 'High';
    if (confidence >= 60) return 'Good';
    return 'Moderate';
}

function pickBestOdd(matchOdds, marketId, selectionSlug) {
    if (!marketId) return null;
    const matches = matchOdds.filter(o => o.market.id === marketId && o.slug === selectionSlug);
    if (!matches.length) return null;
    matches.sort((a, b) => Number(b.odd) - Number(a.odd));
    const best = matches[0];
    const name = best.bookmaker?.name || 'unknown';
    return {
        value: Number(best.odd),
        bookmaker: name.toLowerCase().replace(/\s+/g, ''),
        bookmaker_label: name.toUpperCase(),
        bookmaker_logo: getBookmakerLogo(name),
        affiliate_url: best.bookmaker?.affiliate_link || null
    };
}

function isWithinDateRange(kickoffAt, range) {
    const windowMs = DATE_RANGE_MS[range];
    if (!windowMs) return true;
    const now = Date.now();
    const kickoff = kickoffAt.getTime();
    return kickoff >= (now - LIVE_GRACE_MS) && kickoff <= (now + windowMs);
}

// Builds the full (unfiltered) candidate list: every TeamStreak (streak_length >= 3,
// current season, one of the 8 canonical markets) that has a resolvable upcoming/live
// match, with match/odds/league data already joined in. Deliberately batches every
// DB call (no per-streak queries) - the exact N+1 pattern that caused the
// GET /api/admin/leagues slowdown fixed earlier in this codebase.
async function buildRawCandidates() {
    const { bySlug, matchWinnerId, canonicalIds, rawIds } = await getMarketIndex();

    const teamStreaks = await prisma.teamStreak.findMany({
        where: {
            streak_length: { gte: 3 },
            market_id: { in: canonicalIds },
            season: { is_current: true }
        },
        include: {
            market: { select: { id: true, slug: true } },
            season: { select: { id: true, league: { select: { id: true, name: true, country: true } } } }
        }
    });

    if (!teamStreaks.length) return [];

    const teamIds = [...new Set(teamStreaks.map(s => s.team_id))];
    const seasonIds = [...new Set(teamStreaks.map(s => s.season_id))];

    const [matches, averages] = await Promise.all([
        prisma.match.findMany({
            where: {
                season_id: { in: seasonIds },
                kickoff_at: { not: null },
                AND: [
                    { OR: [{ home_team_id: { in: teamIds } }, { away_team_id: { in: teamIds } }] },
                    {
                        // Live matches are allowed regardless of kickoff time (it's necessarily
                        // in the past once a match has started). NS/PST matches, however, must
                        // still be in the future - otherwise a fixture that's stuck at NS/PST
                        // (never resolved to FT, e.g. postponed) would leak through as a stale
                        // "candidate" and get mislabeled status "soon" by deriveStatus().
                        OR: [
                            { status: { in: LIVE_STATUSES } },
                            { status: { in: ['NS', 'PST'] }, kickoff_at: { gte: new Date() } }
                        ]
                    }
                ]
            },
            include: {
                homeTeam: { select: { id: true, name: true, short_name: true, logo_url: true } },
                awayTeam: { select: { id: true, name: true, short_name: true, logo_url: true } },
                matchOdds: {
                    where: {
                        // MatchOdds lives under the RAW provider market slugs (e.g. 'total-home',
                        // 'goals-overunder'), not the canonical TeamStreak/TeamSeasonAverage slugs -
                        // see SLUG_MAP in teams.service.js. match-winner is a separate market either way.
                        market_id: { in: [...rawIds, matchWinnerId].filter(Boolean) },
                        bookmaker: { is_active: true }
                    },
                    select: {
                        market: { select: { id: true } },
                        slug: true,
                        odd: true,
                        bookmaker: { select: { id: true, name: true, affiliate_link: true } }
                    }
                }
            },
            orderBy: { kickoff_at: 'asc' }
        }),
        prisma.teamSeasonAverage.findMany({
            where: {
                team_id: { in: teamIds },
                market_id: { in: canonicalIds },
                season_id: { in: seasonIds }
            },
            select: { team_id: true, market_id: true, season_id: true, avg_value: true }
        })
    ]);

    // Earliest (live matches sort first since their kickoff_at is already in the past)
    // match per team+season - mirrors the "next match per team" logic in
    // teams.service.js's getUpcomingMatches.
    const matchByTeamSeason = new Map();
    for (const match of matches) {
        const homeKey = `${match.home_team_id}-${match.season_id}`;
        const awayKey = `${match.away_team_id}-${match.season_id}`;
        if (!matchByTeamSeason.has(homeKey)) matchByTeamSeason.set(homeKey, match);
        if (!matchByTeamSeason.has(awayKey)) matchByTeamSeason.set(awayKey, match);
    }

    const averageMap = new Map();
    averages.forEach(a => {
        averageMap.set(`${a.team_id}-${a.market_id}-${a.season_id}`, Number(a.avg_value));
    });

    // Pre-warm flag lookups per distinct country so the loop below never awaits a
    // cold network fetch - getFlag's underlying dataset call is memoized after the first hit.
    const uniqueCountries = [...new Set(teamStreaks.map(s => s.season.league.country).filter(Boolean))];
    const flagMap = new Map();
    for (const country of uniqueCountries) {
        flagMap.set(country, await getFlag(country));
    }

    const candidates = [];

    for (const ts of teamStreaks) {
        const match = matchByTeamSeason.get(`${ts.team_id}-${ts.season_id}`);
        if (!match) continue; // team has no live/upcoming match this season right now

        const marketMeta = MARKET_MAP[ts.market.slug];
        if (!marketMeta) continue;

        const avgValue = averageMap.get(`${ts.team_id}-${ts.market_id}-${ts.season_id}`) ?? 0;
        const threshold = (avgValue % 1 === 0) ? avgValue : Math.floor(avgValue) + 0.5;
        const direction = ts.streak_direction === 'below' ? 'over' : 'under';
        const confidence = Math.round(Number(ts.confidence) || 0);
        const isHome = match.home_team_id === ts.team_id;
        const teamRow = isHome ? match.homeTeam : match.awayTeam;
        const status = deriveStatus(match);
        const league = ts.season.league;
        const avgRounded = Math.round(avgValue * 100) / 100;

        const homeWin = pickBestOdd(match.matchOdds, matchWinnerId, 'home');
        const awayWin = pickBestOdd(match.matchOdds, matchWinnerId, 'away');
        const rawMarketId = resolveRawMarketId(bySlug, ts.market.slug, isHome);
        const recommended = pickBestOdd(match.matchOdds, rawMarketId, `${direction}-${threshold}`);

        candidates.push({
            id: `streak_${ts.id}`,
            streak_count: ts.streak_length,
            market: { key: marketMeta.key, label: marketMeta.label },
            prediction: {
                text: `${teamRow.name} ${marketMeta.label} ${direction} ${threshold}`,
                threshold,
                direction,
                average: avgRounded,
                description: `In the last ${ts.streak_length} matches, ${marketMeta.label.toLowerCase()} of ${teamRow.name} were ${ts.streak_direction} average of ${avgRounded}.`
            },
            confidence,
            confidence_label: confidenceLabel(confidence),
            status,
            match: {
                id: `match_${match.id}`,
                date: match.kickoff_at.toISOString(),
                date_display: formatDateDisplay(match.kickoff_at),
                league: { id: league.id, name: league.name, country: league.country, flag: flagMap.get(league.country) || null },
                home: {
                    id: `team_${match.homeTeam.id}`,
                    name: match.homeTeam.name,
                    short: match.homeTeam.short_name || abbreviate(match.homeTeam.name),
                    logo_url: match.homeTeam.logo_url
                },
                away: {
                    id: `team_${match.awayTeam.id}`,
                    name: match.awayTeam.name,
                    short: match.awayTeam.short_name || abbreviate(match.awayTeam.name),
                    logo_url: match.awayTeam.logo_url
                }
            },
            odds: { home_win: homeWin, away_win: awayWin, recommended },
            // internal-only bookkeeping, stripped by stripInternal() before leaving the service
            _kickoffAt: match.kickoff_at,
            _teamStreakId: ts.id,
            _teamId: ts.team_id,
            _marketId: ts.market_id,
            _rawMarketId: rawMarketId,
            _matchId: match.id
        });
    }

    return candidates;
}

async function getRawCandidates() {
    const now = Date.now();
    if (rawCache.data && (now - rawCache.ts) < RAW_CACHE_TTL_MS) {
        return rawCache.data;
    }
    const data = await buildRawCandidates();
    rawCache = { data, ts: now };
    return data;
}

function stripInternal(item) {
    const { _kickoffAt, _teamStreakId, _teamId, _marketId, _rawMarketId, _matchId, ...rest } = item;
    return rest;
}

function toArrayParam(val) {
    if (val === undefined || val === null || val === '') return undefined;
    const arr = Array.isArray(val) ? val : [val];
    const flat = arr.flatMap(v => String(v).split(',')).map(v => v.trim()).filter(Boolean);
    return flat.length ? flat : undefined;
}

function toNumParam(val) {
    if (val === undefined || val === null || val === '') return undefined;
    const num = Number(val);
    return Number.isNaN(num) ? undefined : num;
}

function parseFilters(query) {
    const filters = {
        streak_min: toNumParam(query.streak_min),
        streak_max: toNumParam(query.streak_max),
        confidence_min: toNumParam(query.confidence_min),
        odds_min: toNumParam(query.odds_min),
        odds_max: toNumParam(query.odds_max),
        markets: toArrayParam(query.markets),
        leagues: toArrayParam(query.leagues)?.map(Number).filter(n => !Number.isNaN(n)),
        status: toArrayParam(query.status),
        date_range: DATE_RANGE_MS[query.date_range] ? query.date_range : undefined
    };

    if (filters.markets) {
        filters.markets = filters.markets.filter(m => PUBLIC_MARKET_KEYS.includes(m));
        if (!filters.markets.length) filters.markets = undefined;
    }
    if (filters.status) {
        filters.status = filters.status.filter(s => ['live', 'soon', 'upcoming'].includes(s));
        if (!filters.status.length) filters.status = undefined;
    }
    if (filters.leagues && !filters.leagues.length) filters.leagues = undefined;

    return filters;
}

function buildFiltersApplied(filters) {
    const applied = {};
    for (const k of ['streak_min', 'streak_max', 'confidence_min', 'odds_min', 'odds_max', 'markets', 'leagues', 'status', 'date_range']) {
        if (filters[k] !== undefined) applied[k] = filters[k];
    }
    return applied;
}

function matchesFilters(item, filters, opts = {}) {
    if (filters.streak_min !== undefined && item.streak_count < filters.streak_min) return false;
    if (filters.streak_max !== undefined && item.streak_count > filters.streak_max) return false;
    if (filters.confidence_min !== undefined && item.confidence < filters.confidence_min) return false;
    if (filters.odds_min !== undefined && (!item.odds.recommended || item.odds.recommended.value < filters.odds_min)) return false;
    if (filters.odds_max !== undefined && (!item.odds.recommended || item.odds.recommended.value > filters.odds_max)) return false;
    if (!opts.skipMarket && filters.markets && !filters.markets.includes(item.market.key)) return false;
    if (filters.leagues && !filters.leagues.includes(item.match.league.id)) return false;
    if (filters.status && !filters.status.includes(item.status)) return false;
    if (!opts.skipDateRange && filters.date_range && !isWithinDateRange(item._kickoffAt, filters.date_range)) return false;
    return true;
}

// Naming rule (so the frontend never has to guess): every key except 'top' is
// literally "<field>_<direction>" - the field being sorted, then "asc"
// (lowest/soonest first) or "desc" (highest/latest first). No bare
// direction-less names, no words like "soon" that silently imply a direction
// without stating one - e.g. odds_desc (NOT "odds") = highest odds first,
// odds_asc = lowest odds first. 'top' is the one deliberate exception: it's a
// named composite ranking (confidence, then streak_count, both descending),
// not a single field, so it keeps its own name; 'top_asc' is simply that same
// ranking reversed (weakest first).
const SORT_OPTIONS = ['top', 'top_asc', 'confidence_desc', 'confidence_asc', 'odds_desc', 'odds_asc', 'kickoff_asc', 'kickoff_desc'];

function sortCandidates(list, sort) {
    const sorted = [...list];
    switch (sort) {
        case 'confidence_desc':
            sorted.sort((a, b) => b.confidence - a.confidence); // highest confidence first
            break;
        case 'confidence_asc':
            sorted.sort((a, b) => a.confidence - b.confidence); // lowest confidence first
            break;
        case 'odds_desc':
            sorted.sort((a, b) => (b.odds.recommended?.value ?? 0) - (a.odds.recommended?.value ?? 0)); // highest odds first
            break;
        case 'odds_asc':
            sorted.sort((a, b) => (a.odds.recommended?.value ?? 0) - (b.odds.recommended?.value ?? 0)); // lowest odds first
            break;
        case 'kickoff_asc':
            sorted.sort((a, b) => a._kickoffAt - b._kickoffAt); // soonest match first
            break;
        case 'kickoff_desc':
            sorted.sort((a, b) => b._kickoffAt - a._kickoffAt); // latest (furthest-out) match first
            break;
        case 'top_asc':
            sorted.sort((a, b) => (a.confidence - b.confidence) || (a.streak_count - b.streak_count)); // weakest overall first
            break;
        case 'top':
        default:
            sorted.sort((a, b) => (b.confidence - a.confidence) || (b.streak_count - a.streak_count)); // strongest overall first
    }
    return sorted;
}

const streaksService = {
    listStreaks: async (query = {}) => {

        const filters = parseFilters(query);
        const page = Math.max(1, parseInt(query.page, 10) || 1);
        const perPage = Math.min(50, Math.max(1, parseInt(query.per_page, 10) || 10));
        const sort = SORT_OPTIONS.includes(query.sort) ? query.sort : 'top';

        const raw = await getRawCandidates();
        const filtered = raw.filter(item => matchesFilters(item, filters));
        const sorted = sortCandidates(filtered, sort);

        const total = sorted.length;
        const totalPages = Math.max(1, Math.ceil(total / perPage));
        const start = (page - 1) * perPage;
        const pageItems = sorted.slice(start, start + perPage);

        return {
            meta: {
                total,
                page,
                per_page: perPage,
                total_pages: totalPages,
                sort,
                filters_applied: buildFiltersApplied(filters)
            },
            data: pageItems.map(stripInternal)
        };
    },

    getSummary: async (query = {}) => {
        const filters = parseFilters(query);
        const raw = await getRawCandidates();
        const filtered = raw.filter(item => matchesFilters(item, filters));

        const total = filtered.length;
        const live = filtered.filter(i => i.status === 'live').length;
        const avgConfidence = total
            ? Math.round((filtered.reduce((s, i) => s + i.confidence, 0) / total) * 10) / 10
            : 0;
        const highConfidenceCount = filtered.filter(i => i.confidence_label === 'High').length;

        // Facet counts each exclude their own filter dimension (standard facet-count
        // pattern), so picking a market doesn't zero out every other market's badge.
        const byMarket = {};
        for (const key of PUBLIC_MARKET_KEYS) {
            byMarket[key] = raw.filter(item =>
                matchesFilters(item, filters, { skipMarket: true }) && item.market.key === key
            ).length;
        }

        const byDate = {};
        for (const range of Object.keys(DATE_RANGE_MS)) {
            byDate[range] = raw.filter(item =>
                matchesFilters(item, filters, { skipDateRange: true }) && isWithinDateRange(item._kickoffAt, range)
            ).length;
        }

        return {
            total,
            live,
            avg_confidence: avgConfidence,
            high_confidence_count: highConfidenceCount,
            by_market: byMarket,
            by_date: byDate
        };
    },

    // Shared by getStreakById and matchup.service.js - both need to resolve a
    // "streak_<id>" string down to its underlying candidate (with the internal
    // _teamId/_marketId/_matchId bookkeeping still attached, unlike the public
    // Streak shape). Keeping this in one place means both endpoints agree on
    // what "streak not found" means and share the same 60s candidate cache.
    resolveCandidateByStreakId: async (id) => {
        const parsed = /^streak_(\d+)$/.exec(id || '');
        if (!parsed) {
            throw new AppError('Invalid streak id', 400);
        }
        const teamStreakId = Number(parsed[1]);

        const raw = await getRawCandidates();
        const base = raw.find(item => item._teamStreakId === teamStreakId);
        if (!base) {
            throw new AppError('Streak not found', 404);
        }
        return base;
    },

    getStreakById: async (id) => {
        const base = await streaksService.resolveCandidateByStreakId(id);

        const direction = base.prediction.direction;
        const threshold = base.prediction.threshold;
        const historyLimit = Math.min(Math.max(base.streak_count, 3), 20);

        const statRows = await prisma.matchTeamStat.findMany({
            where: {
                team_id: base._teamId,
                market_id: base._marketId,
                // Only actually-played matches - the pipeline also creates MatchTeamStat
                // rows ahead of time for not-yet-played fixtures, which would otherwise
                // surface as bogus zero-value "history" entries dated in the future.
                match: { status: { in: ['FT', 'AET', 'PEN'] } }
            },
            orderBy: { match: { kickoff_at: 'desc' } },
            take: historyLimit,
            select: {
                value: true,
                match: { select: { id: true, kickoff_at: true } }
            }
        });

        const history = statRows
            .filter(row => row.match?.kickoff_at)
            .map(row => {
                const value = Number(row.value);
                const isHit = direction === 'over' ? value > threshold : value < threshold;
                return {
                    match_id: `match_${row.match.id}`,
                    date: row.match.kickoff_at.toISOString().slice(0, 10),
                    result: isHit ? 'hit' : 'miss',
                    value
                };
            })
            .reverse(); // oldest -> newest, matching the PDF's chronological dot-trail example

        const sampleSize = history.length;
        const hits = history.filter(h => h.result === 'hit').length;
        const hitRate = sampleSize ? Math.round((hits / sampleSize) * 100) / 100 : 0;

        let stdDeviation = 0;
        if (sampleSize > 1) {
            const values = history.map(h => h.value);
            const mean = values.reduce((s, v) => s + v, 0) / values.length;
            const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1);
            stdDeviation = Math.round(Math.sqrt(variance) * 100) / 100;
        }

        // base._rawMarketId can be null (e.g. no raw provider slug resolves for this
        // canonical market/side combo yet) - Prisma throws PrismaClientValidationError
        // on a bare `null` equality filter, so skip the query entirely in that case
        // rather than passing null through.
        const matchRow = base._rawMarketId
            ? await prisma.match.findUnique({
                where: { id: base._matchId },
                select: {
                    matchOdds: {
                        where: {
                            // See buildRawCandidates(): MatchOdds is keyed by the raw
                            // provider market id, not the canonical one.
                            market_id: base._rawMarketId,
                            slug: `${direction}-${threshold}`,
                            bookmaker: { is_active: true }
                        },
                        select: {
                            odd: true,
                            bookmaker: { select: { name: true, affiliate_link: true } }
                        }
                    }
                }
            })
            : null;

        const allOdds = (matchRow?.matchOdds || [])
            .map(o => {
                const name = o.bookmaker?.name || 'unknown';
                return {
                    bookmaker: name.toLowerCase().replace(/\s+/g, ''),
                    bookmaker_label: name.toUpperCase(),
                    bookmaker_logo: getBookmakerLogo(name),
                    value: Number(o.odd),
                    affiliate_url: o.bookmaker?.affiliate_link || null
                };
            })
            .sort((a, b) => b.value - a.value);

        return {
            ...stripInternal(base),
            sample_size: sampleSize,
            hit_rate: hitRate,
            std_deviation: stdDeviation,
            history,
            all_odds: allOdds
        };
    }
};

module.exports = streaksService;
