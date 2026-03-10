// =============================================
// 🌳 GENEALOTREE APP — Configuration
// =============================================
const CONFIG = {
    PASSWORD: 'sc0ttmill@r_ext',
    PROXY_URL: 'https://silent-lab-14d9.scottmillergavin.workers.dev',
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
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
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
        id: pg.id,
        name: pTitle(p['Name']),
        middleName: pText(p['Middle Name']),
        photo: pFile(p['Photo']),
        dob: pDate(p['Date of Birth']),
        dod: pDate(p['Date of Death']),
        spouseIds: pRel(p['Spouse']),
        childrenIds: pRel(p['Children']),
        parentIds: pRel(p['Parents']),
        eventIds: pRel(p['Events']),
        storyIds: pRel(p['Stories']),
    };
}

function parseEvent(pg) {
    const p = pg.properties;
    return {
        id: pg.id,
        title: pTitle(p['Title']),
        type: pSelect(p['Event Type']),
        date: pDate(p['Date']),
        memberIds: pRel(p['Family Member'])
    };
}

function parseStory(pg) {
    const p = pg.properties;
    return {
        id: pg.id,
        title: pTitle(p['Title']),
        date: pDate(p['Date']),
        memberIds: pRel(p['Family Member'])
    };
}

// =============================================
// DATA LOADING
// =============================================
function normalizeRelationships() {
    const map = new Map(state.members.map(m => [m.id, m]));
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
    } finally {
        showLoading(false);
    }
}

// =============================================
// HELPERS
// =============================================
const getMember = id => state.members.find(m => m.id === id);
const getEvents = id => state.events.filter(e => e.memberIds.includes(id));
const getStories = id => state.stories.filter(s => s.memberIds.includes(id));
const fmtDate = d => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
const getYear = d => d ? new Date(d + 'T00:00:00').getFullYear() : null;
const photoEl = url => url ? '<img src="' + url + '" onerror="this.outerHTML=SILHOUETTE">' : SILHOUETTE;

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
    if (end.getMonth() < b.getMonth() || (end.getMonth() === b.getMonth() && end.getDate() < b.getDate())) a--;
    return a;
}

function fg(label, input) {
    return '<div class="form-group"><label>' + label + '</label>' + input + '</div>';
}

