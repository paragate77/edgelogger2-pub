# Product Requirements Document (PRD)
## EdgeLogger — Cloudflare Workers HTTP Logging Proxy

**Version:** 2.0
**Date:** 2026-04-06
**Status:** Active

---

## 1. Overview

EdgeLogger is a serverless HTTP logging proxy deployed on Cloudflare Workers. It transparently intercepts HTTP traffic, captures request and response details according to configurable settings, and surfaces logs via Cloudflare Workers Logs or LogPush. It returns the upstream response to the caller unmodified.

Key capabilities:
- **Error-driven logging** — logs only on 4xx/5xx responses by default
- **Sensitive header masking** — masks credential and session header values in logs and debug headers
- **Range header sanitization** — removes malformed Range headers before forwarding to origin
- **LogPush debug headers** — injects serialized headers for full visibility in LogPush datasets

---

## 2. Problem Statement

During API development and production debugging, engineers need visibility into exact HTTP traffic between client and backend — including headers, body payloads, and response data. Existing solutions require instrumenting the client or server directly, which is invasive and not always possible.

EdgeLogger solves this by sitting at the edge as a pass-through proxy with zero changes to the client or upstream server. Configurable log coverage and error-only mode keep noise low while capturing exactly what matters.

---

## 3. Goals

- Capture HTTP request and response data for any proxied traffic
- Log only on error responses (4xx/5xx) by default to minimize noise
- Mask sensitive header values in all log output and debug headers
- Allow full debug header capture for LogPush integration
- Strip malformed Range headers before they reach origin
- Introduce zero modification to the request or response observed by the client or upstream
- Produce human-readable log output for inspecting payloads
- Be deployable on Cloudflare's edge network via a single command

---

## 4. Non-Goals

