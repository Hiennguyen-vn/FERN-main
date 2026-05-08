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
            "timeout": max(5.0, float(s.openai_timeout_seconds)),
            "max_retries": max(0, int(s.openai_max_retries)),
            "default_headers": {"User-Agent": s.openai_user_agent},
        }
        if s.openai_base_url:
            kwargs["base_url"] = s.openai_base_url
        _client = AsyncOpenAI(**kwargs)
    return _client


def _cached_input_tokens(usage: Any) -> int:
    """Extract cached prompt-token count across Chat and Responses API shapes."""
    if usage is None:
        return 0
    # Chat completions: prompt_tokens_details.cached_tokens (since 2024-10).
    details = getattr(usage, "prompt_tokens_details", None)
    if details is not None:
        cached = getattr(details, "cached_tokens", None)
        if cached is not None:
            return int(cached)
    # Responses API: input_tokens_details.cached_tokens.
    details = getattr(usage, "input_tokens_details", None)
    if details is not None:
        cached = getattr(details, "cached_tokens", None)
        if cached is not None:
            return int(cached)
    # SDK objects sometimes expose dict-like .__dict__ fall-throughs.
    if isinstance(usage, dict):
        return int(
            (usage.get("prompt_tokens_details") or {}).get("cached_tokens", 0)
            or (usage.get("input_tokens_details") or {}).get("cached_tokens", 0)
            or 0
        )
    return 0


def _usage_from_chat(resp: Any, started_at: float) -> dict:
    usage = getattr(resp, "usage", None)
    return {
        "tokens_in": usage.prompt_tokens if usage else 0,
        "tokens_out": usage.completion_tokens if usage else 0,
        "tokens_cached": _cached_input_tokens(usage),
        "latency_ms": int((time.time() - started_at) * 1000),
    }


def _usage_from_response(resp: Any, started_at: float) -> dict:
    usage = getattr(resp, "usage", None)
    return {
        "tokens_in": getattr(usage, "input_tokens", 0) if usage else 0,
        "tokens_out": getattr(usage, "output_tokens", 0) if usage else 0,
        "tokens_cached": _cached_input_tokens(usage),
        "response_id": getattr(resp, "id", None),
        "latency_ms": int((time.time() - started_at) * 1000),
    }


def _model_for_agent(agent: str | None) -> str:
    s = get_settings()
    key = (agent or "").strip().lower()
    default_model = getattr(s, "openai_model", "")
    agent_model = {
        "supervisor": getattr(s, "openai_model_supervisor", ""),
        "sql_planner": getattr(s, "openai_model_sql_planner", ""),
        "sql_generator": getattr(s, "openai_model_sql_generator", ""),
        "reviewer": getattr(s, "openai_model_reviewer", ""),
        "formatter": getattr(s, "openai_model_formatter", ""),
        "doc_reader": getattr(s, "openai_model_doc_reader", ""),
    }.get(key, "")
    return (agent_model or default_model).strip()


def _usage_with_model(usage: dict, *, model: str, agent: str | None) -> dict:
    usage["model"] = model
    usage["provider"] = "openai_compatible"
    if agent:
        usage["agent"] = agent
    return usage


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
    agent: str | None = None,
    previous_response_id: str | None = None,
    store: bool | None = None,
) -> tuple[dict, dict]:
    """Call OpenAI with structured JSON output.

    In ``responses`` mode, callers may pass ``previous_response_id`` to chain
    follow-ups: the server keeps prior input on its side and the SDK returns
    a new ``response_id`` in the ``usage`` dict (plus the prefix-cache hit
    count in ``tokens_cached``). In ``chat`` mode these arguments are
    ignored; OpenAI's automatic prompt caching still applies for prefixes
    ≥1024 tokens.
    """
    s = get_settings()
    client = get_client()
    model = _model_for_agent(agent)
    t0 = time.time()
    if s.openai_api_mode == "responses":
        kwargs: dict[str, Any] = {
            "model": model,
            "instructions": system_prompt,
            "input": user_prompt,
            "text": _responses_json_format(json_schema),
        }
        if previous_response_id and s.openai_responses_previous_response_id_enabled:
            kwargs["previous_response_id"] = previous_response_id
        if store is not None:
            kwargs["store"] = store
        resp = await client.responses.create(**kwargs)
        parsed = json.loads(_response_output_text(resp) or "{}")
        return parsed, _usage_with_model(_usage_from_response(resp, t0), model=model, agent=agent)

    resp = await client.chat.completions.create(
        model=model,
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
    return parsed, _usage_with_model(_usage_from_chat(resp, t0), model=model, agent=agent)


async def llm_call_text(
    *,
    system_prompt: str,
    user_prompt: str,
    temperature: float = 0.3,
    max_tokens: int = 600,
    agent: str | None = None,
) -> tuple[str, dict]:
    s = get_settings()
    client = get_client()
    model = _model_for_agent(agent)
    t0 = time.time()
    if s.openai_api_mode == "responses":
        resp = await client.responses.create(
            model=model,
            instructions=system_prompt,
            input=user_prompt,
        )
        return _response_output_text(resp), _usage_with_model(_usage_from_response(resp, t0), model=model, agent=agent)

    resp = await client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        temperature=temperature,
        max_completion_tokens=max_tokens,
    )
    text = resp.choices[0].message.content or ""
    return text, _usage_with_model(_usage_from_chat(resp, t0), model=model, agent=agent)


