/* ============================================
   My House PWA - Core Application Logic
   v2: API Integration (실거래가 + 법정동코드 + 청약정보)
   ============================================ */

// ========== Constants ==========
const STORAGE_KEYS = {
    spots: 'myhouse_spots',
    checklist: 'myhouse_checklist',
    cards: 'myhouse_cards',
    fogVisited: 'myhouse_fog_visited',
};

const TYPE_ICONS = {
    apartment: '🏢', villa: '🏘️', officetel: '🏬',
    house: '🏡', development: '🚧', other: '📍',
};

const TYPE_LABELS = {
    apartment: '아파트', villa: '빌라/연립', officetel: '오피스텔',
    house: '단독주택', development: '개발예정지', other: '기타',
};

const CHECKIN_RADIUS = 100;
const DEFAULT_CENTER = [37.5665, 126.9780];
const DEFAULT_ZOOM = 13;

const CHECKLIST_TEMPLATE = [
    {
        category: '🏗️ 건물 외부',
        items: ['외벽 균열/곰팡이 여부', '주차장 공간 및 상태', '쓰레기 처리 시설 위치',
                '엘리베이터 상태 (저층 제외)', 'CCTV 설치 여부', '관리사무소 유무'],
    },
    {
        category: '🏠 건물 내부',
        items: ['수압 체크 (싱크대/화장실)', '곰팡이/결로 여부 (벽, 천장)', '방향 확인 (남향 여부)',
                '소음 확인 (도로/층간)', '환기 상태 (창문 열림 여부)', '콘센트 위치 및 개수',
                '보일러 상태 (연식 확인)', '배수 상태 (화장실/베란다)'],
    },
    {
        category: '📍 주변 환경',
        items: ['지하철/버스까지 도보 시간', '경사도 (언덕 여부)', '편의점/마트 접근성',
                '병원/약국 접근성', '공원/산책로 유무', '야간 가로등/안전성', '학교/학원가 (해당 시)'],
    },
    {
        category: '📄 계약 관련',
        items: ['등기부등본 확인', '전입세대 열람내역 확인', '관리비 확인 (여름/겨울)',
                '특약 사항 확인', '중개수수료 확인', '이사 가능 날짜 확인'],
    },
];

// ========== State ==========
let map = null, userMarker = null, userLatLng = null;
let spotMarkers = {}, spots = [], cards = [], checklistState = {};
let fogEnabled = false, addingSpotMode = false;
let tempMarker = null, tempLatLng = null;
let currentDetailSpotId = null, watchId = null, nearbySpotId = null;

// API state
let currentTrades = [];
let selectedRegionCode = null;
let selectedRegionName = '';

// ========== Initialization ==========
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => { document.getElementById('app').classList.remove('hidden'); }, 2200);
    initMap();
    loadData();
    renderSpotsList();
    renderChecklist();
    renderCards();
    updateBadges();
    bindEvents();
    bindAPIEvents();
    bindMapSearchEvents();
    startLocationWatch();
    registerSW();
    initAPIState();
});

// ========== Map ==========
function initMap() {
    map = L.map('map', { center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM, zoomControl: false });
    L.control.zoom({ position: 'bottomleft' }).addTo(map);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '© OpenStreetMap · © CARTO',
        subdomains: 'abcd',
        maxZoom: 20,
    }).addTo(map);
    map.on('click', (e) => { if (addingSpotMode) setTempMarker(e.latlng); });
}

function createMarkerIcon(type, visited) {
    const mc = `marker-${type}${visited ? ' marker-visited' : ''}`;
    return L.divIcon({
        className: '', iconSize: [36, 36], iconAnchor: [18, 36], popupAnchor: [0, -36],
        html: `<div class="custom-marker ${mc}"><span>${TYPE_ICONS[type] || '📍'}</span></div>`,
    });
}

function addSpotMarker(spot) {
    const m = L.marker([spot.lat, spot.lng], { icon: createMarkerIcon(spot.type, spot.visited) })
        .addTo(map).bindPopup(`<b>${spot.name}</b><br>${TYPE_LABELS[spot.type] || ''}`);
    m.on('click', () => showSpotDetail(spot.id));
    spotMarkers[spot.id] = m;
}

function removeSpotMarker(id) { if (spotMarkers[id]) { map.removeLayer(spotMarkers[id]); delete spotMarkers[id]; } }

function refreshAllMarkers() {
    Object.keys(spotMarkers).forEach(id => removeSpotMarker(id));
    spots.forEach(s => addSpotMarker(s));
}

function setTempMarker(latlng) {
    tempLatLng = latlng;
    if (tempMarker) map.removeLayer(tempMarker);
    tempMarker = L.marker(latlng, {
        icon: L.divIcon({ className: '', iconSize: [36, 36], iconAnchor: [18, 36],
            html: '<div class="custom-marker marker-other" style="opacity:0.7"><span>📌</span></div>' }),
    }).addTo(map);
    document.getElementById('spot-coords').textContent = `${latlng.lat.toFixed(6)}, ${latlng.lng.toFixed(6)}`;
    openModal('modal-add-spot');
}

