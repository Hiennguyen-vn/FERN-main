"""Parse ``test.md`` Markdown tables into :class:`~app.evals.golden_cases.GoldenCase`.

Used by ``scripts.run_openai_evals --suite test-md``. Omits TIME rows that anchor
``Today`` → ``Expected from→to`` and multi-turn §13 rows (need prior turns).
"""

from __future__ import annotations

import re
from pathlib import Path

from app.evals.golden_cases import GoldenCase
from app.query_policy.intent_mapping import intent_for_template

CASE_ID_RE = re.compile(r"^[A-Z]{2,}(?:-[A-Z0-9]+)*-\d{3}\Z")

# Normalised header sets (matches ``test.md`` pipe tables).
T_SOC = frozenset({"auth", "câu hỏi", "expects_sql", "expected intent", "expected route", "id", "layer", "notes"})
T_SAL0 = frozenset(
    {"auth", "câu hỏi", "expects_sql", "expected route", "expected template", "id", "layer", "notes"}
)
T_TMPL = frozenset({"auth", "câu hỏi", "expected template", "id", "layer", "notes"})
T_L4 = frozenset({"auth", "câu hỏi", "expects_sql", "id", "layer", "notes", "tables subset"})
T_FIN_M = frozenset({"auth", "câu hỏi", "expected route template", "id", "layer", "notes"})
T_X5 = frozenset({"auth", "câu hỏi", "expected", "id", "layer", "notes"})
T_TIM_EDGE = frozenset({"câu hỏi", "id", "layer", "notes"})

AUTH_PROFILES: dict[str, tuple[tuple[str, ...], tuple[int, ...]]] = {
    "OM-1": (("outlet_manager",), (1,)),
    "OM-multi": (("outlet_manager",), (1, 2)),
    "RM-3": (("region_manager",), (1, 2, 3, 4, 5)),
    "FIN": (("finance",), (1, 2, 3)),
    "ADM": (("admin",), (1, 2, 3, 4, 5)),
    "HR": (("hr",), (1, 2, 3)),
    "OM-no-finance": (("outlet_manager",), (1,)),
}


def _cells(line: str) -> list[str]:
    parts = [p.strip() for p in line.strip().split("|")]
    if parts and parts[0] == "":
        parts = parts[1:]
    if parts and parts[-1] == "":
        parts = parts[:-1]
    return parts


def primary_question(cell: str) -> str:
    m = re.search(r"`([^`]*)`", cell or "")
    return (m.group(1).strip() if m else (cell or "").strip())


def _norm_hdr(s: str) -> str:
    n = (
        s.strip()
        .strip("`")
        .lower()
        .replace("\xa0", " ")
        .replace("→", "->")
        .strip()
    )
    if "/" in n:
        return n.replace("/", " ").replace("  ", " ").strip()
    return n


def _auth(im: dict[str, int], row: list[str]) -> tuple[tuple[str, ...], tuple[int, ...]]:
    k = "auth"
    if k not in im:
        return ("outlet_manager",), (1,)
    raw = row[im[k]].strip()
    return AUTH_PROFILES.get(raw, (("outlet_manager",), (1,)))


def _ft(val: str) -> bool:
    return val.strip().upper() == "T"


def _strip_cell(cell: str) -> str:
    return primary_question(cell).strip()


def _template_from(cell: str) -> str | None:
    raw = _strip_cell(cell)
    low = raw.lower()
    if not raw or "codegen" in low or raw == "refusal":
        return None
    if raw.startswith("T") or raw.startswith("HR_"):
        return raw
    return None


def _tables_from(cell: str) -> tuple[str, ...]:
    return tuple(
        m.group(1).strip()
        for m in re.finditer(r"`([^`]+)`", cell or "")
        if re.match(r"^(analytics|cdc|fern)\.", (m.group(1) or "").strip())
    )


def _guess_intent(cid: str, tmpl: str | None) -> str | None:
    template_intent = intent_for_template(tmpl)
    if template_intent:
        return template_intent
    if cid.startswith(("SAL", "PAY")):
        return "revenue"
    if cid.startswith("PRD"):
        return "product_mix"
    if cid.startswith("INV"):
        return "inventory"
    if cid.startswith("FIN") and not cid.startswith("FIN-RBAC"):
        return "pnl"
    if cid.startswith("LKP"):
        return "lookup"
    if cid.startswith("HR") and not cid.startswith("HR-RBAC"):
        return "hr_staff"
    if cid.startswith("AMB"):
        return "unknown"
    _ = tmpl
    return None


