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
let state = { members: [], events: [], stories: [], currentView: 'tree', selectedId: null, focusedId: null };
let activeTreeRender = null;

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
const pNum = p => typeof p?.number === 'number' ? p.number : null;
const pFormula = p => {
    const formula = p?.formula;
    if (!formula) return null;
    if (formula.type === 'string') return formula.string || '';
    if (formula.type === 'number') return formula.number != null ? String(formula.number) : null;
    if (formula.type === 'boolean') return formula.boolean ? 'true' : 'false';
    return null;
};
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
        personNumber: pNum(p['PersonID']),
        householdUnitId: pFormula(p['HouseholdUnitID']),
        parentFamilyId: pFormula(p['ParentFamilyID']),
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
        memberIds: pRel(p['Family Member']),
    };
}

function parseStory(pg) {
    const p = pg.properties;
    return {
        id: pg.id,
        title: pTitle(p['Title']),
        date: pDate(p['Date']),
        memberIds: pRel(p['Family Member']),
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
        ensureFocusedId();
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

function getDefaultFocusId() {
    if (!state.members.length) return null;
    const gavin = state.members.find(member => (member.name || '').toLowerCase() === 'gavin scott-miller');
    if (gavin) return gavin.id;
    return [...state.members].sort(memberSort)[0]?.id || null;
}

function ensureFocusedId() {
    if (state.focusedId && getMember(state.focusedId)) return state.focusedId;
    state.focusedId = getDefaultFocusId();
    return state.focusedId;
}

function resetTreeCamera() {
    zoomState = { scale: 0.92, panX: 0, panY: 0, dragging: false, startX: 0, startY: 0 };
    const inner = document.getElementById('tree-inner');
    if (inner) inner.style.transform = 'translate(0px,0px) scale(0.92)';
}

function resetFocusTree() {
    const defaultId = getDefaultFocusId();
    if (!defaultId) return;
    state.focusedId = defaultId;
    if (state.currentView === 'tree') renderTree();
    resetTreeCamera();
}

function setFocusedPerson(id, openDetail = true) {
    if (!getMember(id)) return;
    state.focusedId = id;
    if (state.currentView === 'tree') {
        renderTree();
        resetTreeCamera();
    }
    if (openDetail) showDetail(id);
}

function focusAndShow(id) {
    setFocusedPerson(id, true);
}

function preferredSpouse(member, excludeId = null) {
    if (!member) return null;
    return member.spouseIds
        .map(getMember)
        .filter(Boolean)
        .filter(spouse => spouse.id !== excludeId)
        .sort(memberSort)[0] || null;
}

function displayUnitForPerson(member) {
    if (!member) return [];
    const householdKey = householdKeyForMember(member);
    return state.members
        .filter(candidate => householdKeyForMember(candidate) === householdKey)
        .sort(memberSort);
}

function keyFromIds(ids) {
    return ids.slice().sort().join('|');
}

function householdKeyForMember(member) {
    return member?.householdUnitId || ('HU:' + member?.id);
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
    window.addEventListener('resize', () => {
        if (state.currentView === 'tree') renderTree();
    });
}

function render() {
    state.currentView === 'tree' ? renderTree() : renderList();
}

// =============================================
// TREE VIEW — PERSONS + FAMILY CONNECTORS
// =============================================
function buildGenerationLayout() {
    const members = [...state.members];
    const memberMap = new Map(members.map(m => [m.id, m]));

    const depthMemo = new Map();
    function naturalDepth(memberId, stack = new Set()) {
        if (depthMemo.has(memberId)) return depthMemo.get(memberId);
        if (stack.has(memberId)) return 0;
        stack.add(memberId);
        const member = memberMap.get(memberId);
        const parentIds = (member?.parentIds || []).filter(pid => memberMap.has(pid));
        let depth = 0;
        parentIds.forEach(parentId => {
            depth = Math.max(depth, naturalDepth(parentId, stack) + 1);
        });
        stack.delete(memberId);
        depthMemo.set(memberId, depth);
        return depth;
    }

    const personDepth = new Map();
    members.forEach(member => personDepth.set(member.id, naturalDepth(member.id)));

    let changed = true;
    let guard = 0;
    while (changed && guard < 20) {
        changed = false;
        guard++;
        members.forEach(member => {
            member.spouseIds.filter(sid => memberMap.has(sid)).forEach(spouseId => {
                const target = Math.max(personDepth.get(member.id) || 0, personDepth.get(spouseId) || 0);
                if ((personDepth.get(member.id) || 0) !== target) {
                    personDepth.set(member.id, target);
                    changed = true;
                }
                if ((personDepth.get(spouseId) || 0) !== target) {
                    personDepth.set(spouseId, target);
                    changed = true;
                }
            });
        });
    }

    const unitMap = new Map();
    const personToUnitId = new Map();
    members.slice().sort(memberSort).forEach(member => {
        if (personToUnitId.has(member.id)) return;
        const spouse = member.spouseIds
            .map(id => memberMap.get(id))
            .find(other => other && !personToUnitId.has(other.id) && (personDepth.get(other.id) || 0) === (personDepth.get(member.id) || 0));

        let unitId;
        let people;
        if (spouse) {
            const ids = [member.id, spouse.id].sort();
            unitId = 'unit:' + ids.join('|');
            people = ids.map(id => memberMap.get(id)).sort(memberSort);
        } else {
            unitId = 'unit:' + member.id;
            people = [member];
        }

        const unit = {
            id: unitId,
            depth: personDepth.get(member.id) || 0,
            members: people,
            sortKey: people.map(p => (p.dob || '9999-12-31') + '|' + p.name).join('||'),
            anchorPersonIds: [],
        };

        unitMap.set(unitId, unit);
        people.forEach(person => personToUnitId.set(person.id, unitId));
    });

    [...unitMap.values()].forEach(unit => {
        unit.kind = 'unit';
        unit.parentNodeIds = [];
        unit.childNodeIds = [];
        unit.anchorPersonIds = unit.members
            .filter(person => person.parentIds.length || person.childrenIds.length)
            .map(person => person.id);
        if (!unit.anchorPersonIds.length) unit.anchorPersonIds = unit.members.map(person => person.id);
    });

    const familiesMap = new Map();
    members.forEach(child => {
        const parentIds = child.parentIds.filter(pid => memberMap.has(pid)).sort();
        if (!parentIds.length) return;
        const key = parentIds.join('|');
        if (!familiesMap.has(key)) {
            familiesMap.set(key, { id: 'family:' + key, parentIds: parentIds.slice(), childIds: [] });
        }
        familiesMap.get(key).childIds.push(child.id);
    });

    const families = [...familiesMap.values()].map(family => ({
        ...family,
        childIds: family.childIds.slice().sort((a, b) => memberSort(memberMap.get(a), memberMap.get(b))),
        childUnitIds: [...new Set(family.childIds.map(id => personToUnitId.get(id)).filter(Boolean))],
        parentUnitIds: [...new Set(family.parentIds.map(id => personToUnitId.get(id)).filter(Boolean))],
    }));

    const familyNodeMap = new Map();
    families.forEach(family => {
        const parentDepth = Math.max(...family.parentUnitIds.map(unitId => unitMap.get(unitId)?.depth || 0), 0);
        const childDepth = Math.max(parentDepth + 1, ...family.childUnitIds.map(unitId => unitMap.get(unitId)?.depth || 0));
        const nodeId = 'junction:' + family.id;
        const familyNode = {
            id: nodeId,
            kind: 'family',
            familyId: family.id,
            parentUnitIds: family.parentUnitIds.slice(),
            childUnitIds: family.childUnitIds.slice(),
            rowIndex: parentDepth * 2 + 1,
            depth: parentDepth,
            sortKey: family.parentIds.join('|') + '->' + family.childIds.join('|'),
            parentNodeIds: family.parentUnitIds.slice(),
            childNodeIds: family.childUnitIds.slice(),
        };
        family.rowIndex = familyNode.rowIndex;
        family.childDepth = childDepth;
        family.nodeId = nodeId;
        familyNodeMap.set(nodeId, familyNode);

        family.parentUnitIds.forEach(unitId => {
            const unit = unitMap.get(unitId);
            if (unit && !unit.childNodeIds.includes(nodeId)) unit.childNodeIds.push(nodeId);
        });

        family.childUnitIds.forEach(unitId => {
            const unit = unitMap.get(unitId);
            if (unit && !unit.parentNodeIds.includes(nodeId)) unit.parentNodeIds.push(nodeId);
        });
    });

    const allNodeMap = new Map([
        ...[...unitMap.entries()],
        ...[...familyNodeMap.entries()],
    ]);

    const rowsMap = new Map();
    [...unitMap.values()].forEach(unit => {
        const rowIndex = unit.depth * 2;
        unit.rowIndex = rowIndex;
        if (!rowsMap.has(rowIndex)) rowsMap.set(rowIndex, []);
        rowsMap.get(rowIndex).push(unit);
    });
    [...familyNodeMap.values()].forEach(node => {
        if (!rowsMap.has(node.rowIndex)) rowsMap.set(node.rowIndex, []);
        rowsMap.get(node.rowIndex).push(node);
    });

    const rows = [...rowsMap.keys()].sort((a, b) => a - b).map(rowIndex => ({
        rowIndex,
        depth: rowIndex / 2,
        kind: rowIndex % 2 === 0 ? 'units' : 'families',
        nodes: rowsMap.get(rowIndex).slice().sort((a, b) => a.sortKey.localeCompare(b.sortKey)),
    }));

    allNodeMap.forEach(node => {
        node.lane = 0;
    });

    applyFocusLanes({ rows, families, unitMap, familyNodeMap, allNodeMap });

    return { rows, families, personToUnitId, unitMap, familyNodeMap, allNodeMap, memberMap };
}

function surnameOf(member) {
    const parts = (member?.name || '').trim().split(/\s+/);
    return parts.length ? parts[parts.length - 1].toLowerCase() : '';
}

function familyNodeIdFromPerson(member) {
    const ids = (member?.parentIds || []).slice().sort();
    return ids.length ? 'junction:family:' + ids.join('|') : null;
}

function applyLane(node, lane) {
    if (!node) return;
    if (!node.lane) {
        node.lane = lane;
        return;
    }
    if (node.lane === lane) return;
    if (node.lane === 0) {
        node.lane = lane;
        return;
    }
}

function applyFocusLanes(layout) {
    const candidateUnits = [...layout.unitMap.values()].filter(unit =>
        unit.members.length === 2 &&
        unit.members.some(member => member.parentIds.length) &&
        unit.members.some(member => member.childrenIds.length)
    );
    if (!candidateUnits.length) return;

    candidateUnits.sort((a, b) => {
        const aChildren = a.members.reduce((sum, member) => sum + member.childrenIds.length, 0);
        const bChildren = b.members.reduce((sum, member) => sum + member.childrenIds.length, 0);
        return bChildren - aChildren;
    });

    const focusUnit = candidateUnits[0];
    const focusMembers = focusUnit.members.slice();
    focusMembers.sort((a, b) => {
        const aScott = surnameOf(a).includes('scott-miller') ? -1 : 1;
        const bScott = surnameOf(b).includes('scott-miller') ? -1 : 1;
        if (aScott !== bScott) return aScott - bScott;
        return (a.name || '').localeCompare(b.name || '');
    });
    const leftMember = focusMembers[0];
    const rightMember = focusMembers[1] || focusMembers[0];

    const leftSeedId = familyNodeIdFromPerson(leftMember);
    const rightSeedId = familyNodeIdFromPerson(rightMember);
    if (!leftSeedId && !rightSeedId) return;

    applyLane(focusUnit, -1);

    const seen = new Set();
    function walk(startId, lane, includeFocusUnit) {
        if (!startId) return;
        const queue = [startId];
        while (queue.length) {
            const nodeId = queue.shift();
            const visitKey = lane + ':' + nodeId;
            if (seen.has(visitKey)) continue;
            seen.add(visitKey);
            const node = layout.allNodeMap.get(nodeId);
            if (!node) continue;
            applyLane(node, lane);

            if (node.kind === 'family') {
                node.parentNodeIds.forEach(parentId => queue.push(parentId));
                node.childNodeIds.forEach(childId => {
                    if (!includeFocusUnit && childId === focusUnit.id) return;
                    queue.push(childId);
                });
            } else {
                node.parentNodeIds.forEach(parentId => queue.push(parentId));
                node.childNodeIds.forEach(childId => queue.push(childId));
            }
        }
    }

    walk(leftSeedId, -1, true);
    walk(rightSeedId, 1, false);
}

function median(values) {
    if (!values.length) return null;
    const sorted = values.slice().sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function optimizeRowOrder(layout) {
    const rows = layout.rows.map(row => ({ ...row, nodes: row.nodes.slice() }));
    const orderIndex = new Map();

    function refreshOrderIndex() {
        rows.forEach(row => {
            row.nodes.forEach((node, index) => {
                orderIndex.set(node.id, index);
            });
        });
    }

    function sortRow(row, neighborKey) {
        row.nodes.sort((a, b) => {
            if (a.lane !== b.lane) return a.lane - b.lane;

            const aNeighbors = a[neighborKey]
                .map(nodeId => orderIndex.get(nodeId))
                .filter(index => typeof index === 'number');
            const bNeighbors = b[neighborKey]
                .map(nodeId => orderIndex.get(nodeId))
                .filter(index => typeof index === 'number');

            const aMedian = median(aNeighbors);
            const bMedian = median(bNeighbors);

            if (aMedian != null && bMedian != null && aMedian !== bMedian) return aMedian - bMedian;
            if (aMedian != null && bMedian == null) return -1;
            if (aMedian == null && bMedian != null) return 1;

            const aDegree = aNeighbors.length;
            const bDegree = bNeighbors.length;
            if (aDegree !== bDegree) return bDegree - aDegree;

            return a.sortKey.localeCompare(b.sortKey);
        });
    }

    refreshOrderIndex();

    for (let pass = 0; pass < 8; pass++) {
        for (let rowIndex = 1; rowIndex < rows.length; rowIndex++) {
            sortRow(rows[rowIndex], 'parentNodeIds');
            refreshOrderIndex();
        }
        for (let rowIndex = rows.length - 2; rowIndex >= 0; rowIndex--) {
            sortRow(rows[rowIndex], 'childNodeIds');
            refreshOrderIndex();
        }
    }

    return rows;
}

function placeRowUnits(units, metrics, desiredCenters, sidePad, unitGap) {
    const placements = new Map();
    let cursor = sidePad;
    const finiteDesired = [];
    const laneGap = 120;

    units.forEach(unit => {
        const metric = metrics.get(unit.id) || { width: 0, anchorOffset: 0 };
        const width = metric.width || 0;
        const anchorOffset = Number.isFinite(metric.anchorOffset) ? metric.anchorOffset : width / 2;
        const desired = desiredCenters.get(unit.id);
        let left = cursor;
        if (placements.size) {
            const prevUnit = units[placements.size - 1];
            if ((prevUnit.lane || 0) !== (unit.lane || 0)) left += laneGap;
        }
        if (Number.isFinite(desired)) left = Math.max(left, desired - anchorOffset);
        placements.set(unit.id, { left, width, anchorOffset });
        cursor = left + width + unitGap;
        if (Number.isFinite(desired)) finiteDesired.push({ unitId: unit.id, desired });
    });

    if (finiteDesired.length) {
        const currentAvg = finiteDesired.reduce((sum, entry) => {
            const box = placements.get(entry.unitId);
            return sum + box.left + box.anchorOffset;
        }, 0) / finiteDesired.length;
        const desiredAvg = finiteDesired.reduce((sum, entry) => sum + entry.desired, 0) / finiteDesired.length;
        let shift = desiredAvg - currentAvg;
        const minLeft = Math.min(...units.map(unit => placements.get(unit.id)?.left || 0));
        if (minLeft + shift < sidePad) shift += sidePad - (minLeft + shift);
        if (shift) {
            units.forEach(unit => {
                const box = placements.get(unit.id);
                placements.set(unit.id, { ...box, left: box.left + shift });
            });
        }
    }

    return placements;
}

function computeNodePlacements(rows, metrics, rowY, sidePad, unitGap) {
    const placed = new Map();

    function nodeCenter(nodeId) {
        const box = placed.get(nodeId);
        if (!box) return null;
        const metric = metrics.get(nodeId);
        const anchorOffset = Number.isFinite(metric?.anchorOffset) ? metric.anchorOffset : box.width / 2;
        return box.x + anchorOffset;
    }

    rows.forEach(row => {
        let cursor = sidePad;
        row.nodes.forEach(node => {
            const metric = metrics.get(node.id) || { width: 0, height: 0 };
            const width = metric.width || 0;
            placed.set(node.id, {
                x: cursor,
                y: rowY.get(row.rowIndex),
                width,
                height: metric.height || 0,
            });
            cursor += width + unitGap;
        });
    });

    for (let pass = 0; pass < 6; pass++) {
        rows.forEach(row => {
            const desiredCenters = new Map();
            row.nodes.forEach(node => {
                const centers = node.parentNodeIds.map(nodeCenter).filter(Number.isFinite);
                if (centers.length) {
                    desiredCenters.set(node.id, centers.reduce((sum, value) => sum + value, 0) / centers.length);
                }
            });

            const placements = placeRowUnits(row.nodes, metrics, desiredCenters, sidePad, unitGap);
            row.nodes.forEach(node => {
                const current = placed.get(node.id);
                const next = placements.get(node.id);
                placed.set(node.id, { ...current, x: next.left, y: rowY.get(row.rowIndex) });
            });
        });

        for (let rowIndex = rows.length - 1; rowIndex >= 0; rowIndex--) {
            const row = rows[rowIndex];
            const desiredCenters = new Map();
            row.nodes.forEach(node => {
                const centers = node.childNodeIds.map(nodeCenter).filter(Number.isFinite);
                if (centers.length) {
                    desiredCenters.set(node.id, centers.reduce((sum, value) => sum + value, 0) / centers.length);
                }
            });

            const placements = placeRowUnits(row.nodes, metrics, desiredCenters, sidePad, unitGap);
            row.nodes.forEach(node => {
                const current = placed.get(node.id);
                const next = placements.get(node.id);
                placed.set(node.id, { ...current, x: next.left, y: rowY.get(row.rowIndex) });
            });
        }
    }

    const minLeft = Math.min(...[...placed.values()].map(box => box.x), sidePad);
    if (minLeft < sidePad) {
        const shift = sidePad - minLeft;
        [...placed.entries()].forEach(([nodeId, box]) => {
            placed.set(nodeId, { ...box, x: box.x + shift });
        });
    }

    return placed;
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
        couple.appendChild(nodeEl(member));
    });

    el.appendChild(couple);
    return el;
}

function buildFamilyIndex() {
    const memberMap = new Map(state.members.map(member => [member.id, member]));
    const householdMap = new Map();
    state.members.forEach(member => {
        const key = householdKeyForMember(member);
        if (!householdMap.has(key)) householdMap.set(key, []);
        householdMap.get(key).push(member);
    });

    const familyMap = new Map();
    state.members.forEach(child => {
        const parentIds = child.parentIds.filter(parentId => memberMap.has(parentId)).sort();
        const familyKey = child.parentFamilyId || (parentIds.length ? keyFromIds(parentIds) : '');
        if (!familyKey) return;
        if (!familyMap.has(familyKey)) {
            familyMap.set(familyKey, {
                key: familyKey,
                parentIds: parentIds.slice(),
                parentHouseholdKeys: [...new Set(parentIds.map(parentId => householdKeyForMember(memberMap.get(parentId))))],
                childIds: [],
            });
        }
        const family = familyMap.get(familyKey);
        family.childIds.push(child.id);
        parentIds.forEach(parentId => {
            if (!family.parentIds.includes(parentId)) family.parentIds.push(parentId);
            const householdKey = householdKeyForMember(memberMap.get(parentId));
            if (!family.parentHouseholdKeys.includes(householdKey)) family.parentHouseholdKeys.push(householdKey);
        });
    });

    const families = [...familyMap.values()].map(family => {
        const childUnits = [];
        const seenUnits = new Set();
        family.childIds.slice().sort((a, b) => memberSort(memberMap.get(a), memberMap.get(b))).forEach(childId => {
            const child = memberMap.get(childId);
            if (!child) return;
            const members = displayUnitForPerson(child);
            const unitKey = householdKeyForMember(child);
            if (seenUnits.has(unitKey)) return;
            seenUnits.add(unitKey);
            childUnits.push({
                unitKey,
                primaryId: child.id,
                members,
            });
        });
        return {
            ...family,
            parentUnits: family.parentHouseholdKeys.map(householdKey => ({
                key: householdKey,
                members: (householdMap.get(householdKey) || []).slice().sort(memberSort),
                biologicalIds: family.parentIds.filter(parentId => householdKeyForMember(memberMap.get(parentId)) === householdKey),
            })).filter(unit => unit.members.length),
            childIds: family.childIds.slice().sort((a, b) => memberSort(memberMap.get(a), memberMap.get(b))),
            childUnits,
        };
    });

    const familyByChild = new Map();
    const familiesByParentId = new Map();
    families.forEach(family => {
        family.childIds.forEach(childId => familyByChild.set(childId, family));
        family.parentIds.forEach(parentId => {
            if (!familiesByParentId.has(parentId)) familiesByParentId.set(parentId, []);
            familiesByParentId.get(parentId).push(family);
        });
    });

    return {
        memberMap,
        familyByChild,
        familiesByParentId,
        familiesByParentKey: new Map(families.map(family => [family.key, family])),
    };
}

function bundlePeople(ids, memberMap, limit = 4) {
    const members = ids.map(id => memberMap.get(id)).filter(Boolean).sort(memberSort);
    return {
        visible: members.slice(0, limit),
        overflow: Math.max(0, members.length - limit),
    };
}

function relationTitle(type, depth, members) {
    if (type === 'root') return members.length > 1 ? 'Focused Family' : 'Focused Person';
    if (type === 'ancestor') {
        if (depth === 1) return members.length > 1 ? 'Parent Family' : 'Parent';
        if (depth === 2) return members.length > 1 ? 'Grandparents' : 'Grandparent';
        return 'Earlier Generation';
    }
    if (depth === 1) return members.length > 1 ? 'Child Family' : 'Child';
    if (depth === 2) return members.length > 1 ? 'Grandchild Family' : 'Grandchild';
    return 'Descendant Branch';
}

function householdGroupForParent(parentId, family, index) {
    const parent = index.memberMap.get(parentId);
    if (!parent) return null;
    const householdKey = householdKeyForMember(parent);
    const members = state.members
        .filter(candidate => householdKeyForMember(candidate) === householdKey)
        .sort(memberSort);
    return {
        key: householdKey,
        members,
        biologicalIds: [parentId],
    };
}

function buildAncestorGroupsForChild(childId, index) {
    const family = index.familyByChild.get(childId);
    if (!family) return null;
    const groups = new Map();
    const siblingIds = family.childIds.filter(id => id !== childId);

    (family.parentUnits || []).forEach(unit => {
        if (!groups.has(unit.key)) {
            groups.set(unit.key, {
                key: unit.key,
                members: unit.members,
                biologicalIds: [],
                siblingIds,
            });
        }
        groups.get(unit.key).biologicalIds.push(...unit.biologicalIds);
    });
    return [...groups.values()];
}

function buildAncestorBranch(group, index, depth = 1, visited = new Set()) {
    const visitKey = group.key + ':' + group.biologicalIds.slice().sort().join('|');
    if (visited.has(visitKey)) return null;
    const nextVisited = new Set(visited);
    nextVisited.add(visitKey);

    const bundled = bundlePeople(group.siblingIds || [], index.memberMap);
    const node = {
        id: 'ancestor:' + visitKey,
        type: 'ancestor',
        depth,
        title: relationTitle('ancestor', depth, group.members),
        members: group.members,
        bundle: bundled,
        children: [],
        meta: bundled.visible.length || bundled.overflow ? 'Also in this family' : '',
    };

    const nextGroups = new Map();
    group.biologicalIds.forEach(parentId => {
        const ancestorGroups = buildAncestorGroupsForChild(parentId, index) || [];
        ancestorGroups.forEach(ancestorGroup => {
            if (!nextGroups.has(ancestorGroup.key)) nextGroups.set(ancestorGroup.key, ancestorGroup);
            else nextGroups.get(ancestorGroup.key).biologicalIds.push(...ancestorGroup.biologicalIds);
        });
    });
    [...nextGroups.values()].forEach(nextGroup => {
        nextGroup.biologicalIds = [...new Set(nextGroup.biologicalIds)].sort();
        const branch = buildAncestorBranch(nextGroup, index, depth + 1, nextVisited);
        if (branch) node.children.push(branch);
    });

    return node;
}

function buildDescendantBranch(unit, sourceFamily, index, depth = 1, visited = new Set()) {
    const unitKey = unit.unitKey;
    if (visited.has(unitKey)) return null;
    const nextVisited = new Set(visited);
    nextVisited.add(unitKey);

    const node = {
        id: 'descendant:' + unitKey,
        type: 'descendant',
        depth,
        title: relationTitle('descendant', depth, unit.members),
        members: unit.members,
        bundle: { visible: [], overflow: 0 },
        children: [],
        meta: '',
    };

    const nextFamilies = unit.members
        .flatMap(member => index.familiesByParentId.get(member.id) || [])
        .filter(nextFamily => nextFamily.key !== sourceFamily.key);
    const uniqueFamilies = new Map();
    nextFamilies.forEach(nextFamily => {
        if (!uniqueFamilies.has(nextFamily.key)) uniqueFamilies.set(nextFamily.key, nextFamily);
    });
    [...uniqueFamilies.values()].forEach(nextFamily => {
        nextFamily.childUnits.forEach(childUnit => {
            const branch = buildDescendantBranch(childUnit, nextFamily, index, depth + 1, nextVisited);
            if (branch) node.children.push(branch);
        });
    });

    const childCount = uniqueFamilies.size
        ? uniqueFamilies.size === 1
            ? uniqueFamilies.values().next().value.childIds.length
            : unit.members.reduce((sum, member) => {
                const families = index.familiesByParentId.get(member.id) || [];
                return sum + families.reduce((inner, family) => inner + family.childIds.length, 0);
            }, 0)
        : 0;
    node.meta = childCount ? childCount + (childCount === 1 ? ' child' : ' children') : '';

    return node;
}

function buildFocusedTreeModel() {
    const focusedId = ensureFocusedId();
    const index = buildFamilyIndex();
    const focus = index.memberMap.get(focusedId);
    if (!focus) return null;

    const rootMembers = displayUnitForPerson(focus);
    const rootKey = keyFromIds(rootMembers.map(member => member.id));
    const root = {
        id: 'root:' + rootKey + ':' + focusedId,
        type: 'root',
        depth: 0,
        title: relationTitle('root', 0, rootMembers),
        members: rootMembers,
        bundle: { visible: [], overflow: 0 },
        children: [],
        meta: '',
    };

    const ancestorGroupMap = new Map();
    rootMembers.forEach(member => {
        const groups = buildAncestorGroupsForChild(member.id, index) || [];
        groups.forEach(group => {
            if (!ancestorGroupMap.has(group.key)) ancestorGroupMap.set(group.key, group);
            else ancestorGroupMap.get(group.key).biologicalIds.push(...group.biologicalIds);
        });
    });
    const ancestorRoots = [...ancestorGroupMap.values()].map(group => {
        group.biologicalIds = [...new Set(group.biologicalIds)].sort();
        return buildAncestorBranch(group, index, 1, new Set());
    }).filter(Boolean);

    const descendantFamilyMap = new Map();
    rootMembers.forEach(member => {
        (index.familiesByParentId.get(member.id) || []).forEach(family => {
            descendantFamilyMap.set(family.key, family);
        });
    });
    const descendantRoots = [...descendantFamilyMap.values()]
        .flatMap(family => family.childUnits.map(unit => buildDescendantBranch(unit, family, index, 1, new Set())))
        .filter(Boolean);

    return { root, ancestorRoots, descendantRoots, focusedId };
}

function buildFocusedGraphModel() {
    const focusedId = ensureFocusedId();
    const index = buildFamilyIndex();
    const focus = index.memberMap.get(focusedId);
    if (!focus) return null;

    const focusKey = householdKeyForMember(focus);
    const familyRecords = [...index.familiesByParentKey.values()];
    const unitSource = new Map();
    const outgoing = new Map();
    const incoming = new Map();
    const edgeSet = new Set();

    function ensureUnit(key, members) {
        if (!unitSource.has(key)) unitSource.set(key, { key, members: members.slice().sort(memberSort) });
    }

    function addEdge(from, to) {
        if (!from || !to || from === to) return;
        const edgeKey = from + '>' + to;
        if (edgeSet.has(edgeKey)) return;
        edgeSet.add(edgeKey);
        if (!outgoing.has(from)) outgoing.set(from, []);
        if (!incoming.has(to)) incoming.set(to, []);
        outgoing.get(from).push(to);
        incoming.get(to).push(from);
    }

    state.members.forEach(member => {
        ensureUnit(householdKeyForMember(member), displayUnitForPerson(member));
    });

    familyRecords.forEach(family => {
        family.parentUnits.forEach(unit => ensureUnit(unit.key, unit.members));
        family.childUnits.forEach(unit => ensureUnit(unit.unitKey, unit.members));
        family.parentUnits.forEach(parentUnit => {
            family.childUnits.forEach(childUnit => {
                addEdge(parentUnit.key, childUnit.unitKey);
            });
        });
    });

    const generation = new Map([[focusKey, 0]]);
    const queue = [focusKey];

    while (queue.length) {
        const current = queue.shift();
        const currentGeneration = generation.get(current);

        (outgoing.get(current) || []).forEach(next => {
            if (generation.has(next)) return;
            generation.set(next, currentGeneration + 1);
            queue.push(next);
        });

        (incoming.get(current) || []).forEach(prev => {
            if (generation.has(prev)) return;
            generation.set(prev, currentGeneration - 1);
            queue.push(prev);
        });
    }

    const unitNodes = new Map();
    [...generation.entries()].forEach(([unitKey, level]) => {
        const source = unitSource.get(unitKey);
        const members = source?.members || [];
        const childNodeIds = (outgoing.get(unitKey) || []).filter(next => generation.get(next) === level + 1);
        const parentNodeIds = (incoming.get(unitKey) || []).filter(prev => generation.get(prev) === level - 1);
        const isFocus = unitKey === focusKey;

        let title;
        if (isFocus) title = relationTitle('root', 0, members);
        else if (level < 0) title = relationTitle('ancestor', Math.abs(level), members);
        else if (level === 0) title = members.length > 1 ? 'Sibling Family' : 'Sibling';
        else title = relationTitle('descendant', level, members);

        const directChildCount = childNodeIds.length;
        unitNodes.set(unitKey, {
            id: unitKey,
            key: unitKey,
            type: isFocus ? 'root' : (level < 0 ? 'ancestor' : 'descendant'),
            generation: level,
            depth: Math.abs(level),
            title,
            members,
            bundle: { visible: [], overflow: 0 },
            meta: directChildCount ? directChildCount + (directChildCount === 1 ? ' child' : ' children') : '',
            parentNodeIds,
            childNodeIds,
            sortKey: members.map(member => (member.dob || '9999-12-31') + '|' + member.name).join('||'),
            lane: 0,
        });
    });

    const rowsMap = new Map();
    [...unitNodes.values()].forEach(node => {
        if (!rowsMap.has(node.generation)) rowsMap.set(node.generation, []);
        rowsMap.get(node.generation).push(node);
    });

    const rows = [...rowsMap.keys()].sort((a, b) => a - b).map(generationKey => ({
        rowIndex: generationKey,
        kind: 'units',
        nodes: rowsMap.get(generationKey).slice().sort((a, b) => a.sortKey.localeCompare(b.sortKey)),
    }));

    const edges = [];
    unitNodes.forEach(node => {
        node.childNodeIds.forEach(childId => {
            if (unitNodes.has(childId)) edges.push({ from: node.id, to: childId });
        });
    });

    return { rows, edges, focusKey, unitNodes };
}

function maxDepth(nodes) {
    if (!nodes.length) return 0;
    return Math.max(...nodes.map(node => Math.max(node.depth, maxDepth(node.children))));
}

function estimatePlatformHeight(node) {
    const base = node.type === 'root' ? 118 : 104;
    const personRows = node.members.length * 74;
    const bundleRows = node.bundle.visible.length ? 58 + Math.ceil(node.bundle.visible.length / 2) * 34 : 0;
    return base + personRows + bundleRows;
}

function collectDepthHeights(nodes, sizeOf, map = new Map()) {
    nodes.forEach(node => {
        const current = map.get(node.depth) || 0;
        map.set(node.depth, Math.max(current, sizeOf(node).height));
        collectDepthHeights(node.children, sizeOf, map);
    });
    return map;
}

function ancestorGradientForDepth(depth) {
    if (depth <= 1) return 'linear-gradient(145deg, rgba(255,255,255,0.96), rgba(212,231,197,0.92))';
    if (depth === 2) return 'linear-gradient(145deg, rgba(210,232,192,0.97), rgba(140,185,112,0.95))';
    if (depth === 3) return 'linear-gradient(145deg, rgba(160,205,135,0.97), rgba(90,148,72,0.95))';
    return 'linear-gradient(145deg, rgba(60,105,50,0.98), rgba(28,62,24,0.98))';
}

function subtreeWidth(node, sizeOf, gap) {
    const own = sizeOf(node).width;
    if (!node.children.length) {
        node._subtreeWidth = own;
        node._childOffsets = [];
        return own;
    }
    const childWidths = node.children.map(child => subtreeWidth(child, sizeOf, gap));
    const childrenTotal = childWidths.reduce((sum, width) => sum + width, 0) + gap * (childWidths.length - 1);
    node._subtreeWidth = Math.max(own, childrenTotal);
    let cursor = (node._subtreeWidth - childrenTotal) / 2;
    node._childOffsets = childWidths.map(width => {
        const center = cursor + width / 2;
        cursor += width + gap;
        return center;
    });
    return node._subtreeWidth;
}

function forestWidth(roots, sizeOf, gap, forestGap) {
    if (!roots.length) return 0;
    const widths = roots.map(root => subtreeWidth(root, sizeOf, gap));
    return widths.reduce((sum, width) => sum + width, 0) + forestGap * (widths.length - 1);
}

function collectPositions(node, positions, edges, sizeOf, centerX, y, nextYForDepth, direction) {
    const size = sizeOf(node);
    positions.set(node.id, { x: centerX - size.width / 2, y, width: size.width, height: size.height, node });
    node.children.forEach((child, index) => {
        const childCenterX = centerX - node._subtreeWidth / 2 + node._childOffsets[index];
        const childY = nextYForDepth(child.depth);
        collectPositions(child, positions, edges, sizeOf, childCenterX, childY, nextYForDepth, direction);
        edges.push({
            from: direction > 0 ? node.id : child.id,
            to: direction > 0 ? child.id : node.id,
        });
    });
}

function createPlatformEl(node) {
    const card = document.createElement('div');
    card.className = 'focus-platform focus-platform-' + node.type;
    card.dataset.nodeId = node.id;
    card.dataset.depth = String(node.depth || 0);

    if (node.type === 'ancestor') {
        card.style.setProperty('--platform-gradient', ancestorGradientForDepth(node.depth || 1));
    }

    const header = document.createElement('div');
    header.className = 'focus-platform-header';
    header.innerHTML = '<span class="focus-platform-kicker">' + esc(node.title) + '</span>' +
        (node.meta ? '<span class="focus-platform-meta">' + esc(node.meta) + '</span>' : '');
    card.appendChild(header);

    const people = document.createElement('div');
    people.className = 'focus-platform-people';
    node.members.forEach(member => {
        const row = document.createElement('div');
        row.className = 'focus-person-row' + (member.id === state.focusedId ? ' is-focused' : '');

        const person = document.createElement('button');
        person.className = 'focus-person-chip';
        person.type = 'button';
        person.innerHTML =
            '<span class="focus-person-photo">' + photoEl(member.photo) + '</span>' +
            '<span class="focus-person-copy"><strong>' + esc(member.name) + '</strong><small>' +
            (member.dod ? ((getYear(member.dob) || '—') + ' — ' + (getYear(member.dod) || '—')) : (getYear(member.dob) ? 'b. ' + getYear(member.dob) : '')) +
            '</small></span>';
        person.onclick = e => {
            e.stopPropagation();
            setFocusedPerson(member.id, false);
        };

        const menu = document.createElement('button');
        menu.className = 'focus-chip-menu';
        menu.type = 'button';
        menu.textContent = '...';
        menu.setAttribute('aria-label', 'Open details for ' + member.name);
        menu.onclick = e => {
            e.stopPropagation();
            showDetail(member.id);
        };

        row.appendChild(person);
        row.appendChild(menu);
        people.appendChild(row);
    });
    card.appendChild(people);

    if (node.bundle.visible.length || node.bundle.overflow) {
        const bundle = document.createElement('div');
        bundle.className = 'focus-bundle';
        const label = document.createElement('div');
        label.className = 'focus-bundle-label';
        label.textContent = 'Bundled branch';
        bundle.appendChild(label);

        const chips = document.createElement('div');
        chips.className = 'focus-bundle-chips';
        node.bundle.visible.forEach(member => {
            const chip = document.createElement('button');
            chip.className = 'focus-bundle-chip';
            chip.type = 'button';
            chip.textContent = member.name;
            chip.onclick = e => {
                e.stopPropagation();
                setFocusedPerson(member.id, false);
            };
            chips.appendChild(chip);
        });
        if (node.bundle.overflow) {
            const overflow = document.createElement('span');
            overflow.className = 'focus-bundle-overflow';
            overflow.textContent = '+' + node.bundle.overflow + ' more';
            chips.appendChild(overflow);
        }
        bundle.appendChild(chips);
        card.appendChild(bundle);
    }

    return card;
}

function drawFocusedConnectors(svg, positions, edges) {
    const ns = 'http://www.w3.org/2000/svg';
    svg.innerHTML = '';

    function addPath(points) {
        const path = document.createElementNS(ns, 'path');
        path.setAttribute('d', points.map((point, index) => (index ? 'L' : 'M') + point.x + ' ' + point.y).join(' '));
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', 'var(--line-color)');
        path.setAttribute('stroke-width', '4');
        path.setAttribute('stroke-linecap', 'round');
        path.setAttribute('stroke-linejoin', 'round');
        svg.appendChild(path);
    }

    const childEdgeMap = new Map();
    const parentEdgeMap = new Map();
    const bandEdgeMap = new Map();

    edges.forEach(edge => {
        if (!childEdgeMap.has(edge.to)) childEdgeMap.set(edge.to, []);
        childEdgeMap.get(edge.to).push(edge);

        if (!parentEdgeMap.has(edge.from)) parentEdgeMap.set(edge.from, []);
        parentEdgeMap.get(edge.from).push(edge);

        const from = positions.get(edge.from);
        const to = positions.get(edge.to);
        if (!from || !to) return;
        const bandKey = from.node.generation + '>' + to.node.generation;
        if (!bandEdgeMap.has(bandKey)) bandEdgeMap.set(bandKey, []);
        bandEdgeMap.get(bandKey).push(edge);
    });

    const edgeRouteMap = new Map();
    bandEdgeMap.forEach((bandEdges, bandKey) => {
        const boxes = bandEdges.map(edge => ({
            edge,
            from: positions.get(edge.from),
            to: positions.get(edge.to),
        })).filter(item => item.from && item.to);
        if (!boxes.length) return;

        boxes.sort((a, b) => {
            const aMid = (a.from.x + a.from.width / 2 + a.to.x + a.to.width / 2) / 2;
            const bMid = (b.from.x + b.from.width / 2 + b.to.x + b.to.width / 2) / 2;
            return aMid - bMid;
        });

        const bandTop = Math.max(...boxes.map(item => item.from.y + item.from.height)) + 14;
        const bandBottom = Math.min(...boxes.map(item => item.to.y)) - 14;
        const available = Math.max(18, bandBottom - bandTop);
        const step = boxes.length > 1 ? available / (boxes.length + 1) : available / 2;

        boxes.forEach((item, index) => {
            const laneY = boxes.length > 1 ? bandTop + step * (index + 1) : bandTop + step;
            edgeRouteMap.set(item.edge.from + '>' + item.edge.to, laneY);
        });
    });

    edges.forEach(edge => {
        const from = positions.get(edge.from);
        const to = positions.get(edge.to);
        if (!from || !to) return;
        const outgoingEdges = (parentEdgeMap.get(edge.from) || []).slice().sort((a, b) => {
            const aTo = positions.get(a.to);
            const bTo = positions.get(b.to);
            return (aTo.x + aTo.width / 2) - (bTo.x + bTo.width / 2);
        });
        const incomingEdges = (childEdgeMap.get(edge.to) || []).slice().sort((a, b) => {
            const aFrom = positions.get(a.from);
            const bFrom = positions.get(b.from);
            return (aFrom.x + aFrom.width / 2) - (bFrom.x + bFrom.width / 2);
        });

        const outgoingIndex = Math.max(0, outgoingEdges.findIndex(candidate => candidate.from === edge.from && candidate.to === edge.to));
        const incomingIndex = Math.max(0, incomingEdges.findIndex(candidate => candidate.from === edge.from && candidate.to === edge.to));

        const sourceSpread = Math.min(62, Math.max(18, from.width * 0.16));
        const targetSpread = Math.min(62, Math.max(18, to.width * 0.16));
        const sourceMid = (outgoingEdges.length - 1) / 2;
        const targetMid = (incomingEdges.length - 1) / 2;
        const startX = from.x + from.width / 2 + (outgoingEdges.length > 1 ? (outgoingIndex - sourceMid) * sourceSpread : 0);
        const endX = to.x + to.width / 2 + (incomingEdges.length > 1 ? (incomingIndex - targetMid) * targetSpread : 0);
        const start = { x: startX, y: from.y + from.height };
        const end = { x: endX, y: to.y };
        const highwayY = edgeRouteMap.get(edge.from + '>' + edge.to) || (start.y + (end.y - start.y) / 2);
        addPath([
            start,
            { x: start.x, y: highwayY },
            { x: end.x, y: highwayY },
            end,
        ]);
    });
}

function renderTree() {
    const c = document.getElementById('tree-container');
    c.innerHTML = '';
    if (!state.members.length) {
        c.innerHTML = '<div class="empty-state">🌱 No family members yet!<br>Click <b>➕ Add Member</b> to get started.</div>';
        activeTreeRender = null;
        return;
    }

    const model = buildFocusedGraphModel();
    if (!model) return;

    const sidePad = 80;
    const topPad = 48;
    const bottomPad = 80;
    const rowGap = 92;
    const unitGap = 40;

    const zc = document.createElement('div');
    zc.className = 'zoom-controls';
    zc.innerHTML = '<button onclick="treeZoom(0.15)">＋</button><button onclick="treeZoom(-0.15)">－</button><button onclick="treeZoomReset()">⟳</button>';
    c.appendChild(zc);

    const focusMember = getMember(state.focusedId);
    const toolbar = document.createElement('div');
    toolbar.className = 'focus-toolbar';
    toolbar.innerHTML =
        '<button class="focus-icon-btn" onclick="resetFocusTree()" title="Reset Focus" aria-label="Reset Focus">⌂</button>' +
        '<button class="focus-icon-btn" onclick="treeZoomReset()" title="Recenter View" aria-label="Recenter View">⊕</button>';
    zc.appendChild(toolbar);

    const inner = document.createElement('div');
    inner.id = 'tree-inner';
    inner.style.transformOrigin = '0 0';

    const tree = document.createElement('div');
    tree.className = 'focus-tree';

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('tree-lines');
    tree.appendChild(svg);

    model.rows = optimizeRowOrder(model);

    const nodeEls = new Map();
    model.rows.forEach(row => {
        row.nodes.forEach(node => {
            const el = createPlatformEl(node);
            el.style.position = 'absolute';
            el.style.left = '0px';
            el.style.top = '0px';
            el.style.visibility = 'hidden';
            tree.appendChild(el);
            nodeEls.set(node.id, el);
        });
    });

    inner.appendChild(tree);
    c.appendChild(inner);

    const metrics = new Map();
    model.rows.forEach(row => {
        row.nodes.forEach(node => {
            const el = nodeEls.get(node.id);
            metrics.set(node.id, {
                width: el.offsetWidth || (node.type === 'root' ? 360 : 280),
                height: el.offsetHeight || estimatePlatformHeight(node),
                anchorOffset: (el.offsetWidth || (node.type === 'root' ? 360 : 280)) / 2,
            });
        });
    });

    const rowY = new Map();
    let cursorY = topPad;
    model.rows.forEach(row => {
        const maxHeight = Math.max(...row.nodes.map(node => metrics.get(node.id)?.height || 0), 0);
        rowY.set(row.rowIndex, cursorY);
        cursorY += maxHeight + rowGap;
    });

    const placed = computeNodePlacements(model.rows, metrics, rowY, sidePad, unitGap);
    const focusBox = placed.get(model.focusKey);
    if (focusBox) {
        const minX = Math.min(...[...placed.values()].map(box => box.x));
        const maxX = Math.max(...[...placed.values()].map(box => box.x + box.width));
        const focusCenter = focusBox.x + focusBox.width / 2;
        const desiredHalf = Math.max(focusCenter - minX, maxX - focusCenter) + sidePad;
        const shift = desiredHalf - focusCenter;
        [...placed.entries()].forEach(([nodeId, box]) => {
            placed.set(nodeId, { ...box, x: box.x + shift });
        });
    }

    const allBoxes = [...placed.values()];
    const treeWidth = Math.max(...allBoxes.map(box => box.x + box.width), 0) + sidePad;
    const treeHeight = Math.max(...allBoxes.map(box => box.y + box.height), 0) + bottomPad;
    tree.style.width = treeWidth + 'px';
    tree.style.height = treeHeight + 'px';

    model.rows.forEach(row => {
        row.nodes.forEach(node => {
            const el = nodeEls.get(node.id);
            const box = placed.get(node.id);
            if (!el || !box) return;
            el.style.left = box.x + 'px';
            el.style.top = box.y + 'px';
            el.style.width = box.width + 'px';
            el.style.minHeight = box.height + 'px';
            el.style.visibility = 'visible';
        });
    });

    svg.setAttribute('viewBox', '0 0 ' + treeWidth + ' ' + treeHeight);
    svg.setAttribute('width', treeWidth);
    svg.setAttribute('height', treeHeight);
    drawFocusedConnectors(svg, placed, model.edges);

    initZoomPan(c, inner);
}

function drawFamilyConnectors(treeEl, layout, placed, personLocalAnchors) {
    const svg = treeEl.querySelector('.tree-lines');
    if (!svg) return;

    const ns = 'http://www.w3.org/2000/svg';
    svg.innerHTML = '';

    const width = Math.ceil(treeEl.offsetWidth || treeEl.scrollWidth || 0);
    const height = Math.ceil(treeEl.offsetHeight || treeEl.scrollHeight || 0);
    svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
    svg.setAttribute('width', width);
    svg.setAttribute('height', height);

    function anchorFor(personId) {
        const unitId = layout.personToUnitId.get(personId);
        const box = placed.get(unitId);
        const local = personLocalAnchors.get(personId);
        if (!box || !local) return null;
        return {
            x: box.x + local.x,
            top: box.y + local.top,
            bottom: box.y + local.bottom,
        };
    }

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

    function addOrthogonalPath(points) {
        const cleaned = points.filter((point, index) => {
            if (!point) return false;
            if (!index) return true;
            const prev = points[index - 1];
            return !prev || prev.x !== point.x || prev.y !== point.y;
        });
        if (cleaned.length < 2) return;
        const path = document.createElementNS(ns, 'path');
        const d = cleaned.map((point, index) => (index ? 'L' : 'M') + point.x + ' ' + point.y).join(' ');
        path.setAttribute('d', d);
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', 'var(--line-color)');
        path.setAttribute('stroke-width', '3');
        path.setAttribute('stroke-linecap', 'round');
        path.setAttribute('stroke-linejoin', 'round');
        svg.appendChild(path);
    }

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    const familiesByRow = new Map();
    layout.families.forEach(family => {
        const junctionBox = placed.get(family.nodeId);
        if (!junctionBox) return;
        if (!familiesByRow.has(family.rowIndex)) familiesByRow.set(family.rowIndex, []);
        familiesByRow.get(family.rowIndex).push({
            family,
            junctionCenterX: junctionBox.x + junctionBox.width / 2,
        });
    });

    const familyLaneIndex = new Map();
    const familyLaneCount = new Map();
    [...familiesByRow.entries()].forEach(([rowIndex, items]) => {
        items.sort((a, b) => a.junctionCenterX - b.junctionCenterX);
        items.forEach((item, index) => familyLaneIndex.set(item.family.id, index));
        familyLaneCount.set(rowIndex, items.length);
    });

    layout.families.forEach(family => {
        const parents = family.parentIds.map(anchorFor).filter(Boolean).sort((a, b) => a.x - b.x);
        const junctionBox = placed.get(family.nodeId);
        if (!parents.length || !junctionBox) return;

        const childEntries = family.childIds.map(personId => {
            const anchor = anchorFor(personId);
            const unitId = layout.personToUnitId.get(personId);
            const unit = layout.unitMap.get(unitId);
            return anchor ? {
                personId,
                unitId,
                anchor,
                isBridge: (unit?.parentNodeIds?.length || 0) > 1,
            } : null;
        }).filter(Boolean).sort((a, b) => a.anchor.x - b.anchor.x);
        if (!childEntries.length) return;

        const junctionX = junctionBox.x + junctionBox.width / 2;
        const junctionY = junctionBox.y + junctionBox.height / 2;
        const parentBottom = Math.max(...parents.map(parent => parent.bottom));
        const childTop = Math.min(...childEntries.map(entry => entry.anchor.top));
        if (childTop <= junctionY) return;

        const laneIndex = familyLaneIndex.get(family.id) || 0;
        const laneCount = familyLaneCount.get(family.rowIndex) || 1;
        const parentAvailable = Math.max(24, junctionY - parentBottom - 10);
        const childAvailable = Math.max(30, childTop - junctionY - 10);
        const parentLaneStep = laneCount > 1 ? Math.max(18, Math.min(34, Math.floor(parentAvailable / (laneCount + 1)))) : 0;
        const childLaneStep = laneCount > 1 ? Math.max(22, Math.min(38, Math.floor(childAvailable / (laneCount + 1)))) : 0;
        const parentMergeY = clamp(
            junctionY - (laneCount > 1 ? parentLaneStep * (laneIndex + 1) : Math.min(26, parentAvailable)),
            parentBottom + 10,
            junctionY - 8
        );
        const childBusY = clamp(
            junctionY + (laneCount > 1 ? childLaneStep * (laneIndex + 1) : Math.min(34, Math.round(childAvailable * 0.65))),
            junctionY + 10,
            childTop - 10
        );

        const parentLeft = Math.min(...parents.map(parent => parent.x));
        const parentRight = Math.max(...parents.map(parent => parent.x));
        const parentBusX = parents.length > 1 ? Math.max(parentLeft, Math.min(parentRight, junctionX)) : parents[0].x;
        const regularChildren = childEntries.filter(entry => !entry.isBridge);
        const bridgeChildren = childEntries.filter(entry => entry.isBridge);
        const childLeft = regularChildren.length ? Math.min(...regularChildren.map(entry => entry.anchor.x)) : null;
        const childRight = regularChildren.length ? Math.max(...regularChildren.map(entry => entry.anchor.x)) : null;

        parents.forEach(parent => addOrthogonalPath([
            { x: parent.x, y: parent.bottom },
            { x: parent.x, y: parentMergeY },
        ]));
        if (parents.length > 1) addOrthogonalPath([
            { x: parentLeft, y: parentMergeY },
            { x: parentRight, y: parentMergeY },
        ]);
        addOrthogonalPath([
            { x: parentBusX, y: parentMergeY },
            { x: parentBusX, y: junctionY },
            { x: junctionX, y: junctionY },
            { x: junctionX, y: childBusY },
        ]);

        if (regularChildren.length > 1 && childLeft != null && childRight != null) addOrthogonalPath([
            { x: childLeft, y: childBusY },
            { x: childRight, y: childBusY },
        ]);

        regularChildren.forEach(entry => {
            const child = entry.anchor;
            const startX = regularChildren.length > 1 ? child.x : junctionX;
            const startY = regularChildren.length > 1 ? childBusY : junctionY;
            addOrthogonalPath([
                { x: startX, y: startY },
                { x: child.x, y: startY },
                { x: child.x, y: child.top },
            ]);
        });

        bridgeChildren.forEach((entry, index) => {
            const child = entry.anchor;
            const bridgeLaneY = clamp(
                junctionY + 14 + index * 16,
                junctionY + 10,
                child.top - 10
            );
            addOrthogonalPath([
                { x: junctionX, y: junctionY },
                { x: junctionX, y: bridgeLaneY },
                { x: child.x, y: bridgeLaneY },
                { x: child.x, y: child.top },
            ]);
        });
    });
}

// =============================================
// TREE DOM BUILDERS
// =============================================
function nodeEl(m) {
    const n = document.createElement('div');
    n.className = 'person-node' + (m.dod ? ' deceased' : '');
    n.dataset.personId = m.id;
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
let zoomState = { scale: 0.92, panX: 0, panY: 0, dragging: false, startX: 0, startY: 0 };
function initZoomPan(container, inner) {
    function applyTransform() {
        inner.style.transform = 'translate(' + zoomState.panX + 'px,' + zoomState.panY + 'px) scale(' + zoomState.scale + ')';
    }
    applyTransform();
    container.onwheel = function(e) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -0.08 : 0.08;
        zoomState.scale = Math.min(2, Math.max(0.2, zoomState.scale + delta));
        applyTransform();
    };
    container.onmousedown = function(e) {
        if (e.target.closest('.person-node') || e.target.closest('.zoom-controls')) return;
        zoomState.dragging = true;
        zoomState.startX = e.clientX - zoomState.panX;
        zoomState.startY = e.clientY - zoomState.panY;
        container.style.cursor = 'grabbing';
    };
    window.onmousemove = function(e) {
        if (!zoomState.dragging) return;
        zoomState.panX = e.clientX - zoomState.startX;
        zoomState.panY = e.clientY - zoomState.startY;
        applyTransform();
    };
    window.onmouseup = function() {
        zoomState.dragging = false;
        container.style.cursor = 'grab';
    };
    let lastTouchDist = 0;
    container.ontouchstart = function(e) {
        if (e.touches.length === 2) {
            lastTouchDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        } else if (e.touches.length === 1 && !e.target.closest('.person-node')) {
            zoomState.dragging = true;
            zoomState.startX = e.touches[0].clientX - zoomState.panX;
            zoomState.startY = e.touches[0].clientY - zoomState.panY;
        }
    };
    container.ontouchmove = function(e) {
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
    };
    container.ontouchend = function() { zoomState.dragging = false; };
}
function treeZoom(delta) {
    zoomState.scale = Math.min(2, Math.max(0.2, zoomState.scale + delta));
    const inner = document.getElementById('tree-inner');
    if (inner) inner.style.transform = 'translate(' + zoomState.panX + 'px,' + zoomState.panY + 'px) scale(' + zoomState.scale + ')';
}
function treeZoomReset() {
    resetTreeCamera();
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
        '<div class="detail-dates">' + dateStr + '</div>' +
        '<div style="margin-top:12px"><button class="btn btn-sm btn-outline" onclick="focusAndShow(\'' + id + '\')">🎯 Focus In Tree</button></div></div>' +
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
            '<div class="relation-chip" onclick="focusAndShow(\'' + spouse.id + '\')">💛 ' + esc(spouse.name) + '</div></div></div>';
    }
    if (parents.length) {
        html += '<div class="detail-section"><span class="detail-section-title">👤 Parents</span><div class="relation-chips" style="margin-top:8px">';
        parents.forEach(p => { html += '<div class="relation-chip" onclick="focusAndShow(\'' + p.id + '\')">👤 ' + esc(p.name) + '</div>'; });
        html += '</div></div>';
    }
    if (children.length) {
        html += '<div class="detail-section"><span class="detail-section-title">👶 Children</span><div class="relation-chips" style="margin-top:8px">';
        children.forEach(c => { html += '<div class="relation-chip" onclick="focusAndShow(\'' + c.id + '\')">👶 ' + esc(c.name) + '</div>'; });
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
    } else html += '<p style="color:var(--text-light);font-size:0.88rem">No events yet</p>';
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
                const txt = d.results.filter(b => b.type === 'paragraph').map(b => b.paragraph.rich_text.map(t => t.plain_text).join('')).join('\n');
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
    } catch (e) { console.error(e); toast('❌ Failed — check console'); }
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
    } catch (e) { console.error(e); toast('❌ Failed — check console'); }
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
