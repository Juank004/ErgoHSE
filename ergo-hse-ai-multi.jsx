import { useState, useEffect, useRef, useCallback } from "react";

// ─── THEME ────────────────────────────────────────────────────────────────────
const T = {
  bg: "#04040A",
  surface: "rgba(255,255,255,0.04)",
  border: "rgba(255,255,255,0.08)",
  textPrimary: "#F0F4FF",
  textSecondary: "rgba(240,244,255,0.5)",
  textMuted: "rgba(240,244,255,0.25)",
  green: "#00E5A0",  amber: "#FFB830",  red: "#FF4B6E",
  blue: "#4B9EFF",  accent: "#7B61FF",
};

// Unique color palette per person (hue-distinct, vivid)
const PERSON_PALETTE = [
  { stroke: "#00E5A0", glow: "rgba(0,229,160,0.5)",   label: "P1", bg: "rgba(0,229,160,0.08)" },
  { stroke: "#4B9EFF", glow: "rgba(75,158,255,0.5)",  label: "P2", bg: "rgba(75,158,255,0.08)" },
  { stroke: "#FF6BBA", glow: "rgba(255,107,186,0.5)", label: "P3", bg: "rgba(255,107,186,0.08)" },
  { stroke: "#FFB830", glow: "rgba(255,184,48,0.5)",  label: "P4", bg: "rgba(255,184,48,0.08)" },
  { stroke: "#A78BFA", glow: "rgba(167,139,250,0.5)", label: "P5", bg: "rgba(167,139,250,0.08)" },
  { stroke: "#FB923C", glow: "rgba(251,146,60,0.5)",  label: "P6", bg: "rgba(251,146,60,0.08)" },
];

// Risk overlay colors (override palette stroke when risk is high)
function riskColor(level) {
  if (level === "excellent" || level === "good") return null; // use palette color
  if (level === "moderate") return { stroke: "#FFB830", glow: "rgba(255,184,48,0.55)" };
  return { stroke: "#FF4B6E", glow: "rgba(255,75,110,0.55)" };
}

// ─── MOVENET KEYPOINT INDICES ─────────────────────────────────────────────────
// 0:nose 1:left_eye 2:right_eye 3:left_ear 4:right_ear
// 5:left_shoulder 6:right_shoulder 7:left_elbow 8:right_elbow
// 9:left_wrist 10:right_wrist 11:left_hip 12:right_hip
// 13:left_knee 14:right_knee 15:left_ankle 16:right_ankle
const KP = { nose:0, lEye:1, rEye:2, lEar:3, rEar:4, lShoulder:5, rShoulder:6, lElbow:7, rElbow:8, lWrist:9, rWrist:10, lHip:11, rHip:12, lKnee:13, rKnee:14, lAnkle:15, rAnkle:16 };

const CONNECTIONS = [
  [KP.nose, KP.lEye],[KP.nose, KP.rEye],[KP.lEye, KP.lEar],[KP.rEye, KP.rEar],
  [KP.lShoulder, KP.rShoulder],
  [KP.lShoulder, KP.lElbow],[KP.lElbow, KP.lWrist],
  [KP.rShoulder, KP.rElbow],[KP.rElbow, KP.rWrist],
  [KP.lShoulder, KP.lHip],[KP.rShoulder, KP.rHip],
  [KP.lHip, KP.rHip],
  [KP.lHip, KP.lKnee],[KP.lKnee, KP.lAnkle],
  [KP.rHip, KP.rKnee],[KP.rKnee, KP.rAnkle],
];

// ─── ANGLE ENGINE ─────────────────────────────────────────────────────────────
const angleEngine = {
  angleBetween(v1, v2) {
    const dot = v1.x*v2.x + v1.y*v2.y;
    const m = Math.sqrt(v1.x**2+v1.y**2) * Math.sqrt(v2.x**2+v2.y**2);
    if (!m) return 0;
    return Math.acos(Math.max(-1, Math.min(1, dot/m))) * 180 / Math.PI;
  },
  neckAngle(nose, lS, rS) {
    if (!nose||!lS||!rS) return null;
    const mid = { x:(lS.x+rS.x)/2, y:(lS.y+rS.y)/2 };
    return this.angleBetween({ x:nose.x-mid.x, y:nose.y-mid.y }, { x:0, y:-1 });
  },
  spineAngle(lS, rS, lH, rH) {
    if (!lS||!rS||!lH||!rH) return null;
    const midS = { x:(lS.x+rS.x)/2, y:(lS.y+rS.y)/2 };
    const midH = { x:(lH.x+rH.x)/2, y:(lH.y+rH.y)/2 };
    return this.angleBetween({ x:midS.x-midH.x, y:midS.y-midH.y }, { x:0, y:-1 });
  },
  shoulderDelta(lS, rS) {
    if (!lS||!rS) return null;
    const spanX = Math.abs(lS.x - rS.x);
    return spanX ? (Math.abs(lS.y-rS.y)/spanX)*100 : 0;
  },
};