// ========== Location Tracking ==========
function startLocationWatch() {
    if (!navigator.geolocation) { showToast('⚠️ 위치 서비스를 사용할 수 없습니다'); return; }
    watchId = navigator.geolocation.watchPosition(
        pos => { userLatLng = { lat: pos.coords.latitude, lng: pos.coords.longitude }; updateUserMarker(userLatLng.lat, userLatLng.lng); checkProximity(); },
        err => console.warn('Geo err:', err),
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
    );
}

function updateUserMarker(lat, lng) {
    if (!userMarker) {
        userMarker = L.marker([lat, lng], {
            icon: L.divIcon({ className: '', html: '<div class="user-location-marker"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }),
            zIndexOffset: 1000,
        }).addTo(map);
    } else { userMarker.setLatLng([lat, lng]); }
}

function locateUser() {
    if (userLatLng) { map.flyTo([userLatLng.lat, userLatLng.lng], 16, { duration: 0.8 }); }
    else {
        navigator.geolocation.getCurrentPosition(
            pos => { userLatLng = { lat: pos.coords.latitude, lng: pos.coords.longitude }; updateUserMarker(userLatLng.lat, userLatLng.lng); map.flyTo([userLatLng.lat, userLatLng.lng], 16, { duration: 0.8 }); },
            () => showToast('⚠️ 위치를 가져올 수 없습니다'), { enableHighAccuracy: true }
        );
    }
}

// ========== Proximity / Check-in ==========
function checkProximity() {
    if (!userLatLng || spots.length === 0) return;
    let closestSpot = null, closestDist = Infinity;
    spots.forEach(s => {
        if (s.visited) return;
        const d = getDistance(userLatLng.lat, userLatLng.lng, s.lat, s.lng);
        if (d < CHECKIN_RADIUS && d < closestDist) { closestDist = d; closestSpot = s; }
    });
    const alertEl = document.getElementById('proximity-alert');
    if (closestSpot) {
        nearbySpotId = closestSpot.id;
        document.querySelector('.proximity-text').textContent = `📍 "${closestSpot.name}" 근처입니다! (${Math.round(closestDist)}m)`;
        alertEl.classList.remove('hidden');
    } else { nearbySpotId = null; alertEl.classList.add('hidden'); }
}

function performCheckin() {
    if (!nearbySpotId) return;
    const spot = spots.find(s => s.id === nearbySpotId);
    if (!spot) return;
    spot.visited = true; spot.visitedAt = new Date().toISOString();
    saveData();
    const card = createCard(spot); cards.push(card); saveCards();
    refreshAllMarkers(); renderSpotsList(); renderCards(); updateBadges();
    document.getElementById('proximity-alert').classList.add('hidden');
    nearbySpotId = null;
    showCardAcquired(card); showToast(`🎉 "${spot.name}" 방문 완료! 카드 획득!`);
}

function createCard(spot) {
    const r = Math.random();
    let rarity, rarityLabel;
    if (r > 0.95) { rarity = 'legendary'; rarityLabel = '⭐ LEGENDARY'; }
    else if (r > 0.8) { rarity = 'epic'; rarityLabel = '💎 EPIC'; }
    else if (r > 0.5) { rarity = 'rare'; rarityLabel = '🔮 RARE'; }
    else { rarity = 'common'; rarityLabel = 'COMMON'; }
    return {
        id: generateId(), spotId: spot.id, spotName: spot.name, spotType: spot.type,
        rarity, rarityLabel, acquiredAt: new Date().toISOString(),
        stats: { distance: spot.price ? `${(parseInt(spot.price) / 10000).toFixed(1)}억` : '-', visits: 1 },
    };
}

function showCardAcquired(card) {
    document.getElementById('acquired-card').innerHTML = `
        <div class="card-type-icon">${TYPE_ICONS[card.spotType] || '📍'}</div>
        <div class="card-name">${card.spotName}</div><div class="card-date">${formatDate(card.acquiredAt)}</div>
        <div class="card-rarity rarity-${card.rarity}">${card.rarityLabel}</div>`;
    openModal('modal-card');
}

// ========== Spots CRUD ==========
function addSpot(data) {
    const spot = {
        id: generateId(), name: data.name, type: data.type, price: data.price, note: data.note,
        lat: data.lat, lng: data.lng, visited: false, visitedAt: null, createdAt: new Date().toISOString(),
    };
    spots.push(spot); saveData(); addSpotMarker(spot); renderSpotsList(); updateBadges();
    showToast(`✅ "${spot.name}" 추가 완료!`);
}

function deleteSpot(id) {
    spots = spots.filter(s => s.id !== id); removeSpotMarker(id);
    saveData(); renderSpotsList(); updateBadges(); closeModal('modal-spot-detail');
    showToast('🗑️ 삭제되었습니다');
}

// ========== Rendering ==========
function renderSpotsList() {
    const container = document.getElementById('spots-list');
    document.getElementById('spot-total').textContent = `${spots.length}건`;
    if (spots.length === 0) {
        container.innerHTML = '<div class="empty-state"><span class="empty-icon">🏘️</span><p>지도에서 ➕ 버튼으로<br>관심 장소를 추가해 보세요!</p></div>';
        return;
    }
    const sorted = [...spots].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    container.innerHTML = sorted.map(s => `
        <div class="spot-item ${s.visited ? 'visited' : ''}" data-id="${s.id}">
            <div class="spot-icon-wrapper">${TYPE_ICONS[s.type] || '📍'}</div>
            <div class="spot-info">
                <div class="spot-name">${s.name}</div>
                <div class="spot-meta">${TYPE_LABELS[s.type] || '기타'}${s.price ? ` · ${formatPrice(s.price)}` : ''}</div>
            </div>
            ${s.visited ? '<span class="spot-visited-badge">✅ 방문완료</span>' : ''}
        </div>`).join('');
    container.querySelectorAll('.spot-item').forEach(el => el.addEventListener('click', () => showSpotDetail(el.dataset.id)));
}

function renderChecklist() {
    const container = document.getElementById('checklist-container');
    container.innerHTML = CHECKLIST_TEMPLATE.map((cat, ci) => `
        <div class="checklist-category">
            <div class="checklist-category-title">${cat.category}</div>
            ${cat.items.map((item, ii) => `
                <div class="check-item ${checklistState[`${ci}-${ii}`] ? 'checked' : ''}" data-key="${ci}-${ii}">
                    <div class="check-box">${checklistState[`${ci}-${ii}`] ? '✓' : ''}</div>
                    <span class="check-label">${item}</span>
                </div>`).join('')}
        </div>`).join('');
    container.querySelectorAll('.check-item').forEach(el => {
        el.addEventListener('click', () => { checklistState[el.dataset.key] = !checklistState[el.dataset.key]; saveChecklist(); renderChecklist(); });
    });
}

function renderCards() {
    const container = document.getElementById('cards-grid');
    document.getElementById('card-total').textContent = `${cards.length}장`;
    document.querySelector('#badge-count .badge-num').textContent = cards.length;
    if (cards.length === 0) {
        container.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><span class="empty-icon">🃏</span><p>매물 근처에서 체크인하면<br>카드를 획득할 수 있어요!</p></div>';
        return;
    }
    container.innerHTML = cards.map(c => `
        <div class="game-card"><div class="card-type-icon">${TYPE_ICONS[c.spotType] || '📍'}</div>
        <div class="card-name">${c.spotName}</div><div class="card-date">${formatDate(c.acquiredAt)}</div>
        <div class="card-stats"><div class="card-stat"><span class="card-stat-label">가격</span><span class="card-stat-value">${c.stats.distance}</span></div></div>
        <span class="card-rarity rarity-${c.rarity}">${c.rarityLabel}</span></div>`).join('');
}

function updateBadges() {
    document.querySelector('#visit-count .badge-num').textContent = spots.filter(s => s.visited).length;
    document.querySelector('#badge-count .badge-num').textContent = cards.length;
}

// ========== Spot Detail ==========
function showSpotDetail(id) {
    const spot = spots.find(s => s.id === id); if (!spot) return;
    currentDetailSpotId = id;
    document.getElementById('detail-title').textContent = `${TYPE_ICONS[spot.type]} ${spot.name}`;
    document.getElementById('detail-body').innerHTML = `
        <div class="detail-section">
            <div class="detail-row"><span class="detail-label">유형</span><span class="detail-value">${TYPE_LABELS[spot.type] || '기타'}</span></div>
            ${spot.price ? `<div class="detail-row"><span class="detail-label">가격</span><span class="detail-value">${formatPrice(spot.price)}</span></div>` : ''}
            <div class="detail-row"><span class="detail-label">좌표</span><span class="detail-value" style="font-size:12px;font-family:monospace">${spot.lat.toFixed(6)}, ${spot.lng.toFixed(6)}</span></div>
            <div class="detail-row"><span class="detail-label">등록일</span><span class="detail-value">${formatDate(spot.createdAt)}</span></div>
            <div class="detail-row"><span class="detail-label">방문</span><span class="detail-value">${spot.visited ? `✅ ${formatDate(spot.visitedAt)}` : '❌ 미방문'}</span></div>
        </div>
        ${spot.note ? `<div class="detail-note">📝 ${spot.note}</div>` : ''}`;
    openModal('modal-spot-detail');
    map.flyTo([spot.lat, spot.lng], 16, { duration: 0.5 });
}

// ========== Core Events ==========
function bindEvents() {
    // Tabs
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
            // Auto-expand bottom sheet when switching tabs
            const sheet = document.getElementById('bottom-sheet');
            if (sheet.classList.contains('collapsed')) { sheet.classList.remove('collapsed'); sheet.classList.add('expanded'); }
        });
    });

    // Bottom sheet handle
    document.getElementById('sheet-handle').addEventListener('click', () => {
        const s = document.getElementById('bottom-sheet'); s.classList.toggle('collapsed'); s.classList.toggle('expanded');
    });

    // Map buttons
    document.getElementById('btn-locate').addEventListener('click', locateUser);
    document.getElementById('btn-add-spot').addEventListener('click', () => {
        if (addingSpotMode) { cancelAddMode(); } else {
            addingSpotMode = true; document.getElementById('btn-add-spot').classList.add('active');
            showToast('📌 지도를 탭하여 위치를 선택하세요');
            if (userLatLng) { tempLatLng = { lat: userLatLng.lat, lng: userLatLng.lng }; document.getElementById('spot-coords').textContent = `${userLatLng.lat.toFixed(6)}, ${userLatLng.lng.toFixed(6)}`; }
        }
    });
    document.getElementById('btn-fog-toggle').addEventListener('click', () => {
        fogEnabled = !fogEnabled; document.getElementById('btn-fog-toggle').classList.toggle('active', fogEnabled); toggleFog(fogEnabled);
    });
    document.getElementById('btn-checkin').addEventListener('click', performCheckin);

    // Add Spot Form
    document.getElementById('form-add-spot').addEventListener('submit', e => {
        e.preventDefault();
        const name = document.getElementById('spot-name').value.trim();
        if (!name) return;
        if (!tempLatLng) { showToast('⚠️ 지도에서 위치를 클릭해 주세요'); return; }
        addSpot({ name, type: document.getElementById('spot-type').value, price: document.getElementById('spot-price').value.trim(), note: document.getElementById('spot-note').value.trim(), lat: tempLatLng.lat, lng: tempLatLng.lng });
        closeModal('modal-add-spot'); cancelAddMode(); document.getElementById('form-add-spot').reset();
    });

    // Cancel / Close buttons
    document.getElementById('btn-cancel-spot').addEventListener('click', () => { closeModal('modal-add-spot'); cancelAddMode(); });
    document.getElementById('modal-close-spot').addEventListener('click', () => { closeModal('modal-add-spot'); cancelAddMode(); });
    document.getElementById('modal-close-detail').addEventListener('click', () => closeModal('modal-spot-detail'));
    document.getElementById('btn-close-card').addEventListener('click', () => closeModal('modal-card'));

    // Backdrops
    document.querySelectorAll('.modal-backdrop').forEach(bd => { bd.addEventListener('click', () => { bd.closest('.modal').classList.add('hidden'); cancelAddMode(); }); });

    // Spot actions
    document.getElementById('btn-delete-spot').addEventListener('click', () => { if (currentDetailSpotId && confirm('정말 삭제하시겠습니까?')) deleteSpot(currentDetailSpotId); });
    document.getElementById('btn-navigate-spot').addEventListener('click', () => {
        const s = spots.find(s => s.id === currentDetailSpotId);
        if (s) window.open(`https://map.kakao.com/link/to/${encodeURIComponent(s.name)},${s.lat},${s.lng}`, '_blank');
    });

    // Checklist reset
    document.getElementById('btn-reset-checklist').addEventListener('click', () => {
        if (confirm('체크리스트를 초기화하시겠습니까?')) { checklistState = {}; saveChecklist(); renderChecklist(); showToast('🔄 초기화 완료'); }
    });

    // Settings
    document.getElementById('btn-settings').addEventListener('click', () => openSettingsModal());
    document.getElementById('modal-close-settings').addEventListener('click', () => closeModal('modal-settings'));
    document.getElementById('btn-cancel-settings').addEventListener('click', () => closeModal('modal-settings'));
    document.getElementById('form-settings').addEventListener('submit', e => { e.preventDefault(); saveAPIKeys(); });
}

