import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useMemo } from "react";
import { photoClockLabel } from "@/lib/report-entries";
import { preparePhoto } from "@/lib/photo-prepare";
import { WorkDayBar } from "@/components/work-day-bar";
import { PhotoDrop } from "@/components/photo-drop";
import { DayExport } from "@/components/day-export";
import { buildActivityPdf, type ActivityPdfItem } from "@/lib/activity-pdf";
import { photoCaptionHeading } from "@/lib/photo-caption";
import { MAX_CAPTION } from "@/lib/activity-share";
import { createActivityShare, getMyActivityShare, revokeActivityShare } from "@/lib/server/fns";
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
      body: "Rotten posts at the alley line.",
      dataUrl: swatch("Project A · fence", "#3d4a3a"),
      project: "Project A",
      takenAt: `${SAMPLE_DAY}T08:41:00.000Z`,
      takenSource: "exif",
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
      body: "Counted sheets. One box in the garage is damaged.",
      dataUrl: swatch("Project B · drywall", "#3a3328"),
      project: "Project B",
      takenAt: `${SAMPLE_DAY}T10:22:00.000Z`,
      takenSource: "file",
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

const SAMPLE_PHOTO: Record<string, Pick<Entry, "body" | "takenAt" | "takenSource">> = {
  s1p: {
    body: "Rotten posts at the alley line.",
    takenAt: `${SAMPLE_DAY}T08:41:00.000Z`,
    takenSource: "exif",
  },
  s3p: {
    body: "Counted sheets. One box in the garage is damaged.",
    takenAt: `${SAMPLE_DAY}T10:22:00.000Z`,
    takenSource: "file",
  },
};

