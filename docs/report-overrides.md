# Correcting guild reports

Open **Admin → Guilds → a guild → Manage Reports**.

- **Move to another guild:** enter a stored report's code or Warcraft Logs link, find the destination guild, and save. The report, fights, character appearances, and VOD links move together. The original WCL source snapshot is retained. A saved assignment prevents another guild's polling or full rescan from taking the report back.
- **Remove and ignore:** remove a stored report and exclude its code from this guild indefinitely. You can also enter a code that has already been deleted or has not been fetched yet. Exclusions do not prevent another guild from using the report.
- **Allow fetching:** remove an exclusion. Import the report or run a rescan to restore its data.
- **Use WCL ownership:** release a saved assignment. This leaves the stored report where it is until a future fetch changes its ownership. To reverse a move immediately, move it back from its current guild.

Manual imports also create persistent assignments. Both manual imports and corrections accept report codes and HTTPS Warcraft Logs report links. A destination exclusion must be removed explicitly before moving a report there.

Moves and removals recalculate the affected guild statistics and rankings without generating new historical feed events. Character participation, mechanics, generated tier lists, highlights, and guild network data refresh in the background; follow **Refresh Report Corrections** in Admin tasks. Existing feed events and CCG snapshots are not rewritten.

Corrections wait for you to finish queued/running guild work by returning a conflict while that work is present. Report writes are locked across the API and worker processes. Moves and removals require MongoDB transaction support (a replica set, including Atlas). No deployment or database migration command is required for the new collection; its unique report-code index is initialized before writes.

Report rules live separately from reports and have no expiry. Deleting reports or running full rescans does not delete these rules. Previously deleted reports cannot be identified automatically: add their codes with **Remove and ignore** to prevent their return. Existing manual imports gain a saved assignment when imported again through the updated admin flow.
