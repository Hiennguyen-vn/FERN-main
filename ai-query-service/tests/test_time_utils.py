from datetime import date

import pytest

from app.time_utils import build_time_context, has_time_expression, is_time_followup, parse_time_range


TODAY = date(2026, 5, 4)


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("hôm nay", {"from_date": "2026-05-04", "to_date": "2026-05-04"}),
        ("hôm qua", {"from_date": "2026-05-03", "to_date": "2026-05-03"}),
        ("tuần này", {"from_date": "2026-05-04", "to_date": "2026-05-04"}),
        ("giờ cao điểm bán hàng trong tuần", {"from_date": "2026-05-04", "to_date": "2026-05-04"}),
        ("tuần trước", {"from_date": "2026-04-27", "to_date": "2026-05-03"}),
        ("tuần rồi", {"from_date": "2026-04-27", "to_date": "2026-05-03"}),
        ("tháng này", {"from_date": "2026-05-01", "to_date": "2026-05-04"}),
        ("tháng trước", {"from_date": "2026-04-01", "to_date": "2026-04-30"}),
        ("tháng rồi", {"from_date": "2026-04-01", "to_date": "2026-04-30"}),
        ("tháng 4", {"from_date": "2026-04-01", "to_date": "2026-04-30"}),
        ("tháng 4/2025", {"from_date": "2025-04-01", "to_date": "2025-04-30"}),
        ("tháng 4 năm ngoái", {"from_date": "2025-04-01", "to_date": "2025-04-30"}),
        ("tháng 4 năm nay", {"from_date": "2026-04-01", "to_date": "2026-04-30"}),
        ("tháng 5 năm 2024", {"from_date": "2024-05-01", "to_date": "2024-05-31"}),
        ("tháng 5 2024", {"from_date": "2024-05-01", "to_date": "2024-05-31"}),
        ("tháng 1 và 2 năm nay", {"from_date": "2026-01-01", "to_date": "2026-02-28"}),
        ("tháng 1. 2 năm nay", {"from_date": "2026-01-01", "to_date": "2026-02-28"}),
        ("tháng 11-12 năm ngoái", {"from_date": "2025-11-01", "to_date": "2025-12-31"}),
        ("quý này", {"from_date": "2026-04-01", "to_date": "2026-05-04"}),
        ("quý trước", {"from_date": "2026-01-01", "to_date": "2026-03-31"}),
        ("quý 1", {"from_date": "2026-01-01", "to_date": "2026-03-31"}),
        ("quý 3 năm 2025", {"from_date": "2025-07-01", "to_date": "2025-09-30"}),
        ("quý 3 năm ngoái", {"from_date": "2025-07-01", "to_date": "2025-09-30"}),
        ("q4 2025", {"from_date": "2025-10-01", "to_date": "2025-12-31"}),
        ("7 ngày gần nhất", {"from_date": "2026-04-28", "to_date": "2026-05-04"}),
        ("20 ngày gần nhất", {"from_date": "2026-04-15", "to_date": "2026-05-04"}),
        ("7 ngày trước", {"from_date": "2026-04-27", "to_date": "2026-05-03"}),
        ("30 ngày qua", {"from_date": "2026-04-05", "to_date": "2026-05-04"}),
        ("năm nay", {"from_date": "2026-01-01", "to_date": "2026-05-04"}),
        ("năm ngoái", {"from_date": "2025-01-01", "to_date": "2025-12-31"}),
        ("1 năm trước", {"from_date": "2025-01-01", "to_date": "2025-12-31"}),
        ("2 năm trước", {"from_date": "2024-01-01", "to_date": "2024-12-31"}),
        ("2 năm nay", {"from_date": "2025-01-01", "to_date": "2026-05-04"}),
        ("2 năm gần nhất", {"from_date": "2024-05-05", "to_date": "2026-05-04"}),
        ("7 năm gần nhất", {"from_date": "2019-05-05", "to_date": "2026-05-04"}),
        ("1 năm gần đây", {"from_date": "2025-05-05", "to_date": "2026-05-04"}),
        ("trong vòng 1 năm gần đây", {"from_date": "2025-05-05", "to_date": "2026-05-04"}),
        ("2025", {"from_date": "2025-01-01", "to_date": "2025-12-31"}),
        ("ngày 22/4/2026", {"from_date": "2026-04-22", "to_date": "2026-04-22"}),
        ("từ ngày 1/4/2026 đến ngày 22/4/2026", {"from_date": "2026-04-01", "to_date": "2026-04-22"}),
        ("01/04/2026 - 22/04/2026", {"from_date": "2026-04-01", "to_date": "2026-04-22"}),
        ("1-4-2026 đến 22-4-2026", {"from_date": "2026-04-01", "to_date": "2026-04-22"}),
        ("1/4 đến 22/4/2026", {"from_date": "2026-04-01", "to_date": "2026-04-22"}),
    ],
)
def test_parse_time_range_common_phrases(text, expected):
    assert parse_time_range(text, today=TODAY) == expected


