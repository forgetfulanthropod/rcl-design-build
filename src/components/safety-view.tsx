import { useEffect, useState } from "react";
import { addTraining, approveJsa, getSafety, recordInspection, saveJsa, saveOrientation } from "@/lib/server/fns";
import { localDay } from "@/components/today-report";
import { BigButton, Button, ErrorBanner, Skeleton } from "@/components/ui";

type Desk = Awaited<ReturnType<typeof getSafety>>;

function Answer({ yes }: { yes: boolean | null }) {
  const label = yes == null ? "Not answered" : yes ? "Yes" : "No";
  return <span className={`text-sm ${yes ? "text-copper" : "text-muted"}`}>{label}</span>;
}

export function SafetyView() {
  const today = localDay();
  const [day, setDay] = useState(today);
  const [desk, setDesk] = useState<Desk | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [projectId, setProjectId] = useState("");
  const [hazards, setHazards] = useState("");
  const [controls, setControls] = useState("");
  const [inspectJob, setInspectJob] = useState("");
  const [inspectOn, setInspectOn] = useState(today);
  const [inspectNotes, setInspectNotes] = useState("");
  const [course, setCourse] = useState("");
  const [coursePerson, setCoursePerson] = useState("");
  const [courseDue, setCourseDue] = useState("");

  useEffect(() => {
    let cancelled = false;
    setError("");
    getSafety({ data: { day } })
      .then((next) => {
        if (!cancelled) setDesk(next);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not open safety checks.");
      });
    return () => {
      cancelled = true;
    };
  }, [day]);

  async function run(work: Promise<Desk>): Promise<boolean> {
    setBusy(true);
    setError("");
    try {
      setDesk(await work);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save that.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  const self = desk?.people.find((person) => person.userId === desk.selfId);

  return (
    <div className="mx-auto grid max-w-2xl gap-4" data-testid="safety">
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setDay(today)}
          className={`h-11 rounded-md border text-sm ${day === today ? "border-copper bg-copper text-ink" : "border-line text-fg"}`}
        >
          Today
        </button>
        <input type="date" aria-label="Safety day" className="field" value={day} onChange={(event) => setDay(event.target.value)} />
      </div>
      {error ? <ErrorBanner message={error} /> : null}
      {!desk ? (
        <Skeleton lines={4} label="Loading safety checks" />
      ) : (
        <>
          <p className="text-sm text-muted" data-testid="safety-summary">
            Orientation {desk.orientation.attended} of {desk.orientation.total} · Daily analysis {desk.dailyJsa.recorded ? "recorded" : "missing"} · Inspections {desk.inspection.overdue} overdue · Training {desk.training.inPlace ? "in place" : "not set"}
          </p>

          <section className="rounded-md border border-line bg-surface p-4">
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-lg text-fg">1. Safety orientation</h2>
              <Answer yes={self ? self.attended : desk.orientation.total > 0 && desk.orientation.attended === desk.orientation.total} />
            </div>
            <p className="mt-1 text-base text-muted">Did you attend a safety orientation before this role?</p>
            {self && desk.canWrite && !desk.canManage ? (
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  tone={self.attended === true ? "copper" : "ghost"}
                  disabled={busy}
                  onClick={() => void run(saveOrientation({ data: { day, personId: self.userId, attended: true, attendedOn: today } }))}
                >
                  Yes
                </Button>
                <Button
                  type="button"
                  tone={self.attended === false ? "copper" : "ghost"}
                  disabled={busy}
                  onClick={() => void run(saveOrientation({ data: { day, personId: self.userId, attended: false, attendedOn: "" } }))}
                >
                  No
                </Button>
              </div>
            ) : null}
            {desk.canManage ? (
              <ul className="mt-3 grid gap-2">
                {desk.people.map((person) => (
                  <li key={person.userId} className="flex items-center justify-between gap-2 border-t border-line pt-2">
                    <span className="text-base text-fg">{person.name}</span>
                    <span className="flex gap-2">
                      <button
                        type="button"
                        className={`h-11 rounded-md px-3 text-sm ${person.attended === true ? "bg-copper text-ink" : "text-muted"}`}
                        disabled={busy}
                        onClick={() => void run(saveOrientation({ data: { day, personId: person.userId, attended: true, attendedOn: today } }))}
                      >
                        Yes
                      </button>
                      <button
                        type="button"
                        className={`h-11 rounded-md px-3 text-sm ${person.attended === false ? "bg-copper text-ink" : "text-muted"}`}
                        disabled={busy}
                        onClick={() => void run(saveOrientation({ data: { day, personId: person.userId, attended: false, attendedOn: "" } }))}
                      >
                        No
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

          <section className="rounded-md border border-line bg-surface p-4">
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-lg text-fg">2. Daily job safety analysis</h2>
              <Answer yes={desk.dailyJsa.recorded} />
            </div>
            <p className="mt-1 text-base text-muted">Does the crew have one for this day?</p>
            {desk.jsas.length > 0 ? (
              <ul className="mt-3 grid gap-3">
                {desk.jsas.map((item) => (
                  <li key={item.id} className="border-t border-line pt-3" data-testid="jsa-card">
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="text-base text-fg">{item.projectName}</h3>
                      <span className={`text-sm ${item.status === "approved" ? "text-copper" : "text-muted"}`}>
                        {item.status === "approved" ? "Approved" : "Open"}
                      </span>
                    </div>
                    <p className="mt-1 text-base text-fg">{item.hazards}</p>
                    <p className="mt-1 text-sm text-muted">Controls: {item.controls}</p>
                    <p className="mt-1 text-sm text-muted">{item.createdByName || "Crew"}</p>
                    {desk.canManage && item.status !== "approved" ? (
                      <Button type="button" className="mt-2" disabled={busy} onClick={() => void run(approveJsa({ data: { day, id: item.id } }))}>
                        Approve
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
            {!desk.canWriteJsa ? (
              <p className="mt-3 text-base text-fg" data-testid="jsa-readonly">Your lead records today's job safety analysis.</p>
            ) : null}
            {desk.canWriteJsa ? (
              <form
                className="mt-3 grid gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(saveJsa({ data: { day, projectId, hazards, controls } })).then((ok) => {
                    if (!ok) return;
                    setHazards("");
                    setControls("");
                  });
                }}
              >
                <label className="text-sm text-muted" htmlFor="jsa-job">Job</label>
                <select id="jsa-job" className="field" value={projectId} onChange={(event) => setProjectId(event.target.value)}>
                  <option value="">No job</option>
                  {desk.jobs.map((job) => (
                    <option key={job.id} value={job.id}>{job.name}</option>
                  ))}
                </select>
                <label className="text-sm text-muted" htmlFor="jsa-hazards">Hazards</label>
                <textarea id="jsa-hazards" className="field min-h-20" value={hazards} onChange={(event) => setHazards(event.target.value)} />
                <label className="text-sm text-muted" htmlFor="jsa-controls">Controls</label>
                <textarea id="jsa-controls" className="field min-h-20" value={controls} onChange={(event) => setControls(event.target.value)} />
                <BigButton type="submit" disabled={busy || !hazards.trim() || !controls.trim()}>
                  Save analysis
                </BigButton>
              </form>
            ) : null}
          </section>

          <section className="rounded-md border border-line bg-surface p-4">
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-lg text-fg">3. Inspection every 30 days</h2>
              <Answer yes={desk.inspections.length > 0 && desk.inspection.overdue === 0} />
            </div>
            <ul className="mt-3 grid gap-2">
              {desk.inspections.map((item) => (
                <li key={item.projectId} className="flex items-baseline justify-between gap-3 border-t border-line pt-2">
                  <span className="text-base text-fg">{item.projectName}</span>
                  <span className={`text-sm ${item.overdue ? "text-copper" : "text-muted"}`}>
                    {item.inspectedOn ? `${item.daysAgo}d ago` : "None"}
                    {item.overdue ? " · overdue" : ""}
                  </span>
                </li>
              ))}
            </ul>
            {desk.canManage ? (
              <form
                className="mt-3 grid gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!inspectJob) return;
                  void run(recordInspection({ data: { day, projectId: inspectJob, inspectedOn: inspectOn, notes: inspectNotes } }));
                  setInspectNotes("");
                }}
              >
                <label className="text-sm text-muted" htmlFor="insp-job">Record an inspection</label>
                <select id="insp-job" className="field" value={inspectJob} onChange={(event) => setInspectJob(event.target.value)}>
                  <option value="">Job</option>
                  {desk.jobs.map((job) => (
                    <option key={job.id} value={job.id}>{job.name}</option>
                  ))}
                </select>
                <input type="date" aria-label="Inspection date" className="field" value={inspectOn} onChange={(event) => setInspectOn(event.target.value)} />
                <input className="field" aria-label="Inspection notes" placeholder="What you looked at" value={inspectNotes} onChange={(event) => setInspectNotes(event.target.value)} />
                <Button type="submit" disabled={busy || !inspectJob}>
                  Record inspection
                </Button>
              </form>
            ) : null}
          </section>

          <section className="rounded-md border border-line bg-surface p-4">
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-lg text-fg">4. Training schedule</h2>
              <Answer yes={desk.training.inPlace} />
            </div>
            <p className="mt-1 text-base text-muted">Is there a schedule so certifications stay current?</p>
            {desk.courses.length === 0 ? (
              <p className="mt-2 text-base text-muted">Nothing on the schedule yet.</p>
            ) : (
              <ul className="mt-3 grid gap-2">
                {desk.courses.map((item) => (
                  <li key={item.id} className="border-t border-line pt-2">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-base text-fg">{item.title}</span>
                      <span className={`text-sm ${item.overdue ? "text-copper" : "text-muted"}`}>
                        {item.completedOn ? "Done" : item.overdue ? "Overdue" : item.dueOn ? `Due ${item.dueOn}` : "Scheduled"}
                      </span>
                    </div>
                    {item.personName ? <p className="text-sm text-muted">{item.personName}</p> : null}
                  </li>
                ))}
              </ul>
            )}
            {desk.canManage ? (
              <form
                className="mt-3 grid gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!course.trim()) return;
                  void run(addTraining({ data: { day, title: course, personId: coursePerson, dueOn: courseDue } }));
                  setCourse("");
                  setCourseDue("");
                }}
              >
                <label className="text-sm text-muted" htmlFor="course-title">Add to the schedule</label>
                <input id="course-title" className="field" placeholder="OSHA 10, toolbox talk…" value={course} onChange={(event) => setCourse(event.target.value)} />
                <select className="field" aria-label="Who" value={coursePerson} onChange={(event) => setCoursePerson(event.target.value)}>
                  <option value="">Whole crew</option>
                  {desk.people.map((person) => (
                    <option key={person.userId} value={person.userId}>{person.name}</option>
                  ))}
                </select>
                <input type="date" aria-label="Due date" className="field" value={courseDue} onChange={(event) => setCourseDue(event.target.value)} />
                <Button type="submit" disabled={busy || !course.trim()}>
                  Add to schedule
                </Button>
              </form>
            ) : null}
          </section>
        </>
      )}
    </div>
  );
}
