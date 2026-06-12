from types import SimpleNamespace

import pytest

from app.llm import openai_client


class _FakeResponses:
    def __init__(self):
        self.calls = []

    async def create(self, **kwargs):
        self.calls.append(kwargs)
        return SimpleNamespace(
            output_text='{"ok": true}',
            usage=SimpleNamespace(input_tokens=3, output_tokens=2),
        )


class _FakeClient:
    def __init__(self):
        self.responses = _FakeResponses()


@pytest.mark.asyncio
async def test_llm_call_json_uses_responses_api(monkeypatch):
    settings = SimpleNamespace(
        openai_api_mode="responses",
        openai_model="codex/gpt-5.5",
    )
    fake_client = _FakeClient()

    monkeypatch.setattr(openai_client, "get_settings", lambda: settings)
    monkeypatch.setattr(openai_client, "get_client", lambda: fake_client)

    parsed, usage = await openai_client.llm_call_json(
        system_prompt="system",
        user_prompt="user",
        json_schema={
            "name": "result",
            "strict": True,
            "schema": {
                "type": "object",
                "properties": {"ok": {"type": "boolean"}},
                "required": ["ok"],
                "additionalProperties": False,
            },
        },
    )

    call = fake_client.responses.calls[0]
    assert parsed == {"ok": True}
    assert usage["tokens_in"] == 3
    assert call["model"] == "codex/gpt-5.5"
    assert call["instructions"] == "system"
    assert call["input"] == "user"
    assert call["text"]["format"]["type"] == "json_schema"


@pytest.mark.asyncio
async def test_embed_disabled_fails_fast(monkeypatch):
    settings = SimpleNamespace(openai_embeddings_enabled=False)
    monkeypatch.setattr(openai_client, "get_settings", lambda: settings)

    with pytest.raises(RuntimeError, match="disabled"):
        await openai_client.embed("hello")
