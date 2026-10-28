// ---------------------------------------------------------------------------
// HireProof AI — synthetic demo dataset.
//
// Every person, company, email and document below is fictional and generated
// for development/demo purposes only. No real candidate data is used.
// The dataset is the single source of truth for:
//   - the in-memory fallback data layer (lib/repo/memory.js)
//   - the PostgreSQL seed script (database/seed.js)
//   - the search evaluation dataset (tests/search-eval.json)
// ---------------------------------------------------------------------------

const now = '2026-10-20';

function makeEvidence(id, candidateId, skill, opts) {
  return {
    id,
    candidateId,
    skill,
    sourceType: opts.sourceType ?? 'resume', // resume | assessment | manual
    sourceId: opts.sourceId ?? `res-${candidateId.replace('cand-', '')}`,
    sourceName: opts.sourceName ?? 'Resume',
    excerpt: opts.excerpt,
    location: opts.location ?? null, // { page, section } — never invented
    status: opts.status ?? 'supporting', // claimed | supporting | assessment | not_established | needs_review
    extractor: opts.extractor ?? 'demo-heuristic',
    notes: opts.notes ?? null,
    createdAt: opts.createdAt ?? now,
  };
}

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

export const jobs = [
  {
    id: 'job-junior-fullstack',
    title: 'Junior Full-Stack Developer',
    department: 'Engineering',
    location: 'Remote (EU)',
    employmentType: 'Full-time',
    status: 'open',
    experienceMin: 0,
    experienceMax: 2,
    description:
      'We are hiring a junior full-stack developer to join our product team. You will build user-facing features in React and implement REST APIs in Node.js, backed by a SQL database. You will work with a senior mentor and participate in code reviews.',
    requiredSkills: [
      { skill: 'React', minYears: null, note: 'Has built user-facing React applications' },
      { skill: 'Node.js', minYears: null, note: 'Has developed REST APIs with Node.js' },
      { skill: 'SQL', minYears: null, note: 'Has worked with a SQL database (any engine)' },
    ],
    preferredSkills: [
      { skill: 'TypeScript', minYears: null, note: 'Preferred but not required' },
      { skill: 'Git', minYears: null, note: null },
    ],
    createdAt: '2026-09-08T09:12:00Z',
    updatedAt: '2026-10-14T15:40:00Z',
    createdBy: 'Demo Recruiter',
  },
  {
    id: 'job-senior-frontend',
    title: 'Senior Frontend Engineer',
    department: 'Engineering',
    location: 'Berlin (Hybrid)',
    employmentType: 'Full-time',
    status: 'open',
    experienceMin: 5,
    experienceMax: null,
    description:
      'Own the architecture of our customer-facing web application. We expect deep React and TypeScript experience, production use of Next.js, and a track record of mentoring. Design-system experience is a plus.',
    requiredSkills: [
      { skill: 'React', minYears: 5, note: null },
      { skill: 'TypeScript', minYears: 3, note: null },
      { skill: 'Next.js', minYears: 2, note: null },
    ],
    preferredSkills: [
      { skill: 'Design Systems', minYears: null, note: null },
      { skill: 'Testing', minYears: null, note: 'Jest, Playwright or similar' },
    ],
    createdAt: '2026-08-27T10:00:00Z',
    updatedAt: '2026-10-18T09:30:00Z',
    createdBy: 'Demo Recruiter',
  },
  {
    id: 'job-backend-node',
    title: 'Backend Engineer (Node.js)',
    department: 'Engineering',
    location: 'Remote (Global)',
    employmentType: 'Full-time',
    status: 'open',
    experienceMin: 3,
    experienceMax: null,
    description:
      'Design and operate the services behind our public API. Strong Node.js and PostgreSQL experience required. Experience with message queues and observability is a plus.',
    requiredSkills: [
      { skill: 'Node.js', minYears: 3, note: null },
      { skill: 'PostgreSQL', minYears: 2, note: null },
      { skill: 'REST APIs', minYears: 3, note: null },
    ],
    preferredSkills: [
      { skill: 'Kafka', minYears: null, note: null },
      { skill: 'Docker', minYears: null, note: null },
    ],
    createdAt: '2026-09-19T14:05:00Z',
    updatedAt: '2026-10-11T11:22:00Z',
    createdBy: 'Demo Recruiter',
  },
  {
    id: 'job-data-engineer',
    title: 'Data Engineer',
    department: 'Data',
    location: 'Amsterdam',
    employmentType: 'Full-time',
    status: 'draft',
    experienceMin: 2,
    experienceMax: null,
    description:
      'Build and maintain batch and streaming pipelines that feed our analytics warehouse. Strong Python and SQL skills required; Airflow or dbt experience is a plus.',
    requiredSkills: [
      { skill: 'Python', minYears: 2, note: null },
      { skill: 'SQL', minYears: 3, note: null },
    ],
    preferredSkills: [
      { skill: 'Airflow', minYears: null, note: null },
      { skill: 'dbt', minYears: null, note: null },
    ],
    createdAt: '2026-10-06T08:45:00Z',
    updatedAt: '2026-10-06T08:45:00Z',
    createdBy: 'Demo Recruiter',
  },
  {
    id: 'job-product-designer',
    title: 'Product Designer',
    department: 'Design',
    location: 'Berlin (Hybrid)',
    employmentType: 'Full-time',
    status: 'closed',
    experienceMin: 3,
    experienceMax: null,
    description:
      'Closed role kept for reporting history. Responsible for end-to-end product design: research, flows, prototypes and polished UI in Figma.',
    requiredSkills: [
      { skill: 'Figma', minYears: 2, note: null },
      { skill: 'Prototyping', minYears: 2, note: null },
    ],
    preferredSkills: [],
    createdAt: '2026-07-02T09:00:00Z',
    updatedAt: '2026-09-30T16:10:00Z',
    createdBy: 'Demo Recruiter',
  },
];

// ---------------------------------------------------------------------------
// Candidates
// ---------------------------------------------------------------------------

