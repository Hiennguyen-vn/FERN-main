import { useState } from 'react'
import { useAppDispatch, useAppSelector } from '@/store/hooks'
import { clearCart, removeItem, selectCartSubtotal, selectCartTax, selectCartTotal, setNote, updateQty } from '@/store/cart.slice'
import { useSubmitOrder } from '@/hooks/use-submit-order'
import { useProductNames } from '@/hooks/use-product-name'

function formatVnd(cents: number) {
  return new Intl.NumberFormat('vi-VN').format(cents) + 'đ'
}

interface CartPanelProps {
  hubReachable?: boolean
  salesBlockedReason?: string | null
  productNameById?: Map<string, string>
}

export function CartPanel({ hubReachable = true, salesBlockedReason = null, productNameById }: CartPanelProps) {
  const dispatch = useAppDispatch()
  const cart = useAppSelector(state => state.cart)
  const items = cart.items
  const totalCents = useAppSelector(selectCartTotal)
  const subtotalCents = useAppSelector(selectCartSubtotal)
  const taxCents = useAppSelector(selectCartTax)
  const nameMap = useProductNames(items.map(item => item.product_id))
  const { phase, error, completedSale, submitOrder, reset } = useSubmitOrder()
  const [cashInput, setCashInput] = useState('')
  const [showPayment, setShowPayment] = useState(false)

  const cashPaid = parseFloat(cashInput.replace(/[^0-9]/g, '')) || 0
  const change = cashPaid - totalCents
  const canPay = cashPaid >= totalCents
  const effectiveBlockedReason = salesBlockedReason
    ?? (!hubReachable ? 'Terminal đang mất kết nối tới mini server. Không thể ghi nhận thanh toán lúc này.' : null)
  const canSubmitPayment = canPay && (phase === 'idle' || phase === 'error') && !effectiveBlockedReason

  if (phase === 'done' && completedSale) {
    // After payment success the cart is cleared, so totalCents drops to 0 and the
    // pre-clear `change` reflects only the cash typed in. Use the server-confirmed
    // totalAmount (which already includes tax) for the change shown on the receipt.
    const serverTotal = Math.round(parseFloat(completedSale.totalAmount) || 0)
    const finalChange = Math.max(0, cashPaid - serverTotal)
    return (
      <div className="flex flex-col h-full p-4 items-center justify-center gap-4">
        <div className="text-5xl">✅</div>
        <p className="text-lg font-semibold text-gray-800">Thanh toán thành công</p>
        <p className="text-sm text-gray-500">Đơn #{completedSale.id.toString().slice(-8)}</p>
        <p className="text-sm text-gray-600">Tổng: {formatVnd(serverTotal)} · Khách đưa: {formatVnd(cashPaid)}</p>
        {finalChange > 0 && (
          <p className="text-base font-medium text-green-700">
            Tiền thừa: {formatVnd(finalChange)}
          </p>
        )}
        <button
          onClick={() => {
            reset()
            setShowPayment(false)
            setCashInput('')
          }}
          className="mt-2 w-full bg-green-600 text-white rounded-xl py-3 font-medium hover:bg-green-700"
        >
          Đơn mới
        </button>
      </div>
    )
  }

  if (showPayment) {
    return (
      <div className="flex flex-col h-full p-4 gap-4">
        <div className="flex items-center gap-2">
          <button onClick={() => setShowPayment(false)} className="text-gray-500 hover:text-gray-700">
            ← Quay lại
          </button>
          <h2 className="font-semibold text-gray-800">Thanh toán tiền mặt</h2>
        </div>

        <div className="bg-gray-50 rounded-xl p-4 space-y-1">
          <div className="flex justify-between text-sm text-gray-600">
            <span>Tạm tính</span>
            <span>{formatVnd(subtotalCents)}</span>
          </div>
          <div className="flex justify-between text-sm text-gray-600">
            <span>Thuế</span>
            <span>{formatVnd(taxCents)}</span>
          </div>
          <div className="flex justify-between pt-2 border-t border-gray-200">
            <span className="text-sm font-semibold text-gray-700">Tổng cộng</span>
            <span className="text-2xl font-bold text-gray-900">{formatVnd(totalCents)}</span>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Khách đưa (VND)
          </label>
          <input
            type="number"
            value={cashInput}
            onChange={event => setCashInput(event.target.value)}
            autoFocus
            className="w-full border border-gray-300 rounded-xl px-4 py-3 text-xl focus:outline-none focus:ring-2 focus:ring-green-500"
            placeholder="0"
          />
        </div>

        {cashPaid > 0 && (
          <div className={`rounded-xl p-3 ${change >= 0 ? 'bg-green-50' : 'bg-red-50'}`}>
            <p className="text-sm text-gray-600">
              {change >= 0 ? 'Tiền thừa trả khách' : 'Còn thiếu'}
            </p>
            <p className={`text-xl font-bold ${change >= 0 ? 'text-green-700' : 'text-red-600'}`}>
              {formatVnd(Math.abs(change))}
            </p>
          </div>
        )}

        {effectiveBlockedReason && (
          <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
            {effectiveBlockedReason}
          </p>
        )}
        {error && (
          <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
        )}

        <button
          onClick={() => submitOrder(cashPaid)}
          disabled={!canSubmitPayment}
          className="mt-auto w-full bg-green-600 disabled:opacity-50 text-white rounded-xl py-4 text-lg font-semibold hover:bg-green-700 transition-colors"
        >
          {phase === 'idle' ? 'Xác nhận thanh toán'
            : phase === 'submitting' ? 'Tạo đơn...'
            : phase === 'approving' ? 'Duyệt đơn...'
            : phase === 'paying' ? 'Ghi nhận...'
            : phase === 'error' ? 'Thử lại'
            : 'Đang xử lý...'}
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-gray-200">
        <h2 className="font-semibold text-gray-800">
          Giỏ hàng ({items.length} món)
        </h2>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-2 space-y-2">
        {items.length === 0 && (
          <p className="text-center text-gray-400 text-sm pt-8">
            Chọn món từ menu để thêm vào giỏ
          </p>
        )}
        {items.map(item => {
          const cartLineId = item.cart_line_id ?? `${item.product_id}`
          const productName = productNameById?.get(item.product_id)
            ?? item.product_name
            ?? nameMap.get(item.product_id)
            ?? `#${item.product_id}`
          return (
            <div key={cartLineId} className="flex items-center gap-3 bg-gray-50 rounded-xl px-3 py-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800 truncate">
                  {productName}
                </p>
                <p className="text-xs text-gray-500">
                  {formatVnd(item.unit_price_cents)} × {item.qty}
                </p>
                {item.variant_name && (
                  <p className="text-[11px] text-gray-500">Phiên bản: {item.variant_name}</p>
                )}
                {(item.modifiers ?? []).length > 0 && (
                  <p className="text-[11px] text-gray-500">
                    {item.modifiers!.map(modifier => `${modifier.group_name}: ${modifier.option_name}`).join(' · ')}
                  </p>
                )}
                {item.note && (
                  <p className="text-[11px] text-gray-500 italic">Ghi chú: {item.note}</p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => dispatch(updateQty({ cartLineId, qty: parseFloat(item.qty) - 1 }))}
                  className="w-7 h-7 rounded-full bg-gray-200 flex items-center justify-center text-gray-700 hover:bg-gray-300"
                >
                  −
                </button>
                <span className="text-sm font-medium w-5 text-center">{item.qty}</span>
                <button
                  onClick={() => dispatch(updateQty({ cartLineId, qty: parseFloat(item.qty) + 1 }))}
                  className="w-7 h-7 rounded-full bg-gray-200 flex items-center justify-center text-gray-700 hover:bg-gray-300"
                >
                  +
                </button>
                <button
                  onClick={() => dispatch(removeItem(cartLineId))}
                  className="ml-1 text-red-400 hover:text-red-600 text-lg"
                >
                  ×
                </button>
              </div>
              <span className="text-sm font-semibold text-gray-800 w-20 text-right">
                {formatVnd(item.unit_price_cents * (parseFloat(item.qty) || 1) - (item.discount_cents ?? 0))}
              </span>
            </div>
          )
        })}
      </div>

      <div className="border-t border-gray-200 px-4 py-4 space-y-3">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">
            Ghi chú đơn
          </label>
          <textarea
            value={cart.note}
            onChange={event => dispatch(setNote(event.target.value))}
            rows={2}
            className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            placeholder="Ví dụ: khách ngồi bàn ngoài trời"
          />
        </div>

        {taxCents > 0 && (
          <div className="flex justify-between text-xs text-gray-500">
            <span>Tạm tính · Thuế</span>
            <span>{formatVnd(subtotalCents)} · {formatVnd(taxCents)}</span>
          </div>
        )}
        <div className="flex justify-between items-center">
          <span className="text-gray-600">Tổng cộng</span>
          <span className="text-xl font-bold text-gray-900">{formatVnd(totalCents)}</span>
        </div>
        <p className="text-xs text-gray-500">Giá trên giỏ là tạm tính. Tổng cuối cùng gồm thuế sẽ được tính khi tạo đơn.</p>
        {effectiveBlockedReason && (
          <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">
            {effectiveBlockedReason}
          </p>
        )}

        <div className="flex gap-2">
          <button
            onClick={() => dispatch(clearCart())}
            disabled={items.length === 0}
            className="flex-1 py-3 rounded-xl border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
          >
            Xóa giỏ
          </button>
          <button
            onClick={() => setShowPayment(true)}
            disabled={items.length === 0 || Boolean(effectiveBlockedReason)}
            className="flex-2 flex-grow py-3 px-6 rounded-xl bg-green-600 text-white font-semibold hover:bg-green-700 disabled:opacity-40 transition-colors"
          >
            Thanh toán
          </button>
        </div>
      </div>
    </div>
  )
}
