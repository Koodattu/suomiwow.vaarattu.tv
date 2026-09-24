Optimized copies of the original CCG backgrounds in the parent directory.

- `tile`: up to 640 pixels wide, WebP quality 82.
- `display`: up to 1600 pixels wide for landscape art, or 768 pixels wide for portrait pack art, WebP quality 85.
- Aspect ratios are preserved and smaller originals are never enlarged.
- Original artwork is not modified. Unknown or uploaded backgrounds retain their original URL.

Regenerate from the frontend directory with `node scripts/optimize-ccg-backgrounds.mjs`.
The script also updates `src/lib/ccg-backgrounds.json`, which maps original URLs to their optimized copies.