def _layer_tags(row: list[str]) -> tuple[str, ...]:
    lx = row[1].strip() if len(row) > 1 else ""
    ts = ["from-test-md"]
    if re.match(r"^L\d+$", lx):
        ts.insert(0, lx)
    return tuple(ts)


def load_cases(md_path: str | Path) -> tuple[tuple[GoldenCase, ...], tuple[str, ...]]:
    path = Path(md_path)
    text = path.read_text(encoding="utf-8")
    lines = text.splitlines()

    out: dict[str, GoldenCase] = {}
    skips: list[str] = []

    i = 0
    while i < len(lines):
        line = lines[i].strip()
        if not line.startswith("|") or "| ID |" not in line:
            i += 1
            continue

        hdr = _cells(line)
        i += 1
        if i >= len(lines) or not lines[i].strip().startswith("|---"):
            continue
        i += 1

        im: dict[str, int] = {}
        for j, h in enumerate(hdr):
            im[_norm_hdr(h)] = j

        hdr_lower = [_norm_hdr(h) for h in hdr]
        joinh = "|".join(hdr_lower)
        fset = frozenset(hdr_lower)

        if "previous turn" in joinh:
            skips.append("(once) omitted §13 multi-turn table")
            while i < len(lines) and lines[i].strip().startswith("|"):
                i += 1
            continue
        if "today" in joinh:
            skips.append("(once) omitted §11 TIME table (anchors on Today)")
            while i < len(lines) and lines[i].strip().startswith("|"):
                i += 1
            continue

        while i < len(lines):
            ln = lines[i].strip()
            if not ln.startswith("|"):
                break
            row = _cells(ln)
            i += 1

            cid = row[0] if row else ""
            if not cid or not CASE_ID_RE.match(cid):
                continue
            q_col = im.get("câu hỏi")
            if q_col is None:
                skips.append(f"{cid}: missing Câu hỏi column")
                continue
            question = primary_question(row[q_col]) if q_col < len(row) else ""
            if not question:
                continue

            roles, outlets = _auth(im, row)
            tags = _layer_tags(row)
            notes = row[im["notes"]] if "notes" in im and len(row) > im["notes"] else ""

            gc: GoldenCase | None = None

            try:
                if fset == T_SOC:
                    gc = GoldenCase(
                        id=cid,
                        question=question,
                        auth_roles=roles,
                        auth_outlet_ids=outlets,
                        expected_route=_strip_cell(row[im["expected route"]]),
                        expected_intent=_strip_cell(row[im["expected intent"]]),
                        expects_sql=_ft(row[im["expects_sql"]]),
                        tags=tags,
                        notes=notes,
                    )
                elif fset == T_SAL0:
                    tmpl_cell = row[im["expected template"]]
                    gc = GoldenCase(
                        id=cid,
                        question=question,
                        auth_roles=roles,
                        auth_outlet_ids=outlets,
                        expected_route=_strip_cell(row[im["expected route"]]),
                        expected_intent=_guess_intent(cid, _template_from(tmpl_cell)),
                        expected_template_key=_template_from(tmpl_cell),
                        expects_sql=_ft(row[im["expects_sql"]]),
                        tags=tags,
                        notes=notes,
                    )
                elif fset == T_TMPL:
                    tc = row[im["expected template"]]
                    low_tc = tc.lower()
                    is_codegen = "codegen" in low_tc
                    if cid == "PAY-042":
                        gc = GoldenCase(
                            id=cid,
                            question=question,
                            auth_roles=roles,
                            auth_outlet_ids=outlets,
                            expected_route="data_query",
                            expected_intent="revenue",
                            expects_sql=False,
                            tags=tags + ("rbac-negative", "payment"),
                            notes=notes,
                        )
                    elif "refusal" in low_tc and ("limited" in low_tc or cid.startswith("LKP")):
                        gc = GoldenCase(
                            id=cid,
                            question=question,
                            auth_roles=roles,
                            auth_outlet_ids=outlets,
                            expected_route="clarification",
                            expects_sql=False,
                            tags=tags + ("lookup-policy",),
                            notes=notes,
                        )
                    else:
                        tmpl = _template_from(tc)
                        gc = GoldenCase(
                            id=cid,
                            question=question,
                            auth_roles=roles,
                            auth_outlet_ids=outlets,
                            expected_route="data_query",
                            expected_intent=None if is_codegen else _guess_intent(cid, tmpl),
                            expected_template_key=tmpl,
                            expects_sql=True,
                            tags=tags + (("codegen",) if is_codegen else ()),
                            notes=notes,
                        )
                elif fset == T_L4:
                    ts = row[im["tables subset"]]
                    subset = _tables_from(ts)
                    gc = GoldenCase(
                        id=cid,
                        question=question,
                        auth_roles=roles,
                        auth_outlet_ids=outlets,
                        expected_route="data_query",
                        expected_intent=None,
                        expected_tables_subset=subset,
                        expected_template_key=None,
                        expects_sql=_ft(row[im["expects_sql"]]),
                        tags=tags + ("codegen",),
                        notes=notes,
                    )
                elif fset == T_FIN_M:
                    kcol = "expected route template"
                    raw_cell = row[im[kcol]]
                    if cid.startswith("HR"):
                        if "/" in raw_cell:
                            la, _, ra = raw_cell.partition("/")
                            route_guess = primary_question(la) or la.strip().strip("`").strip()
                            pq = primary_question(ra).strip()
                            tmpl_v = _template_from(ra) or (pq if pq.startswith("HR_") else None)
                        else:
                            route_guess = "hr_staff"
                            tmpl_v = _template_from(raw_cell)
                        gc = GoldenCase(
                            id=cid,
                            question=question,
                            auth_roles=roles,
                            auth_outlet_ids=outlets,
                            expected_route=route_guess,
                            expected_intent="hr_staff",
                            expected_template_key=tmpl_v,
                            expects_sql=False,
                            tags=tags + ("hr",),
                            notes=notes,
                        )
                    else:
                        is_codegen = "codegen" in raw_cell.lower()
                        tmpl = _template_from(raw_cell)
                        gc = GoldenCase(
                            id=cid,
                            question=question,
                            auth_roles=roles,
                            auth_outlet_ids=outlets,
                            expected_route="data_query",
                            expected_intent=None if is_codegen else _guess_intent(cid, tmpl),
                            expected_template_key=tmpl,
                            expects_sql=True,
                            tags=tags + (("codegen",) if is_codegen else ()),
                            notes=notes,
                        )
                elif fset == T_X5:
                    if cid.startswith("FIN-RBAC"):
                        gc = GoldenCase(
                            id=cid,
                            question=question,
                            auth_roles=roles,
                            auth_outlet_ids=outlets,
                            expected_route="data_query",
                            expected_intent="pnl",
                            expects_sql=False,
                            tags=tags + ("rbac-negative",),
                            notes=notes,
                        )
                    elif cid.startswith("HR-RBAC"):
                        gc = GoldenCase(
                            id=cid,
                            question=question,
                            auth_roles=roles,
                            auth_outlet_ids=outlets,
                            expected_route="clarification",
                            expects_sql=False,
                            tags=tags + ("rbac-negative",),
                            notes=notes,
                        )
                    elif cid.startswith("AMB"):
                        gc = GoldenCase(
                            id=cid,
                            question=question,
                            auth_roles=roles,
                            auth_outlet_ids=outlets,
                            expected_route="clarification",
                            expected_intent="unknown",
                            expects_sql=False,
                            tags=tags + ("L7",),
                            notes=notes,
                        )
                    elif cid.startswith("ADV"):
                        gc = GoldenCase(
                            id=cid,
                            question=question,
                            auth_roles=roles,
                            auth_outlet_ids=outlets,
                            expected_route="clarification",
                            expects_sql=False,
                            tags=tags + ("adversarial", "L9"),
                            notes=notes,
                        )
                    else:
                        skips.append(f"{cid}: unclassified T_X5 row")
                elif fset == T_TIM_EDGE:
                    gc = GoldenCase(
                        id=cid,
                        question=question,
                        auth_roles=("outlet_manager",),
                        auth_outlet_ids=(1,),
                        expected_route="clarification",
                        expected_intent="unknown",
                        expects_sql=False,
                        tags=tags + ("L6-edge",),
                        notes=notes,
                    )
                else:
                    skips.append(f"table not handled: {sorted(fset)}")
                    continue

            except (IndexError, KeyError) as err:
                skips.append(f"{cid}: {err}")
                continue

            if gc is not None and cid not in out:
                out[cid] = gc

    dedup = tuple(dict.fromkeys(skips))
    ordered = tuple(out[k] for k in sorted(out))
    return ordered, dedup


__all__ = ["load_cases", "CASE_ID_RE"]
