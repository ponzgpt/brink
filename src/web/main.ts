import {
  AGENTS,
  SCENARIOS,
  advance,
  advise,
  byPopulation,
  observe,
  outcomeOf,
  startMatch,
  type Defcon,
  type DoctrineName,
  type Match,
  type Order,
  type PowerId,
  type ScenarioDef,
  type Verdict,
} from '../engine/index.js';
import { describe } from './describe.js';
import type { Globe } from './globe.js';
import { initTooltips } from './tooltip.js';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

const OPPONENT: DoctrineName = 'PARANOID';

interface Session {
  scenario: ScenarioDef;
  match: Match;
  you: PowerId;
  pending: Order[];
  paused: boolean;
  timer: number | null;
  shown: Set<string>;
  logged: number;
}

let s: Session | null = null;
let globe: Globe | null = null;
let chosen: ScenarioDef | null = null;

/* ---------- 1. choose ---------- */

function renderStart(): void {
  $('scenario-list').innerHTML = Object.values(SCENARIOS)
    .map(
      (sc) => `
      <li>
        <button class="scenario" data-id="${sc.id}" type="button">
          <span class="scenario-name">${sc.name}</span>
          <span class="scenario-time">${estimate(sc)}</span>
          <span class="scenario-sum">${sc.summary}</span>
        </button>
      </li>`,
    )
    .join('');
  for (const b of document.querySelectorAll<HTMLButtonElement>('.scenario')) {
    b.addEventListener('click', () => brief(SCENARIOS[b.dataset['id']!]!));
  }
}

const estimate = (sc: ScenarioDef): string => {
  const ms = (sc.config.maxTicks ?? 60) * (sc.config.tickMs ?? 2600);
  return `${Math.max(1, Math.round(ms / 60000))} min`;
};

/* ---------- 2. brief ---------- */

function brief(sc: ScenarioDef): void {
  chosen = sc;
  $('brief-name').textContent = sc.name;
  $('brief-summary').textContent = sc.summary;
  $('brief-teaches').textContent = sc.teaches;
  $<HTMLSelectElement>('sel-power').innerHTML = sc.powers
    .map((p) => `<option value="${p}">${p}</option>`)
    .join('');
  show('brief');
}

/* ---------- 3. crisis ---------- */

async function begin(): Promise<void> {
  if (!chosen) return;
  const you = $<HTMLSelectElement>('sel-power').value;
  s = {
    scenario: chosen,
    match: startMatch(chosen, `web-${Date.now()}`),
    you,
    pending: [],
    paused: false,
    timer: null,
    shown: new Set(),
    logged: 0,
  };
  show('crisis');
  if (!globe) {
    // A third of the download, and only needed once someone actually plays.
    const { Globe } = await import('./globe.js');
    globe = new Globe($<HTMLCanvasElement>('globe'));
    window.addEventListener('resize', () => globe?.resize());
    requestAnimationFrame(frame);
  }
  globe.resize();
  globe.setSpin(false);
  globe.setCities(s.match.state.cities);
  const home = s.match.state.cities.find((c) => c.power === you);
  if (home) globe.focusOn(home.at.lat, home.at.lon);
  $('board-title').textContent = s.scenario.name.toUpperCase();
  paint();
  drain();
  resume();
}

function resume(): void {
  if (!s || s.timer !== null) return;
  s.timer = window.setInterval(tick, s.match.state.config.tickMs);
  $('act-pause').textContent = 'Pause';
}

function halt(): void {
  if (!s || s.timer === null) return;
  clearInterval(s.timer);
  s.timer = null;
  $('act-pause').textContent = 'Resume';
}

/** The clock is the opponent: a minute passes whether or not an order was given. */
function tick(): void {
  if (!s || s.match.state.over) return;
  const orders: Record<PowerId, Order[]> = {
    [s.you]: s.pending.length ? s.pending : [{ kind: 'HOLD' }],
  };
  for (const p of Object.keys(s.match.state.powers)) {
    if (p !== s.you) orders[p] = AGENTS[OPPONENT].decide(s.match.state, p);
  }
  s.pending = [];
  s.match = advance(s.match, orders);
  paint();
  drain();
  if (s.match.state.over) {
    halt();
    finish();
  }
}

function order(o: Order): void {
  if (!s || s.match.state.over) return;
  if (s.pending.length >= s.match.state.config.maxOrdersPerTick) return;
  s.pending.push(o);
  paint();
}

/* ---------- painting ---------- */

