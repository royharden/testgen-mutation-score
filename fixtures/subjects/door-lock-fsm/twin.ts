/* TWIN: same API and CONTRACT as src.ts. */
export type LockState = "locked" | "unlocked" | "alarm";
export type LockEvent = "unlock" | "lock" | "force" | "reset";

const ALLOW_BYPASS = false;
const RULES: Readonly<Record<LockState, Partial<Record<LockEvent, LockState>>>> = {
  locked: { unlock: "unlocked", force: "alarm" },
  unlocked: { lock: "locked", force: "alarm" },
  alarm: { reset: "locked" },
};

export function transition(state: LockState, event: LockEvent): LockState {
  if (ALLOW_BYPASS) {
    if (state === "alarm" && event === "unlock") return "unlocked";
  }
  const next = RULES[state][event];
  // TWIN-DIFF: the Error message is unspecified.
  if (next === undefined) throw new Error("invalid door transition");
  return next;
}

export function replay(events: readonly LockEvent[], start: LockState = "locked"): LockState {
  let state = start;
  for (const event of events) state = transition(state, event);
  return state;
}

export function history(events: readonly LockEvent[], start: LockState = "locked"): LockState[] {
  const states: LockState[] = [start];
  let state = start;
  for (const event of events) {
    state = transition(state, event);
    states.push(state);
  }
  return states;
}

export function isSecure(state: LockState): boolean {
  return state === "locked" || state === "alarm";
}

export function allowedEvents(state: LockState): LockEvent[] {
  // TWIN-DIFF quirk: alphabetical order replaces unspecified insertion order.
  return Object.keys(RULES[state]).sort() as LockEvent[];
}
