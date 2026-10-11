# typst_engine_bg.wasm: what takes up the 23 MB and how to shrink it

**Short answer:** yes, it can get much smaller without forking Typst. Two settings plus a few small patches to Typst's dependencies bring it from **23.07 MB raw / 6.63 MB brotli to 13.59 MB / 3.97 MB**, about 40% less to download. I built that combination and measured it.

The **default fonts are about as heavy as the wasm**: 9.68 MB raw / 5.08 MB brotli. The worker downloads all 17 of them before the first render.

**How I measured:** I built the engine crate in a scratch copy (`cargo build` offline with the pinned rust 1.99, wasm-bindgen 0.2.129 and wasm-opt `-Oz`, exactly as in `mise-tasks/build/engine`). Then I measured the final `_bg.wasm`: raw size, the code and data sections, gzip -9 and brotli q11. Baseline from the scratch build: **raw 23.07, code 13.48, data 9.52, gzip 9.03, brotli 6.63 MB**, the same as the file in the repo.

twiggy and wasm-tools could not be installed through `mise exec` (a sandbox attestation error), so I wrote small Node parsers instead:
- **Code by crate:** function-body sizes from the name section of the unoptimised 16.49 MB code, grouped by crate from the symbol names. The final code is about 0.82× of that.
- **Data by origin:** a rebuild with `-C link-arg=--no-merge-data-segments`, then byte-matching the embedded files from `~/.cargo/registry` and tracing which functions reference each segment.
- **Savings:** "measured" means a real variant build. Patched copies of dependencies were wired in with `[patch.crates-io]`.

## 1. What the size is made of

### Data (9.52 MB final)

| Origin | Raw | Brotli (alone) | Where it comes from / how found |
|---|---|---|---|
| hayagriva CSL styles (80 matched; the archive holds 91) | 1.71 MB | 0.07 | `include_bytes!` .cbor files, byte-matched |
| hayagriva CSL locales (63) | 1.10 MB | 0.08 | same |
| hypher hyphenation tries (48 languages) | 1.17 MB | 0.78 | Hungarian alone is 354 KB, German 206 KB, Norwegian 156 KB |
| ICU collator data (sort order of bibliography entries) | ~1.07 MB | ~0.28 | hayagriva builds the collator for any locale, so every locale's data is linked; measured with a variant |
| two-face syntaxes (raw-block highlighting) | 0.92 MB | 0.80 | one blob, hardly compresses |
| ICU LSTM models (line breaking for Thai/Lao/Khmer/Burmese) | ~0.34 MB | ~0.3 | f32 weight tables (identified from segment contents) |
| typst-assets (Foxit fonts for PDF images, ICC profiles, CJK segmenter data) | 0.30 MB | <0.1 | byte-matched |
| Other: Unicode/ICU property tables, regex Unicode tables, strings, panic messages, vtables, lorem, symbols | ~2.9 MB | – | remainder |

### Code (13.48 MB final; shares of the unoptimised 16.4 MB)

