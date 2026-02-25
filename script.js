// ── STATE ──────────────────────────────────────────────────
let role = null, uLoc = null, nearHosps = [], selAmb = null, selHosp = null, activeReqId = null, starVal = 0, tripSt = 0, curEta = 5, curReq = null;
let uMap = null, trkMap = null, drvMap = null, hMap = null;
let uMk = null, ambMk = null, drvMk = null;
let etaInt = null, locWatch = null, ambAnimInt = null;

// Firebase placeholders (wire up your own)
let fbDB = null, fbReady = false;
window.addEventListener('firebaseLoaded', () => { fbDB = window.firebaseDB; fbReady = window.firebaseReady; if (fbReady) toast('🔥 Firebase connected — real-time sync active', 'success'); else toast('⚡ Demo mode — Firebase not configured', 'info'); });
setTimeout(() => { if (!fbReady) toast('⚡ Running in demo mode (add your Firebase config)', 'info'); }, 2000);

// In-memory shared state for demo sync
const DS = { requests: [], driverMission: null, ambLoc: null };

// ── ROUTING ────────────────────────────────────────────────
function goPage(id) { document.querySelectorAll('.page').forEach(p => p.classList.remove('active')); document.getElementById(id).classList.add('active'); }
function logout() { clearInterval(etaInt); if (locWatch) navigator.geolocation.clearWatch(locWatch); role = null; goPage('page-landing'); toast('Signed out', 'info'); }

// ── AUTH TABS ──────────────────────────────────────────────
function uTab(t, el) { document.querySelectorAll('#utabs .tab').forEach(x => x.classList.remove('active')); el.classList.add('active'); document.getElementById('ulogin').style.display = t === 'login' ? 'block' : 'none'; document.getElementById('ureg').style.display = t === 'register' ? 'block' : 'none'; }
function sLogin(p) { toast(`ℹ️ Wire up ${p.charAt(0).toUpperCase() + p.slice(1)} OAuth in Firebase console → Authentication → Sign-in providers`, 'info'); }

// ── LOGIN FUNCS ────────────────────────────────────────────
function loginUser() {
    const name = (document.getElementById('ue').value || 'user@demo.com').split('@')[0];
    document.getElementById('uname').textContent = name;
    role = 'user'; goPage('page-user');
    toast(`Welcome ${name}! Tap SOS to request help.`, 'success');
    getLocation();
}
function registerUser() {
    const fn = document.getElementById('rfn').value, em = document.getElementById('re').value;
    if (!fn || !em) { toast('Fill in required fields', 'error'); return; }
    document.getElementById('uname').textContent = fn;
    role = 'user';
    toast(`✅ Account created for ${fn}!`, 'success');
    setTimeout(() => { goPage('page-user'); getLocation(); }, 700);
}
function loginHospital() {
    const sel = document.getElementById('hhosp'); const hname = sel.options[sel.selectedIndex].text;
    document.getElementById('hname').textContent = hname;
    role = 'hospital'; goPage('page-hospital');
    renderFleet(); loadHospDrivers();
    toast(`Welcome, ${hname} admin!`, 'success');
    // Demo: simulate incoming request after 4s
    setTimeout(() => simulateIncoming(), 4000);
}
function loginDriver() {
    role = 'driver'; goPage('page-driver');
    toast('Welcome Raj! You are On Duty.', 'success');
    startLocWatch();
    setTimeout(() => showDemoMission(), 5000);
}

// ── GEOLOCATION ────────────────────────────────────────────
function getLocation() {
    if (!navigator.geolocation) { uLoc = { lat: 28.6139, lng: 77.209 }; fetchHosps(); return; }
    navigator.geolocation.getCurrentPosition(
        p => { uLoc = { lat: p.coords.latitude, lng: p.coords.longitude }; fetchHosps(); toast('📍 Location detected', 'success'); },
        () => { uLoc = { lat: 28.6139, lng: 77.209 }; fetchHosps(); toast('Using fallback location (Delhi)', 'info'); },
        { enableHighAccuracy: true, timeout: 8000 }
    );
}

