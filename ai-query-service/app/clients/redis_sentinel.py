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
    """Direct Redis client (for rate limit). Auto-resolves Sentinel master."""
    host, port = discover_master()
    return redis.Redis(host=host, port=port, decode_responses=True, socket_timeout=1.0)


def make_redis_url() -> str:
    host, port = discover_master()
    return f"redis://{host}:{port}"


def make_langgraph_saver():
    """Returns a LangGraph RedisSaver bound to the current master.

    Imported lazily to avoid hard dependency for unit tests.
    """
    from langgraph.checkpoint.redis import RedisSaver  # type: ignore

    url = make_redis_url()
    return RedisSaver.from_conn_string(url)
