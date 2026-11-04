import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useRef, useMemo } from "react";
import { PdfDoc } from "@/lib/pdf";
import { drawSessionCaption } from "@/lib/session-caption";
import { photoClockLabel } from "@/lib/report-entries";
import { preparePhoto } from "@/lib/photo-prepare";
import { WorkDayBar } from "@/components/work-day-bar";
import type { PhotoTimeSource } from "@/lib/photo-upload";
import type { WorkSession } from "@/lib/work-sessions";

type Entry = {
  id: string;
  ts: string;
  kind: "text" | "photo" | "project" | "lunch";
  body?: string;
  dataUrl?: string;
  lat?: number;
  lng?: number;
  project?: string;
  /** Capture clock when this is a photo: camera time, or file time when there is no EXIF. */
  takenAt?: string | null;
  takenSource?: PhotoTimeSource | null;
};

type DayLog = Record<string, Entry[]>;
type TimeOverrides = Record<string, Record<string, number>>;
type StoredSession = { id: string; startMin: number; endMin: number; project: string; notes: string };
type SessionLog = Record<string, StoredSession[]>;

const STORAGE_KEY = "rcl-tracking-log";
const TIMES_KEY = "rcl-tracking-times";
const SESSIONS_KEY = "rcl-tracking-sessions";
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

