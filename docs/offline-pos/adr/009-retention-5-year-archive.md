# ADR-009: 5-Year Retention + S3 Archive

**Status**: Accepted
**Date**: 2026-04-23

## Context

VN luật kế toán: chứng từ kinh doanh lưu tối thiểu **10 năm** (Luật kế toán 2015 Đ41). Hóa đơn điện tử NĐ 123: 10 năm.

Hot storage PostgreSQL cost: 18M sale/year × 5 năm = 90M row sale_record + 270M row sale_item. Partition hot + archive cold.

## Decision

**Hot retention 5 năm PG partition, sau đó archive S3 parquet.**

| Table | Hot (PG partition) | Cold (S3 parquet) | Total |
|---|---|---|---|
| sale_record | 5 năm | +5 năm | 10 năm |
| sale_item | 5 năm | +5 năm | 10 năm |
| payment | 5 năm | +5 năm | 10 năm |
| inventory_transaction | 5 năm | +5 năm | 10 năm |
| audit_log | 3 năm | Drop | 3 năm |
| outbox_event | 90 ngày | Drop | 90 ngày |
| idempotency_keys | 30 ngày | Drop | 30 ngày |

Archive process:

- Monthly job: dump partition >5 năm → parquet file → upload S3 bucket `fern-archive/<table>/<year>/<month>.parquet`.
- Verify upload → drop partition.
- Restore flow: download parquet → load vào PG temp table cho audit query.

## Consequences

### Positive

- PG dataset size controlled (~90M row sale_record max).
- Compliance luật VN.
- S3 parquet rẻ + queryable qua Athena/DuckDB nếu cần.

### Negative

- Cần archive job custom (pg_partman không archive).
- Restore chậm nếu cần audit data >5 năm.
- S3 cost dài hạn (nhỏ, 10TB ~$230/month S3 Standard).

### Alternative Cold Storage

- BigQuery (W8.5) sẽ giữ full history ~vô hạn (cheaper storage tier).
- S3 parquet là raw backup; BigQuery là query-able analytical copy.

## Reference

- [VN Luật kế toán 2015 Đ41](https://thuvienphapluat.vn/van-ban/Ke-toan-Kiem-toan/Luat-Ke-toan-2015-298369.aspx)
- [docs/offline-pos/07-partitioning-and-pricing.md](../07-partitioning-and-pricing.md)
