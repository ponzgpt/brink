import { SCENARIOS, playScripted, type BrinkEvent, type PowerId } from '../engine/index.js';
import { describe } from './describe.js';
import { fold, maxTickOf, parseJsonl, type FoldedFrame } from './fold.js';
import { Globe } from './globe.js';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

let events: BrinkEvent[] = [];
let frame: FoldedFrame | null = null;
let globe: Globe | null = null;
let playing = false;
let stepMs = 1000;
let lastStep = 0;
let seenImpacts = new Set<string>();

function load(evts: BrinkEvent[]): void {
  events = evts;
  if (events.length === 0) {
    $('picker-note').textContent = 'That file has no events in it.';
    return;
  }
  $('picker').hidden = true;
  $('player').hidden = false;
  if (!globe) {
    globe = new Globe($<HTMLCanvasElement>('globe'));
    window.addEventListener('resize', () => globe?.resize());
  }
  globe.resize();
  globe.setSpin(false);
  const scrub = $<HTMLInputElement>('scrub');
  scrub.max = String(maxTickOf(events));
  scrub.value = '0';
  seenImpacts = new Set();
  show(0);
  globe.setCities(frame!.cities);
}

function show(tick: number): void {
  frame = fold(events, tick, describe);
  $('hud-clock').textContent = `MINUTE ${tick}`;
  $('hud-traces').textContent = `${frame.traces.length} IN FLIGHT`;
  $('m-scenario').textContent = frame.scenarioId;
  $('m-seed').textContent = frame.seed;
  $('m-tick').textContent = `${tick} of ${frame.maxTick}`;
  $<HTMLInputElement>('scrub').value = String(tick);

  $('defcon-strip').innerHTML = frame.powers
    .map((p) => {
      const d = frame!.defcon[p] ?? 5;
      return `<div class="defcon-cell" data-on="1" style="background:var(--defcon-${d});color:var(--paper)">${p} ${d}</div>`;
    })
    .join('');
  $('defcon-strip').setAttribute(
    'style',
    `grid-template-columns:repeat(${Math.max(1, frame.powers.length)},1fr)`,
  );

  $('m-powers').innerHTML = frame.powers
    .map((p) => {
      const now = frame!.cities
        .filter((c) => c.power === p)
        .reduce((a, c) => a + c.popRemaining, 0);
      const start = frame!.cities.filter((c) => c.power === p).reduce((a, c) => a + c.pop, 0);
      const pct = start > 0 ? Math.round((now / start) * 100) : 0;
      return `<tr><th>${p}</th><td>${now.toFixed(1)}M</td><td>${pct}%</td></tr>`;
    })
    .join('');

  $('log').innerHTML = frame.log
    .slice()
    .reverse()
    .map(
      (l) =>
        `<li><span class="at">min ${l.t}</span><span class="what">${escapeHtml(l.line)}</span></li>`,
    )
    .join('');

  globe?.updateCities(frame.cities);
  globe?.setTraces(frame.traces, (t) => {
    const span = t.impactAt - t.launchedAt;
    return span <= 0 ? 1 : Math.max(0, Math.min(1, (tick - t.launchedAt) / span));
  });

  // Flash impacts that land as we pass them, but not when scrubbing backwards.
  for (const e of events) {
    if (e.type !== 'impact' || e.t !== tick || seenImpacts.has(e.payload.traceId)) continue;
    seenImpacts.add(e.payload.traceId);
    const city = frame.cities.find((c) => c.id === e.payload.targetId);
    if (city) globe?.focusOn(city.at.lat, city.at.lon);
    if (city) globe?.flashImpact(city.at.lat, city.at.lon);
  }
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

$<HTMLInputElement>('file').addEventListener('change', async (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (!f) return;
  try {
    load(parseJsonl(await f.text()));
  } catch {
    $('picker-note').textContent = 'That file is not a BRINK event log.';
  }
});

/** A sample is generated rather than shipped: the engine is deterministic, so the
 *  seed below always produces the same match and there is no fixture to go stale. */
$('btn-sample').addEventListener('click', () => {
  const scen = SCENARIOS['twenty-six-minutes']!;
  const assignment: Record<PowerId, 'PARANOID'> = {};
  for (const p of scen.powers) assignment[p] = 'PARANOID';
  load(playScripted(scen, 'sample-001', assignment).match.events);
});

$('btn-play').addEventListener('click', () => {
  playing = !playing;
  $('btn-play').textContent = playing ? 'Pause' : 'Play';
  lastStep = performance.now();
});
$('btn-step').addEventListener('click', () => show(Math.min(frame!.maxTick, frame!.tick + 1)));
$('btn-step-back').addEventListener('click', () => show(Math.max(0, frame!.tick - 1)));
$<HTMLInputElement>('scrub').addEventListener('input', (e) => {
  playing = false;
  $('btn-play').textContent = 'Play';
  show(Number((e.target as HTMLInputElement).value));
});
$<HTMLSelectElement>('speed').addEventListener('change', (e) => {
  stepMs = Number((e.target as HTMLSelectElement).value);
});

let last = performance.now();
function loop(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (playing && frame && now - lastStep >= stepMs) {
    lastStep = now;
    if (frame.tick >= frame.maxTick) {
      playing = false;
      $('btn-play').textContent = 'Play';
    } else {
      show(frame.tick + 1);
    }
  }
  globe?.render(dt);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
