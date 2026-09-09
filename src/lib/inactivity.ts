/**
 * Inactivitatea din Panoul Angajat - auto-return la „Cine preia tableta?”.
 * Un timeout al INTERFEȚEI (UI), NU al timer-ului de lucru.
 * NU oprește, NU pune pe pauză și NU finalizează niciun job/lucrare/timer.
 * Helper pur, partajat de Web și Local.
 */

export const INACTIVITY_TIMEOUT_MS = 60_000;

export const ACTIVITY_EVENTS: readonly string[] = [
  'pointerdown', 'pointermove', 'pointerup', 'pointercancel',
  'touchstart', 'touchmove', 'touchend',
  'mousedown', 'mousemove', 'mouseup',
  'click', 'dblclick', 'wheel',
  'keydown', 'keyup', 'contextmenu', 'scroll',
];

export interface InactivityWatchOptions {
  timeoutMs?: number;
  checkIntervalMs?: number;
  now?: () => number;
  onTimeout: () => void;
}

export interface InactivityWatch {
  start(): void;
  activity(): void;
  dispose(): void;
  tick(): void;
  getRemainingMs(): number;
}

export function createInactivityWatch(opts: InactivityWatchOptions): InactivityWatch {
  const timeoutMs = opts.timeoutMs ?? INACTIVITY_TIMEOUT_MS;
  const checkIntervalMs = opts.checkIntervalMs ?? 1000;
  const now = opts.now ?? ((): number => Date.now());
  let lastActivity = now();
  let timer: ReturnType<typeof setInterval> | null = null;
  let ended = false;

  const evaluate = (): void => {
    if (ended) return;
    if (now() - lastActivity >= timeoutMs) {
      ended = true;
      if (timer) { clearInterval(timer); timer = null; }
      opts.onTimeout();
    }
  };

  const start = (): void => {
    if (timer || ended) return;
    timer = setInterval(evaluate, checkIntervalMs);
  };

  const activity = (): void => {
    if (ended) return;
    lastActivity = now();
  };

  const dispose = (): void => {
    ended = true;
    if (timer) { clearInterval(timer); timer = null; }
  };

  const tick = (): void => { evaluate(); };

  const getRemainingMs = (): number => Math.max(0, timeoutMs - (now() - lastActivity));

  return { start, activity, dispose, tick, getRemainingMs };
}