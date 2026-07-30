# Streaks API — Implementation Notes (for team lead review)

What I built and the reasoning behind each computed value in `/api/streaks`, `/api/streaks/summary`, `/api/streaks/{id}`, `/api/clicks`, and the auth layer in front of them. Source: `src/services/main/streaks.service.js` unless noted.

## What counts as a "streak" at all

A row only becomes a candidate if:
- `streak_length >= 3` (fewer than 3 consecutive matches isn't a "streak" worth surfacing)
- It belongs to the **current season**
- It's one of the markets we actually track (see below)
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

## `history` / `sample_size` — the whole season, not the streak

Originally this was capped to `Math.min(Math.max(base.streak_count, 3), 20)` — i.e. only the games *inside* the active streak's own run. That turned out to be structurally broken: `direction` is deliberately the *inverse* of the streak's own run (see above — the bet is "this breaks," not "this continues"), so testing the streak's own games against the inverted direction was mathematically guaranteed to score `hit_rate: 0%` for every single streak, always, regardless of the team or market. (The reverse would've been equally broken the other way — un-inverting `direction` would've made it always `100%`, since the streak's own games trivially satisfy their own direction by definition.) Full writeup of why in the "why sample size matters" thread we had with the boss - short version: you can't measure "how often does this pattern break" using only the games where it *didn't* break.

The fix (per direction from the boss): `history`/`sample_size` now cover **every match this team has played this season for this market** (`match: { status: { in: FINISHED_STATUSES }, season_id: base._seasonId }`, no `take` limit at all) — not just the streak's own games. That's what makes `hit_rate` meaningful now: games from *before* the current streak started are a genuine mix of hits and misses, so the percentage actually varies by team/market instead of being a hardcoded constant. `_seasonId` is a new internal field on the candidate object (same treatment as `_teamId`/`_matchId` etc. - stripped by `stripInternal` before leaving the service) needed because `MatchTeamStat` has no `season_id` column of its own; it has to filter through the `match` relation.

