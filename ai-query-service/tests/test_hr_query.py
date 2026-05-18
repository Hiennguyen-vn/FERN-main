from decimal import Decimal
from datetime import date
from types import SimpleNamespace

from app.auth.context import AuthContext
from app.graph.nodes import hr_query as hr


def _auth(roles: set[str], outlets: set[int]) -> AuthContext:
    return AuthContext(
        user_id=1,
        session_id="s",
        roles=frozenset(roles),
        permissions=frozenset(),
        outlet_ids=frozenset(outlets),
    )


def _settings(**overrides):
    base = {
        "hr_query_enabled": True,
        "hr_query_max_rows": 50,
    }
    base.update(overrides)
    return SimpleNamespace(**base)


def test_hr_staff_list_runs_static_scoped_query(monkeypatch):
    monkeypatch.setattr(hr, "get_settings", lambda: _settings())

    def fake_execute(sql, params):
        assert sql == hr._STAFF_LIST_SQL
        assert params["outlet_ids"] == [2000]
        return [
            {
                "user_id": 3013,
                "full_name": "Workflow HCM Cashier",
                "username": "workflow.hcm.cashier",
                "employee_code": "VN-HCM-CASHIER-3013",
                "status": "active",
                "outlet_id": 2000,
                "outlet_code": "VN-HCM-001",
                "outlet_name": "Saigon Central Outlet",
                "last_work_date": None,
            }
        ]

    monkeypatch.setattr(hr.pg, "execute_readonly", fake_execute)
    node = hr.make_hr_query(lambda: [2000, 2002])
    state = {
        "auth": _auth({"hr"}, {2000}),
        "normalized_question": "Outlet VN-HCM-001 có nhân viên nào?",
        "raw_entities": {"outlet_names": [], "product_names": [], "categories": [], "employee_names": []},
        "resolved_entities": {"outlet_ids": [2000]},
        "trace": [],
    }

    out = node(state)

    assert out["response_kind"] == "answer"
    assert out["template_key"] == "HR_staff_list"
    assert out["raw_result"][0]["user_id"] == 3013
    assert "Workflow HCM Cashier" in out["answer_text"]
    assert out["skip_answer_formatter_llm"] is True


def test_hr_staff_list_small_result_lists_every_employee(monkeypatch):
    monkeypatch.setattr(hr, "get_settings", lambda: _settings())

    rows = [
        {
            "user_id": idx,
            "full_name": f"Employee {idx}",
            "username": f"emp{idx}",
            "employee_code": f"E{idx:02d}",
            "status": "active",
            "outlet_id": 2000,
            "outlet_code": "VN-HCM-001",
            "outlet_name": "Saigon Central Outlet",
            "last_work_date": "2026-05-02",
        }
        for idx in range(1, 12)
    ]

    monkeypatch.setattr(hr.pg, "execute_readonly", lambda _sql, _params: rows)
    node = hr.make_hr_query(lambda: [2000])
    state = {
        "auth": _auth({"hr"}, {2000}),
        "normalized_question": "danh sách nhân viên outlet của tôi",
        "raw_entities": {"outlet_names": [], "product_names": [], "categories": [], "employee_names": []},
        "resolved_entities": {},
        "trace": [],
    }

    out = node(state)

    assert out["template_key"] == "HR_staff_list"
    assert "Employee 11" in out["answer_text"]
    assert "Hiển thị 10/11" not in out["answer_text"]
    assert "Nguồn dữ liệu: HR staff/work shift" in out["answer_text"]


def test_hr_staff_management_list_uses_role_filtered_sql(monkeypatch):
    monkeypatch.setattr(hr, "get_settings", lambda: _settings())

    def fake_execute(sql, params):
        assert sql == hr._STAFF_MANAGEMENT_LIST_SQL
        assert params["outlet_ids"] == [2000]
        assert params["limit"] == 50
        return [
            {
                "user_id": 99,
                "full_name": "Store Lead",
                "username": "store.lead",
                "employee_code": "MGR-099",
                "status": "active",
                "outlet_id": 2000,
                "outlet_code": "VN-HCM-001",
                "outlet_name": "Saigon Central Outlet",
                "management_roles": "outlet_manager",
            }
        ]

    monkeypatch.setattr(hr.pg, "execute_readonly", fake_execute)
    node = hr.make_hr_query(lambda: [2000, 2002])
    state = {
        "auth": _auth({"hr"}, {2000}),
        "normalized_question": "Thông tin nhân sự quản lý cửa hàng",
        "raw_entities": {"outlet_names": [], "product_names": [], "categories": [], "employee_names": []},
        "resolved_entities": {"outlet_ids": [2000]},
        "trace": [],
    }

    out = node(state)

    assert out["response_kind"] == "answer"
    assert out["template_key"] == "HR_staff_management_list"
    assert out["raw_result"][0]["user_id"] == 99
    assert "Store Lead" in out["answer_text"]
    assert "outlet_manager" in out["answer_text"]
    assert out["skip_answer_formatter_llm"] is True


def test_hr_payroll_requires_privileged_role(monkeypatch):
    monkeypatch.setattr(hr, "get_settings", lambda: _settings())
    monkeypatch.setattr(hr.pg, "execute_readonly", lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("no db")))

    node = hr.make_hr_query(lambda: [2000])
    state = {
        "auth": _auth({"outlet_manager"}, {2000}),
        "normalized_question": "nhân viên Canon Staff đã nhận bao nhiêu lương trong năm nay?",
        "raw_entities": {"outlet_names": [], "product_names": [], "categories": [], "employee_names": ["Canon Staff"]},
        "resolved_entities": {"outlet_ids": [2000]},
        "trace": [],
    }

    out = node(state)

    assert out["response_kind"] == "unsupported"
    assert "không có quyền" in out["answer_text"]


def test_hr_attendance_top_without_time_asks_clarification(monkeypatch):
    monkeypatch.setattr(hr, "get_settings", lambda: _settings())
    monkeypatch.setattr(hr.pg, "execute_readonly", lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("no db")))

    node = hr.make_hr_query(lambda: [2000])
    state = {
        "auth": _auth({"hr"}, {2000}),
        "normalized_question": "nhân viên nào đi làm nhiều nhất?",
        "raw_entities": {
            "outlet_names": [],
            "product_names": [],
            "categories": [],
            "employee_names": ["Dinh Hong Son (SIM-SMALL-EMP-0034)"],
        },
        "resolved_entities": {"outlet_ids": [2000]},
        "time_range": {"from_date": "2026-05-03", "to_date": "2026-05-03"},
        "trace": [],
    }

    out = node(state)

    assert out["response_kind"] == "clarification"
    assert out["response_hints"] == ["time_range"]
    assert "khoảng thời gian" in out["answer_text"]


def test_hr_attendance_top_trailing_one_year_gan_day_runs_without_clarification(monkeypatch):
    monkeypatch.setattr(hr, "get_settings", lambda: _settings())
    monkeypatch.setattr(hr, "today_local", lambda: date(2026, 5, 8))
    calls = []

    def fake_execute(sql, params):
        calls.append((sql, params))
        assert sql == hr._ATTENDANCE_TOP_SQL
        assert params["outlet_ids"] == [2000]
        assert params["from_date"] == "2025-05-09"
        assert params["to_date"] == "2026-05-08"
        return []

    monkeypatch.setattr(hr.pg, "execute_readonly", fake_execute)

    node = hr.make_hr_query(lambda: [2000])
    state = {
        "auth": _auth({"hr"}, {2000}),
        "normalized_question": (
            "nhân viên nào đi làm nhiều giờ nhất trong vòng 1 năm gần đây"
        ),
        "raw_entities": {"outlet_names": [], "product_names": [], "categories": [], "employee_names": []},
        "resolved_entities": {"outlet_ids": [2000]},
        "trace": [],
    }

    out = node(state)

    assert out["response_kind"] == "answer"
    assert out["template_key"] == "HR_attendance_top"
    assert [c[0] for c in calls] == [hr._ATTENDANCE_TOP_SQL]


