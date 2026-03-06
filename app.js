/* ─── Constants ─────────────────────────────────────────────────────────────── */
const BASE_V1        = 'https://statsapi.mlb.com/api/v1';
const BASE_LIVE      = 'https://ws.statsapi.mlb.com/api/v1.1';
const WBC_SPORT_ID   = 51;
const WBC_START_DATE = '2026-03-01';
const WBC_END_DATE   = '2026-04-15';
const BATCH_SIZE     = 200;

/* ─── WBC Team → Flag Emoji ─────────────────────────────────────────────────── */
const TEAM_FLAGS = {
  'Cuba':                   '🇨🇺',
  'Dominican Republic':     '🇩🇴',
  'Italy':                  '🇮🇹',
  'Japan':                  '🇯🇵',
  'Mexico':                 '🇲🇽',
  'Netherlands':            '🇳🇱',
  'Panama':                 '🇵🇦',
  'Puerto Rico':            '🇵🇷',
  'Taiwan':                 '🇹🇼',
  'United States':          '🇺🇸',
  'Venezuela':              '🇻🇪',
  'Australia':              '🇦🇺',
  'Canada':                 '🇨🇦',
  'Colombia':               '🇨🇴',
  'Czech Republic':         '🇨🇿',
  'Israel':                 '🇮🇱',
  'Great Britain':          '🇬🇧',
  'Nicaragua':              '🇳🇮',
  'South Korea':            '🇰🇷',
};

function flagFor(teamName) {
  if (!teamName) return '';
  // Exact match first
  if (TEAM_FLAGS[teamName]) return TEAM_FLAGS[teamName];
  // Partial match fallback
  for (const [key, flag] of Object.entries(TEAM_FLAGS)) {
    if (teamName.includes(key) || key.includes(teamName)) return flag;
  }
  return '🏳️';
}

/* ─── Module State ──────────────────────────────────────────────────────────── */
let scheduleIndex    = new Map(); // dateString → gamePk[]
let dateCache        = new Map(); // dateString → ProcessedDayData
let playerTeamCache  = new Map(); // personId   → { currentTeamId, currentTeamName }
let mlbTeams         = [];        // sorted array from mlb-teams.json

let selectedDate     = null;
let selectedTeamId   = null;
let currentRequestId = 0;         // race-condition guard

/* ─── Initialization ────────────────────────────────────────────────────────── */
async function init() {
  try {
    const [, schedule] = await Promise.all([
      loadMlbTeams(),
      fetchSchedule(),
    ]);
    populateControls(schedule);
    if (scheduleIndex.size === 0) {
      renderEmpty('No 2026 WBC schedule data is available yet. Check back closer to the tournament.');
    }
    // Trigger initial load with defaults
    if (selectedDate && selectedTeamId) {
      await loadAndRender();
    }
  } catch (err) {
    renderError('Failed to initialize. ' + err.message);
  }
}

/* ─── Load MLB Teams ────────────────────────────────────────────────────────── */
async function loadMlbTeams() {
  const res = await apiFetch('data/mlb-teams.json');
  mlbTeams = res;

  const sel = document.getElementById('team-select');
  sel.innerHTML = '';
  mlbTeams.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = t.name;
    sel.appendChild(opt);
  });
  // Default to New York Yankees if present, otherwise first team
  const yankees = mlbTeams.find(t => t.id === 147);
  sel.value = yankees ? yankees.id : mlbTeams[0].id;
  selectedTeamId = parseInt(sel.value, 10);
}

