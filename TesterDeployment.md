# Tester hosting configuration

This is a competition evaluation build, not an approved clinical service. Use fictional cases only. No live IBM/Milvus provider is configured and no authentic module or pending source is approved by deployment. This change prepares configuration; it does not deploy a site or assign a backend URL.

## Netlify frontend

Connect the public repository in Netlify and use the root `netlify.toml`. Its base is `frontend`, build command is `npm run build` and publish directory is `dist` relative to that base: **frontend/dist**. Node is pinned to the locally verified **24.21.0**. Netlify installs the locked frontend dependencies from the base directory; no Python/evidence files are published. Do not upload the repository or private storage as a static directory. The SPA fallback serves index.html for client-side navigation.

Until a backend is assigned, `/api/*` returns the fixed local unavailable document with status 404, ahead of the SPA fallback. Analyze stays disabled, the module selector stays unavailable and a visible message explains that a configured, reachable backend is required. The frontend still rejects malformed or HTML API responses. It never fabricates module availability or clinical output.

`VITE_BACKEND_URL` configures Vite's **local development/preview proxy only**. Setting it in Netlify does not configure a production proxy and cannot enable Analyze. Browser requests always use same-origin `/api/*`. Never put credentials, evidence, provider URLs or private filesystem paths in any VITE variable.

When the Python host assigns its actual reviewed HTTPS origin, replace the commented `<VERIFIED_BACKEND_ORIGIN>` marker in netlify.toml and uncomment that entire proxy rule. Keep it **before** the local `/api/*` fallback and the SPA rule:

```toml
# Template only: substitute the real assigned HTTPS origin before enabling.
# [[redirects]]
# from = "/api/*"
# to = "<VERIFIED_BACKEND_ORIGIN>/:splat"
# status = 200
# force = true
```

The proxy strips `/api` so `/api/v1/analyze` reaches `/v1/analyze` and `/api/ready` reaches `/ready`. Preserve response status/body and `X-Clinical-Mode`; do not cache API responses or enable request/body capture, analytics or payload logging. Verify GET discovery/readiness and POST analysis through the actual proxy before opening testing. Confirm client-disconnect and request-deadline behavior through the host; local cancellation tests cannot establish CDN/proxy buffering behavior. Netlify routing configuration is not backend authorization.

## Python backend host

Use Python **3.12** and the repository root as working directory. Install declared dependencies in the host's isolated environment:

```sh
python -m pip install -c backend/constraintsMilvus.txt setuptools==81.0.0 -r backend/requirements.txt
python -m pip check
python -B -m tools.serveTester
```

The host supplies `PORT`. It must be a decimal integer from 1 through 65535; missing or invalid ports fail with a sanitized error. The launcher binds **0.0.0.0**, uses one worker, disables access logs and does not trust forwarded headers. Do not use the loopback-only tools.runDemo launcher for a hosted service. No external client is created during import, construction, health or readiness checks.

Configure environment settings in the host dashboard, not Git or a real committed .env:

| Setting | Default/source-free state | Controlled competition setting |
|---|---|---|
| `PORT` | Assigned by host; required | Assigned by host; required |
| `CLINICAL_RUNTIME_MODE` | `standard` | `competition` |
| `CLINICAL_DEMO_MODE` | `false` | `false` |
| `LANGUAGE_PROVIDER` | `disabled` | `disabled` |
| `CLINICAL_TESTER_PROVIDER` | `disabled` | `deterministic` only when deliberately opting into offline generated responses |
| `CLINICAL_EVIDENCE_ROOT` | Omit entirely | Absolute private read-only mount, outside the application checkout/image directory |
| `DEBUG` | `false` | `false` |

`standard` has no selectable authentic modules and readiness remains 503. Explicit `CLINICAL_RUNTIME_MODE=synthetic` runs the existing fictional demo without private sources. Competition with `CLINICAL_TESTER_PROVIDER=disabled` stays provider-unavailable; this is not silently replaced with a fake or live model. The deterministic option composes the existing evaluation provider and must not be represented as live model generation or clinically validated analysis. Production mode and live language providers are rejected by this offline tester launcher.

Follow [private evidence installation](EVIDENCE_INSTALLATION.md) to obtain and verify the complete exact inventory legally. Install it in an external directory **before** runtime configuration, then mount it privately read-only. The launcher verifies filenames, sizes, hashes, source/module identities, original inactive configurations and package/claim bindings before competition startup. Missing, altered, stale or incorrectly installed evidence prevents startup. Routine analysis is not returned as a fallback. Do not place protected bytes in Git, frontend/public, release archives, image layers, Docker build contexts, build arguments or environment values. `.dockerignore` remains default-deny; no Docker image or Dockerfile is supplied. A native Python host needs private persistent-volume support; a host without it cannot run the competition package.

Use `/health` for liveness and `/ready` for readiness, on the host-assigned port. `/ready` may return 200 for an available synthetic/competition graph, never authentic clinical readiness. Neither endpoint contacts a provider. Do not require `/ready` to return 200 for the deliberately closed standard graph. Read-only evidence and rolling restarts must preserve complete matching code/package versions; switch the code and verified volume together to roll back.

## Before enabling tester access

Assign the backend origin and private storage, verify publisher processing/display permissions and retain the licensing boundaries. Review host TLS, access control, public backend exposure, log retention, proxy timeouts and response headers. Those infrastructure decisions are not implemented by this configuration. Keep real patient information out. No authentication, deployment, source approval, live provider connection or authentic activation is added here. If any prerequisite is missing, keep the API fallback and Analyze unavailable.

Configuration references reviewed 2026-10-15: [Netlify file-based configuration](https://docs.netlify.com/build/configure-builds/file-based-configuration/), [redirect status options](https://docs.netlify.com/manage/routing/redirects/redirect-options/), [proxy/SPA rewrites](https://docs.netlify.com/manage/routing/redirects/rewrites-proxies/). Python-host arguments were checked against installed Uvicorn 0.32.1; deployment tests use mocks rather than opening a public listener.
