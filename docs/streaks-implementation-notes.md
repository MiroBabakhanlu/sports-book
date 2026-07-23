# Streaks API — Implementation Notes (for team lead review)

What I built and the reasoning behind each computed value in `/api/streaks`, `/api/streaks/summary`, `/api/streaks/{id}`, `/api/clicks`, and the auth layer in front of them. Source: `src/services/main/streaks.service.js` unless noted.

## What counts as a "streak" at all

A row only becomes a candidate if:
- `streak_length >= 3` (fewer than 3 consecutive matches isn't a "streak" worth surfacing)
- It belongs to the **current season**
- It's one of the 8 markets we actually track (see below)
- The team has a resolvable **live or upcoming** match right now (a streak with no next match to bet on isn't actionable, so it's excluded rather than shown dangling)

## Confidence — what's "High" / "Good" / "Moderate"

`confidence` (0–100) comes straight from `TeamStreak.confidence`, computed by the streak-tracker background job (not part of this API layer). This layer just buckets it for display:

```js
function confidenceLabel(confidence) {
    if (confidence >= 80) return 'High';
    if (confidence >= 60) return 'Good';
    return 'Moderate';
}
```

- **High**: confidence ≥ 80
- **Good**: 60 ≤ confidence < 80
- **Moderate**: confidence < 60

These cutoffs were a judgment call on my end (not specified anywhere) — easy to change in one place if you want different bands.

## `status`: live / soon / upcoming

```js
const LIVE_STATUSES = ['1H', '2H', 'HT', 'ET'];
const SOON_WINDOW_MS = 2 * 60 * 60 * 1000; // 2 hours

function deriveStatus(match) {
    if (LIVE_STATUSES.includes(match.status)) return 'live';
    const diff = match.kickoff_at.getTime() - Date.now();
    if (diff < SOON_WINDOW_MS) return 'soon';
    return 'upcoming';
}
```

- **`live`**: the match's provider status is `1H`, `2H`, `HT`, or `ET` (in-progress, any half/extra time) — matches the same bucket already used elsewhere in the codebase (`render_stats.js`).
- **`soon`**: not live, and kickoff is less than 2 hours away. The 2-hour window is from the original PDF spec.
- **`upcoming`**: everything else (kickoff more than 2 hours out).

Note the `diff < SOON_WINDOW_MS` check has no lower bound — a match that's technically already past kickoff but hasn't updated to a live status yet (rare provider lag) still falls into `soon`, not into some undefined negative-time bucket. Not a live match ever ends up mislabeled `upcoming`.

## `prediction.threshold` and `.direction`

The "line" a streak is over/under isn't stored anywhere — it's derived on the fly from the team's season average for that market:

```js
const threshold = (avgValue % 1 === 0) ? avgValue : Math.floor(avgValue) + 0.5;
const direction = ts.streak_direction === 'below' ? 'over' : 'under';
```

- If the average is already a whole number (e.g. exactly `3`), the threshold is that number.
- Otherwise it's floored to the nearest whole number, then `.5` is added (e.g. average `3.1` → floor to `3` → threshold `3.5`; average `3.9` → floor to `3` → threshold `3.5` too). This keeps thresholds at realistic betting lines (`X.5`) instead of arbitrary decimals like `3.1`.
- `direction` is the inverse of the streak's raw direction: if the team's actual values have been running **below** the historical average (`streak_direction: 'below'`), the streak itself is evidence of an **over** prediction going forward (regression toward the mean), and vice versa. This inversion logic was already established elsewhere in the codebase (`admin.service.js`'s `handleLeaueStreakCount`) — I mirrored it rather than inventing a new convention.

## `hit_rate`

```js
const hitRate = sampleSize ? Math.round((hits / sampleSize) * 100) / 100 : 0;
```

Simple fraction: of the historical matches used for `history` (see below), what fraction would have "hit" the current prediction (value over/under the threshold, per `direction`). Rounded to 2 decimal places. `0` if there's no sample data at all.

## `std_deviation` — how it's calculated

**Sample standard deviation with Bessel's correction (n−1)** — the standard formula for estimating population variability from a sample, not the full population:

```js
const values = history.map(h => h.value);
const mean = values.reduce((s, v) => s + v, 0) / values.length;
const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1);
stdDeviation = Math.round(Math.sqrt(variance) * 100) / 100;
```

Step by step:
1. Take the market's actual value (goals/cards/corners) from each of the historical matches in `history`.
2. Compute the mean of those values.
3. Sum the squared deviation of each value from the mean.
4. Divide by `n − 1` (not `n`) — this is Bessel's correction, standard practice when you're treating the sample as an estimate of a larger population's variance rather than treating it as the entire population. Matches Excel's `STDEV.S`, numpy's `std(ddof=1)`, and R's `sd()`.
5. Square root, round to 2 decimals.

Only computed when `sample_size > 1` (variance is undefined for a single data point) — defaults to `0` otherwise.

**What it's for**: a low `std_deviation` means the team's values have been consistently close to their average (a "reliable" streak); a high one means the average is being pulled by a few outlier matches even though the streak count itself looks strong. Useful as a secondary trust signal alongside `confidence`.

## `history` — sample size and ordering

```js
const historyLimit = Math.min(Math.max(base.streak_count, 3), 20);
```

We pull up to `streak_count` historical matches, floored at 3 and capped at 20 — so a 45-match streak still only returns the most recent 20 (keeps the payload bounded), and even a fresh 3-match streak gets at least 3 data points. Only **finished** matches count (`FT`/`AET`/`PEN`) — the pipeline pre-creates stat rows for not-yet-played fixtures too, which would otherwise leak in as bogus zero-value history. Returned oldest → newest (reversed from the DB's newest-first query) to match a natural left-to-right dot-trail UI.

## `GET /matchup/{streakId}` — why it exists separately from `/streaks/{id}`

`/streaks/{id}` was scoped deliberately narrow: it's evidence for *one* prediction (one team, one market), not a general matchup/comparison page. Once we needed a "click a streak, see both teams' full picture" view (mirroring what the internal admin dashboard already shows via `teams.service.js`'s `getTeamDashboard`), that was a genuinely different shape of data, so it's a new endpoint rather than bolting more fields onto `/streaks/{id}`.

Implementation-wise it reuses rather than reinvents:
- **Resolving the streak → match/teams**: pulled a shared `resolveCandidateByStreakId` helper out of `streaks.service.js` (it was inline in `getStreakById` before) so both endpoints agree on what "streak not found" means and share the same 60s candidate cache — no duplicated match-resolution logic.
- **Per-team stats**: same three tables `getTeamDashboard` already uses (`TeamSeasonAverage`, `TeamStreak`, `MatchTeamStat`), just queried for **one market** across **both teams** instead of all 8 markets for one team. `MatchTeamStat` already stores the pre-computed raw value per team per match per market (goals/cards/corners), so there's no manual home/away score math here — same pattern `getStreakById`'s own `history` field already uses.

One deliberate difference from `/streaks/{id}`'s `history`: `matchup`'s per-team `matches` list is **not capped at 20** — since this is meant to be the "full picture" view, it returns every finished match in the season. Worth keeping an eye on payload size if a competition runs a very long season, but not a concern at current scale.

Also: a team's `streak` field here can show a streak shorter than 3 (the floor that keeps something off `/streaks` entirely) — this endpoint isn't filtering candidates, it's just reporting whatever `TeamStreak` row exists for context, so the frontend decides what's worth badging.

## Market scope: why only 8 markets

The original PDF spec's market list didn't match what this codebase actually computes streaks for (it included 1st/2nd-half goals and BTTS, which we have no `TeamStreak`/`TeamSeasonAverage` data for at all). Per direction I was given, I used the canonical 8 markets already tracked everywhere else in the app instead of trying to force the PDF's list:

`team_goals`, `total_goals`, `team_yellow_cards`, `total_yellow_cards`, `team_red_cards`, `total_red_cards`, `team_corners`, `total_corners`

## Odds: "best price" vs "full board"

`/streaks` and `/streaks/{id}`'s top-level `odds.home_win` / `odds.away_win` / `odds.recommended` are each **the single highest price currently offered by any active bookmaker** for that specific bet — not a specific bookmaker's price, the best one available. `/streaks/{id}`'s `all_odds` is the full multi-bookmaker board for the `recommended` line, sorted highest → lowest, for a "compare bookmakers" view. Bookmaker logos are inlined as base64 `data:` URIs (matched by filename against `public/media/`) so the frontend never needs a second request.

## Sort parameter naming

Went through one revision here — my first pass used names like `soon_desc` which don't self-describe a direction. Settled on a strict `<field>_<direction>` convention (`asc`/`desc` always explicit) for every value except `top`/`top_asc`, which are a deliberately named composite ranking (confidence, then streak length) rather than a single field.

## Caching

The expensive DB assembly (`buildRawCandidates`) — joining `TeamStreak` → `Match` → `MatchOdds` → `TeamSeasonAverage` — is cached in-memory for 60 seconds and shared across `/streaks`, `/summary`, and `/streaks/{id}`, since all three would otherwise redo the exact same joins on every request. Practical effect: a streak that just resolved or got recalculated can lag up to ~60s before reflecting everywhere. No caching on filtering/sorting/pagination itself — that's cheap enough to redo per-request against the cached candidate list.

## Auth: shared Bearer token, DB-backed

There's no user/login system anywhere in this codebase, so `/bookmakers`, `/leagues`, `/streaks`, `/clicks` are gated by a single shared secret (not per-user auth — proof the caller is an authorized client). The token lives in a DB table (`ApiToken`), not `.env`, specifically so it can be viewed/rotated from the admin panel (Manage API section) without a redeploy. Rotating immediately invalidates the previous value everywhere.

## `POST /clicks` — fire-and-forget by design

Per spec, this must never block or fail the user's click. The controller validates the payload synchronously (`400` if `streak_id`/`bookmaker`/`click_type` are missing), responds `202` immediately, then writes to the DB in the background — any write failure is caught and logged server-side, never surfaced to the client. `streak_id` is stored as a raw string for analytics only; it's intentionally **not** validated against an existing `TeamStreak`.

## `POST /alerts` — not implemented, on hold

The PDF's spec for this endpoint is a single sentence with no detail on trigger condition, contact-info storage, lifecycle, or unsubscribe flow — and more importantly, doesn't say whether this Node API or the main site's PHP backend is supposed to own the alert-triggering/delivery logic. That question is with you/Levon; nothing has been built for this endpoint pending an answer.
