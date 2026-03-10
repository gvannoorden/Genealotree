// =============================================
// 🌳 GENEALOTREE APP — Configuration
// =============================================
const CONFIG = {
    PASSWORD: 'sc0ttmill@r_ext',
    PROXY_URL: 'https://silent-lab-14d9.scottmillergavin.workers.dev', // Your Cloudflare Worker URL (API key is stored securely in Worker secrets)
    FAMILY_DB_ID: '107331c45b344f0e990ef7e7ec469f12',
    EVENTS_DB_ID: '551340f36d55480e86469feccbad14d4',
    STORIES_DB_ID: '21102098d4904caf99a29a691b38e02f',
};

const EVENT_ICONS = { Marriage:'💒', Graduation:'🎓', Birth:'👶', Death:'🕊️', Move:'🏠', Other:'📌' };
const SILHOUETTE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';

// =============================================
// STATE
// =============================================
let state = { members: [], events: [], stories: [], currentView: 'tree', selectedId: null };

// =============================================
// NOTION API
// =============================================
async function apiFetch(endpoint, method = 'POST', body = null) {
    const opts = {
        method,
        headers: { 'Content-Type': 'application/json' },
    };
    if (body && method !== 'GET') opts.body = JSON.stringify(body);
    const base = CONFIG.PROXY_URL.replace(/\/+$/, '');
    const res = await fetch(base + endpoint, opts);
    if (!res.ok) throw new Error('API ' + res.status + ': ' + (await res.text()));
    return res.json();
}

async function queryDB(dbId, filter, sorts) {
    const body = {};
    if (filter) body.filter = filter;
    if (sorts) body.sorts = sorts;
    let all = [], hasMore = true, cursor;
    while (hasMore) {
        if (cursor) body.start_cursor = cursor;
        const d = await apiFetch('/v1/databases/' + dbId + '/query', 'POST', body);
        all.push(...d.results);
        hasMore = d.has_more;
        cursor = d.next_cursor;
    }
    return all;
}

// =============================================
// PARSERS
// =============================================
const pTitle = p => p?.title?.map(t => t.plain_text).join('') || '';
const pText = p => p?.rich_text?.map(t => t.plain_text).join('') || '';
const pDate = p => p?.date?.start || null;
const pSelect = p => p?.select?.name || null;
const pRel = p => (p?.relation || []).map(r => r.id);
const pFile = p => {
    if (!p?.files?.length) return null;
    const f = p.files[0];
    return f.type === 'file' ? f.file.url : f.type === 'external' ? f.external.url : null;
};

function parseMember(pg) {
    const p = pg.properties;
    return {
        id: pg.id, name: pTitle(p['Name']), middleName: pText(p['Middle Name']),
        photo: pFile(p['Photo']), dob: pDate(p['Date of Birth']), dod: pDate(p['Date of Death']),
        spouseIds: pRel(p['Spouse']), childrenIds: pRel(p['Children']),
        parentIds: pRel(p['Parents']), eventIds: pRel(p['Events']), storyIds: pRel(p['Stories']),
    };
}

function parseEvent(pg) {
    const p = pg.properties;
    return { id: pg.id, title: pTitle(p['Title']), type: pSelect(p['Event Type']),
        date: pDate(p['Date']), memberIds: pRel(p['Family Member']) };
}

function parseStory(pg) {
    const p = pg.properties;
    return { id: pg.id, title: pTitle(p['Title']), date: pDate(p['Date']),
        memberIds: pRel(p['Family Member']) };
}

// =============================================
// DATA LOADING
// =============================================
function normalizeRelationships() {
    const map = new Map(state.members.map(m => [m.id, m]));
    // If A lists B as parent, make sure B lists A as child
    for (const m of state.members) {
        for (const pid of m.parentIds) {
            const parent = map.get(pid);
            if (parent && !parent.childrenIds.includes(m.id)) parent.childrenIds.push(m.id);
        }
        for (const cid of m.childrenIds) {
            const child = map.get(cid);
            if (child && !child.parentIds.includes(m.id)) child.parentIds.push(m.id);
        }
        for (const sid of m.spouseIds) {
            const spouse = map.get(sid);
            if (spouse && !spouse.spouseIds.includes(m.id)) spouse.spouseIds.push(m.id);
        }
    }
}
async function loadAll() {
    showLoading(true);
    try {
        const [m, e, s] = await Promise.all([
            queryDB(CONFIG.FAMILY_DB_ID),
            queryDB(CONFIG.EVENTS_DB_ID),
            queryDB(CONFIG.STORIES_DB_ID),
        ]);
        state.members = m.map(parseMember);
        state.events = e.map(parseEvent);
        state.stories = s.map(parseStory);
        normalizeRelationships();
        render();
        toast('✅ Family data loaded!');
    } catch (err) {
        console.error(err);
        toast('❌ Failed to load data — check console');
    } finally { showLoading(false); }
}