// ── OVERPASS: Real nearby hospitals ────────────────────────
async function fetchHosps() {
    if (!uLoc) return;
    const { lat, lng } = uLoc;
    const q = `[out:json][timeout:12];node["amenity"="hospital"](around:6000,${lat},${lng});out body 10;`;
    try {
        const r = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: 'data=' + encodeURIComponent(q) });
        const d = await r.json();
        nearHosps = d.elements.slice(0, 8).map((el, i) => ({ id: el.id, name: el.tags?.name || `Hospital ${i + 1}`, lat: el.lat, lng: el.lon, dist: calcDist(lat, lng, el.lat, el.lon), ambs: mkAmbs(el.id, i) })).sort((a, b) => a.dist - b.dist);
        if (!nearHosps.length) nearHosps = mockHosps(lat, lng);
        document.getElementById('nhc').textContent = nearHosps.length;
        toast(`🏥 ${nearHosps.length} hospitals loaded from OpenStreetMap`, 'success');
    } catch (e) {
        nearHosps = mockHosps(lat, lng);
        document.getElementById('nhc').textContent = nearHosps.length;
        toast('Using mock hospitals (Overpass unavailable)', 'warn');
    }
}
function mockHosps(lat, lng) {
    return [{ id: 1, name: 'City General Hospital', lat: lat + .012, lng: lng + .008, dist: 1.4, ambs: mkAmbs(1, 0) },
    { id: 2, name: 'Metro Medical Center', lat: lat - .009, lng: lng + .015, dist: 2.1, ambs: mkAmbs(2, 1) },
    { id: 3, name: 'Apollo Emergency Care', lat: lat + .018, lng: lng - .012, dist: 2.8, ambs: mkAmbs(3, 2) }];
}
function mkAmbs(hid, off) {
    const names = [['Raj Kumar', 'Priya Sharma'], ['Amit Singh', 'Deepak Kumar'], ['Kavita Rao', 'Suresh Patel']];
    return [{ id: `AMB-${String(hid * 10 + 1).padStart(3, '0')}`, type: 'ALS Advanced', driver: names[off % 3][0], eta: Math.floor(Math.random() * 5) + 3, dist: (Math.random() * 1.5 + .5).toFixed(1), rating: (4.6 + Math.random() * .4).toFixed(1) },
    { id: `AMB-${String(hid * 10 + 2).padStart(3, '0')}`, type: 'BLS Basic', driver: names[off % 3][1], eta: Math.floor(Math.random() * 6) + 5, dist: (Math.random() * 2 + 1).toFixed(1), rating: (4.4 + Math.random() * .5).toFixed(1) }];
}
function calcDist(a, b, c, d) { const R = 6371, dL = (c - a) * Math.PI / 180, dl = (d - b) * Math.PI / 180, x = Math.sin(dL / 2) ** 2 + Math.cos(a * Math.PI / 180) * Math.cos(c * Math.PI / 180) * Math.sin(dl / 2) ** 2; return Math.round(R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x)) * 10) / 10; }

// ── SOS FLOW ───────────────────────────────────────────────
function triggerSOS() {
    document.getElementById('u-idle').style.display = 'none';
    document.getElementById('u-scan').style.display = 'block';
    toast('🚨 Emergency alert sent!', 'error');
    setTimeout(() => {
        initUserMap();
        document.getElementById('scanstatus').textContent = 'Location found. Loading hospitals...';
        setTimeout(() => {
            if (nearHosps.length) showHospList();
            else setTimeout(() => showHospList(), 1500);
        }, 1800);
    }, 400);
}
function cancelSOS() {
    document.getElementById('u-scan').style.display = 'none';
    document.getElementById('u-idle').style.display = 'block';
    if (uMap) { uMap.remove(); uMap = null; }
    toast('Emergency cancelled', 'info');
}

