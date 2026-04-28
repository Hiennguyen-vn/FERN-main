# Outbox Stuck Recovery

## Signal
- `outbox_pending_depth` keeps rising for more than 10 minutes.
- `outbox_publish_lag_seconds` exceeds the alert threshold.
- Downstream services stop receiving domain events while API writes still succeed.

## Triage
1. Check Kafka broker health and topic availability.
2. Check service logs for `OutboxRelay`, serialization, or authentication errors.
3. Query pending rows:
   ```sql
   SELECT topic, status, COUNT(*), MIN(created_at), MAX(created_at)
   FROM core.outbox_event
   WHERE status IN ('pending', 'failed')
   GROUP BY topic, status
   ORDER BY MIN(created_at);
   ```
4. Inspect recent failures:
   ```sql
   SELECT id, topic, aggregate_type, aggregate_id, attempts, last_error, updated_at
   FROM core.outbox_event
   WHERE status = 'failed'
   ORDER BY updated_at DESC
   LIMIT 50;
   ```

## Recovery
1. Restore Kafka or the affected downstream service first.
2. Restart the emitting service only if the relay thread is wedged.
3. Requeue failed events after the root cause is fixed:
   ```sql
   UPDATE core.outbox_event
   SET status = 'pending', updated_at = NOW()
   WHERE status = 'failed'
     AND topic = '<topic>';
   ```
4. Confirm `outbox_pending_depth` and publish lag return to baseline.

## Escalation
- If payload schema is invalid, move the bad event to DLQ and open a schema compatibility fix.
- If duplicate downstream effects are suspected, verify consumer idempotency tables before replaying.
