from app.graph.nodes.contextualizer import contextualizer, effective_question
import pytest


def test_contextualizer_rewrites_time_followup():
    state = {
        "normalized_question": "tuần này",
        "conversation_turns": [
            {"role": "user", "content": "ý tôi là nhân viên parttime đi làm nhiều nhất ở outlet 1"},
            {"role": "assistant", "content": "Bạn muốn xem trong khoảng thời gian nào?"},
        ],
        "trace": [],
    }

    out = contextualizer(state)

    assert out["contextualization_source"] == "rule_time_followup"
    assert out["contextualized_question"] == "ý tôi là nhân viên parttime đi làm nhiều nhất ở outlet 1 tuần này"
    assert effective_question(out) == out["contextualized_question"]


def test_contextualizer_rewrites_time_followup_with_conversation_prefix_and_quote():
    state = {
        "normalized_question": "thế tháng này'",
        "conversation_turns": [
            {"role": "user", "content": "nhân viên nào đi làm nhiều nhất?"},
            {"role": "assistant", "content": "Bạn muốn xem trong khoảng thời gian nào?"},
        ],
        "trace": [],
    }

    out = contextualizer(state)

    assert out["contextualization_source"] == "rule_time_followup"
    assert out["contextualized_question"] == "nhân viên nào đi làm nhiều nhất thế tháng này'"


def test_contextualizer_rewrites_time_comparison_followup():
    state = {
        "normalized_question": "tháng trước thì sao",
        "conversation_turns": [
            {"role": "user", "content": "Nguyễn Văn An tháng này đã làm bao nhiêu giờ?"},
            {"role": "assistant", "content": "Nguyễn Văn An đã làm 18.50 giờ trong tháng này."},
        ],
        "trace": [],
    }

    out = contextualizer(state)

    assert out["contextualization_source"] == "rule_time_followup"
    assert out["contextualized_question"] == "Nguyễn Văn An đã làm bao nhiêu giờ tháng trước thì sao"
    assert effective_question(out) == out["contextualized_question"]


def test_contextualizer_chained_time_followup_uses_last_domain_question():
    state = {
        "normalized_question": "tháng 3 thì sao",
        "conversation_turns": [
            {"role": "user", "content": "Nguyễn Văn An tháng này đã làm bao nhiêu giờ?"},
            {"role": "assistant", "content": "Nguyễn Văn An đã làm 18.50 giờ trong tháng này."},
            {"role": "user", "content": "tháng trước thì sao"},
            {"role": "assistant", "content": "Tháng trước nhân viên này đã làm 92.00 giờ."},
        ],
        "trace": [],
    }

    out = contextualizer(state)

    assert out["contextualization_source"] == "rule_time_followup"
    assert out["contextualized_question"] == "Nguyễn Văn An đã làm bao nhiêu giờ tháng 3 thì sao"


@pytest.mark.parametrize(
    "current",
    [
        "còn tuần rồi",
        "so với tháng trước",
        "quý trước ra sao",
        "7 ngày gần nhất thì sao",
        "kỳ trước thì sao",
        "q1 thì sao",
        "so với cùng kỳ năm ngoái",
    ],
)
def test_contextualizer_rewrites_time_followup_variants(current):
    state = {
        "normalized_question": current,
        "conversation_turns": [
            {"role": "user", "content": "doanh thu tháng này theo cửa hàng"},
            {"role": "assistant", "content": "Doanh thu tháng này theo cửa hàng là ..."},
        ],
        "trace": [],
    }

    out = contextualizer(state)

    assert out["contextualization_source"] == "rule_time_followup"
    assert out["contextualized_question"] == f"doanh thu theo cửa hàng {current}"


def test_contextualizer_keeps_standalone_time_without_context():
    state = {"normalized_question": "tuần này", "conversation_turns": [], "trace": []}

    out = contextualizer(state)

    assert "contextualized_question" not in out
    assert out["trace"][-1]["skipped"] is True


def test_contextualizer_rewrites_payroll_employee_followup():
    state = {
        "normalized_question": "Canon Staff",
        "conversation_turns": [
            {"role": "user", "content": "lương năm nay của nhân viên này là bao nhiêu?"},
            {"role": "assistant", "content": "Bạn muốn xem lương của nhân viên nào?"},
        ],
        "trace": [],
    }

    out = contextualizer(state)

    assert out["contextualization_source"] == "rule_employee_followup"
    assert out["contextualized_question"] == "lương năm nay của nhân viên này là bao nhiêu Canon Staff"