// ── USER MAP ───────────────────────────────────────────────
function initUserMap() {
    if (uMap) { uMap.remove(); uMap = null; }
    if (!uLoc) return;
    uMap = L.map('umap', { zoomControl: true }).setView([uLoc.lat, uLoc.lng], 14);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap', maxZoom: 19 }).addTo(uMap);
    const ui = L.divIcon({ className: '', html: '<div style="background:#E8280A;width:16px;height:16px;border-radius:50%;border:3px solid #fff;box-shadow:0 2px 10px rgba(232,40,10,.6);"></div>', iconSize: [16, 16], iconAnchor: [8, 8] });
    uMk = L.marker([uLoc.lat, uLoc.lng], { icon: ui }).addTo(uMap).bindPopup('<b>📍 Your Location</b>');
    L.circle([uLoc.lat, uLoc.lng], { color: '#E8280A', fillColor: '#E8280A', fillOpacity: .06, radius: 600 }).addTo(uMap);
}
function showHospList() {
    if (!uMap) return;
    document.getElementById('hospsel').style.display = 'block';
    document.getElementById('mcard-title').textContent = `🏥 ${nearHosps.length} Found`;
    document.getElementById('mcard-detail').textContent = 'Select ambulance below';
    const hi = L.divIcon({ className: '', html: '<div style="background:#1B6EF3;width:14px;height:14px;border-radius:50%;border:2px solid #fff;box-shadow:0 2px 8px rgba(27,110,243,.5);"></div>', iconSize: [14, 14], iconAnchor: [7, 7] });
    nearHosps.forEach(h => L.marker([h.lat, h.lng], { icon: hi }).addTo(uMap).bindPopup(`<b>🏥 ${h.name}</b><br>${h.dist}km away`));
    const pts = [[uLoc.lat, uLoc.lng], ...nearHosps.map(h => [h.lat, h.lng])];
    uMap.fitBounds(pts, { padding: [30, 30] });
    const wrap = document.getElementById('hosplist');
    wrap.innerHTML = nearHosps.map(h => `
    <div style="margin-bottom:16px;">
      <div style="font-family:'Syne',sans-serif;font-weight:700;font-size:.95rem;margin-bottom:10px;display:flex;align-items:center;gap:8px;">
        🏥 ${h.name} <span class="badge bgy">${h.dist} km</span>
      </div>
      <div class="agrid">${h.ambs.map(a => `
        <div class="ac" id="ac-${a.id}">
          <div class="ahead"><div class="aid">🚑 ${a.id}</div><span class="badge bg">Available</span></div>
          <div class="ameta">
            <div class="ami"><span>ETA</span><strong class="tg">${a.eta} min</strong></div>
            <div class="ami"><span>Distance</span><strong>${a.dist} km</strong></div>
            <div class="ami"><span>Type</span><strong>${a.type}</strong></div>
            <div class="ami"><span>Driver</span><strong>${a.driver}</strong></div>
            <div class="ami"><span>Rating</span><strong>⭐ ${a.rating}</strong></div>
          </div>
          <button class="btnbook" onclick="bookAmb('${h.id}','${a.id}','${h.name}','${a.driver}','${a.type}',${a.eta},${h.lat},${h.lng})">Book This Ambulance →</button>
        </div>`).join('')}
      </div>
    </div>`).join('');
    toast(`✅ Select an ambulance to book`, 'success');
}

// ── BOOKING ────────────────────────────────────────────────
function bookAmb(hid, aid, hname, driver, type, eta, hlat, hlng) {
    selAmb = { hid, aid, hname, driver, type, eta: parseInt(eta), hlat: parseFloat(hlat), hlng: parseFloat(hlng) };
    curEta = parseInt(eta);
    const rid = 'EM-' + Math.floor(Math.random() * 9000 + 1000);
    activeReqId = rid;
    const req = { id: rid, patient: document.getElementById('uname').textContent, loc: uLoc, hospital: hname, hlat: parseFloat(hlat), hlng: parseFloat(hlng), amb: aid, driver, type, eta: curEta, status: 'confirmed', emergency: 'Emergency', time: new Date().toISOString() };
    DS.requests.push(req);
    DS.driverMission = req;
    curReq = req;
    // Switch to tracking
    document.getElementById('u-scan').style.display = 'none';
    document.getElementById('u-track').style.display = 'block';
    document.getElementById('trk-title').textContent = 'Ambulance Confirmed! 🎉';
    document.getElementById('trk-sub').textContent = `${aid} • ${driver} is on the way`;
    document.getElementById('trk-eta').textContent = `ETA: ${curEta} min`;
    document.getElementById('td-name').textContent = driver;
    document.getElementById('td-veh').textContent = `${aid} • ${type}`;
    document.getElementById('td-ph').textContent = '+91 98765 43210';
    document.getElementById('td-eta').textContent = `${curEta} min`;
    document.getElementById('trkambid').textContent = aid;
    toast(`✅ ${aid} booked! ${driver} is on the way.`, 'success');
    initTrackMap(parseFloat(hlat), parseFloat(hlng));
    startEta();
    // Notify hospital side (demo)
    setTimeout(() => renderReqCard(req), 500);
}