// ─── POSTURE + RISK ENGINE ────────────────────────────────────────────────────
function analyzePersonKPs(kps) {
  // kps: array of {x,y,score} (normalized 0-1)
  const get = (i) => (kps[i]?.score > 0.3 ? kps[i] : null);
  const nose=get(KP.nose), lS=get(KP.lShoulder), rS=get(KP.rShoulder);
  const lH=get(KP.lHip), rH=get(KP.rHip);

  const neck = angleEngine.neckAngle(nose, lS, rS);
  const spine = angleEngine.spineAngle(lS, rS, lH, rH);
  const sym = angleEngine.shoulderDelta(lS, rS);

  // Scores
  const neckScore = neck===null?25: neck<10?30: neck<18?24: neck<28?15:5;
  const spineScore = spine===null?25: spine<8?30: spine<15?24: spine<25?15:5;
  const symScore = sym===null?12: sym<4?15: sym<8?11: sym<14?6:2;
  const total = neckScore + spineScore + symScore + 8 + 12; // screen+sed defaults

  let level,label,color,glow;
  if(total>=92){level="excellent";label="Excellent";color=T.green;glow="rgba(0,229,160,0.35)";}
  else if(total>=75){level="good";label="Good";color=T.green;glow="rgba(0,229,160,0.25)";}
  else if(total>=55){level="moderate";label="Moderate Risk";color=T.amber;glow="rgba(255,184,48,0.35)";}
  else{level="high";label="High Risk";color=T.red;glow="rgba(255,75,110,0.35)";}

  const issues=[];
  if(neck!==null&&neck>=18) issues.push({ key:"neck", label:"Forward neck", angle:neck, sev:neck>=28?"high":"moderate" });
  if(spine!==null&&spine>=15) issues.push({ key:"spine", label:"Curved back", angle:spine, sev:spine>=25?"high":"moderate" });
  if(sym!==null&&sym>=4) issues.push({ key:"sym", label:`Shoulder tilt ${sym.toFixed(1)}%`, sev:sym>=8?"high":"moderate" });

  return { score:Math.round(total), level, label, color, glow, neck, spine, sym, issues };
}

