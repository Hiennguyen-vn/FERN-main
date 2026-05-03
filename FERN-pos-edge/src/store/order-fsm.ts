/**
 * Pure order state machine for the edge POS.
 *
 * Mirrors the structure of `PaymentStateMachine.java` server-side. Edge order has its
 * own statuses derived from `SaleLocal.status` plus the in-flight phases used by the
 * submit hook. Keeping this pure (no Dexie/Redux access) lets us unit-test transitions
 * and reuse from both the live submit flow and any post-crash recovery flow.
 */

export type OrderStatus =
  | 'draft'
  | 'submitted'
  | 'approved'
  | 'paid'
  | 'voided'

export type OrderEvent =
  | 'submit'    // draft → submitted
  | 'approve'   // submitted → approved
  | 'pay'       // approved → paid
  | 'void'      // submitted|approved → voided

const ALLOWED: Record<OrderStatus, ReadonlyArray<OrderStatus>> = {
  draft:     ['submitted', 'voided'],
  submitted: ['approved', 'voided'],
  approved:  ['paid', 'voided'],
  paid:      [],
  voided:    [],
}

const EVENT_TO_TARGET: Record<OrderEvent, OrderStatus> = {
  submit: 'submitted',
  approve: 'approved',
  pay: 'paid',
  void: 'voided',
}

export class IllegalTransitionError extends Error {
  readonly from: OrderStatus
  readonly event: OrderEvent
  constructor(from: OrderStatus, event: OrderEvent) {
    super(`Cannot apply ${event} from status ${from}`)
    this.name = 'IllegalTransitionError'
    this.from = from
    this.event = event
  }
}

/** Returns the next status if the transition is valid. Throws otherwise.
 *  Idempotent: applying the same event that lands on the current status returns it. */
export function nextStatus(from: OrderStatus, event: OrderEvent): OrderStatus {
  const target = EVENT_TO_TARGET[event]
  if (from === target) return target  // idempotent retry
  if (!ALLOWED[from].includes(target)) {
    throw new IllegalTransitionError(from, event)
  }
  return target
}

/** True if status is terminal (no further transitions). Useful for cleanup decisions. */
export function isTerminal(s: OrderStatus): boolean {
  return ALLOWED[s].length === 0
}
