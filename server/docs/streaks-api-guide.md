# Streaks API — Frontend Integration Guide

Base URL: `/api` (e.g. `https://yourhost.com/api/streaks`)
Interactive docs (same info, browsable): `/api/docs`

## Authentication

Every endpoint below requires a Bearer token on every request:

```
Authorization: Bearer <token>
```

There's no per-user login — this is a single shared token issued to the frontend. Get the current value from whoever manages the admin panel (Manage API section), or ask your team lead. If a request comes back `401`, either the header is missing/malformed or the token was rotated — ask for the current value again.

```
GET /api/streaks
Authorization: Bearer 250f8b83573d68d89d4fb5cef5919be66cbb2149170e68181037584c424c5d1a
```

---

## `GET /streaks/summary` — aggregate stats for the current filters

Use this to render dashboard counters/badges (e.g. "453 streaks · 25 high confidence") without paginating through the whole list.

### Query params (all optional)

| Param | Type | Example | What it does |
|---|---|---|---|
| `streak_min` | integer | `5` | Only include streaks at least this long |
| `streak_max` | integer | `15` | Only include streaks at most this long |
| `confidence_min` | integer | `70` | Only include streaks with confidence ≥ this value |
| `odds_min` | number | `1.5` | Only include streaks whose recommended odd ≥ this value |
| `odds_max` | number | `4.0` | Only include streaks whose recommended odd ≤ this value |
| `markets` | comma-separated | `team_goals,total_corners` | Restrict to one or more markets — valid keys: `team_goals`, `total_goals`, `team_yellow_cards`, `total_yellow_cards`, `team_red_cards`, `total_red_cards`, `team_corners`, `total_corners`, `total_goals_1st_half`, `total_goals_2nd_half` |
| `leagues` | comma-separated ints | `39,140` | Restrict to specific league ids |
| `status` | comma-separated | `live,soon` | Restrict to `live`, `soon`, and/or `upcoming` |
| `date_range` | string | `7days` | One of `today`, `2days`, `7days`, `30days` — filters by match kickoff time |

Unrecognized/invalid values are silently ignored (not an error) — e.g. `markets=fake_market` just means no market filter gets applied.

### Response

```json
{
  "success": true,
  "data": {
    "total": 453,
    "live": 0,
    "avg_confidence": 58.8,
    "high_confidence_count": 25,
    "by_market": {
      "team_goals": 43, "total_goals": 53, "team_yellow_cards": 55,
      "total_yellow_cards": 47, "team_red_cards": 84, "total_red_cards": 86,
      "team_corners": 49, "total_corners": 36
    },
    "by_date": { "today": 31, "2days": 75, "7days": 441, "30days": 453 }
  }
}
```

| Field | Meaning |
|---|---|
| `total` | Count matching all currently-applied filters |
| `live` | Of those, how many have a match in progress right now |
| `avg_confidence` | Average confidence score across the filtered set |
| `high_confidence_count` | Count with confidence ≥ 80 |
| `by_market` | Count per market key |
| `by_date` | Count per date-range bucket |

**Note on `by_market`/`by_date`:** each is computed with its *own* dimension excluded from the filter. So if you're currently filtered to `markets=team_goals`, `by_market.total_goals` still shows the real count for Total Goals (not zero) — this is what lets you render filter badges/pills that stay accurate no matter which one is currently selected.

---

## `GET /streaks` — paginated, filterable, sortable list

### Query params

Everything from `/summary` above, plus:

| Param | Type | Default | What it does |
|---|---|---|---|
| `sort` | string | `top` | See sort values below |
| `page` | integer | `1` | Page number |
| `per_page` | integer | `10` | Items per page, max `50` |

### `sort` values

Every value follows `<field>_<direction>`: `asc` = lowest/soonest first, `desc` = highest/latest first.

| Value | Meaning |
|---|---|
| `top` (default) | Composite ranking: confidence desc, then streak length desc — "best streaks first" |
| `top_asc` | Same composite ranking, reversed — weakest first |
| `confidence_desc` / `confidence_asc` | Sort by confidence score |
| `odds_desc` / `odds_asc` | Sort by the recommended odd's value |
| `kickoff_asc` / `kickoff_desc` | Sort by match kickoff time (soonest first / furthest-out first) |

### Response

```json
{
  "success": true,
  "data": {
    "meta": {
      "total": 453, "page": 1, "per_page": 10, "total_pages": 46,
      "sort": "top",
      "filters_applied": { "status": ["live", "soon"] }
    },
    "data": [ /* array of Streak objects, see below */ ]
  }
}
```

