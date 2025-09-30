/* Pages-only tool: desktop logic ported (crop + merge + CSV in Pro Max) */
const btn = document.getElementById("processBtn");
const filesInput = document.getElementById("pdfs");
const modeSel = document.getElementById("mode");
const resultDiv = document.getElementById("result");
const progressDiv = document.getElementById("progress");

/* Desktop coordinates (points). These mirror:
   FK_LEFT_X, FK_RIGHT_X, FK_BOTTOM_Y, FK_TOP_Y = 185, 410, 450, 820 */
const FK_LEFT_X   = 185;
const FK_RIGHT_X  = 410;
const FK_BOTTOM_Y = 450;
const FK_TOP_Y    = 820;

/* Regexes ported from desktop logic (tuned for client parsing). */
const ORDER_ID_LABELED = /\bOrder\s*(ID|#)?\s*[:|\-]?\s*(OD[0-9A-Z\-]{8,20})\b/i;
const OD_TOKEN = /\bOD[0-9A-Z\-]{8,20}\b/i;
const ORDER_DATE_PAT = /\b(Order\s*Date|Placed\s*on)\s*[:|\-]?\s*([0-9]{1,2}[\/\-][0-9]{1,2}[\/\-][0-9]{2,4}|[0-9]{4}[\/\-][0-9]{1,2}[\/\-][0-9]{1,2})\b/i;
const FK_ITEM_LINE = /^\s*(\d+)\s+([A-Za-z0-9][A-Za-z0-9._\- ]*[A-Za-z0-9])\s*\|\s*(.+?)\s*$/i;

function cleanLine(s) {
  return s.replace(/\u200b|\ufeff/g,"")
          .replace(/│|¦/g,"|")
          .replace(/[—–]/g,"-")
          .replace(/\xa0/g," ")
          .replace(/[ \t]+/g," ")
          .trim();
}

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

/* Crop using same box as desktop safe_set_cropboxes(...) */
function getDesktopCropRect() {
  const x = FK_LEFT_X;
  const y = FK_BOTTOM_Y;
  const width  = FK_RIGHT_X - FK_LEFT_X;
  const height = FK_TOP_Y - FK_BOTTOM_Y;
  return { x, y, width, height };
}

async function cropAndMerge(files) {
  const { PDFDocument } = PDFLib;
  const merged = await PDFDocument.create();
  const rect = getDesktopCropRect();

  for (const f of files) {
    const srcBytes = await readFileAsArrayBuffer(f);
    const src = await PDFDocument.load(srcBytes, { ignoreEncryption: true });
    const pageCount = src.getPageCount();

    for (let i=0; i<pageCount; i++) {
      const [p] = await merged.copyPages(src, [i]);
      p.setCropBox(rect.x, rect.y, rect.width, rect.height);
      p.setMediaBox(rect.x, rect.y, rect.width, rect.height);
      merged.addPage(p);
    }
  }
  return await merged.save();
}

/* PDF text extraction (like get_page_text_robust fallbacks, via PDF.js) */
async function extractTextWithPDFJS(arrayBuffer) {
  await loadPDFJS();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const pages = [];
  for (let i=1; i<=pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const txt = await page.getTextContent();
    const str = txt.items.map(it => it.str).join("\n");
    pages.push(str);
  }
  return pages;
}

function extract_all_skus_from_page(text) {
  if (!text) return [];
  const lines = text.split(/\r?\n/).map(cleanLine).filter(Boolean);
  let start = 0;
  for (let i=0;i<lines.length;i++) {
    if (/\bSKU\s*ID\b\s*\|\s*Description/i.test(lines[i])) { start = i+1; break; }
  }
  const skus = [];
  for (const ln of lines.slice(start)) {
    if (/\bAWB No\.|\bUse Transparent Packaging\b|\bNot for resale\b|\bPrinted at\b/i.test(ln)) break;
    const m = ln.match(FK_ITEM_LINE);
    if (m) {
      const sku = m[2].replace(/\s{2,}/g," ").trim();
      skus.push(sku);
    }
  }
  return skus;
}

function extract_full_sku_from_text(text) {
  if (!text) return null;
  const lines = text.split(/\r?\n/).map(cleanLine).filter(Boolean);
  let best = null;
  for (const ln of lines) {
    const mm = ln.match(/\b([A-Za-z0-9][A-Za-z0-9\-._ ]*[A-Za-z0-9])\s*\|/i);
    if (mm) {
      const tok = mm[1].trim();
      if (tok.toUpperCase()==="ID") continue;
      if (!best || tok.length>best.length) best = tok;
    }
  }
  return best;
}

function extract_order_meta(text) {
  if (!text) return { order_id:null, order_date:null };
  const lines = text.split(/\r?\n/).map(cleanLine).filter(Boolean);

  // Try header window near eKart
  let headerIdx = lines.findIndex(ln => /\bE[- ]?Kart\b|\bEKart\b/i.test(ln));
  let order_id = null, order_date = null;

  if (headerIdx >= 0) {
    const window = lines.slice(headerIdx, headerIdx+15);
    for (const ln of window) {
      let m = ORDER_ID_LABELED.exec(ln);
      if (m) { order_id = m[2].trim(); break; }
      let m2 = OD_TOKEN.exec(ln);
      if (m2) { order_id = m2[0].trim(); break; }
    }
  }
  if (!order_id) {
    for (const ln of lines.slice(0,25)) {
      const m = ORDER_ID_LABELED.exec(ln);
      if (m) { order_id = m[2].trim(); break; }
    }
  }
  if (!order_id) {
    for (const ln of lines) {
      const m = OD_TOKEN.exec(ln);
      if (m) { order_id = m[0].trim(); break; }
    }
  }
  for (const ln of lines.slice(0,25)) {
    const m = ORDER_DATE_PAT.exec(ln);
    if (m) { order_date = m[2].trim(); break; }
  }
  if (!order_date) {
    for (const ln of lines) {
      const m = ORDER_DATE_PAT.exec(ln);
      if (m) { order_date = m[2].trim(); break; }
    }
  }
  return { order_id, order_date };
}

function buildCSV(headers, rows) {
  const out = [headers.join(",")].concat(rows.map(r => r.map(v => String(v??"")).join(",")));
  return new Blob([out.join("\n")], { type: "text/csv" });
}

function build_order_rows(items) {
  const rows = [["Sr. No","Order ID","Order Date","SKU","Qty"]];
  let i=1;
  for (const it of items) rows.push([String(i++), it.order_id||"", it.order_date||"", it.sku||"", String(it.qty||1)]);
  return rows;
}

async function buildZip(mergedPdfBytes, mode, originalFiles) {
  const zip = new JSZip();
  zip.file("cropped_labels_merged.pdf", mergedPdfBytes);

  if (mode === "Pro Max") {
    let meta_skus = [];
    let order_items = [];

    for (const f of originalFiles) {
      const buf = await readFileAsArrayBuffer(f);
      const pageTexts = await extractTextWithPDFJS(buf);

      pageTexts.forEach((txt, pageIndex) => {
        let items = extract_all_skus_from_page(txt);
        if (!items.length) {
          const fb = extract_full_sku_from_text(txt);
          items = fb ? [fb] : [`UNKNOWN_${pageIndex+1}`];
        }
        meta_skus.push(...items);

        // per-page aggregation like desktop
        const per = {};
        items.forEach(s => per[s] = (per[s]||0)+1);

        const { order_id, order_date } = extract_order_meta(txt);
        Object.entries(per).forEach(([sku, qty]) => {
          order_items.push({ order_id: order_id||"", order_date: (order_id?order_date:"")||"", sku, qty });
        });
      });
    }

    // SKU summary
    const counts = {};
    meta_skus.forEach(s => counts[s] = (counts[s]||0) + 1);
    const skuRows = [["Sr. No","SKU","Qty"]];
    let sr=1;
    Object.keys(counts)
      .sort((a,b) => ((a.startsWith("UNKNOWN_")?1:0)-(b.startsWith("UNKNOWN_")?1:0)) || a.localeCompare(b))
      .forEach(s => skuRows.push([String(sr++), s, String(counts[s])]));

    const ordRows = build_order_rows(order_items);

    zip.file("Shinnie-Star_Flipkart_SKU.csv", buildCSV(skuRows[0], skuRows.slice(1)));
    zip.file("Shinnie-Star_Flipkart_Orders.csv", buildCSV(ordRows[0], ordRows.slice(1)));
  }

  return await zip.generateAsync({ type: "blob" });
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
    const mergedPdf = await cropAndMerge(Array.from(files));
    const zipBlob = await buildZip(mergedPdf, mode, Array.from(files));

    const a = document.createElement("a");
    a.href = URL.createObjectURL(zipBlob);
    a.download = "flipkart_cropped.zip";
    document.body.appendChild(a);
    a.click(); a.remove();
    progressDiv.textContent = "Done.";
    resultDiv.textContent = "Downloaded: flipkart_cropped.zip";
  } catch (e) {
    progressDiv.textContent = "";
    resultDiv.textContent = "Failed: " + e.message;
  }
});
