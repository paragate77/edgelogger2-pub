// ─────────────────────────────────────────────
//  LOG_COVERAGE modes
//
//  "req_headers"  – request headers only
//  "req_full"     – request headers + body
//  "res_headers"  – response headers only
//  "res_full"     – response headers + body
//  "headers"      – request headers + response headers
//  "full"         – everything (default)
// ─────────────────────────────────────────────
//
//  RANGE_SANITIZER_ENABLED
//  "true" – strip malformed Range headers before forwarding (GET + HEAD only)
//           adds x-debug-range-removed: true|false to every response
//
//  ALL_HEADERS_ENABLED
//  "true" – serialise request headers (minus skip list) into x-debug-req-headers
//           serialise response headers (minus skip list) into x-debug-res-headers
// ─────────────────────────────────────────────

export interface Env {
    LOG_MODE?: string;                  // "errors" | "all"
    LOG_COVERAGE?: string;
    MAX_BODY_SIZE?: string;             // bytes (only used when body logging is on)
    RANGE_SANITIZER_ENABLED?: string;  // "true" | "false"
    ALL_HEADERS_ENABLED?: string;      // "true" | "false"
}

// ─────────────────────────────────────────────
//  Skip lists for x-debug-req/res-headers
//  (headers already captured by LogPush or sensitive)
//  Note: cf-* headers are also excluded via isCfHeader()
// ─────────────────────────────────────────────

const SKIP_REQ_HEADERS = new Set([
    // already in LogPush default fields
    'user-agent',
    'referer',
    'host',
    'content-type',
    'content-length',
    'accept',
    'accept-encoding',
    'accept-language',
]);

const SKIP_RES_HEADERS = new Set([
    // already in LogPush default fields
    'content-type',
    'content-length',
    'content-encoding',
    'server',
    'date',
]);

// Mask credentials and session identifiers regardless of vendor-specific prefixes.
const SENSITIVE_HEADER_NAME = /(?:^|[-_])(?:access[-_]?token|api[-_]?key|auth(?:entication|orization)?|cookie|credential|csrf|key|password|secret|session|signature|token|xsrf)(?:$|[-_])/i;

// ─────────────────────────────────────────────
//  Range validation (RFC 9110 §14.1 single-range)
// ─────────────────────────────────────────────

const VALID_SINGLE_RANGE = /^bytes=(\d+-\d*|\d*-\d+)$/i;

// ─────────────────────────────────────────────
//  Config helpers
// ─────────────────────────────────────────────

type LogCoverage =
    | 'req_headers'
    | 'req_full'
    | 'res_headers'
    | 'res_full'
    | 'headers'
    | 'full';

function parseCoverage(value: string | undefined): LogCoverage {
    const valid: LogCoverage[] = ['req_headers', 'req_full', 'res_headers', 'res_full', 'headers', 'full'];
    if (value && (valid as string[]).includes(value)) return value as LogCoverage;
    return 'headers';
}

function shouldLog(coverage: LogCoverage, part: 'req_headers' | 'req_body' | 'res_headers' | 'res_body'): boolean {
    switch (coverage) {
        case 'req_headers': return part === 'req_headers';
        case 'req_full':    return part === 'req_headers' || part === 'req_body';
        case 'res_headers': return part === 'res_headers';
        case 'res_full':    return part === 'res_headers' || part === 'res_body';
        case 'headers':     return part === 'req_headers' || part === 'res_headers';
        case 'full':        return true;
    }
}

function isErrorMode(env: Env): boolean {
    return (env.LOG_MODE ?? 'errors') !== 'all';
}

function getMaxBody(env: Env): number {
    const n = Number(env.MAX_BODY_SIZE);
    return Number.isFinite(n) && n > 0 ? n : 10_000;
}

function isEnabled(value: string | undefined): boolean {
    return (value ?? '').toLowerCase() === 'true';
}

function isTextLike(contentType: string): boolean {
    if (!contentType) return false;
    const ct = contentType.toLowerCase();
    return (
        ct.includes('application/json') ||
        ct.startsWith('text/') ||
        ct.includes('application/x-www-form-urlencoded')
    );
}

// cf-* headers are Cloudflare-internal and excluded from all logging
function isCfHeader(key: string): boolean {
    return key.toLowerCase().startsWith('cf-');
}

function isSensitiveHeader(key: string): boolean {
    return SENSITIVE_HEADER_NAME.test(key);
}

function maskHeaderValue(key: string, value: string): string {
    return isSensitiveHeader(key) ? '****' : value;
}

