export function applyPackPointerMotion(target: HTMLElement, clientX: number, clientY: number): { x: number; y: number } {
  const bounds = target.getBoundingClientRect();
  const x = Math.max(0, Math.min(1, (clientX - bounds.left) / bounds.width));
  const y = Math.max(0, Math.min(1, (clientY - bounds.top) / bounds.height));
  const distance = Math.min(1, Math.hypot(x - 0.5, y - 0.5) / Math.SQRT1_2);
  target.style.setProperty("--pack-tilt-x", `${((0.5 - y) * 12).toFixed(2)}deg`);
  target.style.setProperty("--pack-tilt-y", `${((x - 0.5) * 14).toFixed(2)}deg`);
  target.style.setProperty("--pack-shine-x", `${(x * 100).toFixed(1)}%`);
  target.style.setProperty("--pack-shine-y", `${(y * 100).toFixed(1)}%`);
  target.style.setProperty("--pack-light-angle", `${(112 + (x - 0.5) * 24 - (y - 0.5) * 10).toFixed(1)}deg`);
  target.style.setProperty("--pack-fold-x", `${((x - 0.5) * 3.5).toFixed(2)}px`);
  target.style.setProperty("--pack-fold-y", `${((y - 0.5) * 2.5).toFixed(2)}px`);
  target.style.setProperty("--pack-shadow-x", `${((0.5 - x) * 9).toFixed(2)}px`);
  target.style.setProperty("--pack-shadow-y", `${(4 + Math.abs(y - 0.5) * 5).toFixed(2)}px`);
  target.style.setProperty("--pack-shadow-scale", (0.94 + distance * 0.08).toFixed(3));
  return { x, y };
}

export function resetPackMotion(target: HTMLElement): void {
  delete target.dataset.dragging;
  target.style.setProperty("--pack-drag-x", "0px");
  target.style.setProperty("--pack-drag-y", "0px");
  target.style.setProperty("--pack-tilt-x", "0deg");
  target.style.setProperty("--pack-tilt-y", "0deg");
  target.style.setProperty("--pack-shine-x", "50%");
  target.style.setProperty("--pack-shine-y", "38%");
  target.style.setProperty("--pack-light-angle", "112deg");
  target.style.setProperty("--pack-fold-x", "0px");
  target.style.setProperty("--pack-fold-y", "0px");
  target.style.setProperty("--pack-shadow-x", "0px");
  target.style.setProperty("--pack-shadow-y", "4px");
  target.style.setProperty("--pack-shadow-scale", "0.94");
}
