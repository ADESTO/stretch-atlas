// Build atlas.bin from Z-Anatomy GLBs: filter, weld, simplify, skin-weight to the Stretch Atlas rig, pack.
import {NodeIO} from '@gltf-transform/core';
import {MeshoptSimplifier} from 'meshoptimizer';
import fs from 'fs';
await MeshoptSimplifier.ready;
const io = new NodeIO();

const MUSCLE_BUDGET = +process.env.MB || 170000, BONE_BUDGET = +process.env.BB || 90000;

const EXCLUDE_M = /fascia(?!e latae)|septum|retinacul|aponeurosis|sheath|bursa|ligament|tarsus|tendinous ring|trochlea of superior|^(lateral|medial|superior|inferior) rectus muscle$|^(superior|inferior) oblique muscle$|levator palpebrae|pharyng|arytenoid|cricothyroid|glossus|palato|stylopharyngeus|intercostal|diaphragm|transversus thoracis|levator ani|coccygeus|iliococcygeus|pubo-analis|pubococcygeus|anal sphincter|linea alba|interspinales|intertransversarii|levatores|rotatores|lumbrical|interossei|pterygoid|digastric|hyoid|thyroid|mylohyoid|geniohyoid|capitis muscle|longus colli|scalenus|nasalis|nasi|procerus|corrugator|orbicularis|zygomaticus|risorius|depressor|levator anguli|levator labii|levator nasolabialis|mentalis|bucinator|masseter|temporoparietalis|epicranial|platysma|subclavius|frontalis|occipitalis|pollicis brevis|opponens|adductor pollicis|abductor pollicis brevis|digiti minimi of hand|transversus abdominis|internal abdominal oblique|multifidus colli|semispinalis colli|splenius colli|spinalis colli|iliopectineal arch|quadratus plantae|flexor hallucis brevis|adductor hallucis|extensor hallucis brevis|extensor digitorum brevis|flexor digitorum brevis|digiti minimi of foot|abductor hallucis|inguinal/i;
const EXCLUDE_B = /malleus|incus|stapes|sinus|cells of ethmoid|concha|cartilage$|septal cartilage|alar|lateral process of nasal|thyroid|cricoid|arytenoid|corniculate|sesamoid/i;