// ── TRACK MAP ──────────────────────────────────────────────
function initTrackMap(hlat, hlng) {
    if (trkMap) { trkMap.remove(); trkMap = null; }
    if (!uLoc) return;
    setTimeout(() => {
        trkMap = L.map('trkmap').setView([uLoc.lat, uLoc.lng], 14);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(trkMap);
        const ui = L.divIcon({ className: '', html: '<div style="background:#E8280A;width:14px;height:14px;border-radius:50%;border:3px solid #fff;box-shadow:0 2px 8px rgba(232,40,10,.5);"></div>', iconSize: [14, 14], iconAnchor: [7, 7] });
        const ai = L.divIcon({ className: '', html: '<div style="font-size:22px;">🚑</div>', iconSize: [28, 28], iconAnchor: [14, 14] });
        const hi = L.divIcon({ className: '', html: '<div style="font-size:22px;">🏥</div>', iconSize: [28, 28], iconAnchor: [14, 14] });
        L.marker([uLoc.lat, uLoc.lng], { icon: ui }).addTo(trkMap).bindPopup('📍 Your Location');
        L.marker([hlat, hlng], { icon: hi }).addTo(trkMap).bindPopup(`🏥 ${selAmb?.hname || 'Hospital'}`);
        // Ambulance starts near hospital, moves toward user
        const sl = hlat + (uLoc.lat - hlat) * .08, sn = hlng + (uLoc.lng - hlng) * .08;
        ambMk = L.marker([sl, sn], { icon: ai }).addTo(trkMap).bindPopup(`🚑 ${selAmb?.aid}`);
        DS.ambLoc = { lat: sl, lng: sn };
        trkMap.fitBounds([[uLoc.lat, uLoc.lng], [hlat, hlng]], { padding: [40, 40] });
        animateAmb(sl, sn, uLoc.lat, uLoc.lng, curEta);
    }, 250);
}
function animateAmb(fl, fn, tl, tn, etaMins) {
    let p = 0; const steps = 80;
    ambAnimInt = setInterval(() => {
        p += 1 / steps;
        if (p >= 1) { p = 1; clearInterval(ambAnimInt); ambArrived(); }
        const lat = fl + (tl - fl) * p, lng = fn + (tn - fn) * p;
        if (ambMk) ambMk.setLatLng([lat, lng]);
        DS.ambLoc = { lat, lng };
        // sync to driver map
        if (drvMk) drvMk.setLatLng([lat, lng]);
    }, etaMins * 60 * 1000 / steps / 8); // 8x speed for demo
}
function startEta() {
    etaInt = setInterval(() => {
        if (curEta > 0) { curEta--; document.getElementById('trk-eta').textContent = curEta === 0 ? 'Arriving Now!' : 'ETA: ' + curEta + ' min'; document.getElementById('td-eta').textContent = curEta === 0 ? 'Now!' : curEta + ' min'; document.getElementById('trketa').textContent = '~' + curEta + ' min'; }
    }, 3000);
}
function ambArrived() {
    clearInterval(etaInt);
    toast('🚑 Ambulance ARRIVED at your location!', 'success');
    const ss = document.querySelectorAll('#utracker .tstep');
    ss.forEach((s, i) => { s.classList.remove('active'); if (i <= 2) { s.classList.add('done'); s.querySelector('.tdot').textContent = '✓'; } });
    ss[3].classList.add('active');
    document.getElementById('tripbadge').textContent = 'Arrived';
    document.getElementById('tripbadge').className = 'badge bb';
    setTimeout(() => {
        ss[3].classList.remove('active'); ss[3].classList.add('done'); ss[3].querySelector('.tdot').textContent = '✓';
        ss[4].classList.add('done'); ss[4].querySelector('.tdot').textContent = '✓';
        document.getElementById('tripbadge').textContent = '✅ At Hospital';
        document.getElementById('tripbadge').className = 'badge bg';
        document.getElementById('ratecard').style.display = 'block';
        toast('🏥 You have arrived at the hospital!', 'success');
        if (curReq) curReq.status = 'arrived';
    }, 8000);
}
function callDriver() { toast('📞 Calling driver...', 'info'); }
function shareLocation() { toast('📍 Location shared with driver', 'success'); }

