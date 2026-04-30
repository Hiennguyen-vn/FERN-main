# PgBouncer (opt-in)

Transaction pool in front of Postgres. Not wired into main `docker-compose.yml` — opt in:

```bash
docker compose -f infra/docker-compose.yml -f infra/pgbouncer/docker-compose.pgbouncer.yml up -d pgbouncer
```

Then point services at `pgbouncer:6432` instead of `postgres:5432` via `DB_URL`.

## Settings rationale

- `pool_mode = transaction` — max throughput, but **no session-level features** (LISTEN/NOTIFY, SET, prepared stmts on JDBC) — requires Hikari `prepareThreshold=0` or driver workaround.
- `max_client_conn = 1000` — handle 100 stores × 10 conn each.
- `default_pool_size = 25` — server-side conn per DB.
- `query_timeout = 30` — defense in depth alongside V59 statement_timeout.
- `query_wait_timeout = 10` — fail fast under saturation.

## Notes

- Per V59 migration, server-side `statement_timeout` already enforced per role — pgbouncer `query_timeout` is belt + suspenders.
- For prepared statements with JDBC + transaction pooling, set `prepareThreshold=0` in JDBC URL or use `?preparedStatementCacheQueries=0`.
