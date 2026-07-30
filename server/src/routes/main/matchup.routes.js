const express = require('express');
const matchupController = require('../../controllers/main/matchup.controller');
const route = express.Router();

/**
 * @openapi
 * /matchup/{streakId}:
 *   get:
 *     summary: Full streak detail page data - matchday tables, trend chart, available bookmakers, similar streaks, team statistics, league standings
 *     description: >
 *       Given a streak id, resolves the match it's about and returns everything
 *       the streak detail page needs in one call: both teams' season average,
 *       current streak (if any), current league position, and full raw match
 *       history (home/away); a single-team trend chart scoped to exactly the
 *       streak's own length (chartData); every active bookmaker currently
 *       pricing this exact prediction, name/logo/link only, no odd value
 *       (availableBookmakers); up to 5 other active streaks in the same market
 *       ranked by the same confidence-then-streak-length ranking
 *       /streaks?sort=top uses, plus how many more exist beyond those 5
 *       (similarStreaks); both teams' season averages per stat plus the
 *       league-wide average for comparison (statistics); and a windowed slice
 *       of the league table centered on the two teams (leagueStandings). As
 *       opposed to GET /streaks/{id}, which only covers the one team/market the
 *       streak itself is about.
 *     tags: [Matchup]
 *     parameters:
 *       - in: path
 *         name: streakId
 *         required: true
 *         schema: { type: string, example: 'streak_921' }
 *     responses:
 *       200:
 *         description: Matchup detail
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     streak_id: { type: string, example: 'streak_921' }
 *                     market:
 *                       type: object
 *                       properties:
 *                         key: { type: string, example: 'team_goals' }
 *                         label: { type: string, example: 'Team Goals' }
 *                     match:
 *                       type: object
 *                       description: Same match object shape as GET /streaks/{id}, except home/away each also carry a `position` (current league standing, null if not yet computed for this season)
 *                     home: { $ref: '#/components/schemas/MatchupSide' }
 *                     away: { $ref: '#/components/schemas/MatchupSide' }
 *                     chartData:
 *                       type: object
 *                       properties:
 *                         title: { type: string, example: 'Team Yellow Cards per match' }
 *                         subtitle: { type: string, example: 'Everton - last 9 games' }
 *                         avg: { type: number, nullable: true, example: 1.1 }
 *                         data:
 *                           type: array
 *                           description: Exactly streak_count points, oldest to newest, no cap
 *                           items:
 *                             type: object
 *                             properties:
 *                               date: { type: string, example: 'Nov 23' }
 *                               value: { type: number, example: 1 }
 *                     availableBookmakers:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           bookmaker: { type: string, example: 'bet365' }
 *                           bookmaker_label: { type: string, example: 'BET365' }
 *                           bookmaker_logo: { type: string, nullable: true }
 *                           affiliate_url: { type: string, nullable: true }
 *                     similarStreaks:
 *                       type: object
 *                       properties:
 *                         items:
 *                           type: array
 *                           description: Up to 5 other streaks in the same market, sorted by top (confidence desc, then streak_count desc) - trimmed to only what the similar-streaks card needs, not the full Streak shape
 *                           items:
 *                             type: object
 *                             properties:
 *                               id: { type: string, example: 'streak_921' }
 *                               streak_count: { type: integer, example: 9 }
 *                               confidence: { type: integer, example: 85 }
 *                               market:
 *                                 type: object
 *                                 properties:
 *                                   key: { type: string, example: 'team_goals' }
 *                                   label: { type: string, example: 'Team Goals' }
 *                               prediction:
 *                                 type: object
 *                                 properties:
 *                                   direction: { type: string, enum: [over, under] }
 *                                   threshold: { type: number, example: 2.5 }
 *                               home:
 *                                 type: object
 *                                 properties:
 *                                   name: { type: string }
 *                                   logo_url: { type: string, nullable: true }
 *                               away:
 *                                 type: object
 *                                 properties:
 *                                   name: { type: string }
 *                                   logo_url: { type: string, nullable: true }
 *                         otherSimilarStreakCounts: { type: integer, example: 24, description: Streaks in this market beyond the 5 shown }
 *                     statistics:
 *                       type: object
 *                       description: Team Statistics widget - season averages per stat for both teams plus the league-wide average for comparison
 *                       properties:
 *                         home: { $ref: '#/components/schemas/StatsSide' }
 *                         away: { $ref: '#/components/schemas/StatsSide' }
 *                         league_avg: { $ref: '#/components/schemas/StatsSide' }
 *                     leagueStandings:
 *                       type: object
 *                       description: >
 *                         A slice of the table (not the full thing - use GET
 *                         /standings/{leagueId} for that), aiming for 7 rows
 *                         total. If both teams sit within the top 7 (or both
 *                         within the bottom 7), returns that whole 7-row block.
 *                         Otherwise returns a 3-row window around each team
 *                         (self + 1 above + 1 below, shifted away from the table
 *                         edge if needed) plus one divider row at the midpoint
 *                         between the two teams' positions - e.g. 3rd & 16th
 *                         returns rows [2,3,4,9,15,16,17].
 *                       properties:
 *                         rows:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               position: { type: integer, example: 14 }
 *                               team:
 *                                 type: object
 *                                 properties:
 *                                   id: { type: string, example: 'team_42' }
 *                                   name: { type: string }
 *                                   logo_url: { type: string, nullable: true }
 *                               points: { type: integer, example: 20 }
 *                         total_teams: { type: integer, example: 20 }
 *       400:
 *         description: Invalid streak id
 *       404:
 *         description: Streak not found
 * components:
 *   schemas:
 *     MatchupSide:
 *       type: object
 *       properties:
 *         team:
 *           type: object
 *           properties:
 *             id: { type: string, example: 'team_42' }
 *             name: { type: string }
 *             short: { type: string }
 *             logo_url: { type: string, nullable: true }
 *         season_avg: { type: number, nullable: true, example: 3.1 }
 *         streak:
 *           type: object
 *           nullable: true
 *           properties:
 *             count: { type: integer, example: 9 }
 *             direction: { type: string, enum: [above, below] }
 *         matches:
 *           type: array
 *           description: Finished matches only, most recent first
 *           items:
 *             type: object
 *             properties:
 *               match_id: { type: string, example: 'match_1701' }
 *               date: { type: string, format: date }
 *               matchday: { type: integer, nullable: true, example: 17, description: Extracted from the API's round string - can be null (e.g. cup rounds with no numeric round), and isn't guaranteed to be chronological (rescheduled fixtures) }
 *               venue: { type: string, enum: [home, away] }
 *               opponent:
 *                 type: object
 *                 properties:
 *                   id: { type: string }
 *                   name: { type: string }
 *               score: { type: string, example: '3-1' }
 *               value: { type: number, example: 3 }
 *     StatsSide:
 *       type: object
 *       description: null on any field means not enough data yet (e.g. market not computed for this team/season)
 *       properties:
 *         goals_scored: { type: number, nullable: true, example: 1.1 }
 *         goals_conceded: { type: number, nullable: true, example: 0.95 }
 *         goals_1st_half: { type: number, nullable: true, example: 0.5 }
 *         goals_2nd_half: { type: number, nullable: true, example: 0.6 }
 *         corners: { type: number, nullable: true, example: 5.2 }
 *         yellow_cards: { type: number, nullable: true, example: 2.2 }
 *         possession: { type: number, nullable: true, example: 50.9, description: Percentage, not a 0-1 fraction }
 *         shots: { type: number, nullable: true, example: 12.55 }
 *         clean_sheets: { type: number, nullable: true, example: 9, description: On home/away this is a whole-number count; on league_avg it's an average across teams, so can have a decimal }
 */
route.get('/:streakId', matchupController.getMatchup);

module.exports = route;