`meta.filters_applied` echoes back exactly what the server understood from your query string — useful for confirming a typo'd param didn't silently get dropped.

### `Streak` object

```json
{
  "id": "streak_921",
  "streak_count": 9,
  "market": { "key": "team_goals", "label": "Team Goals" },
  "prediction": {
    "text": "Arsenal Team Goals over 2.5",
    "threshold": 2.5,
    "direction": "over",
    "average": 3.1,
    "description": "In the last 9 matches, team goals of Arsenal were above average of 3.1."
  },
  "confidence": 85,
  "confidence_label": "High",
  "status": "upcoming",
  "match": {
    "id": "match_1758",
    "date": "2026-07-19T16:00:00.000Z",
    "date_display": "19 Jul · 16:00",
    "league": { "id": 39, "name": "Premier League", "country": "England", "flag": "..." },
    "home": { "id": "team_42", "name": "Arsenal", "short": "ARS", "logo_url": "..." },
    "away": { "id": "team_50", "name": "Chelsea", "short": "CHE", "logo_url": "..." }
  },
  "odds": {
    "home_win": { "value": 1.8, "bookmaker": "bet365", "bookmaker_label": "BET365", "bookmaker_logo": "data:image/png;base64,...", "affiliate_url": "..." },
    "away_win": { "value": 4.2, "bookmaker": "unibet", "bookmaker_label": "UNIBET", "bookmaker_logo": "...", "affiliate_url": "..." },
    "recommended": { "value": 2.3, "bookmaker": "10bet", "bookmaker_label": "10BET", "bookmaker_logo": "...", "affiliate_url": "..." }
  }
}
```

| Field | Meaning |
|---|---|
| `id` | Use this to fetch full detail via `GET /streaks/{id}` |
| `streak_count` | Consecutive qualifying matches (minimum 3 to appear at all) |
| `market` | Which of the tracked markets this streak is about |
| `prediction.text` / `.description` | Ready-to-display copy — no need to build your own sentence from the raw fields |
| `prediction.threshold` / `.direction` / `.average` | The raw numbers behind the prediction, if you want to build custom UI instead of using `text`/`description` |
| `confidence` | 0–100 |
| `confidence_label` | `High` / `Good` / `Moderate` — pre-bucketed for you, see the internal-notes doc for exact thresholds |
| `status` | `live` / `soon` / `upcoming` |
| `match.*` | Everything needed to render the match card without a second request |
| `odds.home_win` / `.away_win` | Best available match-winner price for that side |
| `odds.recommended` | Best available price specifically for this streak's prediction line — this is what you'd link the user to click through on |

Any `odds.*` field can be `null` if no active bookmaker currently has that line priced — always null-check before rendering.

`bookmaker_logo` is a ready-to-use inline image (`data:image/...;base64,...`) — no extra request needed, but it does make the payload heavier. If you'd rather not receive it, ask and we can add an opt-out param.

---

## `GET /streaks/{id}` — full detail for one streak

Path param `id` must look like `streak_921` (server-side format). Passing something malformed returns `400`; a well-formed id that doesn't currently exist as an active streak returns `404` (streaks disappear from here once their match resolves or the underlying streak breaks).

### Response

Everything from the `Streak` object above, plus:

```json
{
  "sample_size": 21,
  "hit_rate": 33,
  "std_deviation": 2.72,
  "history": [
    { "match_id": "match_1357", "date": "2026-02-24", "result": "miss", "value": 14 },
    { "match_id": "match_1372", "date": "2026-03-08", "result": "hit", "value": 6 }
  ],
  "all_odds": [
    { "bookmaker": "bet365", "bookmaker_label": "BET365", "bookmaker_logo": "...", "value": 2.3, "affiliate_url": "..." },
    { "bookmaker": "unibet", "bookmaker_label": "UNIBET", "bookmaker_logo": "...", "value": 2.1, "affiliate_url": "..." }
  ]
}
```

| Field | Meaning |
|---|---|
| `sample_size` | Every match this team has played this season for this market — **not** capped to the streak's own length |
| `hit_rate` | Percentage (0–100, not a 0–1 fraction) of those matches where the prediction would've hit |
| `std_deviation` | Volatility measure of the market's value across those matches (population standard deviation, since `sample_size` is the full season, not a sample of it) — lower means more consistent |
| `history` | Match-by-match results for the **whole season**, oldest → newest, good for a dot-trail / sparkline UI — same length as `sample_size`, not capped |
| `all_odds` | Every active bookmaker's price for this exact prediction, sorted best → worst — use this for a "compare bookmakers" expanded view (the list-endpoint's `odds.recommended` only gives you the single best one) |

---

