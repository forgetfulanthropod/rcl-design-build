/**
 * A small, dependency-free PDF writer for the daily report download: Helvetica text (WinAnsi),
 * JPEG photos embedded as-is (DCTDecode), US Letter pages. Pure: no DOM and no Node APIs, so it
 * runs in the browser (where the report PDF is built, so big photo sets never pass through a
 * serverless response) and under node:test. Content streams are uncompressed on purpose: the
 * words in the PDF are the words in the file, which keeps it simple and testable.
 */

// ---------- text encoding and metrics ----------

const WIN_ANSI_EXTRA: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87,
  0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91,
  0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98,
  0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
};
const SPACES = new Set([0x00a0, 0x2007, 0x2009, 0x200a, 0x202f, 0x205f, 0x3000, 0x2002, 0x2003]);

/** Map a string to WinAnsi byte codes (what the standard Helvetica fonts can show). Others become "?". */
export function toWinAnsi(value: string): number[] {
  const out: number[] = [];
  for (const ch of value.normalize("NFC")) {
    const c = ch.codePointAt(0)!;
    if (c === 0x09) out.push(0x20);
    else if (SPACES.has(c)) out.push(0x20);
    else if (c >= 0x20 && c <= 0x7e) out.push(c);
    else if (c >= 0xa1 && c <= 0xff) out.push(c);
    else if (WIN_ANSI_EXTRA[c]) out.push(WIN_ANSI_EXTRA[c]);
    else if (c === 0x200b || c === 0xfe0f || c === 0x200d) continue; // zero-width / emoji joiners
    else out.push(0x3f);
  }
  return out;
}

// Helvetica advance widths (1/1000 em) for ASCII 32..126; anything else uses 556.
const HELV = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556,
  556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556,
  556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

export function textWidth(value: string, size: number, bold = false): number {
  let units = 0;
  for (const c of toWinAnsi(value)) units += c >= 32 && c <= 126 ? HELV[c - 32] : 556;
  return (units * size * (bold ? 1.06 : 1)) / 1000;
}

/** Word-wrap to a width; keeps blank lines; breaks words longer than a line. */
export function wrapText(value: string, size: number, maxWidth: number, bold = false): string[] {
  const lines: string[] = [];
  for (const para of value.replace(/\r\n?/g, "\n").split("\n")) {
    const words = para.split(/[ \t]+/).filter(Boolean);
    if (words.length === 0) {
      lines.push("");
      continue;
    }
    let line = "";
    for (let word of words) {
      while (textWidth(word, size, bold) > maxWidth) {
        let cut = word.length - 1;
        while (cut > 1 && textWidth(word.slice(0, cut), size, bold) > maxWidth) cut -= 1;
        if (line) {
          lines.push(line);
          line = "";
        }
        lines.push(word.slice(0, cut));
        word = word.slice(cut);
      }
      const next = line ? `${line} ${word}` : word;
      if (textWidth(next, size, bold) <= maxWidth) line = next;
      else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  return lines;
}

/** A PDF literal string: ( ) \ escaped, bytes above 126 as octal escapes. */
export function pdfString(value: string): string {
  let out = "(";
  for (const c of toWinAnsi(value)) {
    if (c === 0x28 || c === 0x29 || c === 0x5c) out += `\\${String.fromCharCode(c)}`;
    else if (c > 126) out += `\\${c.toString(8).padStart(3, "0")}`;
    else out += String.fromCharCode(c);
  }
  return `${out})`;
}

// ---------- JPEG ----------

export type JpegInfo = { width: number; height: number; components: number };

/** Read a baseline/progressive JPEG's size and colour components from its SOF marker. */
export function jpegInfo(bytes: Uint8Array): JpegInfo | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1];
    if (marker === 0xff) {
      i += 1;
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    const sof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (sof) {
      const height = (bytes[i + 5] << 8) | bytes[i + 6];
      const width = (bytes[i + 7] << 8) | bytes[i + 8];
      const components = bytes[i + 9];
      if (!width || !height || ![1, 3, 4].includes(components)) return null;
      return { width, height, components };
    }
    if (marker === 0xda || len < 2) return null;
    i += 2 + len;
  }
  return null;
}

// ---------- document ----------