// =============================================
// HELPERS
// =============================================
const getMember = id => state.members.find(m => m.id === id);
const getEvents = id => state.events.filter(e => e.memberIds.includes(id));
const getStories = id => state.stories.filter(s => s.memberIds.includes(id));
const fmtDate = d => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US',
    { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
const getYear = d => d ? new Date(d + 'T00:00:00').getFullYear() : null;
const photoEl = url => url
    ? '<img src="' + url + '" onerror="this.outerHTML=SILHOUETTE">'
    : SILHOUETTE;

function showLoading(v) {
    document.getElementById('loading-overlay').classList.toggle('hidden', !v);
}

function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 3000);
}

function calcAge(dob, dod) {
    const end = dod ? new Date(dod + 'T00:00:00') : new Date();
    const b = new Date(dob + 'T00:00:00');
    let a = end.getFullYear() - b.getFullYear();
    if (end.getMonth() < b.getMonth() ||
        (end.getMonth() === b.getMonth() && end.getDate() < b.getDate())) a--;
    return a;
}

function fg(label, input) {
    return '<div class="form-group"><label>' + label + '</label>' + input + '</div>';
}

function esc(s) {
    return (s || '').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

// =============================================
// AUTH
// =============================================
function initAuth() {
    if (sessionStorage.getItem('ft') === '1') return showApp();
    document.getElementById('auth-screen').classList.remove('hidden');
    document.getElementById('app').classList.add('hidden');
    const inp = document.getElementById('password-input');
    const btn = document.getElementById('login-btn');
    const err = document.getElementById('auth-error');
    const go = () => {
        if (inp.value === CONFIG.PASSWORD) {
            sessionStorage.setItem('ft', '1');
            showApp();
        } else {
            err.classList.remove('hidden');
            inp.classList.add('shake');
            setTimeout(() => inp.classList.remove('shake'), 500);
        }
    };
    btn.onclick = go;
    inp.onkeydown = e => { if (e.key === 'Enter') go(); };
}

function showApp() {
    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    loadAll();
}

// =============================================
// NAVIGATION
// =============================================
function initNav() {
    document.querySelectorAll('.nav-btn').forEach(b => {
        b.onclick = () => {
            document.querySelectorAll('.nav-btn').forEach(x => x.classList.remove('active'));
            b.classList.add('active');
            state.currentView = b.dataset.view;
            document.getElementById('tree-view').classList.toggle('hidden', state.currentView !== 'tree');
            document.getElementById('list-view').classList.toggle('hidden', state.currentView !== 'list');
            render();
        };
    });
    document.getElementById('refresh-btn').onclick = loadAll;
    document.getElementById('add-person-btn').onclick = showAddPersonModal;
    document.getElementById('panel-overlay').onclick = closeDetail;
    document.getElementById('search-input').oninput = renderList;
}

function render() {
    state.currentView === 'tree' ? renderTree() : renderList();
}

// =============================================
// TREE VIEW
// =============================================
function renderTree() {
    const c = document.getElementById('tree-container');
    c.innerHTML = '';
    if (!state.members.length) {
        c.innerHTML = '<div class="empty-state">🌱 No family members yet!<br>Click <b>➕ Add Member</b> to get started.</div>';
        return;
    }
    const map = new Map(state.members.map(m => [m.id, m]));
    const placed = new Set();

    // Find root ancestors (no parents in DB)
    const roots = state.members.filter(m =>
        m.parentIds.length === 0 || m.parentIds.every(p => !map.has(p))
    );

    const rootIds = new Set(roots.map(r => r.id));
    function buildTree(person) {
        if (placed.has(person.id)) return null;
        placed.add(person.id);
        let spouse = person.spouseIds[0] ? map.get(person.spouseIds[0]) : null;
        if (spouse && placed.has(spouse.id)) spouse = null;
        if (spouse) placed.add(spouse.id);
        const cids = new Set(person.childrenIds);
        if (spouse) spouse.childrenIds.forEach(id => cids.add(id));
        const children = [...cids].map(id => map.get(id)).filter(Boolean)
            .sort((a, b) => (a.dob || '').localeCompare(b.dob || ''))
            .map(c => buildTree(c)).filter(Boolean);
        return { person, spouse, children };
    }

    // Detect co-parent pairs among roots (share a child but no spouse relation)
    const coParentOf = new Map();
    for (const r of roots) {
        if (r.spouseIds.length > 0 || coParentOf.has(r.id)) continue;
        for (const cid of r.childrenIds) {
            const child = map.get(cid);
            if (!child) continue;
            const mate = child.parentIds.find(pid => pid !== r.id && rootIds.has(pid) && !coParentOf.has(pid));
            if (mate) { coParentOf.set(r.id, mate); coParentOf.set(mate, r.id); break; }
        }
    }
    const units = [];
    roots.sort((a, b) => (a.dob || '').localeCompare(b.dob || ''));
    for (const r of roots) {
        if (placed.has(r.id)) continue;
        const mateId = coParentOf.get(r.id);
        const mate = mateId ? map.get(mateId) : null;
        if (mate && !placed.has(mate.id)) {
            placed.add(r.id); placed.add(mate.id);
            const cids = new Set([...r.childrenIds, ...mate.childrenIds]);
            const children = [...cids].map(id => map.get(id)).filter(Boolean)
                .sort((a, b) => (a.dob || '').localeCompare(b.dob || ''))
                .map(c => buildTree(c)).filter(Boolean);
            if (children.length) units.push({ person: r, spouse: mate, children });
        } else {
            const u = buildTree(r);
            if (u) units.push(u);
        }
    }

    // Zoom controls
    const zc = document.createElement('div');
    zc.className = 'zoom-controls';
    zc.innerHTML = '<button onclick="treeZoom(0.15)">＋</button><button onclick="treeZoom(-0.15)">－</button><button onclick="treeZoomReset()">⟳</button>';
    c.appendChild(zc);
    const inner = document.createElement('div');
    inner.id = 'tree-inner';
    inner.style.transformOrigin = '0 0';
    const tree = document.createElement('div');
    tree.className = 'tree';
    units.forEach(u => tree.appendChild(unitEl(u)));
    inner.appendChild(tree);
    c.appendChild(inner);
    initZoomPan(c, inner);
    // Adjust connector lines to point at the primary person, not couple center
    requestAnimationFrame(function() {
        c.querySelectorAll('.child-branch').forEach(function(br) {
            var fu = br.querySelector(':scope > .child-unit-wrap > .family-unit');
            var pn = fu ? fu.querySelector(':scope > .couple > .person-node') : null;
            if (!pn) return;
            var brR = br.getBoundingClientRect();
            var pnR = pn.getBoundingClientRect();
            if (brR.width === 0) return;
            var pct = ((pnR.left + pnR.width / 2) - brR.left) / brR.width * 100;
            br.style.setProperty('--conn-left', pct + '%');
            br.style.setProperty('--conn-right', (100 - pct) + '%');
        });
    });
}

function unitEl(unit) {
    const el = document.createElement('div');
    el.className = 'family-unit';

    // Couple row
    const couple = document.createElement('div');
    couple.className = 'couple';
    couple.appendChild(nodeEl(unit.person));
    if (unit.spouse) {
        const line = document.createElement('div');
        line.className = 'spouse-line';
        couple.appendChild(line);
        couple.appendChild(nodeEl(unit.spouse));
    }
    el.appendChild(couple);

    // Children
    if (unit.children.length) {
        const vl = document.createElement('div');
        vl.className = 'vert-line';
        el.appendChild(vl);
        const row = document.createElement('div');
        row.className = 'children-row';
        unit.children.forEach(ch => {
            const br = document.createElement('div');
            br.className = 'child-branch';
            const wr = document.createElement('div');
            wr.className = 'child-unit-wrap';
            wr.appendChild(unitEl(ch));
            br.appendChild(wr);
            row.appendChild(br);
        });
        el.appendChild(row);
    }
    return el;
}

function nodeEl(m) {
    const n = document.createElement('div');
    n.className = 'person-node' + (m.dod ? ' deceased' : '');
    n.onclick = e => { e.stopPropagation(); showDetail(m.id); };
    const by = getYear(m.dob), dy = getYear(m.dod);
    n.innerHTML =
        (m.dod ? '<div class="deceased-badge">🕊️</div>' : '') +
        '<div class="node-photo">' + photoEl(m.photo) + '</div>' +
        '<div class="node-name">' + esc(m.name) + '</div>' +
        '<div class="node-dates">' + (dy ? by + ' — ' + dy : by ? 'b. ' + by : '') + '</div>';
    return n;
}

// =============================================
// ZOOM & PAN
// =============================================
let zoomState = { scale: 0.85, panX: 0, panY: 0, dragging: false, startX: 0, startY: 0 };
function initZoomPan(container, inner) {
    function applyTransform() {
        inner.style.transform = 'translate(' + zoomState.panX + 'px,' + zoomState.panY + 'px) scale(' + zoomState.scale + ')';
    }
    applyTransform();
    // Mouse wheel zoom
    container.addEventListener('wheel', function(e) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -0.08 : 0.08;
        zoomState.scale = Math.min(2, Math.max(0.2, zoomState.scale + delta));
        applyTransform();
    }, { passive: false });
    // Mouse drag pan
    container.addEventListener('mousedown', function(e) {
        if (e.target.closest('.person-node') || e.target.closest('.zoom-controls')) return;
        zoomState.dragging = true;
        zoomState.startX = e.clientX - zoomState.panX;
        zoomState.startY = e.clientY - zoomState.panY;
        container.style.cursor = 'grabbing';
    });
    window.addEventListener('mousemove', function(e) {
        if (!zoomState.dragging) return;
        zoomState.panX = e.clientX - zoomState.startX;
        zoomState.panY = e.clientY - zoomState.startY;
        applyTransform();
    });
    window.addEventListener('mouseup', function() {
        zoomState.dragging = false;
        container.style.cursor = 'grab';
    });
    // Touch pinch zoom + drag
    let lastTouchDist = 0, lastTouchMid = null;
    container.addEventListener('touchstart', function(e) {
        if (e.touches.length === 2) {
            lastTouchDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
            lastTouchMid = { x: (e.touches[0].clientX + e.touches[1].clientX) / 2, y: (e.touches[0].clientY + e.touches[1].clientY) / 2 };
        } else if (e.touches.length === 1 && !e.target.closest('.person-node')) {
            zoomState.dragging = true;
            zoomState.startX = e.touches[0].clientX - zoomState.panX;
            zoomState.startY = e.touches[0].clientY - zoomState.panY;
        }
    }, { passive: true });
    container.addEventListener('touchmove', function(e) {
        if (e.touches.length === 2) {
            e.preventDefault();
            const dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
            const ratio = dist / lastTouchDist;
            zoomState.scale = Math.min(2, Math.max(0.2, zoomState.scale * ratio));
            lastTouchDist = dist;
            applyTransform();
        } else if (e.touches.length === 1 && zoomState.dragging) {
            zoomState.panX = e.touches[0].clientX - zoomState.startX;
            zoomState.panY = e.touches[0].clientY - zoomState.startY;
            applyTransform();
        }
    }, { passive: false });
    container.addEventListener('touchend', function() { zoomState.dragging = false; });
}
function treeZoom(delta) {
    zoomState.scale = Math.min(2, Math.max(0.2, zoomState.scale + delta));
    const inner = document.getElementById('tree-inner');
    if (inner) inner.style.transform = 'translate(' + zoomState.panX + 'px,' + zoomState.panY + 'px) scale(' + zoomState.scale + ')';
}
function treeZoomReset() {
    zoomState = { scale: 0.85, panX: 0, panY: 0, dragging: false, startX: 0, startY: 0 };
    const inner = document.getElementById('tree-inner');
    if (inner) inner.style.transform = 'translate(0px,0px) scale(0.85)';
}
// =============================================
// LIST VIEW
// =============================================
function renderList() {
    const c = document.getElementById('list-container');
    const q = (document.getElementById('search-input').value || '').toLowerCase();
    let members = [...state.members].sort((a, b) => a.name.localeCompare(b.name));
    if (q) members = members.filter(m => (m.name + ' ' + m.middleName).toLowerCase().includes(q));
    if (!members.length) {
        c.innerHTML = '<div class="empty-state" style="grid-column:1/-1">' +
            (q ? '🔍 No matches' : '🌱 No members yet!') + '</div>';
        return;
    }
    c.innerHTML = members.map(m => {
        const ev = getEvents(m.id), st = getStories(m.id);
        const by = getYear(m.dob), dy = getYear(m.dod);
        const ds = dy ? by + ' — ' + dy : by ? 'Born ' + by : '';
        let badges = '';
        if (ev.length) badges += '<span class="badge badge-event">📅 ' + ev.length + '</span>';
        if (st.length) badges += '<span class="badge badge-story">📖 ' + st.length + '</span>';
        return '<div class="list-card" onclick="showDetail(\'' + m.id + '\')">' +
            '<div class="list-card-photo">' + photoEl(m.photo) + '</div>' +
            '<div class="list-card-info"><h3>' + (m.dod ? '🕊️ ' : '') +
            esc(m.name) + (m.middleName ? ' ' + esc(m.middleName) : '') + '</h3>' +
            '<p>' + ds + '</p>' +
            (badges ? '<div class="list-card-badges">' + badges + '</div>' : '') +
            '</div></div>';
    }).join('');
}

