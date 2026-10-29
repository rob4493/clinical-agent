import PregnancyInputs from './PregnancyCases.json';
import type { PregnancyContext } from './api';
export type DemoStatus = 'unknown' | 'yes' | 'no';

export interface DemoCase {
  id: string;
  label: string;
  explanation: string;
  ageRange: string;
  caseType: 'brief' | 'detailed';
  pregnancy: DemoStatus;
  pid: DemoStatus;
  narrative: string;
  moduleId: string;
  syntheticModuleId?: string;
  earlyPregnancy?: PregnancyContext;
}

// Module assignments are fixture metadata for each runtime, never inferred from submitted text.
// Inputs only: all outcomes and safety decisions still come from the backend.
export const DemoCases: DemoCase[] = [
  { moduleId: 'module_01_endo', syntheticModuleId: 'SyntheticDemo', id: 'brief', label: 'Brief', explanation: 'A short case with limited context.', ageRange: '25-34', caseType: 'brief', pregnancy: 'unknown', pid: 'unknown', narrative: 'Recurrent pelvic discomfort. Timing, examination and test findings are not provided. Please review the reported pattern and uncertainty.' },
  { moduleId: 'module_01_endo', syntheticModuleId: 'SyntheticDemo', id: 'mild', label: 'Mild/nonurgent', explanation: 'A pattern without a predefined warning.', ageRange: '25-34', caseType: 'brief', pregnancy: 'unknown', pid: 'unknown', narrative: 'Mild intermittent pelvic discomfort over several months. Additional findings are not provided.' },
  { moduleId: 'module_01_endo', syntheticModuleId: 'SyntheticDemo', id: 'detailed', label: 'Detailed', explanation: 'A case with more context.', ageRange: '25-34', caseType: 'detailed', pregnancy: 'unknown', pid: 'unknown', narrative: 'Intermittent pelvic discomfort over several months, with variable interference in daily activities. Examination and test findings are not provided. Please review the available evidence and its limitations.' },
  { moduleId: 'module_01_endo', syntheticModuleId: 'SyntheticDemo', id: 'urgent', label: 'Urgent warning', explanation: 'Shows urgent information first.', ageRange: '25-34', caseType: 'brief', pregnancy: 'unknown', pid: 'unknown', narrative: 'sudden acute pelvic pain' },
  { moduleId: 'module_01_endo', syntheticModuleId: 'SyntheticDemo', id: 'conflict', label: 'Conflict', explanation: 'Intentionally contradicts structured status.', ageRange: '25-34', caseType: 'brief', pregnancy: 'no', pid: 'unknown', narrative: 'pregnancy confirmed' },
  { moduleId: 'module_01_endo', syntheticModuleId: 'SyntheticDemo', id: 'clarification', label: 'Clarification', explanation: 'Missing structured status needs clarification.', ageRange: '25-34', caseType: 'brief', pregnancy: 'unknown', pid: 'unknown', narrative: 'pregnancy confirmed' },
  { moduleId: 'module_01_endo', syntheticModuleId: 'SyntheticDemo', id: 'unsupported', label: 'Outside scope', explanation: 'A concern outside the available module.', ageRange: '25-34', caseType: 'brief', pregnancy: 'unknown', pid: 'unknown', narrative: 'Persistent headache with light sensitivity. Please review the reported symptoms.' },
];

export const PregnancyCases: DemoCase[] = PregnancyInputs as DemoCase[];
