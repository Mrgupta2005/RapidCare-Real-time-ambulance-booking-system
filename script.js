
'use strict';

// ── LOCAL STORAGE DATABASE ─────────────────────────────────
const DB = {
    save: (key, val) => { try { localStorage.setItem('rc_' + key, JSON.stringify(val)); } catch (e) { } },
    load: (key, def = null) => { try { const v = localStorage.getItem('rc_' + key); return v ? JSON.parse(v) : def; } catch (e) { return def; } },
    users: function () { return this.load('users', {}); },
    hospitals: function () { return this.load('hospitals', {}); },
    drivers: function () { return this.load('drivers', {}); },
    requests: function () { return this.load('requests', []); },
    saveUser: function (u) { const d = this.users(); d[u.email] = u; this.save('users', d); },
    saveHosp: function (h) { const d = this.hospitals(); d[h.email] = h; this.save('hospitals', d); },
    saveDriver: function (d) { const dd = this.drivers(); dd[d.email] = d; this.save('drivers', dd); },
    saveRequest: function (r) { const d = this.requests(); d.unshift(r); this.save('requests', d.slice(0, 100)); },
    updateRequest: function (id, patch) {
        const d = this.requests(); const i = d.findIndex(r => r.id === id);
        if (i >= 0) { Object.assign(d[i], patch); this.save('requests', d); }
    }
};

// Seed demo accounts
(function seedDemo() {
    const u = DB.users(); if (!u['user@demo.com']) DB.saveUser({ email: 'user@demo.com', pass: 'user123', name: 'Demo Patient', phone: '+91 98765 43210', blood: 'O+', role: 'user' });
    const h = DB.hospitals(); if (!h['admin@hospital.com']) DB.saveHosp({ email: 'admin@hospital.com', pass: 'hospital123', name: 'City General Hospital', city: 'New Delhi', role: 'hospital' });
    const d = DB.drivers(); if (!d['driver@demo.com']) DB.saveDriver({ email: 'driver@demo.com', pass: 'driver123', name: 'Raj Kumar', vehicle: 'AMB-001', role: 'driver' });
})();

// ── GLOBAL STATE ───────────────────────────────────────────
let role = null, curUser = null, uLoc = null, nearHosps = [], selAmb = null, selHosp = null;
let activeReqId = null, curReq = null, starVal = 0, tripSt = 0, curEta = 5;
let uMap = null, trkMap = null, drvMap = null, hMap = null;
let uMk = null, ambMk = null, drvMk = null;
let etaInt = null, locWatch = null, routeCtrl = null, drvRouteCtrl = null;
let fleetData = [
    { id: 'AMB-001', type: 'ALS Advanced', driver: 'Raj Kumar', reg: 'MH-01-AA-0001', status: 'available' },
    { id: 'AMB-003', type: 'BLS Basic', driver: 'Priya Sharma', reg: 'MH-01-AB-0003', status: 'dispatched' },
    { id: 'AMB-007', type: 'ICU Mobile', driver: 'Amit Singh', reg: 'MH-01-AC-0007', status: 'available' },
    { id: 'AMB-012', type: 'ALS Advanced', driver: '—', reg: 'MH-01-AD-0012', status: 'maintenance' },
];

// Shared in-memory for cross-tab demo sync
const DS = { requests: [], driverMission: null, ambLoc: null };

// ── NAVBAR SCROLL EFFECT ───────────────────────────────────
window.addEventListener('scroll', () => {
    const nav = document.getElementById('main-navbar');
    if (nav) nav.classList.toggle('scrolled', window.scrollY > 50);
});

// ── PAGE ROUTER ─────────────────────────────────────────────
function goPage(id) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const el = document.getElementById(id);
    if (el) { el.classList.add('active'); window.scrollTo(0, 0); }
}

// ── AUTH TAB HELPERS ────────────────────────────────────────
function uTab(t, el) {
    document.querySelectorAll('#utabs .tab2').forEach(x => x.classList.remove('active')); el.classList.add('active');
    document.getElementById('ulogin').style.display = t === 'login' ? 'block' : 'none';
    document.getElementById('ureg').style.display = t === 'register' ? 'block' : 'none';
}
function hAuthTab(t, el) {
    document.querySelectorAll('#htabs .tab2').forEach(x => x.classList.remove('active')); el.classList.add('active');
    document.getElementById('hlogin').style.display = t === 'hlogin' ? 'block' : 'none';
    document.getElementById('hreg').style.display = t === 'hreg' ? 'block' : 'none';
}


