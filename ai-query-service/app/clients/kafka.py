"""Kafka producer with dead-letter fallback for audit events.

When Kafka is unavailable, audit events are emitted to a dedicated
structured logger (``fern.audit.deadletter``) as JSON so they can be
recovered from the log aggregator (e.g. Loki, ELK) without data loss.

The fallback is intentionally simple — it does NOT buffer in-memory or
retry, because:
  • Buffering means memory growth under sustained Kafka outages.
  • Retrying in the hot path adds latency to user-facing responses.
A separate recovery job can drain dead-letter log entries if needed.
"""
import json
import logging
import asyncio
from typing import Any

from aiokafka import AIOKafkaProducer

from app.config import get_settings

logger = logging.getLogger(__name__)

# Dedicated logger for events that could not reach Kafka.
# Configure your log aggregator to capture records from this logger
# so they can be recovered and replayed if needed.
_deadletter_logger = logging.getLogger("fern.audit.deadletter")


_producer: AIOKafkaProducer | None = None


async def get_producer() -> AIOKafkaProducer:
    global _producer
    if _producer is None:
        s = get_settings()
        _producer = AIOKafkaProducer(
            bootstrap_servers=s.kafka_brokers_list,
            value_serializer=lambda v: json.dumps(v).encode("utf-8"),
            acks="all",
            enable_idempotence=True,
            request_timeout_ms=3_000,
            retry_backoff_ms=200,
        )
        try:
            await asyncio.wait_for(_producer.start(), timeout=3.0)
        except Exception:
            _producer = None
            raise
    return _producer


async def stop_producer() -> None:
    global _producer
    if _producer is not None:
        await _producer.stop()
        _producer = None


async def publish_json(topic: str, event: dict[str, Any]) -> None:
    """Publish ``event`` to ``topic``.

    On failure the full event payload is emitted to the dead-letter logger
    as a structured JSON record so the event can be recovered from logs.
    """
    try:
        producer = await get_producer()
        await asyncio.wait_for(producer.send_and_wait(topic, event), timeout=3.0)
    except Exception as e:  # noqa: BLE001
        logger.error(
            "Kafka publish failed topic=%s err=%s — falling back to dead-letter log",
            topic,
            e,
            extra={"topic": topic},
        )
        # Emit the full event to the dead-letter logger so log aggregators
        # can capture and replay it.  The "kafka_topic" field lets consumers
        # know which topic the event was destined for.
        _deadletter_logger.error(
            "kafka_deadletter",
            extra={
                "kafka_topic": topic,
                "kafka_error": str(e),
                "event": event,
            },
        )


async def publish_audit(event: dict[str, Any]) -> None:
    s = get_settings()
    await publish_json(s.kafka_audit_topic, event)
