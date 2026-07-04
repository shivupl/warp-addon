import addOnUISdk from "https://new.express.adobe.com/static/add-on-sdk/sdk.js";

const viewport = document.getElementById("viewport");
const viewPan = document.getElementById("viewPan");
const viewZoom = document.getElementById("viewZoom");
const focusContainer = document.getElementById("focus-container");
const focusUploadPrompt = document.getElementById("focusUploadPrompt");
const focusImg = document.getElementById("focusImg");
const focusUpload = document.getElementById("focusUpload");
const refImg = document.getElementById("refImg");
const opacityCtrl = document.getElementById("opacityCtrl");
const opacityRow = document.querySelector(".opacity-row");
const refToggle = document.getElementById("refToggle");
const gridSnap = document.getElementById("gridSnap");
const gridOverlay = document.getElementById("grid-overlay");
const resetBtn = document.getElementById("resetBtn");
const clearBtn = document.getElementById("clearBtn");
const addToDocumentBtn = document.getElementById("addToDocumentBtn");
const modeTabs = Array.from(document.querySelectorAll(".mode-tab"));
const handles = Array.from({ length: 4 }, (_, index) => document.getElementById(`h${index}`));
const edgeHandles = Array.from(document.querySelectorAll(".edge-handle"));
const centerGrab = document.getElementById("centerGrab");
const coordinateInputs = Array.from(document.querySelectorAll(".coord-input"));

const REF_PLACEHOLDER =
    "data:image/svg+xml;charset=utf-8," +
    encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 900">
  <defs>
    <linearGradient id="wall" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="#f8fafc"/>
      <stop offset="1" stop-color="#cbd5e1"/>
    </linearGradient>
  </defs>
  <rect width="900" height="900" fill="url(#wall)"/>
  <path d="M120 240h660v420H120z" fill="#e2e8f0" stroke="#94a3b8" stroke-width="10"/>
  <path d="M160 280h580v130H160z" fill="#bfdbfe"/>
  <path d="M160 450h270v170H160zM470 450h270v170H470z" fill="#ffffff" stroke="#cbd5e1" stroke-width="6"/>
  <path d="M120 660h660l70 170H50z" fill="#94a3b8"/>
  <path d="M320 660 260 830M580 660l60 170" stroke="#64748b" stroke-width="8"/>
  <text x="450" y="180" text-anchor="middle" font-family="Arial, sans-serif" font-size="42" font-weight="700" fill="#334155">Reference</text>
</svg>`);

const FOCUS_PLACEHOLDER =
    "data:image/svg+xml;charset=utf-8," +
    encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 900">
  <defs>
    <linearGradient id="focus" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="#2563eb"/>
      <stop offset="1" stop-color="#7c3aed"/>
    </linearGradient>
  </defs>
  <rect width="900" height="900" rx="56" fill="url(#focus)"/>
</svg>`);

const EXPORT_SIZE = 1200;
const GRID_DIVISIONS = 12;
const INITIAL_FRAME_SCALE = 0.62;
const INITIAL_VIEW_ZOOM = 1.1;
const MESH_STEPS = 42;
const MAX_TILT_DEGREES = 78;
const TILT_DRAG_SENSITIVITY = 0.7;

let points = [];
let activeHandle = null;
let activeEdge = null;
let isDraggingWhole = false;
let lastContentPos = { x: 0, y: 0 };
let viewTx = 0;
let viewTy = 0;
let viewS = INITIAL_VIEW_ZOOM;
let isViewPan = false;
let lastPanClient = { x: 0, y: 0 };
let addOnReady = false;
let hasFocusUpload = false;
let activeMode = "warp";
let tiltState = null;
let gridFrame = null;

function setStatus(_message) {}

function getViewportSize() {
    const size = viewport.clientWidth || 450;
    return { width: size, height: size };
}

