const express = require('express');
const streakChangesController = require('../../controllers/main/streak-changes.controller');
const route = express.Router();

/**
 * @openapi
 * /streaks/changes:
 *   get:
 *     summary: Poll for unsent streak changes (new/continued/broken/odds_changed/postponed/kickoff_changed)
 *     description: >
 *       Returns every StreakChangeEvent not yet acknowledged, each resolved to the
 *       streak's CURRENT live data (never a frozen snapshot from when the change was
 *       detected). Acknowledge the returned ids via POST /streaks/changes/ack once
 *       processed - a row that's fetched but never acked simply stays unsent and is
 *       included again on the next poll, so nothing is ever silently lost.
 *     tags: [StreakChanges]
 *     responses:
 *       200:
 *         description: Pending change events
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id: { type: integer, description: 'Pass this back to /streaks/changes/ack once processed' }
 *                       change_type: { type: string, enum: [new, continued, broken, odds_changed, postponed, kickoff_changed] }
 *                       description: { type: string }
 *                       detected_at: { type: string, format: date-time }
 *                       streak: { type: object, description: 'Current live data for this streak' }
 */
route.get('/changes', streakChangesController.getChanges);

/**
 * @openapi
 * /streaks/changes/ack:
 *   post:
 *     summary: Acknowledge successfully processed change events
 *     tags: [StreakChanges]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [ids]
 *             properties:
 *               ids:
 *                 type: array
 *                 items: { type: integer }
 *     responses:
 *       200:
 *         description: Number of rows marked sent
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     acknowledged: { type: integer }
 *       400:
 *         description: Missing or invalid ids
 */
route.post('/changes/ack', streakChangesController.ackChanges);

module.exports = route;