// =============================================
// DETAIL PANEL
// =============================================
function showDetail(id) {
    const m = getMember(id);
    if (!m) return;
    state.selectedId = id;
    const map = new Map(state.members.map(x => [x.id, x]));
    const ev = getEvents(id), st = getStories(id);
    const spouse = m.spouseIds[0] ? map.get(m.spouseIds[0]) : null;
    const parents = m.parentIds.map(i => map.get(i)).filter(Boolean);
    const children = m.childrenIds.map(i => map.get(i)).filter(Boolean);
    const by = getYear(m.dob), dy = getYear(m.dod);
    const dateStr = dy ? by + ' — ' + dy + ' 🕊️' : m.dob ? 'Born ' + fmtDate(m.dob) : '';

    const panel = document.getElementById('detail-panel');
    let html = '<div class="detail-header">' +
        '<button class="detail-close" onclick="closeDetail()">✕</button>' +
        '<div class="detail-photo">' + photoEl(m.photo) + '</div>' +
        '<div class="detail-name">' + esc(m.name) + (m.middleName ? ' ' + esc(m.middleName) : '') + '</div>' +
        '<div class="detail-dates">' + dateStr + '</div></div>' +
        '<div class="detail-body">';

    // Details section
    html += '<div class="detail-section"><div class="detail-section-header">' +
        '<span class="detail-section-title">📋 Details</span>' +
        '<button class="btn btn-sm btn-outline" onclick="showEditModal(\'' + id + '\')">' +
        '✏️ Edit</button></div>' +
        '<div class="detail-info-grid">' +
        '<div class="info-item"><label>📅 Born</label><span>' + fmtDate(m.dob) + '</span></div>' +
        '<div class="info-item"><label>' + (m.dod ? '🕊️ Died' : '🎂 Age') + '</label><span>' +
        (m.dod ? fmtDate(m.dod) : m.dob ? calcAge(m.dob, m.dod) + ' years' : '—') +
        '</span></div></div></div>';

    // Spouse section
    if (spouse) {
        html += '<div class="detail-section"><span class="detail-section-title">\ud83d\udc9b Spouse</span>' +
            '<div class="relation-chips" style="margin-top:8px">';
        html += '<div class="relation-chip" onclick="showDetail(\'' + spouse.id + '\')">'
            + '\ud83d\udc9b ' + esc(spouse.name) + '</div>';
        html += '</div></div>';
    }
    // Parents section
    if (parents.length) {
        html += '<div class="detail-section"><span class="detail-section-title">\ud83d\udc64 Parents</span>' +
            '<div class="relation-chips" style="margin-top:8px">';
        parents.forEach(p => {
            html += '<div class="relation-chip" onclick="showDetail(\'' + p.id + '\')">'
                + '\ud83d\udc64 ' + esc(p.name) + '</div>';
        });
        html += '</div></div>';
    }
    // Children section
    if (children.length) {
        html += '<div class="detail-section"><span class="detail-section-title">\ud83d\udc76 Children</span>' +
            '<div class="relation-chips" style="margin-top:8px">';
        children.forEach(c => {
            html += '<div class="relation-chip" onclick="showDetail(\'' + c.id + '\')">'
                + '\ud83d\udc76 ' + esc(c.name) + '</div>';
        });
        html += '</div></div>';
    }
    if (false) { /* legacy */
        html += '<div class="detail-section"><span class="detail-section-title">👨‍👩‍👧‍👦 Family</span>' +
            '<div class="relation-chips" style="margin-top:8px">';
        if (spouse) html += '<div class="relation-chip" onclick="showDetail(\'' + spouse.id + '\')">' +
            '💛 ' + esc(spouse.name) + '</div>';
        parents.forEach(p => {
            html += '<div class="relation-chip" onclick="showDetail(\'' + p.id + '\')">' +
                '👤 ' + esc(p.name) + '</div>';
        });
        children.forEach(c => {
            html += '<div class="relation-chip" onclick="showDetail(\'' + c.id + '\')">' +
                '👶 ' + esc(c.name) + '</div>';
        });
        html += '</div></div>';
    }

    // Events section
    html += '<div class="detail-section"><div class="detail-section-header">' +
        '<span class="detail-section-title">📅 Events (' + ev.length + ')</span>' +
        '<button class="btn btn-sm btn-outline" onclick="showAddEventModal(\'' + id + '\')">➕</button></div>';
    if (ev.length) {
        ev.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
        ev.forEach(e => {
            html += '<div class="event-card"><div class="event-card-header">' +
                '<span class="event-type-icon">' + (EVENT_ICONS[e.type] || '📌') + '</span>' +
                '<span class="event-title">' + esc(e.title) + '</span></div>' +
                '<div class="event-date">' + (e.type || '') + (e.type && e.date ? ' · ' : '') +
                fmtDate(e.date) + '</div></div>';
        });
    } else html += '<p style="color:var(--text-light);font-size:0.88rem">No events yet</p>';
    html += '</div>';

    // Stories section
    html += '<div class="detail-section"><div class="detail-section-header">' +
        '<span class="detail-section-title">📖 Stories (' + st.length + ')</span>' +
        '<button class="btn btn-sm btn-outline" onclick="showAddStoryModal(\'' + id + '\')">➕</button></div>';
    if (st.length) {
        st.forEach(s => {
            html += '<div class="story-card" onclick="toggleStory(\'' + s.id + '\')">' +
                '<div class="story-card-header"><span>📖</span>' +
                '<span class="story-title">' + esc(s.title) + '</span></div>' +
                '<div class="story-date">' + fmtDate(s.date) + '</div>' +
                '<div class="story-content" id="story-' + s.id + '" ' +
                'style="display:none;margin-top:8px;font-size:0.85rem;white-space:pre-wrap;' +
                'border-top:1px solid #eee;padding-top:8px"></div></div>';
        });
    } else html += '<p style="color:var(--text-light);font-size:0.88rem">No stories yet</p>';
    html += '</div></div>';

    panel.innerHTML = html;
    panel.classList.add('open');
    document.getElementById('panel-overlay').classList.add('open');
}