// ─── MULTI-SKELETON CANVAS ────────────────────────────────────────────────────
function MultiSkeletonCanvas({ persons, width, height, showTrails }) {
  const canvasRef = useRef(null);
  const trailsRef = useRef([]); // [{personId, points:[{x,y,t}]}]

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, width, height);
    if (!persons || !persons.length) return;

    const now = Date.now();

    persons.forEach((person, idx) => {
      const palette = PERSON_PALETTE[idx % PERSON_PALETTE.length];
      const risk = person.risk;
      const rc = risk ? riskColor(risk.level) : null;
      const stroke = rc?.stroke || palette.stroke;
      const glow = rc?.glow || palette.glow;
      const kps = person.keypoints;
      const toP = (kp) => ({ x: kp.x * width, y: kp.y * height });

      // Trail effect for nose landmark
      if (showTrails) {
        const noseKP = kps[KP.nose];
        if (noseKP?.score > 0.3) {
          if (!trailsRef.current[idx]) trailsRef.current[idx] = [];
          trailsRef.current[idx].push({ x: noseKP.x * width, y: noseKP.y * height, t: now });
          trailsRef.current[idx] = trailsRef.current[idx].filter(p => now - p.t < 800);
          const trail = trailsRef.current[idx];
          if (trail.length > 1) {
            for (let i = 1; i < trail.length; i++) {
              const alpha = (i / trail.length) * 0.4;
              ctx.beginPath();
              ctx.moveTo(trail[i-1].x, trail[i-1].y);
              ctx.lineTo(trail[i].x, trail[i].y);
              ctx.strokeStyle = stroke + Math.round(alpha*255).toString(16).padStart(2,"0");
              ctx.lineWidth = 2;
              ctx.shadowColor = glow;
              ctx.shadowBlur = 8;
              ctx.stroke();
            }
          }
        }
      }

      // Connections
      ctx.shadowColor = glow;
      ctx.shadowBlur = 20;
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 2.5;
      ctx.lineCap = "round";

      CONNECTIONS.forEach(([i,j]) => {
        const a = kps[i], b = kps[j];
        if (!a || !b || a.score < 0.3 || b.score < 0.3) return;
        const pa = toP(a), pb = toP(b);
        ctx.beginPath();
        ctx.moveTo(pa.x, pa.y);
        ctx.lineTo(pb.x, pb.y);
        ctx.stroke();
      });

      // Joints
      kps.forEach((kp, ki) => {
        if (!kp || kp.score < 0.3) return;
        const p = toP(kp);
        const r = ki === KP.nose ? 7 : [KP.lShoulder,KP.rShoulder,KP.lHip,KP.rHip].includes(ki) ? 5 : 3.5;
        ctx.shadowBlur = 28;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI*2);
        ctx.fillStyle = stroke;
        ctx.fill();
      });

      // Person label badge
      const lS = kps[KP.lShoulder], rS = kps[KP.rShoulder];
      if (lS?.score > 0.3 && rS?.score > 0.3) {
        const cx = ((lS.x+rS.x)/2)*width;
        const cy = ((lS.y+rS.y)/2)*height - 28;
        ctx.shadowBlur = 0;
        ctx.fillStyle = stroke + "22";
        roundRect(ctx, cx-22, cy-12, 44, 22, 11);
        ctx.fill();
        ctx.strokeStyle = stroke + "88";
        ctx.lineWidth = 1;
        roundRect(ctx, cx-22, cy-12, 44, 22, 11);
        ctx.stroke();
        ctx.fillStyle = stroke;
        ctx.font = "bold 11px DM Mono, monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(`${palette.label} ${risk?.score ?? "--"}`, cx, cy);
      }

      ctx.shadowBlur = 0;
    });
  }, [persons, width, height, showTrails]);

  return (
    <canvas ref={canvasRef} width={width} height={height}
      style={{ position:"absolute", top:0, left:0, pointerEvents:"none" }} />
  );
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x+r, y);
  ctx.lineTo(x+w-r, y);
  ctx.quadraticCurveTo(x+w, y, x+w, y+r);
  ctx.lineTo(x+w, y+h-r);
  ctx.quadraticCurveTo(x+w, y+h, x+w-r, y+h);
  ctx.lineTo(x+r, y+h);
  ctx.quadraticCurveTo(x, y+h, x, y+h-r);
  ctx.lineTo(x, y+r);
  ctx.quadraticCurveTo(x, y, x+r, y);
  ctx.closePath();
}

// ─── MOVENET HOOK ─────────────────────────────────────────────────────────────
function useMoveNet({ videoRef, active }) {
  const [persons, setPersons] = useState([]);
  const [status, setStatus] = useState("idle");
  const detectorRef = useRef(null);
  const rafRef = useRef(null);

  useEffect(() => {
    if (!active) return;

    const load = async () => {
      setStatus("loading");
      try {
        // Load TF.js + MoveNet from CDN
        if (!window.tf) {
          await loadScript("https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.17.0/dist/tf.min.js");
        }
        if (!window.poseDetection) {
          await loadScript("https://cdn.jsdelivr.net/npm/@tensorflow-models/pose-detection@2.1.3/dist/pose-detection.min.js");
        }
        await window.tf.ready();

        const detector = await window.poseDetection.createDetector(
          window.poseDetection.SupportedModels.MoveNet,
          {
            modelType: window.poseDetection.movenet.modelType.MULTIPOSE_LIGHTNING,
            enableSmoothing: true,
            minPoseScore: 0.25,
          }
        );
        detectorRef.current = detector;
        setStatus("ready");
      } catch (e) {
        console.error("MoveNet load error", e);
        setStatus("error");
      }
    };

    load();
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [active]);

  useEffect(() => {
    if (status !== "ready" || !detectorRef.current || !videoRef.current) return;

    const detect = async () => {
      if (videoRef.current?.readyState >= 2) {
        try {
          const poses = await detectorRef.current.estimatePoses(videoRef.current, { maxPoses: 6, flipHorizontal: false });
          const enriched = poses.map(p => ({
            ...p,
            risk: analyzePersonKPs(p.keypoints),
          }));
          setPersons(enriched);
        } catch {}
      }
      rafRef.current = requestAnimationFrame(detect);
    };
    rafRef.current = requestAnimationFrame(detect);
    return () => cancelAnimationFrame(rafRef.current);
  }, [status, videoRef]);

  return { persons, status };
}

function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = src; s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
}