export const PAGE = { width: 612, height: 792, margin: 50 } as const;

type Image = { name: string; bytes: Uint8Array; info: JpegInfo };

class Page {
  ops: string[] = [];
  images = new Set<string>();
}

const n = (v: number) => (Math.round(v * 100) / 100).toString();

/** Minimal page-flow layout: a cursor that moves down the page and starts a new page when full. */
export class PdfDoc {
  pages: Page[] = [];
  private images: Image[] = [];
  y = 0;
  constructor() {
    this.addPage();
  }
  get page(): Page {
    return this.pages[this.pages.length - 1];
  }
  get contentWidth() {
    return PAGE.width - PAGE.margin * 2;
  }
  addPage() {
    this.pages.push(new Page());
    this.y = PAGE.height - PAGE.margin;
  }
  /** Start a new page unless `height` more points fit above the footer. */
  ensure(height: number) {
    if (this.y - height < PAGE.margin + 20) this.addPage();
  }
  text(x: number, y: number, value: string, size: number, opts: { bold?: boolean; gray?: number } = {}) {
    const g = opts.gray ?? 0.1;
    this.page.ops.push(`BT /${opts.bold ? "F2" : "F1"} ${n(size)} Tf ${n(g)} g ${n(x)} ${n(y)} Td ${pdfString(value)} Tj ET`);
  }
  /** Wrapped paragraph at the cursor, flowing across pages. */
  paragraph(value: string, size: number, opts: { bold?: boolean; gray?: number; leading?: number; indent?: number } = {}) {
    const leading = opts.leading ?? size * 1.4;
    const indent = opts.indent ?? 0;
    for (const line of wrapText(value, size, this.contentWidth - indent, opts.bold)) {
      this.ensure(leading);
      this.y -= leading;
      if (line) this.text(PAGE.margin + indent, this.y + (leading - size) / 2, line, size, opts);
    }
  }
  rule(gray = 0.8) {
    this.ensure(10);
    this.y -= 6;
    this.page.ops.push(`${n(gray)} G 0.75 w ${n(PAGE.margin)} ${n(this.y)} m ${n(PAGE.width - PAGE.margin)} ${n(this.y)} l S`);
    this.y -= 6;
  }
  gap(points: number) {
    this.y -= points;
  }
  /** Height a JPEG will take at the cursor (null if it isn't a JPEG). */
  jpegHeight(bytes: Uint8Array, maxHeight = 340): number | null {
    const info = jpegInfo(bytes);
    if (!info) return null;
    return info.height * Math.min(1, this.contentWidth / info.width, maxHeight / info.height);
  }
  /** Embed a JPEG at the cursor, scaled to fit. Returns false (and draws nothing) if it isn't a JPEG. */
  jpeg(bytes: Uint8Array, maxHeight = 340): boolean {
    const info = jpegInfo(bytes);
    if (!info) return false;
    const scale = Math.min(1, this.contentWidth / info.width, maxHeight / info.height);
    const w = info.width * scale;
    const h = info.height * scale;
    this.ensure(h + 4);
    const name = `Im${this.images.length + 1}`;
    this.images.push({ name, bytes, info });
    this.y -= h;
    this.page.images.add(name);
    this.page.ops.push(`q ${n(w)} 0 0 ${n(h)} ${n(PAGE.margin)} ${n(this.y)} cm /${name} Do Q`);
    this.y -= 4;
    return true;
  }