def test_hr_time_followup_keeps_attendance_intent_and_parttime_filter(monkeypatch):
    monkeypatch.setattr(hr, "get_settings", lambda: _settings())
    calls = []

    def fake_search_outlets(term, *, limit=5):
        assert term == "Outlet 1"
        return [{"outlet_id": 2000, "outlet_code": "SIM-SMALL-OUT-0001", "outlet_name": "Outlet 1 - VN-HCM"}]

    def fake_execute(sql, params):
        calls.append((sql, params))
        assert sql == hr._ATTENDANCE_TOP_SQL
        assert params["outlet_ids"] == [2000]
        assert params["employment_type"] == "part_time"
        assert params["from_date"] == "2026-04-27"
        assert params["to_date"] == "2026-05-03"
        return [
            {
                "user_id": 7,
                "full_name": "Part Time Staff",
                "username": "pt.staff",
                "employee_code": "PT-007",
                "attended_days": 5,
                "attended_shifts": 6,
                "total_work_hours": Decimal("42.50"),
                "late_shifts": 1,
                "absent_shifts": 0,
                "first_work_date": "2026-04-28",
                "last_work_date": "2026-05-02",
                "employment_type": "part_time",
                "outlet_codes": "SIM-SMALL-OUT-0001",
                "outlet_labels": "Outlet 1 - VN-HCM (SIM-SMALL-OUT-0001)",
            }
        ]

    monkeypatch.setattr(hr.pg, "search_outlets", fake_search_outlets)
    monkeypatch.setattr(hr.pg, "execute_readonly", fake_execute)

    node = hr.make_hr_query(lambda: [2000])
    state = {
        "auth": _auth({"hr"}, {2000}),
        "normalized_question": "tuần này",
        "raw_entities": {"outlet_names": [], "product_names": [], "categories": [], "employee_names": []},
        "resolved_entities": {"outlet_ids": []},
        "time_range": {"from_date": "2026-04-27", "to_date": "2026-05-03"},
        "conversation_turns": [
            {"role": "user", "content": "ý tôi là nhân viên parttime đi làm nhiều nhất ở outlet 1"},
            {"role": "assistant", "content": "Bạn muốn xem trong khoảng thời gian nào?"},
        ],
        "trace": [],
    }

    out = node(state)

    assert [c[0] for c in calls] == [hr._ATTENDANCE_TOP_SQL]
    assert out["template_key"] == "HR_attendance_top"
    assert "42.50 giờ" in out["answer_text"]
    assert "part-time" in out["answer_text"]


def test_hr_attendance_top_does_not_infer_parttime_filter_from_top_row(monkeypatch):
    monkeypatch.setattr(hr, "get_settings", lambda: _settings())

    def fake_execute(sql, params):
        assert sql == hr._ATTENDANCE_TOP_SQL
        assert params["employment_type"] is None
        return [
            {
                "user_id": 7,
                "full_name": "Part Time Staff",
                "username": "pt.staff",
                "employee_code": "PT-007",
                "attended_days": 2,
                "attended_shifts": 3,
                "total_work_hours": Decimal("11.00"),
                "late_shifts": 0,
                "absent_shifts": 0,
                "first_work_date": "2026-05-01",
                "last_work_date": "2026-05-02",
                "employment_type": "part_time",
                "outlet_codes": "SIM-SMALL-OUT-0003",
                "outlet_labels": "Outlet VN-HCM-3 (SIM-SMALL-OUT-0003)",
            }
        ]

    monkeypatch.setattr(hr.pg, "execute_readonly", fake_execute)

    node = hr.make_hr_query(lambda: [2000])
    state = {
        "auth": _auth({"hr"}, {2000}),
        "normalized_question": "nhân viên nào đi làm nhiều nhất tháng này",
        "raw_entities": {"outlet_names": [], "product_names": [], "categories": [], "employee_names": []},
        "resolved_entities": {"outlet_ids": [2000]},
        "time_range": {"from_date": "2026-05-01", "to_date": "2026-05-04"},
        "trace": [],
    }

    out = node(state)

    assert out["template_key"] == "HR_attendance_top"
    first_line = out["answer_text"].splitlines()[0]
    assert "Trong khoảng 2026-05-01 đến 2026-05-02" in first_line
    assert "nhân viên có tổng giờ làm nhiều nhất" in first_line
    assert "nhân viên part-time có tổng giờ làm nhiều nhất" not in first_line


def test_hr_attendance_top_matches_most_hours_phrase(monkeypatch):
    monkeypatch.setattr(hr, "get_settings", lambda: _settings())

    def fake_execute(sql, params):
        assert sql == hr._ATTENDANCE_TOP_SQL
        assert params["outlet_ids"] == [2000]
        assert params["from_date"] == "2026-03-01"
        assert params["to_date"] == "2026-03-31"
        return [
            {
                "user_id": 12,
                "full_name": "Tran Minh Quan",
                "username": "tm.quan",
                "employee_code": "SIM-SMALL-EMP-0012",
                "attended_days": 20,
                "attended_shifts": 24,
                "total_work_hours": Decimal("188.50"),
                "late_shifts": 1,
                "absent_shifts": 0,
                "first_work_date": "2026-03-01",
                "last_work_date": "2026-03-31",
                "employment_type": "full_time",
                "outlet_codes": "SIM-SMALL-OUT-0001",
                "outlet_labels": "Outlet 1 - VN-HCM (SIM-SMALL-OUT-0001)",
            }
        ]

    monkeypatch.setattr(hr.pg, "execute_readonly", fake_execute)

    node = hr.make_hr_query(lambda: [2000])
    state = {
        "auth": _auth({"hr"}, {2000}),
        "normalized_question": "nhân viên nào làm nhiều giờ nhất tháng 3 2026",
        "raw_entities": {"outlet_names": [], "product_names": [], "categories": [], "employee_names": []},
        "resolved_entities": {"outlet_ids": [2000]},
        "time_range": {"from_date": "2026-03-01", "to_date": "2026-03-31"},
        "trace": [],
    }

    out = node(state)

    assert out["template_key"] == "HR_attendance_top"
    assert "Tran Minh Quan" in out["answer_text"]
    assert "188.50 giờ" in out["answer_text"]