// ─── DEMO SIMULATION ──────────────────────────────────────────────────────────
function simPersons(t, count) {
  return Array.from({ length: count }, (_, i) => {
    const ox = 0.15 + i * (0.7 / Math.max(count-1,1)); // spread horizontally
    const wave = Math.sin(t * 0.2 + i * 1.2) * 0.015;
    const neckFwd = Math.sin(t * 0.1 + i) * 0.04;
    const kps = [
      { x: ox+neckFwd, y: 0.20+wave, score: 0.95 },       // nose
      { x: ox-0.012, y: 0.185+wave, score: 0.9 },          // lEye
      { x: ox+0.012, y: 0.185+wave, score: 0.9 },          // rEye
      { x: ox-0.025, y: 0.195+wave, score: 0.9 },          // lEar
      { x: ox+0.025, y: 0.195+wave, score: 0.9 },          // rEar
      { x: ox-0.07, y: 0.36+wave*0.5, score: 0.95 },      // lShoulder
      { x: ox+0.07, y: 0.38+wave*0.3, score: 0.95 },      // rShoulder
      { x: ox-0.10, y: 0.52, score: 0.9 },                 // lElbow
      { x: ox+0.10, y: 0.54, score: 0.9 },                 // rElbow
      { x: ox-0.11, y: 0.67, score: 0.85 },                // lWrist
      { x: ox+0.11, y: 0.69, score: 0.85 },                // rWrist
      { x: ox-0.05, y: 0.64, score: 0.95 },                // lHip
      { x: ox+0.05, y: 0.65, score: 0.95 },                // rHip
      { x: ox-0.05, y: 0.80, score: 0.8 },                 // lKnee
      { x: ox+0.05, y: 0.81, score: 0.8 },                 // rKnee
      { x: ox-0.05, y: 0.94, score: 0.7 },                 // lAnkle
      { x: ox+0.05, y: 0.95, score: 0.7 },                 // rAnkle
    ];
    return { keypoints: kps, risk: analyzePersonKPs(kps), id: i };
  });
}

// ─── MINI SCORE RING ──────────────────────────────────────────────────────────
function MiniRing({ score, color, size = 48 }) {
  const r = size/2 - 4, c = size/2;
  const circ = 2*Math.PI*r;
  const dash = (Math.max(0,score)/100)*circ;
  return (
    <svg width={size} height={size} style={{ transform:"rotate(-90deg)", flexShrink:0 }}>
      <circle cx={c} cy={c} r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={3.5}/>
      <circle cx={c} cy={c} r={r} fill="none" stroke={color} strokeWidth={3.5}
        strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
        style={{ filter:`drop-shadow(0 0 6px ${color})`, transition:"all 0.5s ease" }}/>
      <text x={c} y={c} fill={color} fontSize={11} fontWeight="700"
        textAnchor="middle" dominantBaseline="middle"
        transform={`rotate(90 ${c} ${c})`} fontFamily="monospace">{score}</text>
    </svg>
  );
}

// ─── PERSON CARD ──────────────────────────────────────────────────────────────
function PersonCard({ person, idx, palette }) {
  const r = person.risk;
  if (!r) return null;
  const rc = riskColor(r.level);
  const activeColor = rc?.stroke || palette.stroke;

  return (
    <div style={{
      background: palette.bg,
      border: `1px solid ${activeColor}44`,
      borderLeft: `3px solid ${activeColor}`,
      borderRadius: 12, padding: "12px 14px",
      boxShadow: `0 0 20px ${palette.glow}22`,
      transition: "all 0.4s ease",
    }}>
      <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom: r.issues.length ? 10 : 0 }}>
        <MiniRing score={r.score} color={activeColor} />
        <div style={{ flex:1 }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
            <span style={{ fontSize:13, fontWeight:700, color:activeColor }}>{palette.label}</span>
            <span style={{ fontSize:10, color:activeColor, background:`${activeColor}18`, padding:"2px 8px", borderRadius:10 }}>{r.label}</span>
          </div>
          <div style={{ display:"flex", gap:8, marginTop:4 }}>
            {r.neck!==null && <Chip label="Neck" val={`${r.neck.toFixed(0)}°`} ok={r.neck<18}/>}
            {r.spine!==null && <Chip label="Back" val={`${r.spine.toFixed(0)}°`} ok={r.spine<15}/>}
            {r.sym!==null && <Chip label="Sym" val={`${r.sym.toFixed(1)}%`} ok={r.sym<4}/>}
          </div>
        </div>
      </div>

      {r.issues.map(iss => (
        <div key={iss.key} style={{ fontSize:10, color: iss.sev==="high"?T.red:T.amber, marginTop:4, paddingLeft:4, borderLeft:`2px solid ${iss.sev==="high"?T.red:T.amber}` }}>
          ⚠ {iss.label} {iss.angle!==undefined?`(${iss.angle.toFixed(0)}°)`:""}
        </div>
      ))}
    </div>
  );
}

