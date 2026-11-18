"""Partial mappings of existing SQL tables, not a schema-creation source.

Students and recruiters are represented by users.role. Candidate verification
evidence currently lives in candidate_evidence; dedicated certificates and
verification runs do not yet exist. Never use metadata.create_all against the
application database: database/migrations owns the complete schema.
"""
from datetime import datetime
from sqlalchemy import BigInteger, DateTime, ForeignKey, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(Text, primary_key=True)
    email: Mapped[str] = mapped_column(Text)
    role: Mapped[str] = mapped_column(Text)


class Candidate(Base):
    __tablename__ = "candidates"
    id: Mapped[str] = mapped_column(Text, primary_key=True)
    full_name: Mapped[str] = mapped_column(Text)


class Resume(Base):
    __tablename__ = "resumes"
    id: Mapped[str] = mapped_column(Text, primary_key=True)
    candidate_id: Mapped[str] = mapped_column(ForeignKey("candidates.id"))
    status: Mapped[str] = mapped_column(Text)


class Job(Base):
    __tablename__ = "jobs"
    id: Mapped[str] = mapped_column(Text, primary_key=True)
    title: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(Text)


class Application(Base):
    __tablename__ = "applications"
    id: Mapped[str] = mapped_column(Text, primary_key=True)
    candidate_id: Mapped[str] = mapped_column(ForeignKey("candidates.id"))
    job_id: Mapped[str] = mapped_column(ForeignKey("jobs.id"))
    stage: Mapped[str] = mapped_column(Text)


class Project(Base):
    __tablename__ = "projects"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    candidate_id: Mapped[str] = mapped_column(ForeignKey("candidates.id"))
    name: Mapped[str | None] = mapped_column(Text)


class CandidateEvidence(Base):
    __tablename__ = "candidate_evidence"
    id: Mapped[str] = mapped_column(Text, primary_key=True)
    candidate_id: Mapped[str] = mapped_column(ForeignKey("candidates.id"))
    skill: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(Text)


class ProjectRepositoryRef(Base):
    __tablename__ = "project_repository_refs"
    id: Mapped[str] = mapped_column(Text, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"))
    repository_url: Mapped[str] = mapped_column(Text)


class ProjectClaim(Base):
    __tablename__ = "project_claims"
    id: Mapped[str] = mapped_column(Text, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"))
    claim_text: Mapped[str] = mapped_column(Text)


class ProjectVerificationRun(Base):
    __tablename__ = "project_verification_runs"
    id: Mapped[str] = mapped_column(Text, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"))
    repository_ref_id: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(Text)
    commit_sha: Mapped[str | None] = mapped_column(Text)
    error_code: Mapped[str | None] = mapped_column(Text)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ProjectVerificationEvidence(Base):
    __tablename__ = "project_verification_evidence"
    id: Mapped[str] = mapped_column(Text, primary_key=True)
    run_id: Mapped[str] = mapped_column(Text)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"))
    claim_id: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(Text)
    source_url: Mapped[str | None] = mapped_column(Text)
    file_path: Mapped[str | None] = mapped_column(Text)
    commit_sha: Mapped[str | None] = mapped_column(Text)
    explanation: Mapped[str] = mapped_column(Text)


class Certificate(Base):
    __tablename__ = "certificates"
    id: Mapped[str] = mapped_column(Text, primary_key=True)
    candidate_id: Mapped[str] = mapped_column(ForeignKey("candidates.id"))
    title: Mapped[str] = mapped_column(Text)


class CertificateVerificationRun(Base):
    __tablename__ = "certificate_verification_runs"
    id: Mapped[str] = mapped_column(Text, primary_key=True)
    certificate_id: Mapped[str] = mapped_column(ForeignKey("certificates.id"))
    status: Mapped[str] = mapped_column(Text)
