export const DOC_KINDS = ["policy", "bid", "invoice", "rfi", "submittal", "change_order"] as const;
export type DocKind = (typeof DOC_KINDS)[number];

export const DOC_LABEL: Record<DocKind, string> = {
  policy: "Policy",
  bid: "Bid",
  invoice: "Invoice",
  rfi: "RFI",
  submittal: "Submittal",
  change_order: "Change order",
};

export const DOC_SECTIONS = [
  { id: "policy", label: "Policy", kinds: ["policy"] },
  { id: "bids", label: "Bids", kinds: ["bid"] },
  { id: "invoices", label: "Invoices", kinds: ["invoice"] },
  { id: "changes", label: "Change management", kinds: ["change_order", "rfi", "submittal"] },
] as const;

export type DocSectionId = (typeof DOC_SECTIONS)[number]["id"];

export const DOC_STATUSES: Record<DocKind, readonly string[]> = {
  policy: ["Draft", "In effect", "Retired"],
  bid: ["Draft", "Sent", "Received", "Awarded", "Lost"],
  invoice: ["Draft", "Sent", "Paid", "Void"],
  rfi: ["Open", "Sent", "Answered", "Closed"],
  submittal: ["Draft", "Sent", "Revise", "Approved"],
  change_order: ["Draft", "Submitted", "Approved", "Rejected"],
};

export function isDocKind(value: string): value is DocKind {
  return (DOC_KINDS as readonly string[]).includes(value);
}

/** Bids and invoices are office money. Labor and leads never see them. */
export function isMoneyDoc(kind: DocKind): boolean {
  return kind === "bid" || kind === "invoice";
}

export function visibleSections(money: boolean) {
  return DOC_SECTIONS.filter((section) => money || (section.id !== "bids" && section.id !== "invoices"));
}

export function sectionFor(kind: DocKind) {
  return DOC_SECTIONS.find((section) => (section.kinds as readonly string[]).includes(kind)) ?? DOC_SECTIONS[3];
}

export function documentNumber(n: number): string {
  return String(n).padStart(3, "0");
}

export function documentSubject(kind: DocKind, number: number, title: string): string {
  return `${DOC_LABEL[kind]} ${documentNumber(number)} — ${title}`;
}

/** First send moves a draft onto the next step. Later sends keep the current status. */
export function statusAfterSend(kind: DocKind, status: string): string {
  if (status !== DOC_STATUSES[kind][0]) return status;
  if (kind === "change_order") return "Submitted";
  if (kind === "policy") return "In effect";
  return "Sent";
}

/** A filed reply advances the document when the next step is obvious. Never approves money. */
export function statusAfterReply(kind: DocKind, status: string): string {
  if (kind === "rfi" && (status === "Open" || status === "Sent")) return "Answered";
  if (kind === "bid" && status === "Sent") return "Received";
  if (kind === "submittal" && status === "Sent") return "Revise";
  return status;
}

/** Opens the same message in the sender's Gmail. The desk does not send it. */
export function gmailComposeUrl(to: string, subject: string, body: string): string {
  const params = new URLSearchParams({
    view: "cm",
    fs: "1",
    to,
    su: subject,
    body: body.slice(0, 1500),
  });
  return `https://mail.google.com/mail/?${params.toString()}`;
}
