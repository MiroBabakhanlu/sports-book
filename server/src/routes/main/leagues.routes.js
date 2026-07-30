const express = require('express');
const leaguesController = require('../../controllers/main/leagues.controller');
const route = express.Router();

/**
 * @openapi
 * /leagues/all:
 *   get:
 *     summary: List all leagues (with country flags)
 *     tags: [Leagues]
 *     responses:
 *       200:
 *         description: League list
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data: { type: array, items: { type: object } }
 */
route.get('/all', leaguesController.getAllInfo)


module.exports = route;
