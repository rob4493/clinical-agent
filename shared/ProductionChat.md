# Disabled competition chat release

This release is selected from PR #4 onto main, not a wholesale merge. It retains
the reported-facts and safety-negation fixes, 78 claims and original clinical UI.
It excludes embedded chat, probe/metadata/IAM/quota/operator diagnostics, preview
activation scripts, preview authorization and experimental guided-workflow changes.
Only evaluate and converse are deployed Functions. PR #4 stays draft and unchanged.

The operator reports successful Blue Lantern and editable first/follow-up turns on
Preview #4. This is evidence of preview connectivity, not clinical correctness or
Production access, Live tool-binding verification, or public abuse enforcement.

Production chat is disabled by default, including if preview flags are inherited.
The existing site and structured case review continue independently. The widget
checks a read-only capability and explicitly shows disabled status. It does not
silently simulate IBM or automatically submit case data/documents. A request for
structured review points to the existing form, with three-state facts and original
renderedText preserved. No claims, warnings, sources or clinical schema change.

## Prepared access controls

- Exact clinicalagent.netlify.app origin; trusted production, published deployment.
- Separate competition access code, no IBM/end-user account required. A valid code
  and synthetic-only attestation issue an HttpOnly, Secure, SameSite=Strict host-only
  signed visitor cookie. The code is never forwarded to IBM or stored in quota data.
- Separate server secret; encrypted operator-independent conversation receipts,
  server-owned provider threads, immutable ownership/readback and one-use turn locks.
- Visitor cookie at most 60 minutes, conversation at most 12 turns; deployment window
  at most four hours. Per-turn 1,600 characters, request 24 KiB, reply 4,000 characters.
- Frozen site-wide daily limits: at most 50 calls and 20 conversations, configurable
  downward. New production namespace EndoPublicConversationV1, no historical resets.
  All calls reserve before IAM, including failed attempts. No retries or refunds.
- Declarative IP/domain rate rule 12 requests/minute; rule configuration is not
  evidence of hosted platform enforcement. A leaked shared code can permit others
  to consume the bounded quota; it is invitation access, not strong person identity.
- Existing privacy/urgent screens on latest and verified conversation history;
  halt is persistent for that conversation. No canonical case changes or transcript
  storage. Explicit New conversation clears local history. Failed drafts remain.
- Verified IBM parser rejects action-bearing output; discussion rejection screening
  stays separate from protocol parsing. Discussion is labelled AI-generated and
  never promoted to validated evidence. Screening is not semantic clinical validation.

## Mandatory blockers before enabling

No Production IBM request is authorized by this release. Netlify declares the IBM
credential as a secret with a Production binding; the CLI returns no readable value.
That does not prove either absence or runtime availability. Confirm the existing
secret is populated for Production Functions without exposing it; only correct its
binding if necessary. Production IAM remains untested, with no extra diagnostic.

Effective IBM-side tool destinations, connection authentication and indirect actions
remain unverified. Independently verify/enforce only the approved operations and
appropriate downstream bounds before public activation. A shared code, an agent
instruction, local output rejection, or ENDO_CHAT_TOOL_POLICY value does not prove
remote action prevention. Do not set that policy based only on self-report.

Obtain explicit authorization for a bounded invitation-only synthetic demo, privacy/
retention scope and residual internal usage/cost risks. Enforceable service spending
caps remain unproven. Public unrestricted chat is not included.

## Future configuration, only after separate activation authorization

Production Functions (never frontend VITE variables):

```text
ENDO_CHAT_ENABLED=false                 # true only after authorization/checks
ENDO_CHAT_KILL_SWITCH=true               # false only for authorized session
ENDO_CHAT_TOOL_POLICY=blocked            # approved-operations-enforced requires evidence
ENDO_CHAT_STARTED_AT=                    # fresh ISO UTC
ENDO_CHAT_UNTIL=                         # <= four hours from start
ENDO_CHAT_DAILY_CALL_LIMIT=50
ENDO_CHAT_DAILY_SESSION_LIMIT=20
ENDO_CHAT_ACCESS_CODE=                   # securely generated >=20 chars, distribute privately
ENDO_CHAT_SESSION_SECRET=                # independently generated >=32 chars, server-only
```

Existing reviewed target must be EU-DE Live and UUID
c6698d4e-a08d-4b77-bf05-139ff3b4c695, auth iam and existing API key present.
OTEL_SDK_DISABLED=true, ORCHESTRATE_ENABLED=false,
ENDO_DEMO_INFERENCE_ENABLED=false, ENDO_DEMO_KILL_SWITCH=true remain required.
No preview exception or operator flags authorize Production. No new hosted values
were set by this release. Missing configuration always blocks.

After approved configuration/rebuild, GET /api/v1/conversation should return version
2 / available without storage or IBM access. Then separately authorize one fictional
education question and contextual follow-up through the website. Never auto-test.
Shutdown: disable ENDO_CHAT_ENABLED, engage ENDO_CHAT_KILL_SWITCH, clear start/expiry,
restore tool policy blocked, rebuild and verify blocked GET. Do not reset quotas.

## Rollback

Pre-release live deploy: 6af8e3c8a9a9e5646e4f1d38, main commit
3cd75a039a7fe50fbc66035f92b4c2fab6d97aaa. Restore that already-built Netlify
deploy if release verification fails. It does not alter quota records or IBM agent.
Preserve Preview #4 commit 90094079e37d5b3b61e89b0da8634d562c95ef4a for comparison.
The completed preview session was disabled in saved settings; a manual Preview #4
rebuild applies that shutdown. This is separate from the automatic main deployment.
