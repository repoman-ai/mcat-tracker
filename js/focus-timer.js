export function focusMinutes(session) {
  const value = session?.minutes;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 25) {
    throw new Error("Focus minutes must be a number between 0 and 25.");
  }
  return value;
}

export function createFocusTimer(now = () => Date.now()) {
  const duration = 25 * 60 * 1000;
  let elapsed = 0, runningSince = null;
  return {
    get elapsed() { return Math.min(duration, elapsed + (runningSince === null ? 0 : Math.max(0, now() - runningSince))); },
    get remaining() { return Math.max(0, Math.ceil((duration - this.elapsed) / 1000)); },
    get running() { return runningSince !== null; },
    start() { if (runningSince === null && this.remaining) runningSince = now(); },
    pause() { elapsed = this.elapsed; runningSince = null; },
    reset() { elapsed = 0; runningSince = null; },
  };
}
