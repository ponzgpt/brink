import {
  BOLT,
  SCENARIOS,
  advance,
  assess,
  outcomeOf,
  startMatch,
  type BrinkEvent,
  type Match,
  type Order,
  type PowerId,
  type StrikeOption,
} from '../engine/index.js';
import { clunk, detonation, isMuted, klaxon, raiseBed, setMuted, startBed } from './audio.js';
import type { Globe, Marker, Shape } from './globe.js';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

const SIDES: PowerId[] = ['USA', 'RUS', 'PRK'];
const PHOSPHOR: Record<PowerId, number> = { USA: 0xe8a33d, RUS: 0x5ddc7a, PRK: 0x63b8f5 };
/** Circle, triangle, square for the belligerents; diamond for everyone watching. */
const SHAPE: Record<PowerId, Shape> = { USA: 0, RUS: 1, PRK: 2 };
const shapeOf = (p: PowerId): Shape => SHAPE[p] ?? 3;

/** Cities and revealed launch units as plot markers. Pure mapping, kept out of
 *  globe.ts so importing it does not drag three.js onto the critical path. */
function markersFor(st: Match['state']): Marker[] {
  const out: Marker[] = [];
  for (const c of st.cities)
    out.push({
      at: c.at,
      shape: shapeOf(c.power),
      size: 2.6 + Math.sqrt(c.pop) * 0.75,
      alive: c.pop > 0 ? c.popRemaining / c.pop : 1,
    });
  for (const [pid, p] of Object.entries(st.powers))
    for (const u of p.units)
      if (u.revealed)
        out.push({ at: u.at, shape: shapeOf(pid), size: 3.2, alive: u.alive ? 1 : 0 });
  return out;
}

interface Session {
  match: Match;
  you: PowerId;
  pending: Order;
  timer: number | null;
  logged: number;
  option: StrikeOption;
  target: PowerId;
  /** Once the player picks a target themselves, stop following the assessment. */
  targetTouched: boolean;
}

let s: Session | null = null;
let globe: Globe | null = null;
let side: PowerId = 'USA';

/* ---------- menu ---------- */

function renderMenu(): void {
  $('cards').innerHTML = SCENARIOS.map(
    (sc) => `
    <li>
      <button class="card" data-id="${sc.id}" type="button" ${sc.playable ? '' : 'disabled'}>
        <span class="card-n">${sc.name}</span>
        <span class="card-b">${sc.blurb}</span>
        <span class="card-tag">${sc.playable ? 'PLAYABLE · 26 MIN' : 'IN DEVELOPMENT'}</span>
      </button>
    </li>`,
  ).join('');
  for (const b of document.querySelectorAll<HTMLButtonElement>('.card')) {
    b.addEventListener('click', () => {
      if (b.dataset['id'] === BOLT.id) void open();
    });
  }

  $('sides').innerHTML = SIDES.map(
    (p) => `<button type="button" data-side="${p}" aria-pressed="${p === side}">${p}</button>`,
  ).join('');
  for (const b of $('sides').querySelectorAll<HTMLButtonElement>('button')) {
    b.addEventListener('click', () => {
      side = b.dataset['side'] as PowerId;
      document.body.dataset['side'] = side;
      renderMenu();
    });
  }

  const sound = $<HTMLButtonElement>('sound');
  sound.textContent = isMuted() ? 'Sound off' : 'Sound on';
  sound.setAttribute('aria-pressed', String(!isMuted()));
}

$('sound').addEventListener('click', () => {
  setMuted(!isMuted());
  renderMenu();
});

// Browsers will not start audio before a gesture, so the bed waits for one.
for (const ev of ['pointerdown', 'keydown'] as const) {
  window.addEventListener(ev, () => startBed(), { once: true });
}

/* ---------- opening ---------- */

async function open(): Promise<void> {
  startBed();
  klaxon();
  $('menu').hidden = true;
  $('opening-text').textContent = BOLT.opening;
  $('opening').hidden = false;
  await wait(5200);
  $('opening').hidden = true;
  await begin();
}

/* ---------- crisis ---------- */

