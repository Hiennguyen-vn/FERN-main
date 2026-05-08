"""Verified query assets used before LLM template matching."""

from __future__ import annotations

from dataclasses import dataclass
import re
import unicodedata
from typing import Any


@dataclass(frozen=True)
class VerifiedQueryAsset:
    template_key: str
    metric_ids: tuple[str, ...]
    question_patterns: tuple[str, ...]
    required_slots: tuple[str, ...]
    time_column: str | None
    outlet_column: str | None
    golden_cases: tuple[str, ...] = ()
    confidence: float = 0.95


@dataclass(frozen=True)
class VerifiedQueryMatch:
    template_key: str
    params: dict[str, str | int]
    confidence: float
    asset: VerifiedQueryAsset


VERIFIED_QUERY_ASSETS: tuple[VerifiedQueryAsset, ...] = (
    VerifiedQueryAsset(
        "T34_sales_detail_by_day",
        ("sale_record_detail", "sale_line_revenue"),
        (
            r"\b(chi tiet ban hang|sales detail|sale detail|order detail)\b",
            r"\b(chi tiet|detail|liet ke|danh sach)\b.*\b(don hang|hoa don|don mua hang|sales?|ban hang)\b",
            r"\b(cac don hang|cac don mua hang|hoa don ban hang)\b",
        ),
        ("from_date", "to_date"),
        "business_date",
        "outlet_id",
        ("sales_detail_by_day",),
        0.97,
    ),
    VerifiedQueryAsset(
        "T33_zero_revenue_outlets",
        ("net_revenue", "outlet_zero_revenue"),
        (
            r"\b(cua hang|outlet|chi nhanh)\b.*\b(khong phat sinh doanh thu|khong co doanh thu|chua co doanh thu|doanh thu bang 0|zero revenue)\b",
            r"\b(khong phat sinh doanh thu|khong co doanh thu|chua co doanh thu|doanh thu bang 0|zero revenue)\b.*\b(cua hang|outlet|chi nhanh)\b",
            r"\b(cua hang|outlet|chi nhanh)\b.*\b(khong ban duoc|chua ban duoc|khong co giao dich)\b",
        ),
        ("from_date", "to_date"),
        "business_date",
        "outlet_id",
        ("zero_revenue_outlets",),
        0.97,
    ),
    VerifiedQueryAsset(
        "T23_peak_hour_analysis",
        ("peak_hour", "txn_count", "net_revenue"),
        (
            r"\b(giờ cao điểm|gio cao diem|khung giờ cao điểm|khung gio cao diem|peak hour|peak sales hour)\b",
            r"\b(cao điểm|cao diem)\b.*\b(bán hàng|ban hang|doanh thu|sales|revenue)\b",
            r"\b(bán hàng|ban hang|doanh thu|sales|revenue)\b.*\b(cao điểm|cao diem)\b",
            r"\b(giờ vàng|gio vang|khung giờ vàng|khung gio vang)\b.*\b(bán hàng|ban hang|doanh thu|sales|revenue)\b",
            r"\b(đông khách nhất|dong khach nhat|khách đông nhất|khach dong nhat|bán chạy theo giờ|ban chay theo gio)\b",
            r"\b(giờ|gio|khung giờ|khung gio)\b.*\b(bán chạy nhất|ban chay nhat|doanh thu cao nhất|doanh thu cao nhat|nhiều đơn nhất|nhieu don nhat)\b",
        ),
        ("from_date", "to_date"),
        "business_date",
        "outlet_id",
        ("peak_hour_sales",),
        0.96,
    ),
    VerifiedQueryAsset(
        "T07_revenue_comparison_yoy",
        ("net_revenue", "txn_count"),
        (
            r"\b(doanh thu|doanh so|revenue|sales|gmv)\b.*\b(so voi|so sanh|compare)\b.*\b(cung ky|same period|nam ngoai|last year)\b",
            r"\b(so voi|so sanh|compare)\b.*\b(cung ky|same period|nam ngoai|last year)\b.*\b(doanh thu|doanh so|revenue|sales|gmv)\b",
        ),
        ("from_date", "to_date"),
        "business_date",
        "outlet_id",
        ("revenue_yoy_same_period",),
        0.95,
    ),
    VerifiedQueryAsset(
        "T22_outlet_rank",
        ("net_revenue",),
        (
            r"\b(doanh thu|doanh so|revenue|sales|gmv)\b.*\b(cao nhat|nhieu nhat|top|xep hang|ranking|rank|cua hang nao|outlet nao)\b",
            r"\b(cua hang nao|outlet nao)\b.*\b(doanh thu|doanh so|revenue|sales|gmv)\b.*\b(cao nhat|top)\b",
        ),
        ("from_date", "to_date"),
        "business_date",
        "outlet_id",
        ("top_outlet_revenue_current_period",),
        0.96,
    ),
    VerifiedQueryAsset(
        "T02_revenue_by_outlet",
        ("net_revenue", "txn_count"),
        (r"\b(doanh thu|doanh so|revenue|sales|gmv)\b.*\b(theo cua hang|theo outlet|theo chi nhanh|so sanh)\b",),
        ("from_date", "to_date"),
        "business_date",
        "outlet_id",
        ("revenue_by_outlet",),
        0.95,
    ),
    VerifiedQueryAsset(
        "T32_period_revenue_summary",
        ("net_revenue", "gross_revenue", "txn_count"),
        (
            r"\b(tong doanh thu|tong cong|tat ca cua hang|ca he thong|total revenue)\b",
            # Require revenue language near "toàn bộ / tất cả / hệ thống" so requests like
            # "lấy bảng cdc.payment toàn bộ" do not hit this asset.
            r"\b(doanh thu|doanh so|revenue|sales|gmv)\b.*\b(toan bo|tat ca|cua hang|ca he thong)\b",
            r"\b(toan bo|tat ca|cua hang|ca he thong)\b.*\b(doanh thu|doanh so|revenue|sales|gmv)\b",
        ),
        ("from_date", "to_date"),
        "business_date",
        "outlet_id",
        ("period_revenue_summary",),
        0.94,
    ),
    VerifiedQueryAsset(
        "T01_daily_revenue",
        ("net_revenue", "gross_revenue", "txn_count"),
        (r"\b(doanh thu|doanh so|revenue|sales|gmv)\b.*\b(theo ngay|hang ngay|daily|xu huong|trend)\b",),
        ("from_date", "to_date"),
        "business_date",
        "outlet_id",
        ("daily_revenue_trend",),
        0.94,
    ),
    VerifiedQueryAsset(
        "T35_weekly_revenue_trend",
        ("net_revenue", "gross_revenue", "txn_count"),
        (
            r"\b(theo tuan|tung tuan|moi tuan|weekly|per week)\b.*\b(doanh thu|doanh so|revenue|sales|gmv|xu huong|trend)\b",
            r"\b(doanh thu|doanh so|revenue|sales|gmv|xu huong|trend)\b.*\b(theo tuan|tung tuan|moi tuan|weekly|per week)\b",
        ),
        ("from_date", "to_date"),
        "business_date",
        "outlet_id",
        ("weekly_revenue_trend",),
        0.93,
    ),
    VerifiedQueryAsset(
        "T04_top_products",
        ("revenue", "qty"),
        (r"\b(top san pham|san pham ban chay|best seller|mat hang ban chay)\b",),
        ("from_date", "to_date"),
        "business_date",
        "outlet_id",
        ("top_products",),
        0.94,
    ),
    VerifiedQueryAsset(
        "T08_revenue_by_payment_method",
        ("net_revenue", "txn_count"),
        (r"\b(doanh thu|revenue|sales)\b.*\b(thanh toan|payment|tien mat|cash|the|card)\b",),
        ("from_date", "to_date"),
        "business_date",
        "outlet_id",
        ("revenue_by_payment_method",),
        0.93,
    ),
    VerifiedQueryAsset(
        "T09_avg_basket_size",
        ("avg_basket_size",),
        (r"\b(aov|basket|gia tri don hang trung binh|trung binh don)\b",),
        ("from_date", "to_date"),
        "business_date",
        "outlet_id",
        ("avg_basket_size",),
        0.93,
    ),
    VerifiedQueryAsset(
        "T10_transaction_count",
        ("txn_count",),
        (r"\b(so don|so luong don|transaction|giao dich)\b",),
        ("from_date", "to_date"),
        "business_date",
        "outlet_id",
        ("transaction_count",),
        0.92,
    ),
    VerifiedQueryAsset(
        "T30_sale_cancellation_rate",
        ("cancellation_rate",),
        (r"\b(huy don|cancel|cancellation|ty le huy)\b",),
        ("from_date", "to_date"),
        "business_date",
        "outlet_id",
        ("sale_cancellation_rate",),
        0.92,
    ),
    VerifiedQueryAsset(
        "T24_daily_pnl_summary",
        ("operating_profit", "revenue", "cogs", "payroll_cost"),
        (r"\b(p&l|lai lo|loi nhuan|profit|margin)\b",),
        ("from_date", "to_date"),
        "business_date",
        "outlet_id",
        ("daily_pnl_summary",),
        0.9,
    ),
    VerifiedQueryAsset(
        "T31_outlet_directory",
        ("outlet_lookup",),
        (r"\b(danh sach|liet ke|cua hang nao|outlet nao|store list|list outlets)\b",),
        (),
        None,
        None,
        ("outlet_directory",),
        0.95,
    ),
)