function closeDetail() {
    document.getElementById('detail-panel').classList.remove('open');
    document.getElementById('panel-overlay').classList.remove('open');
}

async function toggleStory(id) {
    const el = document.getElementById('story-' + id);
    if (!el) return;
    if (el.style.display === 'none') {
        el.style.display = 'block';
        if (!el.dataset.loaded) {
            el.textContent = 'Loading...';
            try {
                const d = await apiFetch('/v1/blocks/' + id + '/children?page_size=100', 'GET');
                const txt = d.results.filter(b => b.type === 'paragraph')
                    .map(b => b.paragraph.rich_text.map(t => t.plain_text).join('')).join('\n');
                el.textContent = txt || '(Empty)';
                el.dataset.loaded = '1';
            } catch { el.textContent = '(Could not load)'; }
        }
    } else el.style.display = 'none';
}

// =============================================
// ADD PERSON MODAL
// =============================================
function showAddPersonModal() {
    const opts = state.members.map(m =>
        '<option value="' + m.id + '">' + esc(m.name) + '</option>'
    ).join('');
    showModal(
        '<div class="modal-title">➕ Add Family Member</div>' +
        fg('👤 First Name *', '<input id="fm-name">') +
        fg('👤 Middle Name', '<input id="fm-mid">') +
        fg('📅 Date of Birth', '<input type="date" id="fm-dob">') +
        fg('🕊️ Date of Death', '<input type="date" id="fm-dod">') +
        fg('📸 Photo URL', '<input type="url" id="fm-photo" placeholder="https://...">') +
        fg('💛 Spouse', '<select id="fm-spouse"><option value="">— None —</option>' + opts + '</select>') +
        fg('👤 Parent 1', '<select id="fm-p1"><option value="">— None —</option>' + opts + '</select>') +
        fg('👤 Parent 2', '<select id="fm-p2"><option value="">— None —</option>' + opts + '</select>') +
        '<div class="form-actions">' +
        '<button class="btn btn-outline" onclick="closeModal()">Cancel</button>' +
        '<button class="btn btn-sage" onclick="submitAddPerson()">🌿 Add</button></div>'
    );
}

