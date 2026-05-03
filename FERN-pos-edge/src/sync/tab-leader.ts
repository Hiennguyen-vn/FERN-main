// BroadcastChannel-based tab leader election.
// Only leader tab runs sync agent. Others show read-only banner.

const CHANNEL_NAME = 'fern-pos-leader'
const HEARTBEAT_MS = 2000
const LEADER_TIMEOUT_MS = 6000

let isLeader = false
let channel: BroadcastChannel | null = null
let heartbeatTimer: ReturnType<typeof setInterval> | null = null
let checkTimer: ReturnType<typeof setTimeout> | null = null
let lastLeaderBeat = 0
let onLeaderChange: ((leader: boolean) => void) | null = null

export function getIsLeader() {
  return isLeader
}

function claim() {
  isLeader = true
  onLeaderChange?.(true)
  heartbeatTimer = setInterval(() => {
    channel?.postMessage({ type: 'heartbeat' })
  }, HEARTBEAT_MS)
}

function scheduleCheck() {
  checkTimer = setTimeout(() => {
    if (Date.now() - lastLeaderBeat > LEADER_TIMEOUT_MS) {
      claim()
    } else {
      scheduleCheck()
    }
  }, LEADER_TIMEOUT_MS)
}

export function initTabLeader(onChange: (isLeader: boolean) => void) {
  onLeaderChange = onChange

  if (typeof BroadcastChannel === 'undefined') {
    // Fallback: always leader (single-tab environment)
    claim()
    return
  }

  channel = new BroadcastChannel(CHANNEL_NAME)

  channel.onmessage = (e) => {
    if (e.data?.type === 'heartbeat') {
      lastLeaderBeat = Date.now()
      if (isLeader) {
        // Another tab claimed leader — shouldn't happen; step down
        isLeader = false
        onLeaderChange?.(false)
        if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null }
      }
    }
    if (e.data?.type === 'query') {
      if (isLeader) channel?.postMessage({ type: 'heartbeat' })
    }
  }

  // Ask if anyone is leader
  channel.postMessage({ type: 'query' })
  lastLeaderBeat = 0

  scheduleCheck()
}

export function destroyTabLeader() {
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null }
  if (checkTimer) { clearTimeout(checkTimer); checkTimer = null }
  channel?.close()
  channel = null
  isLeader = false
}
