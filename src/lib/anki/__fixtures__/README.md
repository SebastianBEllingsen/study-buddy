Real Anki 26.08 exports of the same tiny collection, used by
`apkgReader.test.ts`: `anki-26-modern.apkg` is Anki's default export
(`collection.anki21b`, zstd + schema v18) and `anki-26-legacy.apkg` is the
"support older Anki versions" export (`collection.anki21`, schema v11).

Contents: deck `Fixture::Sub` with a Basic note using HTML, entities, MathJax
and a bundled `dot.png`; a Basic note with a remote `<video>` and a
`[sound:clip.mp3]` reference whose file is *not* bundled; a Cloze note with a
hint. Deck `Other` has a "Basic (and reversed card)" note (two cards).