/* ─── Fetch WBC Schedule ────────────────────────────────────────────────────── */
async function fetchSchedule() {
  const scheduleUrl =
    `${BASE_V1}/schedule` +
    `?sportId=1&sportId=51&sportId=21` +
    `&startDate=${WBC_START_DATE}&endDate=${WBC_END_DATE}` +
    `&gameType=` +
    `&language=en` +
    `&leagueId=103&leagueId=104&leagueId=590&leagueId=160&leagueId=159` +
    `&hydrate=team,linescore,flags,seriesStatus(useOverride=true),statusFlags` +
    `&sortBy=gameDate,gameStatus,gameType` +
    `&timeZone=America/New_York`;

  const data = await apiFetch(scheduleUrl);

  scheduleIndex.clear();
  (data.dates || []).forEach(d => {
    const wbcGamePks = (d.games || [])
      .filter(g => g.sport && g.sport.id === WBC_SPORT_ID)
      .map(g => g.gamePk);
    if (wbcGamePks.length > 0) {
      scheduleIndex.set(d.date, wbcGamePks);
    }
  });
  return data;
}

/* ─── Populate Controls ─────────────────────────────────────────────────────── */
function populateControls(scheduleData) {
  const picker  = document.getElementById('date-picker');
  const teamSel = document.getElementById('team-select');
  const dates   = Array.from(scheduleIndex.keys()).sort();

  if (dates.length > 0) {
    picker.min   = dates[0];
    picker.max   = dates[dates.length - 1];
    picker.value = dates[0];
    selectedDate = dates[0];
  }

  // Always enable controls and attach listeners
  teamSel.disabled = false;
  picker.disabled  = false;

  picker.addEventListener('change', onDateChange);
  teamSel.addEventListener('change', onTeamChange);
}

/* ─── Event Handlers ────────────────────────────────────────────────────────── */
function onDateChange(e) {
  selectedDate = e.target.value;
  loadAndRender();
}

function onTeamChange(e) {
  selectedTeamId = parseInt(e.target.value, 10);
  // If we already have cached data for this date, just re-render
  if (dateCache.has(selectedDate)) {
    renderTable(selectedDate, selectedTeamId);
  } else {
    loadAndRender();
  }
}

/* ─── Main Load + Render Orchestrator ───────────────────────────────────────── */
async function loadAndRender() {
  if (!selectedDate || !selectedTeamId) return;

  const reqId = ++currentRequestId;

  if (dateCache.has(selectedDate)) {
    renderTable(selectedDate, selectedTeamId);
    return;
  }

  setLoading(true);
  try {
    await fetchDayData(selectedDate, reqId);
    if (reqId !== currentRequestId) return; // stale
    renderTable(selectedDate, selectedTeamId);
  } catch (err) {
    if (reqId !== currentRequestId) return;
    renderError('Failed to load data: ' + err.message);
  } finally {
    if (reqId === currentRequestId) setLoading(false);
  }
}

/* ─── Fetch Box Scores for a Date ───────────────────────────────────────────── */
async function fetchDayData(date, reqId) {
  const gamePks = scheduleIndex.get(date);
  if (!gamePks || gamePks.length === 0) {
    // Store empty sentinel so we don't re-fetch
    dateCache.set(date, { players: [], mlbTeamIndex: new Map() });
    return;
  }

  // Fetch all live game feeds for the day in parallel and extract boxscore
  const boxscores = await Promise.all(
    gamePks.map(pk =>
      apiFetch(`${BASE_LIVE}/game/${pk}/feed/live?language=en`)
        .then(data => data.liveData.boxscore)
    )
  );

  if (reqId !== currentRequestId) return;

  // Extract all player records
  const playerMap = new Map(); // personId → PlayerRecord (dedup)
  boxscores.forEach(bs => extractPlayersFromBoxscore(bs, playerMap));

  const players = Array.from(playerMap.values());

  // Batch-fetch MLB org for players not yet cached
  const uncachedIds = players
    .map(p => p.personId)
    .filter(id => !playerTeamCache.has(id));

  if (uncachedIds.length > 0) {
    await batchFetchPlayerTeams(uncachedIds);
  }

  if (reqId !== currentRequestId) return;

  // Apply MLB team info to player records
  players.forEach(p => {
    const teamInfo = playerTeamCache.get(p.personId);
    if (teamInfo) {
      p.currentTeamId   = teamInfo.currentTeamId;
      p.currentTeamName = teamInfo.currentTeamName;
    }
  });

  buildDayCache(date, players);
}

