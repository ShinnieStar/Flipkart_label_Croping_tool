# app.py — Shinnie Star Pro Max API
# pip install fastapi uvicorn pypdf reportlab python-multipart
import io, zipfile, tempfile, os
from fastapi import FastAPI, UploadFile, File
from fastapi.responses import StreamingResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware

# import Pro Max helpers from your module or paste same functions here:
from Shinnie_Star_Label_Cropper_Flipkart import (
    crop_pdf_pages, merge_writers, write_summary_pdf, write_csvs
)

app = FastAPI(title="Shinnie Star — Flipkart Pro Max API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://shinniestar.github.io", "https://shinniestar.github.io/Flipkart_label_Croping_tool", "*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.post("/health")
def health():
    return {"status": "ok"}

@app.post("/process")
async def process(files: list[UploadFile] = File(...)):
    try:
        # Save incoming PDFs to temp and load writers
        writers = []
        aggregated = {"sku_counts": {}, "orders": [], "page_skus": []}

        for uf in files:
            data = await uf.read()
            tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".pdf")
            tmp.write(data); tmp.close()

            from pypdf import PdfReader
            reader = PdfReader(tmp.name)
            writer, texts, page_items, page_skus, page_orders = crop_pdf_pages(reader)
            writers.append(writer)
            for skus in page_skus:
                for sku in skus:
                    aggregated["sku_counts"][sku] = aggregated["sku_counts"].get(sku, 0) + 1
            aggregated["orders"].extend(page_orders)
            aggregated["page_skus"].extend(page_skus)
            os.unlink(tmp.name)

        merged = merge_writers(writers)

        # Build outputs into memory
        out_pdf = io.BytesIO()
        merged.write(out_pdf); out_pdf.seek(0)

        tmpdir = tempfile.mkdtemp()
        summary_path = os.path.join(tmpdir, "Shinnie-Star_Flipkart_Summary.pdf")
        write_summary_pdf(summary_path, aggregated)
        sku_csv, orders_csv = write_csvs(tmpdir, aggregated)

        # Package ZIP in memory
        zip_buf = io.BytesIO()
        with zipfile.ZipFile(zip_buf, "w", zipfile.ZIP_DEFLATED) as z:
            z.writestr("Shinnie-Star_Flipkart_Cropped_ProMax.pdf", out_pdf.getvalue())
            z.write(summary_path, arcname="Shinnie-Star_Flipkart_Summary.pdf")
            z.write(sku_csv, arcname="Shinnie-Star_Flipkart_SKU.csv")
            z.write(orders_csv, arcname="Shinnie-Star_Flipkart_Orders.csv")
        zip_buf.seek(0)

        headers = {"Content-Disposition": "attachment; filename=Shinnie-Star_Flipkart_ProMax.zip"}
        return StreamingResponse(zip_buf, media_type="application/zip", headers=headers)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)