function Chip({ label, val, ok }) {
  return (
    <span style={{ fontSize:9, color: ok?T.textMuted:T.amber, background:"rgba(255,255,255,0.05)", padding:"2px 6px", borderRadius:6 }}>
      {label}: {val}
    </span>
  );
}

// ─── NOTIFICATION TOAST ───────────────────────────────────────────────────────
function Toasts({ toasts }) {
  return (
    <div style={{ position:"fixed", top:16, right:16, display:"flex", flexDirection:"column", gap:8, zIndex:999 }}>
      {toasts.map(t => (
        <div key={t.id} style={{
          background:"rgba(8,8,16,0.95)", border:`1px solid ${t.color}44`,
          borderLeft:`3px solid ${t.color}`, borderRadius:10, padding:"10px 14px",
          display:"flex", gap:10, alignItems:"center",
          backdropFilter:"blur(20px)", maxWidth:280,
          boxShadow:`0 8px 32px rgba(0,0,0,0.7), 0 0 20px ${t.color}22`,
          animation:"slideIn 0.3s cubic-bezier(.34,1.56,.64,1)",
        }}>
          <span style={{fontSize:16}}>{t.icon}</span>
          <div>
            <div style={{fontSize:12,fontWeight:700,color:t.color}}>{t.title}</div>
            <div style={{fontSize:10,color:T.textSecondary,marginTop:2}}>{t.body}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── OVERALL SCORE ────────────────────────────────────────────────────────────
function OverallGauge({ persons }) {
  if (!persons.length) return null;
  const avg = Math.round(persons.reduce((s,p)=>s+(p.risk?.score||0),0)/persons.length);
  let color=T.green, label="Excellent";
  if(avg<55){color=T.red;label="High Risk";}
  else if(avg<75){color=T.amber;label="Moderate";}
  else if(avg<92){color=T.green;label="Good";}

  const r=38, circ=2*Math.PI*r;
  const dash=(avg/100)*circ;
  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:4 }}>
      <svg width={100} height={100} style={{transform:"rotate(-90deg)"}}>
        <circle cx={50} cy={50} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={7}/>
        <circle cx={50} cy={50} r={r} fill="none" stroke={color} strokeWidth={7}
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
          style={{filter:`drop-shadow(0 0 10px ${color})`,transition:"all 0.7s cubic-bezier(.34,1.56,.64,1)"}}/>
        <text x={50} y={50} fill={color} fontSize={22} fontWeight="700"
          textAnchor="middle" dominantBaseline="middle"
          transform="rotate(90 50 50)" fontFamily="monospace">{avg}</text>
        <text x={50} y={64} fill={color+"99"} fontSize={8}
          textAnchor="middle" dominantBaseline="middle"
          transform="rotate(90 50 50)" fontFamily="monospace">AVG</text>
      </svg>
      <span style={{fontSize:11,color,fontWeight:700}}>{label}</span>
      <span style={{fontSize:9,color:T.textMuted}}>{persons.length} person{persons.length!==1?"s":""} tracked</span>
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const videoRef = useRef(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [demoMode, setDemoMode] = useState(false);
  const [demoCount, setDemoCount] = useState(3);
  const [showTrails, setShowTrails] = useState(true);
  const [cameraError, setCameraError] = useState(null);
  const [videoSize, setVideoSize] = useState({ w:640, h:480 });
  const [toasts, setToasts] = useState([]);
  const lastAlertRef = useRef({});
  const simRef = useRef(null);
  const simT = useRef(0);
  const [simPersonsList, setSimPersonsList] = useState([]);
  const [sessionStart] = useState(Date.now());
  const [tick, setTick] = useState(0);

  const { persons: realPersons, status: moveStatus } = useMoveNet({ videoRef, active: cameraActive });
  const persons = demoMode ? simPersonsList : realPersons;
  const isRunning = cameraActive || demoMode;

  // Demo loop
  useEffect(() => {
    if (!demoMode) { cancelAnimationFrame(simRef.current); return; }
    const loop = () => {
      simT.current += 0.016;
      setSimPersonsList(simPersons(simT.current, demoCount));
      simRef.current = requestAnimationFrame(loop);
    };
    simRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(simRef.current);
  }, [demoMode, demoCount]);

  // Tick
  useEffect(() => { const id = setInterval(()=>setTick(t=>t+1),1000); return ()=>clearInterval(id); },[]);

  // Alert on high risk persons
  useEffect(() => {
    persons.forEach((p, i) => {
      if (!p.risk || p.risk.level !== "high") return;
      const now = Date.now();
      if (now - (lastAlertRef.current[i]||0) < 20000) return;
      lastAlertRef.current[i] = now;
      const palette = PERSON_PALETTE[i % PERSON_PALETTE.length];
      const iss = p.risk.issues[0];
      const toast = { id: now+i, icon:"🔴", title:`${palette.label}: High Risk`, body: iss?.label || "Poor posture detected", color: T.red };
      setToasts(prev => [...prev.slice(-3), toast]);
      setTimeout(()=>setToasts(prev=>prev.filter(t=>t.id!==now+i)), 6000);
    });
  }, [persons]);

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video:{ width:1280, height:720 } });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => {
          setVideoSize({ w: videoRef.current.videoWidth||1280, h: videoRef.current.videoHeight||720 });
        };
      }
      setCameraActive(true); setDemoMode(false); setCameraError(null);
    } catch {
      setCameraError("Camera denied — try Demo Mode");
    }
  };

  const stopAll = () => {
    videoRef.current?.srcObject?.getTracks().forEach(t=>t.stop());
    setCameraActive(false); setDemoMode(false);
  };

  const sessionSec = Math.floor((Date.now()-sessionStart)/1000);
  const highRiskCount = persons.filter(p=>p.risk?.level==="high").length;

  return (
    <div style={{ minHeight:"100vh", background:T.bg, fontFamily:"'DM Mono','Courier New',monospace", color:T.textPrimary, overflow:"hidden" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        ::-webkit-scrollbar{width:3px;}
        ::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.1);border-radius:2px;}
        @keyframes slideIn{from{opacity:0;transform:translateX(20px);}to{opacity:1;transform:translateX(0);}}
        @keyframes pulse{0%,100%{opacity:1;}50%{opacity:0.4;}}
        @keyframes spin{from{transform:rotate(0deg);}to{transform:rotate(360deg);}}
      `}</style>

      {/* ── Header ── */}
      <header style={{ height:50, borderBottom:`1px solid ${T.border}`, display:"flex", alignItems:"center", justifyContent:"space-between", padding:"0 20px", backdropFilter:"blur(20px)", background:"rgba(4,4,10,0.85)", position:"sticky", top:0, zIndex:100 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <div style={{ width:26, height:26, borderRadius:7, background:"linear-gradient(135deg,#7B61FF,#00E5A0)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:13 }}>⚡</div>
          <span style={{ fontSize:13, letterSpacing:1 }}>ERGO<span style={{color:T.green}}>.HSE</span> <span style={{color:T.textMuted,fontSize:9}}>MULTI-POSE v2</span></span>
        </div>

        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          {isRunning && <span style={{ fontSize:9, color:T.textMuted }}>{`${String(Math.floor(sessionSec/60)).padStart(2,"0")}:${String(sessionSec%60).padStart(2,"0")}`}</span>}
          {highRiskCount>0 && (
            <div style={{ padding:"3px 10px", background:"rgba(255,75,110,0.12)", border:`1px solid ${T.red}44`, borderRadius:20, fontSize:10, color:T.red, animation:"pulse 1.5s infinite" }}>
              ⚠ {highRiskCount} HIGH RISK
            </div>
          )}
          {isRunning && (
            <div style={{ display:"flex", alignItems:"center", gap:5, padding:"3px 10px", background:"rgba(0,229,160,0.08)", border:`1px solid ${T.green}33`, borderRadius:20 }}>
              <div style={{ width:5, height:5, borderRadius:"50%", background:T.green, animation:"pulse 1.5s infinite" }}/>
              <span style={{ fontSize:9, color:T.green }}>LIVE · {persons.length} detected</span>
            </div>
          )}
        </div>
      </header>

      {/* ── Main Grid ── */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 320px", height:"calc(100vh - 50px)" }}>

        {/* Camera Area */}
        <div style={{ padding:16, display:"flex", flexDirection:"column", gap:12, overflow:"auto" }}>

          {/* Video Card */}
          <div style={{
            background:T.surface, border:`1px solid ${T.border}`, borderRadius:16,
            position:"relative", overflow:"hidden", aspectRatio:"16/9", maxHeight:460,
            boxShadow: highRiskCount>0 ? `0 0 50px rgba(255,75,110,0.2)` : persons.length>0 ? `0 0 40px rgba(0,229,160,0.12)` : "none",
            transition:"box-shadow 1s ease",
          }}>
            <video ref={videoRef} autoPlay muted playsInline
              style={{ width:"100%", height:"100%", objectFit:"cover", display:cameraActive?"block":"none" }}/>

            {demoMode && (
              <div style={{ width:"100%", height:"100%", background:"linear-gradient(160deg,#06060f,#0b0b18)", display:"flex", alignItems:"center", justifyContent:"center", flexDirection:"column", gap:8 }}>
                <div style={{ display:"flex", gap:20 }}>
                  {Array.from({length:demoCount},(_,i)=>(
                    <div key={i} style={{ textAlign:"center" }}>
                      <div style={{ fontSize:28, color:PERSON_PALETTE[i].stroke }}>🧍</div>
                      <div style={{ fontSize:9, color:PERSON_PALETTE[i].stroke }}>{PERSON_PALETTE[i].label}</div>
                    </div>
                  ))}
                </div>
                <div style={{ fontSize:10, color:T.textMuted }}>SIMULATION · {demoCount} persons</div>
              </div>
            )}

            {!isRunning && (
              <div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:14, background:"#06060f" }}>
                <div style={{ fontSize:32 }}>📷</div>
                <div style={{ fontSize:11, color:T.textSecondary, textAlign:"center", maxWidth:260 }}>
                  Position camera to see full room<br/>
                  <span style={{color:T.textMuted,fontSize:10}}>Up to 6 people tracked simultaneously</span>
                </div>
                <div style={{ display:"flex", gap:8 }}>
                  <button onClick={startCamera} style={btn(T.green)}>📷 Camera</button>
                  <button onClick={()=>setDemoMode(true)} style={btn(T.accent)}>⚡ Demo</button>
                </div>
                {cameraError && <div style={{fontSize:10,color:T.red,maxWidth:240,textAlign:"center"}}>{cameraError}</div>}
              </div>
            )}

            {isRunning && (
              <MultiSkeletonCanvas persons={persons} width={videoSize.w} height={videoSize.h} showTrails={showTrails} />
            )}

            {/* Controls overlay */}
            {isRunning && (
              <>
                <div style={{ position:"absolute", top:10, left:10, display:"flex", gap:6 }}>
                  <div style={{ padding:"3px 10px", background:"rgba(0,0,0,0.75)", borderRadius:20, border:`1px solid ${T.border}`, fontSize:9, backdropFilter:"blur(10px)" }}>
                    {moveStatus==="loading"?"⏳ Loading MoveNet...":persons.length?`✓ ${persons.length} pose${persons.length>1?"s":""}`:"Scanning..."}
                  </div>
                </div>
                <div style={{ position:"absolute", top:10, right:10, display:"flex", gap:6 }}>
                  <button onClick={()=>setShowTrails(s=>!s)} style={{ padding:"3px 10px", background:showTrails?"rgba(75,158,255,0.2)":"rgba(0,0,0,0.7)", border:`1px solid ${showTrails?T.blue+"66":T.border}`, borderRadius:20, color:showTrails?T.blue:T.textMuted, fontSize:9, cursor:"pointer" }}>
                    Trails {showTrails?"ON":"OFF"}
                  </button>
                  <button onClick={stopAll} style={{ padding:"3px 10px", background:"rgba(255,75,110,0.15)", border:`1px solid ${T.red}44`, borderRadius:20, color:T.red, fontSize:9, cursor:"pointer" }}>✕</button>
                </div>
              </>
            )}
          </div>

          {/* Demo person count control */}
          {demoMode && (
            <div style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 14px", background:T.surface, border:`1px solid ${T.border}`, borderRadius:10 }}>
              <span style={{ fontSize:10, color:T.textMuted }}>DEMO PERSONS:</span>
              {[1,2,3,4,5,6].map(n=>(
                <button key={n} onClick={()=>setDemoCount(n)} style={{
                  width:28, height:28, borderRadius:8, border:`1px solid ${n===demoCount?PERSON_PALETTE[n-1].stroke+"88":T.border}`,
                  background: n===demoCount?PERSON_PALETTE[n-1].bg:"transparent",
                  color: n===demoCount?PERSON_PALETTE[n-1].stroke:T.textMuted,
                  fontSize:12, fontWeight:700, cursor:"pointer",
                }}>{n}</button>
              ))}
            </div>
          )}

          {/* Person color legend */}
          {persons.length>0 && (
            <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
              {persons.map((_,i)=>{
                const p=PERSON_PALETTE[i%PERSON_PALETTE.length];
                return (
                  <div key={i} style={{ display:"flex", alignItems:"center", gap:5, padding:"4px 10px", background:p.bg, border:`1px solid ${p.stroke}33`, borderRadius:20 }}>
                    <div style={{ width:6, height:6, borderRadius:"50%", background:p.stroke, boxShadow:`0 0 6px ${p.glow}` }}/>
                    <span style={{ fontSize:10, color:p.stroke }}>{p.label}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right Panel */}
        <div style={{ borderLeft:`1px solid ${T.border}`, display:"flex", flexDirection:"column", overflow:"hidden", background:"rgba(4,4,10,0.6)" }}>

          {/* Overall Score */}
          <div style={{ padding:18, borderBottom:`1px solid ${T.border}`, display:"flex", justifyContent:"center" }}>
            {persons.length>0
              ? <OverallGauge persons={persons}/>
              : <div style={{color:T.textMuted,fontSize:11,textAlign:"center",padding:"14px 0"}}>
                  {isRunning?"Detecting...":"Start session"}
                </div>
            }
          </div>

          {/* HSE matrix mini */}
          <div style={{ padding:"10px 16px", borderBottom:`1px solid ${T.border}` }}>
            <div style={{ fontSize:9, color:T.textMuted, marginBottom:8, letterSpacing:1 }}>HSE THRESHOLDS</div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:4 }}>
              {[["92–100","Excellent",T.green],["75–91","Good",T.green],["55–74","Moderate",T.amber],["<55","High Risk",T.red]].map(([r,l,c])=>(
                <div key={r} style={{ fontSize:9, display:"flex", justifyContent:"space-between", padding:"4px 8px", background:`${c}08`, border:`1px solid ${c}22`, borderRadius:6 }}>
                  <span style={{color:c,fontFamily:"monospace"}}>{r}</span>
                  <span style={{color:c+"99"}}>{l}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Person Cards */}
          <div style={{ flex:1, overflow:"auto", padding:"12px 14px", display:"flex", flexDirection:"column", gap:10 }}>
            <div style={{ fontSize:9, color:T.textMuted, letterSpacing:1, marginBottom:2 }}>INDIVIDUAL ANALYSIS</div>

            {!isRunning && (
              <div style={{color:T.textMuted,fontSize:11,textAlign:"center",padding:"20px 0"}}>No active session</div>
            )}
            {isRunning && !persons.length && (
              <div style={{color:T.textMuted,fontSize:11,textAlign:"center",padding:"20px 0"}}>
                <div style={{fontSize:20,marginBottom:8}}>👁</div>
                Scanning for people...
              </div>
            )}

            {persons.map((p, i) => (
              <PersonCard key={i} person={p} idx={i} palette={PERSON_PALETTE[i%PERSON_PALETTE.length]}/>
            ))}
          </div>

          <div style={{ padding:"8px 16px", borderTop:`1px solid ${T.border}`, display:"flex", justifyContent:"space-between" }}>
            <span style={{fontSize:9,color:T.textMuted}}>MoveNet MultiPose</span>
            <span style={{fontSize:9,color:T.textMuted}}>Sprint 2 · ergo.hse</span>
          </div>
        </div>
      </div>

      <Toasts toasts={toasts}/>
    </div>
  );
}

function btn(color) {
  return { padding:"8px 16px", background:`${color}14`, border:`1px solid ${color}55`, borderRadius:8, color, fontSize:11, cursor:"pointer", fontFamily:"monospace" };
}