// STARS
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('#starrow .star').forEach(s => {
        s.addEventListener('mouseover', () => document.querySelectorAll('#starrow .star').forEach(st => st.classList.toggle('lit', +st.dataset.v <= +s.dataset.v)));
        s.addEventListener('mouseleave', () => document.querySelectorAll('#starrow .star').forEach(st => st.classList.toggle('lit', +st.dataset.v <= starVal)));
        s.addEventListener('click', () => { starVal = +s.dataset.v; document.querySelectorAll('#starrow .star').forEach(st => st.classList.toggle('lit', +st.dataset.v <= starVal)); });
    });
});
function submitRating() {
    if (!starVal) { toast('Please select a rating', 'error'); return; }
    toast(`🎉 Rated ${starVal} ⭐ — Thank you!`, 'success');
    document.getElementById('ratecard').style.display = 'none';
    setTimeout(() => { document.getElementById('u-track').style.display = 'none'; document.getElementById('u-idle').style.display = 'block'; curEta = 5; starVal = 0; selAmb = null; }, 1200);
}

// ── HOSPITAL ───────────────────────────────────────────────
function htab(t, el) {
    document.querySelectorAll('#page-hospital .tab').forEach(x => x.classList.remove('active')); el.classList.add('active');
    ['req', 'fleet', 'drivers', 'track', 'stats'].forEach(x => { const e = document.getElementById('ht-' + x); if (e) e.style.display = x === t ? 'block' : 'none'; });
    if (t === 'track') setTimeout(() => { if (!hMap) initHospMap(); }, 100);
}

let fleetData = [{ id: 'AMB-001', type: 'ALS Advanced', driver: 'Raj Kumar', reg: 'MH-01-AA-0001', status: 'available' }, { id: 'AMB-003', type: 'BLS Basic', driver: 'Priya Sharma', reg: 'MH-01-AB-0003', status: 'dispatched' }, { id: 'AMB-007', type: 'ICU Mobile', driver: 'Amit Singh', reg: 'MH-01-AC-0007', status: 'available' }, { id: 'AMB-012', type: 'ALS Advanced', driver: '—', reg: 'MH-01-AD-0012', status: 'maintenance' }];