@pytest.mark.parametrize(
    ("context_text", "expected"),
    [
        ("Nguyễn Văn An tháng này đã làm bao nhiêu giờ", {"from_date": "2026-04-01", "to_date": "2026-04-30"}),
        ("nhân viên nào đi làm nhiều nhất tuần này", {"from_date": "2026-04-27", "to_date": "2026-05-03"}),
        ("doanh thu quý này theo cửa hàng", {"from_date": "2026-01-01", "to_date": "2026-03-31"}),
        ("doanh thu năm nay", {"from_date": "2025-01-01", "to_date": "2025-12-31"}),
    ],
)
def test_parse_previous_period_from_context(context_text, expected):
    assert parse_time_range("kỳ trước thì sao", today=TODAY, context_text=context_text) == expected


def test_parse_same_period_last_year_from_context():
    assert parse_time_range(
        "cùng kỳ năm ngoái",
        today=TODAY,
        context_text="User: doanh thu tháng này theo cửa hàng",
    ) == {"from_date": "2025-05-01", "to_date": "2025-05-04"}
    assert parse_time_range(
        "same period last year",
        today=TODAY,
        context_text="User: doanh thu tháng 4/2026",
    ) == {"from_date": "2025-04-01", "to_date": "2025-04-30"}


def test_build_time_context_same_period_comparison_keeps_base_period_from_context():
    ctx = build_time_context(
        current_question="so với cùng kỳ năm ngoái",
        effective_question="doanh thu theo cửa hàng so với cùng kỳ năm ngoái",
        conversation_context="User: doanh thu tháng này theo cửa hàng",
        today=TODAY,
    )

    assert ctx["from_date"] == "2026-05-01"
    assert ctx["to_date"] == "2026-05-04"
    assert ctx["comparison_from_date"] == "2025-05-01"
    assert ctx["comparison_to_date"] == "2025-05-04"
    assert ctx["source"] == "comparison_base_from_context"


@pytest.mark.parametrize(
    "text",
    [
        "tháng trước thì sao",
        "còn tuần rồi",
        "so với tháng trước",
        "quý trước ra sao",
        "7 ngày gần nhất thì sao",
        "20 ngày gần nhất thì sao",
        "thế tháng này'",
        "thì tháng này",
        "thế còn tháng này",
        "trong tuần thì sao",
        "vậy thì tháng này nhé",
        "kỳ trước thì sao",
        "q1 thì sao",
        "tháng 4 năm ngoái thì sao",
        "tháng 5 năm 2024 thì sao",
        "tháng 1 và 2 năm nay thì sao",
        "2 năm nay thì sao",
        "7 năm gần nhất thì sao",
        "cùng kỳ năm ngoái thì sao",
        "1/4/2026 thì sao",
        "01/04/2026 - 22/04/2026 thì sao",
    ],
)
def test_is_time_followup_variants(text):
    assert is_time_followup(text)
    assert has_time_expression(text)


def test_non_time_text_is_not_time_followup():
    assert not is_time_followup("nhân viên nào đi làm nhiều nhất")
    assert not has_time_expression("nhân viên nào đi làm nhiều nhất")


def test_last_year_phrase_gan_day_is_time_expression():
    q = "nhân viên nào đi làm nhiều giờ nhất trong vòng 1 năm gần đây"
    assert has_time_expression(q)
    assert parse_time_range(q, today=TODAY) == {"from_date": "2025-05-05", "to_date": "2026-05-04"}


def test_parse_two_quarter_ranges_in_order():
    from app.time_utils import parse_two_quarter_ranges_in_order

    text = "Kết luận: doanh thu Quý 1/2026 cao hơn Quý 3/2025"
    a, b = parse_two_quarter_ranges_in_order(text)
    assert a == {"from_date": "2026-01-01", "to_date": "2026-03-31"}
    assert b == {"from_date": "2025-07-01", "to_date": "2025-09-30"}

    assert parse_two_quarter_ranges_in_order("chỉ một quý 2/2026") is None
