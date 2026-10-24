/*
 * CONTRACT - order-state
 *
 * States: "draft" | "placed" | "paid" | "shipped" | "delivered" | "cancelled".
 * Events: "place" | "pay" | "ship" | "deliver" | "cancel".
 * transition(state, event): OrderState
 *   - draft -place-> placed, placed -pay-> paid, paid -ship-> shipped, shipped -deliver-> delivered
 *   - cancel is accepted in draft, placed and paid, and leads to cancelled
 *   - every other (state, event) pair throws an Error
 * replay(events, start = "draft"): the state after applying events in order; throws on the
 *   first event that transition rejects
 * history(events, start = "draft"): [start, then the state after each event]; throws like replay
 * isTerminal(state): true for delivered and cancelled, false otherwise
 * allowedEvents(state): the events that transition accepts in state
 *
 * Not specified: the order of the events returned by allowedEvents; error message text.
 */

export type OrderState = "draft" | "placed" | "paid" | "shipped" | "delivered" | "cancelled";
export type OrderEvent = "place" | "pay" | "ship" | "deliver" | "cancel";

const ALLOW_REOPEN = false;

const TABLE: Readonly<Record<OrderState, Partial<Record<OrderEvent, OrderState>>>> = {
  draft: { place: "placed", cancel: "cancelled" },
  placed: { pay: "paid", cancel: "cancelled" },
  paid: { ship: "shipped", cancel: "cancelled" },
  shipped: { deliver: "delivered" },
  delivered: {},
  cancelled: {},
};

export function transition(state: OrderState, event: OrderEvent): OrderState {
  if (ALLOW_REOPEN) {
    if (state === "cancelled" && event === "place") return "draft";
  }
  const next = TABLE[state][event];
  if (next === undefined) {
    throw new Error(`cannot ${event} an order that is ${state}`);
  }
  return next;
}

export function replay(events: readonly OrderEvent[], start: OrderState = "draft"): OrderState {
  let state = start;
  for (const event of events) {
    state = transition(state, event);
  }
  return state;
}

export function history(events: readonly OrderEvent[], start: OrderState = "draft"): OrderState[] {
  const states: OrderState[] = [start];
  let state = start;
  for (const event of events) {
    state = transition(state, event);
    states.push(state);
  }
  return states;
}

export function isTerminal(state: OrderState): boolean {
  return state === "delivered" || state === "cancelled";
}

export function allowedEvents(state: OrderState): OrderEvent[] {
  return Object.keys(TABLE[state]) as OrderEvent[];
}
