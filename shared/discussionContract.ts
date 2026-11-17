/** Presentation contract only: no clinical authority, secrets or provider access. */
export const DiscussionTextLimit=16000;
export const DiscussionRejections=['invalidText','emptyText','responseTooLong','invalidCharacters','executableMarkup','unsafeReference','secretExposure','internalInstruction','actionDirective','medicationDose','unsupportedStaging','patientSpecificRisk','diagnosisAssertion','diagnosisConfirmation','patientAssertion','diagnosticExclusion','prescribingInstruction','providerAction','unclassifiedOutput'] as const;
export type DiscussionRejection=typeof DiscussionRejections[number];
export function isDiscussionRejection(value:unknown):value is DiscussionRejection{return typeof value==='string'&&(DiscussionRejections as readonly string[]).includes(value);}
export const ProviderRejections=['httpNotSuccessful','contentType','bodyUnavailable','bodyReadFailed','bodyTooLarge','invalidUtf8','invalidJson','invalidShape','unexpectedFields','missingRequiredFields','invalidThreadId','invalidMetadata','invalidChoices','incompatibleMessageContent','finishReason','usageValidation','threadMismatch','actionResponse','providerRefusal','textTooLong','textInvalidCharacters','unclassifiedProtocol'] as const;
export function isProviderRejection(value:unknown):value is typeof ProviderRejections[number]{return typeof value==='string'&&(ProviderRejections as readonly string[]).includes(value);}
/** Both UIs render text nodes, never HTML/Markdown, links, embeds or executable code.
 * This additional rejection catches active markup even when entity-encoded. */
export function hasExecutableMarkup(text:string){
 const checked=text.replace(/&(?:lt|#0*60|#x0*3c);/gi,'<').replace(/&(?:gt|#0*62|#x0*3e);/gi,'>');
 return /<\s*\/?\s*(?:script|style|iframe|object|embed|svg|math|img|link|meta|form|input|button|video|audio|source)\b|<\s*\/?\s*[A-Za-z][^>]*\bon[a-z]+\s*=|<\?|<!doctype/i.test(checked);
}