function cancelAddMode() {
    addingSpotMode = false; document.getElementById('btn-add-spot').classList.remove('active');
    if (tempMarker) { map.removeLayer(tempMarker); tempMarker = null; } tempLatLng = null;
}

// ========== Map Location Search (Nominatim - 무료, 키 불필요) ==========
let searchTimeout = null;

function bindMapSearchEvents() {
    const input = document.getElementById('map-search-input');
    const clearBtn = document.getElementById('btn-map-search-clear');
    const resultsDiv = document.getElementById('map-search-results');

    // Debounced input
    input.addEventListener('input', () => {
        const q = input.value.trim();
        clearBtn.classList.toggle('hidden', q.length === 0);
        
        clearTimeout(searchTimeout);
        if (q.length < 2) { resultsDiv.classList.add('hidden'); return; }
        
        searchTimeout = setTimeout(() => performMapSearch(q), 400);
    });

    // Enter key
    input.addEventListener('keypress', e => {
        if (e.key === 'Enter') {
            e.preventDefault();
            clearTimeout(searchTimeout);
            const q = input.value.trim();
            if (q.length >= 2) performMapSearch(q);
        }
    });

    // Clear
    clearBtn.addEventListener('click', () => {
        input.value = '';
        clearBtn.classList.add('hidden');
        resultsDiv.classList.add('hidden');
        input.focus();
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', e => {
        if (!e.target.closest('#map-search-bar')) resultsDiv.classList.add('hidden');
    });
}

