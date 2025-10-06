/* Shinnie Star — Flipkart Crop (Lite) */

const btn = document.getElementById("processBtn");
const filesInput = document.getElementById("pdfs");
const resultDiv = document.getElementById("result");
const progressDiv = document.getElementById("progress");
const refreshBtn = document.getElementById("refreshBtn");
const backBtn = document.getElementById("backBtn");

/* Desktop coordinates ported */
const FK_LEFT_X   = 185;
const FK_RIGHT_X  = 410;
const FK_BOTTOM_Y = 450;
const FK_TOP_Y    = 820;

async function ensurePDFLib() {
  if (!window.PDFLib) {
    await new Promise((r) => {
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js";
      s.onload = r;
      document.body.appendChild(s);
    });
  }
}

function readFileAsArrayBuffer(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsArrayBuffer(file);
  });
}

function getCropRect() {
  const x = FK_LEFT_X;
  const y = FK_BOTTOM_Y;
  const width  = FK_RIGHT_X - FK_LEFT_X;
  const height = FK_TOP_Y - FK_BOTTOM_Y;
  return { x, y, width, height };
}

async function cropAndMerge(files) {
  await ensurePDFLib();
  const { PDFDocument } = window.PDFLib;

  const outDoc = await PDFDocument.create();
  const rect = getCropRect();

  let processed = 0;

  for (const f of files) {
    const srcBytes = await readFileAsArrayBuffer(f);
    const src = await PDFDocument.load(srcBytes, { ignoreEncryption: true });
    const pageCount = src.getPageCount();

    const pages = await outDoc.copyPages(src, Array.from({ length: pageCount }, (_, i) => i));
    for (let i = 0; i < pages.length; i++) {
      const p = pages[i];

      // Create a new cropped page
      const newPage = outDoc.addPage([rect.width, rect.height]);
      const embedded = await outDoc.embedPage(p);

      newPage.drawPage(embedded, {
        x: -rect.x,
        y: -rect.y,
        width: p.getWidth(),
        height: p.getHeight(),
      });
    }
    processed++;
    progressDiv.textContent = `Processed ${processed}/${files.length}`;
  }

  const bytes = await outDoc.save();
  return bytes;
}

function downloadPdf(bytes, name) {
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

btn.addEventListener("click", async () => {
  resultDiv.textContent = "";
  progressDiv.textContent = "";

  const files = Array.from(filesInput.files || []);
  if (!files.length) {
    resultDiv.textContent = "Please select at least one PDF.";
    return;
  }

  btn.disabled = true;
  btn.textContent = "Processing…";
  try {
    await ensurePDFLib();
    const mergedBytes = await cropAndMerge(files);
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    downloadPdf(mergedBytes, `Shinnie Star Cropped File ${ts}.pdf`);
    progressDiv.textContent = "Done.";
    resultDiv.textContent = "Downloaded cropped PDF.";
  } catch (e) {
    console.error(e);
    progressDiv.textContent = "";
    resultDiv.textContent = "Failed: " + (e?.message || e);
  } finally {
    btn.disabled = false;
    btn.textContent = "Process";
  }
});

refreshBtn.addEventListener("click", () => {
  window.location.reload();
});

backBtn.addEventListener("click", () => {
  window.location.href = "https://www.shinniestar.com";
});
