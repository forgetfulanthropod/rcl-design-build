export type TaskCard = { id: string; status: string };

export function taskUpdateError(input: {
  status: string;
  priority: string;
  statuses: readonly string[];
  priorities: readonly string[];
}): string | null {
  if (!input.statuses.includes(input.status)) return "Unknown status.";
  if (!input.priorities.includes(input.priority)) return "Unknown priority.";
  return null;
}

export function groupTasks<T extends TaskCard>(tasks: readonly T[], statuses: readonly string[]) {
  return statuses.map((status) => ({
    status,
    items: tasks.filter((task) => task.status === status),
  }));
}

/** Open field work stays ahead of finished calls. Unknown statuses sink to the end. */
export function openTaskCount(tasks: readonly TaskCard[], done: readonly string[]): number {
  const closed = new Set(done);
  return tasks.filter((task) => !closed.has(task.status)).length;
}
