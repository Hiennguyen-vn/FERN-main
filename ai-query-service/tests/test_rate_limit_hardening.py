import pytest
import redis

from app.config import get_settings
from app.middleware.local_rate_limit import reset_local_limiter
from app.middleware.rate_limit import RateLimitExceeded, check_and_increment


class FakeRedisDown:
    def register_script(self, *_):
        raise redis.ConnectionError("down")


def _settings(policy: str, per_min: int = 2, per_hour: int = 100):
    s = get_settings()
    s.rate_limit_redis_unavailable_policy = policy
    s.rate_limit_per_minute = per_min
    s.rate_limit_per_hour = per_hour
    return s


def test_redis_none_local_fallback_enforces_limit(monkeypatch):
    reset_local_limiter()
    monkeypatch.setattr(
        "app.middleware.rate_limit.get_settings",
        lambda: _settings("local_fallback", per_min=1),
    )
    check_and_increment(None, user_id=99)
    with pytest.raises(RateLimitExceeded) as exc:
        check_and_increment(None, user_id=99)
    assert exc.value.backend == "local_fallback"


def test_redis_none_fail_closed_rejects(monkeypatch):
    monkeypatch.setattr(
        "app.middleware.rate_limit.get_settings",
        lambda: _settings("fail_closed"),
    )
    with pytest.raises(RateLimitExceeded) as exc:
        check_and_increment(None, user_id=1)
    assert exc.value.backend == "fail_closed"


def test_redis_error_local_fallback(monkeypatch):
    reset_local_limiter()
    monkeypatch.setattr(
        "app.middleware.rate_limit.get_settings",
        lambda: _settings("local_fallback", per_min=1),
    )
    check_and_increment(FakeRedisDown(), user_id=5)
    with pytest.raises(RateLimitExceeded):
        check_and_increment(FakeRedisDown(), user_id=5)
