const express = require('express');
const streaksController = require('../../controllers/main/streaks.controller');
const route = express.Router();

/**
 * @openapi
 * components:
 *   schemas:
 *     Odd:
 *       type: object
 *       nullable: true
 *       properties:
 *         value: { type: number, example: 2.3 }
 *         bookmaker: { type: string, example: '10bet' }
 *         bookmaker_label: { type: string, example: '10BET' }
 *         bookmaker_logo: { type: string, nullable: true, description: 'Inline base64 data URI (data:image/png;base64,...) of the bookmaker logo, looked up from public/media by exact bookmaker name. Null if no matching image file exists.' }
 *         affiliate_url: { type: string, nullable: true }
 *     Streak:
 *       type: object
 *       properties:
 *         id: { type: string, example: 'streak_921' }
 *         streak_count: { type: integer, example: 9 }
 *         market:
 *           type: object
 *           properties:
 *             key: { type: string, example: 'team_goals' }
 *             label: { type: string, example: 'Team Goals' }
 *         prediction:
 *           type: object
 *           properties:
 *             text: { type: string }
 *             threshold: { type: number }
 *             direction: { type: string, enum: [over, under] }
 *             average: { type: number }
 *             description: { type: string }
 *         confidence: { type: integer, example: 85 }
 *         confidence_label: { type: string, enum: [High, Good, Moderate] }
 *         status: { type: string, enum: [live, soon, upcoming] }
 *         match:
 *           type: object
 *           properties:
 *             id: { type: string, example: 'match_1758' }
 *             date: { type: string, format: date-time }
 *             date_display: { type: string, example: '19 Jul · 16:00' }
 *             league:
 *               type: object
 *               properties:
 *                 id: { type: integer }
 *                 name: { type: string }
 *                 country: { type: string }
 *                 flag: { type: string, nullable: true }
 *             home:
 *               type: object
 *               properties:
 *                 id: { type: string }
 *                 name: { type: string }
 *                 short: { type: string }
 *                 logo_url: { type: string, nullable: true }
 *             away:
 *               type: object
 *               properties:
 *                 id: { type: string }
 *                 name: { type: string }
 *                 short: { type: string }
 *                 logo_url: { type: string, nullable: true }
 *         odds:
 *           type: object
 *           properties:
 *             home_win: { $ref: '#/components/schemas/Odd' }
 *             away_win: { $ref: '#/components/schemas/Odd' }
 *             recommended: { $ref: '#/components/schemas/Odd' }
 *     StreakDetail:
 *       allOf:
 *         - $ref: '#/components/schemas/Streak'
 *         - type: object
 *           properties:
 *             sample_size: { type: integer }
 *             hit_rate: { type: number, example: 0.89 }
 *             std_deviation: { type: number }
 *             history:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   match_id: { type: string }
 *                   date: { type: string, format: date }
 *                   result: { type: string, enum: [hit, miss] }
 *                   value: { type: number }
 *             all_odds:
 *               type: array
 *               items: { $ref: '#/components/schemas/Odd' }
 */

/**
 * @openapi
 * /streaks/summary:
 *   get:
 *     summary: Aggregate stats for the current streak candidates (totals, facet counts)
 *     description: >
 *       Accepts the same filters as GET /streaks and returns counts/averages over the
 *       filtered set, plus market/date facet counts computed with that one dimension
 *       excluded (so picking a market doesn't zero out the other market badges).
 *     tags: [Streaks]
 *     parameters:
 *       - in: query
 *         name: streak_min
 *         schema: { type: integer }
 *       - in: query
 *         name: streak_max
 *         schema: { type: integer }
 *       - in: query
 *         name: confidence_min
 *         schema: { type: integer }
 *       - in: query
 *         name: odds_min
 *         schema: { type: number }
 *       - in: query
 *         name: odds_max
 *         schema: { type: number }
 *       - in: query
 *         name: markets
 *         description: Comma-separated market keys (team_goals, total_goals, team_yellow_cards, total_yellow_cards, team_red_cards, total_red_cards, team_corners, total_corners)
 *         schema: { type: string }
 *       - in: query
 *         name: leagues
 *         description: Comma-separated league ids
 *         schema: { type: string }
 *       - in: query
 *         name: status
 *         description: Comma-separated statuses (live, soon, upcoming)
 *         schema: { type: string }
 *       - in: query
 *         name: date_range
 *         schema: { type: string, enum: [today, 2days, 7days, 30days] }
 *     responses:
 *       200:
 *         description: Summary counts
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     total: { type: integer }
 *                     live: { type: integer }
 *                     avg_confidence: { type: number }
 *                     high_confidence_count: { type: integer }
 *                     by_market:
 *                       type: object
 *                       additionalProperties: { type: integer }
 *                     by_date:
 *                       type: object
 *                       additionalProperties: { type: integer }
 */
route.get('/summary', streaksController.getSummary);

/**
 * @openapi
 * /streaks:
 *   get:
 *     summary: List candidate streaks (filterable, sortable, paginated)
 *     tags: [Streaks]
 *     parameters:
 *       - in: query
 *         name: streak_min
 *         schema: { type: integer }
 *       - in: query
 *         name: streak_max
 *         schema: { type: integer }
 *       - in: query
 *         name: confidence_min
 *         schema: { type: integer }
 *       - in: query
 *         name: odds_min
 *         schema: { type: number }
 *       - in: query
 *         name: odds_max
 *         schema: { type: number }
 *       - in: query
 *         name: markets
 *         description: Comma-separated market keys (team_goals, total_goals, team_yellow_cards, total_yellow_cards, team_red_cards, total_red_cards, team_corners, total_corners)
 *         schema: { type: string }
 *       - in: query
 *         name: leagues
 *         description: Comma-separated league ids
 *         schema: { type: string }
 *       - in: query
 *         name: status
 *         description: Comma-separated statuses (live, soon, upcoming)
 *         schema: { type: string }
 *       - in: query
 *         name: date_range
 *         schema: { type: string, enum: [today, 2days, 7days, 30days] }
 *       - in: query
 *         name: sort
 *         description: >
 *           Every value is "<field>_<direction>": asc = lowest/soonest first,
 *           desc = highest/latest first. `top`/`top_asc` are the one exception -
 *           a named composite ranking (confidence, then streak length, both
 *           descending for `top`; both ascending for `top_asc`), not a single
 *           field.
 *         schema: { type: string, enum: [top, top_asc, confidence_desc, confidence_asc, odds_desc, odds_asc, kickoff_asc, kickoff_desc], default: top }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: per_page
 *         schema: { type: integer, default: 10, maximum: 50 }
 *     responses:
 *       200:
 *         description: Paginated list of streaks
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     meta:
 *                       type: object
 *                       properties:
 *                         total: { type: integer }
 *                         page: { type: integer }
 *                         per_page: { type: integer }
 *                         total_pages: { type: integer }
 *                         sort: { type: string }
 *                         filters_applied: { type: object }
 *                     data:
 *                       type: array
 *                       items: { $ref: '#/components/schemas/Streak' }
 */
route.get('/', streaksController.getStreaks);

/**
 * @openapi
 * /streaks/{id}:
 *   get:
 *     summary: Get a single streak with history and full odds board
 *     tags: [Streaks]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, example: 'streak_921' }
 *     responses:
 *       200:
 *         description: Streak detail
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data: { $ref: '#/components/schemas/StreakDetail' }
 *       400:
 *         description: Invalid streak id
 *       404:
 *         description: Streak not found
 */
route.get('/:id', streaksController.getStreakById);

module.exports = route;
