"""In-process rate limiter used when Redis is unavailable.

Not distributed — each replica maintains its own counters. Good enough as a
cost-protection fallback during Redis outages; production should still run
Redis for accurate global limits.
"""

from __future__ import annotations

import threading
import time


class LocalRateLimiter:
    """Fixed-window counter per key with TTL eviction."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        # key -> (count, window_expires_at)
        self._windows: dict[str, tuple[int, float]] = {}

    def _purge_expired(self, now: float) -> None:
        expired = [k for k, (_, exp) in self._windows.items() if exp <= now]
        for k in expired:
            self._windows.pop(k, None)

    def increment(self, key: str, window_seconds: int) -> int:
        now = time.monotonic()
        with self._lock:
            self._purge_expired(now)
            count, expires = self._windows.get(key, (0, now + window_seconds))
            if expires <= now:
                count, expires = 0, now + window_seconds
            count += 1
            self._windows[key] = (count, expires)
            return count


_local_limiter = LocalRateLimiter()


def get_local_limiter() -> LocalRateLimiter:
    return _local_limiter


def reset_local_limiter() -> None:
    """Test helper."""
    global _local_limiter
    _local_limiter = LocalRateLimiter()