function esc(s) {
    return (s || '').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function memberSort(a, b) {
    return (a.dob || '9999-12-31').localeCompare(b.dob || '9999-12-31') ||
        (a.name || '').localeCompare(b.name || '');
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
// TREE VIEW — Layered Generations
// =============================================
function buildGenerationLayout() {
    const members = [...state.members];
    const memberMap = new Map(members.map(m => [m.id, m]));
    const parentOf = new Map();

    members.forEach(m => {
        parentOf.set(m.id, m.parentIds.filter(pid => memberMap.has(pid)));
    });

    const uf = {};
    members.forEach(m => { uf[m.id] = m.id; });

    const find = id => uf[id] === id ? id : (uf[id] = find(uf[id]));
    const union = (a, b) => {
        const ra = find(a);
        const rb = find(b);
        if (ra !== rb) uf[rb] = ra;
    };

    members.forEach(m => {
        m.spouseIds.filter(sid => memberMap.has(sid)).forEach(sid => union(m.id, sid));
    });

    const groups = new Map();
    const memberToGroupId = new Map();

    members.forEach(m => {
        const groupId = find(m.id);
        memberToGroupId.set(m.id, groupId);
        if (!groups.has(groupId)) {
            groups.set(groupId, {
                id: groupId,
                members: [],
                parentGroupIds: new Set(),
                childGroupIds: new Set(),
                depth: 0,
                sortKey: '',
            });
        }
        groups.get(groupId).members.push(m);
    });

    groups.forEach(group => {
        group.members.sort(memberSort);
        group.sortKey = group.members.map(m => (m.dob || '9999-12-31') + '|' + m.name).join('||');
    });

    members.forEach(child => {
        const childGroupId = memberToGroupId.get(child.id);
        parentOf.get(child.id).forEach(parentId => {
            const parentGroupId = memberToGroupId.get(parentId);
            if (!parentGroupId || parentGroupId === childGroupId) return;
            groups.get(parentGroupId).childGroupIds.add(childGroupId);
            groups.get(childGroupId).parentGroupIds.add(parentGroupId);
        });
    });

    const depthMemo = new Map();
    function depthOf(groupId, stack = new Set()) {
        if (depthMemo.has(groupId)) return depthMemo.get(groupId);
        if (stack.has(groupId)) return 0;
        stack.add(groupId);
        let depth = 0;
        groups.get(groupId).parentGroupIds.forEach(parentGroupId => {
            depth = Math.max(depth, depthOf(parentGroupId, stack) + 1);
        });
        stack.delete(groupId);
        depthMemo.set(groupId, depth);
        return depth;
    }

    groups.forEach(group => {
        group.depth = depthOf(group.id);
    });

    const rowsMap = new Map();
    [...groups.values()].forEach(group => {
        if (!rowsMap.has(group.depth)) rowsMap.set(group.depth, []);
        rowsMap.get(group.depth).push(group);
    });

    const unitById = new Map();
    const groupToUnitId = new Map();
    const rows = [];

    function sharedChildCount(a, b) {
        let count = 0;
        a.childGroupIds.forEach(childGroupId => {
            if (b.childGroupIds.has(childGroupId)) count++;
        });
        return count;
    }

    [...rowsMap.keys()].sort((a, b) => a - b).forEach(depth => {
        const layerGroups = rowsMap.get(depth).slice().sort((a, b) => a.sortKey.localeCompare(b.sortKey));
        const remaining = new Set(layerGroups.map(group => group.id));
        const row = { depth, units: [] };

        while (remaining.size) {
            const group = layerGroups.find(candidate => remaining.has(candidate.id));
            remaining.delete(group.id);

            const sourceGroups = [group];
            if (group.members.length === 1) {
                let bestMatch = null;
                let bestScore = 0;
                layerGroups.forEach(other => {
                    if (!remaining.has(other.id) || other.members.length !== 1) return;
                    const score = sharedChildCount(group, other);
                    if (score > bestScore || (score === bestScore && score > 0 && other.sortKey < (bestMatch?.sortKey || ''))) {
                        bestScore = score;
                        bestMatch = other;
                    }
                });
                if (bestMatch && bestScore > 0) {
                    remaining.delete(bestMatch.id);
                    sourceGroups.push(bestMatch);
                }
            }

            const membersInUnit = sourceGroups.flatMap(sourceGroup => sourceGroup.members).sort(memberSort);
            const unit = {
                id: 'unit-' + depth + '-' + row.units.length + '-' + membersInUnit.map(m => m.id.slice(0, 4)).join(''),
                depth,
                sourceGroupIds: sourceGroups.map(sourceGroup => sourceGroup.id),
                members: membersInUnit,
                parentUnitIds: new Set(),
                childUnitIds: new Set(),
                sortKey: membersInUnit.map(m => (m.dob || '9999-12-31') + '|' + m.name).join('||'),
            };

            row.units.push(unit);
            unitById.set(unit.id, unit);
            sourceGroups.forEach(sourceGroup => groupToUnitId.set(sourceGroup.id, unit.id));
        }

        rows.push(row);
    });

    groups.forEach(group => {
        const parentUnitId = groupToUnitId.get(group.id);
        group.childGroupIds.forEach(childGroupId => {
            const childUnitId = groupToUnitId.get(childGroupId);
            if (!parentUnitId || !childUnitId || parentUnitId === childUnitId) return;
            unitById.get(parentUnitId).childUnitIds.add(childUnitId);
            unitById.get(childUnitId).parentUnitIds.add(parentUnitId);
        });
    });

    const positionByUnitId = new Map();
    function refreshPositions() {
        rows.forEach(row => {
            row.units.forEach((unit, index) => positionByUnitId.set(unit.id, index));
        });
    }

    function averagePosition(ids) {
        const values = [...ids].filter(id => positionByUnitId.has(id)).map(id => positionByUnitId.get(id));
        if (!values.length) return null;
        return values.reduce((sum, value) => sum + value, 0) / values.length;
    }

    rows.forEach(row => row.units.sort((a, b) => a.sortKey.localeCompare(b.sortKey)));
    refreshPositions();

    for (let i = 1; i < rows.length; i++) {
        rows[i].units.sort((a, b) => {
            const aAnchor = averagePosition(a.parentUnitIds);
            const bAnchor = averagePosition(b.parentUnitIds);
            if (aAnchor != null && bAnchor != null && aAnchor !== bAnchor) return aAnchor - bAnchor;
            if (aAnchor != null && bAnchor == null) return -1;
            if (aAnchor == null && bAnchor != null) return 1;
            return a.sortKey.localeCompare(b.sortKey);
        });
        refreshPositions();
    }

    for (let i = rows.length - 2; i >= 0; i--) {
        rows[i].units.sort((a, b) => {
            const aAnchor = averagePosition(a.childUnitIds);
            const bAnchor = averagePosition(b.childUnitIds);
            if (aAnchor != null && bAnchor != null && aAnchor !== bAnchor) return aAnchor - bAnchor;
            if (aAnchor != null && bAnchor == null) return -1;
            if (aAnchor == null && bAnchor != null) return 1;
            return a.sortKey.localeCompare(b.sortKey);
        });
        refreshPositions();
    }

    refreshPositions();

    const familiesMap = new Map();
    rows.forEach(row => {
        row.units.forEach(unit => {
            if (!unit.parentUnitIds || !unit.parentUnitIds.size) return;
            const parentIds = [...unit.parentUnitIds].sort();
            const key = row.depth + '::' + parentIds.join('|');
            if (!familiesMap.has(key)) {
                familiesMap.set(key, {
                    id: 'family-' + row.depth + '-' + parentIds.map(id => id.slice(-4)).join('-'),
                    depth: row.depth,
                    parentUnitIds: new Set(parentIds),
                    childUnitIds: [],
                });
            }
            familiesMap.get(key).childUnitIds.push(unit.id);
        });
    });

    const families = [...familiesMap.values()].map(family => ({
        ...family,
        childUnitIds: family.childUnitIds.slice().sort((a, b) => (positionByUnitId.get(a) || 0) - (positionByUnitId.get(b) || 0)),
    }));

    return { rows, units: rows.flatMap(row => row.units), families };
}

function generationUnitEl(unit) {
    const el = document.createElement('div');
    el.className = 'generation-unit';
    el.dataset.unitId = unit.id;

    const couple = document.createElement('div');
    couple.className = 'generation-couple';

    unit.members.forEach((member, index) => {
        if (index > 0) {
            const line = document.createElement('div');
            line.className = 'spouse-line';
            couple.appendChild(line);
        }
        couple.appendChild(nodeEl(member, false));
    });

    el.appendChild(couple);
    return el;
}

function drawLayeredConnectors(treeEl, layout) {
    const svg = treeEl.querySelector('.tree-lines');
    if (!svg) return;

    const ns = 'http://www.w3.org/2000/svg';
    svg.innerHTML = '';

    const treeRect = treeEl.getBoundingClientRect();
    const width = Math.ceil(treeEl.scrollWidth || treeEl.getBoundingClientRect().width);
    const height = Math.ceil(treeEl.scrollHeight || treeEl.getBoundingClientRect().height);

    svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
    svg.setAttribute('width', width);
    svg.setAttribute('height', height);

    const anchors = new Map();
    layout.units.forEach(unit => {
        const unitNode = treeEl.querySelector('[data-unit-id="' + unit.id + '"]');
        if (!unitNode) return;
        const rect = unitNode.getBoundingClientRect();
        anchors.set(unit.id, {
            x: rect.left + rect.width / 2 - treeRect.left,
            top: rect.top - treeRect.top,
            bottom: rect.bottom - treeRect.top,
        });
    });

    function addLine(x1, y1, x2, y2) {
        const line = document.createElementNS(ns, 'line');
        line.setAttribute('x1', x1);
        line.setAttribute('y1', y1);
        line.setAttribute('x2', x2);
        line.setAttribute('y2', y2);
        line.setAttribute('stroke', 'var(--line-color)');
        line.setAttribute('stroke-width', '3');
        line.setAttribute('stroke-linecap', 'round');
        svg.appendChild(line);
    }

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    (layout.families || []).forEach(family => {
        const parents = [...family.parentUnitIds]
            .map(parentUnitId => anchors.get(parentUnitId))
            .filter(Boolean)
            .sort((a, b) => a.x - b.x);

        const children = family.childUnitIds
            .map(childUnitId => anchors.get(childUnitId))
            .filter(Boolean)
            .sort((a, b) => a.x - b.x);

        if (!parents.length || !children.length) return;

        const parentBottom = Math.max(...parents.map(parent => parent.bottom));
        const childTop = Math.min(...children.map(child => child.top));
        const gap = childTop - parentBottom;
        if (gap <= 12) return;

        const parentBusY = parentBottom + Math.max(18, Math.min(30, Math.round(gap * 0.28)));
        let childBusY = childTop - Math.max(18, Math.min(30, Math.round(gap * 0.22)));
        if (childBusY <= parentBusY + 12) childBusY = parentBusY + 14;

        const parentXs = parents.map(parent => parent.x);
        const childXs = children.map(child => child.x);
        const parentMin = Math.min(...parentXs);
        const parentMax = Math.max(...parentXs);
        const childAvg = childXs.reduce((sum, x) => sum + x, 0) / childXs.length;
        const trunkX = parents.length > 1 ? clamp(childAvg, parentMin, parentMax) : parentXs[0];

        parents.forEach(parent => addLine(parent.x, parent.bottom, parent.x, parentBusY));
        if (parents.length > 1) addLine(parentMin, parentBusY, parentMax, parentBusY);

        addLine(trunkX, parentBusY, trunkX, childBusY);

        const childBusStart = Math.min(trunkX, ...childXs);
        const childBusEnd = Math.max(trunkX, ...childXs);
        addLine(childBusStart, childBusY, childBusEnd, childBusY);

        children.forEach(child => addLine(child.x, childBusY, child.x, child.top));
    });
}

function renderTree() {
    const c = document.getElementById('tree-container');
    c.innerHTML = '';
    if (!state.members.length) {
        c.innerHTML = '<div class="empty-state">🌱 No family members yet!<br>Click <b>➕ Add Member</b> to get started.</div>';
        return;
    }

    const layout = buildGenerationLayout();

    const zc = document.createElement('div');
    zc.className = 'zoom-controls';
    zc.innerHTML = '<button onclick="treeZoom(0.15)">＋</button><button onclick="treeZoom(-0.15)">－</button><button onclick="treeZoomReset()">⟳</button>';
    c.appendChild(zc);

    const inner = document.createElement('div');
    inner.id = 'tree-inner';
    inner.style.transformOrigin = '0 0';

    const tree = document.createElement('div');
    tree.className = 'layered-tree';

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('tree-lines');
    tree.appendChild(svg);

    layout.rows.forEach(row => {
        const rowEl = document.createElement('div');
        rowEl.className = 'generation-row';
        row.units.forEach(unit => rowEl.appendChild(generationUnitEl(unit)));
        tree.appendChild(rowEl);
    });

    inner.appendChild(tree);
    c.appendChild(inner);
    initZoomPan(c, inner);

    requestAnimationFrame(function() {
        drawLayeredConnectors(tree, layout);
    });
}

// =============================================
// TREE DOM BUILDERS
// =============================================
function nodeEl(m, isBridgeLeaf) {
    const n = document.createElement('div');
    n.className = 'person-node' + (m.dod ? ' deceased' : '') + (isBridgeLeaf ? ' bridge-leaf' : '');
    n.onclick = e => { e.stopPropagation(); showDetail(m.id); };
    const by = getYear(m.dob), dy = getYear(m.dod);
    n.innerHTML =
        (m.dod ? '<div class="deceased-badge">🕊️</div>' : '') +
        '<div class="node-photo">' + photoEl(m.photo) + '</div>' +
        '<div class="node-name">' + esc(m.name) + '</div>' +
        '<div class="node-dates">' + (dy ? by + ' — ' + dy : by ? 'b. ' + by : '') + '</div>' +
        (isBridgeLeaf ? '<div class="bridge-badge">💛 see spouse tree</div>' : '');
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
    container.addEventListener('wheel', function(e) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -0.08 : 0.08;
        zoomState.scale = Math.min(2, Math.max(0.2, zoomState.scale + delta));
        applyTransform();
    }, { passive: false });
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
    let lastTouchDist = 0;
    container.addEventListener('touchstart', function(e) {
        if (e.touches.length === 2) {
            lastTouchDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
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
        c.innerHTML = '<div class="empty-state" style="grid-column:1/-1">' + (q ? '🔍 No matches' : '🌱 No members yet!') + '</div>';
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
            '<div class="list-card-info"><h3>' + (m.dod ? '🕊️ ' : '') + esc(m.name) + (m.middleName ? ' ' + esc(m.middleName) : '') + '</h3>' +
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
    html += '<div class="detail-section"><div class="detail-section-header">' +
        '<span class="detail-section-title">📋 Details</span>' +
        '<button class="btn btn-sm btn-outline" onclick="showEditModal(\'' + id + '\')">✏️ Edit</button></div>' +
        '<div class="detail-info-grid">' +
        '<div class="info-item"><label>📅 Born</label><span>' + fmtDate(m.dob) + '</span></div>' +
        '<div class="info-item"><label>' + (m.dod ? '🕊️ Died' : '🎂 Age') + '</label><span>' + (m.dod ? fmtDate(m.dod) : m.dob ? calcAge(m.dob, m.dod) + ' years' : '—') + '</span></div>' +
        '</div></div>';
    if (spouse) {
        html += '<div class="detail-section"><span class="detail-section-title">💛 Spouse</span><div class="relation-chips" style="margin-top:8px">' +
            '<div class="relation-chip" onclick="showDetail(\'' + spouse.id + '\')">💛 ' + esc(spouse.name) + '</div></div></div>';
    }
    if (parents.length) {
        html += '<div class="detail-section"><span class="detail-section-title">👤 Parents</span><div class="relation-chips" style="margin-top:8px">';
        parents.forEach(p => {
            html += '<div class="relation-chip" onclick="showDetail(\'' + p.id + '\')">👤 ' + esc(p.name) + '</div>';
        });
        html += '</div></div>';
    }
    if (children.length) {
        html += '<div class="detail-section"><span class="detail-section-title">👶 Children</span><div class="relation-chips" style="margin-top:8px">';
        children.forEach(c => {
            html += '<div class="relation-chip" onclick="showDetail(\'' + c.id + '\')">👶 ' + esc(c.name) + '</div>';
        });
        html += '</div></div>';
    }
    html += '<div class="detail-section"><div class="detail-section-header">' +
        '<span class="detail-section-title">📅 Events (' + ev.length + ')</span>' +
        '<button class="btn btn-sm btn-outline" onclick="showAddEventModal(\'' + id + '\')">➕</button></div>';
    if (ev.length) {
        ev.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
        ev.forEach(e => {
            html += '<div class="event-card"><div class="event-card-header">' +
                '<span class="event-type-icon">' + (EVENT_ICONS[e.type] || '📌') + '</span>' +
                '<span class="event-title">' + esc(e.title) + '</span></div>' +
                '<div class="event-date">' + (e.type || '') + (e.type && e.date ? ' · ' : '') + fmtDate(e.date) + '</div></div>';
        });
    } else {
        html += '<p style="color:var(--text-light);font-size:0.88rem">No events yet</p>';
    }
    html += '</div>';
    html += '<div class="detail-section"><div class="detail-section-header">' +
        '<span class="detail-section-title">📖 Stories (' + st.length + ')</span>' +
        '<button class="btn btn-sm btn-outline" onclick="showAddStoryModal(\'' + id + '\')">➕</button></div>';
    if (st.length) {
        st.forEach(s => {
            html += '<div class="story-card" onclick="toggleStory(\'' + s.id + '\')">' +
                '<div class="story-card-header"><span>📖</span><span class="story-title">' + esc(s.title) + '</span></div>' +
                '<div class="story-date">' + fmtDate(s.date) + '</div>' +
                '<div class="story-content" id="story-' + s.id + '" style="display:none;margin-top:8px;font-size:0.85rem;white-space:pre-wrap;border-top:1px solid #eee;padding-top:8px"></div></div>';
        });
    } else {
        html += '<p style="color:var(--text-light);font-size:0.88rem">No stories yet</p>';
    }
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
                const txt = d.results.filter(b => b.type === 'paragraph').map(b => b.paragraph.rich_text.map(t => t.plain_text).join('')).join('\n');
                el.textContent = txt || '(Empty)';
                el.dataset.loaded = '1';
            } catch {
                el.textContent = '(Could not load)';
            }
        }
    } else {
        el.style.display = 'none';
    }
}

// =============================================
// ADD PERSON MODAL
// =============================================
function showAddPersonModal() {
    const opts = state.members.map(m => '<option value="' + m.id + '">' + esc(m.name) + '</option>').join('');
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
        '<div class="form-actions"><button class="btn btn-outline" onclick="closeModal()">Cancel</button><button class="btn btn-sage" onclick="submitAddPerson()">🌿 Add</button></div>'
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
        await apiFetch('/v1/pages', 'POST', { parent: { database_id: CONFIG.FAMILY_DB_ID }, properties: props });
        closeModal();
        toast('✅ Member added!');
        await loadAll();
    } catch (e) {
        console.error(e);
        toast('❌ Failed — check console');
    }
}

