import { useState, useEffect, useRef, useCallback } from "react";

// ─── THEME ────────────────────────────────────────────────────────────────────
const T = {
  bg: "#04040A", surface: "rgba(255,255,255,0.04)", border: "rgba(255,255,255,0.08)",
  textPrimary: "#F0F4FF", textSecondary: "rgba(240,244,255,0.5)", textMuted: "rgba(240,244,255,0.25)",
  green: "#00E5A0", amber: "#FFB830", red: "#FF4B6E", blue: "#4B9EFF", accent: "#7B61FF", pink: "#FF6BBA",
};
const PALETTE = [
  { stroke: "#00E5A0", glow: "rgba(0,229,160,0.6)", label: "P1", bg: "rgba(0,229,160,0.08)" },
  { stroke: "#4B9EFF", glow: "rgba(75,158,255,0.6)", label: "P2", bg: "rgba(75,158,255,0.08)" },
  { stroke: "#FF6BBA", glow: "rgba(255,107,186,0.6)", label: "P3", bg: "rgba(255,107,186,0.08)" },
  { stroke: "#FFB830", glow: "rgba(255,184,48,0.6)", label: "P4", bg: "rgba(255,184,48,0.08)" },
  { stroke: "#A78BFA", glow: "rgba(167,139,250,0.6)", label: "P5", bg: "rgba(167,139,250,0.08)" },
  { stroke: "#FB923C", glow: "rgba(251,146,60,0.6)", label: "P6", bg: "rgba(251,146,60,0.08)" },
];

// ─── MOVENET KP INDICES ───────────────────────────────────────────────────────
const KP = { nose: 0, lEye: 1, rEye: 2, lEar: 3, rEar: 4, lS: 5, rS: 6, lE: 7, rE: 8, lW: 9, rW: 10, lH: 11, rH: 12, lK: 13, rK: 14, lA: 15, rA: 16 };
const CONNECTIONS = [[0, 1], [0, 2], [1, 3], [2, 4], [5, 6], [5, 7], [7, 9], [6, 8], [8, 10], [5, 11], [6, 12], [11, 12], [11, 13], [13, 15], [12, 14], [14, 16]];

// ─── ERGONOMICS ENGINE ────────────────────────────────────────────────────────
function vecAngle(v1, v2) {
  const d = v1.x * v2.x + v1.y * v2.y, m = Math.sqrt(v1.x ** 2 + v1.y ** 2) * Math.sqrt(v2.x ** 2 + v2.y ** 2);
  return m ? Math.acos(Math.max(-1, Math.min(1, d / m))) * 180 / Math.PI : 0;
}

// FRONTAL MODE analysis
function analyzeFrontal(kps) {
  const g = (i) => kps[i]?.score > 0.25 ? kps[i] : null;
  const nose = g(0), lS = g(KP.lS), rS = g(KP.rS), lH = g(KP.lH), rH = g(KP.rH), lE = g(KP.lEar), rE = g(KP.rEar);

  // Neck angle (nose vs shoulder midpoint vs vertical)
  let neck = null;
  if (nose && lS && rS) {
    const mid = { x: (lS.x + rS.x) / 2, y: (lS.y + rS.y) / 2 };
    neck = vecAngle({ x: nose.x - mid.x, y: nose.y - mid.y }, { x: 0, y: -1 });
  }

  // Head pitch: ear vs shoulder (frontal proxy for head up/down)
  let headPitch = null;
  if (lS && rS && nose) {
    const midS = { x: (lS.x + rS.x) / 2, y: (lS.y + rS.y) / 2 };
    // If nose is significantly BELOW shoulder midpoint → head too down
    // If nose is far ABOVE → head looking up (tilt)
    const normDist = (midS.y - nose.y); // positive=nose above shoulders (normal)
    const spanY = Math.abs(lS.y - lH?.y || 0.3);
    headPitch = normDist; // raw normalized value
  }

  // Spine lean
  let spine = null;
  if (lS && rS && lH && rH) {
    const mS = { x: (lS.x + rS.x) / 2, y: (lS.y + rS.y) / 2 }, mH = { x: (lH.x + rH.x) / 2, y: (lH.y + rH.y) / 2 };
    spine = vecAngle({ x: mS.x - mH.x, y: mS.y - mH.y }, { x: 0, y: -1 });
  }

  // Shoulder symmetry
  let sym = null;
  if (lS && rS) { const sx = Math.abs(lS.x - rS.x); sym = sx ? (Math.abs(lS.y - rS.y) / sx) * 100 : 0; }

  // Lateral tilt (head left/right)
  let lateralTilt = null;
  if (lE && rE) {
    lateralTilt = Math.abs(lE.y - rE.y) / Math.max(Math.abs(lE.x - rE.x), 0.01) * 100;
  }

  return { mode: "frontal", neck, spine, sym, lateralTilt, headPitch, raw: { lS, rS, lH, rH, nose } };
}

// LATERAL MODE analysis — more accurate for neck/spine
function analyzeLateral(kps) {
  const g = (i) => kps[i]?.score > 0.25 ? kps[i] : null;
  const nose = g(0), ear = g(KP.lEar) || g(KP.rEar), shoulder = g(KP.lS) || g(KP.rS), hip = g(KP.lH) || g(KP.rH);

  // Ear-shoulder-hip angle for neck forward head posture
  let neckForward = null;
  if (ear && shoulder && hip) {
    // Vector from shoulder to ear, vs vertical
    neckForward = vecAngle({ x: ear.x - shoulder.x, y: ear.y - shoulder.y }, { x: 0, y: -1 });
  }

  // Thoracic kyphosis (shoulder-hip vs vertical)
  let kyphosis = null;
  if (shoulder && hip) {
    kyphosis = vecAngle({ x: shoulder.x - hip.x, y: shoulder.y - hip.y }, { x: 0, y: -1 });
  }

  // Head up/down from lateral: nose above/below ear horizontal
  let headTilt = null;
  if (nose && ear) {
    headTilt = (ear.y - nose.y) * 100; // positive = nose above ear (head tilted back)
  }

  return { mode: "lateral", neckForward, kyphosis, headTilt, raw: { nose, ear, shoulder, hip } };
}

// RISK SCORING — both modes, HSE weighted
function calcRisk(posture, sedMs = 0) {
  if (!posture) return null;
  let neckScore = 25, spineScore = 25, symScore = 12, headScore = 15, sedScore = 15;
  const issues = [];

  if (posture.mode === "frontal") {
    const { neck, spine, sym, lateralTilt, headPitch } = posture;
    // Neck
    if (neck !== null) {
      if (neck < 10) neckScore = 30;
      else if (neck < 18) { neckScore = 24; }
      else if (neck < 28) { neckScore = 15; issues.push({ key: "neck", label: "Forward neck", val: `${neck.toFixed(0)}°`, sev: "moderate" }); }
      else { neckScore = 5; issues.push({ key: "neck", label: "Severe forward neck", val: `${neck.toFixed(0)}°`, sev: "high" }); }
    }
    // Head pitch (up/down in frontal)
    if (headPitch !== null) {
      // headPitch is normalized Y distance (shoulder-nose)
      if (headPitch < 0.04) { headScore = 5; issues.push({ key: "head", label: "Head too low (chin down)", val: "", sev: "high" }); }
      else if (headPitch < 0.08) { headScore = 10; issues.push({ key: "head", label: "Head slightly down", val: "", sev: "moderate" }); }
      else if (headPitch > 0.35) { headScore = 8; issues.push({ key: "head", label: "Head too far back", val: "", sev: "moderate" }); }
      else headScore = 15;
    }
    // Spine
    if (spine !== null) {
      if (spine < 8) spineScore = 30;
      else if (spine < 15) { spineScore = 22; }
      else if (spine < 25) { spineScore = 14; issues.push({ key: "spine", label: "Rounded back", val: `${spine.toFixed(0)}°`, sev: "moderate" }); }
      else { spineScore = 4; issues.push({ key: "spine", label: "Severe back flexion", val: `${spine.toFixed(0)}°`, sev: "high" }); }
    }
    // Symmetry
    if (sym !== null) {
      if (sym < 4) symScore = 15;
      else if (sym < 8) { symScore = 10; issues.push({ key: "sym", label: "Shoulder tilt", val: `${sym.toFixed(1)}%`, sev: "moderate" }); }
      else { symScore = 4; issues.push({ key: "sym", label: "Significant shoulder tilt", val: `${sym.toFixed(1)}%`, sev: "high" }); }
    }
    // Lateral tilt
    if (lateralTilt !== null && lateralTilt > 10) {
      symScore = Math.max(0, symScore - 4);
      issues.push({ key: "tilt", label: "Lateral head tilt", val: `${lateralTilt.toFixed(0)}%`, sev: lateralTilt > 20 ? "high" : "moderate" });
    }
  }

  if (posture.mode === "lateral") {
    const { neckForward, kyphosis, headTilt } = posture;
    // Neck forward (lateral is the gold standard)
    if (neckForward !== null) {
      if (neckForward < 10) { neckScore = 30; }
      else if (neckForward < 18) { neckScore = 24; }
      else if (neckForward < 28) { neckScore = 15; issues.push({ key: "neck", label: "Forward head posture", val: `${neckForward.toFixed(0)}°`, sev: "moderate" }); }
      else { neckScore = 5; issues.push({ key: "neck", label: "Severe forward head posture", val: `${neckForward.toFixed(0)}°`, sev: "high" }); }
    }
    // Kyphosis
    if (kyphosis !== null) {
      if (kyphosis < 10) { spineScore = 30; }
      else if (kyphosis < 20) { spineScore = 22; }
      else if (kyphosis < 30) { spineScore = 14; issues.push({ key: "spine", label: "Thoracic kyphosis", val: `${kyphosis.toFixed(0)}°`, sev: "moderate" }); }
      else { spineScore = 4; issues.push({ key: "spine", label: "Severe kyphosis", val: `${kyphosis.toFixed(0)}°`, sev: "high" }); }
    }
    // Head tilt (up/down lateral)
    if (headTilt !== null) {
      if (headTilt < -8) { headScore = 5; issues.push({ key: "head", label: "Head too far down", val: "", sev: "high" }); }
      else if (headTilt < -3) { headScore = 10; issues.push({ key: "head", label: "Head slightly flexed", val: "", sev: "moderate" }); }
      else if (headTilt > 15) { headScore = 8; issues.push({ key: "head", label: "Head extended back", val: "", sev: "moderate" }); }
      else { headScore = 15; }
    }
    symScore = 12; // not measurable from lateral
  }

  // Sedentary
  const sedMin = sedMs / 60000;
  if (sedMin > 90) { sedScore = 3; issues.push({ key: "sed", label: "Extended sitting >90min", val: `${Math.floor(sedMin)}min`, sev: "high" }); }
  else if (sedMin > 60) { sedScore = 8; }
  else if (sedMin > 30) { sedScore = 12; }

  const total = Math.min(100, neckScore + spineScore + symScore + headScore + sedScore);
  let level, label, color;
  if (total >= 92) { level = "excellent"; label = "Excellent"; color = T.green; }
  else if (total >= 75) { level = "good"; label = "Good"; color = T.green; }
  else if (total >= 55) { level = "moderate"; label = "Moderate Risk"; color = T.amber; }
  else { level = "high"; label = "High Risk"; color = T.red; }

  return { score: total, level, label, color, issues, breakdown: { neck: neckScore, spine: spineScore, sym: symScore, head: headScore, sed: sedScore } };
}

