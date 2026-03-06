# Code Review Reference Guide

## Security Checklist (OWASP Top 10)

- **Injection** — SQL, command, LDAP injection via unsanitized input
- **Broken Auth** — Hardcoded credentials, weak session handling, missing rate limits
- **Sensitive Data Exposure** — Secrets in code/logs, missing encryption, overly broad API responses
- **XXE** — Unsafe XML parsing with external entities enabled
- **Broken Access Control** — Missing authorization checks, IDOR, privilege escalation
- **Misconfig** — Debug mode in production, default credentials, overly permissive CORS
- **XSS** — Unescaped user input in HTML/JS output
- **Insecure Deserialization** — Untrusted data deserialized without validation
- **Known Vulnerabilities** — Outdated dependencies with known CVEs
- **Insufficient Logging** — Missing audit trails for security-sensitive operations

## Common Bug Patterns

- Off-by-one errors in loops and slicing
- Null/undefined not handled on optional chains
- Race conditions in async code (missing await, shared mutable state)
- Resource leaks (unclosed files, connections, streams)
- Error swallowing (empty catch blocks)
- Type coercion bugs (== vs ===, implicit conversions)
- Incorrect error propagation (losing stack traces, wrong error types)

## Performance Anti-Patterns

- N+1 queries (loop of DB calls instead of batch)
- Unbounded collections (no pagination, loading entire tables)
- Synchronous I/O blocking event loop
- Unnecessary re-renders (missing memoization, unstable keys)
- String concatenation in hot loops (use buffer/builder)
- Missing indexes on frequently queried columns
