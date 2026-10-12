import { useState } from "react";
import { getReportPhoto } from "@/lib/server/fns";

/** Thumbnail that opens the full-size photo (fetched through the authenticated server fn). */
export function PhotoThumb({ id, thumb, alt }: { id: string; thumb: string; alt: string }) {
  const [full, setFull] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  return (
    <>
      <button
        type="button"
        data-photo-id={id}
        aria-label={`Open ${alt}`}
        className="block"
        onClick={async () => {
          setOpen(true);
          setError("");
          if (!full) {
            try {
              setFull((await getReportPhoto({ data: { id } })).url);
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : "Could not open the photo.");
            }
          }
        }}
      >
        <img src={thumb} alt={alt} loading="lazy" className="aspect-square w-full rounded-md object-cover" />
      </button>
      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={alt}
          className="fixed inset-0 z-50 grid place-items-center bg-black/90 p-3"
          onClick={() => setOpen(false)}
        >
          {full ? (
            <img src={full} alt={alt} data-testid="photo-full" className="max-h-[85dvh] max-w-full rounded-md object-contain" />
          ) : (
            <p className="text-base text-fg">{error || "Opening photo…"}</p>
          )}
          <button type="button" className="mt-3 h-12 rounded-md border border-line px-6 text-base text-fg" onClick={() => setOpen(false)}>
            Close
          </button>
        </div>
      ) : null}
    </>
  );
}
