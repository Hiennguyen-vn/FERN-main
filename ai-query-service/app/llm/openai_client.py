import json
import time
from typing import Any

from openai import AsyncOpenAI

from app.config import get_settings


_client: AsyncOpenAI | None = None


def get_client() -> AsyncOpenAI:
    global _client
    if _client is None:
        s = get_settings()
        kwargs: dict[str, Any] = {
            "api_key": s.openai_api_key,
            "timeout": 30.0,
            "max_retries": 2,
            "default_headers": {"User-Agent": s.openai_user_agent},
        }
        if s.openai_base_url:
            kwargs["base_url"] = s.openai_base_url
        _client = AsyncOpenAI(**kwargs)
    return _client


def _usage_from_chat(resp: Any, started_at: float) -> dict:
    return {
        "tokens_in": resp.usage.prompt_tokens if resp.usage else 0,
        "tokens_out": resp.usage.completion_tokens if resp.usage else 0,
        "latency_ms": int((time.time() - started_at) * 1000),
    }


def _usage_from_response(resp: Any, started_at: float) -> dict:
    usage = getattr(resp, "usage", None)
    return {
        "tokens_in": getattr(usage, "input_tokens", 0) if usage else 0,
        "tokens_out": getattr(usage, "output_tokens", 0) if usage else 0,
        "latency_ms": int((time.time() - started_at) * 1000),
    }


def _response_output_text(resp: Any) -> str:
    text = getattr(resp, "output_text", None)
    if text:
        return text

    chunks: list[str] = []
    for item in getattr(resp, "output", []) or []:
        for content in getattr(item, "content", []) or []:
            value = getattr(content, "text", None)
            if value:
                chunks.append(value)
    return "".join(chunks)


def _responses_json_format(json_schema: dict[str, Any]) -> dict[str, Any]:
    return {
        "format": {
            "type": "json_schema",
            "name": json_schema["name"],
            "strict": json_schema.get("strict", True),
            "schema": json_schema["schema"],
        }
    }


async def llm_call_json(
    *,
    system_prompt: str,
    user_prompt: str,
    json_schema: dict[str, Any],
    temperature: float = 0.1,
    max_tokens: int = 800,
) -> tuple[dict, dict]:
    """Call GPT-4.1 with structured JSON output. Returns (parsed, usage)."""
    s = get_settings()
    client = get_client()
    t0 = time.time()
    if s.openai_api_mode == "responses":
        resp = await client.responses.create(
            model=s.openai_model,
            instructions=system_prompt,
            input=user_prompt,
            text=_responses_json_format(json_schema),
        )
        parsed = json.loads(_response_output_text(resp) or "{}")
        return parsed, _usage_from_response(resp, t0)

    resp = await client.chat.completions.create(
        model=s.openai_model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        response_format={
            "type": "json_schema",
            "json_schema": json_schema,
        },
        temperature=temperature,
        max_completion_tokens=max_tokens,
    )
    parsed = json.loads(resp.choices[0].message.content or "{}")
    return parsed, _usage_from_chat(resp, t0)


async def llm_call_text(
    *,
    system_prompt: str,
    user_prompt: str,
    temperature: float = 0.3,
    max_tokens: int = 600,
) -> tuple[str, dict]:
    s = get_settings()
    client = get_client()
    t0 = time.time()
    if s.openai_api_mode == "responses":
        resp = await client.responses.create(
            model=s.openai_model,
            instructions=system_prompt,
            input=user_prompt,
        )
        return _response_output_text(resp), _usage_from_response(resp, t0)

    resp = await client.chat.completions.create(
        model=s.openai_model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        temperature=temperature,
        max_completion_tokens=max_tokens,
    )
    text = resp.choices[0].message.content or ""
    return text, _usage_from_chat(resp, t0)


async def embed(text: str) -> list[float]:
    s = get_settings()
    if not s.openai_embeddings_enabled:
        raise RuntimeError("OpenAI embeddings are disabled")
    client = get_client()
    resp = await client.embeddings.create(model=s.openai_embedding_model, input=text)
    return resp.data[0].embedding
