const AppError = require("../../middlewares/AppError");
const { prisma } = require("../../utils/prisma");

// ─────────────────────────────────────────────────────────────────────────
// GET /standings/{leagueId} - pure read. TeamStanding rows are precomputed by
// pop-db.js/update-db.js's generateStandings() whenever fixtures load/update,
// same pattern TeamSeasonAverage already uses - no computation happens here,
// just resolve the league's current season and read its table back.
// ─────────────────────────────────────────────────────────────────────────

const standingsService = {
    getStandings: async (leagueId) => {
        const id = Number(leagueId);
        if (!Number.isInteger(id)) {
            throw new AppError('Invalid league id', 400);
        }

        const league = await prisma.league.findUnique({
            where: { id },
            select: { id: true, name: true, country: true }
        });
        if (!league) {
            throw new AppError('League not found', 404);
        }

        const season = await prisma.season.findFirst({
            where: { league_id: id, is_current: true },
            select: { id: true, year: true }
        });
        if (!season) {
            throw new AppError('No current season found for this league', 404);
        }

        const rows = await prisma.teamStanding.findMany({
            where: { season_id: season.id },
            orderBy: { position: 'asc' },
            include: { team: { select: { id: true, name: true, short_name: true, logo_url: true } } }
        });

        return {
            league,
            season,
            standings: rows.map(r => ({
                position: r.position,
                team: {
                    id: `team_${r.team.id}`,
                    name: r.team.name,
                    short: r.team.short_name || null,
                    logo_url: r.team.logo_url
                },
                played: r.played,
                won: r.won,
                drawn: r.drawn,
                lost: r.lost,
                goals_for: r.goals_for,
                goals_against: r.goals_against,
                goal_difference: r.goal_difference,
                points: r.points
            }))
        };
    },

    // Shared by matchup.service.js's League Standings widget - a small slice of
    // the table around two specific teams, not the full table. Trimmed shape
    // (position/team/points only) since that's all the widget shows - full
    // W/D/L/GF/GA/GD is what GET /standings/{leagueId} is for.
    //
    // Aims for a fixed total of `totalRows` (7, for the default padding=1) rows:
    //   - Both teams within the top `totalRows` positions -> just show positions
    //     1..totalRows (e.g. 1st & 2nd, or 2nd & 5th, both return rows 1-7).
    //     Same rule mirrored at the bottom of the table.
    //   - Otherwise: each team gets its own `padding`-row window (padding*2+1
    //     rows, shifting the shortfall to the other side if the team is near a
    //     table edge - a team in 1st still gets a full 3-row block, not 2), plus
    //     one "divider" row at floor((higherPos + lowerPos) / 2) marking roughly
    //     what sits between the two teams when they're far apart. E.g. 3rd &
    //     16th -> [2,3,4] + [15,16,17] + {9} = 7 rows. When the two teams'
    //     windows already overlap (close together), the divider position falls
    //     inside the union and is a no-op, so the result is fewer than 7 rows -
    //     that's fine, it mirrors the merged-block behavior this was designed
    //     for. This replaces an earlier version that took [min(positions)-
    //     padding, max(positions)+padding] as a single shared span - correct
    //     when the two teams were close together, but degenerated to (close to)
    //     the entire table when they were far apart (e.g. one team 2nd, the
    //     other 19th, in a 20-team league) since the span has to bridge the
    //     whole gap between them.
    getStandingsWindow: async (seasonId, teamIds, padding = 1) => {
        const [teamPositions, totalTeams] = await Promise.all([
            prisma.teamStanding.findMany({
                where: { season_id: seasonId, team_id: { in: teamIds } },
                select: { team_id: true, position: true }
            }),
            prisma.teamStanding.count({ where: { season_id: seasonId } })
        ]);

        if (!teamPositions.length || !totalTeams) {
            return { rows: [], total_teams: totalTeams };
        }

        const windowSize = padding * 2 + 1;
        const totalRows = windowSize * 2 + 1;
        const positions = teamPositions.map(t => t.position);
        const p1 = Math.min(...positions);
        const p2 = Math.max(...positions);

        const positionsToShow = new Set();
        if (totalTeams <= totalRows) {
            for (let p = 1; p <= totalTeams; p++) positionsToShow.add(p);
        } else if (p1 <= totalRows && p2 <= totalRows) {
            for (let p = 1; p <= totalRows; p++) positionsToShow.add(p);
        } else if (p1 > totalTeams - totalRows && p2 > totalTeams - totalRows) {
            for (let p = totalTeams - totalRows + 1; p <= totalTeams; p++) positionsToShow.add(p);
        } else {
            const addWindow = (position) => {
                let start = position - padding;
                let end = position + padding;
                if (start < 1) { end += (1 - start); start = 1; }
                if (end > totalTeams) { start -= (end - totalTeams); end = totalTeams; }
                start = Math.max(1, start);
                for (let p = start; p <= end; p++) positionsToShow.add(p);
            };
            addWindow(p1);
            addWindow(p2);
            positionsToShow.add(Math.floor((p1 + p2) / 2));
        }

        const rows = await prisma.teamStanding.findMany({
            where: { season_id: seasonId, position: { in: [...positionsToShow] } },
            orderBy: { position: 'asc' },
            include: { team: { select: { id: true, name: true, logo_url: true } } }
        });

        return {
            rows: rows.map(r => ({
                position: r.position,
                team: { id: `team_${r.team.id}`, name: r.team.name, logo_url: r.team.logo_url },
                points: r.points
            })),
            total_teams: totalTeams
        };
    }
};

module.exports = standingsService;
