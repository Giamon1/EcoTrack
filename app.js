/*
 * EcoTrack: student eco tracker with a 3D smart bin simulator
 * Needs three.js (r128), qrcode-generator, TensorFlow.js, MobileNet and COCO-SSD
 * loaded before this file (see index.html).
 * Demo only: accounts are saved in this browser's localStorage.
 */

const $ = id => document.getElementById(id);

// ===== 1. Trash categories and demo items
// Item fields: n = name, k = category key, g = geometry, col = color =====
const CATS = {
    rec: { n: 'Recyclable', c: '#39a0ff', i: 0, pts: 1, co2: .08 },
    bio: { n: 'Biodegradable', c: '#39ff6a', i: 1, pts: 0.5, co2: .03 },
    res: { n: 'Residual', c: '#c4ccc7', i: 2, pts: 0.5, co2: 0 },
    haz: { n: 'Hazardous', c: '#ff5a4a', i: 3, pts: 2, co2: .12 }
};

const ITEMS = [
    { n: 'Plastic bottle', k: 'rec', g: () => new THREE.CylinderGeometry(.09, .09, .3, 16), col: 0x7fd0ff },
    { n: 'Paper sheet', k: 'rec', g: () => new THREE.BoxGeometry(.28, .02, .2), col: 0xf4f4ee },
    { n: 'Aluminum can', k: 'rec', g: () => new THREE.CylinderGeometry(.08, .08, .22, 16), col: 0xc9ccd1 },
    { n: 'Banana peel', k: 'bio', g: () => new THREE.TorusGeometry(.1, .045, 8, 14), col: 0xe8d23a },
    { n: 'Apple core', k: 'bio', g: () => new THREE.SphereGeometry(.1, 14, 10), col: 0xc9473a },
    { n: 'Chip wrapper', k: 'res', g: () => new THREE.BoxGeometry(.24, .03, .18), col: 0xd98a2b },
    { n: 'Used battery', k: 'haz', g: () => new THREE.CylinderGeometry(.05, .05, .17, 12), col: 0x555a60 },
    { n: 'Plastic cup', k: 'rec', g: () => new THREE.CylinderGeometry(.1, .07, .2, 16), col: 0xffffff }
];

// Rewards students can redeem with points. Fields: n = name, cost = points, ic = icon, d = description
const REWARDS = [
    { n: 'Pencil', cost: 40, ic: '✏️', d: 'A sharpened pencil made from recycled paper.' },
    { n: 'Eco sticker pack', cost: 50, ic: '🌿', d: 'Waterproof stickers for your bottle or laptop.' },
    { n: 'Notebook', cost: 100, ic: '📓', d: 'Recycled-paper notebook, 80 leaves.' },
    { n: 'Reusable straw set', cost: 140, ic: '🥤', d: 'Stainless steel straws with a cleaning brush.' },
    { n: 'Canvas tote bag', cost: 250, ic: '👜', d: 'Reusable tote with the EcoTrack logo.' },
    { n: 'Water bottle', cost: 380, ic: '🍶', d: 'Insulated reusable bottle.' }
];

const LV = [0, 50, 150, 300, 500];

// ===== 2. App state and browser storage =====
let users = {}, cur = null, active = false, busy = false, reg = false;
let sess = 0; // points earned in the current simulator session
let queue = []; // items waiting to be dropped one after another

try {
    users = JSON.parse(localStorage.getItem('sb_users') || '{}');
}
catch (e) {
}

function saveU() {
    try {
        localStorage.setItem('sb_users', JSON.stringify(users));
    }
    catch (e) {
    }
}

async function hash(s) {
    try {
        const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('sb:' + s));
        return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
    }
    catch (e) {
        return btoa(s);
    }
}

// ===== 3. Register and log in =====
function mode(r) {
    reg = r;
    $('fR').hidden = !r;
    $('tL').className = r ? '' : 'on';
    $('tR').className = r ? 'on' : '';
    $('go').textContent = r ? 'Create account' : 'Log in';
    $('err').textContent = '';
    $('pw').autocomplete = r ? 'new-password' : 'current-password';
}

$('tL').onclick = () => mode(false);

$('tR').onclick = () => mode(true);

$('go').onclick = async () => {
    const sid = $('sid').value.trim(), pw = $('pw').value, e = $('err');
    if (!sid || pw.length < 4) {
        e.textContent = 'Enter your student ID and a password of at least 4 characters.';
        return;
    }
    const h = await hash(pw);
    if (reg) {
        const nm = $('nm').value.trim();
        if (!nm) {
            e.textContent = 'Enter your full name.';
            return;
        }
        if (users[sid]) {
            e.textContent = 'That student ID is already registered. Log in instead.';
            return;
        }
        users[sid] = {
            name: nm,
            section: $('gr').value.trim() || 'No section',
            h,
            pts: 0,
            spent: 0,
            co2: 0,
            c: { rec: 0, bio: 0, res: 0, haz: 0 },
            log: [],
            rd: []
        };
        saveU();
        enter(sid);
    }
    else {
        if (!users[sid] || users[sid].h !== h) {
            e.textContent = 'Student ID or password is incorrect.';
            return;
        }
        enter(sid);
    }
};

document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !$('auth').hidden)
        $('go').click();
});

// ===== 4. Navigation between tabs =====
const VS = ['dash', 'hist', 'lead', 'redeem', 'sim'];

function show(v) {
    VS.forEach(x => {
        $('v_' + x).hidden = x !== v;
        $('n_' + x).className = x === v ? 'on' : '';
    });
    if (v !== 'redeem')
        $('rMsg').textContent = '';
    if (v === 'sim')
        setTimeout(rs, 0);
}

document.querySelectorAll('[data-v]').forEach(b => b.onclick = () => show(b.dataset.v));

