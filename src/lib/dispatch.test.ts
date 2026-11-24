import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DISPATCH_START_LABEL,
  DISPATCH_START_MIN,
  dispatchWeekDays,
  formatDispatchWeek,
  kindLabel,
  placementForDrop,
  resolveDay,
  toE164,
  createDragGate,
  dispatchMessage,
  formatLastSent,
  sendResultLabel,
  type PlacementRow,
  type RosterPerson,
} from "./dispatch.ts";
import { weekStart } from "./crew.ts";
import { formatPhone } from "./roles.ts";

const people: RosterPerson[] = [
  { userId: "ft", kind: "full" },
  { userId: "pt", kind: "part" },
];
const locs = ["a", "b"];
const placements: PlacementRow[] = [
  { userId: "ft", day: "2026-11-02", locationId: "a", kind: "full" },
  { userId: "ft", day: "2026-11-04", locationId: "b", kind: "full" },
  { userId: "pt", day: "2026-11-03", locationId: "a", kind: "part" },
];

test("dispatch starts at 8:00 AM", () => {
  assert.equal(DISPATCH_START_MIN, 480);
  assert.equal(DISPATCH_START_LABEL, "8:00 AM");
  assert.equal(kindLabel("full"), "Full-time");
  assert.equal(kindLabel("part"), "Part-time");
});

test("the dispatch week is Monday through Sunday", () => {
  assert.deepEqual(dispatchWeekDays("2026-11-24"), [
    "2026-11-23",
    "2026-11-24",
    "2026-11-25",
    "2026-11-26",
    "2026-11-27",
    "2026-11-28",
    "2026-11-29",
  ]);
  assert.equal(weekStart("2026-11-29"), "2026-11-23");
  assert.match(formatDispatchWeek("2026-11-23"), /Nov 23–29, 2026/);
});

test("full-time carries forward until the day it is changed; part-time is only that day", () => {
  const mon = resolveDay(people, placements, locs, "2026-11-02");
  assert.deepEqual(
    mon.find((p) => p.userId === "ft"),
    { userId: "ft", kind: "full", locationId: "a", carried: false },
  );
  assert.equal(mon.find((p) => p.userId === "pt")?.locationId, null);

  const tue = resolveDay(people, placements, locs, "2026-11-03");
  assert.deepEqual(
    tue.find((p) => p.userId === "ft"),
    { userId: "ft", kind: "full", locationId: "a", carried: true },
  );
  assert.equal(tue.find((p) => p.userId === "pt")?.locationId, "a");

  const wed = resolveDay(people, placements, locs, "2026-11-04");
  assert.deepEqual(
    wed.find((p) => p.userId === "ft"),
    { userId: "ft", kind: "full", locationId: "b", carried: false },
  );
  assert.equal(wed.find((p) => p.userId === "pt")?.locationId, null);

  const thu = resolveDay(people, placements, locs, "2026-11-05");
  assert.equal(thu.find((p) => p.userId === "ft")?.locationId, "b");
  assert.equal(thu.find((p) => p.userId === "ft")?.carried, true);
  // Changing Wednesday does not rewrite Monday.
  assert.equal(
    resolveDay(people, placements, locs, "2026-11-02").find((p) => p.userId === "ft")?.locationId,
    "a",
  );
});

test("an archived location leaves the person unassigned instead of hiding them", () => {
  const tue = resolveDay(people, placements, ["b"], "2026-11-03");
  assert.equal(tue.find((p) => p.userId === "ft")?.locationId, null);
  assert.equal(tue.find((p) => p.userId === "pt")?.locationId, null);
});

test("a full-timer placed mid-week also shows on Monday of that week", () => {
  const onlyTuesday: PlacementRow[] = [
    { userId: "ft", day: "2026-11-24", locationId: "a", kind: "full" },
  ];
  const monday = resolveDay(people, onlyTuesday, locs, "2026-11-23");
  assert.equal(monday.find((p) => p.userId === "ft")?.locationId, "a");
  assert.equal(monday.find((p) => p.userId === "ft")?.carried, true);
  const wednesday = resolveDay(people, onlyTuesday, locs, "2026-11-25");
  assert.equal(wednesday.find((p) => p.userId === "ft")?.locationId, "a");
  // The previous week is not backfilled.
  const priorSunday = resolveDay(people, onlyTuesday, locs, "2026-11-22");
  assert.equal(priorSunday.find((p) => p.userId === "ft")?.locationId, null);
  // A placement from the previous week still wins over same-week backfill.
  const withPrior: PlacementRow[] = [
    { userId: "ft", day: "2026-11-20", locationId: "b", kind: "full" },
    { userId: "ft", day: "2026-11-24", locationId: "a", kind: "full" },
  ];
  const mondayPrior = resolveDay(people, withPrior, locs, "2026-11-23");
  assert.equal(mondayPrior.find((p) => p.userId === "ft")?.locationId, "b");
  assert.equal(mondayPrior.find((p) => p.userId === "ft")?.carried, true);
});

