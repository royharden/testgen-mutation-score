/*
 * TWIN of order-state/src.ts: same exported API and the same CONTRACT (see src.ts).
 * Differs only where the CONTRACT is silent, plus the planted quirk; each difference is marked TWIN-DIFF.
 */

export type OrderState = "draft" | "placed" | "paid" | "shipped" | "delivered" | "cancelled";
export type OrderEvent = "place" | "pay" | "ship" | "deliver" | "cancel";

// TWIN-DIFF: transitions kept as a list of [from, event, to] rows instead of a nested table.
const RULES: readonly (readonly [OrderState, OrderEvent, OrderState])[] = [
  ["draft", "place", "placed"],
  ["placed", "pay", "paid"],
  ["paid", "ship", "shipped"],
  ["shipped", "deliver", "delivered"],
  ["draft", "cancel", "cancelled"],
  ["placed", "cancel", "cancelled"],
  ["paid", "cancel", "cancelled"],
];

export function transition(state: OrderState, event: OrderEvent): OrderState {
  const rule = RULES.find(([from, on]) => from === state && on === event);
  if (rule === undefined) {
    // TWIN-DIFF: different error message text (the CONTRACT leaves messages unspecified).
    throw new Error(`illegal transition ${state} + ${event}`);
  }
  return rule[2];
}

export function replay(events: readonly OrderEvent[], start: OrderState = "draft"): OrderState {
  return events.reduce<OrderState>((state, event) => transition(state, event), start);
}

export function history(events: readonly OrderEvent[], start: OrderState = "draft"): OrderState[] {
  const states: OrderState[] = [start];
  for (const event of events) states.push(transition(states[states.length - 1]!, event));
  return states;
}

export function isTerminal(state: OrderState): boolean {
  return state === "delivered" || state === "cancelled";
}

export function allowedEvents(state: OrderState): OrderEvent[] {
  // TWIN-DIFF quirk: events come back in alphabetical order; src.ts returns its table's insertion order.
  return RULES.filter(([from]) => from === state)
    .map(([, on]) => on)
    .sort();
}