function enter(sid) {
    show('dash');
    cur = sid;
    active = false;
    // Accounts created before the Redeem page existed need these fields
    const u = users[sid];
    if (typeof u.spent !== 'number') u.spent = 0;
    if (!Array.isArray(u.rd)) u.rd = [];
    $('auth').hidden = true;
    $('app').hidden = false;
    $('pw').value = '';
    $('hn').textContent = users[sid].name;
    $('hg').textContent = 'ID ' + sid + ' · ' + (users[sid].section || users[sid].grade || 'No section');
    setTimeout(() => {
        rs();
        drawScreen('Scan QR to login', 'Use the kiosk', 0);
    }, 0);
    render();
    // Opened by scanning the kiosk QR: go to the simulator and start the camera
    if (location.hash === '#scan') {
        try {
            history.replaceState(null, '', location.pathname + location.search);
        }
        catch (e) {
        }
        show('sim');
        setTimeout(() => $('scan').click(), 400);
    }
}

$('out').onclick = () => {
    closeCam();
    cur = null;
    active = false;
    sess = 0;
    queue = [];
    $('app').hidden = true;
    $('auth').hidden = false;
};

$('scan').onclick = () => {
    if (busy)
        return;
    active = true;
    sess = 0;
    render();
    flash('Welcome, ' + users[cur].name.split(' ')[0] + '!', 'Show your items');
    openCam(); // the QR scan sends the student to the camera
};

// Exit: end the scan session (items can't be dropped until the QR is scanned again)
$('exitSim').onclick = () => {
    if (busy)
        return;
    closeCam();
    active = false;
    sess = 0;
    queue = [];
    drawScreen('Scan QR to login', 'Use the kiosk', 0);
    render();
};

$('items').innerHTML = ITEMS.map((it, i) => `<button data-i="${i}">${it.n}</button>`).join('');

$('items').onclick = e => {
    const b = e.target.closest('button');
    if (b && active && !busy)
        drop(ITEMS[b.dataset.i]);
};

// ===== 5. Dashboard, history and leaderboard =====
const dkey = t => {
    const d = new Date(t);
    return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate();
};

const fmt = t => new Date(t).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
});

function streak(u) {
    const ds = new Set(u.log.filter(e => e.t).map(e => dkey(e.t)));
    let c = 0, d = new Date();
    if (!ds.has(dkey(d)))
        d.setDate(d.getDate() - 1);
    while (ds.has(dkey(d))) {
        c++;
        d.setDate(d.getDate() - 1);
    }
    const ts = [...ds].map(k => {
        const q = k.split('-');
        return new Date(q[0], q[1], q[2]).getTime();
    }).sort((a, b) => a - b);
    let best = 0, run = 0, pv = null;
    ts.forEach(t => {
        run = pv !== null && Math.round((t - pv) / 864e5) === 1 ? run + 1 : 1;
        best = Math.max(best, run);
        pv = t;
    });
    const wk = [];
    for (let i = 6; i >= 0; i--) {
        const x = new Date();
        x.setDate(x.getDate() - i);
        wk.push({
            l: x.toLocaleDateString('en-US', { weekday: 'short' }),
            on: ds.has(dkey(x))
        });
    }
    return {
        c,
        best,
        wk
    };
}

const row = e => `<li><div><b>${e.n}</b><div class="mu">${e.t ? fmt(e.t) + ' · ' : ''}${CATS[e.k].n}</div></div><span class="pill">auto-verified · +${e.p}</span></li>`;

function render() {
    if (!cur)
        return;
    const u = users[cur], sk = streak(u);
    $('av').textContent = u.name[0].toUpperCase();
    $('tip').textContent = active ? 'The bin scans, sorts and awards points automatically.' : 'Scan the QR kiosk first to start a session.';
    $('bst').textContent = active ? 'Session active for ' + u.name + '.' : 'Scan the QR kiosk beside the bin to start.';
    $('scan').textContent = active ? 'Session active' : 'Simulate QR scan';
    $('scan').disabled = active;
    $('exitSim').hidden = !active;
    $('exitSim').disabled = busy;
    $('camBtn').hidden = !active || busy;
    document.querySelectorAll('#items button').forEach(b => b.disabled = !active || busy);
    $('pts').textContent = balance(u); // total points left after redemptions
    $('sp').textContent = sess;
    $('nAct').textContent = u.log.length;
    $('nStr').textContent = sk.c;
    $('sCur').textContent = sk.c;
    $('sBest').textContent = sk.best + ' best';
    $('wk').innerHTML = sk.wk.map(d => `<div><i class="dot ${d.on ? 'on' : ''}"></i>${d.l}</div>`).join('');
    $('sMsg').textContent = sk.c ? 'Nice work. Keep dropping trash every day.' : 'Get an activity verified to start a streak.';
    const L = u.log.map(row).join('') || '<li class="mu">No activity yet. Try the simulator.</li>';
    $('log').innerHTML = u.log.slice(0, 5).map(row).join('') || L;
    $('hist').innerHTML = L;
    renderLeaderboard();
    renderRedeem();
    renderHome(u);
}

// ===== 5a. Dashboard extras: level bar and next reward =====
function renderHome(u) {
    // Level bar uses all points ever earned, so spending points never shrinks it
    let lv = 0;
    LV.forEach((p, i) => {
        if (u.pts >= p) lv = i;
    });
    const nx = LV[lv + 1];
    $('plantBar').style.width = nx === undefined ? '100%' : Math.round((u.pts - LV[lv]) / (nx - LV[lv]) * 100) + '%';
    $('ptsSub').textContent = u.pts + ' earned · ' + (u.spent || 0) + ' spent';
    $('hPts').textContent = balance(u);

    // Next reward the student cannot afford yet
    const bal = balance(u);
    const nr = REWARDS.find(r => r.cost > bal) || REWARDS[REWARDS.length - 1];
    $('nrIc').textContent = nr.ic;
    $('nrName').textContent = nr.n;
    $('nrBar').style.width = Math.min(100, Math.round(bal / nr.cost * 100)) + '%';
    $('nrNote').textContent = bal >= nr.cost ? 'You can redeem every reward!' : (nr.cost - bal) + ' more points to redeem';
}

