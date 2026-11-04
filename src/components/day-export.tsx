/**
 * Download is the default. A private link is created only after an explicit ask,
 * and the share sheet is offered when this browser has one.
 */
export function DayExport({
  busy,
  shareOpen,
  canFileShare,
  linkUrl,
  note,
  error,
  copied,
  onDownload,
  onToggleShare,
  onShareFile,
  onCreateLink,
  onCopy,
  onRevoke,
}: {
  busy: boolean;
  shareOpen: boolean;
  canFileShare: boolean;
  linkUrl: string;
  note: string;
  error: string;
  copied: boolean;
  onDownload: () => void;
  onToggleShare: () => void;
  onShareFile: () => void;
  onCreateLink: () => void;
  onCopy: () => void;
  onRevoke: () => void;
}) {
  return (
    <section className="mb-6 rounded-md border border-line bg-surface p-4" data-testid="day-export" aria-label="Export">
      <h2 className="text-sm font-semibold">Export</h2>
      <p className="mt-1 text-sm text-muted">Download saves the PDF on this device.</p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={onDownload}
          disabled={busy}
          className="inline-flex h-12 flex-1 items-center justify-center rounded-md bg-[#1f8a4c] px-4 text-sm font-semibold text-white disabled:opacity-60"
        >
          {busy ? "Preparing…" : "Download PDF"}
        </button>
        <button
          type="button"
          onClick={onToggleShare}
          disabled={busy}
          aria-expanded={shareOpen}
          className="inline-flex h-12 flex-1 items-center justify-center rounded-md border border-line bg-raised px-4 text-sm font-medium disabled:opacity-60"
        >
          Share
        </button>
      </div>
      {shareOpen ? (
        <div className="mt-3 grid gap-3 border-t border-line pt-3" data-testid="share-options">
          {canFileShare ? (
            <button
              type="button"
              onClick={onShareFile}
              disabled={busy}
              className="inline-flex h-12 items-center justify-center rounded-md border border-line bg-raised px-4 text-sm font-medium disabled:opacity-60"
            >
              Share PDF…
            </button>
          ) : (
            <p className="text-sm text-muted">This browser has no share sheet. Download the PDF, or create a private link.</p>
          )}
          <div>
            <button
              type="button"
              onClick={onCreateLink}
              disabled={busy}
              data-testid="create-share-link"
              className="inline-flex h-12 items-center justify-center rounded-md border border-line px-4 text-sm font-medium disabled:opacity-60"
            >
              Create a private link
            </button>
            <p className="mt-2 text-sm text-muted">
              A link is created when you ask for one. Anyone with the link can view this day. Location is left off the link.
            </p>
          </div>
          {linkUrl ? (
            <div className="grid gap-2">
              <label className="text-sm">
                Private link
                <input className="field mt-1" readOnly value={linkUrl} onFocus={(event) => event.currentTarget.select()} />
              </label>
              <div className="flex gap-2">
                <button type="button" className="inline-flex h-11 items-center rounded-md border border-line px-3 text-sm" onClick={onCopy}>
                  {copied ? "Copied" : "Copy link"}
                </button>
                <button type="button" className="inline-flex h-11 items-center rounded-md px-3 text-sm text-muted" onClick={onRevoke}>
                  Remove link
                </button>
              </div>
            </div>
          ) : null}
          {note ? <p className="text-sm text-muted">{note}</p> : null}
          {error ? (
            <p className="text-sm text-danger" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
