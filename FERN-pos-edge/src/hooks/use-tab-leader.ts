import { useEffect, useState } from 'react'
import { initTabLeader, destroyTabLeader, getIsLeader } from '@/sync/tab-leader'

export function useTabLeader(): boolean {
  const [leader, setLeader] = useState(getIsLeader())

  useEffect(() => {
    initTabLeader(setLeader)
    return () => destroyTabLeader()
  }, [])

  return leader
}
