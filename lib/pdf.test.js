import { encodePdf } from "./pdf.js";

function latin1(bytes) {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return text;
}

const jpeg = Uint8Array.from(atob(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlZ2P/2wBDARESEhgVGC8aGi9jQjhCY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2P/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwAA//2Q==",
), (char) => char.charCodeAt(0));

const pdf = encodePdf([
  {
    jpeg,
    imgWidth: 1,
    imgHeight: 1,
    pageWidth: 100,
    pageHeight: 140,
    drawWidth: 80,
    drawHeight: 80,
    offsetX: 10,
    offsetY: 30,
  },
  {
    jpeg,
    imgWidth: 1,
    imgHeight: 1,
    pageWidth: 100,
    pageHeight: 80,
    drawWidth: 80,
    drawHeight: 40,
    offsetX: 10,
    offsetY: 20,
  },
]);

const text = latin1(pdf);
let failed = 0;
function check(condition, name) {
  if (!condition) {
    failed += 1;
    console.error(`FAIL ${name}`);
  }
}

check(text.startsWith("%PDF-1.4"), "header");
check(text.includes("/Filter /DCTDecode"), "jpeg filter");
check(text.includes("/Count 2"), "two pages");
check((text.match(/\/Im0 Do/g) || []).length === 2, "two images drawn");
check(text.includes(latin1(jpeg)), "jpeg bytes preserved");

const xref = text.indexOf("xref\n");
const start = Number(text.match(/startxref\n(\d+)/)[1]);
check(start === xref, "startxref points at xref");
check(text.trimEnd().endsWith("%%EOF"), "eof");

let thrown = false;
try {
  encodePdf([]);
} catch {
  thrown = true;
}
check(thrown, "empty pdf rejected");

if (failed) {
  console.error(`${failed} failed`);
  process.exit(1);
}
console.log("pdf ok");
