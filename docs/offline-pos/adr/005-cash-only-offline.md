# ADR-005: Cash Only Offline Payments

**Status**: Accepted
**Date**: 2026-04-23

## Context

Offline payment risks:

- Card swipe không verify issuer → chargeback risk 100% merchant liability (EMV Connection).
- QR/e-wallet yêu cầu online gateway → không thể queue.
- Store-and-Forward (Square model) accept risk, nhưng FERN không chạy gateway, không PCI-DSS.

Scope pilot: coffee chain đơn giản.

## Decision

**Offline chỉ chấp nhận cash + voucher (nếu cache trước). Card/QR/e-wallet disable khi offline.**

- UI offline: disable button card/QR, chỉ enable cash.
- Voucher offline: chỉ accept voucher đã cache trong Dexie trước khi mất mạng.
- Sync lên central: payment state `PENDING_OFFLINE → COMPLETED` (không cần authorize lại vì cash đã thu).
- Close shift: cash count match expected → `RECONCILED`.

## Consequences

### Positive

- Zero chargeback risk.
- Không cần PCI-DSS scope.
- Reconciliation đơn giản: đếm tiền mặt.
- Staff training đơn giản: "offline chỉ nhận tiền mặt".

### Negative

- Revenue loss khi mất mạng dài + khách chỉ có card → từ chối sale.
- Mitigation: Highlands cafe ở VN, cash vẫn phổ biến. Acceptable loss.

### Future

Khi tích hợp VNPay/Momo (Phase VII): đánh giá offline QR (chụp QR merchant static, reconcile sau). Card Store-and-Forward đòi hỏi PCI — defer.

## Alternatives Considered

1. **Store-and-Forward card** (Square): risk chargeback cao. Loại pilot.
2. **Offline QR merchant**: khách tự scan QR, confirm trên app họ. Cần verify bằng bank statement sau — defer.
3. **Block mọi payment offline**: quá restrictive, user phản ánh.

## References

- [Adyen Offline Payment](https://docs.adyen.com/point-of-sale/offline-payment)
- [EMV Merchant Processing During Disruptions](https://www.emv-connection.com/downloads/2016/04/Merchant-Processing-during-Communication-Disruption-FINAL-April-2016.pdf)
