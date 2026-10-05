const encoder = new TextEncoder();

function text(value) {
  return encoder.encode(value);
}

function num(value) {
  return (Math.round(Number(value) * 100) / 100).toString();
}

/**
 * Build a PDF whose pages each contain one baseline JPEG.
 * `pages` items: { jpeg, imgWidth, imgHeight, pageWidth, pageHeight, drawWidth, drawHeight, offsetX, offsetY }
 */
export function encodePdf(pages) {
  if (!pages?.length) throw new Error("没有可以写入 PDF 的页面");

  const parts = [];
  let pos = 0;
  const offsets = [];

  function add(bytes) {
    parts.push(bytes);
    pos += bytes.length;
  }

  function addText(value) {
    add(text(value));
  }

  function startObj(id) {
    offsets[id] = pos;
    addText(`${id} 0 obj\n`);
  }

  function endObj() {
    addText("endobj\n");
  }

  addText("%PDF-1.4\n");
  add(new Uint8Array([0x25, 0xff, 0xff, 0xff, 0xff, 0x0a]));

  const pageObj = (index) => 3 + index * 3;
  const contentObj = (index) => 4 + index * 3;
  const imageObj = (index) => 5 + index * 3;
  const objectCount = 2 + pages.length * 3;

  startObj(1);
  addText("<< /Type /Catalog /Pages 2 0 R >>\n");
  endObj();

  const kids = pages.map((_, index) => `${pageObj(index)} 0 R`).join(" ");
  startObj(2);
  addText(`<< /Type /Pages /Count ${pages.length} /Kids [${kids}] >>\n`);
  endObj();

  pages.forEach((page, index) => {
    const pageId = pageObj(index);
    const contentId = contentObj(index);
    const imageId = imageObj(index);
    const content = `q\n${num(page.drawWidth)} 0 0 ${num(page.drawHeight)} ${num(page.offsetX)} ${num(page.offsetY)} cm\n/Im0 Do\nQ\n`;
    const contentBytes = text(content);

    startObj(pageId);
    addText(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(page.pageWidth)} ${num(page.pageHeight)}] /Contents ${contentId} 0 R /Resources << /XObject << /Im0 ${imageId} 0 R >> >> >>\n`,
    );
    endObj();

    startObj(contentId);
    addText(`<< /Length ${contentBytes.length} >>\nstream\n`);
    add(contentBytes);
    addText("endstream\n");
    endObj();

    startObj(imageId);
    addText(
      `<< /Type /XObject /Subtype /Image /Width ${page.imgWidth | 0} /Height ${page.imgHeight | 0} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`,
    );
    add(page.jpeg);
    addText("\nendstream\n");
    endObj();
  });

  const xrefAt = pos;
  addText(`xref\n0 ${objectCount + 1}\n`);
  addText("0000000000 65535 f \n");
  for (let id = 1; id <= objectCount; id += 1) {
    addText(`${String(offsets[id]).padStart(10, "0")} 00000 n \n`);
  }
  addText(`trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\n`);
  addText(`startxref\n${xrefAt}\n%%EOF`);

  const out = new Uint8Array(pos);
  let cursor = 0;
  for (const part of parts) {
    out.set(part, cursor);
    cursor += part.length;
  }
  return out;
}