def test_hr_employee_work_hours_uses_employee_code_not_staff_list(monkeypatch):
    monkeypatch.setattr(hr, "get_settings", lambda: _settings())
    calls = []

    def fake_search_outlets(term, *, limit=3):
        return [{"outlet_id": 2000, "outlet_code": "SIM-SMALL-OUT-0003", "outlet_name": "Outlet VN-HCM-3"}]

    def fake_execute(sql, params):
        calls.append((sql, params))
        if sql == hr._EMPLOYEE_SEARCH_SQL:
            assert params["term"] == "SIM-SMALL-EMP-0034"
            assert params["pattern"] == "%SIM-SMALL-EMP-0034%"
            return [
                {
                    "user_id": 34,
                    "full_name": "Dinh Hong Son",
                    "username": "sim_small_emp_0034",
                    "employee_code": "SIM-SMALL-EMP-0034",
                }
            ]
        if sql == hr._EMPLOYEE_WORK_HOURS_SQL:
            assert params["user_id"] == 34
            assert params["outlet_ids"] == [2000]
            assert params["from_date"] == "2026-05-01"
            assert params["to_date"] == "2026-05-04"
            return [
                {
                    "user_id": 34,
                    "full_name": "Dinh Hong Son",
                    "username": "sim_small_emp_0034",
                    "employee_code": "SIM-SMALL-EMP-0034",
                    "attended_days": 2,
                    "attended_shifts": 2,
                    "total_work_hours": Decimal("16.25"),
                    "late_shifts": 1,
                    "absent_shifts": 0,
                    "first_work_date": date(2026, 5, 1),
                    "last_work_date": date(2026, 5, 2),
                    "employment_type": "full_time",
                    "outlet_codes": "SIM-SMALL-OUT-0003",
                    "outlet_labels": "Outlet VN-HCM-3 (SIM-SMALL-OUT-0003)",
                }
            ]
        raise AssertionError("unexpected sql")

    monkeypatch.setattr(hr.pg, "search_outlets", fake_search_outlets)
    monkeypatch.setattr(hr.pg, "execute_readonly", fake_execute)

    node = hr.make_hr_query(lambda: [2000])
    state = {
        "auth": _auth({"hr"}, {2000}),
        "normalized_question": (
            "- Dinh Hong Son (SIM-SMALL-EMP-0034) - Outlet VN-HCM-3 "
            "(SIM-SMALL-OUT-0003), ca gần nhất 2026-05-02 tháng này đã làm bao nhiêu giờ"
        ),
        "raw_entities": {
            "outlet_names": [],
            "product_names": [],
            "categories": [],
            "employee_names": ["Dinh Hong Son (SIM-SMALL-EMP-0034)"],
        },
        "resolved_entities": {"outlet_ids": [2000]},
        "time_range": {"from_date": "2026-05-01", "to_date": "2026-05-04"},
        "trace": [],
    }

    out = node(state)

    assert [c[0] for c in calls] == [hr._EMPLOYEE_SEARCH_SQL, hr._EMPLOYEE_WORK_HOURS_SQL]
    assert out["response_kind"] == "answer"
    assert out["template_key"] == "HR_employee_work_hours"
    assert "Dinh Hong Son (SIM-SMALL-EMP-0034)" in out["answer_text"]
    assert "16.25 giờ" in out["answer_text"]
    assert "Outlet VN-HCM-3" in out["answer_text"]


def test_hr_employee_work_hours_cleans_time_context_from_employee_name(monkeypatch):
    monkeypatch.setattr(hr, "get_settings", lambda: _settings())
    calls = []

    def fake_execute(sql, params):
        calls.append((sql, params))
        if sql == hr._EMPLOYEE_SEARCH_SQL:
            assert params["term"] == "Dinh Hong Son"
            assert params["pattern"] == "%Dinh Hong Son%"
            return [
                {
                    "user_id": 34,
                    "full_name": "Dinh Hong Son",
                    "username": "sim_small_emp_0034",
                    "employee_code": "SIM-SMALL-EMP-0034",
                }
            ]
        if sql == hr._EMPLOYEE_WORK_HOURS_SQL:
            assert params["user_id"] == 34
            return [
                {
                    "user_id": 34,
                    "full_name": "Dinh Hong Son",
                    "username": "sim_small_emp_0034",
                    "employee_code": "SIM-SMALL-EMP-0034",
                    "attended_days": 2,
                    "attended_shifts": 2,
                    "total_work_hours": Decimal("10.00"),
                    "late_shifts": 0,
                    "absent_shifts": 0,
                    "first_work_date": date(2026, 5, 1),
                    "last_work_date": date(2026, 5, 2),
                    "employment_type": "full_time",
                    "outlet_codes": "SIM-SMALL-OUT-0003",
                    "outlet_labels": "Outlet VN-HCM-3 (SIM-SMALL-OUT-0003)",
                }
            ]
        raise AssertionError("unexpected sql")

    monkeypatch.setattr(hr.pg, "execute_readonly", fake_execute)

    node = hr.make_hr_query(lambda: [2000])
    state = {
        "auth": _auth({"hr"}, {2000}),
        "normalized_question": "Dinh Hong Son tháng này đã làm bao nhiêu giờ?",
        "raw_entities": {"outlet_names": [], "product_names": [], "categories": [], "employee_names": []},
        "resolved_entities": {"outlet_ids": [2000]},
        "time_range": {"from_date": "2026-05-01", "to_date": "2026-05-04"},
        "trace": [],
    }

    out = node(state)

    assert [c[0] for c in calls] == [hr._EMPLOYEE_SEARCH_SQL, hr._EMPLOYEE_WORK_HOURS_SQL]
    assert out["response_kind"] == "answer"
    assert out["template_key"] == "HR_employee_work_hours"
    assert "Dinh Hong Son (SIM-SMALL-EMP-0034)" in out["answer_text"]
    assert "10.00 giờ" in out["answer_text"]


def test_hr_employee_work_hours_time_followup_keeps_employee_and_uses_new_period(monkeypatch):
    monkeypatch.setattr(hr, "get_settings", lambda: _settings())
    calls = []

    def fake_execute(sql, params):
        calls.append((sql, params))
        if sql == hr._EMPLOYEE_SEARCH_SQL:
            assert params["term"] == "SIM-SMALL-EMP-0088"
            assert params["pattern"] == "%SIM-SMALL-EMP-0088%"
            return [
                {
                    "user_id": 88,
                    "full_name": "Nguyễn Văn An",
                    "username": "nguyen.van.an",
                    "employee_code": "SIM-SMALL-EMP-0088",
                }
            ]
        if sql == hr._EMPLOYEE_WORK_HOURS_SQL:
            assert params["user_id"] == 88
            assert params["from_date"] == "2026-04-01"
            assert params["to_date"] == "2026-04-30"
            return [
                {
                    "user_id": 88,
                    "full_name": "Nguyễn Văn An",
                    "username": "nguyen.van.an",
                    "employee_code": "SIM-SMALL-EMP-0088",
                    "attended_days": 6,
                    "attended_shifts": 8,
                    "total_work_hours": Decimal("38.50"),
                    "late_shifts": 1,
                    "absent_shifts": 0,
                    "first_work_date": date(2026, 4, 2),
                    "last_work_date": date(2026, 4, 28),
                    "employment_type": "full_time",
                    "outlet_codes": "SIM-SMALL-OUT-0001",
                    "outlet_labels": "Outlet 1 - VN-HCM (SIM-SMALL-OUT-0001)",
                }
            ]
        raise AssertionError("unexpected sql")

    monkeypatch.setattr(hr.pg, "execute_readonly", fake_execute)

    node = hr.make_hr_query(lambda: [2000])
    state = {
        "auth": _auth({"hr"}, {2000}),
        "normalized_question": "tháng trước thì sao",
        "contextualized_question": "Nguyễn Văn An đã làm bao nhiêu giờ tháng trước thì sao",
        "contextualization_source": "rule_time_followup",
        "conversation_context": (
            "User: Nguyễn Văn An tháng này đã làm bao nhiêu giờ?\n"
            "Assistant: Nguyễn Văn An (SIM-SMALL-EMP-0088) đã làm 18.50 giờ trong tháng này."
        ),
        "raw_entities": {"outlet_names": [], "product_names": [], "categories": [], "employee_names": []},
        "resolved_entities": {"outlet_ids": [2000]},
        "time_range": {"from_date": "2026-04-01", "to_date": "2026-04-30"},
        "trace": [],
    }

    out = node(state)

    assert [c[0] for c in calls] == [hr._EMPLOYEE_SEARCH_SQL, hr._EMPLOYEE_WORK_HOURS_SQL]
    assert out["response_kind"] == "answer"
    assert out["template_key"] == "HR_employee_work_hours"
    assert "Nguyễn Văn An (SIM-SMALL-EMP-0088)" in out["answer_text"]
    assert "38.50 giờ" in out["answer_text"]
    assert "2026-04-01 đến 2026-04-30" in out["answer_text"]


