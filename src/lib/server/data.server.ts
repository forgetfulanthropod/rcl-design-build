import { randomBytes, randomUUID } from "node:crypto";
import { getSql, type Sql } from "@/lib/db";
import {
  COPY_PATH,
  COPY_SOURCE,
  WORKFLOW_PATH,
  WORKFLOW_SOURCE,
  defaultCopy,
  defaultWorkflows,
  parseCopy,
  parseWorkflows,
  renderCopy,
  renderWorkflows,
  validateSource,
  type CopyConfig,
  type WorkflowConfig,
} from "@/lib/product";
import {
  applyDecision,
  insertMagicLink,
  isSyntheticEmail,
  normalizeEmail,
  normalizePhone,
  phoneToEmail,
} from "@/lib/server/magic.server";

const ROLES = ["admin", "pm", "superintendent", "field", "office"] as const;
type Role = (typeof ROLES)[number];

function text(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (value == null) return "";
  return String(value);
}

function num(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function bool(value: unknown): boolean {
  return value === true || value === "t" || value === "true" || value === 1;
}

type Profile = {
  userId: string;
  companyId: string;
  name: string;
  email: string;
  phone: string;
  role: Role;
};

async function requireProfile(userId: string): Promise<{ sql: Sql; profile: Profile }> {
  const sql = await getSql();
  const rows = await sql<{
    user_id: string;
    company_id: string;
    name: string;
    email: string | null;
    phone: string | null;
    role: string;
  }>`
    select user_id, company_id, name, email, phone, role
    from profiles where user_id = ${userId}
  `;
  const row = rows[0];
  if (!row || !ROLES.includes(row.role as Role)) {
    throw new Error("Finish company setup first.");
  }
  return {
    sql,
    profile: {
      userId: text(row.user_id),
      companyId: text(row.company_id),
      name: text(row.name),
      email: text(row.email),
      phone: text(row.phone),
      role: row.role as Role,
    },
  };
}

async function loadConfig(sql: Sql, companyId: string) {
  const files = await sql<{ path: string; content: string }>`
    select path, content from source_files where company_id = ${companyId}
  `;
  let copySource = COPY_SOURCE;
  let workflowSource = WORKFLOW_SOURCE;
  let copy: CopyConfig = defaultCopy();
  let workflows: WorkflowConfig = defaultWorkflows();
  for (const file of files) {
    if (file.path === COPY_PATH) {
      copySource = text(file.content);
      try {
        copy = parseCopy(copySource);
      } catch {
        copy = defaultCopy();
      }
    }
    if (file.path === WORKFLOW_PATH) {
      workflowSource = text(file.content);
      try {
        workflows = parseWorkflows(workflowSource);
      } catch {
        workflows = defaultWorkflows();
      }
    }
  }
  return { copy, workflows, copySource, workflowSource };
}

async function seedSample(sql: Sql, companyId: string, userId: string) {
  const projectId = randomUUID();
  await sql`
    insert into projects (
      id, company_id, name, client_name, address, phase, contract_value, summary
    ) values (
      ${projectId},
      ${companyId},
      ${"River House"},
      ${"Holloway Family"},
      ${"140 River Road"},
      ${"Build"},
      ${486000},
      ${"Design-build residence. Exposed structure, tight site, owner-occupied punch still ahead."}
    )
  `;
  const milestones = [
    ["Permit set approved", "2026-04-02", true],
    ["Dried in", "2026-07-18", true],
    ["Substantial completion", "2026-11-06", false],
  ] as const;
  for (const [name, due, done] of milestones) {
    await sql`
      insert into milestones (id, company_id, project_id, name, due_on, done)
      values (${randomUUID()}, ${companyId}, ${projectId}, ${name}, ${due}, ${done})
    `;
  }
  await sql`
    insert into sheets (id, company_id, project_id, number, title, revision, discipline)
    values
      (${randomUUID()}, ${companyId}, ${projectId}, ${"A2.1"}, ${"Main floor plan"}, ${"C"}, ${"Architectural"}),
      (${randomUUID()}, ${companyId}, ${projectId}, ${"E1.0"}, ${"Power and lighting"}, ${"B"}, ${"Electrical"})
  `;
  await sql`
    insert into rfis (id, company_id, project_id, number, title, question, status, created_by)
    values (
      ${randomUUID()}, ${companyId}, ${projectId}, ${1},
      ${"Footing depth at the river edge"},
      ${"Soils report calls for 42 inches. The bank is higher than the survey. Confirm the inspector will accept 36 inches with the extra stone."},
      ${"Open"}, ${userId}
    )
  `;
  await sql`
    insert into change_orders (
      id, company_id, project_id, number, title, amount, status, created_by
    ) values (
      ${randomUUID()}, ${companyId}, ${projectId}, ${1},
      ${"Cedar soffit in place of vented vinyl"},
      ${8400}, ${"Submitted"}, ${userId}
    )
  `;
  const today = new Date().toISOString().slice(0, 10);
  await sql`
    insert into daily_logs (
      id, company_id, project_id, log_date, crew, weather, notes, created_by
    ) values (
      ${randomUUID()}, ${companyId}, ${projectId}, ${today}, ${6},
      ${"Clear, light wind"},
      ${"Framing crew on the east wall. Electrician rough-in started in the kitchen. No injuries."},
      ${userId}
    )
  `;
  await sql`
    insert into work_orders (
      id, company_id, project_id, customer, site, title, trade, priority, status, notes, created_by
    ) values (
      ${randomUUID()}, ${companyId}, ${projectId},
      ${"Holloway Family"}, ${"140 River Road"},
      ${"Replace heat-damaged range circuit"},
      ${"Electrical"}, ${"Emergency"}, ${"En route"},
      ${"Owner smelled heat at the range last night. Kill the breaker before opening the box."},
      ${userId}
    )
  `;
  await sql`
    insert into work_orders (
      id, company_id, project_id, customer, site, title, trade, priority, status, notes, created_by
    ) values (
      ${randomUUID()}, ${companyId}, ${null},
      ${"Lane Annex"}, ${"88 Mill Street"},
      ${"Fall filter service"},
      ${"HVAC"}, ${"Normal"}, ${"Scheduled"},
      ${"Two systems. Bring 20x25x1 and a spare capacitor."},
      ${userId}
    )
  `;
}

export async function loadDeskData(userId: string) {
  const sql = await getSql();
  const users = await sql<{ email: string; name: string }>`
    select "email", "name" from "user" where "id" = ${userId}
  `;
  const accountEmail = text(users[0]?.email);
  const rows = await sql<{
    user_id: string;
    company_id: string;
    name: string;
    email: string | null;
    phone: string | null;
    role: string;
  }>`
    select user_id, company_id, name, email, phone, role
    from profiles where user_id = ${userId}
  `;
  if (!rows[0]) {
    return {
      needsSetup: true as const,
      email: isSyntheticEmail(accountEmail) ? "" : accountEmail,
      suggestedName: text(users[0]?.name),
    };
  }
  const profile: Profile = {
    userId,
    companyId: text(rows[0].company_id),
    name: text(rows[0].name),
    email: text(rows[0].email),
    phone: text(rows[0].phone),
    role: (ROLES.includes(rows[0].role as Role) ? rows[0].role : "field") as Role,
  };
  const companyId = profile.companyId;
  const companies = await sql<{ name: string }>`select name from companies where id = ${companyId}`;
  const { copy, workflows } = await loadConfig(sql, companyId);

  const projects = await sql<{
    id: string;
    name: string;
    client_name: string;
    address: string;
    phase: string;
    contract_value: number;
    summary: string;
    archived: boolean;
    created_at: string;
  }>`
    select id, name, client_name, address, phase, contract_value, summary, archived, created_at::text as created_at
    from projects where company_id = ${companyId}
    order by archived asc, created_at desc
  `;
  const milestones = await sql<{
    id: string;
    project_id: string;
    name: string;
    due_on: string | null;
    done: boolean;
  }>`
    select id, project_id, name, due_on::text as due_on, done
    from milestones where company_id = ${companyId}
    order by due_on asc
  `;
  const sheets = await sql<{
    id: string;
    project_id: string;
    number: string;
    title: string;
    revision: string;
    discipline: string;
  }>`
    select id, project_id, number, title, revision, discipline
    from sheets where company_id = ${companyId}
    order by number asc
  `;
  const rfis = await sql<{
    id: string;
    project_id: string;
    number: number;
    title: string;
    question: string;
    status: string;
    created_at: string;
  }>`
    select id, project_id, number, title, question, status, created_at::text as created_at
    from rfis where company_id = ${companyId}
    order by number desc
  `;
  const changeOrders = await sql<{
    id: string;
    project_id: string;
    number: number;
    title: string;
    amount: number;
    status: string;
    created_at: string;
  }>`
    select id, project_id, number, title, amount, status, created_at::text as created_at
    from change_orders where company_id = ${companyId}
    order by number desc
  `;
  const logs = await sql<{
    id: string;
    project_id: string;
    log_date: string;
    crew: number;
    weather: string;
    notes: string;
  }>`
    select id, project_id, log_date::text as log_date, crew, weather, notes
    from daily_logs where company_id = ${companyId}
    order by log_date desc, created_at desc
  `;
  const workOrders = await sql<{
    id: string;
    project_id: string | null;
    customer: string;
    site: string;
    title: string;
    trade: string;
    priority: string;
    status: string;
    assigned_user_id: string | null;
    notes: string;
    created_at: string;
  }>`
    select id, project_id, customer, site, title, trade, priority, status,
           assigned_user_id, notes, created_at::text as created_at
    from work_orders where company_id = ${companyId}
    order by created_at desc
  `;
  const crew = await sql<{
    user_id: string;
    name: string;
    email: string | null;
    phone: string | null;
    role: string;
  }>`
    select user_id, name, email, phone, role
    from profiles where company_id = ${companyId}
    order by name asc
  `;
  const comms = await sql<{
    id: string;
    channel: string;
    to_address: string;
    subject: string;
    body: string;
    link_path: string | null;
    kind: string;
    created_at: string;
    sender_user_id: string | null;
    recipient_user_id: string | null;
  }>`
    select id, channel, to_address, subject, body, link_path, kind,
           created_at::text as created_at, sender_user_id, recipient_user_id
    from outbound_messages
    where company_id = ${companyId}
      and (recipient_user_id = ${userId} or sender_user_id = ${userId})
    order by created_at desc
    limit 40
  `;
  const thread = await sql<{
    id: string;
    role: string;
    body: string;
    proposal_id: string | null;
    created_at: string;
  }>`
    select id, role, body, proposal_id, created_at::text as created_at
    from foreman_messages
    where company_id = ${companyId} and user_id = ${userId}
    order by created_at asc
    limit 80
  `;
  const proposals = await sql<{
    id: string;
    title: string;
    summary: string;
    file_path: string;
    status: string;
    staging_token: string;
    author_user_id: string;
    created_at: string;
  }>`
    select id, title, summary, file_path, status, staging_token, author_user_id,
           created_at::text as created_at
    from code_proposals
    where company_id = ${companyId}
    order by created_at desc
    limit 30
  `;

  return {
    needsSetup: false as const,
    profile,
    companyName: text(companies[0]?.name) || copy.productName,
    copy,
    workflows,
    projects: projects.map((p) => ({
      id: text(p.id),
      name: text(p.name),
      clientName: text(p.client_name),
      address: text(p.address),
      phase: text(p.phase),
      contractValue: num(p.contract_value),
      summary: text(p.summary),
      archived: bool(p.archived),
      createdAt: text(p.created_at),
    })),
    milestones: milestones.map((m) => ({
      id: text(m.id),
      projectId: text(m.project_id),
      name: text(m.name),
      dueOn: text(m.due_on).slice(0, 10),
      done: bool(m.done),
    })),
    sheets: sheets.map((s) => ({
      id: text(s.id),
      projectId: text(s.project_id),
      number: text(s.number),
      title: text(s.title),
      revision: text(s.revision),
      discipline: text(s.discipline),
    })),
    rfis: rfis.map((r) => ({
      id: text(r.id),
      projectId: text(r.project_id),
      number: num(r.number),
      title: text(r.title),
      question: text(r.question),
      status: text(r.status),
      createdAt: text(r.created_at),
    })),
    changeOrders: changeOrders.map((c) => ({
      id: text(c.id),
      projectId: text(c.project_id),
      number: num(c.number),
      title: text(c.title),
      amount: num(c.amount),
      status: text(c.status),
      createdAt: text(c.created_at),
    })),
    logs: logs.map((l) => ({
      id: text(l.id),
      projectId: text(l.project_id),
      logDate: text(l.log_date).slice(0, 10),
      crew: num(l.crew),
      weather: text(l.weather),
      notes: text(l.notes),
    })),
    workOrders: workOrders.map((w) => ({
      id: text(w.id),
      projectId: text(w.project_id),
      customer: text(w.customer),
      site: text(w.site),
      title: text(w.title),
      trade: text(w.trade),
      priority: text(w.priority),
      status: text(w.status),
      assignedUserId: text(w.assigned_user_id),
      notes: text(w.notes),
      createdAt: text(w.created_at),
    })),
    crew: crew.map((c) => ({
      userId: text(c.user_id),
      name: text(c.name),
      email: text(c.email),
      phone: text(c.phone),
      role: text(c.role),
    })),
    comms: comms.map((m) => ({
      id: text(m.id),
      channel: text(m.channel),
      toAddress: text(m.to_address),
      subject: text(m.subject),
      body: text(m.body),
      linkPath: text(m.link_path),
      kind: text(m.kind),
      createdAt: text(m.created_at),
    })),
    thread: thread.map((m) => ({
      id: text(m.id),
      role: text(m.role),
      body: text(m.body),
      proposalId: text(m.proposal_id),
      createdAt: text(m.created_at),
    })),
    proposals: proposals.map((p) => ({
      id: text(p.id),
      title: text(p.title),
      summary: text(p.summary),
      filePath: text(p.file_path),
      status: text(p.status),
      stagingPath: `/stage/${text(p.staging_token)}`,
      authorUserId: text(p.author_user_id),
      createdAt: text(p.created_at),
    })),
  };
}

export async function completeSetup(
  userId: string,
  input: { name: string; companyName: string; phone: string },
) {
  const sql = await getSql();
  const existing = await sql<{ user_id: string }>`
    select user_id from profiles where user_id = ${userId}
  `;
  if (existing[0]) return loadDeskData(userId);
  const name = input.name.trim();
  const companyName = input.companyName.trim();
  if (name.length < 2 || name.length > 80) throw new Error("Enter your name.");
  if (companyName.length < 2 || companyName.length > 80) throw new Error("Enter the company name.");
  const phone = input.phone.trim() ? normalizePhone(input.phone) : null;
  if (input.phone.trim() && !phone) throw new Error("Enter a mobile number with area code, or leave it blank.");
  const users = await sql<{ email: string }>`select "email" from "user" where "id" = ${userId}`;
  const accountEmail = text(users[0]?.email);
  const companyId = randomUUID();
  await sql`insert into companies (id, name) values (${companyId}, ${companyName})`;
  await sql`
    insert into profiles (user_id, company_id, name, email, phone, role)
    values (
      ${userId},
      ${companyId},
      ${name},
      ${isSyntheticEmail(accountEmail) ? null : accountEmail},
      ${phone},
      ${"admin"}
    )
  `;
  await sql`
    insert into source_files (company_id, path, content) values
      (${companyId}, ${COPY_PATH}, ${COPY_SOURCE}),
      (${companyId}, ${WORKFLOW_PATH}, ${WORKFLOW_SOURCE})
  `;
  await sql`update "user" set "name" = ${name}, "updatedAt" = now() where "id" = ${userId}`;
  await seedSample(sql, companyId, userId);
  return loadDeskData(userId);
}

async function ownsProject(sql: Sql, companyId: string, projectId: string) {
  const rows = await sql<{ id: string }>`
    select id from projects where id = ${projectId} and company_id = ${companyId} and archived = false
  `;
  if (!rows[0]) throw new Error("That job is not on this desk.");
}

export async function createProject(
  userId: string,
  input: {
    name: string;
    clientName: string;
    address: string;
    phase: string;
    contractValue: number;
    summary: string;
  },
) {
  const { sql, profile } = await requireProfile(userId);
  const { workflows } = await loadConfig(sql, profile.companyId);
  if (!workflows.projectPhases.includes(input.phase)) throw new Error("Pick a phase from the list.");
  await sql`
    insert into projects (
      id, company_id, name, client_name, address, phase, contract_value, summary
    ) values (
      ${randomUUID()},
      ${profile.companyId},
      ${input.name},
      ${input.clientName},
      ${input.address},
      ${input.phase},
      ${Math.round(input.contractValue)},
      ${input.summary}
    )
  `;
  return loadDeskData(userId);
}

export async function setProjectPhase(userId: string, input: { id: string; phase: string }) {
  const { sql, profile } = await requireProfile(userId);
  const { workflows } = await loadConfig(sql, profile.companyId);
  if (!workflows.projectPhases.includes(input.phase)) throw new Error("Unknown phase.");
  await sql`
    update projects set phase = ${input.phase}
    where id = ${input.id} and company_id = ${profile.companyId}
  `;
  return loadDeskData(userId);
}

export async function archiveProject(userId: string, id: string) {
  const { sql, profile } = await requireProfile(userId);
  if (profile.role !== "admin" && profile.role !== "pm") throw new Error("Only an admin or PM can archive a job.");
  await sql`
    update projects set archived = true
    where id = ${id} and company_id = ${profile.companyId}
  `;
  return loadDeskData(userId);
}

export async function createMilestone(
  userId: string,
  input: { projectId: string; name: string; dueOn: string },
) {
  const { sql, profile } = await requireProfile(userId);
  await ownsProject(sql, profile.companyId, input.projectId);
  const due = /^\d{4}-\d{2}-\d{2}$/.test(input.dueOn) ? input.dueOn : null;
  await sql`
    insert into milestones (id, company_id, project_id, name, due_on, done)
    values (${randomUUID()}, ${profile.companyId}, ${input.projectId}, ${input.name}, ${due}, false)
  `;
  return loadDeskData(userId);
}

export async function toggleMilestone(userId: string, id: string) {
  const { sql, profile } = await requireProfile(userId);
  await sql`
    update milestones set done = not done
    where id = ${id} and company_id = ${profile.companyId}
  `;
  return loadDeskData(userId);
}

export async function createRfi(
  userId: string,
  input: { projectId: string; title: string; question: string },
) {
  const { sql, profile } = await requireProfile(userId);
  await ownsProject(sql, profile.companyId, input.projectId);
  const { workflows } = await loadConfig(sql, profile.companyId);
  const max = await sql<{ n: number }>`
    select coalesce(max(number), 0) as n from rfis where project_id = ${input.projectId}
  `;
  await sql`
    insert into rfis (id, company_id, project_id, number, title, question, status, created_by)
    values (
      ${randomUUID()}, ${profile.companyId}, ${input.projectId}, ${num(max[0]?.n) + 1},
      ${input.title}, ${input.question}, ${workflows.rfiStatuses[0] ?? "Open"}, ${userId}
    )
  `;
  return loadDeskData(userId);
}

export async function setRfiStatus(userId: string, input: { id: string; status: string }) {
  const { sql, profile } = await requireProfile(userId);
  const { workflows } = await loadConfig(sql, profile.companyId);
  if (!workflows.rfiStatuses.includes(input.status)) throw new Error("Unknown RFI status.");
  await sql`
    update rfis set status = ${input.status}
    where id = ${input.id} and company_id = ${profile.companyId}
  `;
  return loadDeskData(userId);
}

export async function createChangeOrder(
  userId: string,
  input: { projectId: string; title: string; amount: number },
) {
  const { sql, profile } = await requireProfile(userId);
  await ownsProject(sql, profile.companyId, input.projectId);
  const { workflows } = await loadConfig(sql, profile.companyId);
  const max = await sql<{ n: number }>`
    select coalesce(max(number), 0) as n from change_orders where project_id = ${input.projectId}
  `;
  await sql`
    insert into change_orders (
      id, company_id, project_id, number, title, amount, status, created_by
    ) values (
      ${randomUUID()}, ${profile.companyId}, ${input.projectId}, ${num(max[0]?.n) + 1},
      ${input.title}, ${Math.round(input.amount)}, ${workflows.coStatuses[0] ?? "Draft"}, ${userId}
    )
  `;
  return loadDeskData(userId);
}

export async function setCoStatus(userId: string, input: { id: string; status: string }) {
  const { sql, profile } = await requireProfile(userId);
  const { workflows } = await loadConfig(sql, profile.companyId);
  if (!workflows.coStatuses.includes(input.status)) throw new Error("Unknown change-order status.");
  await sql`
    update change_orders set status = ${input.status}
    where id = ${input.id} and company_id = ${profile.companyId}
  `;
  return loadDeskData(userId);
}

export async function createDailyLog(
  userId: string,
  input: { projectId: string; crew: number; weather: string; notes: string },
) {
  const { sql, profile } = await requireProfile(userId);
  await ownsProject(sql, profile.companyId, input.projectId);
  const today = new Date().toISOString().slice(0, 10);
  await sql`
    insert into daily_logs (
      id, company_id, project_id, log_date, crew, weather, notes, created_by
    ) values (
      ${randomUUID()}, ${profile.companyId}, ${input.projectId}, ${today},
      ${Math.max(0, Math.round(input.crew))}, ${input.weather}, ${input.notes}, ${userId}
    )
  `;
  return loadDeskData(userId);
}

export async function createWorkOrder(
  userId: string,
  input: {
    customer: string;
    site: string;
    title: string;
    trade: string;
    priority: string;
    projectId: string;
    notes: string;
  },
) {
  const { sql, profile } = await requireProfile(userId);
  const { workflows } = await loadConfig(sql, profile.companyId);
  if (!workflows.trades.includes(input.trade)) throw new Error("Pick a trade.");
  if (!workflows.priorities.includes(input.priority)) throw new Error("Pick a priority.");
  const projectId = input.projectId || null;
  if (projectId) await ownsProject(sql, profile.companyId, projectId);
  await sql`
    insert into work_orders (
      id, company_id, project_id, customer, site, title, trade, priority, status, notes, created_by
    ) values (
      ${randomUUID()}, ${profile.companyId}, ${projectId},
      ${input.customer}, ${input.site}, ${input.title}, ${input.trade}, ${input.priority},
      ${workflows.workOrderStatuses[0] ?? "New"}, ${input.notes}, ${userId}
    )
  `;
  return loadDeskData(userId);
}

export async function updateWorkOrder(
  userId: string,
  input: { id: string; status: string; priority: string; assignedUserId: string; notes: string },
) {
  const { sql, profile } = await requireProfile(userId);
  const { workflows } = await loadConfig(sql, profile.companyId);
  if (!workflows.workOrderStatuses.includes(input.status)) throw new Error("Unknown status.");
  if (!workflows.priorities.includes(input.priority)) throw new Error("Unknown priority.");
  let assignee: string | null = input.assignedUserId || null;
  if (assignee) {
    const member = await sql<{ user_id: string }>`
      select user_id from profiles where user_id = ${assignee} and company_id = ${profile.companyId}
    `;
    if (!member[0]) assignee = null;
  }
  await sql`
    update work_orders
    set status = ${input.status}, priority = ${input.priority},
        assigned_user_id = ${assignee}, notes = ${input.notes}
    where id = ${input.id} and company_id = ${profile.companyId}
  `;
  return loadDeskData(userId);
}

export async function inviteCrew(
  userId: string,
  input: { channel: "email" | "sms"; destination: string; name: string; role: string },
) {
  const { sql, profile } = await requireProfile(userId);
  if (profile.role !== "admin") throw new Error("Only an admin can invite the crew.");
  if (!ROLES.includes(input.role as Role)) throw new Error("Pick a role.");
  const name = input.name.trim();
  if (name.length < 2) throw new Error("Enter their name.");
  let email: string;
  let destination: string;
  if (input.channel === "email") {
    const parsed = normalizeEmail(input.destination);
    if (!parsed) throw new Error("Enter a valid email.");
    email = parsed;
    destination = parsed;
  } else {
    const phone = normalizePhone(input.destination);
    if (!phone) throw new Error("Enter a mobile number with area code.");
    email = phoneToEmail(phone);
    destination = phone;
  }
  const previewPath = await insertMagicLink({
    channel: input.channel,
    destination,
    email,
    displayName: name,
    companyId: profile.companyId,
    role: input.role,
    action: null,
    proposalId: null,
    redirectPath: "/",
    minutes: 60 * 24 * 7,
  });
  const subject = `You're on the ${profile.name ? "RCL" : "RCL"} crew`;
  const body = `${name}, ${profile.name} invited you to RCL Design-Build as ${input.role}. Open this single-use link to sign in: ${previewPath}`;
  await sql`
    insert into outbound_messages (
      id, company_id, sender_user_id, recipient_user_id, channel, to_address, subject, body, link_path, kind
    ) values (
      ${randomUUID()}, ${profile.companyId}, ${userId}, ${null}, ${input.channel},
      ${destination}, ${`Crew invite for ${name}`}, ${body}, ${previewPath}, ${"invite"}
    )
  `;
  return { previewPath, subject };
}

function clip(value: string, max: number): string {
  const trimmed = value.trim();
  if (trimmed.length > max) return trimmed.slice(0, max);
  return trimmed;
}

function heuristicProposal(
  message: string,
  copySource: string,
  workflowSource: string,
): { reply: string; proposal: { title: string; summary: string; file: string; content: string } | null } {
  const tagline = message.match(/tagline\s+(?:to\s+)?["“']?([^"”'\n]+)["”']?/i);
  if (tagline?.[1]) {
    const next = clip(tagline[1], 140).replace(/"/g, "");
    const copy = parseCopy(copySource);
    copy.tagline = next;
    return {
      reply: `I staged a copy change so the desk tagline reads “${next}”. An admin has to approve it from the staging link before it goes live. I sent that link by text and email.`,
      proposal: {
        title: "Update desk tagline",
        summary: `Set tagline to “${next}”.`,
        file: COPY_PATH,
        content: renderCopy(copy),
      },
    };
  }
  const phase = message.match(/add (?:a )?(?:project )?phase\s+(?:called\s+)?["“']?([^"”'\n.]+)/i);
  if (phase?.[1]) {
    const name = clip(phase[1], 40).replace(/"/g, "");
    const workflows = parseWorkflows(workflowSource);
    if (!workflows.projectPhases.includes(name)) workflows.projectPhases.push(name);
    return {
      reply: `I staged workflows.ts to add the “${name}” phase. It stays off the live desk until an admin opens the staging link and approves it. I texted and emailed them.`,
      proposal: {
        title: `Add phase ${name}`,
        summary: `Append “${name}” to project phases.`,
        file: WORKFLOW_PATH,
        content: renderWorkflows(workflows),
      },
    };
  }
  const status = message.match(/add (?:a )?(?:work order |field )?status\s+(?:called\s+)?["“']?([^"”'\n.]+)/i);
  if (status?.[1]) {
    const name = clip(status[1], 40).replace(/"/g, "");
    const workflows = parseWorkflows(workflowSource);
    if (!workflows.workOrderStatuses.includes(name)) workflows.workOrderStatuses.push(name);
    return {
      reply: `I staged a new field status, “${name}”. Admins got a staging link by text and email. Nothing changes on the board until one of them approves it.`,
      proposal: {
        title: `Add field status ${name}`,
        summary: `Append “${name}” to work order statuses.`,
        file: WORKFLOW_PATH,
        content: renderWorkflows(workflows),
      },
    };
  }
  const trade = message.match(/add (?:a )?trade\s+(?:called\s+)?["“']?([^"”'\n.]+)/i);
  if (trade?.[1]) {
    const name = clip(trade[1], 40).replace(/"/g, "");
    const workflows = parseWorkflows(workflowSource);
    if (!workflows.trades.includes(name)) workflows.trades.push(name);
    return {
      reply: `I staged “${name}” as a trade. Check the staging build, then an admin approves it. I already sent the link.`,
      proposal: {
        title: `Add trade ${name}`,
        summary: `Append “${name}” to trades.`,
        file: WORKFLOW_PATH,
        content: renderWorkflows(workflows),
      },
    };
  }
  return {
    reply:
      "Ask me about a job, or tell me to change the product. Try “add phase Punch” or “set the tagline to Built once, serviced forever.” I will stage the code and text the admin a link.",
    proposal: null,
  };
}

async function askModel(
  system: string,
  history: { role: "user" | "assistant"; content: string }[],
  message: string,
): Promise<string | null> {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) return null;
  const res = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "grok-4.5",
      temperature: 0.2,
      max_tokens: 1400,
      messages: [{ role: "system", content: system }, ...history, { role: "user", content: message }],
    }),
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return body.choices?.[0]?.message?.content ?? null;
}

function parseModelPayload(raw: string): {
  reply: string;
  proposal: { title: string; summary: string; file: string; content: string } | null;
} | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const value = JSON.parse(raw.slice(start, end + 1)) as {
      reply?: unknown;
      proposal?: unknown;
    };
    if (typeof value.reply !== "string" || !value.reply.trim()) return null;
    if (value.proposal == null) return { reply: value.reply.trim(), proposal: null };
    if (!value.proposal || typeof value.proposal !== "object") return null;
    const proposal = value.proposal as Record<string, unknown>;
    if (
      typeof proposal.title !== "string" ||
      typeof proposal.summary !== "string" ||
      typeof proposal.file !== "string" ||
      typeof proposal.content !== "string"
    ) {
      return { reply: value.reply.trim(), proposal: null };
    }
    return {
      reply: value.reply.trim(),
      proposal: {
        title: proposal.title,
        summary: proposal.summary,
        file: proposal.file,
        content: proposal.content,
      },
    };
  } catch {
    return null;
  }
}

async function notifyAdmins(
  sql: Sql,
  companyId: string,
  proposalId: string,
  stagingToken: string,
  title: string,
  summary: string,
) {
  const admins = await sql<{ user_id: string; name: string; phone: string | null }>`
    select user_id, name, phone from profiles
    where company_id = ${companyId} and role = 'admin'
  `;
  const stagingPath = `/stage/${stagingToken}`;
  for (const admin of admins) {
    const account = await sql<{ email: string }>`
      select "email" from "user" where "id" = ${text(admin.user_id)}
    `;
    const loginEmail = text(account[0]?.email);
    if (!loginEmail) continue;
    const phone = text(admin.phone);
    const approve = await insertMagicLink({
      channel: phone ? "sms" : "email",
      destination: phone || loginEmail,
      email: loginEmail,
      displayName: text(admin.name) || null,
      companyId,
      role: null,
      action: "approve",
      proposalId,
      redirectPath: stagingPath,
      minutes: 60 * 24 * 3,
    });
    const reject = await insertMagicLink({
      channel: phone ? "sms" : "email",
      destination: phone || loginEmail,
      email: loginEmail,
      displayName: text(admin.name) || null,
      companyId,
      role: null,
      action: "reject",
      proposalId,
      redirectPath: stagingPath,
      minutes: 60 * 24 * 3,
    });
    const body = [
      `Foreman drafted a product change: ${title}.`,
      summary,
      ``,
      `Staging build: ${stagingPath}`,
      `Approve (signs you in): ${approve}`,
      `Reject (signs you in): ${reject}`,
    ].join("\n");
    const channels: { channel: "email" | "sms"; to: string }[] = [];
    if (loginEmail && !isSyntheticEmail(loginEmail)) channels.push({ channel: "email", to: loginEmail });
    if (phone) channels.push({ channel: "sms", to: phone });
    if (channels.length === 0) channels.push({ channel: "email", to: loginEmail });
    for (const item of channels) {
      await sql`
        insert into outbound_messages (
          id, company_id, sender_user_id, recipient_user_id, channel, to_address,
          subject, body, link_path, kind
        ) values (
          ${randomUUID()}, ${companyId}, ${null}, ${text(admin.user_id)}, ${item.channel},
          ${item.to}, ${`Approve staging: ${title}`}, ${body}, ${stagingPath}, ${"staging"}
        )
      `;
    }
  }
}

export async function askForeman(userId: string, message: string) {
  const { sql, profile } = await requireProfile(userId);
  const { copySource, workflowSource } = await loadConfig(sql, profile.companyId);
  const prior = await sql<{ role: string; body: string }>`
    select role, body from foreman_messages
    where company_id = ${profile.companyId} and user_id = ${userId}
    order by created_at desc
    limit 8
  `;
  const history = prior
    .reverse()
    .filter((row) => row.role === "user" || row.role === "assistant")
    .map((row) => ({
      role: row.role as "user" | "assistant",
      content: text(row.body).slice(0, 1200),
    }));

  await sql`
    insert into foreman_messages (id, company_id, user_id, role, body)
    values (${randomUUID()}, ${profile.companyId}, ${userId}, ${"user"}, ${message})
  `;

  const system = [
    "You are Foreman, the assistant inside RCL Design-Build, a construction and field-service desk.",
    "Help with jobs, RFIs, change orders, daily logs, and dispatch in plain language.",
    "If the user wants the product itself changed (labels, tagline, phases, statuses, trades, priorities), propose a full replacement of exactly one allowlisted file.",
    "Allowlist: src/product/copy.ts (export const copy) and src/product/workflows.ts (export const workflows).",
    "The object must be JSON-compatible: double-quoted keys and strings. Keep every existing key.",
    "Respond with JSON only, no markdown fences:",
    '{"reply":"short plain text","proposal":null}',
    "or",
    '{"reply":"...","proposal":{"title":"...","summary":"...","file":"src/product/copy.ts","content":"full file"}}',
    "For ordinary questions, proposal must be null. Never invent financial records.",
    "Current copy.ts:",
    copySource,
    "Current workflows.ts:",
    workflowSource,
  ].join("\n");

  const modelRaw = await askModel(system, history, message);
  const parsed = modelRaw ? parseModelPayload(modelRaw) : null;
  const drafted = parsed ?? heuristicProposal(message, copySource, workflowSource);
  let reply = clip(drafted.reply, 1200);
  let proposalId = "";
  if (drafted.proposal) {
    try {
      const file = validateSource(drafted.proposal.file, drafted.proposal.content);
      const base = file === COPY_PATH ? copySource : workflowSource;
      if (base.trim() === drafted.proposal.content.trim()) {
        reply = "That already matches the live source. Nothing to stage.";
      } else {
        proposalId = randomUUID();
        const stagingToken = randomBytes(24).toString("hex");
        const title = clip(drafted.proposal.title, 120) || "Product update";
        const summary = clip(drafted.proposal.summary, 400) || "Foreman drafted a source change.";
        await sql`
          insert into code_proposals (
            id, company_id, author_user_id, title, summary, file_path,
            base_content, proposed_content, status, staging_token
          ) values (
            ${proposalId}, ${profile.companyId}, ${userId}, ${title}, ${summary}, ${file},
            ${base}, ${drafted.proposal.content}, ${"pending"}, ${stagingToken}
          )
        `;
        await notifyAdmins(sql, profile.companyId, proposalId, stagingToken, title, summary);
        if (!/staging/i.test(reply)) {
          reply = `${reply} Staging link: /stage/${stagingToken}. I sent it to admins by text and email.`;
        }
      }
    } catch (error) {
      proposalId = "";
      const reason = error instanceof Error ? error.message : "invalid source";
      reply = `${reply} I could not stage that change (${reason}).`;
    }
  }

  await sql`
    insert into foreman_messages (id, company_id, user_id, role, body, proposal_id)
    values (
      ${randomUUID()}, ${profile.companyId}, ${userId}, ${"assistant"}, ${reply},
      ${proposalId || null}
    )
  `;
  return loadDeskData(userId);
}

export async function decideProposal(
  userId: string,
  input: { id: string; status: "approved" | "rejected" },
) {
  const { sql, profile } = await requireProfile(userId);
  if (profile.role !== "admin") throw new Error("Only an admin can approve product code.");
  const result = await applyDecision(sql, {
    proposalId: input.id,
    companyId: profile.companyId,
    userId,
    status: input.status,
  });
  if (!result.ok) throw new Error(result.error);
  return loadDeskData(userId);
}

export async function getStaging(token: string) {
  if (!/^[a-f0-9]{48}$/.test(token)) return { ok: false as const, error: "Unknown staging link." };
  const sql = await getSql();
  const rows = await sql<{
    id: string;
    title: string;
    summary: string;
    file_path: string;
    base_content: string;
    proposed_content: string;
    status: string;
    created_at: string;
    company_name: string;
  }>`
    select p.id, p.title, p.summary, p.file_path, p.base_content, p.proposed_content,
           p.status, p.created_at::text as created_at, c.name as company_name
    from code_proposals p
    join companies c on c.id = p.company_id
    where p.staging_token = ${token}
  `;
  const row = rows[0];
  if (!row) return { ok: false as const, error: "This staging build does not exist." };
  return {
    ok: true as const,
    proposal: {
      id: text(row.id),
      title: text(row.title),
      summary: text(row.summary),
      filePath: text(row.file_path),
      baseContent: text(row.base_content),
      proposedContent: text(row.proposed_content),
      status: text(row.status),
      createdAt: text(row.created_at),
      companyName: text(row.company_name),
    },
  };
}
