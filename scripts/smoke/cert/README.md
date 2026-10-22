# Test-only certificate

`smoke-test-only.cert.pem` and `smoke-test-only.key.pem` are a self-signed ECDSA P-256 pair used
only by `scripts/smoke/fixtureServer.ts` to speak HTTPS to a Chrome that is launched with
`--ignore-certificate-errors`. The private key is deliberately public: it protects nothing and
must never be trusted by a real browser profile or installed in any keychain.

Node 24 can parse X.509 certificates (`crypto.X509Certificate`) but cannot issue one, which is why
the pair is committed instead of generated at runtime. To regenerate:

```bash
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes \
  -keyout smoke-test-only.key.pem -out smoke-test-only.cert.pem -days 36500 \
  -subj "/CN=Botdar smoke fixture server (test only)" \
  -addext "subjectAltName=DNS:x.com,DNS:twitter.com,DNS:www.reddit.com,DNS:old.reddit.com,DNS:bsky.app,DNS:localhost"
```
