# HireProof AI — VP review deck (November 2026)

Executive review materials for the HireProof AI prototype: a 14-slide deck, a
PDF export, the screenshots it uses and the script that rebuilds it.

## Files

| File | Purpose |
|---|---|
| `HireProof-AI-VP-Review-Nov-2026.pptx` | Editable 14-slide deck (16:9, Arial) |
| `HireProof-AI-VP-Review-Nov-2026.pdf` | PDF export used for visual QA |
| `build_deck.py` | Rebuilds the deck and screenshot cards |
| `screenshots/` | Source captures from the running app |
| `assets/` | Generated rounded/shadowed cards used by the deck |

## Rebuild

```bash
python3 -m pip install python-pptx pillow   # one-time
python3 docs/vp-review/build_deck.py        # writes the .pptx
```

The script is deterministic apart from the screenshot inputs. It rebuilds
`assets/` from `screenshots/` each run.

To regenerate the PDF and inspect every page:

```bash
soffice --headless -env:UserInstallation=file:///tmp/lo-profile \
  --convert-to pdf --outdir /tmp/pdfout \
  "docs/vp-review/HireProof-AI-VP-Review-Nov-2026.pptx"

python3 - <<'PY'
import pymupdf
doc = pymupdf.open("/tmp/pdfout/HireProof-AI-VP-Review-Nov-2026.pdf")
for i, page in enumerate(doc):
    page.get_pixmap(dpi=150).save(f"/tmp/deck-{i+1:02d}.png")
PY
```

All 14 rendered pages were inspected after the final build. Fonts are Arial
deliberately: it is the only sans-serif family that rendered natively in the
LibreOffice QA environment and it is present in PowerPoint and Keynote on both
macOS and Windows.

## Screenshot provenance

Captured on 16 November 2026 from the local OpenNext preview
(`http://localhost:8787`) using headless Chrome over the DevTools protocol:

- desktop: 1440 × 1000 CSS px at 2× device scale (2880 × 2000 files)
- mobile: 375 × 812 CSS px at 2×, mobile emulation on
- `search-results.png` was captured after scrolling to the result list so the
  deck shows ranked candidates, requirement evidence and source links rather
  than only the filter form
- the sidebar is cropped at x = 480 device px (240 CSS px) when building cards

The workspace is in **demo mode** (`AUTH_MODE=demo`) with the in-memory store
because the managed Supabase project is unreachable. Every screenshot carries
the app's own "DEMO ENVIRONMENT" badge and the pages state
`Data backend: memory`. The dataset is the seeded synthetic corpus: 13
candidates, 5 jobs, 12 applications, 46 evidence records. No real candidate
data is present.

## Deck claims and their sources

| Claim | Source |
|---|---|
| 1–4 ms cache hit | measured with `wrangler tail` and local workerd (README, Performance) |
| 0 search API calls in the UI | browser network log on the live and local `/search` pages |
| 66/66 Node tests, 22/22 Python checks | `npm test`, `python-service/tests/test_extraction.py` |
| P@5 0.47 · R@5 0.95 · MRR 1.00 | `npm run eval:search` (6 judged queries, synthetic corpus) |
| 13 / 5 / 12 / 46 counts | `.data/demo-store.json` |
| 39 supporting · 2 claimed · 3 not established · 2 needs review | evidence status counts in the same file |

The deck does not claim production readiness. Slide 12 lists the operational
gaps, and slide 8 states that the Free-plan CPU ceiling is only mitigated, not
removed.