async function performMapSearch(query) {
    const resultsDiv = document.getElementById('map-search-results');
    resultsDiv.classList.remove('hidden');
    resultsDiv.innerHTML = '<div class="map-search-loading">🔍 검색 중...</div>';

    try {
        const results = await API.searchLocation(query);
        if (results.length === 0) {
            resultsDiv.innerHTML = '<div class="map-search-loading">검색 결과가 없습니다</div>';
            return;
        }

        resultsDiv.innerHTML = results.map((r, i) => `
            <div class="map-search-item" data-idx="${i}" data-lat="${r.lat}" data-lng="${r.lng}">
                <span class="map-search-item-icon">📍</span>
                <div class="map-search-item-text">
                    ${r.shortName}
                    <div class="map-search-item-sub">${r.name}</div>
                </div>
            </div>`).join('');

        resultsDiv.querySelectorAll('.map-search-item').forEach(el => {
            el.addEventListener('click', () => {
                const lat = parseFloat(el.dataset.lat);
                const lng = parseFloat(el.dataset.lng);
                const name = el.querySelector('.map-search-item-text').textContent.trim().split('\n')[0];
                
                map.flyTo([lat, lng], 16, { duration: 1 });
                resultsDiv.classList.add('hidden');
                document.getElementById('map-search-input').value = name;
                
                showToast(`📍 ${name} 으로 이동`);
            });
        });
    } catch (err) {
        resultsDiv.innerHTML = `<div class="map-search-loading">❌ 검색 오류: ${err.message}</div>`;
    }
}