/* ─── Extract Players from a Box Score ─────────────────────────────────────── */
function extractPlayersFromBoxscore(boxscore, playerMap) {
  ['home', 'away'].forEach(side => {
    const teamData = boxscore.teams && boxscore.teams[side];
    if (!teamData) return;

    const wbcTeamName  = teamData.team && teamData.team.name ? teamData.team.name : '';
    const pitchersList = teamData.pitchers  || [];
    const battersList  = teamData.batters   || [];
    const playersDict  = teamData.players   || {};

    Object.values(playersDict).forEach(entry => {
      const person   = entry.person || {};
      const personId = person.id;
      if (!personId) return;

      // Skip players already added (shouldn't happen, but guard anyway)
      if (playerMap.has(personId)) return;

      const batting  = entry.stats && entry.stats.batting  ? entry.stats.batting  : null;
      const pitching = entry.stats && entry.stats.pitching ? entry.stats.pitching : null;

      // Determine batting order (string like "100", "200", etc.)
      const battingOrder = entry.battingOrder ? parseInt(entry.battingOrder, 10) : null;

      // Determine pitcher index in the appearance order array
      const pitcherIndex = pitchersList.indexOf(personId);

      // Has meaningful batting stats?
      const hasBatting  = batting  && (batting.plateAppearances > 0 || batting.atBats > 0);
      // Has meaningful pitching stats?
      const hasPitching = pitching && (
        typeof pitching.outs === 'number' ? pitching.outs > 0
          : pitching.inningsPitched && pitching.inningsPitched !== '0.0' && pitching.inningsPitched !== '0'
      );

      const isTwoWay = hasBatting && hasPitching;

      playerMap.set(personId, {
        personId,
        fullName:       person.fullName || 'Unknown',
        wbcTeam:        wbcTeamName,
        battingOrder,
        pitcherIndex,
        batting:        hasBatting  ? batting  : null,
        pitching:       hasPitching ? pitching : null,
        isTwoWay,
        currentTeamId:   null,
        currentTeamName: null,
      });
    });
  });
}

/* ─── Batch-Fetch MLB Organization ─────────────────────────────────────────── */
async function batchFetchPlayerTeams(personIds) {
  const chunks = [];
  for (let i = 0; i < personIds.length; i += BATCH_SIZE) {
    chunks.push(personIds.slice(i, i + BATCH_SIZE));
  }

  const results = await Promise.all(
    chunks.map(ids => apiFetch(`${BASE_V1}/people?personIds=${ids.join(',')}`))
  );

  results.forEach(data => {
    (data.people || []).forEach(p => {
      playerTeamCache.set(p.id, {
        currentTeamId:   p.currentTeam ? p.currentTeam.id   : null,
        currentTeamName: p.currentTeam ? p.currentTeam.name : null,
      });
    });
  });
}

/* ─── Build Day Cache ───────────────────────────────────────────────────────── */
function buildDayCache(date, players) {
  const mlbTeamIndex = new Map();
  players.forEach(p => {
    if (!p.currentTeamId) return;
    if (!mlbTeamIndex.has(p.currentTeamId)) {
      mlbTeamIndex.set(p.currentTeamId, []);
    }
    mlbTeamIndex.get(p.currentTeamId).push(p);
  });
  dateCache.set(date, { players, mlbTeamIndex });
}

