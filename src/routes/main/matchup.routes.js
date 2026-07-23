const express = require('express');
const matchupController = require('../../controllers/main/matchup.controller');
const route = express.Router();

/**
 * @openapi
 * /matchup/{streakId}:
 *   get:
 *     summary: Both teams' averages, streak, and full raw match history for a streak's market
 *     description: >
 *       Given a streak id, resolves the match it's about and returns both the
 *       home and away team's season average, current streak (if any), and
 *       every finished match's raw value - all scoped to that one market.
 *       Meant for an on-click "matchup" detail view (both teams side by side),
 *       as opposed to GET /streaks/{id} which only covers the one team/market
 *       the streak itself is about.
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
 *                       description: Same match object shape as GET /streaks/{id}
 *                     home: { $ref: '#/components/schemas/MatchupSide' }
 *                     away: { $ref: '#/components/schemas/MatchupSide' }
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
 *               venue: { type: string, enum: [home, away] }
 *               opponent:
 *                 type: object
 *                 properties:
 *                   id: { type: string }
 *                   name: { type: string }
 *               score: { type: string, example: '3-1' }
 *               value: { type: number, example: 3 }
 */
route.get('/:streakId', matchupController.getMatchup);

module.exports = route;