function getInitialPoints() {
    const { width, height } = getViewportSize();
    const size = Math.round(Math.min(width, height) * INITIAL_FRAME_SCALE);
    const left = Math.round((width - size) / 2);
    const top = Math.round((height - size) / 2);
    const right = left + size;
    const bottom = top + size;

    return [
        { x: left, y: top },
        { x: right, y: top },
        { x: right, y: bottom },
        { x: left, y: bottom },
    ];
}

function getInitialTiltState() {
    const initialPoints = getInitialPoints();
    const centerX = (initialPoints[0].x + initialPoints[1].x + initialPoints[2].x + initialPoints[3].x) / 4;
    const centerY = (initialPoints[0].y + initialPoints[1].y + initialPoints[2].y + initialPoints[3].y) / 4;

    return {
        centerX,
        centerY,
        rotateX: 0,
        rotateY: 0,
        baseCorners: initialPoints.map((point) => ({
            x: point.x - centerX,
            y: point.y - centerY,
            z: 0,
        })),
    };
}

function quadCenter() {
    const cx = (points[0].x + points[1].x + points[2].x + points[3].x) / 4;
    const cy = (points[0].y + points[1].y + points[2].y + points[3].y) / 4;
    return { x: cx, y: cy };
}

function edgeAngle(from, to) {
    return (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;
}

function syncGridFrame() {
    const frameWidth = points[1].x - points[0].x;
    const frameHeight = points[3].y - points[0].y;

    if (frameWidth <= 0 || frameHeight <= 0) {
        gridFrame = null;
        return;
    }

    gridFrame = {
        originX: points[0].x,
        originY: points[0].y,
        stepX: frameWidth / GRID_DIVISIONS,
        stepY: frameHeight / GRID_DIVISIONS,
    };
}

function snapPointToGrid(x, y) {
    if (!gridFrame) {
        return { x, y };
    }

    const { originX, originY, stepX, stepY } = gridFrame;

    return {
        x: originX + Math.round((x - originX) / stepX) * stepX,
        y: originY + Math.round((y - originY) / stepY) * stepY,
    };
}

function updateGridOverlay() {
    if (!gridOverlay) {
        return;
    }

    const { width, height } = getViewportSize();
    gridOverlay.setAttribute("viewBox", `0 0 ${width} ${height}`);

    if (!gridSnap.checked || !gridFrame) {
        gridOverlay.innerHTML = "";
        gridOverlay.hidden = true;
        return;
    }

    const { originX, originY, stepX, stepY } = gridFrame;
    const lines = [];
    const startColumn = Math.floor(-originX / stepX) - 1;
    const endColumn = Math.ceil((width - originX) / stepX) + 1;
    const startRow = Math.floor(-originY / stepY) - 1;
    const endRow = Math.ceil((height - originY) / stepY) + 1;

    for (let column = startColumn; column <= endColumn; column += 1) {
        const x = originX + column * stepX;
        lines.push(`<line x1="${x}" y1="0" x2="${x}" y2="${height}" />`);
    }

    for (let row = startRow; row <= endRow; row += 1) {
        const y = originY + row * stepY;
        lines.push(`<line x1="0" y1="${y}" x2="${width}" y2="${y}" />`);
    }

    gridOverlay.innerHTML = lines.join("");
    gridOverlay.hidden = false;
}

function applyViewTransform() {
    viewPan.style.transform = `translate(${viewTx}px, ${viewTy}px)`;
    viewZoom.style.transform = `scale(${viewS})`;
}

function clientToContent(clientX, clientY) {
    const rect = viewport.getBoundingClientRect();
    const mx = clientX - rect.left;
    const my = clientY - rect.top;
    return { x: (mx - viewTx) / viewS, y: (my - viewTy) / viewS };
}

function isPanBackgroundTarget(target) {
    return target === refImg || target === viewPan || target === viewZoom || target === viewport;
}

function getTransform(from, to) {
    const A = [];
    const b = [];

    for (let i = 0; i < 4; i++) {
        A.push([from[i].x, from[i].y, 1, 0, 0, 0, -from[i].x * to[i].x, -from[i].y * to[i].x]);
        A.push([0, 0, 0, from[i].x, from[i].y, 1, -from[i].x * to[i].y, -from[i].y * to[i].y]);
        b.push(to[i].x, to[i].y);
    }

    const h = solveLinearSystem(A, b);
    return {
        css: `matrix3d(${h[0]}, ${h[3]}, 0, ${h[6]}, ${h[1]}, ${h[4]}, 0, ${h[7]}, 0, 0, 1, 0, ${h[2]}, ${h[5]}, 0, 1)`,
        h,
    };
}

function solveLinearSystem(A, b) {
    const n = A.length;
    const matrix = A.map((row, index) => [...row, b[index]]);

    for (let i = 0; i < n; i++) {
        let max = i;
        for (let j = i + 1; j < n; j++) {
            if (Math.abs(matrix[j][i]) > Math.abs(matrix[max][i])) {
                max = j;
            }
        }

        [matrix[i], matrix[max]] = [matrix[max], matrix[i]];

        const pivot = matrix[i][i];
        if (Math.abs(pivot) < 1e-10) {
            throw new Error("The selected corner points are too close to calculate a warp.");
        }

        for (let j = i + 1; j < n; j++) {
            const c = matrix[j][i] / pivot;
            for (let k = i; k <= n; k++) {
                matrix[j][k] -= c * matrix[i][k];
            }
        }
    }

    const x = new Array(n);
    for (let i = n - 1; i >= 0; i--) {
        let sum = 0;
        for (let j = i + 1; j < n; j++) {
            sum += matrix[i][j] * x[j];
        }
        x[i] = (matrix[i][n] - sum) / matrix[i][i];
    }

    return x;
}

function projectPoint(h, x, y) {
    const denominator = h[6] * x + h[7] * y + 1;
    return {
        x: (h[0] * x + h[1] * y + h[2]) / denominator,
        y: (h[3] * x + h[4] * y + h[5]) / denominator,
    };
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function cross2D(a, b, c) {
    return (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
}

/** Perspective warp needs a convex quad; bow-tie corners break the homography. */
function isConvexQuad(pts) {
    let sign = 0;

    for (let i = 0; i < 4; i++) {
        const z = cross2D(pts[i], pts[(i + 1) % 4], pts[(i + 2) % 4]);
        if (Math.abs(z) < 1e-4) {
            continue;
        }

        const s = Math.sign(z);
        if (sign === 0) {
            sign = s;
        } else if (s !== sign) {
            return false;
        }
    }

    return sign !== 0;
}

function tryUpdatePoints(nextPoints) {
    if (activeMode === "tilt" || isConvexQuad(nextPoints)) {
        points = nextPoints;
        return true;
    }

    return false;
}

function createTiltStateFromPoints(sourcePoints) {
    const center = {
        x: (sourcePoints[0].x + sourcePoints[1].x + sourcePoints[2].x + sourcePoints[3].x) / 4,
        y: (sourcePoints[0].y + sourcePoints[1].y + sourcePoints[2].y + sourcePoints[3].y) / 4,
    };

    return {
        centerX: center.x,
        centerY: center.y,
        rotateX: 0,
        rotateY: 0,
        baseCorners: sourcePoints.map((point) => ({
            x: point.x - center.x,
            y: point.y - center.y,
            z: 0,
        })),
    };
}

function getTiltPoints() {
    const { width, height } = getViewportSize();
    const perspective = Math.max(width, height) * 1.8;
    const rotateX = (tiltState.rotateX * Math.PI) / 180;
    const rotateY = (tiltState.rotateY * Math.PI) / 180;
    const cosX = Math.cos(rotateX);
    const sinX = Math.sin(rotateX);
    const cosY = Math.cos(rotateY);
    const sinY = Math.sin(rotateY);

    return tiltState.baseCorners.map((corner) => {
        const x1 = corner.x * cosY + corner.z * sinY;
        const z1 = -corner.x * sinY + corner.z * cosY;
        const y2 = corner.y * cosX - z1 * sinX;
        const z2 = corner.y * sinX + z1 * cosX;
        const depthScale = perspective / (perspective + z2);

        return {
            x: tiltState.centerX + x1 * depthScale,
            y: tiltState.centerY + y2 * depthScale,
        };
    });
}

function updateTiltPoints() {
    points = getTiltPoints();
}

function fitFrameToFocusImageAspectRatio() {
    if (!focusImg.naturalWidth || !focusImg.naturalHeight) {
        return;
    }

    const targetAspect = focusImg.naturalWidth / focusImg.naturalHeight;
    const topWidth = Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y);
    const bottomWidth = Math.hypot(points[2].x - points[3].x, points[2].y - points[3].y);
    const leftHeight = Math.hypot(points[3].x - points[0].x, points[3].y - points[0].y);
    const rightHeight = Math.hypot(points[2].x - points[1].x, points[2].y - points[1].y);
    const currentWidth = (topWidth + bottomWidth) / 2;
    const currentHeight = (leftHeight + rightHeight) / 2;

    if (!currentWidth || !currentHeight) {
        return;
    }

    const currentAspect = currentWidth / currentHeight;
    const scaleRatio = targetAspect / currentAspect;
    const scaleX = Math.sqrt(scaleRatio);
    const scaleY = 1 / scaleX;
    const center = quadCenter();
    const horizontal = {
        x: (points[1].x - points[0].x + points[2].x - points[3].x) / 2,
        y: (points[1].y - points[0].y + points[2].y - points[3].y) / 2,
    };
    const horizontalLength = Math.hypot(horizontal.x, horizontal.y) || 1;
    const xAxis = {
        x: horizontal.x / horizontalLength,
        y: horizontal.y / horizontalLength,
    };
    const averageVertical = {
        x: (points[3].x - points[0].x + points[2].x - points[1].x) / 2,
        y: (points[3].y - points[0].y + points[2].y - points[1].y) / 2,
    };
    let yAxis = { x: -xAxis.y, y: xAxis.x };

    if (yAxis.x * averageVertical.x + yAxis.y * averageVertical.y < 0) {
        yAxis = { x: -yAxis.x, y: -yAxis.y };
    }

    points = points.map((point) => {
        const offset = {
            x: point.x - center.x,
            y: point.y - center.y,
        };
        const localX = offset.x * xAxis.x + offset.y * xAxis.y;
        const localY = offset.x * yAxis.x + offset.y * yAxis.y;

        return {
            x: center.x + xAxis.x * localX * scaleX + yAxis.x * localY * scaleY,
            y: center.y + xAxis.y * localX * scaleX + yAxis.y * localY * scaleY,
        };
    });

    if (activeMode === "tilt") {
        tiltState = createTiltStateFromPoints(points);
    }
}

function updateUI() {
    const { width, height } = getViewportSize();
    document.body.dataset.mode = activeMode;

    points.forEach((p, index) => {
        handles[index].style.left = `${p.x}px`;
        handles[index].style.top = `${p.y}px`;
    });

    const edgePositions = {
        top: {
            x: (points[0].x + points[1].x) / 2,
            y: (points[0].y + points[1].y) / 2,
            angle: edgeAngle(points[0], points[1]),
        },
        right: {
            x: (points[1].x + points[2].x) / 2,
            y: (points[1].y + points[2].y) / 2,
            angle: edgeAngle(points[1], points[2]),
        },
        bottom: {
            x: (points[2].x + points[3].x) / 2,
            y: (points[2].y + points[3].y) / 2,
            angle: edgeAngle(points[2], points[3]),
        },
        left: {
            x: (points[3].x + points[0].x) / 2,
            y: (points[3].y + points[0].y) / 2,
            angle: edgeAngle(points[3], points[0]),
        },
    };

    edgeHandles.forEach((handle) => {
        const position = edgePositions[handle.dataset.edge];
        handle.style.left = `${position.x}px`;
        handle.style.top = `${position.y}px`;
        handle.style.transform = `translate(-50%, -50%) rotate(${position.angle}deg)`;
    });

    coordinateInputs.forEach((input) => {
        const index = Number.parseInt(input.dataset.index, 10);
        const axis = input.dataset.axis;
        const value = Math.round(points[index][axis]);

        if (document.activeElement !== input || input.value === "") {
            input.value = String(value);
        }
    });

    const center = quadCenter();
    centerGrab.style.left = `${center.x}px`;
    centerGrab.style.top = `${center.y}px`;

    try {
        if (activeMode === "tilt" || isConvexQuad(points)) {
            const from = [
                { x: 0, y: 0 },
                { x: width, y: 0 },
                { x: width, y: height },
                { x: 0, y: height },
            ];
            focusContainer.style.transform = getTransform(from, points).css;
        }
    } catch (error) {
        setStatus(error.message);
    }

    const showFocusPlaceholder = !hasFocusUpload;
    focusContainer.classList.toggle("is-upload-target", showFocusPlaceholder);
    if (focusUploadPrompt) {
        focusUploadPrompt.hidden = !showFocusPlaceholder;
    }

    handles.forEach((handle) => {
        handle.style.display = showFocusPlaceholder ? "none" : "";
    });
    edgeHandles.forEach((handle) => {
        handle.style.display = showFocusPlaceholder ? "none" : "";
    });
    centerGrab.style.display = showFocusPlaceholder ? "none" : "";

    const showReference = refToggle.checked;
    focusContainer.style.opacity = showReference ? opacityCtrl.value : 1;
    refImg.style.display = showReference ? "block" : "none";

    if (opacityRow) {
        opacityRow.hidden = !showReference;
        opacityRow.style.display = showReference ? "" : "none";
    }
    updateGridOverlay();

    applyViewTransform();
}

function updateAddToPageButton() {
    addToDocumentBtn.disabled = !addOnReady || !hasFocusUpload;
}

function resetUploadField(inputId) {
    const input = document.getElementById(inputId);
    const uploadButton = document.querySelector(`label[for="${inputId}"].upload-button`);

    if (input) {
        input.value = "";
    }

    uploadButton?.classList.remove("is-uploaded");
    const buttonText = uploadButton?.querySelector(".upload-button-text");
    if (buttonText) {
        buttonText.textContent = "Choose Image";
    }
}

function clearAllImages() {
    hasFocusUpload = false;
    focusImg.src = FOCUS_PLACEHOLDER;
    refImg.src = REF_PLACEHOLDER;
    resetUploadField("focusUpload");
    resetUploadField("refUpload");
    updateAddToPageButton();
    resetTransform({ updateStatus: false });
}

function setupUploader(inputId, targetImg) {
    const input = document.getElementById(inputId);
    const uploadButton = document.querySelector(`label[for="${inputId}"].upload-button`);

    input.addEventListener("change", (event) => {
        const file = event.target.files?.[0];
        if (!file) {
            return;
        }

        const reader = new FileReader();
        reader.addEventListener("load", () => {
            uploadButton?.classList.add("is-uploaded");
            const buttonText = uploadButton?.querySelector(".upload-button-text");
            if (buttonText) {
                buttonText.textContent = "Uploaded";
            }
            targetImg.addEventListener(
                "load",
                () => {
                    if (inputId === "focusUpload") {
                        hasFocusUpload = true;
                        fitFrameToFocusImageAspectRatio();
                        syncGridFrame();
                        updateAddToPageButton();
                    }
                    updateUI();
                    setStatus(inputId === "focusUpload" ? "Focus image loaded. Drag the corners to warp it." : "Reference image loaded.");
                },
                { once: true },
            );
            targetImg.src = reader.result;
        });
        reader.readAsDataURL(file);
    });
}

function updatePointFromInput(input) {
    const index = Number.parseInt(input.dataset.index, 10);
    const axis = input.dataset.axis;
    const value = Number.parseFloat(input.value);

    if (!Number.isFinite(value) || !points[index] || (axis !== "x" && axis !== "y")) {
        return;
    }

    const previous = { ...points[index] };
    const nextPoints = points.map((point, pointIndex) =>
        pointIndex === index ? { ...point, [axis]: value } : point,
    );

    if (!tryUpdatePoints(nextPoints)) {
        points[index] = previous;
    }

    updateUI();
}

function setMode(mode) {
    const previousMode = activeMode;
    activeMode = mode;
    if (mode === "tilt" && previousMode !== "tilt") {
        tiltState = createTiltStateFromPoints(points);
        updateTiltPoints();
    }
    modeTabs.forEach((tab) => {
        const isActive = tab.dataset.mode === mode;
        tab.classList.toggle("is-active", isActive);
        tab.setAttribute("aria-selected", String(isActive));
    });
    updateUI();
}

function handlePointerDown(event) {
    const p = clientToContent(event.clientX, event.clientY);

    if (event.target === centerGrab) {
        isDraggingWhole = true;
        lastContentPos = p;
        centerGrab.setPointerCapture(event.pointerId);
        event.preventDefault();
        return;
    }

    const handleIndex = event.target.dataset?.index;
    if (activeMode === "warp" && handleIndex !== undefined && event.target.classList.contains("handle")) {
        activeHandle = Number.parseInt(handleIndex, 10);
        event.target.setPointerCapture(event.pointerId);
        event.preventDefault();
        return;
    }

    const edge = event.target.dataset?.edge;
    if ((activeMode === "tilt" || activeMode === "sides") && edge && event.target.classList.contains("edge-handle")) {
        activeEdge = edge;
        lastContentPos = p;
        event.target.setPointerCapture(event.pointerId);
        event.preventDefault();
        return;
    }

    if (isPanBackgroundTarget(event.target)) {
        isViewPan = true;
        lastPanClient = { x: event.clientX, y: event.clientY };
        viewport.setPointerCapture(event.pointerId);
        event.preventDefault();
    }
}

function handlePointerMove(event) {
    if (isViewPan) {
        viewTx += event.clientX - lastPanClient.x;
        viewTy += event.clientY - lastPanClient.y;
        lastPanClient = { x: event.clientX, y: event.clientY };
        applyViewTransform();
        return;
    }

    if (activeHandle === null && activeEdge === null && !isDraggingWhole) {
        return;
    }

    const p = clientToContent(event.clientX, event.clientY);

    if (activeHandle !== null) {
        const snapped = gridSnap.checked ? snapPointToGrid(p.x, p.y) : p;
        const nextPoints = points.map((point, index) =>
            index === activeHandle ? snapped : point,
        );

        if (!tryUpdatePoints(nextPoints)) {
            return;
        }
    } else if (activeEdge !== null) {
        const dx = p.x - lastContentPos.x;
        const dy = p.y - lastContentPos.y;
        if (activeMode === "tilt") {
            tiltState = {
                ...tiltState,
                rotateX: clamp(tiltState.rotateX - dy * TILT_DRAG_SENSITIVITY, -MAX_TILT_DEGREES, MAX_TILT_DEGREES),
                rotateY: clamp(tiltState.rotateY + dx * TILT_DRAG_SENSITIVITY, -MAX_TILT_DEGREES, MAX_TILT_DEGREES),
            };
            updateTiltPoints();
        } else {
            const edgePointIndexes = {
                top: [0, 1],
                right: [1, 2],
                bottom: [2, 3],
                left: [3, 0],
            };

            const nextPoints = points.map((point, index) =>
                edgePointIndexes[activeEdge].includes(index) ? { x: point.x + dx, y: point.y + dy } : point,
            );

            if (!tryUpdatePoints(nextPoints)) {
                return;
            }
        }
        lastContentPos = p;
    } else {
        const dx = p.x - lastContentPos.x;
        const dy = p.y - lastContentPos.y;
        if (activeMode === "tilt") {
            tiltState = {
                ...tiltState,
                centerX: tiltState.centerX + dx,
                centerY: tiltState.centerY + dy,
            };
            updateTiltPoints();
        } else {
            points = points.map((point) => ({ x: point.x + dx, y: point.y + dy }));
        }
        lastContentPos = p;
    }

    updateUI();
}

function stopDragging() {
    activeHandle = null;
    activeEdge = null;
    isDraggingWhole = false;
    isViewPan = false;
}

function imageLoaded(image) {
    if (image.complete && image.naturalWidth > 0) {
        return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
        image.addEventListener("load", resolve, { once: true });
        image.addEventListener("error", reject, { once: true });
    });
}

function drawTriangle(ctx, image, src, dst) {
    const [s0, s1, s2] = src;
    const [d0, d1, d2] = dst;
    const denom = s0.x * (s1.y - s2.y) + s1.x * (s2.y - s0.y) + s2.x * (s0.y - s1.y);

    if (Math.abs(denom) < 1e-6) {
        return;
    }

    const a = (d0.x * (s1.y - s2.y) + d1.x * (s2.y - s0.y) + d2.x * (s0.y - s1.y)) / denom;
    const b = (d0.y * (s1.y - s2.y) + d1.y * (s2.y - s0.y) + d2.y * (s0.y - s1.y)) / denom;
    const c = (d0.x * (s2.x - s1.x) + d1.x * (s0.x - s2.x) + d2.x * (s1.x - s0.x)) / denom;
    const d = (d0.y * (s2.x - s1.x) + d1.y * (s0.x - s2.x) + d2.y * (s1.x - s0.x)) / denom;
    const e = (d0.x * (s1.x * s2.y - s2.x * s1.y) + d1.x * (s2.x * s0.y - s0.x * s2.y) + d2.x * (s0.x * s1.y - s1.x * s0.y)) / denom;
    const f = (d0.y * (s1.x * s2.y - s2.x * s1.y) + d1.y * (s2.x * s0.y - s0.x * s2.y) + d2.y * (s0.x * s1.y - s1.x * s0.y)) / denom;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(d0.x, d0.y);
    ctx.lineTo(d1.x, d1.y);
    ctx.lineTo(d2.x, d2.y);
    ctx.closePath();
    ctx.clip();
    ctx.transform(a, b, c, d, e, f);
    ctx.drawImage(image, 0, 0);
    ctx.restore();
}

async function createWarpedBlob({ opacity = Number(opacityCtrl.value) } = {}) {
    await imageLoaded(focusImg);

    if (!isConvexQuad(points)) {
        throw new Error("Corner arrangement is invalid. Adjust corners so they do not cross.");
    }

    const { width, height } = getViewportSize();
    const scale = EXPORT_SIZE / Math.max(width, height);
    const from = [
        { x: 0, y: 0 },
        { x: width, y: 0 },
        { x: width, y: height },
        { x: 0, y: height },
    ];
    const { h } = getTransform(from, points);
    const imageWidth = focusImg.naturalWidth;
    const imageHeight = focusImg.naturalHeight;
    const canvas = document.createElement("canvas");
    canvas.width = EXPORT_SIZE;
    canvas.height = EXPORT_SIZE;

    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.globalAlpha = opacity;

    for (let row = 0; row < MESH_STEPS; row++) {
        for (let col = 0; col < MESH_STEPS; col++) {
            const x0 = (col / MESH_STEPS) * width;
            const y0 = (row / MESH_STEPS) * height;
            const x1 = ((col + 1) / MESH_STEPS) * width;
            const y1 = ((row + 1) / MESH_STEPS) * height;
            const src = [
                { x: (x0 / width) * imageWidth, y: (y0 / height) * imageHeight },
                { x: (x1 / width) * imageWidth, y: (y0 / height) * imageHeight },
                { x: (x1 / width) * imageWidth, y: (y1 / height) * imageHeight },
                { x: (x0 / width) * imageWidth, y: (y1 / height) * imageHeight },
            ];
            const dst = [
                projectPoint(h, x0, y0),
                projectPoint(h, x1, y0),
                projectPoint(h, x1, y1),
                projectPoint(h, x0, y1),
            ].map((point) => ({ x: point.x * scale, y: point.y * scale }));

            drawTriangle(ctx, focusImg, [src[0], src[1], src[2]], [dst[0], dst[1], dst[2]]);
            drawTriangle(ctx, focusImg, [src[0], src[2], src[3]], [dst[0], dst[2], dst[3]]);
        }
    }

    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (blob) {
                resolve(blob);
            } else {
                reject(new Error("Could not render the warped image."));
            }
        }, "image/png");
    });
}