// ===== 5b. Redeem page =====
// Total points earned stay in u.pts (level bar and leaderboard use it).
// Points spent on rewards are tracked in u.spent, so balance = earned - spent.
const balance = u => u.pts - (u.spent || 0);

const makeCode = () => 'ECO-' + Math.random().toString(36).slice(2, 8).toUpperCase();

function renderRedeem() {
    const u = users[cur], bal = balance(u);
    $('rBal').textContent = bal;
    $('rSub').textContent = u.pts + ' earned · ' + (u.spent || 0) + ' spent';
    $('rewards').innerHTML = REWARDS.map((r, i) => {
        const can = bal >= r.cost;
        const pct = Math.min(100, Math.round(bal / r.cost * 100));
        return `<div class="rw"><div class="ic">${r.ic}</div><b>${esc(r.n)}</b><div class="mu">${esc(r.d)}</div><div class="cost">${r.cost} pts</div>` +
            (can ? '' : `<div class="bar"><i style="width:${pct}%"></i></div><div class="mu">${r.cost - bal} more pts needed</div>`) +
            `<button class="p" data-r="${i}" type="button"${can ? '' : ' disabled'}>Redeem</button></div>`;
    }).join('');
    $('rdList').innerHTML = (u.rd || []).map(e => `<li><div><b>${esc(e.n)}</b><div class="mu">${fmt(e.t)} · −${e.cost} pts</div></div><span class="code">${esc(e.code)}</span></li>`).join('') ||
        '<li class="mu">Nothing redeemed yet.</li>';
}

$('rewards').onclick = e => {
    const b = e.target.closest('button[data-r]');
    if (!b || !cur) return;
    const r = REWARDS[b.dataset.r], u = users[cur];
    if (!r || balance(u) < r.cost) return;
    if (!confirm('Redeem ' + r.n + ' for ' + r.cost + ' points?')) return;
    const code = makeCode();
    u.spent = (u.spent || 0) + r.cost;
    u.rd.unshift({ n: r.n, cost: r.cost, t: Date.now(), code });
    saveU();
    render();
    $('rMsg').textContent = 'Redeemed ' + r.n + '! Show code ' + code + ' to claim it.';
};

// ===== 6. 3D scene: smart bin and QR kiosk =====
const cv = $('c'), R = new THREE.WebGLRenderer({
    canvas: cv,
    antialias: true
});

R.setPixelRatio(Math.min(devicePixelRatio, 2));

const S = new THREE.Scene();

// soft sky blue, same color as the distance fog so the grass fades into it
S.background = new THREE.Color(0xb7d6e6);

S.fog = new THREE.Fog(0xb7d6e6, 28, 70);

const cam = new THREE.PerspectiveCamera(35, 1, .1, 120);

// softer lighting so surfaces don't blow out to white
S.add(new THREE.AmbientLight(0xffffff, .55));

S.add(new THREE.HemisphereLight(0xdff0ff, 0x8a8a70, .25));

const dl = new THREE.DirectionalLight(0xffffff, .8);

dl.position.set(3, 6, 5);

S.add(dl);

const M = (c, m = .2, r = .6, e) => new THREE.MeshStandardMaterial({
    color: c,
    metalness: m,
    roughness: r,
    emissive: e || 0,
    emissiveIntensity: e ? .15 : 0
});

const body = M(0x2b3135, .3, .55), dk = M(0x111416, .4, .6), wh = M(0xeef1f0, .1, .4);

const bin = new THREE.Group();

S.add(bin);

const add = (g, m, x, y, z, p = bin) => {
    const o = new THREE.Mesh(g, m);
    o.position.set(x, y, z);
    p.add(o);
    return o;
};

// cylinder body (brushed steel) with base ring, grooves and collar
const steel = new THREE.MeshStandardMaterial({
    color: 0x9aa5ab,
    metalness: .85,
    roughness: .3
});

add(new THREE.CylinderGeometry(1, 1, 2.4, 48), steel, 0, 1.3, 0);

add(new THREE.CylinderGeometry(1.04, 1.04, .22, 48), dk, 0, .12, 0);

add(new THREE.CylinderGeometry(1.01, 1.01, .03, 48), dk, 0, 1.9, 0);

add(new THREE.CylinderGeometry(1.01, 1.01, .03, 48), dk, 0, .5, 0);

add(new THREE.CylinderGeometry(1.04, 1.04, .14, 48), wh, 0, 2.5, 0);

// funnel-shaped lid
add(new THREE.CylinderGeometry(.62, 1.02, .3, 48), wh, 0, 2.7, 0);

// color-coded category lamps: four curved strips around the front of the body
const lamps = Object.values(CATS).map((c, i) => {
    const m = M(new THREE.Color(c.c).multiplyScalar(.35), 0, .5, new THREE.Color(c.c));
    m.emissiveIntensity = .15;
    const center = (i - 1.5) * .5;
    add(new THREE.CylinderGeometry(1.012, 1.012, .9, 16, 1, true, center - .2, .4), m, 0, 1.2, 0);
    return m;
});

// hatch on top of the lid with two sliding half-doors
add(new THREE.CylinderGeometry(.4, .4, .04, 32), dk, 0, 2.86, -.1);

const dA = add(new THREE.CylinderGeometry(.44, .44, .05, 32, 1, false, 0, Math.PI), wh, 0, 2.9, -.1);

const dB = add(new THREE.CylinderGeometry(.44, .44, .05, 32, 1, false, Math.PI, Math.PI), wh, 0, 2.9, -.1);

const beam = add(new THREE.TorusGeometry(.5, .02, 8, 40), new THREE.MeshBasicMaterial({
    color: 0x39ff6a,
    transparent: true,
    opacity: 0
}), 0, 3.2, -.1);

beam.rotation.x = Math.PI / 2;

// display screen on the front of the cylinder
const sc = document.createElement('canvas');

sc.width = 320;

sc.height = 160;

const sx = sc.getContext('2d'), tex = new THREE.CanvasTexture(sc);

add(new THREE.BoxGeometry(1.1, .66, .3), dk, 0, 2.0, .9);