async function begin(): Promise<void> {
  const other = SIDES.find((p) => p !== side)!;
  s = {
    match: startMatch(BOLT, side, `web-${Date.now()}`),
    you: side,
    pending: { kind: 'HOLD' },
    timer: null,
    logged: 0,
    option: 'LIMITED',
    target: other,
    targetTouched: false,
  };
  document.body.dataset['side'] = side;
  $('crt-side').textContent = side;
  $('record').hidden = true;
  $('terminal').hidden = false;

  if (!globe) {
    const mod = await import('./globe.js');
    globe = new mod.Globe($<HTMLCanvasElement>('globe'));
    window.addEventListener('resize', () => globe?.resize());
    requestAnimationFrame(frame);
  }
  globe.resize();
  globe.setPhosphor(PHOSPHOR[side] ?? 0xe8a33d);
  globe.setSpin(false);
  const home = s.match.state.cities.find((c) => c.power === side);
  if (home) globe.focusOn(home.at.lat, home.at.lon);

  $('key').innerHTML =
    SIDES.map((p) => `<span><i>${['●', '▲', '■'][SHAPE[p] ?? 3]}</i>${p}</span>`).join('') +
    '<span><i>◆</i>OTHERS</span>';
  $('tray-targets').innerHTML = SIDES.filter((p) => p !== side)
    .map(
      (p) => `<button type="button" data-t="${p}" aria-pressed="${p === s!.target}">${p}</button>`,
    )
    .join('');
  for (const b of $('tray-targets').querySelectorAll<HTMLButtonElement>('button')) {
    b.addEventListener('click', () => {
      if (!s) return;
      s.target = b.dataset['t'] as PowerId;
      s.targetTouched = true;
      select();
    });
  }

  paint();
  drain();
  s.timer = window.setInterval(tick, s.match.state.config.tickMs);
}

/** The clock does not wait. A minute passes whether or not an order was given. */
function tick(): void {
  if (!s || s.match.state.over) return;
  s.match = advance(s.match, s.pending);
  s.pending = { kind: 'HOLD' };
  paint();
  drain();
  if (s.match.state.over) {
    if (s.timer !== null) clearInterval(s.timer);
    s.timer = null;
    raiseBed(0.07, 2);
    window.setTimeout(finish, 900);
  }
}

const queue = (o: Order): void => {
  if (!s || s.match.state.over) return;
  s.pending = o;
  clunk(o.kind === 'TURN_KEYS' ? 90 : 190);
  paint();
};

function select(): void {
  if (!s) return;
  queue({ kind: 'SELECT_OPTION', option: s.option, target: s.target });
}

/** Follow the assessment's attribution until the player overrides it. Defaulting
 *  to an arbitrary power would hand them the wrong country by accident, which is
 *  a different mistake from the one this scenario is about. */
function syncTarget(): void {
  if (!s || s.targetTouched) return;
  const attributed = assess(s.match.state, s.you).attributed;
  if (attributed && attributed !== s.you && SIDES.includes(attributed)) s.target = attributed;
}

/* ---------- painting ---------- */

const STAGE_INDEX = { STOWED: 0, OPEN: 1, AUTHENTICATED: 2, SELECTED: 3, RELEASED: 4 } as const;

function paint(): void {
  if (!s || !globe) return;
  const st = s.match.state;
  const me = st.powers[s.you]!;
  const a = assess(st, s.you);
  const left = Math.max(0, st.config.maxTicks - st.tick);
  syncTarget();

  const clock = $('clock');
  clock.textContent = left > 0 ? `T-${String(left).padStart(2, '0')}:00` : 'WINDOW CLOSED';
  clock.dataset['low'] = left <= 8 ? '1' : '0';

  $('ro-assess').dataset['posture'] = a.posture;
  $('assess-line').textContent = left === 0 ? 'Decision window closed' : a.line;
  $('assess-sub').textContent =
    left === 0 ? 'Weapons already in flight are still arriving.' : a.detail;

  $<HTMLElement>('tl-fill').style.width = `${Math.min(100, (st.tick / st.config.maxTicks) * 100)}%`;
  $('tl-marks').innerHTML = ['T-26', 'T-20', 'T-13', 'T-06', 'IMPACT']
    .map((m) => `<span>${m}</span>`)
    .join('');

  const at = STAGE_INDEX[me.release.stage];
  const pendingStep =
    s.pending.kind === 'OPEN_FOOTBALL'
      ? 1
      : s.pending.kind === 'AUTHENTICATE'
        ? 2
        : s.pending.kind === 'SELECT_OPTION'
          ? 3
          : s.pending.kind === 'TURN_KEYS'
            ? 4
            : 0;
  const shut = st.over || left === 0;
  for (const n of [1, 2, 3, 4] as const) {
    const b = $<HTMLButtonElement>(`s${n}`);
    b.dataset['done'] = at >= n || pendingStep === n ? '1' : '0';
    b.disabled = shut || at >= n || at < n - 1;
  }
  $<HTMLButtonElement>('sdown').disabled = shut || at === 0 || at === 4;
  $('tray').hidden = shut || at < 2 || at === 4;
  for (const b of $('tray').querySelectorAll<HTMLButtonElement>('[data-opt]'))
    b.setAttribute('aria-pressed', String(b.dataset['opt'] === s.option));
  for (const b of $('tray-targets').querySelectorAll<HTMLButtonElement>('button'))
    b.setAttribute('aria-pressed', String(b.dataset['t'] === s.target));

  globe.setMarkers(markersFor(st));
}

