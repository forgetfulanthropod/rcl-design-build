import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useRef } from "react";
import { PdfDoc } from "@/lib/pdf";

type Entry = {
  id: string;
  ts: string; // ISO
  kind: "text" | "photo" | "project" | "lunch";
  body?: string;
  dataUrl?: string;
  lat?: number;
  lng?: number;
  project?: string;
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

async function getLocation(): Promise<{ lat: number; lng: number } | null> {
  if (!navigator.geolocation) return null;
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000 },
    );
  });
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
    const loc = e.lat != null && e.lng != null ? ` · ${e.lat.toFixed(5)}, ${e.lng.toFixed(5)}` : "";
    const label = e.kind === "photo" ? "Photo" : e.kind === "project" ? "Project" : e.kind === "lunch" ? "Lunch" : "Note";
    doc.ensure(20);
    doc.paragraph(`${stamp}${loc} · ${label}`, 9.5, { bold: true, gray: 0.4 });
    if (e.body) doc.paragraph(e.body, 11.5);
    if (e.project) doc.paragraph(`Project: ${e.project}`, 11);
    if (e.kind === "photo") {
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
  const [projectName, setProjectName] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setLog(loadLog());
  }, []);

  const entries = (log[day] ?? []).slice().sort((a, b) => a.ts.localeCompare(b.ts));

  async function addEntry(partial: Omit<Entry, "id" | "ts">) {
    const loc = await getLocation();
    const entry: Entry = {
      id: crypto.randomUUID(),
      ts: new Date().toISOString(),
      ...partial,
      lat: loc?.lat,
      lng: loc?.lng,
    };
    const next = { ...log, [day]: [...(log[day] ?? []), entry] };
    setLog(next);
    saveLog(next);
  }

  function addNote() {
    if (!text.trim()) return;
    void addEntry({ kind: "text", body: text.trim() });
    setText("");
    setMenuOpen(false);
  }

  function addProject() {
    const name = projectName.trim() || "Project";
    void addEntry({ kind: "project", project: name, body: name });
    setProjectName("");
    setMenuOpen(false);
  }

  function addLunch() {
    void addEntry({ kind: "lunch", body: "Lunch" });
    setMenuOpen(false);
  }

  function addPhoto(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      void addEntry({ kind: "photo", dataUrl });
    };
    reader.readAsDataURL(file);
    setMenuOpen(false);
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
      const file = new File([blob], `tracking-${day}.pdf`, { type: "application/pdf" });

      // Prefer Web Share API (mobile can share directly to email)
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          title: `Activity log ${day}`,
          text: `Activity log for ${day}`,
          files: [file],
        });
        return;
      }

      // Fallback: download + open mailto with instructions
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `tracking-${day}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);

      const mailto = `mailto:?subject=${encodeURIComponent(`Activity log ${day}`)}&body=${encodeURIComponent(`Activity log for ${day} is attached (downloaded as tracking-${day}.pdf).`)}`;
      window.open(mailto, "_blank");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="relative mx-auto max-w-lg px-4 pb-28 pt-8">
      <h1 className="mb-2 text-2xl font-semibold">Activity log</h1>
      <p className="mb-4 text-sm text-muted">Time and location are logged automatically. Stored only in this browser.</p>

      <label className="mb-4 block text-sm">
        Day
        <input
          type="date"
          value={day}
          onChange={(e) => setDay(e.target.value)}
          className="mt-1 block w-full rounded border border-line bg-raised px-3 py-2"
        />
      </label>

      <div className="mb-6 space-y-3">
        {entries.length === 0 ? (
          <p className="text-muted">No entries for this day.</p>
        ) : (
          entries.map((e) => (
            <div key={e.id} className="rounded border border-line bg-raised p-3">
              <div className="mb-1 text-xs text-muted">
                {clock(e.ts)}
                {e.lat != null && e.lng != null ? ` · ${e.lat.toFixed(4)}, ${e.lng.toFixed(4)}` : ""}
              </div>
              {e.kind === "text" || e.kind === "project" || e.kind === "lunch" ? (
                <p className="whitespace-pre-wrap">{e.body}</p>
              ) : e.dataUrl ? (
                <img src={e.dataUrl} alt="Entry" className="max-h-48 rounded" />
              ) : null}
            </div>
          ))
        )}
      </div>

      <button
        type="button"
        onClick={shareDay}
        disabled={busy}
        className="w-full rounded border border-line bg-raised px-4 py-3 text-base font-medium disabled:opacity-60"
      >
        {busy ? "Preparing…" : "Share day as PDF (email)"}
      </button>

      {/* Bottom-right FAB menu */}
      <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3">
        {menuOpen && (
          <div className="flex flex-col items-end gap-2 rounded-xl border border-line bg-raised p-2 shadow-lg">
            <button
              type="button"
              onClick={addProject}
              className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm hover:bg-surface"
            >
              <span className="text-lg">📋</span> Project
            </button>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm hover:bg-surface"
            >
              <span className="text-lg">📷</span> Photo
            </button>
            <button
              type="button"
              onClick={addNote}
              className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm hover:bg-surface"
            >
              <span className="text-lg">📝</span> Note
            </button>
            <button
              type="button"
              onClick={addLunch}
              className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm hover:bg-surface"
            >
              <span className="text-lg">🍽️</span> Lunch
            </button>
          </div>
        )}
        <button
          type="button"
          onClick={() => setMenuOpen((o) => !o)}
          className="flex h-16 w-16 items-center justify-center rounded-full bg-green-600 text-2xl text-white shadow-lg transition hover:bg-green-700 active:scale-95"
          aria-label="Log activity"
        >
          {menuOpen ? "✕" : "🕒"}
        </button>
      </div>

      {/* Hidden inputs for note / project / photo */}
      <div className="sr-only">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) addPhoto(f);
            e.target.value = "";
          }}
        />
      </div>

      {/* Quick note / project fields shown when menu open */}
      {menuOpen && (
        <div className="fixed bottom-28 right-6 z-40 w-64 rounded-xl border border-line bg-raised p-3 shadow-lg">
          <input
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            placeholder="Project name…"
            className="mb-2 w-full rounded border border-line bg-surface px-2 py-1 text-sm"
          />
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Note…"
            rows={2}
            className="w-full rounded border border-line bg-surface px-2 py-1 text-sm"
          />
        </div>
      )}
    </main>
  );
}