test("a full-time person with no placement yet is unassigned", () => {
  const day = resolveDay([{ userId: "new", kind: "full" }], [], locs, "2026-11-02");
  assert.deepEqual(day[0], { userId: "new", kind: "full", locationId: null, carried: false });
});

test("drops: part-time can return to the pool; full-time only moves between locations", () => {
  assert.deepEqual(placementForDrop("part", "available"), { locationId: null });
  assert.equal(placementForDrop("full", "available"), null);
  assert.equal(placementForDrop("full", "unassigned"), null);
  assert.equal(placementForDrop("part", null), null);
  assert.deepEqual(placementForDrop("full", "loc-1"), { locationId: "loc-1" });
  assert.deepEqual(placementForDrop("part", "loc-1"), { locationId: "loc-1" });
});

test("phone numbers display as +1 859-555-0100", () => {
  assert.equal(formatPhone("+18595550100"), "+1 859-555-0100");
  assert.equal(formatPhone("8595550199"), "+1 859-555-0199");
  assert.equal(formatPhone("(859) 555-0100"), "+1 859-555-0100");
});

test("phone numbers normalize to E.164", () => {
  assert.equal(toE164("(859) 555-0100"), "+18595550100");
  assert.equal(toE164("859-555-0100"), "+18595550100");
  assert.equal(toE164("+1 859 555 0100"), "+18595550100");
  assert.equal(toE164("+44 20 7946 0958"), "+442079460958");
  assert.equal(toE164("555-0100"), null);
  assert.equal(toE164("not a phone"), null);
  assert.equal(toE164(""), null);
});

test("a dispatch text names one person, their number, and only their instructions", () => {
  const body = dispatchMessage({
    personName: "Luis Moreno",
    phone: "+18595550100",
    dayLabel: "Tuesday, Nov 24",
    startLabel: "8:00 AM",
    locationName: "Shop",
    locationAddress: "100 Yard St",
    locationInstruction: "Bring the trailer.",
    personInstruction: "Call the homeowner.",
    cleared: null,
  });
  assert.match(body, /Luis Moreno/);
  assert.match(body, /Shop, 100 Yard St/);
  assert.match(body, /8:00 AM/);
  assert.match(body, /Number on file: \+18595550100/);
  assert.match(body, /Location: Bring the trailer/);
  assert.match(body, /For you: Call the homeowner/);
  assert.doesNotMatch(body, /Sam Whitfield/);

  const cleared = dispatchMessage({
    personName: "Luis Moreno",
    phone: null,
    dayLabel: "Tuesday, Nov 24",
    startLabel: "8:00 AM",
    locationName: "Shop",
    locationAddress: "",
    locationInstruction: "",
    personInstruction: "",
    cleared: "person",
  });
  assert.match(cleared, /For you: cleared/);
  assert.doesNotMatch(cleared, /Call the homeowner/);
  assert.doesNotMatch(cleared, /Number on file/);
});

test("last sent is Eastern time, or never", () => {
  assert.equal(formatLastSent(null), "Never sent");
  assert.equal(formatLastSent("2026-11-24T12:42:00.000Z"), "Last sent 7:42 AM");
  assert.equal(
    sendResultLabel({ sent: 2, skippedNoPhone: 1, configured: true }),
    "Sent 2. 1 skipped, no phone.",
  );
  assert.match(
    sendResultLabel({ sent: 0, skippedNoPhone: 0, configured: false }),
    /aren't configured/,
  );
});

test("rapid drags keep only the last location", async () => {
  const saved: (string | null)[] = [];
  const gate = createDragGate(30);
  gate.push("a", (id) => saved.push(id));
  gate.push("b", (id) => saved.push(id));
  gate.push(null, (id) => saved.push(id));
  assert.equal(gate.pending(), true);
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.deepEqual(saved, [null]);
  assert.equal(gate.pending(), false);
});
