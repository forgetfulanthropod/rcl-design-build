/** "5", "5.5", "5:30", "5h 30m", "5h30", "45m" → minutes. Anything else → null. */
export function parseHoursInput(value: string): number | null {
  const s = value.trim().toLowerCase();
  if (!s) return null;
  let m = /^(\d{1,2}):([0-5]\d)$/.exec(s);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  m = /^(\d{1,2})\s*h(?:\s*(\d{1,2})\s*m?)?$/.exec(s);
  if (m && (!m[2] || Number(m[2]) < 60)) return Number(m[1]) * 60 + Number(m[2] ?? 0);
  m = /^(\d{1,3})\s*m$/.exec(s);
  if (m) return Number(m[1]);
  m = /^(\d{1,2})(?:\.(\d{1,2}))?$/.exec(s);
  if (m) return Math.round(Number(`${m[1]}.${m[2] ?? 0}`) * 60);
  return null;
}
