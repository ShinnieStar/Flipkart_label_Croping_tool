/* web/script.js */
/* No API; all in-browser with pdf-lib */
const btn = document.getElementById("processBtn");
const filesInput = document.getElementById("pdfs");
const modeSel = document.getElementById("mode");
const resultDiv = document.getElementById("result");
const progressDiv = document.getElementById("progress");

/* Approx shipping-label crop boxes in PDF points (origin bottom-left).
   Adjust these to match desktop tool exactly if needed. */
const BOX_LITE  = { x0: 36,  y0:110, x1:565, y1:420 };
const BOX_PROM  = { x0: 28,  y0:100, x1:570, y1:430 };

async function readFileAsArrayBuffer(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsArrayBuffer(file);
  });
}

function rectFromBox(box, pageHeight) {
  // pdf-lib expects rectangle as {x, y, width, height} from bottom-left
  const x = box.x0;
  const y = box.y0;
  const width  = box.x1 - box.x0;
  const height = box.y1 - box.y0;
  return { x, y, width, height };
}

async function cropAndMerge(files, mode) {
  const { PDFDocument } = PDFLib; // pdf-lib must be loaded via CDN
  const merged = await PDFDocument.create();
  const box = mode === "Lite" ? BOX_LITE : BOX_PROM;

  for (const f of files) {
    const srcBytes = await readFileAsArrayBuffer(f);
    const src = await PDFDocument.load(srcBytes, { ignoreEncryption: true });
    const pageCount = src.getPageCount();

    for (let i=0; i<pageCount; i++) {
      const [copiedPage] = await merged.copyPages(src, [i]);
      const media = copiedPage.getMediaBox(); // { x, y, width, height }
      const rect = rectFromBox(box, media.height);

      // Clip to shipping-label rect
      copiedPage.setCropBox(rect.x, rect.y, rect.width, rect.height);
      // Optional: also set media box to crop box to strictly reduce page size
      copiedPage.setMediaBox(rect.x, rect.y, rect.width, rect.height);

      merged.addPage(copiedPage);
    }
  }

  const mergedBytes = await merged.save();
  return mergedBytes;
}

function makeCSVBlob(headers, rows) {
  const parts = [headers.join(",")];
  for (const r of rows) parts.push(r.map(v => String(v ?? "")).join(","));
  return new Blob([parts.join("\n")], { type: "text/csv" });
}

async function buildZip(mergedPdf, mode) {
  const zip = new JSZip();
  zip.file("cropped_labels_merged.pdf", mergedPdf);

  if (mode === "Pro Max") {
    // Placeholders; hook for real parsing later
    zip.file("order.csv", makeCSVBlob(["order_id","page_no","qty"], []));
    zip.file("sku.csv",   makeCSVBlob(["sku","count"], []));
  }

  const content = await zip.generateAsync({ type: "blob" });
  return content;
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click();
  a.remove(); URL.revokeObjectURL(url);
}

async function ensureLibs() {
  // Load pdf-lib and jszip via CDN only once
  if (!window.PDFLib) {
    await new Promise((r) => {
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js";
      s.onload = r; document.body.appendChild(s);
    });
  }
  if (!window.JSZip) {
    await new Promise((r) => {
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js";
      s.onload = r; document.body.appendChild(s);
    });
  }
}

btn.addEventListener("click", async () => {
  const files = filesInput.files;
  if (!files || files.length === 0) {
    resultDiv.textContent = "Please select at least one PDF.";
    return;
  }

  try {
    progressDiv.textContent = "Processing in browser...";
    await ensureLibs();

    const mode = modeSel.value;
    const mergedPdf = await cropAndMerge(Array.from(files), mode);
    const zipBlob = await buildZip(mergedPdf, mode);

    downloadBlob(zipBlob, "flipkart_cropped.zip");
    progressDiv.textContent = "Done.";
    resultDiv.textContent = "Downloaded: flipkart_cropped.zip";
  } catch (e) {
    progressDiv.textContent = "";
    resultDiv.textContent = "Failed: " + e.message;
  }
});
