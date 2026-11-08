/**
 * Validation issues as the CLI prints them: a validation result's, and those
 * a refused definition carries on its error (`validationIssuesOf`).
 */

import type { ValidationIssue } from '@octavus/server-sdk';
import * as output from '@/output.js';

const SEVERITY_ORDER: ValidationIssue['severity'][] = ['error', 'warning', 'info'];

/** Print the issues, errors first, each with its location and suggestions. */
export function renderIssues(issues: ValidationIssue[]): void {
  for (const severity of SEVERITY_ORDER) {
    for (const issue of issues) {
      if (issue.severity !== severity) continue;
      const location = issue.path ? ` (${output.gray(issue.path)})` : '';
      const line = `  ${issue.message}${location}`;
      if (severity === 'error') {
        output.error(line);
      } else if (severity === 'warning') {
        output.warning(line);
      } else {
        output.info(line);
      }
      for (const suggestion of issue.suggestions ?? []) {
        output.dim(`    ${suggestion}`);
      }
    }
  }
}
