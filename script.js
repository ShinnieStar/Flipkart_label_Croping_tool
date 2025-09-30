/* Lite-only: crop + merge client-side, download single PDF */
const btn = document.getElementById("processBtn");
const filesInput = document.getElementById("pdfs");
const resultDiv = document.getElementById("result");
const progressDiv = document.getElementById("progress");

/* Desktop coordinates ported:
   FK_LEFT_X, FK_RIGHT_X, FK_BOTTOM_Y, FK_TOP_Y = 185, 410, 450, 820 */
const FK_LEFT_X   = 185;
const FK_RIGHT_X  = 410;
const FK_BOTTOM_Y = 450;
const FK_TOP_Y    = 820;

async function ensurePDFLib() {
  if (!window.PDFLib) {
    await new Promise((r) => {
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js";
      s.onload = r; document.body.appendChild(s);
    });
  }
}

async function readFileAsArrayBuffer(file) {
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
  const { PDFDocument } = PDFLib;
  const merged = await PDFDocument.create();
  const rect = getCropRect();

  let processed = 0;
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
    processed++;
    progressDiv.textContent = `Processed ${processed}/${files.length}`;
  }
  return await merged.save();
}

function downloadPdf(bytes, name) {
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

btn.addEventListener("click", async () => {
  const files = filesInput.files;
  if (!files || files.length === 0) {
    resultDiv.textContent = "Please select at least one PDF.";
    return;
  }
  try {
    progressDiv.textContent = "Processing...";
    await ensurePDFLib();

    const mergedBytes = await cropAndMerge(Array.from(files));
    downloadPdf(mergedBytes, "Shinnie Star Croped File.pdf");

    progressDiv.textContent = "Done.";
    resultDiv.textContent = "Downloaded: Shinnie Star Croped File.pdf";
  } catch (e) {
    progressDiv.textContent = "";
    resultDiv.textContent = "Failed: " + e.message;
  }
});
