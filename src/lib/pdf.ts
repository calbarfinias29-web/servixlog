/**
 * Minimal dependency-free PDF writer.
 * Produces a real, downloadable PDF file (A4 pages) from text lines.
 *
 * TEXT COMPLET CU DIACRITICE (ex. „Ghiță"):
 *  - Când e posibil, se încarcă DejaVuSans (Unicode, conține ă/â/î/ș/ț) și se
 *    embeduieste în PDF ca font TrueType Type0 / Identity-H, cu lățimile reale
 *    din tabelul hmtx — nimic nu este scurtat sau transformat.
 *  - Fallback offline: Helvetica + transliterare diacritice (nu ștergere!).
 */

export interface PdfLine {
  text: string;
  size: number;
  bold: boolean;
  gapBefore?: number;
  color?: string;
  /** Valoare aliniată la dreapta (margine dreapta) pe aceeași linie. */
  right?: string;
  /** Offset orizontal custom (pt. coloane). Implicit MARGIN. */
  x?: number;
  /** Coloane suplimentare pe aceeași linie (tabel). */
  cols?: Array<{ text: string; x: number }>;
  /** Desenează o linie orizontală de separare în loc de text. */
  rule?: boolean;
  /** Id de tabel — pentru repetarea headerului pe pagini noi. */
  table?: string;
  /** Marchează rândurile de header ale tabelului (repetate la spargerea paginii). */
  tableHead?: boolean;
}

const A4_W = 595.28;
const A4_H = 841.89;
const MARGIN = 56;

// ============================================================
// FALLBACK: Helvetica (WinAnsi) — transliterare, NU ștergere
// ============================================================
const DIACRITICS: Record<string, string> = {
  'ă': 'a', 'â': 'a', 'î': 'i', 'ș': 's', 'ş': 's', 'ț': 't', 'ţ': 't',
  'Ă': 'A', 'Â': 'A', 'Î': 'I', 'Ș': 'S', 'Ş': 'S', 'Ț': 'T', 'Ţ': 'T',
};
function transliterate(s: string): string {
  return s.replace(/[ăâîșşțţĂÂÎȘŞȚŢ]/g, (m) => DIACRITICS[m] ?? m);
}
function esc(s: string): string {
  // WinAnsi-safe: transliterează diacriticele, apoi elimină restul non-Latin-1.
  return transliterate(s)
    .replace(/[\\()]/g, (m) => `\\${m}`)
    .replace(/\u2019/g, "'")
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '');
}

// ============================================================
// FONT UNICODE — parsare minimă TTF (cmap format 4 + hmtx)
// ============================================================
interface ParsedTtf {
  bytes: Uint8Array;
  gidFor: (charCode: number) => number;
  widthOfGid: (gid: number) => number; // unități font (UPEM)
  unitsPerEm: number;
  ascent: number;
  descent: number;
  bbox: [number, number, number, number];
  postScriptName: string;
}

