/* Shinnie Star — Flipkart Crop (Lite)
   Client-side crop+merge using pdf-lib. */

const btn = document.getElementById("processBtn");
const filesInput = document.getElementById("pdfs");
const resultDiv = document.getElementById("result");
const progressDiv = document.getElementById("progress");

// Flipkart crop rectangle (same as desktop)
const FK_LEFT_X = 185;
const FK_RIGHT_X = 410;
const FK_BOTTOM_Y = 450;
const FK_TOP_Y = 820;

async function ensurePDFLib() {
  if (!window.PDFLib) {
    await new Promise((resolve) => {
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js";
      s.onload = resolve;
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
  const width = FK_RIGHT_X - FK_LEFT_X;
  const height = FK_TOP_Y - FK_BOTTOM_Y;
  return { x, y, width, height };
}

async function cropAndMerge(files) {
  await ensurePDFLib();
  const { PDFDocument } = window.PDFLib;

  // Create the output doc
  const outDoc = await PDFDocument.create();

  let processedPages = 0;
  let totalPagesEstimated = 0;

  // Pre-read to estimate page count
  const buffers = await Promise.all(files.map(readFileAsArrayBuffer));
  const loaded = await Promise.all(buffers.map((b) => PDFDocument.load(b)));

  totalPagesEstimated = loaded.reduce((acc, d) => acc + d.getPageCount(), 0);

  const crop = getCropRect();

  for (let idx = 0; idx < loaded.length; idx++) {
    const src = loaded[idx];
    const pageCount = src.getPageCount();

    const pages = await outDoc.copyPages(src, Array.from({ length: pageCount }, (_, i) => i));
    for (let i = 0; i < pages.length; i++) {
      const p = pages[i];
      // Apply crop box via setMediaBox to a new page canvas
      const { x, y, width, height } = crop;

      // Create a new page with target size and draw cropped region
      const newPage = outDoc.addPage([width, height]);
      const embed = await outDoc.embedPage(p);
      // Draw source page offset so that crop rect aligns at (0,0)
      newPage.drawPage(embed, { x: -x, y: -(y), width: p.getWidth(), height: p.getHeight() });

      processedPages++;
      if (processedPages % 2 === 0 || processedPages === totalPagesEstimated) {
        progressDiv.textContent = `Processed ${processedPages}/${totalPagesEstimated} pages…`;
      }
    }
  }

  const bytes = await outDoc.save();
  return bytes;
}

function downloadBytes(bytes, filename) {
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  URL.revokeObjectURL(url);
  a.remove();
}

btn.addEventListener("click", async () => {
  resultDiv.textContent = "";
  progressDiv.textContent = "";
  const files = Array.from(filesInput.files || []);
  if (!files.length) {
    resultDiv.textContent = "Please select one or more PDFs.";
    return;
  }
  btn.disabled = true;
  btn.textContent = "Processing…";
  try {
    const bytes = await cropAndMerge(files);
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const name = `Shinnie-Star_Flipkart_Cropped_Lite_${ts}.pdf`;
    downloadBytes(bytes, name);
    resultDiv.textContent = "Done. Downloaded cropped PDF.";
  } catch (e) {
    console.error(e);
    resultDiv.textContent = "Error: " + (e && e.message ? e.message : e);
  } finally {
    btn.disabled = false;
    btn.textContent = "Process";
  }
});