function renderFleet() {
    const c = document.getElementById('fleetlist'); if (!c) return;
    const smap = { available: 'bg', dispatched: 'bb', maintenance: 'bgy' };
    c.innerHTML = fleetData.map(f => `<div class="fcard"><div class="fchead"><div class="fcid">🚑 ${f.id}</div><span class="badge ${smap[f.status] || 'bgy'}">${f.status}</span></div><div class="fcmeta"><span><strong>${f.type}</strong></span><span>Driver: <strong>${f.driver}</strong></span><span>Reg: <strong>${f.reg}</strong></span></div></div>`).join('');
}
function loadHospDrivers() { }
function addFleet() {
    const id = document.getElementById('flid').value.trim();
    if (!id) { toast('Enter Unit ID', 'error'); return; }
    fleetData.push({ id, type: document.getElementById('fltype').value, driver: document.getElementById('fldrv').value || '—', reg: document.getElementById('flreg').value || '—', status: 'available' });
    renderFleet();
    ['flid', 'fldrv', 'flreg'].forEach(x => document.getElementById(x).value = '');
    toast(`🚑 ${id} added to fleet!`, 'success');
    document.getElementById('hsav').textContent = parseInt(document.getElementById('hsav').textContent) + 1;
}
function addDriver() {
    const n = document.getElementById('drn').value.trim(); if (!n) { toast('Enter driver name', 'error'); return; }
    const ph = document.getElementById('drph').value, veh = document.getElementById('drveh').value;
    const tb = document.getElementById('drvtable');
    const tr = document.createElement('tr');
    tr.innerHTML = `<td><strong>${n}</strong></td><td>${ph || '—'}</td><td>${veh || '—'}</td><td><span class="badge bgy">Off Duty</span></td><td>0</td>`;
    tb.appendChild(tr);
    ['drn', 'drph', 'drlic', 'drveh'].forEach(x => document.getElementById(x).value = '');
    toast(`👤 ${n} registered!`, 'success');
}
function simulateIncoming() {
    const req = { id: 'EM-' + Math.floor(Math.random() * 9000 + 1000), patient: 'Demo Patient', emergency: 'Chest Pain', hospital: document.getElementById('hname').textContent, time: new Date().toISOString(), status: 'pending', loc: uLoc || { lat: 28.6139, lng: 77.209 } };
    DS.requests.push(req);
    renderReqCard(req);
    toast(`🚨 New emergency #${req.id}!`, 'error');
    document.getElementById('nalert').style.display = 'flex';
    document.getElementById('hsa').textContent = parseInt(document.getElementById('hsa').textContent) + 1;
}
function renderReqCard(req) {
    const c = document.getElementById('lreqs');
    if (c.querySelector('.est')) c.innerHTML = '';
    const d = document.createElement('div');
    d.className = 'mc urg'; d.id = 'req-' + req.id;
    d.innerHTML = `<div class="mhead"><div><div class="mtitle">#${req.id}</div><div style="font-size:.78rem;color:var(--sub);">${new Date(req.time).toLocaleTimeString()}</div></div><span class="badge br rqs">PENDING</span></div>
  <div class="pgrid"><div class="pi"><span>Patient</span><strong>${req.patient}</strong></div><div class="pi"><span>Emergency</span><strong class="tr">${req.emergency || 'Emergency'}</strong></div><div class="pi"><span>Hospital</span><strong>${req.hospital}</strong></div><div class="pi"><span>ETA Requested</span><strong>${req.eta || '—'} min</strong></div></div>
  <div class="arow rqa">
    <button class="bsm acc" onclick="dispatch('${req.id}')">🚑 Dispatch Ambulance</button>
    <button class="bsm gh" onclick="trackReq('${req.id}')">📍 View on Map</button>
    <button class="bsm dng" onclick="dismissReq('${req.id}')">Dismiss</button>
  </div>`;
    c.prepend(d);
}
function dispatch(rid) {
    toast(`🚑 Dispatched for #${rid}`, 'success');
    const c = document.getElementById('req-' + rid);
    if (c) { c.querySelector('.rqs').innerHTML = 'DISPATCHED'; c.querySelector('.rqs').className = 'badge bb rqs'; c.querySelector('.rqa').innerHTML = `<button class="bsm cpl" onclick="completeReq('${rid}')">✅ Complete</button><button class="bsm gh" onclick="trackReq('${rid}')">📍 Track Live</button>`; }
    document.getElementById('hsa').textContent = Math.max(0, parseInt(document.getElementById('hsa').textContent) - 1);
    document.getElementById('hsd').textContent = parseInt(document.getElementById('hsd').textContent) + 1;
    const req = DS.requests.find(r => r.id === rid);
    if (req) { req.status = 'dispatched'; }
    // Update dispatch list
    const dl = document.getElementById('displist');
    if (dl.querySelector('.est')) dl.innerHTML = '';
    const dd = document.createElement('div');
    dd.style = 'background:var(--bg2);border:1px solid var(--border);border-radius:14px;padding:16px;margin-bottom:10px;display:flex;align-items:center;justify-content:space-between;font-size:.86rem;';
    dd.innerHTML = `<div><strong>#${rid}</strong> • ${req?.patient || 'Patient'}</div><div class="badge bb">En Route</div>`;
    dl.prepend(dd);
}
function completeReq(rid) {
    toast(`✅ #${rid} complete`, 'success');
    const c = document.getElementById('req-' + rid); if (c) c.remove();
    document.getElementById('hsc').textContent = parseInt(document.getElementById('hsc').textContent) + 1;
    document.getElementById('hsd').textContent = Math.max(0, parseInt(document.getElementById('hsd').textContent) - 1);
}
function dismissReq(rid) { const c = document.getElementById('req-' + rid); if (c) c.remove(); }
function trackReq(rid) { htab('track', document.querySelectorAll('#page-hospital .tab')[3]); }

