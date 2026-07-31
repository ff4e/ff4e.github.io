/**
 * Paint-rate cap scheduling, kept pure so it can be tested against synthetic refresh
 * rates instead of only on the developer's monitor.
 *
 * The naive cap ("skip while now - lastPaint < period, then lastPaint = now") re-phases
 * to every painted frame and therefore only delivers the target rate when the display
 * refresh is an exact multiple of it. Measured with a 60fps target:
 *
 *     60Hz -> 60.0    120Hz -> 60.0    240Hz -> 60.0     (multiples: correct)
 *     75Hz -> 37.5    144Hz -> 48.0    165Hz -> 55.0     (everything else: aliased)
 *
 * Advancing a deadline by whole periods carries the remainder into the next interval,
 * so the long-run rate is correct at any refresh.
 */

/**
 * Next paint deadline, given the current timestamp and the previous deadline.
 * `prev === 0` means "no deadline yet" (first frame).
 *
 * Within one period of the deadline we advance by exactly one period, preserving phase.
 * More than a period late — a stall, a backgrounded tab, a resumed session — we snap to
 * `now`, so the loop never bursts a backlog of catch-up paints.
 */
export function advancePaintDeadline(now: number, prev: number, period: number): number {
  if (prev !== 0 && now - prev < period) return prev + period;
  return now + period;
}

/** Whether this refresh should be skipped to honour the cap. */
export function shouldSkipPaint(now: number, deadline: number, epsilon: number): boolean {
  return deadline !== 0 && now < deadline - epsilon;
}
