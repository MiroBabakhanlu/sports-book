const { prisma } = require('../utils/prisma');

// The "main" endpoints - the ones the public React site actually calls (see
// server.js's mounting comment). Admin/internal routes are excluded: their
// failures already surface directly in the admin panel's own network tab/
// console, so logging them here too would just mix internal noise in with
// real user-facing failures.
const MAIN_ENDPOINT_PREFIXES = ['/api/bookmakers', '/api/leagues', '/api/streaks', '/api/clicks', '/api/matchup', '/api/standings'];

const errorMiddleware = (error, req, res, next) => {

    console.log(error);

    const statusCode = error.statusCode || 500;

    if (MAIN_ENDPOINT_PREFIXES.some(prefix => req.originalUrl.startsWith(prefix))) {
        // Fire-and-forget - never await this before responding, and never let a
        // logging failure mask or delay the real error response to the client.
        prisma.errorLog.create({
            data: {
                endpoint: req.originalUrl,
                method: req.method,
                status_code: statusCode,
                message: error.message || 'Internal Server Error',
                stack: error.stack || null,
                query_params: Object.keys(req.query || {}).length ? JSON.stringify(req.query) : null
            }
        }).catch((logError) => {
            console.error('Failed to persist ErrorLog:', logError.message);
        });
    }

    res.status(statusCode).json({
        success: false,
        message: error.message || 'Internal Server Error'
    });
}

module.exports = errorMiddleware;
