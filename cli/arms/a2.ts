import type { TestUnit } from "../core/schemas.js";
import type { GateState } from "../core/gate.js";
/** Agent-authored frozen hand proxy. Callers clone this state for each A6 cell. */
export const a2 = (hand: readonly TestUnit[]): GateState => ({ keptUnits: [...hand], killedFeedbackKeys: [], coveredLines: [] });
