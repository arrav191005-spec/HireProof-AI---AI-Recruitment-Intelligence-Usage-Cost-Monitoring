// ---------------------------------------------------------------------------
// Repository interface. The active backend is chosen in index.js.
// All methods are async so backends are interchangeable (memory / postgres).
// ---------------------------------------------------------------------------
const repo = {
  async getBackendInfo() {
    return { backend: 'memory', label: 'In-memory demo store', persistent: true };
  },

  // -- Jobs ------------------------------------------------------------------
  async listJobs({ status, q, page = 1, pageSize = 20 } = {}) {},
  async getJob(/* id */) {},
  async getJobRequirements(/* jobId */) {},
  async createJob(/* data */) {},
  async updateJob(/* id, patch */) {},

  // -- Candidates ------------------------------------------------------------
  async listCandidates({ q, skill, minYears, maxYears, evidenceStatus, page = 1, pageSize = 10, sort = 'recent' } = {}) {},
  async getCandidate(/* id */) {},
  async createCandidateFromExtraction(/* data */) {},
  async getCandidateSkills(/* candidateId */) {},
  async getCandidateEvidence(/* candidateId */) {},
  async updateEvidence(/* evidenceId, patch { status, notes, reviewedBy } */) {},
  async addEvidence(/* data */) {},
  async getCandidateSubmissions(/* candidateId */) {},
  async getCandidateApplications(/* candidateId */) {},
  async getJobApplications(/* jobId */) {},
  async createApplication(/* { candidateId, jobId, stage } */) {},
  async updateApplicationStage(/* applicationId, stage */) {},
  async updateCandidate(/* id, patch */) {},

  // -- Assessments -----------------------------------------------------------
  async listAssessments() {},
  async getAssessment(/* id */) {},
  async createAssessment(/* data */) {},
  async createSubmission(/* data */) {},
  async updateSubmission(/* id, patch */) {},
  async listSubmissions({ assessmentId, candidateId } = {}) {},

  // -- List-page aggregates --------------------------------------------------
  // Single-query replacements for N+1 patterns on list pages (the Workers CPU
  // budget makes per-row queries disproportionately expensive).
  async listSkillVocab() {},
  async applicationCounts(/* jobIds */) {},
  async candidateRollups(/* candidateIds */) {},

  // -- Search & analytics ------------------------------------------------------
  async recordSearchEvent(/* { query, mode, resultCount } */) {},
  async recentSearchEvents(/* limit */) {},
  async analyticsSummary() {},
  async logAudit(/* { action, entityType, entityId, metadata } */) {},
  async recentAuditLogs(/* limit */) {},

  // -- Search engine input ----------------------------------------------------
  // Candidate documents for the search engine: profile + evidence text.
  async searchCorpus() {},
};

export default repo;
