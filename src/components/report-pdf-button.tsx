import { useState } from "react";
import { downloadReportPdf, type PdfTarget } from "@/lib/report-pdf-download";

/**
 * "Download PDF". `before` runs first (the editor saves unsaved text so the PDF has it).
 * Not rendered at all when the viewer can't download; see `PdfOffHint`.
 */
export function ReportPdfButton({
  target,
  before,
  className = "",
}: {
  target: PdfTarget;
  before?: () => Promise<void>;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <div className={className}>
      <button
        type="button"
        className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-md border border-line bg-raised px-4 text-base font-medium text-fg disabled:opacity-60"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            await before?.();
            await downloadReportPdf(target);
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : "Could not make the PDF.");
          } finally {
            setBusy(false);
          }
        }}
      >
        <span aria-hidden="true">⤓</span> {busy ? "Preparing PDF…" : "Download PDF"}
      </button>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
