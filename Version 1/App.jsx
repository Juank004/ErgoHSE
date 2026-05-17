import { useState, useEffect, useRef, useCallback } from "react";

// ─── THEME ────────────────────────────────────────────────────────────────────
const T = {
  bg: "#04040A", surface: "rgba(255,255,255,0.04)", border: "rgba(255,255,255,0.08)",
  textPrimary: "#F0F4FF", textSecondary: "rgba(240,244,255,0.5)", textMuted: "rgba(240,244,255,0.25)",
  green: "#00E5A0", amber: "#FFB830", red: "#FF4B6E", blue: "#4B9EFF", accent: "#7B61FF", pink: "#FF6BBA",
};

const PERSON_PALETTE = [
  { stroke: "#00E5A0", glow: "rgba(0,229,160,0.6)", label: "P1", bg: "rgba(0,229,160,0.08)" },
  { stroke: "#4B9EFF", glow: "rgba(75,158,255,0.6)", label: "P2", bg: "rgba(75,158,255,0.08)" },
  { stroke: "#FF6BBA", glow: "rgba(255,107,186,0.6)", label: "P3", bg: "rgba(255,107,186,0.08)" },
  { stroke: "#FFB830", glow: "rgba(255,184,48,0.6)", label: "P4", bg: "rgba(255,184,48,0.08)" },
  { stroke: "#A78BFA", glow: "rgba(167,139,250,0.6)", label: "P5", bg: "rgba(167,139,250,0.08)" },
  { stroke: "#FB923C", glow: "rgba(251,146,60,0.6)", label: "P6", bg: "rgba(251,146,60,0.08)" },
];

// ─── MOVENET KEYPOINT INDICES ─────────────────────────────────────────────────
const KP = {
  nose: 0, lEye: 1, rEye: 2, lEar: 3, rEar: 4, lShoulder: 5, rShoulder: 6,
  lElbow: 7, rElbow: 8, lWrist: 9, rWrist: 10, lHip: 11, rHip: 12, lKnee: 13, rKnee: 14, lAnkle: 15, rAnkle: 16
};

const BODY_CONNECTIONS = [
  // face
  [KP.nose, KP.lEye], [KP.nose, KP.rEye], [KP.lEye, KP.lEar], [KP.rEye, KP.rEar],
  // torso
  [KP.lShoulder, KP.rShoulder], [KP.lShoulder, KP.lHip], [KP.rShoulder, KP.rHip], [KP.lHip, KP.rHip],
  // arms
  [KP.lShoulder, KP.lElbow], [KP.lElbow, KP.lWrist],
  [KP.rShoulder, KP.rElbow], [KP.rElbow, KP.rWrist],
  // legs
  [KP.lHip, KP.lKnee], [KP.lKnee, KP.lAnkle],
  [KP.rHip, KP.rKnee], [KP.rKnee, KP.rAnkle],
];

// Hand landmark connections (21 points each hand from MediaPipe Hands)
const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],       // thumb
  [0, 5], [5, 6], [6, 7], [7, 8],       // index
  [0, 9], [9, 10], [10, 11], [11, 12],  // middle
  [0, 13], [13, 14], [14, 15], [15, 16],// ring
  [0, 17], [17, 18], [18, 19], [19, 20],// pinky
  [5, 9], [9, 13], [13, 17],          // palm base
];

// Face mesh simplified connections (from MediaPipe Face Mesh key points)
const FACE_OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109, 10];

// ─── ANGLE ENGINE ─────────────────────────────────────────────────────────────
const angleEngine = {
  angleBetween(v1, v2) {
    const d = v1.x * v2.x + v1.y * v2.y, m = Math.sqrt(v1.x ** 2 + v1.y ** 2) * Math.sqrt(v2.x ** 2 + v2.y ** 2);
    return m ? Math.acos(Math.max(-1, Math.min(1, d / m))) * 180 / Math.PI : 0;
  },
  neckAngle(nose, lS, rS) {
    if (!nose || !lS || !rS) return null;
    const mid = { x: (lS.x + rS.x) / 2, y: (lS.y + rS.y) / 2 };
    return this.angleBetween({ x: nose.x - mid.x, y: nose.y - mid.y }, { x: 0, y: -1 });
  },
  spineAngle(lS, rS, lH, rH) {
    if (!lS || !rS || !lH || !rH) return null;
    const mS = { x: (lS.x + rS.x) / 2, y: (lS.y + rS.y) / 2 }, mH = { x: (lH.x + rH.x) / 2, y: (lH.y + rH.y) / 2 };
    return this.angleBetween({ x: mS.x - mH.x, y: mS.y - mH.y }, { x: 0, y: -1 });
  },
  shoulderDelta(lS, rS) {
    if (!lS || !rS) return null;
    const spanX = Math.abs(lS.x - rS.x);
    return spanX ? (Math.abs(lS.y - rS.y) / spanX) * 100 : 0;
  },
};

