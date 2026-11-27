import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { ChevronLeft, ChevronRight, GripVertical, Info, MoreHorizontal, Send } from "lucide-react";
import {
  addDispatchLocation,
  addDispatchPerson,
  claimDispatchSends,
  getDispatch,
  placeDispatch,
  removeDispatchPerson,
  sendDispatchDay,
  setDispatchDayNote,
  setDispatchPersonKind,
  setDispatchPersonNote,
  setDispatchPhone,
  undoDispatchSend,
  updateDispatchLocation,
} from "@/lib/server/fns";
import { DispatchMap } from "@/components/dispatch-map";
import { Button, Chip, EmptyState, ErrorBanner, Skeleton } from "@/components/ui";
import { useDesk } from "@/components/desk-context";
import { can } from "@/lib/permissions";
import { formatPhone } from "@/lib/roles";
import { addDays, todayIso, weekStart } from "@/lib/crew";
import {
  DISPATCH_DRAG_SAVE_MS,
  createDragGate,
  formatDispatchDay,
  formatDispatchDayShort,
  formatDispatchWeek,
  kindLabel,
  placementForDrop,
  sendResultLabel,
  type DispatchKind,
} from "@/lib/dispatch";

type Board = Awaited<ReturnType<typeof getDispatch>>;
type Person = Board["people"][number];
type Placement = Board["daysPlaced"][number]["placements"][number];

const GOLD = "bg-[#c6a15b] text-[#1a1408]";
const BLUE = "text-[#6ea8d4]";

type HeldAction = { token: string; label: string; commit: () => Promise<unknown> };

type Ghost = {
  userId: string;
  name: string;
  kind: DispatchKind;
  from: string | null;
  x: number;
  y: number;
  over: string | null;
};

function message(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}

