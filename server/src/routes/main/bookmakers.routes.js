const express = require('express');
const bookmakersController = require('../../controllers/main/bookmakers.controller');
const route = express.Router();

/**
 * @openapi
 * /bookmakers/bookmaker/{region}:
 *   get:
 *     summary: Get active bookmaker info for a region
 *     tags: [Bookmakers]
 *     parameters:
 *       - in: path
 *         name: region
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Bookmaker info
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data: { type: array, items: { type: object } }
 */
route.get('/bookmaker/:region', bookmakersController.getBookMakerInfo)


module.exports = route;