| Area | Share | Main crates |
|---|---|---|
| Typst itself | 30% | typst_library alone 3.15 MB (incl. a 163 KB `color::map` function), plus layout, eval, svg, comemo, ecow |
| Text shaping, fonts, Unicode, ICU | 10% | read_fonts, skrifa, rustybuzz, ttf_parser |
| Bibliography | 9.3% | citationberg, hayagriva, biblatex, serde_path_to_error, icu_collator |
| **PDF export** | 8.8% | typst_pdf, krilla, pdf_writer, subsetter, write_fonts, resvg, tiny_skia |
| **Wasm plugins** | 8.3% | wasmi, wasmparser, wasmi_ir |
| Raster images | 6.7% | image, webp, zune_jpeg, png, gif, moxcms |
| PDF files used as images | 6.6% | hayro_* (also needed for the SVG preview) |
| Data formats (json/toml/yaml/csv/xml/cbor) | 6.3% | |
| regex (shared by Typst's `regex()` and syntect) | 4.1% | |
| SVG images | 3.3% | usvg, svgtypes, roxmltree |
| Syntax highlighting code | 2.2% | syntect, fancy_regex |
| serde | 2.0% | |
| std/alloc | 1.2% | |
| typst-ide | ~0 | the jump functions only; measured −0.01 MB |
| wasm-bindgen glue | ~0 | |

## 2. What can be removed, what users lose, and the saving

All numbers are measured from variant builds unless marked "estimated".

| Option | How | What users lose | Raw saving | gzip / brotli saving |
|---|---|---|---|---|
| **`opt-level = "z"`** (now `"s"`) | one line in Cargo.toml | nothing functional; possibly slower compiles (needs a benchmark) | −2.20 MB (code 13.48 → 11.22) | −0.78 / **−0.44** |
| **Hyphenation for English and German only** | patched copy of hypher with `default = ["alloc","english","german"]`. Language variants are feature-gated and typst-layout only calls `Lang::from_iso`, so it compiles | no hyphenation for the other 46 languages (no error, just no hyphens) | −0.93 MB | −0.69 / **−0.62** |
| **No built-in highlighting for raw blocks** | patched copy of two-face whose `extra_no_newlines()` returns `SyntaxSet::default()` | no colouring of code blocks in other languages; Typst code (`typ`/`typc`/`typm`) is still highlighted and user-supplied `raw.syntaxes` still work. A middle ground is a custom set of ~15 languages built at build time | −0.92 MB | −0.84 / **−0.80** |
| **Simple sort for bibliographies** | patched hayagriva: `collation_cmp` compares strings directly | locale-aware sort order of bibliography entries (accents, non-Latin scripts) | −1.14 MB | −0.45 / −0.30 |
| **Only one built-in CSL style and the en-US locale** | patched hayagriva archive (I tested keeping apa only) | named built-in styles; users can still pass a `.csl` file | −2.73 MB | −0.27 / **−0.13** (CBOR compresses about 25×) |
| **No PDF export in this module** | remove `typst-pdf` | the PDF download, unless a second module provides it (section 3) | −1.88 MB (code −1.74) | −0.66 / −0.43 |
| typst-ide | already minimal | – | −0.01 MB | – |
| Wasm plugins (wasmi) | needs a typst-library patch (`foundations/plugin.rs`) or a stub of the wasmi API | `plugin()`, so Universe packages that use plugins break | ~1.1–1.2 MB estimated, not built | ~0.3 brotli estimated |
| ICU LSTM models | patch typst-layout or icu_segmenter_data | proper line breaking for Thai/Lao/Khmer/Burmese | ~0.34 MB estimated | ~0.3 estimated |
| PDF/SVG/raster image support, data formats, regex | not feature-gated in typst-library 0.15.1 | – | needs a fork | – |

- **Feature flags:** none of Typst's crates expose a flag for any of this. hayagriva's `default = ["biblatex","archive"]` and hypher's `full` are switched on by typst-library and typst-layout, and Cargo features only add, never remove. So every option except the opt-level needs a `[patch.crates-io]` with a vendored copy of the dependency that changes 1–10 lines.
- **No patch to Typst itself** is needed for any measured option.
- **Combined (measured):** opt-level z + no PDF + hypher en/de + no two-face syntaxes + hayagriva with one style and simple sort gives **raw 13.59, code 9.74, data 3.78, gzip 5.48, brotli 3.97 MB**.
- opt-level z + no PDF on its own: raw 19.32, brotli 5.85.

## 3. Splitting the module

**PDF export as a second wasm:** Rust on wasm32 has no practical way to load a second module into the same memory. `PagedDocument` lives inside the first module's memory and Typst cannot serialize it. So a "PDF module" would be a **second full engine** (≈ today's 23 MB / 6.6 MB brotli) that receives the project files and compiles again on "Download PDF". In other words, it duplicates everything except the 1.88 MB it removes from the main module.

That is still a reasonable trade if PDF downloads are rare: build a preview engine without PDF and a full engine loaded on demand. It costs a second build target and a second worker. It saves only 0.43 MB brotli on the critical path, though, and the first PDF download then costs about 6 MB.

binaryen's `wasm-split` (splitting off cold functions to load later) is technically possible. But it needs the loading to block (or JSPI/asyncify) and does not work well with wasm-bindgen, so the risk is high.

