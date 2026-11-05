import Schema from './clinicalData.schema.json';
import { validateNode, ClinicalDataError } from './schemaRules';
import type { ConflictReview, ConflictResolution, ReportAssertion, ResolutionOption } from './clinicalData';

export const ResolutionLabels: Record<ResolutionOption, string> = {
  firstAssertion: 'Use the first report for this analysis',
  secondAssertion: 'Use the second report for this analysis',
  changedOverTime: 'Both are valid—the information changed over time',
  differentContext: 'The reports describe different tests or contexts',
  correctedReport: 'A corrected report supersedes an earlier report',
  unresolved: 'Keep unresolved',
  requestVerification: 'Request additional verification',
};

export const ResolutionNotes = ['', 'Source verification is pending.', 'The case will be updated before reanalysis.', 'Additional clarification is required.'];

export function validateAssertion(assertion: unknown): ReportAssertion {
  validateNode(assertion, Schema.$defs.ReportAssertion);
  return assertion as ReportAssertion;
}

/** Differences are not automatically contradictions. Report relationships require human review. */
export function compareAssertions(assertions: ReportAssertion[]): 'opposingValues' | 'temporalDifference' | 'differentContext' | 'reportRelationship' | 'unresolved' | 'noConflict' {
  if (assertions.length < 2 || assertions.length > 4) throw new ClinicalDataError();
  assertions.forEach(validateAssertion);
  if (new Set(assertions.map(assertion => assertion.id)).size !== assertions.length) throw new ClinicalDataError();
  if (assertions.some(assertion => assertion.verification !== 'clinicianVerified')) return 'unresolved';
  if (new Set(assertions.map(assertion => assertion.concept)).size !== 1 || new Set(assertions.map(assertion => assertion.contextId)).size !== 1 || new Set(assertions.flatMap(assertion => assertion.method ? [assertion.method] : [])).size > 1) return 'differentContext';
  if (assertions.some(assertion => ['corrected', 'amended'].includes(assertion.reportStatus ?? '') || assertion.supersedesId)) return 'reportRelationship';
  const dates = assertions.map(assertion => assertion.effectiveDate);
  if (dates.some(date => date && date.kind !== 'notReported') && new Set(dates.map(date => JSON.stringify(date))).size !== 1) return 'temporalDifference';
  const states = new Set(assertions.map(assertion => assertion.normalizedValue));
  return states.has('present') && states.has('absent') ? 'opposingValues' : 'noConflict';
}

export function validateConflict(payload: unknown): ConflictReview {
  validateNode(payload, Schema.$defs.ConflictReview);
  const conflict = payload as ConflictReview;
  const expectedLabel = conflict.concept === 'pregnancyPossible' ? 'Pregnancy status' : 'PID diagnostic status';
  if (conflict.label !== expectedLabel || conflict.assertions.some(assertion => assertion.concept !== conflict.concept) || compareAssertions(conflict.assertions) !== conflict.conflictType || !conflict.assertions.some(report => report.normalizedValue === 'present') || !conflict.assertions.some(report => report.normalizedValue === 'absent') || conflict.assertions.some(report => report.supersedesId && (report.supersedesId === report.id || !conflict.assertions.some(source => source.id === report.supersedesId)))) throw new ClinicalDataError();
  return conflict;
}

/** Local handling records cannot alter original assertions, case fields or server safety gates. */
export function recordResolution(conflict: ConflictReview, option: ResolutionOption, note: string, recordedAt: string): ConflictResolution {
  validateConflict(conflict);
  if (!availableResolutions(conflict).includes(option) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(recordedAt) || !Number.isFinite(Date.parse(recordedAt)) || new Date(recordedAt).toISOString() !== recordedAt) throw new ClinicalDataError();
  // A bounded note vocabulary prevents identifiers and unsupported instructions.
  if (!ResolutionNotes.includes(note)) throw new ClinicalDataError();
  const resolution: ConflictResolution = { conflictId: conflict.id, concept: conflict.concept, option, assertionIds: conflict.assertions.map(assertion => assertion.id), recordedAt, ...(note ? { note } : {}), reanalysis: 'paused' };
  validateNode(resolution, Schema.$defs.ConflictResolution);
  return resolution;
}

export function resolutionLabel(option: ResolutionOption, conflict: ConflictReview): string {
  if (option === 'firstAssertion') return `Use ${conflict.assertions[0].sourceLabel} for this analysis`;
  if (option === 'secondAssertion') return `Use ${conflict.assertions[1].sourceLabel} for this analysis`;
  return ResolutionLabels[option];
}

function dateExtent(date: ReportAssertion['effectiveDate']): [string, string] | undefined {
  // Approximation alone supplies no uncertainty interval; do not invent one.
  if (!date || date.kind === 'approximate') return;
  if (date.kind === 'range') return [date.start!, date.end!];
  if (date.kind !== 'exact') return;
  if (date.precision === 'year') return [date.value! + '-01-01', date.value! + '-12-31'];
  if (date.precision === 'day') return [date.value!, date.value!];
  const [year, month] = date.value!.split('-').map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const last = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  return [date.value! + '-01', date.value! + '-' + last];
}

/** Resolution choices depend solely on confirmed metadata, never Watson output or inference. */
export function availableResolutions(conflict: ConflictReview): ResolutionOption[] {
  validateConflict(conflict);
  const reports = conflict.assertions;
  const extents = reports.map(report => dateExtent(report.effectiveDate));
  const changed = extents.some((first, index) => first && extents.slice(index + 1).some(second => second && (first[1] < second[0] || second[1] < first[0])));
  const different = new Set(reports.map(report => report.contextId)).size > 1 || new Set(reports.flatMap(report => report.method ? [report.method] : [])).size > 1;
  const corrected = reports.some(report => ['corrected', 'amended'].includes(report.reportStatus ?? '') || !!report.supersedesId);
  return conflict.allowedOptions.filter(option => option === 'changedOverTime' ? changed : option === 'differentContext' ? different : option === 'correctedReport' ? corrected : true);
}