// ─────────────────────────────────────────────
//  Header serialiser for x-debug-req/res-headers
//  Format: key=value; key=value; ...
//  Skips: skip list + cf-* headers; sensitive values are masked
// ─────────────────────────────────────────────

function serializeHeaders(headers: Headers, skipList: Set<string>): string {
    return [...headers.entries()]
        .filter(([k]) => !skipList.has(k.toLowerCase()) && !isCfHeader(k))
        .map(([k, v]) => `${k}=${maskHeaderValue(k, v)}`)
        .join('; ');
}

// ─────────────────────────────────────────────
//  Formatters — human-readable log output
// ─────────────────────────────────────────────

function formatHeaders(headers: Headers): string {
    const entries = [...headers.entries()]
        .filter(([k]) => !isCfHeader(k));
    if (entries.length === 0) return '  (none)';
    const maxKey = Math.max(...entries.map(([k]) => k.length));
    return entries
        .map(([k, v]) => `  ${k.padEnd(maxKey)}  ${maskHeaderValue(k, v)}`)
        .join('\n');
}

async function formatBody(r: Request | Response, maxBody: number): Promise<string> {
    const contentType = r.headers.get('content-type') ?? '';
    try {
        if (contentType.includes('application/json')) {
            const text = await r.text();
            const truncated = text.slice(0, maxBody);
            const formatted = (() => {
                try {
                    return JSON.stringify(JSON.parse(truncated), null, 2);
                } catch {
                    return truncated;
                }
            })();
            return (text.length > maxBody ? `${formatted}\n  (truncated, ${text.length} bytes)` : formatted)
                .split('\n').map(l => `  ${l}`).join('\n');
        }
        if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('form')) {
            const form = Object.fromEntries(await (r as Request).formData());
            return Object.entries(form)
                .map(([k, v]) => `  ${k}: ${v}`)
                .join('\n');
        }
        const text = await r.text();
        const truncated = text.slice(0, maxBody);
        return text.length > maxBody
            ? `${truncated}\n  (truncated, ${text.length} bytes)`
            : truncated.trim().length > 0
                ? truncated.split('\n').map(l => `  ${l}`).join('\n')
                : '  (empty)';
    } catch {
        return '  (could not parse body)';
    }
}

function buildSection(title: string, content: string): string {
    return [`  -- ${title}`, content].join('\n');
}

// ─────────────────────────────────────────────
//  Worker
// ─────────────────────────────────────────────