async function submitAddPerson() {
    const name = document.getElementById('fm-name').value.trim();
    if (!name) return toast('❌ Name is required!');
    const props = { 'Name': { title: [{ text: { content: name } }] } };
    const mid = document.getElementById('fm-mid').value.trim();
    if (mid) props['Middle Name'] = { rich_text: [{ text: { content: mid } }] };
    const dob = document.getElementById('fm-dob').value;
    if (dob) props['Date of Birth'] = { date: { start: dob } };
    const dod = document.getElementById('fm-dod').value;
    if (dod) props['Date of Death'] = { date: { start: dod } };
    const photo = document.getElementById('fm-photo').value.trim();
    if (photo) props['Photo'] = { files: [{ type: 'external', name: 'photo', external: { url: photo } }] };
    const sp = document.getElementById('fm-spouse').value;
    if (sp) props['Spouse'] = { relation: [{ id: sp }] };
    const pids = [document.getElementById('fm-p1').value, document.getElementById('fm-p2').value].filter(Boolean);
    if (pids.length) props['Parents'] = { relation: pids.map(id => ({ id })) };
    try {
        toast('⏳ Creating...');
        await apiFetch('/v1/pages', 'POST', {
            parent: { database_id: CONFIG.FAMILY_DB_ID }, properties: props
        });
        closeModal();
        toast('✅ Member added!');
        await loadAll();
    } catch (e) { console.error(e); toast('❌ Failed — check console'); }
}