function loadSessions(): SessionLog {
  try {
    const raw = localStorage.getItem(SESSIONS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveSessions(sessions: SessionLog) {
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
}

function swatch(label: string, color: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480" fill="${color}"/><text x="50%" y="50%" font-size="32" fill="white" text-anchor="middle" dy=".3em" font-family="sans-serif">${label}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const SAMPLE_SESSIONS: StoredSession[] = [
  { id: "ss-a", startMin: 8 * 60, endMin: 11 * 60 + 30, project: "Project A", notes: "demolish fence" },
  { id: "ss-b", startMin: 13 * 60, endMin: 16 * 60, project: "Project B", notes: "drywall takeoffs" },
];

function seedSampleIfEmpty(log: DayLog): DayLog {
  if (Object.keys(log).length > 0) return log;
  const sample: Entry[] = [
    {
      id: "s1",
      ts: `${SAMPLE_DAY}T08:32:00.000Z`,
      kind: "text",
      body: "Demolish the alley fence. Posts were rotten at the base.",
      project: "Project A",
      lat: 38.04,
      lng: -84.5,
    },
    {
      id: "s1p",
      ts: `${SAMPLE_DAY}T08:40:00.000Z`,
      kind: "photo",
      dataUrl: swatch("Project A · fence", "#3d4a3a"),
      project: "Project A",
    },
    {
      id: "s2",
      ts: `${SAMPLE_DAY}T09:05:00.000Z`,
      kind: "text",
      body: "Hauled the old boards and marked the post holes for the new line.",
      project: "Project A",
    },
    {
      id: "s3",
      ts: `${SAMPLE_DAY}T10:15:00.000Z`,
      kind: "text",
      body: "Started drywall takeoffs for the upstairs bedrooms.",
      project: "Project B",
    },
    {
      id: "s3p",
      ts: `${SAMPLE_DAY}T10:22:00.000Z`,
      kind: "photo",
      dataUrl: swatch("Project B · drywall", "#3a3328"),
      project: "Project B",
    },
    {
      id: "s4",
      ts: `${SAMPLE_DAY}T11:40:00.000Z`,
      kind: "text",
      body: "Counted sheets and noted the damaged box in the garage.",
      project: "Project B",
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
      body: "Dropped the takeoff with the office and locked the gate.",
      project: "Project B",
    },
    {
      id: "s7",
      ts: `${SAMPLE_DAY}T14:50:00.000Z`,
      kind: "text",
      body: "Backfilled the fence line and left the site clean.",
      project: "Project A",
    },
  ];
  const next = { ...log, [SAMPLE_DAY]: sample };
  saveLog(next);
  return next;
}

function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

const PHOTO_FMT = {
  clock: (iso: string) => clock(iso),
  dayKey: (iso: string) => {
    const d = new Date(iso);
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  },
  shortDay: (iso: string) => new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" }),
};

/** The time a photo entry shows: camera time, or file time marked as not the camera. */
function photoWhen(e: Entry): string {
  if (e.kind !== "photo") return clock(e.ts);
  const fields = e.takenSource === "file" ? { fileTime: e.takenAt } : { takenAt: e.takenAt };
  return photoClockLabel(fields, e.ts, PHOTO_FMT) || clock(e.ts);
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

function buildDayPdf(
  day: string,
  entries: Entry[],
  jpegs: Map<string, Uint8Array | null>,
  projectTimes: { project: string; minutes: number }[],
  sessions: WorkSession[],
): Uint8Array {
  const doc = new PdfDoc();
  doc.paragraph("Activity log", 22, { bold: true, leading: 28 });
  doc.gap(4);
  doc.paragraph(`Day: ${new Date(day + "T12:00:00").toLocaleDateString([], { weekday: "long", month: "short", day: "numeric", year: "numeric" })}`, 12);
  doc.paragraph(`Entries: ${entries.length}`, 11, { gray: 0.4 });
  doc.rule();
  if (entries.length === 0) doc.paragraph("Nothing logged yet.", 11, { gray: 0.35 });
  for (const e of entries) {
    doc.gap(8);
    const loc = e.lat != null && e.lng != null ? ` · ${e.lat.toFixed(5)}, ${e.lng.toFixed(5)}` : "";
    const label = e.kind === "photo" ? "Photo" : e.kind === "project" ? "Project" : e.kind === "lunch" ? "Lunch" : "Note";
    doc.ensure(20);
    doc.paragraph(`${photoWhen(e)}${loc} · ${label}`, 9.5, { bold: true, gray: 0.4 });
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
  drawSessionCaption(doc, sessions);
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
  const [sessions, setSessions] = useState<SessionLog>({});
  const [project, setProject] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [photoError, setPhotoError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const loaded = seedSampleIfEmpty(loadLog());
    setLog(loaded);
    setTimes(loadTimes());
    const stored = loadSessions();
    if (!stored[SAMPLE_DAY] && loaded[SAMPLE_DAY]) stored[SAMPLE_DAY] = SAMPLE_SESSIONS;
    setSessions(stored);
    saveSessions(stored);
    if (loaded[SAMPLE_DAY] && !loaded[todayKey()]) {
      setDay(SAMPLE_DAY);
    }
  }, []);

  const allDays = useMemo(() => {
    return Object.keys(log).sort().reverse();
  }, [log]);

  const entries = (log[day] ?? []).slice().sort((a, b) => a.ts.localeCompare(b.ts));

  const daySessions = useMemo<WorkSession[]>(
    () =>
      (sessions[day] ?? []).map((session) => ({
        id: session.id,
        day,
        projectId: null,
        projectName: session.project,
        startMin: session.startMin,
        endMin: session.endMin,
        notes: session.notes,
      })),
    [sessions, day],
  );

  const projectChoices = useMemo(() => {
    const names = new Set<string>();
    for (const entry of entries) if (entry.project) names.add(entry.project);
    for (const session of daySessions) names.add(session.projectName);
    if (project.trim()) names.add(project.trim());
    return [...names].map((name) => ({ id: name, name }));
  }, [entries, daySessions, project]);

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

  function addLunch() {
    void addEntry({ kind: "lunch", body: "Lunch" });
    setMenuOpen(false);
  }

  function addPhoto(file: File) {
    setBusy(true);
    setPhotoError("");
    setMenuOpen(false);
    void preparePhoto(file)
      .then((photo) => {
        void addEntry({
          kind: "photo",
          dataUrl: photo.image,
          takenAt: photo.takenSource === "file" ? photo.fileTime : photo.takenAt,
          takenSource: photo.takenSource,
        });
      })
      .catch((cause: unknown) => {
        setPhotoError(cause instanceof Error ? cause.message : "Couldn't read that photo.");
      })
      .finally(() => setBusy(false));
  }

  function writeSessions(next: SessionLog) {
    setSessions(next);
    saveSessions(next);
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
      const pdf = buildDayPdf(day, entries, jpegs, displayTimes, daySessions);
      const blob = new Blob([pdf as BlobPart], { type: "application/pdf" });
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
          This is a sample day. Green on the bar is hours from work sessions. Tap + Today to start your own day.
        </div>
      )}

      <WorkDayBar
        sessions={daySessions}
        projects={projectChoices}
        freeText
        canWrite
        onSave={(input) => {
          const row: StoredSession = {
            id: input.id ?? crypto.randomUUID(),
            startMin: input.startMin,
            endMin: input.endMin,
            project: input.projectName,
            notes: input.notes,
          };
          const list = sessions[day] ?? [];
          const next = { ...sessions, [day]: input.id ? list.map((item) => (item.id === input.id ? row : item)) : [...list, row] };
          writeSessions(next);
        }}
        onDelete={(id) => {
          writeSessions({ ...sessions, [day]: (sessions[day] ?? []).filter((item) => item.id !== id) });
        }}
      />
      {photoError ? (
        <p className="mt-3 text-sm text-danger" role="alert">
          {photoError}
        </p>
      ) : null}

      <label className="mb-4 mt-4 block text-sm">
        Current project / client
        <input
          value={project}
          onChange={(e) => setProject(e.target.value)}
          placeholder="e.g. Project A"
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
                {photoWhen(e)}
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
        accept="image/*,.heic,.heif"
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
