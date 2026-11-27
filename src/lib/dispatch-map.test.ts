import assert from "node:assert/strict";
import { test } from "node:test";
import { addDays } from "./crew.ts";
import {
  MAP_FUTURE_DAYS,
  MAP_PAST_DAYS,
  asOfFromIndex,
  clampAsOf,
  crewOptions,
  formatMapDay,
  indexFromAsOf,
  initials,
  mapDayCaption,
  mapRange,
  phasePercent,
  progressAt,
  selectDispatchMap,
  sliderSpan,
  stageForPercent,
  type DispatchMapFacts,
} from "./dispatch-map.ts";

const TODAY = "2026-11-27";

function facts(extra?: Partial<DispatchMapFacts>): DispatchMapFacts {
  const range = mapRange(TODAY);
  return {
    today: TODAY,
    rangeStart: range.start,
    rangeEnd: range.end,
    canEdit: true,
    jobs: [
      { id: "whitaker", name: "Whitaker kitchen", address: "418 Whitaker Ln", phase: "Build", lat: 38.01, lng: -84.45 },
      { id: "oak", name: "Oak Street", address: "1510 Oak St", phase: "Permit", lat: 38.05, lng: -84.51 },
      { id: "dental", name: "Dental fit-up", address: "820 Euclid", phase: "Design", lat: 38.03, lng: -84.49 },
      { id: "done", name: "Finished porch", address: "1 Done", phase: "Finish", lat: 38.02, lng: -84.5 },
    ],
    people: [
      { userId: "luis", name: "Luis Moreno", active: true },
      { userId: "lena", name: "Lena Ortiz", active: true },
      { userId: "sam", name: "Sam Whitfield (Bluegrass Electric)", active: true },
      { userId: "gone", name: "Gone Guy", active: false },
    ],
    presences: [],
    ...extra,
  };
}

test("the slider covers one year back through six months ahead", () => {
  const range = mapRange(TODAY);
  assert.equal(range.start, addDays(TODAY, -MAP_PAST_DAYS));
  assert.equal(range.end, addDays(TODAY, MAP_FUTURE_DAYS));
  assert.equal(sliderSpan(TODAY), MAP_PAST_DAYS + MAP_FUTURE_DAYS);
  assert.equal(indexFromAsOf(TODAY, TODAY), MAP_PAST_DAYS);
  assert.equal(asOfFromIndex(TODAY, 0), range.start);
  assert.equal(asOfFromIndex(TODAY, sliderSpan(TODAY)), range.end);
  assert.equal(asOfFromIndex(TODAY, -10), range.start);
  assert.equal(asOfFromIndex(TODAY, 9_999), range.end);
  assert.equal(clampAsOf(TODAY, "1999-01-01"), range.start);
  assert.equal(clampAsOf(TODAY, "2099-01-01"), range.end);
  assert.equal(clampAsOf(TODAY, "nope"), range.start);
});

test("phases sit on the four stages", () => {
  assert.equal(phasePercent("Schematic"), 8);
  assert.equal(phasePercent("Design"), 22);
  assert.equal(phasePercent("Permit"), 40);
  assert.equal(phasePercent("Build"), 68);
  assert.equal(phasePercent("Finish"), 100);
  assert.equal(phasePercent("mystery"), 0);
  assert.equal(stageForPercent(0), "nothing");
  assert.equal(stageForPercent(8), "starting");
  assert.equal(stageForPercent(33), "starting");
  assert.equal(stageForPercent(34), "maturing");
  assert.equal(stageForPercent(89), "maturing");
  assert.equal(stageForPercent(90), "finished");
  assert.equal(stageForPercent(100), "finished");
});

test("slider: crew time scales a job toward its phase, then through scheduled days", () => {
  // Build is 68% as of today. Four person-days are already on the books.
  const past = ["2026-11-24|luis", "2026-11-25|luis", "2026-11-26|lena", "2026-11-27|luis"];
  assert.equal(progressAt({ phase: "Build", asOf: "2026-11-23", today: TODAY, personDays: past }), 0);
  assert.equal(progressAt({ phase: "Build", asOf: "2026-11-24", today: TODAY, personDays: past }), 17);
  assert.equal(progressAt({ phase: "Build", asOf: TODAY, today: TODAY, personDays: past }), 68);
  assert.equal(stageForPercent(17), "starting");
  assert.equal(stageForPercent(68), "maturing");

  // Two scheduled person-days walk the remaining 32 points to finished.
  const future = [...past, "2026-11-28|luis", "2026-12-01|lena"];
  assert.equal(progressAt({ phase: "Build", asOf: "2026-11-28", today: TODAY, personDays: future }), 84);
  assert.equal(progressAt({ phase: "Build", asOf: "2026-12-01", today: TODAY, personDays: future }), 100);
  // A future date with nothing scheduled holds today's percent.
  assert.equal(progressAt({ phase: "Build", asOf: "2026-12-15", today: TODAY, personDays: past }), 68);
});