function analyzeKPs(kps) {
  const get = (i) => kps[i]?.score > 0.25 ? kps[i] : null;
  const nose = get(KP.nose), lS = get(KP.lShoulder), rS = get(KP.rShoulder), lH = get(KP.lHip), rH = get(KP.rHip);
  const neck = angleEngine.neckAngle(nose, lS, rS);
  const spine = angleEngine.spineAngle(lS, rS, lH, rH);
  const sym = angleEngine.shoulderDelta(lS, rS);
  const nS = neck === null ? 25 : neck < 10 ? 30 : neck < 18 ? 24 : neck < 28 ? 15 : 5;
  const spS = spine === null ? 25 : spine < 8 ? 30 : spine < 15 ? 24 : spine < 25 ? 15 : 5;
  const smS = sym === null ? 12 : sym < 4 ? 15 : sym < 8 ? 11 : sym < 14 ? 6 : 2;
  const total = nS + spS + smS + 8 + 12;
  let level, label, color, glow;
  if (total >= 92) { level = "excellent"; label = "Excellent"; color = T.green; glow = "rgba(0,229,160,0.4)"; }
  else if (total >= 75) { level = "good"; label = "Good"; color = T.green; glow = "rgba(0,229,160,0.3)"; }
  else if (total >= 55) { level = "moderate"; label = "Moderate"; color = T.amber; glow = "rgba(255,184,48,0.4)"; }
  else { level = "high"; label = "High Risk"; color = T.red; glow = "rgba(255,75,110,0.4)"; }
  const issues = [];
  if (neck !== null && neck >= 18) issues.push({ key: "neck", label: "Forward neck", angle: neck, sev: neck >= 28 ? "high" : "moderate" });
  if (spine !== null && spine >= 15) issues.push({ key: "spine", label: "Curved back", angle: spine, sev: spine >= 25 ? "high" : "moderate" });
  if (sym !== null && sym >= 4) issues.push({ key: "sym", label: `Shoulder tilt ${sym.toFixed(1)}%`, sev: sym >= 8 ? "high" : "moderate" });
  return { score: Math.round(total), level, label, color, glow, neck, spine, sym, issues };
}

// ─── CANVAS DRAWING ───────────────────────────────────────────────────────────
function drawRoundRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r); ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h); ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r); ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
}