// ========== Fog of War ==========
function toggleFog(enabled) {
    let fogEl = document.querySelector('.fog-overlay');
    if (enabled) {
        if (!fogEl) { fogEl = document.createElement('div'); fogEl.className = 'fog-overlay'; document.getElementById('map-container').appendChild(fogEl); }
        fogEl.style.opacity = '1'; showToast('🌫️ 안개 모드 ON');
    } else { if (fogEl) { fogEl.style.opacity = '0'; setTimeout(() => fogEl.remove(), 500); } showToast('🌫️ 안개 모드 OFF'); }
}

// ===================================================================
// API INTEGRATION - 실거래가, 법정동코드, 청약정보
// ===================================================================

function initAPIState() {
    const keys = API.getKeys();
    // Check if keys exist, show/hide accordingly
    checkAPIKeyState();
    // Populate region dropdown
    populateRegionDropdown();
}

function checkAPIKeyState() {
    const hasKey = API.hasKeys();

    // Trade tab
    document.getElementById('trade-no-key').classList.toggle('hidden', hasKey);
    document.querySelector('.api-search-box')?.classList.toggle('hidden', !hasKey);

    // Subscription tab
    document.getElementById('sub-no-key').classList.toggle('hidden', hasKey);
}

function populateRegionDropdown() {
    const sel = document.getElementById('trade-region-select');
    sel.innerHTML = '<option value="">지역 선택 (빠른선택)</option>';
    API.POPULAR_REGIONS.forEach(r => {
        const opt = document.createElement('option');
        opt.value = r.code; opt.textContent = r.name;
        sel.appendChild(opt);
    });
}

// ========== API Events ==========
function bindAPIEvents() {
    // Trade: Quick region select → search
    document.getElementById('btn-trade-search').addEventListener('click', () => {
        const code = document.getElementById('trade-region-select').value;
        if (!code) { showToast('⚠️ 지역을 선택해 주세요'); return; }
        const region = API.POPULAR_REGIONS.find(r => r.code === code);
        selectedRegionCode = code;
        selectedRegionName = region ? region.name : code;
        fetchTrades();
    });

    // Trade: Custom region search (법정동코드 API)
    document.getElementById('btn-region-search').addEventListener('click', searchRegion);
    document.getElementById('trade-region-input').addEventListener('keypress', e => { if (e.key === 'Enter') { e.preventDefault(); searchRegion(); } });

    // Chart: apartment filter
    document.getElementById('chart-apt-filter').addEventListener('change', e => {
        drawPriceChart(e.target.value || null);
    });

    // Subscription: load + refresh
    document.getElementById('btn-sub-refresh').addEventListener('click', fetchSubscriptionInfo);

    // Auto-load subscription when tab is clicked
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (btn.dataset.tab === 'subscription' && API.getKeys().subscriptionKey) {
                const list = document.getElementById('sub-list');
                if (!list.children.length || list.querySelector('.empty-state')) fetchSubscriptionInfo();
            }
        });
    });
}

