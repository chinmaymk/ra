# OWASP Top 10 (2021) Quick Reference

## A01:2021 — Broken Access Control
**What:** Users act outside their intended permissions.
**Check for:** Missing auth on endpoints, IDOR (changing IDs to access other users' data), missing function-level access control, CORS misconfiguration.
**Fix:** Deny by default, enforce ownership checks, disable directory listing, log access failures.

## A02:2021 — Cryptographic Failures
**What:** Failures related to cryptography leading to data exposure.
**Check for:** Data transmitted in cleartext, weak algorithms (MD5, SHA1, DES), hardcoded keys, missing encryption at rest.
**Fix:** Encrypt sensitive data, use strong algorithms (AES-256, bcrypt/argon2), manage keys properly.

## A03:2021 — Injection
**What:** Untrusted data sent to an interpreter as part of a command/query.
**Check for:** SQL injection, command injection, XSS, LDAP injection, template injection, path traversal.
**Fix:** Parameterized queries, input validation, output encoding, allowlists over denylists.

## A04:2021 — Insecure Design
**What:** Fundamental design flaws, not implementation bugs.
**Check for:** Missing rate limiting, no account lockout, business logic bypasses, no abuse case modeling.
**Fix:** Threat modeling, secure design patterns, reference architectures.

## A05:2021 — Security Misconfiguration
**What:** Missing or incorrect security hardening.
**Check for:** Default credentials, unnecessary features enabled, verbose error messages, missing security headers, outdated software.
**Fix:** Hardened defaults, remove unused features, automate configuration verification.

## A06:2021 — Vulnerable and Outdated Components
**What:** Using components with known vulnerabilities.
**Check for:** Outdated libraries, known CVEs, unsupported frameworks, no patch management.
**Fix:** Regular dependency updates, `npm audit` / `cargo audit`, monitor CVE databases.

## A07:2021 — Identification and Authentication Failures
**What:** Weaknesses in identity verification.
**Check for:** Credential stuffing (no rate limiting), weak passwords allowed, session fixation, missing MFA.
**Fix:** MFA, strong password policies, session rotation on login, rate limiting.

## A08:2021 — Software and Data Integrity Failures
**What:** Assuming software updates, data, and CI/CD pipelines are trustworthy without verification.
**Check for:** Unsigned updates, insecure deserialization, CI/CD without integrity checks.
**Fix:** Digital signatures, integrity verification, review CI/CD permissions.

## A09:2021 — Security Logging and Monitoring Failures
**What:** Insufficient logging to detect and respond to breaches.
**Check for:** Auth events not logged, errors not logged, no alerting, sensitive data in logs.
**Fix:** Log auth events, sanitize log output, set up alerting, audit trail.

## A10:2021 — Server-Side Request Forgery (SSRF)
**What:** Server fetches a URL supplied by the attacker.
**Check for:** User-supplied URLs fetched by server, access to internal services, cloud metadata endpoints.
**Fix:** URL allowlisting, network segmentation, disable redirects for server-side requests.
