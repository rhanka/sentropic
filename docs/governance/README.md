# Global governance contract — r11

This dossier records the shared governance contract for Sentropic, h2a, Engram
and Design System, including the owner's decisions of 2026-10-19.

- [Interactive portable dossier](governance-r11-portable.html): download the HTML
  and open it locally. It runs offline, starts collapsed and supports French,
  English, light/dark themes and frame expansion. GitHub displays HTML as source.
- [Decision register](decisions.md): G1, G2, G3 and H1, with dated verbatim evidence.
- [Study](study.md): 18 clauses, 14 provisional capabilities, 33 need routes and
  migration M0–M6. The owner's capability map remains pending.
- [Owner request](OWNER-REQUEST.md), [decision evidence](OWNER-DECISIONS-2026-10-19.md),
  [DS boundary](DS-POSITION-G3-2026-10-19.md) and
  [feedback history](owner-feedback-diagram/OWNER-FEEDBACK-RAW.md).
- [R11 DS typography and diagram validation](validation/r11-final.md) and [SHA-256 manifest](SHA256SUMS).

![Collapsed governance overview](images/overview-en.svg)

The accepted governance decisions do not qualify implementations, releases or
runtime deployments. The dossier preserves those evidence states separately.
Historical repository paths and package versions in the study are snapshot
citations from the original investigation, not claims about the latest releases.
The bilingual study and raw owner records are preserved in their source language.

## Rebuild and validate

Run from the repository root with Docker and Make available:

```sh
make -C docs/governance/kit install ENV=test-governance-contract
make -C docs/governance/kit build ENV=test-governance-contract
make -C docs/governance/kit export-static validate ENV=test-governance-contract
make -C docs/governance/kit deliver checksums ENV=test-governance-contract
make -C docs/governance/kit check-r11-final ENV=test-governance-contract
```

Dependencies and browser tooling live in Docker volumes. `node_modules/`,
`dist/` and `.cache/` are excluded from Git. The portable, static images and
precomputed geometry are intentional delivery artifacts. To regenerate geometry,
run `make -C docs/governance/kit prepare ENV=test-governance-contract` before build.
The pinned lockfile and vendored ELK layout engine support the source rebuild;
their licenses accompany the source. No application services or ports are used.

`export-static` freezes the same browser-rendered, precomputed geometry into
script-free SVG, including the collapsed overview and all ten frames. Each SVG
contains both theme palettes and works as a GitHub README image. The
[image manifest](images/manifest.json) ties those exports to the portable digest.

After rebuilding, verification reports and screenshots are in `kit/.cache/`.
The committed `validation/` directory records the final r11 check and historical runs. Verify the
delivered files with `sha256sum -c SHA256SUMS` from this directory.