// =============================================
// EDIT PERSON MODAL
// =============================================
function showEditModal(id) {
    const m = getMember(id);
    if (!m) return;
    const opts = state.members.filter(x => x.id !== id).map(x => '<option value="' + x.id + '">' + esc(x.name) + '</option>').join('');
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
        '<div class="form-actions"><button class="btn btn-outline" onclick="closeModal()">Cancel</button><button class="btn" onclick="submitEdit(\'' + id + '\')">💾 Save</button></div>'
    );
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
    } catch (e) {
        console.error(e);
        toast('❌ Failed — check console');
    }
}

// =============================================
// ADD EVENT MODAL
// =============================================
function showAddEventModal(memberId) {
    const m = getMember(memberId);
    const typeOpts = Object.entries(EVENT_ICONS).map(([k, v]) => '<option value="' + k + '">' + v + ' ' + k + '</option>').join('');
    showModal(
        '<div class="modal-title">📅 Add Event' + (m ? ' for ' + esc(m.name) : '') + '</div>' +
        fg('📝 Title *', '<input id="ev-title" placeholder="e.g. Graduated from State U">') +
        fg('🏷️ Type', '<select id="ev-type"><option value="">— Select —</option>' + typeOpts + '</select>') +
        fg('📅 Date', '<input type="date" id="ev-date">') +
        '<div class="form-actions"><button class="btn btn-outline" onclick="closeModal()">Cancel</button><button class="btn" onclick="submitEvent(\'' + memberId + '\')">📅 Add</button></div>'
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
        await apiFetch('/v1/pages', 'POST', { parent: { database_id: CONFIG.EVENTS_DB_ID }, properties: props });
        closeModal();
        toast('✅ Event added!');
        await loadAll();
        showDetail(memberId);
    } catch (e) {
        console.error(e);
        toast('❌ Failed');
    }
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
        '<div class="form-actions"><button class="btn btn-outline" onclick="closeModal()">Cancel</button><button class="btn" onclick="submitStory(\'' + memberId + '\')">📖 Add</button></div>'
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
        const pg = await apiFetch('/v1/pages', 'POST', { parent: { database_id: CONFIG.STORIES_DB_ID }, properties: props });
        const txt = document.getElementById('st-text').value.trim();
        if (txt) {
            await apiFetch('/v1/blocks/' + pg.id + '/children', 'PATCH', {
                children: [{
                    object: 'block',
                    type: 'paragraph',
                    paragraph: { rich_text: [{ type: 'text', text: { content: txt } }] }
                }]
            });
        }
        closeModal();
        toast('✅ Story added!');
        await loadAll();
        showDetail(memberId);
    } catch (e) {
        console.error(e);
        toast('❌ Failed');
    }
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
});        title: pTitle(p['Title']),
        type: pSelect(p['Event Type']),
        date: pDate(p['Date']),
        memberIds: pRel(p['Family Member'])
    };
}

