import { useEffect, useState } from "react";
import { createDocument, fileDocumentReply, listDocuments, sendDocument, setDocumentStatus } from "@/lib/server/fns";
import { Drawer } from "vaul";
import { DOC_LABEL, DOC_SECTIONS, addButtonLabel, DOC_STATUSES, SECTION_EMPTY, createdMessage, docFormFields, documentNumber, newDocumentId, sectionFor, visibleSections, type DocKind, type DocSectionId } from "@/lib/documents";
import { BigButton, Button, EmptyState, ErrorBanner, Skeleton } from "@/components/ui";

type Board = Awaited<ReturnType<typeof listDocuments>>;
type Card = Board["documents"][number];

/** Short list that sits beside the activity board. Full editing stays on Docs. */
export function DocumentRail({ onOpen }: { onOpen: () => void }) {
  const [board, setBoard] = useState<Board | null>(null);

  useEffect(() => {
    let cancelled = false;
    listDocuments()
      .then((next) => {
        if (!cancelled) setBoard(next);
      })
      .catch(() => {
        if (!cancelled) setBoard(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <aside className="grid content-start gap-2 rounded-md border border-line bg-surface p-4" data-testid="doc-rail" aria-label="Documents">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg text-fg">Documents</h2>
        <button type="button" onClick={onOpen} className="h-11 px-2 text-sm text-copper">
          Manage
        </button>
      </div>
      {!board ? (
        <Skeleton lines={3} label="Loading documents" />
      ) : board.documents.length === 0 ? (
        <p className="text-sm text-muted">Nothing filed yet.</p>
      ) : (
        <ul className="grid gap-2">
          {board.documents.slice(0, 8).map((doc) => (
            <li key={doc.id}>
              <button type="button" onClick={onOpen} className="w-full text-left">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="text-sm text-fg">{sectionFor(doc.kind).label}</span>
                  <span className="text-sm text-copper">{doc.status}</span>
                </span>
                <span className="block text-sm text-muted">{doc.title}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

/** md+ (768 px) and up. Phones get the New document drawer; desktop an inline panel. */
function useDesktop(): boolean {
  const [desktop, setDesktop] = useState(true);
  useEffect(() => {
    const query = window.matchMedia("(min-width: 768px)");
    const update = () => setDesktop(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return desktop;
}

/** The New document form: an inline panel on desktop, a vaul drawer on phones. Esc/Cancel close it. */
function NewDocument({ desktop, title, onClose, children }: { desktop: boolean; title: string; onClose: () => void; children: React.ReactNode }) {
  if (desktop) {
    return (
      <section className="rounded-md border border-line bg-surface p-4" data-testid="new-document" aria-label={title}>
        <h2 className="mb-3 text-lg text-fg">{title}</h2>
        {children}
      </section>
    );
  }
  return (
    <Drawer.Root open onOpenChange={(open) => (open ? undefined : onClose())}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-40 bg-black/60" />
        <Drawer.Content className="fixed inset-x-0 bottom-0 z-50 max-h-[90dvh] overflow-y-auto rounded-t-xl border-t border-line bg-surface p-4" data-testid="new-document" aria-describedby={undefined}>
          <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-line" aria-hidden="true" />
          <Drawer.Title className="mb-3 text-lg text-fg">{title}</Drawer.Title>
          {children}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

export function DocumentsView() {
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [section, setSection] = useState<DocSectionId>("policy");
  const [openId, setOpenId] = useState("");
  const [kind, setKind] = useState<DocKind>("rfi");
  const [projectId, setProjectId] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [who, setWho] = useState("");
  const [email, setEmail] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [replyFrom, setReplyFrom] = useState("");
  const [replyBody, setReplyBody] = useState("");
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState("");
  const desktop = useDesktop();

  useEffect(() => {
    let cancelled = false;
    listDocuments()
      .then((next) => {
        if (!cancelled) setBoard(next);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not open documents.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function run(work: Promise<Board | { board: Board; gmailUrl: string | null }>): Promise<Board | null> {
    setBusy(true);
    setError("");
    try {
      const result = await work;
      const next = "gmailUrl" in result ? result.board : result;
      if ("gmailUrl" in result && result.gmailUrl) window.open(result.gmailUrl, "_blank", "noopener");
      setBoard(next);
      return next;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save that.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  const sections = visibleSections(Boolean(board?.moneyVisible));
  const active = sections.some((item) => item.id === section) ? section : (sections[0]?.id ?? "policy");
  const inSection = DOC_SECTIONS.find((item) => item.id === active)?.kinds ?? [];
  const docs = (board?.documents ?? []).filter((doc) => (inSection as readonly string[]).includes(doc.kind));
  const creatable = inSection.filter((item) => {
    if (!board?.canCreate) return false; // labor and subs read documents only (spec 05 · F2c)
    if (item === "bid" || item === "invoice") return Boolean(board?.moneyVisible);
    if (item === "rfi") return Boolean(board?.canCreate);
    return Boolean(board?.canStatus);
  });
  const createKind: DocKind = creatable.includes(kind) ? kind : (creatable[0] ?? "rfi");
  const fields = docFormFields(createKind, Boolean(board?.moneyVisible));
  const current = board?.documents.find((doc) => doc.id === openId) ?? null;
  const thread = board?.messages.filter((message) => message.documentId === openId) ?? [];

  return (
    <div className="mx-auto grid max-w-3xl gap-4" data-testid="documents">
      {error ? <ErrorBanner message={error} /> : null}
      {created ? (
        <p role="status" className="rounded-md bg-raised p-3 text-base text-fg" data-testid="doc-created">{created}</p>
      ) : null}
      {!board ? (
        <Skeleton lines={4} label="Loading documents" />
      ) : current ? (
        <DocumentDetail
          doc={current}
          thread={thread}
          busy={busy}
          board={board}
          note={note}
          setNote={setNote}
          replyFrom={replyFrom}
          setReplyFrom={setReplyFrom}
          replyBody={replyBody}
          setReplyBody={setReplyBody}
          onBack={() => {
            setOpenId("");
            setCreated("");
          }}
          onStatus={(status) => void run(setDocumentStatus({ data: { id: current.id, status } }))}
          onSend={(channel) =>
            void run(sendDocument({ data: { id: current.id, channel, to: email || current.counterpartyEmail, note } })).then((ok) => {
              if (ok) setNote("");
            })
          }
          onFile={() =>
            void run(fileDocumentReply({ data: { id: current.id, channel: "gmail", fromEmail: replyFrom, body: replyBody } })).then((ok) => {
              if (ok) setReplyBody("");
            })
          }
          sendTo={email || current.counterpartyEmail}
          setSendTo={setEmail}
        />
      ) : (
        <>
          <div className="flex min-w-0 items-end justify-between gap-3 border-b border-line">
            <div className="-mb-px flex min-w-0 flex-1 gap-1 overflow-x-auto" role="tablist" aria-label="Document sections">
              {sections.map((item) => {
                const count = board.documents.filter((doc) => (item.kinds as readonly string[]).includes(doc.kind)).length;
                const selected = active === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="tab"
                    id={`doc-tab-${item.id}`}
                    aria-selected={selected}
                    aria-controls="doc-panel"
                    onClick={() => {
                      setSection(item.id);
                      setCreating(false);
                    }}
                    className={`inline-flex h-11 shrink-0 items-center gap-2 border-b-2 px-3 text-sm ${selected ? "border-copper text-fg" : "border-transparent text-muted hover:text-fg"}`}
                  >
                    {item.label}
                    <span className="rounded-full bg-raised px-2 text-xs tabular-nums text-fg" aria-label={`${count} documents`}>
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
            {creatable.length > 0 && !creating ? (
              <Button type="button" className="mb-1 shrink-0" onClick={() => setCreating(true)}>
                + New document
              </Button>
            ) : null}
          </div>
          {creatable.length > 0 && creating ? (
            <NewDocument
              desktop={desktop}
              title={`New ${DOC_LABEL[createKind]}`}
              onClose={() => setCreating(false)}
            >
              <form
                className="grid gap-2"
                aria-label={`New ${DOC_LABEL[createKind]}`}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setCreating(false);
                }}
                onSubmit={(event) => {
                  event.preventDefault();
                  const dollars = amount.trim() ? Number(amount) : null;
                  const before = board.documents;
                  void run(
                    createDocument({
                      data: {
                        kind: createKind,
                        projectId,
                        title,
                        body,
                        counterparty: fields.recipient ? who : "",
                        counterpartyEmail: fields.recipient ? email : "",
                        amount: fields.amount && dollars != null && Number.isFinite(dollars) ? Math.round(dollars) : null,
                      },
                    }),
                  ).then((next) => {
                    if (!next) return;
                    setTitle("");
                    setBody("");
                    setWho("");
                    setAmount("");
                    setCreating(false);
                    const id = newDocumentId(before, next.documents);
                    const doc = next.documents.find((item) => item.id === id);
                    if (doc) {
                      setCreated(createdMessage(doc.kind, doc.number));
                      setOpenId(doc.id);
                      setEmail(doc.counterpartyEmail);
                    }
                  });
                }}
              >
                <label className="text-sm text-muted" htmlFor="doc-type">Type</label>
                <select id="doc-type" className="field" value={createKind} autoFocus onChange={(event) => setKind(event.target.value as DocKind)}>
                  {creatable.map((item) => (
                    <option key={item} value={item}>{DOC_LABEL[item]}</option>
                  ))}
                </select>
                <label className="text-sm text-muted" htmlFor="doc-job">Job</label>
                <select id="doc-job" className="field" value={projectId} onChange={(event) => setProjectId(event.target.value)}>
                  <option value="">No job</option>
                  {board.jobs.map((job) => (
                    <option key={job.id} value={job.id}>{job.name}</option>
                  ))}
                </select>
                <label className="text-sm text-muted" htmlFor="doc-title">Subject <span aria-hidden="true">*</span></label>
                <input id="doc-title" className="field" required value={title} onChange={(event) => setTitle(event.target.value)} />
                <label className="text-sm text-muted" htmlFor="doc-body">Details</label>
                <textarea id="doc-body" className="field min-h-20" value={body} onChange={(event) => setBody(event.target.value)} />
                {fields.recipient ? (
                  <>
                    <label className="text-sm text-muted" htmlFor="doc-who">Recipient name</label>
                    <input id="doc-who" className="field" value={who} onChange={(event) => setWho(event.target.value)} />
                    <label className="text-sm text-muted" htmlFor="doc-email">Recipient email</label>
                    <input id="doc-email" className="field" type="email" placeholder="name@company.com" value={email} onChange={(event) => setEmail(event.target.value)} />
                  </>
                ) : null}
                {fields.amount ? (
                  <>
                    <label className="text-sm text-muted" htmlFor="doc-amount">Amount (USD)</label>
                    <input id="doc-amount" className="field" inputMode="numeric" placeholder="0" value={amount} onChange={(event) => setAmount(event.target.value)} />
                  </>
                ) : null}
                <div className="grid grid-cols-2 gap-2">
                  <BigButton type="submit" disabled={busy || !title.trim()}>
                    {addButtonLabel(createKind)}
                  </BigButton>
                  <Button type="button" tone="ghost" className="h-14" onClick={() => setCreating(false)}>
                    Cancel
                  </Button>
                </div>
              </form>
            </NewDocument>
          ) : null}
          {docs.length === 0 ? (
            <div id="doc-panel" role="tabpanel" aria-labelledby={`doc-tab-${active}`}>
              <EmptyState title={SECTION_EMPTY[active]} />
            </div>
          ) : (
            <ul className="grid gap-3" id="doc-panel" role="tabpanel" aria-labelledby={`doc-tab-${active}`}>
              {docs.map((doc) => (
                <li key={doc.id}>
                  <button type="button" onClick={() => { setOpenId(doc.id); setEmail(doc.counterpartyEmail); }} className="w-full rounded-md border border-line bg-surface p-4 text-left">
                    <div className="flex items-baseline justify-between gap-3">
                      <h3 className="text-lg text-fg">{DOC_LABEL[doc.kind]} {documentNumber(doc.number)}</h3>
                      <span className="text-sm text-copper">{doc.status}</span>
                    </div>
                    <p className="mt-1 text-base text-fg">{doc.title}</p>
                    <p className="mt-1 text-sm text-muted">
                      {[doc.projectName, doc.counterparty, doc.amount != null ? `$${doc.amount.toLocaleString()}` : ""].filter(Boolean).join(" · ") || "No job yet"}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function DocumentDetail({
  doc,
  thread,
  busy,
  board,
  note,
  setNote,
  replyFrom,
  setReplyFrom,
  replyBody,
  setReplyBody,
  onBack,
  onStatus,
  onSend,
  onFile,
  sendTo,
  setSendTo,
}: {
  doc: Card;
  thread: Board["messages"];
  busy: boolean;
  board: Board;
  note: string;
  setNote: (value: string) => void;
  replyFrom: string;
  setReplyFrom: (value: string) => void;
  replyBody: string;
  setReplyBody: (value: string) => void;
  onBack: () => void;
  onStatus: (status: string) => void;
  onSend: (channel: "resend" | "gmail") => void;
  onFile: () => void;
  sendTo: string;
  setSendTo: (value: string) => void;
}) {
  const statuses = DOC_STATUSES[doc.kind].filter((status) => {
    if (doc.kind === "change_order" && (status === "Approved" || status === "Rejected")) return board.canApproveMoney;
    return true;
  });
  return (
    <div className="grid gap-4">
      <button type="button" onClick={onBack} className="h-11 justify-self-start text-sm text-copper">
        All documents
      </button>
      <header>
        <p className="text-sm text-copper">{DOC_LABEL[doc.kind]} {documentNumber(doc.number)} · {doc.status}</p>
        <h2 className="text-2xl text-fg">{doc.title}</h2>
        {doc.projectName ? <p className="mt-1 text-sm text-muted">{doc.projectName}</p> : null}
        {doc.amount != null ? <p className="mt-1 text-base text-fg">${doc.amount.toLocaleString()}</p> : null}
        {doc.body ? <p className="mt-3 whitespace-pre-wrap text-base leading-relaxed text-fg">{doc.body}</p> : null}
      </header>
      {board.canStatus ? (
        <div className="flex flex-wrap gap-2">
          {statuses.map((status) => (
            <button
              key={status}
              type="button"
              disabled={busy || status === doc.status}
              onClick={() => onStatus(status)}
              className={`h-11 rounded-md border px-3 text-sm ${status === doc.status ? "border-copper bg-copper text-ink" : "border-line text-fg"}`}
            >
              {status}
            </button>
          ))}
        </div>
      ) : null}
      <section className="grid gap-3">
        <h3 className="text-lg text-fg">Mail</h3>
        {thread.length === 0 ? <p className="text-sm text-muted">Nothing sent yet.</p> : null}
        {thread.map((message) => (
          <article key={message.id} className="rounded-md border border-line bg-surface p-4" data-testid="doc-message">
            <p className="text-sm text-muted">
              {message.direction === "in" ? "Reply" : "Sent"} · {message.channel === "gmail" ? "Gmail" : "Resend"} · {message.status}
              {message.error ? ` · ${message.error}` : ""}
            </p>
            <p className="mt-1 text-base text-fg">{message.subject}</p>
            <p className="mt-1 text-sm text-muted">{message.direction === "in" ? message.fromEmail : message.toEmail}</p>
            <p className="mt-2 whitespace-pre-wrap text-base leading-relaxed text-fg">{message.body}</p>
          </article>
        ))}
      </section>
      {doc.canSend ? (
        <form className="grid gap-2 rounded-md border border-line bg-surface p-4" onSubmit={(event) => event.preventDefault()}>
          <label className="text-sm text-muted" htmlFor="send-to">To</label>
          <input id="send-to" className="field" type="email" value={sendTo} onChange={(event) => setSendTo(event.target.value)} />
          <label className="text-sm text-muted" htmlFor="send-note">Note</label>
          <textarea id="send-note" className="field min-h-20" value={note} onChange={(event) => setNote(event.target.value)} />
          <BigButton type="button" disabled={busy || !sendTo.includes("@")} onClick={() => onSend("resend")}>
            {board.resendReady ? "Send with Resend" : "Queue on Resend"}
          </BigButton>
          <Button type="button" tone="ghost" disabled={busy || !sendTo.includes("@")} onClick={() => onSend("gmail")}>
            Open in Gmail
          </Button>
          <p className="text-sm text-muted">Resend sends from this desk. Gmail opens the same note in your mailbox. File the reply here when it comes back.</p>
          <label className="mt-2 text-sm text-muted" htmlFor="reply-from">File a Gmail reply</label>
          <input id="reply-from" className="field" type="email" placeholder="From" value={replyFrom} onChange={(event) => setReplyFrom(event.target.value)} />
          <textarea className="field min-h-20" aria-label="Reply" value={replyBody} onChange={(event) => setReplyBody(event.target.value)} />
          <Button type="button" tone="ghost" disabled={busy || !replyFrom.includes("@") || !replyBody.trim()} onClick={onFile}>
            File reply
          </Button>
        </form>
      ) : board.sendOffHint ? (
        <p className="rounded-md border border-line bg-surface p-4 text-base text-muted" data-testid="send-off">
          {board.sendOffHint}
        </p>
      ) : null}
    </div>
  );
}