function paint(): void {
  if (!s) return;
  const st = s.match.state;
  const me = st.powers[s.you]!;
  const o = observe(st, s.you);
  const a = advise(st, s.you);

  $('clock').textContent = `T+${st.tick} MIN`;
  $('tracks').textContent = `${st.traces.length} TRACK${st.traces.length === 1 ? '' : 'S'}`;

  $('ladder').innerHTML = ([5, 4, 3, 2, 1] as const)
    .map((l) => {
      const on = me.defcon === l;
      return `<span class="rung" data-on="${on ? 1 : 0}" style="${on ? `background:var(--defcon-${l})` : ''}">${l}</span>`;
    })
    .join('');

  const pod = $('pod-advisory');
  pod.dataset['posture'] = a.posture;
  $('adv-head').textContent = a.headline;
  $('adv-detail').textContent = a.detail;

  $('warnings').innerHTML = o.newReports.length
    ? o.newReports
        .map(
          (r) => `<div class="warn">
            <b>${r.inboundTo}</b> &larr; ${r.attributedTo}
            <span data-tip="confidence">${r.confidence.toLowerCase()}</span>
            <span class="warn-eta">${r.etaTicks} min</span>
          </div>`,
        )
        .join('')
    : '<p class="quiet">Clear.</p>';

  $('units').innerHTML = o.units
    .map(
      (u) =>
        `<tr><th data-tip="${u.type === 'sub' ? 'boat' : 'silo'}">${u.id.split('-').slice(1).join('-')}</th><td>${u.warheads}</td><td class="dim">${u.status.replace(/_/g, ' ').toLowerCase()}</td></tr>`,
    )
    .join('');

  $('powers').innerHTML = o.powers
    .map(
      (p) =>
        `<tr><th>${p.id}</th><td>${p.populationM}M</td><td class="dim">DEFCON ${st.powers[p.id]!.defcon}</td></tr>`,
    )
    .join('');

  const unit = $<HTMLSelectElement>('act-unit');
  keepSelection(
    unit,
    o.units
      .filter((u) => u.status.startsWith('READY'))
      .map((u) => [u.id, `${u.id.split('-').slice(1).join('-')} · ${u.warheads}`]),
  );
  keepSelection(
    $<HTMLSelectElement>('act-target'),
    o.powers.map((p) => [p.id, p.id]),
  );
  keepSelection(
    $<HTMLSelectElement>('act-kind'),
    o.releaseAuthorised.map((k) => [k, k === 'CITIES' ? 'at cities' : 'at forces']),
  );

  const busy = s.pending.length >= st.config.maxOrdersPerTick;
  $<HTMLButtonElement>('act-lower').disabled = me.defcon <= 1 || busy;
  $<HTMLButtonElement>('act-raise').disabled = me.defcon >= 5 || busy;
  $<HTMLButtonElement>('act-launch').disabled =
    busy || o.releaseAuthorised.length === 0 || unit.options.length === 0;
  $('act-doctrine').textContent = me.doctrine === 'RIDE_OUT' ? 'Delegate' : 'Take back control';
  $('act-kind').toggleAttribute('data-tip', false);
  $('act-kind').setAttribute(
    'data-tip',
    o.releaseAuthorised.includes('CITIES') ? 'cities' : 'forces',
  );

  coach(o.newReports.length > 0, a.posture, me.defcon);
}

function keepSelection(sel: HTMLSelectElement, items: [string, string][]): void {
  const keep = sel.value;
  sel.innerHTML = items.map(([v, label]) => `<option value="${v}">${label}</option>`).join('');
  if (keep && items.some(([v]) => v === keep)) sel.value = keep;
  sel.disabled = items.length === 0;
}

function drain(): void {
  if (!s) return;
  const fresh = s.match.events.slice(s.logged);
  s.logged = s.match.events.length;
  const list = $('ticker');
  for (const e of fresh) {
    if (e.type === 'launch') globe?.focusOn(e.payload.origin.lat, e.payload.origin.lon);
    if (e.type === 'impact') {
      const c = s.match.state.cities.find((x) => x.id === e.payload.targetId);
      if (c) globe?.flashImpact(c.at.lat, c.at.lon);
    }
    const line = describe(e);
    if (!line) continue;
    const li = document.createElement('li');
    if (e.type === 'impact' || (e.type === 'launch' && e.payload.automatic)) li.className = 'alarm';
    li.textContent = `${String(e.t).padStart(3, ' ')}′  ${line}`;
    list.prepend(li);
  }
  while (list.children.length > 40) list.lastChild?.remove();
}

/* ---------- onboarding: one card, at the moment it is useful ---------- */

const COACH: [string, string][] = [
  [
    'first-warning',
    'A track has been assessed. Origin and destination are estimates, and some reports are of nothing at all. You are not told which this is.',
  ],
  [
    'can-release',
    'Readiness now permits a strike at forces. Going lower permits cities — and takes another minute you may not have.',
  ],
  [
    'urged',
    'The assessment is recommending release. It is reading the same uncertain reports you are.',
  ],
];

