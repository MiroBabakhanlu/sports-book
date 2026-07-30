const AppError = require("../../middlewares/AppError");
const { prisma } = require("../../utils/prisma");

// ─────────────────────────────────────────────────────────────────────────
// POST /clicks - fires whenever a user clicks an odds chip on a streak card.
// Per the spec: "Backend logs for affiliate revenue reporting. Fire-and-forget
// - no blocking required on the frontend." That means the write to ClickLog
// must never be allowed to slow down or fail the user-facing click action:
// - We only validate the handful of fields we actually need to make the log
//   row meaningful (streak_id, bookmaker, click_type). No FK/existence check
//   against TeamStreak - streak_id is stored as a raw string, purely for
//   analytics, same as the PDF example ("streak_8f3a2b").
// - The actual DB write is deliberately NOT awaited by the controller (see
//   clicks.controller.js) - logClick() is called and its promise is left to
//   resolve/reject in the background, with errors caught + logged here so
//   they never bubble up as an unhandled rejection.
const clicksService = {

    validateClickPayload: (body) => {
        const { streak_id, bookmaker, click_type } = body || {};
        if (!streak_id || typeof streak_id !== 'string') {
            throw new AppError('streak_id is required', 400);
        }
        if (!bookmaker || typeof bookmaker !== 'string') {
            throw new AppError('bookmaker is required', 400);
        }
        if (!click_type || typeof click_type !== 'string') {
            throw new AppError('click_type is required', 400);
        }
    },

    // Fire-and-forget: caller should NOT await this before responding.
    logClick: async (body) => {
        const { streak_id, bookmaker, click_type, country, session_id } = body || {};
        try {
            await prisma.clickLog.create({
                data: {
                    streak_id,
                    bookmaker,
                    click_type,
                    country: country || null,
                    session_id: session_id || null
                }
            });
        } catch (error) {
            console.error('⚠️ Failed to write click log (non-blocking):', error);
        }
    }

};

module.exports = clicksService;
