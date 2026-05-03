import { useMemo, useState } from 'react'
import { useAppDispatch, useAppSelector } from '@/store/hooks'
import { addItem } from '@/store/cart.slice'
import { inventoryApi } from '@/api/inventory-api'
import type { ModifierGroupView, ModifierOptionView, ProductVariantView } from '@/api/types'
import type { SaleItemLocal } from '@/db/schema'
import type { PosMenuCategory, PosMenuItem } from '@/hooks/use-pos-menu'

function formatVnd(amount: number) {
  return new Intl.NumberFormat('vi-VN').format(amount) + 'đ'
}

interface MenuGridProps {
  categories: PosMenuCategory[]
  disabled?: boolean
}

interface PendingConfigState {
  item: PosMenuItem
  variantId: string | null
  modifierOptionIds: string[]
  note: string
}

interface OversellState {
  itemName: string
  qtyAvailable: number
  lastSyncedAt: number
  cartLine: SaleItemLocal
}

function priceModifierToCents(variant: ProductVariantView | undefined, basePriceCents: number): number {
  if (!variant) return 0
  const numeric = Number(variant.priceModifierValue ?? 0)
  if (!Number.isFinite(numeric) || numeric === 0) return 0
  if (variant.priceModifierType === 'percentage') {
    return Math.round((basePriceCents * numeric) / 100)
  }
  if (variant.priceModifierType === 'fixed') {
    return Math.round(numeric)
  }
  return 0
}

function modifierPriceToCents(option: ModifierOptionView): number {
  return Math.round(Number(option.priceAdjustment ?? 0))
}

function groupSelectedCount(group: ModifierGroupView, selectedOptionIds: string[]): number {
  return group.options.filter(option => selectedOptionIds.includes(option.id)).length
}

function createDefaultConfig(item: PosMenuItem): PendingConfigState {
  const defaultVariant = item.variants.find(variant => variant.isActive) ?? null
  const defaultModifierIds = item.modifierGroups.flatMap(group => {
    const activeOptions = group.options.filter(option => option.isActive)
    if (activeOptions.length === 0) return []
    if (group.selectionType === 'single' && (group.isRequired || group.minSelections > 0)) {
      return [activeOptions[0].id]
    }
    return []
  })
  return {
    item,
    variantId: defaultVariant?.id ?? null,
    modifierOptionIds: defaultModifierIds,
    note: '',
  }
}

