import os, re, io, tempfile, traceback, csv
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor

from pypdf import PdfReader, PdfWriter
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import mm
import sys

FK_LEFT_X, FK_RIGHT_X, FK_BOTTOM_Y, FK_TOP_Y = 185, 410, 450, 820
FK_ROW_RE_STRICT = re.compile(r"^\s*\d+\s+([A-Za-z0-9][A-Za-z0-9\-._ ]*[A-Za-z0-9])\s*\|", re.I)
FK_ROW_RE_RELAX = re.compile(r"\b([A-Za-z0-9][A-Za-z0-9\-._ ]*[A-Za-z0-9])\s*\|", re.I)
FK_ITEM_LINE = re.compile(r"^\s*(\d+)\s+([A-Za-z0-9][A-Za-z0-9._\- ]*[A-Za-z0-9])\s*\|\s*(.+?)\s*$", re.I)

# -------------------- Utilities --------------------
def get_unique_filename(output_folder, base_name):
    p = os.path.join(output_folder, base_name)
    if not os.path.exists(p): return p
    n, ext = os.path.splitext(base_name); i = 1
    while True:
        cand = os.path.join(output_folder, f"{n}_{i}{ext}")
        if not os.path.exists(cand): return cand
        i += 1

def ensure_writable_folder(path):
    if not os.path.isdir(path): raise RuntimeError("Output folder does not exist.")
    testfile = os.path.join(path, "~write_test.tmp")
    with open(testfile, "wb") as f: f.write(b"ok")
    os.remove(testfile)

def clean_line(s: str) -> str:
    s = s.replace("\u200b","").replace("\ufeff","")
    s = s.replace("│","|").replace("¦","|").replace("—","-").replace("–","-")
    s = re.sub(r"[ \t]+"," ", s)
    return s.strip()

def extract_all_skus_from_page(text: str):
    if not text: return []
    lines = [clean_line(ln) for ln in text.splitlines() if clean_line(ln)]
    start_idx = 0
    for i, ln in enumerate(lines):
        if re.search(r"\bSKU\s*ID\b\s*\|\s*Description", ln, re.I):
            start_idx = i + 1; break
    skus = []
    for ln in lines[start_idx:]:
        if re.search(r"\bAWB No\.|\bUse Transparent Packaging\b|\bNot for resale\b|\bPrinted at\b", ln, re.I):
            break
        m = FK_ITEM_LINE.match(ln)
        if m:
            sku = re.sub(r"\s{2,}", " ", m.group(2).strip())
            skus.append(sku)
    return skus

def extract_full_sku_from_text(text: str, idx: int):
    if not text: return None
    lines = [clean_line(ln) for ln in text.splitlines() if clean_line(ln)]
    for ln in lines:
        m = FK_ROW_RE_STRICT.match(ln)
        if m:
            tok = m.group(1).strip()
            if tok.upper() != "ID": return tok
    best = None
    for ln in lines:
        for m in FK_ROW_RE_RELAX.finditer(ln):
            tok = m.group(1).strip()
            if tok.upper() == "ID": continue
            if (best is None) or (len(tok) > len(best)): best = tok
    return best

def safe_set_cropboxes(page, left, bottom, right, top):
    try:
        page.crop_box.lower_left = (left, bottom)
        page.crop_box.upper_right = (right, top)
        page.trim_box.lower_left = (left, bottom)
        page.trim_box.upper_right = (right, top)
        return
    except Exception: pass
    try:
        page.cropbox.lower_left = (left, bottom)
        page.cropbox.upper_right = (right, top)
        page.trimbox.lower_left = (left, bottom)
        page.trimbox.upper_right = (right, top)
        return
    except Exception: pass
    mb = page.mediabox
    mb.lower_left = (left, bottom)
    mb.upper_right = (right, top)

def build_flipkart_summary_from_meta(meta_skus):
    counts = {}
    for sku in meta_skus:
        counts[sku] = counts.get(sku, 0) + 1
    rows = [["Sr. No","SKU","Qty"]]
    sr = 1
    for sku in sorted(counts.keys(), key=lambda s: (s.startswith("UNKNOWN_"), s)):
        rows.append([str(sr), sku, str(counts[sku])])
        sr += 1
    return rows

