const { prisma } = require("../../utils/prisma");
const AppError = require("../../middlewares/AppError");
const { resolveCurrentStreakData } = require("../../../streak-sync-scheduler");

// External (PHP) server sync - see streak-sync-scheduler.js's top comment and
// prisma/schema.prisma's StreakChangeEvent model for the full design. This
// service just answers two questions: "what's unsent" (resolved to current
// live data, never a frozen snapshot) and "mark these as sent."
const streakChangesService = {
    getChanges: async () => {
        const pending = await prisma.streakChangeEvent.findMany({
            where: { sent_at: null },
            orderBy: { id: 'asc' }
        });

        const resolved = [];
        for (const event of pending) {
            const streak = await resolveCurrentStreakData(event.team_streak_id);
            if (!streak) continue; // the underlying TeamStreak row is gone - nothing to send

            resolved.push({
                id: event.id,
                change_type: event.change_type,
                description: event.description,
                detected_at: event.created_at,
                streak
            });
        }
        return resolved;
    },

    ackChanges: async (ids) => {
        if (!Array.isArray(ids) || ids.length === 0) {
            throw new AppError('ids array is required', 400);
        }
        const numericIds = ids.map(Number).filter(Number.isInteger);
        if (numericIds.length === 0) {
            throw new AppError('ids must contain at least one valid integer', 400);
        }

        const result = await prisma.streakChangeEvent.updateMany({
            where: { id: { in: numericIds }, sent_at: null },
            data: { sent_at: new Date() }
        });
        return { acknowledged: result.count };
    }
};

module.exports = streakChangesService;
