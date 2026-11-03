import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useRef } from "react";
import { PdfDoc } from "@/lib/pdf";

type Entry = {
  id: string;
  ts: string; // ISO
  kind: "text" | "photo";
  body?: string;
  dataUrl?: string;
};

type DayLog = Record<string, Entry[]>;

const STORAGE_KEY = "rcl-tracking-log";

function todayKey(): string {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function loadLog(): DayLog {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveLog(log: DayLog) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(log));
}

function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

async function dataUrlToJpeg(dataUrl: string): Promise<Uint8Array | null> {
  try {
    const img = new Image();
    img.src = dataUrl;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext("2d")!.drawImage(img, 0, 0);
    const jpegUrl = canvas.toDataURL("image/jpeg", 0.82);
    const bin = atob(jpegUrl.split(",")[1]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

function buildDayPdf(day: string, entries: Entry[], jpegs: Map<string, Uint8Array | null>): Uint8Array {
  const doc = new PdfDoc();
  doc.paragraph("Activity log", 22, { bold: true, leading: 28 });
  doc.gap(4);
  doc.paragraph(`Day: ${new Date(day + "T12:00:00").toLocaleDateString([], { weekday: "long", month: "short", day: "numeric", year: "numeric" })}`, 12);
  doc.paragraph(`Entries: ${entries.length}`, 11, { gray: 0.4 });
  doc.rule();
  if (entries.length === 0) doc.paragraph("Nothing logged yet.", 11, { gray: 0.35 });
  for (const e of entries) {
    doc.gap(8);
    const stamp = clock(e.ts);
    doc.ensure(20);
    doc.paragraph(`${stamp} · ${e.kind === "photo" ? "Photo" : "Note"}`, 9.5, { bold: true, gray: 0.4 });
    if (e.kind === "text" && e.body) {
      doc.paragraph(e.body, 11.5);
    } else if (e.kind === "photo") {
      const jpeg = jpegs.get(e.id);
      if (jpeg && doc.jpeg(jpeg)) {
        // embedded
      } else {
        doc.paragraph("(Photo could not be included.)", 11, { gray: 0.35 });
      }
    }
  }
  return doc.render({
    title: `Activity log · ${day}`,
    footer: (page, total) => `Activity log · ${day} · Page ${page} of ${total}`,
  });
}

export const Route = createFileRoute("/tracking")({
  component: TrackingPage,
});

function TrackingPage() {
  const [day, setDay] = useState(todayKey());
  const [log, setLog] = useState<DayLog>({});
  const [text, setText] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setLog(loadLog());
  }, []);

  const entries = (log[day] ?? []).slice().sort((a, b) => a.ts.localeCompare(b.ts));

  function addText() {
    if (!text.trim()) return;
    const entry: Entry = { id: crypto.randomUUID(), ts: new Date().toISOString(), kind: "text", body: text.trim() };
    const next = { ...log, [day]: [...(log[day] ?? []), entry] };
    setLog(next);
    saveLog(next);
    setText("");
  }

  function addPhoto(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const entry: Entry = { id: crypto.randomUUID(), ts: new Date().toISOString(), kind: "photo", dataUrl };
      const next = { ...log, [day]: [...(log[day] ?? []), entry] };
      setLog(next);
      saveLog(next);
    };
    reader.readAsDataURL(file);
  }

  async function shareDay() {
    setBusy(true);
    try {
      const jpegs = new Map<string, Uint8Array | null>();
      for (const e of entries) {
        if (e.kind === "photo" && e.dataUrl) {
          jpegs.set(e.id, await dataUrlToJpeg(e.dataUrl));
        }
      }
      const pdf = buildDayPdf(day, entries, jpegs);
      const blob = new Blob([pdf], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `tracking-${day}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-lg px-4 py-8">
      <h1 className="mb-2 text-2xl font-semibold">Tracking</h1>
      <p className="mb-4 text-sm text-muted">Simple timestamped activity log. Stored only in this browser.</p>

      <label className="mb-4 block text-sm">
        Day
        <input
          type="date"
          value={day}
          onChange={(e) => setDay(e.target.value)}
          className="mt-1 block w-full rounded border border-line bg-raised px-3 py-2"
        />
      </label>

      <div className="mb-4 space-y-3">
        {entries.length === 0 ? (
          <p className="text-muted">No entries for this day.</p>
        ) : (
          entries.map((e) => (
            <div key={e.id} className="rounded border border-line bg-raised p-3">
              <div className="mb-1 text-xs text-muted">{clock(e.ts)}</div>
              {e.kind === "text" ? (
                <p className="whitespace-pre-wrap">{e.body}</p>
              ) : e.dataUrl ? (
                <img src={e.dataUrl} alt="Entry" className="max-h-48 rounded" />
              ) : null}
            </div>
          ))
        )}
      </div>

      <div className="space-y-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Note…"
          rows={3}
          className="w-full rounded border border-line bg-raised px-3 py-2"
        />
        <div className="flex gap-2">
          <button
            type="button"
            onClick={addText}
            className="flex-1 rounded bg-fg px-4 py-2 text-raised"
          >
            Add note
          </button>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="rounded border border-line px-4 py-2"
          >
            Add photo
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) addPhoto(f);
              e.target.value = "";
            }}
          />
        </div>
        <button
          type="button"
          onClick={shareDay}
          disabled={busy}
          className="w-full rounded border border-line bg-raised px-4 py-2 disabled:opacity-60"
        >
          {busy ? "Making PDF…" : "Share day as PDF"}
        </button>
      </div>
    </main>
  );
}