test("two records on the same person-day count once, and a quiet job shows its phase today", () => {
  const doubled = ["2026-11-27|luis", "2026-11-27|luis"];
  assert.equal(progressAt({ phase: "Design", asOf: TODAY, today: TODAY, personDays: doubled }), 22);
  assert.equal(progressAt({ phase: "Design", asOf: "2026-11-26", today: TODAY, personDays: [] }), 0);
  assert.equal(progressAt({ phase: "Design", asOf: TODAY, today: TODAY, personDays: [] }), 22);
  assert.equal(progressAt({ phase: "Finish", asOf: TODAY, today: TODAY, personDays: [] }), 100);
});

test("initials and the slider caption", () => {
  assert.equal(initials("Luis Moreno"), "LM");
  assert.equal(initials("Sam Whitfield (Bluegrass Electric)"), "SW");
  assert.equal(initials("Ada"), "AD");
  assert.equal(initials("  "), "?");
  assert.equal(mapDayCaption(TODAY, TODAY), "Today");
  assert.equal(mapDayCaption(TODAY, "2026-11-28"), "Tomorrow");
  assert.equal(mapDayCaption(TODAY, "2026-11-26"), "Yesterday");
  assert.equal(mapDayCaption(TODAY, "2026-11-25"), "2 days ago");
  assert.equal(mapDayCaption(TODAY, "2026-11-30"), "3 days ahead");
  assert.match(formatMapDay(TODAY), /Nov/);
});

test("selectDispatchMap: last active on the left, next day on the right, day badges, needs a crew", () => {
  const board = facts({
    presences: [
      { userId: "luis", projectId: "whitaker", day: "2026-11-24", kind: "report" },
      { userId: "luis", projectId: "whitaker", day: "2026-11-25", kind: "assignment" },
      { userId: "luis", projectId: "whitaker", day: "2026-11-25", kind: "session" },
      { userId: "lena", projectId: "whitaker", day: "2026-11-26", kind: "activity" },
      { userId: "lena", projectId: "oak", day: "2026-11-27", kind: "report" },
      { userId: "sam", projectId: "oak", day: "2026-11-20", kind: "assignment" },
      { userId: "sam", projectId: "dental", day: "2026-11-28", kind: "assignment" },
      { userId: "luis", projectId: "whitaker", day: "2026-11-28", kind: "report" },
    ],
  });
  const view = selectDispatchMap(board, TODAY);
  assert.equal(view.asOf, TODAY);
  assert.equal(view.nextDay, "2026-11-28");
  assert.equal(view.canAssign, true);

  const whitaker = view.jobs.find((job) => job.id === "whitaker");
  const oak = view.jobs.find((job) => job.id === "oak");
  const dental = view.jobs.find((job) => job.id === "dental");
  const done = view.jobs.find((job) => job.id === "done");
  assert.ok(whitaker && oak && dental && done);

  // Lena's latest day is Oak, so she is last-active there, not at Whitaker.
  assert.deepEqual(
    whitaker.lastActive.map((person) => person.userId),
    ["luis"],
  );
  assert.equal(whitaker.lastActive[0]?.days, 2);
  assert.equal(whitaker.lastActive[0]?.initials, "LM");
  // Tomorrow's report is not an assignment, so Whitaker still needs a crew.
  assert.deepEqual(whitaker.nextCrew, []);
  assert.equal(whitaker.needsCrew, true);
  assert.equal(whitaker.stage, "maturing");

  assert.deepEqual(
    oak.lastActive.map((person) => [person.userId, person.days]),
    [
      ["lena", 1],
      ["sam", 1],
    ],
  );
  assert.equal(oak.needsCrew, true);

  assert.deepEqual(dental.lastActive, []);
  assert.equal(dental.nextCrew[0]?.userId, "sam");
  assert.equal(dental.nextCrew[0]?.days, 0);
  assert.equal(dental.needsCrew, false);

  assert.equal(done.stage, "finished");
  assert.equal(done.needsCrew, false);
  assert.equal(view.needsCrewCount, 2);
});