def generate_bounded_table_pdf_bytes(market, table_data, title_suffix=""):
    buf = io.BytesIO()
    styles = getSampleStyleSheet()
    story = []
    story.append(Paragraph(f"Marketplace: {market}", styles["Normal"]))
    story.append(Spacer(1, 6))
    colWidths = [15*mm, 150*mm, 20*mm] if len(table_data[0])==3 else [15*mm, 110*mm, 25*mm, 15*mm]
    tbl = Table(table_data, colWidths=colWidths, repeatRows=1)
    style = TableStyle([
        ("GRID",(0,0),(-1,-1),0.8,colors.black),
        ("BACKGROUND",(0,0),(-1,0),colors.HexColor("#1565C0")),
        ("TEXTCOLOR",(0,0),(-1,0),colors.white),
        ("FONTNAME",(0,0),(-1,0),"Helvetica-Bold"),
        ("FONTSIZE",(0,0),(-1,0),11),
        ("ALIGN",(0,0),(-1,0),"CENTER"),
        ("VALIGN",(0,0),(-1,-1),"MIDDLE"),
        ("FONTSIZE",(0,1),(-1,-1),10),
        ("ROWBACKGROUNDS",(0,1),(-1,-1),[colors.whitesmoke, colors.HexColor("#EAF3FF")]),
        ("LEFTPADDING",(0,0),(-1,-1),6),("RIGHTPADDING",(0,0),(-1,-1),6),
        ("TOPPADDING",(0,0),(-1,-1),4),("BOTTOMPADDING",(0,0),(-1,-1),4),
        ("ALIGN",(0,1),(0,-1),"CENTER"),
        ("ALIGN",(-1,1),(-1,-1),"RIGHT"),
    ])
    tbl.setStyle(style)
    story.append(tbl)

    def draw(cv, doc):
        page_w, page_h = A4
        cv.setFillColorRGB(0.09,0.48,0.76)
        cv.rect(0, page_h-60, page_w, 60, fill=1, stroke=0)
        cv.setFillColor(colors.white)
        cv.setFont("Helvetica-Bold",18)
        tag = f"Shinnie Star — {market} Summary"
        if title_suffix:
            tag += f" — {title_suffix}"
        cv.drawString(36, page_h-38, tag)
        cv.setFillColor(colors.black)
        cv.setFont("Helvetica",9)
        cv.drawString(36, 20, f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")

    SimpleDocTemplate(buf, pagesize=A4, leftMargin=18*mm, rightMargin=18*mm, topMargin=24*mm, bottomMargin=16*mm)\
        .build(story, onFirstPage=draw, onLaterPages=draw)
    buf.seek(0)
    return buf.read()

def merge_pdfs_filepaths(paths):
    merger = PdfWriter()
    for p in paths:
        try:
            r = PdfReader(p)
            for page in r.pages:
                merger.add_page(page)
        except Exception: pass
    fd, tmp = tempfile.mkstemp(suffix=".pdf")
    os.close(fd)
    with open(tmp,"wb") as f:
        merger.write(f)
    return tmp

# ---------------- Process Function ----------------
def process_flipkart(input_files, output_folder, mode="Pro Max"):
    try:
        pdf_file = merge_pdfs_filepaths(input_files) if isinstance(input_files, list) else input_files
        reader = PdfReader(pdf_file)
        n = len(reader.pages)
        if n == 0:
            raise RuntimeError("PDF has 0 pages.")

        writer = PdfWriter()
        ensure_writable_folder(output_folder)

        print(f"Processing {n} pages in mode: {mode}")

        if mode.lower() != "pro max":
            for i, pg in enumerate(reader.pages):
                safe_set_cropboxes(pg, FK_LEFT_X, FK_BOTTOM_Y, FK_RIGHT_X, FK_TOP_Y)
                writer.add_page(pg)
                if i % 10 == 0 or i == n-1:
                    print(f"Progress: {int((i+1)/n*100)}%")
            name = "Shinnie-Star_Flipkart_Cropped_Lite.pdf"
            out_path = get_unique_filename(output_folder, name)
            with open(out_path,"wb") as f:
                writer.write(f)
            print(f"Output PDF: {out_path}")
            return out_path, None
        else:
            meta_skus = []
            pages = list(reader.pages)

            def process_page(i):
                pg = pages[i]
                txt = ""
                try:
                    txt = pg.extract_text(extraction_mode="layout", strip_rotated=False) or ""
                    if not txt.strip():
                        txt = pg.extract_text() or ""
                except Exception:
                    txt = ""
                items = extract_all_skus_from_page(txt)
                if items:
                    return items
                else:
                    fallback = extract_full_sku_from_text(txt, i)
                    return [fallback] if fallback else [f"UNKNOWN_{i}"]

            with ThreadPoolExecutor(max_workers=4) as executor:
                futures = {executor.submit(process_page, i): i for i in range(n)}
                for i, future in enumerate(futures):
                    items = future.result()
                    meta_skus.extend(items)
                    safe_set_cropboxes(pages[i], FK_LEFT_X, FK_BOTTOM_Y, FK_RIGHT_X, FK_TOP_Y)
                    writer.add_page(pages[i])
                    if i % 10 == 0 or i == n-1:
                        print(f"Progress: {int((i+1)/n*50)}%")

            table_data = build_flipkart_summary_from_meta(meta_skus)
            summary_bytes = generate_bounded_table_pdf_bytes("Flipkart", table_data, title_suffix=f"Total Labels: {n}")
            summary_reader = PdfReader(io.BytesIO(summary_bytes))
            for sp in summary_reader.pages:
                writer.add_page(sp)

            name = "Shinnie-Star_Flipkart_Cropped_ProMax.pdf"
            out_path = get_unique_filename(output_folder, name)
            with open(out_path,"wb") as f:
                writer.write(f)

            csv_name = "Shinnie-Star_Flipkart_Summary.csv"
            csv_path = get_unique_filename(output_folder, csv_name)
            with open(csv_path, "w", newline="", encoding="utf-8") as csvfile:
                writer_csv = csv.writer(csvfile)
                writer_csv.writerows(table_data)

            print(f"Output PDF: {out_path}")
            print(f"CSV Summary: {csv_path}")
            return out_path, csv_path

    except Exception as e:
        print("Error:", e)
        print(traceback.format_exc())
        return None, None

# ---------------- CLI Entry ----------------
if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Shinnie Star — Flipkart Label Cropper (CLI Version)")
    parser.add_argument("-i", "--input", nargs="+", required=True, help="Input PDF file(s)")
    parser.add_argument("-o", "--output", required=True, help="Output folder")
    parser.add_argument("-m", "--mode", default="Pro Max", choices=["Lite","Pro Max"], help="Mode: Lite or Pro Max")
    args = parser.parse_args()

    process_flipkart(args.input, args.output, args.mode)
