#!/usr/bin/env python3
"""Build the HireProof AI VP review deck.

Run from the repo root:
    python3 docs/vp-review/build_deck.py

Screenshots are captured from the local demo environment (375x812 and
1440x1000). The deck uses only verified counts from the seeded dataset and the
measured test/evaluation results.
"""

from __future__ import annotations

import os
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter
from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.util import Emu, Inches, Pt

ROOT = Path(__file__).resolve().parents[2]
ASSETS = ROOT / "docs" / "vp-review" / "screenshots"
CARDS = ROOT / "docs" / "vp-review" / "assets"
OUT = ROOT / "docs" / "vp-review" / "HireProof-AI-VP-Review-Nov-2026.pptx"
CARDS.mkdir(parents=True, exist_ok=True)

# ---------------------------------------------------------------------------
# Palette and type
# ---------------------------------------------------------------------------
NAVY = RGBColor(0x0A, 0x16, 0x28)
NAVY_800 = RGBColor(0x16, 0x30, 0x4E)
NAVY_700 = RGBColor(0x1E, 0x3F, 0x63)
INK = RGBColor(0x0F, 0x17, 0x2A)
SLATE_700 = RGBColor(0x33, 0x41, 0x55)
SLATE_600 = RGBColor(0x47, 0x55, 0x69)
SLATE_500 = RGBColor(0x64, 0x74, 0x8B)
SLATE_400 = RGBColor(0x94, 0xA3, 0xB8)
BORDER = RGBColor(0xDC, 0xE6, 0xF2)
BORDER_SOFT = RGBColor(0xE8, 0xEE, 0xF7)
LIGHT = RGBColor(0xF6, 0xF9, 0xFC)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)
BRAND = RGBColor(0x25, 0x78, 0xEB)
BRAND_DARK = RGBColor(0x1D, 0x61, 0xD8)
BRAND_50 = RGBColor(0xEF, 0xF8, 0xFF)
BRAND_100 = RGBColor(0xDB, 0xEE, 0xFE)
BRAND_200 = RGBColor(0xBF, 0xE2, 0xFE)
TEAL = RGBColor(0x0D, 0x94, 0x88)
TEAL_50 = RGBColor(0xEC, 0xFD, 0xF5)
AMBER = RGBColor(0xB4, 0x53, 0x09)
AMBER_50 = RGBColor(0xFF, 0xFB, 0xEB)
PURPLE = RGBColor(0x6D, 0x28, 0xD9)
PURPLE_50 = RGBColor(0xF5, 0xF3, 0xFF)
RED = RGBColor(0xB9, 0x1C, 0x1C)
RED_50 = RGBColor(0xFE, 0xF2, 0xF2)

# Arial is deliberate: it is the one sans-serif family that renders natively in
# PowerPoint, Keynote and LibreOffice on both macOS and Windows. The deck was
# QA'd by converting to PDF with LibreOffice and inspecting every page.
HEAD = "Arial"
BODY = "Arial"

W, H = 13.333, 7.5
M = 0.7


def rgb_alpha(color: RGBColor, alpha: int) -> str:
    """Return an #RRGGBBAA string (python-pptx accepts it as a hex color)."""
    return "%02X%02X%02X%02X" % (color[0], color[1], color[2], alpha)


# ---------------------------------------------------------------------------
# Primitives
# ---------------------------------------------------------------------------
def new_slide(prs: Presentation, dark: bool = False):
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    bg = slide.background.fill
    bg.solid()
    bg.fore_color.rgb = NAVY if dark else LIGHT
    return slide


def _strip_style(shp):
    """Remove the theme style reference (it carries a preset shadow that
    LibreOffice and PowerPoint render even when effectLst is empty)."""
    style = shp._element.find(
        "{http://schemas.openxmlformats.org/presentationml/2006/main}style"
    )
    if style is not None:
        shp._element.remove(style)


def rect(slide, x, y, w, h, fill=None, line=None, line_w=0.75, radius=None, shape=MSO_SHAPE.RECTANGLE):
    if radius is not None:
        shape = MSO_SHAPE.ROUNDED_RECTANGLE
    shp = slide.shapes.add_shape(shape, Inches(x), Inches(y), Inches(w), Inches(h))
    if radius is not None:
        shp.adjustments[0] = radius
    if fill is None:
        shp.fill.background()
    else:
        shp.fill.solid()
        shp.fill.fore_color.rgb = fill
    if line is None:
        shp.line.fill.background()
    else:
        shp.line.color.rgb = line
        shp.line.width = Pt(line_w)
    shp.shadow.inherit = False
    _strip_style(shp)
    if shp.has_text_frame:
        shp.text_frame.text = ""
    return shp


def line(slide, x1, y1, x2, y2, color=BORDER, width=1.0, dash=None):
    conn = slide.shapes.add_connector(1, Inches(x1), Inches(y1), Inches(x2), Inches(y2))
    conn.line.color.rgb = color
    conn.line.width = Pt(width)
    if dash is not None:
        conn.line.dash_style = dash
    return conn


def text(slide, x, y, w, h, value, size=14, bold=False, color=INK, font=BODY,
         align=PP_ALIGN.LEFT, anchor=MSO_ANCHOR.TOP, line_spacing=1.12,
         space_after=0, italic=False, margins=(0, 0, 0, 0)):
    box = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = box.text_frame
    tf.word_wrap = True
    tf.margin_left = Inches(margins[0])
    tf.margin_right = Inches(margins[1])
    tf.margin_top = Inches(margins[2])
    tf.margin_bottom = Inches(margins[3])
    tf.vertical_anchor = anchor
    tf.auto_size = None
    p = tf.paragraphs[0]
    p.alignment = align
    p.line_spacing = line_spacing
    p.space_after = Pt(space_after)
    run = p.add_run()
    run.text = value
    f = run.font
    f.name = font
    f.size = Pt(size)
    f.bold = bold
    f.italic = italic
    f.color.rgb = color
    return box


