# CLAUDE.md

## Project Overview

WBC Aggregator is a static single-page app that aggregates 2026 World Baseball Classic player stats by MLB organization. It fetches live data from the MLB Stats API with no build step or server-side runtime.

## Architecture

All logic lives in `app.js` (~556 lines). There is no framework, no bundler, and no npm. Changes take effect on page reload.

**Data flow:**

1. On load, `fetchSchedule()` requests the full WBC season schedule from the MLB Stats API (sport ID 51, season 2026) and builds a `scheduleIndex` mapping dates to game IDs.
2. When the user selects a date, `fetchDayData()` calls `getBoxscore()` for each game, extracts player stats via `extractPlayersFromBoxscore()`, then calls `batchFetchPlayerTeams()` to resolve each player's current MLB organization.
3. `renderTable()` splits players into position players and pitchers and renders them into two separate HTML tables.

**Caching:** Three in-memory caches prevent redundant API calls within a session: `scheduleIndex`, `dateCache` (per-date player data), and `playerTeamCache` (per-player MLB org).

**Race condition guard:** `currentRequestId` is incremented on each user action; async callbacks check it before committing results to the DOM.

## Key Files

| File | Purpose |
|------|---------|
| `app.js` | All application logic |
| `index.html` | Page shell and dropdown markup |
| `style.css` | Styles; responsive breakpoint at 600px |
| `data/mlb-teams.json` | Static list of all 30 MLB teams (IDs + abbreviations) |
| `.github/workflows/deploy.yml` | CI/CD: SCP deploy to remote server on push to `main` |

## External API

Base URL: `https://statsapi.mlb.com/api/v1`

- **Schedule:** `GET /schedule?sportId=51&season=2026&gameType=I&startDate=...&endDate=...`
- **Box score:** `GET /game/{gameId}/boxscore`
- **Player lookup:** `GET /people?personIds=...&hydrate=currentTeam`

The WBC uses sport ID 51. If the `gameType=I` filter returns no games, the app retries without it.

## Common Tasks

**Add a stat column:** Update `extractPlayersFromBoxscore()` to capture the stat, add it to the player object, then update `renderTable()` to include the column header and cell.

**Support a new WBC country flag:** Add an entry to the `wbcTeamFlags` object in `app.js`. Keys are matched exactly first, then by substring.

**Change the season year:** Update the `season` parameter in the `fetchSchedule()` API call and anywhere else `2026` appears in `app.js`.

**Adjust caching:** The three cache objects (`scheduleIndex`, `dateCache`, `playerTeamCache`) are module-level variables. They reset on page reload; there is no persistent storage.

## Code Style

- Vanilla ES6+ (no TypeScript, no transpilation)
- Async/await throughout
- HTML output escaped via `escapeHtml()` to prevent XSS
- No linter configured; keep existing style consistent (2-space indent, single quotes)

## Deployment

Merging to `main` triggers the GitHub Actions workflow, which SCPs all files (excluding `.git/`) to the remote server. The workflow uses four repository secrets: `FTP_SERVER`, `FTP_USERNAME`, `FTP_PASSWORD`, `DEPLOY_PATH`.
