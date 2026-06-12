"""Redis Sentinel master discovery + LangGraph RedisSaver wiring."""
import logging

import redis
from redis.sentinel import Sentinel

from app.config import get_settings

logger = logging.getLogger(__name__)


def discover_master() -> tuple[str, int]:
    s = get_settings()
    sentinel = Sentinel(s.sentinel_host_tuples, socket_timeout=0.5)
    return sentinel.discover_master(s.redis_sentinel_master)


def make_redis_client() -> redis.Redis:
    """Direct Redis client (for rate limit / jti store). Auto-resolves Sentinel master."""
    host, port = discover_master()
    return redis.Redis(host=host, port=port, decode_responses=True, socket_timeout=1.0)


def make_redis_url() -> str:
    host, port = discover_master()
    return f"redis://{host}:{port}"


def make_langgraph_saver():
    """Returns a LangGraph RedisSaver bound to the current master.

    Imported lazily to avoid hard dependency for unit tests.
    TTL is configured via ``langgraph_checkpoint_ttl_minutes``.
    """
    from langgraph.checkpoint.redis import RedisSaver  # type: ignore

    s = get_settings()
    url = make_redis_url()
    ttl_minutes = max(1, int(getattr(s, "langgraph_checkpoint_ttl_minutes", 60)))
    ttl = {"default_ttl": ttl_minutes, "refresh_on_read": True}
    logger.info("Initialising LangGraph RedisSaver (ttl=%s minutes)", ttl_minutes)
    return RedisSaver(redis_url=url, ttl=ttl)
