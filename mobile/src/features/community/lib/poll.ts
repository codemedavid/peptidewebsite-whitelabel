/**
 * How often an open chat asks for new messages. Fast while people are
 * talking; each quiet poll in a row stretches the wait up to a ceiling, so a
 * chat left open on a quiet afternoon costs a fraction of the requests.
 * Any new message, edit, send or return to the app resets it to fast.
 */

export const POLL_FAST_MS = 3_000;
export const POLL_SLOW_MS = 12_000;
/** Quiet polls (≈12 s) before backing off. */
const FAST_QUIET_POLLS = 4;
const STEP_MS = 1_500;

export function nextPollDelay(quietPolls: number): number {
  if (quietPolls < FAST_QUIET_POLLS) return POLL_FAST_MS;
  return Math.min(POLL_FAST_MS + (quietPolls - FAST_QUIET_POLLS + 1) * STEP_MS, POLL_SLOW_MS);
}