def test_hr_time_followup_does_not_pick_first_code_when_context_has_many_matching_names(monkeypatch):
    monkeypatch.setattr(hr, "get_settings", lambda: _settings())

    def fake_execute(sql, params):
        assert sql == hr._EMPLOYEE_SEARCH_SQL
        assert params["term"] == "Dinh Hong Son"
        return [
            {"user_id": 143, "full_name": "Dinh Hong Son", "username": "sim_small_emp_0143", "employee_code": "SIM-SMALL-EMP-0143"},
            {"user_id": 34, "full_name": "Dinh Hong Son", "username": "sim_small_emp_0034", "employee_code": "SIM-SMALL-EMP-0034"},
        ]

    monkeypatch.setattr(hr.pg, "execute_readonly", fake_execute)

    node = hr.make_hr_query(lambda: [2000])
    state = {
        "auth": _auth({"hr"}, {2000}),
        "normalized_question": "tháng trước thì sao",
        "contextualized_question": "Dinh Hong Son đã làm bao nhiêu giờ tháng trước thì sao",
        "contextualization_source": "rule_time_followup",
        "conversation_context": (
            "Assistant: Tìm thấy nhiều nhân viên khớp 'Dinh Hong Son'. Bạn muốn xem giờ làm của ai?\n"
            "- Dinh Hong Son (SIM-SMALL-EMP-0143) - username sim_small_emp_0143\n"
            "- Dinh Hong Son (SIM-SMALL-EMP-0034) - username sim_small_emp_0034"
        ),
        "raw_entities": {"outlet_names": [], "product_names": [], "categories": [], "employee_names": []},
        "resolved_entities": {"outlet_ids": [2000]},
        "time_range": {"from_date": "2026-04-01", "to_date": "2026-04-30"},
        "trace": [],
    }

    out = node(state)

    assert out["response_kind"] == "clarification"
    assert out["template_key"] == "HR_employee_work_hours"
    assert "Tìm thấy nhiều nhân viên khớp 'Dinh Hong Son'" in out["answer_text"]


def test_hr_employee_work_hours_without_time_asks_clarification(monkeypatch):
    monkeypatch.setattr(hr, "get_settings", lambda: _settings())
    monkeypatch.setattr(hr.pg, "execute_readonly", lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("no db")))

    node = hr.make_hr_query(lambda: [2000])
    state = {
        "auth": _auth({"hr"}, {2000}),
        "normalized_question": "Dinh Hong Son đã làm bao nhiêu giờ?",
        "raw_entities": {"outlet_names": [], "product_names": [], "categories": [], "employee_names": ["Dinh Hong Son"]},
        "resolved_entities": {"outlet_ids": [2000]},
        "trace": [],
    }

    out = node(state)

    assert out["response_kind"] == "clarification"
    assert out["template_key"] == "HR_employee_work_hours"
    assert out["response_hints"] == ["time_range"]
    assert "khoảng thời gian" in out["answer_text"]


def test_hr_employee_work_hours_selection_phrase_without_time_asks_clarification(monkeypatch):
    monkeypatch.setattr(hr, "get_settings", lambda: _settings())
    monkeypatch.setattr(hr.pg, "execute_readonly", lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("no db")))

    node = hr.make_hr_query(lambda: [2000])
    state = {
        "auth": _auth({"hr"}, {2000}),
        "normalized_question": "tôi muốn xem giờ làm của - Nguyen Van An (SIM-SMALL-EMP-0009) - username sim_small_emp_0009",
        "raw_entities": {"outlet_names": [], "product_names": [], "categories": [], "employee_names": []},
        "resolved_entities": {"outlet_ids": [2000]},
        "trace": [],
    }

    out = node(state)

    assert out["response_kind"] == "clarification"
    assert out["template_key"] == "HR_employee_work_hours"
    assert out["response_hints"] == ["time_range"]
    assert "khoảng thời gian" in out["answer_text"]


def test_hr_employee_work_hours_selection_phrase_with_context_time_uses_code(monkeypatch):
    monkeypatch.setattr(hr, "get_settings", lambda: _settings())
    calls = []

    def fake_execute(sql, params):
        calls.append((sql, params))
        if sql == hr._EMPLOYEE_SEARCH_SQL:
            assert params["term"] == "SIM-SMALL-EMP-0009"
            assert params["pattern"] == "%SIM-SMALL-EMP-0009%"
            return [
                {
                    "user_id": 9,
                    "full_name": "Nguyen Van An",
                    "username": "sim_small_emp_0009",
                    "employee_code": "SIM-SMALL-EMP-0009",
                }
            ]
        if sql == hr._EMPLOYEE_WORK_HOURS_SQL:
            assert params["user_id"] == 9
            assert params["from_date"] == "2026-05-01"
            assert params["to_date"] == "2026-05-04"
            return [
                {
                    "user_id": 9,
                    "full_name": "Nguyen Van An",
                    "username": "sim_small_emp_0009",
                    "employee_code": "SIM-SMALL-EMP-0009",
                    "attended_days": 2,
                    "attended_shifts": 3,
                    "total_work_hours": Decimal("12.75"),
                    "late_shifts": 0,
                    "absent_shifts": 1,
                    "first_work_date": date(2026, 5, 1),
                    "last_work_date": date(2026, 5, 2),
                    "employment_type": "part_time",
                    "outlet_codes": "SIM-SMALL-OUT-0003",
                    "outlet_labels": "Outlet VN-HCM-3 (SIM-SMALL-OUT-0003)",
                }
            ]
        raise AssertionError("unexpected sql")

    monkeypatch.setattr(hr.pg, "execute_readonly", fake_execute)

    node = hr.make_hr_query(lambda: [2000])
    state = {
        "auth": _auth({"hr"}, {2000}),
        "normalized_question": "tôi muốn xem giờ làm của - Nguyen Van An (SIM-SMALL-EMP-0009) - username sim_small_emp_0009",
        "contextualized_question": (
            "Nguyen Van An tháng này làm bao nhiêu giờ "
            "tôi muốn xem giờ làm của - Nguyen Van An (SIM-SMALL-EMP-0009) - username sim_small_emp_0009"
        ),
        "contextualization_source": "rule_hr_employee_selection_followup",
        "raw_entities": {"outlet_names": [], "product_names": [], "categories": [], "employee_names": []},
        "resolved_entities": {"outlet_ids": [2000]},
        "time_range": {"from_date": "2026-05-01", "to_date": "2026-05-04"},
        "trace": [],
    }

    out = node(state)

    assert [c[0] for c in calls] == [hr._EMPLOYEE_SEARCH_SQL, hr._EMPLOYEE_WORK_HOURS_SQL]
    assert out["response_kind"] == "answer"
    assert out["template_key"] == "HR_employee_work_hours"
    assert "Nguyen Van An (SIM-SMALL-EMP-0009)" in out["answer_text"]
    assert "12.75 giờ" in out["answer_text"]


