// Clear linked hover state when the pointer or user leaves the game window.
export function onFigurinePointerExit(clear: () => void) {
  const hidden = () => { if (document.hidden) clear(); };
  document.documentElement.addEventListener("pointerleave", clear);
  window.addEventListener("blur", clear);
  document.addEventListener("visibilitychange", hidden);
  return () => {
    document.documentElement.removeEventListener("pointerleave", clear);
    window.removeEventListener("blur", clear);
    document.removeEventListener("visibilitychange", hidden);
  };
}
