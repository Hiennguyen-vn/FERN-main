# Chaos suite

Weekly run in staging. Each scenario passes its assertion (no lost data, recovery within SLO, idempotency holds).

## Scenarios

| Scenario | How | Assertion |
|---|---|---|
| Kafka broker outage | `docker compose stop kafka1` (or `kubectl delete pod kafka-0`) | Producers retry, no message loss; consumer lag recovers ≤ 5 min after restart. |
| Postgres failover | `patronictl failover --candidate patroni2 fern-pg` | New leader elected ≤ 30s; service reconnect ≤ 60s; outbox loses zero messages. |
| Network partition POS↔central | `tc qdisc add dev eth0 root netem loss 100%` on edge container | Edge buffers in local outbox; on heal, all events drained, no duplicates (W0.1 stable eventId). |
| Replay storm | `kafka-console-consumer --from-beginning ...| kafka-console-producer ...` 24h dump | Consumers idempotent; `core.processed_events` count stable. |
| Redis sentinel failover | kill master pod | Rate limiter degrades to fail-open; recovers within sentinel timeout (10s). |
| Inventory consumer lag | `docker compose pause inventory-service` for 30s, push 10 concurrent orders | Reservations protect available qty; second over-quota order rejected; on resume, no double-deduct. |

## Run

```bash
./run-chaos.sh kafka-outage
./run-chaos.sh patroni-failover
./run-chaos.sh inventory-lag
```

Each script exits 0 on assertion pass. CI cron runs nightly.
