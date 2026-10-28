# Regression tests for the demo extractor — especially the date handling that
# previously dropped every ISO-dated role (2021-03) and glued graduation years
# onto school names. No pytest dependency: run with
#   python-service/.venv/bin/python python-service/tests/test_extraction.py
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.extraction import demo_extract, ExtractEvidenceRequest  # noqa: E402

RESUME = """MIRA ODELL
mira.odell@example.com | Bristol, UK
Backend Developer

SUMMARY
Backend developer with 5 years of experience building APIs and data pipelines.

SKILLS
Python, FastAPI, PostgreSQL, Docker, Kafka, Git

EXPERIENCE
Backend Developer at Larkspur Systems | 2021-03 - Present
Designed FastAPI services and PostgreSQL schemas; containerised with Docker.
Wrote Kafka consumers feeding the reporting database. Code reviewed via Git.

Junior Developer at Kestrel Media | 2019-01 - 2021-02
Maintained REST endpoints in Python and wrote pytest suites.

PROJECTS
Queue metrics dashboard
Python service streaming Kafka events into a PostgreSQL dashboard.

EDUCATION
BSc Computer Science
University of Bristol 2019
"""

PAGES = [{"page": 1, "text": RESUME}]

failures = []


def check(label, cond, detail=""):
    if cond:
        print(f"  ok  {label}")
    else:
        failures.append(label)
        print(f" FAIL {label} {detail}")


def run():
    ex = demo_extract(ExtractEvidenceRequest(text=RESUME, pages=PAGES))

    # --- experience: ISO year-month dates must parse --------------------------
    check("two roles parsed", len(ex.experience) == 2, f"got {len(ex.experience)}")
    if len(ex.experience) == 2:
        first, second = ex.experience
        check("role 1 title", first.title == "Backend Developer", first.title)
        check("role 1 company", first.company == "Larkspur Systems", first.company)
        check("role 1 start is ISO", first.start == "2021-03", first.start)
        check("role 1 end Present", first.end == "Present", first.end)
        check("role 2 company", second.company == "Kestrel Media", second.company)
        check("role 2 range", (second.start, second.end) == ("2019-01", "2021-02"),
              f"{second.start}->{second.end}")

    # --- education: graduation year is not part of the school name -----------
    check("one education entry", len(ex.education) == 1, f"got {len(ex.education)}")
    if ex.education:
        edu = ex.education[0]
        check("school without year", edu.institution == "University of Bristol", edu.institution)
        check("graduation year in end", edu.end == "2019", edu.end)
        check("degree kept", (edu.degree or "").startswith("BSc"), edu.degree)

    # --- years: explicit claim wins ------------------------------------------
    check("years from claim", ex.years_experience == 5.0, ex.years_experience)

    # --- grounding: every excerpt must be a real substring --------------------
    bad = [e for e in ex.evidence if e.excerpt not in RESUME]
    check("all evidence excerpts grounded", not bad, [b.excerpt for b in bad])
    check("evidence produced", len(ex.evidence) > 0)
    pages_used = {e.page for e in ex.evidence}
    check("page numbers in range", all(p is None or 1 <= p <= len(PAGES) for p in pages_used),
          pages_used)

    # --- month-name dates still work (no regression) -------------------------
    text2 = RESUME.replace("2021-03 - Present", "Mar 2021 - Present").replace(
        "2019-01 - 2021-02", "Jan 2019 - Feb 2021")
    ex2 = demo_extract(ExtractEvidenceRequest(text=text2, pages=[{"page": 1, "text": text2}]))
    check("month-name dates still parse", len(ex2.experience) == 2, f"got {len(ex2.experience)}")
    if len(ex2.experience) == 2:
        check("month-name range preserved",
              (ex2.experience[1].start, ex2.experience[1].end) == ("Jan 2019", "Feb 2021"),
              f"{ex2.experience[1].start}->{ex2.experience[1].end}")

    # --- plain-year dates still work (no regression) -------------------------
    text3 = RESUME.replace("2021-03 - Present", "2021 - Present").replace(
        "2019-01 - 2021-02", "2019 - 2021")
    ex3 = demo_extract(ExtractEvidenceRequest(text=text3, pages=[{"page": 1, "text": text3}]))
    check("plain-year dates still parse", len(ex3.experience) == 2, f"got {len(ex3.experience)}")

    # --- sanity: implausible years are skipped, not crash --------------------
    text4 = RESUME.replace("2021-03 - Present", "1821-03 - Present")
    try:
        ex4 = demo_extract(ExtractEvidenceRequest(text=text4, pages=[{"page": 1, "text": text4}]))
        check("implausible year skipped without crash",
              all(x.start != "1821-03" for x in ex4.experience))
    except Exception as err:  # noqa: BLE001
        check("implausible year skipped without crash", False, repr(err))

    # --- role summaries: prose between roles belongs to the earlier role -----
    if len(ex.experience) == 2:
        first_summary = ex.experience[0].summary or ""
        check("role 1 keeps its summary",
              "Designed FastAPI services" in first_summary and "Kafka consumers" in first_summary,
              first_summary[:80])
        check("role 2 keeps its summary",
              "pytest suites" in (ex.experience[1].summary or ""),
              (ex.experience[1].summary or "")[:80])
        check("role 2 header not swallowed by role 1 summary",
              "Kestrel Media" not in first_summary, first_summary[:80])


if __name__ == "__main__":
    print("python-service extraction regression tests")
    run()
    if failures:
        print(f"\n{len(failures)} check(s) failed")
        sys.exit(1)
    print("\nall checks passed")
