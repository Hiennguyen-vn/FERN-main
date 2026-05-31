from app.graph.outlet_scope import requested_outlet_ids_for_rbac


def test_explicit_question_outlet_overrides_frontend_scope():
    state = {
        "resolved_entities": {"outlet_ids": [101]},
        "scope_outlet_ids": [202],
    }

    assert requested_outlet_ids_for_rbac(state) == [101]


def test_frontend_scope_is_default_when_question_has_no_outlet():
    state = {
        "resolved_entities": {"outlet_ids": []},
        "scope_outlet_ids": [202],
    }

    assert requested_outlet_ids_for_rbac(state) == [202]