// ─── LOAD SCRIPT ──────────────────────────────────────────────────────────────
function loadScript(src) {
  return new Promise((res, rej) => {
    if (document.querySelector(`script[src="${src}"]`)) { res(); return; }
    const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s);
  });
}

// ─── VISION HOOK (throttled + hands + face) ───────────────────────────────────
const HAND_CONNECTIONS = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [0, 9], [9, 10], [10, 11], [11, 12], [0, 13], [13, 14], [14, 15], [15, 16], [0, 17], [17, 18], [18, 19], [19, 20], [5, 9], [9, 13], [13, 17]];
const FACE_OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109, 10];
const FACE_KEY_PTS = [1, 4, 6, 168, 8, 9, 10, 152, 234, 454, 33, 263, 133, 362, 61, 291, 13, 14];

function useVision({ videoRef, active, viewMode, enableHands, enableFace }) {
  const [persons, setPersons] = useState([]);
  const [handRes, setHandRes] = useState(null);
  const [faceRes, setFaceRes] = useState(null);
  const [status, setStatus] = useState("idle");
  const detectorRef = useRef(null);
  const handsRef = useRef(null);
  const faceRef = useRef(null);
  const rafRef = useRef(null);
  const lastRunRef = useRef(0);
  const THROTTLE_MS = 80;

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const load = async () => {
      setStatus("loading");
      try {
        if (!window.tf) await loadScript("https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.17.0/dist/tf.min.js");
        if (!window.poseDetection) await loadScript("https://cdn.jsdelivr.net/npm/@tensorflow-models/pose-detection@2.1.3/dist/pose-detection.min.js");
        await window.tf.ready();
        const d = await window.poseDetection.createDetector(
          window.poseDetection.SupportedModels.MoveNet,
          { modelType: window.poseDetection.movenet.modelType.MULTIPOSE_LIGHTNING, enableSmoothing: true, minPoseScore: 0.2 }
        );
        if (!cancelled) detectorRef.current = d;
        // Hands
        if (enableHands && !handsRef.current) {
          await loadScript("https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4/hands.js");
          if (window.Hands) {
            const h = new window.Hands({ locateFile: (f) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4/${f}` });
            h.setOptions({ maxNumHands: 2, modelComplexity: 1, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
            h.onResults((r) => { if (!cancelled) setHandRes(r); });
            if (!cancelled) handsRef.current = h;
          }
        }
        // Face
        if (enableFace && !faceRef.current) {
          await loadScript("https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4/face_mesh.js");
          if (window.FaceMesh) {
            const f = new window.FaceMesh({ locateFile: (fn) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4/${fn}` });
            f.setOptions({ maxNumFaces: 4, refineLandmarks: false, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
            f.onResults((r) => { if (!cancelled) setFaceRes(r); });
            if (!cancelled) faceRef.current = f;
          }
        }
        if (!cancelled) setStatus("ready");
      } catch (e) { if (!cancelled) setStatus("error"); console.error(e); }
    };
    load();
    return () => { cancelled = true; cancelAnimationFrame(rafRef.current); };
  }, [active]);

  // Re-init hands/face when toggles change after load
  useEffect(() => {
    if (status !== "ready") return;
    if (enableHands && !handsRef.current) {
      loadScript("https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4/hands.js").then(() => {
        if (!window.Hands) return;
        const h = new window.Hands({ locateFile: (f) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4/${f}` });
        h.setOptions({ maxNumHands: 2, modelComplexity: 1, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
        h.onResults((r) => setHandRes(r));
        handsRef.current = h;
      });
    }
    if (!enableHands) { handsRef.current = null; setHandRes(null); }
    if (enableFace && !faceRef.current) {
      loadScript("https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4/face_mesh.js").then(() => {
        if (!window.FaceMesh) return;
        const f = new window.FaceMesh({ locateFile: (fn) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4/${fn}` });
        f.setOptions({ maxNumFaces: 4, refineLandmarks: false, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
        f.onResults((r) => setFaceRes(r));
        faceRef.current = f;
      });
    }
    if (!enableFace) { faceRef.current = null; setFaceRes(null); }
  }, [enableHands, enableFace, status]);

  useEffect(() => {
    if (status !== "ready" || !detectorRef.current || !videoRef.current) return;
    let running = true;
    const loop = async () => {
      if (!running) return;
      const now = Date.now();
      if (now - lastRunRef.current >= THROTTLE_MS) {
        lastRunRef.current = now;
        const vid = videoRef.current;
        if (vid?.readyState >= 2) {
          try {
            const rect = vid.getBoundingClientRect();
            const dW = rect.width || 640, dH = rect.height || 480;
            const sW = vid.videoWidth || 640, sH = vid.videoHeight || 480;
            const poses = await detectorRef.current.estimatePoses(vid, { maxPoses: 6, flipHorizontal: false });
            const enriched = poses.map(p => {
              const normKps = p.keypoints.map(k => ({ ...k, x: k.x / sW, y: k.y / sH }));
              const posture = viewMode === "lateral" ? analyzeLateral(normKps) : analyzeFrontal(normKps);
              return { keypoints: p.keypoints.map(k => ({ ...k, x: (k.x / sW) * dW, y: (k.y / sH) * dH })), risk: calcRisk(posture), posture };
            });
            if (running) setPersons(enriched);
          } catch { }
          if (enableHands && handsRef.current) { try { await handsRef.current.send({ image: vid }); } catch { } }
          if (enableFace && faceRef.current) { try { await faceRef.current.send({ image: vid }); } catch { } }
        }
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => { running = false; cancelAnimationFrame(rafRef.current); };
  }, [status, videoRef, viewMode, enableHands, enableFace]);

  return { persons, handRes, faceRes, status };
}

// ─── CANVAS OVERLAY ───────────────────────────────────────────────────────────
function OverlayCanvas({ persons, handRes, faceRes, W, H, showTrails, showHands, showFace }) {
  const ref = useRef(null);
  const trails = useRef([]);

  useEffect(() => {
    const c = ref.current; if (!c) return;
    const ctx = c.getContext("2d");
    ctx.clearRect(0, 0, W, H);
    const now = Date.now();

    // ── BODY ──
    if (persons?.length) {
      persons.forEach((p, idx) => {
        const pal = PALETTE[idx % PALETTE.length];
        const risk = p.risk;
        let stroke = pal.stroke, glow = pal.glow;
        if (risk?.level === "high") { stroke = T.red; glow = "rgba(255,75,110,0.7)"; }
        else if (risk?.level === "moderate") { stroke = T.amber; glow = "rgba(255,184,48,0.6)"; }
        const kps = p.keypoints;
        if (showTrails && kps[0]?.score > 0.3) {
          if (!trails.current[idx]) trails.current[idx] = [];
          trails.current[idx].push({ x: kps[0].x, y: kps[0].y, t: now });
          trails.current[idx] = trails.current[idx].filter(pt => now - pt.t < 800);
          const tr = trails.current[idx];
          for (let i = 1; i < tr.length; i++) {
            ctx.beginPath(); ctx.moveTo(tr[i - 1].x, tr[i - 1].y); ctx.lineTo(tr[i].x, tr[i].y);
            ctx.strokeStyle = stroke + Math.round((i / tr.length) * 100).toString(16).padStart(2, "0");
            ctx.lineWidth = 2.5; ctx.shadowColor = glow; ctx.shadowBlur = 8; ctx.stroke();
          }
        }
        ctx.shadowColor = glow; ctx.shadowBlur = 20; ctx.strokeStyle = stroke; ctx.lineWidth = 2.5; ctx.lineCap = "round";
        CONNECTIONS.forEach(([i, j]) => {
          const a = kps[i], b = kps[j];
          if (!a || !b || a.score < 0.25 || b.score < 0.25) return;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        });

        // Columna vertebral: línea desde mid-hombros → mid-caderas (visible en frontal)
        const lSk = kps[KP.lS], rSk = kps[KP.rS], lHk = kps[KP.lH], rHk = kps[KP.rH];
        if (lSk?.score > 0.25 && rSk?.score > 0.25 && lHk?.score > 0.25 && rHk?.score > 0.25) {
          const mShX = (lSk.x + rSk.x) / 2, mShY = (lSk.y + rSk.y) / 2;
          const mHiX = (lHk.x + rHk.x) / 2, mHiY = (lHk.y + rHk.y) / 2;
          // Estilo especial columna — línea punteada sutil
          ctx.setLineDash && ctx.setLineDash([4, 3]);
          ctx.shadowColor = glow; ctx.shadowBlur = 10; ctx.strokeStyle = stroke + "99"; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.moveTo(mShX, mShY); ctx.lineTo(mHiX, mHiY); ctx.stroke();
          ctx.setLineDash && ctx.setLineDash([]);
          // Puntos vertebrales intermedios
          for (let s = 0.25; s <= 0.75; s += 0.25) {
            const vx = mShX + (mHiX - mShX) * s, vy = mShY + (mHiY - mShY) * s;
            ctx.beginPath(); ctx.arc(vx, vy, 2.5, 0, Math.PI * 2);
            ctx.fillStyle = stroke + "bb"; ctx.shadowBlur = 14; ctx.fill();
          }
        }
        kps.forEach((kp, ki) => {
          if (!kp || kp.score < 0.25) return;
          const r = ki === 0 ? 8 : [KP.lS, KP.rS, KP.lH, KP.rH].includes(ki) ? 6 : 3.5;
          ctx.shadowColor = glow; ctx.shadowBlur = 28;
          ctx.beginPath(); ctx.arc(kp.x, kp.y, r, 0, Math.PI * 2); ctx.fillStyle = stroke; ctx.fill();
          ctx.beginPath(); ctx.arc(kp.x, kp.y, r * 0.45, 0, Math.PI * 2); ctx.fillStyle = "#ffffff99"; ctx.fill();
        });
        if (kps[0]?.score > 0.3) {
          const pr = 14 + Math.sin(now / 600 + idx) * 6;
          ctx.beginPath(); ctx.arc(kps[0].x, kps[0].y, pr, 0, Math.PI * 2);
          ctx.strokeStyle = stroke + "55"; ctx.lineWidth = 1.5; ctx.shadowBlur = 12; ctx.stroke();
        }
        const lS = kps[KP.lS], rS = kps[KP.rS];
        if (lS?.score > 0.25 && rS?.score > 0.25) {
          const cx = (lS.x + rS.x) / 2, cy = Math.min(lS.y, rS.y) - 30;
          ctx.shadowBlur = 0;
          ctx.fillStyle = stroke + "28"; rRect(ctx, cx - 30, cy - 13, 60, 24, 12); ctx.fill();
          ctx.strokeStyle = stroke + "99"; ctx.lineWidth = 1; rRect(ctx, cx - 30, cy - 13, 60, 24, 12); ctx.stroke();
          ctx.fillStyle = stroke; ctx.font = "bold 11px 'DM Mono',monospace";
          ctx.textAlign = "center"; ctx.textBaseline = "middle";
          ctx.fillText(`${pal.label} ${risk?.score ?? "-"}`, cx, cy);
        }
        if (risk?.issues?.length && kps[0]?.score > 0.3) {
          const iss = risk.issues[0];
          ctx.fillStyle = (iss.sev === "high" ? T.red : T.amber) + "cc";
          ctx.font = "10px 'DM Mono',monospace"; ctx.textAlign = "center"; ctx.shadowBlur = 0;
          ctx.fillText(`⚠ ${iss.label}`, kps[0].x, kps[0].y - 60);
        }
        ctx.shadowBlur = 0;
      });
    }

    // ── HANDS ──
    if (showHands && handRes?.multiHandLandmarks) {
      handRes.multiHandLandmarks.forEach((hand, hi) => {
        const isRight = handRes.multiHandedness?.[hi]?.label === "Right";
        const hColor = isRight ? "#00E5A0" : "#FF6BBA";
        const hGlow = isRight ? "rgba(0,229,160,0.6)" : "rgba(255,107,186,0.6)";
        ctx.shadowColor = hGlow; ctx.shadowBlur = 18; ctx.strokeStyle = hColor; ctx.lineWidth = 2.2; ctx.lineCap = "round";
        HAND_CONNECTIONS.forEach(([i, j]) => {
          const a = hand[i], b = hand[j]; if (!a || !b) return;
          ctx.beginPath(); ctx.moveTo(a.x * W, a.y * H); ctx.lineTo(b.x * W, b.y * H); ctx.stroke();
        });
        hand.forEach((lm, li) => {
          const isTip = [4, 8, 12, 16, 20].includes(li);
          ctx.beginPath(); ctx.arc(lm.x * W, lm.y * H, isTip ? 5 : 3, 0, Math.PI * 2);
          ctx.fillStyle = isTip ? "#FF4B6E" : hColor;
          ctx.shadowColor = isTip ? "rgba(255,75,110,0.8)" : hGlow; ctx.shadowBlur = 20; ctx.fill();
          ctx.beginPath(); ctx.arc(lm.x * W, lm.y * H, isTip ? 2.5 : 1.5, 0, Math.PI * 2);
          ctx.fillStyle = "#ffffffcc"; ctx.fill();
        });
        ctx.shadowBlur = 0;
      });
    }

    // ── FACE MESH ──
    if (showFace && faceRes?.multiFaceLandmarks) {
      faceRes.multiFaceLandmarks.forEach(face => {
        ctx.shadowColor = "rgba(255,0,180,0.8)"; ctx.shadowBlur = 18;
        ctx.strokeStyle = "#FF00CC"; ctx.lineWidth = 2;
        ctx.beginPath();
        FACE_OVAL.forEach((idx, i) => {
          const lm = face[idx]; if (!lm) return;
          i === 0 ? ctx.moveTo(lm.x * W, lm.y * H) : ctx.lineTo(lm.x * W, lm.y * H);
        });
        ctx.closePath(); ctx.stroke();
        FACE_KEY_PTS.forEach(idx => {
          const lm = face[idx]; if (!lm) return;
          ctx.beginPath(); ctx.arc(lm.x * W, lm.y * H, 2.5, 0, Math.PI * 2);
          ctx.fillStyle = "#FF00CC"; ctx.shadowColor = "rgba(255,0,200,0.9)"; ctx.shadowBlur = 12; ctx.fill();
          ctx.beginPath(); ctx.arc(lm.x * W, lm.y * H, 1, 0, Math.PI * 2);
          ctx.fillStyle = "#ffffff"; ctx.fill();
        });
        ctx.shadowBlur = 0;
      });
    }
  });

  return <canvas ref={ref} width={W} height={H} style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", pointerEvents: "none" }} />;
}
function rRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h); ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r); ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
}

// ─── CAPTURA DE PANTALLA DEL VIDEO CON ESQUELETO ─────────────────────────────
async function captureVideoFrame(videoEl, overlayCanvasEl) {
  try {
    const w = videoEl.videoWidth || 640;
    const h = videoEl.videoHeight || 480;
    const offscreen = document.createElement("canvas");
    offscreen.width = w; offscreen.height = h;
    const ctx = offscreen.getContext("2d");
    // Dibujar el frame del video
    ctx.drawImage(videoEl, 0, 0, w, h);
    // Dibujar el overlay del skeleton encima (escalado)
    if (overlayCanvasEl) {
      ctx.drawImage(overlayCanvasEl, 0, 0, w, h);
    }
    return offscreen.toDataURL("image/jpeg", 0.82);
  } catch { return null; }
}

// ─── ESQUELETO VECTORIAL PARA PDF ─────────────────────────────────────────────
function drawSkeletonSilhouette(doc, pd, cx, cy, scale = 1.1) {
  // Silueta humana sentado + puntos de postura clave
  const col = pd.avgScore >= 75 ? [0, 180, 120] : pd.avgScore >= 55 ? [220, 150, 30] : [210, 50, 60];
  const dimCol = [60, 65, 90];

  // Líneas del esqueleto (coordenadas normalizadas de figura sentada)
  const joints = {
    head: { x: cx, y: cy - 52 * scale },
    neck: { x: cx, y: cy - 40 * scale },
    lSh: { x: cx - 18 * scale, y: cy - 30 * scale },
    rSh: { x: cx + 18 * scale, y: cy - 30 * scale },
    spine1: { x: cx, y: cy - 15 * scale },
    spine2: { x: cx + 4 * scale, y: cy + 2 * scale },  // ligera curva lumbar
    lHip: { x: cx - 14 * scale, y: cy + 10 * scale },
    rHip: { x: cx + 14 * scale, y: cy + 10 * scale },
    lEl: { x: cx - 30 * scale, y: cy - 10 * scale },
    rEl: { x: cx + 30 * scale, y: cy - 10 * scale },
    lWr: { x: cx - 38 * scale, y: cy + 8 * scale },
    rWr: { x: cx + 38 * scale, y: cy + 8 * scale },
    lKn: { x: cx - 16 * scale, y: cy + 30 * scale },
    rKn: { x: cx + 16 * scale, y: cy + 30 * scale },
  };

  const lines = [
    [joints.neck, joints.head], [joints.neck, joints.lSh], [joints.neck, joints.rSh],
    [joints.neck, joints.spine1], [joints.spine1, joints.spine2],
    [joints.lSh, joints.lEl], [joints.lEl, joints.lWr],
    [joints.rSh, joints.rEl], [joints.rEl, joints.rWr],
    [joints.spine2, joints.lHip], [joints.spine2, joints.rHip],
    [joints.lHip, joints.lKn], [joints.rHip, joints.rKn],
  ];

  // Sombra/glow efecto (segunda pasada levemente desplazada)
  doc.setDrawColor(col[0], col[1], col[2], 0.2);
  doc.setLineWidth(1.8);
  lines.forEach(([a, b]) => { doc.line(a.x + 0.3, a.y + 0.3, b.x + 0.3, b.y + 0.3); });

  // Líneas principales
  doc.setDrawColor(...col); doc.setLineWidth(1.2);
  lines.forEach(([a, b]) => { doc.line(a.x, a.y, b.x, b.y); });

  // Puntos articulares
  Object.values(joints).forEach(j => {
    doc.setFillColor(...col);
    doc.circle(j.x, j.y, 1.4, "F");
    doc.setFillColor(220, 230, 255);
    doc.circle(j.x, j.y, 0.6, "F");
  });

  // Cabeza (círculo)
  doc.setDrawColor(...col); doc.setLineWidth(0.8);
  doc.circle(joints.head.x, joints.head.y - 5 * scale, 5 * scale, "D");

  // Ángulos indicadores (si hay problemas)
  if (pd.issues?.some(i => i.key === "neck")) {
    doc.setDrawColor(210, 100, 50); doc.setLineWidth(0.5);
    // Flecha en cuello indicando inclinación
    doc.line(joints.neck.x, joints.neck.y, joints.neck.x + 8 * scale, joints.neck.y - 12 * scale);
    doc.setFontSize(6); doc.setTextColor(210, 100, 50);
    doc.text("⚠", joints.neck.x + 9 * scale, joints.neck.y - 12 * scale);
  }
}

// ─── GENERADOR PDF MEJORADO (ESPAÑOL) ────────────────────────────────────────
async function generatePDF(reportData) {
  if (!window.jspdf) {
    await loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js");
  }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const PW = 210, PH = 297, M = 16;
  let y = M;

  // ── UTILIDADES ──
  const h2r = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const s2c = (s) => s >= 75 ? "#1db87a" : s >= 55 ? "#c47a1a" : "#c43a50"; // tonos suavizados
  const BG = [14, 16, 26], CARD = [22, 26, 42], LINE = [40, 46, 70];
  const GREEN = [29, 184, 122], AMBER = [196, 122, 26], RED = [196, 58, 80];
  const TEXT = [210, 215, 235], MUTED = [120, 128, 158], ACCENT = [29, 184, 122];

  const newPage = () => {
    doc.addPage();
    doc.setFillColor(...BG); doc.rect(0, 0, PW, PH, "F");
    // Banda lateral izquierda sutil
    doc.setFillColor(25, 30, 48); doc.rect(0, 0, 4, PH, "F");
    y = M + 4;
  };
  const checkPage = (needed = 20) => { if (y > PH - needed - 14) newPage(); };

  const secHeader = (title, icon = "") => {
    checkPage(20);
    doc.setFillColor(...CARD);
    doc.roundedRect(M, y, PW - M * 2, 9, 2, 2, "F");
    doc.setDrawColor(...ACCENT); doc.setLineWidth(0.4);
    doc.line(M, y, M, y + 9); // barra izquierda
    doc.setFontSize(9); doc.setFont("helvetica", "bold"); doc.setTextColor(...ACCENT);
    doc.text(`${icon}  ${title}`, M + 4, y + 6);
    y += 13;
  };

  const bodyText = (text, color = TEXT, size = 8.5) => {
    checkPage(10);
    doc.setFontSize(size); doc.setFont("helvetica", "normal"); doc.setTextColor(...color);
    const lines = doc.splitTextToSize(text, PW - M * 2 - 4);
    lines.forEach(l => { checkPage(6); doc.text(l, M + 2, y); y += 5; });
  };

  const divider = () => {
    doc.setDrawColor(...LINE); doc.setLineWidth(0.25);
    doc.line(M, y, PW - M, y); y += 4;
  };

  // ══════════════════════════════════════════════════════
  // PÁGINA 1 — PORTADA
  // ══════════════════════════════════════════════════════
  doc.setFillColor(...BG); doc.rect(0, 0, PW, PH, "F");
  doc.setFillColor(25, 30, 48); doc.rect(0, 0, 4, PH, "F");

  // Banda superior
  doc.setFillColor(...GREEN); doc.rect(0, 0, PW, 1.8, "F");
  doc.setFillColor(20, 24, 40); doc.rect(0, 1.8, PW, 28, "F");

  // Logo / título
  y = 14;
  doc.setFontSize(26); doc.setFont("helvetica", "bold"); doc.setTextColor(...TEXT);
  doc.text("ERGO", M, y);
  doc.setTextColor(...GREEN); doc.text(".HSE", M + 29, y);
  doc.setFontSize(8); doc.setFont("helvetica", "normal"); doc.setTextColor(...MUTED);
  doc.text("SISTEMA DE EVALUACIÓN ERGONÓMICA BASADO EN IA", M, y + 6);
  doc.setFontSize(7.5); doc.setTextColor(...MUTED);
  doc.text("Informe de Evaluación de Riesgo Ergonómico", M, y + 11);

  // Fecha y número de informe
  const fechaStr = new Date().toLocaleDateString("es-ES", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  doc.setFontSize(7); doc.setTextColor(...MUTED);
  doc.text(fechaStr.charAt(0).toUpperCase() + fechaStr.slice(1), PW - M, y + 3, { align: "right" });
  doc.text(`Ref: ERGO-${Date.now().toString().slice(-6)}`, PW - M, y + 8, { align: "right" });

  y = 34;

  // ── CAPTURA DE VIDEO ──
  if (reportData.captureDataURL) {
    const imgW = PW - M * 2, imgH = imgW * (9 / 16);
    try {
      doc.addImage(reportData.captureDataURL, "JPEG", M, y, imgW, imgH, undefined, "MEDIUM");
      // Borde sutil
      doc.setDrawColor(...LINE); doc.setLineWidth(0.3);
      doc.roundedRect(M, y, imgW, imgH, 2, 2, "D");
      // Etiqueta
      doc.setFillColor(14, 16, 26, 0.7); doc.setFillColor(14, 16, 26);
      doc.roundedRect(M, y + imgH - 7, 50, 7, 0, 0, "F");
      doc.setFontSize(6.5); doc.setTextColor(...ACCENT);
      doc.text("Captura de sesión con esqueleto de postura", M + 2, y + imgH - 3);
    } catch (e) { console.warn("No se pudo insertar captura", e); }
    y += imgH + 6;
  } else {
    // Sin captura — dibujar esqueleto vectorial centrado
    const skel_cx = PW / 2, skel_cy = y + 45;
    doc.setFontSize(7); doc.setTextColor(...MUTED);
    doc.text("Representación vectorial de postura detectada", PW / 2, y + 3, { align: "center" });
    // Fondo
    doc.setFillColor(...CARD); doc.roundedRect(M, y + 6, PW - M * 2, 78, 4, 4, "F");
    // Dibujar esqueleto(s)
    const n = Math.min(reportData.personsData.length, 3);
    const spacing = (PW - M * 2) / (n + 1);
    reportData.personsData.slice(0, 3).forEach((pd, i) => {
      drawSkeletonSilhouette(doc, pd, M + spacing * (i + 1), skel_cy, 1.0);
      doc.setFontSize(7); const sc2 = s2c(pd.avgScore);
      doc.setTextColor(...h2r(sc2));
      doc.text(`P${i + 1}: ${pd.avgScore}/100`, M + spacing * (i + 1), skel_cy + 42, { align: "center" });
    });
    y += 90;
  }

  // ── FICHA TÉCNICA ──
  doc.setFillColor(...CARD); doc.setDrawColor(...LINE); doc.setLineWidth(0.3);
  doc.roundedRect(M, y, PW - M * 2, 42, 3, 3, "FD");

  const campos = [
    ["Operador", reportData.operator || "Profesional HSE"],
    ["Ubicación / Área", reportData.location || "—"],
    ["Fecha", fechaStr.charAt(0).toUpperCase() + fechaStr.slice(1)],
    ["Duración del muestreo", `${reportData.samplingMin} minuto${reportData.samplingMin !== 1 ? "s" : ""}`],
    ["Modo de vista", reportData.viewMode === "lateral" ? "Lateral (Vista de lado)" : "Frontal (Vista de frente)"],
    ["Personas analizadas", String(reportData.personsData.length)],
    ["Total de muestras", String(reportData.totalSnapshots || 0)],
    ["Normas de referencia", "ISO 11226 · EN 1005-4 · NIOSH"],
  ];
  campos.forEach((row, i) => {
    const col = i % 2, rowI = Math.floor(i / 2);
    const ix = M + 6 + col * (PW - M * 2) / 2, iy = y + 8 + rowI * 9;
    doc.setFontSize(7.5); doc.setFont("helvetica", "bold"); doc.setTextColor(...ACCENT);
    doc.text(row[0] + ":", ix, iy);
    doc.setFont("helvetica", "normal"); doc.setTextColor(...TEXT);
    doc.text(row[1], ix + 36, iy);
  });
  y += 46;

  // ── SCORE GENERAL ──
  checkPage(28);
  const avgScore = Math.round(reportData.personsData.reduce((s, p) => s + (p.avgScore || 0), 0) / Math.max(reportData.personsData.length, 1));
  const scColor = s2c(avgScore);
  const scRGB = h2r(scColor);
  const nivelLabel = avgScore >= 92 ? "Excelente" : avgScore >= 75 ? "Bueno" : avgScore >= 55 ? "Riesgo Moderado" : "Riesgo Alto";

  doc.setFillColor(...CARD); doc.roundedRect(M, y, PW - M * 2, 26, 3, 3, "F");
  // Barra de fondo
  doc.setFillColor(...LINE); doc.roundedRect(M + 36, y + 5, PW - M * 2 - 44, 8, 4, 4, "F");
  // Barra de score
  const barW2 = (PW - M * 2 - 44) * (avgScore / 100);
  doc.setFillColor(...scRGB); doc.roundedRect(M + 36, y + 5, barW2, 8, 4, 4, "F");
  // Score numérico a la izquierda
  doc.setFontSize(18); doc.setFont("helvetica", "bold"); doc.setTextColor(...scRGB);
  doc.text(`${avgScore}`, M + 4, y + 14);
  doc.setFontSize(7.5); doc.setTextColor(...MUTED); doc.text("/100", M + 20, y + 14);
  // Nivel a la derecha DEBAJO de la barra
  doc.setFontSize(9); doc.setFont("helvetica", "bold"); doc.setTextColor(...scRGB);
  doc.text(nivelLabel, PW - M - 2, y + 22, { align: "right" });
  y += 30;

  // ══════════════════════════════════════════════════════
  // PÁGINA 2 — RESUMEN EJECUTIVO + TABLA DE ÁNGULOS
  // ══════════════════════════════════════════════════════
  newPage();

  secHeader("RESUMEN EJECUTIVO", "[1]");
  const resumen = genResumenES(reportData, avgScore);
  resumen.forEach(l => {
    if (l === "") { y += 2; return; }
    if (l.startsWith("•")) {
      doc.setFontSize(8.5); doc.setFont("helvetica", "normal"); doc.setTextColor(...TEXT);
      const ls = doc.splitTextToSize(l, PW - M * 2 - 8);
      ls.forEach(ll => { checkPage(6); doc.text(ll, M + 6, y); y += 5; });
    } else {
      bodyText(l, TEXT, 8.5);
    }
  });

  y += 4; divider();

  // ── TABLA DE MÉTRICAS ANGULARES ──
  secHeader("TABLA DE ANGULOS Y METRICAS POSTURALES", "[2]");

  // Encabezado tabla
  const cols = [M + 2, M + 38, M + 70, M + 100, M + 130, M + 158];
  const colLabels = ["Persona", "Cuello (°)", "Espalda (°)", "Asimetría (%)", "Cabeza", "Score"];
  doc.setFillColor(28, 34, 54); doc.roundedRect(M, y - 3, PW - M * 2, 9, 2, 2, "F");
  doc.setFontSize(7.5); doc.setFont("helvetica", "bold"); doc.setTextColor(...ACCENT);
  colLabels.forEach((cl, i) => doc.text(cl, cols[i], y + 3));
  y += 10;

  reportData.personsData.forEach((pd, i) => {
    checkPage(10);
    const pal = PALETTE[i % PALETTE.length];
    const isEven = i % 2 === 0;
    doc.setFillColor(isEven ? 20 : 24, isEven ? 24 : 28, isEven ? 40 : 46);
    doc.rect(M, y - 3, PW - M * 2, 8, "F");

    // Barra color persona
    doc.setFillColor(...h2r(pal.stroke)); doc.rect(M, y - 3, 2, 8, "F");

    doc.setFontSize(8); doc.setFont("helvetica", "bold"); doc.setTextColor(...h2r(pal.stroke));
    doc.text(pal.label, cols[0], y + 2);

    // Ángulo cuello
    const neckVal = pd.angles?.neck;
    const neckColor = neckVal === null || neckVal === undefined ? "#8090a0" : neckVal < 10 ? "#1db87a" : neckVal < 18 ? "#8ab870" : neckVal < 28 ? "#c47a1a" : "#c43a50";
    doc.setFont("helvetica", "normal"); doc.setTextColor(...h2r(neckColor));
    doc.text(neckVal != null ? `${neckVal.toFixed(1)}°` : "—", cols[1], y + 2);

    // Ángulo espalda
    const spineVal = pd.angles?.spine;
    const spineColor = spineVal === null || spineVal === undefined ? "#8090a0" : spineVal < 8 ? "#1db87a" : spineVal < 15 ? "#8ab870" : spineVal < 25 ? "#c47a1a" : "#c43a50";
    doc.setTextColor(...h2r(spineColor));
    doc.text(spineVal != null ? `${spineVal.toFixed(1)}°` : "—", cols[2], y + 2);

    // Simetría
    const symVal = pd.angles?.sym;
    const symColor = symVal === null || symVal === undefined ? "#8090a0" : symVal < 4 ? "#1db87a" : symVal < 8 ? "#c47a1a" : "#c43a50";
    doc.setTextColor(...h2r(symColor));
    doc.text(symVal != null ? `${symVal.toFixed(1)}%` : "—", cols[3], y + 2);

    // Head status
    const headIss = pd.issues?.find(iss2 => iss2.key === "head");
    if (headIss) { doc.setTextColor(headIss.sev === "high" ? 196 : 196, headIss.sev === "high" ? 58 : 122, headIss.sev === "high" ? 80 : 26); }
    else { doc.setTextColor(29, 184, 122); }
    doc.text(headIss ? "Ajustar" : "Normal", cols[4], y + 2);

    // Score con mini barra
    const sc2 = s2c(pd.avgScore);
    doc.setFillColor(...LINE); doc.roundedRect(cols[5], y - 1, 28, 5, 2, 2, "F");
    doc.setFillColor(...h2r(sc2)); doc.roundedRect(cols[5], y - 1, 28 * (pd.avgScore / 100), 5, 2, 2, "F");
    doc.setTextColor(...h2r(sc2)); doc.setFont("helvetica", "bold");
    doc.text(`${pd.avgScore}`, cols[5] + 30, y + 2);
    y += 9;
  });

  y += 4;

  // Leyenda de colores de ángulos
  checkPage(16);
  doc.setFontSize(7); doc.setFont("helvetica", "normal");
  const legend = [["<10°", "Excelente", "#1db87a"], ["10–18°", "Aceptable", "#8ab870"], ["18–28°", "Advertencia", "#c47a1a"], [">28°", "Riesgo alto", "#c43a50"]];
  doc.setTextColor(...MUTED); doc.text("Referencia de ángulos de cuello:", M, y); y += 5;
  legend.forEach((l, i) => {
    doc.setFillColor(...h2r(l[2])); doc.circle(M + 4 + i * 44, y - 1.5, 2, "F");
    doc.setTextColor(...h2r(l[2])); doc.text(`${l[0]} ${l[1]}`, M + 8 + i * 44, y);
  });
  y += 8; divider();

  // ── ANÁLISIS POR PERSONA ──
  secHeader("ANALISIS INDIVIDUAL POR PERSONA", "[3]");

  reportData.personsData.forEach((pd, i) => {
    checkPage(55);
    const pal = PALETTE[i % PALETTE.length];
    const sc2 = s2c(pd.avgScore);

    // Card de persona
    doc.setFillColor(...CARD); doc.setDrawColor(...h2r(pal.stroke)); doc.setLineWidth(0.3);
    doc.roundedRect(M, y, PW - M * 2, 10, 2, 2, "FD");
    doc.setFillColor(...h2r(pal.stroke)); doc.roundedRect(M, y, 3, 10, 1, 1, "F");
    doc.setFontSize(9.5); doc.setFont("helvetica", "bold"); doc.setTextColor(...h2r(pal.stroke));
    doc.text(`Persona ${i + 1}  (${pal.label})`, M + 6, y + 7);
    doc.setTextColor(...h2r(sc2));
    doc.text(`${pd.avgScore}/100  ·  ${nivelFromScore(pd.avgScore)}`, PW - M - 2, y + 7, { align: "right" });
    y += 13;

    // Métricas en dos columnas
    const metricas = [
      { label: "Posición del cuello / cabeza", score: pd.breakdown?.neck ?? 25, max: 30 },
      { label: "Cabeza vertical (arriba/abajo)", score: pd.breakdown?.head ?? 12, max: 15 },
      { label: "Postura de espalda / columna", score: pd.breakdown?.spine ?? 25, max: 30 },
      { label: "Simetría de hombros", score: pd.breakdown?.sym ?? 12, max: 15 },
      { label: "Tiempo sedentario", score: pd.breakdown?.sed ?? 12, max: 10 },
    ];
    metricas.forEach((m, mi) => {
      checkPage(8);
      const pct = m.score / m.max;
      const mc = pct >= 0.8 ? GREEN : pct >= 0.5 ? AMBER : RED;
      doc.setFontSize(8); doc.setFont("helvetica", "normal"); doc.setTextColor(...TEXT);
      doc.text(m.label, M + 4, y);
      // Barra
      doc.setFillColor(...LINE); doc.roundedRect(M + 72, y - 3, 50, 4.5, 2, 2, "F");
      doc.setFillColor(...mc); doc.roundedRect(M + 72, y - 3, 50 * Math.min(1, pct), 4.5, 2, 2, "F");
      // Valor
      doc.setTextColor(...mc); doc.setFont("helvetica", "bold");
      doc.text(`${m.score}/${m.max}`, M + 124, y);
      const pctLabel = `${Math.round(pct * 100)}%`;
      doc.setTextColor(...MUTED); doc.setFont("helvetica", "normal"); doc.setFontSize(7);
      doc.text(pctLabel, M + 136, y);
      y += 7;
    });

    // Issues
    if (pd.issues?.length) {
      y += 2;
      doc.setFontSize(8); doc.setFont("helvetica", "bold"); doc.setTextColor(...AMBER);
      doc.text("Desviaciones detectadas:", M + 4, y); y += 5;
      pd.issues.forEach(iss => {
        checkPage(6);
        const ic = iss.sev === "high" ? RED : AMBER;
        doc.setFillColor(...ic); doc.circle(M + 7, y - 1, 1.2, "F");
        doc.setFontSize(8); doc.setFont("helvetica", "normal"); doc.setTextColor(...ic);
        doc.text(`${iss.label}${iss.val ? " (" + iss.val + ")" : ""}`, M + 10, y); y += 5;
      });
    }
    y += 4; divider();
  });

  // ══════════════════════════════════════════════════════
  // PÁGINA 3 — RECOMENDACIONES + NOTAS TÉCNICAS
  // ══════════════════════════════════════════════════════
  newPage();
  secHeader("RECOMENDACIONES ERGONOMICAS", "[4]");
  const recs = genRecomendacionesES(reportData, avgScore);
  recs.forEach(rec => {
    checkPage(18);
    doc.setFontSize(9); doc.setFont("helvetica", "bold"); doc.setTextColor(...ACCENT);
    doc.text(rec.categoria, M, y); y += 5;
    rec.items.forEach(item => {
      checkPage(7);
      doc.setFontSize(8.5); doc.setFont("helvetica", "normal"); doc.setTextColor(...TEXT);
      const ls = doc.splitTextToSize(`• ${item}`, PW - M * 2 - 8);
      ls.forEach(l => { checkPage(6); doc.text(l, M + 4, y); y += 5; });
    });
    y += 4;
  });

  y += 2; divider();
  secHeader("NOTAS TECNICAS Y METODOLOGIA", "[5]");
  const notas = [
    `Método de medición: Estimación de postura mediante visión computacional con modelo TensorFlow MoveNet MultiPose Lightning. Frecuencia de muestreo: ~12 cuadros/segundo con throttle a ${Math.round(1000 / 80)} fps efectivos.`,
    `Cálculo de ángulos: Ángulo de cuello calculado como desviación del vector oído-hombro respecto al eje vertical (modo lateral) o vector nariz-punto medio de hombros (modo frontal). Ángulo de columna: vector punto medio hombros → punto medio caderas vs. vertical.`,
    `Modo de vista utilizado: ${reportData.viewMode === "lateral" ? "LATERAL (ángulo 30–45°) — recomendado para máxima precisión en postura de cuello adelantado y cifosis torácica." : "FRONTAL (vista de frente) — recomendado para asimetría de hombros e inclinación lateral de cabeza."}`,
    `Marco de puntuación HSE: Puntuación compuesta ponderada (0–100) según ISO 11226, EN 1005-4 y guías NIOSH. Cuello: 30 pts · Espalda: 30 pts · Posición de cabeza: 15 pts · Simetría: 15 pts · Tiempo sedentario: 10 pts.`,
    `Umbrales de confianza: Puntos anatómicos con confianza de detección <0.25 son excluidos del análisis para evitar falsos positivos.`,
    `Limitaciones: Esta herramienta provee una evaluación de nivel de tamizaje (screening). No reemplaza una evaluación completa de salud ocupacional por un ergónomo certificado o médico ocupacional. Resultados pueden verse afectados por iluminación, ángulo de cámara y oclusión parcial del cuerpo.`,
  ];
  notas.forEach(n => { bodyText(n, MUTED, 8); y += 2; });

  // ── FIRMA / PIE PROFESIONAL ──
  checkPage(30);
  y += 4;
  doc.setFillColor(...CARD); doc.roundedRect(M, y, PW - M * 2, 24, 3, 3, "F");
  doc.setDrawColor(...GREEN); doc.setLineWidth(0.3); doc.roundedRect(M, y, PW - M * 2, 24, 3, 3, "D");
  doc.setFontSize(8); doc.setFont("helvetica", "bold"); doc.setTextColor(...MUTED);
  doc.text("Elaborado por:", M + 6, y + 7);
  doc.setFont("helvetica", "bold"); doc.setTextColor(...ACCENT);
  doc.text("Juan Carlos Cordova", M + 6, y + 14);
  doc.setFont("helvetica", "normal"); doc.setTextColor(...MUTED); doc.setFontSize(7);
  doc.text("Profesional HSE / Ingeniero de Campo", M + 6, y + 20);
  doc.setFontSize(7.5); doc.setTextColor(...MUTED);
  doc.text("Firma: ___________________________", PW - M - 2, y + 13, { align: "right" });
  doc.text("Fecha: " + new Date().toLocaleDateString("es-ES"), PW - M - 2, y + 20, { align: "right" });
  y += 28;

  // ── FOOTER EN CADA PÁGINA ──
  const totalPgs = doc.getNumberOfPages();
  for (let i = 1; i <= totalPgs; i++) {
    doc.setPage(i);
    doc.setFillColor(...BG); doc.rect(0, PH - 11, PW, 11, "F");
    doc.setDrawColor(...GREEN); doc.setLineWidth(0.2); doc.line(0, PH - 11, PW, PH - 11);
    doc.setFillColor(20, 24, 40); doc.rect(0, PH - 11, 4, 11, "F");
    doc.setFontSize(6.5); doc.setFont("helvetica", "normal"); doc.setTextColor(...MUTED);
    doc.text(`ERGO.HSE AI  ·  Informe de Evaluación Ergonómica  ·  ${reportData.location || ""}  ·  ${new Date().toLocaleDateString("es-ES")}`, M, PH - 5);
    doc.text(`Pág. ${i} / ${totalPgs}`, PW - M, PH - 5, { align: "right" });
  }

  doc.save(`ERGO_HSE_Informe_${new Date().toISOString().slice(0, 10)}.pdf`);
}

function nivelFromScore(s) { return s >= 92 ? "Excelente" : s >= 75 ? "Bueno" : s >= 55 ? "Riesgo Moderado" : "Riesgo Alto"; }

function sectionHeader(doc, margin, y, title, W) {
  doc.setFillColor(22, 26, 42);
  doc.roundedRect(margin, y - 4, W - margin * 2, 10, 2, 2, "F");
  doc.setDrawColor(29, 184, 122); doc.setLineWidth(0.4);
  doc.line(margin, y - 4, margin, y + 6);
  // Cuadrado indicador en lugar de emoji
  doc.setFillColor(29, 184, 122);
  doc.roundedRect(margin + 4, y - 1, 3, 4, 0.5, 0.5, "F");
  doc.setFontSize(9.5); doc.setFont("helvetica", "bold"); doc.setTextColor(29, 184, 122);
  doc.text(title, margin + 10, y + 3);
}

function genResumenES(rd, avgScore) {
  const nivel = nivelFromScore(avgScore).toUpperCase();
  const n = rd.personsData.length;
  const alto = rd.personsData.filter(p => p.avgScore < 55).length;
  const mod = rd.personsData.filter(p => p.avgScore >= 55 && p.avgScore < 75).length;
  const lines = [];
  lines.push(`La presente evaluación ergonómica fue realizada durante un período de muestreo de ${rd.samplingMin} minuto${rd.samplingMin !== 1 ? "s" : ""}, utilizando estimación de postura basada en inteligencia artificial en modo de vista ${rd.viewMode === "lateral" ? "lateral" : "frontal"}. Se analizó un total de ${n} persona${n !== 1 ? "s" : ""}.`);
  lines.push("");
  lines.push(`La sesión arrojó una puntuación ergonómica compuesta de ${avgScore}/100, clasificada como ${nivel}.`);
  if (alto > 0) lines.push(`• ${alto} persona${alto > 1 ? "s" : ""}  presentó patrones de postura de RIESGO ALTO que requieren intervención inmediata.`);
  if (mod > 0) lines.push(`• ${mod} persona${mod > 1 ? "s" : ""}  mostró patrones de RIESGO MODERADO que ameritan seguimiento.`);
  lines.push("");
  const allIssues = rd.personsData.flatMap(p => p.issues || []);
  const cnt = {}; allIssues.forEach(i => { cnt[i.key] = (cnt[i.key] || 0) + 1; });
  const top = Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, 4);
  if (top.length) {
    lines.push("Desviaciones ergonómicas más frecuentes detectadas durante la sesión:");
    const labels = { neck: "Postura adelantada de cabeza/cuello", spine: "Flexión torácica / espalda encorvada", sym: "Asimetría de hombros", head: "Posición vertical anormal de la cabeza", sed: "Tiempo sedentario prolongado", tilt: "Inclinación lateral de la cabeza" };
    top.forEach(([k, c]) => { lines.push(`• ${labels[k] || k} — detectado en ${c} de ${n} persona${n !== 1 ? "s" : ""}`); });
  }
  return lines;
}

function genRecomendacionesES(rd, avgScore) {
  const recs = [];
  const all = rd.personsData.flatMap(p => p.issues || []);
  const has = k => all.some(i => i.key === k);
  const hasH = k => all.some(i => i.key === k && i.sev === "high");

  const ws = { categoria: "CONFIGURACIÓN DEL PUESTO DE TRABAJO", items: [] };
  ws.items.push("Posicionar el monitor a la distancia de un brazo (50–70 cm) con la parte superior de la pantalla al nivel de los ojos o ligeramente por debajo.");
  ws.items.push("Utilizar silla ajustable con soporte lumbar. Ajustar la altura del asiento para que los muslos queden paralelos al suelo y los pies descansen planos.");
  if (has("neck") || has("head")) ws.items.push("Elevar el monitor 5–10 cm si se detectó postura de cuello adelantado. Usar soporte de monitor o elevador de laptop.");
  if (has("spine")) ws.items.push("Asegurar que el respaldo de la silla soporte la curva lumbar natural. Considerar un cojín lumbar si no hay soporte integrado.");
  if (has("sym") || has("tilt")) ws.items.push("Revisar la ubicación del teclado y ratón — la posición descentrada genera asimetría crónica de hombros y cuello.");
  recs.push(ws);

  const pc = { categoria: "PROTOCOLO DE CORRECCIÓN POSTURAL", items: [] };
  if (hasH("neck")) pc.items.push("URGENTE: Reeducar la posición neutral de la cabeza. El oído debe alinearse verticalmente sobre el hombro. Usar recordatorio de postura o señal física (marca en el monitor).");
  else if (has("neck")) pc.items.push("Practicar retracciones de mentón: tirar el mentón hacia atrás en línea recta, mantener 5s, repetir 10 veces, 3 veces/día para contrarrestar la postura de cabeza adelantada.");
  if (has("spine")) pc.items.push("Realizar estiramientos de extensión torácica cada 30 minutos: entrelazar manos detrás de la cabeza y arquearse suavemente sobre el respaldo de la silla.");
  if (has("head")) pc.items.push("Ajustar la altura del monitor o la silla. La cabeza debe mantenerse naturalmente erguida, sin forzarla hacia arriba o hacia abajo para ver la pantalla.");
  if (pc.items.length === 0) pc.items.push("Mantener los hábitos posturales actuales. Continuar con pausas de movimiento regulares.");
  recs.push(pc);

  const bs = { categoria: "PAUSAS ACTIVAS Y MOVIMIENTO", items: [] };
  bs.items.push("Aplicar la regla 20-20-20: cada 20 minutos, mirar un objeto a 6 metros de distancia durante 20 segundos.");
  bs.items.push("Levantarse y caminar al menos 2 minutos cada 30 minutos de sedentarismo continuo.");
  if (has("sed")) bs.items.push("PRIORIDAD: Implementar pausas de movimiento cada hora de forma inmediata. Considerar escritorio de pie o convertidor sit-stand.");
  bs.items.push("Programar alarmas en el teléfono o computador para verificar la postura cada 15 minutos durante las primeras 2 semanas de corrección.");
  recs.push(bs);

  const ex = { categoria: "EJERCICIOS RECOMENDADOS (Diario)", items: [] };
  ex.items.push("Estiramientos de cuello: flexión lateral y rotación, 30 s por lado, 2 veces al día.");
  ex.items.push("Apertura de pecho / estiramiento pectoral en marco de puerta, 30 s × 3 series.");
  if (has("spine") || has("neck")) ex.items.push("Movilidad espinal tipo cat-cow: 10 repeticiones × 2 series, mañana y al salir del trabajo.");
  ex.items.push("Compresión de escápulas: retraer omóplatos, mantener 5 s × 15 reps — contrarresta los hombros protruidos por el trabajo en teclado.");
  recs.push(ex);

  if (avgScore < 55 || rd.personsData.some(p => p.avgScore < 45)) {
    const cr = { categoria: "RECOMENDACIÓN DE DERIVACIÓN CLÍNICA", items: [] };
    cr.items.push("Una o más personas presentaron puntuaciones de RIESGO ALTO. Se recomienda derivación a médico ocupacional o ergónomo certificado.");
    cr.items.push("Realizar evaluación formal de riesgo musculoesquelético (métodos REBA, RULA u OWAS) por un profesional calificado.");
    cr.items.push("Considerar aplicar el Cuestionario Nórdico de síntomas musculoesqueléticos a los trabajadores afectados.");
    recs.push(cr);
  }
  return recs;
}

// ─── UI COMPONENTS ────────────────────────────────────────────────────────────
function MiniRing({ score, color, size = 44 }) {
  const r = size / 2 - 4, c = size / 2, circ = 2 * Math.PI * r, dash = (Math.max(0, score ?? 0) / 100) * circ;
  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)", flexShrink: 0 }}>
      <circle cx={c} cy={c} r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={3} />
      <circle cx={c} cy={c} r={r} fill="none" stroke={color} strokeWidth={3}
        strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
        style={{ filter: `drop-shadow(0 0 6px ${color})`, transition: "all 0.5s ease" }} />
      <text x={c} y={c} fill={color} fontSize={10} fontWeight="700" textAnchor="middle"
        dominantBaseline="middle" transform={`rotate(90 ${c} ${c})`} fontFamily="monospace">{score ?? "-"}</text>
    </svg>
  );
}