Returned oldest → newest (reversed from the DB's newest-first query), same as before.

## `hit_rate`

```js
const hitRate = sampleSize ? Math.round((hits / sampleSize) * 100) : 0;
```

Percentage (`0`–`100`), matching the `confidence` field's convention elsewhere in this API — **not** a `0`–`1` fraction like the original PDF example showed. `0` if there's no sample data at all.

## `std_deviation` — population, not sample

```js
const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
stdDeviation = Math.round(Math.sqrt(variance) * 100) / 100;
```

**Population standard deviation** (divide by `n`) — changed from the sample formula (Bessel's correction, `n − 1`) used earlier this session. That correction is for when your data is a *sample* estimating some larger, unknown population's variance. Now that `sample_size` is every game the team actually played this season for this market, it *is* the full population for that scope, not a sample of it — so there's nothing to correct for. Computed whenever `sample_size > 0` (population variance is well-defined even for `n = 1`, unlike the sample formula which divides by zero at `n = 1`).

**What it's for**: a low `std_deviation` means the team's values have been consistently close to their average across the season; a high one means the average is being pulled around by a few outlier matches even though the streak count itself looks strong. Useful as a secondary trust signal alongside `confidence`.

## `GET /matchup/{streakId}` — why it exists separately from `/streaks/{id}`

`/streaks/{id}` was scoped deliberately narrow: it's evidence for *one* prediction (one team, one market), not a general matchup/comparison page. Once we needed a "click a streak, see both teams' full picture" view (mirroring what the internal admin dashboard already shows via `teams.service.js`'s `getTeamDashboard`), that was a genuinely different shape of data, so it's a new endpoint rather than bolting more fields onto `/streaks/{id}`.

Implementation-wise it reuses rather than reinvents:
- **Resolving the streak → match/teams**: pulled a shared `resolveCandidateByStreakId` helper out of `streaks.service.js` (it was inline in `getStreakById` before) so both endpoints agree on what "streak not found" means and share the same 60s candidate cache — no duplicated match-resolution logic.
- **Per-team stats**: same three tables `getTeamDashboard` already uses (`TeamSeasonAverage`, `TeamStreak`, `MatchTeamStat`), just queried for **one market** across **both teams** instead of every tracked market for one team. `MatchTeamStat` already stores the pre-computed raw value per team per match per market (goals/cards/corners), so there's no manual home/away score math here — same pattern `getStreakById`'s own `history` field already uses.

One deliberate difference from `/streaks/{id}`'s `history`: `matchup`'s per-team `matches` list is **not capped at 20** — since this is meant to be the "full picture" view, it returns every finished match in the season. Worth keeping an eye on payload size if a competition runs a very long season, but not a concern at current scale.

Also: a team's `streak` field here can show a streak shorter than 3 (the floor that keeps something off `/streaks` entirely) — this endpoint isn't filtering candidates, it's just reporting whatever `TeamStreak` row exists for context, so the frontend decides what's worth badging.

### `chartData`, `availableBookmakers`, `similarStreaks`

Added once the actual streak-detail page design (not just the matchup mockup) came in, requesting all of a page's data from this one endpoint rather than spreading it across calls. Two more extractions came out of this, same pattern as `resolveCandidateByStreakId`:
- `streaksService.getAllOddsForStreak(base)` — pulled the bookmaker-odds query straight out of `getStreakById`'s `all_odds` block. `getStreakById` calls it unchanged (still gets `value` back); `matchup` calls the exact same thing for `availableBookmakers` and just strips `value` before returning — the widget only needs "who to visit," not the price.
- `streaksService.getSimilarStreaks(base, limit)` — reuses the same cached candidate pool and the same `sortCandidates(list, 'top')` ranking `/streaks?sort=top` already uses, filtered to the current streak's market and excluding the streak itself. `otherSimilarStreakCounts` is just `(candidates in that market, minus itself) − (however many were returned)` — no separate count query.

`chartData` is deliberately **single-team** (whichever side the streak actually belongs to — resolved by comparing `base._teamId` against `match.home_team_id`), unlike `home`/`away` which are both sides. Its `data` array length is exactly `streak_count` — no floor, no 20-item cap like `history` uses — sliced from the same uncapped `matches` list already being built for that side, so no extra query. The reference line is the team's `season_avg`, not the betting `threshold` used in `history`/`hit_rate` — deliberately different from `/streaks/{id}`'s hit/miss framing, this chart is "how does this compare to their own normal," not "did this bet hit."

## Market scope

The original PDF spec's market list didn't match what this codebase actually computes streaks for (it included BTTS, which we have no `TeamStreak`/`TeamSeasonAverage` data for at all, and no plan to add). Per direction I was given, I used the canonical markets already tracked everywhere else in the app instead of trying to force the PDF's list. Originally that was 8 markets; `total_goals_1st_half`/`total_goals_2nd_half` were added later once we confirmed API-Football's fixture response already includes halftime score data (`f.score.halftime.{home,away}`) in the same payload the pipeline was already fetching — no new API call needed, just previously-unused data:

`team_goals`, `total_goals`, `team_yellow_cards`, `total_yellow_cards`, `team_red_cards`, `total_red_cards`, `team_corners`, `total_corners`, `total_goals_1st_half`, `total_goals_2nd_half`

Adding a market means keeping **five separate places** in sync (this was already a pre-existing pattern, not something introduced by this addition):
- `prisma/manual_seeds.js` — seeds the canonical `Market` row
- `pop-db.js` and `update-db.js` — each has its own hardcoded market slug list gating which markets get `MatchTeamStat` rows written, plus the actual per-market value computation branch (`TeamSeasonAverage` computation itself is generic in both files, no changes needed there)
- `streak-tracker.js`'s `TARGET_SLUGS` — gates which markets get `TeamStreak` rows computed
- `teams.service.js`'s `STREAK_CHECK_SLUGS` (canonical markets) and `SLUG_MAP` (raw odds slug → canonical slug, for odds resolution)
- `streaks.service.js`'s `MARKET_MAP` — exposes it publicly via `/streaks`, `/streaks/summary`, `/streaks/{id}`, `/matchup/{id}`

None of these currently import from a shared constant — they're five independent copies that happen to agree today. Worth consolidating into one source of truth if another market gets added later.

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

## `GET /standings/{leagueId}` — precomputed, not calculated on request

This was originally going to be computed on the fly per request (cached in-memory, same style as the streaks candidate pool) — changed to a proper stored table instead, since that's actually more consistent with how this app already handles everything else in this category. `TeamSeasonAverage` and `TeamStreak` are both precomputed by background pipelines and just read at request time; standings now follows the same shape rather than being the one exception.

New `TeamStanding` table (`prisma db push`, not migrate), one row per team per season (`@@unique([team_id, season_id])`), computed by a `generateStandings(seasonId)` function that lives in **both** `pop-db.js` and `update-db.js` — same "two independent copies" situation as `generateSeasonAverages` already has in those two files, called right alongside it at the same point in each. It reads straight from `Match.home_score`/`away_score`/`status` (not `MatchTeamStat` - standings doesn't need anything from the stats pipeline), tallies W/D/L/goals per team, and ranks `points` desc → `goal_difference` desc → `goals_for` desc. `standings.service.js` itself does zero computation - it just resolves the league's current season and reads the precomputed rows back, ordered by `position`.

Verified against real data (Liga Pro Ecuador, 240 finished matches): the tiebreaker chain resolved correctly for two genuine ties in the actual dataset - Universidad Católica vs Aucas (both 35 pts, split by goal difference) and Orense vs Técnico Universitario (both 23 pts *and* both -5 GD, split by goals-for).

### `matchup`'s `match.home`/`.away.position`

Now that `TeamStanding` exists, `/matchup/{streakId}` reads each team's `position` straight from it and attaches it to `match.home`/`match.away`. Deliberately **not** added to `buildRawCandidates()`'s shared `match` object in `streaks.service.js` - that object is built for every candidate in the 60s-cached pool (hundreds of streaks at once), and `/streaks`, `/streaks/summary`, `/streaks/{id}` all reuse it too. Adding a `TeamStanding` lookup there would mean paying that cost for every candidate on every cache refresh, for a field only the matchup view actually wants. Instead `matchup.service.js` clones `base.match` locally and only adds `position` to that one copy - two extra lightweight `team_id`-scoped lookups per `/matchup` request, not a change to the shared pipeline.

## Team Statistics (`statistics` in `/matchup/{streakId}`)

Six new markets power this, none of them streak-eligible (deliberately excluded from `STREAK_CHECK_SLUGS`/`TARGET_SLUGS` - these are comparison stats, not predictions):
- `team-goals-conceded` - was already scaffolded (commented out) in `pop-db.js`/`manual_seeds.js` from earlier work; just activated it
- `team-goals-1st-half` / `team-goals-2nd-half` - **team-specific**, not to be confused with `total-goals-1st-half`/`total-goals-2nd-half` (the match-wide totals built earlier for streak predictions). Same underlying halftime data (`f.score.halftime`), just attributed per-team instead of summed
- `team-possession`, `team-shots` - same discovery pattern as the halftime data: both already sit in the `f.statistics` array `pop-db.js` was already parsing for cards/corners, just never read. `Ball Possession` comes back as a string like `"46%"` - `parseInt` already stops at the first non-numeric character, so the existing `getRawStatValue` helper handles it with zero changes
- `team-clean-sheets` - stores a plain `1`/`0` per team per match (home's clean sheet = away scored `0` that match, and vice versa)

**`clean_sheets` was originally special-cased** - queried directly against `MatchTeamStat` with its own bespoke count query, bypassing `TeamSeasonAverage` entirely, on the reasoning that it's a count rather than an average. That reasoning didn't hold up: `generateSeasonAverages()` doesn't know or care what a market's values *mean* - it just does `sum/count` for whatever's in `MatchTeamStat`, for every market, identically. Feed it `1`s and `0`s and `avg_value` comes out as the clean-sheet **rate** (e.g. `0.429` = clean sheet in 43% of matches) - a completely valid statistic, computed the exact same way as every other market's average. So `team-clean-sheets` now goes through the identical `MatchTeamStat` → `TeamSeasonAverage` pipeline as everything else in this list, with zero special-casing anywhere in `pop-db.js`/`update-db.js`.

The only place any special handling survives is the very last step, in `matchup.service.js`, converting the stored rate back into the whole-number count the widget displays: `count = round(avg_value * matches_played)` - both fields already sitting on the same `TeamSeasonAverage` row fetched for every other stat, so no extra query for `home`/`away`. `league_avg.clean_sheets` does need its own aggregation (average of each team's *converted count*, not average of rates) since `rate * matches_played` isn't linear across teams that have played different numbers of matches - `avg(rate) * avg(played)` would give a slightly wrong answer, so it converts every team's row to a count first, then averages those.

`league_avg` overall is computed on request (plain `TeamSeasonAverage.findMany` + averaging in JS, scoped to the league's current season) rather than stored - unlike standings, this didn't need the "proper table" treatment. Standings needed precomputation because building one row requires iterating every match in the season with several interdependent tiebreakers; a league average is just a mean over an already-small, already-indexed table - cheap enough to compute per request.

Verified against real data: `league_avg.goals_scored` and `league_avg.goals_conceded` came back numerically identical (`1.08` both) - expected in a closed league, since every goal scored by one team is conceded by another. Also independently recomputed every team's clean-sheet count by hand from the raw `TeamSeasonAverage` rows (`rate × matches_played`) and confirmed both the individual counts and the league average (`6.8`) matched the API response exactly, before *and* after the clean_sheets refactor - same real-world numbers, cleaner implementation.

**Side effect on the admin dashboard**: `teams.service.js`'s `getTeamDashboard` (powers the internal admin "Full Market" table, team-avgs cards, and the matchup comparison modal - unrelated to the public `/matchup` API) had no market filter on its `TeamSeasonAverage` query at all - it just returned every market that had a row for that team+season. The moment these 6 new markets started getting `TeamSeasonAverage` rows, they started leaking into that admin table too, showing up as empty "nc" (no streak) rows with no matchday data, since they were never meant to appear there. Fixed by scoping that query to `STREAK_CHECK_SLUGS` - the admin streak-analysis views only ever wanted the streak-eligible markets to begin with, so this was really pre-existing latent behavior (the query was already too broad) that only became visible once a second category of market existed.

## `leagueStandings` in `/matchup/{streakId}` — a window, not the full table

`standingsService.getStandingsWindow(seasonId, teamIds, padding = 1)`, reusing `TeamStanding` (same table `GET /standings/{leagueId}` already reads). Deliberately a separate, trimmed method from `getStandings()` rather than that function's `standings` array sliced down after the fact - only fetches the small position/team/points shape this widget needs, not the full W/D/L/GF/GA/GD every row of the full-table endpoint carries. Centralized on `standingsService` (not inlined in `matchup.service.js`) for the same reason `getAllOddsForStreak`/`getSimilarStreaks` live on `streaksService` - it's standings-domain logic, reusable if another endpoint ever wants a table window.

**Went through one redesign here.** First version took `[min(positions) - padding, max(positions) + padding]` as a single shared span (`padding = 2`) - correct-looking and matched the original mockup exactly for two teams close together (14th & 16th → 12–18), but degenerates toward the *entire table* the moment the two teams are far apart, since the span has to bridge the whole gap between them (2nd & 19th in a 20-team league → span 1–20, i.e. everything - not caught by any test I'd run, since I'd only checked "close together" and the two clamp edges, never "far apart").

Redesigned to a **per-team window unioned together**, rather than one shared span: each team gets `padding` rows on each side (`padding*2+1` rows), shifting the shortfall to the other side if the team is close enough to the top/bottom that one side runs out (so a team in 1st still gets a full 3-row block - itself + 2 below - not 2 rows). The two teams' row-sets are then merged as a plain `Set` union - close/adjacent teams naturally collapse into one contiguous block (no manual "are these overlapping" logic needed), far-apart teams stay as two small separate blocks, and there's no shared-span code path to degenerate in the first place.

Trade-off, chosen deliberately over keeping the old formula for the "close" case and only falling back to this one when teams are far apart: the close-together case now shows 5 rows instead of the original mockup's 7 (`padding=1` per team vs. the old `padding=2` shared span), since the union of two `±1` blocks is narrower than one shared `±2` span. Went with the simpler, single, threshold-free algorithm over preserving the exact mockup row count - verified against real data across close (5 rows), far apart (6 rows, not the full 16-team table), and both-near-the-top (3 rows, correctly deduplicated where the two teams' blocks fully overlap) cases.

**Second redesign**: the 6-row far-apart result above was flagged as inconsistent with a fixed 7-row target the widget should always aim for. Added two more rules on top of the per-team-window union: (1) if both teams sit within the top `totalRows` (7) positions, or both within the bottom `totalRows`, just return that whole top/bottom block directly (1st & 2nd, or 2nd & 5th → rows 1-7 - the per-team-window union alone doesn't reach 7 rows here, since two small overlapping ±1 blocks near the top collapse down to 3); (2) otherwise, on top of the two teams' 3-row windows, add one more "divider" position at `floor((lowerPos + higherPos) / 2)` - roughly the table position sitting between the two teams - giving 7 total when the two windows don't overlap (e.g. 3rd & 16th → `[2,3,4]` + divider `[9]` + `[15,16,17]`). When the two teams are close enough that their windows already overlap, the divider position falls inside the existing union and is a no-op (adds nothing new, same fewer-than-7-rows merged-block result as before - e.g. 14th & 16th still returns 5 rows, not padded up to 7). Verified against real DB data: Aucas(3rd)/Macara(5th, Liga Pro Ecuador) both within top 7 → rows 1-7; Houston Dynamo(12th)/Austin(23rd, MLS) → `[11,12,13,17,22,23,24]`, 7 rows with the divider at 17th; 1st/2nd → rows 1-7; the two bottom-most teams in a 30-team league → rows 24-30.

## `POST /alerts` — not implemented, on hold

The PDF's spec for this endpoint is a single sentence with no detail on trigger condition, contact-info storage, lifecycle, or unsubscribe flow — and more importantly, doesn't say whether this Node API or the main site's PHP backend is supposed to own the alert-triggering/delivery logic. That question is with you/Levon; nothing has been built for this endpoint pending an answer.