// ── LOGIN FUNCS ─────────────────────────────────────────────
function loginUser() {
    const email = document.getElementById('ue').value.trim();
    const pass = document.getElementById('up').value.trim();

    if (!email || !pass) {
        toast('Please fill all fields', 'error');
        return;
    }

    const users = DB.users();
    const user = users[email];

    if (!user) {
        toast('Account not found. Please register.', 'error');
        return;
    }

    if (user.pass !== pass) {
        toast('Incorrect password', 'error');
        return;
    }

    curUser = user;
    role = 'user';

    document.getElementById('uname').textContent = user.name;

    goPage('pg-user');
    toast(`Welcome ${user.name}`, 'success');
    localStorage.setItem("rc_currentUser", JSON.stringify(curUser));
    localStorage.setItem("rc_role", role);
}
function registerUser() {
    const fn = document.getElementById('rfn').value.trim();
    const em = document.getElementById('re').value.trim();
    const ph = document.getElementById('rph').value.trim();
    const p1 = document.getElementById('rp').value;
    const p2 = document.getElementById('rp2').value;
    if (!fn || !em || !p1) { toast('Please fill required fields', 'error'); return; }
    if (p1 !== p2) { toast('Passwords do not match', 'error'); return; }
    if (p1.length < 6) { toast('Password must be at least 6 characters', 'error'); return; }
    const user = { email: em, pass: p1, name: fn + ' ' + (document.getElementById('rln').value.trim()), phone: ph, blood: document.getElementById('rbl').value, role: 'user', createdAt: new Date().toISOString() };
    DB.saveUser(user); curUser = user; role = 'user';
    document.getElementById('uname').textContent = user.name;
    toast(`✅ Account created! Welcome, ${fn}!`, 'success');
    setTimeout(() => { goPage('pg-user'); getLocation(); }, 600);
}
function loginHospital() {
    const email = (document.getElementById('he').value || '').trim();
    const pass = (document.getElementById('hp').value || '').trim();
    const hosps = DB.hospitals();
    let hosp = hosps[email];
    if (!hosp && email === 'admin@hospital.com') hosp = { email, pass: 'hospital123', name: 'City General Hospital', role: 'hospital' };
    if (!hosp) { toast('Hospital account not found', 'error'); return; }
    if (hosp.pass && hosp.pass !== pass) { toast('Incorrect password', 'error'); return; }
    curUser = hosp; role = 'hospital';
    document.getElementById('h-display-name').textContent = hosp.name;
    goPage('pg-hospital');
    toast(`Welcome, ${hosp.name}!`, 'success');
    renderFleet();
    setTimeout(() => simulateIncoming(), 4500);
    localStorage.setItem("rc_currentUser", JSON.stringify(curUser));
    localStorage.setItem("rc_role", role);
}
function registerHospital() {
    const name = document.getElementById('hname_reg').value.trim();
    const email = document.getElementById('hreg_email').value.trim();
    const phone = document.getElementById('hreg_phone').value.trim();
    const addr = document.getElementById('hreg_addr').value.trim();
    const city = document.getElementById('hreg_city').value.trim();
    const state = document.getElementById('hreg_state').value.trim();
    const regno = document.getElementById('hreg_regno').value.trim();
    const p1 = document.getElementById('hreg_pass').value;
    const p2 = document.getElementById('hreg_pass2').value;
    if (!name || !email || !p1) { toast('Fill all required fields', 'error'); return; }
    if (p1 !== p2) { toast('Passwords do not match', 'error'); return; }
    if (p1.length < 6) { toast('Password must be at least 6 characters', 'error'); return; }
    const hosp = { name, email, phone, address: addr, city, state, regNo: regno, pass: p1, role: 'hospital', createdAt: new Date().toISOString() };
    DB.saveHosp(hosp); curUser = hosp; role = 'hospital';
    document.getElementById('h-display-name').textContent = name;
    toast(`✅ Hospital "${name}" registered!`, 'success');
    setTimeout(() => { goPage('pg-hospital'); renderFleet(); }, 600);
}
function loginDriver() {
    const email = document.getElementById('de').value.trim();
    const pass = document.getElementById('dp').value.trim();

    if (!email || !pass) {
        toast('Please fill all fields', 'error');
        return;
    }

    const drivers = DB.drivers();
    const drv = drivers[email];

    if (!drv) {
        toast('Driver not registered', 'error');
        return;
    }

    if (drv.pass !== pass) {
        toast('Incorrect password', 'error');
        return;
    }

    curUser = drv;
    role = 'driver';

    goPage('pg-driver');
    toast(`Welcome ${drv.name}`, 'success');

    localStorage.setItem("rc_currentUser", JSON.stringify(curUser));
    localStorage.setItem("rc_role", role);
}
window.onload = function () {
    const savedUser = localStorage.getItem("rc_currentUser");
    const savedRole = localStorage.getItem("rc_role");

    if (savedUser && savedRole) {
        curUser = JSON.parse(savedUser);
        role = savedRole;

        if (role === "user") goPage('pg-user');
        else if (role === "hospital") goPage('pg-hospital');
        else if (role === "driver") goPage('pg-driver');
    }
};
function logout() {
    localStorage.removeItem("rc_currentUser");
    localStorage.removeItem("rc_role");

    goPage('pg-land');
}

