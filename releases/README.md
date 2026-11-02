# Release content

Each version has one source file: `releases/<version>.json`. About → Release notes and the What's new preview read the generated catalog built from these files. Images live in `public/releases/<version>/` and ship with the app; no network requests are required for release content.

`0.1.0.json` is a sample draft, not a published release. Review its claims, replace illustrations if desired, set `sample` to `false`, set a real `date`, and change `status` to `ready` before releasing it.

## File format (schemaVersion 1)

- `version`: stable `major.minor.patch`, matching the filename.
- `status`: `draft`, `ready`, or `released`.
- `sample`: required boolean; samples cannot be tagged by the release scripts.
- `date`: ISO `YYYY-MM-DD`; may be `null` only in drafts.
- `title`, `summary`: plain text, with no unfinished TODO/TBD/PLACEHOLDER text.
- `sections`: text-only categories, each appearing at most once: `Added`, `Improved`, `Fixed`, `Known issues`. Each category contains `items` with a `title` and `text`.
- `whatsNew`: 1–10 slides, in presentation order. Each has a unique slug `id`, `eyebrow`, `title`, `text`, and `image` with `src` and descriptive `alt`. Paths must start with `/releases/<version>/`. Supported images: SVG, PNG, WebP, JPG and JPEG. Prefer a 2:1 illustration, about 720 × 360 pixels. Author trusted local SVGs; external URLs and directory traversal are rejected.

The illustrated tour has Next/Done, Previous, clickable pagination dots, arrow-key navigation and Escape to close. Opening it again starts at slide one. Release notes render only categorized text. Older versions are available in expandable history entries. This prepares the same modal for an updater later; it does not automatically open on launch yet.

## Editing

1. Run `npm run release:notes` after bumping the app version. Existing files are never overwritten. The new draft deliberately contains TODOs and an example image; replace them before validation.
2. Edit the JSON and put final artwork in its public version directory.
3. Run `npm run release:generate` and commit the JSON, artwork, and `lib/generated/releases.ts` together.
4. Run `npm run release:check` to validate versions, content, image files and the generated catalog. Add `-- --ready` to check publication metadata too.

The committed generated catalog keeps client code free of filesystem access. `npm run build` refreshes it; checks verify that it is already current. Never edit the generated TypeScript directly. Files are sorted by numeric version, not string order.
