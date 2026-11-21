# Temporary Production-runtime IAM verification

This separate diagnostic is deployed over the currently published application,
not the unreleased PR #4 application. It does not change Preview verifyIam.
Production chat remains disabled. No agent, clinical tool, metadata or model
endpoint is contacted. A successful build is not an authentication result.

`productionIamOnce` is a Netlify Scheduled Function (annual January 1 schedule).
Netlify rejects direct public URL invocation. The administrator uses the
authenticated Netlify dashboard: clinicalagent > Functions > productionIamOnce
> Run now. Do not run it until its Scheduled badge and correct Production deploy
are confirmed. Do not use a simulated local invocation as runtime evidence.

Defaults are disabled. For the single administrator-authorized test, set only
Production Functions values:

- ENDO_PRODUCTION_IAM_ENABLED=true
- ENDO_PRODUCTION_IAM_KILL_SWITCH=false
- ENDO_PRODUCTION_IAM_STARTED_AT=current UTC ISO timestamp
- ENDO_PRODUCTION_IAM_UNTIL=that timestamp plus at most ten minutes

Redeploy after changing Functions configuration. Keep public/model inference
disabled, ENDO_DEMO_KILL_SWITCH=true, ENDO_CHAT_KILL_SWITCH=true and telemetry
disabled. Never retrieve a management API secret and submit it to IAM: Secrets
Controller masks those values. Only the hosted runtime reads the real key.

The fixed immutable ticket `one-authorized-exchange` in the separate store
`EndoProductionIamOnceV1` is claimed atomically and strongly read back BEFORE
reading the key. Every deployment/window shares that ticket. Missing storage,
ambiguous ownership, expired settings or wrong site/context fail closed. Failures
consume the allowance; no retries, refunds, ticket deletion or re-arming.

Logs contain only status PASS/FAIL, iamHttp, fixed IBM errorCode (or null), and
runtimeConfigurationAccessed. A key-presence Boolean is not authentication proof.
The existing broker validates the returned token, then discards it. No keys,
tokens, fingerprints, request/response bodies, prompts or private errors are logged.

Immediately after the one execution, set ENABLED=false, KILL_SWITCH=true and clear
STARTED_AT/UNTIL, redeploy, then remove the Function and deploy the original
application again. Preserve the one-shot record. A repeated dashboard run must
never issue IAM again. Preserve all existing quota records. Final removal ends
the scheduled trigger; expiry already fails closed independently.

IAM success verifies this Production runtime credential only. It does not prove
Live tool bindings, connection permissions, IBM service allowance or chat works.