// ── GEOLOCATION — REAL GPS WITH FALLBACKS ──────────────────
function getLocation() {
    document.getElementById('nhc-count').textContent = '...';
    if (!navigator.geolocation) {
        toast('Geolocation not supported by your browser', 'error');
        uLoc = { lat: 28.6139, lng: 77.2090 }; fetchHosps(); return;
    }
    // High-accuracy GPS attempt first
    navigator.geolocation.getCurrentPosition(
        pos => {
            uLoc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
            toast(`📍 Location detected (${uLoc.lat.toFixed(4)}, ${uLoc.lng.toFixed(4)})`, 'success');
            fetchHosps();
        },
        err => {
            console.warn('GPS error:', err.code, err.message);
            if (err.code === 1) {
                toast('⚠️ Location permission denied. Please allow location access in browser settings.', 'error');
                uLoc = { lat: 28.6139, lng: 77.2090 };
            } else {
                toast('📍 Using network location estimate', 'info');
                uLoc = { lat: 28.6139, lng: 77.2090 };
            }
            fetchHosps();
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
}

// ── OVERPASS REAL HOSPITAL FETCH ────────────────────────────
async function fetchHosps() {
    if (!uLoc) return;
    const { lat, lng } = uLoc;
    const q = `[out:json][timeout:14];(node["amenity"="hospital"](around:7000,${lat},${lng});way["amenity"="hospital"](around:7000,${lat},${lng}););out center 12;`;
    try {
        const r = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: 'data=' + encodeURIComponent(q) });
        const d = await r.json();
        const els = d.elements.map(el => ({ id: el.id, name: el.tags?.name || el.tags?.['name:en'] || 'Hospital', lat: el.lat || el.center?.lat, lng: el.lon || el.center?.lon })).filter(h => h.lat && h.lng).slice(0, 10);
        nearHosps = els.map((h, i) => ({ ...h, dist: calcDist(lat, lng, h.lat, h.lng), ambs: mkAmbs(h.id, i) })).sort((a, b) => a.dist - b.dist);
        if (!nearHosps.length) nearHosps = mockHosps(lat, lng);
        document.getElementById('nhc-count').textContent = nearHosps.length;
        toast(`🏥 Found ${nearHosps.length} real hospitals nearby`, 'success');
    } catch (e) {
        nearHosps = mockHosps(lat, lng);
        document.getElementById('nhc-count').textContent = nearHosps.length;
        toast('Using cached hospital data', 'warn');
    }
    document.getElementById("avg-response").textContent = calculateAvgResponse();
}
function mockHosps(lat, lng) {
    return [{ id: 1, name: 'City General Hospital', lat: lat + .012, lng: lng + .008, dist: calcDist(lat, lng, lat + .012, lng + .008), ambs: mkAmbs(1, 0) },
    { id: 2, name: 'Metro Medical Center', lat: lat - .009, lng: lng + .015, dist: calcDist(lat, lng, lat - .009, lng + .015), ambs: mkAmbs(2, 1) },
    { id: 3, name: 'Apollo Emergency Care', lat: lat + .018, lng: lng - .012, dist: calcDist(lat, lng, lat + .018, lng - .012), ambs: mkAmbs(3, 2) }];
}
function mkAmbs(hid, off) {
    const names = [['Raj Kumar', 'Priya Sharma'], ['Amit Singh', 'Deepak Verma'], ['Kavita Rao', 'Suresh Patel']];
    return [{ id: `AMB-${String(hid * 10 + 1).padStart(3, '0')}`, type: 'ALS Advanced', driver: names[off % 3][0], eta: Math.floor(Math.random() * 5) + 3, dist: (Math.random() * 1.5 + .5).toFixed(1), rating: (4.6 + Math.random() * .4).toFixed(1), status: 'available' },
    { id: `AMB-${String(hid * 10 + 2).padStart(3, '0')}`, type: 'BLS Basic', driver: names[off % 3][1], eta: Math.floor(Math.random() * 6) + 5, dist: (Math.random() * 2.5 + 1).toFixed(1), rating: (4.3 + Math.random() * .6).toFixed(1), status: 'available' }];
}
function calcDist(a, b, c, d) {
    const R = 6371, dL = (c - a) * Math.PI / 180, dl = (d - b) * Math.PI / 180;
    const x = Math.sin(dL / 2) ** 2 + Math.cos(a * Math.PI / 180) * Math.cos(c * Math.PI / 180) * Math.sin(dl / 2) ** 2;
    return Math.round(R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x)) * 10) / 10;
}

// ── SOS FLOW ────────────────────────────────────────────────
function calculateAvgResponse() {
    if (!nearHosps.length) return "--";

    let total = 0;
    let count = 0;

    nearHosps.forEach(h => {
        h.ambs.forEach(a => {
            total += parseInt(a.eta);
            count++;
        });
    });

    const avg = Math.round(total / count);

    return avg + " min";
}
function triggerSOS() {
    document.getElementById('u-idle').style.display = 'none';
    document.getElementById('u-scan').style.display = 'block';
    toast('🚨 Emergency alert sent!', 'error');
    if (!uLoc) {
        document.getElementById('scan-txt').textContent = 'Requesting precise GPS location...';
        getLocation();
    }
    setTimeout(() => {
        initUserMap();
        document.getElementById('scan-txt').textContent = 'Location found. Loading real hospitals...';
        setTimeout(() => {
            if (nearHosps.length) renderHospList();
            else fetchHosps().then(() => renderHospList());
        }, 2000);
    }, 600);
}
function cancelSOS() {
    document.getElementById('u-scan').style.display = 'none';
    document.getElementById('u-idle').style.display = 'block';
    if (uMap) { uMap.remove(); uMap = null; }
    toast('Emergency cancelled', 'info');
}

