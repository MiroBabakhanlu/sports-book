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
| `markets` | comma-separated | `team_goals,total_corners` | Restrict to one or more markets — valid keys: `team_goals`, `total_goals`, `team_yellow_cards`, `total_yellow_cards`, `team_red_cards`, `total_red_cards`, `team_corners`, `total_corners` |
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
| `market` | Which of the 8 tracked markets this streak is about |
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
  "sample_size": 9,
  "hit_rate": 0.89,
  "std_deviation": 1.05,
  "history": [
    { "match_id": "match_1701", "date": "2026-05-02", "result": "hit", "value": 3 },
    { "match_id": "match_1712", "date": "2026-05-09", "result": "hit", "value": 4 }
  ],
  "all_odds": [
    { "bookmaker": "bet365", "bookmaker_label": "BET365", "bookmaker_logo": "...", "value": 2.3, "affiliate_url": "..." },
    { "bookmaker": "unibet", "bookmaker_label": "UNIBET", "bookmaker_logo": "...", "value": 2.1, "affiliate_url": "..." }
  ]
}
```

| Field | Meaning |
|---|---|
| `sample_size` | How many past matches the stats below are based on |
| `hit_rate` | Fraction (0–1) of those matches where the prediction would've hit — multiply by 100 for a percentage |
| `std_deviation` | Volatility measure of the market's value across those matches — lower means more consistent |
| `history` | Match-by-match results, oldest → newest, good for a dot-trail / sparkline UI |
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
  "match": { /* same match object shape as GET /streaks/{id} */ },
  "home": {
    "team": { "id": "team_100", "name": "Manta FC", "short": "MF", "logo_url": "..." },
    "season_avg": 2.55,
    "streak": { "count": 9, "direction": "below" },
    "matches": [
      { "match_id": "match_1508", "date": "2026-07-19", "venue": "away", "opponent": { "id": "team_98", "name": "Guayaquil City FC" }, "score": "1-0", "value": 1 }
    ]
  },
  "away": { /* same shape as home */ }
}
```

| Field | Meaning |
|---|---|
| `market` | The one market this matchup is scoped to (whichever market the streak was about) |
| `match` | The specific upcoming/live fixture this matchup pertains to |
| `home` / `away` | Full breakdown for each side, see below |
| `<side>.season_avg` | That team's season average for `market`, or `null` if not yet computed |
| `<side>.streak` | That team's current streak for `market` (`count`, `direction`), or `null` if they don't have one — **note this can be a streak shorter than 3**, since it's shown for context here rather than filtered like the main `/streaks` listing |
| `<side>.matches` | Every **finished** match this season, **most recent first**, with the raw stat `value` for `market` in that specific match, who the `opponent` was, `venue` (home/away for that match), and the final `score` |

This is a heavier response than the other endpoints (full-season match history for two teams) — fetch it only when the user actually opens the matchup view, not alongside the list/summary calls.

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