add(new THREE.PlaneGeometry(1.0, .5), new THREE.MeshBasicMaterial({ map: tex }), 0, 2.0, 1.052);

// QR kiosk beside the bin
const kiosk = new THREE.Group();

kiosk.position.set(2.5, 0, .3);

S.add(kiosk);

add(new THREE.CylinderGeometry(.35, .4, .1, 24), dk, 0, .05, 0, kiosk);

add(new THREE.BoxGeometry(.12, 1.5, .12), M(0x9aa3a8, .8, .3), 0, .8, 0, kiosk);

const kp = new THREE.Group();

kp.position.set(0, 1.75, .05);

kp.rotation.x = -.25;

kiosk.add(kp);

add(new THREE.BoxGeometry(1, 1.3, .08), dk, 0, 0, 0, kp);

// ---- Real QR code ----
// The kiosk QR always opens the GitHub Pages site. The "#scan" at the end tells the app
// to go straight to the simulator and start the camera after the student logs in.
// Needs the qrcode-generator library (see index.html).
const QR_URL = 'https://giamon1.github.io/EcoTrack/';

const qrUrl = () => QR_URL + '#scan';

// Draw a QR code for the text onto a canvas: black squares on white, with the quiet border scanners need
function drawQR(canvas, text) {
    const g = canvas.getContext('2d'), size = canvas.width;
    g.fillStyle = '#fff';
    g.fillRect(0, 0, size, size);
    try {
        const q = qrcode(0, 'M');
        q.addData(text);
        q.make();
        const count = q.getModuleCount(), quiet = 4;
        const cell = Math.floor(size / (count + quiet * 2));
        const off = Math.floor((size - cell * count) / 2);
        g.fillStyle = '#000';
        for (let y = 0; y < count; y++)
            for (let x = 0; x < count; x++)
                if (q.isDark(y, x))
                    g.fillRect(off + x * cell, off + y * cell, cell, cell);
        return true;
    }
    catch (e) {
        // library missing (offline) or link too long
        g.fillStyle = '#b3392b';
        g.font = '700 28px Segoe UI,sans-serif';
        g.textAlign = 'center';
        g.fillText('QR unavailable', size / 2, size / 2);
        return false;
    }
}

const qc = document.createElement('canvas');

qc.width = qc.height = 512;

drawQR(qc, qrUrl());

const qTex = new THREE.CanvasTexture(qc);

// keep the squares sharp on the 3D panel
qTex.magFilter = THREE.NearestFilter;

qTex.minFilter = THREE.LinearFilter;

qTex.generateMipmaps = false;

add(new THREE.PlaneGeometry(.8, .8), new THREE.MeshBasicMaterial({ map: qTex }), 0, .1, .05, kp);

const lb = document.createElement('canvas');

lb.width = 256;

lb.height = 40;

const lx = lb.getContext('2d');

lx.fillStyle = '#39ff6a';

lx.font = 'italic 800 26px Segoe UI,sans-serif';

lx.textAlign = 'center';

lx.fillText('Scan to log in', 128, 30);

add(new THREE.PlaneGeometry(.9, .14), new THREE.MeshBasicMaterial({
    map: new THREE.CanvasTexture(lb),
    transparent: true
}), 0, -.5, .05, kp);