/* ─── Render ────────────────────────────────────────────────────────────────── */
function renderTable(date, teamId) {
  const results = document.getElementById('results');
  const dayData  = dateCache.get(date);

  if (!dayData) {
    renderEmpty('No data available for this date.');
    return;
  }

  if (!scheduleIndex.has(date) || scheduleIndex.get(date).length === 0) {
    results.innerHTML = `<div class="empty-state"><p>No WBC games were played on ${formatDate(date)}.</p></div>`;
    return;
  }

  const teamPlayers = dayData.mlbTeamIndex.get(teamId) || [];
  const teamName    = (mlbTeams.find(t => t.id === teamId) || {}).name || 'this team';

  if (teamPlayers.length === 0) {
    results.innerHTML = `<div class="empty-state"><p>No players from the ${teamName} appeared in WBC games on ${formatDate(date)}.</p></div>`;
    return;
  }

  // Split into position players (batted) and pitchers (pitched)
  const posPlayers = teamPlayers
    .filter(p => p.batting !== null)
    .sort((a, b) => {
      // Starters (battingOrder set) before bench
      const aOrd = a.battingOrder !== null ? a.battingOrder : 9999;
      const bOrd = b.battingOrder !== null ? b.battingOrder : 9999;
      if (aOrd !== bOrd) return aOrd - bOrd;
      return a.fullName.localeCompare(b.fullName);
    });

  const pitchers = teamPlayers
    .filter(p => p.pitching !== null)
    .sort((a, b) => {
      const aIdx = a.pitcherIndex >= 0 ? a.pitcherIndex : 9999;
      const bIdx = b.pitcherIndex >= 0 ? b.pitcherIndex : 9999;
      if (aIdx !== bIdx) return aIdx - bIdx;
      return a.fullName.localeCompare(b.fullName);
    });

  let html = '';

  if (posPlayers.length > 0) {
    html += `
      <div class="stat-section">
        <div class="stat-section-header">
          <span class="section-icon">⚾</span> Position Players
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th class="col-name">Player</th>
                <th class="col-team">WBC Team</th>
                <th>AB</th>
                <th>R</th>
                <th>H</th>
                <th>2B</th>
                <th>3B</th>
                <th>HR</th>
                <th>RBI</th>
                <th>BB</th>
                <th>SO</th>
                <th>AVG</th>
              </tr>
            </thead>
            <tbody>
              ${posPlayers.map(p => buildBattingRow(p)).join('')}
            </tbody>
          </table>
        </div>
      </div>`;
  }

  if (pitchers.length > 0) {
    html += `
      <div class="stat-section">
        <div class="stat-section-header">
          <span class="section-icon">🥎</span> Pitchers
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th class="col-name">Player</th>
                <th class="col-team">WBC Team</th>
                <th>IP</th>
                <th>H</th>
                <th>R</th>
                <th>ER</th>
                <th>BB</th>
                <th>SO</th>
                <th>HR</th>
                <th>ERA</th>
              </tr>
            </thead>
            <tbody>
              ${pitchers.map(p => buildPitchingRow(p)).join('')}
            </tbody>
          </table>
        </div>
      </div>`;
  }

  results.innerHTML = html;
}

/* ─── Row Builders ──────────────────────────────────────────────────────────── */
function buildBattingRow(p) {
  const b    = p.batting;
  const ab   = b.atBats      ?? 0;
  const r    = b.runs        ?? 0;
  const h    = b.hits        ?? 0;
  const d    = b.doubles     ?? 0;
  const t    = b.triples     ?? 0;
  const hr   = b.homeRuns    ?? 0;
  const rbi  = b.rbi         ?? 0;
  const bb   = b.baseOnBalls ?? b.walks ?? 0;
  const so   = b.strikeOuts  ?? 0;
  const avg  = fmtAvg(h, ab);

  return `
    <tr>
      <td class="col-name">${escHtml(p.fullName)}${p.isTwoWay ? ' <span class="badge-twoway">2-way</span>' : ''}</td>
      <td class="col-team">${wbcTeamCell(p.wbcTeam)}</td>
      <td>${ab}</td>
      <td>${r}</td>
      <td${h > 0 ? ' class="stat-highlight"' : ''}>${h}</td>
      <td>${d}</td>
      <td>${t}</td>
      <td${hr > 0 ? ' class="stat-highlight"' : ''}>${hr}</td>
      <td>${rbi}</td>
      <td>${bb}</td>
      <td>${so}</td>
      <td>${avg}</td>
    </tr>`;
}

