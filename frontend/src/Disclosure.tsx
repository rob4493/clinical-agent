import { useEffect, useId, useState, type ReactNode } from 'react';

/** Native button semantics provide Enter/Space activation and explicit state announcements. */
export default function Disclosure({ label, children, resetKey, expanded: controlled, onToggle, contentId, triggerId }: { label: string; children: ReactNode; resetKey?: unknown; expanded?: boolean; onToggle?: (expanded: boolean) => void; contentId?: string; triggerId?: string }) {
  const [localExpanded, setExpanded] = useState(false);
  const expanded = controlled ?? localExpanded;
  const generatedId = useId();
  const panelId = contentId ?? generatedId;
  useEffect(() => setExpanded(false), [resetKey]);
  return <div className="responseDisclosure"><button id={triggerId} type="button" aria-expanded={expanded} aria-controls={panelId} onClick={() => { setExpanded(!expanded); onToggle?.(!expanded); }}>{label}<span aria-hidden="true">{expanded ? ' −' : ' +'}</span></button><div id={panelId} hidden={!expanded}>{expanded && children}</div></div>;
}