  /** Serialise. `footer(i, total)` is drawn at the bottom of every page. */
  render(meta: { title: string; footer?: (page: number, total: number) => string }): Uint8Array {
    const total = this.pages.length;
    if (meta.footer) {
      this.pages.forEach((p, i) => {
        p.ops.push(`BT /F1 8 Tf 0.45 g ${n(PAGE.margin)} ${n(PAGE.margin - 22)} Td ${pdfString(meta.footer!(i + 1, total))} Tj ET`);
      });
    }
    const chunks: Uint8Array[] = [];
    let length = 0;
    const offsets: number[] = [];
    const push = (part: string | Uint8Array) => {
      const bytes = typeof part === "string" ? latin1(part) : part;
      chunks.push(bytes);
      length += bytes.length;
    };
    // Object numbers: 1 catalog, 2 pages, 3 F1, 4 F2, 5 info, then images, then page+content pairs.
    const imageBase = 6;
    const pageBase = imageBase + this.images.length;
    const imageNum = new Map(this.images.map((img, i) => [img.name, imageBase + i]));
    const obj = (num: number, body: string | (() => void)) => {
      offsets[num] = length;
      push(`${num} 0 obj\n`);
      if (typeof body === "string") push(body);
      else body();
      push("\nendobj\n");
    };
    push("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n");
    const kids = this.pages.map((_, i) => `${pageBase + i * 2} 0 R`).join(" ");
    obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
    obj(2, `<< /Type /Pages /Kids [${kids}] /Count ${total} >>`);
    obj(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
    obj(4, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
    obj(5, `<< /Title ${pdfString(meta.title)} /Producer (RCL Design Build) >>`);
    this.images.forEach((img, i) => {
      const space = img.info.components === 1 ? "/DeviceGray" : img.info.components === 4 ? "/DeviceCMYK" : "/DeviceRGB";
      const decode = img.info.components === 4 ? " /Decode [1 0 1 0 1 0 1 0]" : "";
      obj(imageBase + i, () => {
        push(
          `<< /Type /XObject /Subtype /Image /Width ${img.info.width} /Height ${img.info.height} /ColorSpace ${space}` +
            ` /BitsPerComponent 8 /Filter /DCTDecode${decode} /Length ${img.bytes.length} >>\nstream\n`,
        );
        push(img.bytes);
        push("\nendstream");
      });
    });
    this.pages.forEach((p, i) => {
      const num = pageBase + i * 2;
      const xobjects = [...p.images].map((name) => `/${name} ${imageNum.get(name)} 0 R`).join(" ");
      obj(
        num,
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE.width} ${PAGE.height}] /Contents ${num + 1} 0 R` +
          ` /Resources << /Font << /F1 3 0 R /F2 4 0 R >>${xobjects ? ` /XObject << ${xobjects} >>` : ""} >> >>`,
      );
      const content = latin1(p.ops.join("\n"));
      obj(num + 1, () => {
        push(`<< /Length ${content.length} >>\nstream\n`);
        push(content);
        push("\nendstream");
      });
    });
    const count = pageBase + total * 2;
    const xref = length;
    let table = `xref\n0 ${count}\n0000000000 65535 f \n`;
    for (let i = 1; i < count; i += 1) table += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
    push(table);
    push(`trailer\n<< /Size ${count} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    const out = new Uint8Array(length);
    let at = 0;
    for (const c of chunks) {
      out.set(c, at);
      at += c.length;
    }
    return out;
  }
}

function latin1(value: string): Uint8Array {
  const out = new Uint8Array(value.length);
  for (let i = 0; i < value.length; i += 1) out[i] = value.charCodeAt(i) & 0xff;
  return out;
}

/**
 * The text drawn in a PDF this module wrote (one string per Tj, in page order), decoded back
 * from WinAnsi. For tests and checks; it reads only uncompressed content streams.
 */
export function extractPdfText(bytes: Uint8Array): string[] {
  let raw = "";
  for (let i = 0; i < bytes.length; i += 1) raw += String.fromCharCode(bytes[i]);
  const out: string[] = [];
  // Only text this writer drew: "BT /F1 12 Tf 0.1 g 50 700 Td (...) Tj ET" (never image bytes).
  const re = /BT \/F[12] [\d.]+ Tf [\d.]+ g [\d.-]+ [\d.-]+ Td \(((?:\\.|[^\\)])*)\) Tj ET/g;
  for (const m of raw.matchAll(re)) {
    const lit = m[1];
    out.push(
      lit.replace(/\\([0-7]{3}|.)/g, (_, esc: string) => (esc.length === 3 ? decodeWinAnsi(parseInt(esc, 8)) : esc)),
    );
  }
  return out;
}

const FROM_EXTRA = new Map(Object.entries(WIN_ANSI_EXTRA).map(([u, b]) => [b, String.fromCodePoint(Number(u))]));
function decodeWinAnsi(code: number): string {
  return FROM_EXTRA.get(code) ?? String.fromCharCode(code);
}