def rich(slide, x, y, w, h, parts, size=14, color=INK, font=BODY, align=PP_ALIGN.LEFT,
         line_spacing=1.12, space_after=0, anchor=MSO_ANCHOR.TOP):
    """parts: list of (text, bold, color_override) runs in one paragraph."""
    box = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = box.text_frame
    tf.word_wrap = True
    tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
    tf.vertical_anchor = anchor
    tf.auto_size = None
    p = tf.paragraphs[0]
    p.alignment = align
    p.line_spacing = line_spacing
    p.space_after = Pt(space_after)
    for value, bold, override in parts:
        run = p.add_run()
        run.text = value
        run.font.name = font
        run.font.size = Pt(size)
        run.font.bold = bold
        run.font.color.rgb = override or color
    return box


def eyebrow(slide, value, color=BRAND, dark=False):
    text(slide, M, 0.48, 7.0, 0.24, value, size=10.5, bold=True,
         color=color if not dark else BRAND_200)


def title(slide, value, dark=False, y=0.78, size=30, width=12.0):
    text(slide, M, y, width, 0.9, value, size=size, bold=True,
         color=WHITE if dark else INK, line_spacing=1.02)


def subtitle(slide, value, dark=False, y=1.42, width=10.8, size=13.5, color=None):
    text(slide, M, y, width, 0.55, value, size=size,
         color=color or (BRAND_200 if dark else SLATE_600), line_spacing=1.25)


def footer(slide, number, total=14, dark=False):
    color = RGBColor(0x5C, 0x72, 0x8D) if dark else SLATE_400
    line(slide, M, 7.13, W - M, 7.13, color=RGBColor(0x22, 0x3A, 0x58) if dark else BORDER_SOFT, width=0.7)
    text(slide, M, 7.19, 6.0, 0.2, "HireProof AI", size=9, bold=True, color=color)
    text(slide, W - M - 1.5, 7.19, 1.5, 0.2, f"{number:02d} / {total:02d}", size=9,
         color=color, align=PP_ALIGN.RIGHT)


def notes(slide, value):
    slide.notes_slide.notes_text_frame.text = value


def pill(slide, x, y, w, h, value, fill=BRAND_50, color=BRAND_DARK, size=9.5, border=None):
    rect(slide, x, y, w, h, fill=fill, line=border, radius=0.5)
    text(slide, x, y, w, h, value, size=size, bold=True, color=color,
         align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)


def dot(slide, x, y, d, color):
    oval = slide.shapes.add_shape(MSO_SHAPE.OVAL, Inches(x), Inches(y), Inches(d), Inches(d))
    oval.fill.solid()
    oval.fill.fore_color.rgb = color
    oval.line.fill.background()
    oval.shadow.inherit = False
    _strip_style(oval)
    return oval


def arrow(slide, x, y, w=0.34, h=0.16, color=SLATE_400):
    shp = slide.shapes.add_shape(MSO_SHAPE.RIGHT_ARROW, Inches(x), Inches(y), Inches(w), Inches(h))
    shp.fill.solid()
    shp.fill.fore_color.rgb = color
    shp.line.fill.background()
    shp.shadow.inherit = False
    _strip_style(shp)
    return shp


def down_arrow(slide, x, y, w=0.16, h=0.3, color=SLATE_400):
    shp = slide.shapes.add_shape(MSO_SHAPE.DOWN_ARROW, Inches(x), Inches(y), Inches(w), Inches(h))
    shp.fill.solid()
    shp.fill.fore_color.rgb = color
    shp.line.fill.background()
    shp.shadow.inherit = False
    _strip_style(shp)
    return shp


def check_badge(slide, x, y, d=0.24, color=TEAL, dark=False):
    dot(slide, x, y, d, color)
    text(slide, x, y - 0.005, d, d, "✓", size=9, bold=True, color=WHITE,
         align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)


# ---------------------------------------------------------------------------
# Screenshot cards (rounded corners + soft shadow)
# ---------------------------------------------------------------------------
def make_card(src: Path, dst: Path, crop=None, radius_px=34, shadow=True, border=True):
    im = Image.open(src).convert("RGBA")
    if crop:
        im = im.crop(crop)
    w, h = im.size
    radius = max(8, int(radius_px * (w / 2322)))
    mask = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(mask)
    d.rounded_rectangle([0, 0, w - 1, h - 1], radius=radius, fill=255)
    im.putalpha(mask)

    pad = 46 if shadow else 0
    canvas = Image.new("RGBA", (w + pad * 2, h + pad * 2), (0, 0, 0, 0))
    if shadow:
        sh = Image.new("RGBA", (w + pad * 2, h + pad * 2), (0, 0, 0, 0))
        sd = ImageDraw.Draw(sh)
        sd.rounded_rectangle([pad, pad + 8, pad + w - 1, pad + 8 + h - 1], radius=radius,
                             fill=(10, 22, 40, 80))
        sh = sh.filter(ImageFilter.GaussianBlur(14))
        canvas.alpha_composite(sh)
    canvas.alpha_composite(im, (pad, pad))
    if border:
        bd = ImageDraw.Draw(canvas)
        bd.rounded_rectangle([pad, pad, pad + w - 1, pad + h - 1], radius=radius,
                             outline=(220, 230, 242, 255), width=2)
    canvas.save(dst)


def prep_cards():
    # Crops start at x=480 device px: the 240 CSS-px sidebar at 2x DPR. Any
    # earlier start clips the first letter of the candidate name.
    specs = {
        "evidence": ("candidate-evidence.png", (480, 0, 2880, 2000), 34),
        "search": ("search-results.png", (480, 0, 2880, 1600), 34),
        "search_tall": ("search-results.png", (480, 0, 2880, 1742), 34),
        "dashboard": ("dashboard.png", (480, 0, 2880, 1742), 34),
        "jobs": ("jobs.png", (480, 0, 2880, 1742), 34),
        "analytics": ("analytics.png", (480, 0, 2880, 1742), 34),
        "candidate": ("candidate.png", (480, 0, 2880, 1450), 34),
        "requirements": ("candidate-requirements.png", (480, 0, 2880, 1742), 34),
        "ava": ("ava-evidence.png", (480, 0, 2880, 1742), 34),
        "assessment": ("assessment-detail.png", (480, 0, 2880, 1450), 34),
        "mobile_search": ("mobile-search.png", None, 40),
        "mobile_dashboard": ("mobile-dashboard.png", None, 40),
    }
    for name, (file, crop, radius) in specs.items():
        make_card(ASSETS / file, CARDS / f"{name}.png", crop=crop, radius_px=radius)


