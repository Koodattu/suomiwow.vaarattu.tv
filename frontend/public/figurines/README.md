# Runtime collectible assets

`community-000/`, `community-001/`, and `community-002/` contain the 48 catalog
figures. `world/models/` contains registered world props. GLBs use Meshopt geometry
and embedded KTX2 ETC1S textures with full mipmaps. Preserve source material and
ground-anchor metadata. Catalog tests enforce reviewed per-character budgets.

Close-up box artwork in `packaging/` intentionally uses UASTC; shelf artwork uses
ETC1S. The old prototype figures, retired Chipiepew, and unregistered world props
were archived outside `public/` on 2026-11-02. Original exports and authoring
records remain in `E:/Projektit/wow.export/worker/data/`.

See [the short workflow](../../../docs/collectibles-assets.md) for importing,
conversion commands, cache versions and checks on this machine. Everything under
`public/` is served; keep backups and intermediate assets elsewhere.