def test_hr_work_hours_total_does_not_treat_outlet_code_as_employee(monkeypatch):
    monkeypatch.setattr(hr, "get_settings", lambda: _settings())
    monkeypatch.setattr(
        hr.pg,
        "search_outlets",
        lambda _term, *, limit=3: [
            {"outlet_id": 2000, "outlet_code": "SIM-SMALL-OUT-0003", "outlet_name": "Outlet VN-HCM-3"}
        ],
    )

    def fake_execute(sql, params):
        assert sql == hr._WORK_HOURS_TOTAL_SQL
        assert params["outlet_ids"] == [2000]
        return [
            {
                "employee_count": 3,
                "attended_days": 2,
                "attended_shifts": 9,
                "total_work_hours": Decimal("29.93"),
                "late_shifts": 2,
                "absent_shifts": 0,
                "first_work_date": date(2026, 5, 1),
                "last_work_date": date(2026, 5, 2),
                "outlet_codes": "SIM-SMALL-OUT-0003",
                "outlet_labels": "Outlet VN-HCM-3 (SIM-SMALL-OUT-0003)",
            }
        ]

    monkeypatch.setattr(hr.pg, "execute_readonly", fake_execute)

    node = hr.make_hr_query(lambda: [2000])
    state = {
        "auth": _auth({"hr"}, {2000}),
        "normalized_question": "Outlet VN-HCM-3 tháng này đã làm bao nhiêu giờ?",
        "raw_entities": {"outlet_names": ["VN-HCM-3"], "product_names": [], "categories": [], "employee_names": ["Outlet VN-HCM-3"]},
        "resolved_entities": {"outlet_ids": [2000]},
        "time_range": {"from_date": "2026-05-01", "to_date": "2026-05-04"},
        "trace": [],
    }

    out = node(state)

    assert out["response_kind"] == "answer"
    assert out["template_key"] == "HR_work_hours_total"
    assert "29.93 giờ" in out["answer_text"]
    assert "3 nhân viên" in out["answer_text"]


def test_hr_aggregate_work_hours_not_mistakes_time_phrase_for_employee(monkeypatch):
    """Phrases like 'tổng giờ làm tháng trước' must not capture 'tháng trước' as a name."""

    monkeypatch.setattr(hr, "get_settings", lambda: _settings())

    def fake_execute(sql, params):
        assert sql == hr._WORK_HOURS_TOTAL_SQL
        assert params["outlet_ids"] == [2000]
        return []

    monkeypatch.setattr(hr.pg, "execute_readonly", fake_execute)

    node = hr.make_hr_query(lambda: [2000])
    state = {
        "auth": _auth({"hr"}, {2000}),
        "normalized_question": "tổng giờ làm tháng trước",
        "raw_entities": {"outlet_names": [], "product_names": [], "categories": [], "employee_names": []},
        "resolved_entities": {"outlet_ids": [2000]},
        "time_range": {"from_date": "2026-04-01", "to_date": "2026-04-30"},
        "trace": [],
    }

    out = node(state)
    assert out["template_key"] == "HR_work_hours_total"


def test_hr_payroll_total_uses_employee_then_payroll_queries(monkeypatch):
    monkeypatch.setattr(hr, "get_settings", lambda: _settings())
    calls = []

    def fake_execute(sql, params):
        calls.append((sql, params))
        if sql == hr._EMPLOYEE_SEARCH_SQL:
            assert params["pattern"] == "%Canon Staff%"
            return [
                {
                    "user_id": 3005,
                    "full_name": "Canon Staff",
                    "username": "canon.staff",
                    "employee_code": "CANON-STAFF",
                }
            ]
        if sql == hr._PAYROLL_TOTAL_SQL:
            assert params["user_id"] == 3005
            assert params["outlet_ids"] == [2000]
            return [
                {
                    "user_id": 3005,
                    "full_name": "Canon Staff",
                    "username": "canon.staff",
                    "employee_code": "CANON-STAFF",
                    "currency_code": "VND",
                    "total_net_salary": Decimal("19200000"),
                    "total_base_salary": Decimal("18000000"),
                    "payroll_count": 1,
                    "first_period_start": "2026-03-01",
                    "last_period_end": "2026-03-31",
                    "paid_count": 0,
                    "approved_count": 1,
                }
            ]
        raise AssertionError("unexpected sql")

    monkeypatch.setattr(hr.pg, "execute_readonly", fake_execute)

    node = hr.make_hr_query(lambda: [2000])
    state = {
        "auth": _auth({"finance"}, {2000}),
        "normalized_question": "Canon Staff đã nhận bao nhiêu lương trong năm nay?",
        "raw_entities": {"outlet_names": [], "product_names": [], "categories": [], "employee_names": []},
        "resolved_entities": {"outlet_ids": [2000]},
        "time_range": {"from_date": "2026-01-01", "to_date": "2026-05-03"},
        "trace": [],
    }

    out = node(state)

    assert [c[0] for c in calls] == [hr._EMPLOYEE_SEARCH_SQL, hr._PAYROLL_TOTAL_SQL]
    assert out["response_kind"] == "answer"
    assert out["template_key"] == "HR_payroll_total"
    assert "19,200,000 VNĐ" in out["answer_text"]
    assert "1 đã duyệt" in out["answer_text"]


def test_hr_payroll_employee_followup_uses_contextualized_question(monkeypatch):
    monkeypatch.setattr(hr, "get_settings", lambda: _settings())
    calls = []

    def fake_execute(sql, params):
        calls.append((sql, params))
        if sql == hr._EMPLOYEE_SEARCH_SQL:
            assert params["pattern"] == "%Canon Staff%"
            return [
                {
                    "user_id": 3005,
                    "full_name": "Canon Staff",
                    "username": "canon.staff",
                    "employee_code": "CANON-STAFF",
                }
            ]
        if sql == hr._PAYROLL_TOTAL_SQL:
            return [
                {
                    "user_id": 3005,
                    "full_name": "Canon Staff",
                    "username": "canon.staff",
                    "employee_code": "CANON-STAFF",
                    "currency_code": "VND",
                    "total_net_salary": Decimal("12000000"),
                    "total_base_salary": Decimal("12000000"),
                    "payroll_count": 1,
                    "first_period_start": "2026-01-01",
                    "last_period_end": "2026-01-31",
                    "paid_count": 1,
                    "approved_count": 0,
                }
            ]
        raise AssertionError("unexpected sql")

    monkeypatch.setattr(hr.pg, "execute_readonly", fake_execute)

    node = hr.make_hr_query(lambda: [2000])
    state = {
        "auth": _auth({"finance"}, {2000}),
        "normalized_question": "Canon Staff",
        "contextualized_question": "lương năm nay của nhân viên này là bao nhiêu Canon Staff",
        "contextualization_source": "rule_employee_followup",
        "raw_entities": {"outlet_names": [], "product_names": [], "categories": [], "employee_names": []},
        "resolved_entities": {"outlet_ids": [2000]},
        "time_range": {"from_date": "2026-01-01", "to_date": "2026-05-03"},
        "trace": [],
    }

    out = node(state)

    assert [c[0] for c in calls] == [hr._EMPLOYEE_SEARCH_SQL, hr._PAYROLL_TOTAL_SQL]
    assert out["template_key"] == "HR_payroll_total"
    assert "12,000,000 VNĐ" in out["answer_text"]