export const candidates = [
  // ---- Juniors (target cohort for the example search query) ---------------
  {
    id: 'cand-ava-thompson',
    fullName: 'Ava Thompson',
    headline: 'Junior Full-Stack Developer',
    email: 'ava.thompson@example.com',
    location: 'Dublin, Ireland',
    yearsExperience: 1,
    currentCompany: 'Brightpath Software (intern → junior)',
    status: 'active',
    source: 'Inbound application',
    summary:
      'Junior developer with one year of professional experience building a customer portal in React and Node.js against PostgreSQL.',
    links: { github: 'github.com/ava-thompson-demo', portfolio: null },
    createdAt: '2026-09-12T10:20:00Z',
  },
  {
    id: 'cand-marcus-chen',
    fullName: 'Marcus Chen',
    headline: 'Junior Software Engineer',
    email: 'marcus.chen@example.com',
    location: 'Toronto, Canada',
    yearsExperience: 1,
    currentCompany: 'Northwind Labs',
    status: 'active',
    source: 'Sourced',
    summary:
      'Recent bootcamp graduate turned junior engineer; shipped a React + Express + MySQL project in production and is learning TypeScript.',
    links: { github: 'github.com/marcus-chen-demo', portfolio: 'marcuschen.example.com' },
    createdAt: '2026-09-15T13:45:00Z',
  },
  {
    id: 'cand-priya-nair',
    fullName: 'Priya Nair',
    headline: 'Junior Developer (Python / React)',
    email: 'priya.nair@example.com',
    location: 'Bengaluru, India',
    yearsExperience: 1,
    currentCompany: 'Kestrel Digital',
    status: 'active',
    source: 'Inbound application',
    summary:
      'Junior developer strong in React on the front end and Python/FastAPI on the back end; SQL through coursework and one internship project.',
    links: { github: 'github.com/priya-nair-demo', portfolio: null },
    createdAt: '2026-09-21T08:30:00Z',
  },
  {
    id: 'cand-diego-ramirez',
    fullName: 'Diego Ramírez',
    headline: 'Frontend Developer (Junior)',
    email: 'diego.ramirez@example.com',
    location: 'Madrid, Spain',
    yearsExperience: 1,
    currentCompany: 'Freelance',
    status: 'active',
    source: 'Inbound application',
    summary:
      'Junior frontend developer with several React sites for small business clients; no professional backend experience yet.',
    links: { github: 'github.com/diego-ramirez-demo', portfolio: 'diegoramirez.example.com' },
    createdAt: '2026-10-02T17:05:00Z',
  },
  {
    id: 'cand-grace-liu',
    fullName: 'Grace Liu',
    headline: 'Junior Frontend Developer',
    email: 'grace.liu@example.com',
    location: 'Vancouver, Canada',
    yearsExperience: 1,
    currentCompany: 'Cedar & Co (agency)',
    status: 'active',
    source: 'Referral',
    summary:
      'Junior React developer with TypeScript experience from agency work; has not worked with SQL databases professionally.',
    links: { github: 'github.com/grace-liu-demo', portfolio: null },
    createdAt: '2026-10-05T11:55:00Z',
  },

  // ---- Senior / mid-level --------------------------------------------------
  {
    id: 'cand-elena-petrova',
    fullName: 'Elena Petrova',
    headline: 'Senior Frontend Engineer',
    email: 'elena.petrova@example.com',
    location: 'Berlin, Germany',
    yearsExperience: 8,
    currentCompany: 'Finlight GmbH',
    status: 'active',
    source: 'Sourced',
    summary:
      'Senior frontend engineer; leads the design-system team, deep React and TypeScript experience, Next.js in production since 2021.',
    links: { github: 'github.com/elena-petrova-demo', portfolio: null },
    createdAt: '2026-08-30T09:15:00Z',
  },
  {
    id: 'cand-jordan-blake',
    fullName: 'Jordan Blake',
    headline: 'Frontend Engineer',
    email: 'jordan.blake@example.com',
    location: 'Lisbon, Portugal',
    yearsExperience: 6,
    currentCompany: 'Wavecrest Media',
    status: 'active',
    source: 'Inbound application',
    summary:
      'Product-minded frontend engineer; React and TypeScript in production, led migration to Next.js App Router, mentors two juniors.',
    links: { github: 'github.com/jordan-blake-demo', portfolio: 'jordanblake.example.com' },
    createdAt: '2026-09-03T12:00:00Z',
  },
  {
    id: 'cand-sam-okafor',
    fullName: 'Sam Okafor',
    headline: 'Backend Engineer',
    email: 'sam.okafor@example.com',
    location: 'Lagos, Nigeria',
    yearsExperience: 5,
    currentCompany: 'Payrail Systems',
    status: 'active',
    source: 'Sourced',
    summary:
      'Backend engineer focused on Node.js microservices and PostgreSQL performance; built the payments API processing 2M requests/day.',
    links: { github: 'github.com/sam-okafor-demo', portfolio: null },
    createdAt: '2026-09-10T15:40:00Z',
  },
  {
    id: 'cand-lena-fischer',
    fullName: 'Lena Fischer',
    headline: 'Software Engineer (Python)',
    email: 'lena.fischer@example.com',
    location: 'Vienna, Austria',
    yearsExperience: 4,
    currentCompany: 'Medtrack AG',
    status: 'active',
    source: 'Inbound application',
    summary:
      'Python backend engineer; FastAPI services, PostgreSQL data modeling, and a HIPAA-compliant document pipeline.',
    links: { github: 'github.com/lena-fischer-demo', portfolio: null },
    createdAt: '2026-09-25T10:10:00Z',
  },
  {
    id: 'cand-ravi-patel',
    fullName: 'Ravi Patel',
    headline: 'Full-Stack Engineer',
    email: 'ravi.patel@example.com',
    location: 'Manchester, UK',
    yearsExperience: 7,
    currentCompany: 'Orbital Retail',
    status: 'active',
    source: 'Referral',
    summary:
      'Full-stack engineer; Node.js APIs and React front ends in e-commerce, PostgreSQL and Redis in production, team lead for two years.',
    links: { github: 'github.com/ravi-patel-demo', portfolio: null },
    createdAt: '2026-09-28T14:30:00Z',
  },
  {
    id: 'cand-noah-kim',
    fullName: 'Noah Kim',
    headline: 'Data Engineer',
    email: 'noah.kim@example.com',
    location: 'Seoul, South Korea',
    yearsExperience: 3,
    currentCompany: 'Hanstream Analytics',
    status: 'active',
    source: 'Sourced',
    summary:
      'Data engineer building Airflow and dbt pipelines on BigQuery and PostgreSQL; Python and SQL are daily tools.',
    links: { github: 'github.com/noah-kim-demo', portfolio: null },
    createdAt: '2026-10-08T09:50:00Z',
  },
  {
    id: 'cand-isabella-rossi',
    fullName: 'Isabella Rossi',
    headline: 'Product Designer',
    email: 'isabella.rossi@example.com',
    location: 'Milan, Italy',
    yearsExperience: 5,
    currentCompany: 'Studio Otto',
    status: 'active',
    source: 'Inbound application',
    summary:
      'Product designer for B2B SaaS; Figma systems, prototyping and usability testing for logistics software.',
    links: { github: null, portfolio: 'isabellarossi.example.com' },
    createdAt: '2026-08-15T13:20:00Z',
  },
];

// ---------------------------------------------------------------------------
// Resumes — fictional documents with page/section references used by evidence.
// ---------------------------------------------------------------------------

export const resumes = candidates.map((c) => {
  const slug = c.id.replace('cand-', '');
  return {
    id: `res-${slug}`,
    candidateId: c.id,
    filename: `${slug}-resume.pdf`,
    mimeType: 'application/pdf',
    fileSize: 90_000 + (slug.length * 7919) % 120_000,
    pageCount: 2,
    uploadedAt: c.createdAt,
    status: 'processed',
    // Section map: stable references evidence can point to. Page numbers are
    // meaningful here because these documents are synthetic; the real upload
    // flow derives them from the PDF layer.
    sections: [
      { page: 1, section: 'Summary', text: c.summary },
      { page: 1, section: 'Skills', text: '' }, // filled below via skills
      { page: 1, section: 'Experience', text: '' },
      { page: 2, section: 'Projects', text: '' },
      { page: 2, section: 'Education', text: '' },
    ],
  };
});

