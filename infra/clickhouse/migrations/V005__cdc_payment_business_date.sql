-- Migration V005: derive payment business_date from payment time.
--
-- Local simulation data is bulk-created, so core.payment.created_at can reflect
-- seed/runtime time rather than the business transaction time. Use payment_time
-- when available so payment marts align with sales business dates.

ALTER TABLE cdc.payment
MODIFY COLUMN business_date Date MATERIALIZED
    toDate(
        if(
            toHour(ifNull(payment_time, created_at)) < 2,
            ifNull(payment_time, created_at) - INTERVAL 1 DAY,
            ifNull(payment_time, created_at)
        )
    );
