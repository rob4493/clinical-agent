# Licensing boundaries

Apache License 2.0 applies only to original project code, original documentation and original configuration contributed by their owners. It does not license clinical sources, medical publications, external standards, trademarks or any other third-party content. References, identifiers, hashes and official links do not grant source-use rights or imply endorsement.

No third-party PDF, captured web page, clinical knowledge document or private source-derived runtime claim package is distributed with the source-free release. This includes NICE, ACOG, ACEP/Elsevier, WHO, NICHD and CDC artifacts. Even where an organization permits some reuse, this release does not assert a document-specific permission. Knowledge-base documents and review packets are also withheld conservatively because their embedded third-party material has not been cleared.

The `evaluation/` packages contain newly written project-authored summaries of factual propositions, with bibliographic attribution and official links. They do not distribute the private runtime claim packages or underlying publications, and they are not reproductions of or replacements for those publications. Their original project-authored expression falls within the project's original-work licensing boundary; referenced third-party expression, publications and trademarks do not. Evaluation review, attribution and similarity checks confer neither clinical approval nor a licence to any third-party material. Competition mode uses these summaries independently of protected originals; authentic clinical approval remains unchanged.

An authorized operator must independently obtain the exact files listed in EvidenceSources.example.json and confirm permission for the intended private evaluation, processing and display. Permission to download is not necessarily permission to redistribute, process with AI or expose to testers. Installation confirms bytes, not licence rights, clinical approval or currency. Do not bypass publisher restrictions.

Dependency packages retain their respective licences and notices; Apache 2.0 does not relicense React, Vite, FastAPI, PyMilvus or other dependencies. They are installed separately through declared requirements and the npm lockfile. Before distributing a compiled frontend or packaged dependency environment, preserve required dependency notices and review the actual installed dependency licence inventory. No dependency binaries are included in this source release.

Names and trademarks are used only to identify referenced organizations and technologies. No affiliation, endorsement, regulatory approval, clinical validation or production readiness is claimed.

## Browser runtime dependency notice

Netlify's build platform injects its own serverless runtime wrappers. The locally verified `@netlify/serverless-functions-api` 2.24.0 is MIT-licensed, Copyright (c) 2023 Netlify. Its unchanged permission/copyright notice is preserved in `netlify/RuntimeNotice.txt` and included separately in the function artifact. This third-party grant does not change the Apache scope of original project code or grant any rights to clinical publications. The isolated Netlify CLI is development tooling, not an application dependency or source-release artifact.

The current browser build bundles React, React DOM and Scheduler, which carry the following MIT licence. The browser notice also preserves Vite's MIT licence for its generated browser helper. Both licence texts are included as `THIRD_PARTY_NOTICES.txt` in the built website through `frontend/public`. Keep it with distributed browser builds. These are separate third-party grants, not an extension of the project's Apache licence.

MIT License

Copyright (c) Meta Platforms, Inc. and affiliates.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
