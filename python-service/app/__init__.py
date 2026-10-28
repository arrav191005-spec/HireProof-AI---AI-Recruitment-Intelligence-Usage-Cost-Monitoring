"""HireProof AI document-processing microservice (FastAPI).

Package layout:
- config.py       environment configuration (secrets only ever read from env)
- schemas.py      Pydantic request/response models
- pdf.py          untrusted-PDF handling and text extraction (pypdf)
- extraction.py   demo (heuristic) resume evidence extraction + grounding helpers
- llm.py          thin OpenAI HTTP client (chat/JSON + embeddings) used only in "llm" mode
- questions.py     interview-question generation (demo templates + LLM mode)
- main.py         FastAPI app, routes, exception handlers
"""

__version__ = "1.0.0"
