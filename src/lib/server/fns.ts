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

/** Hints for which job a form starts on (spec 05 · F3). Any signed-in crew member. */
export const getJobHints = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((input: { day: string }) => ({ day: dayArg(input?.day) }))
  .handler(async ({ data, context }) => {
    const { jobHints } = await import("./reports.server");
    return jobHints(context.userId, data.day);
  });

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
  .validator(
    (input: { day: string; lunchMinutes: number; start: string; end: string; lines?: { projectId: string | null; costCodeId: string | null; minutes: number }[] }) => ({
      day: dayArg(input?.day),
      lunchMinutes: Number(input?.lunchMinutes),
      start: optional(input?.start, 5),
      end: optional(input?.end, 5),
      lines: timeLines(input?.lines),
    }),
  )
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


// ---- Sharing settings (spec 06 rev 3). Owner, Admin and superadmin only; checked in sharing.server. ----

function sharingKeyArg(value: unknown): string {
  return required(value, 40, "Setting");
}
function onOff(value: unknown): boolean {
  if (typeof value !== "boolean") throw new Error("Pick On or Off.");
  return value;
}
function onOffInherit(value: unknown): boolean | null {
  if (value === null) return null;
  return onOff(value);
}

export const getSharingOverview = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { getSharingOverview: run } = await import("./sharing.server");
    return run(context.userId);
  });

export const getSharingProject = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((input: { projectId: string }) => ({ projectId: required(input?.projectId, 80, "Job") }))
  .handler(async ({ context, data }) => {
    const { getSharingProject: run } = await import("./sharing.server");
    return run(context.userId, data);
  });

export const getSharingReviewCount = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { reviewCount } = await import("./sharing.server");
    return reviewCount(context.userId);
  });

export const listSharingReviewQueue = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { listReviewQueue } = await import("./sharing.server");
    return listReviewQueue(context.userId);
  });

export const setCompanySharing = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { key: string; value: boolean; note?: string }) => ({
    key: sharingKeyArg(input?.key),
    value: onOff(input?.value),
    note: optional(input?.note, 500),
  }))
  .handler(async ({ context, data }) => {
    const { setCompanySetting } = await import("./sharing.server");
    return setCompanySetting(context.userId, data);
  });

export const setProjectSharing = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { projectId: string; key: string; value: boolean | null; note?: string }) => ({
    projectId: required(input?.projectId, 80, "Job"),
    key: sharingKeyArg(input?.key),
    value: onOffInherit(input?.value),
    note: optional(input?.note, 500),
  }))
  .handler(async ({ context, data }) => {
    const { setProjectSetting } = await import("./sharing.server");
    return setProjectSetting(context.userId, data);
  });

export const getReviewPreview = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((input: { projectId: string }) => ({ projectId: required(input?.projectId, 80, "Job") }))
  .handler(async ({ context, data }) => {
    const { getReviewPreview: run } = await import("./sharing.server");
    return run(context.userId, data);
  });

/** Clears the "Sharing review needed" flag on ONE job. There is no bulk version. */
export const markProjectReviewed = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { projectId: string; expectedSnapshotHash?: string }) => ({
    projectId: required(input?.projectId, 80, "Job"),
    expectedSnapshotHash: optional(input?.expectedSnapshotHash, 16) || undefined,
  }))
  .handler(async ({ context, data }) => {
    const { markProjectReviewed: run } = await import("./sharing.server");
    return run(context.userId, data);
  });

export const requestSharingReview = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { projectId: string; note?: string }) => ({
    projectId: required(input?.projectId, 80, "Job"),
    note: optional(input?.note, 500),
  }))
  .handler(async ({ context, data }) => {
    const { requestReviewAgain } = await import("./sharing.server");
    return requestReviewAgain(context.userId, data);
  });

export const listSharingAudit = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((input: { projectId?: string; scope?: string; key?: string; person?: string }) => ({
    projectId: optional(input?.projectId, 80),
    scope: optional(input?.scope, 80),
    key: optional(input?.key, 40),
    person: optional(input?.person, 80),
  }))
  .handler(async ({ context, data }) => {
    const { listAudit } = await import("./sharing.server");
    return listAudit(context.userId, data);
  });

// ---- Crew & skills board (spec 01). Permissions checked in crew.server. ----

export const getCrewBoard = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((input: { week?: string } = {}) => ({ week: optional(input?.week, 10) || undefined }))
  .handler(async ({ context, data }) => {
    const { getBoard } = await import("./crew.server");
    return getBoard(context.userId, data);
  });

export const assignCrew = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { userId: string; projectId: string; day: string; part?: string; note?: string }) => ({
    userId: required(input?.userId, 80, "Person"),
    projectId: required(input?.projectId, 80, "Job"),
    day: dayArg(input?.day),
    part: optional(input?.part, 8) || "full",
    note: optional(input?.note, 500),
  }))
  .handler(async ({ context, data }) => {
    const { assignPerson } = await import("./crew.server");
    return assignPerson(context.userId, data);
  });