test("dragging ahead counts scheduled days and moves last-active onto that job", () => {
  const board = facts({
    presences: [
      { userId: "luis", projectId: "whitaker", day: "2026-11-27", kind: "assignment" },
      { userId: "luis", projectId: "oak", day: "2026-11-28", kind: "assignment" },
      { userId: "luis", projectId: "oak", day: "2026-11-29", kind: "assignment" },
    ],
  });
  const today = selectDispatchMap(board, TODAY);
  const whitakerNow = today.jobs.find((job) => job.id === "whitaker")!;
  const oakNow = today.jobs.find((job) => job.id === "oak")!;
  assert.equal(whitakerNow.lastActive[0]?.userId, "luis");
  assert.equal(whitakerNow.lastActive[0]?.days, 1);
  assert.equal(oakNow.nextCrew[0]?.userId, "luis");
  assert.equal(oakNow.percent, 40);

  const friday = selectDispatchMap(board, "2026-11-28");
  const oakThen = friday.jobs.find((job) => job.id === "oak")!;
  assert.equal(oakThen.lastActive[0]?.userId, "luis");
  assert.equal(oakThen.lastActive[0]?.days, 1);
  assert.equal(oakThen.nextCrew[0]?.userId, "luis");
  assert.ok(oakThen.percent > 40 && oakThen.percent < 100);

  const after = selectDispatchMap(board, "2026-11-29");
  const oakAfter = after.jobs.find((job) => job.id === "oak")!;
  assert.equal(oakAfter.lastActive[0]?.days, 2);
  assert.equal(oakAfter.percent, 100);
  assert.equal(oakAfter.stage, "finished");
  assert.equal(oakAfter.needsCrew, false);
});

test("history is not flagged, and a read-only viewer still sees who is missing", () => {
  const board = facts({
    canEdit: false,
    presences: [{ userId: "luis", projectId: "whitaker", day: "2026-11-20", kind: "assignment" }],
  });
  const past = selectDispatchMap(board, "2026-11-01");
  assert.equal(past.canAssign, false);
  assert.equal(past.needsCrewCount, 0);
  const live = selectDispatchMap(board, TODAY);
  assert.equal(live.canEdit, false);
  assert.equal(live.canAssign, false);
  assert.equal(live.jobs.find((job) => job.id === "whitaker")?.needsCrew, true);
});

test("the same person on two jobs in one day is last-active on both", () => {
  const board = facts({
    presences: [
      { userId: "luis", projectId: "whitaker", day: TODAY, kind: "report" },
      { userId: "luis", projectId: "oak", day: TODAY, kind: "session" },
    ],
  });
  const view = selectDispatchMap(board, TODAY);
  assert.equal(view.jobs.find((job) => job.id === "whitaker")?.lastActive[0]?.userId, "luis");
  assert.equal(view.jobs.find((job) => job.id === "oak")?.lastActive[0]?.userId, "luis");
});

test("crewOptions: people already here, people on another job, inactive people hidden", () => {
  const board = facts({
    presences: [
      { userId: "sam", projectId: "dental", day: "2026-11-28", kind: "assignment" },
      { userId: "gone", projectId: "oak", day: "2026-11-28", kind: "assignment" },
    ],
  });
  const options = crewOptions(board, "whitaker", "2026-11-28");
  assert.deepEqual(
    options.map((person) => [person.userId, person.assignedHere, person.busyElsewhere]),
    [
      ["lena", false, null],
      ["luis", false, null],
      ["sam", false, "Dental fit-up"],
    ],
  );
  const dental = crewOptions(board, "dental", "2026-11-28");
  assert.equal(dental.find((person) => person.userId === "sam")?.assignedHere, true);
});

test("selectDispatchMap does not mutate the facts", () => {
  const board = facts({
    presences: [{ userId: "luis", projectId: "whitaker", day: TODAY, kind: "assignment" }],
  });
  const before = JSON.stringify(board);
  selectDispatchMap(board, TODAY);
  assert.equal(JSON.stringify(board), before);
});
