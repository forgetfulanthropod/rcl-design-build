import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useRef, useMemo } from "react";
import { PdfDoc } from "@/lib/pdf";

type Entry = {
  id: string;
  ts: string;
  kind: "text" | "photo" | "project" | "lunch";
  body?: string;
  dataUrl?: string;
  lat?: number;
  lng?: number;
  project?: string;
};

type DayLog = Record<string, Entry[]>;
type TimeOverrides = Record<string, Record<string, number>>;

const STORAGE_KEY = "rcl-tracking-log";
const TIMES_KEY = "rcl-tracking-times";
const SAMPLE_DAY = "2026-11-02";

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

function loadTimes(): TimeOverrides {
  try {
    const raw = localStorage.getItem(TIMES_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveTimes(times: TimeOverrides) {
  localStorage.setItem(TIMES_KEY, JSON.stringify(times));
}

function seedSampleIfEmpty(log: DayLog): DayLog {
  if (Object.keys(log).length > 0) return log;
  const sample: Entry[] = [
    {
      id: "s1",
      ts: `${SAMPLE_DAY}T08:32:00.000Z`,
      kind: "text",
      body: "Picked up Mr Smith’s terrier. Energetic start, good leash manners.",
      project: "Mr Smith terrier",
      lat: 38.04,
      lng: -84.5,
    },
    {
      id: "s1p",
      ts: `${SAMPLE_DAY}T08:40:00.000Z`,
      kind: "photo",
      dataUrl: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0MDAiIGhlaWdodD0iMzAwIj48cmVjdCB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgZmlsbD0iIzRhNTU2OCIvPjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiBmb250LXNpemU9IjI0IiBmaWxsPSJ3aGl0ZSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPk1yIFNtaXRoIFRlcnJpZXI8L3RleHQ+PC9zdmc+",
      project: "Mr Smith terrier",
    },
    {
      id: "s2",
      ts: `${SAMPLE_DAY}T09:05:00.000Z`,
      kind: "text",
      body: "Walked the neighborhood loop. Terrier wanted to chase squirrels.",
      project: "Mr Smith terrier",
    },
    {
      id: "s3",
      ts: `${SAMPLE_DAY}T10:15:00.000Z`,
      kind: "text",
      body: "Picked up Mrs Jones’s schnauzer. Calm and well-trained.",
      project: "Mrs Jones schnauzer",
    },
    {
      id: "s3p",
      ts: `${SAMPLE_DAY}T10:22:00.000Z`,
      kind: "photo",
      dataUrl: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0MDAiIGhlaWdodD0iMzAwIj48cmVjdCB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgZmlsbD0iIzJkMzc0OCIvPjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiBmb250LXNpemU9IjI0IiBmaWxsPSJ3aGl0ZSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPk1ycyBKb25lcyBTY2huYXV6ZXI8L3RleHQ+PC9zdmc+",
      project: "Mrs Jones schnauzer",
    },
    {
      id: "s4",
      ts: `${SAMPLE_DAY}T11:40:00.000Z`,
      kind: "text",
      body: "Park time with both dogs. They played well together.",
      project: "Mrs Jones schnauzer",
    },
    {
      id: "s5",
      ts: `${SAMPLE_DAY}T12:30:00.000Z`,
      kind: "lunch",
      body: "Lunch break",
      project: "Lunch",
    },
    {
      id: "s6",
      ts: `${SAMPLE_DAY}T13:45:00.000Z`,
      kind: "text",
      body: "Dropped schnauzer back. Mrs Jones happy with the report.",
      project: "Mrs Jones schnauzer",
    },
    {
      id: "s7",
      ts: `${SAMPLE_DAY}T14:50:00.000Z`,
      kind: "text",
      body: "Final walk with terrier and drop-off. All good.",
      project: "Mr Smith terrier",
    },
  ];
  const next = { ...log, [SAMPLE_DAY]: sample };
  saveLog(next);
  return next;
}

function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatMinutes(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function formatDayLabel(day: string): string {
  try {
    const d = new Date(day + "T12:00:00");
    return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
  } catch {
    return day;
  }
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

function buildDayPdf(day: string, entries: Entry[], jpegs: Map<string, Uint8Array | null>, projectTimes: { project: string; minutes: number }[]): Uint8Array {
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
  if (projectTimes.length > 0) {
    doc.gap(12);
    doc.rule();
    doc.paragraph("Project time", 14, { bold: true });
    let total = 0;
    for (const pt of projectTimes) {
      doc.paragraph(`${pt.project}: ${formatMinutes(pt.minutes)}`, 11);
      total += pt.minutes;
    }
    doc.paragraph(`Total: ${formatMinutes(total)}`, 12, { bold: true });
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
  const [times, setTimes] = useState<TimeOverrides>({});
  const [project, setProject] = useState("");
  const [text, setText] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const loaded = seedSampleIfEmpty(loadLog());
    setLog(loaded);
    setTimes(loadTimes());
    if (loaded[SAMPLE_DAY] && !loaded[todayKey()]) {
      setDay(SAMPLE_DAY);
    }
  }, []);

  const allDays = useMemo(() => {
    return Object.keys(log).sort().reverse();
  }, [log]);

  const entries = (log[day] ?? []).slice().sort((a, b) => a.ts.localeCompare(b.ts));

  const autoProjectMinutes = useMemo(() => {
    const result: Record<string, number> = {};
    if (entries.length === 0) return result;
    const sorted = [...entries];
    for (let i = 0; i < sorted.length; i++) {
      const e = sorted[i];
      const proj = e.project || "Unassigned";
      const start = new Date(e.ts).getTime();
      let end = start;
      if (i + 1 < sorted.length) {
        end = new Date(sorted[i + 1].ts).getTime();
      } else if (day === todayKey()) {
        end = Date.now();
      }
      const mins = Math.max(0, (end - start) / 60000);
      result[proj] = (result[proj] || 0) + mins;
    }
    return result;
  }, [entries, day]);

  const projectList = useMemo(() => {
    const set = new Set<string>();
    entries.forEach((e) => set.add(e.project || "Unassigned"));
    if (project) set.add(project);
    return Array.from(set);
  }, [entries, project]);

  const displayTimes = useMemo(() => {
    const overrides = times[day] || {};
    return projectList.map((p) => ({
      project: p,
      minutes: overrides[p] != null ? overrides[p] : Math.round(autoProjectMinutes[p] || 0),
      isOverride: overrides[p] != null,
    }));
  }, [projectList, autoProjectMinutes, times, day]);

  const totalMinutes = displayTimes.reduce((s, t) => s + t.minutes, 0);

  async function addEntry(partial: Omit<Entry, "id" | "ts">) {
    const loc = await getLocation();
    const entry: Entry = {
      id: crypto.randomUUID(),
      ts: new Date().toISOString(),
      project: project || undefined,
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

  function setProjectMinutes(proj: string, minutes: number) {
    const next = { ...times, [day]: { ...(times[day] || {}), [proj]: minutes } };
    setTimes(next);
    saveTimes(next);
  }

  function createToday() {
    setDay(todayKey());
    if (!log[todayKey()]) {
      const next = { ...log, [todayKey()]: [] };
      setLog(next);
      saveLog(next);
    }
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
      const pdf = buildDayPdf(day, entries, jpegs, displayTimes);
      const blob = new Blob([pdf], { type: "application/pdf" });
      const file = new File([blob], `tracking-${day}.pdf`, { type: "application/pdf" });

      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          title: `Activity log ${day}`,
          text: `Activity log for ${day}`,
          files: [file],
        });
        return;
      }

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

  const isSample = day === SAMPLE_DAY;

  return (
    <main className="relative mx-auto max-w-lg px-4 pb-28 pt-8">
      <h1 className="mb-2 text-2xl font-semibold">Activity log</h1>
      <p className="mb-4 text-sm text-muted">
        Day-by-day tracking. Everything stays in this browser. See the sample day, then start your own.
      </p>

      <div className="mb-4">
        <div className="mb-2 flex items-center justify-between text-sm">
          <span className="font-medium">Your days</span>
          <button
            type="button"
            onClick={createToday}
            className="rounded border border-line px-2 py-1 text-xs"
          >
            + Today
          </button>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {allDays.length === 0 ? (
            <span className="text-xs text-muted">No days yet</span>
          ) : (
            allDays.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDay(d)}
                className={`shrink-0 rounded-full border px-3 py-1 text-xs ${
                  d === day ? "border-green-600 bg-green-600 text-white" : "border-line bg-raised"
                }`}
              >
                {formatDayLabel(d)}
                {d === SAMPLE_DAY ? " · sample" : ""}
                <span className="ml-1 opacity-70">({(log[d] ?? []).length})</span>
              </button>
            ))
          )}
        </div>
      </div>

      {isSample && (
        <div className="mb-4 rounded border border-dashed border-green-600/40 bg-green-600/5 p-3 text-sm">
          This is a sample day of dog walking. Switch projects (clients) as you go. Tap + Today to start your own day.
        </div>
      )}

      <label className="mb-4 block text-sm">
        Current project / client
        <input
          value={project}
          onChange={(e) => setProject(e.target.value)}
          placeholder="e.g. Mr Smith terrier"
          className="mt-1 block w-full rounded border border-line bg-raised px-3 py-2"
        />
      </label>

      <label className="mb-4 block text-sm">
        Day
        <input
          type="date"
          value={day}
          onChange={(e) => {
            const v = e.target.value;
            setDay(v);
            if (v && !log[v]) {
              const next = { ...log, [v]: [] };
              setLog(next);
              saveLog(next);
            }
          }}
          className="mt-1 block w-full rounded border border-line bg-raised px-3 py-2"
        />
      </label>

      <div className="mb-6 space-y-3">
        {entries.length === 0 ? (
          <p className="text-muted">No entries for this day yet. Use the green button to log something.</p>
        ) : (
          entries.map((e) => (
            <div key={e.id} className="rounded border border-line bg-raised p-3">
              <div className="mb-1 text-xs text-muted">
                {clock(e.ts)}
                {e.lat != null && e.lng != null ? ` · ${e.lat.toFixed(4)}, ${e.lng.toFixed(4)}` : ""}
                {e.project ? ` · ${e.project}` : ""}
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

      {displayTimes.length > 0 && (
        <div className="mb-6 rounded border border-line bg-raised p-4">
          <h2 className="mb-3 text-sm font-semibold">Project time</h2>
          <div className="space-y-2">
            {displayTimes.map((pt) => (
              <div key={pt.project} className="flex items-center justify-between text-sm">
                <span>{pt.project}</span>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={pt.minutes}
                  onChange={(e) => setProjectMinutes(pt.project, Number(e.target.value) || 0)}
                  className="w-20 rounded border border-line bg-surface px-2 py-1 text-right text-sm"
                />
                <span className="w-16 text-right text-muted">{formatMinutes(pt.minutes)}</span>
              </div>
            ))}
            <div className="mt-2 flex items-center justify-between border-t border-line pt-2 text-sm font-medium">
              <span>Total</span>
              <span>{formatMinutes(totalMinutes)}</span>
            </div>
          </div>
          <p className="mt-2 text-xs text-muted">Times are automatic from your logs. Edit the minutes to override.</p>
        </div>
      )}

      <button
        type="button"
        onClick={shareDay}
        disabled={busy}
        className="w-full rounded border border-line bg-raised px-4 py-3 text-base font-medium disabled:opacity-60"
      >
        {busy ? "Preparing…" : "Share day as PDF (email)"}
      </button>

      {menuOpen && (
        <div className="fixed bottom-28 right-6 z-40 flex w-56 flex-col gap-1 rounded-xl border border-line bg-raised p-2 shadow-lg">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex items-center gap-3 rounded-lg px-4 py-3 text-left text-sm hover:bg-surface"
          >
            <span className="text-xl">📷</span>
            <span>Photo</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setMenuOpen(false);
              const note = prompt("Note:");
              if (note?.trim()) void addEntry({ kind: "text", body: note.trim() });
            }}
            className="flex items-center gap-3 rounded-lg px-4 py-3 text-left text-sm hover:bg-surface"
          >
            <span className="text-xl">📝</span>
            <span>Note</span>
          </button>
          <button
            type="button"
            onClick={addLunch}
            className="flex items-center gap-3 rounded-lg px-4 py-3 text-left text-sm hover:bg-surface"
          >
            <span className="text-xl">🍽️</span>
            <span>Lunch</span>
          </button>
        </div>
      )}

      <div className="fixed bottom-6 right-6 z-50">
        <button
          type="button"
          onClick={() => setMenuOpen((o) => !o)}
          className="flex h-16 w-16 items-center justify-center rounded-full bg-green-600 text-2xl text-white shadow-lg transition hover:bg-green-700 active:scale-95"
          aria-label="Log activity"
        >
          {menuOpen ? "✕" : "🕒"}
        </button>
      </div>

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
    </main>
  );
}