/** Fill caption and clock on the sample photos when an older copy of the sample is already stored. */
function applySampleCaptions(log: DayLog): DayLog {
  const day = log[SAMPLE_DAY];
  if (!day) return log;
  let changed = false;
  const nextDay = day.map((entry) => {
    const sample = SAMPLE_PHOTO[entry.id];
    if (!sample) return entry;
    if (entry.body && entry.takenSource) return entry;
    changed = true;
    return {
      ...entry,
      body: entry.body || sample.body,
      takenAt: entry.takenAt ?? sample.takenAt,
      takenSource: entry.takenSource ?? sample.takenSource,
    };
  });
  if (!changed) return log;
  const next = { ...log, [SAMPLE_DAY]: nextDay };
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
  const [photoBusy, setPhotoBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [photoError, setPhotoError] = useState("");
  const [shareOpen, setShareOpen] = useState(false);
  const [canFileShare, setCanFileShare] = useState(false);
  const [linkToken, setLinkToken] = useState("");
  const [shareNote, setShareNote] = useState("");
  const [shareError, setShareError] = useState("");
  const [copied, setCopied] = useState(false);
  const [shareCheckedDay, setShareCheckedDay] = useState("");

  useEffect(() => {
    try {
      const file = new File([new Blob(["%PDF"])], "day.pdf", { type: "application/pdf" });
      setCanFileShare(typeof navigator.share === "function" && Boolean(navigator.canShare?.({ files: [file] })));
    } catch {
      setCanFileShare(false);
    }
  }, []);

  useEffect(() => {
    setLinkToken("");
    setShareCheckedDay("");
    setCopied(false);
    setShareNote("");
    setShareError("");
  }, [day]);

  useEffect(() => {
    const loaded = applySampleCaptions(seedSampleIfEmpty(loadLog()));
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

  async function addPhotos(files: File[]) {
    setPhotoBusy(true);
    setPhotoError("");
    const added: Entry[] = [];
    const errors: string[] = [];
    for (const file of files) {
      try {
        const photo = await preparePhoto(file);
        added.push({
          id: crypto.randomUUID(),
          ts: new Date().toISOString(),
          kind: "photo",
          body: "",
          dataUrl: photo.image,
          project: project || undefined,
          takenAt: photo.takenSource === "file" ? photo.fileTime : photo.takenAt,
          takenSource: photo.takenSource,
        });
      } catch (cause) {
        errors.push(cause instanceof Error ? cause.message : "Couldn't read that photo.");
      }
    }
    if (added.length) {
      const next = { ...log, [day]: [...(log[day] ?? []), ...added] };
      setLog(next);
      saveLog(next);
    }
    setPhotoError(errors[0] ?? "");
    setPhotoBusy(false);
  }

  function setCaption(id: string, body: string) {
    const next = {
      ...log,
      [day]: (log[day] ?? []).map((entry) => (entry.id === id ? { ...entry, body: body.slice(0, MAX_CAPTION) } : entry)),
    };
    setLog(next);
    saveLog(next);
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

  async function makePdf(): Promise<{ blob: Blob; name: string }> {
    const jpegs = new Map<string, Uint8Array | null>();
    for (const e of entries) {
      if (e.kind === "photo" && e.dataUrl) jpegs.set(e.id, await dataUrlToJpeg(e.dataUrl));
    }
    const items: ActivityPdfItem[] = entries.map((e) => {
      if (e.kind === "photo") {
        return {
          kind: "photo",
          captionTime: photoCaptionHeading({ takenAt: e.takenAt, takenSource: e.takenSource }, clock),
          caption: e.body ?? "",
          project: e.project,
          jpeg: jpegs.get(e.id) ?? null,
        };
      }
      const loc = e.lat != null && e.lng != null ? ` · ${e.lat.toFixed(5)}, ${e.lng.toFixed(5)}` : "";
      const label = e.kind === "project" ? "Project" : e.kind === "lunch" ? "Lunch" : "Note";
      return { kind: e.kind, stamp: `${clock(e.ts)}${loc} · ${label}`, body: e.body ?? "", project: e.project };
    });
    const pdf = buildActivityPdf({
      dayKey: day,
      dayLabel: new Date(day + "T12:00:00").toLocaleDateString([], { weekday: "long", month: "short", day: "numeric", year: "numeric" }),
      items,
      sessions: daySessions,
      projectTimes: displayTimes.map((pt) => ({ project: pt.project, label: formatMinutes(pt.minutes) })),
      totalLabel: formatMinutes(totalMinutes),
    });
    return { blob: new Blob([pdf as BlobPart], { type: "application/pdf" }), name: `tracking-${day}.pdf` };
  }

  function savePdf(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  async function downloadDay() {
    setExportBusy(true);
    setShareError("");
    try {
      const { blob, name } = await makePdf();
      savePdf(blob, name);
    } catch (cause) {
      setShareError(cause instanceof Error ? cause.message : "Couldn't make the PDF.");
    } finally {
      setExportBusy(false);
    }
  }

  async function shareFile() {
    setExportBusy(true);
    setShareError("");
    try {
      const { blob, name } = await makePdf();
      const file = new File([blob], name, { type: "application/pdf" });
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ title: `Activity log ${day}`, files: [file] });
        return;
      }
      savePdf(blob, name);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setShareError(cause instanceof Error ? cause.message : "Couldn't share the PDF.");
    } finally {
      setExportBusy(false);
    }
  }

  function shareFailure(cause: unknown): string {
    const message = cause instanceof Error ? cause.message : "";
    if (/unauthorized/i.test(message)) return "";
    if (/doc\.send/.test(message)) {
      return "A private link follows document sending. Owners, admins, and leads can create one. Labor can when Labor can send documents is on. Subs cannot.";
    }
    return message || "Couldn't create a link.";
  }

  async function openShare() {
    setShareOpen((open) => !open);
    setShareError("");
    if (shareOpen || shareCheckedDay === day) return;
    setShareCheckedDay(day);
    try {
      const mine = await getMyActivityShare({ data: { day } });
      if (mine?.token) setLinkToken(mine.token);
    } catch (cause) {
      const message = shareFailure(cause);
      if (!message) setShareNote("Sign in to create a private link. Download saves the PDF on this device.");
      else setShareError(message);
    }
  }

  function snapshot() {
    return {
      day,
      entries: entries.map((e) => ({
        id: e.id,
        kind: e.kind,
        body: e.body ?? "",
        image: e.kind === "photo" ? (e.dataUrl ?? "") : "",
        takenAt: e.takenAt ?? null,
        takenSource: e.takenSource ?? null,
        project: e.project ?? "",
        ts: e.ts,
      })),
      sessions: daySessions.map((session) => ({
        id: session.id,
        startMin: session.startMin,
        endMin: session.endMin,
        project: session.projectName,
        notes: session.notes,
      })),
    };
  }

  async function createLink() {
    setExportBusy(true);
    setShareError("");
    setShareNote("");
    try {
      const created = await createActivityShare({ data: snapshot() });
      setLinkToken(created.token);
      setShareCheckedDay(day);
    } catch (cause) {
      const message = shareFailure(cause);
      if (!message) setShareNote("Sign in to create a private link. Download saves the PDF on this device.");
      else setShareError(message);
    } finally {
      setExportBusy(false);
    }
  }

  async function copyLink() {
    const url = `${window.location.origin}/share/${linkToken}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setShareError("Select the link and copy it.");
    }
  }

  async function removeLink() {
    if (!linkToken) return;
    setExportBusy(true);
    setShareError("");
    try {
      await revokeActivityShare({ data: { token: linkToken } });
      setLinkToken("");
      setCopied(false);
    } catch (cause) {
      setShareError(cause instanceof Error ? cause.message : "Couldn't remove the link.");
    } finally {
      setExportBusy(false);
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
          This is a sample day. Green on the bar is hours already saved. Drop photos below and write a caption under each one.
        </div>
      )}

      <WorkDayBar sessions={daySessions} projects={projectChoices} freeText canWrite={false} onSave={() => {}} onDelete={() => {}} />
      <div className="mt-4">
        <PhotoDrop busy={photoBusy} onFiles={(files) => void addPhotos(files)} />
      </div>
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
          <p className="text-muted">No entries for this day yet. Drop photos above, or use the green button for a note or lunch.</p>
        ) : (
          entries.map((e) =>
            e.kind === "photo" ? (
              <figure key={e.id} className="rounded border border-line bg-raised p-3" data-testid="photo-caption">
                {e.project ? <p className="mb-1 text-xs text-muted">{e.project}</p> : null}
                {e.dataUrl ? <img src={e.dataUrl} alt="" className="max-h-48 rounded" /> : null}
                <figcaption className="mt-2">
                  <p className="text-sm font-medium tabular-nums" data-testid="photo-caption-time">
                    {photoCaptionHeading({ takenAt: e.takenAt, takenSource: e.takenSource }, clock) || "Time not recorded"}
                  </p>
                  <textarea
                    className="field mt-1"
                    maxLength={MAX_CAPTION}
                    placeholder="Add a caption"
                    aria-label="Caption"
                    value={e.body ?? ""}
                    onChange={(event) => setCaption(e.id, event.target.value)}
                  />
                </figcaption>
              </figure>
            ) : (
              <div key={e.id} className="rounded border border-line bg-raised p-3">
                <div className="mb-1 text-xs text-muted">
                  {photoWhen(e)}
                  {e.lat != null && e.lng != null ? ` · ${e.lat.toFixed(4)}, ${e.lng.toFixed(4)}` : ""}
                  {e.project ? ` · ${e.project}` : ""}
                </div>
                <p className="whitespace-pre-wrap">{e.body}</p>
              </div>
            ),
          )
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

      <DayExport
        busy={exportBusy}
        shareOpen={shareOpen}
        canFileShare={canFileShare}
        linkUrl={linkToken ? `${typeof window === "undefined" ? "" : window.location.origin}/share/${linkToken}` : ""}
        note={shareNote}
        error={shareError}
        copied={copied}
        onDownload={() => void downloadDay()}
        onToggleShare={() => void openShare()}
        onShareFile={() => void shareFile()}
        onCreateLink={() => void createLink()}
        onCopy={() => void copyLink()}
        onRevoke={() => void removeLink()}
      />

      {menuOpen && (
        <div className="fixed bottom-28 right-6 z-40 flex w-56 flex-col gap-1 rounded-xl border border-line bg-raised p-2 shadow-lg">
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
    </main>
  );
}
