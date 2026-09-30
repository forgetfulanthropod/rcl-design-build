import { useMemo, useState } from "react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  archiveProject,
  askForeman,
  createChangeOrder,
  createDailyLog,
  createMilestone,
  createProject,
  createRfi,
  createWorkOrder,
  decideProposal,
  inviteCrew,
  loadDesk,
  setCoStatus,
  setProjectPhase,
  setRfiStatus,
  toggleMilestone,
  updateWorkOrder,
} from "@/lib/server/fns";
import { money, stamp } from "@/lib/money";
import { Button, Chip, Panel } from "@/components/ui";

export type DeskResult = Awaited<ReturnType<typeof loadDesk>>;
export type ReadyDesk = Extract<DeskResult, { needsSetup: false }>;

type Commit = (work: Promise<DeskResult>) => Promise<void>;

export function DeskHome({ data, open }: { data: ReadyDesk; open: (view: "jobs" | "field" | "foreman" | "comms") => void }) {
  const active = data.projects.filter((project) => !project.archived);
  const openRfis = data.rfis.filter((rfi) => rfi.status !== "Closed" && rfi.status !== "Answered");
  const hot = data.workOrders.filter((order) => order.status !== "Complete" && order.status !== "Invoiced");
  const pending = data.proposals.filter((proposal) => proposal.status === "pending");
  const chart = active.map((project) => ({ name: project.name, value: project.contractValue }));

  return (
    <div className="grid gap-4">
      <section className="rounded-md border border-line bg-surface p-5">
        <p className="text-sm text-copper">{data.profile.role}</p>
        <h2 className="mt-1 text-3xl text-fg">
          {data.copy.deskGreeting.replace(/\.$/, "")}, {data.profile.name.split(" ")[0]}.
        </h2>
        <p className="mt-2 max-w-xl text-muted">{data.copy.tagline}</p>
      </section>
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Open jobs" value={String(active.length)} onClick={() => open("jobs")} />
        <Stat label="Live calls" value={String(hot.length)} onClick={() => open("field")} />
        <Stat label="Code waiting" value={String(pending.length)} onClick={() => open("foreman")} />
      </div>
      {chart.length > 0 ? (
        <Panel title="Contract value">
          <div className="h-40 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chart}>
                <XAxis dataKey="name" tick={{ fill: "var(--color-muted)", fontSize: 12 }} interval={0} />
                <YAxis hide />
                <Tooltip
                  cursor={{ fill: "var(--color-raised)" }}
                  contentStyle={{
                    background: "var(--color-surface)",
                    border: "1px solid var(--color-line)",
                    color: "var(--color-fg)",
                  }}
                  formatter={(value) => money(Number(value))}
                />
                <Bar dataKey="value" fill="var(--color-copper)" radius={4} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2">
        <Panel title="Open RFIs">
          {openRfis.length === 0 ? <p className="text-sm text-muted">Nothing waiting on an answer.</p> : null}
          <ul className="grid gap-2">
            {openRfis.slice(0, 4).map((rfi) => (
              <li key={rfi.id} className="text-sm">
                <span className="text-muted">RFI {rfi.number}</span> {rfi.title}
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Dispatch">
          {hot.length === 0 ? <p className="text-sm text-muted">No open work orders.</p> : null}
          <ul className="grid gap-2">
            {hot.slice(0, 4).map((order) => (
              <li key={order.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0 truncate">{order.title}</span>
                <Chip hot={order.priority === "Emergency"}>{order.status}</Chip>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  );
}

function Stat({ label, value, onClick }: { label: string; value: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="rounded-md border border-line bg-surface p-4 text-left">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 font-display text-4xl tabular-nums">{value}</p>
    </button>
  );
}

export function JobsView({ data, commit }: { data: ReadyDesk; commit: Commit }) {
  const jobs = data.projects;
  const [selected, setSelected] = useState(jobs.find((job) => !job.archived)?.id ?? jobs[0]?.id ?? "");
  const job = jobs.find((item) => item.id === selected);
  const [openForm, setOpenForm] = useState(false);
  const [name, setName] = useState("");
  const [clientName, setClientName] = useState("");
  const [address, setAddress] = useState("");
  const [phase, setPhase] = useState(data.workflows.projectPhases[0] ?? "Precon");
  const [value, setValue] = useState("0");
  const [summary, setSummary] = useState("");

  return (
    <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
      <div className="grid content-start gap-2">
        <Button tone="ghost" onClick={() => setOpenForm((value) => !value)}>
          {openForm ? "Close" : "New job"}
        </Button>
        {openForm ? (
          <form
            className="grid gap-2 rounded-md border border-line bg-surface p-3"
            onSubmit={(event) => {
              event.preventDefault();
              void commit(
                createProject({
                  data: {
                    name,
                    clientName,
                    address,
                    phase,
                    contractValue: Number(value),
                    summary,
                  },
                }),
              );
              setOpenForm(false);
            }}
          >
            <input className="field" placeholder="Job name" value={name} onChange={(e) => setName(e.target.value)} required />
            <input className="field" placeholder="Client" value={clientName} onChange={(e) => setClientName(e.target.value)} required />
            <input className="field" placeholder="Address" value={address} onChange={(e) => setAddress(e.target.value)} required />
            <select className="field" value={phase} onChange={(e) => setPhase(e.target.value)}>
              {data.workflows.projectPhases.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
            <input className="field" inputMode="numeric" placeholder="Contract $" value={value} onChange={(e) => setValue(e.target.value)} />
            <textarea className="field" placeholder="Summary" value={summary} onChange={(e) => setSummary(e.target.value)} />
            <Button type="submit">Save job</Button>
          </form>
        ) : null}
        {jobs.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setSelected(item.id)}
            className={`rounded-md border px-3 py-3 text-left ${
              item.id === selected ? "border-copper bg-surface" : "border-line"
            }`}
          >
            <p className={`text-sm ${item.archived ? "text-muted" : "text-fg"}`}>{item.name}</p>
            <p className="text-xs text-muted">{item.phase}</p>
          </button>
        ))}
      </div>
      {job ? <JobDetail job={job} data={data} commit={commit} /> : <p className="text-muted">No jobs yet.</p>}
    </div>
  );
}

function JobDetail({
  job,
  data,
  commit,
}: {
  job: ReadyDesk["projects"][number];
  data: ReadyDesk;
  commit: Commit;
}) {
  const milestones = data.milestones.filter((item) => item.projectId === job.id);
  const sheets = data.sheets.filter((item) => item.projectId === job.id);
  const rfis = data.rfis.filter((item) => item.projectId === job.id);
  const orders = data.changeOrders.filter((item) => item.projectId === job.id);
  const logs = data.logs.filter((item) => item.projectId === job.id);
  const [milestone, setMilestone] = useState("");
  const [due, setDue] = useState("");
  const [rfiTitle, setRfiTitle] = useState("");
  const [question, setQuestion] = useState("");
  const [coTitle, setCoTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [crew, setCrew] = useState("4");
  const [weather, setWeather] = useState("");

  return (
    <div className="grid gap-4">
      <section className="rounded-md border border-line bg-surface p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-3xl">{job.name}</h2>
            <p className="text-sm text-muted">
              {job.clientName} · {job.address}
            </p>
          </div>
          <p className="font-display text-2xl tabular-nums">{money(job.contractValue)}</p>
        </div>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted">{job.summary}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {data.workflows.projectPhases.map((phase) => (
            <button
              key={phase}
              type="button"
              disabled={job.archived}
              onClick={() => void commit(setProjectPhase({ data: { id: job.id, phase } }))}
              className={`h-9 rounded-full px-3 text-sm ${
                job.phase === phase ? "bg-copper text-ink" : "bg-raised text-fg"
              }`}
            >
              {phase}
            </button>
          ))}
        </div>
        {!job.archived && (data.profile.role === "admin" || data.profile.role === "pm") ? (
          <button
            type="button"
            className="mt-3 text-sm text-muted"
            onClick={() => void commit(archiveProject({ data: job.id }))}
          >
            Archive job
          </button>
        ) : null}
      </section>
      <div className="grid gap-4 md:grid-cols-2">
        <Panel title="Milestones">
          <ul className="grid gap-2">
            {milestones.map((item) => (
              <li key={item.id}>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={item.done}
                    onChange={() => void commit(toggleMilestone({ data: item.id }))}
                  />
                  <span className={item.done ? "text-muted line-through" : ""}>{item.name}</span>
                  <span className="ml-auto text-muted tabular-nums">{item.dueOn}</span>
                </label>
              </li>
            ))}
          </ul>
          <form
            className="mt-3 grid gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void commit(createMilestone({ data: { projectId: job.id, name: milestone, dueOn: due } }));
              setMilestone("");
            }}
          >
            <input className="field" placeholder="New milestone" value={milestone} onChange={(e) => setMilestone(e.target.value)} required />
            <input className="field" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
            <Button type="submit" tone="ghost">
              Add milestone
            </Button>
          </form>
        </Panel>
        <Panel title="Sheets">
          <ul className="grid gap-2 text-sm">
            {sheets.map((sheet) => (
              <li key={sheet.id} className="flex justify-between gap-2">
                <span>
                  {sheet.number} {sheet.title}
                </span>
                <span className="text-muted">
                  {sheet.discipline} rev {sheet.revision}
                </span>
              </li>
            ))}
            {sheets.length === 0 ? <li className="text-muted">No sheets logged.</li> : null}
          </ul>
        </Panel>
        <Panel title="RFIs">
          <ul className="grid gap-3">
            {rfis.map((rfi) => (
              <li key={rfi.id} className="text-sm">
                <div className="flex items-center justify-between gap-2">
                  <p>
                    {rfi.number}. {rfi.title}
                  </p>
                  <select
                    className="field h-9 w-auto"
                    value={rfi.status}
                    onChange={(event) =>
                      void commit(setRfiStatus({ data: { id: rfi.id, status: event.target.value } }))
                    }
                  >
                    {data.workflows.rfiStatuses.map((status) => (
                      <option key={status}>{status}</option>
                    ))}
                  </select>
                </div>
                <p className="mt-1 text-muted">{rfi.question}</p>
              </li>
            ))}
          </ul>
          <form
            className="mt-3 grid gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void commit(createRfi({ data: { projectId: job.id, title: rfiTitle, question } }));
              setRfiTitle("");
              setQuestion("");
            }}
          >
            <input className="field" placeholder="RFI title" value={rfiTitle} onChange={(e) => setRfiTitle(e.target.value)} required />
            <textarea className="field" placeholder="Question" value={question} onChange={(e) => setQuestion(e.target.value)} required />
            <Button type="submit" tone="ghost">
              Log RFI
            </Button>
          </form>
        </Panel>
        <Panel title="Change orders">
          <ul className="grid gap-3">
            {orders.map((order) => (
              <li key={order.id} className="flex items-center justify-between gap-2 text-sm">
                <span>
                  CO {order.number} {order.title}
                  <span className="ml-2 tabular-nums text-muted">{money(order.amount)}</span>
                </span>
                <select
                  className="field h-9 w-auto"
                  value={order.status}
                  onChange={(event) =>
                    void commit(setCoStatus({ data: { id: order.id, status: event.target.value } }))
                  }
                >
                  {data.workflows.coStatuses.map((status) => (
                    <option key={status}>{status}</option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
          <form
            className="mt-3 grid gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void commit(
                createChangeOrder({
                  data: { projectId: job.id, title: coTitle, amount: Number(amount) },
                }),
              );
              setCoTitle("");
              setAmount("");
            }}
          >
            <input className="field" placeholder="Change title" value={coTitle} onChange={(e) => setCoTitle(e.target.value)} required />
            <input className="field" inputMode="numeric" placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} required />
            <Button type="submit" tone="ghost">
              Add change order
            </Button>
          </form>
        </Panel>
      </div>
      <Panel title="Daily log">
        <ul className="grid gap-3">
          {logs.map((log) => (
            <li key={log.id} className="text-sm">
              <p className="text-muted">
                {log.logDate} · crew {log.crew} · {log.weather}
              </p>
              <p>{log.notes}</p>
            </li>
          ))}
        </ul>
        <form
          className="mt-3 grid gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void commit(
              createDailyLog({
                data: { projectId: job.id, crew: Number(crew), weather, notes },
              }),
            );
            setNotes("");
          }}
        >
          <div className="grid gap-2 sm:grid-cols-2">
            <input className="field" inputMode="numeric" value={crew} onChange={(e) => setCrew(e.target.value)} />
            <input className="field" placeholder="Weather" value={weather} onChange={(e) => setWeather(e.target.value)} />
          </div>
          <textarea className="field" placeholder="What happened" value={notes} onChange={(e) => setNotes(e.target.value)} required />
          <Button type="submit" tone="ghost">
            File today
          </Button>
        </form>
      </Panel>
    </div>
  );
}

