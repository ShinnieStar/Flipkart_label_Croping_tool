/* Pure browser version: crop + merge + CSV (Pro Max) */
const btn = document.getElementById("processBtn");
const filesInput = document.getElementById("pdfs");
const modeSel = document.getElementById("mode");
const resultDiv = document.getElementById("result");
const progressDiv = document.getElementById("progress");

/* Replace these with your desktop tool's exact coordinates if needed.
   Units: PDF points. Origin: bottom-left. */
const BOX_LITE  = { x0: 42,  y0:118, x1:566, y1:422 };  // Lite shipping-label box
const BOX_PROM  = { x0: 30,  y0:104, x1:572, y1:432 };  // Pro Max shipping-label box

/* Lightweight patterns for Flipkart labels; refine to your desktop regex */
const ORDER_ID_RE = /\b(?:OD|FM|FN|FL|FOD)[A-Z0-9-]{6,}\b/i;
const SKU_RE      = /\bSKU[:\s-]*([A-Z0-9_-]{3,})\b/i;

async function ensureLibs() {
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

async function loadPDFJS() {
  if (window.pdfjsLib) return;
  await new Promise(r => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.5.136/build/pdf.min.js";
    s.onload = r; document.body.appendChild(s);
  });
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.5.136/build/pdf.worker.min.js";
}

async function readFileAsArrayBuffer(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsArrayBuffer(file);
  });
}

function rectFromBox(box) {
  const x = box.x0, y = box.y0;
  const width = box.x1 - box.x0;
  const height = box.y1 - box.y0;
  return { x, y, width, height };
}

async function cropAndMerge(files, mode) {
  const { PDFDocument } = PDFLib;
  const merged = await PDFDocument.create();
  const box = mode === "Lite" ? BOX_LITE : BOX_PROM;

  for (const f of files) {
    const srcBytes = await readFileAsArrayBuffer(f);
    const src = await PDFDocument.load(srcBytes, { ignoreEncryption: true });
    const pageCount = src.getPageCount();

    for (let i=0; i<pageCount; i++) {
      const [copiedPage] = await merged.copyPages(src, [i]);
      const rect = rectFromBox(box);
      // Crop to shipping label
      copiedPage.setCropBox(rect.x, rect.y, rect.width, rect.height);
      // Tight page size to label
      copiedPage.setMediaBox(rect.x, rect.y, rect.width, rect.height);
      merged.addPage(copiedPage);
    }
  }

  const mergedBytes = await merged.save();
  return mergedBytes;
}

async function extractTextWithPDFJS(arrayBuffer) {
  await loadPDFJS();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const pages = [];
  for (let i=1; i<=pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const txt = await page.getTextContent();
    const str = txt.items.map(it => it.str).join(" ");
    pages.push(str);
  }
  return pages;
}

function parseOrdersAndSkus(pageTexts) {
  const orderRows = []; // [order_id, page_no, qty]
  const skuCount = new Map();
  pageTexts.forEach((t, idx) => {
    const pno = idx+1;
    const oid = (t.match(ORDER_ID_RE) || [])[0] || "";
    const sku = ((t.match(SKU_RE) || [])[1] || "").toUpperCase();
    const qty = 1;
    orderRows.push([oid, pno, qty]);
    if (sku) skuCount.set(sku, (skuCount.get(sku) || 0) + 1);
  });
  const skuRows = Array.from(skuCount.entries()).map(([k,v]) => [k,v]);
  return { orderRows, skuRows };
}

function makeCSVBlob(headers, rows) {
  const parts = [headers.join(",")];
  for (const r of rows) parts.push(r.map(v => String(v ?? "")).join(","));
  return new Blob([parts.join("\n")], { type: "text/csv" });
}

async function buildZip(mergedPdf, mode, originalFiles) {
  const zip = new JSZip();
  zip.file("cropped_labels_merged.pdf", mergedPdf);

  if (mode === "Pro Max") {
    // Parse from original files to retain text content
    let allTexts = [];
    for (const f of originalFiles) {
      const buf = await readFileAsArrayBuffer(f);
      const pages = await extractTextWithPDFJS(buf);
      allTexts = allTexts.concat(pages);
    }
    const { orderRows, skuRows } = parseOrdersAndSkus(allTexts);
    zip.file("order.csv", makeCSVBlob(["order_id","page_no","qty"], orderRows));
    zip.file("sku.csv",   makeCSVBlob(["sku","count"], skuRows));
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
    const zipBlob = await buildZip(mergedPdf, mode, Array.from(files));

    downloadBlob(zipBlob, "flipkart_cropped.zip");
    progressDiv.textContent = "Done.";
    resultDiv.textContent = "Downloaded: flipkart_cropped.zip";
  } catch (e) {
    progressDiv.textContent = "";
    resultDiv.textContent = "Failed: " + e.message;
  }
});
