/**
 * A photo of a score becomes a one-page PDF (the photo as a JPEG inside), so it is kept, viewed, annotated and converted exactly like any other PDF.
 * The page is sized so that 300 dpi gives the photo's own pixels (what the recognition engines render the PDF at).
 */
const enc = new TextEncoder();

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** a PDF with one page that shows this JPEG (width x height pixels) */
export function jpegToPdf(jpeg: Uint8Array, width: number, height: number): Uint8Array {
  const w = +(width * 72 / 300).toFixed(2);
  const h = +(height * 72 / 300).toFixed(2);
  const objs: Uint8Array[] = [];
  const text = (s: string) => enc.encode(s);
  objs.push(text("<< /Type /Catalog /Pages 2 0 R >>"));
  objs.push(text("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"));
  objs.push(text(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`));
  objs.push(concat([text(`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`), jpeg, text("\nendstream")]));
  const content = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`;
  objs.push(text(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`));
  const parts: Uint8Array[] = [text("%PDF-1.4\n")];
  const offsets: number[] = [];
  let pos = parts[0].length;
  objs.forEach((o, i) => {
    offsets.push(pos);
    const head = text(`${i + 1} 0 obj\n`);
    const tail = text("\nendobj\n");
    parts.push(head, o, tail);
    pos += head.length + o.length + tail.length;
  });
  const xref = [`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`, ...offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`)].join("");
  parts.push(text(xref + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${pos}\n%%EOF\n`));
  return concat(parts);
}

/** Photo (png, jpg, tif, bmp ...) -> PDF file with the same name. The browser decodes it (and turns it upright when the camera says so). */
export async function imageToPdf(file: File, maxSide = 4800): Promise<File> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * k));
  const h = Math.max(1, Math.round(bmp.height * k));
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h); // transparent pixels become white paper
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  const blob: Blob = await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("toBlob"))), "image/jpeg", 0.92));
  const pdf = jpegToPdf(new Uint8Array(await blob.arrayBuffer()), w, h);
  return new File([pdf as unknown as BlobPart], file.name.replace(/\.[^.]+$/, "") + ".pdf", { type: "application/pdf" });
}
