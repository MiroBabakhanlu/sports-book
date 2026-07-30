// Shared CORS config for the handful of routes that are genuinely called
// cross-origin: the six "main" routes (called by the separately-hosted React
// client) and GET /api/admin/api-token (called by BOTH that client AND the
// admin panel this same server serves same-origin - which is why this
// server's own production URL has to be in the allowlist too, not just the
// client's: browsers send an Origin header even on same-origin requests, and
// that origin is this server's own domain, not the client's.
const allowedOrigins = [
    'http://localhost:3000',
    'http://localhost:8080', // local server's own origin - admin panel same-origin calls in local dev
    'https://sports-book-client-production.up.railway.app',
    'https://sports-book-production.up.railway.app',
    ...(process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim()) : []),
];

const corsOptions = {
    origin: (origin, callback) => {
        // No origin (curl, server-to-server) - allow.
        if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
        return callback(new Error(`Not allowed by CORS: ${origin}`));
    },
};

module.exports = { corsOptions, allowedOrigins };