export const candidateSkills = [
  // Ava Thompson
  { candidateId: 'cand-ava-thompson', skill: 'React', years: 1, level: 'working', source: 'resume' },
  { candidateId: 'cand-ava-thompson', skill: 'Node.js', years: 1, level: 'working', source: 'resume' },
  { candidateId: 'cand-ava-thompson', skill: 'PostgreSQL', years: 1, level: 'working', source: 'resume' },
  { candidateId: 'cand-ava-thompson', skill: 'JavaScript', years: 2, level: 'working', source: 'resume' },
  { candidateId: 'cand-ava-thompson', skill: 'REST APIs', years: 1, level: 'working', source: 'resume' },
  // Marcus Chen
  { candidateId: 'cand-marcus-chen', skill: 'React', years: 1, level: 'working', source: 'resume' },
  { candidateId: 'cand-marcus-chen', skill: 'Node.js', years: 1, level: 'working', source: 'resume' },
  { candidateId: 'cand-marcus-chen', skill: 'Express', years: 1, level: 'working', source: 'resume' },
  { candidateId: 'cand-marcus-chen', skill: 'MySQL', years: 1, level: 'working', source: 'resume' },
  { candidateId: 'cand-marcus-chen', skill: 'TypeScript', years: 0.5, level: 'learning', source: 'resume' },
  // Priya Nair
  { candidateId: 'cand-priya-nair', skill: 'React', years: 1, level: 'working', source: 'resume' },
  { candidateId: 'cand-priya-nair', skill: 'Python', years: 2, level: 'working', source: 'resume' },
  { candidateId: 'cand-priya-nair', skill: 'FastAPI', years: 1, level: 'working', source: 'resume' },
  { candidateId: 'cand-priya-nair', skill: 'SQL', years: 1, level: 'working', source: 'resume' },
  // Diego Ramírez
  { candidateId: 'cand-diego-ramirez', skill: 'React', years: 1, level: 'working', source: 'resume' },
  { candidateId: 'cand-diego-ramirez', skill: 'JavaScript', years: 2, level: 'working', source: 'resume' },
  { candidateId: 'cand-diego-ramirez', skill: 'HTML/CSS', years: 2, level: 'working', source: 'resume' },
  // Grace Liu
  { candidateId: 'cand-grace-liu', skill: 'React', years: 1, level: 'working', source: 'resume' },
  { candidateId: 'cand-grace-liu', skill: 'TypeScript', years: 1, level: 'working', source: 'resume' },
  { candidateId: 'cand-grace-liu', skill: 'JavaScript', years: 2, level: 'working', source: 'resume' },
  { candidateId: 'cand-grace-liu', skill: 'CSS', years: 2, level: 'working', source: 'resume' },
  // Elena Petrova
  { candidateId: 'cand-elena-petrova', skill: 'React', years: 7, level: 'expert', source: 'resume' },
  { candidateId: 'cand-elena-petrova', skill: 'TypeScript', years: 6, level: 'expert', source: 'resume' },
  { candidateId: 'cand-elena-petrova', skill: 'Next.js', years: 4, level: 'advanced', source: 'resume' },
  { candidateId: 'cand-elena-petrova', skill: 'Design Systems', years: 3, level: 'advanced', source: 'resume' },
  { candidateId: 'cand-elena-petrova', skill: 'Testing', years: 5, level: 'advanced', source: 'resume' },
  // Jordan Blake
  { candidateId: 'cand-jordan-blake', skill: 'React', years: 6, level: 'advanced', source: 'resume' },
  { candidateId: 'cand-jordan-blake', skill: 'TypeScript', years: 4, level: 'advanced', source: 'resume' },
  { candidateId: 'cand-jordan-blake', skill: 'Next.js', years: 3, level: 'advanced', source: 'resume' },
  { candidateId: 'cand-jordan-blake', skill: 'Testing', years: 3, level: 'working', source: 'resume' },
  // Sam Okafor
  { candidateId: 'cand-sam-okafor', skill: 'Node.js', years: 5, level: 'expert', source: 'resume' },
  { candidateId: 'cand-sam-okafor', skill: 'PostgreSQL', years: 4, level: 'advanced', source: 'resume' },
  { candidateId: 'cand-sam-okafor', skill: 'REST APIs', years: 5, level: 'advanced', source: 'resume' },
  { candidateId: 'cand-sam-okafor', skill: 'Kafka', years: 2, level: 'working', source: 'resume' },
  { candidateId: 'cand-sam-okafor', skill: 'Docker', years: 3, level: 'working', source: 'resume' },
  // Lena Fischer
  { candidateId: 'cand-lena-fischer', skill: 'Python', years: 4, level: 'advanced', source: 'resume' },
  { candidateId: 'cand-lena-fischer', skill: 'FastAPI', years: 3, level: 'advanced', source: 'resume' },
  { candidateId: 'cand-lena-fischer', skill: 'PostgreSQL', years: 3, level: 'working', source: 'resume' },
  { candidateId: 'cand-lena-fischer', skill: 'SQL', years: 4, level: 'advanced', source: 'resume' },
  // Ravi Patel
  { candidateId: 'cand-ravi-patel', skill: 'Node.js', years: 6, level: 'advanced', source: 'resume' },
  { candidateId: 'cand-ravi-patel', skill: 'React', years: 5, level: 'advanced', source: 'resume' },
  { candidateId: 'cand-ravi-patel', skill: 'PostgreSQL', years: 5, level: 'advanced', source: 'resume' },
  { candidateId: 'cand-ravi-patel', skill: 'Redis', years: 3, level: 'working', source: 'resume' },
  // Noah Kim
  { candidateId: 'cand-noah-kim', skill: 'Python', years: 3, level: 'advanced', source: 'resume' },
  { candidateId: 'cand-noah-kim', skill: 'SQL', years: 3, level: 'advanced', source: 'resume' },
  { candidateId: 'cand-noah-kim', skill: 'Airflow', years: 2, level: 'working', source: 'resume' },
  { candidateId: 'cand-noah-kim', skill: 'dbt', years: 2, level: 'working', source: 'resume' },
  // Isabella Rossi
  { candidateId: 'cand-isabella-rossi', skill: 'Figma', years: 5, level: 'expert', source: 'resume' },
  { candidateId: 'cand-isabella-rossi', skill: 'Prototyping', years: 4, level: 'advanced', source: 'resume' },
  { candidateId: 'cand-isabella-rossi', skill: 'User Research', years: 3, level: 'working', source: 'resume' },
];

// ---------------------------------------------------------------------------
// Experience / education / projects
// ---------------------------------------------------------------------------