// ========== 법정동코드 검색 ==========
async function searchRegion() {
    const keyword = document.getElementById('trade-region-input').value.trim();
    if (!keyword) { showToast('⚠️ 검색할 지역명을 입력하세요'); return; }

    const resultsDiv = document.getElementById('region-search-results');
    resultsDiv.classList.remove('hidden');
    resultsDiv.innerHTML = '<div class="api-loading"><div class="loading-spinner"></div><p>검색 중...</p></div>';

    try {
        const results = await API.searchRegion(keyword);
        if (results.length === 0) {
            resultsDiv.innerHTML = '<div style="padding:12px;text-align:center;color:var(--text-muted);font-size:13px">검색 결과가 없습니다</div>';
            return;
        }

        // Deduplicate by 5-digit code
        const unique = {};
        results.forEach(r => { if (!unique[r.code]) unique[r.code] = r; });
        const list = Object.values(unique);

        resultsDiv.innerHTML = list.map(r => `
            <div class="region-result-item" data-code="${r.code}" data-name="${r.fullName}">
                ${r.fullName} <span class="region-code">${r.code}</span>
            </div>`).join('');

        resultsDiv.querySelectorAll('.region-result-item').forEach(el => {
            el.addEventListener('click', () => {
                selectedRegionCode = el.dataset.code;
                selectedRegionName = el.dataset.name;
                document.getElementById('trade-region-input').value = selectedRegionName;
                resultsDiv.classList.add('hidden');
                fetchTrades();
            });
        });
    } catch (err) {
        resultsDiv.innerHTML = `<div style="padding:12px;color:var(--accent-danger);font-size:13px">❌ ${err.message}</div>`;
    }
}

// ========== 실거래가 조회 ==========
async function fetchTrades() {
    if (!selectedRegionCode) return;

    const months = parseInt(document.getElementById('trade-months').value) || 6;
    const loading = document.getElementById('trade-loading');
    const results = document.getElementById('trade-results');

    loading.classList.remove('hidden');
    results.classList.add('hidden');

    try {
        showToast(`💰 ${selectedRegionName} 실거래가 조회 중...`);
        currentTrades = await API.getRecentTrades(selectedRegionCode, months);

        if (currentTrades.length === 0) {
            loading.classList.add('hidden');
            showToast('📭 해당 기간에 거래 데이터가 없습니다');
            return;
        }

        // Populate apartment filter
        const aptFilter = document.getElementById('chart-apt-filter');
        const aptNames = API.getAptNames(currentTrades);
        aptFilter.innerHTML = '<option value="">전체 아파트</option>';
        aptNames.forEach(name => {
            const opt = document.createElement('option');
            opt.value = name; opt.textContent = name;
            aptFilter.appendChild(opt);
        });

        // Draw chart
        drawPriceChart(null);

        // Render stats
        renderTradeStats(currentTrades);

        // Render trade list
        renderTradeList(currentTrades);

        loading.classList.add('hidden');
        results.classList.remove('hidden');
        showToast(`✅ ${currentTrades.length}건의 거래 데이터 로드 완료`);

    } catch (err) {
        loading.classList.add('hidden');
        showToast(`❌ 오류: ${err.message}`);
        console.error(err);
    }
}

