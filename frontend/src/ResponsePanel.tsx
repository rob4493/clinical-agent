import type { Review, Statement } from './api';
import { safeUrl } from './api';
import { useEffect, useState } from 'react';
import SourceDetails from './SourceDetails';

function Citation({ statement }: { statement: Statement }) {
  return <>{statement.text}{statement.numbers.length > 0 && <span className="citation"> [{statement.numbers.join(',')}]</span>}</>;
}

export default function ResponsePanel({ review, synthetic = false, pending = false, competition = false }: { review: Review | null; synthetic?: boolean; pending?: boolean; competition?: boolean }) {
  const [sourceId, setSourceId] = useState<string | null>(null);
  useEffect(() => setSourceId(null), [review]);
  if (!review) return <section className="card responseCard" aria-labelledby="reviewTitle" aria-busy={pending}><h2 id="reviewTitle">Evidence review</h2><p className="muted">{pending ? 'Checking the case and reviewing selected evidence…' : 'Your response will appear here after submission.'}</p><div className="emptyReview"><strong>{pending ? 'Analysis in progress' : 'Ready for your case'}</strong><span>{synthetic ? 'Review the case before submitting.' : 'Guided by independent clinical judgment.'}</span></div></section>;
  const presentation = review.considerations.length ? { tone: 'supported', label: 'Evidence-supported response' }
    : review.heading === 'Resolve conflicting information' ? { tone: 'conflict', label: 'Analysis paused · conflicting information' }
    : review.heading === 'Clarification required' ? { tone: 'clarification', label: 'Analysis paused · clarification needed' }
    : { tone: 'insufficient', label: 'Analysis unavailable · review limitation' };
  const urgentOnly = review.warnings.length > 0 && review.considerations.length === 0 && review.messages.length === 0 && !review.question;
  return <section className={`card responseCard ${presentation.tone}`} aria-label="Clinical evidence review">
    {review.warnings.length > 0 && <div className="urgentPanel" role="alert"><h2 tabIndex={-1} id="urgentTitle">Urgent assessment</h2><p className="urgentLabel">Priority warning — review first</p>{review.warnings.map((warning, index) => <p key={index}><Citation statement={warning} /></p>)}</div>}
    {synthetic && <p className="syntheticLabel">Synthetic demonstration response</p>}
    {!urgentOnly && <>{!synthetic && <p className="outcomeLabel">{presentation.label}</p>}<h2 tabIndex={-1} id="reviewTitle">{review.heading}</h2>
    {review.context && <p className="reviewContext">{review.context}</p>}</>}
    {review.considerations.length === 1 ? <p className="directAnswer"><Citation statement={review.considerations[0]} /></p> : review.considerations.length > 1 && <ol className="considerations">{review.considerations.map((statement, index) => <li key={index}><Citation statement={statement} /></li>)}</ol>}
    {review.messages.map((message, index) => <p key={index}>{message}</p>)}
    {review.question && <div className="followup"><h3>One useful follow-up</h3><p>{review.question}</p></div>}
    {review.sources.length > 0 && <section className="sources" aria-labelledby="sourcesTitle"><h3 id="sourcesTitle">Sources</h3><ul>{review.sources.map(source => <li key={source.number}>
      {synthetic || (competition && !safeUrl(source.verifiedUrl)) ? <button type="button" className="sourceButton" onClick={() => setSourceId(source.sourceId)} aria-label={`[${source.number}] View source details`}><span className="sourceTitle" title={source.title}>[{source.number}] {competition ? `${source.organization ?? ''} — ${source.title}${source.date ? ` · ${source.date}` : ''}` : 'View source'}</span><span className="sourceAction">View source details</span></button> : safeUrl(source.verifiedUrl) ? <a className="sourceButton" href={source.verifiedUrl!} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" aria-label={`[${source.number}] ${source.title} — opens in a new tab`}><span className="sourceTitle" title={source.title}>[{source.number}] {source.organization ? `${source.organization} — ` : ''}{source.title}{source.date ? ` · ${source.date}` : ''}</span><span className="sourceAction">Opens in a new tab</span></a> : <span className="unlinkedSource">[{source.number}] {source.title} <small>Verified link unavailable</small></span>}
    </li>)}</ul></section>}
    {(synthetic || competition) && sourceId && <SourceDetails sourceId={sourceId} competition={competition} onClose={() => setSourceId(null)} />}
    <p className="decisionNotice">{review.notice}</p>
  </section>;
}
