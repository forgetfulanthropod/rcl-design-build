import { createServerFn } from "@tanstack/react-start";
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
