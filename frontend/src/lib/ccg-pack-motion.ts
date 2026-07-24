export function applyPackPointerMotion(target: HTMLElement, clientX: number, clientY: number): { x: number; y: number } {
  const bounds = target.getBoundingClientRect();
  const x = Math.max(0, Math.min(1, (clientX - bounds.left) / bounds.width));
  const y = Math.max(0, Math.min(1, (clientY - bounds.top) / bounds.height));
  target.style.setProperty("--pack-tilt-x", `${((0.5 - y) * 16).toFixed(2)}deg`);
  target.style.setProperty("--pack-tilt-y", `${((x - 0.5) * 18).toFixed(2)}deg`);
  target.style.setProperty("--pack-shine-x", `${(x * 100).toFixed(1)}%`);
  target.style.setProperty("--pack-shine-y", `${(y * 100).toFixed(1)}%`);
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
}
