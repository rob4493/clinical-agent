import type { ReactNode } from 'react';
import FindingIcon from './FindingIcon';
import type { FindingCard } from './findingRules';

/** Reviewed explanations stay beside their symbol; original evidence remains available below. */
export default function VisualFindings({ findings, summary, onCite, sourcesOpen }: { findings: FindingCard[]; summary?: ReactNode; onCite: () => void; sourcesOpen: boolean }) {
  if (!findings.length && !summary) return null;
  const explained = findings.some(finding => finding.paragraphs?.length);
  function paragraphs(finding: FindingCard) {
    const fragments = finding.paragraphs ?? [];
    // Group complete reviewed fragments; keep each citation attached to its wording.
    const split = Math.ceil(fragments.length / 2);
    return [fragments.slice(0, split), fragments.slice(split)].filter(group => group.length).map((group, index) => <p key={index}>{group.map((paragraph, part) => <span key={part}>{paragraph.text} {citation(paragraph.numbers)}{' '}</span>)}</p>);
  }
  function citation(numbers: number[]) {
    return numbers.length > 0 && <button type="button" className="citation citationButton" onClick={onCite} aria-expanded={sourcesOpen} aria-controls="reviewSources" aria-label={`View cited sources ${numbers.join(',')}`}>[{numbers.join(',')}]</button>;
  }
  return <div className="visualSummary">
    {!explained && summary && <p className="directAnswer">{summary}</p>}
    {findings.length > 0 && <ul className="summaryFindings">{findings.map(finding => <li key={finding.id} id={`finding${finding.id}`}>
      <div className="summaryIcons" aria-hidden="true"><FindingIcon decorative finding={finding.id} title={finding.label} /></div>
      <div className="summaryContent"><h3>{finding.label}</h3>
        {finding.paragraphs?.length ? <div className="findingExplanation">{paragraphs(finding)}</div>
          : finding.kind === 'discussion' ? <p>{finding.reported}</p> : null}
      </div>
    </li>)}</ul>}
  </div>;
}
