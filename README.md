# WBC Aggregator

A web app that shows MLB player statistics from the 2026 World Baseball Classic, filtered by MLB organization.

## What It Does

Select an MLB team and a date to see box scores for WBC games played that day, showing only the players who belong to that MLB organization. Position player batting stats and pitcher stats are displayed in separate tables.

## Usage

Open `index.html` in a browser (or serve via any static HTTP server), pick an MLB team from the dropdown, then pick a date. The app fetches live data from the MLB Stats API.

## Tech Stack

- Vanilla JavaScript (ES6+), HTML5, CSS3
- No build tools, no dependencies, no frameworks
- External API: [MLB Stats API](https://statsapi.mlb.com/api/v1) (WBC sport ID: 51, season: 2026)

## Project Structure

```
├── app.js            # Main application logic
├── index.html        # Page structure
├── style.css         # Styles (responsive, mobile-friendly)
└── data/
    └── mlb-teams.json  # Static list of all 30 MLB teams with IDs
```

## Local Development

No install step required. Just open `index.html` directly in a browser, or serve it with any static server:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

Edit `app.js`, `index.html`, or `style.css` and reload the page to see changes.

## Deployment

Pushes to `main` automatically deploy via GitHub Actions (`.github/workflows/deploy.yml`) using SCP to the configured remote server. Required GitHub secrets:

| Secret | Description |
|--------|-------------|
| `FTP_SERVER` | SSH host |
| `FTP_USERNAME` | SSH username |
| `FTP_PASSWORD` | SSH password |
| `DEPLOY_PATH` | Target directory on the server |
