"""Cross-provider LLM failover behaviour in app.llm.openai_client."""

import httpx
import pytest
from openai import APIConnectionError, APIStatusError, APITimeoutError, RateLimitError

from app.llm import openai_client as oc


def _req() -> httpx.Request:
    return httpx.Request("POST", "https://api.test/v1/x")


class _FakeClient:
    def __init__(self, label: str):
        self.label = label


def _fake_settings(fallback_model: str = ""):
    class _S:
        openai_fallback_model = fallback_model

    return _S()


async def test_provider_meta_recorded_on_success(monkeypatch):
    monkeypatch.setattr(oc, "get_client", lambda: _FakeClient("primary"))
    monkeypatch.setattr(oc, "get_fallback_client", lambda: None)
    monkeypatch.setattr(oc, "get_settings", lambda: _fake_settings())

    async def op(client, model):
        return "ok"

    await oc._with_fallback("m", op)
    meta = oc.get_last_provider_meta()
    assert meta["llm_provider"] == "primary"
    assert meta["llm_fallback_used"] is False


async def test_primary_success_skips_fallback(monkeypatch):
    monkeypatch.setattr(oc, "get_client", lambda: _FakeClient("primary"))
    monkeypatch.setattr(oc, "get_fallback_client", lambda: _FakeClient("fallback"))
    monkeypatch.setattr(oc, "get_settings", lambda: _fake_settings())

    async def op(client, model):
        return (client.label, model)

    assert await oc._with_fallback("m", op) == ("primary", "m")


async def test_failover_to_secondary_with_model_override(monkeypatch):
    monkeypatch.setattr(oc, "get_client", lambda: _FakeClient("primary"))
    monkeypatch.setattr(oc, "get_fallback_client", lambda: _FakeClient("fallback"))
    monkeypatch.setattr(oc, "get_settings", lambda: _fake_settings("fb-model"))

    seen = []

    async def op(client, model):
        seen.append((client.label, model))
        if client.label == "primary":
            raise APITimeoutError(request=_req())
        return (client.label, model)

    result = await oc._with_fallback("m", op)
    assert result == ("fallback", "fb-model")
    assert seen[0] == ("primary", "m")


async def test_rate_limit_triggers_failover(monkeypatch):
    monkeypatch.setattr(oc, "get_client", lambda: _FakeClient("primary"))
    monkeypatch.setattr(oc, "get_fallback_client", lambda: _FakeClient("fallback"))
    monkeypatch.setattr(oc, "get_settings", lambda: _fake_settings())

    async def op(client, model):
        if client.label == "primary":
            resp = httpx.Response(status_code=429, request=_req())
            raise RateLimitError("rate limited", response=resp, body=None)
        return client.label

    assert await oc._with_fallback("m", op) == "fallback"


async def test_4xx_surfaces_without_failover(monkeypatch):
    monkeypatch.setattr(oc, "get_client", lambda: _FakeClient("primary"))
    fb_called = {"n": 0}

    def _fb():
        fb_called["n"] += 1
        return _FakeClient("fallback")

    monkeypatch.setattr(oc, "get_fallback_client", _fb)
    monkeypatch.setattr(oc, "get_settings", lambda: _fake_settings())

    calls: list[str] = []

    async def op(client, model):
        calls.append(client.label)
        resp = httpx.Response(status_code=400, request=_req())
        raise APIStatusError("bad request", response=resp, body=None)

    with pytest.raises(APIStatusError):
        await oc._with_fallback("m", op)
    assert calls == ["primary"]


async def test_all_providers_fail_raises_unavailable(monkeypatch):
    monkeypatch.setattr(oc, "get_client", lambda: _FakeClient("primary"))
    monkeypatch.setattr(oc, "get_fallback_client", lambda: _FakeClient("fallback"))
    monkeypatch.setattr(oc, "get_settings", lambda: _fake_settings())

    async def op(client, model):
        raise APIConnectionError(message="down", request=_req())

    with pytest.raises(oc.LLMUnavailableError):
        await oc._with_fallback("m", op)


async def test_no_fallback_configured_single_provider(monkeypatch):
    monkeypatch.setattr(oc, "get_client", lambda: _FakeClient("primary"))
    monkeypatch.setattr(oc, "get_fallback_client", lambda: None)
    monkeypatch.setattr(oc, "get_settings", lambda: _fake_settings())

    async def op(client, model):
        raise APIConnectionError(message="down", request=_req())

    with pytest.raises(oc.LLMUnavailableError):
        await oc._with_fallback("m", op)