// ── USER MAP with OSRM routing ──────────────────────────────
function mkIcon(emoji, size = 18, color = '#FF2D2D') {
    if (emoji) { return L.divIcon({ className: '', html: `<div style="font-size:${size}px;filter:drop-shadow(0 2px 4px rgba(0,0,0,.5));">${emoji}</div>`, iconSize: [size + 4, size + 4], iconAnchor: [(size + 4) / 2, (size + 4) / 2] }); }
    return L.divIcon({ className: '', html: `<div style="background:${color};width:${size}px;height:${size}px;border-radius:50%;border:3px solid #fff;box-shadow:0 2px 12px rgba(0,0,0,.5);"></div>`, iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
}

function initUserMap() {
    if (uMap) { uMap.remove(); uMap = null; }
    if (!uLoc) return;
    uMap = L.map('umap', { zoomControl: true }).setView([uLoc.lat, uLoc.lng], 14);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { attribution: '© OpenStreetMap © CartoDB', maxZoom: 19 }).addTo(uMap);
    uMk = L.marker([uLoc.lat, uLoc.lng], { icon: mkIcon(null, 16, '#FF2D2D') }).addTo(uMap).bindPopup('<b style="color:#0F1623">📍 Your Location</b>');
    L.circle([uLoc.lat, uLoc.lng], { color: '#FF2D2D', fillColor: '#FF2D2D', fillOpacity: .07, radius: 500, weight: 1 }).addTo(uMap);
}
function renderHospList() {
    if (!uMap) return;
    document.getElementById('hosp-sel-section').style.display = 'block';
    document.getElementById('ump-title').textContent = `🏥 ${nearHosps.length} Hospitals Found`;
    document.getElementById('ump-detail').textContent = 'Real data from OpenStreetMap';
    nearHosps.forEach(h => {
        L.marker([h.lat, h.lng], { icon: mkIcon('🏥', 20) }).addTo(uMap).bindPopup(`<b style="color:#0F1623">${h.name}</b><br><span style="color:#5A6478">${h.dist}km away</span>`);
    });
    const pts = [[uLoc.lat, uLoc.lng], ...nearHosps.map(h => [h.lat, h.lng])];
    try { uMap.fitBounds(pts, { padding: [30, 30] }); } catch (e) { }
    document.getElementById('hosp-list').innerHTML = nearHosps.map(h => `
    <div style="margin-bottom:18px;">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;font-weight:800;font-size:.95rem;">
        🏥 ${h.name} <span class="badge bd-gray">${h.dist} km away</span>
      </div>
      <div class="amb-grid">${h.ambs.map(a => `
        <div class="amb-card">
          <div class="amb-head"><div class="amb-id">🚑 ${a.id}</div><span class="badge bd-green">Available</span></div>
          <div class="amb-meta">
            <div class="am-item"><span>ETA</span><strong style="color:var(--green);">${a.eta} min</strong></div>
            <div class="am-item"><span>Distance</span><strong>${a.dist} km</strong></div>
            <div class="am-item"><span>Type</span><strong>${a.type}</strong></div>
            <div class="am-item"><span>Driver</span><strong>${a.driver}</strong></div>
            <div class="am-item"><span>Rating</span><strong>⭐ ${a.rating}</strong></div>
          </div>
          <button class="btn-book" onclick="bookAmb(${h.id},'${a.id}','${h.name}','${a.driver}','${a.type}',${a.eta},${h.lat},${h.lng})">Book This Ambulance →</button>
        </div>`).join('')}
      </div>
    </div>`).join('');
    toast('✅ Select an ambulance to confirm booking', 'success');
}

// ── BOOKING ──────────────────────────────────────────────────
function bookAmb(hid, aid, hname, driver, type, eta, hlat, hlng) {
    selAmb = { hid, aid, hname, driver, type, eta: parseInt(eta), hlat: parseFloat(hlat), hlng: parseFloat(hlng) };
    curEta = parseInt(eta);
    const rid = 'EM-' + Math.floor(Math.random() * 9000 + 1000);
    activeReqId = rid;
    const req = { id: rid, patient: curUser?.name || 'Patient', loc: uLoc, hospital: hname, hlat: parseFloat(hlat), hlng: parseFloat(hlng), plat: uLoc.lat, plng: uLoc.lng, amb: aid, driver, type, eta: curEta, status: 'confirmed', emergency: 'Emergency', time: new Date().toISOString() };
    DS.requests.push(req); DS.driverMission = req; curReq = req;
    DB.saveRequest(req);
    // UI switch
    document.getElementById('u-scan').style.display = 'none';
    document.getElementById('u-track').style.display = 'block';
    document.getElementById('trk-title').textContent = '🎉 Ambulance Confirmed!';
    document.getElementById('trk-sub').textContent = `${aid} • ${driver} is on the way`;
    document.getElementById('trk-eta-badge').textContent = `ETA: ${curEta} min`;
    document.getElementById('td-name').textContent = driver;
    document.getElementById('td-veh').textContent = `${aid} • ${type}`;
    document.getElementById('td-ph').textContent = '+91 98765 43210';
    document.getElementById('td-eta').textContent = `${curEta} min`;
    document.getElementById('trk-amb-id').textContent = aid;
    toast(`✅ ${aid} booked! ${driver} is on the way.`, 'success');
    initTrackMap(parseFloat(hlat), parseFloat(hlng));
    startEta();
}

// ── TRACKING MAP with OSRM routing ──────────────────────────
function initTrackMap(hlat, hlng) {
    if (trkMap) { trkMap.remove(); trkMap = null; routeCtrl = null; }
    if (!uLoc) return;
    setTimeout(() => {
        trkMap = L.map('trkmap').setView([uLoc.lat, uLoc.lng], 14);
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { attribution: '© CartoDB', maxZoom: 19 }).addTo(trkMap);
        L.marker([uLoc.lat, uLoc.lng], { icon: mkIcon(null, 14, '#FF2D2D') }).addTo(trkMap).bindPopup('<b style="color:#0F1623">📍 Your Location</b>');
        L.marker([hlat, hlng], { icon: mkIcon('🏥', 20) }).addTo(trkMap).bindPopup(`<b style="color:#0F1623">🏥 ${selAmb?.hname}</b>`);
        // Place ambulance starting from hospital direction
        const sl = hlat + (uLoc.lat - hlat) * .1, sn = hlng + (uLoc.lng - hlng) * .1;
        ambMk = L.marker([sl, sn], { icon: mkIcon('🚑', 22) }).addTo(trkMap).bindPopup(`<b style="color:#0F1623">🚑 ${selAmb?.aid}</b>`);
        DS.ambLoc = { lat: sl, lng: sn };
        // OSRM route from ambulance to user
        if (L.Routing && L.Routing.control) {
            try {
                routeCtrl = L.Routing.control({
                    waypoints: [L.latLng(sl, sn), L.latLng(uLoc.lat, uLoc.lng)],
                    router: L.Routing.osrmv1({ serviceUrl: 'https://router.project-osrm.org/route/v1' }),
                    lineOptions: { styles: [{ color: '#FF2D2D', weight: 4, opacity: .8 }] },
                    addWaypoints: false, draggableWaypoints: false, fitSelectedRoutes: true,
                    createMarker: () => null, show: false,
                    collapsible: true,
                }).addTo(trkMap);
                routeCtrl.on('routesfound', e => {
                    const r = e.routes[0];
                    const tmin = Math.ceil(r.summary.totalTime / 60);
                    const dkm = (r.summary.totalDistance / 1000).toFixed(1);
                    document.getElementById('trk-eta-text').textContent = `~${tmin} min away`;
                    document.getElementById('trk-dist-val').textContent = `${dkm} km`;
                    document.getElementById('trk-dist-chip').style.display = 'inline-flex';
                    curEta = tmin;
                    document.getElementById('td-eta').textContent = `${tmin} min`;
                    document.getElementById('trk-eta-badge').textContent = `ETA: ${tmin} min`;
                });
            } catch (er) {
                trkMap.fitBounds([[uLoc.lat, uLoc.lng], [hlat, hlng]], { padding: [40, 40] });
            }
        }
        // Animate ambulance toward user
        animateAmb(sl, sn, uLoc.lat, uLoc.lng, curEta);
    }, 250);
}
function animateAmb(fl, fn, tl, tn, etaMin) {
    let p = 0; const steps = 100;
    const iv = setInterval(() => {
        p += 1 / steps; if (p >= 1) { p = 1; clearInterval(iv); ambArrived(); }
        const lat = fl + (tl - fl) * p, lng = fn + (tn - fn) * p;
        if (ambMk) ambMk.setLatLng([lat, lng]);
        DS.ambLoc = { lat, lng };
        if (drvMk) drvMk.setLatLng([lat, lng]);
    }, etaMin * 60 * 1000 / steps / 8);
}
function startEta() {
    clearInterval(etaInt);
    etaInt = setInterval(() => {
        if (curEta > 0) {
            curEta--;
            document.getElementById('trk-eta-badge').textContent = curEta === 0 ? 'Arriving Now!' : 'ETA: ' + curEta + ' min';
            document.getElementById('td-eta').textContent = curEta === 0 ? 'Now!' : curEta + ' min';
            document.getElementById('trk-eta-text').textContent = curEta === 0 ? '🟢 Arriving!' : '~' + curEta + ' min away';
        }
    }, 3000);
}
function ambArrived() {
    clearInterval(etaInt);
    toast('🚑 Ambulance ARRIVED at your location!', 'success');
    const ss = document.querySelectorAll('#utracker .tstep');
    ss.forEach((s, i) => { s.classList.remove('active'); if (i <= 2) { s.classList.add('done'); s.querySelector('.tdot').textContent = '✓'; } });
    ss[3].classList.add('active');
    document.getElementById('trip-badge').textContent = 'Arrived'; document.getElementById('trip-badge').className = 'badge bd-blue';
    if (activeReqId) DB.updateRequest(activeReqId, { status: 'arrived' });
    setTimeout(() => {
        ss[3].classList.remove('active'); ss[3].classList.add('done'); ss[3].querySelector('.tdot').textContent = '✓';
        ss[4].classList.add('done'); ss[4].querySelector('.tdot').textContent = '✓';
        document.getElementById('trip-badge').textContent = '✅ At Hospital'; document.getElementById('trip-badge').className = 'badge bd-green';
        document.getElementById('rate-card').style.display = 'block';
        toast('🏥 You have arrived at the hospital!', 'success');
        if (activeReqId) DB.updateRequest(activeReqId, { status: 'completed' });
    }, 10000);
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
    if (!starVal) { toast('Select a star rating first', 'error'); return; }
    if (activeReqId) DB.updateRequest(activeReqId, { rating: starVal, comment: document.getElementById('ratecomment').value });
    toast(`🎉 Rated ${starVal} ⭐ — Thank you!`, 'success');
    document.getElementById('rate-card').style.display = 'none';
    setTimeout(() => { document.getElementById('u-track').style.display = 'none'; document.getElementById('u-idle').style.display = 'block'; curEta = 5; starVal = 0; selAmb = null; activeReqId = null; }, 1200);
}

