// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { compareAssertions, recordResolution, validateConflict, availableResolutions, ResolutionLabels } from '../../shared/conflictReview';
import { ConflictReports } from '../src/DemoCases';
import { validateNode } from '../../shared/schemaRules';
import Schema from '../../shared/clinicalData.schema.json';


function reviewFor(option: string) {
  const conflict = structuredClone(ConflictReports);
  if (option === 'changedOverTime') { conflict.assertions[0].effectiveDate = { kind: 'exact', precision: 'day', value: '2026-01-01' }; conflict.assertions[1].effectiveDate = { kind: 'exact', precision: 'day', value: '2026-02-01' }; conflict.conflictType = 'temporalDifference'; }
  if (option === 'differentContext') { conflict.assertions[1].contextId = 'PreviousContext'; conflict.conflictType = 'differentContext'; }
  if (option === 'correctedReport') { conflict.assertions[1].reportStatus = 'corrected'; conflict.conflictType = 'reportRelationship'; }
  return conflict;
}

describe('Bounded local conflict handling', () => {
  it('has an exact confirmed synthetic opposite-status fixture', () => {
    expect(validateConflict(ConflictReports)).toBe(ConflictReports);
    expect(compareAssertions(ConflictReports.assertions)).toBe('opposingValues');
    expect(ConflictReports.assertions.map(assertion => assertion.normalizedValue)).toEqual(['absent', 'present']);
  });
  for (const state of ['unknown', 'notReported', 'notApplicable', 'absent'] as const) it('does not call ' + state + ' versus absent a conflict', () => {
    const assertions = structuredClone(ConflictReports.assertions); assertions[1].normalizedValue = state;
    expect(compareAssertions(assertions)).toBe('noConflict');
  });
  it('keeps temporal, context and report-status differences separate', () => {
    const assertions = structuredClone(ConflictReports.assertions);
    assertions[1].contextId = 'PreviousContext'; expect(compareAssertions(assertions)).toBe('differentContext');
    assertions[1].contextId = assertions[0].contextId;
    assertions[1].effectiveDate = { kind: 'exact', precision: 'day', value: '2026-10-01' }; expect(compareAssertions(assertions)).toBe('temporalDifference');
    assertions[1].reportStatus = 'corrected'; expect(compareAssertions(assertions)).toBe('reportRelationship');
    assertions[1].verification = 'unverified'; expect(compareAssertions(assertions)).toBe('unresolved');
  });
  for (const option of ConflictReports.allowedOptions) it('records ' + option + ' separately and leaves analysis paused', () => {
    const conflict = reviewFor(option);
    const original = JSON.stringify(conflict);
    const record = recordResolution(conflict, option, '', '2026-10-30T12:00:00.000Z');
    expect(record.option).toBe(option); expect(record.reanalysis).toBe('paused');
    expect(record.assertionIds).toEqual(['DemoAssertionOne', 'DemoAssertionTwo']);
    expect(record.concept).toBe('pregnancyPossible'); expect(JSON.stringify(conflict)).toBe(original);
    expect(Object.keys(ResolutionLabels)).toHaveLength(7);
  });
  it('supports PID without inferring a diagnosis', () => {
    const conflict = structuredClone(ConflictReports); conflict.concept = 'pidDiagnosedOrPresumed'; conflict.label = 'PID diagnostic status';
    conflict.assertions.forEach(assertion => { assertion.concept = conflict.concept; });
    expect(validateConflict(conflict)).toBe(conflict);
  });
  it('rejects malformed dates, duplicate IDs, extra properties and unconfirmed assertions', () => {
    const conflict = structuredClone(ConflictReports); conflict.assertions[1].id = conflict.assertions[0].id;
    expect(() => validateConflict(conflict)).toThrow('Invalid clinical data');
    expect(() => validateConflict({ ...ConflictReports, secret: 'synthetic secret' })).toThrow('Invalid clinical data');
    conflict.assertions[1].id = 'Second'; conflict.assertions[1].verification = 'unverified';
    expect(() => validateConflict(conflict)).toThrow('Invalid clinical data');
    expect(() => recordResolution(ConflictReports, 'unresolved', '', '2026-02-30T12:00:00.000Z')).toThrow('Invalid clinical data');
    expect(() => recordResolution(ConflictReports, 'unresolved', 'Patient name: Synthetic Person', '2026-10-30T12:00:00.000Z')).toThrow('Invalid clinical data');
    expect(() => validateNode({ ...ConflictReports.assertions[0], effectiveDate: { kind: 'exact', precision: 'day', value: '2026-02-30' } }, Schema.$defs.ReportAssertion)).toThrow();
  });
});

it('shows only four always-valid options for the final-report fixture', () => {
  expect(availableResolutions(ConflictReports)).toEqual(['firstAssertion', 'secondAssertion', 'unresolved', 'requestVerification']);
  for (const option of ['changedOverTime', 'differentContext', 'correctedReport'] as const) expect(() => recordResolution(ConflictReports, option, '', '2026-10-30T12:00:00.000Z')).toThrow('Invalid clinical data');
});
it('does not invent metadata from missing, unknown or overlapping dates', () => {
  const conflict = structuredClone(ConflictReports);
  conflict.assertions[0].effectiveDate = { kind: 'unknown' }; conflict.assertions[1].effectiveDate = { kind: 'notReported' }; conflict.conflictType = 'temporalDifference';
  expect(availableResolutions(conflict)).not.toContain('changedOverTime');
  conflict.assertions[0].effectiveDate = { kind: 'exact', precision: 'year', value: '2026' };
  conflict.assertions[1].effectiveDate = { kind: 'exact', precision: 'day', value: '2026-01-01' };
  expect(availableResolutions(conflict)).not.toContain('changedOverTime');
});
it('supports supplied method and superseding relationships without source selection', () => {
  const conflict = structuredClone(ConflictReports);
  conflict.assertions[0].method = 'Reported method A'; conflict.assertions[1].method = 'Reported method B'; conflict.conflictType = 'differentContext';
  expect(availableResolutions(conflict)).toContain('differentContext');
  delete conflict.assertions[0].method; delete conflict.assertions[1].method;
  conflict.assertions[1].supersedesId = conflict.assertions[0].id; conflict.conflictType = 'reportRelationship';
  expect(availableResolutions(conflict)).toContain('correctedReport');
  conflict.assertions[1].supersedesId = 'UnknownSource'; expect(() => validateConflict(conflict)).toThrow();
});
