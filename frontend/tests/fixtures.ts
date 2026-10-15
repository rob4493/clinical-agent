import { DecisionNotice } from '../src/api';

export const Modules = { modules: [{ moduleId: 'FictionalModule', displayName: 'Fictional review module', supportedCaseTypes: ['brief', 'detailed'] }] };
export const Ready = { status: 'ready', reasonCode: 'ready', availableModuleCount: 1 };
export const ConsiderationText = 'A fictional evidence-bound observation is available for clinician review.';

export function analysisResult(outcome = 'AgentResponse', urgent = false) {
  const warnings = urgent ? [{ ruleId: 'U1', text: 'Fictional urgent assessment warning.', sourceTags: ['FictionalSource'] }] : [];
  const clinical = outcome === 'AgentResponse';
  return {
    warnings,
    response: {
      responseType: outcome, decisionSupportNotice: DecisionNotice, moduleId: 'FictionalModule',
      message: 'The selected evidence or service is unavailable.',
      conflictDescription: 'Structured and narrative information conflict.',
      clarificationRequest: 'Please clarify the reported pregnancy status.',
      supportedInterpretations: [{ text: ConsiderationText, citations: [{ sourceTag: 'FictionalSource' }] }],
      internalPath: '/internal/private', providerPayload: 'private provider payload',
    },
    sources: clinical || urgent ? [{ number: 1, source: { sourceId: 'FictionalSource', title: 'Fictional reference', verifiedUrl: 'https://fictional.invalid/Evidence%2FAlpha', knowledgeFile: 'private.bin' } }] : [],
    renderedText: [
      ...(urgent ? ['Fictional urgent assessment warning. [1]'] : []),
      ...(clinical ? [ConsiderationText + ' [1]'] : ['The selected evidence or service is unavailable.']),
      ...(clinical || urgent ? ['Sources', '[1] Fictional reference — <https://fictional.invalid/Evidence%2FAlpha>'] : []),
      DecisionNotice,
    ].join('\n\n'),
  };
}
