# Security Checklist (OWASP Top 10)

## Injection
- SQL injection via unsanitized input in queries
- Command injection via shell execution with user data
- LDAP injection, XPath injection

## Broken Authentication
- Hardcoded credentials in source code
- Weak session management
- Missing rate limits on auth endpoints

## Sensitive Data Exposure
- Secrets in code, logs, or error messages
- Missing encryption for data in transit/at rest
- API keys committed to version control

## XML External Entities (XXE)
- Unsafe XML parsing with external entity processing enabled

## Broken Access Control
- Missing authorization checks
- Insecure Direct Object References (IDOR)
- Privilege escalation paths

## Security Misconfiguration
- Debug mode in production
- Default credentials
- Overly permissive CORS
- Unnecessary services/ports exposed

## Cross-Site Scripting (XSS)
- Unescaped user input rendered in HTML
- DOM-based XSS via innerHTML or document.write

## Insecure Deserialization
- Untrusted data deserialized without validation
- Pickle, eval, or similar dangerous deserializers

## Known Vulnerabilities
- Outdated dependencies with published CVEs
- Using deprecated/unmaintained packages

## Insufficient Logging
- Missing audit trails for sensitive operations
- No alerting on suspicious patterns

## Common Bug Patterns
- Off-by-one errors in loops and slicing
- Null/undefined on optional chains
- Race conditions (missing await, shared mutable state)
- Resource leaks (unclosed files, connections, streams)
- Error swallowing (empty catch blocks)
- Type coercion bugs (== vs ===)