function createOutputBlob(options) {
    return createWarpedBlob(options);
}

async function addWarpedImageToDocument() {
    if (!addOnReady || !hasFocusUpload) {
        return;
    }

    try {
        addToDocumentBtn.disabled = true;
        setStatus("Rendering and adding image to your Express page...");
        const blob = await createOutputBlob({ opacity: 1 });
        await addOnUISdk.app.document.addImage(blob, { title: activeMode === "tilt" ? "Free tilt" : "Perspective warp" });
        setStatus("PNG added to the current page.");
    } catch (error) {
        setStatus(error.message || "Could not add the warped image to the page.");
    } finally {
        updateAddToPageButton();
    }
}

function resetViewTransform() {
    const { width, height } = getViewportSize();
    viewS = INITIAL_VIEW_ZOOM;
    viewTx = (width * (1 - viewS)) / 2;
    viewTy = (height * (1 - viewS)) / 2;
}

function resetTransform({ updateStatus = true } = {}) {
    points = getInitialPoints();
    fitFrameToFocusImageAspectRatio();
    syncGridFrame();
    tiltState = getInitialTiltState();
    if (activeMode === "tilt") {
        tiltState = createTiltStateFromPoints(points);
        updateTiltPoints();
    }
    resetViewTransform();
    updateUI();
    if (updateStatus) {
        setStatus(addOnReady ? "Transformation reset." : "Waiting for Adobe Express...");
    }
}