- Not a production-grade API gateway or reverse proxy
- Not a security or access-control layer
- Does not store, index, or search logs (delegated to Cloudflare's logging infrastructure)
- Does not implement routing, load balancing, or rate limiting

---

## 5. Target Users

| User | Use Case |
|------|----------|
| Backend developer | Debug API requests/responses in development or staging |
| Frontend developer | Inspect exact payloads sent to a backend |
| QA engineer | Verify HTTP contract between services |
| Platform engineer | Audit third-party webhook payloads via LogPush |

---

## 6. Functional Requirements

### 6.1 Log Mode

| ID | Requirement |
|----|-------------|
| F-01 | The Worker MUST support a `LOG_MODE` environment variable |
| F-02 | `LOG_MODE = "errors"` (default) MUST emit logs only when response status >= 400 |
| F-03 | `LOG_MODE = "all"` MUST emit logs for every request |
| F-04 | When `LOG_MODE` is not set, the Worker MUST default to `"errors"` |

---

### 6.2 Log Coverage

| ID | Requirement |
|----|-------------|
| F-05 | The Worker MUST support a `LOG_COVERAGE` environment variable |
| F-06 | `LOG_COVERAGE` MUST accept: `req_headers`, `req_full`, `res_headers`, `res_full`, `headers`, `full` |
| F-07 | When `LOG_COVERAGE` is not set or invalid, the Worker MUST default to `"headers"` |

**Coverage mode reference:**

| Value | Req Headers | Req Body | Res Headers | Res Body |
|-------|:-----------:|:--------:|:-----------:|:--------:|
| `req_headers` | ✓ | | | |
| `req_full` | ✓ | ✓ | | |
| `res_headers` | | | ✓ | |
| `res_full` | | | ✓ | ✓ |
| `headers` | ✓ | | ✓ | |
| `full` | ✓ | ✓ | ✓ | ✓ |

---

### 6.3 Sensitive Header Masking

| ID | Requirement |
|----|-------------|
| F-08 | The Worker MUST mask sensitive header values as `****` in all log output |
| F-09 | Sensitive header detection MUST cover authorization, cookie, token, key, secret, session, password, and CSRF/XSRF header-name patterns |
| F-10 | The Worker MUST mask sensitive header values in `x-debug-req-headers` and `x-debug-res-headers` |
| F-11 | Masking MUST apply to both request and response headers |

---

### 6.4 Body Safety

| ID | Requirement |
|----|-------------|
| F-12 | When `LOG_COVERAGE` does not include body, the Worker MUST NOT read or clone the request/response body |
| F-13 | When body logging is enabled, the Worker MUST clone before reading to preserve the original stream |
| F-14 | Body logging MUST be skipped for non-text content types (binary, multipart, images, etc.) |
| F-15 | Body logging MUST be truncated at `MAX_BODY_SIZE` bytes with a truncation notice |

---

### 6.5 Latency Tracking

| ID | Requirement |
|----|-------------|
| F-16 | Every response log MUST include the request-to-response duration in milliseconds |
| F-17 | Duration MUST be measured from Worker entry to upstream response received |

---

### 6.6 Range Header Sanitizer

| ID | Requirement |
|----|-------------|
| F-18 | When `RANGE_SANITIZER_ENABLED = "true"`, the Worker MUST validate Range headers on GET and HEAD requests |
| F-19 | Validation MUST follow RFC 9110 §14.1 single-range syntax: `bytes=<start>-<end>` |
| F-20 | If the Range header is malformed, the Worker MUST remove it before forwarding to origin |
| F-21 | The Worker MUST always add `x-debug-range-removed: true\|false` to every response when sanitizer is enabled |
| F-22 | When Range is removed, the Worker MUST add `x-debug-range-original: <original-value>` to the response |
| F-23 | Range sanitizer MUST NOT apply to POST, PUT, PATCH, DELETE, or other non-GET/HEAD methods |

---

### 6.7 LogPush Debug Headers

| ID | Requirement |
|----|-------------|
| F-24 | When `ALL_HEADERS_ENABLED = "true"`, the Worker MUST serialize request headers into `x-debug-req-headers` and inject it into the forwarded request |
| F-25 | `x-debug-req-headers` MUST reflect headers **after** Range sanitization (i.e. without the removed Range header) |
| F-26 | The Worker MUST serialize response headers into `x-debug-res-headers` and inject it into the response |
| F-27 | Serialization format MUST be `key=value; key=value; ...` |
| F-28 | `cf-*` headers MUST be excluded from both `x-debug-req-headers` and `x-debug-res-headers` |
| F-29 | The following headers MUST be excluded from `x-debug-req-headers`: `user-agent`, `referer`, `host`, `content-type`, `content-length`, `accept`, `accept-encoding`, `accept-language`, `authorization`, `cookie` |
| F-30 | The following headers MUST be excluded from `x-debug-res-headers`: `content-type`, `content-length`, `content-encoding`, `server`, `date`, `set-cookie` |

---

### 6.8 Log Format

```
>>> REQ/<requestId>  <METHOD> <path>
  -- ◀ REQUEST HEADERS
  <header-name>  <header-value>
  ...
────────────────────────────────────────

<<< RES/<requestId>  <METHOD> <path>  <status> <statusText>  (<duration>ms)
  -- ▶ RESPONSE HEADERS
  <header-name>  <header-value>
  ...
────────────────────────────────────────
```

- `>>>` denotes a request section
- `<<<` denotes a response section
- Only sections enabled by `LOG_COVERAGE` are emitted
- `cf-*` headers are excluded from log output
- Logs are emitted only when `LOG_MODE` condition is met

---

## 7. Non-Functional Requirements

| ID | Requirement |
|----|-------------|
| NF-01 | The Worker MUST NOT clone request body unless body logging is explicitly enabled |
| NF-02 | The Worker MUST be deployable via a single `wrangler deploy` command |
| NF-03 | The codebase MUST pass TypeScript strict-mode type checking |
| NF-04 | The Worker MUST be compatible with Cloudflare Workers runtime compatibility date `2024-09-14` or later |
| NF-05 | `wrangler.toml` MUST be git-ignored; `wrangler.example.toml` MUST be committed as the setup template |

---

## 8. Technical Architecture

### Runtime
- **Platform:** Cloudflare Workers (serverless edge, `workerd` runtime)
- **Language:** TypeScript 5.6+
- **Tooling:** Wrangler 4.x, esbuild (via Wrangler)

### Request Flow

```
Client Request
      │
      ▼
┌──────────────────────────────────────────────┐
│              Cloudflare Workers              │
│                                              │
│  1. Parse env vars (LOG_MODE, LOG_COVERAGE,  │
│     RANGE_SANITIZER_ENABLED,                 │
│     ALL_HEADERS_ENABLED)                     │
│                                              │
│  2. [if RANGE_SANITIZER] Validate Range      │
│     └─ malformed → remove Range header       │
│                                              │
│  3. [if ALL_HEADERS] Snapshot req headers    │
│     → inject x-debug-req-headers             │
│     (after range removal)                    │
│                                              │
│  4. Buffer request log lines                 │
│                                              │
│  5. fetch(forwardRequest) → upstream         │
│     └─ on error: log + return 502            │
│                                              │
│  6. Measure latency                          │
│                                              │
│  7. [if ALL_HEADERS] Snapshot res headers    │
│     → inject x-debug-res-headers             │
│                                              │
│  8. [if RANGE_SANITIZER] Inject              │
│     x-debug-range-removed                   │
│     x-debug-range-original (if removed)     │
│                                              │
│  9. [if LOG_MODE condition met] Emit logs    │
│                                              │
│  10. Return final response                   │
└──────────────────────────────────────────────┘
      │
      ▼
Client Response
```

---

## 9. Configuration

| Parameter | Default | Description |
|-----------|---------|-------------|
| `LOG_MODE` | `errors` | `errors` = 4xx/5xx only, `all` = every request |
| `LOG_COVERAGE` | `headers` | Controls which parts of traffic are logged |
| `MAX_BODY_SIZE` | `10000` | Max body bytes to log (truncates beyond limit) |
| `RANGE_SANITIZER_ENABLED` | `false` | Enable malformed Range header removal |
| `ALL_HEADERS_ENABLED` | `false` | Enable full header capture for LogPush |

---

## 10. Debug Response Headers

| Header | Condition | Description |
|--------|-----------|-------------|
| `x-debug-req-headers` | `ALL_HEADERS_ENABLED=true` | Serialized request headers sent to origin |
| `x-debug-res-headers` | `ALL_HEADERS_ENABLED=true` | Serialized response headers from origin |
| `x-debug-range-removed` | `RANGE_SANITIZER_ENABLED=true` | `true` if Range was removed, `false` otherwise |
| `x-debug-range-original` | Range was removed | Original malformed Range header value |

### LogPush Field Mapping

| Header | LogPush Field |
|--------|--------------|
| `x-debug-req-headers` | `ClientRequestHeaders["x-debug-req-headers"]` |
| `x-debug-res-headers` | `EdgeResponseHeaders["x-debug-res-headers"]` |
| `x-debug-range-removed` | `EdgeResponseHeaders["x-debug-range-removed"]` |
| `x-debug-range-original` | `EdgeResponseHeaders["x-debug-range-original"]` |

---

## 11. Supported Content Types

| Content-Type | Body Logging |
|---|---|
| `application/json` | Pretty-printed JSON (truncated at `MAX_BODY_SIZE`) |
| `application/x-www-form-urlencoded` | `key: value` pairs |
| `text/*` | Raw text (truncated at `MAX_BODY_SIZE`) |
| `multipart/form-data` | Skipped (`binary body skipped`) |
| `image/*`, `application/octet-stream`, others | Skipped (`binary body skipped`) |

---

## 12. Known Limitations

| Risk | Description | Mitigation |
|------|-------------|------------|
| Sensitive data exposure | Logged headers may include sensitive values | Sensitive header-name patterns are masked |
| Large body payloads | Very large bodies increase memory and CPU time | `MAX_BODY_SIZE` truncation + `headers`-only mode |
| HEAD requests | WAF may block HEAD requests before reaching Worker | Expected behavior — not a Worker issue |
| LogPush field size | Single LogPush field max ~8KB | Long header sets may be truncated |
| Private domain exposure | `wrangler.toml` contains real domain and route config | `wrangler.toml` is git-ignored |

---

## 13. Acceptance Criteria

- [x] `LOG_MODE=errors` emits logs only for 4xx/5xx responses
- [x] `LOG_MODE=all` emits logs for every request
- [x] `LOG_COVERAGE=headers` logs request + response headers only
- [x] `LOG_COVERAGE=full` logs headers + body for both directions
- [x] Sensitive headers masked in logs and debug headers
- [x] Binary body types are skipped without breaking the request
- [x] Body larger than `MAX_BODY_SIZE` is truncated with a notice
- [x] Response log includes latency in milliseconds
- [x] `RANGE_SANITIZER_ENABLED=true` removes malformed Range on GET/HEAD
- [x] `x-debug-range-removed` always present when sanitizer enabled
- [x] `x-debug-range-original` present only when Range was removed
- [x] `x-debug-req-headers` excludes removed Range header
- [x] `ALL_HEADERS_ENABLED=true` injects `x-debug-req-headers` and `x-debug-res-headers`
- [x] `cf-*` headers excluded from all debug headers and log output
- [x] All 33 test cases pass (`./test/test.sh`)
- [x] `wrangler deploy` succeeds and Worker is reachable on configured route
