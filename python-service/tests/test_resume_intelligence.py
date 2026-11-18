import unittest
from unittest.mock import patch

from pydantic import ValidationError

from app.ai_provider import AIProviderDisabled, FixtureAIProvider, OpenAIResponsesProvider
from app.resume_intelligence import (
    ResumeIntelligenceOutput, analyze_resume_text, ats_compatibility,
    map_claims_to_evidence, minimise_resume_text,
)


RESUME = """Ada Example
ada@example.invalid
PROJECTS
Shop Stack — Built a React storefront with FastAPI and PostgreSQL authentication.
Repository: https://github.com/example/shop-stack
"""


def fixture_payload():
    excerpt = "Shop Stack — Built a React storefront with FastAPI and PostgreSQL authentication."
    return {
        "summary": "Built a web project.",
        "skills": ["React", "FastAPI", "PostgreSQL", "Invented"],
        "projects": [{
            "name": "Shop Stack",
            "description": "React storefront with FastAPI and PostgreSQL authentication.",
            "claimed_languages": ["TypeScript"],
            "claimed_frameworks": ["React", "FastAPI"],
            "claimed_databases": ["PostgreSQL"],
            "github_url": "https://github.com/example/shop-stack",
            "deployed_url": "https://invented.invalid/demo",
            "source_excerpt": excerpt,
        }],
        "claims": [
            {"project_name": "Shop Stack", "claim_text": "React", "category": "framework",
             "source_excerpt": excerpt},
            {"project_name": "Shop Stack", "claim_text": "FastAPI", "category": "framework",
             "source_excerpt": excerpt},
            {"project_name": "Shop Stack", "claim_text": "shopping cart", "category": "feature",
             "source_excerpt": "not present"},
        ],
        "certificates": ["not present"],
    }


class ResumeIntelligenceTests(unittest.TestCase):
    def test_fixture_output_is_grounded_and_pii_minimised(self):
        result, provider_result = analyze_resume_text(RESUME, FixtureAIProvider(fixture_payload()))
        self.assertEqual(provider_result.model, "fixture-model")
        self.assertNotIn("ada@example.invalid", minimise_resume_text(RESUME))
        self.assertEqual(result.projects[0].github_url, "https://github.com/example/shop-stack")
        self.assertIsNone(result.projects[0].deployed_url)
        self.assertEqual([claim.claim_text for claim in result.claims], ["React", "FastAPI"])
        self.assertNotIn("Invented", result.skills)
        self.assertEqual(result.certificates, [])

    def test_hallucinated_citations_are_not_returned(self):
        result, _ = analyze_resume_text(RESUME, FixtureAIProvider(fixture_payload()))
        findings = map_claims_to_evidence(result.claims, [{
            "claim": "React", "status": "supporting", "file_path": "web/App.tsx",
            "source_url": "https://github.com/example/shop/blob/" + "a" * 40 + "/web/App.tsx",
            "source_excerpt": "import React from 'react'",
            "explanation": "A repository file contains a React import.",
        }])
        self.assertEqual(findings[0].classification, "supported")
        self.assertEqual(findings[0].file_path, "web/App.tsx")
        self.assertEqual(findings[0].source_excerpt, "import React from 'react'")
        self.assertEqual(findings[1].classification, "needs_review")
        self.assertIsNone(findings[1].source_url)

    def test_ats_is_explainable_and_does_not_use_personal_data(self):
        output, _ = analyze_resume_text(RESUME, FixtureAIProvider(fixture_payload()))
        report = ats_compatibility(
            requirements=[{"skill": "React"}, {"skill": "Python"}, {"skill": "PostgreSQL"}],
            skills=output.skills, projects=output.projects, has_experience=False, has_education=False,
        )
        self.assertEqual(report.covered_requirements, ["React", "PostgreSQL"])
        self.assertEqual(report.missing_requirements, ["Python"])
        self.assertIn("not an official", report.label.lower())
        self.assertIn("must not be used to automatically", report.disclaimer)

    def test_invalid_fixture_is_rejected_by_pydantic(self):
        with self.assertRaises(ValidationError):
            FixtureAIProvider({"projects": "not-a-list"}).structured(
                system="x", user="y", schema=ResumeIntelligenceOutput, schema_name="test")

    def test_real_provider_is_disabled_without_explicit_backend_enablement(self):
        with patch("app.ai_provider.config.ai_analysis_enabled", return_value=False):
            with self.assertRaises(AIProviderDisabled):
                OpenAIResponsesProvider()
