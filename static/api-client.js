(function () {
    const runtime = window.GROUND_CONTROL_RUNTIME || {};
    const rawApiBase = typeof runtime.API_BASE_URL === "string" ? runtime.API_BASE_URL.trim() : "";
    const apiBase = rawApiBase.replace(/\/+$/, "");
    const passthroughPrefixes = ["/static/", "/favicon", "/assets/", "/manifest", "/config.js"];

    function shouldRewrite(url) {
        return typeof url === "string"
            && url.startsWith("/")
            && !url.startsWith("//")
            && !passthroughPrefixes.some((prefix) => url.startsWith(prefix));
    }

    function buildApiUrl(url) {
        if (!apiBase || !shouldRewrite(url)) {
            return url;
        }
        return `${apiBase}${url}`;
    }

    window.gcApiBase = apiBase;
    window.gcApiUrl = buildApiUrl;

    const nativeFetch = window.fetch.bind(window);
    window.fetch = function patchedFetch(input, init) {
        if (typeof input === "string") {
            return nativeFetch(buildApiUrl(input), init);
        }
        return nativeFetch(input, init);
    };
})();
