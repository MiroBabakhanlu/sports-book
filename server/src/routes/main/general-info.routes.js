const express = require('express');
const generalInfoController = require('../../controllers/main/general-info.controller');
const route = express.Router();

/**
 * @openapi
 * /general-info:
 *   get:
 *     summary: Reference snapshot of active sports, leagues, and streak-eligible markets
 *     description: >
 *       Consumers (e.g. AssuredBets) should call this BEFORE requesting streak changes -
 *       diff sports/leagues/markets here against your own local tables and insert
 *       anything missing first. New sports/leagues/markets may appear over time;
 *       any aimed_sport/market.key/league not recognized locally should be inserted
 *       from here rather than treated as an error when it later shows up on a streak.
 *     tags: [General Info]
 *     responses:
 *       200:
 *         description: Current sports, leagues, and markets
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     sports:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           key: { type: string, example: 'football' }
 *                           label: { type: string, example: 'Football' }
 *                     leagues:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           id: { type: integer }
 *                           name: { type: string }
 *                           country: { type: string, nullable: true }
 *                           aimed_sport: { type: string, example: 'football' }
 *                           flag: { type: string, nullable: true }
 *                     markets:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           key: { type: string, example: 'team_goals' }
 *                           label: { type: string, example: 'Team Goals' }
 *                           is_boolean: { type: boolean, example: false }
 */
route.get('/', generalInfoController.getGeneralInfo);

module.exports = route;
