from app.audit.pii import RegexPIIRedactor, redact_pii


def test_redact_phone_email_cccd():
    text = "Liên hệ 0912345678 hoặc a@b.com, CCCD 123456789012"
    out = redact_pii(text)
    assert "0912345678" not in out
    assert "a@b.com" not in out
    assert "123456789012" not in out
    assert "[PHONE]" in out
    assert "[EMAIL]" in out
    assert "[CCCD]" in out


def test_redact_address_pattern():
    text = "Giao tại số 12 đường Lê Lợi phường Bến Nghé"
    out = RegexPIIRedactor().redact(text)
    assert "[ADDRESS]" in out
