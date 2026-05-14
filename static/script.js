(function () {
    const groupColors = [
        "#e41a1c",
        "#377eb8",
        "#4daf4a",
        "#984ea3",
        "#ff7f00",
        "#ffff33",
        "#a65628",
        "#f781bf"
    ];
    const MISSION_PLAN_STORAGE_KEY = "ground_control_navigation_plan_v1";

    const state = {
        selectedSource: "",
        streamingActive: false,
        statsInterval: null,
        telemetryInterval: null,
        gpsLive: false,
        lastCapturedFilename: null,
        lastClusterResult: null,
        mode: "normal",
        altitude: 0,
        distance: 0,
        battery: 100,
        flightTime: 600,
        homeLat: null,
        homeLon: null,
        firstGpsTs: null,
        voiceEnabled: true,
        lastConnectionStatus: null,
        currentView: "execute",
        historyMissions: []
    };

    const el = {
        datetime: document.getElementById("datetime"),
        statusBadge: document.getElementById("statusBadge"),
        activeModeChip: document.getElementById("activeModeChip"),

        navExecuteBtn: document.getElementById("navExecuteBtn"),
        navHistoryBtn: document.getElementById("navHistoryBtn"),
        navNavigationBtn: document.getElementById("navNavigationBtn"),
        executeView: document.getElementById("executeView"),
        historyView: document.getElementById("historyView"),
        navigationView: document.getElementById("navigationView"),

        modeNormalBtn: document.getElementById("modeNormalBtn"),
        modeCruiseBtn: document.getElementById("modeCruiseBtn"),
        modeEmergencyBtn: document.getElementById("modeEmergencyBtn"),

        startBtn: document.getElementById("startBtn"),
        stopBtn: document.getElementById("stopBtn"),
        captureBtn: document.getElementById("captureBtn"),
        clusterBtn: document.getElementById("clusterBtn"),

        engageCruiseBtn: document.getElementById("engageCruiseBtn"),
        rtlBtn: document.getElementById("rtlBtn"),
        landNowBtn: document.getElementById("landNowBtn"),
        emergencyStopBtn: document.getElementById("emergencyStopBtn"),

        cruiseSpeed: document.getElementById("cruiseSpeed"),
        corridorWidth: document.getElementById("corridorWidth"),
        autoCorrect: document.getElementById("autoCorrect"),

        videoSource: document.getElementById("videoSource"),
        videoSourceLabel: document.getElementById("videoSourceLabel"),
        videoStage: document.querySelector(".video-stage"),
        videoCanvas: document.getElementById("videoCanvas"),
        peopleCount: document.getElementById("peopleCount"),
        fpsCount: document.getElementById("fpsCount"),
        groupsCount: document.getElementById("groupsCount"),

        capturedImg: document.getElementById("capturedImg"),
        capturePlaceholder: document.getElementById("capturePlaceholder"),
        capturePanelTitle: document.getElementById("capturePanelTitle"),
        clusteringSummaryPanel: document.getElementById("clusteringSummaryPanel"),
        clusteringSummaryContent: document.getElementById("clusteringSummaryContent"),
        downloadCoordsJsonBtn: document.getElementById("downloadCoordsJsonBtn"),
        downloadMissionBtn: document.getElementById("downloadMissionBtn"),

        altitudeVal: document.getElementById("altitudeVal"),
        distanceVal: document.getElementById("distanceVal"),
        batteryVal: document.getElementById("batteryVal"),
        batteryBar: document.getElementById("batteryBar"),
        flightTimeVal: document.getElementById("flightTimeVal"),
        telemetryLatVal: document.getElementById("telemetryLatVal"),
        telemetryLonVal: document.getElementById("telemetryLonVal"),
        headingVal: document.getElementById("headingVal"),
        speedVal: document.getElementById("speedVal"),
        fixVal: document.getElementById("fixVal"),
        satsVal: document.getElementById("satsVal"),
        sourceVal: document.getElementById("sourceVal"),
        timestampVal: document.getElementById("timestampVal"),

        gpsLat: document.getElementById("gpsLat"),
        gpsLon: document.getElementById("gpsLon"),
        gpsFix: document.getElementById("gpsFix"),
        gpsSats: document.getElementById("gpsSats"),
        gpsMapFrame: document.getElementById("gpsMapFrame"),
        miniGpsLat: document.getElementById("miniGpsLat"),
        miniGpsLon: document.getElementById("miniGpsLon"),
        miniGpsFix: document.getElementById("miniGpsFix"),
        miniGpsSats: document.getElementById("miniGpsSats"),

        startLat: document.getElementById("startLat"),
        startLon: document.getElementById("startLon"),
        targetLat: document.getElementById("targetLat"),
        targetLon: document.getElementById("targetLon"),
        aiGpsSourceChip: document.getElementById("aiGpsSourceChip"),
        aiPlanBtn: document.getElementById("aiPlanBtn"),
        aiEta: document.getElementById("aiEta"),
        aiDistance: document.getElementById("aiDistance"),
        aiAlerts: document.getElementById("aiAlerts"),
        aiPlanSummary: document.getElementById("aiPlanSummary"),

        refreshHistoryBtn: document.getElementById("refreshHistoryBtn"),
        historyStatus: document.getElementById("historyStatus"),
        historyList: document.getElementById("historyList"),

        toast: document.getElementById("toast")
    };

    const ctx = el.videoCanvas.getContext("2d");
    const streamImage = new Image();
    streamImage.crossOrigin = "anonymous";

    function speechSupported() {
        return typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
    }

    function pickVoice() {
        if (!speechSupported()) {
            return null;
        }
        const voices = window.speechSynthesis.getVoices() || [];
        if (!voices.length) {
            return null;
        }
        const englishVoices = voices.filter((v) => /en-US|en-GB|en-AU|English/i.test(v.lang || ""));

        // Prefer female voices for Friday-style assistant persona.
        const femaleHint = /female|zira|aria|jenny|samantha|hazel|eva|susan|libby|serena|cortana/i;
        const femaleEnglish = englishVoices.find((v) => femaleHint.test(v.name || ""));
        if (femaleEnglish) {
            return femaleEnglish;
        }

        const anyEnglish = englishVoices[0];
        return anyEnglish || voices[0];
    }

    function speak(text, options = {}) {
        if (!state.voiceEnabled || !text || !speechSupported()) {
            return;
        }
        const utter = new SpeechSynthesisUtterance(String(text));
        const voice = pickVoice();
        if (voice) {
            utter.voice = voice;
        }
        utter.rate = options.rate || 0.97;
        utter.pitch = options.pitch || 1.08;
        utter.volume = options.volume || 1.0;
        if (options.interrupt) {
            window.speechSynthesis.cancel();
        }
        window.speechSynthesis.speak(utter);
    }

    function modeLabel(mode) {
        return `${mode.charAt(0).toUpperCase()}${mode.slice(1)}`;
    }

    function announceWelcomeAndStatus() {
        speak("Hey boss, I am Friday, welcome to the Aero Command system.", { interrupt: true });
        const conn = state.streamingActive ? "connected" : "not connected";
        speak(`Current connection status is ${conn}.`, { rate: 1.02 });
        speak(`System is currently in ${modeLabel(state.mode)} mode.`, { rate: 1.02 });
    }

    function showToast(message, shouldSpeak = false) {
        el.toast.textContent = message;
        el.toast.classList.add("show");
        if (shouldSpeak) {
            speak(message);
        }
        setTimeout(() => {
            el.toast.classList.remove("show");
        }, 2200);
    }

    function updateDateTime() {
        const dt = new Date();
        const pad = (n) => n.toString().padStart(2, "0");
        el.datetime.textContent = `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}`;
    }

    function setConnectionStatus(isConnected, announce = true) {
        el.statusBadge.textContent = isConnected ? "Connected" : "Disconnected";
        el.statusBadge.classList.toggle("connected", isConnected);
        el.statusBadge.classList.toggle("disconnected", !isConnected);
        if (announce && state.lastConnectionStatus !== isConnected) {
            state.lastConnectionStatus = isConnected;
            speak(isConnected ? "Connection status: connected." : "Connection status: disconnected.");
        }
    }

    function setMode(mode, options = {}) {
        const announce = options.announce !== false;
        state.mode = mode;
        document.body.setAttribute("data-mode", mode);
        el.modeNormalBtn.classList.toggle("active", mode === "normal");
        el.modeCruiseBtn.classList.toggle("active", mode === "cruise");
        el.modeEmergencyBtn.classList.toggle("active", mode === "emergency");

        const modeText = mode.charAt(0).toUpperCase() + mode.slice(1);
        el.activeModeChip.textContent = `Mode: ${modeText}`;
        if (announce) {
            speak(`System mode changed to ${modeText}.`);
        }
    }

    function updateStatsOverlay(people, fps, groups) {
        el.peopleCount.textContent = people;
        el.fpsCount.textContent = fps;
        el.groupsCount.textContent = Number(groups) > 0 ? groups : "OFF";
    }

    function drawFrame() {
        if (!state.streamingActive) {
            return;
        }
        try {
            ctx.clearRect(0, 0, el.videoCanvas.width, el.videoCanvas.height);
            ctx.drawImage(streamImage, 0, 0, el.videoCanvas.width, el.videoCanvas.height);
        } catch (_e) {
            // Keep loop alive while stream frame loads.
        }
        requestAnimationFrame(drawFrame);
    }

    function switchView(viewName) {
        state.currentView = viewName;
        const showExecute = viewName === "execute";
        const showHistory = viewName === "history";
        const showNavigation = viewName === "navigation";

        el.executeView.style.display = showExecute ? "grid" : "none";
        el.historyView.style.display = showHistory ? "block" : "none";

        el.navExecuteBtn.classList.toggle("active", showExecute);
        el.navHistoryBtn.classList.toggle("active", showHistory);
        if (el.navigationView) { el.navigationView.style.display = showNavigation ? "block" : "none"; }
        if (el.navNavigationBtn) { el.navNavigationBtn.classList.toggle("active", showNavigation); }

        if (showNavigation) {
            // Delay init slightly so container has correct dimensions after display:block
            setTimeout(() => initEmbeddedNav(), 50);
        }
        if (showHistory) {
            loadMissionHistory();
        }
    }

    function fmtMaybeNum(v, digits = 6) {
        const n = Number(v);
        return Number.isFinite(n) ? n.toFixed(digits) : "-";
    }

    function escapeHtml(str) {
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/\"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function persistMissionPlan(planPayload) {
        try {
            localStorage.setItem(MISSION_PLAN_STORAGE_KEY, JSON.stringify(planPayload));
        } catch (_e) {
            // Ignore storage quota/privacy mode errors.
        }
    }

    function resolveMissionClusteredImageUrl(mission) {
        if (!mission || typeof mission !== "object") {
            return null;
        }
        if (mission.clustered_image_url) {
            return mission.clustered_image_url;
        }

        const summary = mission.cluster_summary || {};
        if (summary.local_clustered_image_url) {
            return summary.local_clustered_image_url;
        }

        const src = String(mission.source_filename || "").trim();
        if (!src) {
            return null;
        }
        return `/captured_images/clustered_${encodeURIComponent(src)}`;
    }

    function renderHistoryCard(mission) {
        const telemetry = mission.telemetry || {};
        const summary = mission.cluster_summary || {};
        const created = mission.created_at ? new Date(mission.created_at).toLocaleString() : "-";
        const clusteredImageUrl = resolveMissionClusteredImageUrl(mission);
        const imgHtml = clusteredImageUrl
            ? `<img src="${clusteredImageUrl}" alt="Mission clustered result" loading="lazy">`
            : "";
        const waypoint = mission.waypoint_content || "No waypoint content saved";
        const missionId = escapeHtml(mission.id || "");

        return `
            <article class="history-card history-card-clickable" data-mission-id="${missionId}" role="button" tabindex="0" aria-label="Restore mission ${missionId}">
                <h3>Mission ${missionId || "-"}</h3>
                <div class="history-kv">Captured: ${escapeHtml(created)}</div>
                <div class="history-kv">Source: ${escapeHtml(mission.source_filename || "-")}</div>
                ${imgHtml}
                <div class="history-kv">Lat: ${fmtMaybeNum(telemetry.lat, 7)} | Lon: ${fmtMaybeNum(telemetry.lon, 7)}</div>
                <div class="history-kv">Alt: ${fmtMaybeNum(telemetry.alt_m, 1)} m | Speed: ${fmtMaybeNum(telemetry.speed_mps, 2)} m/s</div>
                <div class="history-kv">Fix: ${escapeHtml(telemetry.fix_type ?? "-")} | Sats: ${escapeHtml(telemetry.sats ?? "-")}</div>
                <div class="history-kv">Clusters: ${escapeHtml(summary.num_groups ?? "-")} | Balloons: ${escapeHtml(summary.total_balloons ?? "-")}</div>
                <div class="history-waypoint">${escapeHtml(waypoint)}</div>
                <div class="history-restore-hint">Click to restore this mission on Execute view</div>
            </article>
        `;
    }

    function renderClusterSummaryHtmlFromStoredMission(summary) {
        const data = summary || {};
        const groupCoordinates = Array.isArray(data.group_coordinates) ? data.group_coordinates : [];
        const clusterSizes = Array.isArray(data.cluster_sizes) ? data.cluster_sizes : [];
        const numGroups = Number(data.num_groups || 0);

        let html = "";
        let singles = 0;
        const groupCoordsByNumber = new Map();
        groupCoordinates.forEach((g) => {
            groupCoordsByNumber.set(g.group, g);
        });

        for (let i = 0; i < clusterSizes.length; i += 1) {
            if (i < numGroups) {
                const groupNumber = i + 1;
                const g = groupCoordsByNumber.get(groupNumber);
                let coordsHtml = "";
                if (g && Number.isFinite(Number(g.lat)) && Number.isFinite(Number(g.lon))) {
                    const px = g.center_pixel || {};
                    coordsHtml = `<div style="margin-left:20px;color:#c8d7e8;">Lat: ${Number(g.lat).toFixed(7)} | Lon: ${Number(g.lon).toFixed(7)} | Px: (${px.u ?? "-"}, ${px.v ?? "-"})</div>`;
                }
                html += `<div style="display:flex;align-items:center;gap:8px;margin:5px 0;">
                    <span style="width:12px;height:12px;border-radius:3px;background:${groupColors[i % groupColors.length]};display:inline-block;"></span>
                    <span style="color:${groupColors[i % groupColors.length]};font-weight:600;">Group ${groupNumber}</span>
                    <span>${clusterSizes[i]} people</span>
                </div>${coordsHtml}`;
            } else {
                singles += Number(clusterSizes[i] || 0);
            }
        }

        if (singles > 0) {
            html += `<div style="margin-top:6px;color:#c8d7e8;">Single detections: ${singles}</div>`;
        }

        if (Array.isArray(data.storage_errors) && data.storage_errors.length > 0) {
            html += `<div style="margin-top:8px;color:#f7d9a8;">Storage warnings: ${data.storage_errors.join("; ")}</div>`;
        }

        return html || "No clusters found";
    }

    function applyMissionToExecuteView(mission) {
        const telemetry = mission.telemetry || {};
        const summary = mission.cluster_summary || {};

        state.lastCapturedFilename = mission.source_filename || null;
        state.lastClusterResult = {
            mission_wpl: mission.waypoint_content || null,
            waypoint_file_url: mission.waypoint_file_url || null,
            group_coordinates: Array.isArray(summary.group_coordinates) ? summary.group_coordinates : [],
            cluster_sizes: Array.isArray(summary.cluster_sizes) ? summary.cluster_sizes : [],
            num_groups: Number(summary.num_groups || 0),
            total_balloons: Number(summary.total_balloons || 0),
            image_url: resolveMissionClusteredImageUrl(mission),
            mission_id: mission.id || null
        };

        const lat = Number(telemetry.lat);
        const lon = Number(telemetry.lon);
        const alt = Number(telemetry.alt_m);
        const speed = Number(telemetry.speed_mps);
        const heading = Number(telemetry.heading_deg);
        const ts = Number(telemetry.timestamp);

        el.telemetryLatVal.textContent = Number.isFinite(lat) ? lat.toFixed(7) : "-";
        el.telemetryLonVal.textContent = Number.isFinite(lon) ? lon.toFixed(7) : "-";
        el.altitudeVal.textContent = Number.isFinite(alt) ? `${alt.toFixed(1)} m` : "-";
        el.speedVal.textContent = Number.isFinite(speed) ? `${speed.toFixed(2)} m/s` : "-";
        el.headingVal.textContent = Number.isFinite(heading) ? `${heading.toFixed(1)} deg` : "-";
        el.fixVal.textContent = telemetry.fix_type ?? "-";
        el.satsVal.textContent = telemetry.sats ?? "-";
        const rawSource = telemetry.source ?? "mission-history";
        el.sourceVal.textContent = formatSourceLabel(rawSource);
        el.sourceVal.title = rawSource;
        el.timestampVal.textContent = Number.isFinite(ts)
            ? new Date(ts * 1000).toLocaleTimeString()
            : (mission.created_at ? new Date(mission.created_at).toLocaleTimeString() : "-");

        if (Number.isFinite(lat) && Number.isFinite(lon)) {
            el.gpsLat.textContent = lat.toFixed(7);
            el.gpsLon.textContent = lon.toFixed(7);
            updateGpsMap(lat, lon);
            state.gpsLive = true;
        }
        el.gpsFix.textContent = telemetry.fix_type ?? "-";
        el.gpsSats.textContent = telemetry.sats ?? "-";

        if (mission.created_at) {
            const createdTs = Date.parse(mission.created_at);
            if (Number.isFinite(createdTs)) {
                const elapsed = Math.max(0, Math.floor((Date.now() - createdTs) / 1000));
                const mins = Math.floor(elapsed / 60);
                const secs = elapsed % 60;
                el.flightTimeVal.textContent = `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
            }
        }

        updateStatsOverlay(
            Number(summary.total_balloons || 0),
            0,
            Number(summary.num_groups || 0)
        );

        const restoredImageUrl = resolveMissionClusteredImageUrl(mission);
        if (restoredImageUrl) {
            el.capturedImg.onerror = () => {
                el.capturedImg.style.display = "none";
                el.capturePlaceholder.style.display = "block";
                el.capturePlaceholder.textContent = "Clustered image could not be loaded from storage or local cache.";
            };
            el.capturedImg.src = `${restoredImageUrl}${restoredImageUrl.includes("?") ? "&" : "?"}t=${Date.now()}`;
            el.capturedImg.style.display = "block";
            el.capturePlaceholder.style.display = "none";
            el.capturePanelTitle.textContent = "Clustered Frame (Restored)";
        } else {
            el.capturedImg.style.display = "none";
            el.capturePlaceholder.style.display = "block";
            el.capturePlaceholder.textContent = "No stored clustered image for this mission.";
            el.capturePanelTitle.textContent = "Captured Frame";
        }

        const summaryHtml = renderClusterSummaryHtmlFromStoredMission(summary);
        el.clusteringSummaryContent.innerHTML = `${summaryHtml}<div style="margin-top:8px;color:#8ef0c4;">Restored from mission history: ${escapeHtml(mission.id || "-")}</div>`;
        el.clusteringSummaryPanel.style.display = "block";

        if (Number.isFinite(lat)) {
            el.startLat.value = lat.toFixed(7);
        }
        if (Number.isFinite(lon)) {
            el.startLon.value = lon.toFixed(7);
        }

        switchView("execute");
        showToast("Mission restored to Execute dashboard", true);
    }

    function restoreMissionById(missionId) {
        const safeId = String(missionId || "").trim();
        if (!safeId) {
            return;
        }
        el.historyStatus.textContent = `Restoring mission ${safeId}...`;

        const fallbackMission = (state.historyMissions || []).find((m) => String(m.id) === safeId);

        fetch(`/api/missions/${encodeURIComponent(safeId)}`)
            .then((res) => res.json())
            .then((data) => {
                if (data.ok && data.mission) {
                    applyMissionToExecuteView(data.mission);
                    el.historyStatus.textContent = "Mission restored. You are now on Execute view.";
                    return;
                }

                if (fallbackMission) {
                    applyMissionToExecuteView(fallbackMission);
                    el.historyStatus.textContent = "Mission restored from cached history payload.";
                    return;
                }

                showToast(data.error || "Failed to restore mission", true);
                el.historyStatus.textContent = "Mission restore failed.";
            })
            .catch(() => {
                if (fallbackMission) {
                    applyMissionToExecuteView(fallbackMission);
                    el.historyStatus.textContent = "Mission restored from cached history payload.";
                    return;
                }
                el.historyStatus.textContent = "Mission restore failed.";
                showToast("Mission restore failed", true);
            });
    }

    function loadMissionHistory() {
        el.historyStatus.textContent = "Loading mission history...";
        el.historyList.innerHTML = "";

        fetch("/api/missions")
            .then((res) => res.json())
            .then((data) => {
                if (!data.ok) {
                    el.historyStatus.textContent = data.error || "Failed to load mission history";
                    return;
                }
                const missions = Array.isArray(data.missions) ? data.missions : [];
                state.historyMissions = missions;
                if (!missions.length) {
                    el.historyStatus.textContent = "No mission records found in Supabase yet.";
                    return;
                }
                el.historyStatus.textContent = `Loaded ${missions.length} mission record(s).`;
                el.historyList.innerHTML = missions.map(renderHistoryCard).join("");
            })
            .catch(() => {
                el.historyStatus.textContent = "Mission history service unavailable";
            });
    }

    function startStatsPolling() {
        if (state.statsInterval) {
            clearInterval(state.statsInterval);
        }
        state.statsInterval = setInterval(() => {
            fetch("/stats")
                .then((r) => r.json())
                .then((data) => updateStatsOverlay(data.people, data.fps, data.groups))
                .catch(() => {
                    // Keep last values if stats are temporarily unavailable.
                });
        }, 300);
    }

    function stopStatsPolling() {
        if (state.statsInterval) {
            clearInterval(state.statsInterval);
            state.statsInterval = null;
        }
        updateStatsOverlay(0, 0, 0);
    }

    function startStream() {
        if (!state.selectedSource) {
            showToast("Please select a source first", true);
            return;
        }

        const streamUrl = state.selectedSource === "Jetson Nano (Live)" ? "/live_stream" : "/stream";
        const selectPromise = state.selectedSource === "Jetson Nano (Live)"
            ? Promise.resolve()
            : fetch(`/select/${state.selectedSource}`).then((res) => {
                if (!res.ok) {
                    throw new Error("select failed");
                }
            });

        selectPromise
            .then(() => {
                state.streamingActive = true;
                streamImage.src = streamUrl;
                streamImage.onload = drawFrame;
                if (el.videoStage) {
                    el.videoStage.classList.add("stream-active");
                }
                setConnectionStatus(true);
                startStatsPolling();
                showToast("Stream started", true);
            })
            .catch(() => {
                showToast("Failed to start stream", true);
            });
    }

    function stopStream(options = {}) {
        const announce = options.announce !== false;
        state.streamingActive = false;
        streamImage.src = "";
        ctx.clearRect(0, 0, el.videoCanvas.width, el.videoCanvas.height);
        if (el.videoStage) {
            el.videoStage.classList.remove("stream-active");
        }
        setConnectionStatus(false, announce);
        stopStatsPolling();
        if (announce) {
            showToast("Stream stopped", true);
        }
    }

    function updateTelemetry() {
        if (!state.gpsLive) {
            el.altitudeVal.textContent = "-";
            el.distanceVal.textContent = "-";
            el.batteryVal.textContent = "-";
            el.batteryBar.style.width = "0%";
            el.flightTimeVal.textContent = "-";
            el.telemetryLatVal.textContent = "-";
            el.telemetryLonVal.textContent = "-";
            el.headingVal.textContent = "-";
            el.speedVal.textContent = "-";
            el.fixVal.textContent = "Waiting Cube GPS";
            el.satsVal.textContent = "-";
            el.sourceVal.textContent = "-";
            el.timestampVal.textContent = "-";
            return;
        }

        // Battery is not available from current GPS bridge payload yet.
        el.batteryVal.textContent = "-";
        el.batteryBar.style.width = "0%";
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

    function updateGpsMap(lat, lon) {
        if (!el.gpsMapFrame) {
            return;
        }
        el.gpsMapFrame.src = `https://www.google.com/maps?q=${lat},${lon}&z=18&output=embed`;
    }

    function formatSourceLabel(source) {
        if (!source || source === "-") {
            return "-";
        }
        try {
            if (source.startsWith("http://") || source.startsWith("https://")) {
                const u = new URL(source);
                return u.host;
            }
        } catch (_e) {
            // Fallback to raw source string.
        }
        return source;
    }

    function pollGps() {
        fetch("/gps")
            .then((res) => res.json())
            .then((data) => {
                if (!data.ok || data.lat === null || data.lon === null) {
                    const rawSource = data.source ?? "-";
                    const sourceLabel = formatSourceLabel(rawSource);
                    el.sourceVal.textContent = sourceLabel;
                    el.sourceVal.title = rawSource;
                    el.timestampVal.textContent = data.timestamp
                        ? new Date(Number(data.timestamp) * 1000).toLocaleTimeString()
                        : "-";

                    // Surface bridge/GPS reason instead of hiding everything as blank.
                    if (data.error) {
                        if (/stale/i.test(String(data.error))) {
                            el.fixVal.textContent = "Stale GPS";
                        } else if (/MAVLink|no MAVLink|no MAVLINK/i.test(String(data.error))) {
                            el.fixVal.textContent = "No MAVLink GPS";
                        } else {
                            el.fixVal.textContent = "No GPS Fix";
                        }
                    } else {
                        el.fixVal.textContent = "Waiting Cube GPS";
                    }

                    state.gpsLive = false;
                    return;
                }
                el.gpsLat.textContent = Number(data.lat).toFixed(7);
                el.gpsLon.textContent = Number(data.lon).toFixed(7);
                el.gpsFix.textContent = data.fix_type ?? "-";
                el.gpsSats.textContent = data.sats ?? "-";
                updateGpsMap(data.lat, data.lon);
                state.gpsLive = true;
                if (el.miniGpsLat) el.miniGpsLat.textContent = Number(data.lat).toFixed(6);
                if (el.miniGpsLon) el.miniGpsLon.textContent = Number(data.lon).toFixed(6);
                if (el.miniGpsFix) el.miniGpsFix.textContent = data.fix_type ?? "-";
                if (el.miniGpsSats) el.miniGpsSats.textContent = data.sats ?? "-";
                // Auto-fill AI Mission Intelligence start coords if fields are empty
                if (el.startLat && !el.startLat.value.trim()) el.startLat.value = Number(data.lat).toFixed(7);
                if (el.startLon && !el.startLon.value.trim()) el.startLon.value = Number(data.lon).toFixed(7);
                if (el.aiGpsSourceChip) {
                    el.aiGpsSourceChip.textContent = "GPS: Live";
                    el.aiGpsSourceChip.style.borderColor = "rgba(62,233,214,0.7)";
                    el.aiGpsSourceChip.style.color = "#a8fff5";
                }

                const lat = Number(data.lat);
                const lon = Number(data.lon);
                el.telemetryLatVal.textContent = Number.isFinite(lat) ? lat.toFixed(7) : "-";
                el.telemetryLonVal.textContent = Number.isFinite(lon) ? lon.toFixed(7) : "-";
                el.headingVal.textContent = data.heading_deg !== null && data.heading_deg !== undefined
                    ? `${Number(data.heading_deg).toFixed(1)} deg`
                    : "-";
                el.speedVal.textContent = data.speed_mps !== null && data.speed_mps !== undefined
                    ? `${Number(data.speed_mps).toFixed(2)} m/s`
                    : "-";
                el.fixVal.textContent = data.fix_type ?? "-";
                el.satsVal.textContent = data.sats ?? "-";
                const rawSource = data.source ?? "-";
                el.sourceVal.textContent = formatSourceLabel(rawSource);
                el.sourceVal.title = rawSource;
                el.timestampVal.textContent = data.timestamp
                    ? new Date(Number(data.timestamp) * 1000).toLocaleTimeString()
                    : "-";

                if (state.homeLat === null || state.homeLon === null) {
                    state.homeLat = lat;
                    state.homeLon = lon;
                }
                if (state.firstGpsTs === null && data.timestamp) {
                    state.firstGpsTs = Number(data.timestamp);
                }
                if (state.homeLat !== null && state.homeLon !== null && Number.isFinite(lat) && Number.isFinite(lon)) {
                    const distance = haversineMeters(state.homeLat, state.homeLon, lat, lon);
                    el.distanceVal.textContent = `${distance.toFixed(1)} m`;
                }
                if (state.firstGpsTs !== null && data.timestamp) {
                    const elapsed = Math.max(0, Math.floor(Number(data.timestamp) - state.firstGpsTs));
                    const mins = Math.floor(elapsed / 60);
                    const secs = elapsed % 60;
                    el.flightTimeVal.textContent = `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
                }

                if (data.alt_m !== null && data.alt_m !== undefined) {
                    el.altitudeVal.textContent = `${Number(data.alt_m).toFixed(1)} m`;
                }
            })
            .catch(() => {
                // Keep existing values when GPS endpoint is unavailable.
            });
    }

    function publishLaptopGps() {
        if (!navigator.geolocation) {
            return;
        }
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const payload = {
                    lat: pos.coords.latitude,
                    lon: pos.coords.longitude,
                    alt_m: pos.coords.altitude,
                    speed_mps: pos.coords.speed,
                    timestamp: Date.now() / 1000
                };
                fetch("/gps/laptop", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload)
                }).catch(() => {
                    // Ignore transient GPS publish failures.
                });
            },
            () => {
                // Permission denied or unavailable.
            },
            { enableHighAccuracy: true, maximumAge: 3000, timeout: 4000 }
        );
    }

    function fmtEta(totalSec) {
        const h = Math.floor(totalSec / 3600);
        const m = Math.floor((totalSec % 3600) / 60);
        const s = totalSec % 60;
        if (h > 0) {
            return `${h}h ${m}m ${s}s`;
        }
        if (m > 0) {
            return `${m}m ${s}s`;
        }
        return `${s}s`;
    }

    function renderAlerts(alerts) {
        el.aiAlerts.innerHTML = alerts
            .map((a) => {
                const level = (a.type || "info").toUpperCase();
                return `<div>[${level}] ${a.message}</div>`;
            })
            .join("");
    }

    function pollAiAnomaly() {
        fetch("/ai/anomaly")
            .then((res) => res.json())
            .then((data) => {
                if (!data.alerts || !data.alerts.length) {
                    return;
                }
                renderAlerts(data.alerts);
            })
            .catch(() => {
                el.aiAlerts.textContent = "AI anomaly service unavailable";
            });
    }

    function pollAiEta() {
        const lat = parseFloat(el.targetLat.value);
        const lon = parseFloat(el.targetLon.value);
        if (Number.isNaN(lat) || Number.isNaN(lon)) {
            return;
        }
        fetch(`/ai/eta?lat=${lat}&lon=${lon}`)
            .then((res) => res.json())
            .then((data) => {
                if (!data.ok) {
                    return;
                }
                el.aiDistance.textContent = `${data.distance_m} m`;
                el.aiEta.textContent = fmtEta(data.eta_s);
            })
            .catch(() => {
                // Ignore transient ETA poll failures.
            });
    }

    function getBrowserPosition() {
        return new Promise((resolve, reject) => {
            if (!navigator.geolocation) {
                reject(new Error("Browser geolocation not supported"));
                return;
            }
            navigator.geolocation.getCurrentPosition(
                (pos) => resolve(pos),
                (err) => reject(err),
                { enableHighAccuracy: true, maximumAge: 3000, timeout: 4000 }
            );
        });
    }

    async function runAiPlan() {
        const lat = parseFloat(el.targetLat.value);
        const lon = parseFloat(el.targetLon.value);
        if (Number.isNaN(lat) || Number.isNaN(lon)) {
            showToast("Enter valid target coordinates");
            return;
        }

        let startLat = parseFloat(el.gpsLat.textContent);
        let startLon = parseFloat(el.gpsLon.textContent);

        if (Number.isNaN(startLat) || Number.isNaN(startLon)) {
            const manualStartLat = parseFloat(el.startLat.value);
            const manualStartLon = parseFloat(el.startLon.value);
            if (!Number.isNaN(manualStartLat) && !Number.isNaN(manualStartLon)) {
                startLat = manualStartLat;
                startLon = manualStartLon;
            } else {
                try {
                    const pos = await getBrowserPosition();
                    startLat = pos.coords.latitude;
                    startLon = pos.coords.longitude;
                    el.gpsLat.textContent = Number(startLat).toFixed(7);
                    el.gpsLon.textContent = Number(startLon).toFixed(7);

                    fetch("/gps/laptop", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            lat: startLat,
                            lon: startLon,
                            alt_m: pos.coords.altitude,
                            speed_mps: pos.coords.speed,
                            timestamp: Date.now() / 1000
                        })
                    }).catch(() => {
                        // Ignore GPS post errors during plan fallback.
                    });
                } catch (_e) {
                    showToast("No current GPS. Enter Start Lat/Lon or allow browser location");
                    return;
                }
            }
        }

        fetch("/ai/plan", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                start: { lat: startLat, lon: startLon },
                target: { lat, lon },
                no_fly: []
            })
        })
            .then((res) => res.json())
            .then((data) => {
                if (!data.ok) {
                    showToast("AI planner failed", true);
                    return;
                }
                el.aiDistance.textContent = `${data.distance_m} m`;
                el.aiEta.textContent = fmtEta(data.eta_s);
                el.aiPlanSummary.innerHTML = data.waypoints
                    .map((w, i) => `${i + 1}. ${w.type.toUpperCase()} (${Number(w.lat).toFixed(6)}, ${Number(w.lon).toFixed(6)})`)
                    .join("<br>");
                persistMissionPlan({
                    updated_at: new Date().toISOString(),
                    distance_m: data.distance_m,
                    eta_s: data.eta_s,
                    waypoints: Array.isArray(data.waypoints) ? data.waypoints : [],
                    start: { lat: startLat, lon: startLon },
                    target: { lat, lon },
                    source: "dashboard_ai_plan"
                });
                updateGpsMap(lat, lon);
                showToast("AI plan generated", true);
            })
            .catch(() => showToast("AI planner failed", true));
    }

    function runCapture() {
        if (!state.streamingActive) {
            showToast("Start stream first to capture current Vision Feed frame", true);
            return;
        }

        let filename = window.prompt("Enter a name for the captured image (without extension):");
        if (!filename) {
            showToast("Capture cancelled", true);
            return;
        }

        filename = filename.replace(/[^a-zA-Z0-9_-]/g, "");
        if (!filename) {
            showToast("Invalid filename", true);
            return;
        }

        fetch("/capture", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ filename })
        })
            .then((res) => res.json())
            .then((data) => {
                if (!data.image_url) {
                    showToast("Failed to capture image", true);
                    return;
                }
                el.capturedImg.src = `${data.image_url}?t=${Date.now()}`;
                el.capturedImg.style.display = "block";
                el.capturePlaceholder.style.display = "none";
                el.capturePanelTitle.textContent = "Captured Frame";
                state.lastCapturedFilename = data.image_url.split("/").pop().split("?")[0];
                showToast("Capture completed successfully", true);
            })
            .catch(() => {
                showToast("Failed to capture image", true);
            });
    }

    function runClustering() {
        if (!state.lastCapturedFilename) {
            showToast("No captured image to cluster", true);
            return;
        }

        fetch("/cluster_image", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ filename: state.lastCapturedFilename })
        })
            .then((res) => res.json())
            .then((data) => {
                state.lastClusterResult = data;
                if (!data.image_url) {
                    showToast("Clustering failed", true);
                    return;
                }

                el.capturedImg.src = `${data.image_url}?t=${Date.now()}`;
                el.capturedImg.style.display = "block";
                el.capturePlaceholder.style.display = "none";
                el.capturePanelTitle.textContent = "Clustered Frame";

                let html = "";
                let singles = 0;
                const groupCoordsByNumber = new Map();
                if (Array.isArray(data.group_coordinates)) {
                    data.group_coordinates.forEach((g) => {
                        groupCoordsByNumber.set(g.group, g);
                    });
                }
                if (data.cluster_sizes && data.cluster_sizes.length > 0) {
                    for (let i = 0; i < data.cluster_sizes.length; i += 1) {
                        if (data.num_groups && i < data.num_groups) {
                            const groupNumber = i + 1;
                            const g = groupCoordsByNumber.get(groupNumber);
                            let coordsHtml = "";
                            if (g && Number.isFinite(g.lat) && Number.isFinite(g.lon)) {
                                coordsHtml = `<div style="margin-left:20px;color:#c8d7e8;">Lat: ${Number(g.lat).toFixed(7)} | Lon: ${Number(g.lon).toFixed(7)} | Px: (${g.center_pixel.u}, ${g.center_pixel.v})</div>`;
                            }
                            html += `<div style="display:flex;align-items:center;gap:8px;margin:5px 0;">
                                <span style="width:12px;height:12px;border-radius:3px;background:${groupColors[i % groupColors.length]};display:inline-block;"></span>
                                <span style="color:${groupColors[i % groupColors.length]};font-weight:600;">Group ${groupNumber}</span>
                                <span>${data.cluster_sizes[i]} people</span>
                            </div>${coordsHtml}`;
                        } else {
                            singles += data.cluster_sizes[i];
                        }
                    }
                }

                if (singles > 0) {
                    html += `<div style="margin-top:6px;color:#c8d7e8;">Single detections: ${singles}</div>`;
                }

                if (data.geo_error) {
                    html += `<div style="margin-top:8px;color:#f7b0b0;">Coordinate estimation unavailable: ${data.geo_error}</div>`;
                }

                if (data.mission_saved) {
                    html += `<div style="margin-top:8px;color:#8ef0c4;">Mission saved to Supabase history.</div>`;
                    if (data.mission_save_warning) {
                        html += `<div style="margin-top:8px;color:#f7d9a8;">Saved with warning: ${data.mission_save_warning}</div>`;
                    }
                } else if (data.mission_save_error) {
                    html += `<div style="margin-top:8px;color:#f7b0b0;">Mission save failed: ${data.mission_save_error}</div>`;
                } else if (data.mission_save_reason) {
                    html += `<div style="margin-top:8px;color:#f7d9a8;">Mission not saved: ${data.mission_save_reason}</div>`;
                }

                el.clusteringSummaryContent.innerHTML = html || "No clusters found";
                el.clusteringSummaryPanel.style.display = "block";
                if (data.mission_saved) {
                    if (data.mission_save_warning) {
                        showToast("Clustering saved with storage warning", true);
                    } else {
                        showToast("Clustering complete and saved to history", true);
                    }
                } else if (data.mission_save_error || data.mission_save_reason) {
                    showToast("Clustering complete but history save failed", true);
                } else {
                    showToast("Clustering complete", true);
                }
            })
            .catch(() => {
                showToast("Clustering failed", true);
            });
    }

    function downloadTextFile(filename, text, mimeType) {
        const blob = new Blob([text], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    function downloadCoordsJson() {
        const data = state.lastClusterResult;
        if (!data || !Array.isArray(data.group_coordinates) || data.group_coordinates.length === 0) {
            showToast("No coordinates available yet", true);
            return;
        }
        const payload = {
            generated_at: new Date().toISOString(),
            total_groups: data.group_coordinates.length,
            group_coordinates: data.group_coordinates
        };
        downloadTextFile(`group_coordinates_${Date.now()}.json`, JSON.stringify(payload, null, 2), "application/json");
        showToast("Coordinates JSON downloaded", true);
    }

    function downloadMissionFile() {
        const data = state.lastClusterResult;
        if (!data) {
            showToast("Mission file not available yet", true);
            return;
        }
        if (data.mission_wpl) {
            downloadTextFile(`group_mission_${Date.now()}.waypoints`, data.mission_wpl, "text/plain");
            showToast("QGC mission downloaded", true);
            return;
        }
        if (data.waypoint_file_url) {
            window.open(data.waypoint_file_url, "_blank", "noopener,noreferrer");
            showToast("Opened stored waypoint file", true);
            return;
        }
        showToast("Mission file not available yet", true);
    }

    function bindEvents() {
        el.videoSource.addEventListener("change", function onSourceChange() {
            state.selectedSource = this.value;
            el.videoSourceLabel.textContent = state.selectedSource || "No Source Selected";
            stopStream({ announce: false });
            if (state.selectedSource) {
                speak(`Source selected: ${state.selectedSource}`);
            }
        });

        el.startBtn.addEventListener("click", startStream);
        el.stopBtn.addEventListener("click", () => stopStream());
        el.captureBtn.addEventListener("click", runCapture);
        el.clusterBtn.addEventListener("click", runClustering);
        el.downloadCoordsJsonBtn.addEventListener("click", downloadCoordsJson);
        el.downloadMissionBtn.addEventListener("click", downloadMissionFile);
        el.aiPlanBtn.addEventListener("click", runAiPlan);

        const aiSyncGpsBtn = document.getElementById("aiSyncGpsBtn");
        if (aiSyncGpsBtn) {
            aiSyncGpsBtn.addEventListener("click", () => {
                fetch("/gps").then(r => r.json()).then(data => {
                    if (data.ok && data.lat != null && data.lon != null) {
                        if (el.startLat) el.startLat.value = Number(data.lat).toFixed(7);
                        if (el.startLon) el.startLon.value = Number(data.lon).toFixed(7);
                        showToast("Start coords synced from live GPS", true);
                    } else {
                        showToast("No live GPS available", false);
                    }
                }).catch(() => showToast("GPS sync failed", false));
            });
        }

        el.navExecuteBtn.addEventListener("click", () => switchView("execute"));
        el.navHistoryBtn.addEventListener("click", () => switchView("history"));
        if (el.navNavigationBtn) {
            el.navNavigationBtn.addEventListener("click", () => switchView("navigation"));
        }
        el.refreshHistoryBtn.addEventListener("click", loadMissionHistory);
        el.historyList.addEventListener("click", (event) => {
            const card = event.target.closest(".history-card[data-mission-id]");
            if (!card) {
                return;
            }
            restoreMissionById(card.getAttribute("data-mission-id"));
        });
        el.historyList.addEventListener("keydown", (event) => {
            if (event.key !== "Enter" && event.key !== " ") {
                return;
            }
            const card = event.target.closest(".history-card[data-mission-id]");
            if (!card) {
                return;
            }
            event.preventDefault();
            restoreMissionById(card.getAttribute("data-mission-id"));
        });

        el.modeNormalBtn.addEventListener("click", () => setMode("normal"));
        el.modeCruiseBtn.addEventListener("click", () => setMode("cruise"));
        el.modeEmergencyBtn.addEventListener("click", () => setMode("emergency"));

        el.engageCruiseBtn.addEventListener("click", () => {
            setMode("cruise");
            const speed = Number(el.cruiseSpeed.value || 8);
            const corridor = Number(el.corridorWidth.value || 35);
            const autoCorrect = el.autoCorrect.checked ? "ON" : "OFF";
            showToast(`Cruise engaged: ${speed} m/s, corridor ${corridor} m, auto-correct ${autoCorrect}`, true);
        });

        el.rtlBtn.addEventListener("click", () => {
            setMode("emergency");
            showToast("Emergency action: Return To Launch", true);
        });

        el.landNowBtn.addEventListener("click", () => {
            setMode("emergency");
            showToast("Emergency action: Land Now", true);
        });

        el.emergencyStopBtn.addEventListener("click", () => {
            const confirmed = window.confirm("Confirm EMERGENCY STOP?");
            if (!confirmed) {
                return;
            }
            setMode("emergency");
            stopStream({ announce: false });
            showToast("Emergency stop activated", true);
        });
    }

    function startSchedulers() {
        setInterval(updateDateTime, 1000);
        updateDateTime();

        state.telemetryInterval = setInterval(updateTelemetry, 1000);
        updateTelemetry();

        setInterval(pollGps, 1000);
        pollGps();

        setInterval(publishLaptopGps, 2000);
        publishLaptopGps();

        setInterval(pollAiAnomaly, 2000);
        pollAiAnomaly();

        setInterval(pollAiEta, 2000);
    }

    function init() {
        setConnectionStatus(false, false);
        setMode("normal", { announce: false });
        switchView("execute");
        bindEvents();
        startSchedulers();

        if (speechSupported()) {
            // Prime voices list in Chromium-based browsers.
            window.speechSynthesis.getVoices();
            window.speechSynthesis.onvoiceschanged = () => {
                window.speechSynthesis.getVoices();
            };
        }

        setTimeout(() => {
            announceWelcomeAndStatus();
        }, 600);
    }

    init();
})();

/* ─────────────────────────────────────────────────────────────────────────
   Embedded Navigation Map — initialized lazily when Navigation tab opens
   Uses Leaflet (always available, no token required) + /gps polling
───────────────────────────────────────────────────────────────────────── */
(function () {
    const EMBED_PLAN_KEY = "ground_control_navigation_plan_v1";
    const TILE_NORMAL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
    const TILE_SAT = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
    const ATTR_NORMAL = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
    const ATTR_SAT = "Tiles &copy; Esri";
    const MAX_TRACK = 2000;
    const POLL_MS = 1000;
    const DEFAULT_LAT = 3.1390;
    const DEFAULT_LON = 101.6869;

    let initialized = false;
    let map = null;
    let tileLayer = null;
    let droneMarker = null;
    let startMarker = null;
    let targetMarker = null;
    let plannedLine = null;
    let actualLine = null;
    let pollTimer = null;

    let mode = "normal";
    let autoCenter = true;
    let actualTrack = [];
    let plannedWaypoints = [];
    let plannedDistM = null;
    let startPoint = null;
    let targetPoint = null;
    let currentPoint = null;

    function $(id) { return document.getElementById(id); }

    const ids = {
        map: "navMapEmbed",
        recenter: "embedRecenterBtn",
        genBtn: "embedGenerateBtn",
        clearBtn: "embedClearBtn",
        modeBtn: "embedMapModeBtn",
        autoCenterBtn: "embedAutoCenterBtn",
        zoom: "embedZoom",
        targetLat: "embedTargetLat",
        targetLon: "embedTargetLon",
        speed: "embedSpeed",
        heading: "embedHeading",
        distance: "embedDistance",
        eta: "embedEta",
        progress: "embedProgress",
        gpsStatus: "embedGpsStatus",
        sats: "embedSats",
        source: "embedSource",
    };

    function haverM(la1, lo1, la2, lo2) {
        const R = 6371000, r = Math.PI / 180;
        const dLa = (la2 - la1) * r, dLo = (lo2 - lo1) * r;
        const a = Math.sin(dLa / 2) ** 2 + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin(dLo / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    function fmtDist(m) {
        if (!Number.isFinite(m)) return "-";
        return m >= 1000 ? (m / 1000).toFixed(2) + " km" : m.toFixed(1) + " m";
    }

    function fmtEta(s) {
        if (!Number.isFinite(s) || s < 0) return "-";
        const sec = Math.round(s);
        const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), ss = sec % 60;
        if (h > 0) return h + "h " + m + "m " + ss + "s";
        if (m > 0) return m + "m " + ss + "s";
        return ss + "s";
    }

    function setText(id, v) { const el = $(id); if (el) el.textContent = v; }

    function setTileLayer() {
        if (!map) return;
        if (tileLayer) map.removeLayer(tileLayer);
        const url = mode === "normal" ? TILE_NORMAL : TILE_SAT;
        const attr = mode === "normal" ? ATTR_NORMAL : ATTR_SAT;
        tileLayer = L.tileLayer(url, { attribution: attr, maxZoom: 20 }).addTo(map);
    }

    function makeDroneIcon() {
        return L.divIcon({
            className: "leaflet-drone-icon",
            html: '<div class="drone-marker"><div class="drone-marker-arrow"></div></div>',
            iconSize: [30, 30], iconAnchor: [15, 15]
        });
    }

    function makeStartIcon() {
        return L.divIcon({
            className: "leaflet-start-icon",
            html: '<div class="start-marker">S</div>',
            iconSize: [20, 20], iconAnchor: [10, 10]
        });
    }

    function makeTargetIcon() {
        return L.divIcon({
            className: "leaflet-target-icon",
            html: '<div class="target-marker">T</div>',
            iconSize: [20, 20], iconAnchor: [10, 10]
        });
    }

    function ensureDroneMarker(lat, lon) {
        if (!droneMarker) {
            droneMarker = L.marker([lat, lon], { icon: makeDroneIcon() }).addTo(map);
        } else {
            droneMarker.setLatLng([lat, lon]);
        }
        const el = droneMarker.getElement();
        return el ? el.querySelector(".drone-marker-arrow") : null;
    }

    function setHeading(arrowEl, deg) {
        if (arrowEl && Number.isFinite(deg)) arrowEl.style.transform = "rotate(" + deg + "deg)";
    }

    function redrawLines() {
        if (!map) return;
        if (plannedLine) plannedLine.setLatLngs(plannedWaypoints.map(p => [p.lat, p.lon]));
        if (actualLine) actualLine.setLatLngs(actualTrack.map(p => [p.lat, p.lon]));
    }

    function updateHud(pt, payload) {
        setText(ids.speed, pt && Number.isFinite(pt.speed_mps) ? pt.speed_mps.toFixed(2) + " m/s" : "-");
        setText(ids.heading, pt && Number.isFinite(pt.heading_deg) ? pt.heading_deg.toFixed(1) + " deg" : "-");
        setText(ids.sats, payload && payload.sats != null ? String(payload.sats) : "-");
        const fix = payload && payload.fix_type;
        const sats = payload && payload.sats;
        const gpsText = !payload || !payload.ok ? "No GPS" :
            (Number.isFinite(fix) && fix >= 3) ? (Number.isFinite(sats) && sats >= 8 ? "Locked" : "Weak Lock") : "No Fix";
        setText(ids.gpsStatus, gpsText);
        const src = payload && payload.source ? String(payload.source) : "-";
        try {
            const u = new URL(src);
            setText(ids.source, u.host);
        } catch (_) {
            setText(ids.source, src);
        }
        if (!pt || !targetPoint) {
            setText(ids.distance, "-"); setText(ids.eta, "-"); setText(ids.progress, "-");
            return;
        }
        const rem = haverM(pt.lat, pt.lon, targetPoint.lat, targetPoint.lon);
        setText(ids.distance, fmtDist(rem));
        const spd = Number(pt.speed_mps);
        setText(ids.eta, fmtEta(Number.isFinite(spd) && spd > 0.2 ? rem / spd : null));
        const base = Number.isFinite(plannedDistM) && plannedDistM > 0 ? plannedDistM :
            (startPoint ? haverM(startPoint.lat, startPoint.lon, targetPoint.lat, targetPoint.lon) : null);
        setText(ids.progress, Number.isFinite(base) && base > 0 ?
            Math.max(0, Math.min(100, (base - rem) / base * 100)).toFixed(1) + "%" : "-");
    }

    function handlePayload(payload) {
        if (!payload || !payload.ok || payload.lat == null || payload.lon == null) {
            updateHud(currentPoint, payload || {});
            return;
        }
        const lat = Number(payload.lat), lon = Number(payload.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
        const pt = {
            lat, lon,
            speed_mps: Number.isFinite(Number(payload.speed_mps)) ? Number(payload.speed_mps) : null,
            heading_deg: Number.isFinite(Number(payload.heading_deg)) ? Number(payload.heading_deg) : null,
            fix_type: Number.isFinite(Number(payload.fix_type)) ? Number(payload.fix_type) : null,
            sats: Number.isFinite(Number(payload.sats)) ? Number(payload.sats) : null,
        };
        currentPoint = pt;

        const arrow = ensureDroneMarker(lat, lon);
        setHeading(arrow, pt.heading_deg);

        const last = actualTrack[actualTrack.length - 1];
        if (!last || haverM(last.lat, last.lon, lat, lon) >= 0.35) {
            actualTrack.push(pt);
            if (actualTrack.length > MAX_TRACK) actualTrack.shift();
        }
        if (!startPoint) {
            startPoint = { lat, lon };
            if (!startMarker) startMarker = L.marker([lat, lon], { icon: makeStartIcon() }).addTo(map);
            else startMarker.setLatLng([lat, lon]);
        }
        redrawLines();
        if (autoCenter) map.panTo([lat, lon], { animate: true, duration: 0.7 });
        updateHud(pt, payload);
    }

    function startPolling() {
        if (pollTimer) return;
        const poll = () => {
            fetch("/gps").then(r => r.json()).then(handlePayload).catch(() => {});
        };
        poll();
        pollTimer = setInterval(poll, POLL_MS);
    }

    function bindEmbedEvents() {
        const rec = $(ids.recenter);
        if (rec) rec.addEventListener("click", () => {
            if (currentPoint) map.setView([currentPoint.lat, currentPoint.lon], map.getZoom());
        });

        const modeBtn = $(ids.modeBtn);
        if (modeBtn) modeBtn.addEventListener("click", () => {
            mode = mode === "normal" ? "satellite" : "normal";
            modeBtn.textContent = mode === "normal" ? "Satellite" : "Normal";
            setTileLayer();
        });

        const acBtn = $(ids.autoCenterBtn);
        if (acBtn) acBtn.addEventListener("click", () => {
            autoCenter = !autoCenter;
            acBtn.textContent = autoCenter ? "Auto-Center ON" : "Auto-Center OFF";
        });

        const zoom = $(ids.zoom);
        if (zoom) zoom.addEventListener("input", () => {
            const z = Number(zoom.value);
            if (Number.isFinite(z)) map.setZoom(z, { animate: false });
        });

        const genBtn = $(ids.genBtn);
        if (genBtn) genBtn.addEventListener("click", async () => {
            if (!currentPoint) return;
            const tLat = Number($(ids.targetLat).value);
            const tLon = Number($(ids.targetLon).value);
            if (!Number.isFinite(tLat) || !Number.isFinite(tLon)) return;
            try {
                const res = await fetch("/ai/plan", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ start: { lat: currentPoint.lat, lon: currentPoint.lon }, target: { lat: tLat, lon: tLon }, no_fly: [] })
                });
                const data = await res.json();
                if (!data.ok) return;
                plannedWaypoints = (data.waypoints || []).map(w => ({ lat: Number(w.lat), lon: Number(w.lon) })).filter(w => Number.isFinite(w.lat));
                plannedDistM = Number(data.distance_m) || null;
                targetPoint = { lat: tLat, lon: tLon };
                if (!targetMarker) targetMarker = L.marker([tLat, tLon], { icon: makeTargetIcon() }).addTo(map);
                else targetMarker.setLatLng([tLat, tLon]);
                if (!startPoint) startPoint = { lat: currentPoint.lat, lon: currentPoint.lon };
                redrawLines();
                updateHud(currentPoint, { ok: true });
            } catch (_) {}
        });

        const clearBtn = $(ids.clearBtn);
        if (clearBtn) clearBtn.addEventListener("click", () => {
            plannedWaypoints = [];
            plannedDistM = null;
            targetPoint = null;
            if (targetMarker) { targetMarker.remove(); targetMarker = null; }
            redrawLines();
            updateHud(currentPoint, { ok: !!currentPoint });
        });
    }

    function initEmbeddedNav() {
        if (initialized) {
            if (map) { map.invalidateSize(); }
            return;
        }
        if (typeof L === "undefined") return;
        const container = $(ids.map);
        if (!container) return;
        initialized = true;

        map = L.map(container, { zoomControl: false, center: [DEFAULT_LAT, DEFAULT_LON], zoom: 16 });
        L.control.zoom({ position: "bottomright" }).addTo(map);
        setTileLayer();
        // Ensure Leaflet computes correct size after the container becomes visible
        setTimeout(() => map.invalidateSize(), 100);

        plannedLine = L.polyline([], { color: "#ffd166", weight: 5, dashArray: "8,6" }).addTo(map);
        actualLine = L.polyline([], { color: "#3ee9d6", weight: 5 }).addTo(map);

        map.on("zoomend", () => {
            const z = $(ids.zoom);
            if (z) z.value = map.getZoom().toFixed(1);
        });

        bindEmbedEvents();
        startPolling();

        fetch("/api/navigation/track?limit=300")
            .then(r => r.json())
            .then(data => {
                if (!Array.isArray(data.points)) return;
                const pts = data.points.map(p => ({ lat: Number(p.lat), lon: Number(p.lon), speed_mps: Number(p.speed_mps) || null, heading_deg: Number(p.heading_deg) || null })).filter(p => Number.isFinite(p.lat));
                if (!pts.length) return;
                actualTrack = pts.slice(-MAX_TRACK);
                const last = actualTrack[actualTrack.length - 1];
                currentPoint = last;
                startPoint = startPoint || actualTrack[0];
                ensureDroneMarker(last.lat, last.lon);
                if (startPoint && !startMarker) startMarker = L.marker([startPoint.lat, startPoint.lon], { icon: makeStartIcon() }).addTo(map);
                redrawLines();
                map.setView([last.lat, last.lon], map.getZoom(), { animate: false });
                updateHud(last, { ok: true, fix_type: last.fix_type, sats: last.sats });
            })
            .catch(() => {});
    }

    window.initEmbeddedNav = initEmbeddedNav;
})();
