// Pure helpers for the AI "needs attention" summary (no server imports, unit-tested).
function text(v: unknown): string {
  return v == null ? "" : String(v);
}

export const ATTENTION_CATEGORIES = [
  "safety", "delay", "materials", "damage", "blocked", "client", "quality", "other",
] as const;

export type AttentionItem = {
  category: string;
  severity: "high" | "medium" | "low";
  summary: string;
  reportId: string;
  person: string;
  day: string;
  quote: string;
};

export const ATTENTION_SYSTEM = `You review construction crew daily reports for the business owner.
List only items that need the owner's attention: safety issues or injuries, delays, material shortages,
damage, blocked work, client issues or complaints, quality problems, and anything else risky.
Ignore routine progress. Every item must cite the exact report it came from.
Reply with JSON only: {"items":[{"category":"safety|delay|materials|damage|blocked|client|quality|other",
"severity":"high|medium|low","summary":"<one short sentence>","reportId":"<id from the input>",
"quote":"<short exact quote from that report>"}]}. Use {"items":[]} if nothing needs attention.`;

export type ModelCall = (system: string, message: string) => Promise<string | null>;

export function parseAttention(
  raw: string,
  reports: { id: string | null; userName: string; day: string }[],
): AttentionItem[] {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end < start) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return [];
  }
  const items = (parsed as { items?: unknown }).items;
  if (!Array.isArray(items)) return [];
  const byId = new Map(reports.map((r) => [r.id ?? "", r]));
  const out: AttentionItem[] = [];
  for (const it of items as Record<string, unknown>[]) {
    const report = byId.get(text(it.reportId));
    if (!report) continue; // drop anything that doesn't cite a real report
    const sev = text(it.severity);
    const cat = text(it.category);
    out.push({
      category: (ATTENTION_CATEGORIES as readonly string[]).includes(cat) ? cat : "other",
      severity: sev === "high" || sev === "low" ? sev : "medium",
      summary: text(it.summary).slice(0, 300),
      reportId: report.id ?? "",
      person: report.userName,
      day: report.day,
      quote: text(it.quote).slice(0, 300),
    });
  }
  const rank = { high: 0, medium: 1, low: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

