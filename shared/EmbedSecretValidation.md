# Distinguish secret masking from a bad key

Netlify documents secret values as readable only by code running on Netlify:
https://docs.netlify.com/build/environment-variables/secrets-controller/
https://open-api.netlify.com/
Checked 7 November 2026. A masked, omitted or otherwise unreadable management
value is not a malformed PEM. The old CLI RSA diagnosis was unsound and has been
withdrawn. The original local private/public files passed format, strength,
public-identity and signing checks on 7 November 2026. The hosted key is still
unverified. No key update is indicated by the management-plane failure.

## Original local files

Run in PowerShell from the repository root, substituting the real absolute paths
to the existing originals outside Git. Arguments contain paths, never key bytes:

```powershell
node tools/checkLocalEmbedKey.ts 'C:\secure-location\private.pem' 'C:\secure-location\public.pem'
```

The helper reads originals only in memory, returns safe PASS/FAIL codes and checks
the actual signer's PKCS#8 format requirement, real newlines, RSA >=4096 bits,
matching local public fingerprint and ephemeral signing/verification. It writes
nothing, issues no JWT, and makes no network request. This is a match to the
supplied original public.pem, not proof of the Netlify pin or IBM registration.
Do not use the example paths literally or put originals in this repository.

## Prepared hosted diagnostic (not deployed or enabled)

`netlify/functions/verifyEmbedKey.ts` defines a read-only diagnostic at the direct
Function path `/.netlify/functions/verifyEmbedKey`. It is disabled unless the new
ORCHESTRATE_EMBED_DIAGNOSTIC_ENABLED flag is exactly true. It additionally requires
the existing PR #4 ID/origin pins, unpublished platform deploy-preview identity,
preview activation false, preview kill switch true and telemetry disabled. Trusted
Netlify context.user must be unexpired and match the existing operator allowlist.
Forged headers and CLI identity cannot authorize it. Production always fails.

Only after authorization does it read actual runtime key/pin bytes. It parses the
key, checks format/strength, derives the public fingerprint, compares the configured
pin and signs/verifies an ephemeral random challenge in memory. No JWT, public
fingerprint, private key, identity or exception details are returned. No IBM call,
quota access, case input, storage or logging exists. Results are fixed PASS/FAIL
reason codes with no-store headers. It accepts only a query-free GET. It does not
depend on IBM verification acknowledgements or the expired inference test window.

This is preparation only. A separate authorized preview deployment and explicit
diagnostic-only opt-in are needed before it can inspect the hosted runtime. No
activation flag, secret, Netlify setting or production configuration was changed.
After that controlled deployment, the authenticated operator can open the direct
Function URL on Preview #4 or fetch it from that preview's browser console:

```javascript
fetch('/.netlify/functions/verifyEmbedKey', {
  credentials: 'same-origin', cache: 'no-store', redirect: 'error'
}).then(response => response.json()).then(report => console.log(report));
```

Use https://deploy-preview-4--clinicalagent.netlify.app/ and its existing Netlify
team-login protection. The direct diagnostic URL is
https://deploy-preview-4--clinicalagent.netlify.app/.netlify/functions/verifyEmbedKey.
No manually constructed Authorization header, copied cookie or token is needed.
The diagnostic-only opt-in must already be explicitly authorized and configured
for preview Functions before that build; rebuilding alone does not enable it.
Do not change any setting as part of this code-update procedure. With no opt-in,
404 diagnosticDisabled is expected, not a signing failure. 403 operatorRequired
means the platform identity was missing, unlisted or expired. Only a 200 JSON
PASS/keyVerified establishes that the runtime signing key matches its configured
pin. A 200 FAIL supplies a bounded key-check reason. A 503 does not diagnose the
key. HTML/login responses are platform access responses, not diagnostic results.

The response contains only status and a fixed reason. Do not capture browser
cookies/headers or export HAR files. Disable the diagnostic after verification.
Passing validates the runtime key against its pin, not IBM's registered public key.
That registration and missing/expired/tampered JWT rejection remain manual IBM
checks. No key update is recommended until actual local/runtime results establish
the cause.