// ===== School background: covered outdoor walkway, school building, grass and trees =====
{
    // grass all around
    const grass = add(new THREE.PlaneGeometry(160, 160), M(0x5f8f3e, 0, .95), 0, -.03, 0, S);
    grass.rotation.x = -Math.PI / 2;

    // concrete slab (walkway under the roof and the plaza in front of it)
    const cc = document.createElement('canvas');
    cc.width = cc.height = 64;
    const cx = cc.getContext('2d');
    cx.fillStyle = '#9a9d90';
    cx.fillRect(0, 0, 64, 64);
    cx.strokeStyle = '#7f8276';
    cx.lineWidth = 3;
    cx.strokeRect(0, 0, 64, 64);
    const ct = new THREE.CanvasTexture(cc);
    ct.wrapS = ct.wrapT = THREE.RepeatWrapping;
    ct.repeat.set(20, 6.25);
    const slab = add(new THREE.PlaneGeometry(40, 12.5), new THREE.MeshStandardMaterial({ map: ct, roughness: .9, metalness: 0 }), 0, 0, 1.75, S);
    slab.rotation.x = -Math.PI / 2;
    add(new THREE.BoxGeometry(40, .2, .4), M(0x7d8074, 0, .9), 0, .1, 8.2, S); // curb

    // green guide line on the walkway
    const gl = add(new THREE.PlaneGeometry(40, .08), new THREE.MeshBasicMaterial({ color: 0x3f7a2e }), 0, .01, -3.4, S);
    gl.rotation.x = -Math.PI / 2;

    // school building wall (tan) with a green base band and a maroon top edge
    add(new THREE.BoxGeometry(60, 11, .5), M(0xbba982, 0, .95), 0, 5.5, -4.75, S);
    add(new THREE.BoxGeometry(60, 1.1, .12), M(0x3f6f33, 0, .8), 0, .55, -4.44, S);
    add(new THREE.BoxGeometry(60, .5, .7), M(0x6d4a3a, 0, .8), 0, 11.1, -4.6, S);

    // windows
    const glass = M(0x6f9db8, .1, .3, 0x6f9db8), frameM = M(0xcfc8ad, 0, .7);
    const fg = new THREE.BoxGeometry(2.2, 1.9, .08);
    const wg = new THREE.BoxGeometry(2, 1.7, .06);
    const mv = new THREE.BoxGeometry(.06, 1.7, .08);
    const mh = new THREE.BoxGeometry(2, .06, .08);
    const sg = new THREE.BoxGeometry(2.4, .12, .25);
    for (let k = 0; k < 9; k++) {
        if (k === 2) continue; // the door goes here
        const wx = -14.4 + k * 3.6;
        add(fg, frameM, wx, 3.1, -4.43, S);
        add(wg, glass, wx, 3.1, -4.39, S);
        add(mv, frameM, wx, 3.1, -4.36, S);
        add(mh, frameM, wx, 3.1, -4.36, S);
        add(sg, frameM, wx, 2.15, -4.3, S);
    }

    // double door
    const doorM = M(0x2f6b4a, 0, .6);
    add(new THREE.BoxGeometry(2.6, 3.7, .1), frameM, -7.2, 1.85, -4.4, S);
    add(new THREE.BoxGeometry(1.1, 3.4, .08), doorM, -7.78, 1.7, -4.33, S);
    add(new THREE.BoxGeometry(1.1, 3.4, .08), doorM, -6.62, 1.7, -4.33, S);
    add(new THREE.BoxGeometry(.7, 1, .02), glass, -7.78, 2.4, -4.28, S);
    add(new THREE.BoxGeometry(.7, 1, .02), glass, -6.62, 2.4, -4.28, S);

    // shrubs along the wall
    const shrubG = new THREE.SphereGeometry(.5, 12, 8), shrubM = M(0x3d7a34, 0, .95);
    for (let k = 0; k < 8; k++) {
        const sh = add(shrubG, shrubM, -12.6 + k * 3.6, .4, -3.9, S);
        sh.scale.set(1.3, .85, 1);
    }

    // bulletin board
    add(new THREE.BoxGeometry(3.2, 1.3, .1), M(0x6b4a2a, 0, .8), -5.8, 4.8, -4.43, S);
    add(new THREE.BoxGeometry(3, 1.1, .05), M(0xb58d57, 0, .95), -5.8, 4.8, -4.39, S);
    [[-1.1, 0xe9e4d2], [-.5, 0xf2b632], [.1, 0x7fd0ff], [.7, 0xff9bb0], [1.2, 0xc3e88d]]
        .forEach(([dx, c]) => add(new THREE.BoxGeometry(.45, .6, .02), M(c, 0, .9), -5.8 + dx, 4.8, -4.36, S));

    // wall clock
    const ck = add(new THREE.CylinderGeometry(.5, .5, .08, 32), M(0xe9e4d2, 0, .4), -1.5, 4.8, -4.4, S);
    ck.rotation.x = Math.PI / 2;
    add(new THREE.TorusGeometry(.5, .04, 8, 32), dk, -1.5, 4.8, -4.36, S);
    add(new THREE.BoxGeometry(.04, .3, .02), dk, -1.5, 4.95, -4.34, S);
    add(new THREE.BoxGeometry(.22, .04, .02), dk, -1.39, 4.8, -4.34, S);

    // "Keep our school green" sign
    const gc = document.createElement('canvas');
    gc.width = 512;
    gc.height = 128;
    const gx = gc.getContext('2d');
    gx.fillStyle = '#3f7a2e';
    gx.fillRect(0, 0, 512, 128);
    gx.strokeStyle = '#f3f0e2';
    gx.lineWidth = 6;
    gx.strokeRect(8, 8, 496, 112);
    gx.fillStyle = '#f3f0e2';
    gx.font = '700 44px Georgia,serif';
    gx.textAlign = 'center';
    gx.textBaseline = 'middle';
    gx.fillText('Keep our school green', 256, 66);
    add(new THREE.PlaneGeometry(4, 1.1), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(gc) }), 3.5, 4.8, -4.37, S);

    // ---- Roof over the walkway ----
    // The roof is one-sided: you see it from underneath, but it is invisible from above,
    // so the bin stays visible when you tilt the camera up.
    const rc = document.createElement('canvas');
    rc.width = rc.height = 32;
    const rcx = rc.getContext('2d');
    rcx.fillStyle = '#a9b5bb';
    rcx.fillRect(0, 0, 32, 32);
    rcx.fillStyle = '#8d9aa1';
    rcx.fillRect(0, 0, 6, 32);
    const rt = new THREE.CanvasTexture(rc);
    rt.wrapS = rt.wrapT = THREE.RepeatWrapping;
    rt.repeat.set(36, 1);
    const roof = add(new THREE.PlaneGeometry(36, 7), new THREE.MeshStandardMaterial({ map: rt, roughness: .7, metalness: .1 }), 0, 5.8, -1, S);
    roof.rotation.x = Math.PI / 2;

    // rafters under the roof and a green fascia beam on the front edge
    const rafG = new THREE.BoxGeometry(.25, .3, 7), rafM = M(0x6e6a5c, 0, .8);
    for (let rx = -18; rx <= 18; rx += 3) add(rafG, rafM, rx, 5.65, -1, S);
    add(new THREE.BoxGeometry(36, .5, .3), M(0x3f6f33, 0, .8), 0, 5.85, 2.5, S);

    // ceiling lights
    const lightM = new THREE.MeshBasicMaterial({ color: 0xfff3c4 });
    [-9, -3, 3, 9].forEach(lx2 => add(new THREE.BoxGeometry(1.4, .08, .3), lightM, lx2, 5.72, -1, S));

    // roof posts
    const postM = M(0xa8a392, 0, .85);
    [-15, -9, -4.5, 7.5, 13].forEach(px => {
        add(new THREE.BoxGeometry(.4, 5.6, .4), postM, px, 2.8, 2.3, S);
        add(new THREE.BoxGeometry(.65, .2, .65), postM, px, .1, 2.3, S);
    });

    // trees
    const trunkG = new THREE.CylinderGeometry(.18, .26, 1.8, 8), leafG = new THREE.SphereGeometry(1.3, 12, 10);
    const trunkM = M(0x6b4a2a, 0, .9), leafM = M(0x3f7a2e, 0, .9), leafM2 = M(0x4f8c36, 0, .9);
    [[-19, 5, 1.1], [19, 4, 1.2], [-14, 13, 1], [11, 14, 1.2], [-4, 19, 1.1], [24, 10, 1]].forEach(([tx2, tz, sz], i) => {
        add(trunkG, trunkM, tx2, .9 * sz, tz, S).scale.setScalar(sz);
        add(leafG, i % 2 ? leafM : leafM2, tx2, 2.7 * sz, tz, S).scale.setScalar(sz);
        add(leafG, leafM, tx2 + .5 * sz, 3.6 * sz, tz - .2 * sz, S).scale.setScalar(sz * .7);
    });
}

