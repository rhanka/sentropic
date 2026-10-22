# Final r11 delivery — DS typography

The sole current portable is [governance-r11-portable.html](../governance-r11-portable.html).
The dossier revision and visible badge are `r11`. Page headings use DS
`Typography`; every source font-size declaration references a DS token, with
no numeric size, local size token, fallback size or local heading override.

The offline 1440 px comparison passed for collapsed/expanded diagrams, inline
and in the viewer: all SVG geometry attributes and label texts match the
previous validated delivery. Only typography and the revision changed.
The baseline portable SHA-256 was
`7d008746d0057d0c80bc2468069eb9297bc267d55a671e504e8be7a485246fae`.
The final portable SHA-256 is
`c3192f3d8d49495e0056cdefe045c2e519460be91660e4fb2d4100825ed9bfa0`.

Before/after page and four-state diagram screenshots, plus the comparison
report, are saved under
`/home/antoinefa/src/sentropic/.tmp/governance-unification/r11-final-shots/`.
The final page and expanded viewer screenshots were visually inspected.
No horizontal overflow, browser error or external request occurred.

`make -C docs/governance/kit check-r11-final ENV=test-governance-contract`
rechecks the badge, DS typography, offline behavior and four preserved geometry
hashes without requiring an obsolete portable. This author's verification
does not constitute independent review; its historical selection status remains
documented in [review-selection.md](review-selection.md).

The final validation also passed: source assertions; 102 geometry scenes and
732 edges with no collision or routing failures; 16 offline browser states and
324 interactions; 32 content slides and 52 needs; denied-storage operation;
and 11 static SVG images in both themes at desktop and mobile widths.
