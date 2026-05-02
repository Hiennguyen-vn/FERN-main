import json
import logging
from typing import Any

from aiokafka import AIOKafkaProducer

from app.config import get_settings

logger = logging.getLogger(__name__)


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
        )
        await _producer.start()
    return _producer


async def stop_producer() -> None:
    global _producer
    if _producer is not None:
        await _producer.stop()
        _producer = None


async def publish_audit(event: dict[str, Any]) -> None:
    s = get_settings()
    try:
        producer = await get_producer()
        await producer.send_and_wait(s.kafka_audit_topic, event)
    except Exception as e:  # noqa: BLE001
        logger.error("Audit publish failed: %s", e, extra={"event_id": event.get("event_id")})