function parseStory(pg) {
    const p = pg.properties;
    return {
        id: pg.id,
        title: pTitle(p['Title']),
        date: pDate(p['Date']),
        memberIds: pRel(p['Family Member'])
    };
}

// =============================================
// DATA LOADING
// =============================================
function normalizeRelationships() {
    const map = new Map(state.members.map(m => [m.id, m]));
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
    } finally {
        showLoading(false);
    }
}

// =============================================
// HELPERS
// =============================================
const getMember = id => state.members.find(m => m.id === id);
const getEvents = id => state.events.filter(e => e.memberIds.includes(id));
const getStories = id => state.stories.filter(s => s.memberIds.includes(id));
const fmtDate = d => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
const getYear = d => d ? new Date(d + 'T00:00:00').getFullYear() : null;
const photoEl = url => url ? '<img src="' + url + '" onerror="this.outerHTML=SILHOUETTE">' : SILHOUETTE;

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
    if (end.getMonth() < b.getMonth() || (end.getMonth() === b.getMonth() && end.getDate() < b.getDate())) a--;
    return a;
}

function fg(label, input) {
    return '<div class="form-group"><label>' + label + '</label>' + input + '</div>';
}

function esc(s) {
    return (s || '').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function memberSort(a, b) {
    return (a.dob || '9999-12-31').localeCompare(b.dob || '9999-12-31') ||
        (a.name || '').localeCompare(b.name || '');
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
// TREE VIEW — Layered Generations
// =============================================
function buildGenerationLayout() {
    const members = [...state.members];
    const memberMap = new Map(members.map(m => [m.id, m]));
    const parentOf = new Map();

    members.forEach(m => {
        parentOf.set(m.id, m.parentIds.filter(pid => memberMap.has(pid)));
    });

    const uf = {};
    members.forEach(m => { uf[m.id] = m.id; });

    const find = id => uf[id] === id ? id : (uf[id] = find(uf[id]));
    const union = (a, b) => {
        const ra = find(a);
        const rb = find(b);
        if (ra !== rb) uf[rb] = ra;
    };

    members.forEach(m => {
        m.spouseIds.filter(sid => memberMap.has(sid)).forEach(sid => union(m.id, sid));
    });

    const groups = new Map();
    const memberToGroupId = new Map();

    members.forEach(m => {
        const groupId = find(m.id);
        memberToGroupId.set(m.id, groupId);
        if (!groups.has(groupId)) {
            groups.set(groupId, {
                id: groupId,
                members: [],
                parentGroupIds: new Set(),
                childGroupIds: new Set(),
                depth: 0,
                sortKey: '',
            });
        }
        groups.get(groupId).members.push(m);
    });

    groups.forEach(group => {
        group.members.sort(memberSort);
        group.sortKey = group.members.map(m => (m.dob || '9999-12-31') + '|' + m.name).join('||');
    });

    members.forEach(child => {
        const childGroupId = memberToGroupId.get(child.id);
        parentOf.get(child.id).forEach(parentId => {
            const parentGroupId = memberToGroupId.get(parentId);
            if (!parentGroupId || parentGroupId === childGroupId) return;
            groups.get(parentGroupId).childGroupIds.add(childGroupId);
            groups.get(childGroupId).parentGroupIds.add(parentGroupId);
        });
    });

    const depthMemo = new Map();
    function depthOf(groupId, stack = new Set()) {
        if (depthMemo.has(groupId)) return depthMemo.get(groupId);
        if (stack.has(groupId)) return 0;
        stack.add(groupId);
        let depth = 0;
        groups.get(groupId).parentGroupIds.forEach(parentGroupId => {
            depth = Math.max(depth, depthOf(parentGroupId, stack) + 1);
        });
        stack.delete(groupId);
        depthMemo.set(groupId, depth);
        return depth;
    }

    groups.forEach(group => {
        group.depth = depthOf(group.id);
    });

    const rowsMap = new Map();
    [...groups.values()].forEach(group => {
        if (!rowsMap.has(group.depth)) rowsMap.set(group.depth, []);
        rowsMap.get(group.depth).push(group);
    });

    const unitById = new Map();
    const groupToUnitId = new Map();
    const rows = [];

    function sharedChildCount(a, b) {
        let count = 0;
        a.childGroupIds.forEach(childGroupId => {
            if (b.childGroupIds.has(childGroupId)) count++;
        });
        return count;
    }

    [...rowsMap.keys()].sort((a, b) => a - b).forEach(depth => {
        const layerGroups = rowsMap.get(depth).slice().sort((a, b) => a.sortKey.localeCompare(b.sortKey));
        const remaining = new Set(layerGroups.map(group => group.id));
        const row = { depth, units: [] };

        while (remaining.size) {
            const group = layerGroups.find(candidate => remaining.has(candidate.id));
            remaining.delete(group.id);

            const sourceGroups = [group];
            if (group.members.length === 1) {
                let bestMatch = null;
                let bestScore = 0;
                layerGroups.forEach(other => {
                    if (!remaining.has(other.id) || other.members.length !== 1) return;
                    const score = sharedChildCount(group, other);
                    if (score > bestScore || (score === bestScore && score > 0 && other.sortKey < (bestMatch?.sortKey || ''))) {
                        bestScore = score;
                        bestMatch = other;
                    }
                });
                if (bestMatch && bestScore > 0) {
                    remaining.delete(bestMatch.id);
                    sourceGroups.push(bestMatch);
                }
            }

            const membersInUnit = sourceGroups.flatMap(sourceGroup => sourceGroup.members).sort(memberSort);
            const unit = {
                id: 'unit-' + depth + '-' + row.units.length + '-' + membersInUnit.map(m => m.id.slice(0, 4)).join(''),
                depth,
                sourceGroupIds: sourceGroups.map(sourceGroup => sourceGroup.id),
                members: membersInUnit,
                parentUnitIds: new Set(),
                childUnitIds: new Set(),
                sortKey: membersInUnit.map(m => (m.dob || '9999-12-31') + '|' + m.name).join('||'),
            };

            row.units.push(unit);
            unitById.set(unit.id, unit);
            sourceGroups.forEach(sourceGroup => groupToUnitId.set(sourceGroup.id, unit.id));
        }

        rows.push(row);
    });

    groups.forEach(group => {
        const parentUnitId = groupToUnitId.get(group.id);
        group.childGroupIds.forEach(childGroupId => {
            const childUnitId = groupToUnitId.get(childGroupId);
            if (!parentUnitId || !childUnitId || parentUnitId === childUnitId) return;
            unitById.get(parentUnitId).childUnitIds.add(childUnitId);
            unitById.get(childUnitId).parentUnitIds.add(parentUnitId);
        });
    });

    const positionByUnitId = new Map();
    function refreshPositions() {
        rows.forEach(row => {
            row.units.forEach((unit, index) => positionByUnitId.set(unit.id, index));
        });
    }

    function averagePosition(ids) {
        const values = [...ids].filter(id => positionByUnitId.has(id)).map(id => positionByUnitId.get(id));
        if (!values.length) return null;
        return values.reduce((sum, value) => sum + value, 0) / values.length;
    }

    rows.forEach(row => row.units.sort((a, b) => a.sortKey.localeCompare(b.sortKey)));
    refreshPositions();

    for (let i = 1; i < rows.length; i++) {
        rows[i].units.sort((a, b) => {
            const aAnchor = averagePosition(a.parentUnitIds);
            const bAnchor = averagePosition(b.parentUnitIds);
            if (aAnchor != null && bAnchor != null && aAnchor !== bAnchor) return aAnchor - bAnchor;
            if (aAnchor != null && bAnchor == null) return -1;
            if (aAnchor == null && bAnchor != null) return 1;
            return a.sortKey.localeCompare(b.sortKey);
        });
        refreshPositions();
    }

    for (let i = rows.length - 2; i >= 0; i--) {
        rows[i].units.sort((a, b) => {
            const aAnchor = averagePosition(a.childUnitIds);
            const bAnchor = averagePosition(b.childUnitIds);
            if (aAnchor != null && bAnchor != null && aAnchor !== bAnchor) return aAnchor - bAnchor;
            if (aAnchor != null && bAnchor == null) return -1;
            if (aAnchor == null && bAnchor != null) return 1;
            return a.sortKey.localeCompare(b.sortKey);
        });
        refreshPositions();
    }

    refreshPositions();

    const familiesMap = new Map();
    rows.forEach(row => {
        row.units.forEach(unit => {
            if (!unit.parentUnitIds || !unit.parentUnitIds.size) return;
            const parentIds = [...unit.parentUnitIds].sort();
            const key = row.depth + '::' + parentIds.join('|');
            if (!familiesMap.has(key)) {
                familiesMap.set(key, {
                    id: 'family-' + row.depth + '-' + parentIds.map(id => id.slice(-4)).join('-'),
                    depth: row.depth,
                    parentUnitIds: new Set(parentIds),
                    childUnitIds: [],
                });
            }
            familiesMap.get(key).childUnitIds.push(unit.id);
        });
    });

    const families = [...familiesMap.values()].map(family => ({
        ...family,
        childUnitIds: family.childUnitIds.slice().sort((a, b) => (positionByUnitId.get(a) || 0) - (positionByUnitId.get(b) || 0)),
    }));

    return { rows, units: rows.flatMap(row => row.units), families };
}

function generationUnitEl(unit) {
    const el = document.createElement('div');
    el.className = 'generation-unit';
    el.dataset.unitId = unit.id;

    const couple = document.createElement('div');
    couple.className = 'generation-couple';

    unit.members.forEach((member, index) => {
        if (index > 0) {
            const line = document.createElement('div');
            line.className = 'spouse-line';
            couple.appendChild(line);
        }
        couple.appendChild(nodeEl(member, false));
    });

    el.appendChild(couple);
    return el;
}

function drawLayeredConnectors(treeEl, layout) {
    const svg = treeEl.querySelector('.tree-lines');
    if (!svg) return;

    const ns = 'http://www.w3.org/2000/svg';
    svg.innerHTML = '';

    const treeRect = treeEl.getBoundingClientRect();
    const width = Math.ceil(treeEl.scrollWidth || treeEl.getBoundingClientRect().width);
    const height = Math.ceil(treeEl.scrollHeight || treeEl.getBoundingClientRect().height);

    svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
    svg.setAttribute('width', width);
    svg.setAttribute('height', height);

    const anchors = new Map();
    layout.units.forEach(unit => {
        const unitNode = treeEl.querySelector('[data-unit-id="' + unit.id + '"]');
        if (!unitNode) return;
        const rect = unitNode.getBoundingClientRect();
        anchors.set(unit.id, {
            x: rect.left + rect.width / 2 - treeRect.left,
            top: rect.top - treeRect.top,
            bottom: rect.bottom - treeRect.top,
        });
    });

    function addLine(x1, y1, x2, y2) {
        const line = document.createElementNS(ns, 'line');
        line.setAttribute('x1', x1);
        line.setAttribute('y1', y1);
        line.setAttribute('x2', x2);
        line.setAttribute('y2', y2);
        line.setAttribute('stroke', 'var(--line-color)');
        line.setAttribute('stroke-width', '3');
        line.setAttribute('stroke-linecap', 'round');
        svg.appendChild(line);
    }

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    (layout.families || []).forEach(family => {
        const parents = [...family.parentUnitIds]
            .map(parentUnitId => anchors.get(parentUnitId))
            .filter(Boolean)
            .sort((a, b) => a.x - b.x);

        const children = family.childUnitIds
            .map(childUnitId => anchors.get(childUnitId))
            .filter(Boolean)
            .sort((a, b) => a.x - b.x);

        if (!parents.length || !children.length) return;

        const parentBottom = Math.max(...parents.map(parent => parent.bottom));
        const childTop = Math.min(...children.map(child => child.top));
        const gap = childTop - parentBottom;
        if (gap <= 12) return;

        const parentBusY = parentBottom + Math.max(18, Math.min(30, Math.round(gap * 0.28)));
        let childBusY = childTop - Math.max(18, Math.min(30, Math.round(gap * 0.22)));
        if (childBusY <= parentBusY + 12) childBusY = parentBusY + 14;

        const parentXs = parents.map(parent => parent.x);
        const childXs = children.map(child => child.x);
        const parentMin = Math.min(...parentXs);
        const parentMax = Math.max(...parentXs);
        const childAvg = childXs.reduce((sum, x) => sum + x, 0) / childXs.length;
        const trunkX = parents.length > 1 ? clamp(childAvg, parentMin, parentMax) : parentXs[0];

        parents.forEach(parent => addLine(parent.x, parent.bottom, parent.x, parentBusY));
        if (parents.length > 1) addLine(parentMin, parentBusY, parentMax, parentBusY);

        addLine(trunkX, parentBusY, trunkX, childBusY);

        const childBusStart = Math.min(trunkX, ...childXs);
        const childBusEnd = Math.max(trunkX, ...childXs);
        addLine(childBusStart, childBusY, childBusEnd, childBusY);

        children.forEach(child => addLine(child.x, childBusY, child.x, child.top));
    });
}

function renderTree() {
    const c = document.getElementById('tree-container');
    c.innerHTML = '';
    if (!state.members.length) {
        c.innerHTML = '<div class="empty-state">🌱 No family members yet!<br>Click <b>➕ Add Member</b> to get started.</div>';
        return;
    }

    const layout = buildGenerationLayout();

    const zc = document.createElement('div');
    zc.className = 'zoom-controls';
    zc.innerHTML = '<button onclick="treeZoom(0.15)">＋</button><button onclick="treeZoom(-0.15)">－</button><button onclick="treeZoomReset()">⟳</button>';
    c.appendChild(zc);

    const inner = document.createElement('div');
    inner.id = 'tree-inner';
    inner.style.transformOrigin = '0 0';

    const tree = document.createElement('div');
    tree.className = 'layered-tree';

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('tree-lines');
    tree.appendChild(svg);

    layout.rows.forEach(row => {
        const rowEl = document.createElement('div');
        rowEl.className = 'generation-row';
        row.units.forEach(unit => rowEl.appendChild(generationUnitEl(unit)));
        tree.appendChild(rowEl);
    });

    inner.appendChild(tree);
    c.appendChild(inner);
    initZoomPan(c, inner);

    requestAnimationFrame(function() {
        drawLayeredConnectors(tree, layout);
    });
}

// =============================================
// TREE DOM BUILDERS
// =============================================
function nodeEl(m, isBridgeLeaf) {
    const n = document.createElement('div');
    n.className = 'person-node' + (m.dod ? ' deceased' : '') + (isBridgeLeaf ? ' bridge-leaf' : '');
    n.onclick = e => { e.stopPropagation(); showDetail(m.id); };
    const by = getYear(m.dob), dy = getYear(m.dod);
    n.innerHTML =
        (m.dod ? '<div class="deceased-badge">🕊️</div>' : '') +
        '<div class="node-photo">' + photoEl(m.photo) + '</div>' +
        '<div class="node-name">' + esc(m.name) + '</div>' +
        '<div class="node-dates">' + (dy ? by + ' — ' + dy : by ? 'b. ' + by : '') + '</div>' +
        (isBridgeLeaf ? '<div class="bridge-badge">💛 see spouse tree</div>' : '');
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
    container.addEventListener('wheel', function(e) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -0.08 : 0.08;
        zoomState.scale = Math.min(2, Math.max(0.2, zoomState.scale + delta));
        applyTransform();
    }, { passive: false });
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
    let lastTouchDist = 0;
    container.addEventListener('touchstart', function(e) {
        if (e.touches.length === 2) {
            lastTouchDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
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
        c.innerHTML = '<div class="empty-state" style="grid-column:1/-1">' + (q ? '🔍 No matches' : '🌱 No members yet!') + '</div>';
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
            '<div class="list-card-info"><h3>' + (m.dod ? '🕊️ ' : '') + esc(m.name) + (m.middleName ? ' ' + esc(m.middleName) : '') + '</h3>' +
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
    html += '<div class="detail-section"><div class="detail-section-header">' +
        '<span class="detail-section-title">📋 Details</span>' +
        '<button class="btn btn-sm btn-outline" onclick="showEditModal(\'' + id + '\')">✏️ Edit</button></div>' +
        '<div class="detail-info-grid">' +
        '<div class="info-item"><label>📅 Born</label><span>' + fmtDate(m.dob) + '</span></div>' +
        '<div class="info-item"><label>' + (m.dod ? '🕊️ Died' : '🎂 Age') + '</label><span>' + (m.dod ? fmtDate(m.dod) : m.dob ? calcAge(m.dob, m.dod) + ' years' : '—') + '</span></div>' +
        '</div></div>';
    if (spouse) {
        html += '<div class="detail-section"><span class="detail-section-title">💛 Spouse</span><div class="relation-chips" style="margin-top:8px">' +
            '<div class="relation-chip" onclick="showDetail(\'' + spouse.id + '\')">💛 ' + esc(spouse.name) + '</div></div></div>';
    }
    if (parents.length) {
        html += '<div class="detail-section"><span class="detail-section-title">👤 Parents</span><div class="relation-chips" style="margin-top:8px">';
        parents.forEach(p => {
            html += '<div class="relation-chip" onclick="showDetail(\'' + p.id + '\')">👤 ' + esc(p.name) + '</div>';
        });
        html += '</div></div>';
    }
    if (children.length) {
        html += '<div class="detail-section"><span class="detail-section-title">👶 Children</span><div class="relation-chips" style="margin-top:8px">';
        children.forEach(c => {
            html += '<div class="relation-chip" onclick="showDetail(\'' + c.id + '\')">👶 ' + esc(c.name) + '</div>';
        });
        html += '</div></div>';
    }
    html += '<div class="detail-section"><div class="detail-section-header">' +
        '<span class="detail-section-title">📅 Events (' + ev.length + ')</span>' +
        '<button class="btn btn-sm btn-outline" onclick="showAddEventModal(\'' + id + '\')">➕</button></div>';
    if (ev.length) {
        ev.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
        ev.forEach(e => {
            html += '<div class="event-card"><div class="event-card-header">' +
                '<span class="event-type-icon">' + (EVENT_ICONS[e.type] || '📌') + '</span>' +
                '<span class="event-title">' + esc(e.title) + '</span></div>' +
                '<div class="event-date">' + (e.type || '') + (e.type && e.date ? ' · ' : '') + fmtDate(e.date) + '</div></div>';
        });
    } else {
        html += '<p style="color:var(--text-light);font-size:0.88rem">No events yet</p>';
    }
    html += '</div>';
    html += '<div class="detail-section"><div class="detail-section-header">' +
        '<span class="detail-section-title">📖 Stories (' + st.length + ')</span>' +
        '<button class="btn btn-sm btn-outline" onclick="showAddStoryModal(\'' + id + '\')">➕</button></div>';
    if (st.length) {
        st.forEach(s => {
            html += '<div class="story-card" onclick="toggleStory(\'' + s.id + '\')">' +
                '<div class="story-card-header"><span>📖</span><span class="story-title">' + esc(s.title) + '</span></div>' +
                '<div class="story-date">' + fmtDate(s.date) + '</div>' +
                '<div class="story-content" id="story-' + s.id + '" style="display:none;margin-top:8px;font-size:0.85rem;white-space:pre-wrap;border-top:1px solid #eee;padding-top:8px"></div></div>';
        });
    } else {
        html += '<p style="color:var(--text-light);font-size:0.88rem">No stories yet</p>';
    }
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
                const txt = d.results.filter(b => b.type === 'paragraph').map(b => b.paragraph.rich_text.map(t => t.plain_text).join('')).join('\n');
                el.textContent = txt || '(Empty)';
                el.dataset.loaded = '1';
            } catch {
                el.textContent = '(Could not load)';
            }
        }
    } else {
        el.style.display = 'none';
    }
}

// =============================================
// ADD PERSON MODAL
// =============================================
function showAddPersonModal() {
    const opts = state.members.map(m => '<option value="' + m.id + '">' + esc(m.name) + '</option>').join('');
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
        '<div class="form-actions"><button class="btn btn-outline" onclick="closeModal()">Cancel</button><button class="btn btn-sage" onclick="submitAddPerson()">🌿 Add</button></div>'
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
        await apiFetch('/v1/pages', 'POST', { parent: { database_id: CONFIG.FAMILY_DB_ID }, properties: props });
        closeModal();
        toast('✅ Member added!');
        await loadAll();
    } catch (e) {
        console.error(e);
        toast('❌ Failed — check console');
    }
}

