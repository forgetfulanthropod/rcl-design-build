/**
 * Timestamps for one seeded demo report. The demo seeds today's reports too, and the nominal
 * times (photos ~7:02, first edit ~7:05, submitted ~15:20+) are in the future for most of the
 * day. Every time is capped at `now`, keeping the order photos → first edit → submit, and
 * never moved before the report's own day.
 */
export type DemoReportTimes = { first: string; last: string; submitted: string; photos: { taken: string; created: string }[] };

const MIN = 60_000;

export function demoReportTimes(dayStr: string, ago: number, photoCount: number, now: Date = new Date()): DemoReportTimes {
  const at = (h: number, m: number) => {
    const d = new Date(`${dayStr}T00:00:00`);
    d.setHours(h, m, 0, 0);
    return d.getTime();
  };
  const dayStart = at(0, 0);
  const floor = (t: number) => Math.max(dayStart, t);
  const last = floor(Math.min(at(15, 20 + ((ago * 11) % 35)), now.getTime() - MIN));
  const first = floor(Math.min(at(7, 5 + ((ago * 7) % 25)), last - 2 * MIN));
  const photos = Array.from({ length: photoCount }, (_, n) => {
    // Each photo is taken, then saved a minute later, all before the first edit.
    const back = (photoCount - n) * 2 * MIN;
    const created = floor(Math.min(at(7, 3 + n), first - back + MIN));
    const taken = floor(Math.min(at(7, 2 + n), created - MIN));
    return { taken: new Date(taken).toISOString(), created: new Date(created).toISOString() };
  });
  const iso = (t: number) => new Date(t).toISOString();
  return { first: iso(first), last: iso(last), submitted: iso(last), photos };
}
