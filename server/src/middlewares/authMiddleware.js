const AppError = require("./AppError");
const { prisma } = require("../utils/prisma");

// Guards the "main" endpoints (bookmakers/leagues/streaks/clicks) that the
// external frontend consumes. There's no user/login system in this codebase,
// so this is a single shared secret - not per-user auth, just proof the
// caller is an authorized client. Frontend sends it as: Authorization: Bearer <token>
// The token itself lives in the ApiToken table (not .env) so it can be
// generated/regenerated from the admin panel without a redeploy - see
// adminService.getApiToken/regenerateApiToken.
const authMiddleware = async (req, res, next) => {
    const header = req.headers.authorization || '';
    const [scheme, token] = header.split(' ');

    if (scheme !== 'Bearer' || !token) {
        return next(new AppError('Missing or malformed Authorization header. Expected: Bearer <token>', 401));
    }

    try {
        const active = await prisma.apiToken.findFirst({ where: { is_active: true, token } });
        if (!active) {
            return next(new AppError('Invalid API token', 401));
        }
        next();
    } catch (error) {
        next(error);
    }
};

module.exports = authMiddleware;