// ── HOSPITAL LOGIC ────────────────────────────────────────────
function htab(t, el) {
    document.querySelectorAll('#pg-hospital .tab').forEach(x => x.classList.remove('active')); el.classList.add('active');
    ['req', 'fleet', 'drivers', 'track', 'stats'].forEach(x => { const e = document.getElementById('ht-' + x); if (e) e.style.display = x === t ? 'block' : 'none'; });
    if (t === 'track') setTimeout(() => { if (!hMap) initHMap(); }, 100);
}
function renderFleet() {
    const c = document.getElementById('fleet-cards'); if (!c) return;
    const sm = { available: 'bd-green', dispatched: 'bd-blue', maintenance: 'bd-gray' };
    c.innerHTML = fleetData.map(f => `
    <div style="background:var(--navy2);border:1px solid var(--border);border-radius:var(--radius);padding:18px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <span style="font-weight:800;">🚑 ${f.id}</span><span class="badge ${sm[f.status] || 'bd-gray'}">${f.status}</span>
      </div>
      <div style="font-size:.82rem;color:var(--text2);display:flex;flex-direction:column;gap:5px;">
        <span><strong style="color:var(--text);">${f.type}</strong></span>
        <span>Driver: <strong style="color:var(--text);">${f.driver}</strong></span>
        <span>Reg: ${f.reg}</span>
      </div>
    </div>`).join('');
}
function addFleet() {
    const id = document.getElementById('fl-id').value.trim();
    if (!id) { toast('Enter unit ID', 'error'); return; }
    fleetData.push({ id, type: document.getElementById('fl-type').value, driver: document.getElementById('fl-drv').value || '—', reg: document.getElementById('fl-reg').value || '—', status: 'available' });
    renderFleet();
    ['fl-id', 'fl-drv', 'fl-reg'].forEach(x => document.getElementById(x).value = '');
    toast(`🚑 ${id} added to fleet!`, 'success');
    document.getElementById('hsav').textContent = parseInt(document.getElementById('hsav').textContent) + 1;
}
function addDriver() {
    const n = document.getElementById('dr-n').value.trim(); if (!n) { toast('Enter driver name', 'error'); return; }
    const ph = document.getElementById('dr-ph').value, veh = document.getElementById('dr-veh').value;
    const tb = document.getElementById('drv-table');
    const tr = document.createElement('tr');
    tr.innerHTML = `<td><strong>${n}</strong></td><td>${ph || '—'}</td><td>${veh || '—'}</td><td><span class="badge bd-gray">Off Duty</span></td><td>0</td>`;
    tb.appendChild(tr);
    DB.saveDriver({ email: n.toLowerCase().replace(' ', '.') + Math.random().toString(36).slice(-4) + '@rapidcare.in', name: n, phone: ph, vehicle: veh, role: 'driver', createdAt: new Date().toISOString() });
    ['dr-n', 'dr-ph', 'dr-lic', 'dr-veh'].forEach(x => document.getElementById(x).value = '');
    toast(`👤 ${n} registered as driver!`, 'success');
}
function simulateIncoming() {
    const req = { id: 'EM-' + Math.floor(Math.random() * 9000 + 1000), patient: 'Demo Patient', emergency: 'Chest Pain', hospital: curUser?.name || 'Hospital', time: new Date().toISOString(), status: 'pending', lat: uLoc?.lat || 28.6139, lng: uLoc?.lng || 77.209 };
    renderReqCard(req);
    document.getElementById('hsa').textContent = parseInt(document.getElementById('hsa').textContent) + 1;
    document.getElementById('h-notif').style.display = 'flex';
    toast(`🚨 New emergency #${req.id} — ${req.patient}!`, 'error');
}
function renderReqCard(req) {
    const c = document.getElementById('lreqs');
    if (c.querySelector('.empty-st')) c.innerHTML = '';
    const d = document.createElement('div'); d.className = 'mission-card urgent'; d.id = 'req-' + req.id;
    d.innerHTML = `
    <div class="mc-head">
      <div><div class="mc-title">#${req.id}</div><div class="mc-time">${new Date(req.time).toLocaleTimeString()}</div></div>
      <span class="badge bd-red rqs">PENDING</span>
    </div>
    <div class="pg-grid">
      <div class="pgi"><span>Patient</span><strong>${req.patient}</strong></div>
      <div class="pgi"><span>Emergency</span><strong style="color:var(--red);">${req.emergency}</strong></div>
      <div class="pgi"><span>Hospital</span><strong>${req.hospital}</strong></div>
      <div class="pgi"><span>Time</span><strong>${new Date(req.time).toLocaleTimeString()}</strong></div>
    </div>
    <div class="btn-row rqa">
      <button class="bsm acc" onclick="dispatchReq('${req.id}')">🚑 Dispatch</button>
      <button class="bsm gh" onclick="htab('track',document.querySelectorAll('#pg-hospital .tab')[3])">📍 Track</button>
      <button class="bsm dng" onclick="this.closest('.mission-card').remove()">Dismiss</button>
    </div>`;
    c.prepend(d);
}
function dispatchReq(rid) {
    const c = document.getElementById('req-' + rid);
    if (c) {
        c.querySelector('.rqs').textContent = 'DISPATCHED'; c.querySelector('.rqs').className = 'badge bd-blue rqs';
        c.querySelector('.rqa').innerHTML = `<button class="bsm cmp" onclick="completeReq('${rid}')">✅ Complete</button><button class="bsm gh" onclick="htab('track',document.querySelectorAll('#pg-hospital .tab')[3])">📍 Live Track</button>`;
    }
    document.getElementById('hsa').textContent = Math.max(0, parseInt(document.getElementById('hsa').textContent) - 1);
    document.getElementById('hsd').textContent = parseInt(document.getElementById('hsd').textContent) + 1;
    DB.updateRequest(rid, { status: 'dispatched' });
    toast(`🚑 Ambulance dispatched for #${rid}`, 'success');
}
function completeReq(rid) {
    const c = document.getElementById('req-' + rid); if (c) c.remove();
    document.getElementById('hsc').textContent = parseInt(document.getElementById('hsc').textContent) + 1;
    document.getElementById('hsd').textContent = Math.max(0, parseInt(document.getElementById('hsd').textContent) - 1);
    DB.updateRequest(rid, { status: 'completed' });
    toast(`✅ #${rid} marked complete`, 'success');
}
function initHMap() {
    if (hMap) return;
    const c = uLoc || { lat: 28.6139, lng: 77.209 };
    setTimeout(() => {
        hMap = L.map('hmap').setView([c.lat, c.lng], 13);
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { attribution: '© CartoDB', maxZoom: 19 }).addTo(hMap);
        const m1 = L.marker([c.lat + .009, c.lng - .006], { icon: mkIcon('🚑', 22) }).addTo(hMap).bindPopup('<b style="color:#0F1623">🚑 AMB-001 — En Route</b>');
        L.marker([c.lat - .008, c.lng + .013], { icon: mkIcon('🚑', 22) }).addTo(hMap).bindPopup('<b style="color:#0F1623">🚑 AMB-003 — On Scene</b>');
        L.marker([c.lat, c.lng], { icon: mkIcon('🏥', 22) }).addTo(hMap).bindPopup(`<b style="color:#0F1623">🏥 ${curUser?.name || 'Hospital'}</b>`);
        let t = 0; setInterval(() => { t += .0008; m1.setLatLng([c.lat + .009 - t, c.lng - .006 + t]); }, 1500);
        if (DS.ambLoc) { const rm = L.marker([DS.ambLoc.lat, DS.ambLoc.lng], { icon: mkIcon('🚑', 22) }).addTo(hMap).bindPopup(`<b style="color:#0F1623">🚑 ${selAmb?.aid || 'Active'}</b>`); setInterval(() => { if (DS.ambLoc) rm.setLatLng([DS.ambLoc.lat, DS.ambLoc.lng]); }, 2000); }
        toast('🗺️ Live fleet map loaded', 'success');
    }, 250);
}

