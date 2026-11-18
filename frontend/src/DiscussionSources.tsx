import {discussionSource} from '../../shared/discussionSources';
import {safeUrl} from './api';

export default function DiscussionSources({ids=[]}:{ids?:string[]}){
 const sources=[...new Set(ids)].map(discussionSource).filter(source=>source&&safeUrl(source.officialUrl));
 return <aside className="discussionReading" aria-label="Sources & further reading"><h4>Sources &amp; further reading</h4><p>Related clinical reading—not independent verification of this AI response. Claim-linked evidence remains in structured Evidence Review.</p>{sources.length?<ul>{sources.map(source=>source&&<li key={source.sourceId}><a href={source.officialUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{source.title}<span className="visuallyHidden"> (opens in a new tab)</span></a><p>{source.organization}{source.publicationDate?' · '+source.publicationDate:''}</p></li>)}</ul>:<p>No sufficiently relevant registry-verified source URL is available for this answer.</p>}</aside>;
}
