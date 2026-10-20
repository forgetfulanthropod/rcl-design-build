import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { getReportPhoto } from "@/lib/server/fns";
import { userMovedFocus } from "@/lib/focus";

/**
 * Thumbnail that opens the full-size photo (fetched through the authenticated server fn).
 * The viewer is a Radix dialog: Escape closes it, focus stays inside while open and goes back
 * to the thumbnail on close, and the page behind doesn't scroll. Clicking the backdrop closes it;
 * clicking the photo itself doesn't.
 */
export function PhotoThumb({ id, thumb, alt }: { id: string; thumb: string; alt: string }) {
  const [full, setFull] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    setError("");
    if (full) return;
    try {
      setFull((await getReportPhoto({ data: { id } })).url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not open the photo.");
    }
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) void load();
      }}
    >
      <Dialog.Trigger asChild>
        <button type="button" data-photo-id={id} aria-label={`Open ${alt}`} className="block">
          <img src={thumb} alt={alt} loading="lazy" className="aspect-square w-full rounded-md object-cover" />
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/90" />
        <Dialog.Content
          data-testid="photo-viewer"
          aria-describedby={undefined}
          className="fixed inset-0 z-50 grid place-items-center p-3 outline-none"
          onClick={() => setOpen(false)}
          onCloseAutoFocus={(event) => {
            // Radix returns focus to the thumbnail a tick after close. If the user has already
            // moved on (e.g. tapped "Your day"), don't pull focus back: that blur would fire the
            // report's autosave and the field would lose the keyboard mid-word.
            if (!userMovedFocus(document.activeElement)) return;
            event.preventDefault();
          }}
        >
          <Dialog.Title className="sr-only">{alt}</Dialog.Title>
          {full ? (
            <img
              src={full}
              alt={alt}
              data-testid="photo-full"
              className="max-h-[85dvh] max-w-full rounded-md object-contain"
              onClick={(event) => event.stopPropagation()}
            />
          ) : (
            <p className="text-base text-fg" onClick={(event) => event.stopPropagation()}>
              {error || "Opening photo…"}
            </p>
          )}
          <Dialog.Close asChild>
            <button
              type="button"
              autoFocus
              className="absolute right-3 top-3 inline-flex h-12 min-w-12 items-center justify-center rounded-md border border-line bg-surface px-4 text-base text-fg"
              onClick={(event) => event.stopPropagation()}
            >
              Close
            </button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
