# Protected Preview 4 operator-context diagnostic

Prepared locally only; deployment and configuration require separate approval.
Existing verifyEmbedKey reads signing material, while verifyQuota requires wider
isolation configuration. Neither is used as a substitute for this identity-only check.

The GET-only `/.netlify/functions/verifyOperatorContext` uses trusted platform
`context.user`, not cookies parsed by application code or identity headers. It
requires an allowlisted ID and a finite, unexpired Date, exact Preview 4 origin,
unpublished deploy-preview context, and the existing preview/operator pins.
It returns only `{"status":"authorized"}` or `{"status":"unauthorized"}`.
No identity, expiry, token, secret, quota, clinical or IBM operation is returned
or performed. A successful result grants no downstream permission.

Default: disabled. The proposed update includes these three files, ReleaseFiles.txt,
evaluation/review.json and the Python/TypeScript trusted seals. Only the new runtime
Function is added to the review bindings. Separate approval is needed to deploy
the scoped update and set `ORCHESTRATE_OPERATOR_DIAGNOSTIC_ENABLED=true` in Deploy Preview Functions
scope only. Do not enable the probe, start its window or change legacy flags.
Existing embedded activation must remain false and its kill switch true;
probe enable must be absent/false and probe kill must be absent/true.

After an approved protected preview rebuild, the authenticated operator can run
this GET from Preview 4's browser console (no cookies or tokens are copied):

```javascript
fetch('/.netlify/functions/verifyOperatorContext', {
  credentials: 'same-origin', cache: 'no-store', redirect: 'error'
}).then(async response => ({httpStatus: response.status, result: await response.json()}));
```

Only a 200 authorized result from the hosted Function proves this request received
an allowlisted unexpired platform identity. A Netlify login or edge 401 alone does
not. Repeat while signed out: access must be denied. Header spoofing is covered
locally; an authorized hosted negative test must remain GET-only and must not
carry copied credentials. Production and other previews must never authorize.
No new hosted result is claimed by local mocked tests. If real platform context
differs from the expected Date representation, fail closed and investigate rather
than coercing caller data. Disable the diagnostic after verification through a
separately approved operator configuration change.

## Deployment and rollback (not authorized by this document)

1. Recheck PR 4's remote head against 41cbe6efc3c8a1e49c8004470fb11356a6f9b984.
   Stop on unexpected changes. Review the exact seven-path diff and passing checks.
2. After explicit commit/push approval, add only the seven named paths individually
   from the isolated snapshot and update the existing feature branch normally.
   Do not merge main, force-push or change production.
3. Retain existing preview access protection. After explicit configuration approval,
   set only ORCHESTRATE_OPERATOR_DIAGNOSTIC_ENABLED=true in deploy-preview context,
   Functions scope. Do not change other scopes or production values. Rebuild only
   Preview 4 as authorized so the Function receives the setting; verify its commit.
4. Run the GET above as the allowlisted operator, then signed out. A platform HTML
   challenge is denial evidence, not a successful Function identity check. No POST,
   quota test, IBM request, signing-key operation or inference window is needed.
5. Disable the diagnostic after use. No other Endo feature should consume its result.

Fast rollback is a separately authorized preview-only setting change to
ORCHESTRATE_OPERATOR_DIAGNOSTIC_ENABLED=false and preview rebuild. For code rollback,
revert the scoped commit normally on the feature branch (including all three seals
and the release inventory together) and rebuild Preview 4. Baseline is
41cbe6efc3c8a1e49c8004470fb11356a6f9b984. Never rewrite history or alter main.

No hosted operator-context result has been obtained during preparation. Neither
this endpoint nor a successful identity check verifies IBM permissions, privacy,
retention, quotas or spending controls. Those remain separate release gates.
