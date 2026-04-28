# DB Pool Exhausted

## Signal
- Hikari active connections remain at max.
- API latency spikes or requests fail with connection timeout errors.
- PostgreSQL shows many idle-in-transaction or long-running queries.

## Triage
1. Identify the affected service and pool:
   ```promql
   hikaricp_connections_active == hikaricp_connections_max
   ```
2. Inspect PostgreSQL activity:
   ```sql
   SELECT pid, usename, application_name, state, wait_event_type, wait_event,
          now() - query_start AS age, query
   FROM pg_stat_activity
   WHERE datname = current_database()
   ORDER BY age DESC
   LIMIT 30;
   ```
3. Check recent deploys and traffic spikes.
4. Look for slow queries on endpoints with unbounded search or missing indexes.

## Recovery
1. If a known long-running report is blocking the pool, cancel it:
   ```sql
   SELECT pg_cancel_backend(<pid>);
   ```
2. If sessions are idle in transaction, terminate only after confirming they are stale:
   ```sql
   SELECT pg_terminate_backend(<pid>);
   ```
3. Temporarily scale the service horizontally if the database has headroom.
4. Restart the affected service only when leak symptoms persist after query cleanup.

## Follow-up
- Add or tune indexes for slow paths.
- Tighten request limits and pagination.
- Add a regression test for any query that exhausted the pool.
