const { default: axios } = require('axios');
const { prisma } = require('./src/utils/prisma');
const { SLUG_MAP } = require('./src/services/teams.service');

// Raw odds-provider market slugs we actually track (the keys of SLUG_MAP -
// same mapping used everywhere else this codebase resolves canonical <->
// raw market slugs). The API returns dozens of bet types per bookmaker
// (Match Winner, Correct Score, Asian Handicap, etc.) that we never use -
// skipping them before any DB write is the single biggest speedup here,
// since writing every irrelevant selection was most of the total volume.
const TRACKED_RAW_SLUGS = new Set(Object.keys(SLUG_MAP));

function chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
        chunks.push(array.slice(i, i + size));
    }
    return chunks;
}

// 1. Helper for Market Names (NO DOTS)
function formatMarketSlug(value) {
    if (!value) return '';
    return value
        .toString()
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9\s-]/g, '') // Strips everything except alphanumeric/space/hyphen
        .replace(/[\s_]+/g, '-')
        .replace(/-+/g, '-');
}

// 2. Helper for Selection Values (DOTS ALLOWED)
function formatSelectionSlug(value) {
    if (!value) return '';
    return value
        .toString()
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9.\s-]/g, '') // Allows '.', alphanumeric, space, hyphen
        .replace(/[\s_]+/g, '-')
        .replace(/-+/g, '-');
}

async function syncTargetedOdds(targetLeagues) {
    try {
        console.log("⏰ [Odds Pipeline] Scanning for odds updates...");

        const now = new Date();

        const leagueConditions = targetLeagues.map(([leagueId, year]) => ({
            season: {
                year: String(year),
                league: { id_api: String(leagueId) }
            }
        }));

        const upcomingMatches = await prisma.match.findMany({
            where: {
                status: { in: ['NS', 'PST'] },
                kickoff_at: { gte: now },
                OR: leagueConditions
            },
            include: {
                season: { include: { league: true } }
            }
        });

        if (upcomingMatches.length === 0) {
            console.log("ℹ️ [Odds Pipeline] No upcoming unstarted matches found.");
            return;
        }

        // 1. Load Caches for Markets and Bookmakers
        const dbMarkets = await prisma.market.findMany();
        const marketLookupBySlug = {};
        dbMarkets.forEach(m => { marketLookupBySlug[m.slug] = m.id; });

        const dbBookmakers = await prisma.bookmaker.findMany();
        const bookmakerLookupByName = {};
        dbBookmakers.forEach(b => { bookmakerLookupByName[b.name] = b.id; });

        const activeTasks = new Map();
        upcomingMatches.forEach((match) => {
            const leagueApiId = match.season.league.id_api;
            const seasonYear = match.season.year;
            const key = `${leagueApiId}-${seasonYear}`;
            if (!activeTasks.has(key)) {
                activeTasks.set(key, { leagueApiId, seasonYear });
            }
        });

        let totalUpserts = 0;
        let totalSkipped = 0;

        for (const [key, task] of activeTasks.entries()) {
            let currentPage = 1;
            let totalPages = 1;

            do {
                console.log(`📡 Fetching API odds for League ${task.leagueApiId} (Season: ${task.seasonYear}) - Page ${currentPage}...`);

                const response = await axios.get('https://v3.football.api-sports.io/odds', {
                    params: { league: task.leagueApiId, season: task.seasonYear, page: currentPage },
                    headers: { 'x-apisports-key': '6dea7d814258faa2db4f3051b6cfc065' }
                });

                totalPages = response.data?.paging?.total || 1;
                const fixturesPayload = response.data?.response || [];

                // Collect this page's writes and fire them in batched chunks at
                // the end instead of one sequentially-awaited round trip per
                // selection - with thousands of selections per page, that
                // serialization was the other major source of the slowness.
                const pendingUpserts = [];

                for (const fixtureItem of fixturesPayload) {
                    const apiFixtureId = String(fixtureItem.fixture.id);
                    const localMatch = upcomingMatches.find(m => String(m.id_api) === apiFixtureId);

                    if (!localMatch) continue;

                    for (const bookmaker of fixtureItem.bookmakers) {

                        // A. Handle Bookmaker Auto-Discovery
                        let internalBookmakerId = bookmakerLookupByName[bookmaker.name];

                        if (!internalBookmakerId) {
                            console.log(`✨ [Auto-Discovery] Creating new bookmaker: "${bookmaker.name}"`);
                            const newBookmaker = await prisma.bookmaker.create({
                                data: { name: bookmaker.name } // is_active/is_default get default values
                            });
                            internalBookmakerId = newBookmaker.id;
                            bookmakerLookupByName[bookmaker.name] = internalBookmakerId;
                        }

                        // B. Process Bets - skip anything that isn't one of our
                        // tracked markets before touching the DB at all.
                        for (const bet of bookmaker.bets) {
                            const marketSlug = formatMarketSlug(bet.name);

                            if (!TRACKED_RAW_SLUGS.has(marketSlug)) {
                                totalSkipped += bet.values.length;
                                continue;
                            }

                            let internalMarketId = marketLookupBySlug[marketSlug];

                            if (!internalMarketId) {
                                const newMarket = await prisma.market.upsert({
                                    where: { slug: marketSlug },
                                    update: { name: bet.name },
                                    create: {
                                        name: bet.name,
                                        scope: 'team',
                                        slug: marketSlug,
                                        id_api: String(bet.id),
                                        sport: { connect: { slug: 'football' } }
                                    },
                                });
                                internalMarketId = newMarket.id;
                                marketLookupBySlug[marketSlug] = internalMarketId;
                            }

                            for (const selection of bet.values) {
                                const standardizedSlug = formatSelectionSlug(selection.value);

                                pendingUpserts.push(prisma.matchOdds.upsert({
                                    where: {
                                        match_market_bookmaker_slug: {
                                            match_id: localMatch.id,
                                            market_id: internalMarketId,
                                            bookmaker_id: internalBookmakerId, // USE ID, NOT NAME
                                            slug: standardizedSlug
                                        }
                                    },
                                    update: {
                                        odd: selection.odd,
                                        updated_at: new Date()
                                    },
                                    create: {
                                        match_id: localMatch.id,
                                        market_id: internalMarketId,
                                        bookmaker_id: internalBookmakerId, // USE ID, NOT NAME
                                        slug: standardizedSlug,
                                        odd: selection.odd
                                    }
                                }));
                                totalUpserts++;
                            }
                        }
                    }
                }

                for (const chunk of chunkArray(pendingUpserts, 100)) {
                    await prisma.$transaction(chunk);
                }

                currentPage++;
            } while (currentPage <= totalPages);
        }
        console.log(`✅ [Odds Pipeline] Processed successfully. ${totalUpserts} update(s) written, ${totalSkipped} irrelevant selection(s) skipped.`);
    } catch (error) {
        console.error("❌ [Odds Pipeline] Error:", error.message);
    }
}

function runOddsPipeline(targetLeagues) {
    syncTargetedOdds(targetLeagues);
    const THREE_HOURS = 3 * 60 * 60 * 1000;
    setInterval(() => { syncTargetedOdds(targetLeagues); }, THREE_HOURS);
}

module.exports = { runOddsPipeline, syncTargetedOdds };