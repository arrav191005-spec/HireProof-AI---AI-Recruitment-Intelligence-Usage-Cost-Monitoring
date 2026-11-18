-- Phase 12: read only the candidate-owned structured inputs needed for an
-- explainable compatibility estimate.
grant select on candidate_skills, experiences, education to hireproof_v2_access;
create policy hp_candidate_skill_read on candidate_skills for select to hireproof_v2_access
  using (hp_can_candidate(candidate_id));
create policy hp_experience_read on experiences for select to hireproof_v2_access
  using (hp_can_candidate(candidate_id));
create policy hp_education_read on education for select to hireproof_v2_access
  using (hp_can_candidate(candidate_id));