**Fetching data lazily like fonts:** the crates read their data synchronously from the binary (`include_bytes!`), so there is no runtime hook. It can be done with a small patch per crate:
- the crate looks up its data in a registry that the host fills;
- if the data is missing, it records it (the same pattern as `take_missing_packages`);
- the host fetches the data and compiles again, after clearing Typst's compile cache (`comemo::evict`), because hyphenation data is not a tracked World input.

Whether it pays off per crate:
- **hypher:** good fit, per-language files; 0.78 MB brotli moves off the critical path.
- **two-face:** good fit, one 0.8 MB blob loaded on the first raw block with a language.
- **hayagriva styles and locales:** not worth it for download size (0.15 MB brotli); it only saves about 2.8 MB of memory.
- **ICU collator data:** this is compiled-in Rust data, not files, so it cannot be fetched lazily without a larger patch.

## 4. How the files are delivered today

- **Loading:** `createEngine` → `init({module_or_path: url})` → `fetch` → `WebAssembly.instantiateStreaming`, so compilation overlaps the download. This needs the `application/wasm` MIME type, otherwise it falls back to a slower path with a warning.
- **Startup order:** the Preview constructor starts the worker right away and posts `init` with `ENGINE_WASM_URL` and **all 17 `DEFAULT_FONT_URLS`**. The worker waits for the wasm and every font (`Promise.all`), calls `addFont` 17 times, and only then can compile. So the critical path is **6.63 MB (wasm) + 5.08 MB (fonts) ≈ 11.7 MB brotli**, or 23.1 + 9.7 MB raw. NewCMMath alone is 3.8 MB raw in three weights, and seven DejaVu and Libertinus faces are loaded before anything uses them.
- **Server:**
  - `vite` dev (demo and `mise run demo`) serves the files uncompressed with no long-lived caching.
  - The collaboration server does not serve static files at all.
  - There is no brotli/gzip pre-compression step and no compression plugin in `package.json`.
  - The library build (`dist/lib`) emits `typst_engine_bg.wasm` and the fonts **without a content hash**, so `immutable` caching is unsafe and everything depends on the consumer's server.
- **Caching:** the Cache API is used only for Typst packages, not for the wasm or the fonts.

## 5. Recommendation, best first

1. **Serve the files properly (no code risk).** Pre-compress with brotli (`.br` next to the files), set `Content-Type: application/wasm`, add a content hash to the wasm and font names in `dist/lib`, and use `Cache-Control: immutable`. Brotli instead of gzip saves 2.4 MB on the wasm alone (9.03 → 6.63), and repeat visits cost nothing.
2. **Load fonts lazily or in tiers.** Load Libertinus Regular/Italic/Bold plus NewCMMath-Regular first and the rest on demand. Missing-font diagnostics could trigger the fetch, like packages already do. That is up to about 3–4 MB brotli off the critical path, with no Rust changes. It is outside the wasm question, but it is the biggest single item on the critical path.
3. **`opt-level = "z"`:** −2.2 MB raw / −0.44 brotli for one line. Benchmark compile time first. Faster compiler settings for typst-layout only can be tried through profile overrides, but with `lto = true` it is not certain those per-crate settings have any effect, so measure.
4. **Small patched copies of dependencies** (a few lines each; check them on every Typst upgrade):
   - two-face without syntaxes, or with a reduced set: −0.80 MB brotli;
   - hypher with only the languages you need: −0.62 MB brotli;
   - the per-crate lazy-loading patch from section 3 keeps both features working while still moving the data off the critical path.
5. **hayagriva (styles, locales, collator):** big raw saving (−3.9 MB raw, ≈ −2.5 MB of startup memory) but only −0.43 MB brotli. Do it only if memory or instantiation time matters.
6. **PDF as a separate, on-demand full engine:** −0.43 MB brotli on the critical path, but a second build and worker and about 6 MB on the first download. Not worth it unless PDF is a rare action.
7. **Avoid:** forking typst-library to drop wasm plugins, image formats or PDF-as-image (~1.1 MB each), and `wasm-split`. High maintenance or high risk for modest gains.

With 1–4 and the wasm in its smallest measured form (≈ 4 MB brotli), the critical path drops from about 11.7 MB to roughly 5–6 MB brotli including the core fonts.

The measuring scripts and patched crate copies were in the session scratchpad (not kept).