def _responses_tools_schema(tools: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Translate Chat-Completions tool schema → Responses API tool schema.

    Chat shape: ``{"type": "function", "function": {"name": ..., "parameters": ...}}``
    Responses shape: ``{"type": "function", "name": ..., "parameters": ...}``
    """
    out: list[dict[str, Any]] = []
    for t in tools:
        if t.get("type") == "function" and isinstance(t.get("function"), dict):
            fn = t["function"]
            out.append(
                {
                    "type": "function",
                    "name": fn.get("name"),
                    "description": fn.get("description"),
                    "parameters": fn.get("parameters"),
                }
            )
        else:
            out.append(t)
    return out


def _responses_extract_tool_calls(resp: Any) -> list[dict[str, Any]]:
    """Pull function-call items out of a Responses API response."""
    out: list[dict[str, Any]] = []
    for item in getattr(resp, "output", []) or []:
        if getattr(item, "type", None) == "function_call":
            out.append(
                {
                    "id": getattr(item, "id", None) or getattr(item, "call_id", None),
                    "call_id": getattr(item, "call_id", None) or getattr(item, "id", None),
                    "name": getattr(item, "name", None),
                    "arguments": getattr(item, "arguments", "{}"),
                }
            )
    return out


async def llm_call_chat_with_tools(
    *,
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]],
    model: str,
    temperature: float = 0.05,
    max_tokens: int = 1500,
    tool_choice: str | dict = "auto",
) -> tuple[Any, dict]:
    """Single Chat Completions turn with tool calling. Returns (response, usage)."""
    client = get_client()
    t0 = time.time()
    resp = await client.chat.completions.create(
        model=model,
        messages=messages,
        tools=tools,
        tool_choice=tool_choice,
        temperature=temperature,
        max_completion_tokens=max_tokens,
    )
    return resp, _usage_with_model(_usage_from_chat(resp, t0), model=model, agent="sql_generator")


async def llm_call_responses_with_tools(
    *,
    instructions: str,
    user_input: str | list[dict[str, Any]],
    tools: list[dict[str, Any]],
    model: str,
    previous_response_id: str | None = None,
    store: bool = True,
) -> tuple[Any, dict]:
    """Single Responses API turn with tool calling.

    When ``previous_response_id`` is set, the server reuses the prior input
    state and only the new ``user_input`` (typically the tool outputs) is
    sent over the wire. Combined with prefix caching, this is the cheapest
    way to drive the SQL Writer's tool loop.
    """
    client = get_client()
    t0 = time.time()
    kwargs: dict[str, Any] = {
        "model": model,
        "input": user_input,
        "tools": _responses_tools_schema(tools),
        "store": store,
    }
    use_previous_response_id = (
        bool(previous_response_id) and get_settings().openai_responses_previous_response_id_enabled
    )
    if instructions and not use_previous_response_id:
        # Only send the (large, static) system prompt on the FIRST turn —
        # subsequent turns inherit it via ``previous_response_id``.
        kwargs["instructions"] = instructions
    if use_previous_response_id:
        kwargs["previous_response_id"] = previous_response_id
    resp = await client.responses.create(**kwargs)
    return resp, _usage_with_model(_usage_from_response(resp, t0), model=model, agent="sql_generator")


async def embed(text: str) -> list[float]:
    s = get_settings()
    if not s.openai_embeddings_enabled:
        raise RuntimeError("OpenAI embeddings are disabled")
    client = get_client()
    resp = await client.embeddings.create(model=s.openai_embedding_model, input=text)
    return resp.data[0].embedding