// ===== 7. Bin screen (drawn on a canvas texture) =====
let st = {
    a: 'Scan QR to login',
    b: 'Use the kiosk',
    p: 0,
    c: '#39ff6a'
};

function paint() {
    sx.fillStyle = '#071109';
    sx.fillRect(0, 0, 320, 160);
    sx.fillStyle = '#39ff6a';
    sx.font = 'italic 800 32px Segoe UI,sans-serif';
    sx.fillText('Smart bin', 14, 40);
    sx.fillStyle = '#fff';
    sx.font = '700 21px Segoe UI,sans-serif';
    sx.fillText(st.a, 14, 86);
    sx.fillStyle = st.c;
    sx.font = '16px Segoe UI,sans-serif';
    sx.fillText(st.b, 14, 112);
    sx.strokeStyle = '#39ff6a';
    sx.lineWidth = 3;
    sx.beginPath();
    sx.arc(274, 34, 20, 0, 7);
    sx.stroke();
    sx.fillStyle = '#39ff6a';
    sx.fillRect(14, 132, 292 * st.p, 8);
    sx.strokeRect(14, 132, 292, 8);
    tex.needsUpdate = true;
}

function drawScreen(a, b, p, c) {
    st = {
        a,
        b,
        p,
        c: c || '#39ff6a'
    };
    paint();
}

function flash(a, b) {
    drawScreen(a, b, 0);
    setTimeout(() => {
        if (active && !busy)
            drawScreen('Ready', 'Place item in bin', 0);
    }, 2000);
}

paint();

// ===== 8. Camera controls (drag to rotate, scroll to zoom) =====
// Lower camera and higher target than before, so the roof shows at the top of the view
let th = .5, ph = .1, dist = 11.5;

const tg = new THREE.Vector3(1.1, 2.4, 0);

function cm() {
    cam.position.set(tg.x + dist * Math.sin(th) * Math.cos(ph), tg.y + dist * Math.sin(ph), tg.z + dist * Math.cos(th) * Math.cos(ph));
    cam.lookAt(tg);
}

let dr = false, lx0 = 0, ly0 = 0, dx0 = 0, dy0 = 0;

cv.onpointerdown = e => {
    dr = true;
    lx0 = dx0 = e.clientX;
    ly0 = dy0 = e.clientY;
    cv.setPointerCapture(e.pointerId);
};

cv.onpointerup = e => {
    dr = false;
    // a click (not a drag) on the QR kiosk counts as scanning it
    if (Math.hypot(e.clientX - dx0, e.clientY - dy0) < 5)
        clickScene(e);
};

function clickScene(e) {
    if (!cur || active || busy)
        return;
    const box = cv.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera({
        x: (e.clientX - box.left) / box.width * 2 - 1,
        y: -((e.clientY - box.top) / box.height) * 2 + 1
    }, cam);
    if (ray.intersectObject(kiosk, true).length)
        $('scan').click();
}

cv.onpointermove = e => {
    if (!dr)
        return;
    th -= (e.clientX - lx0) * .008;
    ph = Math.max(-.05, Math.min(.9, ph + (e.clientY - ly0) * .006));
    lx0 = e.clientX;
    ly0 = e.clientY;
};

cv.addEventListener('wheel', e => {
    e.preventDefault();
    dist = Math.max(6, Math.min(16, dist + e.deltaY * .01));
}, { passive: false });

function rs() {
    const w = cv.clientWidth, h = cv.clientHeight;
    if (!w)
        return;
    R.setSize(w, h, false);
    cam.aspect = w / h;
    cam.updateProjectionMatrix();
}

addEventListener('resize', rs);

// ===== 9. Drop animation and awarding points =====
let anim = null, item = null, door = 0;

function drop(it) {
    busy = true;
    render();
    item = new THREE.Mesh(it.g(), M(it.col, .1, .5));
    if (it.n === 'Banana peel')
        item.rotation.x = Math.PI / 2;
    item.position.set(0, 5.4, -.1);
    S.add(item);
    drawScreen('Detecting...', 'Item detected', .15);
    anim = {
        it,
        t: 0,
        ph: 0
    };
}

function tick(dt) {
    const tgt = anim && anim.ph >= 1 && anim.ph < 4 ? .42 : 0;
    door += (tgt - door) * Math.min(1, dt * 8);
    dA.position.z = -.1 - door;
    dB.position.z = -.1 + door;
    lamps.forEach(m => m.emissiveIntensity += (.15 - m.emissiveIntensity) * Math.min(1, dt * 3));
    if (!anim) {
        beam.material.opacity = 0;
        return;
    }
    const a = anim;
    a.t += dt;
    if (a.ph === 0) {
        item.position.y -= dt * 2.6;
        item.rotation.z += dt * 2;
        if (item.position.y <= 3.4) {
            a.ph = 1;
            a.t = 0;
            drawScreen('Scanning...', 'AI vision analyzing', .4);
        }
    }
    else if (a.ph === 1) {
        beam.material.opacity = .9;
        beam.position.y = 3.4 - Math.min(a.t, 1) * .6;
        item.rotation.y += dt * 4;
        if (a.t > 1.3) {
            a.ph = 2;
            a.t = 0;
            beam.material.opacity = 0;
            const c = CATS[a.it.k];
            drawScreen(a.it.n, 'Identified: ' + c.n, .7, c.c);
        }
    }
    else if (a.ph === 2) {
        lamps[CATS[a.it.k].i].emissiveIntensity = 1.6;
        if (a.t > 1) {
            a.ph = 3;
            a.t = 0;
        }
    }
    else if (a.ph === 3) {
        lamps[CATS[a.it.k].i].emissiveIntensity = 1.6;
        item.position.y -= dt * 3;
        item.scale.multiplyScalar(1 - dt * 1.2);
        if (item.position.y < 2.5) {
            a.ph = 4;
            a.t = 0;
        }
    }
    else if (a.ph === 4 && a.t > .5) {
        S.remove(item);
        award(a.it);
        anim = null;
        busy = false;
        render();
        if (queue.length && active)
            drop(queue.shift()); // next item in the batch
    }
}