function NoteField({
  label,
  value,
  testId,
  onSave,
}: {
  label: string;
  value: string;
  testId: string;
  onSave: (next: string) => Promise<void>;
}) {
  const [text, setText] = useState(value);
  const [saved, setSaved] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setText(value), [value]);
  useEffect(() => {
    const node = area.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${Math.max(node.scrollHeight, 44)}px`;
  }, [text]);
  return (
    <label className="grid gap-1 text-sm text-muted">
      {label}
      <textarea
        ref={area}
        rows={1}
        className="field min-h-11 resize-y overflow-hidden"
        maxLength={800}
        data-testid={testId}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setSaved(false);
        }}
        onBlur={() => {
          if (text === value) return;
          void onSave(text)
            .then(() => setSaved(true))
            .catch(() => setSaved(false));
        }}
      />
      {saved ? <span className="text-xs text-[#8fbfa4]">Saved</span> : null}
    </label>
  );
}

function SendDock({
  day,
  send,
  canEdit,
  onRefresh,
}: {
  day: string;
  send: Board["send"];
  canEdit: boolean;
  onRefresh: () => Promise<void>;
}) {
  const [toast, setToast] = useState("");
  const [undoId, setUndoId] = useState<string | null>(null);
  const scheduled = send.scheduled;
  const scheduledId = scheduled?.id ?? null;
  const refreshRef = useRef(onRefresh);
  refreshRef.current = onRefresh;
  const dismissed = useRef<string | null>(null);
  const sendAtRef = useRef(scheduled?.sendAt ?? "");
  sendAtRef.current = scheduled?.sendAt ?? "";
  useEffect(() => {
    if (!scheduledId) {
      setUndoId(null);
      return;
    }
    if (dismissed.current === scheduledId) return;
    setUndoId(scheduledId);
    const left = Math.min(5_000, Math.max(0, new Date(sendAtRef.current).getTime() - Date.now()));
    const timer = window.setTimeout(() => {
      dismissed.current = scheduledId;
      setUndoId((current) => (current === scheduledId ? null : current));
      void claimDispatchSends({ data: { id: scheduledId } })
        .then(async (result) => {
          const job = result.jobs.find((item) => item.id === scheduledId) ?? result.jobs[0];
          if (job) setToast(sendResultLabel(job));
          await refreshRef.current();
        })
        .catch((cause: unknown) => {
          setToast(cause instanceof Error ? cause.message : "Could not send.");
        });
    }, left);
    return () => window.clearTimeout(timer);
  }, [scheduledId]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 6000);
    return () => window.clearTimeout(timer);
  }, [toast]);
  if (!canEdit) return null;
  const undoOpen = undoId !== null && undoId === scheduled?.id;
  const enabled = send.pending && !undoOpen;
  return (
    <>
      <div
        className="flex shrink-0 flex-col items-end gap-2 pt-2"
        data-testid="dispatch-send-dock"
      >
        <p
          className="rounded-md border border-line bg-surface px-2 py-1 text-xs text-muted shadow"
          data-testid="dispatch-last-sent"
        >
          {send.lastSentLabel}
        </p>
        {undoOpen ? (
          <button
            type="button"
            data-testid="dispatch-undo"
            className="h-11 rounded-full bg-raised px-4 text-sm font-medium text-fg shadow"
            onClick={() => {
              if (!scheduled) return;
              void undoDispatchSend({ data: { id: scheduled.id } })
                .then(() => onRefresh())
                .catch((cause: unknown) =>
                  setToast(cause instanceof Error ? cause.message : "Could not undo."),
                );
            }}
          >
            Undo
          </button>
        ) : null}
        <button
          type="button"
          data-testid="dispatch-send"
          data-state={enabled ? "pending" : "idle"}
          aria-label={enabled ? "Send this day's dispatch" : "Nothing new to send"}
          aria-disabled={!enabled}
          disabled={!enabled}
          className={`grid h-14 w-14 place-items-center rounded-full shadow-lg ${enabled ? "bg-[#1f8a4c] text-white" : "cursor-not-allowed bg-[#6b6560] text-[#cfc6ba]"}`}
          onClick={() => {
            if (!enabled) return;
            void sendDispatchDay({ data: { day } })
              .then(() => onRefresh())
              .catch((cause: unknown) =>
                setToast(cause instanceof Error ? cause.message : "Could not send."),
              );
          }}
        >
          <Send className="size-6" aria-hidden />
        </button>
      </div>
      {toast ? (
        <p
          role="status"
          data-testid="dispatch-toast"
          className="fixed bottom-44 right-4 z-30 max-w-xs rounded-md border border-line bg-surface px-3 py-2 text-sm shadow md:bottom-28"
        >
          {toast}
        </p>
      ) : null}
    </>
  );
}

export function DispatchView() {
  const { ready } = useDesk();
  const role = ready.profile.role;
  const [mode, setMode] = useState<"day" | "week" | "map">("day");
  const [day, setDay] = useState(() => todayIso());
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [addingLoc, setAddingLoc] = useState(false);
  const [addingPerson, setAddingPerson] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);
  const [ghost, setGhost] = useState<Ghost | null>(null);
  const [held, setHeld] = useState<HeldAction | null>(null);
  const [queued, setQueued] = useState(0);
  const dragCleanup = useRef<(() => void) | null>(null);
  const gates = useRef(new Map<string, ReturnType<typeof createDragGate>>());

  const load = useCallback(() => {
    setError("");
    return getDispatch({ data: { day } })
      .then((next) => setBoard(next))
      .catch((cause: unknown) => setError(message(cause, "Could not load dispatch.")));
  }, [day]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => () => dragCleanup.current?.(), []);
  useEffect(() => {
    if (!held) return;
    const job = held;
    const timer = window.setTimeout(() => {
      setHeld((current) => (current?.token === job.token ? null : current));
      void job.commit();
    }, 5_000);
    return () => window.clearTimeout(timer);
  }, [held]);

  const canEdit = board ? board.canEdit : can(role, "dispatch.edit");
  const showing = board && board.day === day ? board : null;

  async function refresh() {
    setBoard(await getDispatch({ data: { day } }));
  }

  function queueMove(userId: string, locationId: string | null, forDay: string) {
    let gate = gates.current.get(userId);
    if (!gate) {
      gate = createDragGate(DISPATCH_DRAG_SAVE_MS);
      gates.current.set(userId, gate);
      setQueued((count) => count + 1);
    }
    gate.push(locationId, (next) => {
      void run(
        () => placeDispatch({ data: { userId, day: forDay, locationId: next } }),
        "Could not move them.",
      ).finally(() => {
        gates.current.delete(userId);
        setQueued((count) => Math.max(0, count - 1));
      });
    });
  }

  async function run(work: () => Promise<unknown>, fallback: string): Promise<boolean> {
    setBusy(true);
    setError("");
    try {
      await work();
      await refresh();
      return true;
    } catch (cause) {
      setError(message(cause, fallback));
      return false;
    } finally {
      setBusy(false);
    }
  }

  function beginDrag(
    event: ReactPointerEvent<HTMLButtonElement>,
    person: Person & { from: string | null },
  ) {
    if (!canEdit || busy) return;
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startY = event.clientY;
    let moved = false;
    const hit = (x: number, y: number) => {
      const node = document.elementFromPoint(x, y);
      const zone = node instanceof Element ? node.closest("[data-drop]") : null;
      return zone instanceof HTMLElement ? (zone.dataset.drop ?? null) : null;
    };
    const move = (ev: PointerEvent) => {
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > 8) moved = true;
      if (moved) ev.preventDefault();
      const over = moved ? hit(ev.clientX, ev.clientY) : null;
      setGhost({
        userId: person.userId,
        name: person.name,
        kind: person.kind,
        from: person.from,
        x: ev.clientX,
        y: ev.clientY,
        over,
      });
      if (ev.clientY < 88) window.scrollBy(0, -16);
      else if (ev.clientY > window.innerHeight - 96) window.scrollBy(0, 16);
    };
    const finish = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      dragCleanup.current = null;
      const over = moved ? hit(ev.clientX, ev.clientY) : null;
      setGhost(null);
      if (!moved) {
        setMenu(person.userId);
        return;
      }
      const action = placementForDrop(person.kind, over);
      if (!action || action.locationId === person.from) return;
      queueMove(person.userId, action.locationId, day);
    };
    dragCleanup.current = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  }

  const step = mode === "week" ? 7 : 1;

  return (
    <div
      className="flex h-[calc(100dvh-11rem)] min-h-0 min-w-0 flex-col md:h-[calc(100dvh-6.75rem)]"
      data-testid="dispatch-view"
      data-pending={queued > 0 ? "true" : "false"}
    >
      <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto pb-2" data-testid="dispatch-scroll">
      <div className="grid gap-2">
        {mode === "map" ? null : (
        <div className="flex items-center gap-2 md:hidden">
          <button
            type="button"
            className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-line"
            aria-label={mode === "week" ? "Previous week" : "Previous day"}
            onClick={() => setDay((current) => addDays(current, -step))}
          >
            <ChevronLeft className="size-5" aria-hidden />
          </button>
          <p
            className="min-w-0 flex-1 truncate text-center text-base"
            data-testid="dispatch-when-short"
          >
            {mode === "week" ? formatDispatchWeek(weekStart(day)) : formatDispatchDayShort(day)}
          </p>
          <button
            type="button"
            className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-line"
            aria-label={mode === "week" ? "Next week" : "Next day"}
            onClick={() => setDay((current) => addDays(current, step))}
          >
            <ChevronRight className="size-5" aria-hidden />
          </button>
          <span className="text-muted" aria-hidden>
            ·
          </span>
          <button
            type="button"
            className="h-11 shrink-0 rounded-md border border-line px-3 text-sm"
            onClick={() => setDay(todayIso())}
          >
            Today
          </button>
        </div>
        )}
        <div
          className="flex w-full rounded-md border border-line p-1 md:hidden"
          role="tablist"
          aria-label="Dispatch view"
        >
          {(["day", "week", "map"] as const).map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={mode === id}
              data-testid={`dispatch-tab-${id}-mobile`}
              className={`h-11 flex-1 rounded-md text-sm font-medium ${mode === id ? GOLD : "text-muted"}`}
              onClick={() => setMode(id)}
            >
              {id === "day" ? "Day" : id === "week" ? "Week" : "Map"}
            </button>
          ))}
        </div>
        <div className="hidden flex-wrap items-center gap-2 md:flex">
          <div
            className="flex rounded-md border border-line p-1"
            role="tablist"
            aria-label="Dispatch view"
          >
            {(["day", "week", "map"] as const).map((id) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={mode === id}
                data-testid={`dispatch-tab-${id}`}
                className={`h-11 rounded-md px-4 text-sm font-medium ${mode === id ? GOLD : "text-muted"}`}
                onClick={() => setMode(id)}
              >
                {id === "day" ? "Day" : id === "week" ? "Week" : "Map"}
              </button>
            ))}
          </div>
          {mode === "map" ? null : (
            <>
              <button
                type="button"
                className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-line"
                aria-label={mode === "week" ? "Previous week" : "Previous day"}
                onClick={() => setDay((current) => addDays(current, -step))}
              >
                <ChevronLeft className="size-5" aria-hidden />
              </button>
              <p className="min-w-[10rem] text-center font-display text-lg" data-testid="dispatch-when">
                {mode === "week" ? formatDispatchWeek(weekStart(day)) : formatDispatchDay(day)}
              </p>
              <button
                type="button"
                className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-line"
                aria-label={mode === "week" ? "Next week" : "Next day"}
                onClick={() => setDay((current) => addDays(current, step))}
              >
                <ChevronRight className="size-5" aria-hidden />
              </button>
              <button
                type="button"
                className="h-11 rounded-md border border-line px-3 text-sm"
                onClick={() => setDay(todayIso())}
              >
                Today
              </button>
            </>
          )}
        </div>
        {showing && !showing.canEdit ? (
          <p className="text-sm text-muted" data-testid="dispatch-readonly">
            View only
          </p>
        ) : null}
      </div>

      {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}
      {!showing && !error ? <Skeleton lines={6} label="Loading dispatch" /> : null}

      {showing && mode === "map" ? <DispatchMap /> : null}

      {showing && mode === "day" ? (
        <DayBoard
          board={showing}
          day={day}
          busy={busy}
          canEdit={showing.canEdit}
          addingLoc={addingLoc}
          addingPerson={addingPerson}
          menu={menu}
          ghost={ghost}
          onAddLoc={() => {
            setAddingPerson(false);
            setAddingLoc((open) => !open);
          }}
          onAddPerson={() => {
            setAddingLoc(false);
            setAddingPerson((open) => !open);
          }}
          onCancelLoc={() => setAddingLoc(false)}
          onCancelPerson={() => setAddingPerson(false)}
          onMenu={setMenu}
          onDrag={beginDrag}
          onPlace={(userId, locationId) => {
            setMenu(null);
            void run(
              () => placeDispatch({ data: { userId, day, locationId } }),
              "Could not move them.",
            );
          }}
          onKind={(userId, kind, locationId) => {
            setMenu(null);
            void run(
              () => setDispatchPersonKind({ data: { userId, kind, day, locationId } }),
              "Could not change that.",
            );
          }}
          onRemovePerson={(userId) => {
            setMenu(null);
            void run(() => removeDispatchPerson({ data: { userId } }), "Could not remove them.");
          }}
          onRemoveLocation={(id) => {
            const name =
              showing?.locations.find((location) => location.id === id)?.name ?? "that location";
            setHeld({
              token: `location:${id}`,
              label: `Removing ${name}`,
              commit: () =>
                run(
                  () => updateDispatchLocation({ data: { id, archived: true, day } }),
                  "Could not remove that location.",
                ),
            });
          }}
          onSaveStanding={(id, notes) =>
            updateDispatchLocation({ data: { id, notes, day } })
              .then(() => refresh())
              .catch((cause: unknown) => {
                setError(message(cause, "Could not save that."));
                throw cause;
              })
          }
          onSaveDay={(locationId, notes) => {
            if (notes === "") {
              setHeld({
                token: `clear:${locationId}`,
                label: "Clearing today's instructions",
                commit: () =>
                  setDispatchDayNote({ data: { locationId, day, notes: "" } })
                    .then(() => refresh())
                    .catch((cause: unknown) => {
                      setError(message(cause, "Could not save that."));
                      throw cause;
                    }),
              });
              return Promise.resolve();
            }
            return setDispatchDayNote({ data: { locationId, day, notes } })
              .then(() => refresh())
              .catch((cause: unknown) => {
                setError(message(cause, "Could not save that."));
                throw cause;
              });
          }}
          onSavePersonNote={(userId, notes) => {
            if (notes === "") {
              const name =
                showing?.people.find((person) => person.userId === userId)?.name ?? "this person";
              setHeld({
                token: `pclear:${userId}`,
                label: `Clearing instruction for ${name}`,
                commit: () =>
                  setDispatchPersonNote({ data: { userId, day, notes: "" } })
                    .then(() => refresh())
                    .catch((cause: unknown) => {
                      setError(message(cause, "Could not save that."));
                      throw cause;
                    }),
              });
              return Promise.resolve();
            }
            return setDispatchPersonNote({ data: { userId, day, notes } })
              .then(() => refresh())
              .catch((cause: unknown) => {
                setError(message(cause, "Could not save that."));
                throw cause;
              });
          }}
          onSavePhone={(userId, phone) =>
            setDispatchPhone({ data: { userId, phone, day } })
              .then(() => refresh())
              .catch((cause: unknown) => {
                setError(message(cause, "Could not save that number."));
                throw cause;
              })
          }
          onCreateLocation={(input) =>
            void run(
              () => addDispatchLocation({ data: { ...input, day } }),
              "Could not add that location.",
            ).then((ok) => ok && setAddingLoc(false))
          }
          onCreatePerson={(input) =>
            void run(
              () => addDispatchPerson({ data: { ...input, day } }),
              "Could not add that person.",
            ).then((ok) => ok && setAddingPerson(false))
          }
        />
      ) : null}

      {showing && mode === "week" ? (
        <WeekBoard
          board={showing}
          focus={day}
          onOpen={(next) => {
            setDay(next);
            setMode("day");
          }}
        />
      ) : null}
      </div>

      {ghost ? (
        <div
          className="pointer-events-none fixed z-50 rounded-md border border-[#c6a15b] bg-surface px-3 py-2 text-sm shadow-lg"
          style={{ left: ghost.x + 14, top: ghost.y + 14 }}
          data-testid="dispatch-ghost"
        >
          {ghost.name}
        </div>
      ) : null}
      {menu ? (
        <button
          type="button"
          aria-label="Close move menu"
          className="fixed inset-0 z-20 cursor-default"
          onClick={() => setMenu(null)}
        />
      ) : null}
      {held ? (
        <p
          role="status"
          data-testid="dispatch-action-undo"
          className="mt-2 flex shrink-0 items-center justify-end gap-3 text-sm"
        >
          {held.label}
          <button
            type="button"
            className={`h-11 rounded-full px-3 text-sm font-medium ${GOLD}`}
            onClick={() => setHeld(null)}
          >
            Undo
          </button>
        </p>
      ) : null}
      {showing && mode !== "map" ? (
        <SendDock
          day={day}
          send={showing.send}
          canEdit={showing.canEdit}
          onRefresh={() => refresh()}
        />
      ) : null}
    </div>
  );
}

function hot(ghost: Ghost | null, zone: string): boolean {
  if (!ghost || ghost.over !== zone) return false;
  const action = placementForDrop(ghost.kind, ghost.over);
  return Boolean(action) && action?.locationId !== ghost.from;
}

function DayBoard({
  board,
  day,
  busy,
  canEdit,
  addingLoc,
  addingPerson,
  menu,
  ghost,
  onAddLoc,
  onAddPerson,
  onCancelLoc,
  onCancelPerson,
  onMenu,
  onDrag,
  onPlace,
  onKind,
  onRemovePerson,
  onRemoveLocation,
  onSaveStanding,
  onSaveDay,
  onSavePersonNote,
  onSavePhone,
  onCreateLocation,
  onCreatePerson,
}: {
  board: Board;
  day: string;
  busy: boolean;
  canEdit: boolean;
  addingLoc: boolean;
  addingPerson: boolean;
  menu: string | null;
  ghost: Ghost | null;
  onAddLoc: () => void;
  onAddPerson: () => void;
  onCancelLoc: () => void;
  onCancelPerson: () => void;
  onMenu: (userId: string | null) => void;
  onDrag: (
    event: ReactPointerEvent<HTMLButtonElement>,
    person: Person & { from: string | null },
  ) => void;
  onPlace: (userId: string, locationId: string | null) => void;
  onKind: (userId: string, kind: DispatchKind, locationId: string | null) => void;
  onRemovePerson: (userId: string) => void;
  onRemoveLocation: (id: string) => void;
  onSaveStanding: (id: string, notes: string) => Promise<void>;
  onSaveDay: (id: string, notes: string) => Promise<void>;
  onSavePersonNote: (userId: string, notes: string) => Promise<void>;
  onSavePhone: (userId: string, phone: string) => Promise<void>;
  onCreateLocation: (input: {
    projectId?: string;
    name?: string;
    address?: string;
    notes?: string;
  }) => void;
  onCreatePerson: (input: {
    userId: string;
    kind: DispatchKind;
    locationId?: string | null;
  }) => void;
}) {
  const [locMenu, setLocMenu] = useState<string | null>(null);
  const placed = board.daysPlaced.find((entry) => entry.day === day);
  const byId = new Map(board.people.map((person) => [person.userId, person]));
  const named = (rows: Placement[] | undefined) =>
    (rows ?? [])
      .map((row) => {
        const person = byId.get(row.userId);
        return person ? { ...person, from: row.locationId, carried: row.carried } : null;
      })
      .filter((row): row is Person & { from: string | null; carried: boolean } => Boolean(row))
      .sort((a, b) => a.name.localeCompare(b.name));

  const available = named(
    placed?.placements.filter((row) => row.kind === "part" && !row.locationId),
  );
  const unassigned = named(
    placed?.placements.filter((row) => row.kind === "full" && !row.locationId),
  );
  const hasPart = board.people.some((person) => person.kind === "part");
  const noteFor = (userId: string) =>
    board.personInstructions.find((note) => note.userId === userId && note.day === day)?.body ?? "";
  const personExtras = {
    noteFor,
    onSaveNote: onSavePersonNote,
    onSavePhone,
  };

  return (
    <div className="grid min-w-0 gap-4" data-testid="dispatch-day">
      <div className="flex items-center gap-2">
        <p className="font-display text-2xl" data-testid="dispatch-start">
          Starts at {board.startLabel}
        </p>
        <span className="group relative">
          <button
            type="button"
            className="grid h-11 w-11 place-items-center rounded-full text-muted"
            aria-label="About the 8:00 AM start"
            data-testid="dispatch-start-info"
          >
            <Info className="size-5" aria-hidden />
          </button>
          <span
            role="tooltip"
            className="pointer-events-none absolute left-0 top-12 z-20 hidden w-64 rounded-md border border-line bg-surface p-3 text-sm text-fg shadow group-focus-within:block group-hover:block"
          >
            Full-time crew stay on a location until you move them. Part-time crew appear only on the
            days you place them.
          </span>
        </span>
      </div>

      {canEdit ? (
        <div className="flex flex-wrap gap-2">
          <Button type="button" tone="ghost" onClick={onAddLoc} data-testid="dispatch-add-location">
            Add location
          </Button>
          <Button
            type="button"
            tone="ghost"
            onClick={onAddPerson}
            data-testid="dispatch-add-person"
          >
            Add person
          </Button>
        </div>
      ) : null}

      {addingLoc ? (
        <AddLocation board={board} busy={busy} onCancel={onCancelLoc} onCreate={onCreateLocation} />
      ) : null}
      {addingPerson ? (
        <AddPerson board={board} busy={busy} onCancel={onCancelPerson} onCreate={onCreatePerson} />
      ) : null}

      {board.locations.length === 0 && board.people.length === 0 ? (
        <EmptyState
          title="Nothing dispatched yet"
          body={
            canEdit
              ? "Add a location, then add people as full-time or part-time."
              : "No one is on the schedule for this day."
          }
        />
      ) : null}

      {hasPart && available.length === 0 ? (
        <p className="text-sm text-muted" data-testid="dispatch-available">
          Available: none
        </p>
      ) : null}
      {hasPart && available.length > 0 ? (
        <section
          className={`rounded-md border bg-surface p-3 ${hot(ghost, "available") ? "border-[#c6a15b]" : "border-line"}`}
          data-drop="available"
          data-testid="dispatch-available"
        >
          <h2 className="text-lg">Available</h2>
          <p className="mb-2 text-sm text-muted">Part-time, not placed this day.</p>
          <PersonList
            people={available}
            empty="No one is waiting."
            canEdit={canEdit}
            busy={busy}
            menu={menu}
            ghost={ghost}
            locations={board.locations}
            onDrag={onDrag}
            onMenu={onMenu}
            onPlace={onPlace}
            onKind={onKind}
            onRemovePerson={onRemovePerson}
            {...personExtras}
          />
        </section>
      ) : null}

      {unassigned.length ? (
        <section
          className="rounded-md border border-dashed border-line p-3"
          data-testid="dispatch-unassigned"
        >
          <h2 className="text-lg">Not placed yet</h2>
          <p className="mb-2 text-sm text-muted">
            Full-time, with no location from {board.startLabel}.
          </p>
          <PersonList
            people={unassigned}
            empty=""
            canEdit={canEdit}
            busy={busy}
            menu={menu}
            ghost={ghost}
            locations={board.locations}
            onDrag={onDrag}
            onMenu={onMenu}
            onPlace={onPlace}
            onKind={onKind}
            onRemovePerson={onRemovePerson}
            {...personExtras}
          />
        </section>
      ) : null}

      {board.locations.map((location) => {
        const people = named(placed?.placements.filter((row) => row.locationId === location.id));
        return (
          <section
            key={location.id}
            className={`relative rounded-md border bg-surface p-3 ${hot(ghost, location.id) ? "border-[#c6a15b]" : "border-line"}`}
            data-drop={location.id}
            data-testid="dispatch-location"
          >
            {hot(ghost, location.id) ? (
              <div
                className="absolute inset-x-0 top-0 h-1.5 rounded-t-md bg-[#c6a15b]"
                data-testid="dispatch-drop-line"
              />
            ) : null}
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h2 className="truncate text-lg">{location.name}</h2>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
                  {location.address ? <span>{location.address}</span> : null}
                  <span className="rounded-full bg-raised px-2 py-0.5 text-xs text-fg">
                    {people.length} crew
                  </span>
                  {location.linked ? <Chip>Job</Chip> : null}
                </div>
              </div>
              {canEdit ? (
                <div className="relative shrink-0">
                  <button
                    type="button"
                    aria-label={`Actions for ${location.name}`}
                    aria-expanded={locMenu === location.id}
                    className="grid h-11 w-11 cursor-pointer place-items-center rounded-md text-muted"
                    onClick={() => setLocMenu((current) => (current === location.id ? null : location.id))}
                  >
                    <MoreHorizontal className="size-5" aria-hidden />
                  </button>
                  {locMenu === location.id ? (
                    <div
                      role="menu"
                      className="absolute right-0 z-30 mt-1 grid min-w-52 gap-1 rounded-md border border-line bg-bg p-2 shadow"
                    >
                      <button
                        type="button"
                        role="menuitem"
                        className="h-11 rounded-md px-2 text-left text-sm hover:bg-raised"
                        onClick={() => {
                          setLocMenu(null);
                          onRemoveLocation(location.id);
                        }}
                      >
                        Remove
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className="h-11 rounded-md px-2 text-left text-sm hover:bg-raised"
                        aria-label={`Clear instructions for ${location.name}`}
                        onClick={() => {
                          setLocMenu(null);
                          void onSaveDay(location.id, "");
                        }}
                      >
                        Clear today's instructions
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
            <div className="mt-3">
              <PersonList
                people={people}
                empty="No one here yet."
                canEdit={canEdit}
                busy={busy}
                menu={menu}
                ghost={ghost}
                locations={board.locations}
                onDrag={onDrag}
                onMenu={onMenu}
                onPlace={onPlace}
                onKind={onKind}
                onRemovePerson={onRemovePerson}
                {...personExtras}
              />
            </div>
            <div className="mt-3 grid gap-3">
              {canEdit ? (
                <>
                  <NoteField
                    label="Standing instructions"
                    value={location.standingNotes}
                    testId="dispatch-standing-note"
                    onSave={(notes) => onSaveStanding(location.id, notes)}
                  />
                  <NoteField
                    label="Today's instructions"
                    value={location.dayNotes}
                    testId="dispatch-day-note"
                    onSave={(notes) => onSaveDay(location.id, notes)}
                  />
                </>
              ) : (
                <>
                  {location.standingNotes ? (
                    <p className="text-sm text-muted">{location.standingNotes}</p>
                  ) : null}
                  {location.dayNotes ? <p className="text-base">{location.dayNotes}</p> : null}
                </>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function PersonFacts({
  person,
  note,
  canEdit,
  onSaveNote,
  onSavePhone,
}: {
  person: Person;
  note: string;
  canEdit: boolean;
  onSaveNote: (userId: string, notes: string) => Promise<void>;
  onSavePhone: (userId: string, phone: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note);
  const [phone, setPhone] = useState(person.phone ? formatPhone(person.phone) : "");
  const noteArea = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setDraft(note), [note]);
  useEffect(() => setPhone(person.phone ? formatPhone(person.phone) : ""), [person.phone]);
  useEffect(() => {
    const node = noteArea.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${Math.max(node.scrollHeight, 44)}px`;
  }, [draft, editing]);
  return (
    <div className="grid gap-1 px-2 pb-2">
      {canEdit ? (
        <input
          aria-label={`Phone for ${person.name}`}
          data-testid="dispatch-phone"
          className="field"
          inputMode="tel"
          autoComplete="tel"
          placeholder="Mobile number"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          onBlur={() => {
            const current = person.phone ? formatPhone(person.phone) : "";
            if (phone.trim() === current) return;
            void onSavePhone(person.userId, phone);
          }}
        />
      ) : (
        <p className="text-sm" data-testid="dispatch-phone">
          {person.phone ? (
            <a className={BLUE} href={`tel:${person.phone}`}>
              {formatPhone(person.phone)}
            </a>
          ) : (
            "No phone"
          )}
        </p>
      )}
      {editing ? (
        <div className="grid gap-1">
          <textarea
            ref={noteArea}
            rows={1}
            aria-label={`Instruction for ${person.name}`}
            data-testid="dispatch-person-note"
            className="field min-h-11 resize-y overflow-hidden"
            maxLength={800}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={`h-11 rounded-md px-3 text-sm font-medium ${GOLD}`}
              onClick={() => void onSaveNote(person.userId, draft).then(() => setEditing(false))}
            >
              {`Save instruction for ${person.name}`}
            </button>
            <button
              type="button"
              className="h-11 px-2 text-sm text-muted"
              onClick={() => {
                setDraft(note);
                setEditing(false);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : note ? (
        <p className="text-sm" data-testid="dispatch-person-note">
          {note}
        </p>
      ) : null}
      {canEdit && !editing ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={`h-11 px-1 text-left text-sm ${BLUE}`}
            onClick={() => {
              setDraft(note);
              setEditing(true);
            }}
          >
            {note ? `Edit instruction for ${person.name}` : `Instruction for ${person.name}`}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function PersonList({
  people,
  empty,
  canEdit,
  busy,
  menu,
  ghost,
  locations,
  onDrag,
  onMenu,
  onPlace,
  onKind,
  onRemovePerson,
  noteFor,
  onSaveNote,
  onSavePhone,
}: {
  people: (Person & { from: string | null; carried: boolean })[];
  empty: string;
  canEdit: boolean;
  busy: boolean;
  menu: string | null;
  ghost: Ghost | null;
  locations: Board["locations"];
  onDrag: (
    event: ReactPointerEvent<HTMLButtonElement>,
    person: Person & { from: string | null },
  ) => void;
  onMenu: (userId: string | null) => void;
  onPlace: (userId: string, locationId: string | null) => void;
  onKind: (userId: string, kind: DispatchKind, locationId: string | null) => void;
  onRemovePerson: (userId: string) => void;
  noteFor: (userId: string) => string;
  onSaveNote: (userId: string, notes: string) => Promise<void>;
  onSavePhone: (userId: string, phone: string) => Promise<void>;
}) {
  if (people.length === 0) return empty ? <p className="text-sm text-muted">{empty}</p> : null;
  return (
    <ul className="grid gap-1">
      {people.map((person) => (
        <li
          key={person.userId}
          className={`relative ${menu === person.userId ? "z-30" : ""}`}
          data-testid="dispatch-person"
        >
          <div
            className={`flex min-h-11 items-center gap-1 rounded-md bg-raised pr-2 ${ghost?.userId === person.userId ? "opacity-40" : ""}`}
          >
            {canEdit ? (
              <button
                type="button"
                aria-label={`Move ${person.name}`}
                aria-grabbed={ghost?.userId === person.userId}
                data-testid="dispatch-handle"
                disabled={busy}
                className="inline-flex h-11 w-11 shrink-0 cursor-grab items-center justify-center rounded-md text-muted active:cursor-grabbing"
                style={{ touchAction: "none" }}
                onPointerDown={(event) => onDrag(event, person)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onMenu(menu === person.userId ? null : person.userId);
                  }
                }}
              >
                <GripVertical className="size-5" aria-hidden />
              </button>
            ) : null}
            <span className="min-w-0 flex-1 truncate text-base">{person.name}</span>
            <span className="shrink-0 text-xs text-muted">{kindLabel(person.kind)}</span>
          </div>
          <PersonFacts
            person={person}
            note={noteFor(person.userId)}
            canEdit={canEdit}
            onSaveNote={onSaveNote}
            onSavePhone={onSavePhone}
          />
          {menu === person.userId ? (
            <div
              role="menu"
              aria-label={`Move ${person.name}`}
              data-testid="dispatch-move-menu"
              className="relative z-30 mt-1 grid gap-1 rounded-md border border-line bg-bg p-2"
            >
              {locations.map((location) => (
                <button
                  key={location.id}
                  type="button"
                  role="menuitem"
                  className="h-11 rounded-md px-2 text-left text-sm hover:bg-raised disabled:opacity-50"
                  disabled={location.id === person.from}
                  onClick={() => onPlace(person.userId, location.id)}
                >
                  {location.name.startsWith("Move to ")
                    ? location.name
                    : `Move to ${location.name}`}
                </button>
              ))}
              {person.kind === "part" ? (
                <button
                  type="button"
                  role="menuitem"
                  className="h-11 rounded-md px-2 text-left text-sm hover:bg-raised disabled:opacity-50"
                  disabled={!person.from}
                  onClick={() => onPlace(person.userId, null)}
                >
                  Available
                </button>
              ) : null}
              <button
                type="button"
                role="menuitem"
                className="h-11 rounded-md px-2 text-left text-sm hover:bg-raised"
                onClick={() =>
                  onKind(
                    person.userId,
                    person.kind === "full" ? "part" : "full",
                    person.kind === "part" ? (person.from ?? locations[0]?.id ?? null) : null,
                  )
                }
              >
                {person.kind === "full" ? "Make part-time" : "Make full-time"}
              </button>
              {noteFor(person.userId) ? (
                <button
                  type="button"
                  role="menuitem"
                  className="h-11 rounded-md px-2 text-left text-sm hover:bg-raised"
                  aria-label={`Clear instruction for ${person.name}`}
                  onClick={() => {
                    onMenu(null);
                    void onSaveNote(person.userId, "");
                  }}
                >
                  Clear instruction
                </button>
              ) : null}
              <button
                type="button"
                role="menuitem"
                className="h-11 rounded-md px-2 text-left text-sm hover:bg-raised"
                onClick={() => onRemovePerson(person.userId)}
              >
                Remove from schedule
              </button>
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function AddLocation({
  board,
  busy,
  onCancel,
  onCreate,
}: {
  board: Board;
  busy: boolean;
  onCancel: () => void;
  onCreate: (input: {
    projectId?: string;
    name?: string;
    address?: string;
    notes?: string;
  }) => void;
}) {
  const [projectId, setProjectId] = useState("");
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  return (
    <form
      className="grid gap-3 rounded-md border border-line bg-surface p-3"
      data-testid="dispatch-location-form"
      onSubmit={(event) => {
        event.preventDefault();
        onCreate(projectId ? { projectId, notes } : { name, address, notes });
      }}
    >
      <p className="text-sm text-muted">
        Use a job already in the company, or add a site that is not a job.
      </p>
      {board.projects.length ? (
        <label className="grid gap-1 text-sm" htmlFor="dispatch-project">
          Job
          <select
            id="dispatch-project"
            className="field"
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
          >
            <option value="">New location</option>
            {board.projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {projectId ? null : (
        <>
          <label className="grid gap-1 text-sm" htmlFor="dispatch-location-name">
            Location
            <input
              id="dispatch-location-name"
              className="field"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              maxLength={120}
            />
          </label>
          <label className="grid gap-1 text-sm" htmlFor="dispatch-location-address">
            Address
            <input
              id="dispatch-location-address"
              className="field"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              maxLength={160}
            />
          </label>
        </>
      )}
      <label className="grid gap-1 text-sm" htmlFor="dispatch-location-notes">
        Standing instructions
        <textarea
          id="dispatch-location-notes"
          className="field"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          maxLength={800}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}>
          Add location
        </Button>
        <Button type="button" tone="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function AddPerson({
  board,
  busy,
  onCancel,
  onCreate,
}: {
  board: Board;
  busy: boolean;
  onCancel: () => void;
  onCreate: (input: { userId: string; kind: DispatchKind; locationId?: string | null }) => void;
}) {
  const [userId, setUserId] = useState(board.candidates[0]?.userId ?? "");
  const [kind, setKind] = useState<DispatchKind>("full");
  const [locationId, setLocationId] = useState(board.locations[0]?.id ?? "");
  if (board.candidates.length === 0) {
    return (
      <div className="rounded-md border border-line p-3" data-testid="dispatch-person-form">
        <p>Everyone in the company is already on the schedule.</p>
        <Button type="button" tone="ghost" className="mt-3" onClick={onCancel}>
          Close
        </Button>
      </div>
    );
  }
  return (
    <form
      className="grid gap-3 rounded-md border border-line bg-surface p-3"
      data-testid="dispatch-person-form"
      onSubmit={(event) => {
        event.preventDefault();
        onCreate({ userId, kind, locationId: kind === "full" ? locationId || null : null });
      }}
    >
      <label className="grid gap-1 text-sm" htmlFor="dispatch-person">
        Person
        <select
          id="dispatch-person"
          className="field"
          value={userId}
          onChange={(event) => setUserId(event.target.value)}
          required
        >
          {board.candidates.map((person) => (
            <option key={person.userId} value={person.userId}>
              {person.name}
            </option>
          ))}
        </select>
      </label>
      <fieldset className="grid gap-2">
        <legend className="text-sm">Schedule</legend>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="radio"
            name="dispatch-kind"
            checked={kind === "full"}
            onChange={() => setKind("full")}
          />
          Full-time, at a location from 8:00 AM every day
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="radio"
            name="dispatch-kind"
            checked={kind === "part"}
            onChange={() => setKind("part")}
          />
          Part-time, only on the days you place them
        </label>
      </fieldset>
      {kind === "full" && board.locations.length ? (
        <label className="grid gap-1 text-sm" htmlFor="dispatch-person-location">
          Starting location
          <select
            id="dispatch-person-location"
            className="field"
            value={locationId}
            onChange={(event) => setLocationId(event.target.value)}
          >
            {board.locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}>
          Add to schedule
        </Button>
        <Button type="button" tone="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function WeekBoard({
  board,
  focus,
  onOpen,
}: {
  board: Board;
  focus: string;
  onOpen: (day: string) => void;
}) {
  const byId = new Map(board.people.map((person) => [person.userId, person]));
  return (
    <div
      className="flex min-w-0 gap-2 overflow-x-auto pb-2 md:grid md:grid-cols-7 md:overflow-visible"
      data-testid="dispatch-week"
    >
      {board.days.map((day) => {
        const placed = board.daysPlaced.find((entry) => entry.day === day);
        const groups = board.locations
          .map((location) => ({
            location,
            people: (placed?.placements ?? []).filter((row) => row.locationId === location.id),
          }))
          .filter((group) => group.people.length > 0);
        const available = (placed?.placements ?? []).filter(
          (row) => row.kind === "part" && !row.locationId,
        ).length;
        return (
          <section
            key={day}
            data-selected={day === focus ? "true" : "false"}
            className={`w-40 shrink-0 overflow-hidden rounded-md border p-2 md:w-auto md:min-w-0 ${day === focus ? "border-[#c6a15b] bg-[#2a2418]" : "border-line"}`}
          >
            <button
              type="button"
              className="sticky top-0 z-10 h-11 w-full bg-inherit text-left text-sm font-medium"
              onClick={() => onOpen(day)}
            >
              {formatDispatchDayShort(day)}
            </button>
            {groups.length === 0 ? <p className="text-sm text-muted">No one placed</p> : null}
            <ul className="grid gap-2">
              {groups.map((group) => (
                <li key={group.location.id}>
                  <p className="truncate text-sm font-medium">{group.location.name}</p>
                  {board.locationInstructions.find(
                    (note) => note.locationId === group.location.id && note.day === day,
                  ) ? (
                    <p
                      className="line-clamp-2 text-xs text-muted"
                      data-testid="dispatch-week-location-note"
                    >
                      {
                        board.locationInstructions.find(
                          (note) => note.locationId === group.location.id && note.day === day,
                        )?.body
                      }
                    </p>
                  ) : null}
                  <ul>
                    {group.people.map((row) => {
                      const person = byId.get(row.userId);
                      const instruction = board.personInstructions.find(
                        (note) => note.userId === row.userId && note.day === day,
                      );
                      return (
                        <li key={row.userId} className="text-sm text-muted">
                          <p className="truncate">{person?.name ?? "Crew"}</p>
                          {person?.phone ? (
                            <p className="truncate text-xs">{formatPhone(person.phone)}</p>
                          ) : null}
                          {instruction ? (
                            <p
                              className="line-clamp-2 text-xs"
                              data-testid="dispatch-week-person-note"
                            >
                              {instruction.body}
                            </p>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))}
            </ul>
            {available ? <p className="mt-2 text-xs text-muted">{available} available</p> : null}
          </section>
        );
      })}
    </div>
  );
}
