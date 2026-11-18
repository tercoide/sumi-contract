// A small PDF writer for the reports (port of PdfDoc): A4 pages, portrait or landscape, text in Helvetica and
// Helvetica-Bold (the PDF base fonts: nothing to embed), lines and filled rectangles, colors. Coordinates in
// millimetres from the top left of the page. Text goes as Windows-1252 (Spanish accents and ñ); text widths use
// Helvetica's metrics, so numbers can be aligned to the right and long texts cut.

export const A4W = 210;
export const A4H = 297;

// Helvetica widths, 1/1000 em, characters 32 to 126
const WIDTHS = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const BOLD_WIDTHS = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];

// Windows-1252's characters 128 to 159 (the rest of 160-255 is Latin-1)
const CP1252 = "€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008DŽ\u008F\u0090‘’“”•–—˜™š›œ\u009DžŸ";

/** The Windows-1252 code of each character ("?" for those it doesn't have) */
function latin(s: string): number[] {
  const out: number[] = [];
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c < 128 || (c >= 160 && c <= 255)) out.push(c);
    else {
      const i = CP1252.indexOf(ch);
      out.push(i >= 0 ? 128 + i : 63);
    }
  }
  return out;
}

const num = (f: number) => String(Math.round(f * 1000) / 1000);
const pt = (mm: number) => (mm * 72) / 25.4;

function rgb(color: number): string {
  return `${num(((color >> 16) & 255) / 255)} ${num(((color >> 8) & 255) / 255)} ${num((color & 255) / 255)}`;
}

export class PdfDoc {
  landscape: boolean;
  footer = ""; // written at the foot of every page when saving: &1 the page, &2 how many
  private pages: string[] = []; // the content stream of each page (characters 0-255)
  private page = "";
  private open = false;

  constructor(landscape = false) {
    this.landscape = landscape;
  }

  pageW(): number {
    return this.landscape ? A4H : A4W;
  }

  pageH(): number {
    return this.landscape ? A4W : A4H;
  }

  pageCount(): number {
    return this.pages.length + (this.open ? 1 : 0);
  }

  newPage(): void {
    if (this.open) this.pages.push(this.page);
    this.page = "";
    this.open = true;
  }

  private emit(s: string): void {
    if (!this.open) this.newPage();
    this.page += s + "\n";
  }

  private x(f: number): string {
    return num(pt(f));
  }

  private y(f: number): string {
    return num(pt(this.pageH() - f));
  }

  /** The width of a text in mm at size points */
  textWidth(text: string, size: number, bold = false): number {
    let units = 0;
    for (const c of latin(text)) units += c >= 32 && c <= 126 ? (bold ? BOLD_WIDTHS : WIDTHS)[c - 32] : 556;
    return (((units / 1000) * size) / 72) * 25.4;
  }

  /** The text cut to fit width mm, with "..." when it doesn't */
  fit(text: string, width: number, size: number, bold = false): string {
    if (this.textWidth(text, size, bold) <= width) return text;
    let s = [...text];
    while (s.length > 1 && this.textWidth(s.join("") + "...", size, bold) > width) s = s.slice(0, -1);
    return s.join("") + "...";
  }

  /** Text at x, y (the baseline, mm from the top). align: "l", "r" (x is the right end) or "c" (x is the middle) */
  text(x: number, y: number, text: string, size = 9, bold = false, align = "l", color = 0x000000): void {
    if (!text) return;
    if (align === "r") x -= this.textWidth(text, size, bold);
    else if (align === "c") x -= this.textWidth(text, size, bold) / 2;
    let s = "";
    for (const c of latin(text)) {
      const ch = String.fromCharCode(c);
      s += ch === "\\" || ch === "(" || ch === ")" ? "\\" + ch : ch;
    }
    this.emit(`BT ${rgb(color)} rg /${bold ? "F2" : "F1"} ${num(size)} Tf ${this.x(x)} ${this.y(y)} Td (${s}) Tj ET`);
  }

  line(x1: number, y1: number, x2: number, y2: number, width = 0.2, color = 0x000000): void {
    this.emit(`${rgb(color)} RG ${num(pt(width))} w ${this.x(x1)} ${this.y(y1)} m ${this.x(x2)} ${this.y(y2)} l S`);
  }

  /** A filled rectangle (x, y the top left corner) */
  box(x: number, y: number, w: number, h: number, color: number): void {
    this.emit(`${rgb(color)} rg ${this.x(x)} ${this.y(y + h)} ${num(pt(w))} ${num(pt(h))} re f`);
  }

  /** The file */
  bytes(): Uint8Array {
    if (this.open) {
      this.pages.push(this.page);
      this.open = false;
    }
    if (this.pages.length === 0) this.pages.push("");
    if (this.footer) {
      const n = this.pages.length;
      for (let i = 0; i < n; i++) {
        this.page = "";
        this.open = true;
        this.text(this.pageW() - 15, this.pageH() - 8, this.footer.replace("&1", String(i + 1)).replace("&2", String(n)), 7, false, "r", 0x808080);
        this.pages[i] += this.page;
        this.open = false;
      }
    }
    const mediaBox = `[0 0 ${num(pt(this.pageW()))} ${num(pt(this.pageH()))}]`;
    // 1 catalog, 2 pages, 3 and 4 fonts, then each page and its content
    const first = 5;
    const objects: string[] = [];
    const kids = this.pages.map((_, i) => `${first + i * 2} 0 R`).join(" ");
    objects.push("<< /Type /Catalog /Pages 2 0 R >>");
    objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${this.pages.length} >>`);
    objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
    objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
    this.pages.forEach((stream, i) => {
      objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox ${mediaBox} /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${first + i * 2 + 1} 0 R >>`);
      objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}endstream`);
    });
    // every character is one byte (0-255), so lengths and offsets are the string's
    let out = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
    const offsets: number[] = [];
    objects.forEach((o, i) => {
      offsets.push(out.length);
      out += `${i + 1} 0 obj\n${o}\nendobj\n`;
    });
    const xref = out.length;
    out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const o of offsets) out += String(o).padStart(10, "0") + " 00000 n \n";
    out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    const bytes = new Uint8Array(out.length);
    for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i);
    return bytes;
  }
}