// =============================================
// EDIT PERSON MODAL
// =============================================
function showEditModal(id) {
    const m = getMember(id);
    if (!m) return;
    const opts = state.members.filter(x => x.id !== id)
        .map(x => '<option value="' + x.id + '">' + esc(x.name) + '</option>').join('');
    showModal(
        '<div class="modal-title">✏️ Edit ' + esc(m.name) + '</div>' +
        fg('👤 First Name', '<input id="em-name" value="' + esc(m.name) + '">') +
        fg('👤 Middle Name', '<input id="em-mid" value="' + esc(m.middleName) + '">') +
        fg('📅 Date of Birth', '<input type="date" id="em-dob" value="' + (m.dob || '') + '">') +
        fg('🕊️ Date of Death', '<input type="date" id="em-dod" value="' + (m.dod || '') + '">') +
        fg('📸 Photo URL', '<input type="url" id="em-photo" value="' + esc(m.photo || '') + '">') +
        fg('💛 Spouse', '<select id="em-spouse"><option value="">— None —</option>' + opts + '</select>') +
        fg('👤 Parent 1', '<select id="em-p1"><option value="">— None —</option>' + opts + '</select>') +
        fg('👤 Parent 2', '<select id="em-p2"><option value="">— None —</option>' + opts + '</select>') +
        '<div class="form-actions">' +
        '<button class="btn btn-outline" onclick="closeModal()">Cancel</button>' +
        '<button class="btn" onclick="submitEdit(\'' + id + '\')">💾 Save</button></div>'
    );
    // Pre-select current values
    if (m.spouseIds[0]) document.getElementById('em-spouse').value = m.spouseIds[0];
    if (m.parentIds[0]) document.getElementById('em-p1').value = m.parentIds[0];
    if (m.parentIds[1]) document.getElementById('em-p2').value = m.parentIds[1];
}