// ─── MULTI OVERLAY CANVAS ─────────────────────────────────────────────────────
// KEY FIX: canvas is sized to the DISPLAY size of the video element, not the source resolution
function OverlayCanvas({ persons, handResults, faceResults, canvasW, canvasH, showTrails, showHands, showFace }) {
  const canvasRef = useRef(null);
  const trailsRef = useRef([]);
  const particlesRef = useRef([]);
  const frameRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvasW, canvasH);

    const now = Date.now();
    frameRef.current++;

    // ── BODY SKELETONS ──
    if (persons && persons.length) {
      persons.forEach((person, idx) => {
        const pal = PERSON_PALETTE[idx % PERSON_PALETTE.length];
        const risk = person.risk;
        let stroke = pal.stroke, glow = pal.glow;
        if (risk?.level === "high") { stroke = T.red; glow = "rgba(255,75,110,0.7)"; }
        else if (risk?.level === "moderate") { stroke = T.amber; glow = "rgba(255,184,48,0.6)"; }

        const kps = person.keypoints;
        // kps are already in display pixel coords (scaled externally)
        const toP = (kp) => ({ x: kp.x, y: kp.y });

        // Trail for nose
        if (showTrails && kps[KP.nose]?.score > 0.3) {
          if (!trailsRef.current[idx]) trailsRef.current[idx] = [];
          trailsRef.current[idx].push({ x: kps[KP.nose].x, y: kps[KP.nose].y, t: now });
          trailsRef.current[idx] = trailsRef.current[idx].filter(p => now - p.t < 900);
          const trail = trailsRef.current[idx];
          for (let i = 1; i < trail.length; i++) {
            const alpha = (i / trail.length) * 0.5;
            ctx.beginPath();
            ctx.moveTo(trail[i - 1].x, trail[i - 1].y);
            ctx.lineTo(trail[i].x, trail[i].y);
            ctx.strokeStyle = stroke + Math.round(alpha * 255).toString(16).padStart(2, "0");
            ctx.lineWidth = 3;
            ctx.shadowColor = glow; ctx.shadowBlur = 10;
            ctx.stroke();
          }
        }

        // Body connections with glow
        ctx.shadowColor = glow; ctx.shadowBlur = 22;
        ctx.strokeStyle = stroke; ctx.lineWidth = 2.8; ctx.lineCap = "round";
        BODY_CONNECTIONS.forEach(([i, j]) => {
          const a = kps[i], b = kps[j];
          if (!a || !b || a.score < 0.25 || b.score < 0.25) return;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        });

        // Joints
        kps.forEach((kp, ki) => {
          if (!kp || kp.score < 0.25) return;
          const isKey = [KP.lShoulder, KP.rShoulder, KP.lHip, KP.rHip].includes(ki);
          const r = ki === KP.nose ? 8 : isKey ? 6 : 4;
          ctx.shadowColor = glow; ctx.shadowBlur = 30;
          ctx.beginPath(); ctx.arc(kp.x, kp.y, r, 0, Math.PI * 2);
          ctx.fillStyle = stroke; ctx.fill();
          // inner bright core
          ctx.beginPath(); ctx.arc(kp.x, kp.y, r * 0.5, 0, Math.PI * 2);
          ctx.fillStyle = "#ffffff88"; ctx.fill();
        });

        // Floating badge with score
        const lS = kps[KP.lShoulder], rS = kps[KP.rShoulder];
        if (lS?.score > 0.25 && rS?.score > 0.25) {
          const cx = (lS.x + rS.x) / 2, cy = Math.min(lS.y, rS.y) - 32;
          ctx.shadowBlur = 0;
          // badge background
          ctx.fillStyle = stroke + "28";
          drawRoundRect(ctx, cx - 30, cy - 14, 60, 26, 13);
          ctx.fill();
          ctx.strokeStyle = stroke + "99"; ctx.lineWidth = 1.2;
          drawRoundRect(ctx, cx - 30, cy - 14, 60, 26, 13);
          ctx.stroke();
          // text
          ctx.fillStyle = stroke; ctx.font = "bold 12px 'DM Mono',monospace";
          ctx.textAlign = "center"; ctx.textBaseline = "middle";
          ctx.fillText(`${pal.label} ${risk?.score ?? "-"}`, cx, cy);
        }

        // Pulse ring on nose (breathing effect)
        if (kps[KP.nose]?.score > 0.3) {
          const pulsePct = (Math.sin(now / 600 + idx) * 0.5 + 0.5);
          const pulseR = 14 + pulsePct * 8;
          ctx.beginPath(); ctx.arc(kps[KP.nose].x, kps[KP.nose].y, pulseR, 0, Math.PI * 2);
          ctx.strokeStyle = stroke + (Math.round(pulsePct * 80 + 20)).toString(16).padStart(2, "0");
          ctx.lineWidth = 1.5; ctx.shadowColor = glow; ctx.shadowBlur = 15; ctx.stroke();
        }

        ctx.shadowBlur = 0;
      });
    }

    // ── HAND LANDMARKS ──
    if (showHands && handResults?.multiHandLandmarks) {
      handResults.multiHandLandmarks.forEach((hand, hi) => {
        const isRight = handResults.multiHandedness?.[hi]?.label === "Right";
        const handColor = isRight ? "#00E5A0" : "#FF6BBA";
        const handGlow = isRight ? "rgba(0,229,160,0.6)" : "rgba(255,107,186,0.6)";

        ctx.shadowColor = handGlow; ctx.shadowBlur = 18;
        ctx.strokeStyle = handColor; ctx.lineWidth = 2.2; ctx.lineCap = "round";
        HAND_CONNECTIONS.forEach(([i, j]) => {
          const a = hand[i], b = hand[j];
          if (!a || !b) return;
          ctx.beginPath();
          ctx.moveTo(a.x * canvasW, a.y * canvasH);
          ctx.lineTo(b.x * canvasW, b.y * canvasH);
          ctx.stroke();
        });

        hand.forEach((lm, li) => {
          const isTip = [4, 8, 12, 16, 20].includes(li);
          const px = lm.x * canvasW, py = lm.y * canvasH;
          ctx.beginPath(); ctx.arc(px, py, isTip ? 5 : 3, 0, Math.PI * 2);
          ctx.fillStyle = isTip ? "#FF4B6E" : handColor;
          ctx.shadowColor = isTip ? "rgba(255,75,110,0.8)" : handGlow;
          ctx.shadowBlur = 20; ctx.fill();
          ctx.beginPath(); ctx.arc(px, py, isTip ? 2.5 : 1.5, 0, Math.PI * 2);
          ctx.fillStyle = "#ffffffcc"; ctx.fill();
        });
        ctx.shadowBlur = 0;
      });
    }

    // ── FACE MESH ──
    if (showFace && faceResults?.multiFaceLandmarks) {
      faceResults.multiFaceLandmarks.forEach((face) => {
        // Face oval outline
        ctx.shadowColor = "rgba(255,107,186,0.5)"; ctx.shadowBlur = 14;
        ctx.strokeStyle = "#FF6BBA88"; ctx.lineWidth = 1.5;
        ctx.beginPath();
        FACE_OVAL.forEach((idx, i) => {
          const lm = face[idx];
          if (!lm) return;
          const px = lm.x * canvasW, py = lm.y * canvasH;
          i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
        });
        ctx.closePath(); ctx.stroke();

        // Key facial points (eyes, nose, lips area — sparse)
        const keyPoints = [1, 4, 5, 195, 197, 6, 168, 8, 9, 10, 152, 234, 454, 33, 263, 133, 362, 61, 291, 13, 14, 78, 308];
        keyPoints.forEach(idx => {
          const lm = face[idx];
          if (!lm) return;
          ctx.beginPath(); ctx.arc(lm.x * canvasW, lm.y * canvasH, 1.8, 0, Math.PI * 2);
          ctx.fillStyle = "#FF6BBA"; ctx.shadowColor = "rgba(255,107,186,0.8)"; ctx.shadowBlur = 8; ctx.fill();
        });
        ctx.shadowBlur = 0;
      });
    }

  }); // runs every render — canvas stays in sync

  return (
    <canvas
      ref={canvasRef}
      width={canvasW}
      height={canvasH}
      style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", pointerEvents: "none" }}
    />
  );
}

