import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { groupTasks, openTaskCount, taskUpdateError } from "./tasks.ts";

const STATUSES = ["New", "Scheduled", "On site", "Punch", "Complete", "Billed"];
const PRIORITIES = ["Rush", "High", "Normal", "Low"];

describe("field task management", () => {
  it("rejects a status or priority that is not on the desk", () => {
    assert.equal(
      taskUpdateError({ status: "Lost", priority: "Normal", statuses: STATUSES, priorities: PRIORITIES }),
      "Unknown status.",
    );
    assert.equal(
      taskUpdateError({ status: "New", priority: "Whenever", statuses: STATUSES, priorities: PRIORITIES }),
      "Unknown priority.",
    );
    assert.equal(
      taskUpdateError({ status: "On site", priority: "High", statuses: STATUSES, priorities: PRIORITIES }),
      null,
    );
  });

  it("groups calls under each status and counts what is still open", () => {
    const tasks = [
      { id: "a", status: "On site", title: "Cabinet run" },
      { id: "b", status: "Scheduled", title: "Fit-up punch" },
      { id: "c", status: "Complete", title: "Walkthrough" },
    ];
    const board = groupTasks(tasks, STATUSES);
    assert.deepEqual(
      board.find((column) => column.status === "On site")?.items.map((item) => item.id),
      ["a"],
    );
    assert.equal(board.find((column) => column.status === "New")?.items.length, 0);
    assert.equal(openTaskCount(tasks, ["Complete", "Billed"]), 2);
  });
});
