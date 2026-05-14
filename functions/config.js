function normalizeApiBase(value) {
    const raw = typeof value === "string" ? value.trim() : "";
    if (!raw) {
        return "/api-proxy";
    }
    if (raw.startsWith("/")) {
        const cleaned = raw.replace(/\/+$/, "");
        return cleaned || "/";
    }
    return raw.replace(/\/+$/, "");
}

export async function onRequestGet(context) {
    const apiBase = normalizeApiBase(context.env.FRONTEND_API_BASE);
    const payload = `window.GROUND_CONTROL_RUNTIME = Object.assign({}, window.GROUND_CONTROL_RUNTIME, { API_BASE_URL: ${JSON.stringify(apiBase)} });`;
    return new Response(payload, {
        headers: {
            "Content-Type": "application/javascript; charset=utf-8",
            "Cache-Control": "no-store"
        }
    });
}
