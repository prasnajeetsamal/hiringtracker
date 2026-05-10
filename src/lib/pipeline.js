// src/lib/pipeline.js
// The hiring pipeline state machine. Single source of truth for stage keys,
// default order, "what to expect" defaults, and transition helpers.

export const STAGES = [
  {
    key: 'resume_submitted',
    label: 'Resume Submitted',
    short: 'Submitted',
    whatToExpect: 'Resume received and queued for hiring-manager review.',
  },
  {
    key: 'hm_review',
    label: 'Hiring Manager Review',
    short: 'HM Review',
    whatToExpect: 'The hiring manager reviews the resume and decides whether to move the candidate forward.',
  },
  {
    key: 'technical_written',
    label: 'Technical Written',
    short: 'Tech Written',
    whatToExpect: 'A take-home or proctored written exercise to assess technical fundamentals.',
  },
  {
    key: 'technical_interview',
    label: 'Technical Interview',
    short: 'Tech Interview',
    whatToExpect: "Live technical interview covering depth in the candidate's primary area.",
  },
  {
    key: 'problem_solving',
    label: 'Problem Solving',
    short: 'Problem Solving',
    whatToExpect: 'Open-ended problem-solving session to evaluate reasoning and approach.',
  },
  {
    key: 'case_study',
    label: 'Case Study',
    short: 'Case Study',
    whatToExpect: 'A scenario-based case study, typically with a short prep period and a panel discussion.',
  },
  {
    key: 'offer',
    label: 'Offer',
    short: 'Offer',
    whatToExpect: 'Offer extended; candidate decision pending.',
  },
  {
    key: 'joined_fractal',
    label: 'Joined Fractal',
    short: 'Joined',
    whatToExpect: 'Candidate accepted the offer and has joined.',
  },
  {
    key: 'rejected_offer',
    label: 'Rejected Offer',
    short: 'Declined',
    whatToExpect: 'Candidate declined the offer.',
  },
];

export const STAGE_KEYS = STAGES.map((s) => s.key);
export const STAGE_BY_KEY = Object.fromEntries(STAGES.map((s) => [s.key, s]));

export const STAGE_STATE = {
  pending: 'pending',
  in_progress: 'in_progress',
  passed: 'passed',
  failed: 'failed',
  skipped: 'skipped',
};

export const TERMINAL_STAGE_STATES = new Set([STAGE_STATE.passed, STAGE_STATE.failed, STAGE_STATE.skipped]);

export function defaultStageConfig() {
  return STAGES.map((s) => ({
    stage_key: s.key,
    enabled: true,
    what_to_expect: s.whatToExpect,
  }));
}

export function enabledStages(stageConfig) {
  if (!Array.isArray(stageConfig) || stageConfig.length === 0) return STAGES;
  const map = new Map(stageConfig.map((c) => [c.stage_key, c]));
  return STAGES.filter((s) => map.get(s.key)?.enabled !== false);
}

export function nextEnabledStage(stageConfig, currentKey) {
  const list = enabledStages(stageConfig);
  const idx = list.findIndex((s) => s.key === currentKey);
  if (idx === -1) return null;
  return list[idx + 1] || null;
}
