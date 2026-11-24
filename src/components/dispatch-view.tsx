import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { ChevronLeft, ChevronRight, GripVertical } from "lucide-react";
import {
  addDispatchLocation,
  addDispatchPerson,
  getDispatch,
  placeDispatch,
  removeDispatchPerson,
  setDispatchDayNote,
  setDispatchPersonKind,
  setDispatchPersonNote,
  setDispatchPhone,
  updateDispatchLocation,
} from "@/lib/server/fns";
import { Button, Chip, EmptyState, ErrorBanner, Skeleton } from "@/components/ui";
import { useDesk } from "@/components/desk-context";
import { can } from "@/lib/permissions";
import { formatPhone } from "@/lib/roles";
import { addDays, todayIso, weekStart } from "@/lib/crew";
import {
  DISPATCH_DRAG_SAVE_MS,
  createDragGate,
  formatDispatchDay,
  formatDispatchWeek,
  kindLabel,
  placementForDrop,
  type DispatchKind,
} from "@/lib/dispatch";

type Board = Awaited<ReturnType<typeof getDispatch>>;
type Person = Board["people"][number];
type Placement = Board["daysPlaced"][number]["placements"][number];

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
  useEffect(() => setText(value), [value]);
  return (
    <label className="grid gap-1 text-sm text-muted">
      {label}
      <textarea
        className="field"
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
      {saved ? <span className="text-xs text-pine">Saved</span> : null}
    </label>
  );
}

