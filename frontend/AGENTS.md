<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Collectibles assets

Read [the short local asset workflow](../docs/collectibles-assets.md) before importing,
converting, or removing models. All served GLBs must use embedded KTX2 ETC1S;
close-up box artwork intentionally uses UASTC. Preserve original exports and
metadata, update cache versions, and run `node --test test/figurine-ktx.test.mjs`.
Keep retired models outside `public/`; the check also detects unregistered assets.