// ========== Price Chart (Canvas) ==========
function drawPriceChart(aptName) {
    const chartData = API.buildPriceChart(currentTrades, aptName);
    const canvas = document.getElementById('price-chart');
    const ctx = canvas.getContext('2d');

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.parentElement.clientWidth || 360;
    const h = 180;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    const { labels, avgPrices, maxPrices, minPrices } = chartData;
    if (labels.length === 0) {
        ctx.fillStyle = '#6c6c8a'; ctx.font = '13px Noto Sans KR'; ctx.textAlign = 'center';
        ctx.fillText('데이터 없음', w / 2, h / 2);
        return;
    }

    const padL = 55, padR = 15, padT = 15, padB = 30;
    const chartW = w - padL - padR;
    const chartH = h - padT - padB;

    const allPrices = [...maxPrices, ...minPrices];
    const priceMin = Math.min(...allPrices) * 0.95;
    const priceMax = Math.max(...allPrices) * 1.05;
    const priceRange = priceMax - priceMin || 1;

    const xStep = labels.length > 1 ? chartW / (labels.length - 1) : chartW / 2;
    const toX = i => padL + i * xStep;
    const toY = price => padT + chartH - ((price - priceMin) / priceRange) * chartH;

    // Grid lines
    ctx.strokeStyle = 'rgba(108,92,231,0.1)'; ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
        const y = padT + (chartH / 4) * i;
        ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
        const price = priceMax - (priceRange / 4) * i;
        ctx.fillStyle = '#6c6c8a'; ctx.font = '10px Noto Sans KR'; ctx.textAlign = 'right';
        ctx.fillText(formatPriceShort(price), padL - 6, y + 4);
    }

    // X labels
    ctx.fillStyle = '#6c6c8a'; ctx.font = '10px Noto Sans KR'; ctx.textAlign = 'center';
    labels.forEach((label, i) => { if (i % Math.ceil(labels.length / 6) === 0 || i === labels.length - 1) ctx.fillText(label, toX(i), h - 8); });

    // Lines helper
    function drawLine(data, color, filled = false) {
        ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = 2;
        data.forEach((v, i) => { i === 0 ? ctx.moveTo(toX(i), toY(v)) : ctx.lineTo(toX(i), toY(v)); });
        ctx.stroke();
        if (filled) {
            ctx.lineTo(toX(data.length - 1), padT + chartH); ctx.lineTo(toX(0), padT + chartH); ctx.closePath();
            ctx.fillStyle = color.replace('1)', '0.08)'); ctx.fill();
        }
    }

    // Draw area + lines
    drawLine(avgPrices, 'rgba(108,92,231,1)', true);
    drawLine(maxPrices, 'rgba(253,121,168,0.6)');
    drawLine(minPrices, 'rgba(0,206,201,0.6)');

    // Dots for avg
    avgPrices.forEach((v, i) => {
        ctx.beginPath(); ctx.arc(toX(i), toY(v), 3, 0, Math.PI * 2);
        ctx.fillStyle = '#6c5ce7'; ctx.fill();
    });
}

function renderTradeStats(trades) {
    const prices = trades.map(t => parseInt(t.dealAmount)).filter(p => !isNaN(p));
    if (prices.length === 0) return;
    const avg = Math.round(prices.reduce((s, v) => s + v, 0) / prices.length);
    const max = Math.max(...prices);
    const min = Math.min(...prices);

    document.getElementById('trade-stats').innerHTML = `
        <div class="stat-card"><div class="stat-value">${formatPriceShort(avg)}</div><div class="stat-label">평균 거래가</div></div>
        <div class="stat-card"><div class="stat-value">${formatPriceShort(max)}</div><div class="stat-label">최고가</div></div>
        <div class="stat-card"><div class="stat-value">${formatPriceShort(min)}</div><div class="stat-label">최저가</div></div>`;
}

function renderTradeList(trades) {
    document.getElementById('trade-count').textContent = `${trades.length}건`;
    const display = trades.slice(0, 50); // Show max 50
    document.getElementById('trade-list').innerHTML = display.map(t => `
        <div class="trade-item">
            <div class="trade-price">${formatPriceShort(parseInt(t.dealAmount))}</div>
            <div class="trade-info">
                <div class="trade-apt-name">${t.aptName}</div>
                <div class="trade-detail">${t.area}㎡ · ${t.floor}층 · ${t.buildYear}년식</div>
            </div>
            <div class="trade-date">${t.dealYear}.${String(t.dealMonth).padStart(2,'0')}.${String(t.dealDay).padStart(2,'0')}</div>
        </div>`).join('');
}

// ========== 청약 분양정보 ==========
async function fetchSubscriptionInfo() {
    const loading = document.getElementById('sub-loading');
    const list = document.getElementById('sub-list');

    loading.classList.remove('hidden');
    list.innerHTML = '';

    try {
        showToast('🏗️ 청약 정보를 불러오는 중...');
        const items = await API.getSubscriptionInfo(1);

        if (items.length === 0) {
            list.innerHTML = '<div class="empty-state"><span class="empty-icon">📭</span><p>현재 공개된 분양 정보가 없습니다</p></div>';
            loading.classList.add('hidden');
            return;
        }

        list.innerHTML = items.map(item => `
            <div class="sub-card">
                <div class="sub-card-header">
                    <div class="sub-house-name">${item.houseName}</div>
                    <span class="sub-badge">${item.houseDtlSecdNm || '분양'}</span>
                </div>
                <div class="sub-location">📍 ${item.supplyLocation || item.sido || '위치 미정'}</div>
                <div class="sub-dates">
                    <div class="sub-date-item">
                        <span class="sub-date-label">모집공고일</span>
                        <span class="sub-date-value">${formatApiDate(item.recruitDate)}</span>
                    </div>
                    <div class="sub-date-item">
                        <span class="sub-date-label">접수시작</span>
                        <span class="sub-date-value">${formatApiDate(item.applyStartDate)}</span>
                    </div>
                    <div class="sub-date-item">
                        <span class="sub-date-label">접수마감</span>
                        <span class="sub-date-value">${formatApiDate(item.applyEndDate)}</span>
                    </div>
                    <div class="sub-date-item">
                        <span class="sub-date-label">당첨발표</span>
                        <span class="sub-date-value">${formatApiDate(item.winnerDate)}</span>
                    </div>
                </div>
                ${item.totalSupply ? `<div class="sub-supply">🏠 총 공급: <strong>${Number(item.totalSupply).toLocaleString()}세대</strong></div>` : ''}
                ${item.constructor ? `<div class="sub-supply">🔨 시행사: ${item.constructor}</div>` : ''}
            </div>`).join('');

        loading.classList.add('hidden');
        showToast(`✅ ${items.length}건의 분양 정보 로드 완료`);

    } catch (err) {
        loading.classList.add('hidden');
        list.innerHTML = `<div class="empty-state"><span class="empty-icon">❌</span><p>데이터를 불러올 수 없습니다<br><small>${err.message}</small></p></div>`;
        showToast(`❌ 오류: ${err.message}`);
    }
}

