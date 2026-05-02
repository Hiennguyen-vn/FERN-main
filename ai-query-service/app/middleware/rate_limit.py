"""Per-user rate limit. Fail-open on Redis errors."""
import logging

import redis

from app.config import get_settings

logger = logging.getLogger(__name__)


class RateLimitExceeded(Exception):
    def __init__(self, scope: str, limit: int):
        self.scope = scope
        self.limit = limit
        super().__init__(f"Rate limit exceeded ({scope}={limit})")


def check_and_increment(redis_client: redis.Redis, user_id: int) -> None:
    """Raises RateLimitExceeded if over limit. Fail-open if Redis errors."""
    s = get_settings()
    key_min = f"rate:{user_id}:min"
    key_hour = f"rate:{user_id}:hour"
    try:
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
        raise RateLimitExceeded("per_minute", s.rate_limit_per_minute)
    if per_hour > s.rate_limit_per_hour:
        raise RateLimitExceeded("per_hour", s.rate_limit_per_hour)