async function load(file, kind) {
  const doc = await io.read(file);
  const parts = [];
  for (const n of doc.getRoot().listNodes()) {
    const mesh = n.getMesh(); if (!mesh) continue;
    const name = n.getName();
    const m = name.match(/^(.*?)(?:\.([a-z0-9]+))?$/); const base = m[1], suf = m[2] || '';
    if (!(suf === 'l' || suf === 'r' || suf === '')) continue;
    if (/^[\(\[]/.test(base) && kind === 'b') continue;
    if ((kind === 'm' ? EXCLUDE_M : EXCLUDE_B).test(base)) continue;
    const W = n.getWorldMatrix();
    const pos = [], idx = [];
    for (const p of mesh.listPrimitives()) {
      const a = p.getAttribute('POSITION').getArray(); const off = pos.length / 3;
      for (let i = 0; i < a.length; i += 3) {
        const x = a[i], y = a[i+1], z = a[i+2];
        pos.push(W[0]*x + W[4]*y + W[8]*z + W[12], W[1]*x + W[5]*y + W[9]*z + W[13], W[2]*x + W[6]*y + W[10]*z + W[14]);
      }
      const ix = p.getIndices(); if (ix) { const ia = ix.getArray(); for (let i = 0; i < ia.length; i++) idx.push(ia[i] + off); }
      else for (let i = 0; i < a.length/3; i++) idx.push(i + off);
    }
    if (idx.length < 36) continue;
    parts.push({name: base.replace(/^\((.*)\)$/, '$1'), side: suf, kind, pos: new Float32Array(pos), idx: new Uint32Array(idx)});
  }
  return parts;
}
function weld(p) {
  const map = new Map(), np = [], remap = new Uint32Array(p.pos.length/3);
  for (let i = 0; i < remap.length; i++) {
    const k = `${Math.round(p.pos[i*3]*1e4)},${Math.round(p.pos[i*3+1]*1e4)},${Math.round(p.pos[i*3+2]*1e4)}`;
    let j = map.get(k); if (j === undefined) { j = np.length/3; map.set(k, j); np.push(p.pos[i*3], p.pos[i*3+1], p.pos[i*3+2]); }
    remap[i] = j;
  }
  const ni = []; for (let t = 0; t < p.idx.length; t += 3) { const a = remap[p.idx[t]], b = remap[p.idx[t+1]], c = remap[p.idx[t+2]]; if (a !== b && b !== c && a !== c) ni.push(a, b, c); }
  p.pos = new Float32Array(np); p.idx = new Uint32Array(ni);
}
function simplify(p, ratio) {
  const target = Math.max(60, Math.floor(p.idx.length * ratio / 3) * 3);
  if (target < p.idx.length) {
    const [ni] = MeshoptSimplifier.simplify(p.idx, p.pos, 3, target, 0.03, []);
    if (ni.length >= 36) p.idx = ni;
  }
  // compact
  const used = new Int32Array(p.pos.length/3).fill(-1), np = [];
  const ni = new Uint32Array(p.idx.length);
  for (let i = 0; i < p.idx.length; i++) { const v = p.idx[i]; if (used[v] < 0) { used[v] = np.length/3; np.push(p.pos[v*3], p.pos[v*3+1], p.pos[v*3+2]); } ni[i] = used[v]; }
  p.pos = new Float32Array(np); p.idx = ni;
}

const muscles = await load('muscles.glb', 'm');
const bones = await load('skeleton.glb', 'b');
for (const p of [...muscles, ...bones]) weld(p);
const mv = muscles.reduce((s, p) => s + p.pos.length/3, 0), bv = bones.reduce((s, p) => s + p.pos.length/3, 0);
console.log('welded muscles', muscles.length, mv, 'bones', bones.length, bv);
for (const p of muscles) simplify(p, MUSCLE_BUDGET / mv);
for (const p of bones) simplify(p, BONE_BUDGET / bv);

/* ---------- joint centres ---------- */
const byName = (list, n, s) => list.find(p => p.name === n && p.side === s);
const verts = p => { const out = []; for (let i = 0; i < p.pos.length; i += 3) out.push([p.pos[i], p.pos[i+1], p.pos[i+2]]); return out; };
const mean = vs => vs.reduce((a, v) => [a[0]+v[0], a[1]+v[1], a[2]+v[2]], [0,0,0]).map(x => x / vs.length);
function sphereFit(vs) { // algebraic least squares: x²+y²+z² = 2ax+2by+2cz+d
  const A = [[0,0,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]], B = [0,0,0,0];
  for (const [x,y,z] of vs) { const r = [2*x, 2*y, 2*z, 1], t = x*x+y*y+z*z; for (let i = 0; i < 4; i++) { B[i] += r[i]*t; for (let j = 0; j < 4; j++) A[i][j] += r[i]*r[j]; } }
  for (let i = 0; i < 4; i++) { let mx = i; for (let k = i+1; k < 4; k++) if (Math.abs(A[k][i]) > Math.abs(A[mx][i])) mx = k; [A[i], A[mx]] = [A[mx], A[i]]; [B[i], B[mx]] = [B[mx], B[i]];
    for (let k = 0; k < 4; k++) if (k !== i) { const f = A[k][i]/A[i][i]; for (let j = 0; j < 4; j++) A[k][j] -= f*A[i][j]; B[k] -= f*B[i]; } }
  return [B[0]/A[0][0], B[1]/A[1][1], B[2]/A[2][2]];
}
const ext = (vs, ax, f) => vs.reduce((m, v) => f(v[ax], m) ? v[ax] : m, f === Math.max ? -1e9 : 1e9);
const femL = verts(byName(bones, 'Femur', 'l')), tibL = verts(byName(bones, 'Tibia', 'l'));
const humL = verts(byName(bones, 'Humerus', 'l')), radL = verts(byName(bones, 'Radius', 'l')), ulnL = verts(byName(bones, 'Ulna', 'l'));
const femTop = Math.max(...femL.map(v => v[1])); const femXmid = mean(femL)[0];
const hipL = sphereFit(femL.filter(v => v[1] > femTop - .055 && v[0] < femXmid - .01));
const femBot = Math.min(...femL.map(v => v[1])), tibTop = Math.max(...tibL.map(v => v[1]));
const kc = mean(femL.filter(v => v[1] < femBot + .025)); const kneeL = [kc[0], (femBot + tibTop)/2 + .005, kc[2]];
const ankleL = [ .08, .08, -.045 ];
{ const t = verts(byName(bones, 'Talus', 'l')); const top = Math.max(...t.map(v => v[1])); const c = mean(t.filter(v => v[1] > top - .015)); ankleL[0] = c[0]; ankleL[1] = top - .012; ankleL[2] = c[2]; }
const humTop = Math.max(...humL.map(v => v[1])); const humXmid = mean(humL.filter(v => v[1] > humTop - .06))[0];
const shoulderL = sphereFit(humL.filter(v => v[1] > humTop - .05 && v[0] < humXmid + .005));
const humBot = Math.min(...humL.map(v => v[1])); const ec = mean(humL.filter(v => v[1] < humBot + .02)); const elbowL = [ec[0], humBot + .012, ec[2]];
const rb = Math.min(...radL.map(v => v[1])), ub = Math.min(...ulnL.map(v => v[1]));
const wristL = mean([mean(radL.filter(v => v[1] < rb + .015)), mean(ulnL.filter(v => v[1] < ub + .015))]);
const vert = n => mean(verts(byName(bones, n, '')));
const L3 = vert('Vertebra L3'), L4 = vert('Vertebra L4'), C7 = vert('Vertebra C7'), T1 = vert('Vertebra T1');
const lumbar = [0, (L3[1] + L4[1])/2, (L3[2] + L4[2])/2 + .01];
const neck = [0, (C7[1] + T1[1])/2, (C7[2] + T1[2])/2 + .02];
const pelvis = [0, hipL[1] + .03, hipL[2]];
const allB = bones.flatMap(verts);
const crown = [0, Math.max(...allB.map(v => v[1])), 0];
const handL = bones.filter(p => p.side === 'l' && /finger of hand/.test(p.name)).flatMap(verts);
const fingerL = handL.reduce((m, v) => v[1] < m[1] ? v : m, [0, 9, 0]);
const footL = bones.filter(p => p.side === 'l' && /finger of foot|metatarsal/.test(p.name)).flatMap(verts);
const toeL = footL.reduce((m, v) => v[2] > m[2] ? v : m, [0, 0, -9]);
const calcL = verts(byName(bones, 'Calcaneus', 'l'));
const heelL = calcL.reduce((m, v) => v[2] < m[2] ? v : m, [0, 0, 9]);
const soleY = Math.min(...[...calcL, ...footL].map(v => v[1]));
const patL = mean(verts(byName(bones, 'Patella', 'l')));
const ischL = (() => { const h = verts(byName(bones, 'Hip bone', 'l')); const low = Math.min(...h.map(v => v[1])); return mean(h.filter(v => v[1] < low + .02)); })();
const sacrum = (() => { const s = verts(byName(bones, 'Sacrum', '')); return s.reduce((m, v) => v[2] < m[2] ? v : m, [0,0,9]); })();
const backPt = (() => { const t = verts(byName(bones, 'Scapula', 'l')); return t.reduce((m, v) => v[2] < m[2] ? v : m, [0,0,9]); })();
const headBack = (() => { const o = verts(byName(bones, 'Occipital bone', '')); return o.reduce((m, v) => v[2] < m[2] ? v : m, [0,0,9]); })();
const mir = v => [-v[0], v[1], v[2]];
const J = {pelvis, chest: lumbar, neck, hipL, kneeL, ankleL, hipR: mir(hipL), kneeR: mir(kneeL), ankleR: mir(ankleL),
  shoulderL, elbowL, shoulderR: mir(shoulderL), elbowR: mir(elbowL), wristL, wristR: mir(wristL), crown, fingerL, fingerR: mir(fingerL), toeL, toeR: mir(toeL)};
const r3 = v => v.map(x => +x.toFixed(4));
for (const k in J) J[k] = r3(J[k]);
console.log(J);
const MARKS = {
  heelL: [heelL[0], soleY, heelL[2] + .01], heelR: mir([heelL[0], soleY, heelL[2] + .01]),
  toeL: [toeL[0], soleY, toeL[2]], toeR: mir([toeL[0], soleY, toeL[2]]),
  heelBackL: heelL, heelBackR: mir(heelL),
  kneeL: [patL[0], patL[1], patL[2] + .02], kneeR: mir([patL[0], patL[1], patL[2] + .02]),
  ischL: [ischL[0], ischL[1] - .04, ischL[2] - .02], ischR: mir([ischL[0], ischL[1] - .04, ischL[2] - .02]),
  pubis: (() => { const h = [...verts(byName(bones, 'Hip bone', 'l')), ...verts(byName(bones, 'Hip bone', 'r'))].filter(v => Math.abs(v[0]) < .04); const f = h.reduce((m, v) => v[2] > m[2] ? v : m, [0,0,-9]); return [0, f[1], f[2] + .03]; })(),
  sternum: (() => { const b = verts(byName(bones, 'Body of sternum', '')); const f = b.reduce((m, v) => v[2] > m[2] ? v : m, [0,0,-9]); return [0, f[1], f[2] + .03]; })(),
  forehead: (() => { const b = verts(byName(bones, 'Frontal bone', '')); const f = b.reduce((m, v) => v[2] > m[2] ? v : m, [0,0,-9]); return [0, f[1], f[2] + .01]; })(),
  elbowL: (() => { const u = verts(byName(bones, 'Ulna', 'l')); const t = Math.max(...u.map(v => v[1])); const b = u.filter(v => v[1] > t - .03).reduce((m, v) => v[2] < m[2] ? v : m, [0,0,9]); return [b[0], b[1], b[2] - .015]; })(),
  sacrum: [0, sacrum[1], sacrum[2] - .03], back: [0, backPt[1], backPt[2] - .04], head: [0, headBack[1], headBack[2] - .01], crown,
};
MARKS.elbowR = mir(MARKS.elbowL);
for (const k in MARKS) MARKS[k] = r3(MARKS[k]);
const MARK_BONE = {heel:'ankle', toe:'ankle', heelBack:'ankle', knee:'hip', isch:'pelvis', elbow:'elbow', pubis:'pelvis', sacrum:'pelvis', sternum:'chest', back:'chest', head:'neck', crown:'neck', forehead:'neck'};
const markBone = Object.fromEntries(Object.keys(MARKS).map(k => { const m = k.match(/^(.*?)([LR])?$/); return [k, MARK_BONE[m[1]] + (m[2] || '')]; }));

/* ---------- skinning ---------- */
const BONES = ['pelvis','chest','neck','hipL','kneeL','ankleL','hipR','kneeR','ankleR','shoulderL','elbowL','shoulderR','elbowR','wristL','wristR'];
const BI = Object.fromEntries(BONES.map((b, i) => [b, i]));
const CAPS = [
  ['pelvis', [0, ischL[1], pelvis[2]], [0, lumbar[1], lumbar[2] - .02], .1, 'a'],
  ['chest', lumbar, neck, .12, 'a'],
  ['neck', neck, crown, .06, 'a'],
  ...['L','R'].flatMap(s => [
    ['hip'+s, J['hip'+s], J['knee'+s], .055, s],
    ['knee'+s, J['knee'+s], J['ankle'+s], .04, s],
    ['ankle'+s, s === 'L' ? heelL : mir(heelL), J['toe'+s], .025, s],
    ['shoulder'+s, J['shoulder'+s], J['elbow'+s], .035, s],
    ['elbow'+s, J['elbow'+s], J['wrist'+s], .03, s],
    ['wrist'+s, J['wrist'+s], J['finger'+s], .022, s],
  ]),
];
function segDist(p, a, b) { const ab = [b[0]-a[0], b[1]-a[1], b[2]-a[2]]; const t = Math.max(0, Math.min(1, ((p[0]-a[0])*ab[0] + (p[1]-a[1])*ab[1] + (p[2]-a[2])*ab[2]) / (ab[0]**2 + ab[1]**2 + ab[2]**2)));
  return Math.hypot(p[0]-a[0]-ab[0]*t, p[1]-a[1]-ab[1]*t, p[2]-a[2]-ab[2]*t); }
function weightsAt(p, side) {
  const allow = c => c[4] === 'a' || (side === 'l' && c[4] === 'L') || (side === 'r' && c[4] === 'R') || (side === '' && Math.abs(p[0]) > .12 && c[4] === (p[0] > 0 ? 'L' : 'R'));
  const ws = [];
  for (const c of CAPS) if (allow(c)) { const d = Math.max(segDist(p, c[1], c[2]) - c[3], .004); ws.push([BI[c[0]], d ** -4]); }
  ws.sort((a, b) => b[1] - a[1]);
  const [a, b] = ws; let w = a[1] / (a[1] + b[1]); if (w > .97) w = 1;
  return [a[0], b[0], w];
}
const RIGID = [
  [/femur/i, 'hip'], [/patella|tibia|fibula/i, 'knee'], [/talus|calcaneus|navicular|cuboid|cuneiform|metatarsal|of foot/i, 'ankle'],
  [/humerus/i, 'shoulder'], [/radius|ulna/i, 'elbow'], [/scaphoid|lunate|triquetrum|pisiform|trapezi|capitate|hamate|metacarpal|of hand/i, 'wrist'],
  [/clavicle|scapula|rib|sternum|xiphoid|manubrium|vertebra t/i, 'chest'], [/vertebra c|atlas|axis|bone$|mandible|maxilla|vomer|incisor|canine|premolar|molar|hyoid/i, 'neck'],
  [/hip bone|sacrum|coccyx/i, 'pelvis'],
];
function rigidBone(p) {
  if (/vertebra l/i.test(p.name)) { const c = mean(verts(p)); return c[1] > lumbar[1] ? BI.chest : BI.pelvis; }
  for (const [re, b] of RIGID) if (re.test(p.name)) { const lim = ['hip','knee','ankle','shoulder','elbow','wrist'].includes(b); return BI[lim ? b + (p.side === 'r' ? 'R' : 'L') : b]; }
  const c = mean(verts(p)); return weightsAt(c, p.side)[0];
}

/* ---------- curated mapping ---------- */
const CURATED = {
  rectusFemoris:['Rectus femoris muscle'], vastusLateralis:['Vastus lateralis muscle'], vastusMedialis:['Vastus medialis muscle'], vastusIntermedius:['Vastus intermedius muscle'],
  bicepsFemoris:['Long head of biceps femoris','Short head of biceps femoris'], semitendinosus:['Semimembranosus muscle','Semitendinosus muscle'],
  gluteusMaximus:['Gluteus maximus muscle'], gluteusMedius:['Gluteus medius muscle'], gluteusMinimus:['Gluteus minimus muscle'], piriformis:['Piriformis muscle'],
  iliopsoas:['Iliacus muscle','Psoas major'], adductors:['Adductor magnus','Adductor minimus','Adductor longus','Adductor brevis','Pectineus muscle'], gracilis:['Gracilis muscle'],
  tfl:['Tensor fasciae latae'], sartorius:['Sartorius muscle'],
  gastrocnemius:['Lateral head of gastrocnemius','Medial head of gastrocnemius'], soleus:['Soleus muscle'], tibialisAnterior:['Tibialis anterior muscle'], fibularis:['Fibularis longus muscle','Fibularis brevis muscle'],
  pectoralisMajor:['Clavicular head of pectoralis major muscle','Sternocostal head of pectoralis major muscle','Abdominal part of pectoralis major muscle'],
  latissimusDorsi:['Latissimus dorsi muscle'], deltoid:['Acromial part of deltoid muscle','Clavicular part of deltoid muscle','Scapular spinal part of deltoid muscle'],
  bicepsBrachii:['Long head of biceps brachii','Short head of biceps brachii'], brachialis:['Brachialis muscle'],
  tricepsBrachii:['Medial head of triceps brachii','Lateral head of triceps brachii','Long head of triceps brachii'],
  forearmFlexors:['Flexor carpi radialis','Palmaris longus muscle','Humeral head of flexor carpi ulnaris','Ulnar head of flexor carpi ulnaris','Humero-ulnar head of flexor digitorum superficialis','Radial head of flexor digitorum superficialis'],
  forearmExtensors:['Extensor carpi radialis longus','Extensor carpi radialis brevis','Extensor digitorum','Humeral head of extensor carpi ulnaris','Ulnar head of extensor carpi ulnaris'],
  rectusAbdominis:['Rectus abdominis muscle'], externalOblique:['External abdominal oblique muscle'], quadratusLumborum:['Quadratus lumborum muscle'],
  erectorSpinae:['Iliocostalis lumborum muscle','Iliocostalis thoracis muscle','Iliocostalis colli muscle','Longissimus thoracis muscle','Longissimus colli muscle','Spinalis thoracis muscle'],
  multifidus:['Multifidus lumborum muscle','Multifidus thoracis muscle'],
  trapezius:['Descending part of trapezius muscle','Transverse part of trapezius muscle','Ascending part of trapezius muscle'], levatorScapulae:['Levator scapulae'],
  rhomboids:['Rhomboid major muscle','Rhomboid minor muscle'], sternocleidomastoid:['Sternocleidomastoid muscle'],
  rotatorCuff:['Supraspinatus muscle','Infraspinatus muscle','Teres minor muscle','Subscapularis muscle'],
};
const CUR_OF = {}; for (const [id, ns] of Object.entries(CURATED)) for (const n of ns) CUR_OF[n] = id;
const missing = Object.values(CURATED).flat().filter(n => !muscles.some(p => p.name === n)); if (missing.length) console.log('MISSING', missing);

/* ---------- probes ---------- */
function probes(p) {
  const vs = verts(p), c = mean(vs);
  // principal axis by power iteration
  const C = [[0,0,0],[0,0,0],[0,0,0]]; for (const v of vs) { const d = [v[0]-c[0], v[1]-c[1], v[2]-c[2]]; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i][j] += d[i]*d[j]; }
  let a = [0, 1, 0]; for (let k = 0; k < 30; k++) { const n = [0,1,2].map(i => C[i][0]*a[0] + C[i][1]*a[1] + C[i][2]*a[2]); const l = Math.hypot(...n) || 1; a = n.map(x => x/l); }
  const t = vs.map(v => (v[0]-c[0])*a[0] + (v[1]-c[1])*a[1] + (v[2]-c[2])*a[2]);
  const lo = Math.min(...t), hi = Math.max(...t), K = 6, bins = Array.from({length: K}, () => []);
  vs.forEach((v, i) => bins[Math.min(K-1, Math.floor((t[i]-lo)/(hi-lo+1e-9)*K))].push(v));
  const pts = bins.filter(b => b.length).map(mean);
  // extend ends to the real extremes along the axis
  const ends = [vs[t.indexOf(lo)], vs[t.indexOf(hi)]];
  return [ends[0], ...pts, ends[1]].map(q => { const [b0, b1, w] = weightsAt(q, p.side); return [...r3(q), b0, b1, +w.toFixed(3)]; });
}

/* ---------- pack ---------- */
const all = [...muscles, ...bones];
let minB = [9,9,9], maxB = [-9,-9,-9];
for (const p of all) for (let i = 0; i < p.pos.length; i += 3) for (let k = 0; k < 3; k++) { minB[k] = Math.min(minB[k], p.pos[i+k]); maxB[k] = Math.max(maxB[k], p.pos[i+k]); }
const chunks = []; let cur = null;
const partsOut = [];
function newChunk(kind) { cur = {kind, parts: [], v: 0, i: 0}; chunks.push(cur); }
for (const kind of ['m', 'b']) {
  newChunk(kind);
  for (const p of all.filter(q => q.kind === kind)) {
    const nv = p.pos.length/3; if (cur.v + nv > 65535) newChunk(kind);
    p.chunk = chunks.length - 1; p.vStart = cur.v; p.iStart = cur.i; cur.v += nv; cur.i += p.idx.length; cur.parts.push(p);
  }
}
const bufs = []; let off = 0; const meta = [];
function push(arr) { const b = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength); const pad = (4 - (b.length % 4)) % 4; bufs.push(b, Buffer.alloc(pad)); const o = off; off += b.length + pad; return o; }
let pid = 0;
for (const ch of chunks) {
  const P = new Int16Array(ch.v*3), S = new Uint8Array(ch.v*2), Wt = new Uint8Array(ch.v), I = new Uint16Array(ch.i);
  for (const p of ch.parts) {
    const rigid = p.kind === 'b' ? rigidBone(p) : -1;
    for (let i = 0; i < p.pos.length/3; i++) {
      const v = [p.pos[i*3], p.pos[i*3+1], p.pos[i*3+2]], o = (p.vStart + i);
      for (let k = 0; k < 3; k++) P[o*3+k] = Math.round((v[k] - minB[k]) / (maxB[k] - minB[k]) * 65534 - 32767);
      if (rigid >= 0) { S[o*2] = rigid; S[o*2+1] = rigid; Wt[o] = 255; }
      else { const [b0, b1, w] = weightsAt(v, p.side); S[o*2] = b0; S[o*2+1] = b1; Wt[o] = Math.round(w*255); }
    }
    for (let i = 0; i < p.idx.length; i++) I[p.iStart + i] = p.idx[i] + p.vStart;
    const rec = {id: pid++, name: p.name, side: p.side, kind: p.kind, chunk: p.chunk, v: [p.vStart, p.pos.length/3], i: [p.iStart, p.idx.length]};
    if (p.kind === 'm') { rec.cur = CUR_OF[p.name] || null; rec.probes = probes(p); }
    else rec.bone = rigid;
    partsOut.push(rec);
  }
  meta.push({kind: ch.kind, vCount: ch.v, iCount: ch.i, pos: push(P), skin: push(S), w: push(Wt), idx: push(I)});
}
const json = JSON.stringify({bbox: [minB, maxB], joints: J, marks: MARKS, markBone, bones: BONES, chunks: meta, parts: partsOut,
  credit: 'Anatomical models: Z-Anatomy (Lluís Vinent and contributors), CC BY-SA 4.0, derived from BodyParts3D (DBCLS). Simplified and rigged for Stretch Atlas.'});
const jb = Buffer.from(json); const jpad = (4 - ((jb.length + 4) % 4)) % 4;
const head = Buffer.alloc(4); head.writeUInt32LE(jb.length + jpad);
fs.writeFileSync(process.env.OUT || 'atlas.bin', Buffer.concat([head, jb, Buffer.alloc(jpad, 32), ...bufs]));
console.log('parts', partsOut.length, 'chunks', meta.map(m => m.kind + m.vCount + '/' + m.iCount).join(' '), 'bytes', fs.statSync(process.env.OUT || 'atlas.bin').size, 'json', jb.length);