def test_hr_payroll_deictic_followup_uses_single_employee_code_from_context(monkeypatch):
    monkeypatch.setattr(hr, "get_settings", lambda: _settings())
    calls = []

    def fake_execute(sql, params):
        calls.append((sql, params))
        if sql == hr._EMPLOYEE_SEARCH_SQL:
            assert params["term"] == "SIM-SMALL-EMP-0034"
            return [
                {
                    "user_id": 34,
                    "full_name": "Dinh Hong Son",
                    "username": "sim_small_emp_0034",
                    "employee_code": "SIM-SMALL-EMP-0034",
                }
            ]
        if sql == hr._PAYROLL_TOTAL_SQL:
            assert params["user_id"] == 34
            return [
                {
                    "user_id": 34,
                    "full_name": "Dinh Hong Son",
                    "username": "sim_small_emp_0034",
                    "employee_code": "SIM-SMALL-EMP-0034",
                    "currency_code": "VND",
                    "total_net_salary": Decimal("15000000"),
                    "total_base_salary": Decimal("15000000"),
                    "payroll_count": 1,
                    "first_period_start": "2026-01-01",
                    "last_period_end": "2026-01-31",
                    "paid_count": 1,
                    "approved_count": 0,
                }
            ]
        raise AssertionError("unexpected sql")

    monkeypatch.setattr(hr.pg, "execute_readonly", fake_execute)

    node = hr.make_hr_query(lambda: [2000])
    state = {
        "auth": _auth({"finance"}, {2000}),
        "normalized_question": "Nhân viên này đã nhận bao nhiêu lương trong năm nay?",
        "conversation_context": (
            "Assistant: Dinh Hong Son (SIM-SMALL-EMP-0034) có tổng giờ làm 10.00 giờ trong tháng này."
        ),
        "raw_entities": {"outlet_names": [], "product_names": [], "categories": [], "employee_names": []},
        "resolved_entities": {"outlet_ids": [2000]},
        "time_range": {"from_date": "2026-01-01", "to_date": "2026-05-04"},
        "trace": [],
    }

    out = node(state)

    assert [c[0] for c in calls] == [hr._EMPLOYEE_SEARCH_SQL, hr._PAYROLL_TOTAL_SQL]
    assert out["template_key"] == "HR_payroll_total"
    assert "15,000,000 VNĐ" in out["answer_text"]


def test_hr_work_hours_ordinal_followup_uses_selected_employee_code(monkeypatch):
    monkeypatch.setattr(hr, "get_settings", lambda: _settings())
    calls = []

    def fake_execute(sql, params):
        calls.append((sql, params))
        if sql == hr._EMPLOYEE_SEARCH_SQL:
            assert params["term"] == "SIM-SMALL-EMP-0034"
            return [
                {
                    "user_id": 34,
                    "full_name": "Dinh Hong Son",
                    "username": "sim_small_emp_0034",
                    "employee_code": "SIM-SMALL-EMP-0034",
                }
            ]
        if sql == hr._EMPLOYEE_WORK_HOURS_SQL:
            assert params["user_id"] == 34
            return [
                {
                    "user_id": 34,
                    "full_name": "Dinh Hong Son",
                    "username": "sim_small_emp_0034",
                    "employee_code": "SIM-SMALL-EMP-0034",
                    "attended_days": 2,
                    "attended_shifts": 2,
                    "total_work_hours": Decimal("10.00"),
                    "late_shifts": 0,
                    "absent_shifts": 0,
                    "first_work_date": date(2026, 5, 1),
                    "last_work_date": date(2026, 5, 2),
                    "employment_type": "full_time",
                    "outlet_codes": "SIM-SMALL-OUT-0003",
                    "outlet_labels": "Outlet VN-HCM-3 (SIM-SMALL-OUT-0003)",
                }
            ]
        raise AssertionError("unexpected sql")

    monkeypatch.setattr(hr.pg, "execute_readonly", fake_execute)

    node = hr.make_hr_query(lambda: [2000])
    state = {
        "auth": _auth({"hr"}, {2000}),
        "normalized_question": "nhân viên 2 tháng này đã làm bao nhiêu giờ?",
        "conversation_context": (
            "Assistant: Tìm thấy nhiều nhân viên khớp 'Dinh Hong Son'. Bạn muốn xem giờ làm của ai?\n"
            "- Dinh Hong Son (SIM-SMALL-EMP-0143) - username sim_small_emp_0143\n"
            "- Dinh Hong Son (SIM-SMALL-EMP-0034) - username sim_small_emp_0034"
        ),
        "raw_entities": {"outlet_names": [], "product_names": [], "categories": [], "employee_names": []},
        "resolved_entities": {"outlet_ids": [2000]},
        "time_range": {"from_date": "2026-05-01", "to_date": "2026-05-04"},
        "trace": [],
    }

    out = node(state)

    assert [c[0] for c in calls] == [hr._EMPLOYEE_SEARCH_SQL, hr._EMPLOYEE_WORK_HOURS_SQL]
    assert out["template_key"] == "HR_employee_work_hours"
    assert "10.00 giờ" in out["answer_text"]


def test_hr_employee_tenure_uses_employee_code_from_context(monkeypatch):
    monkeypatch.setattr(hr, "get_settings", lambda: _settings())
    monkeypatch.setattr(hr, "today_local", lambda: date(2026, 5, 4))
    calls = []

    def fake_execute(sql, params):
        calls.append((sql, params))
        if sql == hr._EMPLOYEE_SEARCH_SQL:
            assert params["term"] == "SIM-SMALL-EMP-0084"
            return [
                {
                    "user_id": 84,
                    "full_name": "Ngo Anh Linh",
                    "username": "sim_small_emp_0084",
                    "employee_code": "SIM-SMALL-EMP-0084",
                }
            ]
        if sql == hr._EMPLOYEE_TENURE_SQL:
            assert params["user_id"] == 84
            return [
                {
                    "user_id": 84,
                    "full_name": "Ngo Anh Linh",
                    "username": "sim_small_emp_0084",
                    "employee_code": "SIM-SMALL-EMP-0084",
                    "first_start_date": date(2025, 11, 23),
                    "latest_contract_start_date": date(2025, 11, 23),
                    "contract_count": 1,
                    "active_contract_count": 1,
                    "employment_types": "full_time",
                    "contract_statuses": "active",
                }
            ]
        raise AssertionError("unexpected sql")

    monkeypatch.setattr(hr.pg, "execute_readonly", fake_execute)

    node = hr.make_hr_query(lambda: [2000])
    state = {
        "auth": _auth({"hr"}, {2000}),
        "normalized_question": "ngo anh linh đã làm việc ở công ty bao lâu rồi",
        "conversation_context": (
            "User: nhân viên đi làm nhiều nhất tuần này\n"
            "Assistant: Trong khoảng này, nhân viên có tổng giờ làm nhiều nhất là "
            "Ngo Anh Linh (SIM-SMALL-EMP-0084)."
        ),
        "raw_entities": {"outlet_names": [], "product_names": [], "categories": [], "employee_names": ["ngo anh linh"]},
        "resolved_entities": {"outlet_ids": [2000]},
        "trace": [],
    }

    out = node(state)

    assert [c[0] for c in calls] == [hr._EMPLOYEE_SEARCH_SQL, hr._EMPLOYEE_TENURE_SQL]
    assert out["template_key"] == "HR_employee_tenure"
    assert "Ngo Anh Linh (SIM-SMALL-EMP-0084)" in out["answer_text"]
    assert "2025-11-23" in out["answer_text"]
    assert "5 tháng" in out["answer_text"]


def test_hr_employee_tenure_asks_when_name_matches_many(monkeypatch):
    monkeypatch.setattr(hr, "get_settings", lambda: _settings())

    def fake_execute(sql, params):
        assert sql == hr._EMPLOYEE_SEARCH_SQL
        return [
            {"user_id": 1, "full_name": "Ngo Anh Linh", "username": "a", "employee_code": "EMP-1"},
            {"user_id": 2, "full_name": "Ngo Anh Linh", "username": "b", "employee_code": "EMP-2"},
        ]

    monkeypatch.setattr(hr.pg, "execute_readonly", fake_execute)

    node = hr.make_hr_query(lambda: [2000])
    state = {
        "auth": _auth({"hr"}, {2000}),
        "normalized_question": "ngo anh linh đã làm việc ở công ty bao lâu rồi",
        "raw_entities": {"outlet_names": [], "product_names": [], "categories": [], "employee_names": ["ngo anh linh"]},
        "resolved_entities": {"outlet_ids": [2000]},
        "trace": [],
    }

    out = node(state)

    assert out["response_kind"] == "clarification"
    assert out["template_key"] == "HR_employee_tenure"
    assert "Tìm thấy nhiều nhân viên" in out["answer_text"]