function coach(hasWarning: boolean, posture: string, defcon: number): void {
  if (!s) return;
  const key =
    hasWarning && !s.shown.has('first-warning')
      ? 'first-warning'
      : defcon <= 3 && !s.shown.has('can-release')
        ? 'can-release'
        : posture === 'URGENT' && !s.shown.has('urged')
          ? 'urged'
          : null;
  if (!key) return;
  s.shown.add(key);
  $('coach-text').textContent = COACH.find(([k]) => k === key)![1];
  $('coach').hidden = false;
  // Only the first card stops the clock. After that the player has been told how
  // this works, and pausing again would contradict the one rule that matters.
  if (s.shown.size === 1) {
    halt();
  } else {
    window.setTimeout(() => {
      $('coach').hidden = true;
    }, 9000);
  }
}

/* ---------- 4. record ---------- */

function finish(): void {
  if (!s) return;
  const o = outcomeOf(s.match.state, s.match.events, s.you);
  const headline: Record<Verdict, string> = {
    NO_LAUNCH: 'Nothing was launched',
    YOU_HELD: 'You held. Others did not.',
    YOU_FIRED_FIRST: 'You released first',
    YOU_RETALIATED: 'You answered',
    GENERAL_EXCHANGE: 'General exchange',
  };
  $('rec-verdict').textContent = headline[o.verdict];
  $('rec-dead').textContent =
    o.deadM > 0
      ? `${o.deadM.toFixed(1)} million dead. ${o.globalPopulationPct}% of the modelled population remains.`
      : 'No one died.';
  const mine = o.records.find((r) => r.power === s!.you);
  $('rec-note').textContent = mine?.firedOnFalseWarning
    ? 'At least one of your releases followed a warning that was of nothing.'
    : o.anyFiredOnFalseWarning
      ? 'Someone on this board released after a warning that was of nothing.'
      : '';
  $('rec-table').innerHTML =
    '<tr><th></th><td>alive</td><td>released</td><td class="dim">auto</td></tr>' +
    byPopulation(o)
      .map(
        (r) =>
          `<tr${r.power === s!.you ? ' class="you"' : ''}><th>${r.power}</th><td>${r.populationPct}%</td><td>${r.warheadsLaunched}</td><td class="dim">${r.automaticLaunches}</td></tr>`,
      )
      .join('');
  show('record');
}

/* ---------- plumbing ---------- */

const mmss = (t: number) =>
  `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;

function show(id: 'start' | 'brief' | 'crisis' | 'record'): void {
  for (const k of ['start', 'brief', 'crisis', 'record'] as const) $(k).hidden = k !== id;
  // The crisis keeps its board on screen behind the record card.
  if (id === 'record') $('crisis').hidden = false;
}

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (s && globe) {
    const st = s.match.state;
    globe.setTraces(st.traces, (t) => {
      const span = t.impactAt - t.launchedAt;
      if (span <= 0) return 1;
      // Slide between ticks so a track crawls rather than jumping.
      const within = s!.paused || s!.timer === null ? 0 : 0;
      return Math.max(0, Math.min(1, (st.tick + within - t.launchedAt) / span));
    });
    globe.updateCities(st.cities);
    globe.render(dt);
  }
  requestAnimationFrame(frame);
}

$('btn-go').addEventListener('click', () => void begin());
$('act-lower').addEventListener('click', () =>
  order({ kind: 'SET_DEFCON', level: (s!.match.state.powers[s!.you]!.defcon - 1) as Defcon }),
);
$('act-raise').addEventListener('click', () =>
  order({ kind: 'SET_DEFCON', level: (s!.match.state.powers[s!.you]!.defcon + 1) as Defcon }),
);
$('act-launch').addEventListener('click', () =>
  order({
    kind: 'LAUNCH',
    unit: $<HTMLSelectElement>('act-unit').value,
    targetPower: $<HTMLSelectElement>('act-target').value,
    targetKind: $<HTMLSelectElement>('act-kind').value as 'FORCES' | 'CITIES',
  }),
);
$('act-doctrine').addEventListener('click', () =>
  order({
    kind: 'SET_DOCTRINE',
    doctrine:
      s!.match.state.powers[s!.you]!.doctrine === 'RIDE_OUT' ? 'LAUNCH_ON_WARNING' : 'RIDE_OUT',
  }),
);
$('act-pause').addEventListener('click', () => (s?.timer === null ? resume() : halt()));
$('coach-ok').addEventListener('click', () => {
  $('coach').hidden = true;
  if (s && s.timer === null && !s.match.state.over) resume();
});
$('rec-again').addEventListener('click', () => void begin());
$('rec-other').addEventListener('click', () => {
  halt();
  show('start');
});
$('rec-download').addEventListener('click', () => {
  if (!s) return;
  const blob = new Blob([s.match.events.map((e) => JSON.stringify(e)).join('\n')], {
    type: 'application/x-ndjson',
  });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `brink-${s.match.state.scenarioId}-${s.match.state.seed}.jsonl`;
  a.click();
  URL.revokeObjectURL(a.href);
});

initTooltips();
renderStart();
