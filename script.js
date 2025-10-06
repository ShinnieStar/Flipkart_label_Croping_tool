const API_BASE = "https://YOUR-RENDER-URL"; // e.g., https://shinnie-star-promax.onrender.com

function getMode() {
  const m = document.querySelector('input[name="mode"]:checked');
  return m ? m.value : "lite";
}

async function postProMax(files) {
  const fd = new FormData();
  files.forEach((f) => fd.append("files", f, f.name));
  const res = await fetch(`${API_BASE}/process`, { method: "POST", body: fd });
  if (!res.ok) throw new Error(`Server ${res.status}`);
  const blob = await res.blob();
  const a = document.createElement("a");
  const url = URL.createObjectURL(blob);
  a.href = url;
  a.download = `Shinnie-Star_Flipkart_ProMax_${new Date().toISOString().replace(/[:.]/g,"-")}.zip`;
  document.body.appendChild(a); a.click();
  URL.revokeObjectURL(url); a.remove();
}

btn.addEventListener("click", async () => {
  resultDiv.textContent = ""; progressDiv.textContent = "";
  const files = Array.from(filesInput.files || []);
  if (!files.length) { resultDiv.textContent = "Please select one or more PDFs."; return; }
  btn.disabled = true; btn.textContent = "Processing…";
  try {
    if (getMode() === "promax") {
      progressDiv.textContent = "Uploading to Pro Max server…";
      await postProMax(files);
      resultDiv.textContent = "Done. Pro Max ZIP downloaded.";
    } else {
      const bytes = await cropAndMerge(files); // existing Lite flow
      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      downloadBytes(bytes, `Shinnie-Star_Flipkart_Cropped_Lite_${ts}.pdf`);
      resultDiv.textContent = "Done. Lite PDF downloaded.";
    }
  } catch (e) {
    console.error(e);
    resultDiv.textContent = "Error: " + (e?.message || e);
  } finally {
    btn.disabled = false; btn.textContent = "Process";
  }
});