// ─── LOAD SCRIPT HELPER ───────────────────────────────────────────────────────
function loadScript(src) {
  return new Promise((res, rej) => {
    if (document.querySelector(`script[src="${src}"]`)) { res(); return; }
    const s = document.createElement("script");
    s.src = src; s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
}

// ─── MOVENET + MEDIAPIPE HANDS/FACE HOOK ──────────────────────────────────────
function useVisionAI({ videoRef, active, enableHands, enableFace }) {
  const [persons, setPersons] = useState([]);
  const [handResults, setHandResults] = useState(null);
  const [faceResults, setFaceResults] = useState(null);
  const [status, setStatus] = useState("idle");
  const detectorRef = useRef(null);
  const handsRef = useRef(null);
  const faceRef = useRef(null);
  const rafRef = useRef(null);
  const videoRectRef = useRef({ w: 640, h: 480 });

  useEffect(() => {
    if (!active) return;
    let cancelled = false;

    const load = async () => {
      setStatus("loading");
      try {
        // TF.js
        if (!window.tf) {
          await loadScript("https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.17.0/dist/tf.min.js");
        }
        // MoveNet
        if (!window.poseDetection) {
          await loadScript("https://cdn.jsdelivr.net/npm/@tensorflow-models/pose-detection@2.1.3/dist/pose-detection.min.js");
        }
        await window.tf.ready();
        const detector = await window.poseDetection.createDetector(
          window.poseDetection.SupportedModels.MoveNet,
          { modelType: window.poseDetection.movenet.modelType.MULTIPOSE_LIGHTNING, enableSmoothing: true, minPoseScore: 0.2 }
        );
        if (!cancelled) detectorRef.current = detector;

        // MediaPipe Hands
        if (enableHands) {
          await loadScript("https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4/hands.js");
          if (window.Hands) {
            const hands = new window.Hands({ locateFile: (f) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4/${f}` });
            hands.setOptions({ maxNumHands: 2, modelComplexity: 1, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
            hands.onResults((r) => { if (!cancelled) setHandResults(r); });
            if (!cancelled) handsRef.current = hands;
          }
        }

        // MediaPipe Face Mesh
        if (enableFace) {
          await loadScript("https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4/face_mesh.js");
          if (window.FaceMesh) {
            const face = new window.FaceMesh({ locateFile: (f) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4/${f}` });
            face.setOptions({ maxNumFaces: 4, refineLandmarks: false, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
            face.onResults((r) => { if (!cancelled) setFaceResults(r); });
            if (!cancelled) faceRef.current = face;
          }
        }

        if (!cancelled) setStatus("ready");
      } catch (e) {
        console.error(e);
        if (!cancelled) setStatus("error");
      }
    };
    load();
    return () => { cancelled = true; if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [active, enableHands, enableFace]);

  // Detection loop
  useEffect(() => {
    if (status !== "ready" || !detectorRef.current || !videoRef.current) return;
    let running = true;

    const detect = async () => {
      if (!running) return;
      const vid = videoRef.current;
      if (vid?.readyState >= 2) {
        // Get actual display rect of the video element
        const rect = vid.getBoundingClientRect();
        videoRectRef.current = { w: rect.width || vid.videoWidth || 640, h: rect.height || vid.videoHeight || 480 };
        const dW = videoRectRef.current.w, dH = videoRectRef.current.h;
        const srcW = vid.videoWidth || 640, srcH = vid.videoHeight || 480;

        try {
          const poses = await detectorRef.current.estimatePoses(vid, { maxPoses: 6, flipHorizontal: false });
          // Scale keypoints from source video resolution to display size
          const enriched = poses.map(p => ({
            ...p,
            keypoints: p.keypoints.map(kp => ({
              ...kp,
              x: (kp.x / srcW) * dW,
              y: (kp.y / srcH) * dH,
            })),
            risk: analyzeKPs(p.keypoints.map(kp => ({ ...kp, x: kp.x / srcW, y: kp.y / srcH }))),
          }));
          if (running) setPersons(enriched);
        } catch { }

        if (enableHands && handsRef.current) {
          try { await handsRef.current.send({ image: vid }); } catch { }
        }
        if (enableFace && faceRef.current) {
          try { await faceRef.current.send({ image: vid }); } catch { }
        }
      }
      if (running) rafRef.current = requestAnimationFrame(detect);
    };
    rafRef.current = requestAnimationFrame(detect);
    return () => { running = false; if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [status, videoRef, enableHands, enableFace]);

  return { persons, handResults, faceResults, status, displaySize: videoRectRef.current };
}

// ─── DEMO SIMULATION ──────────────────────────────────────────────────────────
function simPersons(t, count, dW, dH) {
  return Array.from({ length: count }, (_, i) => {
    const ox = (0.18 + i * (0.64 / Math.max(count - 1, 1))) * dW;
    const wave = Math.sin(t * 0.2 + i * 1.2) * 0.015 * dH;
    const nF = Math.sin(t * 0.1 + i) * 0.04 * dW;
    const kps = [
      { x: ox + nF, y: 0.20 * dH + wave, score: 0.95 }, { x: ox - 0.012 * dW, y: 0.185 * dH + wave, score: 0.9 },
      { x: ox + 0.012 * dW, y: 0.185 * dH + wave, score: 0.9 }, { x: ox - 0.025 * dW, y: 0.195 * dH + wave, score: 0.9 },
      { x: ox + 0.025 * dW, y: 0.195 * dH + wave, score: 0.9 },
      { x: ox - 0.07 * dW, y: 0.36 * dH + wave * 0.5, score: 0.95 }, { x: ox + 0.07 * dW, y: 0.38 * dH + wave * 0.3, score: 0.95 },
      { x: ox - 0.10 * dW, y: 0.52 * dH, score: 0.9 }, { x: ox + 0.10 * dW, y: 0.54 * dH, score: 0.9 },
      { x: ox - 0.11 * dW, y: 0.67 * dH, score: 0.85 }, { x: ox + 0.11 * dW, y: 0.69 * dH, score: 0.85 },
      { x: ox - 0.05 * dW, y: 0.64 * dH, score: 0.95 }, { x: ox + 0.05 * dW, y: 0.65 * dH, score: 0.95 },
      { x: ox - 0.05 * dW, y: 0.80 * dH, score: 0.8 }, { x: ox + 0.05 * dW, y: 0.81 * dH, score: 0.8 },
      { x: ox - 0.05 * dW, y: 0.94 * dH, score: 0.7 }, { x: ox + 0.05 * dW, y: 0.95 * dH, score: 0.7 },
    ];
    return { keypoints: kps, risk: analyzeKPs(kps.map(k => ({ ...k, x: k.x / dW, y: k.y / dH }))), id: i };
  });
}

// ─── MINI SCORE RING ──────────────────────────────────────────────────────────
function MiniRing({ score, color, size = 48 }) {
  const r = size / 2 - 4, c = size / 2, circ = 2 * Math.PI * r, dash = (Math.max(0, score ?? 0) / 100) * circ;
  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)", flexShrink: 0 }}>
      <circle cx={c} cy={c} r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={3.5} />
      <circle cx={c} cy={c} r={r} fill="none" stroke={color} strokeWidth={3.5}
        strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
        style={{ filter: `drop-shadow(0 0 7px ${color})`, transition: "all 0.5s ease" }} />
      <text x={c} y={c} fill={color} fontSize={11} fontWeight="700"
        textAnchor="middle" dominantBaseline="middle"
        transform={`rotate(90 ${c} ${c})`} fontFamily="monospace">{score ?? "-"}</text>
    </svg>
  );
}

// ─── OVERALL GAUGE ────────────────────────────────────────────────────────────
function OverallGauge({ persons }) {
  if (!persons.length) return null;
  const avg = Math.round(persons.reduce((s, p) => s + (p.risk?.score || 0), 0) / persons.length);
  let color = T.green, label = "Excellent";
  if (avg < 55) { color = T.red; label = "High Risk"; } else if (avg < 75) { color = T.amber; label = "Moderate"; } else if (avg < 92) { color = T.green; label = "Good"; }
  const r = 38, circ = 2 * Math.PI * r, dash = (avg / 100) * circ;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
      <svg width={100} height={100} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={50} cy={50} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={7} />
        <circle cx={50} cy={50} r={r} fill="none" stroke={color} strokeWidth={7}
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
          style={{ filter: `drop-shadow(0 0 12px ${color})`, transition: "all 0.7s cubic-bezier(.34,1.56,.64,1)" }} />
        <text x={50} y={46} fill={color} fontSize={24} fontWeight="700"
          textAnchor="middle" dominantBaseline="middle"
          transform="rotate(90 50 50)" fontFamily="monospace">{avg}</text>
        <text x={50} y={62} fill={color + "88"} fontSize={8}
          textAnchor="middle" dominantBaseline="middle"
          transform="rotate(90 50 50)" fontFamily="monospace">AVG</text>
      </svg>
      <span style={{ fontSize: 12, color, fontWeight: 700 }}>{label}</span>
      <span style={{ fontSize: 9, color: T.textMuted }}>{persons.length} person{persons.length !== 1 ? "s" : ""} tracked</span>
    </div>
  );
}

// ─── PERSON CARD ──────────────────────────────────────────────────────────────
function PersonCard({ person, idx }) {
  const pal = PERSON_PALETTE[idx % PERSON_PALETTE.length];
  const r = person.risk;
  if (!r) return null;
  let activeColor = pal.stroke;
  if (r.level === "high") activeColor = T.red;
  else if (r.level === "moderate") activeColor = T.amber;
  return (
    <div style={{ background: pal.bg, border: `1px solid ${activeColor}44`, borderLeft: `3px solid ${activeColor}`, borderRadius: 12, padding: "12px 14px", boxShadow: `0 0 20px ${pal.glow}18`, transition: "all 0.4s ease" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: r.issues.length ? 10 : 0 }}>
        <MiniRing score={r.score} color={activeColor} />
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: activeColor }}>{pal.label}</span>
            <span style={{ fontSize: 10, color: activeColor, background: `${activeColor}18`, padding: "2px 8px", borderRadius: 10 }}>{r.label}</span>
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
            {r.neck !== null && <Chip label="Neck" val={`${r.neck.toFixed(0)}°`} ok={r.neck < 18} />}
            {r.spine !== null && <Chip label="Back" val={`${r.spine.toFixed(0)}°`} ok={r.spine < 15} />}
            {r.sym !== null && <Chip label="Sym" val={`${r.sym.toFixed(1)}%`} ok={r.sym < 4} />}
          </div>
        </div>
      </div>
      {r.issues.map(iss => (
        <div key={iss.key} style={{ fontSize: 10, color: iss.sev === "high" ? T.red : T.amber, marginTop: 4, paddingLeft: 8, borderLeft: `2px solid ${iss.sev === "high" ? T.red : T.amber}` }}>
          ⚠ {iss.label}{iss.angle !== undefined ? ` (${iss.angle.toFixed(0)}°)` : ""}
        </div>
      ))}
    </div>
  );
}
function Chip({ label, val, ok }) {
  return <span style={{ fontSize: 9, color: ok ? T.textMuted : T.amber, background: "rgba(255,255,255,0.05)", padding: "2px 6px", borderRadius: 6 }}>{label}: {val}</span>;
}

// ─── TOAST ────────────────────────────────────────────────────────────────────
function Toasts({ toasts }) {
  return (
    <div style={{ position: "fixed", top: 16, right: 16, display: "flex", flexDirection: "column", gap: 8, zIndex: 999, pointerEvents: "none" }}>
      {toasts.map(t => (
        <div key={t.id} style={{ background: "rgba(8,8,16,0.95)", border: `1px solid ${t.color}44`, borderLeft: `3px solid ${t.color}`, borderRadius: 10, padding: "10px 14px", display: "flex", gap: 10, alignItems: "center", backdropFilter: "blur(20px)", maxWidth: 280, boxShadow: `0 8px 32px rgba(0,0,0,0.7),0 0 20px ${t.color}22`, animation: "slideIn 0.3s cubic-bezier(.34,1.56,.64,1)" }}>
          <span style={{ fontSize: 16 }}>{t.icon}</span>
          <div><div style={{ fontSize: 12, fontWeight: 700, color: t.color }}>{t.title}</div><div style={{ fontSize: 10, color: T.textSecondary, marginTop: 2 }}>{t.body}</div></div>
        </div>
      ))}
    </div>
  );
}

// ─── TOGGLE BUTTON ────────────────────────────────────────────────────────────
function Toggle({ label, on, onClick, color }) {
  return (
    <button onClick={onClick} style={{ padding: "4px 10px", background: on ? `${color}22` : "rgba(255,255,255,0.03)", border: `1px solid ${on ? color + "66" : T.border}`, borderRadius: 20, color: on ? color : T.textMuted, fontSize: 10, cursor: "pointer", fontFamily: "monospace", transition: "all 0.2s" }}>
      {label} {on ? "ON" : "OFF"}
    </button>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const videoRef = useRef(null);
  const containerRef = useRef(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [demoMode, setDemoMode] = useState(false);
  const [demoCount, setDemoCount] = useState(2);
  const [showTrails, setShowTrails] = useState(true);
  const [showHands, setShowHands] = useState(true);
  const [showFace, setShowFace] = useState(true);
  const [cameraError, setCameraError] = useState(null);
  const [displaySize, setDisplaySize] = useState({ w: 640, h: 480 });
  const [toasts, setToasts] = useState([]);
  const lastAlertRef = useRef({});
  const simRef = useRef(null);
  const simT = useRef(0);
  const [simList, setSimList] = useState([]);
  const [sessionStart] = useState(Date.now());
  const [tick, setTick] = useState(0);

  const { persons: realPersons, handResults, faceResults, status } = useVisionAI({
    videoRef, active: cameraActive, enableHands: showHands, enableFace: showFace
  });

  const persons = demoMode ? simList : realPersons;
  const isRunning = cameraActive || demoMode;
  const highRiskCount = persons.filter(p => p.risk?.level === "high").length;

  // Update display size when video resizes
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(entries => {
      for (const e of entries) {
        setDisplaySize({ w: e.contentRect.width, h: e.contentRect.height });
      }
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // Demo loop
  useEffect(() => {
    if (!demoMode) { cancelAnimationFrame(simRef.current); return; }
    const loop = () => {
      simT.current += 0.016;
      setSimList(simPersons(simT.current, demoCount, displaySize.w, displaySize.h));
      simRef.current = requestAnimationFrame(loop);
    };
    simRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(simRef.current);
  }, [demoMode, demoCount, displaySize.w, displaySize.h]);

  // Tick
  useEffect(() => { const id = setInterval(() => setTick(t => t + 1), 1000); return () => clearInterval(id); }, []);

  // Alerts
  useEffect(() => {
    persons.forEach((p, i) => {
      if (!p.risk || p.risk.level !== "high") return;
      const now = Date.now();
      if (now - (lastAlertRef.current[i] || 0) < 20000) return;
      lastAlertRef.current[i] = now;
      const pal = PERSON_PALETTE[i % PERSON_PALETTE.length];
      const iss = p.risk.issues[0];
      const toast = { id: now + i, icon: "🔴", title: `${pal.label}: High Risk`, body: iss?.label || "Poor posture", color: T.red };
      setToasts(prev => [...prev.slice(-3), toast]);
      setTimeout(() => setToasts(prev => prev.filter(t => t.id !== now + i)), 6000);
    });
  }, [persons]);

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 } });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => {
          // initial size
          const r = videoRef.current.getBoundingClientRect();
          setDisplaySize({ w: r.width || 640, h: r.height || 480 });
        };
      }
      setCameraActive(true); setDemoMode(false); setCameraError(null);
    } catch { setCameraError("Camera denied — try Demo Mode"); }
  };

  const stopAll = () => {
    videoRef.current?.srcObject?.getTracks().forEach(t => t.stop());
    setCameraActive(false); setDemoMode(false);
  };

  const sessSec = Math.floor((Date.now() - sessionStart) / 1000);

  return (
    <div style={{ minHeight: "100vh", background: T.bg, fontFamily: "'DM Mono','Courier New',monospace", color: T.textPrimary, overflow: "hidden" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        ::-webkit-scrollbar{width:3px;}
        ::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.1);border-radius:2px;}
        @keyframes slideIn{from{opacity:0;transform:translateX(20px);}to{opacity:1;transform:translateX(0);}}
        @keyframes pulse{0%,100%{opacity:1;}50%{opacity:0.35;}}
        @keyframes spin{from{transform:rotate(0deg);}to{transform:rotate(360deg);}}
        @keyframes fadeUp{from{opacity:0;transform:translateY(8px);}to{opacity:1;transform:translateY(0);}}
      `}</style>

      {/* Header */}
      <header style={{ height: 50, borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 20px", backdropFilter: "blur(20px)", background: "rgba(4,4,10,0.9)", position: "sticky", top: 0, zIndex: 100 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 26, height: 26, borderRadius: 7, background: "linear-gradient(135deg,#7B61FF,#00E5A0)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13 }}>⚡</div>
          <span style={{ fontSize: 13, letterSpacing: 1 }}>ERGO<span style={{ color: T.green }}>.HSE</span> <span style={{ color: T.textMuted, fontSize: 9 }}>MULTI-POSE v2.1</span></span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {isRunning && <span style={{ fontSize: 9, color: T.textMuted }}>{`${String(Math.floor(sessSec / 60)).padStart(2, "0")}:${String(sessSec % 60).padStart(2, "0")}`}</span>}
          {highRiskCount > 0 && <div style={{ padding: "3px 10px", background: "rgba(255,75,110,0.12)", border: `1px solid ${T.red}44`, borderRadius: 20, fontSize: 10, color: T.red, animation: "pulse 1.5s infinite" }}>⚠ {highRiskCount} HIGH RISK</div>}
          {isRunning && <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "3px 10px", background: "rgba(0,229,160,0.08)", border: `1px solid ${T.green}33`, borderRadius: 20 }}>
            <div style={{ width: 5, height: 5, borderRadius: "50%", background: T.green, animation: "pulse 1.5s infinite" }} />
            <span style={{ fontSize: 9, color: T.green }}>LIVE · {persons.length} detected</span>
          </div>}
          {status === "loading" && <div style={{ fontSize: 9, color: T.amber, animation: "pulse 1s infinite" }}>⏳ Loading models...</div>}
        </div>
      </header>

      {/* Main grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", height: "calc(100vh - 50px)" }}>

        {/* Camera + Overlay */}
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12, overflow: "auto" }}>

          {/* Video Card */}
          <div style={{
            background: T.surface, border: `1px solid ${T.border}`, borderRadius: 16, overflow: "hidden", position: "relative", aspectRatio: "16/9", maxHeight: 460,
            boxShadow: highRiskCount > 0 ? "0 0 60px rgba(255,75,110,0.25)" : persons.length > 0 ? "0 0 40px rgba(0,229,160,0.12)" : "none",
            transition: "box-shadow 1s ease"
          }}>

            <div ref={containerRef} style={{ position: "absolute", inset: 0 }}>
              <video ref={videoRef} autoPlay muted playsInline
                style={{ width: "100%", height: "100%", objectFit: "cover", display: cameraActive ? "block" : "none" }} />

              {demoMode && (
                <div style={{ width: "100%", height: "100%", background: "linear-gradient(160deg,#06060f,#0c0c1a)", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 10 }}>
                  <div style={{ display: "flex", gap: 24 }}>{Array.from({ length: demoCount }, (_, i) => (
                    <div key={i} style={{ textAlign: "center" }}>
                      <div style={{ fontSize: 32, color: PERSON_PALETTE[i].stroke, filter: `drop-shadow(0 0 12px ${PERSON_PALETTE[i].glow})` }}>🧍</div>
                      <div style={{ fontSize: 9, color: PERSON_PALETTE[i].stroke, marginTop: 4 }}>{PERSON_PALETTE[i].label}</div>
                    </div>
                  ))}</div>
                  <div style={{ fontSize: 10, color: T.textMuted }}>SIMULATION · {demoCount} persons</div>
                </div>
              )}

              {!isRunning && (
                <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, background: "#06060f" }}>
                  <div style={{ fontSize: 36 }}>📷</div>
                  <div style={{ fontSize: 11, color: T.textSecondary, textAlign: "center", maxWidth: 280 }}>
                    Position camera to capture full scene<br />
                    <span style={{ color: T.textMuted, fontSize: 10 }}>Up to 6 people · Hand & face tracking</span>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={startCamera} style={btn(T.green)}>📷 Camera</button>
                    <button onClick={() => setDemoMode(true)} style={btn(T.accent)}>⚡ Demo</button>
                  </div>
                  {cameraError && <div style={{ fontSize: 10, color: T.red, maxWidth: 240, textAlign: "center" }}>{cameraError}</div>}
                </div>
              )}

              {/* THE OVERLAY — sized to container via ResizeObserver */}
              {isRunning && (
                <OverlayCanvas
                  persons={persons}
                  handResults={cameraActive ? handResults : null}
                  faceResults={cameraActive ? faceResults : null}
                  canvasW={displaySize.w}
                  canvasH={displaySize.h}
                  showTrails={showTrails}
                  showHands={showHands}
                  showFace={showFace}
                />
              )}
            </div>

            {/* Controls overlay */}
            {isRunning && (
              <>
                <div style={{ position: "absolute", top: 10, left: 10, zIndex: 10 }}>
                  <div style={{ padding: "3px 10px", background: "rgba(0,0,0,0.75)", borderRadius: 20, border: `1px solid ${T.border}`, fontSize: 9, backdropFilter: "blur(10px)" }}>
                    {status === "loading" ? "⏳ Loading..." : persons.length ? `✓ ${persons.length} pose${persons.length > 1 ? "s" : ""}` : "Scanning..."}
                  </div>
                </div>
                <div style={{ position: "absolute", top: 10, right: 10, display: "flex", gap: 6, zIndex: 10 }}>
                  <Toggle label="Trails" on={showTrails} onClick={() => setShowTrails(s => !s)} color={T.blue} />
                  <Toggle label="Hands" on={showHands} onClick={() => setShowHands(s => !s)} color={T.green} />
                  <Toggle label="Face" on={showFace} onClick={() => setShowFace(s => !s)} color={T.pink} />
                  <button onClick={stopAll} style={{ padding: "4px 10px", background: "rgba(255,75,110,0.15)", border: `1px solid ${T.red}44`, borderRadius: 20, color: T.red, fontSize: 10, cursor: "pointer" }}>✕</button>
                </div>
              </>
            )}
          </div>

          {/* Demo controls */}
          {demoMode && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10 }}>
              <span style={{ fontSize: 10, color: T.textMuted }}>DEMO PERSONS:</span>
              {[1, 2, 3, 4, 5, 6].map(n => (
                <button key={n} onClick={() => setDemoCount(n)} style={{ width: 28, height: 28, borderRadius: 8, border: `1px solid ${n === demoCount ? PERSON_PALETTE[n - 1].stroke + "88" : T.border}`, background: n === demoCount ? PERSON_PALETTE[n - 1].bg : "transparent", color: n === demoCount ? PERSON_PALETTE[n - 1].stroke : T.textMuted, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>{n}</button>
              ))}
            </div>
          )}

          {/* Legend */}
          {persons.length > 0 && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {persons.map((_, i) => {
                const p = PERSON_PALETTE[i % PERSON_PALETTE.length];
                return (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 10px", background: p.bg, border: `1px solid ${p.stroke}33`, borderRadius: 20 }}>
                    <div style={{ width: 6, height: 6, borderRadius: "50%", background: p.stroke, boxShadow: `0 0 6px ${p.glow}` }} />
                    <span style={{ fontSize: 10, color: p.stroke }}>{p.label}</span>
                  </div>
                );
              })}
              {showHands && cameraActive && <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 10px", background: "rgba(0,229,160,0.06)", border: `1px solid ${T.green}33`, borderRadius: 20 }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: T.green }} />
                <span style={{ fontSize: 10, color: T.green }}>Hands</span>
              </div>}
              {showFace && cameraActive && <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 10px", background: "rgba(255,107,186,0.06)", border: `1px solid ${T.pink}33`, borderRadius: 20 }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: T.pink }} />
                <span style={{ fontSize: 10, color: T.pink }}>Face Mesh</span>
              </div>}
            </div>
          )}
        </div>

        {/* Right panel */}
        <div style={{ borderLeft: `1px solid ${T.border}`, display: "flex", flexDirection: "column", overflow: "hidden", background: "rgba(4,4,10,0.7)" }}>
          <div style={{ padding: 18, borderBottom: `1px solid ${T.border}`, display: "flex", justifyContent: "center" }}>
            {persons.length > 0
              ? <OverallGauge persons={persons} />
              : <div style={{ color: T.textMuted, fontSize: 11, textAlign: "center", padding: "14px 0" }}>{isRunning ? "Detecting..." : "Start session"}</div>}
          </div>

          <div style={{ padding: "10px 16px", borderBottom: `1px solid ${T.border}` }}>
            <div style={{ fontSize: 9, color: T.textMuted, marginBottom: 8, letterSpacing: 1 }}>HSE THRESHOLDS</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
              {[["92–100", "Excellent", T.green], ["75–91", "Good", T.green], ["55–74", "Moderate", T.amber], ["<55", "High Risk", T.red]].map(([r, l, c]) => (
                <div key={r} style={{ fontSize: 9, display: "flex", justifyContent: "space-between", padding: "4px 8px", background: `${c}08`, border: `1px solid ${c}22`, borderRadius: 6 }}>
                  <span style={{ color: c, fontFamily: "monospace" }}>{r}</span><span style={{ color: c + "99" }}>{l}</span>
                </div>
              ))}
            </div>
          </div>

          <div style={{ flex: 1, overflow: "auto", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: 9, color: T.textMuted, letterSpacing: 1 }}>INDIVIDUAL ANALYSIS</div>
            {!isRunning && <div style={{ color: T.textMuted, fontSize: 11, textAlign: "center", padding: "20px 0" }}>No active session</div>}
            {isRunning && !persons.length && <div style={{ color: T.textMuted, fontSize: 11, textAlign: "center", padding: "20px 0" }}><div style={{ fontSize: 20, marginBottom: 8 }}>👁</div>Scanning...</div>}
            {persons.map((p, i) => <PersonCard key={i} person={p} idx={i} />)}
          </div>

          <div style={{ padding: "8px 16px", borderTop: `1px solid ${T.border}`, display: "flex", justifyContent: "space-between" }}>
            <span style={{ fontSize: 9, color: T.textMuted }}>MoveNet · Hands · FaceMesh</span>
            <span style={{ fontSize: 9, color: T.textMuted }}>v2.1</span>
          </div>
        </div>
      </div>
      <Toasts toasts={toasts} />
    </div>
  );
}

function btn(color) {
  return { padding: "8px 16px", background: `${color}14`, border: `1px solid ${color}55`, borderRadius: 8, color, fontSize: 11, cursor: "pointer", fontFamily: "monospace" };
}