export const experiences = [
  {
    candidateId: 'cand-ava-thompson',
    company: 'Brightpath Software',
    title: 'Junior Full-Stack Developer',
    start: '2025-07',
    end: null,
    location: 'Dublin (hybrid)',
    summary:
      'Part of a four-person team building the Brightpath customer portal. Built React UI components, implemented Node.js/Express endpoints, and wrote PostgreSQL queries for reporting screens.',
    highlights: [
      'Built 15+ React screens for the customer portal used by 3,000 monthly users',
      'Implemented Node.js (Express) REST endpoints for account management and wrote the PostgreSQL queries behind them',
      'Fixed 40+ bugs in the legacy jQuery dashboard while migrating it to React',
    ],
  },
  {
    candidateId: 'cand-ava-thompson',
    company: 'Brightpath Software',
    title: 'Software Engineering Intern',
    start: '2025-01',
    end: '2025-06',
    location: 'Dublin (hybrid)',
    summary: 'Internship converting manual reporting spreadsheets into a small React + Node internal tool.',
    highlights: ['Shipped an internal React dashboard adopted by the support team'],
  },
  {
    candidateId: 'cand-marcus-chen',
    company: 'Northwind Labs',
    title: 'Junior Software Engineer',
    start: '2025-08',
    end: null,
    location: 'Toronto (remote)',
    summary:
      'Maintains the customer onboarding service. Day-to-day work is Express (Node.js) APIs, MySQL schema changes, and React forms.',
    highlights: [
      'Built Express REST endpoints and MySQL migrations for the onboarding wizard',
      'Built React forms with client-side validation used by 200+ new customers per month',
      'Rewrote a slow MySQL report query, cutting generation time from 9s to under 1s',
    ],
  },
  {
    candidateId: 'cand-marcus-chen',
    company: 'Scalar Bootcamp',
    title: 'Teaching Assistant (part-time)',
    start: '2024-10',
    end: '2025-07',
    location: 'Toronto',
    summary: 'TA for the web development cohort; reviewed student JavaScript and React assignments.',
    highlights: [],
  },
  {
    candidateId: 'cand-priya-nair',
    company: 'Kestrel Digital',
    title: 'Junior Developer',
    start: '2025-09',
    end: null,
    location: 'Bengaluru',
    summary:
      'Works across the stack on client projects: React front ends and Python (FastAPI) services; SQL for reporting and fixtures.',
    highlights: [
      'Built a React admin console for a logistics client with 30+ components',
      'Developed FastAPI endpoints for inventory sync and wrote the PostgreSQL integration tests',
    ],
  },
  {
    candidateId: 'cand-priya-nair',
    company: 'Kestrel Digital',
    title: 'Backend Intern (Python)',
    start: '2025-03',
    end: '2025-08',
    location: 'Bengaluru',
    summary: 'Internship on the Python services team; automated data cleanup scripts.',
    highlights: [],
  },
  {
    candidateId: 'cand-diego-ramirez',
    company: 'Freelance',
    title: 'Frontend Developer',
    start: '2024-11',
    end: null,
    location: 'Madrid',
    summary:
      'Freelance React work for small businesses: marketing sites and booking widgets. All projects are frontend-only; backend work was out of scope.',
    highlights: [
      'Delivered 6 React sites for local businesses, each Lighthouse performance score 90+',
      'Built a reusable booking-widget React component package used by 4 clients',
    ],
  },
  {
    candidateId: 'cand-grace-liu',
    company: 'Cedar & Co (agency)',
    title: 'Junior Frontend Developer',
    start: '2025-06',
    end: null,
    location: 'Vancouver',
    summary:
      'Agency frontend work in React + TypeScript across three client projects. Databases are handled by the backend team.',
    highlights: [
      'Built typed React component libraries for two agency clients',
      'Migrated a legacy jQuery site to React with zero regression reports in QA',
    ],
  },
  {
    candidateId: 'cand-elena-petrova',
    company: 'Finlight GmbH',
    title: 'Senior Frontend Engineer',
    start: '2022-03',
    end: null,
    location: 'Berlin',
    summary:
      'Tech lead for the trading dashboard (React + TypeScript + Next.js). Owns the design system and the component testing strategy.',
    highlights: [
      'Led the migration of a 400k-LOC Angular app to Next.js App Router over 14 months',
      'Designed and maintains the Finlight design system (48 components, 95% test coverage with Jest and Playwright)',
      'Mentors 3 engineers; runs the frontend guild',
    ],
  },
  {
    candidateId: 'cand-elena-petrova',
    company: 'Commerce One',
    title: 'Frontend Engineer',
    start: '2018-06',
    end: '2022-02',
    location: 'Hamburg',
    summary: 'React development for the e-commerce storefront; introduced TypeScript to the codebase in 2020.',
    highlights: [],
  },
  {
    candidateId: 'cand-jordan-blake',
    company: 'Wavecrest Media',
    title: 'Frontend Engineer',
    start: '2021-02',
    end: null,
    location: 'Lisbon (remote)',
    summary:
      'Frontend lead for the publisher analytics product. React and TypeScript, moved the app to Next.js App Router, introduced testing culture.',
    highlights: [
      'Led the Next.js App Router migration and cut p75 page load from 4.1s to 1.8s',
      'Introduced Playwright end-to-end tests to the release process',
      'Mentors two junior developers',
    ],
  },
  {
    candidateId: 'cand-sam-okafor',
    company: 'Payrail Systems',
    title: 'Backend Engineer',
    start: '2022-05',
    end: null,
    location: 'Lagos (remote)',
    summary:
      'Owns core Node.js payment services. PostgreSQL schema design, query optimization, Kafka event flows and Docker-based deploys.',
    highlights: [
      'Built the Node.js payments API handling ~2M requests/day at p99 under 120ms',
      'Redesigned PostgreSQL indexing for the ledger table, reducing report queries from 30s to 400ms',
      'Introduced Kafka-based event publishing between billing and notifications services',
    ],
  },
  {
    candidateId: 'cand-sam-okafor',
    company: 'Softgear',
    title: 'Software Engineer',
    start: '2021-01',
    end: '2022-04',
    location: 'Lagos',
    summary: 'REST APIs in Node.js for inventory and shipping integrations.',
    highlights: [],
  },
  {
    candidateId: 'cand-lena-fischer',
    company: 'Medtrack AG',
    title: 'Software Engineer',
    start: '2022-09',
    end: null,
    location: 'Vienna',
    summary:
      'Python backend for clinical document processing: FastAPI services, PostgreSQL modeling, and a document ingestion pipeline.',
    highlights: [
      'Built the FastAPI ingestion service processing 50k clinical documents per day',
      'Modeled the PostgreSQL schema for versioned clinical records with full audit history',
      'Wrote the pipeline that extracts structured data from scanned referrals (Python, Tesseract)',
    ],
  },
  {
    candidateId: 'cand-ravi-patel',
    company: 'Orbital Retail',
    title: 'Full-Stack Engineer / Team Lead',
    start: '2024-01',
    end: null,
    location: 'Manchester',
    summary:
      'Leads a team of five on the storefront platform: Node.js APIs, React front end, PostgreSQL and Redis.',
    highlights: [
      'Led the checkout re-architecture (Node.js + PostgreSQL), improving conversion 7%',
      'Introduced Redis caching for the catalog API, cutting database load 60%',
    ],
  },
  {
    candidateId: 'cand-noah-kim',
    company: 'Hanstream Analytics',
    title: 'Data Engineer',
    start: '2023-07',
    end: null,
    location: 'Seoul',
    summary:
      'Builds Airflow DAGs and dbt models feeding the analytics warehouse; heavy SQL and Python work daily.',
    highlights: [
      'Maintains 60+ Airflow DAGs for ingestion from 12 source systems',
      'Wrote the dbt models behind the executive revenue dashboard',
      'Tuned warehouse SQL queries saving ~$4k/month in compute',
    ],
  },
  {
    candidateId: 'cand-isabella-rossi',
    company: 'Studio Otto',
    title: 'Senior Product Designer',
    start: '2022-01',
    end: null,
    location: 'Milan',
    summary:
      'End-to-end product design for logistics SaaS clients: research, flows, high-fidelity Figma prototypes, usability testing.',
    highlights: [
      'Redesigned the fleet-dispatch console; task completion time dropped 35% in usability tests',
      'Built and documented the Studio Otto Figma component library',
    ],
  },
];

