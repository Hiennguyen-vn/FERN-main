"""Per-user rate limit using atomic Lua script.

When Redis is healthy, counters are global and accurate. When Redis is down or
not initialised, behaviour is controlled by ``rate_limit_redis_unavailable_policy``:

* ``fail_open``       — legacy: allow (dev/prototype)
* ``local_fallback``  — per-process counters (cost protection during outage)
* ``fail_closed``     — reject all requests with 429
"""

from __future__ import annotations

import logging

import redis

from app.config import get_settings
from app.middleware.local_rate_limit import get_local_limiter

logger = logging.getLogger(__name__)

# Atomic Lua script: INCR + EXPIRE in a single round-trip.
_INCR_EXPIRE_SCRIPT = """
local count = redis.call('INCR', KEYS[1])
if count == 1 then
    redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return count
"""


class RateLimitExceeded(Exception):
    def __init__(self, scope: str, limit: int, retry_after: int, *, backend: str = "redis"):
        self.scope = scope
        self.limit = limit
        self.retry_after = retry_after  # seconds until the window resets
        self.backend = backend
        super().__init__(f"Rate limit exceeded ({scope}={limit}, backend={backend})")


def _check_limits(per_min: int, per_hour: int, *, backend: str) -> None:
    s = get_settings()
    if per_min > s.rate_limit_per_minute:
        raise RateLimitExceeded("per_minute", s.rate_limit_per_minute, retry_after=60, backend=backend)
    if per_hour > s.rate_limit_per_hour:
        raise RateLimitExceeded("per_hour", s.rate_limit_per_hour, retry_after=3600, backend=backend)


def _redis_increment(redis_client: redis.Redis, user_id: int) -> tuple[int, int]:
    key_min = f"rate:{user_id}:min"
    key_hour = f"rate:{user_id}:hour"
    if hasattr(redis_client, "register_script"):
        script = redis_client.register_script(_INCR_EXPIRE_SCRIPT)
        per_min = int(script(keys=[key_min], args=[60]))
        per_hour = int(script(keys=[key_hour], args=[3600]))
    else:
        pipe = redis_client.pipeline()
        pipe.incr(key_min)
        pipe.expire(key_min, 60)
        pipe.incr(key_hour)
        pipe.expire(key_hour, 3600)
        results = pipe.execute()
        per_min = int(results[0])
        per_hour = int(results[2])
    return per_min, per_hour


def _local_increment(user_id: int) -> tuple[int, int]:
    limiter = get_local_limiter()
    per_min = limiter.increment(f"rate:{user_id}:min", 60)
    per_hour = limiter.increment(f"rate:{user_id}:hour", 3600)
    return per_min, per_hour


def check_and_increment(redis_client: redis.Redis | None, user_id: int) -> None:
    """Raises RateLimitExceeded if over limit.

    Uses Redis when available; falls back per ``rate_limit_redis_unavailable_policy``.
    """
    s = get_settings()
    policy = s.rate_limit_redis_unavailable_policy

    if redis_client is not None:
        try:
            per_min, per_hour = _redis_increment(redis_client, user_id)
            logger.debug("rate_limit backend=redis user_id=%s per_min=%s per_hour=%s", user_id, per_min, per_hour)
            _check_limits(per_min, per_hour, backend="redis")
            return
        except RateLimitExceeded:
            raise
        except (redis.ConnectionError, redis.TimeoutError, redis.RedisError) as e:
            logger.warning("Rate limit Redis error (policy=%s): %s", policy, e)
            if policy == "fail_open":
                return
            # fall through to local/fail_closed handling

    # Redis client missing or Redis errored.
    if policy == "fail_open":
        logger.warning("rate_limit backend=none policy=fail_open user_id=%s", user_id)
        return

    if policy == "fail_closed":
        logger.warning("rate_limit backend=fail_closed user_id=%s", user_id)
        raise RateLimitExceeded("redis_unavailable", s.rate_limit_per_minute, retry_after=60, backend="fail_closed")

    # local_fallback
    per_min, per_hour = _local_increment(user_id)
    logger.warning(
        "rate_limit backend=local_fallback user_id=%s per_min=%s per_hour=%s",
        user_id,
        per_min,
        per_hour,
    )
    _check_limits(per_min, per_hour, backend="local_fallback")
