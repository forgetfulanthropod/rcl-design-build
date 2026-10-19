import { createServerFn } from "@tanstack/react-start";
import { isDocKind } from "@/lib/documents";
import { authMiddleware } from "@/lib/auth/middleware";

function required(value: unknown, max: number, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} is required.`);
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) throw new Error(`${label} must be 1–${max} characters.`);
  return trimmed;
}

function optional(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

function dollars(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 500_000_000) throw new Error("Enter a dollar amount.");
  return Math.round(n);
}

export const loadDesk = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { loadDeskData } = await import("./data.server");
    return loadDeskData(context.userId);
  });

export const completeSetup = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { name: string; companyName: string; phone: string }) => ({
    name: required(input?.name, 80, "Name"),
    companyName: required(input?.companyName, 80, "Company"),
    phone: optional(input?.phone, 24),
  }))
  .handler(async ({ context, data }) => {
    const { completeSetup: run } = await import("./data.server");
    return run(context.userId, data);
  });

export const createProject = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (input: {
      name: string;
      clientName: string;
      address: string;
      phase: string;
      contractValue: number;
      summary: string;
    }) => ({
      name: required(input?.name, 120, "Job name"),
      clientName: required(input?.clientName, 120, "Client"),
      address: required(input?.address, 160, "Address"),
      phase: required(input?.phase, 40, "Phase"),
      contractValue: dollars(input?.contractValue),
      summary: optional(input?.summary, 600),
    }),
  )
  .handler(async ({ context, data }) => {
    const { createProject: run } = await import("./data.server");
    return run(context.userId, data);
  });

export const setProjectPhase = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { id: string; phase: string }) => ({
    id: required(input?.id, 80, "Job"),
    phase: required(input?.phase, 40, "Phase"),
  }))
  .handler(async ({ context, data }) => {
    const { setProjectPhase: run } = await import("./data.server");
    return run(context.userId, data);
  });

export const archiveProject = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((id: string) => required(id, 80, "Job"))
  .handler(async ({ context, data }) => {
    const { archiveProject: run } = await import("./data.server");
    return run(context.userId, data);
  });

export const createMilestone = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { projectId: string; name: string; dueOn: string }) => ({
    projectId: required(input?.projectId, 80, "Job"),
    name: required(input?.name, 120, "Milestone"),
    dueOn: optional(input?.dueOn, 10),
  }))
  .handler(async ({ context, data }) => {
    const { createMilestone: run } = await import("./data.server");
    return run(context.userId, data);
  });

export const toggleMilestone = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((id: string) => required(id, 80, "Milestone"))
  .handler(async ({ context, data }) => {
    const { toggleMilestone: run } = await import("./data.server");
    return run(context.userId, data);
  });

export const createRfi = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { projectId: string; title: string; question: string }) => ({
    projectId: required(input?.projectId, 80, "Job"),
    title: required(input?.title, 160, "Title"),
    question: required(input?.question, 1000, "Question"),
  }))
  .handler(async ({ context, data }) => {
    const { createRfi: run } = await import("./data.server");
    return run(context.userId, data);
  });

export const setRfiStatus = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { id: string; status: string }) => ({
    id: required(input?.id, 80, "RFI"),
    status: required(input?.status, 40, "Status"),
  }))
  .handler(async ({ context, data }) => {
    const { setRfiStatus: run } = await import("./data.server");
    return run(context.userId, data);
  });

export const createChangeOrder = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { projectId: string; title: string; amount: number }) => ({
    projectId: required(input?.projectId, 80, "Job"),
    title: required(input?.title, 160, "Title"),
    amount: dollars(input?.amount),
  }))
  .handler(async ({ context, data }) => {
    const { createChangeOrder: run } = await import("./data.server");
    return run(context.userId, data);
  });

export const setCoStatus = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { id: string; status: string }) => ({
    id: required(input?.id, 80, "Change order"),
    status: required(input?.status, 40, "Status"),
  }))
  .handler(async ({ context, data }) => {
    const { setCoStatus: run } = await import("./data.server");
    return run(context.userId, data);
  });

export const createDailyLog = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { projectId: string; crew: number; weather: string; notes: string }) => {
    const crew = Number(input?.crew);
    if (!Number.isFinite(crew) || crew < 0 || crew > 500) throw new Error("Enter the crew count.");
    return {
      projectId: required(input?.projectId, 80, "Job"),
      crew: Math.round(crew),
      weather: optional(input?.weather, 80),
      notes: required(input?.notes, 1000, "Notes"),
    };
  })
  .handler(async ({ context, data }) => {
    const { createDailyLog: run } = await import("./data.server");
    return run(context.userId, data);
  });

export const createWorkOrder = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (input: {
      customer: string;
      site: string;
      title: string;
      trade: string;
      priority: string;
      projectId: string;
      notes: string;
    }) => ({
      customer: required(input?.customer, 120, "Customer"),
      site: required(input?.site, 160, "Site"),
      title: required(input?.title, 160, "Title"),
      trade: required(input?.trade, 40, "Trade"),
      priority: required(input?.priority, 40, "Priority"),
      projectId: optional(input?.projectId, 80),
      notes: optional(input?.notes, 800),
    }),
  )
  .handler(async ({ context, data }) => {
    const { createWorkOrder: run } = await import("./data.server");
    return run(context.userId, data);
  });

export const updateWorkOrder = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (input: { id: string; status: string; priority: string; assignedUserId: string; notes: string }) => ({
      id: required(input?.id, 80, "Work order"),
      status: required(input?.status, 40, "Status"),
      priority: required(input?.priority, 40, "Priority"),
      assignedUserId: optional(input?.assignedUserId, 80),
      notes: optional(input?.notes, 800),
    }),
  )
  .handler(async ({ context, data }) => {
    const { updateWorkOrder: run } = await import("./data.server");
    return run(context.userId, data);
  });

export const inviteCrew = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (input: { channel: "email" | "sms"; destination: string; name: string; role: string }) => {
      if (input?.channel !== "email" && input?.channel !== "sms") throw new Error("Pick email or text.");
      return {
        channel: input.channel,
        destination: required(input.destination, 160, "Destination"),
        name: required(input.name, 80, "Name"),
        role: required(input.role, 40, "Role"),
      };
    },
  )
  .handler(async ({ context, data }) => {
    const { inviteCrew: run } = await import("./data.server");
    return run(context.userId, data);
  });

export const askForeman = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { message: string }) => ({
    message: required(input?.message, 2000, "Message"),
  }))
  .handler(async ({ context, data }) => {
    const { askForeman: run } = await import("./data.server");
    return run(context.userId, data.message);
  });

export const decideProposal = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { id: string; status: "approved" | "rejected" }) => {
    if (input?.status !== "approved" && input?.status !== "rejected") {
      throw new Error("Approve or reject.");
    }
    return { id: required(input.id, 80, "Proposal"), status: input.status };
  })
  .handler(async ({ context, data }) => {
    const { decideProposal: run } = await import("./data.server");
    return run(context.userId, data);
  });

export const requestMagicLink = createServerFn({ method: "POST" })
  .validator((input: { channel: "email" | "sms"; destination: string; name: string }) => {
    if (input?.channel !== "email" && input?.channel !== "sms") throw new Error("Pick email or text.");
    return {
      channel: input.channel,
      destination: required(input.destination, 160, "Destination"),
      name: optional(input.name, 80),
    };
  })
  .handler(async ({ data }) => {
    const { requestLoginLink } = await import("./magic.server");
    return requestLoginLink(data);
  });

export const consumeMagicLink = createServerFn({ method: "POST" })
  .validator((input: { token: string }) => ({
    token: required(input?.token, 80, "Link"),
  }))
  .handler(async ({ data }) => {
    const { consumeToken } = await import("./magic.server");
    return consumeToken(data.token);
  });

export const getStaging = createServerFn({ method: "GET" })
  .validator((token: string) => required(token, 80, "Staging link"))
  .handler(async ({ data }) => {
    const { getStaging: run } = await import("./data.server");
    return run(data);
  });

/** Whether debug role sign-in is on (DEBUG_LOGIN=true on the server). */
export const getDebugLogin = createServerFn({ method: "GET" }).handler(async () => {
  const { debugLoginEnabled, ensureDemoCompany, DEBUG_ROLES } = await import("./debug-login.server");
  if (!debugLoginEnabled()) return { enabled: false, roles: [] as string[] };
  await ensureDemoCompany();
  return { enabled: true, roles: [...DEBUG_ROLES] as string[] };
});

/** Debug-only: sign in as a seeded demo user. Refused unless DEBUG_LOGIN=true on the server. */
export const debugSignIn = createServerFn({ method: "POST" })
  .validator((input: { role: string }) => ({ role: required(input?.role, 20, "Role") }))
  .handler(async ({ data }) => {
    const { debugSignIn: run } = await import("./debug-login.server");
    return run(data.role);
  });

/** Debug-only: wipe and re-seed the demo company. Refused when DEBUG_LOGIN=false. */
export const resetDemoData = createServerFn({ method: "POST" }).handler(async () => {
  const { resetDemoCompany } = await import("./debug-login.server");
  await resetDemoCompany();
  return { ok: true };
});

// ---------- daily reports ----------

function dayArg(value: unknown): string {
  const day = required(value, 10, "Day");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("Pick a day.");
  return day;
}

async function reportsFor(userId: string) {
  const { getSql } = await import("@/lib/db");
  const { member } = await import("./reports.server");
  const { assertCan } = await import("@/lib/permissions");
  const me = await member(await getSql(), userId);
  return { me, assertCan };
}

export const getMyReport = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((input: { day: string }) => ({ day: dayArg(input?.day) }))
  .handler(async ({ data, context }) => {
    const { me, assertCan } = await reportsFor(context.userId);
    assertCan(me.role, "report.write");
    const { getMyReport: run } = await import("./reports.server");
    return run(context.userId, data.day);
  });

export const saveMyReport = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { day: string; narrative: string; projectId: string }) => ({
    day: dayArg(input?.day),
    narrative: typeof input?.narrative === "string" ? input.narrative.slice(0, 8000) : "",
    projectId: optional(input?.projectId, 80),
  }))
  .handler(async ({ data, context }) => {
    const { me, assertCan } = await reportsFor(context.userId);
    assertCan(me.role, "report.write");
    const { saveMyReport: run } = await import("./reports.server");
    return run(context.userId, data);
  });

export const addMyPhoto = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { day: string; image: string; thumb: string; width: number; height: number; takenAt: string }) => {
    if (typeof input?.image !== "string" || input.image.length > 4_500_000) throw new Error("That photo is too large.");
    if (typeof input?.thumb !== "string" || input.thumb.length > 300_000) throw new Error("That photo is too large.");
    return {
      day: dayArg(input.day),
      image: input.image,
      thumb: input.thumb,
      width: Number(input.width) || 0,
      height: Number(input.height) || 0,
      takenAt: optional(input.takenAt, 40),
    };
  })
  .handler(async ({ data, context }) => {
    const { me, assertCan } = await reportsFor(context.userId);
    assertCan(me.role, "report.write");
    const { addMyPhoto: run } = await import("./reports.server");
    return run(context.userId, data);
  });

export const submitMyReport = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { day: string; lunchMinutes: number }) => ({ day: dayArg(input?.day), lunchMinutes: Number(input?.lunchMinutes) }))
  .handler(async ({ data, context }) => {
    const { me, assertCan } = await reportsFor(context.userId);
    assertCan(me.role, "report.write");
    const { submitMyReport: run } = await import("./reports.server");
    return run(context.userId, data);
  });

export const listMyReports = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { me, assertCan } = await reportsFor(context.userId);
    assertCan(me.role, "report.write");
    const { listMyReports: run } = await import("./reports.server");
    return run(context.userId);
  });

export const reviewReports = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((input: { from: string; to: string; projectId: string; personId: string }) => ({
    from: dayArg(input?.from),
    to: dayArg(input?.to),
    projectId: optional(input?.projectId, 80),
    personId: optional(input?.personId, 80),
  }))
  .handler(async ({ data, context }) => {
    const { me, assertCan } = await reportsFor(context.userId);
    assertCan(me.role, "report.review");
    const { reviewReports: run } = await import("./reports.server");
    return run(context.userId, data);
  });

export const getAttention = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { from: string; to: string; refresh?: boolean; cachedOnly?: boolean }) => ({
    from: dayArg(input?.from),
    to: dayArg(input?.to),
    refresh: Boolean(input?.refresh),
    cachedOnly: Boolean(input?.cachedOnly),
  }))
  .handler(async ({ data, context }) => {
    const { me, assertCan } = await reportsFor(context.userId);
    assertCan(me.role, "report.review");
    const { attentionSummary } = await import("./reports.server");
    // The model client (data.server) is only
    // loaded when a fresh summary is actually generated, so the cached path stays light.
    return attentionSummary(context.userId, data, async (system, message) => {
      const { askModel } = await import("./data.server");
      return askModel(system, [], message);
    });
  });

export const getReportPhoto = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((input: { id: string }) => ({ id: required(input?.id, 80, "Photo") }))
  .handler(async ({ data, context }) => {
    const { readPhoto } = await import("./reports.server");
    const photo = await readPhoto(context.userId, data.id);
    if (!photo) throw new Error("Photo not found.");
    return { url: `data:${photo.mime};base64,${photo.bytes.toString("base64")}` };
  });

export const listActivities = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((input: { day: string }) => ({ day: dayArg(input?.day) }))
  .handler(async ({ data, context }) => {
    const { listActivities: run } = await import("./activities.server");
    return run(context.userId, data.day);
  });

export const overviewActivities = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((input: { from: string; to: string; projectId: string }) => ({
    from: dayArg(input?.from),
    to: dayArg(input?.to),
    projectId: optional(input?.projectId, 80),
  }))
  .handler(async ({ data, context }) => {
    const { overviewActivities: run } = await import("./activities.server");
    return run(context.userId, data);
  });

export const createActivity = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { day: string; title: string; detail: string; projectId: string }) => ({
    day: dayArg(input?.day),
    title: required(input?.title, 160, "Activity"),
    detail: optional(input?.detail, 2000),
    projectId: optional(input?.projectId, 80),
  }))
  .handler(async ({ data, context }) => {
    const { createActivity: run } = await import("./activities.server");
    return run(context.userId, data);
  });

export const updateActivity = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { id: string; title: string; detail: string; projectId: string }) => ({
    id: required(input?.id, 80, "Activity"),
    title: required(input?.title, 160, "Activity"),
    detail: optional(input?.detail, 2000),
    projectId: optional(input?.projectId, 80),
  }))
  .handler(async ({ data, context }) => {
    const { updateActivity: run } = await import("./activities.server");
    return run(context.userId, data);
  });

export const approveActivity = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((id: string) => required(id, 80, "Activity"))
  .handler(async ({ data, context }) => {
    const { approveActivity: run } = await import("./activities.server");
    return run(context.userId, data);
  });

function flag(value: unknown): boolean {
  return value === true;
}

export const getSafety = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((input: { day: string }) => ({ day: dayArg(input?.day) }))
  .handler(async ({ data, context }) => {
    const { getSafety: run } = await import("./safety.server");
    return run(context.userId, data.day);
  });

export const saveOrientation = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { day: string; personId: string; attended: boolean; attendedOn: string }) => ({
    day: dayArg(input?.day),
    personId: required(input?.personId, 80, "Person"),
    attended: flag(input?.attended),
    attendedOn: input?.attendedOn ? dayArg(input.attendedOn) : "",
  }))
  .handler(async ({ data, context }) => {
    const { saveOrientation: run } = await import("./safety.server");
    return run(context.userId, data);
  });

export const saveJsa = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { day: string; projectId: string; hazards: string; controls: string }) => ({
    day: dayArg(input?.day),
    projectId: optional(input?.projectId, 80),
    hazards: required(input?.hazards, 2000, "Hazards"),
    controls: required(input?.controls, 2000, "Controls"),
  }))
  .handler(async ({ data, context }) => {
    const { saveJsa: run } = await import("./safety.server");
    return run(context.userId, data);
  });

export const approveJsa = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { day: string; id: string }) => ({
    day: dayArg(input?.day),
    id: required(input?.id, 80, "Analysis"),
  }))
  .handler(async ({ data, context }) => {
    const { approveJsa: run } = await import("./safety.server");
    return run(context.userId, data);
  });

export const recordInspection = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { day: string; projectId: string; inspectedOn: string; notes: string }) => ({
    day: dayArg(input?.day),
    projectId: required(input?.projectId, 80, "Job"),
    inspectedOn: dayArg(input?.inspectedOn),
    notes: optional(input?.notes, 2000),
  }))
  .handler(async ({ data, context }) => {
    const { recordInspection: run } = await import("./safety.server");
    return run(context.userId, data);
  });

export const addTraining = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { day: string; title: string; personId: string; dueOn: string }) => ({
    day: dayArg(input?.day),
    title: required(input?.title, 160, "Training"),
    personId: optional(input?.personId, 80),
    dueOn: input?.dueOn ? dayArg(input.dueOn) : "",
  }))
  .handler(async ({ data, context }) => {
    const { addTraining: run } = await import("./safety.server");
    return run(context.userId, data);
  });

function emailArg(value: unknown, label: string): string {
  const email = required(value, 160, label).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error(`${label} needs a real email address.`);
  return email;
}

export const listDocuments = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { listDocuments: run } = await import("./documents.server");
    return run(context.userId);
  });

export const createDocument = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: {
    kind: string;
    projectId: string;
    title: string;
    body: string;
    counterparty: string;
    counterpartyEmail: string;
    amount: number | null;
  }) => {
    const rawKind = required(input?.kind, 40, "Kind");
    if (!isDocKind(rawKind)) throw new Error("Unknown document.");
    const raw = input?.amount;
    const amount = raw == null || (typeof raw === "string" && raw === "") ? null : Number(raw);
    if (amount != null && (!Number.isFinite(amount) || amount < 0 || amount > 500_000_000)) throw new Error("Enter a dollar amount.");
    return {
      kind: rawKind,
      projectId: optional(input?.projectId, 80),
      title: required(input?.title, 160, "Title"),
      body: optional(input?.body, 8000),
      counterparty: optional(input?.counterparty, 120),
      counterpartyEmail: input?.counterpartyEmail ? emailArg(input.counterpartyEmail, "Email") : "",
      amount: amount == null ? null : Math.round(amount),
    };
  })
  .handler(async ({ data, context }) => {
    const { createDocument: run } = await import("./documents.server");
    return run(context.userId, data);
  });

export const setDocumentStatus = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { id: string; status: string }) => ({
    id: required(input?.id, 80, "Document"),
    status: required(input?.status, 40, "Status"),
  }))
  .handler(async ({ data, context }) => {
    const { setDocumentStatus: run } = await import("./documents.server");
    return run(context.userId, data);
  });

export const sendDocument = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { id: string; channel: string; to: string; note: string }) => {
    const channel = input?.channel === "gmail" ? "gmail" : input?.channel === "resend" ? "resend" : null;
    if (!channel) throw new Error("Pick Resend or Gmail.");
    return {
      id: required(input?.id, 80, "Document"),
      channel,
      to: emailArg(input?.to, "To"),
      note: optional(input?.note, 4000),
    };
  })
  .handler(async ({ data, context }) => {
    const { sendDocument: run } = await import("./documents.server");
    return run(context.userId, data);
  });

export const fileDocumentReply = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { id: string; channel: string; fromEmail: string; body: string }) => ({
    id: required(input?.id, 80, "Document"),
    channel: input?.channel === "resend" ? "resend" as const : "gmail" as const,
    fromEmail: emailArg(input?.fromEmail, "From"),
    body: required(input?.body, 8000, "Reply"),
  }))
  .handler(async ({ data, context }) => {
    const { fileDocumentReply: run } = await import("./documents.server");
    return run(context.userId, data);
  });