function OverallGauge({ persons }) {
  if (!persons.length) return null;
  const avg = Math.round(persons.reduce((s, p) => s + (p.risk?.score || 0), 0) / persons.length);
  const color = avg >= 75 ? T.green : avg >= 55 ? T.amber : T.red;
  const label = avg >= 92 ? "Excellent" : avg >= 75 ? "Good" : avg >= 55 ? "Moderate Risk" : "High Risk";
  const r = 36, circ = 2 * Math.PI * r, dash = (avg / 100) * circ;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
      <svg width={96} height={96} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={48} cy={48} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={6} />
        <circle cx={48} cy={48} r={r} fill="none" stroke={color} strokeWidth={6}
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
          style={{ filter: `drop-shadow(0 0 10px ${color})`, transition: "all 0.7s cubic-bezier(.34,1.56,.64,1)" }} />
        <text x={48} y={44} fill={color} fontSize={20} fontWeight="700" textAnchor="middle"
          dominantBaseline="middle" transform="rotate(90 48 48)" fontFamily="monospace">{avg}</text>
        <text x={48} y={60} fill={color + "88"} fontSize={7.5} textAnchor="middle"
          dominantBaseline="middle" transform="rotate(90 48 48)" fontFamily="monospace">AVG</text>
      </svg>
      <span style={{ fontSize: 11, color, fontWeight: 700 }}>{label}</span>
      <span style={{ fontSize: 9, color: T.textMuted }}>{persons.length} person{persons.length !== 1 ? "s" : ""}</span>
    </div>
  );
}

