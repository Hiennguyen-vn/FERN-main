#!/usr/bin/env python3
"""Build expanded sales-flow PDF with diagram and reference tables."""

from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import (
    Image,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

ROOT = Path(__file__).resolve().parents[2]
DIAGRAM = ROOT / "tmp/pdfs/luong-ban-hang-diagram.png"
OUTPUT = ROOT / "output/pdf/luong-ban-hang.pdf"


def table_style(header_rows: int = 1) -> TableStyle:
    return TableStyle(
        [
            ("BACKGROUND", (0, 0), (-1, header_rows - 1), colors.HexColor("#2B4C7E")),
            ("TEXTCOLOR", (0, 0), (-1, header_rows - 1), colors.white),
            ("FONTNAME", (0, 0), (-1, header_rows - 1), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 8),
            ("ALIGN", (0, 0), (-1, -1), "LEFT"),
            ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#CBD5E1")),
            ("ROWBACKGROUNDS", (0, header_rows), (-1, -1), [colors.white, colors.HexColor("#F7FAFC")]),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ]
    )


def make_table(data: list[list[str]], col_widths: list[float]) -> Table:
    table = Table(data, colWidths=col_widths, repeatRows=1)
    table.setStyle(table_style())
    return table


def main() -> None:
    if not DIAGRAM.exists():
        raise SystemExit(f"Missing diagram image: {DIAGRAM}")

    doc = SimpleDocTemplate(
        str(OUTPUT),
        pagesize=A4,
        leftMargin=1.5 * cm,
        rightMargin=1.5 * cm,
        topMargin=1.5 * cm,
        bottomMargin=1.5 * cm,
        title="Luong ban hang POS - FERN",
    )

    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "Title",
        parent=styles["Heading1"],
        fontName="Helvetica-Bold",
        fontSize=17,
        textColor=colors.HexColor("#16324F"),
        spaceAfter=6,
    )
    subtitle_style = ParagraphStyle(
        "Subtitle",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=9.5,
        leading=13,
        textColor=colors.HexColor("#425466"),
        spaceAfter=8,
    )
    section_style = ParagraphStyle(
        "Section",
        parent=styles["Heading2"],
        fontName="Helvetica-Bold",
        fontSize=11,
        textColor=colors.HexColor("#2B4C7E"),
        spaceBefore=6,
        spaceAfter=6,
    )
    note_style = ParagraphStyle(
        "Note",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=8,
        leading=11,
        textColor=colors.HexColor("#425466"),
    )

    story = [
        Paragraph("Luong ban hang POS (Order-to-Cash)", title_style),
        Paragraph(
            "Luong nghiep vu dong bo tu source code FERN: mo phien POS, tao don, "
            "duyet don (tru ton kho), ghi nhan thanh toan, va huy don (void).",
            subtitle_style,
        ),
        Paragraph("Sequence diagram", section_style),
    ]

    page_w, page_h = A4
    usable_w = page_w - doc.leftMargin - doc.rightMargin
    usable_h = page_h - doc.topMargin - doc.bottomMargin - 3.5 * cm
    img = Image(str(DIAGRAM))
    scale = min(usable_w / img.drawWidth, usable_h / img.drawHeight)
    img.drawWidth = img.drawWidth * scale
    img.drawHeight = img.drawHeight * scale
    story.append(img)

    story.append(PageBreak())
    story.append(Paragraph("Bang tham chieu", section_style))
    story.append(Spacer(1, 0.2 * cm))

    story.append(Paragraph("1. Trang thai don hang", section_style))
    story.append(
        make_table(
            [
                ["Buoc", "API", "status", "payment_status"],
                ["0. Mo phien", "POST /api/v1/sales/pos-sessions", "—", "—"],
                ["1. Tao don", "POST /api/v1/sales/orders", "order_created", "unpaid"],
                ["2. Duyet don", "POST /api/v1/sales/orders/{id}/approve", "order_approved", "unpaid"],
                ["3. Thanh toan", "POST /api/v1/sales/orders/{id}/mark-payment-done", "payment_done", "paid"],
                ["Huy don", "POST /api/v1/sales/orders/{id}/cancel", "cancelled", "unpaid"],
            ],
            [2.2 * cm, 7.8 * cm, 2.8 * cm, 2.8 * cm],
        )
    )
    story.append(Spacer(1, 0.5 * cm))

    story.append(Paragraph("2. Thanh phan tham gia", section_style))
    story.append(
        make_table(
            [
                ["Thanh phan", "Vai tro"],
                ["Thu ngan / POS Frontend", "UI: chon SP, duyet, thanh toan; gui Idempotency-Key"],
                ["API Gateway", "Xac thuc JWT, routing toi sales-service"],
                ["sales-service", "SalesController, SalesService, SalesRepository"],
                ["PostgreSQL (core.*)", "sale_record, sale_item, payment, inventory_transaction"],
            ],
            [4.5 * cm, 10.9 * cm],
        )
    )
    story.append(Spacer(1, 0.5 * cm))

    story.append(Paragraph("Ghi chu", section_style))
    story.append(
        Paragraph(
            "- Tao don khong chap nhan payment trong body; thanh toan tach o buoc mark-payment-done.<br/>"
            "- Ton kho duoc kiem 2 lan: khi tao don va khi duyet (row lock).<br/>"
            "- Don dine_in co the tao kitchen_ticket (KDS); don co customer_id tu dong cong loyalty.<br/>"
            "- Source: SalesController.java, SalesService.java, SalesRepository.java, use-submit-order.ts",
            note_style,
        )
    )

    doc.build(story)
    print(OUTPUT)


if __name__ == "__main__":
    main()
