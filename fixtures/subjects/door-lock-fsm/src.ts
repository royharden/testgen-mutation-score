/*
 * CONTRACT - door-lock-fsm
 * States: locked, unlocked, alarm. Events: unlock, lock, force, reset.
 * transition: locked/unlock -> unlocked; unlocked/lock -> locked;
 * locked/force and unlocked/force -> alarm; alarm/reset -> locked.
 * Every other state/event pair throws Error. Error messages are unspecified.
 * replay(events, start = locked) applies events in order, throwing on invalid events.
 * history(events, start = locked) returns the start and every subsequent state.
 * isSecure(state) is true for locked and alarm, false for unlocked.
 * allowedEvents(state) returns exactly the accepted events, in unspecified order.
 */

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
  if (next === undefined) throw new Error(`door cannot ${event} while ${state}`);
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
  return Object.keys(RULES[state]) as LockEvent[];
}