function PersonCard({ person, idx }) {
  const pal = PALETTE[idx % PALETTE.length];
  const r = person.risk;
  if (!r) return null;
  let ac = pal.stroke;
  if (r.level === "high") ac = T.red;
  else if (r.level === "moderate") ac = T.amber;
  return (
    <div style={{ background: pal.bg, border: `1px solid ${ac}44`, borderLeft: `3px solid ${ac}`, borderRadius: 10, padding: "10px 12px", transition: "all 0.4s ease" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <MiniRing score={r.score} color={ac} />
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: ac }}>{pal.label}</span>
            <span style={{ fontSize: 9, color: ac, background: `${ac}18`, padding: "2px 7px", borderRadius: 10 }}>{r.label}</span>
          </div>
          <div style={{ display: "flex", gap: 5, marginTop: 3, flexWrap: "wrap" }}>
            {Object.entries(r.breakdown || {}).map(([k, v]) => {
              const maxV = { neck: 30, spine: 30, head: 15, sym: 15, sed: 10 }[k] || 15;
              const ok = v / maxV >= 0.8;
              return <span key={k} style={{ fontSize: 8, color: ok ? T.textMuted : T.amber, background: "rgba(255,255,255,0.04)", padding: "1px 5px", borderRadius: 4, fontFamily: "monospace" }}>{k}:{v}</span>;
            })}
          </div>
        </div>
      </div>
      {r.issues?.map(iss => (
        <div key={iss.key} style={{ fontSize: 9, color: iss.sev === "high" ? T.red : T.amber, marginTop: 4, paddingLeft: 6, borderLeft: `2px solid ${iss.sev === "high" ? T.red : T.amber}` }}>
          ⚠ {iss.label}{iss.val ? ` (${iss.val})` : ""}
        </div>
      ))}
    </div>
  );
}