export function FieldView({ data, commit }: { data: ReadyDesk; commit: Commit }) {
  const [active, setActive] = useState(data.workOrders[0]?.id ?? "");
  const order = data.workOrders.find((item) => item.id === active);
  const [customer, setCustomer] = useState("");
  const [site, setSite] = useState("");
  const [title, setTitle] = useState("");
  const [trade, setTrade] = useState(data.workflows.trades[0] ?? "");
  const [priority, setPriority] = useState(data.workflows.priorities.includes("Normal") ? "Normal" : data.workflows.priorities[0]);
  const [projectId, setProjectId] = useState("");
  const [notes, setNotes] = useState("");
  const grouped = useMemo(
    () =>
      data.workflows.workOrderStatuses.map((status) => ({
        status,
        items: data.workOrders.filter((item) => item.status === status),
      })),
    [data.workOrders, data.workflows.workOrderStatuses],
  );

  return (
    <div className="grid gap-4">
      <form
        className="grid gap-2 rounded-md border border-line bg-surface p-4 md:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          void commit(
            createWorkOrder({
              data: { customer, site, title, trade, priority, projectId, notes },
            }),
          );
          setTitle("");
          setNotes("");
        }}
      >
        <input className="field" placeholder="Customer" value={customer} onChange={(e) => setCustomer(e.target.value)} required />
        <input className="field" placeholder="Site" value={site} onChange={(e) => setSite(e.target.value)} required />
        <input className="field md:col-span-2" placeholder="Work order" value={title} onChange={(e) => setTitle(e.target.value)} required />
        <select className="field" value={trade} onChange={(e) => setTrade(e.target.value)}>
          {data.workflows.trades.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
        <select className="field" value={priority} onChange={(e) => setPriority(e.target.value)}>
          {data.workflows.priorities.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
        <select className="field md:col-span-2" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          <option value="">No linked job</option>
          {data.projects
            .filter((project) => !project.archived)
            .map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
        </select>
        <textarea className="field md:col-span-2" placeholder="Notes for the tech" value={notes} onChange={(e) => setNotes(e.target.value)} />
        <Button type="submit" className="md:col-span-2">
          Dispatch
        </Button>
      </form>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {grouped.map((column) => (
          <section key={column.status} className="w-64 shrink-0 rounded-md border border-line bg-bg p-2">
            <h2 className="px-1 text-base">{column.status}</h2>
            <div className="mt-2 grid gap-2">
              {column.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActive(item.id)}
                  className={`rounded-md border p-3 text-left ${
                    item.id === active ? "border-copper bg-surface" : "border-line bg-surface"
                  }`}
                >
                  <p className="text-sm">{item.title}</p>
                  <p className="mt-1 text-xs text-muted">{item.customer}</p>
                  <div className="mt-2">
                    <Chip hot={item.priority === "Emergency"}>{item.priority}</Chip>
                  </div>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
      {order ? (
        <OrderEditor key={order.id} order={order} data={data} commit={commit} />
      ) : (
        <p className="text-sm text-muted">Dispatch a call to fill the board.</p>
      )}
    </div>
  );
}

function OrderEditor({
  order,
  data,
  commit,
}: {
  order: ReadyDesk["workOrders"][number];
  data: ReadyDesk;
  commit: Commit;
}) {
  const [status, setStatus] = useState(order.status);
  const [priority, setPriority] = useState(order.priority);
  const [assignedUserId, setAssignedUserId] = useState(order.assignedUserId);
  const [notes, setNotes] = useState(order.notes);
  const assignee = data.crew.find((person) => person.userId === order.assignedUserId);

  return (
    <form
      className="grid gap-2 rounded-md border border-line bg-surface p-4"
      onSubmit={(event) => {
        event.preventDefault();
        void commit(updateWorkOrder({ data: { id: order.id, status, priority, assignedUserId, notes } }));
      }}
    >
      <h2 className="text-2xl">{order.title}</h2>
      <p className="text-sm text-muted">
        {order.trade} · {order.site}
        {assignee ? ` · ${assignee.name}` : ""}
      </p>
      <div className="grid gap-2 sm:grid-cols-3">
        <select className="field" value={status} onChange={(e) => setStatus(e.target.value)}>
          {data.workflows.workOrderStatuses.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
        <select className="field" value={priority} onChange={(e) => setPriority(e.target.value)}>
          {data.workflows.priorities.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
        <select className="field" value={assignedUserId} onChange={(e) => setAssignedUserId(e.target.value)}>
          <option value="">Unassigned</option>
          {data.crew.map((person) => (
            <option key={person.userId} value={person.userId}>
              {person.name}
            </option>
          ))}
        </select>
      </div>
      <textarea className="field" value={notes} onChange={(e) => setNotes(e.target.value)} />
      <Button type="submit" tone="ghost">
        Update call
      </Button>
    </form>
  );
}

export function CommsView({ data }: { data: ReadyDesk }) {
  return (
    <div className="grid gap-3">
      <p className="max-w-xl text-sm leading-relaxed text-muted">
        Email and texts land here. Staging approvals are private to each admin. Invites stay with the
        person who sent them. Magic sign-in links are single-use.
      </p>
      {data.comms.length === 0 ? (
        <p className="rounded-md border border-line bg-surface p-4 text-sm text-muted">
          Nothing in the radio yet. Ask Foreman to change the product, or invite a crew member.
        </p>
      ) : null}
      {data.comms.map((message) => (
        <article key={message.id} className="rounded-md border border-line bg-surface p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Chip hot={message.channel === "sms"}>{message.channel === "sms" ? "Text" : "Email"}</Chip>
            <span className="text-sm text-muted">{message.toAddress}</span>
            <span className="ml-auto text-xs text-muted tabular-nums">{stamp(message.createdAt)}</span>
          </div>
          <h2 className="mt-2 text-xl">{message.subject}</h2>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-fg">{linkify(message.body)}</p>
        </article>
      ))}
    </div>
  );
}

function linkify(body: string) {
  const parts = body.split(/(\/(?:stage|m)\/[a-f0-9]+)/g);
  return parts.map((part, index) =>
    part.startsWith("/") ? (
      <a key={index} href={part} className="text-copper underline">
        {part}
      </a>
    ) : (
      <span key={index}>{part}</span>
    ),
  );
}

export function ForemanView({ data, commit }: { data: ReadyDesk; commit: Commit }) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = data.proposals.filter((proposal) => proposal.status === "pending");

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_18rem]">
      <section className="flex min-h-[24rem] flex-col rounded-md border border-line bg-surface">
        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {data.thread.length === 0 ? (
            <p className="text-sm leading-relaxed text-muted">
              Ask about River House, or tell Foreman to change the product. “Add phase Punch” stages
              a code edit and texts the admin a staging link.
            </p>
          ) : null}
          {data.thread.map((item) => (
            <div key={item.id} className={item.role === "user" ? "text-right" : "text-left"}>
              <p
                className={`inline-block max-w-[40rem] rounded-md px-3 py-2 text-left text-sm leading-relaxed ${
                  item.role === "user" ? "bg-copper text-ink" : "bg-raised text-fg"
                }`}
              >
                {item.body}
              </p>
            </div>
          ))}
        </div>
        <form
          className="flex gap-2 border-t border-line p-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!message.trim()) return;
            setBusy(true);
            const next = message;
            setMessage("");
            void commit(askForeman({ data: { message: next } })).finally(() => setBusy(false));
          }}
        >
          <input
            className="field"
            placeholder="Message Foreman"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
          <Button type="submit" disabled={busy}>
            {busy ? "…" : "Send"}
          </Button>
        </form>
      </section>
      <aside className="grid content-start gap-3">
        <h2 className="text-xl">Staged code</h2>
        {data.proposals.length === 0 ? <p className="text-sm text-muted">No proposals yet.</p> : null}
        {data.proposals.map((proposal) => (
          <article key={proposal.id} className="rounded-md border border-line p-3">
            <div className="flex items-center justify-between gap-2">
              <Chip hot={proposal.status === "pending"}>{proposal.status}</Chip>
              <span className="text-xs text-muted">{proposal.filePath.split("/").pop()}</span>
            </div>
            <p className="mt-2 text-sm">{proposal.title}</p>
            <a href={proposal.stagingPath} className="mt-2 inline-flex text-sm text-copper">
              Open staging
            </a>
            {data.profile.role === "admin" && proposal.status === "pending" ? (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Button
                  className="px-2"
                  onClick={() => void commit(decideProposal({ data: { id: proposal.id, status: "approved" } }))}
                >
                  Approve
                </Button>
                <Button
                  tone="ghost"
                  className="px-2"
                  onClick={() => void commit(decideProposal({ data: { id: proposal.id, status: "rejected" } }))}
                >
                  Reject
                </Button>
              </div>
            ) : null}
          </article>
        ))}
        {pending.length > 0 && data.profile.role !== "admin" ? (
          <p className="text-xs text-muted">Admins approve from the link in their text or email.</p>
        ) : null}
      </aside>
    </div>
  );
}

export function CrewView({ data, commit }: { data: ReadyDesk; commit: Commit }) {
  const [channel, setChannel] = useState<"email" | "sms">("sms");
  const [destination, setDestination] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("field");
  const [sent, setSent] = useState("");
  const [error, setError] = useState("");

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Panel title="People">
        <ul className="grid gap-3">
          {data.crew.map((person) => (
            <li key={person.userId} className="flex items-center justify-between gap-2 text-sm">
              <div>
                <p>{person.name}</p>
                <p className="text-muted">{person.phone || person.email || "No direct line"}</p>
              </div>
              <Chip>{person.role}</Chip>
            </li>
          ))}
        </ul>
      </Panel>
      <Panel title="Invite">
        {data.profile.role !== "admin" ? (
          <p className="text-sm text-muted">Only an admin can send email or text invites.</p>
        ) : (
          <form
            className="grid gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void inviteCrew({ data: { channel, destination, name, role } })
                .then((result) => {
                  setError("");
                  setSent(result.previewPath);
                  setDestination("");
                  setName("");
                  return commit(loadDesk());
                })
                .catch((cause: unknown) => {
                  setError(cause instanceof Error ? cause.message : "Could not send the invite.");
                });
            }}
          >
            <div className="grid grid-cols-2 gap-2">
              {(["sms", "email"] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setChannel(item)}
                  className={`h-11 rounded-md border text-sm ${
                    channel === item ? "border-copper bg-copper text-ink" : "border-line"
                  }`}
                >
                  {item === "sms" ? "Text" : "Email"}
                </button>
              ))}
            </div>
            <input className="field" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} required />
            <input
              className="field"
              placeholder={channel === "sms" ? "Mobile number" : "Email"}
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              required
            />
            <select className="field" value={role} onChange={(e) => setRole(e.target.value)}>
              {["field", "superintendent", "pm", "office", "admin"].map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
            <Button type="submit">Send invite</Button>
            {error ? <p className="text-sm text-danger">{error}</p> : null}
            {sent ? (
              <p className="text-sm text-muted">
                Queued. Hand them this single-use link if you are standing next to them:{" "}
                <a className="text-copper underline" href={sent}>
                  {sent}
                </a>
              </p>
            ) : null}
          </form>
        )}
      </Panel>
    </div>
  );
}
