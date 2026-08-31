/**
 * Minimal dependency-free PDF writer.
 * Produces a real, downloadable PDF file (A4 pages, Helvetica) from text lines.
 */

export interface PdfLine { text: string; size: number; bold: boolean; gapBefore?: number }

const A4_W = 595.28;
const A4_H = 841.89;
const MARGIN = 56;

function esc(s: string): string {
  // WinAnsi-safe: strip anything outside Latin-1 to keep the PDF valid.
  return s
    .replace(/[\\()]/g, (m) => `\\${m}`)
    .replace(/\u2019/g, "'")
    .replace(/[\u0102-\u021B]/g, '')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '');
}

export function generateReportPdf(fileName: string, lines: PdfLine[]): void {
  const lineHeight = (size: number): number => size * 1.45;
  const usableH = A4_H - MARGIN * 2;

  // Paginate
  const pages: PdfLine[][] = [];
  let current: PdfLine[] = [];
  let y = 0;
  for (const line of lines) {
    const advance = (line.gapBefore ?? 0) + lineHeight(line.size);
    if (y + advance > usableH && current.length > 0) {
      pages.push(current);
      current = [];
      y = 0;
    }
    y += advance;
    current.push(line);
  }
  if (current.length > 0) pages.push(current);

  // Build content streams
  const contents = pages.map((pageLines) => {
    let cy = A4_H - MARGIN;
    const parts: string[] = ['BT'];
    for (const line of pageLines) {
      cy -= (line.gapBefore ?? 0) + lineHeight(line.size);
      parts.push(`/F${line.bold ? 2 : 1} ${line.size} Tf`);
      parts.push(`1 0 0 1 ${MARGIN.toFixed(2)} ${cy.toFixed(2)} Tm`);
      parts.push(`(${esc(line.text)}) Tj`);
    }
    parts.push('ET');
    return parts.join('\n');
  });

  // Assemble PDF objects
  const objects: string[] = [];
  const pageCount = pages.length;
  const kids = Array.from({ length: pageCount }, (_, k) => `${3 + k * 2} 0 R`).join(' ');
  objects.push('<< /Type /Catalog /Pages 2 0 R >>'); // 1
  objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>`); // 2
  contents.forEach((stream, i) => {
    const pageNum = 3 + i * 2;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4_W.toFixed(2)} ${A4_H.toFixed(2)}] /Resources << /Font << /F1 ${3 + pageCount * 2} 0 R /F2 ${3 + pageCount * 2 + 1} 0 R >> >> /Contents ${pageNum + 1} 0 R >>`); // page
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`); // content
  });
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((off) => { pdf += `${off.toString().padStart(10, '0')} 00000 n \n`; });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  const bytes = new Uint8Array(pdf.length);
  for (let i = 0; i < pdf.length; i++) bytes[i] = pdf.charCodeAt(i) & 0xff;
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName.endsWith('.pdf') ? fileName : `${fileName}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Convenience helpers for report layouts */
export const title = (t: string): PdfLine => ({ text: t, size: 18, bold: true, gapBefore: 6 });
export const heading = (t: string): PdfLine => ({ text: t.toUpperCase(), size: 11, bold: true, gapBefore: 16 });
export const row = (label: string, value: string): PdfLine => ({ text: `${label}:  ${value}`, size: 10.5, bold: false, gapBefore: 4 });
