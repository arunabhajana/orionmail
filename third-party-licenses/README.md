# Third-party license sources

- `npm run notices:generate` regenerates `public/third-party-notices.json` and `public/THIRD-PARTY-NOTICES.txt`.
- Production builds run this command automatically using the installed production npm tree and the locked Windows Rust graph, including build dependencies.
- Package-provided license, copyright, COPYING and NOTICE files are collected first.
- Version-scoped directories here supply notices omitted from published archives. `.source-url` files identify upstream source revisions where available.
- `NOTICE-UPSTREAM.txt` reproduces a package's published license declaration and supplied README attribution when its archive has no standalone license file. It does not relicense that package.
- GSAP uses its own Standard No Charge license; it is not covered by OrionMail's MIT license.
- When upgrading dependencies, review their terms and add any missing version-scoped upstream notices before building. Generation fails when no license/notice source is available.
- Do not commit developer machine paths or credential files to notice artifacts.
