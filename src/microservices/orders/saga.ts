import type { OrderLine, OrderStatus, RejectReason } from '../../shared/contract.js';

export type Step = 'RESERVING' | 'PAYING' | 'REFUNDING' | 'DONE';

export interface SagaState {
  status: OrderStatus;
  step: Step;
}

export type SagaEvent =
  | { type: 'inventory.reserved'; data: { lines: OrderLine[]; amount: number } }
  | { type: 'inventory.rejected'; data: { reason: RejectReason } }
  | { type: 'payments.succeeded'; data: { chargeId: string } }
  | { type: 'payments.failed'; data: { reason: RejectReason } }
  | { type: 'payments.refunded'; data: Record<string, never> };

export interface Decision {
  patch?: {
    status: OrderStatus;
    step: Step;
    reason?: RejectReason;
    items?: OrderLine[];
    amount?: number;
  };
  emit: { type: string; data: unknown }[];
}

const IGNORE: Decision = { emit: [] };

/**
 * The place-order saga, as a pure function. Events that don't fit the current step are late
 * duplicates or arrive after a decision was made, and are ignored.
 */
export function decide(state: SagaState, event: SagaEvent): Decision {
  switch (event.type) {
    case 'inventory.reserved':
      if (state.step !== 'RESERVING') return IGNORE;
      return {
        patch: {
          status: 'PENDING',
          step: 'PAYING',
          items: event.data.lines,
          amount: event.data.amount,
        },
        emit: [{ type: 'payments.requested', data: { amount: event.data.amount } }],
      };
    case 'inventory.rejected':
      if (state.step !== 'RESERVING') return IGNORE;
      return { patch: { status: 'REJECTED', step: 'DONE', reason: event.data.reason }, emit: [] };
    case 'payments.succeeded':
      if (state.step !== 'PAYING') return IGNORE;
      return {
        patch: { status: 'CONFIRMED', step: 'DONE' },
        emit: [{ type: 'orders.confirmed', data: {} }],
      };
    case 'payments.failed':
      if (state.step !== 'PAYING') return IGNORE;
      // Compensation: inventory listens for orders.rejected and puts the stock back.
      return {
        patch: { status: 'REJECTED', step: 'DONE', reason: event.data.reason },
        emit: [{ type: 'orders.rejected', data: {} }],
      };
    case 'payments.refunded':
      if (state.status !== 'CANCELLING') return IGNORE;
      return {
        patch: { status: 'CANCELLED', step: 'DONE' },
        emit: [{ type: 'orders.cancelled', data: {} }],
      };
  }
}
