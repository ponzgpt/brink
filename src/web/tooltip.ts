/**
 * One delegated listener for every explainer on the page.
 *
 * The alternative was prose: a paragraph next to each control saying what it does.
 * Putting it behind `data-tip` keeps the console looking like a console and still
 * answers the question at the moment it is asked.
 */
const TERMS: Record<string, string> = {
  defcon:
    'Readiness. 5 is peacetime, 1 is general release. It moves one level per minute — you cannot jump it, so the decision to be able to answer is itself a commitment.',
  release:
    'What your current readiness permits. Strikes at forces unlock at DEFCON 3, strikes at cities at DEFCON 1.',
  forces:
    'A strike against launch sites. It destroys weapons rather than people, and it is the only option available before DEFCON 1.',
  cities:
    'A strike against population. It is what the arsenals exist to threaten, and it is irreversible the moment it leaves the ground.',
  warning:
    'Your early-warning picture. Origin and destination are estimates that narrow as a track flies — and some reports are of nothing at all. You are never told which.',
  confidence:
    'How far the track has flown, not how likely it is to be real. A low-confidence track can still be real, and a high-confidence one can still be nothing.',
  advisory:
    'What the system recommends. It reads the same ambiguous reports you do, so it is confidently wrong exactly as often as they are.',
  doctrine:
    'A standing order. Launch-on-warning means the machinery fires without consulting you — including on a report of nothing.',
  salvo:
    'Each order releases part of a unit, not all of it. A unit keeps firing until it runs dry.',
  silo: 'Land-based. Fires the minute you order it, and can be destroyed on the ground.',
  boat: 'Sea-based. Takes a minute to spin up, and is hidden until it fires.',
  exercise:
    'Everything here is a simulation. The arsenals and distances are real and sourced; nothing else is, and no real person is represented.',
};

let el: HTMLDivElement | null = null;

export function initTooltips(): void {
  el = document.createElement('div');
  el.className = 'tip';
  el.setAttribute('role', 'tooltip');
  el.hidden = true;
  document.body.appendChild(el);

  const show = (target: HTMLElement) => {
    const key = target.dataset['tip'];
    const text = key ? (TERMS[key] ?? key) : null;
    if (!text || !el) return;
    el.textContent = text;
    el.hidden = false;
    const r = target.getBoundingClientRect();
    const w = Math.min(280, window.innerWidth - 24);
    el.style.width = `${w}px`;
    const left = Math.min(Math.max(8, r.left), window.innerWidth - w - 8);
    el.style.left = `${left}px`;
    // Prefer above; fall back below when there is no room.
    const above = r.top > el.offsetHeight + 12;
    el.style.top = `${above ? r.top - el.offsetHeight - 8 : r.bottom + 8}px`;
  };
  const hide = () => {
    if (el) el.hidden = true;
  };

  for (const [on, fn] of [
    ['pointerover', show],
    ['focusin', show],
  ] as const) {
    document.addEventListener(on, (e) => {
      const t = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-tip]');
      if (t) fn(t);
    });
  }
  document.addEventListener('pointerout', hide);
  document.addEventListener('focusout', hide);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hide();
  });
}
