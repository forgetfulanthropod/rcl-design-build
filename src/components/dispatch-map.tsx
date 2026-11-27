import { useCallback, useEffect, useRef, useState } from "react";
import type { LayerGroup, Map as LeafletMap } from "leaflet";
import "leaflet/dist/leaflet.css";
import { assignDispatchCrew, getDispatchMap } from "@/lib/server/fns";
import {
  asOfFromIndex,
  crewOptions,
  formatMapDay,
  indexFromAsOf,
  mapDayCaption,
  selectDispatchMap,
  sliderSpan,
  type DispatchMapFacts,
  type JobBubble,
  type WorkerChip,
} from "@/lib/dispatch-map";
import { Button, ErrorBanner, Skeleton } from "@/components/ui";

type LeafletNS = typeof import("leaflet");

const FACE = 36;
const FACE_COMPACT = 30;
const BUBBLE = 72;
const BUBBLE_COMPACT = 56;

function message(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function sideWidth(count: number, face: number): number {
  if (count <= 0) return 0;
  const shown = Math.min(count, 4);
  return shown * face + (count > 4 ? 24 : 0);
}

function faces(people: WorkerChip[], side: "left" | "right"): string {
  const shown = people.slice(0, 4);
  const extra = people.length - shown.length;
  const icons = shown
    .map(
      (person) => `<span class="dispatch-face" title="${esc(person.name)}, ${person.days} day${person.days === 1 ? "" : "s"}">
        <span class="dispatch-initials">${esc(person.initials)}</span>
        ${person.days > 0 ? `<span class="dispatch-days">${person.days}</span>` : ""}
      </span>`,
    )
    .join("");
  const more = extra > 0 ? `<span class="dispatch-more">+${extra}</span>` : "";
  return `<span class="dispatch-faces" data-side="${side}">${icons}${more}</span>`;
}

function pinHtml(job: JobBubble, bubble: number): string {
  return `<div class="dispatch-pin-row" style="--bubble:${bubble}px;--face:${Math.round(bubble * 0.44)}px">
    ${faces(job.lastActive, "left")}
    <span class="dispatch-bubble-col">
      <span class="dispatch-flag${job.needsCrew ? "" : " dispatch-flag-spacer"}">${job.needsCrew ? "Needs crew" : ""}</span>
      <span class="dispatch-bubble" data-stage="${job.stage}" style="--p:${job.percent}">
        <span class="dispatch-bubble-core">${job.percent}</span>
      </span>
    </span>
    ${faces(job.nextCrew, "right")}
  </div>`;
}

function bubbleLabel(job: JobBubble): string {
  return [
    job.name,
    job.stage,
    `${job.percent} percent`,
    job.lastActive.length
      ? `Last on the job: ${job.lastActive.map((person) => `${person.name} ${person.days}`).join(", ")}`
      : "No one on the job yet",
    job.nextCrew.length
      ? `Next day: ${job.nextCrew.map((person) => person.name).join(", ")}`
      : "Next day: nobody",
    job.needsCrew ? "Needs a crew" : "",
  ]
    .filter(Boolean)
    .join(". ");
}

async function loadLeaflet(): Promise<LeafletNS> {
  const mod = await import("leaflet");
  const candidate = (mod as { default?: LeafletNS }).default;
  if (candidate && typeof candidate.map === "function") return candidate;
  if (typeof (mod as unknown as LeafletNS).map === "function") return mod as unknown as LeafletNS;
  throw new Error("The map could not be loaded.");
}

export function DispatchMap() {
  const [facts, setFacts] = useState<DispatchMapFacts | null>(null);
  const [asOf, setAsOf] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const canvas = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const layerRef = useRef<LayerGroup | null>(null);
  const fitted = useRef(false);
  const openRef = useRef<(id: string) => void>(() => {});
  openRef.current = (id) => setOpenId(id);

  const load = useCallback(() => {
    setError("");
    return getDispatchMap()
      .then((next) => {
        setFacts(next);
        setAsOf((current) => current ?? next.today);
      })
      .catch((cause: unknown) => setError(message(cause, "Could not load the map.")));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const view = facts && asOf ? selectDispatchMap(facts, asOf) : null;
  const viewRef = useRef(view);
  viewRef.current = view;
  const markerKey = view
    ? `${view.asOf}|${view.jobs
        .map((job) =>
          [
            job.id,
            job.percent,
            job.stage,
            job.needsCrew ? 1 : 0,
            job.lastActive.map((person) => `${person.userId}:${person.days}`).join("."),
            job.nextCrew.map((person) => `${person.userId}:${person.days}`).join("."),
          ].join("~"),
        )
        .join("||")}`
    : "";

  const mapSlot = facts ? "ready" : "wait";
  useEffect(() => {
    const node = canvas.current;
    if (!node) return;
    let cancelled = false;
    let map: LeafletMap | null = null;
    void loadLeaflet()
      .then((L) => {
        if (cancelled || !canvas.current) return;
        map = L.map(canvas.current, { zoomControl: true, attributionControl: true }).setView([38.0406, -84.5037], 11);
        L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        }).addTo(map);
        layerRef.current = L.layerGroup().addTo(map);
        mapRef.current = map;
        setMapReady(true);
        requestAnimationFrame(() => map?.invalidateSize());
      })
      .catch((cause: unknown) => setError(message(cause, "The map could not be loaded.")));
    return () => {
      cancelled = true;
      map?.remove();
      mapRef.current = null;
      layerRef.current = null;
      fitted.current = false;
      setMapReady(false);
    };
  }, [mapSlot]);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    const current = viewRef.current;
    if (!mapReady || !map || !layer || !current) return;
    let cancelled = false;
    void loadLeaflet().then((L) => {
      if (cancelled || mapRef.current !== map) return;
      layer.clearLayers();
      const compact = window.matchMedia("(max-width: 700px)").matches;
      const bubble = compact ? BUBBLE_COMPACT : BUBBLE;
      const face = compact ? FACE_COMPACT : FACE;
      for (const job of current.jobs) {
        const left = sideWidth(job.lastActive.length, face);
        const right = sideWidth(job.nextCrew.length, face);
        const width = Math.max(left + bubble + right, bubble);
        const height = compact ? 92 : 108;
        const icon = L.divIcon({
          className: "leaflet-div-icon dispatch-pin",
          html: pinHtml(job, bubble),
          iconSize: [width, height],
          iconAnchor: [left + bubble / 2, height / 2],
        });
        const marker = L.marker([job.lat, job.lng], { icon, keyboard: true, title: job.name });
        marker.on("click", () => openRef.current(job.id));
        marker.addTo(layer);
        const el = marker.getElement();
        if (el) {
          el.dataset.testid = "dispatch-bubble";
          el.dataset.jobId = job.id;
          el.dataset.jobName = job.name;
          el.dataset.stage = job.stage;
          el.dataset.needs = job.needsCrew ? "true" : "false";
          el.setAttribute("aria-label", bubbleLabel(job));
        }
      }
      if (!fitted.current && current.jobs.length > 0) {
        const bounds = L.latLngBounds(current.jobs.map((job) => [job.lat, job.lng] as [number, number]));
        map.fitBounds(bounds.pad(0.35), { maxZoom: 13 });
        fitted.current = true;
      }
      requestAnimationFrame(() => map.invalidateSize());
    });
    return () => {
      cancelled = true;
    };
  }, [mapReady, markerKey]);

  const span = facts ? sliderSpan(facts.today) : 0;
  const index = facts && asOf ? indexFromAsOf(facts.today, asOf) : 0;

  return (
    <div className="grid min-w-0 gap-3" data-testid="dispatch-map">
      {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}
      {!view && !error ? <Skeleton lines={5} label="Loading the job map" /> : null}
      {facts && view ? (
        <>
          <div className="grid gap-1">
            <div className="flex items-end justify-between gap-3">
              <p className="min-w-0" data-testid="dispatch-slider-date">
                <span className="font-display text-2xl">{formatMapDay(view.asOf)}</span>
                <span className="mt-0.5 block text-sm text-muted">{mapDayCaption(view.today, view.asOf)}</span>
              </p>
              <button
                type="button"
                className="h-11 shrink-0 rounded-md border border-line px-3 text-sm"
                onClick={() => setAsOf(facts.today)}
              >
                Today
              </button>
            </div>
            <label className="grid gap-1">
              <span className="sr-only">Dispatch date, from one year ago to six months ahead</span>
              <input
                type="range"
                className="dispatch-slider"
                min={0}
                max={span}
                step={1}
                value={index}
                data-testid="dispatch-slider"
                aria-valuemin={0}
                aria-valuemax={span}
                aria-valuenow={index}
                aria-valuetext={`${formatMapDay(view.asOf)}, ${mapDayCaption(view.today, view.asOf)}`}
                onChange={(event) => setAsOf(asOfFromIndex(facts.today, Number(event.target.value)))}
              />
            </label>
            <div className="flex justify-between text-xs text-muted">
              <span>1 year ago</span>
              <span>6 months ahead</span>
            </div>
          </div>

          <p className="text-sm text-muted" data-testid="dispatch-legend">
            Left of a job: who was last on it, with their days. Right: who is assigned the next day.
          </p>

          <div
            ref={canvas}
            className="dispatch-map-canvas overflow-hidden rounded-md border border-line"
            data-testid="dispatch-map-canvas"
          />

          <NeedsList view={view} onOpen={setOpenId} />
          {openId ? (
            <AssignSheet
              facts={facts}
              job={view.jobs.find((item) => item.id === openId) ?? null}
              day={view.nextDay}
              canAssign={view.canAssign}
              onClose={() => setOpenId(null)}
              onSaved={() => {
                setOpenId(null);
                return load();
              }}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function NeedsList({
  view,
  onOpen,
}: {
  view: ReturnType<typeof selectDispatchMap>;
  onOpen: (id: string) => void;
}) {
  const needing = view.jobs.filter((job) => job.needsCrew);
  return (
    <section className="grid gap-2" aria-label="Jobs that need a crew">
      <h2 className="text-lg" data-testid="dispatch-needs-count">
        {needing.length === 0
          ? `Every open job has a crew for ${formatMapDay(view.nextDay)}`
          : `${needing.length} ${needing.length === 1 ? "job needs" : "jobs need"} a crew for ${formatMapDay(view.nextDay)}`}
      </h2>
      {needing.length === 0 ? (
        <p className="text-sm text-muted" data-testid="dispatch-needs-clear">
          Nothing is waiting on a dispatch.
        </p>
      ) : (
        <ul className="grid gap-2">
          {needing.map((job) => (
            <li
              key={job.id}
              data-testid="dispatch-need"
              data-job-name={job.name}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[#e07a6a] bg-surface p-3"
            >
              <div className="min-w-0">
                <p className="truncate text-base font-medium">{job.name}</p>
                <p className="text-sm text-muted">
                  {job.stage} · {job.percent}% · nobody assigned {formatMapDay(view.nextDay)}
                </p>
              </div>
              {view.canAssign ? (
                <Button type="button" data-testid="dispatch-assign" onClick={() => onOpen(job.id)}>
                  Assign
                </Button>
              ) : (
                <span className="text-sm text-muted">View only</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AssignSheet({
  facts,
  job,
  day,
  canAssign,
  onClose,
  onSaved,
}: {
  facts: DispatchMapFacts;
  job: JobBubble | null;
  day: string;
  canAssign: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const options = job ? crewOptions(facts, job.id, day) : [];
  const [picked, setPicked] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (!job) return null;
  const chosen = picked.filter((id) => options.some((person) => person.userId === id && !person.busyElsewhere && !person.assignedHere));
  return (
    <div className="fixed inset-0 z-[1200] flex items-end justify-center sm:items-center" role="presentation">
      <button type="button" aria-label="Close assign" className="absolute inset-0 bg-black/60" onClick={onClose} />
      <form
        role="dialog"
        aria-labelledby="dispatch-assign-title"
        data-testid="dispatch-assign-sheet"
        className="relative z-10 grid max-h-[85dvh] w-full max-w-lg gap-3 overflow-y-auto rounded-t-md border border-line bg-bg p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:rounded-md"
        onSubmit={(event) => {
          event.preventDefault();
          if (!canAssign || chosen.length === 0 || busy) return;
          setBusy(true);
          setError("");
          void assignDispatchCrew({ data: { projectId: job.id, day, userIds: chosen } })
            .then(() => onSaved())
            .catch((cause: unknown) => {
              setError(message(cause, "Could not assign that crew."));
              setBusy(false);
            });
        }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="dispatch-assign-title" className="truncate text-xl">
              {job.name}
            </h2>
            <p className="text-sm text-muted">
              {job.stage} · {job.percent}% · {formatMapDay(day)}
            </p>
          </div>
          <button type="button" className="h-11 shrink-0 px-2 text-sm text-muted" onClick={onClose}>
            Close
          </button>
        </div>
        {job.needsCrew ? (
          <p className="rounded-md bg-[#3a2420] px-3 py-2 text-sm text-[#f0c2b8]" data-testid="dispatch-assign-flag">
            Nobody is assigned for {formatMapDay(day)}. Pick a crew to push the job forward.
          </p>
        ) : (
          <p className="text-sm text-muted">
            {job.nextCrew.length
              ? `Already on this day: ${job.nextCrew.map((person) => person.name).join(", ")}.`
              : "This job does not need a crew that day."}
          </p>
        )}
        {error ? <ErrorBanner message={error} /> : null}
        {canAssign ? (
          <fieldset className="grid gap-1">
            <legend className="mb-1 text-sm">Crew</legend>
            {options.map((person) => {
              const disabled = Boolean(person.busyElsewhere) || person.assignedHere;
              const checked = person.assignedHere || picked.includes(person.userId);
              return (
                <label
                  key={person.userId}
                  className={`flex min-h-11 items-center gap-3 rounded-md px-2 text-base ${disabled ? "text-muted" : ""}`}
                >
                  <input
                    type="checkbox"
                    className="size-5"
                    data-testid="dispatch-assign-person"
                    name="crew"
                    value={person.userId}
                    checked={checked}
                    disabled={disabled || busy}
                    onChange={(event) => {
                      setPicked((current) =>
                        event.target.checked
                          ? [...current, person.userId]
                          : current.filter((id) => id !== person.userId),
                      );
                    }}
                  />
                  <span className="min-w-0 flex-1">
                    {person.name}
                    {person.assignedHere ? <span className="block text-sm text-muted">Already on this job</span> : null}
                    {person.busyElsewhere ? (
                      <span className="block text-sm text-muted">On {person.busyElsewhere}</span>
                    ) : null}
                  </span>
                </label>
              );
            })}
          </fieldset>
        ) : (
          <p className="text-sm text-muted" data-testid="dispatch-map-readonly">
            View only
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {canAssign ? (
            <Button type="submit" data-testid="dispatch-assign-save" disabled={busy || chosen.length === 0}>
              {chosen.length === 0 ? "Assign" : `Assign ${chosen.length}`}
            </Button>
          ) : null}
          <Button type="button" tone="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
