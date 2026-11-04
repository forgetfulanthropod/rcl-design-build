import { useRef, useState } from "react";
import { isPhotoFile } from "@/lib/photo-upload";

/** Drop zone and a pick-files button. Several photos at once, including iPhone HEIC. */
export function PhotoDrop({ busy, onFiles }: { busy: boolean; onFiles: (files: File[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [skipped, setSkipped] = useState("");

  function take(list: FileList | File[]) {
    const all = [...list];
    const photos = all.filter(isPhotoFile);
    const skip = all.length - photos.length;
    setSkipped(skip === 0 ? "" : skip === 1 ? "Skipped a file that isn't a photo." : `Skipped ${skip} files that aren't photos.`);
    if (photos.length) onFiles(photos);
  }

  return (
    <section
      data-testid="photo-drop"
      aria-label="Add photos"
      className={`rounded-md border border-dashed p-4 ${over ? "border-pine bg-raised" : "border-line bg-surface"}`}
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        take(event.dataTransfer.files);
      }}
    >
      <p className="text-sm font-medium">Drop photos here</p>
      <p className="mt-1 text-sm text-muted">Several at once, including iPhone HEIC. Each photo gets a caption.</p>
      <button
        type="button"
        className="mt-3 inline-flex h-12 items-center rounded-md bg-[#1f8a4c] px-4 text-sm font-semibold text-white disabled:opacity-60"
        disabled={busy}
        onClick={() => input.current?.click()}
      >
        {busy ? "Adding photos…" : "Choose photos"}
      </button>
      {skipped ? <p className="mt-2 text-sm text-danger">{skipped}</p> : null}
      <input
        ref={input}
        data-testid="photo-input"
        type="file"
        accept="image/*,.heic,.heif"
        multiple
        className="sr-only"
        onChange={(event) => {
          if (event.target.files) take(event.target.files);
          event.target.value = "";
        }}
      />
    </section>
  );
}
