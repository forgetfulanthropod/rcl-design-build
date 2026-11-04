import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clockFromMinutes,
  inputToMinutes,
  labelSessions,
  mayAddSession,
  mayEditSession,
  mayReviewSessions,
  normalizeSession,
  sessionCaption,
  sessionCaptionRuns,
  sessionLetter,
  sessionMinutes,
  type WorkSession,
} from "./work-sessions.ts";

const session = (partial: Partial<WorkSession> & Pick<WorkSession, "id" | "startMin">): WorkSession => ({
  day: "2026-10-20",
  projectId: null,
  projectName: "Project",
  endMin: partial.startMin + 60,
  notes: "",
  ...partial,
});

test("session letters run a, b, c and then aa; order is by start, not by insert order", () => {
  assert.equal(sessionLetter(0), "a");
  assert.equal(sessionLetter(1), "b");
  assert.equal(sessionLetter(25), "z");
  assert.equal(sessionLetter(26), "aa");
  const labeled = labelSessions([
    session({ id: "later", startMin: 13 * 60, projectName: "Project B", notes: "drywall takeoffs" }),
    session({ id: "earlier", startMin: 8 * 60, projectName: "Project A", notes: "demolish fence" }),
    session({ id: "same", startMin: 8 * 60, projectName: "Project A", notes: "second" }),
  ]);
  assert.deepEqual(labeled.map((s) => s.letter), ["a", "b", "c"]);
  assert.deepEqual(labeled.map((s) => s.id), ["earlier", "same", "later"]);
});

test("caption is letter, project, notes — project name is the bold run", () => {
  const sessions = [
    session({ id: "b", startMin: 13 * 60, projectName: "Project B", notes: "drywall takeoffs" }),
    session({ id: "a", startMin: 8 * 60, projectName: "Project A", notes: "  demolish fence  " }),
  ];
  assert.equal(sessionCaption(sessions), "a  Project A demolish fence   b  Project B drywall takeoffs");
  const runs = sessionCaptionRuns(sessions);
  assert.deepEqual(
    runs.filter((run) => run.bold).map((run) => run.text),
    ["Project A", "Project B"],
  );
  assert.equal(runs.map((run) => run.text).join(""), sessionCaption(sessions));
  assert.equal(sessionCaption([session({ id: "a", startMin: 60, projectName: "Project A", notes: "  " })]), "a  Project A");
});

test("a session stays inside one day and needs a project; the bar uses its minutes", () => {
  assert.deepEqual(normalizeSession({ startMin: 8 * 60, endMin: 11 * 60 + 30, projectName: " Project A ", notes: " demolish fence " }), {
    ok: true,
    value: { startMin: 480, endMin: 690, projectName: "Project A", notes: "demolish fence" },
  });
  assert.equal(normalizeSession({ startMin: 600, endMin: 600, projectName: "Project A", notes: "" }).ok, false);
  assert.equal(normalizeSession({ startMin: 600, endMin: 500, projectName: "Project A", notes: "" }).ok, false);
  assert.equal(normalizeSession({ startMin: -1, endMin: 60, projectName: "Project A", notes: "" }).ok, false);
  assert.equal(normalizeSession({ startMin: 0, endMin: 60, projectName: "   ", notes: "notes" }).ok, false);
  assert.equal(normalizeSession({ startMin: 0, endMin: 1440, projectName: "Project A", notes: "x".repeat(800) }).ok, true);
  const capped = normalizeSession({ startMin: 0, endMin: 1440, projectName: "Project A", notes: "x".repeat(800) });
  assert.equal(capped.ok && capped.value.notes.length, 500);
  assert.equal(sessionMinutes({ startMin: 8 * 60, endMin: 11 * 60 + 30 }), 210);
  assert.equal(clockFromMinutes(8 * 60), "8:00 AM");
  assert.equal(clockFromMinutes(13 * 60 + 5), "1:05 PM");
  assert.equal(inputToMinutes("08:00"), 480);
  assert.equal(inputToMinutes("24:00"), 1440);
  assert.equal(inputToMinutes("24:01"), null);
  assert.equal(inputToMinutes("nope"), null);
});

test("hours editing: every role edits their own; only owner, admin and superadmin edit someone else's", () => {
  for (const role of ["owner", "admin", "superadmin", "lead", "labor", "sub"] as const) {
    assert.equal(mayAddSession(role), true, role);
    assert.equal(mayEditSession(role, "me", "me"), true, `${role} own`);
  }
  for (const role of ["owner", "admin", "superadmin"] as const) {
    assert.equal(mayReviewSessions(role), true, role);
    assert.equal(mayEditSession(role, "them", "me"), true, `${role} other`);
  }
  assert.equal(mayReviewSessions("lead"), true);
  assert.equal(mayEditSession("lead", "them", "me"), false);
  for (const role of ["labor", "sub"] as const) {
    assert.equal(mayReviewSessions(role), false, role);
    assert.equal(mayEditSession(role, "them", "me"), false, role);
  }
  assert.equal(mayAddSession("hacker"), false);
  assert.equal(mayEditSession("hacker", "me", "me"), false);
  assert.equal(mayEditSession("subcontractor", "them", "me"), false);
  assert.equal(mayEditSession("field", "me", "me"), true);
  assert.equal(mayEditSession("field", "them", "me"), false);
  assert.equal(mayEditSession("owner", undefined, "me"), false);
  assert.equal(mayEditSession("owner", "them", undefined), false);
});