function award(it) {
    const c = CATS[it.k], u = users[cur];
    u.pts += c.pts;
    sess += c.pts;
    u.co2 += c.co2;
    u.c[it.k]++;
    u.log.unshift({
        n: it.n,
        k: it.k,
        p: c.pts,
        t: Date.now()
    });
    saveU();
    drawScreen('+' + c.pts + ' points!', c.n + ' sorted', 1, c.c);
    setTimeout(() => {
        if (active && !busy)
            drawScreen('Ready', 'Place item in bin', 0);
    }, 2200);
}

// ===== 10. Render loop =====
let last = performance.now();

(function loop(n) {
    const dt = Math.min(.05, (n - last) / 1000);
    last = n;
    tick(dt);
    cm();
    if (cv.offsetParent)
        R.render(S, cam);
    requestAnimationFrame(loop);
})(last);

// ===== 11. Leaderboard (All-time, This week, Streaks, Sections) =====
let leadMode = 'all';

const LEAD_NOTES = {
    all: 'Total points from verified drops.',
    week: 'Points earned in the last 7 days.',
    streak: 'Current day streak.',
    section: 'Total points by section.'
};

const esc = text => String(text).replace(/[&<>"]/g, ch => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[ch]));

// Build one list of students with every number the board can sort by
function leaderboardStudents() {
    const weekAgo = Date.now() - 7 * 864e5;
    const students = Object.entries(users).map(([id, u]) => ({
        name: u.name,
        section: u.section || u.grade || 'No section',
        total: u.pts,
        week: u.log.filter(e => e.t >= weekAgo).reduce((sum, e) => sum + e.p, 0),
        streak: streak(u).c,
        me: id === cur
    }));
    return students;
}

// Turn the students into board rows for the selected tab
function leaderboardRows() {
    const students = leaderboardStudents();
    if (leadMode === 'section') {
        const sections = {};
        students.forEach(s => {
            if (!sections[s.section]) sections[s.section] = {name: s.section, count: 0, value: 0, me: false};
            sections[s.section].count++;
            sections[s.section].value += s.total;
            if (s.me) sections[s.section].me = true;
        });
        return Object.values(sections).map(s => ({name: s.name, sub: s.count + (s.count === 1 ? ' student' : ' students'), value: s.value, unit: 'pts', me: s.me}));
    }
    const field = {all: 'total', week: 'week', streak: 'streak'}[leadMode];
    return students.map(s => ({
        name: s.name,
        sub: s.section,
        value: s[field],
        unit: leadMode === 'streak' ? (s.streak === 1 ? 'day' : 'days') : 'pts',
        me: s.me
    }));
}

function renderLeaderboard() {
    $('leadNote').textContent = LEAD_NOTES[leadMode];
    document.querySelectorAll('#leadTabs button').forEach(b => b.classList.toggle('on', b.dataset.m === leadMode));
    const rows = leaderboardRows().filter(r => r.value > 0).sort((a, b) => b.value - a.value);
    let rank = 0, previous = null;
    $('lead').innerHTML = rows.map((r, i) => {
        if (r.value !== previous) {
            rank = i + 1;
            previous = r.value;
        }
        return `<div class="lrow ${r.me ? 'me' : ''}"><span class="rank r${rank}">${rank}</span><div class="who">${esc(r.name)}${r.me ? ' (you)' : ''}<div>${esc(r.sub)}</div></div><b>${r.value} ${r.unit}</b></div>`;
    }).join('');
    $('leadMe').textContent = rows.some(r => r.me) ? '' : (rows.length ? "You're not on this board yet." : 'No one on this board yet.');
}

$('leadTabs').onclick = e => {
    const b = e.target.closest('button');
    if (!b) return;
    leadMode = b.dataset.m;
    renderLeaderboard();
};

// ===== 12. Camera scanner: detects every item and counts them =====
// COCO-SSD finds all objects in view; MobileNet is a fallback for single items.
// Values are ITEMS indexes: 0 bottle, 1 paper, 2 can, 3 banana, 4 apple, 5 chips, 6 battery, 7 cup.
const COCO = {
    bottle: 0, book: 1, cup: 7, banana: 3, apple: 4, orange: 4, carrot: 4, broccoli: 4,
    sandwich: 4, donut: 4, cake: 4, pizza: 4, 'hot dog': 4, 'cell phone': 6, remote: 6
};

const RULES = [
    [0, /bottle|jug|lotion|soap dispenser/],
    [1, /paper|envelope|notebook|menu|tissue|binder|book/],
    [2, /\b(can|tin|canister)\b|cocktail shaker/],
    [3, /banana/],
    [4, /granny smith|apple|pomegranate/],
    [5, /packet|plastic bag|pretzel|wrapper/],
    [6, /flashlight|torch|remote control|cassette|lighter|ipod|radio/],
    [7, /\bcup\b|mug|beer glass/]
];

// Names that contain a keyword above but mean something else
const SKIP = /ashcan|trash|garbage|opener|computer|laptop|bucket/;

let stream = null, model = null, det = null, camOn = false, found = {}, frames = [];

$('camPick').innerHTML = ITEMS.map((it, i) => `<button data-i="${i}" type="button">${it.n}</button>`).join('');

const setCam = t => $('camMsg').textContent = t;

// Pick the first guess that matches one of the demo items
function match(preds) {
    for (const p of preds) {
        if (p.probability < .12)
            continue;
        const label = p.className.toLowerCase();
        if (SKIP.test(label))
            continue;
        for (const [i, re] of RULES)
            if (re.test(label))
                return { i, label: p.className.split(',')[0] };
    }
    return null;
}

// Show the list of detected items with + / − quantity buttons
function renderFound() {
    const ids = Object.keys(found).filter(k => found[k] > 0);
    $('camRes').hidden = !ids.length;
    let n = 0, pts = 0;
    $('camList').innerHTML = ids.map(k => {
        const it = ITEMS[k], c = CATS[it.k];
        n += found[k];
        pts += found[k] * c.pts;
        return `<div class="cr"><div><b>${it.n}</b><div class="mu">${c.n} · +${c.pts} pts each</div></div>` +
            `<div class="qty"><button data-q="${k}" data-d="-1" type="button">−</button><b>${found[k]}</b><button data-q="${k}" data-d="1" type="button">+</button></div></div>`;
    }).join('');
    $('camTotal').textContent = ids.length ? n + (n === 1 ? ' item' : ' items') + ' · +' + pts + ' pts total' : '';
}

$('camList').onclick = e => {
    const b = e.target.closest('button[data-q]');
    if (!b) return;
    const k = b.dataset.q;
    found[k] = Math.max(0, Math.min(20, (found[k] || 0) + +b.dataset.d));
    if (!found[k]) delete found[k];
    renderFound();
};

// Draw a colored box and name over every detected object
function drawBoxes(dets) {
    const o = $('camOv'), v = $('camVid');
    o.width = v.videoWidth;
    o.height = v.videoHeight;
    const g = o.getContext('2d');
    g.clearRect(0, 0, o.width, o.height);
    g.lineWidth = Math.max(3, o.width / 200);
    g.font = '600 ' + Math.max(16, o.width / 32) + 'px Segoe UI,sans-serif';
    dets.forEach(d => {
        const [x, y, w, h] = d.bbox, it = ITEMS[COCO[d.class]], c = CATS[it.k];
        g.strokeStyle = c.c;
        g.fillStyle = c.c;
        g.strokeRect(x, y, w, h);
        g.fillText(it.n, x + 4, Math.max(18, y - 6));
    });
}

// Median count over the last frames, so one bad frame doesn't change the result
function stable() {
    const out = {}, keys = new Set(frames.flatMap(f => Object.keys(f)));
    keys.forEach(k => {
        const v = frames.map(f => f[k] || 0).sort((a, b) => a - b);
        const med = v[Math.floor(v.length / 2)];
        if (med >= 1) out[k] = med;
    });
    return out;
}

async function openCam() {
    if (camOn) return;
    camOn = true;
    frames = [];
    found = {};
    $('cam').hidden = false;
    renderFound();
    setCam('Starting camera...');
    try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia)
            throw new Error('nocam');
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
        if (!camOn) {
            stopStream();
            return;
        }
        const v = $('camVid');
        v.srcObject = stream;
        await v.play();
        if (v.videoWidth)
            v.parentNode.style.aspectRatio = v.videoWidth + ' / ' + v.videoHeight;
    }
    catch (err) {
        setCam('Camera not available. Allow camera access (it needs https), or add the items below.');
        return;
    }
    if (!det || !model) {
        setCam('Loading AI models...');
        try {
            [det, model] = await Promise.all([
                det || cocoSsd.load({ base: 'mobilenet_v2' }),
                model || mobilenet.load()
            ]);
        }
        catch (err) {
            setCam('Could not load the AI models. Check your internet connection, or add the items below.');
            return;
        }
    }
    if (!camOn) return;
    setCam('Place all items in view, spaced apart so each one is visible.');
    scanLoop();
}