## `GET /matchup/{streakId}` — both teams' averages, streak, and full match history

Use this for an on-click "matchup" view — `GET /streaks/{id}` only covers evidence for the one team/market the streak is about; this gives you both sides so you can build a full comparison page for the market in question.

Path param `id` is the same `streak_921`-style id — same `400`/`404` rules as `/streaks/{id}`.

### Response

```json
{
  "streak_id": "streak_763",
  "market": { "key": "team_yellow_cards", "label": "Team Yellow Cards" },
  "match": { /* same shape as GET /streaks/{id}, but home/away each also get a "position" field (current league standing) */ },
  "home": {
    "team": { "id": "team_100", "name": "Manta FC", "short": "MF", "logo_url": "..." },
    "season_avg": 2.55,
    "streak": { "count": 9, "direction": "below" },
    "matches": [
      { "match_id": "match_1508", "date": "2026-07-19", "venue": "away", "opponent": { "id": "team_98", "name": "Guayaquil City FC" }, "score": "1-0", "value": 1 }
    ]
  },
  "away": { /* same shape as home */ },
  "chartData": {
    "title": "Team Yellow Cards per match",
    "subtitle": "Manta FC - last 9 games",
    "avg": 2.55,
    "data": [
      { "date": "May 16", "value": 1 },
      { "date": "Jul 19", "value": 1 }
    ]
  },
  "availableBookmakers": [
    { "bookmaker": "bet365", "bookmaker_label": "BET365", "bookmaker_logo": "...", "affiliate_url": "..." }
  ],
  "similarStreaks": {
    "items": [
      {
        "id": "streak_89", "streak_count": 8, "confidence": 84,
        "market": { "key": "team_goals", "label": "Team Goals" },
        "prediction": { "direction": "over", "threshold": 1.5 },
        "home": { "name": "St. Louis City", "logo_url": "..." },
        "away": { "name": "Colorado Rapids", "logo_url": "..." }
      }
    ],
    "otherSimilarStreakCounts": 24
  },
  "statistics": {
    "home": {
      "goals_scored": 1.1, "goals_conceded": 0.95, "goals_1st_half": 0.5, "goals_2nd_half": 0.6,
      "corners": 5.2, "yellow_cards": 2.2, "possession": 50.9, "shots": 12.55, "clean_sheets": 9
    },
    "away": { "goals_scored": 1.14, "goals_conceded": 1.0, "corners": 4.81, "yellow_cards": 1.76, "possession": 48.95, "shots": 12.1, "clean_sheets": 9 },
    "league_avg": { "goals_scored": 1.08, "goals_conceded": 1.08, "corners": 4.4, "yellow_cards": 2.22, "possession": 48.17, "shots": 11.89, "clean_sheets": 6.8 }
  },
  "leagueStandings": {
    "rows": [
      { "position": 2, "team": { "id": "team_44", "name": "Arsenal", "logo_url": "..." }, "points": 55 },
      { "position": 3, "team": { "id": "team_45", "name": "Man City", "logo_url": "..." }, "points": 52 },
      { "position": 4, "team": { "id": "team_46", "name": "Tottenham", "logo_url": "..." }, "points": 48 },
      { "position": 9, "team": { "id": "team_47", "name": "Brighton", "logo_url": "..." }, "points": 30 },
      { "position": 15, "team": { "id": "team_48", "name": "West Ham", "logo_url": "..." }, "points": 18 },
      { "position": 16, "team": { "id": "team_49", "name": "Wolverhampton", "logo_url": "..." }, "points": 16 },
      { "position": 17, "team": { "id": "team_50", "name": "Leicester", "logo_url": "..." }, "points": 14 }
    ],
    "total_teams": 20
  }
}
```

