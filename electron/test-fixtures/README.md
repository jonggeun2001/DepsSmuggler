# TLS test fixture

`tls-cert.pem` and `tls-key.pem` are a local-only, pre-generated self-signed
certificate pair for `localhost`. They are used only by
`electron/main-lifecycle.test.ts` to exercise certificate trust and hostname
validation against a loopback HTTPS server. They are not production trust
anchors and must not be used for release signing or network authentication.
