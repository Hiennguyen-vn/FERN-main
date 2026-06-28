#!/usr/bin/env python3
"""Render condensed sales-flow diagram to single A4 PDF."""

from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import Image, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

ROOT = Path(__file__).resolve().parents[2]
DIAGRAM = ROOT / "tmp/pdfs/luong-dat-don-thanh-cong-a4.png"
OUTPUT = ROOT / "output/pdf/luong-dat-don-thanh-cong.pdf"


def main() -> None:
    if not DIAGRAM.exists():
        raise SystemExit(f"Missing diagram: {DIAGRAM}")

    doc = SimpleDocTemplate(
        str(OUTPUT),
        pagesize=landscape(A4),
        leftMargin=1.0 * cm,
        rightMargin=1.0 * cm,
        topMargin=0.8 * cm,
        bottomMargin=0.8 * cm,
    )

    styles = getSampleStyleSheet()
    title = ParagraphStyle(
        "Title",
        parent=styles["Heading1"],
        fontName="Helvetica-Bold",
        fontSize=14,
        textColor=colors.HexColor("#16324F"),
        spaceAfter=4,
    )
    sub = ParagraphStyle(
        "Sub",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=8,
        textColor=colors.HexColor("#425466"),
        spaceAfter=6,
    )

    page_w, page_h = landscape(A4)
    usable_w = page_w - doc.leftMargin - doc.rightMargin
    usable_h = page_h - doc.topMargin - doc.bottomMargin - 2.2 * cm

    img = Image(str(DIAGRAM))
    scale = min(usable_w / img.drawWidth, usable_h / img.drawHeight)
    img.drawWidth *= scale
    img.drawHeight *= scale

    table = Table(
        [
            ["Buoc", "API", "status", "payment"],
            ["Tao don", "POST /api/v1/sales/orders", "order_created", "unpaid"],
            ["Duyet", "POST .../approve", "order_approved", "unpaid"],
            ["Thanh toan", "POST .../mark-payment-done", "payment_done", "paid"],
        ],
        colWidths=[2.0 * cm, 7.5 * cm, 2.8 * cm, 2.2 * cm],
    )
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#2B4C7E")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 7),
                ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#CBD5E1")),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F7FAFC")]),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ]
        )
    )

    doc.build(
        [
            Paragraph("Luong dat don thanh cong - POS (FERN)", title),
            Paragraph("Happy path: mo phien, tao don, duyet, thanh toan, async inventory + finance.", sub),
            img,
            Spacer(1, 0.15 * cm),
            table,
        ]
    )
    print(OUTPUT)


if __name__ == "__main__":
    main()
