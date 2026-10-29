export type BoxState = { phase: "sealed" | "loading" | "opening" | "revealed" | "error"; selected: number | null; round: number };
export type BoxAction = { type: "open"; selected: number } | { type: "loaded" | "revealed" | "failed" | "reset" | "retry" };
export const initialBox: BoxState = { phase: "sealed", selected: null, round: 0 };

export function chooseFigure(count: number, random: number): number {
  if (!Number.isInteger(count) || count < 1 || random < 0 || random >= 1 || !Number.isFinite(random)) throw new Error("Invalid draw");
  return Math.floor(random * count);
}

export function boxReducer(state: BoxState, action: BoxAction): BoxState {
  switch (action.type) {
    case "open": return state.phase === "sealed" ? { ...state, phase: "loading", selected: action.selected } : state;
    case "loaded": return state.phase === "loading" ? { ...state, phase: "opening" } : state;
    case "revealed": return state.phase === "opening" ? { ...state, phase: "revealed" } : state;
    case "failed": return state.phase === "loading" || state.phase === "opening" ? { ...state, phase: "error" } : state;
    case "retry": return state.phase === "error" ? { ...state, phase: "loading", round: state.round + 1 } : state;
    case "reset": return state.phase === "revealed" || state.phase === "error" ? { ...initialBox, round: state.round + 1 } : state;
  }
}