function drain(): void {
  if (!s) return;
  const fresh = s.match.events.slice(s.logged);
  s.logged = s.match.events.length;
  for (const e of fresh) {
    if (e.type === 'launch') globe?.focusOn(e.payload.origin.lat, e.payload.origin.lon);
    if (e.type === 'impact') {
      const c = s.match.state.cities.find((x) => x.id === e.payload.targetId);
      if (c) globe?.blast(c.at.lat, c.at.lon);
      detonation();
    }
    const entry = line(e, s.you);
    if (!entry) continue;
    const list = $(entry.own ? 'log-own' : 'log-threat');
    const li = document.createElement('li');
    if (entry.hot) li.className = 'hot';
    li.innerHTML = `<span>${String(e.t).padStart(2, '0')}'</span>${entry.text}`;
    list.prepend(li);
    while (list.children.length > 30) list.lastChild?.remove();
  }
}

/** Two logs: what they appear to be doing, and what you have done about it. */
function line(e: BrinkEvent, you: PowerId): { text: string; own: boolean; hot?: boolean } | null {
  switch (e.type) {
    case 'warning':
      return e.payload.seenBy === you
        ? {
            text: `Track inbound ${e.payload.destGuess} · ${e.payload.originGuess ?? 'origin unresolved'} · ${e.payload.confidence.toLowerCase()} · ${e.payload.etaTicks}m`,
            own: false,
          }
        : null;
    case 'launch':
      return e.payload.from === you
        ? {
            text: `AWAY — ${e.payload.warheads} warheads at ${e.payload.targetPower}, impact ${e.payload.impactAt}'. No recall.`,
            own: true,
            hot: true,
          }
        : { text: `Launch detected from ${e.payload.from}`, own: false, hot: true };
    case 'impact':
      return {
        text: `Detonations on ${e.payload.targetPower} — ${e.payload.popKilled}M`,
        own: false,
        hot: true,
      };
    case 'release_stage':
      return e.payload.power === you
        ? { text: `Authorisation ${e.payload.to.toLowerCase().replace('_', ' ')}`, own: true }
        : null;
    case 'invalid_order':
      return e.payload.power === you ? { text: `Refused — ${e.payload.reason}`, own: true } : null;
    default:
      return null;
  }
}

/* ---------- record ---------- */

function finish(): void {
  if (!s) return;
  const o = outcomeOf(s.match.state, s.match.events);
  const head: Record<string, string> = {
    HELD: 'You held.',
    STRUCK_AND_HELD: 'You were struck, and did not answer.',
    RELEASED: 'You released.',
    EXCHANGE: 'General exchange.',
  };
  $('rec-head').textContent = head[o.verdict] ?? o.verdict;
  $('rec-dead').textContent = o.deadM > 0 ? `${o.deadM.toFixed(1)} million dead.` : 'No one died.';
  $('rec-note').textContent = o.youFiredOnFalseWarning
    ? 'Your release followed a warning that was of nothing.'
    : o.minutesToDecide !== null
      ? `You turned the keys at minute ${o.minutesToDecide} of ${s.match.state.config.maxTicks}.`
      : 'Authorisation was never completed.';
  $('rec-table').innerHTML = o.rows
    .map(
      (r) =>
        `<tr${r.power === s!.you ? ' class="you"' : ''}><th>${r.power}</th><td>${r.populationPct}% alive</td><td>${r.warheadsReleased} released</td></tr>`,
    )
    .join('');
  $('record').hidden = false;
}

/* ---------- plumbing ---------- */

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (s && globe) {
    const st = s.match.state;
    globe.setTraces(st.traces, (t) => {
      const span = t.impactAt - t.launchedAt;
      return span <= 0 ? 1 : Math.max(0, Math.min(1, (st.tick - t.launchedAt) / span));
    });
    globe.render(dt);
  }
  requestAnimationFrame(frame);
}

$('s1').addEventListener('click', () => queue({ kind: 'OPEN_FOOTBALL' }));
$('s2').addEventListener('click', () => queue({ kind: 'AUTHENTICATE' }));
$('s3').addEventListener('click', () => select());
$('s4').addEventListener('click', () => queue({ kind: 'TURN_KEYS' }));
$('sdown').addEventListener('click', () => queue({ kind: 'STAND_DOWN' }));
for (const b of $('tray').querySelectorAll<HTMLButtonElement>('[data-opt]')) {
  b.addEventListener('click', () => {
    if (!s) return;
    s.option = b.dataset['opt'] as StrikeOption;
    select();
  });
}
$('rec-again').addEventListener('click', () => void begin());
$('rec-menu').addEventListener('click', () => {
  if (s?.timer !== null && s?.timer !== undefined) clearInterval(s.timer);
  s = null;
  $('record').hidden = true;
  $('terminal').hidden = true;
  $('menu').hidden = false;
});

renderMenu();
