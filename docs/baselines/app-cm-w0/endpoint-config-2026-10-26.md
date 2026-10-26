# B01 endpoint/config receipt — 26 October 2026

Collected at source `79a4f2703ffd34ad2b66999d3daf8b7516e90735`; integration base `fbfe68f0e40d386e6b3429abc2ea8f868fcdd3f6`. The owner authorizes W0-close.a/d only. Historical readings remain dated observations. All commands used Make with `ENV=test-app-w0` last; no local stack, restore or live writes.

The tenant-admin credential was decoded from root `.env` into a mode-600 temporary kubeconfig, removed on exit. No value was logged. Namespaced GETs used explicit kubeconfig and a 30-second timeout. [Raw metadata/hashes](endpoint-config-2026-10-26.txt) span 07:42:03–21Z; [public HTTPS probes](public-endpoints-2026-10-26.txt) span 07:42:21–24Z.

Commands: `kubectl get ingress,services,endpointslices,pods,configmaps,deployments -o json` as separate GETs in `sentropic` then `sentropic-preprod`; Secret reads used metadata-only custom columns `NAME,UID,RV`. Retained JSON selects metadata, selectors, ports, endpoint Pod targetRefs, imageIDs and config references only. No Secret data or application responses are retained.

Hash procedures (SHA-256): ConfigMaps use `jq -Sc '{data,binaryData,immutable}'` including its trailing newline; Deployment hashes use `jq -Sc '.spec.template'` likewise. Each digest immediately follows its object's metadata. Inside each existing API/IdP container, Node hashes `JSON.stringify(Object.fromEntries(Object.entries(process.env).sort(([a],[b])=>a.localeCompare(b,"en"))))`; only the digest leaves the process. This attests exec-inherited container environment, including transient pod identity, rather than an application-transformed runtime object. UI exec runs `sha256sum /etc/nginx/conf.d/default.conf`.

Endpoint binding: each exact app/IdP hostname appears in the tenant Ingress. App routes `/` to `ui:5173`; the running UI's Nginx file hashes to `993c4106fc3ca00166ca15e9d0ba0fb6f8c619314376143133c510b910909c94` in both namespaces and maps `/api/v1/*` to `api:8787`. Service selectors and ready EndpointSlice Pod UIDs match the retained live pod metadata. IdP routes directly to `auth-idp:8787`. Public TLS validation succeeds; all four hostnames connect to `51.79.100.177`. Ingress loadBalancer status is empty; this receipt combines the host routing, ready endpoints, running proxy file and successful public probes, without claiming a unique cryptographic response-to-pod attestation.

Production health/session/MCP statuses are **200/401/404**; preprod **200/401/401**. Both IdP discovery responses are JSON 200 with their configured issuers. Response-body digests are retained, not bodies. Authenticated MCP parity remains W2 qualification.

Production API/IdP image digest remains `f2173e9d37f525a3cef0d6148dded71765c594b775d54426486df90d82a2cbe3`; UI remains `a3b3458814a7e91aaf1b94728d51222c1b8c35c196ec980c152c9c17e684b316`. Preprod now uses API/IdP `a47fbfd8d0bb4140e15b0652e9e60b9f70c309cda1d273158c6ed64f9429b6ee` and UI `bdb995da6d046654251bd11697172b9222a00af0aed56fdcb129d819f16d2466`; this supersedes no historical reading and does not prove app artifacts activation.

Raw metadata SHA-256: `9a941051389040cc1248064114e0f7a28e8336b22d380802c55beefa1a8c9ecd`; public-probe file: `220f9f5f0423444fa85cb93878aebb3e806a860e81ea09b931c264901a570c79`. These supply B01's remaining baseline evidence; W5 must refresh the actual deployment/config tuple.