export function MenuGrid({ categories, disabled = false }: MenuGridProps) {
  const dispatch = useAppDispatch()
  const outletId = useAppSelector(s => s.auth.outletId)
  const [selectedCat, setSelectedCat] = useState<string | null>(categories[0]?.id ?? null)
  const [pendingConfig, setPendingConfig] = useState<PendingConfigState | null>(null)
  const [oversell, setOversell] = useState<OversellState | null>(null)
  const [configError, setConfigError] = useState<string | null>(null)

  const activeCat = categories.some(category => category.id === selectedCat)
    ? selectedCat
    : categories[0]?.id ?? null

  const activeItems =
    categories.find(c => c.id === activeCat)?.items ?? categories[0]?.items ?? []

  const configSummary = useMemo(() => {
    if (!pendingConfig) return null
    const variant = pendingConfig.item.variants.find(entry => entry.id === pendingConfig.variantId)
    const selectedOptions = pendingConfig.item.modifierGroups.flatMap(group =>
      group.options
        .filter(option => pendingConfig.modifierOptionIds.includes(option.id))
        .map(option => ({
          ...option,
          groupCode: group.code,
          groupName: group.name,
        }))
    )
    const unitPriceCents = pendingConfig.item.price_cents
      + priceModifierToCents(variant, pendingConfig.item.price_cents)
      + selectedOptions.reduce((sum, option) => sum + modifierPriceToCents(option), 0)
    const taxCents = Math.round(unitPriceCents * (pendingConfig.item.tax_basis_points ?? 0) / 10_000)
    const inclusivePriceCents = unitPriceCents + taxCents
    return { variant, selectedOptions, unitPriceCents, taxCents, inclusivePriceCents }
  }, [pendingConfig])

  function openConfigurator(item: PosMenuItem) {
    if (disabled) return
    setConfigError(null)
    setPendingConfig(createDefaultConfig(item))
  }

  function toggleModifier(group: ModifierGroupView, option: ModifierOptionView) {
    if (!pendingConfig) return
    const selected = new Set(pendingConfig.modifierOptionIds)
    const alreadySelected = selected.has(option.id)
    if (group.selectionType === 'single') {
      group.options.forEach(candidate => selected.delete(candidate.id))
      if (!alreadySelected) {
        selected.add(option.id)
      }
    } else if (alreadySelected) {
      selected.delete(option.id)
    } else {
      const selectedCount = groupSelectedCount(group, [...selected])
      if (group.maxSelections > 0 && selectedCount >= group.maxSelections) {
        setConfigError(`Nhóm "${group.name}" chỉ chọn tối đa ${group.maxSelections} lựa chọn.`)
        return
      }
      selected.add(option.id)
    }
    setConfigError(null)
    setPendingConfig({
      ...pendingConfig,
      modifierOptionIds: [...selected],
    })
  }

  function buildCartLine(config: PendingConfigState): SaleItemLocal {
    const variant = config.item.variants.find(entry => entry.id === config.variantId)
    const selectedOptions = config.item.modifierGroups.flatMap(group =>
      group.options
        .filter(option => config.modifierOptionIds.includes(option.id))
        .map(option => ({
          modifier_option_id: option.id,
          group_name: group.name,
          option_name: option.name,
          price_add_cents: modifierPriceToCents(option),
        }))
    )
    const unitPriceCents = config.item.price_cents
      + priceModifierToCents(variant, config.item.price_cents)
      + selectedOptions.reduce((sum, option) => sum + option.price_add_cents, 0)
    // Mirror agent-side tax math (sales.ts:378-379): tax = price * tax_basis_points / 10000.
    // Carrying tax in the cart line keeps Tạm tính + Thuế + Tổng aligned with what the
    // server will charge, so cashier and customer see the same final number.
    const taxCents = Math.round((unitPriceCents * (config.item.tax_basis_points ?? 0)) / 10_000)
    return {
      cart_line_id: crypto.randomUUID(),
      product_id: config.item.productId,
      product_name: config.item.productName,
      qty: '1',
      unit_price_cents: unitPriceCents,
      discount_cents: 0,
      tax_cents: taxCents,
      line_total_cents: unitPriceCents + taxCents,
      variant_id: variant?.id ?? null,
      variant_name: variant?.name ?? null,
      note: config.note.trim() || null,
      modifier_option_ids: selectedOptions.map(option => option.modifier_option_id),
      modifiers: selectedOptions,
    }
  }

  async function confirmAdd() {
    if (!pendingConfig) return
    const { item, modifierOptionIds } = pendingConfig
    for (const group of item.modifierGroups) {
      const selectedCount = groupSelectedCount(group, modifierOptionIds)
      if ((group.isRequired || group.minSelections > 0) && selectedCount < Math.max(group.minSelections, group.isRequired ? 1 : 0)) {
        setConfigError(`Nhóm "${group.name}" cần chọn ít nhất ${Math.max(group.minSelections, group.isRequired ? 1 : 0)} lựa chọn.`)
        return
      }
      if (group.maxSelections > 0 && selectedCount > group.maxSelections) {
        setConfigError(`Nhóm "${group.name}" chỉ chọn tối đa ${group.maxSelections} lựa chọn.`)
        return
      }
    }

    const cartLine = buildCartLine(pendingConfig)
    if (outletId) {
      try {
        const { data: row } = await inventoryApi.getProductAvailability(outletId, item.productId)
        const available = row.qty_available
        if (available < 1) {
          setOversell({
            itemName: item.productName,
            qtyAvailable: available,
            lastSyncedAt: row.last_synced_at ? Date.parse(row.last_synced_at) : Date.now(),
            cartLine,
          })
          return
        }
      } catch {
        // Let the mini server enforce inventory on submit when availability cannot be read.
      }
    }
    dispatch(addItem(cartLine))
    setPendingConfig(null)
    setConfigError(null)
  }

  return (
    <>
      <div className="flex h-full overflow-hidden">
        <aside className="w-36 flex-shrink-0 bg-gray-100 overflow-y-auto border-r border-gray-200">
          {categories.map(cat => (
            <button
              key={cat.id}
              onClick={() => setSelectedCat(cat.id)}
              className={`w-full text-left px-3 py-3 text-sm font-medium border-b border-gray-200 transition-colors
                ${activeCat === cat.id
                  ? 'bg-green-600 text-white'
                  : 'text-gray-700 hover:bg-gray-200'}`}
            >
              {cat.name}
            </button>
          ))}
        </aside>

        <div className="flex-1 overflow-y-auto p-3">
          <div className="grid grid-cols-3 gap-2">
            {activeItems.map(item => (
              <button
                key={item.productId}
                onClick={() => openConfigurator(item)}
                disabled={disabled}
                className="bg-white rounded-xl border border-gray-200 p-3 text-left hover:border-green-400 hover:shadow-sm transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <div className="h-16 bg-gray-100 rounded-lg mb-2 flex items-center justify-center text-2xl">
                  ☕
                </div>
                <p className="text-sm font-medium text-gray-900 truncate">
                  {item.productName}
                </p>
                <p className="text-sm text-green-600 font-semibold mt-0.5">
                  {formatVnd(item.price_cents)}
                </p>
                {item.tax_basis_points > 0 && (
                  <p className="text-[10px] text-gray-400">+ VAT khi tính tiền</p>
                )}
                {(item.variants.length > 0 || item.modifierGroups.length > 0) && (
                  <p className="mt-1 text-[11px] text-gray-500">
                    Có tuỳ chọn
                  </p>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      {pendingConfig && configSummary && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-2xl shadow-xl p-6 max-w-lg w-full max-h-[85vh] overflow-y-auto space-y-5">
            <div>
              <h3 className="font-semibold text-gray-900">{pendingConfig.item.productName}</h3>
              <p className="text-sm text-gray-500">Cấu hình món trước khi thêm vào giỏ</p>
            </div>

            {pendingConfig.item.variants.length > 0 && (
              <section className="space-y-2">
                <h4 className="text-sm font-medium text-gray-800">Phiên bản</h4>
                <div className="space-y-2">
                  {pendingConfig.item.variants
                    .filter(variant => variant.isActive)
                    .map(variant => {
                      const delta = priceModifierToCents(variant, pendingConfig.item.price_cents)
                      return (
                        <label key={variant.id} className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 px-3 py-2">
                          <div>
                            <p className="text-sm font-medium text-gray-800">{variant.name}</p>
                            {delta !== 0 && (
                              <p className="text-xs text-gray-500">
                                {delta > 0 ? '+' : ''}{formatVnd(delta)}
                              </p>
                            )}
                          </div>
                          <input
                            type="radio"
                            checked={pendingConfig.variantId === variant.id}
                            onChange={() => {
                              setConfigError(null)
                              setPendingConfig({ ...pendingConfig, variantId: variant.id })
                            }}
                          />
                        </label>
                      )
                    })}
                </div>
              </section>
            )}

            {pendingConfig.item.modifierGroups.map(group => (
              <section key={group.id} className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-medium text-gray-800">{group.name}</h4>
                  <span className="text-[11px] text-gray-500">
                    {group.selectionType === 'single' ? 'Chọn 1' : `Tối đa ${group.maxSelections || 'nhiều'}`}
                  </span>
                </div>
                <div className="space-y-2">
                  {group.options
                    .filter(option => option.isActive)
                    .map(option => {
                      const checked = pendingConfig.modifierOptionIds.includes(option.id)
                      const delta = modifierPriceToCents(option)
                      return (
                        <label key={option.id} className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 px-3 py-2">
                          <div>
                            <p className="text-sm font-medium text-gray-800">{option.name}</p>
                            {delta !== 0 && (
                              <p className="text-xs text-gray-500">
                                {delta > 0 ? '+' : ''}{formatVnd(delta)}
                              </p>
                            )}
                          </div>
                          <input
                            type={group.selectionType === 'single' ? 'radio' : 'checkbox'}
                            checked={checked}
                            onChange={() => toggleModifier(group, option)}
                          />
                        </label>
                      )
                    })}
                </div>
              </section>
            ))}

            <section className="space-y-2">
              <h4 className="text-sm font-medium text-gray-800">Ghi chú</h4>
              <textarea
                value={pendingConfig.note}
                onChange={event => setPendingConfig({ ...pendingConfig, note: event.target.value })}
                rows={3}
                className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                placeholder="Ví dụ: ít đá, không hành..."
              />
            </section>

            <div className="rounded-xl bg-gray-50 px-4 py-3 space-y-1">
              <div className="flex items-center justify-between text-xs text-gray-500">
                <span>Giá chưa thuế</span>
                <span>{formatVnd(configSummary.unitPriceCents)}</span>
              </div>
              {configSummary.taxCents > 0 && (
                <div className="flex items-center justify-between text-xs text-gray-500">
                  <span>VAT</span>
                  <span>{formatVnd(configSummary.taxCents)}</span>
                </div>
              )}
              <div className="flex items-center justify-between pt-1 border-t border-gray-200">
                <span className="text-sm font-medium text-gray-700">Tổng cộng</span>
                <span className="font-semibold text-gray-900">{formatVnd(configSummary.inclusivePriceCents)}</span>
              </div>
              {configSummary.selectedOptions.length > 0 && (
                <div className="mt-2 space-y-1 text-xs text-gray-500">
                  {configSummary.selectedOptions.map(option => (
                    <div key={option.id} className="flex items-center justify-between">
                      <span>{option.groupName}: {option.name}</span>
                      <span>{formatVnd(modifierPriceToCents(option))}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {configError && (
              <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{configError}</p>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => {
                  setPendingConfig(null)
                  setConfigError(null)
                }}
                className="flex-1 py-2.5 border border-gray-300 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Hủy
              </button>
              <button
                onClick={confirmAdd}
                className="flex-1 py-2.5 bg-green-600 text-white rounded-xl text-sm font-semibold hover:bg-green-700"
              >
                Thêm vào giỏ
              </button>
            </div>
          </div>
        </div>
      )}

      {oversell && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full space-y-4">
            <h3 className="font-semibold text-gray-900">Hết hàng trong cache</h3>
            <p className="text-sm text-gray-600">
              <strong>{oversell.itemName}</strong> còn{' '}
              <strong>{Math.max(0, oversell.qtyAvailable)}</strong> phần
              (cache lúc {new Date(oversell.lastSyncedAt).toLocaleTimeString('vi-VN')}).
              <br />
              Đồng bộ lại tồn kho hoặc chọn món khác trước khi bán.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setOversell(null)}
                className="flex-1 py-2.5 bg-green-600 text-white rounded-xl text-sm font-semibold hover:bg-green-700"
              >
                Đã hiểu
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