| Field | Meaning |
|---|---|
| `market` | The one market this matchup is scoped to (whichever market the streak was about) |
| `match` | The specific upcoming/live fixture this matchup pertains to |
| `home` / `away` | Full breakdown for each side, see below. Note: these are different from the `home`/`away` nested inside `match` above — `match.home`/`.away` are basic identity + `position`; these top-level ones carry season stats/streak/match history for `market` specifically |
| `<side>.season_avg` | That team's season average for `market`, or `null` if not yet computed |
| `<side>.streak` | That team's current streak for `market` (`count`, `direction`), or `null` if they don't have one — **note this can be a streak shorter than 3**, since it's shown for context here rather than filtered like the main `/streaks` listing |
| `<side>.matches` | Every **finished** match this season, **most recent first**, with the raw stat `value` for `market` in that specific match, who the `opponent` was, `venue` (home/away for that match), and the final `score` |
| `chartData` | Single-team trend chart data — **only the team the streak actually belongs to**, not both sides. `data` has exactly `streak_count` points (no cap), oldest → newest, `date` pre-formatted as `"Nov 23"`. `avg` is that team's season average — draw it as your chart's reference line and compare each point against it client-side (no `above`/`below` flag is sent — you already have both numbers) |
| `availableBookmakers` | Every active bookmaker currently pricing this exact prediction — name, logo, link only, **no odd value** (use `odds.recommended` / `all_odds` on the other endpoints if you need the price) |
| `similarStreaks.items` | Up to 5 other active streaks in the **same market** (any direction/threshold), ranked the same way `/streaks?sort=top` ranks (confidence desc, then streak length desc), excluding the streak you asked for. **Trimmed shape** — only `id`, `streak_count`, `confidence`, `market`, `prediction.direction`/`.threshold`, and `home`/`away.name`/`.logo_url`. Not the full `Streak` object (no odds/match/status/prediction text) — fetch `/streaks/{id}` for that if a card is clicked through |
| `similarStreaks.otherSimilarStreakCounts` | How many more streaks exist in that market beyond the 5 returned — e.g. `24` when the market has 30 total, 5 shown, 1 excluded (the one you're viewing) |
| `statistics.home` / `.away` | Season averages per stat for each team — `goals_scored`, `goals_conceded`, `goals_1st_half`, `goals_2nd_half`, `corners`, `yellow_cards`, `possession` (percentage, not a 0–1 fraction), `shots`, `clean_sheets` (whole-number count here, not an average) |
| `statistics.league_avg` | Same 9 keys, but averaged across every team in the league's current season — use this as the reference/baseline behind each stat's comparison bar. `clean_sheets` here **is** an average (can have a decimal, e.g. `6.8`), unlike the whole-number count on `home`/`away` |
| `leagueStandings.rows` | A **window** of the table, not the full thing — aims for 7 rows total. If both teams sit within the top 7 (or both within the bottom 7), returns that whole 7-row block (e.g. 1st & 2nd, or 2nd & 5th → rows 1–7). Otherwise, each team gets its own 3-row block (1 above + itself + 1 below, shifted to 2-on-the-available-side if the team is at a table edge), plus one **divider row** at the midpoint between the two teams' positions marking roughly what sits between them — e.g. 3rd & 16th → rows `[2,3,4]` + divider `[9]` + rows `[15,16,17]`, 7 rows total. Close/adjacent teams' 3-row blocks overlap and merge into one smaller contiguous block instead (e.g. 14th & 16th → rows 13–17, 5 rows — the divider falls inside the merged block so adds nothing new). For the **full** table, call `GET /standings/{leagueId}` (`match.league.id` in this same response) separately |
| `leagueStandings.total_teams` | Total teams in the league's current season — use this to know how far "Full table →" would actually go |

This is a heavier response than the other endpoints (full-season match history for two teams, plus odds/similar-streaks lookups) — fetch it only when the user actually opens the matchup view, not alongside the list/summary calls.

---

## Logging a click (optional, fire-and-forget)

If you want click analytics on odds chips, `POST /clicks` accepts:

```json
{
  "streak_id": "streak_921",
  "bookmaker": "bet365",
  "click_type": "recommended_odd",
  "country": "GB",
  "session_id": "sess_abc"
}
```

`streak_id`, `bookmaker`, `click_type` are required; `country`/`session_id` are optional. This is entirely optional for the frontend to call — nothing else depends on it. Fire it and don't wait for/handle the response; it returns `202` almost instantly regardless of whether the write succeeds.

---

## `GET /standings/{leagueId}` — current season's league table

Path param `leagueId` is the numeric league id (same one used in `match.league.id` elsewhere in this API, e.g. inside a `Streak` object). Returns `400` for a non-numeric id, `404` if the league doesn't exist or has no current season.

### Response

```json
{
  "league": { "id": 6, "name": "Liga Pro", "country": "Ecuador" },
  "season": { "id": 6, "year": "2026" },
  "standings": [
    {
      "position": 1,
      "team": { "id": "team_92", "name": "Independiente del Valle", "short": null, "logo_url": "..." },
      "played": 21, "won": 17, "drawn": 1, "lost": 3,
      "goals_for": 52, "goals_against": 20, "goal_difference": 32,
      "points": 52
    }
  ]
}
```

Ranked `points` desc → `goal_difference` desc → `goals_for` desc (standard football table tiebreakers; head-to-head record is not factored in).

This is a pure read — the table is precomputed whenever fixtures load or update (same as `TeamSeasonAverage`), not calculated per-request, so it's cheap to call.
