// Minimal stand-in for the xAI chat completions API, for e2e only. Start: node e2e/fake-xai.mjs 8099
// It reads "[report <id>] ..." blocks from the prompt and flags narratives with risky keywords.
import { createServer } from "node:http";

const RULES = [
  [/ladder.*crack|cracked rail|injur|knob-and-tube/i, "safety", "high"],
  [/short by|ran out|waiting on \d+ sheets/i, "materials", "medium"],
  [/crushed|damage|rut in the neighbor/i, "damage", "medium"],
  [/pushes|delay|moved to|blocked|can't|cannot/i, "delay", "medium"],
  [/complain/i, "client", "low"],
];

createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const msg = JSON.parse(body || "{}").messages?.at(-1)?.content ?? "";
    const items = [];
    for (const block of msg.split(/\n\n(?=\[report )/)) {
      const m = /^\[report ([^\]]+)\][^\n]*\n([\s\S]*)$/.exec(block);
      if (!m) continue;
      for (const [re, category, severity] of RULES) {
        const hit = re.exec(m[2]);
        if (hit) {
          const sentence = m[2].split(/(?<=\.)\s/).find((s) => re.test(s)) ?? hit[0];
          items.push({ category, severity, summary: sentence.slice(0, 140), reportId: m[1], quote: sentence.slice(0, 120) });
          break;
        }
      }
    }
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ items }) } }] }));
  });
}).listen(Number(process.argv[2] || 8099), "127.0.0.1");
