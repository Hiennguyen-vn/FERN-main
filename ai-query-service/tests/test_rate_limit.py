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
    def __init__(self, per_min=1, per_hour=1):
        self.per_min = per_min
        self.per_hour = per_hour
    def pipeline(self):
        return FakePipeline([self.per_min, True, self.per_hour, True])


class FakeRedisDown:
    def pipeline(self):
        raise redis.ConnectionError("nope")


def test_under_limit_passes():
    check_and_increment(FakeRedisOk(per_min=5, per_hour=10), user_id=1)


def test_over_minute_limit_raises():
    with pytest.raises(RateLimitExceeded) as exc:
        check_and_increment(FakeRedisOk(per_min=999, per_hour=10), user_id=1)
    assert exc.value.scope == "per_minute"


def test_over_hour_limit_raises():
    with pytest.raises(RateLimitExceeded) as exc:
        check_and_increment(FakeRedisOk(per_min=1, per_hour=99999), user_id=1)
    assert exc.value.scope == "per_hour"


def test_redis_down_fail_open():
    # Should NOT raise
    check_and_increment(FakeRedisDown(), user_id=1)