export function parseTtf(buf: ArrayBuffer, postScriptName: string): ParsedTtf {
  const dv = new DataView(buf);
  const numTables = dv.getUint16(4);
  const tables: Record<string, { off: number; len: number }> = {};
  for (let i = 0; i < numTables; i++) {
    const p = 12 + i * 16;
    const tag = String.fromCharCode(dv.getUint8(p), dv.getUint8(p + 1), dv.getUint8(p + 2), dv.getUint8(p + 3));
    tables[tag] = { off: dv.getUint32(p + 8), len: dv.getUint32(p + 12) };
  }
  const unitsPerEm = dv.getUint16(tables.head.off + 18);
  const bbox: [number, number, number, number] = [
    dv.getInt16(tables.head.off + 36), dv.getInt16(tables.head.off + 38),
    dv.getInt16(tables.head.off + 40), dv.getInt16(tables.head.off + 42),
  ];
  const ascent = dv.getInt16(tables.hhea.off + 4);
  const descent = dv.getInt16(tables.hhea.off + 6);
  const numGlyphs = dv.getUint32(tables.maxp.off + 4);
  const numH = dv.getUint16(tables.hhea.off + 34);
  const widthOfGid = (gid: number): number => {
    const idx = Math.min(Math.max(gid, 0), numH - 1);
    return dv.getUint16(tables.hmtx.off + idx * 4);
  };
  const cmapOff = tables.cmap.off;
  const nSub = dv.getUint16(cmapOff + 2);
  let subOff = -1;
  for (let i = 0; i < nSub; i++) {
    const p = cmapOff + 4 + i * 8;
    const plat = dv.getUint16(p);
    const enc = dv.getUint16(p + 2);
    if ((plat === 3 && (enc === 1 || enc === 10)) || plat === 0) {
      const o = cmapOff + dv.getUint32(p + 4);
      if (dv.getUint16(o) === 4) { subOff = o; break; }
    }
  }
  const cmapLen = tables.cmap.len;
  const gidFor = (charCode: number): number => {
    if (subOff < 0) return 0;
    const segCountX2 = dv.getUint16(subOff + 6);
    const segs = segCountX2 / 2;
    const endO = subOff + 14;
    const startO = endO + segCountX2 + 2;
    const deltaO = startO + segCountX2;
    const rangeO = deltaO + segCountX2;
    let lo = 0;
    let hi = segs - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const end = dv.getUint16(endO + mid * 2);
      const start = dv.getUint16(startO + mid * 2);
      if (charCode > end) lo = mid + 1;
      else if (charCode < start) hi = mid - 1;
      else {
        const delta = dv.getInt16(deltaO + mid * 2);
        const range = dv.getUint16(rangeO + mid * 2);
        if (range === 0) return (charCode + delta) & 0xffff;
        const giOff = rangeO + mid * 2 + range + (charCode - start) * 2;
        if (giOff + 1 >= subOff + cmapLen) return 0;
        const gid = dv.getUint16(giOff);
        return gid === 0 ? 0 : (gid + delta) & 0xffff;
      }
    }
    return 0;
  };
  return { bytes: new Uint8Array(buf), gidFor, widthOfGid, unitsPerEm, ascent, descent, bbox, postScriptName };
}

const FONT_URLS = {
  regular: [
    'https://cdn.jsdelivr.net/npm/dejavu-fonts-ttf@2.37.3/ttf/DejaVuSans.ttf',
    'https://unpkg.com/dejavu-fonts-ttf@2.37.3/ttf/DejaVuSans.ttf',
  ],
  bold: [
    'https://cdn.jsdelivr.net/npm/dejavu-fonts-ttf@2.37.3/ttf/DejaVuSans-Bold.ttf',
    'https://unpkg.com/dejavu-fonts-ttf@2.37.3/ttf/DejaVuSans-Bold.ttf',
  ],
};
async function fetchFirst(urls: string[]): Promise<ArrayBuffer | null> {
  for (const u of urls) {
    try {
      const res = await fetch(u);
      if (res.ok) return await res.arrayBuffer();
    } catch { /* offline — încearcă următorul */ }
  }
  return null;
}
let fontsPromise: Promise<{ regular: ParsedTtf | null; bold: ParsedTtf | null }> | null = null;
function loadFonts(): Promise<{ regular: ParsedTtf | null; bold: ParsedTtf | null }> {
  if (!fontsPromise) {
    fontsPromise = (async () => {
      const [r, b] = await Promise.all([fetchFirst(FONT_URLS.regular), fetchFirst(FONT_URLS.bold)]);
      return {
        regular: r ? parseTtf(r, 'DejaVuSans') : null,
        bold: b ? parseTtf(b, 'DejaVuSans-Bold') : null,
      };
    })();
  }
  return fontsPromise;
}

type PdfObj = string | Uint8Array;
function bytesOf(part: PdfObj): Uint8Array {
  if (typeof part === 'string') {
    const out = new Uint8Array(part.length);
    for (let i = 0; i < part.length; i++) out[i] = part.charCodeAt(i) & 0xff;
    return out;
  }
  return part;
}

