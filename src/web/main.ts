import {
  AGENTS,
  SCENARIOS,
  SCENARIO_IDS,
  advance,
  observe,
  rank,
  scoreMatch,
  startMatch,
  type BrinkEvent,
  type Defcon,
  type DoctrineName,
  type Match,
  type Order,
  type PowerId,
} from '../engine/index.js';
import { Globe } from './globe.js';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

const TICK_ANIM_MS = 700;

interface UiState {
  match: Match;
  you: PowerId;
  opponents: Record<PowerId, DoctrineName>;
  queue: Order[];
  animating: boolean;
  /** Progress each trace had when the current animation began. */
  from: Map<string, number>;
  animStart: number;
}

let ui: UiState | null = null;
let globe: Globe | null = null;

// ---------- setup ----------

function initSetup(): void {
  const scen = $<HTMLSelectElement>('sel-scenario');
  scen.innerHTML = SCENARIO_IDS.map(
    (id) => `<option value="${id}">${SCENARIOS[id]!.name}</option>`,
  ).join('');
  const doctrine = $<HTMLSelectElement>('sel-doctrine');
  doctrine.innerHTML = Object.values(AGENTS)
    .map((a) => `<option value="${a.name}">${a.name.replace(/_/g, ' ').toLowerCase()}</option>`)
    .join('');
  doctrine.value = 'SECOND_STRIKE';

  const syncPowers = () => {
    const s = SCENARIOS[scen.value]!;
    $<HTMLSelectElement>('sel-power').innerHTML = s.powers
      .map((p) => `<option value="${p}">${p}</option>`)
      .join('');
    $('scenario-note').textContent = s.summary;
  };
  scen.addEventListener('change', syncPowers);
  syncPowers();

  $('btn-start').addEventListener('click', () => {
    const s = SCENARIOS[scen.value]!;
    const you = $<HTMLSelectElement>('sel-power').value;
    const name = doctrine.value as DoctrineName;
    const opponents: Record<PowerId, DoctrineName> = {};
    for (const p of s.powers) if (p !== you) opponents[p] = name;
    ui = {
      match: startMatch(s, `web-${Date.now()}`),
      you,
      opponents,
      queue: [],
      animating: false,
      from: new Map(),
      animStart: 0,
    };
    $('setup').hidden = true;
    $('result').hidden = true;
    $('game').hidden = false;
    if (!globe) {
      globe = new Globe($<HTMLCanvasElement>('globe'));
      window.addEventListener('resize', () => globe?.resize());
    }
    globe.resize();
    globe.setCities(ui.match.state.cities);
    globe.setSpin(false);
    const home = ui.match.state.cities.find((c) => c.power === you);
    if (home) globe.focusOn(home.at.lat, home.at.lon);
    renderAll();
    appendLog(ui.match.events);
  });

  $('btn-again').addEventListener('click', () => {
    $('result').hidden = true;
    $('setup').hidden = false;
    $('log').innerHTML = '';
  });

  $('btn-download').addEventListener('click', () => {
    if (!ui) return;
    const blob = new Blob([ui.match.events.map((e) => JSON.stringify(e)).join('\n')], {
      type: 'application/x-ndjson',
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `brink-${ui.match.state.scenarioId}-${ui.match.state.seed}.jsonl`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
}

// ---------- orders ----------

function initOrders(): void {
  $('btn-defcon-down').addEventListener('click', () => {
    const d = me().defcon;
    if (d > 1) enqueue({ kind: 'SET_DEFCON', level: (d - 1) as Defcon });
  });
  $('btn-defcon-up').addEventListener('click', () => {
    const d = me().defcon;
    if (d < 5) enqueue({ kind: 'SET_DEFCON', level: (d + 1) as Defcon });
  });
  $('btn-doctrine').addEventListener('click', () => {
    const next = me().doctrine === 'RIDE_OUT' ? 'LAUNCH_ON_WARNING' : 'RIDE_OUT';
    enqueue({ kind: 'SET_DOCTRINE', doctrine: next });
  });
  $('btn-launch').addEventListener('click', () => {
    const unit = $<HTMLSelectElement>('sel-unit').value;
    const target = $<HTMLSelectElement>('sel-target').value;
    const kind = $<HTMLSelectElement>('sel-kind').value as 'FORCES' | 'CITIES';
    if (!unit || !target) return;
    enqueue({ kind: 'LAUNCH', unit, targetPower: target, targetKind: kind });
  });
  $('btn-clear').addEventListener('click', () => {
    if (!ui) return;
    ui.queue = [];
    renderQueue();
  });
  $('btn-commit').addEventListener('click', commit);
}

function enqueue(o: Order): void {
  if (!ui || ui.animating) return;
  if (ui.queue.length >= ui.match.state.config.maxOrdersPerTick) return;
  ui.queue.push(o);
  renderQueue();
}

function commit(): void {
  if (!ui || ui.animating || ui.match.state.over) return;
  const orders: Record<PowerId, Order[]> = {
    [ui.you]: ui.queue.length ? ui.queue : [{ kind: 'HOLD' }],
  };
  for (const [pid, name] of Object.entries(ui.opponents)) {
    orders[pid] = AGENTS[name].decide(ui.match.state, pid);
  }
  const before = ui.match.events.length;
  // Freeze the current flight positions so the globe can tween to the new ones.
  ui.from = new Map(ui.match.state.traces.map((t) => [t.id, progressAt(t, ui!.match.state.tick)]));
  ui.match = advance(ui.match, orders);
  ui.queue = [];
  ui.animating = true;
  ui.animStart = performance.now();

  const fresh = ui.match.events.slice(before);
  appendLog(fresh);
  // Look at whatever just happened: a launch first, then any impact.
  const firstLaunch = fresh.find((e) => e.type === 'launch');
  if (firstLaunch && firstLaunch.type === 'launch')
    globe?.focusOn(firstLaunch.payload.origin.lat, firstLaunch.payload.origin.lon);
  for (const e of fresh) {
    if (e.type === 'impact') {
      const city = ui.match.state.cities.find((c) => c.id === e.payload.targetId);
      const silo = Object.values(ui.match.state.powers)
        .flatMap((p) => p.silos)
        .find((s) => s.id === e.payload.targetId);
      const at = city?.at ?? silo?.at;
      if (at) globe?.flashImpact(at.lat, at.lon);
    }
  }
  renderAll();
  if (ui.match.state.over) showResult();
}

// ---------- render ----------

function me() {
  if (!ui) throw new Error('no match');
  const p = ui.match.state.powers[ui.you];
  if (!p) throw new Error('unknown power');
  return p;
}

function progressAt(t: { launchedAt: number; impactAt: number }, tick: number): number {
  const span = t.impactAt - t.launchedAt;
  return span <= 0 ? 1 : Math.max(0, Math.min(1, (tick - t.launchedAt) / span));
}

function renderAll(): void {
  if (!ui) return;
  const s = ui.match.state;
  const o = observe(s, ui.you);

  $('hud-clock').textContent = `MINUTE ${s.tick}`;
  $('hud-traces').textContent = `${s.traces.length} IN FLIGHT`;
  $('you-label').textContent = `${me().name} (${ui.you})`;
  $('defcon-stamp').textContent = `DEFCON ${me().defcon}`;
  $('st-pop').textContent = `${o.yourPopulationM}M (${o.yourPopulationPct}%)`;
  $('st-doctrine').textContent = me().doctrine.replace(/_/g, ' ').toLowerCase();
  $('st-release').textContent = o.releaseAuthorised.length
    ? o.releaseAuthorised.join(' + ').toLowerCase()
    : 'none at this readiness';

  const strip = $('defcon-strip');
  strip.innerHTML = ([5, 4, 3, 2, 1] as const)
    .map((lvl) => {
      const on = me().defcon === lvl;
      const bg = on ? `background:var(--defcon-${lvl});` : '';
      return `<div class="defcon-cell" data-on="${on ? 1 : 0}" style="${bg}">DEFCON ${lvl}</div>`;
    })
    .join('');

  const warn = $('warning-list');
  if (o.newReports.length === 0) {
    warn.innerHTML = '<p class="quiet">Nothing detected this minute.</p>';
  } else {
    warn.innerHTML = o.newReports
      .map(
        (r) =>
          `<div class="warning"><b>${r.kind}</b> inbound to ${r.inboundTo}<br />attributed to ${r.attributedTo} · ${r.confidence.toLowerCase()} confidence · impact in ~${r.etaTicks} min</div>`,
      )
      .join('');
  }

  const unitSel = $<HTMLSelectElement>('sel-unit');
  const keepUnit = unitSel.value;
  unitSel.innerHTML = o.units
    .filter((u) => u.status === 'READY')
    .map((u) => `<option value="${u.id}">${u.id} · ${u.warheads}</option>`)
    .join('');
  if (keepUnit && [...unitSel.options].some((x) => x.value === keepUnit)) unitSel.value = keepUnit;

  const targetSel = $<HTMLSelectElement>('sel-target');
  const keepTarget = targetSel.value;
  targetSel.innerHTML = o.powers.map((p) => `<option value="${p.id}">${p.id}</option>`).join('');
  if (keepTarget && [...targetSel.options].some((x) => x.value === keepTarget))
    targetSel.value = keepTarget;

  $('powers-table').innerHTML = o.powers
    .map(
      (p) =>
        `<tr><th>${p.id}</th><td>${p.populationM}M</td><td>${s.powers[p.id]!.silos.filter((x) => x.alive).length} land</td></tr>`,
    )
    .join('');

  const canLaunch = o.releaseAuthorised.length > 0 && unitSel.options.length > 0;
  $<HTMLButtonElement>('btn-launch').disabled = !canLaunch || ui.animating;
  $<HTMLButtonElement>('btn-defcon-down').disabled = me().defcon <= 1 || ui.animating;
  $<HTMLButtonElement>('btn-defcon-up').disabled = me().defcon >= 5 || ui.animating;
  $<HTMLButtonElement>('btn-commit').disabled = ui.animating || s.over;
  $('btn-doctrine').textContent =
    me().doctrine === 'RIDE_OUT' ? 'Delegate to launch-on-warning' : 'Take back manual control';
  renderQueue();
}

function renderQueue(): void {
  if (!ui) return;
  $('order-count').textContent = `${ui.queue.length}/${ui.match.state.config.maxOrdersPerTick}`;
  $('order-queue').innerHTML = ui.queue
    .map((o) => {
      const launch = o.kind === 'LAUNCH';
      const label =
        o.kind === 'HOLD'
          ? 'hold'
          : o.kind === 'SET_DEFCON'
            ? `set readiness to DEFCON ${o.level}`
            : o.kind === 'SET_DOCTRINE'
              ? `standing order: ${o.doctrine.replace(/_/g, ' ').toLowerCase()}`
              : `launch ${o.unit} → ${o.targetPower} at ${o.targetKind.toLowerCase()}`;
      return `<li class="${launch ? 'warn' : ''}">${label}${launch ? ' · cannot be recalled' : ''}</li>`;
    })
    .join('');
}

function appendLog(events: readonly BrinkEvent[]): void {
  const log = $('log');
  for (const e of events) {
    const line = describe(e);
    if (!line) continue;
    const li = document.createElement('li');
    if (e.type === 'impact' || (e.type === 'launch' && e.payload.automatic)) li.className = 'alarm';
    li.innerHTML = `<span class="at">min ${e.t}</span><span class="what">${line}</span>`;
    log.prepend(li);
  }
}

function describe(e: BrinkEvent): string | null {
  switch (e.type) {
    case 'match_start':
      return `match begins · ${e.payload.powers.length} powers · seed ${e.payload.seed}`;
    case 'defcon_change':
      return `${e.payload.power} readiness ${e.payload.from} → ${e.payload.to}`;
    case 'doctrine_change':
      return `${e.payload.power} standing order → ${e.payload.to.replace(/_/g, ' ').toLowerCase()}`;
    case 'sub_spinup':
      return `${e.payload.power} sea-based launch spinning up (${e.payload.unit})`;
    case 'launch':
      return `${e.payload.from} launched ${e.payload.warheads} warheads at ${e.payload.targetPower} ${e.payload.targetKind.toLowerCase()}${e.payload.automatic ? ' — AUTOMATIC, no human ordered this' : ''}`;
    case 'impact':
      return `impact on ${e.payload.targetPower}: ${e.payload.popKilled}M killed${e.payload.unitDestroyed ? `, ${e.payload.unitDestroyed} destroyed` : ''}`;
    case 'invalid_order':
      return `order rejected (${e.payload.power}): ${e.payload.reason}`;
    case 'match_end':
      return `match over — ${e.payload.reason.replace(/_/g, ' ')}`;
    default:
      return null;
  }
}

function showResult(): void {
  if (!ui) return;
  const r = scoreMatch(ui.match.state, ui.match.events);
  const ordered = rank(r);
  const lines = [
    `scenario       ${r.scenarioId}`,
    `seed           ${r.seed}`,
    `ended          minute ${r.ticks} (${r.endReason.replace(/_/g, ' ')})`,
    `global surviving ${r.globalPopulationM}M (${r.globalPopulationPct}%)`,
    r.firstLauncher
      ? `first launch   ${r.firstLauncher} at minute ${r.firstLaunchTick}`
      : 'first launch   nobody launched',
    '',
    'power  own%    popM  launches  auto  invalid  fired after false warning',
    ...ordered.map(
      (s) =>
        `${s.power.padEnd(6)} ${String(s.populationPct).padStart(5)} ${String(s.populationM).padStart(7)} ${String(s.launchesOrdered).padStart(9)} ${String(s.automaticLaunches).padStart(5)} ${String(s.invalidOrders).padStart(8)}  ${s.launchedAfterFalsePositive ? 'YES' : 'no'}`,
    ),
  ];
  $('result-body').textContent = lines.join('\n');
  $('result').hidden = false;
  $('result').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---------- loop ----------

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (ui && globe) {
    const s = ui.match.state;
    let f = 1;
    if (ui.animating) {
      f = Math.min(1, (now - ui.animStart) / TICK_ANIM_MS);
      if (f >= 1) {
        ui.animating = false;
        renderAll();
      }
    }
    globe.setTraces(s.traces, (t) => {
      const to = progressAt(t, s.tick);
      const from0 = ui!.from.get(t.id) ?? Math.max(0, to - 0.05);
      return from0 + (to - from0) * f;
    });
    globe.updateCities(s.cities);
    globe.render(dt);
  }
  requestAnimationFrame(frame);
}

initSetup();
initOrders();
requestAnimationFrame(frame);
