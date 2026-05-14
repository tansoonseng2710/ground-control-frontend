(function () {
    const PLAN_STORAGE_KEY = "ground_control_navigation_plan_v1";
    const NORMAL_STYLE = "mapbox://styles/mapbox/navigation-night-v1";
    const SATELLITE_STYLE = "mapbox://styles/mapbox/satellite-streets-v12";
    const LEAFLET_NORMAL_TILES = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
    const LEAFLET_SATELLITE_TILES = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
    const LEAFLET_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
    const LEAFLET_SAT_ATTRIBUTION = "Tiles &copy; Esri";
    const MAX_TRACK_POINTS = 2000;
    const WS_RETRY_MS = 5000;
    const DEFAULT_CENTER = { lat: 3.1390, lon: 101.6869 };

    const state = {
        map: null,
        mapEngine: null,
        ws: null,
        wsRetryTimer: null,
        pollingTimer: null,
        autoCenter: true,
        mapMode: "normal",
        currentPoint: null,
        actualTrack: [],
        plannedWaypoints: [],
        plannedDistanceM: null,
        startPoint: null,
        targetPoint: null,
        currentMarker: null,
        currentArrow: null,
        startMarker: null,
        targetMarker: null,
        plannedRouteLayer: null,
        actualRouteLayer: null,
        tileLayer: null,
        telemetrySource: "-",
        wsPath: null
    };

    const el = {
        navNow: document.getElementById("navNow"),
        navConnection: document.getElementById("navConnection"),
        targetLatInput: document.getElementById("targetLatInput"),
        targetLonInput: document.getElementById("targetLonInput"),
        generatePlanBtn: document.getElementById("generatePlanBtn"),
        clearPlanBtn: document.getElementById("clearPlanBtn"),
        mapModeBtn: document.getElementById("mapModeBtn"),
        autoCenterBtn: document.getElementById("autoCenterBtn"),
        recenterBtn: document.getElementById("recenterBtn"),
        zoomRange: document.getElementById("zoomRange"),
        navToast: document.getElementById("navToast"),
        navSpeed: document.getElementById("navSpeed"),
        navHeading: document.getElementById("navHeading"),
        navDistance: document.getElementById("navDistance"),
        navEta: document.getElementById("navEta"),
        navProgress: document.getElementById("navProgress"),
        navGpsStatus: document.getElementById("navGpsStatus"),
        navSats: document.getElementById("navSats"),
        navSource: document.getElementById("navSource")
    };

    function isMapbox() {
        return state.mapEngine === "mapbox";
    }

    function isLeaflet() {
        return state.mapEngine === "leaflet";
    }

    function showToast(message) {
        el.navToast.textContent = message;
        el.navToast.classList.add("show");
        setTimeout(() => {
            el.navToast.classList.remove("show");
        }, 2000);
    }

    function updateClock() {
        const now = new Date();
        const pad = (n) => n.toString().padStart(2, "0");
        el.navNow.textContent = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    }

    function setConnection(text, connected) {
        el.navConnection.textContent = text;
        el.navConnection.classList.toggle("connected", connected);
        el.navConnection.classList.toggle("disconnected", !connected);
    }

    function formatSourceLabel(source) {
        if (!source) {
            return "-";
        }
        try {
            if (source.startsWith("http://") || source.startsWith("https://")) {
                const url = new URL(source);
                return url.host;
            }
        } catch (_e) {
            // Use raw source on parse errors.
        }
        return source;
    }

    function fmtDistance(meters) {
        if (!Number.isFinite(meters)) {
            return "-";
        }
        if (meters >= 1000) {
            return `${(meters / 1000).toFixed(2)} km`;
        }
        return `${meters.toFixed(1)} m`;
    }

    function fmtDuration(totalSec) {
        if (!Number.isFinite(totalSec) || totalSec < 0) {
            return "-";
        }
        const sec = Math.round(totalSec);
        const h = Math.floor(sec / 3600);
        const m = Math.floor((sec % 3600) / 60);
        const s = sec % 60;
        if (h > 0) {
            return `${h}h ${m}m ${s}s`;
        }
        if (m > 0) {
            return `${m}m ${s}s`;
        }
        return `${s}s`;
    }

    function haversineMeters(lat1, lon1, lat2, lon2) {
        const R = 6371000;
        const toRad = (d) => (d * Math.PI) / 180;
        const dLat = toRad(lat2 - lat1);
        const dLon = toRad(lon2 - lon1);
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    function lineDistanceMeters(waypoints) {
        let total = 0;
        for (let i = 1; i < waypoints.length; i += 1) {
            total += haversineMeters(waypoints[i - 1].lat, waypoints[i - 1].lon, waypoints[i].lat, waypoints[i].lon);
        }
        return total;
    }

    function parsePoint(input) {
        if (!input || typeof input !== "object") {
            return null;
        }
        const lat = Number(input.lat);
        const lon = Number(input.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
            return null;
        }
        const point = {
            lat,
            lon,
            timestamp: Number(input.timestamp) || Date.now() / 1000
        };
        const speed = Number(input.speed_mps);
        const heading = Number(input.heading_deg);
        const fix = Number(input.fix_type);
        const sats = Number(input.sats);
        point.speed_mps = Number.isFinite(speed) ? speed : null;
        point.heading_deg = Number.isFinite(heading) ? heading : null;
        point.fix_type = Number.isFinite(fix) ? fix : null;
        point.sats = Number.isFinite(sats) ? sats : null;
        point.source = input.source || null;
        return point;
    }

    function createDroneMarkerHtml() {
        return '<div class="drone-marker"><div class="drone-marker-arrow"></div></div>';
    }

    function createStartMarkerHtml() {
        return '<div class="start-marker">S</div>';
    }

    function createTargetMarkerHtml() {
        return '<div class="target-marker">T</div>';
    }

    function getCurrentZoom() {
        if (!state.map) {
            return 16;
        }
        if (isMapbox()) {
            return state.map.getZoom();
        }
        return state.map.getZoom();
    }

    function ensureRouteLayers() {
        if (!state.map) {
            return;
        }

        if (isMapbox()) {
            if (!state.map.getSource("planned-route")) {
                state.map.addSource("planned-route", {
                    type: "geojson",
                    data: {
                        type: "Feature",
                        properties: {},
                        geometry: { type: "LineString", coordinates: [] }
                    }
                });
            }
            if (!state.map.getLayer("planned-route-layer")) {
                state.map.addLayer({
                    id: "planned-route-layer",
                    type: "line",
                    source: "planned-route",
                    layout: { "line-cap": "round", "line-join": "round" },
                    paint: { "line-color": "#ffd166", "line-width": 5, "line-dasharray": [2, 1] }
                });
            }

            if (!state.map.getSource("actual-route")) {
                state.map.addSource("actual-route", {
                    type: "geojson",
                    data: {
                        type: "Feature",
                        properties: {},
                        geometry: { type: "LineString", coordinates: [] }
                    }
                });
            }
            if (!state.map.getLayer("actual-route-layer")) {
                state.map.addLayer({
                    id: "actual-route-layer",
                    type: "line",
                    source: "actual-route",
                    layout: { "line-cap": "round", "line-join": "round" },
                    paint: { "line-color": "#3ee9d6", "line-width": 5 }
                });
            }
            return;
        }

        if (isLeaflet()) {
            if (!state.plannedRouteLayer) {
                state.plannedRouteLayer = L.polyline([], {
                    color: "#ffd166",
                    weight: 5,
                    dashArray: "8,6"
                }).addTo(state.map);
            }
            if (!state.actualRouteLayer) {
                state.actualRouteLayer = L.polyline([], {
                    color: "#3ee9d6",
                    weight: 5
                }).addTo(state.map);
            }
        }
    }

    function redrawRouteLines() {
        if (!state.map) {
            return;
        }
        if (isMapbox()) {
            const plannedCoords = state.plannedWaypoints.map((p) => [p.lon, p.lat]);
            const actualCoords = state.actualTrack.map((p) => [p.lon, p.lat]);
            const plannedSource = state.map.getSource("planned-route");
            if (plannedSource) {
                plannedSource.setData({
                    type: "Feature",
                    properties: {},
                    geometry: { type: "LineString", coordinates: plannedCoords }
                });
            }
            const actualSource = state.map.getSource("actual-route");
            if (actualSource) {
                actualSource.setData({
                    type: "Feature",
                    properties: {},
                    geometry: { type: "LineString", coordinates: actualCoords }
                });
            }
            return;
        }

        if (isLeaflet()) {
            if (state.plannedRouteLayer) {
                state.plannedRouteLayer.setLatLngs(state.plannedWaypoints.map((p) => [p.lat, p.lon]));
            }
            if (state.actualRouteLayer) {
                state.actualRouteLayer.setLatLngs(state.actualTrack.map((p) => [p.lat, p.lon]));
            }
        }
    }

    function setMapMarkerPosition(marker, point) {
        if (!marker || !point) {
            return;
        }
        if (isMapbox()) {
            marker.setLngLat([point.lon, point.lat]);
        } else if (isLeaflet()) {
            marker.setLatLng([point.lat, point.lon]);
        }
    }

    function ensureCurrentMarker() {
        if (!state.map || state.currentMarker) {
            return;
        }
        if (isMapbox()) {
            const container = document.createElement("div");
            container.innerHTML = createDroneMarkerHtml();
            const node = container.firstElementChild;
            state.currentArrow = node.querySelector(".drone-marker-arrow");
            state.currentMarker = new mapboxgl.Marker({ element: node, anchor: "center" })
                .setLngLat([DEFAULT_CENTER.lon, DEFAULT_CENTER.lat])
                .addTo(state.map);
            return;
        }

        if (isLeaflet()) {
            state.currentMarker = L.marker([DEFAULT_CENTER.lat, DEFAULT_CENTER.lon], {
                icon: L.divIcon({
                    className: "leaflet-drone-icon",
                    html: createDroneMarkerHtml(),
                    iconSize: [30, 30],
                    iconAnchor: [15, 15]
                })
            }).addTo(state.map);
            const markerElement = state.currentMarker.getElement();
            state.currentArrow = markerElement ? markerElement.querySelector(".drone-marker-arrow") : null;
        }
    }

    function setMarkerHeading(headingDeg) {
        if (!Number.isFinite(headingDeg)) {
            return;
        }
        if (!state.currentArrow && isLeaflet() && state.currentMarker && state.currentMarker.getElement) {
            const markerElement = state.currentMarker.getElement();
            state.currentArrow = markerElement ? markerElement.querySelector(".drone-marker-arrow") : null;
        }
        if (!state.currentArrow) {
            return;
        }
        state.currentArrow.style.transform = `rotate(${headingDeg}deg)`;
    }

    function setStartMarker(point) {
        if (!state.map || !point) {
            return;
        }
        if (!state.startMarker) {
            if (isMapbox()) {
                const container = document.createElement("div");
                container.innerHTML = createStartMarkerHtml();
                state.startMarker = new mapboxgl.Marker({ element: container.firstElementChild, anchor: "center" }).addTo(state.map);
            } else if (isLeaflet()) {
                state.startMarker = L.marker([point.lat, point.lon], {
                    icon: L.divIcon({
                        className: "leaflet-start-icon",
                        html: createStartMarkerHtml(),
                        iconSize: [20, 20],
                        iconAnchor: [10, 10]
                    })
                }).addTo(state.map);
            }
        }
        setMapMarkerPosition(state.startMarker, point);
    }

    function setTargetMarker(point) {
        if (!state.map || !point) {
            return;
        }
        if (!state.targetMarker) {
            if (isMapbox()) {
                const container = document.createElement("div");
                container.innerHTML = createTargetMarkerHtml();
                state.targetMarker = new mapboxgl.Marker({ element: container.firstElementChild, anchor: "center" }).addTo(state.map);
            } else if (isLeaflet()) {
                state.targetMarker = L.marker([point.lat, point.lon], {
                    icon: L.divIcon({
                        className: "leaflet-target-icon",
                        html: createTargetMarkerHtml(),
                        iconSize: [20, 20],
                        iconAnchor: [10, 10]
                    })
                }).addTo(state.map);
            }
        }
        setMapMarkerPosition(state.targetMarker, point);
    }

    function removeTargetMarker() {
        if (!state.targetMarker) {
            return;
        }
        if (isMapbox()) {
            state.targetMarker.remove();
        } else if (isLeaflet()) {
            state.targetMarker.remove();
        }
        state.targetMarker = null;
    }

    function centerOn(point, immediate) {
        if (!state.map || !point) {
            return;
        }
        if (isMapbox()) {
            if (immediate) {
                state.map.jumpTo({ center: [point.lon, point.lat] });
                return;
            }
            state.map.easeTo({ center: [point.lon, point.lat], duration: 700 });
            return;
        }
        if (isLeaflet()) {
            const zoom = getCurrentZoom();
            if (immediate) {
                state.map.setView([point.lat, point.lon], zoom, { animate: false });
            } else {
                state.map.panTo([point.lat, point.lon], { animate: true, duration: 0.7 });
            }
        }
    }

    function appendTrackPoint(point) {
        const last = state.actualTrack[state.actualTrack.length - 1];
        if (last) {
            const d = haversineMeters(last.lat, last.lon, point.lat, point.lon);
            if (d < 0.35) {
                return;
            }
        }
        state.actualTrack.push(point);
        if (state.actualTrack.length > MAX_TRACK_POINTS) {
            state.actualTrack.shift();
        }
    }

    function gpsStatusText(payload) {
        if (!payload || !payload.ok) {
            return "No GPS";
        }
        const fixType = Number(payload.fix_type);
        const sats = Number(payload.sats);
        if (Number.isFinite(fixType) && fixType >= 3) {
            if (Number.isFinite(sats) && sats >= 8) {
                return "Locked";
            }
            return "Weak Lock";
        }
        return "No Fix";
    }

    function updateHud(point, payload) {
        const speed = point && Number.isFinite(point.speed_mps) ? `${point.speed_mps.toFixed(2)} m/s` : "-";
        const heading = point && Number.isFinite(point.heading_deg) ? `${point.heading_deg.toFixed(1)} deg` : "-";
        el.navSpeed.textContent = speed;
        el.navHeading.textContent = heading;

        const sats = payload && payload.sats !== undefined && payload.sats !== null ? String(payload.sats) : "-";
        el.navSats.textContent = sats;
        el.navGpsStatus.textContent = gpsStatusText(payload);
        el.navSource.textContent = formatSourceLabel(state.telemetrySource || "-");

        if (!point || !state.targetPoint) {
            el.navDistance.textContent = "-";
            el.navEta.textContent = "-";
            el.navProgress.textContent = "-";
            return;
        }

        const remaining = haversineMeters(point.lat, point.lon, state.targetPoint.lat, state.targetPoint.lon);
        el.navDistance.textContent = fmtDistance(remaining);

        const speedMps = Number(point.speed_mps);
        const eta = Number.isFinite(speedMps) && speedMps > 0.2 ? remaining / speedMps : null;
        el.navEta.textContent = fmtDuration(eta);

        const baselineDistance = Number.isFinite(state.plannedDistanceM) && state.plannedDistanceM > 0
            ? state.plannedDistanceM
            : (state.startPoint ? haversineMeters(state.startPoint.lat, state.startPoint.lon, state.targetPoint.lat, state.targetPoint.lon) : null);
        if (!Number.isFinite(baselineDistance) || baselineDistance <= 0) {
            el.navProgress.textContent = "-";
        } else {
            const progress = Math.max(0, Math.min(100, ((baselineDistance - remaining) / baselineDistance) * 100));
            el.navProgress.textContent = `${progress.toFixed(1)}%`;
        }
    }

    function handleTelemetry(payload, options = {}) {
        const source = payload && payload.source ? String(payload.source) : null;
        if (source) {
            state.telemetrySource = source;
        }

        if (!payload || !payload.ok || payload.lat === null || payload.lon === null || payload.lat === undefined || payload.lon === undefined) {
            updateHud(state.currentPoint, payload || {});
            return;
        }

        const point = parsePoint(payload);
        if (!point) {
            return;
        }
        state.currentPoint = point;

        ensureCurrentMarker();
        setMapMarkerPosition(state.currentMarker, point);
        setMarkerHeading(point.heading_deg);

        appendTrackPoint(point);
        if (!state.startPoint) {
            state.startPoint = { lat: point.lat, lon: point.lon };
            setStartMarker(state.startPoint);
        }

        redrawRouteLines();
        if (state.autoCenter && !options.skipCenter) {
            centerOn(point, false);
        }
        updateHud(point, payload);
    }

    function persistPlan(plan) {
        try {
            localStorage.setItem(PLAN_STORAGE_KEY, JSON.stringify(plan));
        } catch (_e) {
            // Ignore storage issues.
        }
    }

    function readStoredPlan() {
        try {
            const raw = localStorage.getItem(PLAN_STORAGE_KEY);
            if (!raw) {
                return null;
            }
            return JSON.parse(raw);
        } catch (_e) {
            return null;
        }
    }

    function applyPlan(plan, options = {}) {
        const waypointsRaw = Array.isArray(plan && plan.waypoints) ? plan.waypoints : [];
        const waypoints = waypointsRaw.map((w) => parsePoint({ lat: w.lat, lon: w.lon })).filter(Boolean);

        state.plannedWaypoints = waypoints;
        state.plannedDistanceM = Number(plan && plan.distance_m);
        if (!Number.isFinite(state.plannedDistanceM) || state.plannedDistanceM <= 0) {
            state.plannedDistanceM = waypoints.length >= 2 ? lineDistanceMeters(waypoints) : null;
        }

        const start = parsePoint(plan && plan.start ? plan.start : (waypoints[0] || null));
        const target = parsePoint(plan && plan.target ? plan.target : (waypoints[waypoints.length - 1] || null));
        state.startPoint = start || state.startPoint;
        state.targetPoint = target || null;

        if (state.startPoint) {
            setStartMarker(state.startPoint);
        }
        if (state.targetPoint) {
            setTargetMarker(state.targetPoint);
            el.targetLatInput.value = state.targetPoint.lat.toFixed(7);
            el.targetLonInput.value = state.targetPoint.lon.toFixed(7);
        } else {
            removeTargetMarker();
        }

        redrawRouteLines();
        updateHud(state.currentPoint, { ok: true, sats: state.currentPoint && state.currentPoint.sats });

        if (options.persist !== false) {
            persistPlan({
                updated_at: new Date().toISOString(),
                distance_m: state.plannedDistanceM,
                eta_s: plan && plan.eta_s,
                waypoints: waypoints.map((p, idx) => ({
                    lat: p.lat,
                    lon: p.lon,
                    type: waypointsRaw[idx] && waypointsRaw[idx].type ? waypointsRaw[idx].type : "waypoint"
                })),
                start: state.startPoint,
                target: state.targetPoint
            });
        }
    }

    function clearPlan() {
        state.plannedWaypoints = [];
        state.plannedDistanceM = null;
        state.targetPoint = null;
        removeTargetMarker();
        redrawRouteLines();
        el.navDistance.textContent = "-";
        el.navEta.textContent = "-";
        el.navProgress.textContent = "-";
        try {
            localStorage.removeItem(PLAN_STORAGE_KEY);
        } catch (_e) {
            // Ignore storage issues.
        }
        showToast("Planned route cleared");
    }

    async function generatePlan() {
        if (!state.currentPoint) {
            showToast("Waiting for live GPS before planning route");
            return;
        }
        const targetLat = Number(el.targetLatInput.value);
        const targetLon = Number(el.targetLonInput.value);
        if (!Number.isFinite(targetLat) || !Number.isFinite(targetLon)) {
            showToast("Enter valid target coordinates");
            return;
        }

        try {
            const res = await fetch("/ai/plan", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    start: { lat: state.currentPoint.lat, lon: state.currentPoint.lon },
                    target: { lat: targetLat, lon: targetLon },
                    no_fly: []
                })
            });
            const data = await res.json();
            if (!data.ok) {
                showToast(data.error || "Route generation failed");
                return;
            }
            applyPlan({
                distance_m: data.distance_m,
                eta_s: data.eta_s,
                waypoints: data.waypoints || [],
                start: { lat: state.currentPoint.lat, lon: state.currentPoint.lon },
                target: { lat: targetLat, lon: targetLon }
            });
            showToast("Route generated");
        } catch (_e) {
            showToast("Route generation failed");
        }
    }

    function startPollingFallback() {
        if (state.pollingTimer) {
            return;
        }
        setConnection("Polling GPS...", true);
        const poll = () => {
            fetch("/gps")
                .then((res) => res.json())
                .then((payload) => {
                    handleTelemetry(payload);
                })
                .catch(() => {
                    setConnection("GPS unavailable", false);
                });
        };
        poll();
        state.pollingTimer = setInterval(poll, 1000);
    }

    function stopPollingFallback() {
        if (!state.pollingTimer) {
            return;
        }
        clearInterval(state.pollingTimer);
        state.pollingTimer = null;
    }

    function scheduleWsReconnect() {
        if (state.wsRetryTimer) {
            return;
        }
        state.wsRetryTimer = setTimeout(() => {
            state.wsRetryTimer = null;
            connectWebSocket(state.wsPath);
        }, WS_RETRY_MS);
    }

    function getApiBaseMode() {
        const base = typeof window.gcApiBase === "string" ? window.gcApiBase.trim() : "";
        if (!base) {
            return "same-origin";
        }
        if (base.startsWith("/")) {
            return "proxy-path";
        }
        if (base.startsWith("http://") || base.startsWith("https://")) {
            return "absolute";
        }
        return "same-origin";
    }

    function buildWebSocketUrl(wsPath) {
        const mode = getApiBaseMode();
        if (mode === "absolute") {
            const apiBaseUrl = new URL(window.gcApiBase);
            const wsUrl = new URL(wsPath, apiBaseUrl);
            wsUrl.protocol = apiBaseUrl.protocol === "https:" ? "wss:" : "ws:";
            return wsUrl.toString();
        }
        const scheme = window.location.protocol === "https:" ? "wss" : "ws";
        return `${scheme}://${window.location.host}${wsPath}`;
    }

    function canUseWebSocket(wsPath) {
        if (!wsPath || typeof window.WebSocket === "undefined") {
            return false;
        }
        return getApiBaseMode() !== "proxy-path";
    }

    function connectWebSocket(wsPath) {
        if (!canUseWebSocket(wsPath)) {
            startPollingFallback();
            return;
        }
        if (state.ws && (state.ws.readyState === WebSocket.OPEN || state.ws.readyState === WebSocket.CONNECTING)) {
            return;
        }

        const wsUrl = buildWebSocketUrl(wsPath);
        setConnection("Connecting WebSocket...", false);

        try {
            const ws = new WebSocket(wsUrl);
            state.ws = ws;

            ws.addEventListener("open", () => {
                stopPollingFallback();
                setConnection("WebSocket Live", true);
            });

            ws.addEventListener("message", (event) => {
                try {
                    const payload = JSON.parse(event.data);
                    handleTelemetry(payload);
                } catch (_e) {
                    // Ignore malformed payload.
                }
            });

            ws.addEventListener("close", () => {
                setConnection("WebSocket disconnected", false);
                startPollingFallback();
                scheduleWsReconnect();
            });

            ws.addEventListener("error", () => {
                setConnection("WebSocket error", false);
            });
        } catch (_e) {
            startPollingFallback();
            scheduleWsReconnect();
        }
    }

    async function restoreTrack() {
        try {
            const res = await fetch("/api/navigation/track?limit=300");
            const data = await res.json();
            const points = Array.isArray(data.points) ? data.points : [];
            const parsed = points.map(parsePoint).filter(Boolean);
            if (!parsed.length) {
                return;
            }
            state.actualTrack = parsed.slice(-MAX_TRACK_POINTS);
            const first = state.actualTrack[0];
            const last = state.actualTrack[state.actualTrack.length - 1];
            state.currentPoint = last;
            state.startPoint = state.startPoint || first;
            ensureCurrentMarker();
            setMapMarkerPosition(state.currentMarker, last);
            setMarkerHeading(last.heading_deg);
            setStartMarker(state.startPoint);
            redrawRouteLines();
            centerOn(last, true);
            updateHud(last, { ok: true, fix_type: last.fix_type, sats: last.sats });
        } catch (_e) {
            // Ignore startup history fetch failures.
        }
    }

    async function restorePlanFromServer() {
        try {
            const res = await fetch("/api/navigation/mission_plan");
            const data = await res.json();
            const plan = data && data.plan;
            if (!plan || !Array.isArray(plan.waypoints) || !plan.waypoints.length) {
                return false;
            }
            applyPlan(plan, { persist: true });
            return true;
        } catch (_e) {
            return false;
        }
    }

    async function loadConfig() {
        const res = await fetch("/api/navigation/config");
        return res.json();
    }

    function setLeafletTileLayer() {
        if (!isLeaflet() || !state.map) {
            return;
        }
        if (state.tileLayer) {
            state.map.removeLayer(state.tileLayer);
        }
        const isNormal = state.mapMode === "normal";
        const url = isNormal ? LEAFLET_NORMAL_TILES : LEAFLET_SATELLITE_TILES;
        const attribution = isNormal ? LEAFLET_ATTRIBUTION : LEAFLET_SAT_ATTRIBUTION;
        state.tileLayer = L.tileLayer(url, { attribution, maxZoom: 20 });
        state.tileLayer.addTo(state.map);
    }

    function toggleMapMode() {
        if (!state.map) {
            return;
        }
        state.mapMode = state.mapMode === "normal" ? "satellite" : "normal";
        el.mapModeBtn.textContent = state.mapMode === "normal" ? "Satellite" : "Normal";

        if (isMapbox()) {
            const style = state.mapMode === "normal" ? NORMAL_STYLE : SATELLITE_STYLE;
            state.map.setStyle(style);
            state.map.once("style.load", () => {
                ensureRouteLayers();
                redrawRouteLines();
            });
            return;
        }

        if (isLeaflet()) {
            setLeafletTileLayer();
            redrawRouteLines();
        }
    }

    function bindEvents() {
        el.generatePlanBtn.addEventListener("click", generatePlan);
        el.clearPlanBtn.addEventListener("click", clearPlan);
        el.mapModeBtn.addEventListener("click", toggleMapMode);
        el.autoCenterBtn.addEventListener("click", () => {
            state.autoCenter = !state.autoCenter;
            el.autoCenterBtn.textContent = state.autoCenter ? "Auto-Center ON" : "Auto-Center OFF";
            if (state.autoCenter && state.currentPoint) {
                centerOn(state.currentPoint, false);
            }
        });
        el.recenterBtn.addEventListener("click", () => {
            if (!state.currentPoint) {
                showToast("Waiting for GPS lock");
                return;
            }
            centerOn(state.currentPoint, false);
        });

        el.zoomRange.addEventListener("input", () => {
            if (!state.map) {
                return;
            }
            const zoom = Number(el.zoomRange.value);
            if (!Number.isFinite(zoom)) {
                return;
            }
            if (isMapbox()) {
                state.map.easeTo({ zoom, duration: 150 });
            } else if (isLeaflet()) {
                state.map.setZoom(zoom, { animate: false });
            }
        });
    }

    async function initMapbox(accessToken) {
        if (typeof mapboxgl === "undefined") {
            throw new Error("Mapbox GL JS not loaded");
        }
        mapboxgl.accessToken = accessToken;
        state.mapEngine = "mapbox";
        state.map = new mapboxgl.Map({
            container: "navMap",
            style: NORMAL_STYLE,
            center: [DEFAULT_CENTER.lon, DEFAULT_CENTER.lat],
            zoom: 16,
            pitch: 45,
            antialias: true
        });
        state.map.addControl(new mapboxgl.NavigationControl(), "bottom-right");

        await new Promise((resolve) => {
            state.map.on("load", resolve);
        });

        ensureRouteLayers();
        state.map.on("zoom", () => {
            el.zoomRange.value = state.map.getZoom().toFixed(1);
        });
    }

    async function initLeafletMap() {
        if (typeof L === "undefined") {
            throw new Error("Leaflet not loaded");
        }
        state.mapEngine = "leaflet";
        state.map = L.map("navMap", {
            zoomControl: false,
            center: [DEFAULT_CENTER.lat, DEFAULT_CENTER.lon],
            zoom: 16
        });
        L.control.zoom({ position: "bottomright" }).addTo(state.map);
        setLeafletTileLayer();
        ensureRouteLayers();
        state.map.on("zoomend", () => {
            el.zoomRange.value = state.map.getZoom().toFixed(1);
        });
    }

    async function initMap(accessToken) {
        if (accessToken) {
            try {
                await initMapbox(accessToken);
                return "mapbox";
            } catch (_e) {
                // Fall through to Leaflet fallback.
            }
        }
        await initLeafletMap();
        return "leaflet";
    }

    async function init() {
        updateClock();
        setInterval(updateClock, 1000);
        bindEvents();

        let cfg;
        try {
            cfg = await loadConfig();
        } catch (_e) {
            setConnection("Config unavailable", false);
            showToast("Failed to load navigation config");
            return;
        }

        const token = cfg.mapbox_access_token || "";
        try {
            const engine = await initMap(token);
            if (engine === "leaflet") {
                setConnection("Leaflet map (no token)", true);
                showToast("Using token-free map fallback");
            }
        } catch (_e) {
            setConnection("Map initialization failed", false);
            showToast("Unable to initialize navigation map");
            return;
        }

        await restoreTrack();

        const gotServerPlan = await restorePlanFromServer();
        if (!gotServerPlan) {
            const stored = readStoredPlan();
            if (stored && Array.isArray(stored.waypoints) && stored.waypoints.length) {
                applyPlan(stored, { persist: false });
            }
        }

        if (cfg.websocket_enabled && canUseWebSocket(cfg.ws_path)) {
            state.wsPath = cfg.ws_path;
            connectWebSocket(cfg.ws_path);
        } else {
            startPollingFallback();
        }
    }

    init();
})();