export default {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
        const coverage    = parseCoverage(env.LOG_COVERAGE);
        const url         = new URL(request.url);
        const requestId   = request.headers.get('cf-ray') ?? generateUUID();
        const maxBody     = getMaxBody(env);
        const errorMode   = isErrorMode(env);
        const rangeSanitizer = isEnabled(env.RANGE_SANITIZER_ENABLED);
        const allHeaders     = isEnabled(env.ALL_HEADERS_ENABLED);

        const start = Date.now();

        // ─────────────────────────────────────────────
        //  Step 1: Range sanitizer
        //  Only for GET + HEAD when RANGE_SANITIZER_ENABLED=true
        // ─────────────────────────────────────────────
        let rangeRemoved = false;
        let rangeOriginal = '';
        const isGetOrHead = request.method === 'GET' || request.method === 'HEAD';

        if (rangeSanitizer && isGetOrHead) {
            const range = request.headers.get('range');
            if (range && !VALID_SINGLE_RANGE.test(range.trim())) {
                rangeRemoved = true;
                rangeOriginal = range;
            }
        }

        // ─────────────────────────────────────────────
        //  Step 2: Build outgoing request
        //  Mutate headers only if needed (range removal or all-headers injection)
        //  One pass — no redundant Request construction
        // ─────────────────────────────────────────────
        let forwardRequest = request;
        if (rangeRemoved || allHeaders) {
            const newHeaders = new Headers(request.headers);

            // Step 2a: Remove malformed range FIRST
            if (rangeRemoved) {
                newHeaders.delete('range');
            }

            // Step 2b: Snapshot AFTER range removal
            // x-debug-req-headers reflects exactly what reaches origin
            if (allHeaders) {
                const serialized = serializeHeaders(newHeaders, SKIP_REQ_HEADERS);
                if (serialized) newHeaders.set('x-debug-req-headers', serialized);
            }

            // Step 2c: Inject range debug headers into request
            // → captured in LogPush ClientRequestHeaders
            // → unaffected by Transform Rules on response
            if (rangeSanitizer) {
                newHeaders.set('x-debug-range-removed', String(rangeRemoved));
                if (rangeRemoved && rangeOriginal) {
                    newHeaders.set('x-debug-range-original', rangeOriginal);
                }
            }

            forwardRequest = new Request(request, { headers: newHeaders });
        }

        // ─────────────────────────────────────────────
        //  Step 3: Build log lines (buffered — emit only if needed)
        // ─────────────────────────────────────────────
        const reqLines: string[] = [];
        reqLines.push(`\n>>> REQ/${requestId}  ${request.method} ${url.pathname}`);

        // Clone only when body logging is needed
        let requestClone: Request | null = null;
        const needReqBody = shouldLog(coverage, 'req_body');
        if (needReqBody) {
            const ct = request.headers.get('content-type') ?? '';
            if (isTextLike(ct)) {
                requestClone = request.clone();
            }
        }

        if (shouldLog(coverage, 'req_headers')) {
            reqLines.push(buildSection('◀ REQUEST HEADERS', formatHeaders(request.headers)));
        }

        if (needReqBody) {
            const ct = request.headers.get('content-type') ?? '';
            if (!isTextLike(ct)) {
                reqLines.push(buildSection('◀ REQUEST BODY', '  (binary body skipped)'));
            } else if (requestClone) {
                const body = await formatBody(requestClone, maxBody);
                reqLines.push(buildSection('◀ REQUEST BODY', body));
            }
        }

        reqLines.push('─'.repeat(40));

        // ─────────────────────────────────────────────
        //  Step 4: Forward request
        // ─────────────────────────────────────────────
        let response: Response;
        try {
            response = await fetch(forwardRequest);
        } catch (err) {
            console.error(`\nERR/${requestId}  ${request.method} ${url.pathname}  FETCH ERROR\n---\n  ${String(err)}\n`);
            return new Response('Bad Gateway', { status: 502 });
        }

        const duration = Date.now() - start;

        // ─────────────────────────────────────────────
        //  Step 5: Build response + inject debug headers
        // ─────────────────────────────────────────────
        const needDebugHeaders = rangeSanitizer || allHeaders;
        let finalResponse = response;

        if (needDebugHeaders) {
            const resHeaders = new Headers(response.headers);

            // x-debug-res-headers (ALL_HEADERS_ENABLED)
            if (allHeaders) {
                const serialized = serializeHeaders(response.headers, SKIP_RES_HEADERS);
                if (serialized) resHeaders.set('x-debug-res-headers', serialized);
            }

            // x-debug-range-removed (RANGE_SANITIZER_ENABLED) — always attached
            // x-debug-range-original — only when range was removed
            if (rangeSanitizer) {
                resHeaders.set('x-debug-range-removed', String(rangeRemoved));
                if (rangeRemoved && rangeOriginal) {
                    resHeaders.set('x-debug-range-original', rangeOriginal);
                }
            }

            finalResponse = new Response(response.body, {
                status: response.status,
                statusText: response.statusText,
                headers: resHeaders,
            });
        }

        // ─────────────────────────────────────────────
        //  Step 6: Emit logs
        // ─────────────────────────────────────────────
        const resLines: string[] = [];
        resLines.push(`\n<<< RES/${requestId}  ${request.method} ${url.pathname}  ${response.status} ${response.statusText}  (${duration}ms)`);

        if (shouldLog(coverage, 'res_headers')) {
            resLines.push(buildSection('▶ RESPONSE HEADERS', formatHeaders(finalResponse.headers)));
        }

        const needResBody = shouldLog(coverage, 'res_body');
        if (needResBody) {
            const ct = response.headers.get('content-type') ?? '';
            if (!isTextLike(ct)) {
                resLines.push(buildSection('▶ RESPONSE BODY', '  (binary body skipped)'));
            } else {
                const responseClone = finalResponse.clone();
                const body = await formatBody(responseClone, maxBody);
                resLines.push(buildSection('▶ RESPONSE BODY', body));
            }
        }

        resLines.push('─'.repeat(40));

        const shouldEmit = errorMode ? response.status >= 400 : true;
        if (shouldEmit) {
            console.log(reqLines.join('\n'));
            console.log(resLines.join('\n'));
        }

        return finalResponse;
    },
};

// ─────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────

function generateUUID(): string {
    const array = new Uint8Array(16);
    crypto.getRandomValues(array);
    array[6] = (array[6]! & 0x0f) | 0x40;
    array[8] = (array[8]! & 0x3f) | 0x80;
    return [...array]
        .map((b, i) => (i === 4 || i === 6 || i === 8 || i === 10 ? '-' : '') + b.toString(16).padStart(2, '0'))
        .join('');
}
