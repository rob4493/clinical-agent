import type { Review, Statement } from './api';
import { safeUrl } from './api';
import { useEffect, useState } from 'react';
import SourceDetails from './SourceDetails';
import Disclosure from './Disclosure';
import { summarizeReview } from './responsePresentation';

function Citation({ statement, onCite, sourcesOpen }: { statement: Statement; onCite?: () => void; sourcesOpen?: boolean }) {
  return <>{statement.text}{statement.numbers.length > 0 && <button type="button" className="citation citationButton" onClick={onCite} aria-expanded={sourcesOpen} aria-controls="reviewSources" aria-label={`View cited sources ${statement.numbers.join(',')}`}>[{statement.numbers.join(',')}]</button>}</>;
}

export default function ResponsePanel({ review, synthetic = false, pending = false, competition = false }: { review: Review | null; synthetic?: boolean; pending?: boolean; competition?: boolean }) {
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  useEffect(() => { setSourceId(null); setSourcesOpen(false); }, [review]);
  function openSources() { setSourcesOpen(true); }
  if (!review) return <section id="evidenceWorkspace" tabIndex={-1} className="card responseCard" aria-labelledby="reviewTitle" aria-busy={pending}><h2 id="reviewTitle">Evidence review</h2><p className="muted">{pending ? 'Checking the case and reviewing selected evidence…' : 'Your response will appear here after submission.'}</p><div className="emptyReview"><strong>{pending ? 'Analysis in progress' : 'Ready for your case'}</strong><span>{synthetic ? 'Review the case before submitting.' : 'Guided by independent clinical judgment.'}</span></div></section>;
  const presentation = review.considerations.length ? { tone: 'supported', label: 'Evidence-supported response' }
    : review.heading === 'Resolve conflicting information' ? { tone: 'conflict', label: 'Analysis paused · conflicting information' }
    : review.heading === 'Clarification required' ? { tone: 'clarification', label: 'Analysis paused · clarification needed' }
    : { tone: 'insufficient', label: 'Analysis unavailable · review limitation' };
  const urgentOnly = review.warnings.length > 0 && review.considerations.length === 0 && review.messages.length === 0 && !review.question;
  const concise = summarizeReview(review);
  return <section id="evidenceWorkspace" tabIndex={-1} className={`card responseCard ${presentation.tone}`} aria-label="Clinical evidence review">
    {review.warnings.length > 0 && <div className="urgentPanel" role="alert"><h2 tabIndex={-1} id="urgentTitle"><span aria-hidden="true">! </span>Urgent assessment</h2><p className="urgentLabel">Priority warning — review first</p>{review.warnings.map((warning, index) => <p key={index}><Citation sourcesOpen={sourcesOpen} onCite={openSources} statement={warning} /></p>)}</div>}
    {review.scopeNotice && <p className="scopeNotice" role="note">{review.scopeNotice}</p>}
    {synthetic && <p className="syntheticLabel">Synthetic demonstration response</p>}
    {!urgentOnly && <>{!synthetic && <p className="outcomeLabel">{presentation.label}</p>}<h2 tabIndex={-1} id="reviewTitle">{review.considerations.length ? 'Summary' : review.heading}</h2>
</>}
    {concise.summary && <section aria-labelledby="reviewTitle"><p className="directAnswer"><Citation sourcesOpen={sourcesOpen} onCite={openSources} statement={concise.summary} /></p></section>}
    {concise.next && <section aria-labelledby="nextTitle"><h3 id="nextTitle">Next consideration</h3><p><Citation sourcesOpen={sourcesOpen} onCite={openSources} statement={concise.next} /></p></section>}
    {concise.points.length > 0 && <Disclosure resetKey={review} label={`Key points (${concise.points.length})`}><ul className="keyPoints">{concise.points.map((statement, index) => <li key={index}><Citation sourcesOpen={sourcesOpen} onCite={openSources} statement={statement} /></li>)}</ul></Disclosure>}
    {review.messages.map((message, index) => <p key={index}>{message}</p>)}
    {review.question && <div className="followup"><h3>Questions to clarify</h3><p>{review.question}</p></div>}
    {review.considerations.length > 0 && <Disclosure resetKey={review} label="View clinical and educational details">
      <h3>Clinical interpretation</h3>
      {review.context && <p>{review.context}</p>}
      {review.considerations.map((statement, index) => <p key={index}><Citation sourcesOpen={sourcesOpen} onCite={openSources} statement={statement} /></p>)}
      {concise.terms.length > 0 && <section><h3>Medical terms explained</h3><dl>{concise.terms.map(term => <div key={term.term}><dt>{term.term}</dt><dd>{term.explanation}</dd></div>)}</dl></section>}

    </Disclosure>}
    {review.sources.length > 0 && <Disclosure resetKey={review} triggerId="sourcesTitle" contentId="reviewSources" expanded={sourcesOpen} onToggle={setSourcesOpen} label={`Sources (${review.sources.length})`}><section className="sources" aria-label="Cited sources"><ul>{review.sources.map(source => <li key={source.number}>
      {synthetic || (competition && !safeUrl(source.verifiedUrl)) ? <button type="button" className="sourceButton" onClick={() => setSourceId(source.sourceId)} aria-label={`[${source.number}] View source details`}><span className="sourceTitle" title={source.title}>[{source.number}] {source.organization ? `${source.organization} - ` : ''}{source.title}{source.date ? ` - ${source.date}` : ''}</span><span className="sourceAction">View source details</span></button> : safeUrl(source.verifiedUrl) ? <a className="sourceButton" href={source.verifiedUrl!} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" aria-label={`[${source.number}] ${source.title} - opens in a new tab`}><span className="sourceTitle" title={source.title}>[{source.number}] {source.organization ? `${source.organization} - ` : ''}{source.title}{source.date ? ` - ${source.date}` : ''}</span><span className="sourceAction">Opens in a new tab</span></a> : <span className="unlinkedSource">[{source.number}] {source.title} <small>Verified link unavailable</small></span>}
    </li>)}</ul></section></Disclosure>}
    {(synthetic || competition) && sourceId && <SourceDetails sourceId={sourceId} competition={competition} onClose={() => setSourceId(null)} />}
    <p className="decisionNotice">{review.notice}</p>
  </section>;
}