export function DispatchView() {
  const { ready } = useDesk();
  const role = ready.profile.role;
  const [mode, setMode] = useState<"day" | "week">("day");
  const [day, setDay] = useState(() => todayIso());
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [addingLoc, setAddingLoc] = useState(false);
  const [addingPerson, setAddingPerson] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);
  const [ghost, setGhost] = useState<Ghost | null>(null);
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
    <div className="grid min-w-0 gap-4" data-testid="dispatch-view" data-pending={queued > 0 ? "true" : "false"}>
      <div className="flex flex-wrap items-center gap-2">
        <div
          className="flex rounded-md border border-line p-1"
          role="tablist"
          aria-label="Dispatch view"
        >
          {(["day", "week"] as const).map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={mode === id}
              data-testid={`dispatch-tab-${id}`}
              className={`h-11 rounded-md px-4 text-sm font-medium ${mode === id ? "bg-copper text-ink" : "text-muted"}`}
              onClick={() => setMode(id)}
            >
              {id === "day" ? "Day" : "Week"}
            </button>
          ))}
        </div>
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
        {showing && !showing.canEdit ? (
          <p className="text-sm text-muted" data-testid="dispatch-readonly">
            View only
          </p>
        ) : null}
      </div>

      {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}
      {!showing && !error ? <Skeleton lines={6} label="Loading dispatch" /> : null}

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
          onRemoveLocation={(id) =>
            void run(
              () => updateDispatchLocation({ data: { id, archived: true } }),
              "Could not remove that location.",
            )
          }
          onSaveStanding={(id, notes) =>
            updateDispatchLocation({ data: { id, notes } })
              .then(() => refresh())
              .catch((cause: unknown) => {
                setError(message(cause, "Could not save that."));
                throw cause;
              })
          }
          onSaveDay={(locationId, notes) =>
            setDispatchDayNote({ data: { locationId, day, notes } })
              .then(() => refresh())
              .catch((cause: unknown) => {
                setError(message(cause, "Could not save that."));
                throw cause;
              })
          }
          onSavePersonNote={(userId, notes) =>
            setDispatchPersonNote({ data: { userId, day, notes } })
              .then(() => refresh())
              .catch((cause: unknown) => {
                setError(message(cause, "Could not save that."));
                throw cause;
              })
          }
          onSavePhone={(userId, phone) =>
            setDispatchPhone({ data: { userId, phone } })
              .then(() => refresh())
              .catch((cause: unknown) => {
                setError(message(cause, "Could not save that number."));
                throw cause;
              })
          }
          onCreateLocation={(input) =>
            void run(
              () => addDispatchLocation({ data: input }),
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

      {ghost ? (
        <div
          className="pointer-events-none fixed z-50 rounded-md border border-copper bg-surface px-3 py-2 text-sm shadow-lg"
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
      <div>
        <p className="font-display text-2xl" data-testid="dispatch-start">
          Starts at {board.startLabel}
        </p>
        <p className="mt-1 max-w-xl text-sm text-muted">
          Full-time crew stay on a location until you move them. Part-time crew appear only on the
          days you place them.
        </p>
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

      {hasPart ? (
        <section
          className={`rounded-md border bg-surface p-3 ${hot(ghost, "available") ? "border-copper ring-2 ring-copper" : "border-line"}`}
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
            className={`rounded-md border bg-surface p-3 ${hot(ghost, location.id) ? "border-copper ring-2 ring-copper" : "border-line"}`}
            data-drop={location.id}
            data-testid="dispatch-location"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="truncate text-lg">{location.name}</h2>
                  {location.linked ? <Chip>Job</Chip> : null}
                </div>
                {location.address ? <p className="text-sm text-muted">{location.address}</p> : null}
              </div>
              {canEdit ? (
                <button
                  type="button"
                  className="h-11 shrink-0 rounded-md px-2 text-sm text-muted"
                  aria-label={`Remove ${location.name}`}
                  onClick={() => onRemoveLocation(location.id)}
                >
                  Remove
                </button>
              ) : null}
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
                  {location.dayNotes ? (
                    <button
                      type="button"
                      className="h-11 justify-self-start rounded-md px-2 text-sm text-muted"
                      aria-label={`Clear instructions for ${location.name}`}
                      onClick={() => void onSaveDay(location.id, "")}
                    >
                      Clear today's instructions
                    </button>
                  ) : null}
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
  const [phone, setPhone] = useState(person.phone ?? "");
  useEffect(() => setDraft(note), [note]);
  useEffect(() => setPhone(person.phone ?? ""), [person.phone]);
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
            if (phone.trim() === (person.phone ?? "")) return;
            void onSavePhone(person.userId, phone);
          }}
        />
      ) : (
        <p className="text-sm text-muted" data-testid="dispatch-phone">
          {person.phone ? formatPhone(person.phone) : "No phone"}
        </p>
      )}
      {editing ? (
        <div className="grid gap-1">
          <textarea
            aria-label={`Instruction for ${person.name}`}
            data-testid="dispatch-person-note"
            className="field"
            maxLength={800}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="h-11 rounded-md bg-copper px-3 text-sm font-medium text-ink"
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
          <button type="button" className="h-11 px-1 text-left text-sm text-copper" onClick={() => { setDraft(note); setEditing(true); }}>
            {note ? `Edit instruction for ${person.name}` : `Instruction for ${person.name}`}
          </button>
          {note ? (
            <button
              type="button"
              className="h-11 px-1 text-sm text-muted"
              aria-label={`Clear instruction for ${person.name}`}
              onClick={() => void onSaveNote(person.userId, "")}
            >
              Clear
            </button>
          ) : null}
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
        <li key={person.userId} className="relative" data-testid="dispatch-person">
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
                  {location.name}
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
              <button
                type="button"
                role="menuitem"
                className="h-11 rounded-md px-2 text-left text-sm text-danger hover:bg-raised"
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
    <div className="flex min-w-0 gap-3 overflow-x-auto pb-2" data-testid="dispatch-week">
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
            className={`w-44 shrink-0 rounded-md border p-2 ${day === focus ? "border-copper" : "border-line"}`}
          >
            <button
              type="button"
              className="h-11 w-full text-left text-sm font-medium"
              onClick={() => onOpen(day)}
            >
              {formatDispatchDay(day).replace(/, /, " ")}
            </button>
            {groups.length === 0 ? <p className="text-sm text-muted">No one placed</p> : null}
            <ul className="grid gap-2">
              {groups.map((group) => (
                <li key={group.location.id}>
                  <p className="truncate text-sm font-medium">{group.location.name}</p>
                  {board.locationInstructions.find((note) => note.locationId === group.location.id && note.day === day) ? (
                    <p className="text-xs text-muted" data-testid="dispatch-week-location-note">
                      {board.locationInstructions.find((note) => note.locationId === group.location.id && note.day === day)?.body}
                    </p>
                  ) : null}
                  <ul>
                    {group.people.map((row) => {
                      const person = byId.get(row.userId);
                      const instruction = board.personInstructions.find((note) => note.userId === row.userId && note.day === day);
                      return (
                        <li key={row.userId} className="text-sm text-muted">
                          <p className="truncate">{person?.name ?? "Crew"}</p>
                          {person?.phone ? <p className="truncate text-xs">{formatPhone(person.phone)}</p> : null}
                          {instruction ? <p className="text-xs" data-testid="dispatch-week-person-note">{instruction.body}</p> : null}
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
