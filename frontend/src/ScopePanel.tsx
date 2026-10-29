import { CompetitionBanner } from './api';

export default function ScopePanel({ synthetic, competition = false, pregnancyAvailable = false }: { synthetic: boolean; competition?: boolean; pregnancyAvailable?: boolean }) {
  return <details className="scopePanel" aria-labelledby="scopeTitle">
    <summary id="scopeTitle" tabIndex={0}>Scope &amp; safety</summary>
    <h2>{synthetic ? 'Current coverage' : 'What this version can review'}</h2>
    {competition && <p>{CompetitionBanner}</p>}
    <div className="scopeCoverage"><span className="coverageFocus">Endometriosis and chronic pelvic pain workflow</span>{competition && pregnancyAvailable && <span className="coverageFocus">Early Pregnancy Pain and Bleeding · competition evaluation</span>}</div>
    <div className="futureModules" aria-label="Inactive future modules">{!pregnancyAvailable && <span>Early pregnancy pain and bleeding <small>In development</small></span>}<span>Pelvic inflammatory disease <small>In development</small></span><span>Polycystic ovary syndrome <small>In development</small></span></div>
    <p>{competition ? 'The separate competition package is available for controlled evaluation. Production clinical modules remain inactive pending expert review.' : 'Authentic clinical modules remain inactive and unavailable pending expert review.'}</p>
    <details><summary>Clinical scope, limitations and boundary testing</summary>
      <p>Designed for clinician-facing evidence review of endometriosis and chronic pelvic pain: evidence-supported considerations, important missing or conflicting information, supported test limitations, verified sources and predefined urgent-warning patterns.</p>
      <p>It does not diagnose a condition, determine disease probability or stage, prescribe treatment, or replace clinical judgment.</p>
      <div className="scopeDetails">
        <div><h3>Current designed clinical focus</h3><ul><li>Endometriosis and chronic pelvic pain</li><li>Related symptom patterns supported by the selected module</li><li>{competition ? 'Specific test limitations in the separately eligible competition package' : 'Specific test limitations contained in the approved module'}</li><li>Predefined pelvic-pain urgent-warning patterns</li></ul></div>
        <div><h3>Not currently supported as full clinical modules</h3><ul><li>The inactive future modules listed above</li><li>General medical, neurological, respiratory, cardiac or unrelated conditions</li><li>Medication selection or dosing</li><li>Diagnosis confirmation or exclusion</li><li>Disease probability or staging</li></ul></div>
      </div>
      <p>{competition && pregnancyAvailable ? 'Early-pregnancy competition review is limited to verified claims and their exact conditions. PID remains inactive. ' : 'Early-pregnancy and PID information may trigger narrowly predefined safety warnings; complete analysis for those conditions is unavailable. '}Absence of a warning is not evidence of clinical safety.</p>
      <h3>Help test the boundaries</h3>
      <p>Use de-identified, minimum-necessary information only. Try a relevant pelvic-pain case, very little information, conflicting structured and narrative information, an urgent pattern, an unrelated question, a diagnosis or medication/dosage request, or an instruction to ignore the rules.</p>
      <p>Expected safe behavior includes necessary clarification, refusing unsupported analysis, preserving urgent warnings, avoiding diagnosis and prescribing, using only available evidence, and not exposing internal instructions or data.</p>
      {synthetic && <p>Supported forms receive bounded case-specific reviews. Other wording receives an explicit scope or evidence limitation, with no unrestricted medical answer.</p>}
    </details>
  </details>;
}