def test_contextualizer_rewrites_hr_employee_selection_followup_with_prior_time():
    state = {
        "normalized_question": "tôi muốn xem giờ làm của - Nguyen Van An (SIM-SMALL-EMP-0009) - username sim_small_emp_0009",
        "conversation_turns": [
            {"role": "user", "content": "Nguyen Van An tháng này làm bao nhiêu giờ?"},
            {
                "role": "assistant",
                "content": (
                    "Tìm thấy nhiều nhân viên khớp 'Nguyen Van An'. Bạn muốn xem giờ làm của ai?\n"
                    "- Nguyen Van An (SIM-SMALL-EMP-0009) - username sim_small_emp_0009"
                ),
            },
        ],
        "trace": [],
    }

    out = contextualizer(state)

    assert out["contextualization_source"] == "rule_hr_employee_selection_followup"
    assert out["contextualized_question"] == (
        "Nguyen Van An tháng này làm bao nhiêu giờ "
        "tôi muốn xem giờ làm của - Nguyen Van An (SIM-SMALL-EMP-0009) - username sim_small_emp_0009"
    )


def test_contextualizer_rewrites_outlet_followup():
    state = {
        "normalized_question": "còn outlet 2",
        "conversation_turns": [{"role": "user", "content": "doanh thu tuần này của outlet 1"}],
        "trace": [],
    }

    out = contextualizer(state)

    assert out["contextualization_source"] == "rule_short_filter_followup"
    assert out["contextualized_question"] == "doanh thu tuần này của outlet 2"


def test_contextualizer_does_not_rewrite_short_non_entity_reply():
    state = {
        "normalized_question": "không",
        "conversation_turns": [{"role": "user", "content": "lương năm nay của nhân viên này là bao nhiêu?"}],
        "trace": [],
    }

    out = contextualizer(state)

    assert "contextualized_question" not in out


def test_contextualizer_inherits_time_for_ranking_followup():
    state = {
        "normalized_question": "cửa hàng nào doanh thu cao nhất",
        "conversation_turns": [
            {"role": "user", "content": "doanh thu tất cả cửa hàng tháng trước"},
            {"role": "assistant", "content": "Doanh thu tháng trước là 100."},
        ],
        "trace": [],
    }

    out = contextualizer(state)

    assert out["contextualization_source"] == "rule_inherit_time_for_ranking"
    assert out["contextualized_question"] == "doanh thu tất cả cửa hàng tháng trước cửa hàng nào doanh thu cao nhất"


def test_contextualizer_does_not_rewrite_outlet_directory_from_hr_context():
    state = {
        "normalized_question": "có các cửa hàng nào trong hệ thống",
        "conversation_turns": [
            {"role": "user", "content": "Le Hoang Cuong tháng trước đã làm bao nhiêu giờ?"},
            {"role": "assistant", "content": "Le Hoang Cuong đã làm 102.55 giờ."},
        ],
        "trace": [],
    }

    out = contextualizer(state)

    assert "contextualized_question" not in out
    assert out["trace"][-1]["skipped"] is True


def test_contextualizer_rewrites_product_name_after_inventory_question():
    prev = "Sản phẩm bán chậm này có tồn kho cao không trong tháng này?"
    state = {
        "normalized_question": "Com Chay",
        "conversation_turns": [
            {"role": "user", "content": prev},
            {"role": "assistant", "content": "Bạn đang muốn kiểm tra sản phẩm nào?"},
        ],
        "trace": [],
    }

    out = contextualizer(state)

    assert out["contextualization_source"] == "rule_product_entity_followup"
    cq = out["contextualized_question"]
    assert "Com Chay" in cq
    assert prev.rstrip("?.!")[0:12] in cq or "bán chậm" in cq


def test_contextualizer_merges_ui_suggestion_with_anaphora_to_prior_question():
    prev = "Xếp hạng nhóm sản phẩm theo doanh thu trong ngày 2026-05-02 tại outlet VN-HCM-3"
    state = {
        "normalized_question": "Yếu tố nào đóng góp nhiều nhất vào kết quả này?",
        "conversation_turns": [
            {"role": "user", "content": prev},
            {"role": "assistant", "content": "DRINK dẫn đầu với 2.965.600 đ…"},
        ],
        "trace": [],
    }

    out = contextualizer(state)

    assert out["contextualization_source"] == "rule_anaphora_followup"
    assert "VN-HCM-3" in out["contextualized_question"]
    assert "kết quả này" in out["contextualized_question"]


def test_contextualizer_merges_revenue_này_followup():
    state = {
        "normalized_question": "revenue này tách theo outlet thế nào?",
        "conversation_turns": [
            {"role": "user", "content": "Doanh thu 7 ngày qua theo ngày cho toàn region?"},
            {"role": "assistant", "content": "Tổng 7 ngày là 12 tỷ…"},
        ],
        "trace": [],
    }

    out = contextualizer(state)

    assert out["contextualization_source"] == "rule_anaphora_followup"
    assert "Doanh thu 7 ngày" in out["contextualized_question"]
    assert "revenue này" in out["contextualized_question"].lower() or "tách theo outlet" in out["contextualized_question"]