export const removeCrewAssignment = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { id: string }) => ({ id: required(input?.id, 80, "Assignment") }))
  .handler(async ({ context, data }) => {
    const { removeAssignment } = await import("./crew.server");
    return removeAssignment(context.userId, data);
  });

export const copyCrewLastWeek = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { week?: string } = {}) => ({ week: optional(input?.week, 10) || undefined }))
  .handler(async ({ context, data }) => {
    const { copyLastWeek } = await import("./crew.server");
    return copyLastWeek(context.userId, data);
  });

export const publishCrewWeek = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { week?: string; confirmWarnings?: boolean } = {}) => ({
    week: optional(input?.week, 10) || undefined,
    confirmWarnings: input?.confirmWarnings === true,
  }))
  .handler(async ({ context, data }) => {
    const { publishWeek } = await import("./crew.server");
    return publishWeek(context.userId, data);
  });

export const listCrewTrades = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { listTrades } = await import("./crew.server");
    return listTrades(context.userId);
  });

export const listCrewCertTypes = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { listCertTypes } = await import("./crew.server");
    return listCertTypes(context.userId);
  });

export const setCrewPersonTrade = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { userId: string; tradeId: string; level?: string }) => ({
    userId: required(input?.userId, 80, "Person"),
    tradeId: required(input?.tradeId, 80, "Trade"),
    level: optional(input?.level, 20) || "journeyman",
  }))
  .handler(async ({ context, data }) => {
    const { setPersonTrade } = await import("./crew.server");
    return setPersonTrade(context.userId, data);
  });

export const removeCrewPersonTrade = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { userId: string; tradeId: string }) => ({
    userId: required(input?.userId, 80, "Person"),
    tradeId: required(input?.tradeId, 80, "Trade"),
  }))
  .handler(async ({ context, data }) => {
    const { removePersonTrade } = await import("./crew.server");
    return removePersonTrade(context.userId, data);
  });

export const upsertCrewPersonCert = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { userId: string; certTypeId: string; number?: string; issuedOn?: string; expiresOn?: string; id?: string }) => ({
    userId: required(input?.userId, 80, "Person"),
    certTypeId: required(input?.certTypeId, 80, "Cert"),
    number: optional(input?.number, 80),
    issuedOn: optional(input?.issuedOn, 10) || undefined,
    expiresOn: optional(input?.expiresOn, 10) || undefined,
    id: optional(input?.id, 80) || undefined,
  }))
  .handler(async ({ context, data }) => {
    const { upsertPersonCert } = await import("./crew.server");
    return upsertPersonCert(context.userId, data);
  });

export const setCrewJobRequirement = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { projectId: string; certTypeId: string; on: boolean }) => ({
    projectId: required(input?.projectId, 80, "Job"),
    certTypeId: required(input?.certTypeId, 80, "Cert"),
    on: input?.on === true,
  }))
  .handler(async ({ context, data }) => {
    const { setJobRequirement } = await import("./crew.server");
    return setJobRequirement(context.userId, data);
  });

export const setCrewJobLead = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { projectId: string; leadUserId: string; on: boolean }) => ({
    projectId: required(input?.projectId, 80, "Job"),
    leadUserId: required(input?.leadUserId, 80, "Lead"),
    on: input?.on === true,
  }))
  .handler(async ({ context, data }) => {
    const { setJobLead } = await import("./crew.server");
    return setJobLead(context.userId, data);
  });

export const getCrewPerson = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((input: { userId: string }) => ({ userId: required(input?.userId, 80, "Person") }))
  .handler(async ({ context, data }) => {
    const { getPersonDetail } = await import("./crew.server");
    return getPersonDetail(context.userId, data);
  });

export const getCrewCertsMatrix = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { getCertsMatrix } = await import("./crew.server");
    return getCertsMatrix(context.userId);
  });

export const getMyCrewWeek = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((input: { week?: string } = {}) => ({ week: optional(input?.week, 10) || undefined }))
  .handler(async ({ context, data }) => {
    const { getMyWeek } = await import("./crew.server");
    return getMyWeek(context.userId, data);
  });

export const requestCrewOff = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { fromDay: string; toDay: string; reason: string; note?: string; forUserId?: string }) => ({
    fromDay: dayArg(input?.fromDay),
    toDay: dayArg(input?.toDay),
    reason: required(input?.reason, 20, "Reason"),
    note: optional(input?.note, 500),
    forUserId: optional(input?.forUserId, 80) || undefined,
  }))
  .handler(async ({ context, data }) => {
    const { requestOff } = await import("./crew.server");
    return requestOff(context.userId, data);
  });

export const confirmCrewOff = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { id: string; status: "confirmed" | "declined" }) => ({
    id: required(input?.id, 80, "Request"),
    status: input?.status === "declined" ? ("declined" as const) : ("confirmed" as const),
  }))
  .handler(async ({ context, data }) => {
    const { confirmOff } = await import("./crew.server");
    return confirmOff(context.userId, data);
  });

export const getYoureOn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { getYoureOn: run } = await import("./crew.server");
    return run(context.userId);
  });

// ---- Timesheets (spec 02). Permissions checked in time.server. ----

