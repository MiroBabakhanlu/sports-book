const { prisma } = require('./src/utils/prisma');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const API_KEY = '6dea7d814258faa2db4f3051b6cfc065';
const BASE_URL = 'https://v3.football.api-sports.io';

const REPORT_DIR = path.join(__dirname, 'reports');
const REPORT_PATH = path.join(REPORT_DIR, 'missing-stats-report.md');

function pct(n, d) {
    if (!d) return 0;
    return Math.round((n / d) * 1000) / 10;
}

// Live, per-league coverage object straight from API-Football - not cached, since
// this is meant to reflect the provider's current stance every time the report runs.
async function fetchCoverage(leagueIdApi) {
    try {
        const res = await axios.get(`${BASE_URL}/leagues`, {
            headers: { 'x-apisports-key': API_KEY },
            params: { id: leagueIdApi }
        });
        const entry = res.data.response[0];
        const currentSeason = entry?.seasons?.find(s => s.current);
        return currentSeason?.coverage || null;
    } catch (error) {
        return { error: error.message };
    }
}

async function buildLeagueSection(league) {
    const season = await prisma.season.findFirst({ where: { league_id: league.id, is_current: true } });
    if (!season) {
        return { league, skipped: true };
    }

    const totalFinished = await prisma.match.count({
        where: { season_id: season.id, status: { in: ['FT', 'AET', 'PEN'] } }
    });

    const missingRows = await prisma.missingMatchStat.findMany({
        where: { league_id: league.id, season_id: season.id },
        select: {
            match_id: true, match_id_api: true, market_id: true,
            market: { select: { slug: true, name: true } },
            team: { select: { name: true } },
            match: { select: { homeTeam: { select: { name: true } }, awayTeam: { select: { name: true } } } }
        }
    });

    const affectedMatches = new Set(missingRows.map(r => r.match_id));
    const overallPct = pct(affectedMatches.size, totalFinished);

    const coverage = await fetchCoverage(league.id_api);

    // Group by market, tracking distinct matches (not raw rows - a match can have
    // both home and away rows for the same market).
    const byMarket = new Map();
    for (const row of missingRows) {
        const key = row.market_id;
        if (!byMarket.has(key)) {
            byMarket.set(key, { slug: row.market.slug, name: row.market.name, matches: new Map() });
        }
        byMarket.get(key).matches.set(row.match_id, row);
    }

    return {
        league, season, totalFinished,
        matchesAffected: affectedMatches.size, overallPct,
        coverage, byMarket
    };
}

function renderLeagueSection(data) {
    const { league, season, totalFinished, matchesAffected, overallPct, coverage, byMarket } = data;
    const lines = [];

    lines.push(`## ${league.name} (${league.country || 'Unknown'})`);
    lines.push('');
    lines.push(`**${overallPct}% of finished matches (${matchesAffected} / ${totalFinished}) are missing at least one stat market.**`);
    lines.push('');
    lines.push('### API-Football coverage (live, current season)');
    lines.push('```json');
    lines.push(JSON.stringify(coverage, null, 2));
    lines.push('```');
    lines.push('');

    if (matchesAffected === 0) {
        lines.push('No missing data for this league. All stat markets fully populated.');
        lines.push('');
        lines.push('---');
        lines.push('');
        return lines.join('\n');
    }

    lines.push('### Per-market breakdown');
    lines.push('');
    lines.push('| Market | Slug | Matches missing | % of total |');
    lines.push('|---|---|---|---|');

    const marketEntries = [...byMarket.values()].sort((a, b) => b.matches.size - a.matches.size);
    for (const m of marketEntries) {
        lines.push(`| ${m.name} | \`${m.slug}\` | ${m.matches.size} | ${pct(m.matches.size, totalFinished)}% |`);
    }
    lines.push('');

    for (const m of marketEntries) {
        const marketPct = pct(m.matches.size, totalFinished);
        lines.push(`#### ${m.name} (\`${m.slug}\`) — ${marketPct}% missing (${m.matches.size} / ${totalFinished} matches)`);
        lines.push('');

        if (marketPct >= 100) {
            lines.push('Entire market unavailable for every finished match in this league - provider does not supply this data here. No per-match detail (nothing to individually check).');
            lines.push('');
            continue;
        }

        lines.push('| Match DB ID | Match API ID | Market ID | Slug | Home Team | Away Team |');
        lines.push('|---|---|---|---|---|---|');
        for (const row of m.matches.values()) {
            lines.push(`| ${row.match_id} | ${row.match_id_api} | ${row.market_id} | \`${row.market.slug}\` | ${row.match.homeTeam.name} | ${row.match.awayTeam.name} |`);
        }
        lines.push('');
    }

    lines.push('---');
    lines.push('');
    return lines.join('\n');
}

async function generateMissingStatsReport() {
    const leagues = await prisma.league.findMany({ select: { id: true, name: true, country: true, id_api: true } });

    const sections = [];
    const summaryRows = [];

    for (const league of leagues) {
        const data = await buildLeagueSection(league);
        if (data.skipped) continue;

        summaryRows.push({
            name: data.league.name, country: data.league.country,
            matchesAffected: data.matchesAffected, totalFinished: data.totalFinished, overallPct: data.overallPct
        });
        sections.push(renderLeagueSection(data));
    }

    summaryRows.sort((a, b) => b.overallPct - a.overallPct);

    const header = [];
    header.push('# Missing Match Statistics Report');
    header.push('');
    header.push(`Generated: ${new Date().toISOString()}`);
    header.push('');
    header.push('Scoped to finished matches only (`FT`/`AET`/`PEN`) - not-yet-played fixtures are excluded, since those trivially have no stats yet and are not a data gap.');
    header.push('');
    header.push('## Summary');
    header.push('');
    header.push('| League | Country | Matches Affected | Total Finished | % Affected |');
    header.push('|---|---|---|---|---|');
    for (const r of summaryRows) {
        header.push(`| ${r.name} | ${r.country || ''} | ${r.matchesAffected} | ${r.totalFinished} | ${r.overallPct}% |`);
    }
    header.push('');
    header.push('---');
    header.push('');

    const fullReport = header.join('\n') + '\n' + sections.join('\n');

    if (!fs.existsSync(REPORT_DIR)) fs.mkdirSync(REPORT_DIR, { recursive: true });
    fs.writeFileSync(REPORT_PATH, fullReport);
    console.log(`✅ Missing stats report written to ${REPORT_PATH}`);
}

module.exports = { generateMissingStatsReport };
