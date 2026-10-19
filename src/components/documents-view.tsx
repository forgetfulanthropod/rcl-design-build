import { useEffect, useState } from "react";
import { createDocument, fileDocumentReply, listDocuments, sendDocument, setDocumentStatus } from "@/lib/server/fns";
import { DOC_LABEL, DOC_SECTIONS, DOC_STATUSES, documentNumber, sectionFor, visibleSections, type DocKind, type DocSectionId } from "@/lib/documents";
import { BigButton, Button, EmptyState, ErrorBanner, Skeleton } from "@/components/ui";

type Board = Awaited<ReturnType<typeof listDocuments>>;
type Card = Board["documents"][number];

/** Short list that sits beside the activity board. Full editing stays on Docs. */
export function DocumentRail({ onOpen }: { onOpen: (docId?: string) => void }) {
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
        <button type="button" onClick={() => onOpen()} className="h-11 px-2 text-sm text-copper">
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
              <button type="button" onClick={() => onOpen(doc.id)} className="w-full text-left">
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

/**
 * Docs. With routing (spec 05 · F1) the section and the open document live in the URL:
 * pass `section`/`docId` from the route and get `onSection`/`onOpenDoc` back.
 */
export function DocumentsView({
  section: sectionParam,
  onSection,
  docId,
  onOpenDoc,
  onTitle,
}: {
  section?: DocSectionId;
  onSection?: (section: DocSectionId) => void;
  docId?: string;
  onOpenDoc?: (docId: string) => void;
  onTitle?: (title: string) => void;
} = {}) {
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [sectionState, setSectionState] = useState<DocSectionId>(sectionParam ?? "policy");
  const section = sectionParam ?? sectionState;
  const setSection = (next: DocSectionId) => (onSection ? onSection(next) : setSectionState(next));
  const [openState, setOpenState] = useState("");
  const openId = docId ?? openState;
  const setOpenId = (next: string) => (onOpenDoc ? onOpenDoc(next) : setOpenState(next));
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

  async function run(work: Promise<Board | { board: Board; gmailUrl: string | null }>) {
    setBusy(true);
    setError("");
    try {
      const result = await work;
      if ("gmailUrl" in result) {
        setBoard(result.board);
        if (result.gmailUrl) window.open(result.gmailUrl, "_blank", "noopener");
      } else {
        setBoard(result);
      }
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save that.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  const sections = visibleSections(Boolean(board?.moneyVisible));
  const active = sections.some((item) => item.id === section) ? section : (sections[0]?.id ?? "policy");
  const inSection = DOC_SECTIONS.find((item) => item.id === active)?.kinds ?? [];
  const docs = (board?.documents ?? []).filter((doc) => (inSection as readonly string[]).includes(doc.kind));
  const creatable = inSection.filter((item) => {
    if (item === "bid" || item === "invoice") return Boolean(board?.moneyVisible);
    if (item === "rfi") return Boolean(board?.canCreate);
    return Boolean(board?.canStatus);
  });
  const createKind: DocKind = creatable.includes(kind) ? kind : (creatable[0] ?? "rfi");
  const current = board?.documents.find((doc) => doc.id === openId) ?? null;
  const currentTitle = current ? `${DOC_LABEL[current.kind]} ${documentNumber(current.number)}` : "";
  useEffect(() => {
    onTitle?.(currentTitle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTitle]);
  // A link to a document this desk can't see (another company, or gone): say so, leak nothing.
  const missing = Boolean(board && openId && !current);
  const thread = board?.messages.filter((message) => message.documentId === openId) ?? [];

  return (
    <div className="mx-auto grid max-w-3xl gap-4" data-testid="documents">
      {error ? <ErrorBanner message={error} /> : null}
      {!board ? (
        <Skeleton lines={4} label="Loading documents" />
      ) : missing ? (
        <div className="grid gap-3" data-testid="doc-missing">
          <EmptyState title="Not found" body="This document isn't on your desk." />
          <Button type="button" tone="ghost" onClick={() => setOpenId("")}>
            Back to Docs
          </Button>
        </div>
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
          onBack={() => setOpenId("")}
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
          <div className="flex gap-2 overflow-x-auto" role="tablist" aria-label="Document sections">
            {sections.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setSection(item.id)}
                className={`h-11 shrink-0 rounded-md border px-3 text-sm ${active === item.id ? "border-copper bg-copper text-ink" : "border-line text-fg"}`}
              >
                {item.label}
              </button>
            ))}
          </div>
          <p className="text-sm text-muted" data-testid="doc-counts">
            {sections
              .map((item) => {
                const count = board.documents.filter((doc) => (item.kinds as readonly string[]).includes(doc.kind)).length;
                return `${count} ${item.label.toLowerCase()}`;
              })
              .join(" · ")}
          </p>
          {creatable.length > 0 ? (
            <form
              className="grid gap-2 rounded-md border border-line bg-surface p-4"
              onSubmit={(event) => {
                event.preventDefault();
                const dollars = amount.trim() ? Number(amount) : null;
                void run(
                  createDocument({
                    data: {
                      kind: createKind,
                      projectId,
                      title,
                      body,
                      counterparty: who,
                      counterpartyEmail: email,
                      amount: dollars != null && Number.isFinite(dollars) ? Math.round(dollars) : null,
                    },
                  }),
                ).then((ok) => {
                  if (!ok) return;
                  setTitle("");
                  setBody("");
                  setWho("");
                  setAmount("");
                });
              }}
            >
              <div className="grid grid-cols-2 gap-2">
                {creatable.map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setKind(item)}
                    className={`h-11 rounded-md border text-sm ${createKind === item ? "border-copper bg-copper text-ink" : "border-line text-fg"}`}
                  >
                    {DOC_LABEL[item]}
                  </button>
                ))}
              </div>
              <label className="text-sm text-muted" htmlFor="doc-title">Title</label>
              <input id="doc-title" className="field" value={title} onChange={(event) => setTitle(event.target.value)} />
              <label className="text-sm text-muted" htmlFor="doc-body">What it says</label>
              <textarea id="doc-body" className="field min-h-20" value={body} onChange={(event) => setBody(event.target.value)} />
              <label className="text-sm text-muted" htmlFor="doc-job">Job</label>
              <select id="doc-job" className="field" value={projectId} onChange={(event) => setProjectId(event.target.value)}>
                <option value="">No job</option>
                {board.jobs.map((job) => (
                  <option key={job.id} value={job.id}>{job.name}</option>
                ))}
              </select>
              <label className="text-sm text-muted" htmlFor="doc-who">Send to</label>
              <input id="doc-who" className="field" placeholder="Name" value={who} onChange={(event) => setWho(event.target.value)} />
              <input className="field" type="email" aria-label="Email" placeholder="name@company.com" value={email} onChange={(event) => setEmail(event.target.value)} />
              {board.moneyVisible && (createKind === "bid" || createKind === "invoice" || createKind === "change_order") ? (
                <>
                  <label className="text-sm text-muted" htmlFor="doc-amount">Amount</label>
                  <input id="doc-amount" className="field" inputMode="numeric" placeholder="0" value={amount} onChange={(event) => setAmount(event.target.value)} />
                </>
              ) : null}
              <BigButton type="submit" disabled={busy || !title.trim()}>
                Add {DOC_LABEL[createKind].toLowerCase()}
              </BigButton>
            </form>
          ) : null}
          {docs.length === 0 ? (
            <EmptyState title="Nothing in this section" body="Policy and change management are on every desk. Bids and invoices stay with the office." />
          ) : (
            <ul className="grid gap-3">
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
      {board.canSend ? (
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
      ) : null}
    </div>
  );
}