async function submitEdit(id) {
    const props = {};
    const name = document.getElementById('em-name').value.trim();
    if (name) props['Name'] = { title: [{ text: { content: name } }] };
    const mid = document.getElementById('em-mid').value.trim();
    props['Middle Name'] = { rich_text: mid ? [{ text: { content: mid } }] : [] };
    const dob = document.getElementById('em-dob').value;
    props['Date of Birth'] = dob ? { date: { start: dob } } : { date: null };
    const dod = document.getElementById('em-dod').value;
    props['Date of Death'] = dod ? { date: { start: dod } } : { date: null };
    const photo = document.getElementById('em-photo').value.trim();
    props['Photo'] = photo ? { files: [{ type: 'external', name: 'photo', external: { url: photo } }] } : { files: [] };
    const sp = document.getElementById('em-spouse').value;
    props['Spouse'] = sp ? { relation: [{ id: sp }] } : { relation: [] };
    const pids = [document.getElementById('em-p1').value, document.getElementById('em-p2').value].filter(Boolean);
    props['Parents'] = { relation: pids.map(id => ({ id })) };
    try {
        toast('⏳ Saving...');
        await apiFetch('/v1/pages/' + id, 'PATCH', { properties: props });
        closeModal();
        toast('✅ Updated!');
        await loadAll();
        if (state.selectedId) showDetail(state.selectedId);
    } catch (e) { console.error(e); toast('❌ Failed — check console'); }
}