export const education = [
  { candidateId: 'cand-ava-thompson', degree: 'BSc Computer Science', school: 'Trinity College Dublin', year: '2025' },
  { candidateId: 'cand-marcus-chen', degree: 'Web Development Bootcamp Certificate', school: 'Scalar Bootcamp', year: '2024' },
  { candidateId: 'cand-priya-nair', degree: 'B.E. Information Science', school: 'VTU', year: '2025' },
  { candidateId: 'cand-diego-ramirez', degree: 'Frontend Certificate', school: 'Ironhack Madrid', year: '2024' },
  { candidateId: 'cand-grace-liu', degree: 'Diploma, Full-Stack Web Development', school: 'BCIT', year: '2025' },
  { candidateId: 'cand-elena-petrova', degree: 'MSc Computer Science', school: 'TU Berlin', year: '2018' },
  { candidateId: 'cand-jordan-blake', degree: 'BSc Software Engineering', school: 'Univ. of Lisbon', year: '2020' },
  { candidateId: 'cand-sam-okafor', degree: 'BSc Computer Engineering', school: 'University of Lagos', year: '2020' },
  { candidateId: 'cand-lena-fischer', degree: 'MSc Computer Science', school: 'TU Wien', year: '2022' },
  { candidateId: 'cand-ravi-patel', degree: 'BSc Computer Science', school: 'University of Manchester', year: '2019' },
  { candidateId: 'cand-noah-kim', degree: 'BSc Statistics', school: 'Seoul National University', year: '2023' },
  { candidateId: 'cand-isabella-rossi', degree: 'BA Interaction Design', school: 'Politecnico di Milano', year: '2021' },
];

export const projects = [
  {
    candidateId: 'cand-ava-thompson',
    name: 'Flatmate Expense Splitter',
    summary: 'Full-stack side project: React front end, Node.js/Express API, PostgreSQL storage.',
    tech: ['React', 'Node.js', 'PostgreSQL'],
    link: 'github.com/ava-thompson-demo/expense-splitter',
  },
  {
    candidateId: 'cand-marcus-chen',
    name: 'GymTrack',
    summary: 'React + Express + MySQL workout tracker with JWT auth; deployed on a $5 VPS.',
    tech: ['React', 'Express', 'MySQL'],
    link: 'github.com/marcus-chen-demo/gymtrack',
  },
  {
    candidateId: 'cand-marcus-chen',
    name: 'TypeScript Practice Repo',
    summary: 'Ongoing repo of TypeScript exercises as he migrates projects from JavaScript to TypeScript.',
    tech: ['TypeScript'],
    link: 'github.com/marcus-chen-demo/ts-practice',
  },
  {
    candidateId: 'cand-priya-nair',
    name: 'Library Slot Booker',
    summary: 'React front end with a FastAPI backend and SQL storage for a campus library.',
    tech: ['React', 'FastAPI', 'SQL'],
    link: 'github.com/priya-nair-demo/library-scraper',
  },
  {
    candidateId: 'cand-diego-ramirez',
    name: 'Booking Widgets',
    summary: 'Open-source React booking widget; no backend component (integrates with third-party forms).',
    tech: ['React', 'JavaScript'],
    link: 'github.com/diego-ramirez-demo/booking-widget',
  },
  {
    candidateId: 'cand-grace-liu',
    name: 'Design-Tokens CLI',
    summary: 'Small TypeScript CLI that syncs design tokens from Figma to CSS variables.',
    tech: ['TypeScript', 'Node.js (CLI only)'],
    link: 'github.com/grace-liu-demo/tokens-cli',
  },
  {
    candidateId: 'cand-elena-petrova',
    name: 'DS Workshop Materials',
    summary: 'Public workshop on design-system architecture in Next.js and TypeScript.',
    tech: ['Next.js', 'TypeScript'],
    link: 'github.com/elena-petrova-demo/ds-workshop',
  },
  {
    candidateId: 'cand-sam-okafor',
    name: 'pg-audit-trail',
    summary: 'Node.js library that adds audit-trail tables and triggers to PostgreSQL schemas.',
    tech: ['Node.js', 'PostgreSQL'],
    link: 'github.com/sam-okafor-demo/pg-audit-trail',
  },
];

// ---------------------------------------------------------------------------
// Evidence records — each ties a skill to a source excerpt with a location.
// ---------------------------------------------------------------------------