// HOSPITAL TRACKING MAP
function initHospMap() {
    if (hMap) return;
    const c = uLoc || { lat: 28.6139, lng: 77.209 };
    setTimeout(() => {
        hMap = L.map('hospmap').setView([c.lat, c.lng], 13);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(hMap);
        const ai = L.divIcon({ className: '', html: '<div style="font-size:20px;">🚑</div>', iconSize: [24, 24], iconAnchor: [12, 12] });
        const m1 = L.marker([c.lat + .009, c.lng - .006], { icon: ai }).addTo(hMap).bindPopup('🚑 AMB-001 — En Route');
        const m2 = L.marker([c.lat - .008, c.lng + .013], { icon: ai }).addTo(hMap).bindPopup('🚑 AMB-003 — On Scene');
        // If we have actual ambulance location from DS
        let t = 0;
        setInterval(() => { t += .001; m1.setLatLng([c.lat + .009 - t, c.lng - .006 + t]); }, 1500);
        // Sync with booking if active
        if (DS.ambLoc) {
            const rm = L.marker([DS.ambLoc.lat, DS.ambLoc.lng], { icon: ai }).addTo(hMap).bindPopup(`🚑 ${selAmb?.aid || 'Active Unit'}`);
            setInterval(() => { if (DS.ambLoc) rm.setLatLng([DS.ambLoc.lat, DS.ambLoc.lng]); }, 2000);
        }
        toast('🗺️ Fleet tracking map loaded', 'success');
    }, 200);
}

// ── DRIVER ─────────────────────────────────────────────────
function toggleDuty(cb) {
    document.getElementById('dlbl').textContent = cb.checked ? 'On Duty' : 'Off Duty';
    document.getElementById('dlbl').style.color = cb.checked ? 'var(--green)' : 'var(--muted)';
    toast(cb.checked ? '✅ You are On Duty' : '💤 Off Duty', 'info');
}
function startLocWatch() {
    if (!navigator.geolocation) return;
    locWatch = navigator.geolocation.watchPosition(p => {
        if (drvMk) drvMk.setLatLng([p.coords.latitude, p.coords.longitude]);
        if (DS.ambLoc) DS.ambLoc = { lat: p.coords.latitude, lng: p.coords.longitude };
    }, () => { }, { enableHighAccuracy: true });
}
function showDemoMission() {
    const req = { id: 'EM-' + Math.floor(Math.random() * 9000 + 1000), patient: 'Ananya Mehta', emergency: 'Chest Pain', pickup: 'Sector 15, Block C', hospital: 'City General Hospital', plat: (uLoc?.lat || 28.6139) + .005, plng: (uLoc?.lng || 77.209) - .003, hlat: (uLoc?.lat || 28.6139) + .014, hlng: (uLoc?.lng || 77.209) + .009 };
    curReq = req; activeReqId = req.id;
    document.getElementById('nomission').style.display = 'none';
    document.getElementById('inmission').style.display = 'block';
    document.getElementById('mi-id').textContent = '#' + req.id;
    document.getElementById('mi-pat').textContent = req.patient;
    document.getElementById('mi-emg').textContent = req.emergency;
    document.getElementById('mi-pkp').textContent = req.pickup;
    document.getElementById('mi-hosp').textContent = req.hospital;
    toast(`🚨 Mission #${req.id} — ${req.patient}`, 'error');
}
function acceptMission() {
    document.getElementById('inmission').style.display = 'none';
    document.getElementById('acttrip').style.display = 'block';
    document.getElementById('at-id').textContent = '#' + (curReq?.id || 'EM-0000');
    document.getElementById('at-pat').textContent = curReq?.patient || 'Patient';
    document.getElementById('at-emg').textContent = curReq?.emergency || 'Emergency';
    if (curReq) curReq.status = 'driver_accepted';
    tripSt = 1;
    toast('✅ Mission accepted! Navigate to patient.', 'success');
    initDrvMap();
}
function declineMission() { document.getElementById('inmission').style.display = 'none'; document.getElementById('nomission').style.display = 'block'; toast('Mission declined', 'info'); }

