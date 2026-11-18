"""Opt-in live OpenAI Responses API smoke test using synthetic non-PII text."""
import os
import unittest

from app.ai_provider import OpenAIResponsesProvider
from app.resume_intelligence import analyze_resume_text

LIVE = os.environ.get("LIVE_OPENAI_TEST") == "1"
CONFIGURED = os.environ.get("AI_ANALYSIS_ENABLED") == "true" and bool(os.environ.get("OPENAI_API_KEY"))


@unittest.skipUnless(LIVE and CONFIGURED,
                     "set LIVE_OPENAI_TEST=1, AI_ANALYSIS_ENABLED=true and OPENAI_API_KEY")
class LiveOpenAITests(unittest.TestCase):
    def test_responses_api_returns_grounded_structured_resume_data(self):
        text = (
            "Synthetic Candidate\n"
            "Projects: Weather Board — Built a Python FastAPI dashboard with PostgreSQL.\n"
            "https://github.com/example/weather-board\n"
        )
        result, provider_result = analyze_resume_text(text, OpenAIResponsesProvider())
        self.assertTrue(provider_result.model)
        self.assertGreaterEqual(provider_result.usage.total_tokens, 0)
        self.assertTrue(all(project.source_excerpt in text for project in result.projects))
        self.assertTrue(all(claim.source_excerpt in text for claim in result.claims))
