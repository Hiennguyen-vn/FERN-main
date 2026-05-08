import json
import logging
import asyncio
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
    try:
        producer = await get_producer()
        await asyncio.wait_for(producer.send_and_wait(topic, event), timeout=3.0)
    except Exception as e:  # noqa: BLE001
        logger.error("Kafka publish failed topic=%s err=%s", topic, e, extra={"topic": topic})


async def publish_audit(event: dict[str, Any]) -> None:
    s = get_settings()
    await publish_json(s.kafka_audit_topic, event)
