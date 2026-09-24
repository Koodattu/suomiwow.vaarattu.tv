# Death analysis interface

## Design read

Raiders reviewing a boss need to spot repeated death timings, compare attempts, and open the original log for a cause. The existing SuomiWoW dark surface suits an evening desktop gaming session; retain its neutral surfaces and use amber only for selection/early death, rose for other deaths, and green for survival. Symbols and labels supplement color.

## Directions considered

- Aligned pull timelines: directly supports timing comparison, repetition, and individual investigation. Selected as the main view.
- Session heatmap: compact for long histories but hides individual attempts. Use a small selectable density overview as supporting navigation.
- Insight-led cards: fast reading, but limited stored evidence risks misleading causal claims. Do not invent conclusions or scores.

## Structure

Compact character/boss context and collapsible selection controls; an inline summary; Timeline/Records views. The timeline displays every confirmed pull, including survival and missing death data, independently of records pagination. Session and focus controls reduce the working set. A selectable time-density strip focuses a time interval; seconds/percentage modes change the comparison axis. Select an attempt to inspect its character deaths, phase boundaries, and other known roster deaths. On narrow screens the inspector moves below the chart. Records retain existing sorting/filtering as an alternative.

## Acceptance

- Full-history plots are never constructed from a paginated event subset.
- Missing data is visibly different from survival; unknown roster order remains unknown.
- Repeated deaths and simultaneous deaths remain distinguishable in the inspector.
- Character/boss navigation, sessions, focus, axis, selected pull, and view remain shareable; scope changes clear stale selections.
- Pointer, touch, and keyboard can select pulls and investigate every individual death without relying on hover.
- Validate dense data, no deaths, missing data, empty filters, errors, Finnish text, mobile width, keyboard focus, and reduced motion.