// ── DRIVER LOGIC ──────────────────────────────────────────────
function toggleDuty(cb) {
    document.getElementById('duty-lbl').textContent = cb.checked ? 'On Duty' : 'Off Duty';
    document.getElementById('duty-lbl').style.color = cb.checked ? 'var(--green)' : 'var(--text3)';
    toast(cb.checked ? '✅ You are now On Duty' : '💤 You are now Off Duty', 'info');
}
function startLocWatch() {
    if (!navigator.geolocation) return;
    locWatch = navigator.geolocation.watchPosition(p => {
        if (drvMk) drvMk.setLatLng([p.coords.latitude, p.coords.longitude]);
        if (DS.ambLoc) DS.ambLoc = { lat: p.coords.latitude, lng: p.coords.longitude };
    }, () => { }, { enableHighAccuracy: true });
}
function showDemoMission() {
    const loc = uLoc || { lat: 28.6139, lng: 77.209 };
    const req = { id: 'EM-' + Math.floor(Math.random() * 9000 + 1000), patient: 'Ananya Mehta', emergency: 'Chest Pain (Acute)', pickup: 'Sector 15, Block C', hospital: 'City General Hospital', plat: loc.lat + .006, plng: loc.lng - .004, hlat: loc.lat + .014, hlng: loc.lng + .009 };
    curReq = req; activeReqId = req.id;
    document.getElementById('d-none').style.display = 'none';
    document.getElementById('d-incoming').style.display = 'block';
    document.getElementById('mi-id').textContent = '#' + req.id;
    document.getElementById('mi-pat').textContent = req.patient;
    document.getElementById('mi-emg').textContent = req.emergency;
    document.getElementById('mi-pkp').textContent = req.pickup;
    document.getElementById('mi-hosp').textContent = req.hospital;
    toast(`🚨 Incoming mission #${req.id}!`, 'error');
}
function acceptMission() {
    document.getElementById('d-incoming').style.display = 'none';
    document.getElementById('d-active').style.display = 'block';
    document.getElementById('at-id').textContent = '#' + (curReq?.id || 'EM-0000');
    document.getElementById('at-pat').textContent = curReq?.patient || '—';
    document.getElementById('at-emg').textContent = curReq?.emergency || '—';
    tripSt = 1;
    if (activeReqId) DB.updateRequest(activeReqId, { status: 'driver_accepted' });
    toast('✅ Mission accepted! Navigate to patient.', 'success');
    initDrvMap();
}
function declineMission() {
    document.getElementById('d-incoming').style.display = 'none';
    document.getElementById('d-none').style.display = 'block';
    toast('Mission declined', 'info');
}
function initDrvMap() {
    if (drvMap) { drvMap.remove(); drvMap = null; drvRouteCtrl = null; }
    const dl = uLoc || { lat: 28.6139 + .01, lng: 77.209 - .01 };
    const pl = { lat: curReq?.plat || dl.lat - .009, lng: curReq?.plng || dl.lng + .006 };
    setTimeout(() => {
        drvMap = L.map('dmap').setView([dl.lat, dl.lng], 14);
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { attribution: '© CartoDB', maxZoom: 19 }).addTo(drvMap);
        drvMk = L.marker([dl.lat, dl.lng], { icon: mkIcon('🚑', 24) }).addTo(drvMap).bindPopup('<b style="color:#0F1623">🚑 Your Ambulance</b>');
        L.marker([pl.lat, pl.lng], { icon: mkIcon(null, 14, '#FF2D2D') }).addTo(drvMap).bindPopup('<b style="color:#0F1623">📍 Patient Location</b>');
        // OSRM turn-by-turn routing
        if (L.Routing && L.Routing.control) {
            try {
                drvRouteCtrl = L.Routing.control({
                    waypoints: [L.latLng(dl.lat, dl.lng), L.latLng(pl.lat, pl.lng)],
                    router: L.Routing.osrmv1({ serviceUrl: 'https://router.project-osrm.org/route/v1', profile: 'driving' }),
                    lineOptions: { styles: [{ color: '#00D97E', weight: 5, opacity: .85 }] },
                    addWaypoints: false, draggableWaypoints: false, fitSelectedRoutes: true,
                    createMarker: () => null, show: true, collapsible: true,
                }).addTo(drvMap);
                drvRouteCtrl.on('routesfound', e => {
                    const r = e.routes[0];
                    const tmin = Math.ceil(r.summary.totalTime / 60);
                    const dkm = (r.summary.totalDistance / 1000).toFixed(1);
                    document.getElementById('nav-eta').textContent = `~${tmin} min (${dkm} km)`;
                    document.getElementById('nav-dist').textContent = dkm + ' km';
                    document.getElementById('nav-dist-chip').style.display = 'inline-flex';
                });
            } catch (er) {
                drvMap.fitBounds([[dl.lat, dl.lng], [pl.lat, pl.lng]], { padding: [30, 30] });
            }
        }
    }, 250);
}
const nxtLabels = ['Arrived at Patient →', 'Patient On Board →', 'En Route to Hospital →', 'Arrived at Hospital — Finish'];
const nxtMsgs = ['Patient pickup confirmed!', 'En route to hospital!', 'Arrived at hospital!', '✅ Mission complete!'];
function nextStep() {
    tripSt++;
    const steps = [null, 'ds2', 'ds3', 'ds4', 'ds5'];
    if (tripSt <= 4) {
        const pv = document.getElementById(steps[tripSt]);
        if (pv) { pv.classList.remove('active'); pv.classList.add('done'); pv.querySelector('.tdot').textContent = '✓'; }
        if (tripSt < 4) { const nx = document.getElementById(steps[tripSt + 1]); if (nx) nx.classList.add('active'); }
        toast(nxtMsgs[tripSt - 1], 'success');
        const btn = document.getElementById('nxt-btn'); if (btn && tripSt < 4) btn.textContent = nxtLabels[tripSt];
        // Reroute to hospital on step 3
        if (tripSt === 3 && curReq && drvMap) {
            const hl = { lat: curReq.hlat, lng: curReq.hlng };
            L.marker([hl.lat, hl.lng], { icon: mkIcon('🏥', 22) }).addTo(drvMap).bindPopup('<b style="color:#0F1623">🏥 Destination Hospital</b>');
            if (drvRouteCtrl && drvMk) {
                const cp = drvMk.getLatLng();
                try { drvRouteCtrl.setWaypoints([cp, L.latLng(hl.lat, hl.lng)]); } catch (e) { }
            }
            document.getElementById('nav-dest').textContent = '→ Hospital Delivery';
            document.getElementById('at-badge').textContent = 'En Route to Hospital';
            if (activeReqId) DB.updateRequest(activeReqId, { status: 'to_hospital' });
        }
        if (tripSt === 4) {
            document.getElementById('d-trips').textContent = parseInt(document.getElementById('d-trips').textContent) + 1;
            document.getElementById('trip-act').innerHTML = '<div style="color:var(--green);font-weight:700;font-size:.9rem;padding:8px 0;">✅ Mission Complete! Awaiting next dispatch.</div>';
            if (activeReqId) DB.updateRequest(activeReqId, { status: 'completed' });
            setTimeout(() => { document.getElementById('d-active').style.display = 'none'; document.getElementById('d-none').style.display = 'block'; tripSt = 0; activeReqId = null; curReq = null; }, 5000);
        }
    }
}
function callPatient() { toast('📞 Calling patient...', 'info'); }

// ── TOAST SYSTEM ──────────────────────────────────────────────
function toast(msg, type = 'info') {
    const icons = { success: '✅', error: '🚨', info: 'ℹ️', warn: '⚠️' };
    const c = document.getElementById('toaster');
    const d = document.createElement('div'); d.className = `toast ${type}`;
    d.innerHTML = `<span class="ti">${icons[type] || 'ℹ️'}</span><span class="tm">${msg}</span><button class="tc" onclick="this.closest('.toast').remove()">✕</button>`;
    c.prepend(d); setTimeout(() => d.remove(), 5000);
}