// =============================================
// ADD EVENT MODAL
// =============================================
function showAddEventModal(memberId) {
    const m = getMember(memberId);
    const typeOpts = Object.entries(EVENT_ICONS)
        .map(([k, v]) => '<option value="' + k + '">' + v + ' ' + k + '</option>').join('');
    showModal(
        '<div class="modal-title">📅 Add Event' + (m ? ' for ' + esc(m.name) : '') + '</div>' +
        fg('📝 Title *', '<input id="ev-title" placeholder="e.g. Graduated from State U">') +
        fg('🏷️ Type', '<select id="ev-type"><option value="">— Select —</option>' + typeOpts + '</select>') +
        fg('📅 Date', '<input type="date" id="ev-date">') +
        '<div class="form-actions">' +
        '<button class="btn btn-outline" onclick="closeModal()">Cancel</button>' +
        '<button class="btn" onclick="submitEvent(\'' + memberId + '\')">📅 Add</button></div>'
    );
}

async function submitEvent(memberId) {
    const title = document.getElementById('ev-title').value.trim();
    if (!title) return toast('❌ Title is required!');
    const props = {
        'Title': { title: [{ text: { content: title } }] },
        'Family Member': { relation: [{ id: memberId }] },
    };
    const type = document.getElementById('ev-type').value;
    if (type) props['Event Type'] = { select: { name: type } };
    const date = document.getElementById('ev-date').value;
    if (date) props['Date'] = { date: { start: date } };
    try {
        toast('⏳ Creating...');
        await apiFetch('/v1/pages', 'POST', {
            parent: { database_id: CONFIG.EVENTS_DB_ID }, properties: props
        });
        closeModal();
        toast('✅ Event added!');
        await loadAll();
        showDetail(memberId);
    } catch (e) { console.error(e); toast('❌ Failed'); }
}

// =============================================
// ADD STORY MODAL
// =============================================
function showAddStoryModal(memberId) {
    const m = getMember(memberId);
    showModal(
        '<div class="modal-title">📖 Add Story' + (m ? ' for ' + esc(m.name) : '') + '</div>' +
        fg('📝 Title *', '<input id="st-title" placeholder="e.g. The time Grandpa caught the big fish">') +
        fg('📅 When it happened', '<input type="date" id="st-date">') +
        fg('📖 Story', '<textarea id="st-text" rows="5" placeholder="Tell the story..."></textarea>') +
        '<div class="form-actions">' +
        '<button class="btn btn-outline" onclick="closeModal()">Cancel</button>' +
        '<button class="btn" onclick="submitStory(\'' + memberId + '\')">📖 Add</button></div>'
    );
}

async function submitStory(memberId) {
    const title = document.getElementById('st-title').value.trim();
    if (!title) return toast('❌ Title is required!');
    const props = {
        'Title': { title: [{ text: { content: title } }] },
        'Family Member': { relation: [{ id: memberId }] },
    };
    const date = document.getElementById('st-date').value;
    if (date) props['Date'] = { date: { start: date } };
    try {
        toast('⏳ Creating...');
        const pg = await apiFetch('/v1/pages', 'POST', {
            parent: { database_id: CONFIG.STORIES_DB_ID }, properties: props
        });
        const txt = document.getElementById('st-text').value.trim();
        if (txt) {
            await apiFetch('/v1/blocks/' + pg.id + '/children', 'PATCH', {
                children: [{
                    object: 'block', type: 'paragraph',
                    paragraph: { rich_text: [{ type: 'text', text: { content: txt } }] }
                }]
            });
        }
        closeModal();
        toast('✅ Story added!');
        await loadAll();
        showDetail(memberId);
    } catch (e) { console.error(e); toast('❌ Failed'); }
}

// =============================================
// MODAL HELPERS
// =============================================
function showModal(html) {
    document.getElementById('modal-container').innerHTML =
        '<div class="modal-overlay" onclick="closeModal()">' +
        '<div class="modal-card" onclick="event.stopPropagation()">' +
        html + '</div></div>';
}

function closeModal() {
    document.getElementById('modal-container').innerHTML = '';
}

// =============================================
// INIT
// =============================================
document.addEventListener('DOMContentLoaded', () => {
    initAuth();
    initNav();
});
