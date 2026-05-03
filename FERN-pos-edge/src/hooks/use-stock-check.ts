import { useEffect, useState } from 'react'
import { inventoryApi } from '@/api/inventory-api'
import { useAppSelector } from '@/store/hooks'

export interface StockInfo {
  qty_available: number
  last_synced_at: number | null
}

export function useStockCheck(productId: string): StockInfo {
  const outletId = useAppSelector(s => s.auth.outletId)
  const [info, setInfo] = useState<StockInfo>({ qty_available: Infinity, last_synced_at: null })

  useEffect(() => {
    if (!outletId) return
    inventoryApi.getProductAvailability(outletId, productId)
      .then(({ data: row }) => {
        setInfo({
          qty_available: row.qty_available,
          last_synced_at: row.last_synced_at ? Date.parse(row.last_synced_at) : null,
        })
      })
      .catch(() => {
        setInfo({ qty_available: Infinity, last_synced_at: null })
      })
  }, [productId, outletId])

  return info
}