def test_hr_work_hours_ambiguous_duplicate_name_asks_for_employee_code(monkeypatch):
    monkeypatch.setattr(hr, "get_settings", lambda: _settings())
    calls = []

    def fake_execute(sql, params):
        calls.append((sql, params))
        assert sql == hr._EMPLOYEE_SEARCH_SQL
        assert params["pattern"] == "%Nguyen Van An%"
        return [
            {"user_id": 79, "full_name": "Nguyen Van An", "username": "sim_small_emp_0079", "employee_code": "SIM-SMALL-EMP-0079"},
            {"user_id": 90, "full_name": "Nguyen Van An", "username": "sim_small_emp_0090", "employee_code": "SIM-SMALL-EMP-0090"},
            {"user_id": 185, "full_name": "Nguyen Van An", "username": "sim_small_emp_0185", "employee_code": "SIM-SMALL-EMP-0185"},
        ]

    monkeypatch.setattr(hr.pg, "execute_readonly", fake_execute)

    node = hr.make_hr_query(lambda: [2000])
    state = {
        "auth": _auth({"hr"}, {2000}),
        "normalized_question": "Nguyen Van An tháng này làm bao nhiêu giờ?",
        "raw_entities": {"outlet_names": [], "product_names": [], "categories": [], "employee_names": ["Nguyen Van An"]},
        "resolved_entities": {"outlet_ids": [2000]},
        "time_range": {"from_date": "2026-05-01", "to_date": "2026-05-04"},
        "trace": [],
    }

    out = node(state)

    assert [c[0] for c in calls] == [hr._EMPLOYEE_SEARCH_SQL]
    assert out["response_kind"] == "clarification"
    assert out["template_key"] == "HR_employee_work_hours"
    assert "Tìm thấy nhiều nhân viên" in out["answer_text"]
    assert "SIM-SMALL-EMP-0079" in out["answer_text"]


def test_hr_work_hours_exact_code_returns_may_hours_with_coverage(monkeypatch):
    monkeypatch.setattr(hr, "get_settings", lambda: _settings())
    calls = []

    def fake_execute(sql, params):
        calls.append((sql, params))
        if sql == hr._EMPLOYEE_SEARCH_SQL:
            assert params["term"] == "SIM-SMALL-EMP-0079"
            return [
                {
                    "user_id": 79,
                    "full_name": "Nguyen Van An",
                    "username": "sim_small_emp_0079",
                    "employee_code": "SIM-SMALL-EMP-0079",
                }
            ]
        if sql == hr._EMPLOYEE_WORK_HOURS_SQL:
            assert params["from_date"] == "2026-05-01"
            assert params["to_date"] == "2026-05-04"
            return [
                {
                    "user_id": 79,
                    "full_name": "Nguyen Van An",
                    "username": "sim_small_emp_0079",
                    "employee_code": "SIM-SMALL-EMP-0079",
                    "attended_days": 2,
                    "attended_shifts": 6,
                    "total_work_hours": Decimal("8.00"),
                    "late_shifts": 0,
                    "absent_shifts": 0,
                    "first_work_date": date(2026, 5, 1),
                    "last_work_date": date(2026, 5, 2),
                    "employment_type": "part_time",
                    "outlet_codes": "SIM-SMALL-OUT-0003",
                    "outlet_labels": "Outlet VN-HCM-3 (SIM-SMALL-OUT-0003)",
                }
            ]
        raise AssertionError("unexpected sql")

    monkeypatch.setattr(hr.pg, "execute_readonly", fake_execute)

    node = hr.make_hr_query(lambda: [2000])
    state = {
        "auth": _auth({"hr"}, {2000}),
        "normalized_question": "SIM-SMALL-EMP-0079 tháng này làm bao nhiêu giờ?",
        "raw_entities": {"outlet_names": [], "product_names": [], "categories": [], "employee_names": []},
        "resolved_entities": {"outlet_ids": [2000]},
        "time_range": {"from_date": "2026-05-01", "to_date": "2026-05-04"},
        "data_coverage_context": {
            "datasets": [
                {
                    "source": "postgres",
                    "dataset": "core.work_shift",
                    "min_date": "2025-07-02",
                    "max_date": "2026-05-02",
                    "row_count": 43836,
                }
            ],
            "errors": [],
        },
        "trace": [],
    }

    out = node(state)

    assert [c[0] for c in calls] == [hr._EMPLOYEE_SEARCH_SQL, hr._EMPLOYEE_WORK_HOURS_SQL]
    assert out["template_key"] == "HR_employee_work_hours"
    assert "trong khoảng 2026-05-01 đến 2026-05-02" in out["answer_text"]
    assert "8.00 giờ" in out["answer_text"]
    assert "bạn hỏi đến 2026-05-04" in out["answer_text"]


def test_hr_payroll_empty_period_does_not_report_zero_salary(monkeypatch):
    monkeypatch.setattr(hr, "get_settings", lambda: _settings())

    def fake_execute(sql, params):
        if sql == hr._EMPLOYEE_SEARCH_SQL:
            return [
                {
                    "user_id": 79,
                    "full_name": "Nguyen Van An",
                    "username": "sim_small_emp_0079",
                    "employee_code": "SIM-SMALL-EMP-0079",
                }
            ]
        if sql == hr._PAYROLL_TOTAL_SQL:
            assert params["from_date"] == "2026-05-01"
            assert params["to_date"] == "2026-05-04"
            return []
        raise AssertionError("unexpected sql")

    monkeypatch.setattr(hr.pg, "execute_readonly", fake_execute)

    node = hr.make_hr_query(lambda: [2000])
    state = {
        "auth": _auth({"finance"}, {2000}),
        "normalized_question": "SIM-SMALL-EMP-0079 tháng này nhận bao nhiêu lương?",
        "raw_entities": {"outlet_names": [], "product_names": [], "categories": [], "employee_names": []},
        "resolved_entities": {"outlet_ids": [2000]},
        "time_range": {"from_date": "2026-05-01", "to_date": "2026-05-04"},
        "data_coverage_context": {
            "datasets": [
                {
                    "source": "postgres",
                    "dataset": "core.payroll_period",
                    "min_date": "2025-07-01",
                    "max_date": "2026-03-31",
                    "row_count": 9,
                }
            ],
            "errors": [],
        },
        "trace": [],
    }

    out = node(state)

    assert out["template_key"] == "HR_payroll_total"
    assert "Không có kỳ lương" in out["answer_text"]
    assert "0 VNĐ" not in out["answer_text"]
    assert "dữ liệu HR hiện chỉ cập nhật đến 2026-03-31" in out["answer_text"]


def test_hr_tenure_headcount_detects_so_nhan_vien_phrase():
    assert hr._is_tenure_headcount_question("số Nhân viên thâm niên trên 1 năm là bao nhiêu?") is True


def test_hr_tenure_list_detects_danh_sach_month_threshold():
    assert hr._is_tenure_list_question("danh sách nhân viên thâm niên làm việc trên 3 tháng") is True
    assert hr._question_kind("danh sách nhân viên thâm niên làm việc trên 3 tháng") == "tenure_list"


def test_hr_tenure_aggregate_noise_marks_misparsed_name():
    assert hr._employee_term_is_tenure_aggregate_noise("thâm niên trên 1") is True
    assert hr._employee_term_is_tenure_aggregate_noise("Nguyễn Văn A") is False