function Toasts({ toasts }) {
  return (
    <div style={{ position: "fixed", top: 16, right: 16, display: "flex", flexDirection: "column", gap: 8, zIndex: 999, pointerEvents: "none" }}>
      {toasts.map(t => (
        <div key={t.id} style={{ background: "rgba(8,8,16,0.95)", border: `1px solid ${t.color}44`, borderLeft: `3px solid ${t.color}`, borderRadius: 10, padding: "10px 14px", display: "flex", gap: 8, alignItems: "center", backdropFilter: "blur(20px)", maxWidth: 260, animation: "slideIn 0.3s ease" }}>
          <span style={{ fontSize: 14 }}>{t.icon}</span>
          <div><div style={{ fontSize: 11, fontWeight: 700, color: t.color }}>{t.title}</div><div style={{ fontSize: 9, color: T.textSecondary, marginTop: 1 }}>{t.body}</div></div>
        </div>
      ))}
    </div>
  );
}

function Tog({ label, on, onClick, color }) {
  return <button onClick={onClick} style={{ padding: "4px 9px", background: on ? `${color}20` : "rgba(255,255,255,0.03)", border: `1px solid ${on ? color + "66" : T.border}`, borderRadius: 16, color: on ? color : T.textMuted, fontSize: 9, cursor: "pointer", transition: "all 0.2s", fontFamily: "monospace" }}>{label}</button>;
}

