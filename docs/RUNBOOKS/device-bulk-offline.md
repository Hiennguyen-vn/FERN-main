# Device Bulk Offline

## Signal
- Many POS terminals stop syncing or refreshing device tokens.
- `device_offline_count` or sync lag alerts fire across multiple outlets.
- Store staff report local orders accumulating on terminals.

## Triage
1. Check gateway and sales-service health.
2. Confirm Kafka and Postgres are reachable from services.
3. Verify device token registry reads are succeeding.
4. Compare failures by outlet, region, and app version.
5. Check whether `/api/v1/devices/refresh` and `/api/v1/sync/*` are returning 401/403, 5xx, or network timeouts.

## Recovery
1. If tokens were rotated, republish the active secret set and restart gateway/services.
2. If registry rows were disabled incorrectly, re-enable only confirmed active devices:
   ```sql
   UPDATE core.device_registry
   SET status = 'active', updated_at = NOW()
   WHERE outlet_id = <outlet_id>
     AND status = 'disabled'
     AND updated_at > NOW() - INTERVAL '1 hour';
   ```
3. If the gateway is rejecting terminal order writes, verify device JWT auth for `POST /api/v1/sales/orders`.
4. Once connectivity returns, monitor sync backlog drain and oversell alerts.

## Follow-up
- Export affected device IDs and firmware/app versions.
- Review device-token rotation logs.
- Confirm no local orders remain pending on terminals after recovery.