def _fold(text: str) -> str:
    decomposed = unicodedata.normalize("NFD", text or "")
    no_marks = "".join(ch for ch in decomposed if unicodedata.category(ch) != "Mn")
    return no_marks.replace("đ", "d").replace("Đ", "D").lower()


def _params_from_slots(
    asset: VerifiedQueryAsset,
    time_range: dict[str, Any],
    question_folded: str,
) -> dict[str, str | int] | None:
    params: dict[str, str | int] = {}
    if "from_date" in asset.required_slots or "to_date" in asset.required_slots:
        fd = str(time_range.get("from_date") or "").strip()
        td = str(time_range.get("to_date") or "").strip()
        if not fd or not td:
            return None
        params["from_date"] = fd
        params["to_date"] = td
    if asset.template_key == "T04_top_products":
        limit_match = re.search(r"\b(?:top|limit)\s+(\d{1,3})\b", question_folded)
        params["limit"] = max(1, min(int(limit_match.group(1)), 100)) if limit_match else 10
    return params


def select_verified_query(
    *,
    question: str,
    intent: str | None,
    time_range: dict[str, Any],
) -> VerifiedQueryMatch | None:
    folded = _fold(question)
    intent_key = (intent or "").strip().lower()
    if intent_key in {"greeting", "thanks", "hr_staff"}:
        return None
    # Raw CDC / ingestion-table requests must not shortcut into golden metric templates.
    if re.search(r"\bcdc\.", folded):
        return None

    for asset in VERIFIED_QUERY_ASSETS:
        if asset.template_key == "T31_outlet_directory" and intent_key not in {"lookup", "unknown"}:
            continue
        if not any(re.search(pattern, folded) for pattern in asset.question_patterns):
            continue
        params = _params_from_slots(asset, time_range, folded)
        if params is None:
            continue
        return VerifiedQueryMatch(
            template_key=asset.template_key,
            params=params,
            confidence=asset.confidence,
            asset=asset,
        )
    return None
