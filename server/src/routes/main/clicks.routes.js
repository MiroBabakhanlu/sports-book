const express = require('express');
const clicksController = require('../../controllers/main/clicks.controller');
const route = express.Router();

/**
 * @openapi
 * /clicks:
 *   post:
 *     summary: Log a click on an odds chip (affiliate revenue reporting)
 *     description: >
 *       Fires when a user clicks an odds chip on a streak card. Fire-and-forget:
 *       the server responds as soon as the payload is validated, without waiting
 *       for the log write to finish, so the frontend never has to block the
 *       click on this request. streak_id is stored as-is for reporting and is
 *       not validated against any existing streak.
 *     tags: [Clicks]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [streak_id, bookmaker, click_type]
 *             properties:
 *               streak_id: { type: string, example: 'streak_8f3a2b' }
 *               bookmaker: { type: string, example: 'bet365' }
 *               click_type: { type: string, example: 'recommended_odd' }
 *               country: { type: string, nullable: true, example: 'GB' }
 *               session_id: { type: string, nullable: true, example: 'sess_abc' }
 *     responses:
 *       202:
 *         description: Click accepted for logging (write happens asynchronously)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     logged: { type: boolean, example: true }
 *       400:
 *         description: Missing required field (streak_id, bookmaker, or click_type)
 */
route.post('/', clicksController.logClick);

module.exports = route;
