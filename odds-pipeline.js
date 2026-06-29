const { default: axios } = require('axios');
const { prisma } = require('./src/utils/prisma');

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
                status: "NS",
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

        const activeTasks = new Map();
        upcomingMatches.forEach((match) => {
            const leagueApiId = match.season.league.id_api;
            const seasonYear = match.season.year;
            const key = `${leagueApiId}-${seasonYear}`;
            if (!activeTasks.has(key)) {
                activeTasks.set(key, { leagueApiId, seasonYear });
            }
        });

        const dbMarkets = await prisma.market.findMany();
        const marketLookupBySlug = {};
        dbMarkets.forEach(m => { marketLookupBySlug[m.slug] = m.id; });

        let totalUpserts = 0;

        for (const [key, task] of activeTasks.entries()) {
            let currentPage = 1;
            let totalPages = 1;

            do {
                console.log(`📡 Fetching API odds for League ${task.leagueApiId} (Season: ${task.seasonYear}) - Page ${currentPage}...`);

                const response = await axios.get('https://v3.football.api-sports.io/odds', {
                    params: { league: task.leagueApiId, season: task.seasonYear, page: currentPage },
                    headers: { 'x-apisports-key': 'be6628089266c3f9779a94c9744b1dcf' }
                });

                totalPages = response.data?.paging?.total || 1;
                const fixturesPayload = response.data?.response || [];

                for (const fixtureItem of fixturesPayload) {
                    const apiFixtureId = String(fixtureItem.fixture.id);
                    const localMatch = upcomingMatches.find(m => String(m.id_api) === apiFixtureId);

                    if (!localMatch) continue;

                    for (const bookmaker of fixtureItem.bookmakers) {
                        for (const bet of bookmaker.bets) {

                            // USE MARKET FORMATTER (No dots)
                            const marketSlug = formatMarketSlug(bet.name);
                            let internalMarketId = marketLookupBySlug[marketSlug];

                            if (!internalMarketId) {
                                console.log(`✨ [Auto-Discovery] Creating new market: "${bet.name}" (Slug: ${marketSlug})`);
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

                            // USE SELECTION FORMATTER (Allows dots)
                            for (const selection of bet.values) {
                                const standardizedSlug = formatSelectionSlug(selection.value);

                                await prisma.matchOdds.upsert({
                                    where: {
                                        match_market_bookmaker_slug: {
                                            match_id: localMatch.id,
                                            market_id: internalMarketId,
                                            bookmaker_name: bookmaker.name,
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
                                        bookmaker_name: bookmaker.name,
                                        slug: standardizedSlug,
                                        odd: selection.odd
                                    }
                                });
                                totalUpserts++;
                            }
                        }
                    }
                }
                currentPage++;
            } while (currentPage <= totalPages);
        }
        console.log(`✅ [Odds Pipeline] Processed successfully. Total database updates: ${totalUpserts}`);
    } catch (error) {
        console.error("❌ [Odds Pipeline] Error:", error.message);
    }
}

function runOddsPipeline(targetLeagues) {
    syncTargetedOdds(targetLeagues);
    const THREE_HOURS = 3 * 60 * 60 * 1000;
    setInterval(() => { syncTargetedOdds(targetLeagues); }, THREE_HOURS);
}

module.exports = { runOddsPipeline };