/** Generează PDF-ul, cu fonturi Unicode dacă sunt disponibile. */
async function buildAndDownload(fileName: string, lines: PdfLine[], forceLegacy: boolean): Promise<void> {
  const fonts = forceLegacy ? { regular: null, bold: null } : await loadFonts().catch(() => ({ regular: null, bold: null }));
  const useUnicode = fonts.regular != null && fonts.bold != null;

  const lineHeight = (size: number): number => size * 1.45;
  const usableH = A4_H - MARGIN * 2;
  const fontFor = (line: PdfLine): ParsedTtf | null => (useUnicode ? (line.bold ? fonts.bold : fonts.regular) : null);
  const measure = (text: string, size: number, bold: boolean): number => {
    if (!text) return 0;
    const font = bold ? fonts.bold : fonts.regular;
    if (useUnicode && font) {
      let w = 0;
      for (const ch of text) {
        const gid = font.gidFor(ch.codePointAt(0) ?? 32);
        if (gid) w += font.widthOfGid(gid);
      }
      return (w / font.unitsPerEm) * size;
    }
    return text.length * size * 0.5;
  };
  const wrapWords = (text: string, avail: number, size: number, bold: boolean): string[] => {
    const words = text.split(/\s+/).filter(Boolean);
    const out: string[] = [];
    let cur = '';
    for (const w of words) {
      const cand = cur ? `${cur} ${w}` : w;
      if (measure(cand, size, bold) <= avail || !cur) cur = cand;
      else { out.push(cur); cur = w; }
    }
    if (cur) out.push(cur);
    return out.length > 0 ? out : [''];
  };

  // Pre-procesare: împarte liniile cu coloane pe mai multe rânduri dacă textul nu încape.
  const prepared: PdfLine[] = [];
  for (const line of lines) {
    if (line.cols && line.cols.length > 0) {
      // Anti-suprapunere: fiecare coloană începe Cel târziu după lățimea REALĂ
      // măsurată a textului principal (ex. DATA / ORA) + un gap de siguranță.
      const mainEnd = MARGIN + measure(line.text, line.size, line.bold);
      const colXs = line.cols.map((c) => Math.max(c.x, mainEnd + 12));
      const wrappedCols = line.cols.map((c, i) => wrapWords(c.text, A4_W - MARGIN - colXs[i], line.size, line.bold));
      const rows = Math.max(...wrappedCols.map((w) => w.length));
      for (let k = 0; k < rows; k++) {
        prepared.push({
          ...line,
          text: k === 0 ? line.text : '',
          cols: line.cols.map((c, i) => ({ text: wrappedCols[i][k] ?? '', x: colXs[i] })).filter((c) => c.text !== ''),
          gapBefore: k === 0 ? (line.gapBefore ?? 0) : 0,
        });
      }
    } else {
      prepared.push(line);
    }
  }

  // Paginare + repetarea headerului de tabel pe pagina următoare
  const pages: PdfLine[][] = [];
  let current: PdfLine[] = [];
  let y = 0;
  const headMap = new Map<string, PdfLine[]>();
  let activeTable: string | undefined;
  for (const line of prepared) {
    const advance = (line.gapBefore ?? 0) + lineHeight(line.size);
    if (y + advance > usableH && current.length > 0) {
      pages.push(current);
      current = [];
      y = 0;
      if (activeTable) {
        const heads = headMap.get(activeTable);
        if (heads) {
          for (const h of heads) {
            const a = (h.gapBefore ?? 0) + lineHeight(h.size);
            y += a;
            current.push(h);
          }
        }
      }
    }
    y += advance;
    current.push(line);
    if (line.table) {
      activeTable = line.table;
      if (line.tableHead) {
        const arr = headMap.get(line.table) ?? [];
        if (!arr.includes(line)) arr.push(line);
        headMap.set(line.table, arr);
      }
    } else {
      activeTable = undefined;
    }
  }
  if (current.length > 0) pages.push(current);
  const pageCount = pages.length;

  // Conținut: text multi-coloană, aliniere dreapta, linii de separare
  const regularChars = new Set<number>();
  const boldChars = new Set<number>();
  const encodeHex = (font: ParsedTtf, text: string): string => {
    let hex = '';
    for (const ch of text) {
      const code = ch.codePointAt(0) ?? 32;
      hex += font.gidFor(code).toString(16).padStart(4, '0').toUpperCase();
    }
    return hex;
  };
  const contents: string[] = pages.map((pageLines) => {
    let cy = A4_H - MARGIN;
    const parts: string[] = [];
    let inText = false;
    const startText = (): void => { if (!inText) { parts.push('BT'); inText = true; } };
    const endText = (): void => { if (inText) { parts.push('ET'); inText = false; } };
    const drawAt = (txt: string, x: number, line: PdfLine): void => {
      if (!txt) return;
      const font = fontFor(line);
      parts.push(`1 0 0 1 ${x.toFixed(2)} ${cy.toFixed(2)} Tm`);
      if (font) {
        const set = line.bold ? boldChars : regularChars;
        for (const ch of txt) set.add(ch.codePointAt(0) ?? 32);
        parts.push(`<${encodeHex(font, txt)}> Tj`);
      } else {
        parts.push(`(${esc(txt)}) Tj`);
      }
    };
    for (const line of pageLines) {
      cy -= (line.gapBefore ?? 0) + lineHeight(line.size);
      if (line.rule) {
        endText();
        const ry = (cy + lineHeight(line.size) / 2).toFixed(2);
        parts.push(`0.6 w 0.78 0.80 0.84 RG ${MARGIN.toFixed(2)} ${ry} m ${(A4_W - MARGIN).toFixed(2)} ${ry} l S`);
        continue;
      }
      startText();
      parts.push(`/F${line.bold ? 2 : 1} ${line.size} Tf`);
      // Culoare de umplere EMISĂ ÎNTOTDEAUNA: fără reset, textul normal moștenește
      // ultima culoare gri/accent setată pe pagină (aspect „spălăcit"). Fără color
      // explicit → negru complet (0 0 0). Accenturile (roșu/verde/gri etichete)
      // rămân neatinse prin line.color.
      if (line.color && line.color.match(/^#[0-9A-Fa-f]{6}$/)) {
        const r = parseInt(line.color.slice(1, 3), 16) / 255;
        const g = parseInt(line.color.slice(3, 5), 16) / 255;
        const b = parseInt(line.color.slice(5, 7), 16) / 255;
        parts.push(`${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} rg`);
      } else {
        parts.push('0 0 0 rg');
      }
      drawAt(line.text, line.x ?? MARGIN, line);
      for (const c of line.cols ?? []) drawAt(c.text, c.x, line);
      if (line.right) drawAt(line.right, A4_W - MARGIN - measure(line.right, line.size, line.bold), line);
    }
    endText();
    return parts.join('\n');
  });

  const objects: PdfObj[] = [];
  objects.push('<< /Type /Catalog /Pages 2 0 R >>'); // 1
  const kids = Array.from({ length: pageCount }, (_, k) => `${3 + k * 2} 0 R`).join(' ');
  objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>`); // 2
  contents.forEach((stream, i) => {
    const pageNum = 3 + i * 2;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4_W.toFixed(2)} ${A4_H.toFixed(2)}] /Resources << /Font << /F1 ${3 + pageCount * 2} 0 R /F2 ${3 + pageCount * 2 + (useUnicode ? 4 : 1)} 0 R >> >> /Contents ${pageNum + 1} 0 R >>`);
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });

  if (useUnicode) {
    // 4 obiecte per font: Type0, CIDFontType2, FontDescriptor, FontFile2.
    for (const [font, chars] of [[fonts.regular!, regularChars], [fonts.bold!, boldChars]] as Array<[ParsedTtf, Set<number>]>) {
      const type0Num = objects.length + 1;
      const cidNum = type0Num + 1;
      const fdNum = type0Num + 2;
      const ffNum = type0Num + 3;
      const gidWidths = new Map<number, number>();
      for (const code of chars) {
        const gid = font.gidFor(code);
        if (gid !== 0) gidWidths.set(gid, Math.round((font.widthOfGid(gid) * 1000) / font.unitsPerEm));
      }
      const wParts: string[] = [];
      for (const gid of Array.from(gidWidths.keys()).sort((a, b) => a - b)) wParts.push(`${gid} [${gidWidths.get(gid)}]`);
      objects.push(`<< /Type /Font /Subtype /Type0 /BaseFont /${font.postScriptName} /Encoding /Identity-H /DescendantFonts [${cidNum} 0 R] >>`);
      objects.push(`<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${font.postScriptName} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${fdNum} 0 R /CIDToGIDMap /Identity /W [${wParts.join(' ')}] >>`);
      objects.push(`<< /Type /FontDescriptor /FontName /${font.postScriptName} /Flags 32 /FontBBox [${font.bbox.map((v) => Math.round((v * 1000) / font.unitsPerEm)).join(' ')}] /ItalicAngle 0 /Ascent ${Math.round((font.ascent * 1000) / font.unitsPerEm)} /Descent ${Math.round((font.descent * 1000) / font.unitsPerEm)} /CapHeight 700 /StemV 80 /FontFile2 ${ffNum} 0 R >>`);
      // FontFile2: UN singur obiect binar (header + font bytes + endstream).
      const ffHead = bytesOf(`<< /Length ${font.bytes.length} /Length1 ${font.bytes.length} >>\nstream\n`);
      const ffTail = bytesOf('\nendstream');
      const ff = new Uint8Array(ffHead.length + font.bytes.length + ffTail.length);
      ff.set(ffHead, 0);
      ff.set(font.bytes, ffHead.length);
      ff.set(ffTail, ffHead.length + font.bytes.length);
      objects.push(ff);
    }
  } else {
    objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  }

  // Asamblare byte-level (offseturile xref sunt în octeți)
  const header = '%PDF-1.4\n';
  const chunks: Uint8Array[] = [bytesOf(header)];
  const offsets: number[] = [];
  let total = header.length;
  objects.forEach((body, i) => {
    offsets.push(total);
    const objNumStr = `${i + 1} 0 obj\n`;
    const bodyBytes = bytesOf(body);
    const tail = '\nendobj\n';
    chunks.push(bytesOf(objNumStr), bodyBytes, bytesOf(tail));
    total += objNumStr.length + bodyBytes.length + tail.length;
  });
  const xrefStart = total;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) xref += `${off.toString().padStart(10, '0')} 00000 n \n`;
  xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  chunks.push(bytesOf(xref));

  const pdfBytes = new Uint8Array(chunks.reduce((s, c) => s + c.length, 0));
  let pos = 0;
  for (const c of chunks) { pdfBytes.set(c, pos); pos += c.length; }

  const blob = new Blob([pdfBytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName.endsWith('.pdf') ? fileName : `${fileName}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** API public — rămâne sincron pentru apelanți; descărcarea rulează async. */
export function generateReportPdf(fileName: string, lines: PdfLine[]): void {
  void buildAndDownload(fileName, lines, false).catch(() => {
    // Ultimă instanță: PDF Helvetica (transliterat) — descărcarea are prioritate.
    void buildAndDownload(fileName, lines, true).catch(() => { /* ignoră */ });
  });
}

/** Convenience helpers for report layouts */
export const title = (t: string): PdfLine => ({ text: t, size: 18, bold: true, gapBefore: 6 });
export const heading = (t: string): PdfLine => ({ text: t.toUpperCase(), size: 12.5, bold: true, gapBefore: 16 });
export const row = (label: string, value: string): PdfLine => ({ text: `${label}:  ${value}`, size: 11.5, bold: false, gapBefore: 4 });