export const evidence = [
  // Ava — strong on all three required skills of the junior job
  makeEvidence('ev-ava-1', 'cand-ava-thompson', 'React', {
    excerpt: 'Built 15+ React screens for the customer portal used by 3,000 monthly users',
    location: { page: 1, section: 'Experience — Brightpath Software' },
    status: 'supporting',
  }),
  makeEvidence('ev-ava-2', 'cand-ava-thompson', 'Node.js', {
    excerpt: 'Implemented Node.js (Express) REST endpoints for account management and wrote the PostgreSQL queries behind them',
    location: { page: 1, section: 'Experience — Brightpath Software' },
    status: 'supporting',
  }),
  makeEvidence('ev-ava-3', 'cand-ava-thompson', 'SQL', {
    excerpt: 'Implemented Node.js (Express) REST endpoints for account management and wrote the PostgreSQL queries behind them',
    location: { page: 1, section: 'Experience — Brightpath Software' },
    status: 'supporting',
  }),
  makeEvidence('ev-ava-4', 'cand-ava-thompson', 'SQL', {
    sourceType: 'resume',
    excerpt: 'Flatmate Expense Splitter: full-stack side project: React front end, Node.js/Express API, PostgreSQL storage.',
    location: { page: 2, section: 'Projects' },
    status: 'supporting',
    createdAt: '2026-09-12T10:25:00Z',
  }),
  makeEvidence('ev-ava-5', 'cand-ava-thompson', 'TypeScript', {
    excerpt: 'Skills list mentions "TypeScript (basic)" but no project or role description shows TypeScript work.',
    location: { page: 1, section: 'Skills' },
    status: 'claimed',
    notes: 'Listed under skills with "(basic)" qualifier; no corroborating experience entry.',
  }),

  // Marcus
  makeEvidence('ev-marcus-1', 'cand-marcus-chen', 'React', {
    excerpt: 'Built React forms with client-side validation used by 200+ new customers per month',
    location: { page: 1, section: 'Experience — Northwind Labs' },
    status: 'supporting',
  }),
  makeEvidence('ev-marcus-2', 'cand-marcus-chen', 'Node.js', {
    excerpt: 'Built Express REST endpoints and MySQL migrations for the onboarding wizard',
    location: { page: 1, section: 'Experience — Northwind Labs' },
    status: 'supporting',
  }),
  makeEvidence('ev-marcus-3', 'cand-marcus-chen', 'SQL', {
    excerpt: 'Rewrote a slow MySQL report query, cutting generation time from 9s to under 1s',
    location: { page: 1, section: 'Experience — Northwind Labs' },
    status: 'supporting',
  }),
  makeEvidence('ev-marcus-4', 'cand-marcus-chen', 'TypeScript', {
    excerpt: 'TypeScript Practice Repo: ongoing repo of TypeScript exercises as he migrates projects from JavaScript to TypeScript.',
    location: { page: 2, section: 'Projects' },
    status: 'needs_review',
    notes: 'Learning-level evidence only — practice repo, no production TypeScript. Recruiter to confirm level.',
  }),

  // Priya — React yes; Node.js is claimed-but-conflicting (her backend is Python)
  makeEvidence('ev-priya-1', 'cand-priya-nair', 'React', {
    excerpt: 'Built a React admin console for a logistics client with 30+ components',
    location: { page: 1, section: 'Experience — Kestrel Digital' },
    status: 'supporting',
  }),
  makeEvidence('ev-priya-2', 'cand-priya-nair', 'Node.js', {
    excerpt: 'Developed FastAPI endpoints for inventory sync and wrote the PostgreSQL integration tests',
    location: { page: 1, section: 'Experience — Kestrel Digital' },
    status: 'needs_review',
    notes: 'Resume lists "Node.js (familiar)" in skills, but all described backend work is Python/FastAPI. Ask in screening.',
  }),
  makeEvidence('ev-priya-3', 'cand-priya-nair', 'SQL', {
    excerpt: 'Developed FastAPI endpoints for inventory sync and wrote the PostgreSQL integration tests',
    location: { page: 1, section: 'Experience — Kestrel Digital' },
    status: 'supporting',
  }),

  // Diego — frontend only
  makeEvidence('ev-diego-1', 'cand-diego-ramirez', 'React', {
    excerpt: 'Delivered 6 React sites for local businesses, each Lighthouse performance score 90+',
    location: { page: 1, section: 'Experience — Freelance' },
    status: 'supporting',
  }),
  makeEvidence('ev-diego-2', 'cand-diego-ramirez', 'Node.js', {
    excerpt: 'Not found: resume describes only frontend work ("All projects are frontend-only; backend work was out of scope").',
    location: null,
    status: 'not_established',
    notes: 'Absence is not evidence of inability — recommend asking about side projects in screening.',
  }),
  makeEvidence('ev-diego-3', 'cand-diego-ramirez', 'SQL', {
    excerpt: 'Not found: no SQL, database or data-storage mention anywhere in the resume.',
    location: null,
    status: 'not_established',
  }),

  // Grace
  makeEvidence('ev-grace-1', 'cand-grace-liu', 'React', {
    excerpt: 'Built typed React component libraries for two agency clients',
    location: { page: 1, section: 'Experience — Cedar & Co' },
    status: 'supporting',
  }),
  makeEvidence('ev-grace-2', 'cand-grace-liu', 'TypeScript', {
    excerpt: 'Built typed React component libraries for two agency clients',
    location: { page: 1, section: 'Experience — Cedar & Co' },
    status: 'supporting',
  }),
  makeEvidence('ev-grace-3', 'cand-grace-liu', 'SQL', {
    excerpt: 'Not found: profile states "Databases are handled by the backend team"; no SQL evidence.',
    location: null,
    status: 'not_established',
  }),

  // Elena
  makeEvidence('ev-elena-1', 'cand-elena-petrova', 'React', {
    excerpt: 'Led the migration of a 400k-LOC Angular app to Next.js App Router over 14 months',
    location: { page: 1, section: 'Experience — Finlight GmbH' },
    status: 'supporting',
  }),
  makeEvidence('ev-elena-2', 'cand-elena-petrova', 'TypeScript', {
    excerpt: 'Designed and maintains the Finlight design system (48 components, 95% test coverage with Jest and Playwright)',
    location: { page: 1, section: 'Experience — Finlight GmbH' },
    status: 'supporting',
  }),
  makeEvidence('ev-elena-3', 'cand-elena-petrova', 'Next.js', {
    excerpt: 'Led the migration of a 400k-LOC Angular app to Next.js App Router over 14 months',
    location: { page: 1, section: 'Experience — Finlight GmbH' },
    status: 'supporting',
  }),
  makeEvidence('ev-elena-4', 'cand-elena-petrova', 'Design Systems', {
    excerpt: 'Designed and maintains the Finlight design system (48 components, 95% test coverage with Jest and Playwright)',
    location: { page: 1, section: 'Experience — Finlight GmbH' },
    status: 'supporting',
  }),

  // Jordan
  makeEvidence('ev-jordan-1', 'cand-jordan-blake', 'React', {
    excerpt: 'Frontend lead for the publisher analytics product. React and TypeScript, moved the app to Next.js App Router',
    location: { page: 1, section: 'Experience — Wavecrest Media' },
    status: 'supporting',
  }),
  makeEvidence('ev-jordan-2', 'cand-jordan-blake', 'Next.js', {
    excerpt: 'Led the Next.js App Router migration and cut p75 page load from 4.1s to 1.8s',
    location: { page: 1, section: 'Experience — Wavecrest Media' },
    status: 'supporting',
  }),
  makeEvidence('ev-jordan-3', 'cand-jordan-blake', 'Testing', {
    excerpt: 'Introduced Playwright end-to-end tests to the release process',
    location: { page: 1, section: 'Experience — Wavecrest Media' },
    status: 'supporting',
  }),

  // Sam
  makeEvidence('ev-sam-1', 'cand-sam-okafor', 'Node.js', {
    excerpt: 'Built the Node.js payments API handling ~2M requests/day at p99 under 120ms',
    location: { page: 1, section: 'Experience — Payrail Systems' },
    status: 'supporting',
  }),
  makeEvidence('ev-sam-2', 'cand-sam-okafor', 'PostgreSQL', {
    excerpt: 'Redesigned PostgreSQL indexing for the ledger table, reducing report queries from 30s to 400ms',
    location: { page: 1, section: 'Experience — Payrail Systems' },
    status: 'supporting',
  }),
  makeEvidence('ev-sam-3', 'cand-sam-okafor', 'REST APIs', {
    excerpt: 'Built the Node.js payments API handling ~2M requests/day at p99 under 120ms',
    location: { page: 1, section: 'Experience — Payrail Systems' },
    status: 'supporting',
  }),
  makeEvidence('ev-sam-4', 'cand-sam-okafor', 'Kafka', {
    excerpt: 'Introduced Kafka-based event publishing between billing and notifications services',
    location: { page: 1, section: 'Experience — Payrail Systems' },
    status: 'supporting',
  }),

  // Lena
  makeEvidence('ev-lena-1', 'cand-lena-fischer', 'Python', {
    excerpt: 'Built the FastAPI ingestion service processing 50k clinical documents per day',
    location: { page: 1, section: 'Experience — Medtrack AG' },
    status: 'supporting',
  }),
  makeEvidence('ev-lena-2', 'cand-lena-fischer', 'SQL', {
    excerpt: 'Modeled the PostgreSQL schema for versioned clinical records with full audit history',
    location: { page: 1, section: 'Experience — Medtrack AG' },
    status: 'supporting',
  }),
  makeEvidence('ev-lena-3', 'cand-lena-fischer', 'Node.js', {
    excerpt: 'Skills list includes "Node.js (side projects)" but no professional Node.js work is described.',
    location: { page: 1, section: 'Skills' },
    status: 'claimed',
  }),

  // Ravi
  makeEvidence('ev-ravi-1', 'cand-ravi-patel', 'Node.js', {
    excerpt: 'Led the checkout re-architecture (Node.js + PostgreSQL), improving conversion 7%',
    location: { page: 1, section: 'Experience — Orbital Retail' },
    status: 'supporting',
  }),
  makeEvidence('ev-ravi-2', 'cand-ravi-patel', 'PostgreSQL', {
    excerpt: 'Introduced Redis caching for the catalog API, cutting database load 60%',
    location: { page: 1, section: 'Experience — Orbital Retail' },
    status: 'supporting',
  }),
  makeEvidence('ev-ravi-3', 'cand-ravi-patel', 'React', {
    excerpt: 'Leads a team of five on the storefront platform: Node.js APIs, React front end, PostgreSQL and Redis.',
    location: { page: 1, section: 'Experience — Orbital Retail' },
    status: 'supporting',
  }),

  // Noah
  makeEvidence('ev-noah-1', 'cand-noah-kim', 'Python', {
    excerpt: 'Maintains 60+ Airflow DAGs for ingestion from 12 source systems',
    location: { page: 1, section: 'Experience — Hanstream Analytics' },
    status: 'supporting',
  }),
  makeEvidence('ev-noah-2', 'cand-noah-kim', 'SQL', {
    excerpt: 'Tuned warehouse SQL queries saving ~$4k/month in compute',
    location: { page: 1, section: 'Experience — Hanstream Analytics' },
    status: 'supporting',
  }),

  // Isabella
  makeEvidence('ev-isabella-1', 'cand-isabella-rossi', 'Figma', {
    excerpt: 'Built and documented the Studio Otto Figma component library',
    location: { page: 1, section: 'Experience — Studio Otto' },
    status: 'supporting',
  }),
  makeEvidence('ev-isabella-2', 'cand-isabella-rossi', 'Prototyping', {
    excerpt: 'Redesigned the fleet-dispatch console; task completion time dropped 35% in usability tests',
    location: { page: 1, section: 'Experience — Studio Otto' },
    status: 'supporting',
  }),
];

