// Multi-pack fan geometry shared by the opening reveal and shared batch pages, in card widths (x) and card heights (y).
const MULTI_FAN_COLUMN_STEP = 0.68;
const MULTI_FAN_ROW_STEP = 0.7;
const MULTI_FAN_ARC_DEPTH = 0.12;
const MULTI_FAN_ANGLE_STEP = 2.1;

// Lays the cards out as overlapping fanned rows, each later row covering the bottom of the one above.
export function getMultiFanLayout(total: number) {
  const rows = total > 12 ? 2 : 1;
  const perRow = Math.ceil(total / rows);
  const heightUnits = (rows - 1) * MULTI_FAN_ROW_STEP + 1 + MULTI_FAN_ARC_DEPTH;
  const slots = Array.from({ length: total }, (_, index) => {
    const row = Math.floor(index / perRow);
    const rowCount = row === rows - 1 ? total - perRow * (rows - 1) : perRow;
    const column = index - row * perRow;
    const offset = column - (rowCount - 1) / 2;
    const spread = rowCount > 1 ? offset / ((rowCount - 1) / 2) : 0;
    return {
      row,
      lastRow: row === rows - 1,
      x: offset * MULTI_FAN_COLUMN_STEP,
      y: row * MULTI_FAN_ROW_STEP + spread * spread * MULTI_FAN_ARC_DEPTH,
      angle: offset * MULTI_FAN_ANGLE_STEP,
      zIndex: row * 40 + column + 1,
    };
  });
  return { heightUnits, dealFromY: (heightUnits - 1) / 2, slots };
}
