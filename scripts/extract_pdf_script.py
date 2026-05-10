#!/usr/bin/env python3
"""Extract text from Annie Jr script PDF using Tesseract OCR."""
from __future__ import annotations

import subprocess
import sys
import tempfile
from pathlib import Path

import pytesseract
from PIL import Image, ImageFilter, ImageOps

PDF_PATH = Path("/Users/mark/Downloads/Annie-Jr-Script-.pdf")
PAGES_DIR = Path(__file__).parent / "annie_jr_pages"
OUTPUT_PATH = Path(__file__).parent / "annie_jr_script.txt"


def render_page(pdf_path: Path, page_num: int, output_dir: Path) -> Path:
    prefix = str(output_dir / "page")
    subprocess.run(
        ["pdftoppm", "-r", "250", "-f", str(page_num), "-l", str(page_num),
         "-png", str(pdf_path), prefix],
        check=True,
        capture_output=True,
    )
    return sorted(output_dir.glob("page-*.png"))[-1]


def preprocess(image_path: Path) -> Image.Image:
    img = Image.open(image_path).convert("L")  # grayscale
    img = ImageOps.autocontrast(img)
    img = img.filter(ImageFilter.SHARPEN)
    return img


def ocr_page(image_path: Path) -> str:
    img = preprocess(image_path)
    # PSM 1 = auto page segmentation with OSD; works well for mixed layout
    text = pytesseract.image_to_string(img, lang="eng", config="--psm 1")
    return text.strip()


def get_page_count(pdf_path: Path) -> int:
    result = subprocess.run(
        ["pdfinfo", str(pdf_path)], capture_output=True, text=True, check=True
    )
    for line in result.stdout.splitlines():
        if line.startswith("Pages:"):
            return int(line.split(":")[1].strip())
    raise RuntimeError("Could not determine page count")


def assemble_output(total_pages: int) -> None:
    parts: list[str] = []
    for page_num in range(1, total_pages + 1):
        page_file = PAGES_DIR / f"page_{page_num:03d}.txt"
        if page_file.exists():
            content = page_file.read_text(encoding="utf-8").strip()
            if content:
                parts.append(f"--- p{page_num} ---\n{content}")
    OUTPUT_PATH.write_text("\n\n".join(parts), encoding="utf-8")


def main() -> None:
    if not PDF_PATH.exists():
        sys.exit(f"PDF not found: {PDF_PATH}")

    total_pages = get_page_count(PDF_PATH)
    PAGES_DIR.mkdir(exist_ok=True)

    already_done = sum(1 for _ in PAGES_DIR.glob("page_*.txt"))
    if already_done:
        print(f"Resuming — {already_done}/{total_pages} pages already done")

    print(f"Processing {total_pages} pages → {OUTPUT_PATH}")

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp = Path(tmpdir)
        for page_num in range(1, total_pages + 1):
            page_file = PAGES_DIR / f"page_{page_num:03d}.txt"
            if page_file.exists():
                print(f"  [{page_num:3d}/{total_pages}] skipped (cached)")
                continue

            print(f"  [{page_num:3d}/{total_pages}] ", end="", flush=True)
            try:
                img_path = render_page(PDF_PATH, page_num, tmp)
                text = ocr_page(img_path)
                img_path.unlink()
                page_file.write_text(text, encoding="utf-8")
                print("ok" if text else "(blank)")
            except Exception as exc:
                print(f"ERROR: {exc}")
                page_file.write_text(f"[ERROR page {page_num}: {exc}]", encoding="utf-8")

    assemble_output(total_pages)
    print(f"\nDone. Script saved to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