// ========== Settings Modal ==========
function openSettingsModal() {
    const keys = API.getKeys();
    document.getElementById('key-service').value = keys.serviceKey || '';
    document.getElementById('key-proxy').value = keys.proxyUrl || '';

    // Update status badge
    updateKeyStatus('status-key', !!keys.serviceKey);

    openModal('modal-settings');
}

function updateKeyStatus(elId, registered) {
    const el = document.getElementById(elId);
    el.textContent = registered ? '✅ 등록됨' : '미등록';
    el.classList.toggle('registered', registered);
}

function saveAPIKeys() {
    const keys = {
        serviceKey: document.getElementById('key-service').value.trim(),
        proxyUrl: document.getElementById('key-proxy').value.trim() || undefined,
    };
    API.saveKeys(keys);
    checkAPIKeyState();
    closeModal('modal-settings');
    showToast('✅ API 키가 저장되었습니다!');
}

// ========== Modals / Toast ==========
function openModal(id) { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

function showToast(message) {
    const t = document.getElementById('toast');
    t.textContent = message; t.classList.remove('hidden');
    clearTimeout(t._timeout);
    t._timeout = setTimeout(() => t.classList.add('hidden'), 2500);
}

// ========== Data Persistence ==========
function loadData() {
    try {
        spots = JSON.parse(localStorage.getItem(STORAGE_KEYS.spots)) || [];
        checklistState = JSON.parse(localStorage.getItem(STORAGE_KEYS.checklist)) || {};
        cards = JSON.parse(localStorage.getItem(STORAGE_KEYS.cards)) || [];
        spots.forEach(s => addSpotMarker(s));
    } catch (e) { console.error('Load err:', e); }
}
function saveData() { localStorage.setItem(STORAGE_KEYS.spots, JSON.stringify(spots)); }
function saveChecklist() { localStorage.setItem(STORAGE_KEYS.checklist, JSON.stringify(checklistState)); }
function saveCards() { localStorage.setItem(STORAGE_KEYS.cards, JSON.stringify(cards)); }

// ========== Utilities ==========
function generateId() { return Date.now().toString(36) + Math.random().toString(36).substr(2, 5); }

function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3, φ1 = lat1 * Math.PI / 180, φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180, Δλ = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(Δφ/2)**2 + Math.cos(φ1)*Math.cos(φ2)*Math.sin(Δλ/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function formatPrice(val) {
    const n = parseInt(val); if (isNaN(n)) return val;
    return n >= 10000 ? `${(n/10000).toFixed(1)}억` : `${n.toLocaleString()}만원`;
}

function formatPriceShort(val) {
    const n = parseInt(val); if (isNaN(n)) return '-';
    if (n >= 10000) return `${(n/10000).toFixed(1)}억`;
    if (n >= 1000) return `${(n/1000).toFixed(0)}천`;
    return `${n}만`;
}

function formatDate(iso) {
    if (!iso) return '-';
    const d = new Date(iso);
    return `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}`;
}

function formatApiDate(str) {
    if (!str) return '-';
    const s = str.replace(/[^0-9]/g, '');
    if (s.length >= 8) return `${s.substr(0,4)}.${s.substr(4,2)}.${s.substr(6,2)}`;
    return str;
}

// ========== Service Worker ==========
function registerSW() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js').then(reg => {
            console.log('SW ok');
            // 새 SW가 대기 중이면 즉시 활성화
            reg.addEventListener('updatefound', () => {
                const newSW = reg.installing;
                newSW.addEventListener('statechange', () => {
                    if (newSW.state === 'activated') {
                        console.log('SW updated - reloading');
                        window.location.reload();
                    }
                });
            });
            // 페이지 열 때마다 업데이트 체크
            reg.update();
        }).catch(e => console.warn('SW fail:', e));

        // 탭 다시 포커스될 때 업데이트 확인
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) {
                navigator.serviceWorker.getRegistration().then(reg => {
                    if (reg) reg.update();
                });
            }
        });
    }
}