function timeLines(value: unknown): { projectId: string | null; costCodeId: string | null; minutes: number }[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 6).map((line: { projectId?: unknown; costCodeId?: unknown; minutes?: unknown }) => ({
    projectId: optional(line?.projectId, 80) || null,
    costCodeId: optional(line?.costCodeId, 80) || null,
    minutes: Number(line?.minutes),
  }));
}

function idList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.length > 0 && v.length <= 80).slice(0, 500);
}

function exportKind(value: unknown): "payroll" | "sub_hours" {
  return value === "sub_hours" ? "sub_hours" : "payroll";
}

export const getSubmitDefaults = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((input: { day: string }) => ({ day: dayArg(input?.day) }))
  .handler(async ({ context, data }) => {
    const { getSubmitDefaults: run } = await import("./time.server");
    return run(context.userId, data);
  });

export const getMyHours = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((input: { week?: string } = {}) => ({ week: optional(input?.week, 10) || undefined }))
  .handler(async ({ context, data }) => {
    const { getMyHours: run } = await import("./time.server");
    return run(context.userId, data);
  });

export const getTimeWeek = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((input: { week?: string; today?: string } = {}) => ({
    week: optional(input?.week, 10) || undefined,
    today: optional(input?.today, 10) || undefined,
  }))
  .handler(async ({ context, data }) => {
    const { getTimeWeek: run } = await import("./time.server");
    return run(context.userId, data);
  });

export const getTimeReport = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((input: { reportId: string }) => ({ reportId: required(input?.reportId, 80, "Report") }))
  .handler(async ({ context, data }) => {
    const { reportForTimeReview } = await import("./reports.server");
    return reportForTimeReview(context.userId, data.reportId);
  });

export const approveTime = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { ids: string[] }) => ({ ids: idList(input?.ids) }))
  .handler(async ({ context, data }) => {
    const { approveEntries } = await import("./time.server");
    return approveEntries(context.userId, data);
  });

export const rejectTime = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { ids: string[]; reason: string }) => ({ ids: idList(input?.ids), reason: optional(input?.reason, 500) }))
  .handler(async ({ context, data }) => {
    const { rejectEntries } = await import("./time.server");
    return rejectEntries(context.userId, data);
  });

export const editTime = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { id: string; projectId: string | null; costCodeId: string | null; minutes: number }) => ({
    id: required(input?.id, 80, "Entry"),
    projectId: optional(input?.projectId, 80) || null,
    costCodeId: optional(input?.costCodeId, 80) || null,
    minutes: Number(input?.minutes),
  }))
  .handler(async ({ context, data }) => {
    const { editEntry } = await import("./time.server");
    return editEntry(context.userId, data);
  });

export const unlockTime = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { ids: string[] }) => ({ ids: idList(input?.ids) }))
  .handler(async ({ context, data }) => {
    const { unlockEntries } = await import("./time.server");
    return unlockEntries(context.userId, data);
  });

export const nudgeTime = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { userId: string; day: string }) => ({ userId: required(input?.userId, 80, "Person"), day: dayArg(input?.day) }))
  .handler(async ({ context, data }) => {
    const { nudgeMissing } = await import("./time.server");
    return nudgeMissing(context.userId, data);
  });

export const previewPayroll = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((input: { start?: string; end?: string; kind?: string } = {}) => ({
    start: optional(input?.start, 10) || undefined,
    end: optional(input?.end, 10) || undefined,
    kind: exportKind(input?.kind),
  }))
  .handler(async ({ context, data }) => {
    const { previewPayrollExport } = await import("./time.server");
    return previewPayrollExport(context.userId, data);
  });

export const runPayroll = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { start: string; end: string; kind?: string }) => ({
    start: optional(input?.start, 10),
    end: optional(input?.end, 10),
    kind: exportKind(input?.kind),
  }))
  .handler(async ({ context, data }) => {
    const { runPayrollExport } = await import("./time.server");
    return runPayrollExport(context.userId, data);
  });

export const listPayrollExports = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { listPayrollExports: run } = await import("./time.server");
    return run(context.userId);
  });

export const getPayrollCsv = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((input: { id: string }) => ({ id: required(input?.id, 80, "Export") }))
  .handler(async ({ context, data }) => {
    const { getPayrollExportCsv } = await import("./time.server");
    return getPayrollExportCsv(context.userId, data);
  });

export const voidPayroll = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { id: string }) => ({ id: required(input?.id, 80, "Export") }))
  .handler(async ({ context, data }) => {
    const { voidPayrollExport } = await import("./time.server");
    return voidPayrollExport(context.userId, data);
  });

export const listPayRates = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { listPayRates: run } = await import("./time.server");
    return run(context.userId);
  });

export const setPayRate = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { userId: string; effectiveOn: string; rateCents: number; burdenPct: number }) => ({
    userId: required(input?.userId, 80, "Person"),
    effectiveOn: dayArg(input?.effectiveOn),
    rateCents: Math.round(Number(input?.rateCents)),
    burdenPct: Number(input?.burdenPct),
  }))
  .handler(async ({ context, data }) => {
    const { setPayRate: run } = await import("./time.server");
    return run(context.userId, data);
  });
