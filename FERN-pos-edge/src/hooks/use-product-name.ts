import { useEffect, useState } from 'react'
import { db } from '@/db/schema'

// Batch lookup product names from Dexie catalog
export function useProductNames(productIds: string[]): Map<string, string> {
  const [nameMap, setNameMap] = useState<Map<string, string>>(new Map())

  useEffect(() => {
    if (productIds.length === 0) return
    db.catalog.bulkGet(productIds).then(items => {
      const map = new Map<string, string>()
      for (const item of items) {
        if (item) map.set(item.id, item.name)
      }
      setNameMap(map)
    })
  }, [productIds.join(',')])  // eslint-disable-line react-hooks/exhaustive-deps

  return nameMap
}