def picture(slide, name, x, y, w=None, h=None):
    path = CARDS / f"{name}.png"
    kw = {}
    if w is not None:
        kw["width"] = Inches(w)
    if h is not None:
        kw["height"] = Inches(h)
    return slide.shapes.add_picture(str(path), Inches(x), Inches(y), **kw)


# ---------------------------------------------------------------------------
# Deck
# ---------------------------------------------------------------------------
def build():
    prep_cards()
    prs = Presentation()
    prs.slide_width = Inches(W)
    prs.slide_height = Inches(H)

    # =======================================================================
    # 1 — Title
    # =======================================================================
    s = new_slide(prs, dark=True)
    # Soft background blocks
    rect(s, 8.9, -1.6, 4.9, 4.9, fill=RGBColor(0x0F, 0x26, 0x40), radius=0.5)
    rect(s, 10.4, 3.6, 4.2, 4.2, fill=RGBColor(0x0D, 0x20, 0x38), radius=0.5)

    rect(s, M, 0.96, 0.56, 0.56, fill=BRAND, radius=0.16)
    text(s, M, 0.955, 0.56, 0.56, "H", size=22, bold=True, color=WHITE,
         align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)

    text(s, M, 1.78, 5.8, 0.55, "HireProof AI", size=42, bold=True, color=WHITE, line_spacing=1.0)
    rect(s, M, 2.53, 0.9, 0.045, fill=BRAND)
    text(s, M, 2.76, 6.0, 0.42, "Evidence-first recruiting intelligence.", size=21, color=BRAND_200)
    text(s, M, 3.34, 5.5, 1.0,
         "A working prototype for hiring teams that need to defend every decision — not just make one.",
         size=14, color=SLATE_400, line_spacing=1.35)

    pill(s, M, 5.38, 1.95, 0.36, "No opaque match scores", fill=RGBColor(0x13, 0x2C, 0x48),
         color=BRAND_200, size=9)
    pill(s, M + 2.08, 5.38, 1.45, 0.36, "No auto-reject", fill=RGBColor(0x13, 0x2C, 0x48),
         color=BRAND_200, size=9)
    pill(s, M + 3.66, 5.38, 1.95, 0.36, "Every claim traceable", fill=RGBColor(0x13, 0x2C, 0x48),
         color=BRAND_200, size=9)

    line(s, M, 6.62, M + 5.6, 6.62, color=RGBColor(0x25, 0x40, 0x60), width=0.7)
    text(s, M, 6.75, 6.0, 0.24, "Prepared for executive review  ·  16 November 2026", size=10,
         color=RGBColor(0x7C, 0x93, 0xAE))

    picture(s, "evidence", 7.15, 1.0, w=5.5)
    text(s, 7.2, 5.95, 5.4, 0.24, "Demo workspace  ·  synthetic candidate data", size=9,
         color=RGBColor(0x7C, 0x93, 0xAE))

    notes(s, "This is a working prototype, not a concept deck. The promise is narrow and testable: every candidate claim should be traceable to a source, and a human should make the decision. The screenshots are from the running app with the seeded synthetic dataset.")

    # =======================================================================
    # 2 — Executive summary
    # =======================================================================
    s = new_slide(prs)
    eyebrow(s, "EXECUTIVE SUMMARY")
    title(s, "Recruiters need proof, not a confidence score.")
    subtitle(s, "HireProof turns every candidate claim into a traceable, reviewable record — and keeps the human decision where it belongs.")

    cols = [
        ("01", "THE CATEGORY SELLS CERTAINTY",
         "AI summaries compress messy evidence into a match score that no recruiter can audit.",
         BRAND),
        ("02", "WE SELL THE EVIDENCE",
         "Every claim links to a source excerpt and page. Missing information is labeled, not guessed.",
         TEAL),
        ("03", "AND WE CAN SHOW IT WORKING",
         "Jobs, candidates, evidence, assessments, search and analytics run end-to-end today.",
         PURPLE),
    ]
    for i, (num, head, body, accent) in enumerate(cols):
        x = M + i * 4.05
        rect(s, x, 2.12, 3.78, 2.65, fill=WHITE, line=BORDER, radius=0.055)
        rect(s, x, 2.12, 3.78, 0.055, fill=accent)
        text(s, x + 0.28, 2.38, 0.5, 0.3, num, size=11, bold=True, color=accent)
        text(s, x + 0.28, 2.72, 3.2, 0.45, head, size=11.5, bold=True, color=INK)
        text(s, x + 0.28, 3.2, 3.22, 1.3, body, size=13, color=SLATE_600, line_spacing=1.28)

    # Bottom ask
    rect(s, M, 5.15, W - 2 * M, 1.32, fill=NAVY, radius=0.05)
    text(s, M + 0.38, 5.38, 0.85, 0.25, "THE ASK", size=9.5, bold=True, color=BRAND_200)
    text(s, M + 1.28, 5.3, 8.5, 0.7,
         "Fund a 6-week, 3-recruiter pilot to test whether traceable evidence reduces review time — with a stop/go gate at day 45.",
         size=14, color=WHITE, line_spacing=1.22)
    text(s, W - M - 1.7, 5.65, 1.3, 0.3, "Slide 14  →", size=11, bold=True,
         color=BRAND_200, align=PP_ALIGN.RIGHT)

    footer(s, 2)
    notes(s, "Three points only. The category sells certainty; we sell evidence. The product is already end-to-end. And the decision in front of the room is a small, time-boxed pilot, not a platform bet.")

    # =======================================================================
    # 3 — Problem
    # =======================================================================
    s = new_slide(prs)
    eyebrow(s, "THE PROBLEM")
    title(s, "Hiring AI has a trust problem — and it is structural.")
    subtitle(s, "The failure mode is not that models are always wrong. It is that their output looks equally confident when they are.")

    problems = [
        ("01", "Opaque scores", "A match percentage compresses evidence into a number no recruiter can audit or explain.", BRAND),
        ("02", "Invented specificity", "Generated summaries produce details that read like facts — and survive into the hiring decision.", AMBER),
        ("03", "No audit trail", "Decisions cannot be reconstructed for compliance, candidate feedback or an internal review.", PURPLE),
        ("04", "Auto-reject risk", "Automation removes the human before anyone has checked the evidence behind the claim.", RED),
    ]
    for i, (num, head, body, accent) in enumerate(problems):
        x = M + i * 3.05
        rect(s, x, 2.1, 2.85, 3.35, fill=WHITE, line=BORDER, radius=0.06)
        dot(s, x + 0.26, 2.36, 0.34, accent)
        text(s, x + 0.26, 2.355, 0.34, 0.34, num, size=8.5, bold=True, color=WHITE,
             align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
        text(s, x + 0.26, 2.92, 2.35, 0.45, head, size=15, bold=True, color=INK)
        text(s, x + 0.26, 3.5, 2.38, 1.55, body, size=12, color=SLATE_600, line_spacing=1.3)

    rect(s, M, 5.86, W - 2 * M, 0.86, fill=RED_50, line=RGBColor(0xFE, 0xCA, 0xCA), radius=0.08)
    rect(s, M, 5.86, 0.06, 0.86, fill=RED)
    text(s, M + 0.35, 6.03, 11.4, 0.45,
         "The risk is not only a bad hire. It is a decision you cannot defend.",
         size=16, bold=True, color=RGBColor(0x7F, 0x1D, 0x1D))

    footer(s, 3)
    notes(s, "I am not arguing that AI cannot help recruiting. I am arguing that the current interface hides the evidence. When a summary is wrong, it is wrong with the same confident tone as when it is right. That is a product design problem before it is a model problem.")

    # =======================================================================
    # 4 — Product
    # =======================================================================
    s = new_slide(prs)
    eyebrow(s, "THE PRODUCT")
    title(s, "A recruiting workspace that shows its work.")
    subtitle(s, "Open roles, search the pool, inspect evidence, run assessments and review the pipeline — in one place.")

    picture(s, "search", M, 1.95, w=6.6)
    text(s, M, 6.5, 6.6, 0.24,
         "10 candidates matched, each with requirement-level evidence and source links.",
         size=9.5, color=SLATE_500)

    principles = [
        ("01", "Evidence over inference",
         "Claims link to a source excerpt and page number. Unlocatable claims are downgraded, never invented.", TEAL),
        ("02", "Human judgment over auto-reject",
         "The system labels, sorts and explains. It never moves or rejects a candidate on its own.", BRAND),
        ("03", "Honest states over confident guesses",
         "Retrieval scores are labeled as retrieval scores — never as a hiring probability.", PURPLE),
    ]
    for i, (num, head, body, accent) in enumerate(principles):
        y = 2.0 + i * 1.48
        text(s, 7.6, y, 0.4, 0.3, num, size=10, bold=True, color=accent)
        text(s, 8.0, y - 0.025, 4.6, 0.3, head, size=13, bold=True, color=INK)
        text(s, 8.0, y + 0.28, 4.55, 0.9, body, size=11.5, color=SLATE_600, line_spacing=1.25)

    footer(s, 4)
    notes(s, "This is the product in one screen. The search result is not a scorecard with a number at the top. It shows the requirement, the evidence status, the exact excerpt and a link to the source. The ranking number exists, but it is explicitly framed as retrieval, not a prediction.")

    # =======================================================================
    # 5 — Evidence model
    # =======================================================================
    s = new_slide(prs)
    eyebrow(s, "THE EVIDENCE MODEL")
    title(s, "Five states. One rule: never dress up a guess as a fact.")
    subtitle(s, "Every record carries a status, a source and a reviewer trail. Missing information stays missing.")

    states = [
        ("Supporting", "An excerpt was located in a source document.", TEAL, TEAL_50),
        ("Assessment", "Demonstrated in a recorded task or submission.", BRAND, BRAND_50),
        ("Claimed", "Stated by the candidate, but no locatable source.", AMBER, AMBER_50),
        ("Not established", "Available records do not show it — not a negative.", SLATE_500, RGBColor(0xF1, 0xF5, 0xF9)),
        ("Needs review", "Ambiguous; requires human judgment.", PURPLE, PURPLE_50),
    ]
    for i, (name, desc, accent, bg) in enumerate(states):
        y = 2.02 + i * 0.78
        rect(s, M, y, 6.25, 0.68, fill=WHITE, line=BORDER, radius=0.1)
        rect(s, M, y, 0.055, 0.68, fill=accent)
        dot(s, M + 0.22, y + 0.26, 0.16, accent)
        text(s, M + 0.48, y + 0.1, 1.55, 0.22, name, size=10.5, bold=True, color=INK)
        text(s, M + 2.0, y + 0.095, 4.0, 0.46, desc, size=10, color=SLATE_600, line_spacing=1.15)

    picture(s, "requirements", 7.35, 1.98, w=5.3)
    text(s, 7.4, 6.1, 5.3, 0.24, "Requirement view: absence is shown, not scored as a rejection.",
         size=9.5, color=SLATE_500)

    text(s, M, 6.18, 6.2, 0.42, "Not established ≠ rejected.", size=20, bold=True, color=NAVY)
    text(s, M, 6.62, 6.4, 0.3, "A recruiter decides. The system records why.", size=11, color=SLATE_500)

    footer(s, 5)
    notes(s, "The five-state model is the core IP. Supporting means we found the quote. Assessment means they demonstrated it. Claimed means they said it but we could not locate it. Not established means the records are silent — which is different from negative. Needs review means a human must look. This is what makes the output defensible.")

    # =======================================================================
    # 6 — Product tour
    # =======================================================================
    s = new_slide(prs)
    eyebrow(s, "PRODUCT TOUR")
    title(s, "From job opening to defensible decision.")
    subtitle(s, "Four views, one data model. Every screen reads the same evidence records.")

    tour = [
        ("jobs", "01  Jobs", "Open roles, requirements and pipeline state."),
        ("search_tall", "02  Search", "Ranked in the browser with requirement-level evidence."),
        ("ava", "03  Candidate", "Claimed, supporting and review states with source links."),
        ("analytics", "04  Analytics", "Exact counts — no modeled or synthetic curves."),
    ]
    for i, (img, head, body) in enumerate(tour):
        x = M + (i % 2) * 6.03
        y = 1.92 + (i // 2) * 2.5
        rect(s, x, y, 5.95, 2.34, fill=WHITE, line=BORDER, radius=0.055)
        picture(s, img, x + 0.03, y + 0.03, w=3.0)
        text(s, x + 3.2, y + 0.38, 0.4, 0.22, head[:2], size=9, bold=True, color=BRAND)
        text(s, x + 3.2, y + 0.62, 2.5, 0.28, head[4:], size=12.5, bold=True, color=INK)
        text(s, x + 3.2, y + 1.0, 2.5, 0.9, body, size=9.5, color=SLATE_600, line_spacing=1.25)
        text(s, x + 3.2, y + 1.98, 2.5, 0.2, "Open  →", size=8.5, bold=True, color=BRAND_DARK)

    footer(s, 6)
    notes(s, "This is the five-minute tour. The point is not that there are many screens. The point is that they all read the same evidence model, so a recruiter never has to reconcile four different versions of the truth.")

    # =======================================================================
    # 7 — Architecture
    # =======================================================================
    s = new_slide(prs)
    eyebrow(s, "ARCHITECTURE")
    title(s, "A deliberately small system, with clear trust boundaries.")
    subtitle(s, "One frontend, one optional document service, one managed database. The browser never touches the database or an AI key.")

    boxes = [
        (0.7, 2.45, 2.25, "BROWSER", "Next.js UI", "Ranks search locally\nagainst embedded corpus", BRAND),
        (3.45, 2.45, 2.25, "EDGE", "Cloudflare Worker", "Cache hit 1–4 ms\nSession check on miss", TEAL),
        (6.2, 2.45, 2.25, "APP", "Next.js / OpenNext", "SSR, API routes\nvalidation, auth checks", PURPLE),
        (8.95, 2.45, 2.2, "DATA", "PostgreSQL + Auth", "Server-only SQL\nRLS + GoTrue sessions", AMBER),
    ]
    for x, y, w, tag, head, body, accent in boxes:
        rect(s, x, y, w, 1.55, fill=WHITE, line=BORDER, radius=0.07)
        rect(s, x, y, w, 0.05, fill=accent)
        text(s, x + 0.2, y + 0.22, w - 0.4, 0.2, tag, size=8.5, bold=True, color=accent)
        text(s, x + 0.2, y + 0.48, w - 0.4, 0.3, head, size=13, bold=True, color=INK)
        text(s, x + 0.2, y + 0.84, w - 0.35, 0.55, body, size=9.5, color=SLATE_600, line_spacing=1.2)

    arrow(s, 2.98, 3.12)
    arrow(s, 5.73, 3.12)
    arrow(s, 8.48, 3.12)
    text(s, 2.98, 2.82, 0.5, 0.2, "HTTPS", size=7.5, color=SLATE_400, align=PP_ALIGN.CENTER)
    text(s, 5.73, 2.82, 0.5, 0.2, "miss", size=7.5, color=SLATE_400, align=PP_ALIGN.CENTER)
    text(s, 8.48, 2.82, 0.5, 0.2, "SQL", size=7.5, color=SLATE_400, align=PP_ALIGN.CENTER)

    # Document service
    rect(s, 6.2, 4.65, 2.25, 1.15, fill=BRAND_50, line=BRAND_200, radius=0.08)
    text(s, 6.4, 4.8, 1.9, 0.2, "DOCUMENT SERVICE", size=8, bold=True, color=BRAND_DARK)
    text(s, 6.4, 5.02, 1.9, 0.25, "FastAPI on Render", size=11.5, bold=True, color=INK)
    text(s, 6.4, 5.28, 1.9, 0.3, "PDF parsing · extraction", size=8.5, color=SLATE_600)
    down_arrow(s, 7.24, 4.12, color=BRAND_200, h=0.38)
    text(s, 7.48, 4.18, 0.8, 0.2, "parse", size=7.5, color=SLATE_400)

    # Trust strip
    rect(s, M, 6.16, W - 2 * M, 0.62, fill=NAVY, radius=0.08)
    text(s, M + 0.3, 6.3, 11.8, 0.3,
         "Trust boundary:  database credentials and AI keys stay server-side  ·  all writes are validated and attributed  ·  every decision is logged",
         size=9.5, color=BRAND_200)

    footer(s, 7)
    notes(s, "The architecture is intentionally boring. The interesting decision is where trust lives: the browser gets a trimmed read-only corpus for ranking, but never a database credential or an AI key. The document service is optional and degrades honestly without it.")

    # =======================================================================
    # 8 — Engineering highlight
    # =======================================================================
    s = new_slide(prs, dark=True)
    eyebrow(s, "ENGINEERING", dark=True)
    title(s, "We made search survive a 10 ms CPU budget.", dark=True)
    subtitle(s, "Cloudflare Workers Free allows 10 ms of CPU per request. A Next.js render costs 60–554 ms. The naive design could not work.",
             dark=True, color=SLATE_400)

    # Before card
    rect(s, M, 2.05, 5.35, 3.55, fill=RGBColor(0x12, 0x27, 0x40), line=RGBColor(0x2B, 0x45, 0x62), radius=0.05)
    text(s, M + 0.3, 2.24, 1.2, 0.2, "BEFORE", size=9, bold=True, color=RGBColor(0xF8, 0x71, 0x71))
    text(s, M + 0.3, 2.5, 4.7, 0.35, "The request path was too expensive.", size=15, bold=True, color=WHITE)
    bars = [
        ("SSR render", "60–554 ms", 0.78),
        ("POST /api/search", "155–164 ms", 0.55),
        ("Free-plan budget", "10 ms", 0.12),
    ]
    for i, (label, value, frac) in enumerate(bars):
        y = 3.0 + i * 0.52
        text(s, M + 0.3, y, 1.65, 0.2, label, size=9.5, color=SLATE_400)
        rect(s, M + 2.02, y + 0.03, 2.55 * frac, 0.14, fill=RGBColor(0xF8, 0x71, 0x71) if i < 2 else BRAND)
        text(s, M + 2.02 + 2.55 * frac + 0.12, y - 0.02, 1.1, 0.2, value, size=9.5, bold=True,
             color=WHITE if i < 2 else BRAND_200)
    rect(s, M + 0.3, 4.86, 4.72, 0.5, fill=RGBColor(0x3B, 0x12, 0x18), line=RGBColor(0x7F, 0x1D, 0x1D), radius=0.1)
    text(s, M + 0.48, 4.98, 4.4, 0.25, "Result: Error 1102 / “Search failed (503)”", size=10.5, bold=True,
         color=RGBColor(0xFC, 0xA5, 0xA5))

    # After card
    rect(s, 6.25, 2.05, 6.38, 3.55, fill=RGBColor(0x0D, 0x2A, 0x3A), line=RGBColor(0x1C, 0x4D, 0x5A), radius=0.05)
    text(s, 6.55, 2.24, 1.2, 0.2, "AFTER", size=9, bold=True, color=RGBColor(0x5E, 0xEA, 0xD4))
    text(s, 6.55, 2.5, 5.7, 0.35, "Two changes removed search from the request path.", size=15, bold=True, color=WHITE)

    fixes = [
        ("1", "Edge response cache",
         "A 1–4 ms hit before OpenNext. Keys bound to deploy, user, token hash and URL; 200s only; 15-minute TTL."),
        ("2", "Rank in the browser",
         "The cached /search document embeds a privacy-trimmed corpus. The pure JS engine ranks it locally."),
    ]
    for i, (num, head, body) in enumerate(fixes):
        y = 3.0 + i * 1.18
        dot(s, 6.55, y + 0.02, 0.26, TEAL)
        text(s, 6.55, y + 0.015, 0.26, 0.26, num, size=9, bold=True, color=WHITE,
             align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
        text(s, 6.95, y - 0.02, 5.3, 0.25, head, size=11.5, bold=True, color=WHITE)
        text(s, 6.95, y + 0.28, 5.3, 0.65, body, size=10, color=RGBColor(0x9F, 0xB8, 0xC9), line_spacing=1.25)

    metrics = [
        ("1–4 ms", "cache hit"),
        ("0", "search API calls in the UI"),
        ("66/66", "tests passing"),
    ]
    for i, (value, label) in enumerate(metrics):
        x = M + i * 4.05
        text(s, x, 5.95, 3.7, 0.42, value, size=25, bold=True, color=WHITE)
        text(s, x, 6.38, 3.7, 0.22, label, size=9.5, color=SLATE_400)

    text(s, 8.0, 6.9, 4.6, 0.2, "Measured with wrangler tail and local workerd  ·  details in README", size=7.5,
         color=RGBColor(0x5C, 0x72, 0x8D), align=PP_ALIGN.RIGHT)

    footer(s, 8, dark=True)
    notes(s, "This is the engineering story I am proud of. The first design treated Cloudflare like a normal Node server. It failed under the Free plan: search alone was 15 times the per-request CPU budget. The fix was not to buy a bigger plan. It was to stop doing search on the server. The result is a 1–4 ms cache hit and zero Worker requests for an in-page search.")

    # =======================================================================
    # 9 — Security & trust
    # =======================================================================
    s = new_slide(prs)
    eyebrow(s, "SECURITY & TRUST")
    title(s, "Trust is enforced in code, not promised in copy.")
    subtitle(s, "The same evidence discipline applies to access, data and review attribution.")

    controls = [
        ("Session verified at three layers", "Middleware, server layout and every API handler independently validate the session."),
        ("RLS on application tables", "Row-level security plus revoked anon grants; database access only through the server."),
        ("Secrets stay server-side", "Database URL and AI keys never enter the client bundle or a logged payload."),
        ("Source excerpt + page number", "Every evidence record points to a real substring and a document location."),
        ("Reviewer attribution + audit log", "Decisions record who acted, when and what changed."),
        ("No auto-reject path", "Missing evidence never moves or rejects a candidate. A human must act."),
    ]
    for i, (head, body) in enumerate(controls):
        x = M + (i % 2) * 3.18
        y = 2.02 + (i // 2) * 1.42
        check_badge(s, x, y + 0.02, d=0.22)
        text(s, x + 0.34, y - 0.03, 2.65, 0.24, head, size=10.5, bold=True, color=INK)
        text(s, x + 0.34, y + 0.26, 2.65, 0.85, body, size=9.5, color=SLATE_600, line_spacing=1.22)

    rect(s, 7.05, 1.96, 5.58, 4.55, fill=AMBER_50, line=RGBColor(0xFD, 0xE6, 0x8A), radius=0.05)
    text(s, 7.35, 2.17, 4.9, 0.2, "PILOT HARDENING — BEFORE EXTERNAL TRAFFIC", size=8.5, bold=True, color=AMBER)
    gaps = [
        ("Rate limiting + CSRF", "SameSite cookies only today."),
        ("Workspace isolation", "All recruiters share one workspace."),
        ("Password reset", "Admins provision users directly."),
        ("Sandboxed execution", "Assessment code is checked, never executed."),
    ]
    for i, (head, body) in enumerate(gaps):
        y = 2.56 + i * 0.88
        dot(s, 7.38, y + 0.08, 0.1, AMBER)
        text(s, 7.6, y, 4.6, 0.22, head, size=10.5, bold=True, color=RGBColor(0x78, 0x3C, 0x0B))
        text(s, 7.6, y + 0.24, 4.55, 0.3, body, size=9.5, color=RGBColor(0x92, 0x65, 0x2B))

    text(s, 7.35, 6.12, 4.9, 0.24, "These are scoped, staffed and estimated — not hidden.", size=9.5, italic=True,
         color=RGBColor(0x92, 0x65, 0x2B))

    footer(s, 9)
    notes(s, "Trust is not a badge on a landing page. It is what the code refuses to do: the browser cannot query the database, a missing claim cannot become a rejection, and every decision carries a name. The right-hand card is the honest list of what is not production-ready yet.")

    # =======================================================================
    # 10 — Numbers
    # =======================================================================
    s = new_slide(prs)
    eyebrow(s, "BY THE NUMBERS")
    title(s, "The prototype is small. The signal is real.")
    subtitle(s, "Synthetic dataset, exact counts. No modeled or estimated metrics.")

    tiles = [
        ("13", "candidate profiles"),
        ("5", "jobs · 3 open"),
        ("12", "applications"),
        ("46", "evidence records"),
    ]
    for i, (value, label) in enumerate(tiles):
        x = M + (i % 2) * 2.85
        y = 2.0 + (i // 2) * 1.55
        rect(s, x, y, 2.62, 1.35, fill=WHITE, line=BORDER, radius=0.07)
        text(s, x + 0.24, y + 0.18, 2.2, 0.55, value, size=32, bold=True, color=NAVY)
        text(s, x + 0.24, y + 0.86, 2.2, 0.25, label, size=10, color=SLATE_500)

    # Evidence breakdown card
    rect(s, 6.15, 1.98, 6.48, 2.85, fill=WHITE, line=BORDER, radius=0.05)
    text(s, 6.45, 2.17, 5.9, 0.25, "EVIDENCE BY STATUS", size=9, bold=True, color=SLATE_500)
    statuses = [
        ("Supporting", 39, TEAL),
        ("Claimed", 2, AMBER),
        ("Not established", 3, SLATE_500),
        ("Needs review", 2, PURPLE),
    ]
    for i, (label, value, accent) in enumerate(statuses):
        y = 2.5 + i * 0.48
        text(s, 6.45, y, 1.45, 0.2, label, size=9.5, color=SLATE_600)
        rect(s, 7.95, y + 0.04, max(0.08, value / 39 * 3.45), 0.13, fill=accent)
        text(s, 11.5, y - 0.01, 0.6, 0.2, str(value), size=9.5, bold=True, color=INK, align=PP_ALIGN.RIGHT)

    # Bottom metric strip
    bottom = [
        ("66/66", "Node tests"),
        ("22/22", "Python checks"),
        ("P@5 0.47", "search baseline"),
        ("1–4 ms", "cache hit"),
    ]
    for i, (value, label) in enumerate(bottom):
        x = M + i * 3.05
        rect(s, x, 5.15, 2.83, 1.15, fill=NAVY, radius=0.06)
        text(s, x + 0.22, 5.28, 2.4, 0.35, value, size=18, bold=True, color=WHITE)
        text(s, x + 0.22, 5.72, 2.4, 0.2, label, size=9, color=BRAND_200)

    text(s, M, 6.55, 11.9, 0.3,
         "Search evaluation: 6 judged queries, P@5 0.47 · R@5 0.95 · MRR 1.00. A baseline, not a production benchmark.",
         size=8.5, color=SLATE_500)

    footer(s, 10)
    notes(s, "I am deliberately not showing growth curves or market sizes. These are exact counts from the seeded dataset and measured results from the running app. The search precision is 0.47 at five — mediocre, and we say so. The recall and MRR show the ranker is finding the right people; the precision says the ordering still needs work.")

    # =======================================================================
    # 11 — Demo
    # =======================================================================
    s = new_slide(prs)
    eyebrow(s, "DEMO")
    title(s, "A five-minute walkthrough.")
    subtitle(s, "The live demo runs in labeled demo mode with synthetic data — no credentials required.")

    steps = [
        ("1", "Open the dashboard", "Pipeline, evidence awaiting review, and recent activity."),
        ("2", "Search “senior React TypeScript engineer…”", "10 matches, each with requirement-level evidence."),
        ("3", "Open Elena Petrova → Evidence", "Excerpt, resume page, status and review action."),
        ("4", "Open Requirement evidence", "“Not established” is shown; it never becomes a rejection."),
        ("5", "Open Analytics and an assessment", "Exact counts; static checks plus human review."),
    ]
    for i, (num, head, body) in enumerate(steps):
        y = 2.0 + i * 0.88
        dot(s, M, y + 0.02, 0.32, BRAND)
        text(s, M, y + 0.01, 0.32, 0.32, num, size=9, bold=True, color=WHITE,
             align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
        text(s, M + 0.48, y - 0.03, 6.0, 0.24, head, size=11, bold=True, color=INK)
        text(s, M + 0.48, y + 0.24, 6.0, 0.3, body, size=9.5, color=SLATE_600)

    picture(s, "mobile_search", 7.15, 1.8, h=4.35)
    picture(s, "evidence", 9.45, 2.2, w=3.15)

    rect(s, M, 6.35, 6.25, 0.55, fill=WHITE, line=BORDER, radius=0.08)
    text(s, M + 0.2, 6.47, 5.85, 0.28, "Live demo: hireproof-ai.hireproof-ai.workers.dev", size=9.5, bold=True,
         color=BRAND_DARK)
    text(s, M + 0.2, 6.72, 5.85, 0.14, "Document service: localhost:8000  ·  app preview: localhost:8787", size=7.5,
         color=SLATE_500)

    footer(s, 11)
    notes(s, "This is the live walkthrough. The public URL is running the current build in demo mode because the managed Supabase project is offline. That is stated on the page. If the network is unavailable, the same flow runs locally on port 8787 with the document service on 8000.")

    # =======================================================================
    # 12 — Limitations
    # =======================================================================
    s = new_slide(prs)
    eyebrow(s, "WHAT THIS IS — AND IS NOT")
    title(s, "We are explicit about prototype vs. production.")
    subtitle(s, "A VP review should not require discovering the caveats afterwards.")

    rect(s, M, 1.95, 5.9, 4.35, fill=WHITE, line=BORDER, radius=0.05)
    text(s, M + 0.3, 2.15, 5.2, 0.25, "VERIFIED TODAY", size=9.5, bold=True, color=TEAL)
    verified = [
        "End-to-end flows on a seeded synthetic dataset",
        "66 Node tests and 22 Python extraction checks",
        "Browser-verified 375 × 812 mobile layouts",
        "Real source excerpts, page numbers and review states",
        "Search and cache behavior measured under Free-plan limits",
    ]
    for i, item in enumerate(verified):
        y = 2.55 + i * 0.62
        check_badge(s, M + 0.32, y + 0.02, d=0.2)
        text(s, M + 0.65, y - 0.02, 4.9, 0.42, item, size=10.5, color=SLATE_700, line_spacing=1.15)

    rect(s, 6.85, 1.95, 5.78, 4.35, fill=AMBER_50, line=RGBColor(0xFD, 0xE6, 0x8A), radius=0.05)
    text(s, 7.15, 2.15, 5.2, 0.25, "NOT YET PRODUCTION-GRADE", size=9.5, bold=True, color=AMBER)
    gaps = [
        "Free-plan CPU can still return 1102 on cold bursts",
        "Search P@5 is 0.47 — the ranker is not trained",
        "Managed Postgres and Auth are offline; demo uses memory",
        "No rate limiting, CSRF hardening or password reset",
        "Assessment code is statically checked, not sandbox-executed",
    ]
    for i, item in enumerate(gaps):
        y = 2.55 + i * 0.62
        dot(s, 7.17, y + 0.08, 0.1, AMBER)
        text(s, 7.4, y - 0.02, 4.9, 0.42, item, size=10.5, color=RGBColor(0x78, 0x3C, 0x0B),
             line_spacing=1.15)

    rect(s, M, 6.42, W - 2 * M, 0.48, fill=NAVY, radius=0.08)
    text(s, M + 0.25, 6.52, 11.8, 0.25,
         "The pilot is designed to test the product — not to pretend the operations are finished.",
         size=10, bold=True, color=BRAND_200)

    footer(s, 12)
    notes(s, "This is the slide that protects the room from a bad surprise. The product works end-to-end on synthetic data. The operations are not finished: the managed database and auth are offline, the search ranking is a baseline, and the Free plan still has a hard CPU ceiling. We are asking for a pilot, not a production launch.")

    # =======================================================================
    # 13 — Roadmap
    # =======================================================================
    s = new_slide(prs)
    eyebrow(s, "ROADMAP")
    title(s, "From prototype to a defensible pilot in 90 days.")
    subtitle(s, "Small scope, clear gates, no platform rewrite.")

    phases = [
        ("0–30 DAYS", "Make it real", BRAND,
         ["Restore managed Postgres + Auth", "Deploy the current build", "3 recruiters · 2 roles",
          "Baseline time-to-evidence", "Agree the four metrics"]),
        ("30–60 DAYS", "Make it better", TEAL,
         ["Learned ranking + embeddings", "Review SLAs and queues", "Role-based access",
          "Exportable evidence pack", "Weekly recruiter check-ins"]),
        ("60–90 DAYS", "Make the call", PURPLE,
         ["Pilot readout vs baseline", "Security review", "Cost model",
          "Go / narrow / stop", "Publish the evidence pack"]),
    ]
    for i, (period, head, accent, items) in enumerate(phases):
        x = M + i * 4.05
        rect(s, x, 1.95, 3.78, 3.95, fill=WHITE, line=BORDER, radius=0.05)
        rect(s, x, 1.95, 3.78, 0.055, fill=accent)
        text(s, x + 0.28, 2.18, 3.2, 0.22, period, size=9, bold=True, color=accent)
        text(s, x + 0.28, 2.45, 3.2, 0.35, head, size=17, bold=True, color=INK)
        for j, item in enumerate(items):
            y = 3.02 + j * 0.52
            dot(s, x + 0.3, y + 0.08, 0.1, accent)
            text(s, x + 0.52, y - 0.02, 3.0, 0.3, item, size=10, color=SLATE_600)

    rect(s, M, 6.18, W - 2 * M, 0.66, fill=BRAND_50, line=BRAND_200, radius=0.08)
    text(s, M + 0.3, 6.32, 11.9, 0.3,
         "Day 45 gate:  ≥50% faster evidence review  and  ≥4/5 recruiter trust  — or we stop.",
         size=11, bold=True, color=BRAND_DARK)

    footer(s, 13)
    notes(s, "The roadmap is deliberately narrow. Days 0–30 are about restoring operations and getting real usage. Days 30–60 improve ranking and review workflow. Days 60–90 produce a decision, not another demo. The day-45 gate is the important part: we agree on what success means before we start.")

    # =======================================================================
    # 14 — Ask
    # =======================================================================
    s = new_slide(prs, dark=True)
    rect(s, 9.2, -1.2, 4.8, 4.8, fill=RGBColor(0x0F, 0x26, 0x40), radius=0.5)
    rect(s, 10.9, 3.8, 3.8, 3.8, fill=RGBColor(0x0D, 0x20, 0x38), radius=0.5)

    eyebrow(s, "THE ASK", dark=True)
    title(s, "Approve the pilot, not the hype.", dark=True)
    text(s, M, 1.55, 8.4, 0.4, "Six weeks. Three recruiters. Two roles. One clear decision at the end.",
         size=13.5, color=SLATE_400)

    asks = [
        ("3 × 2 × 6", "3 recruiters · 2 roles · 6 weeks", "A real usage window, not a demo tour."),
        ("1 + 2", "One executive sponsor · two design partners", "Someone who can unblock, and teams with real roles."),
        ("4 metrics", "Agreed before day one", "No moving the goalposts after the pilot."),
    ]
    for i, (value, head, body) in enumerate(asks):
        y = 2.25 + i * 1.12
        text(s, M, y, 1.55, 0.4, value, size=20, bold=True, color=BRAND_200)
        text(s, M + 1.75, y + 0.02, 6.3, 0.25, head, size=11.5, bold=True, color=WHITE)
        text(s, M + 1.75, y + 0.3, 6.3, 0.25, body, size=10, color=SLATE_400)

    metrics = [
        ("≥50%", "faster evidence review"),
        ("100%", "claims source-linked"),
        ("≥4/5", "recruiter trust"),
        ("0", "auto-rejects"),
    ]
    for i, (value, label) in enumerate(metrics):
        x = M + i * 3.05
        text(s, x, 5.88, 2.8, 0.4, value, size=23, bold=True, color=WHITE)
        text(s, x, 6.28, 2.8, 0.2, label, size=8.5, color=BRAND_200)

    line(s, M, 6.72, M + 11.9, 6.72, color=RGBColor(0x25, 0x40, 0x60), width=0.7)
    text(s, M, 6.84, 7.0, 0.3, "Trust is the feature.", size=20, italic=True, color=BRAND_200)
    text(s, W - M - 3.8, 6.9, 3.8, 0.2, "HireProof AI  ·  November 2026", size=9, color=RGBColor(0x7C, 0x93, 0xAE),
         align=PP_ALIGN.RIGHT)

    notes(s, "So the ask is concrete: three recruiters, two roles, six weeks, and four metrics agreed before we start. If we do not hit the gate, we stop. That is a much better use of the next quarter than building more surface area on a prototype.")

    prs.save(OUT)
    print(f"Saved {OUT}")


if __name__ == "__main__":
    build()