async function scanLoop() {
    if (!camOn || Object.keys(found).length) return;
    try {
        const v = $('camVid');
        const dets = (await det.detect(v, 20)).filter(d => d.score >= .45 && COCO[d.class] !== undefined);
        drawBoxes(dets);
        const counts = {};
        dets.forEach(d => {
            const i = COCO[d.class];
            counts[i] = (counts[i] || 0) + 1;
        });
        // nothing found by COCO-SSD: ask MobileNet about a single item
        if (!dets.length) {
            const m = match(await model.classify(v, 5));
            if (m) counts[m.i] = 1;
        }
        frames.push(counts);
        if (frames.length > 6) frames.shift();
        if (frames.length >= 4) {
            const out = stable();
            if (Object.keys(out).length) {
                found = out;
                renderFound();
                setCam('Check the quantities. Use + / − to fix any mistakes.');
                return;
            }
        }
    }
    catch (err) {
    }
    setTimeout(scanLoop, 400);
}

function stopStream() {
    if (stream)
        stream.getTracks().forEach(t => t.stop());
    stream = null;
    $('camVid').srcObject = null;
}

function closeCam() {
    camOn = false;
    found = {};
    stopStream();
    $('cam').hidden = true;
}

$('camClose').onclick = closeCam;

$('camBtn').onclick = openCam;

$('camRetry').onclick = () => {
    found = {};
    frames = [];
    renderFound();
    const o = $('camOv');
    o.getContext('2d').clearRect(0, 0, o.width, o.height);
    setCam('Place all items in view, spaced apart so each one is visible.');
    if (det && model) scanLoop();
};

$('camPick').onclick = e => {
    const b = e.target.closest('button');
    if (!b) return;
    found[b.dataset.i] = Math.min(20, (found[b.dataset.i] || 0) + 1);
    renderFound();
    setCam('Check the quantities. Use + / − to fix any mistakes.');
};

// Drop everything found, one item after another
$('camDrop').onclick = () => {
    if (!active || busy) return;
    const list = Object.keys(found).flatMap(k => Array(found[k]).fill(ITEMS[k]));
    if (!list.length) return;
    closeCam();
    queue = list;
    drop(queue.shift());
};

// ===== 13. Large QR window (for scanning with a phone) =====
function refreshQR() {
    const url = qrUrl();
    drawQR(qc, url);
    qTex.needsUpdate = true;
    drawQR($('qrBig'), url);
    $('qrLink').textContent = url;
}

$('qrBtn').onclick = () => {
    refreshQR();
    $('qrModal').hidden = false;
};

$('qrClose').onclick = () => $('qrModal').hidden = true;