// ─── SAMPLING CONTROLLER ─────────────────────────────────────────────────────
function SamplingPanel({ sampling, setSampling, samplingMin, setSamplingMin, elapsed, onFinish, operator, setOperator, location, setLocation, viewMode }) {
  const pct = sampling ? Math.min(100, (elapsed / 60 / samplingMin) * 100) : 0;
  const remaining = sampling ? Math.max(0, samplingMin * 60 - elapsed) : 0;
  const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  if (!sampling) {
    return (
      <div style={{ padding: 14, borderBottom: `1px solid ${T.border}` }}>
        <div style={{ fontSize: 9, color: T.textMuted, marginBottom: 8, letterSpacing: 1 }}>SESSION SETUP</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <input value={operator} onChange={e => setOperator(e.target.value)}
            placeholder="Operator name" style={inputSt} />
          <input value={location} onChange={e => setLocation(e.target.value)}
            placeholder="Location / Area" style={inputSt} />
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span style={{ fontSize: 9, color: T.textMuted, whiteSpace: "nowrap" }}>Duration (min):</span>
            <input type="number" min={1} max={60} value={samplingMin}
              onChange={e => setSamplingMin(Math.max(1, parseInt(e.target.value) || 5))}
              style={{ ...inputSt, width: 60, textAlign: "center" }} />
          </div>
          <button onClick={() => setSampling(true)} style={{ padding: "8px", background: "rgba(0,229,160,0.12)", border: `1px solid ${T.green}55`, borderRadius: 8, color: T.green, fontSize: 11, cursor: "pointer", fontFamily: "monospace", marginTop: 2 }}>
            ▶ START SAMPLING
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: "10px 14px", borderBottom: `1px solid ${T.border}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <span style={{ fontSize: 9, color: T.green, letterSpacing: 1, animation: "pulse 1.5s infinite" }}>● SAMPLING</span>
        <span style={{ fontSize: 11, fontFamily: "monospace", color: T.textPrimary }}>{fmt(remaining)}</span>
      </div>
      <div style={{ height: 4, background: "rgba(255,255,255,0.06)", borderRadius: 2, marginBottom: 6 }}>
        <div style={{ width: `${pct}%`, height: "100%", background: T.green, borderRadius: 2, boxShadow: `0 0 8px ${T.green}88`, transition: "width 1s linear" }} />
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <button onClick={onFinish} style={{ flex: 1, padding: "7px", background: "rgba(0,229,160,0.1)", border: `1px solid ${T.green}44`, borderRadius: 8, color: T.green, fontSize: 10, cursor: "pointer" }}>
          ⬛ Finish & Export PDF
        </button>
        <button onClick={() => setSampling(false)} style={{ padding: "7px 10px", background: "rgba(255,75,110,0.1)", border: `1px solid ${T.red}44`, borderRadius: 8, color: T.red, fontSize: 10, cursor: "pointer" }}>✕</button>
      </div>
    </div>
  );
}
const inputSt = { background: "rgba(255,255,255,0.04)", border: `1px solid ${T.border}`, borderRadius: 6, color: T.textPrimary, fontSize: 10, padding: "6px 8px", fontFamily: "monospace", outline: "none", width: "100%" };

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const videoRef = useRef(null);
  const containerRef = useRef(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [showTrails, setShowTrails] = useState(true);
  const [showHands, setShowHands] = useState(true);
  const [showFace, setShowFace] = useState(true);
  const [viewMode, setViewMode] = useState("frontal");
  const [cameraError, setCameraError] = useState(null);
  const [displaySize, setDisplaySize] = useState({ w: 640, h: 480 });
  const [toasts, setToasts] = useState([]);
  const lastAlertRef = useRef({});
  const [sessionStart] = useState(Date.now());
  const [tick, setTick] = useState(0);

  // Sampling
  const [sampling, setSampling] = useState(false);
  const [samplingMin, setSamplingMin] = useState(5);
  const [samplingStart, setSamplingStart] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [operator, setOperator] = useState("");
  const [location, setLocation] = useState("");

  // Use refs for sampling data to avoid stale closure issues
  const snapshotsRef = useRef([]);
  const samplingRef = useRef(false);
  const samplingStartRef = useRef(null);
  const samplingMinRef = useRef(5);
  const operatorRef = useRef("");
  const locationRef = useRef("");
  const viewModeRef = useRef("frontal");
  const personsRef = useRef([]);

  const isRunning = cameraActive;
  const { persons, handRes, faceRes, status } = useVision({ videoRef, active: cameraActive, viewMode, enableHands: showHands, enableFace: showFace });
  const highRiskCount = persons.filter(p => p.risk?.level === "high").length;

  // Keep refs in sync
  useEffect(() => { personsRef.current = persons; }, [persons]);
  useEffect(() => { samplingRef.current = sampling; }, [sampling]);
  useEffect(() => { samplingStartRef.current = samplingStart; }, [samplingStart]);
  useEffect(() => { samplingMinRef.current = samplingMin; }, [samplingMin]);
  useEffect(() => { operatorRef.current = operator; }, [operator]);
  useEffect(() => { locationRef.current = location; }, [location]);
  useEffect(() => { viewModeRef.current = viewMode; }, [viewMode]);

  // ResizeObserver
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(entries => {
      for (const e of entries) setDisplaySize({ w: e.contentRect.width, h: e.contentRect.height });
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // Tick + elapsed + snapshot collection — all via refs, no stale closures
  useEffect(() => {
    const id = setInterval(() => {
      setTick(t => t + 1);
      if (samplingRef.current && samplingStartRef.current) {
        const e = Math.floor((Date.now() - samplingStartRef.current) / 1000);
        setElapsed(e);
        // Snapshot every 3s
        if (e > 0 && e % 3 === 0 && personsRef.current.length > 0) {
          snapshotsRef.current.push({
            timestamp: Date.now(),
            personsRisk: personsRef.current.map(p => ({ risk: p.risk, posture: p.posture })),
          });
        }
        // Auto finish
        if (e >= samplingMinRef.current * 60) {
          handleFinishSampling();
        }
      }
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // Start sampling
  const handleStartSampling = () => {
    snapshotsRef.current = [];
    const now = Date.now();
    setSamplingStart(now);
    samplingStartRef.current = now;
    setElapsed(0);
    setSampling(true);
    samplingRef.current = true;
  };

  // Finish + generate PDF — reads from refs, never stale
  const handleFinishSampling = useCallback(() => {
    setSampling(false);
    samplingRef.current = false;
    const snaps = snapshotsRef.current;
    if (!snaps.length) {
      setToasts(t => [...t, { id: Date.now(), icon: "ℹ️", title: "Sin datos", body: "No se recolectaron muestras — verifique que la cámara vea personas durante la sesión", color: T.amber }]);
      return;
    }
    const maxPersons = Math.max(...snaps.map(s => s.personsRisk.length), 1);
    const personsData = Array.from({ length: maxPersons }, (_, i) => {
      const pSnaps = snaps.filter(s => s.personsRisk[i]).map(s => s.personsRisk[i]);
      const scores = pSnaps.map(s => s.risk?.score || 0).filter(Boolean);
      const avgScore = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 50;
      const allIssues = pSnaps.flatMap(s => s.risk?.issues || []);
      const seen = {};
      const uniqueIssues = allIssues.filter(iss => { if (seen[iss.key]) return false; seen[iss.key] = true; return true; });
      const bd = { neck: 0, spine: 0, head: 0, sym: 0, sed: 0 };
      pSnaps.forEach(s => { if (s.risk?.breakdown) Object.keys(bd).forEach(k => { bd[k] += (s.risk.breakdown[k] || 0) / pSnaps.length; }); });
      Object.keys(bd).forEach(k => { bd[k] = Math.round(bd[k]); });
      // Average angles for table
      const neckAngles = pSnaps.map(s => s.posture?.neck ?? s.posture?.neckForward).filter(v => v != null && !isNaN(v));
      const spineAngles = pSnaps.map(s => s.posture?.spine ?? s.posture?.kyphosis).filter(v => v != null && !isNaN(v));
      const symAngles = pSnaps.map(s => s.posture?.sym).filter(v => v != null && !isNaN(v));
      const avgAngle = (arr) => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length * 10) / 10 : null;
      const angles = { neck: avgAngle(neckAngles), spine: avgAngle(spineAngles), sym: avgAngle(symAngles) };
      return { avgScore, breakdown: bd, issues: uniqueIssues, angles };
    });

    // Capture video frame with skeleton overlay
    const vid = videoRef.current;
    const overlayCanvas = document.querySelector("canvas[style*='pointer-events: none']");
    if (vid && vid.readyState >= 2) {
      captureVideoFrame(vid, overlayCanvas).then(dataURL => {
        const toastId = Date.now();
        generatePDF({ operator: operatorRef.current, location: locationRef.current, samplingMin: samplingMinRef.current, viewMode: viewModeRef.current, personsData, totalSnapshots: snaps.length, captureDataURL: dataURL });
        setToasts(t => [...t, { id: toastId, icon: "📄", title: "Informe PDF generado", body: `${snaps.length} muestras · Guardado en descargas`, color: T.green }]);
        setTimeout(() => setToasts(t => t.filter(x => x.id !== toastId)), 6000);
      });
    } else {
      const toastId = Date.now();
      generatePDF({ operator: operatorRef.current, location: locationRef.current, samplingMin: samplingMinRef.current, viewMode: viewModeRef.current, personsData, totalSnapshots: snaps.length, captureDataURL: null });
      setToasts(t => [...t, { id: toastId, icon: "📄", title: "Informe PDF generado", body: `${snaps.length} muestras · Guardado en descargas`, color: T.green }]);
      setTimeout(() => setToasts(t => t.filter(x => x.id !== toastId)), 6000);
    }
  }, []);

  // Alerts
  useEffect(() => {
    persons.forEach((p, i) => {
      if (!p.risk || p.risk.level !== "high") return;
      const now = Date.now();
      if (now - (lastAlertRef.current[i] || 0) < 20000) return;
      lastAlertRef.current[i] = now;
      const iss = p.risk.issues[0];
      setToasts(prev => [...prev.slice(-3), { id: now + i, icon: "🔴", title: `${PALETTE[i % PALETTE.length].label}: High Risk`, body: iss?.label || "Poor posture", color: T.red }]);
      setTimeout(() => setToasts(prev => prev.filter(t => t.id !== now + i)), 6000);
    });
  }, [persons]);

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" } });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => {
          const r = videoRef.current.getBoundingClientRect();
          setDisplaySize({ w: r.width || 640, h: r.height || 480 });
        };
      }
      setCameraActive(true); setCameraError(null);
    } catch { setCameraError("Camera denied — please allow camera access"); }
  };
  const stopCamera = () => {
    videoRef.current?.srcObject?.getTracks().forEach(t => t.stop());
    setCameraActive(false); setSampling(false);
  };

  const sessSec = Math.floor((Date.now() - sessionStart) / 1000);

  return (
    <div style={{ minHeight: "100vh", background: T.bg, fontFamily: "'DM Mono','Courier New',monospace", color: T.textPrimary, overflow: "hidden" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        ::-webkit-scrollbar{width:3px;}::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.1);border-radius:2px;}
        @keyframes slideIn{from{opacity:0;transform:translateX(16px);}to{opacity:1;transform:translateX(0);}}
        @keyframes pulse{0%,100%{opacity:1;}50%{opacity:0.35;}}
        input::placeholder{color:rgba(240,244,255,0.25);}
        input:focus{border-color:rgba(0,229,160,0.4)!important;outline:none;}
      `}</style>

      {/* Header */}
      <header style={{ height: 48, borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 18px", backdropFilter: "blur(20px)", background: "rgba(4,4,10,0.92)", position: "sticky", top: 0, zIndex: 100 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 24, height: 24, borderRadius: 6, background: "linear-gradient(135deg,#7B61FF,#00E5A0)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12 }}>⚡</div>
          <span style={{ fontSize: 12, letterSpacing: 1 }}>ERGO<span style={{ color: T.green }}>.HSE</span><span style={{ color: T.textMuted, fontSize: 8, marginLeft: 6 }}>AI v4 · {viewMode.toUpperCase()}</span></span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {/* View mode toggle */}
          <div style={{ display: "flex", gap: 4, padding: "3px", background: "rgba(255,255,255,0.04)", borderRadius: 18, border: `1px solid ${T.border}` }}>
            {["frontal", "lateral"].map(m => (
              <button key={m} onClick={() => setViewMode(m)} style={{ padding: "3px 10px", borderRadius: 16, border: "none", background: viewMode === m ? "rgba(0,229,160,0.15)" : "transparent", color: viewMode === m ? T.green : T.textMuted, fontSize: 9, cursor: "pointer", fontFamily: "monospace", transition: "all 0.2s" }}>
                {m === "frontal" ? "👁 FRONTAL" : "◀ LATERAL"}
              </button>
            ))}
          </div>
          {isRunning && <span style={{ fontSize: 8, color: T.textMuted }}>{`${String(Math.floor(sessSec / 60)).padStart(2, "0")}:${String(sessSec % 60).padStart(2, "0")}`}</span>}
          {highRiskCount > 0 && <div style={{ padding: "2px 8px", background: "rgba(255,75,110,0.1)", border: `1px solid ${T.red}44`, borderRadius: 16, fontSize: 9, color: T.red, animation: "pulse 1.5s infinite" }}>⚠ {highRiskCount} HIGH</div>}
          {isRunning && <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "2px 8px", background: "rgba(0,229,160,0.07)", border: `1px solid ${T.green}33`, borderRadius: 16 }}>
            <div style={{ width: 4, height: 4, borderRadius: "50%", background: T.green, animation: "pulse 1.5s infinite" }} />
            <span style={{ fontSize: 8, color: T.green }}>LIVE · {persons.length} detected</span>
          </div>}
          {status === "loading" && <span style={{ fontSize: 8, color: T.amber, animation: "pulse 1s infinite" }}>⏳ Loading AI...</span>}
        </div>
      </header>

      {/* Main grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", height: "calc(100vh - 48px)" }}>

        {/* Camera */}
        <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10, overflow: "auto" }}>
          <div style={{
            background: T.surface, border: `1px solid ${T.border}`, borderRadius: 14, overflow: "hidden", position: "relative", aspectRatio: "16/9", maxHeight: 440,
            boxShadow: highRiskCount > 0 ? "0 0 50px rgba(255,75,110,0.2)" : persons.length > 0 ? "0 0 30px rgba(0,229,160,0.1)" : "none", transition: "box-shadow 1s ease"
          }}>

            <div ref={containerRef} style={{ position: "absolute", inset: 0 }}>
              <video ref={videoRef} autoPlay muted playsInline style={{ width: "100%", height: "100%", objectFit: "cover", display: cameraActive ? "block" : "none" }} />

              {!isRunning && (
                <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, background: "#05050d" }}>
                  <div style={{ fontSize: 32 }}>📷</div>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 11, color: T.textSecondary }}>ERGO.HSE Ergonomic AI</div>
                    <div style={{ fontSize: 9, color: T.textMuted, marginTop: 4 }}>MoveNet MultiPose · Up to 6 persons · {viewMode === "lateral" ? "Side view (recommended)" : "Front view"}</div>
                  </div>
                  {viewMode === "lateral" && <div style={{ fontSize: 9, color: T.amber, background: "rgba(255,184,48,0.08)", border: `1px solid ${T.amber}33`, borderRadius: 8, padding: "6px 12px", maxWidth: 280, textAlign: "center" }}>
                    💡 Lateral mode: Position camera 30–45° to the side for best neck & spine accuracy
                  </div>}
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={startCamera} style={btnSt(T.green)}>📷 Start Camera</button>
                  </div>
                  {cameraError && <div style={{ fontSize: 9, color: T.red, maxWidth: 240, textAlign: "center" }}>{cameraError}</div>}
                </div>
              )}

              {isRunning && <OverlayCanvas persons={persons} handRes={handRes} faceRes={faceRes} W={displaySize.w} H={displaySize.h} showTrails={showTrails} showHands={showHands} showFace={showFace} />}
            </div>

            {/* Controls */}
            {isRunning && (
              <>
                <div style={{ position: "absolute", top: 8, left: 8, zIndex: 10 }}>
                  <div style={{ padding: "2px 8px", background: "rgba(0,0,0,0.75)", borderRadius: 16, border: `1px solid ${T.border}`, fontSize: 8, backdropFilter: "blur(8px)" }}>
                    {status === "loading" ? "⏳ Loading..." : persons.length ? `✓ ${persons.length} pose${persons.length > 1 ? "s" : ""}` : "Scanning..."}
                  </div>
                </div>
                <div style={{ position: "absolute", top: 8, right: 8, display: "flex", gap: 5, zIndex: 10 }}>
                  <Tog label="Trails" on={showTrails} onClick={() => setShowTrails(s => !s)} color={T.blue} />
                  <Tog label="Hands" on={showHands} onClick={() => setShowHands(s => !s)} color={T.green} />
                  <Tog label="Face" on={showFace} onClick={() => setShowFace(s => !s)} color={T.pink} />
                  <button onClick={stopCamera} style={{ padding: "3px 8px", background: "rgba(255,75,110,0.15)", border: `1px solid ${T.red}44`, borderRadius: 16, color: T.red, fontSize: 9, cursor: "pointer" }}>✕</button>
                </div>
              </>
            )}
          </div>

          {/* Mode guidance */}
          <div style={{ display: "flex", gap: 8, padding: "8px 12px", background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, fontSize: 9, color: T.textMuted }}>
            {viewMode === "frontal"
              ? <>👁 <b style={{ color: T.textSecondary }}>FRONTAL:</b> Best for shoulder symmetry, lateral tilt, head up/down. Position camera at eye level, facing the person directly.</>
              : <>◀ <b style={{ color: T.textSecondary }}>LATERAL:</b> Best for neck forward posture and thoracic kyphosis. Camera at 30–45° side angle, subject facing screen naturally.</>
            }
          </div>

          {/* Person legend */}
          {persons.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {persons.map((_, i) => {
                const p = PALETTE[i % PALETTE.length];
                return <div key={i} style={{ display: "flex", alignItems: "center", gap: 4, padding: "3px 9px", background: p.bg, border: `1px solid ${p.stroke}33`, borderRadius: 16 }}>
                  <div style={{ width: 5, height: 5, borderRadius: "50%", background: p.stroke, boxShadow: `0 0 5px ${p.glow}` }} />
                  <span style={{ fontSize: 9, color: p.stroke }}>{p.label}</span>
                </div>;
              })}
              {showHands && <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "3px 9px", background: "rgba(0,229,160,0.06)", border: `1px solid ${T.green}33`, borderRadius: 16 }}>
                <div style={{ width: 5, height: 5, borderRadius: "50%", background: T.green }} />
                <span style={{ fontSize: 9, color: T.green }}>Hands</span>
              </div>}
              {showFace && <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "3px 9px", background: "rgba(255,107,186,0.06)", border: `1px solid ${T.pink}33`, borderRadius: 16 }}>
                <div style={{ width: 5, height: 5, borderRadius: "50%", background: T.pink }} />
                <span style={{ fontSize: 9, color: T.pink }}>Face Mesh</span>
              </div>}
            </div>
          )}
        </div>

        {/* Right panel */}
        <div style={{ borderLeft: `1px solid ${T.border}`, display: "flex", flexDirection: "column", overflow: "hidden", background: "rgba(4,4,10,0.7)" }}>

          {/* Overall score */}
          <div style={{ padding: 14, borderBottom: `1px solid ${T.border}`, display: "flex", justifyContent: "center" }}>
            {persons.length > 0
              ? <OverallGauge persons={persons} />
              : <div style={{ color: T.textMuted, fontSize: 10, textAlign: "center", padding: "12px 0" }}>{isRunning ? "Detecting..." : "Start camera"}</div>}
          </div>

          {/* Sampling panel */}
          <SamplingPanel
            sampling={sampling} setSampling={handleStartSampling}
            samplingMin={samplingMin} setSamplingMin={setSamplingMin}
            elapsed={elapsed} onFinish={handleFinishSampling}
            operator={operator} setOperator={setOperator}
            location={location} setLocation={setLocation}
            viewMode={viewMode}
          />

          {/* HSE thresholds */}
          <div style={{ padding: "8px 14px", borderBottom: `1px solid ${T.border}` }}>
            <div style={{ fontSize: 8, color: T.textMuted, marginBottom: 6, letterSpacing: 1 }}>HSE THRESHOLDS</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 3 }}>
              {[["92–100", "Excellent", T.green], ["75–91", "Good", T.green], ["55–74", "Moderate", T.amber], ["<55", "High Risk", T.red]].map(([r, l, c]) => (
                <div key={r} style={{ fontSize: 8, display: "flex", justifyContent: "space-between", padding: "3px 7px", background: `${c}08`, border: `1px solid ${c}22`, borderRadius: 5 }}>
                  <span style={{ color: c, fontFamily: "monospace" }}>{r}</span><span style={{ color: c + "99" }}>{l}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Individual analysis */}
          <div style={{ flex: 1, overflow: "auto", padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontSize: 8, color: T.textMuted, letterSpacing: 1 }}>INDIVIDUAL ANALYSIS</div>
            {!isRunning && <div style={{ color: T.textMuted, fontSize: 10, textAlign: "center", padding: "16px 0" }}>No active session</div>}
            {isRunning && !persons.length && <div style={{ color: T.textMuted, fontSize: 10, textAlign: "center", padding: "16px 0" }}><div style={{ fontSize: 18, marginBottom: 6 }}>👁</div>Scanning...</div>}
            {persons.map((p, i) => <PersonCard key={i} person={p} idx={i} />)}
          </div>

          <div style={{ padding: "6px 14px", borderTop: `1px solid ${T.border}`, display: "flex", justifyContent: "space-between" }}>
            <span style={{ fontSize: 7, color: T.textMuted }}>MoveNet MultiPose · ISO 11226 · EN 1005-4</span>
            <span style={{ fontSize: 7, color: T.textMuted }}>v4.0</span>
          </div>
        </div>
      </div>
      <Toasts toasts={toasts} />
    </div>
  );
}

function btnSt(color) { return { padding: "8px 16px", background: `${color}12`, border: `1px solid ${color}55`, borderRadius: 8, color, fontSize: 10, cursor: "pointer", fontFamily: "monospace" }; }