import type { FindingId } from './findingRules';

/** Original monoline symbols inspired by the supplied subject reference, not clinical anatomy diagrams. */
export default function FindingIcon({ finding, title, decorative = false }: { finding: FindingId; title: string; decorative?: boolean }) {
  return <svg viewBox="0 0 64 64" width="64" height="64" role={decorative ? undefined : 'img'} aria-label={decorative ? undefined : title} aria-hidden={decorative || undefined} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    {!decorative && <title>{title}</title>}
    {finding === 'generalReview' ? <><rect x="14" y="9" width="36" height="47" rx="6" /><path d="M24 8h16v8H24zM24 28h16M24 36h12" /><circle className="findingAccent" cx="39" cy="47" r="3" /></> : finding === 'pelvicPain' ? <><path d="M22 16c-8-7-18-2-17 8 1 8 12 10 15 3M42 16c8-7 18-2 17 8-1 8-12 10-15 3M22 16c5-4 15-4 20 0M22 16c-3 9 1 13 5 18v13c0 7 10 7 10 0V34c4-5 8-9 5-18" /><circle cx="15" cy="31" r="5" /><circle cx="49" cy="31" r="5" /><path className="findingAccent" d="m7 41-4 5 6-1-2 6m50-10 4 5-6-1 2 6" /></> : <><path d="M32 53 9 31C-5 15 17 1 32 20 47 1 69 15 55 31Z" /><path className="findingAccent" d="m47 7-6 13 10-2-6 14" /></>}
  </svg>;
}