function handleWheel(event) {
    event.preventDefault();
    const rect = viewport.getBoundingClientRect();
    const mx = event.clientX - rect.left;
    const my = event.clientY - rect.top;
    const cx = (mx - viewTx) / viewS;
    const cy = (my - viewTy) / viewS;
    const factor = event.deltaY > 0 ? 0.92 : 1.08;
    const newS = Math.min(6, Math.max(0.25, viewS * factor));

    viewTx = mx - cx * newS;
    viewTy = my - cy * newS;
    viewS = newS;
    applyViewTransform();
}

function initializePlanner() {
    refImg.src = REF_PLACEHOLDER;
    focusImg.src = FOCUS_PLACEHOLDER;
    refImg.addEventListener("dragstart", (event) => event.preventDefault());
    focusImg.addEventListener("dragstart", (event) => event.preventDefault());

    points = getInitialPoints();
    tiltState = getInitialTiltState();
    setupUploader("refUpload", refImg);
    setupUploader("focusUpload", focusImg);

    focusUploadPrompt?.addEventListener("click", (event) => {
        event.stopPropagation();
        focusUpload?.click();
    });

    viewport.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopDragging);
    window.addEventListener("pointercancel", stopDragging);
    viewport.addEventListener("wheel", handleWheel, { passive: false });
    opacityCtrl.addEventListener("input", updateUI);
    gridSnap.addEventListener("change", updateUI);
    refToggle.addEventListener("change", updateUI);
    resetBtn.addEventListener("click", resetTransform);
    clearBtn.addEventListener("click", clearAllImages);
    addToDocumentBtn.addEventListener("click", addWarpedImageToDocument);
    modeTabs.forEach((tab) => {
        tab.addEventListener("click", () => setMode(tab.dataset.mode));
    });
    coordinateInputs.forEach((input) => {
        input.addEventListener("input", () => updatePointFromInput(input));
        input.addEventListener("change", updateUI);
    });
    window.addEventListener("resize", updateUI);

    resetViewTransform();
    updateUI();
    requestAnimationFrame(() => {
        requestAnimationFrame(() => resetTransform({ updateStatus: false }));
    });
}

initializePlanner();

addOnUISdk.ready.then(() => {
    console.log("addOnUISdk is ready for use.");
    addOnReady = true;
    updateAddToPageButton();
    setStatus("");
});
