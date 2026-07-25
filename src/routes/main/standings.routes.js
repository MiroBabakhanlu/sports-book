const express = require('express');
const standingsController = require('../../controllers/main/standings.controller');
const route = express.Router();

/**
 * @openapi
 * /standings/{leagueId}:
 *   get:
 *     summary: Current season's league table (W/D/L/points/goal difference) for a league
 *     description: >
 *       Pure read - the table itself is precomputed whenever fixtures load or
 *       update (same pattern TeamSeasonAverage already uses), not calculated
 *       on request. Resolves the league's current season and returns its full
 *       standings, ranked points desc, then wins desc, then goal difference
 *       desc, then goals for desc (matches official tiebreaker rules, e.g.
 *       MLS's Supporters' Shield - a team with fewer wins can outrank one with
 *       a better goal difference).
 *     tags: [Standings]
 *     parameters:
 *       - in: path
 *         name: leagueId
 *         required: true
 *         schema: { type: integer, example: 39 }
 *     responses:
 *       200:
 *         description: League table
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     league:
 *                       type: object
 *                       properties:
 *                         id: { type: integer }
 *                         name: { type: string }
 *                         country: { type: string }
 *                     season:
 *                       type: object
 *                       properties:
 *                         id: { type: integer }
 *                         year: { type: string }
 *                     standings:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           position: { type: integer, example: 1 }
 *                           team:
 *                             type: object
 *                             properties:
 *                               id: { type: string, example: 'team_42' }
 *                               name: { type: string }
 *                               short: { type: string, nullable: true }
 *                               logo_url: { type: string, nullable: true }
 *                           played: { type: integer }
 *                           won: { type: integer }
 *                           drawn: { type: integer }
 *                           lost: { type: integer }
 *                           goals_for: { type: integer }
 *                           goals_against: { type: integer }
 *                           goal_difference: { type: integer }
 *                           points: { type: integer }
 *       400:
 *         description: Invalid league id
 *       404:
 *         description: League not found, or no current season for this league
 */
route.get('/:leagueId', standingsController.getStandings);

module.exports = route;
