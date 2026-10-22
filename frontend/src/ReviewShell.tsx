/** Real section navigation only; no saved cases, profiles or evidence-library claims. */
export function ReviewNavigation() {
  return <aside className="reviewNavigation" aria-label="Endo navigation">
    <a className="wordmark" href="#caseForm" aria-label="Endo — case details">Endo</a>
    <p className="brandSubtitle">Clinical Evidence<br />Assistant</p>
    <nav aria-label="Review sections">
      <a href="#caseForm"><span aria-hidden="true">＋</span>Case details</a>
      <a href="#uploadTitle"><span aria-hidden="true">▤</span>Documents</a>
      <a href="#evidenceWorkspace"><span aria-hidden="true">◇</span>Evidence review</a>
      <a href="#scopeTitle"><span aria-hidden="true">ⓘ</span>Scope & safety</a>
    </nav>
    <div className="botanical" aria-hidden="true"><i /><i /><i /><i /><i /></div>
    <p className="navigationFoot">Clinician-facing<br />In-memory review only</p>
  </aside>;
}

export function WorkflowBar({ pending, hasResponse }: { pending: boolean; hasResponse: boolean }) {
  const active = pending ? 1 : hasResponse ? 2 : 0;
  return <header className="workflowBar"><span className="workflowLabel">New review</span>
    <ol aria-label="Review workflow">{['Case details', 'Analyze', 'Evidence review'].map((step, index) => <li key={step} aria-current={active === index ? 'step' : undefined}><span aria-hidden="true">{index + 1}</span>{step}</li>)}</ol>
    <p>De-identified information only<br /><span>Not a diagnostic or prescribing system.</span></p>
  </header>;
}
