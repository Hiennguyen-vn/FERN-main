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
        _client = AsyncOpenAI(api_key=s.openai_api_key, timeout=30.0, max_retries=2)
    return _client


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
    usage = {
        "tokens_in": resp.usage.prompt_tokens if resp.usage else 0,
        "tokens_out": resp.usage.completion_tokens if resp.usage else 0,
        "latency_ms": int((time.time() - t0) * 1000),
    }
    return parsed, usage


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
    usage = {
        "tokens_in": resp.usage.prompt_tokens if resp.usage else 0,
        "tokens_out": resp.usage.completion_tokens if resp.usage else 0,
        "latency_ms": int((time.time() - t0) * 1000),
    }
    return text, usage


async def embed(text: str) -> list[float]:
    s = get_settings()
    client = get_client()
    resp = await client.embeddings.create(model=s.openai_embedding_model, input=text)
    return resp.data[0].embedding