function initDrvMap() {
    if (drvMap) { drvMap.remove(); drvMap = null; }
    setTimeout(() => {
        const dl = uLoc || { lat: 28.6139 + .01, lng: 77.209 - .008 };
        const pl = { lat: curReq?.plat || dl.lat - .009, lng: curReq?.plng || dl.lng + .005 };
        drvMap = L.map('drvmap').setView([dl.lat, dl.lng], 14);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(drvMap);
        const di = L.divIcon({ className: '', html: '<div style="font-size:22px;">🚑</div>', iconSize: [28, 28], iconAnchor: [14, 14] });
        const pi = L.divIcon({ className: '', html: '<div style="background:#E8280A;width:14px;height:14px;border-radius:50%;border:3px solid #fff;box-shadow:0 2px 10px rgba(232,40,10,.6);"></div>', iconSize: [14, 14], iconAnchor: [7, 7] });
        drvMk = L.marker([dl.lat, dl.lng], { icon: di }).addTo(drvMap).bindPopup('🚑 Your Position');
        L.marker([pl.lat, pl.lng], { icon: pi }).addTo(drvMap).bindPopup('📍 Patient');
        // Draw a simple line route
        L.polyline([[dl.lat, dl.lng], [pl.lat, pl.lng]], { color: '#1B6EF3', weight: 4, dashArray: '8 4' }).addTo(drvMap);
        drvMap.fitBounds([[dl.lat, dl.lng], [pl.lat, pl.lng]], { padding: [30, 30] });
        const dist = calcDist(dl.lat, dl.lng, pl.lat, pl.lng);
        document.getElementById('navdest').textContent = '→ Patient pickup';
        document.getElementById('naveta').textContent = `~${Math.ceil(dist * 2)} min`;
    }, 250);
}

const stepLabels = ['Arrived at Patient →', 'Patient On Board →', 'En Route to Hospital →', 'Arrived at Hospital — Complete'];
const stepMsgs = ['Patient confirmed!', 'Heading to hospital!', 'Arrived at hospital!', '✅ Mission complete!'];
function nextStep() {
    tripSt++;
    const steps = [null, 'ds2', 'ds3', 'ds4', 'ds5'];
    if (tripSt <= 4) {
        const prev = document.getElementById(steps[tripSt]);
        if (prev) { prev.classList.remove('active'); prev.classList.add('done'); prev.querySelector('.tdot').textContent = '✓'; }
        if (tripSt < 4) { const nx = document.getElementById(steps[tripSt + 1]); if (nx) nx.classList.add('active'); }
        toast(stepMsgs[tripSt - 1] || 'Done', 'success');
        const btn = document.getElementById('nxtbtn');
        if (btn && tripSt < 4) btn.textContent = stepLabels[tripSt];
        // Update driver map for hospital leg
        if (tripSt === 3 && curReq && drvMap && drvMk) {
            const hl = L.divIcon({ className: '', html: '<div style="font-size:22px;">🏥</div>', iconSize: [28, 28], iconAnchor: [14, 14] });
            L.marker([curReq.hlat, curReq.hlng], { icon: hl }).addTo(drvMap).bindPopup('🏥 Hospital');
            L.polyline([[curReq.plat || 28.614, curReq.plng || 77.21], [curReq.hlat, curReq.hlng]], { color: '#00A86B', weight: 4, dashArray: '8 4' }).addTo(drvMap);
            document.getElementById('navdest').textContent = '→ Hospital delivery';
            if (curReq) curReq.status = 'at_hospital';
        }
        if (tripSt === 4) {
            document.getElementById('dtrips').textContent = parseInt(document.getElementById('dtrips').textContent) + 1;
            document.getElementById('tripact').innerHTML = '<div style="color:var(--green);font-family:\'Syne\',sans-serif;font-weight:700;">✅ Mission Complete! Awaiting next dispatch.</div>';
            setTimeout(() => { document.getElementById('acttrip').style.display = 'none'; document.getElementById('nomission').style.display = 'block'; tripSt = 0; activeReqId = null; }, 5000);
        }
    }
}
function callPatient() { toast('📞 Calling patient...', 'info'); }

// ── TOAST ──────────────────────────────────────────────────
function toast(msg, type = 'info') {
    const icons = { success: '✅', error: '🚨', info: 'ℹ️', warn: '⚠️' };
    const c = document.getElementById('tst');
    const d = document.createElement('div');
    d.className = `tos ${type}`;
    d.innerHTML = `<span class="tic">${icons[type] || 'ℹ️'}</span><span class="tmsg">${msg}</span><button class="tcls" onclick="this.closest('.tos').remove()">✕</button>`;
    c.prepend(d);
    setTimeout(() => d.remove(), 5000);
}