// =============================================
// EDIT PERSON MODAL
// =============================================
function showEditModal(id) {
    const m = getMember(id);
    if (!m) return;
    const opts = state.members.filter(x => x.id !== id).map(x => '<option value="' + x.id + '">' + esc(x.name) + '</option>').join('');
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
        '<div class="form-actions"><button class="btn btn-outline" onclick="closeModal()">Cancel</button><button class="btn" onclick="submitEdit(\'' + id + '\')">💾 Save</button></div>'
    );
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
    } catch (e) {
        console.error(e);
        toast('❌ Failed — check console');
    }
}

// =============================================
// ADD EVENT MODAL
// =============================================
function showAddEventModal(memberId) {
    const m = getMember(memberId);
    const typeOpts = Object.entries(EVENT_ICONS).map(([k, v]) => '<option value="' + k + '">' + v + ' ' + k + '</option>').join('');
    showModal(
        '<div class="modal-title">📅 Add Event' + (m ? ' for ' + esc(m.name) : '') + '</div>' +
        fg('📝 Title *', '<input id="ev-title" placeholder="e.g. Graduated from State U">') +
        fg('🏷️ Type', '<select id="ev-type"><option value="">— Select —</option>' + typeOpts + '</select>') +
        fg('📅 Date', '<input type="date" id="ev-date">') +
        '<div class="form-actions"><button class="btn btn-outline" onclick="closeModal()">Cancel</button><button class="btn" onclick="submitEvent(\'' + memberId + '\')">📅 Add</button></div>'
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
        await apiFetch('/v1/pages', 'POST', { parent: { database_id: CONFIG.EVENTS_DB_ID }, properties: props });
        closeModal();
        toast('✅ Event added!');
        await loadAll();
        showDetail(memberId);
    } catch (e) {
        console.error(e);
        toast('❌ Failed');
    }
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
        '<div class="form-actions"><button class="btn btn-outline" onclick="closeModal()">Cancel</button><button class="btn" onclick="submitStory(\'' + memberId + '\')">📖 Add</button></div>'
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
        const pg = await apiFetch('/v1/pages', 'POST', { parent: { database_id: CONFIG.STORIES_DB_ID }, properties: props });
        const txt = document.getElementById('st-text').value.trim();
        if (txt) {
            await apiFetch('/v1/blocks/' + pg.id + '/children', 'PATCH', {
                children: [{
                    object: 'block',
                    type: 'paragraph',
                    paragraph: { rich_text: [{ type: 'text', text: { content: txt } }] }
                }]
            });
        }
        closeModal();
        toast('✅ Story added!');
        await loadAll();
        showDetail(memberId);
    } catch (e) {
        console.error(e);
        toast('❌ Failed');
    }
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
