-- pos_session uses small sequential id (fits JS Number safely for compatibility with PWA type).
-- Other aggregates (sale_record, sale_item, payment) keep Snowflake IDs (BIGINT string).

CREATE SEQUENCE IF NOT EXISTS pos_session_id_seq START 1;