// ---------------------------------------------------------------------------
// Assessments + submissions
// ---------------------------------------------------------------------------

export const assessments = [
  {
    id: 'asmt-js-data-01',
    title: 'JavaScript Data Processing Challenge',
    skill: 'JavaScript',
    difficulty: 'medium',
    status: 'published',
    timeLimitMinutes: 45,
    description:
      'Implement a small data-processing module used by our reporting pipeline. Tests are described in the task; in this demo build, submissions receive static checks only and are queued for human review.',
    instructions:
      'Write a function `summarizeOrders(orders)` that takes an array of order objects `{ id, customer, total, status }` and returns `{ totalCount, completedCount, revenueByCustomer }` where `revenueByCustomer` maps customer name to the sum of totals of COMPLETED orders only. Handle an empty array and ignore orders without a numeric total.',
    testCases: [
      { name: 'returns zeroed summary for empty array', input: '[]', expected: '{ totalCount: 0, completedCount: 0, revenueByCustomer: {} }' },
      { name: 'counts only completed orders in revenue', input: '[{total: 10, status: "completed"}, {total: 5, status: "cancelled"}]', expected: 'revenueByCustomer only includes the completed total' },
      { name: 'ignores orders with non-numeric totals', input: '[{total: "12", status: "completed"}]', expected: 'order ignored' },
    ],
    executionMode: 'static_checks', // never executes candidate code in this build
    createdAt: '2026-09-14T10:00:00Z',
  },
  {
    id: 'asmt-sql-01',
    title: 'SQL Query Fundamentals',
    skill: 'SQL',
    difficulty: 'easy',
    status: 'published',
    timeLimitMinutes: 30,
    description:
      'Five short SQL questions against a small e-commerce schema (customers, orders, order_items). Scored by human review in this build; the schema and expected results are attached to each question.',
    instructions:
      'Answer the five questions in the attached document. Each question shows the schema of the tables involved and the expected result shape.',
    testCases: [],
    executionMode: 'manual_review',
    createdAt: '2026-09-20T10:00:00Z',
  },
  {
    id: 'asmt-react-01',
    title: 'React Component Design Review',
    skill: 'React',
    difficulty: 'medium',
    status: 'draft',
    timeLimitMinutes: 60,
    description:
      'Candidate reviews a deliberately imperfect React component and proposes an improved version plus a short written rationale. Draft — not yet published.',
    instructions: 'Download the sample component, refactor it, and explain your changes in up to 300 words.',
    testCases: [],
    executionMode: 'manual_review',
    createdAt: '2026-10-12T10:00:00Z',
  },
];

