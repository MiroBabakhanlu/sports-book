// ─────────────────────────────────────────────────────────────────────────
// One-off correction: StreakResult rows graded before the push-result fix
// (streak-sync-scheduler.js / backfill-streak-results.js) recorded a
// whole-number line landing exactly on its threshold as a "miss" - in
// betting terms that's actually a push (stake back, no win, no loss), not a
// loss. This finds every 'miss' row where actual_value === threshold
// (only possible for non-binary markets, since threshold is null for
// binary ones) and corrects result to 'push'.
//
// Not wired to run automatically - require()'d and called (commented out by
// default) from server.js, same toggle-via-comment convention as every
// other pipeline. Uncomment, restart the server once to run it, then
// re-comment. Safe to re-run: once a row is 'push' it no longer matches the
// 'miss' + tie condition, so a second run just finds nothing to fix.
// ─────────────────────────────────────────────────────────────────────────

const { prisma } = require('./src/utils/prisma');

async function fixPushResults() {
    console.log('[fix-push-results] Scanning for miss-graded rows that were actually pushes...');

    const candidates = await prisma.streakResult.findMany({
        where: { result: 'miss', threshold: { not: null } },
        select: { id: true, threshold: true, actual_value: true }
    });

    const tieIds = candidates
        .filter(r => Number(r.actual_value) === Number(r.threshold))
        .map(r => r.id);

    if (tieIds.length === 0) {
        console.log('[fix-push-results] Nothing to fix.');
        return;
    }

    const result = await prisma.streakResult.updateMany({
        where: { id: { in: tieIds } },
        data: { result: 'push' }
    });

    console.log(`[fix-push-results] Corrected ${result.count} row(s) from 'miss' to 'push'.`);
}

module.exports = { fixPushResults };