function buildPitchingRow(p) {
  const pi   = p.pitching;
  const ip   = pi.inningsPitched ?? fmtIP(pi.outs ?? 0);
  const h    = pi.hits           ?? 0;
  const r    = pi.runs           ?? 0;
  const er   = pi.earnedRuns     ?? 0;
  const bb   = pi.baseOnBalls    ?? pi.walks ?? 0;
  const so   = pi.strikeOuts     ?? 0;
  const hr   = pi.homeRuns       ?? 0;
  const era  = pi.era !== undefined ? fmtStat(pi.era) : fmtERA(er, pi.outs ?? outsFromIP(ip));

  return `
    <tr>
      <td class="col-name">${escHtml(p.fullName)}${p.isTwoWay ? ' <span class="badge-twoway">2-way</span>' : ''}</td>
      <td class="col-team">${wbcTeamCell(p.wbcTeam)}</td>
      <td>${ip}</td>
      <td>${h}</td>
      <td>${r}</td>
      <td>${er}</td>
      <td>${bb}</td>
      <td${so > 0 ? ' class="stat-highlight"' : ''}>${so}</td>
      <td>${hr}</td>
      <td>${era}</td>
    </tr>`;
}

function wbcTeamCell(teamName) {
  const flag = flagFor(teamName);
  return `<span class="wbc-team"><span class="wbc-flag">${flag}</span>${escHtml(teamName)}</span>`;
}

/* ─── Stat Formatting Helpers ───────────────────────────────────────────────── */
function fmtAvg(hits, atBats) {
  if (atBats === 0) return '---';
  const avg = hits / atBats;
  return avg === 1 ? '1.000' : avg.toFixed(3).replace(/^0/, '');
}

function fmtIP(outs) {
  return `${Math.floor(outs / 3)}.${outs % 3}`;
}

function outsFromIP(ipStr) {
  if (!ipStr) return 0;
  const [full, frac = '0'] = String(ipStr).split('.');
  return (parseInt(full, 10) * 3) + parseInt(frac, 10);
}

function fmtERA(earnedRuns, outs) {
  if (outs === 0) return '---';
  return ((earnedRuns / outs) * 27).toFixed(2);
}

function fmtStat(val) {
  if (val === undefined || val === null) return '---';
  const n = parseFloat(val);
  if (isNaN(n)) return String(val);
  return n.toFixed(2);
}

/* ─── UI State Helpers ──────────────────────────────────────────────────────── */
function setLoading(on) {
  const controls = document.getElementById('controls');
  controls.classList.toggle('is-loading', on);
  if (on) {
    document.getElementById('results').innerHTML = `
      <div class="loading-state">
        <div class="spinner"></div>
        <p>Loading box scores…</p>
      </div>`;
  }
}

function renderError(msg) {
  document.getElementById('results').innerHTML = `
    <div class="error-state">
      <p>${escHtml(msg)}</p>
      <button class="retry-btn" onclick="loadAndRender()">Retry</button>
    </div>`;
}

function renderEmpty(msg) {
  document.getElementById('results').innerHTML = `
    <div class="empty-state"><p>${escHtml(msg)}</p></div>`;
}

/* ─── Generic Fetch Wrapper ─────────────────────────────────────────────────── */
async function apiFetch(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.json();
}

/* ─── Misc Utilities ────────────────────────────────────────────────────────── */
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDate(isoDate) {
  const [y, m, d] = isoDate.split('-');
  const dt = new Date(+y, +m - 1, +d);
  return dt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

/* ─── Boot ──────────────────────────────────────────────────────────────────── */
init();
