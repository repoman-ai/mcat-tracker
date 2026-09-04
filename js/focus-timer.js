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
