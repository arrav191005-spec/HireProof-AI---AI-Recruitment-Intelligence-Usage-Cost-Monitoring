// Static (non-executing) checks for JavaScript assessment submissions.
//
// These are intentionally shallow heuristics: they never run the candidate's
// code, they only inspect its text. Results inform a human reviewer — they do
// not produce a score on their own.
export function runStaticChecks(code, assessment) {
  const passed = [];
  const warnings = [];
  const trimmed = code.trim();

  if (trimmed.length === 0) {
    return { passed, warnings: ['Submission is empty'] };
  }

  if (/function\s+\w+|=>|async\s+function/.test(trimmed)) {
    passed.push('Contains a function definition');
  } else {
    warnings.push('No function definition found — expected a function implementation');
  }

  if (/console\.log/.test(trimmed)) {
    warnings.push('Contains console.log — remove debug output before final submission');
  }
  if (/\beval\s*\(|new\s+Function\s*\(/.test(trimmed)) {
    warnings.push('Uses eval/Function constructor — flagged for reviewer attention');
  }
  if (/while\s*\(\s*true\s*\)|for\s*\(\s*;;\s*\)/.test(trimmed)) {
    warnings.push('Contains an unbounded loop — would hit execution timeouts in a sandboxed runner');
  }

  if (assessment.skill === 'JavaScript') {
    if (/summarizeOrders/.test(assessment.instructions) && !/summarizeOrders/.test(trimmed)) {
      warnings.push('Expected function `summarizeOrders` is not defined in the submission');
    } else if (/summarizeOrders/.test(trimmed)) {
      passed.push('Defines the expected `summarizeOrders` function');
    }
  }

  const langMatch = {
    JavaScript: /=>|function|const|let|var/,
    SQL: /\bselect\b|\bwith\b/i,
    Python: /def |import |lambda/,
  };
  const pattern = langMatch[assessment.skill];
  if (pattern && !pattern.test(trimmed)) {
    warnings.push(`Submission does not look like ${assessment.skill}`);
  }

  if (passed.length === 0 && warnings.length === 0) {
    warnings.push('No signals detected');
  }
  return { passed, warnings };
}

export default { runStaticChecks };
