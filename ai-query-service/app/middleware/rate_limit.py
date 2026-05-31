"""Per-user rate limit using atomic Lua script. Fail-open on Redis errors."""
import logging

import redis

from app.config import get_settings

logger = logging.getLogger(__name__)

# Atomic Lua script: INCR + EXPIRE in a single round-trip.
# Guarantees the key always has a TTL even if the process crashes between
# INCR and EXPIRE in the old pipeline approach.
# KEYS[1] = key, ARGV[1] = ttl_seconds
_INCR_EXPIRE_SCRIPT = """
local count = redis.call('INCR', KEYS[1])
if count == 1 then
    redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return count
"""


class RateLimitExceeded(Exception):
    def __init__(self, scope: str, limit: int, retry_after: int):
        self.scope = scope
        self.limit = limit
        self.retry_after = retry_after  # seconds until the window resets
        super().__init__(f"Rate limit exceeded ({scope}={limit})")


def check_and_increment(redis_client: redis.Redis, user_id: int) -> None:
    """Raises RateLimitExceeded if over limit. Fail-open if Redis errors.

    Uses a registered Lua script so that INCR and EXPIRE are atomic:
    the key always gets a TTL, preventing a permanent counter if the
    process crashes between the two commands.

    Falls back to the legacy pipeline (INCR + EXPIRE) when the client
    does not support ``register_script`` (e.g. test mocks).
    """
    s = get_settings()
    key_min = f"rate:{user_id}:min"
    key_hour = f"rate:{user_id}:hour"
    try:
        if hasattr(redis_client, "register_script"):
            script = redis_client.register_script(_INCR_EXPIRE_SCRIPT)
            per_min = int(script(keys=[key_min], args=[60]))
            per_hour = int(script(keys=[key_hour], args=[3600]))
        else:
            # Fallback for mocks / environments without Lua support.
            pipe = redis_client.pipeline()
            pipe.incr(key_min)
            pipe.expire(key_min, 60)
            pipe.incr(key_hour)
            pipe.expire(key_hour, 3600)
            results = pipe.execute()
            per_min = int(results[0])
            per_hour = int(results[2])
    except (redis.ConnectionError, redis.TimeoutError, redis.RedisError) as e:
        logger.warning("Rate limit Redis error, fail-open: %s", e)
        return

    if per_min > s.rate_limit_per_minute:
        raise RateLimitExceeded("per_minute", s.rate_limit_per_minute, retry_after=60)
    if per_hour > s.rate_limit_per_hour:
        raise RateLimitExceeded("per_hour", s.rate_limit_per_hour, retry_after=3600)
