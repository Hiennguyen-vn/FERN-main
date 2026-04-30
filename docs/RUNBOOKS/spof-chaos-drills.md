# SPOF Chaos Drills

> Manual game-day procedures. Run trên staging compose stack. Verify Phase 1 SPOF mitigations hoạt động.

## Pre-flight

```bash
docker compose -f infra/docker-compose.yml up -d
docker compose -f infra/docker-compose.yml ps
./infra/kafka/init-topics.sh
```

Check baseline healthy:

- All `kafka`, `kafka-2`, `kafka-3` healthy
- All `redis`, `redis-replica-{1,2}`, `redis-sentinel-{1,2,3}` healthy
- `gateway`, `gateway-2`, `gateway-lb` healthy
- `pgbouncer-1`, `pgbouncer-2`, `pgbouncer-lb` healthy

---

## Drill 1: Kafka broker loss

**Goal**: producer + consumer continue khi mất 1/3 broker.

```bash
# Trigger
docker compose -f infra/docker-compose.yml stop kafka-2

# Observe
docker compose -f infra/docker-compose.yml exec kafka /usr/bin/kafka-topics \
  --bootstrap-server kafka:29092,kafka-3:29092 \
  --describe --topic fern.finance.expense-record-created
```

Expect: ISR shrinks to 2, partitions still served, producer ack=all completes (`min.insync.replicas=2`).

Alert fires: `KafkaUnderReplicatedPartitions` (after 5m), `KafkaBrokerDown`.

```bash
# Recover
docker compose -f infra/docker-compose.yml start kafka-2
```

ISR returns 3 trong < 60s.

---

## Drill 2: Redis master fail → Sentinel promote

**Goal**: replica promote < 30s, services continue read/write via Sentinel.

```bash
# Baseline — confirm master
docker compose -f infra/docker-compose.yml exec redis-sentinel-1 \
  redis-cli -p 26379 sentinel get-master-addr-by-name fern-master

# Trigger
docker compose -f infra/docker-compose.yml stop redis

# Wait 10s, query sentinel
sleep 10
docker compose -f infra/docker-compose.yml exec redis-sentinel-1 \
  redis-cli -p 26379 sentinel get-master-addr-by-name fern-master
```

Expect: returns `redis-replica-1` or `redis-replica-2` IP.

Alert fires: `RedisMasterDown`.

App side: JedisSentinelPool reconnects to new master automatically.

```bash
# Recover
docker compose -f infra/docker-compose.yml start redis
# Original master now joins as replica
```

---

## Drill 3: Gateway replica loss

**Goal**: nginx LB redispatches to remaining replica, no client errors.

```bash
# Generate traffic in other terminal
while true; do curl -sf http://localhost:8080/health/live >/dev/null && echo OK || echo FAIL; sleep 0.5; done

# Trigger
docker compose -f infra/docker-compose.yml stop gateway-2
```

Expect: zero `FAIL` lines. nginx fail_timeout=10s removes upstream after first 502.

```bash
# Recover
docker compose -f infra/docker-compose.yml start gateway-2
```

---

## Drill 4: PgBouncer instance loss

**Goal**: HAProxy redispatches connections to surviving PgBouncer.

Pre-req: services pointed at `DB_URL=jdbc:postgresql://pgbouncer-lb:6432/fern`.

```bash
# Trigger
docker compose -f infra/docker-compose.yml stop pgbouncer-1

# Verify HAProxy backend status
curl -s "http://localhost:8404/stats;csv" | grep pgbouncer_back
```

Expect: `pgb1` shows DOWN, `pgb2` UP. New connections route to pgb2.

```bash
# Recover
docker compose -f infra/docker-compose.yml start pgbouncer-1
```

---

## Drill 5: Postgres replica down

**Goal**: primary continues; sync replication blocking only if `synchronous_standby_names` set.

```bash
docker compose -f infra/docker-compose.yml stop postgres-replica
```

Alert fires: `PostgresReplicaDown` (after 1m).

App impact: read-only replica queries fail; primary writes continue (currently no sync standby configured).

```bash
docker compose -f infra/docker-compose.yml start postgres-replica
# Wait for streaming to resume
docker compose -f infra/docker-compose.yml exec postgres psql -U fern -c \
  "SELECT application_name, state, sync_state FROM pg_stat_replication;"
```

---

## Drill 6: Outbox stuck — Kafka unreachable

**Goal**: outbox worker retries, no event loss. Pending count grows.

```bash
docker compose -f infra/docker-compose.yml stop kafka kafka-2 kafka-3

# Generate event (POST endpoint)
curl -X POST http://localhost:8080/api/v1/finance/expense-records \
  -H "Content-Type: application/json" \
  -H "X-Idempotency-Key: drill-$(date +%s)" \
  -d '{"amount": 100, "category": "test"}'

# Verify outbox row PENDING
docker compose -f infra/docker-compose.yml exec postgres psql -U fern -c \
  "SELECT id, status, attempt_count FROM core.outbox_event ORDER BY id DESC LIMIT 5;"
```

Expect: row exists with `status='PENDING'` and `attempt_count` increasing.

Alert fires: `OutboxRelayBacklogGrowing` (after 5m + threshold).

```bash
# Recover
docker compose -f infra/docker-compose.yml start kafka kafka-2 kafka-3
```

Within ~30s relay drains, status flips to `PUBLISHED`.

---

## Drill 7: ShedLock — multi-replica scheduled job

**Goal**: only one replica executes scheduled task at a time.

```bash
# Scale to 2 replicas
docker compose -f infra/docker-compose.yml up -d --scale sales-service=2

# Trigger short-interval cleanup (override via env)
# Watch logs across both replicas
docker compose -f infra/docker-compose.yml logs -f sales-service | grep "deleted .* expired idempotency"
```

Expect: log line appears on only ONE replica per cycle. `core.shedlock` row updated atomically.

```sql
SELECT name, lock_until, locked_by FROM core.shedlock WHERE name='idempotency-cache-cleanup';
```

---

## Cleanup

```bash
docker compose -f infra/docker-compose.yml down -v
```

## Frequency

- Per-drill smoke test: weekly trên staging.
- Full game day: monthly.
- Pre-release gate: full game day before any P0 release.
