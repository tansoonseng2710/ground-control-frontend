const DEFAULT_ALLOW_HEADERS = "Content-Type, Authorization, X-Requested-With, Accept";
const ALLOW_METHODS = "GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS";

function buildCorsHeaders(origin, requestAllowHeaders) {
    const allowOrigin = origin || "*";
    return {
        "Access-Control-Allow-Origin": allowOrigin,
        "Access-Control-Allow-Methods": ALLOW_METHODS,
        "Access-Control-Allow-Headers": requestAllowHeaders || DEFAULT_ALLOW_HEADERS,
        "Access-Control-Expose-Headers": "Content-Type, Content-Length",
        "Vary": "Origin, Access-Control-Request-Headers"
    };
}

function resolvePathTail(pathParam) {
    if (Array.isArray(pathParam)) {
        return pathParam.join("/");
    }
    return pathParam || "";
}

function buildTargetUrl(requestUrl, backendBase, pathTail) {
    const incoming = new URL(requestUrl);
    const target = new URL(backendBase);
    const basePath = target.pathname.replace(/\/+$/, "");
    const mergedPath = `${basePath}/${pathTail}`.replace(/\/{2,}/g, "/");
    target.pathname = mergedPath || "/";
    target.search = incoming.search;
    return target.toString();
}

function copyRequestHeaders(request) {
    const headers = new Headers(request.headers);
    headers.delete("host");
    return headers;
}

async function proxyRequest(context) {
    const backendBase = context.env.BACKEND_API_URL;
    const origin = context.request.headers.get("Origin") || "";
    const requestAllowHeaders = context.request.headers.get("Access-Control-Request-Headers") || "";
    const corsHeaders = buildCorsHeaders(origin, requestAllowHeaders);

    if (!backendBase) {
        return new Response(JSON.stringify({
            error: "BACKEND_API_URL is not configured"
        }), {
            status: 500,
            headers: {
                "Content-Type": "application/json; charset=utf-8",
                ...corsHeaders
            }
        });
    }

    const pathTail = resolvePathTail(context.params.path);
    const targetUrl = buildTargetUrl(context.request.url, backendBase, pathTail);
    const method = context.request.method.toUpperCase();

    const upstream = await fetch(targetUrl, {
        method,
        headers: copyRequestHeaders(context.request),
        body: method === "GET" || method === "HEAD" ? undefined : context.request.body,
        redirect: "manual"
    });

    const responseHeaders = new Headers(upstream.headers);
    Object.entries(corsHeaders).forEach(([key, value]) => responseHeaders.set(key, value));

    return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: responseHeaders
    });
}

export async function onRequest(context) {
    if (context.request.method.toUpperCase() === "OPTIONS") {
        const origin = context.request.headers.get("Origin") || "";
        const requestAllowHeaders = context.request.headers.get("Access-Control-Request-Headers") || "";
        return new Response(null, {
            status: 204,
            headers: buildCorsHeaders(origin, requestAllowHeaders)
        });
    }
    return proxyRequest(context);
}
