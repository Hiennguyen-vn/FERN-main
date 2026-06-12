import pytest
import redis

from app.middleware.rate_limit import RateLimitExceeded, check_and_increment


class FakePipeline:
    def __init__(self, return_values):
        self.return_values = return_values

    def incr(self, *_):
        return self
    def expire(self, *_):
        return self
    def execute(self):
        return self.return_values


class FakeRedisOk:
    """Fake Redis that does NOT implement register_script (exercises pipeline fallback)."""
    def __init__(self, per_min=1, per_hour=1):
        self.per_min = per_min
        self.per_hour = per_hour
    def pipeline(self):
        return FakePipeline([self.per_min, True, self.per_hour, True])


class FakeRedisDown:
    def pipeline(self):
        raise redis.ConnectionError("nope")


def test_under_limit_passes(monkeypatch):
    monkeypatch.setattr(
        "app.middleware.rate_limit.get_settings",
        lambda: type("S", (), {
            "rate_limit_redis_unavailable_policy": "fail_open",
            "rate_limit_per_minute": 20,
            "rate_limit_per_hour": 200,
        })(),
    )
    check_and_increment(FakeRedisOk(per_min=5, per_hour=10), user_id=1)


def test_over_minute_limit_raises():
    with pytest.raises(RateLimitExceeded) as exc:
        check_and_increment(FakeRedisOk(per_min=999, per_hour=10), user_id=1)
    assert exc.value.scope == "per_minute"
    assert exc.value.retry_after == 60


def test_over_hour_limit_raises():
    with pytest.raises(RateLimitExceeded) as exc:
        check_and_increment(FakeRedisOk(per_min=1, per_hour=99999), user_id=1)
    assert exc.value.scope == "per_hour"
    assert exc.value.retry_after == 3600


def test_redis_down_fail_open():
    # Should NOT raise
    check_and_increment(FakeRedisDown(), user_id=1)