def test_hr_tenure_misparsed_term_falls_back_to_headcount(monkeypatch):
    """If classification wrongly stays on employee_tenure, tenure phrase 'name' triggers headcount SQL."""

    def fake_qkind(q: str) -> str:
        return "employee_tenure"

    monkeypatch.setattr(hr, "_question_kind", fake_qkind)
    monkeypatch.setattr(hr, "get_settings", lambda: _settings())

    calls = []

    def fake_execute(sql, params):
        calls.append(sql)
        assert sql == hr._TENURE_HEADCOUNT_SQL
        return [{"employee_count": 3, "without_contract_date_count": 0}]

    monkeypatch.setattr(hr.pg, "execute_readonly", fake_execute)

    node = hr.make_hr_query(lambda: [2000])
    state = {
        "auth": _auth({"hr"}, {2000}),
        "normalized_question": "Nhân viên thâm niên trên 1 năm là bao nhiêu?",
        "raw_entities": {"outlet_names": [], "product_names": [], "categories": [], "employee_names": []},
        "resolved_entities": {"outlet_ids": [2000]},
        "trace": [],
    }
    out = node(state)
    assert out["hr_query_kind"] == "tenure_headcount"
    assert out["template_key"] == "HR_tenure_headcount"
    assert "**3**" in out["answer_text"]


def test_hr_employment_type_headcount_fulltime(monkeypatch):
    monkeypatch.setattr(hr, "get_settings", lambda: _settings())

    def fake_execute(sql, params):
        assert sql == hr._EMPLOYMENT_TYPE_HEADCOUNT_SQL
        assert params["outlet_ids"] == [2000]
        assert params["employment_type"] == "full_time"
        return [{"employee_count": 42, "not_this_type_count": 8}]

    monkeypatch.setattr(hr.pg, "execute_readonly", fake_execute)

    node = hr.make_hr_query(lambda: [2000])
    state = {
        "auth": _auth({"hr"}, {2000}),
        "normalized_question": "số nhân viên hợp đồng fulltime",
        "raw_entities": {"outlet_names": [], "product_names": [], "categories": [], "employee_names": []},
        "resolved_entities": {"outlet_ids": [2000]},
        "trace": [],
    }
    out = node(state)
    assert out["hr_query_kind"] == "employment_type_headcount"
    assert out["template_key"] == "HR_employment_type_headcount"
    assert "**42**" in out["answer_text"]
    assert "full-time" in out["answer_text"]


def test_hr_tenure_headcount_question_kind_and_query(monkeypatch):
    monkeypatch.setattr(hr, "get_settings", lambda: _settings())

    def fake_execute(sql, params):
        assert sql == hr._TENURE_HEADCOUNT_SQL
        assert params["outlet_ids"] == [2000]
        assert params["years"] == 1
        assert params["at_least"] is True
        return [{"employee_count": 12, "without_contract_date_count": 2}]

    monkeypatch.setattr(hr.pg, "execute_readonly", fake_execute)

    node = hr.make_hr_query(lambda: [2000])
    state = {
        "auth": _auth({"hr"}, {2000}),
        "normalized_question": "Nhân viên thâm niên trên 1 năm là bao nhiêu?",
        "raw_entities": {"outlet_names": [], "product_names": [], "categories": [], "employee_names": []},
        "resolved_entities": {"outlet_ids": [2000]},
        "trace": [],
    }
    out = node(state)
    assert out["hr_query_kind"] == "tenure_headcount"
    assert out["template_key"] == "HR_tenure_headcount"
    assert "**12**" in out["answer_text"]
    assert "chưa có" in out["answer_text"]


def test_hr_tenure_list_month_threshold_runs_static_query(monkeypatch):
    monkeypatch.setattr(hr, "get_settings", lambda: _settings())

    def fake_execute(sql, params):
        assert sql == hr._TENURE_LIST_SQL
        assert params["outlet_ids"] == [2000]
        assert params["months"] == 3
        assert params["at_least"] is True
        assert params["limit"] == 50
        return [
            {
                "user_id": 7,
                "full_name": "Senior Staff",
                "username": "senior.staff",
                "employee_code": "EMP-007",
                "status": "active",
                "outlet_id": 2000,
                "outlet_code": "VN-HCM-001",
                "outlet_name": "Saigon Central Outlet",
                "first_start_date": "2025-12-01",
                "tenure_days": 158,
            }
        ]

    monkeypatch.setattr(hr.pg, "execute_readonly", fake_execute)

    node = hr.make_hr_query(lambda: [2000])
    state = {
        "auth": _auth({"hr"}, {2000}),
        "normalized_question": "danh sách nhân viên thâm niên làm việc trên 3 tháng",
        "raw_entities": {"outlet_names": [], "product_names": [], "categories": [], "employee_names": []},
        "resolved_entities": {"outlet_ids": [2000]},
        "trace": [],
    }

    out = node(state)

    assert out["hr_query_kind"] == "tenure_list"
    assert out["template_key"] == "HR_tenure_list"
    assert "Senior Staff" in out["answer_text"]
    assert "trên/từ 3 tháng" in out["answer_text"]


def test_hr_new_contracts_list_year_runs_static_query(monkeypatch):
    monkeypatch.setattr(hr, "get_settings", lambda: _settings())
    monkeypatch.setattr(hr, "today_local", lambda: date(2026, 5, 8))

    def fake_execute(sql, params):
        assert sql == hr._NEW_CONTRACTS_LIST_SQL
        assert params["outlet_ids"] == [2000]
        assert params["year_start"] == "2026-01-01"
        assert params["year_end"] == "2026-12-31"
        assert params["limit"] == 50
        return [
            {
                "user_id": 42,
                "full_name": "New Hire",
                "username": "new.hire",
                "employee_code": "EMP-NEW",
                "status": "active",
                "outlet_id": 2000,
                "outlet_code": "VN-HCM-001",
                "outlet_name": "Saigon Central Outlet",
                "contract_start_date": "2026-03-01",
            }
        ]

    monkeypatch.setattr(hr.pg, "execute_readonly", fake_execute)

    node = hr.make_hr_query(lambda: [2000])
    state = {
        "auth": _auth({"hr"}, {2000}),
        "normalized_question": "danh sách các nhân viên mới kí hợp đồng năm nay",
        "raw_entities": {"outlet_names": [], "product_names": [], "categories": [], "employee_names": []},
        "resolved_entities": {"outlet_ids": [2000]},
        "trace": [],
    }

    out = node(state)

    assert out["hr_query_kind"] == "new_contract_list"
    assert out["template_key"] == "HR_new_contracts_list"
    assert "New Hire" in out["answer_text"]
    assert "2026" in out["answer_text"]
    assert "2026-03-01" in out["answer_text"]


def test_hr_outlets_missing_staff_runs_static_query(monkeypatch):
    monkeypatch.setattr(hr, "get_settings", lambda: _settings())

    def fake_execute(sql, params):
        assert sql == hr._OUTLETS_MISSING_STAFF_SQL
        assert params["outlet_ids"] == [2000, 2002, 2010]
        return [
            {"outlet_id": 2010, "outlet_code": "VN-HCM-010", "outlet_name": "Lotte Outlet"},
        ]

    monkeypatch.setattr(hr.pg, "execute_readonly", fake_execute)

    node = hr.make_hr_query(lambda: [2000, 2002, 2010])
    state = {
        "auth": _auth({"superadmin"}, {2000, 2002, 2010}),
        "normalized_question": "Có outlet nào thiếu nhân sự không?",
        "raw_entities": {"outlet_names": [], "product_names": [], "categories": [], "employee_names": []},
        "resolved_entities": {"outlet_ids": []},
        "trace": [],
    }
    out = node(state)
    assert out["hr_query_kind"] == "outlets_missing_staff"
    assert out["template_key"] == "HR_outlets_missing_staff"
    assert "Lotte Outlet" in out["answer_text"]
    assert "VN-HCM-010" in out["answer_text"]