export const assessmentSubmissions = [
  {
    id: 'sub-001',
    assessmentId: 'asmt-js-data-01',
    candidateId: 'cand-ava-thompson',
    submittedAt: '2026-09-16T14:20:00Z',
    status: 'completed',
    score: 82,
    executionMode: 'demo_data', // seeded result — represents what a secure runner would produce
    result: {
      staticChecks: { passed: ['handles empty array', 'filters by status'], warnings: ['no input type guard'] },
      testCaseResults: [
        { name: 'returns zeroed summary for empty array', passed: true },
        { name: 'counts only completed orders in revenue', passed: true },
        { name: 'ignores orders with non-numeric totals', passed: false },
      ],
      reviewerNote: null,
    },
  },
  {
    id: 'sub-002',
    assessmentId: 'asmt-js-data-01',
    candidateId: 'cand-marcus-chen',
    submittedAt: '2026-09-18T09:05:00Z',
    status: 'completed',
    score: 74,
    executionMode: 'demo_data',
    result: {
      staticChecks: { passed: ['handles empty array'], warnings: ['uses implicit any-like patterns'] },
      testCaseResults: [
        { name: 'returns zeroed summary for empty array', passed: true },
        { name: 'counts only completed orders in revenue', passed: false },
        { name: 'ignores orders with non-numeric totals', passed: true },
      ],
      reviewerNote: null,
    },
  },
  {
    id: 'sub-003',
    assessmentId: 'asmt-sql-01',
    candidateId: 'cand-sam-okafor',
    submittedAt: '2026-09-24T11:40:00Z',
    status: 'completed',
    score: 95,
    executionMode: 'demo_data',
    result: {
      staticChecks: { passed: ['all five questions attempted', 'correct use of window function in Q4'], warnings: [] },
      testCaseResults: [],
      reviewerNote: 'Strong fundamentals; Q5 acceptable alternative solution.',
    },
  },
  {
    id: 'sub-004',
    assessmentId: 'asmt-sql-01',
    candidateId: 'cand-lena-fischer',
    submittedAt: '2026-09-26T16:10:00Z',
    status: 'manual_review',
    score: null,
    executionMode: 'manual_review',
    result: {
      staticChecks: { passed: ['all five questions attempted'], warnings: ['Q2 result shape deviates from spec'] },
      testCaseResults: [],
      reviewerNote: null,
    },
  },
  {
    id: 'sub-005',
    assessmentId: 'asmt-js-data-01',
    candidateId: 'cand-grace-liu',
    submittedAt: '2026-10-06T10:30:00Z',
    status: 'manual_review',
    score: null,
    executionMode: 'static_checks',
    result: {
      staticChecks: { passed: ['handles empty array', 'numeric type guard present'], warnings: ['status filter case-sensitive'] },
      testCaseResults: [],
      reviewerNote: null,
    },
  },
];

// ---------------------------------------------------------------------------
// Applications (funnel), search events, audit log
// ---------------------------------------------------------------------------

export const applications = [
  { id: 'app-001', candidateId: 'cand-elena-petrova', jobId: 'job-senior-frontend', stage: 'interview', createdAt: '2026-09-02T09:00:00Z', updatedAt: '2026-10-15T10:00:00Z' },
  { id: 'app-002', candidateId: 'cand-jordan-blake', jobId: 'job-senior-frontend', stage: 'screening', createdAt: '2026-09-05T09:00:00Z', updatedAt: '2026-10-12T10:00:00Z' },
  { id: 'app-003', candidateId: 'cand-sam-okafor', jobId: 'job-backend-node', stage: 'interview', createdAt: '2026-09-11T09:00:00Z', updatedAt: '2026-10-16T10:00:00Z' },
  { id: 'app-004', candidateId: 'cand-ravi-patel', jobId: 'job-backend-node', stage: 'applied', createdAt: '2026-09-29T09:00:00Z', updatedAt: '2026-09-29T09:00:00Z' },
  { id: 'app-005', candidateId: 'cand-ava-thompson', jobId: 'job-junior-fullstack', stage: 'assessment', createdAt: '2026-09-13T09:00:00Z', updatedAt: '2026-10-10T10:00:00Z' },
  { id: 'app-006', candidateId: 'cand-marcus-chen', jobId: 'job-junior-fullstack', stage: 'assessment', createdAt: '2026-09-16T09:00:00Z', updatedAt: '2026-10-10T10:00:00Z' },
  { id: 'app-007', candidateId: 'cand-priya-nair', jobId: 'job-junior-fullstack', stage: 'screening', createdAt: '2026-09-22T09:00:00Z', updatedAt: '2026-10-08T10:00:00Z' },
  { id: 'app-008', candidateId: 'cand-diego-ramirez', jobId: 'job-junior-fullstack', stage: 'applied', createdAt: '2026-10-03T09:00:00Z', updatedAt: '2026-10-03T09:00:00Z' },
  { id: 'app-009', candidateId: 'cand-grace-liu', jobId: 'job-junior-fullstack', stage: 'screening', createdAt: '2026-10-06T09:00:00Z', updatedAt: '2026-10-14T10:00:00Z' },
  { id: 'app-010', candidateId: 'cand-lena-fischer', jobId: 'job-backend-node', stage: 'applied', createdAt: '2026-09-26T09:00:00Z', updatedAt: '2026-09-26T09:00:00Z' },
  { id: 'app-011', candidateId: 'cand-noah-kim', jobId: 'job-data-engineer', stage: 'applied', createdAt: '2026-10-09T09:00:00Z', updatedAt: '2026-10-09T09:00:00Z' },
  { id: 'app-012', candidateId: 'cand-isabella-rossi', jobId: 'job-product-designer', stage: 'hired', createdAt: '2026-08-16T09:00:00Z', updatedAt: '2026-09-28T10:00:00Z' },
];

export const searchEvents = [
  { id: 'se-001', query: 'junior developers with React, Node.js and SQL experience', mode: 'keyword', resultCount: 5, createdAt: '2026-10-13T10:12:00Z' },
  { id: 'se-002', query: 'senior React TypeScript Next.js mentor', mode: 'keyword', resultCount: 3, createdAt: '2026-10-14T15:44:00Z' },
  { id: 'se-003', query: 'backend engineer with PostgreSQL performance experience', mode: 'keyword', resultCount: 4, createdAt: '2026-10-15T09:03:00Z' },
  { id: 'se-004', query: 'data engineer Python SQL Airflow', mode: 'keyword', resultCount: 2, createdAt: '2026-10-19T14:27:00Z' },
];

export const auditLogs = [
  { id: 'audit-001', actor: 'Demo Recruiter', action: 'job.create', entityType: 'job', entityId: 'job-junior-fullstack', createdAt: '2026-09-08T09:12:00Z', metadata: { title: 'Junior Full-Stack Developer' } },
  { id: 'audit-002', actor: 'Demo Recruiter', action: 'resume.upload', entityType: 'candidate', entityId: 'cand-ava-thompson', createdAt: '2026-09-12T10:20:00Z', metadata: { filename: 'ava-thompson-resume.pdf' } },
  { id: 'audit-003', actor: 'Demo Recruiter', action: 'assessment.create', entityType: 'assessment', entityId: 'asmt-js-data-01', createdAt: '2026-09-14T10:00:00Z', metadata: { title: 'JavaScript Data Processing Challenge' } },
  { id: 'audit-004', actor: 'Demo Recruiter', action: 'job.status_change', entityType: 'job', entityId: 'job-product-designer', createdAt: '2026-09-30T16:10:00Z', metadata: { from: 'open', to: 'closed' } },
  { id: 'audit-005', actor: 'Demo Recruiter', action: 'evidence.review', entityType: 'candidate', entityId: 'cand-marcus-chen', createdAt: '2026-10-09T11:30:00Z', metadata: { evidenceId: 'ev-marcus-4', decision: 'needs_review' } },
];

export const demoMode = {
  aiProvider: 'not configured',
  database: 'auto',
};

export default {
  jobs,
  candidates,
  resumes,
  candidateSkills,
  experiences,
  education,
  projects,
  evidence,
  assessments,
  assessmentSubmissions,
  applications,
  searchEvents,
  auditLogs,
};
