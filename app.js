/* ============================================
   My House PWA - Core Application Logic
   ============================================ */

// ========== Constants ==========
const STORAGE_KEYS = {
    spots: 'myhouse_spots',
    checklist: 'myhouse_checklist',
    cards: 'myhouse_cards',
    fogVisited: 'myhouse_fog_visited',
};

const TYPE_ICONS = {
    apartment: '🏢',
    villa: '🏘️',
    officetel: '🏬',
    house: '🏡',
    development: '🚧',
    other: '📍',
};

const TYPE_LABELS = {
    apartment: '아파트',
    villa: '빌라/연립',
    officetel: '오피스텔',
    house: '단독주택',
    development: '개발예정지',
    other: '기타',
};

// Proximity threshold in meters to trigger check-in
const CHECKIN_RADIUS = 100;

// Default map center (Seoul)
const DEFAULT_CENTER = [37.5665, 126.9780];
const DEFAULT_ZOOM = 13;

// Checklist template
const CHECKLIST_TEMPLATE = [
    {
        category: '🏗️ 건물 외부',
        items: [
            '외벽 균열/곰팡이 여부',
            '주차장 공간 및 상태',
            '쓰레기 처리 시설 위치',
            '엘리베이터 상태 (저층 제외)',
            'CCTV 설치 여부',
            '관리사무소 유무',
        ],
    },
    {
        category: '🏠 건물 내부',
        items: [
            '수압 체크 (싱크대/화장실)',
            '곰팡이/결로 여부 (벽, 천장)',
            '방향 확인 (남향 여부)',
            '소음 확인 (도로/층간)',
            '환기 상태 (창문 열림 여부)',
            '콘센트 위치 및 개수',
            '보일러 상태 (연식 확인)',
            '배수 상태 (화장실/베란다)',
        ],
    },
    {
        category: '📍 주변 환경',
        items: [
            '지하철/버스까지 도보 시간',
            '경사도 (언덕 여부)',
            '편의점/마트 접근성',
            '병원/약국 접근성',
            '공원/산책로 유무',
            '야간 가로등/안전성',
            '학교/학원가 (해당 시)',
        ],
    },
    {
        category: '📄 계약 관련',
        items: [
            '등기부등본 확인',
            '전입세대 열람내역 확인',
            '관리비 확인 (여름/겨울)',
            '특약 사항 확인',
            '중개수수료 확인',
            '이사 가능 날짜 확인',
        ],
    },
];

// ========== State ==========
let map = null;
let userMarker = null;
let userLatLng = null;
let spotMarkers = {};
let spots = [];
let cards = [];
let checklistState = {};
let fogEnabled = false;
let addingSpotMode = false;
let tempMarker = null;
let tempLatLng = null;
let currentDetailSpotId = null;
let watchId = null;
let nearbySpotId = null;

// ========== Initialization ==========
document.addEventListener('DOMContentLoaded', () => {
    // Show app after splash
    setTimeout(() => {
        document.getElementById('app').classList.remove('hidden');
    }, 2200);

    initMap();
    loadData();
    renderSpotsList();
    renderChecklist();
    renderCards();
    updateBadges();
    bindEvents();
    startLocationWatch();
    registerSW();
});

// ========== Map ==========
function initMap() {
    map = L.map('map', {
        center: DEFAULT_CENTER,
        zoom: DEFAULT_ZOOM,
        zoomControl: false,
    });

    L.control.zoom({ position: 'bottomleft' }).addTo(map);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap',
        maxZoom: 19,
    }).addTo(map);

    // Click to add spot when in add mode
    map.on('click', (e) => {
        if (addingSpotMode) {
            setTempMarker(e.latlng);
        }
    });
}

function createMarkerIcon(type, visited) {
    const markerClass = `marker-${type}${visited ? ' marker-visited' : ''}`;
    return L.divIcon({
        className: '',
        html: `<div class="custom-marker ${markerClass}"><span>${TYPE_ICONS[type] || '📍'}</span></div>`,
        iconSize: [36, 36],
        iconAnchor: [18, 36],
        popupAnchor: [0, -36],
    });
}

function addSpotMarker(spot) {
    const icon = createMarkerIcon(spot.type, spot.visited);
    const marker = L.marker([spot.lat, spot.lng], { icon })
        .addTo(map)
        .bindPopup(`<b>${spot.name}</b><br>${TYPE_LABELS[spot.type] || ''}`);

    marker.on('click', () => showSpotDetail(spot.id));
    spotMarkers[spot.id] = marker;
}

function removeSpotMarker(id) {
    if (spotMarkers[id]) {
        map.removeLayer(spotMarkers[id]);
        delete spotMarkers[id];
    }
}

function refreshAllMarkers() {
    Object.keys(spotMarkers).forEach((id) => removeSpotMarker(id));
    spots.forEach((spot) => addSpotMarker(spot));
}

function setTempMarker(latlng) {
    tempLatLng = latlng;
    if (tempMarker) map.removeLayer(tempMarker);
    tempMarker = L.marker(latlng, {
        icon: L.divIcon({
            className: '',
            html: '<div class="custom-marker marker-other" style="opacity:0.7"><span>📌</span></div>',
            iconSize: [36, 36],
            iconAnchor: [18, 36],
        }),
    }).addTo(map);

    document.getElementById('spot-coords').textContent =
        `${latlng.lat.toFixed(6)}, ${latlng.lng.toFixed(6)}`;
    openModal('modal-add-spot');
}

// ========== Location Tracking ==========
function startLocationWatch() {
    if (!navigator.geolocation) {
        showToast('⚠️ 위치 서비스를 사용할 수 없습니다');
        return;
    }

    watchId = navigator.geolocation.watchPosition(
        (pos) => {
            const { latitude, longitude } = pos.coords;
            userLatLng = { lat: latitude, lng: longitude };
            updateUserMarker(latitude, longitude);
            checkProximity();
        },
        (err) => {
            console.warn('Geolocation error:', err);
        },
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
    );
}

function updateUserMarker(lat, lng) {
    if (!userMarker) {
        userMarker = L.marker([lat, lng], {
            icon: L.divIcon({
                className: '',
                html: '<div class="user-location-marker"></div>',
                iconSize: [18, 18],
                iconAnchor: [9, 9],
            }),
            zIndexOffset: 1000,
        }).addTo(map);
    } else {
        userMarker.setLatLng([lat, lng]);
    }
}

function locateUser() {
    if (userLatLng) {
        map.flyTo([userLatLng.lat, userLatLng.lng], 16, { duration: 0.8 });
    } else {
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                userLatLng = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                updateUserMarker(userLatLng.lat, userLatLng.lng);
                map.flyTo([userLatLng.lat, userLatLng.lng], 16, { duration: 0.8 });
            },
            () => showToast('⚠️ 위치를 가져올 수 없습니다'),
            { enableHighAccuracy: true }
        );
    }
}

// ========== Proximity / Check-in ==========
function checkProximity() {
    if (!userLatLng || spots.length === 0) return;

    let closestSpot = null;
    let closestDist = Infinity;

    spots.forEach((spot) => {
        if (spot.visited) return;
        const dist = getDistance(userLatLng.lat, userLatLng.lng, spot.lat, spot.lng);
        if (dist < CHECKIN_RADIUS && dist < closestDist) {
            closestDist = dist;
            closestSpot = spot;
        }
    });

    const alertEl = document.getElementById('proximity-alert');
    if (closestSpot) {
        nearbySpotId = closestSpot.id;
        document.querySelector('.proximity-text').textContent =
            `📍 "${closestSpot.name}" 근처입니다! (${Math.round(closestDist)}m)`;
        alertEl.classList.remove('hidden');
    } else {
        nearbySpotId = null;
        alertEl.classList.add('hidden');
    }
}

function performCheckin() {
    if (!nearbySpotId) return;

    const spot = spots.find((s) => s.id === nearbySpotId);
    if (!spot) return;

    spot.visited = true;
    spot.visitedAt = new Date().toISOString();
    saveData();

    // Create card
    const card = createCard(spot);
    cards.push(card);
    saveCards();

    // Refresh UI
    refreshAllMarkers();
    renderSpotsList();
    renderCards();
    updateBadges();

    document.getElementById('proximity-alert').classList.add('hidden');
    nearbySpotId = null;

    // Show card modal
    showCardAcquired(card);
    showToast(`🎉 "${spot.name}" 방문 완료! 카드 획득!`);
}

function createCard(spot) {
    const rarityRoll = Math.random();
    let rarity, rarityLabel;
    if (rarityRoll > 0.95) {
        rarity = 'legendary';
        rarityLabel = '⭐ LEGENDARY';
    } else if (rarityRoll > 0.8) {
        rarity = 'epic';
        rarityLabel = '💎 EPIC';
    } else if (rarityRoll > 0.5) {
        rarity = 'rare';
        rarityLabel = '🔮 RARE';
    } else {
        rarity = 'common';
        rarityLabel = 'COMMON';
    }

    return {
        id: generateId(),
        spotId: spot.id,
        spotName: spot.name,
        spotType: spot.type,
        rarity,
        rarityLabel,
        acquiredAt: new Date().toISOString(),
        stats: {
            distance: spot.price ? `${(parseInt(spot.price) / 10000).toFixed(1)}억` : '-',
            visits: 1,
        },
    };
}

function showCardAcquired(card) {
    const el = document.getElementById('acquired-card');
    el.innerHTML = `
        <div class="card-type-icon">${TYPE_ICONS[card.spotType] || '📍'}</div>
        <div class="card-name">${card.spotName}</div>
        <div class="card-date">${formatDate(card.acquiredAt)}</div>
        <div class="card-rarity rarity-${card.rarity}">${card.rarityLabel}</div>
    `;
    openModal('modal-card');
}

// ========== Spots CRUD ==========
function addSpot(data) {
    const spot = {
        id: generateId(),
        name: data.name,
        type: data.type,
        price: data.price,
        note: data.note,
        lat: data.lat,
        lng: data.lng,
        visited: false,
        visitedAt: null,
        createdAt: new Date().toISOString(),
    };

    spots.push(spot);
    saveData();
    addSpotMarker(spot);
    renderSpotsList();
    updateBadges();
    showToast(`✅ "${spot.name}" 추가 완료!`);
}

function deleteSpot(id) {
    spots = spots.filter((s) => s.id !== id);
    removeSpotMarker(id);
    saveData();
    renderSpotsList();
    updateBadges();
    closeModal('modal-spot-detail');
    showToast('🗑️ 삭제되었습니다');
}

// ========== Rendering ==========
function renderSpotsList() {
    const container = document.getElementById('spots-list');
    document.getElementById('spot-total').textContent = `${spots.length}건`;

    if (spots.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <span class="empty-icon">🏘️</span>
                <p>지도에서 ➕ 버튼으로<br>관심 장소를 추가해 보세요!</p>
            </div>
        `;
        return;
    }

    const sorted = [...spots].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    container.innerHTML = sorted
        .map(
            (spot) => `
        <div class="spot-item ${spot.visited ? 'visited' : ''}" data-id="${spot.id}">
            <div class="spot-icon-wrapper">
                ${TYPE_ICONS[spot.type] || '📍'}
            </div>
            <div class="spot-info">
                <div class="spot-name">${spot.name}</div>
                <div class="spot-meta">
                    ${TYPE_LABELS[spot.type] || '기타'}
                    ${spot.price ? ` · ${formatPrice(spot.price)}` : ''}
                </div>
            </div>
            ${spot.visited ? '<span class="spot-visited-badge">✅ 방문완료</span>' : ''}
        </div>
    `
        )
        .join('');

    container.querySelectorAll('.spot-item').forEach((el) => {
        el.addEventListener('click', () => showSpotDetail(el.dataset.id));
    });
}

function renderChecklist() {
    const container = document.getElementById('checklist-container');
    container.innerHTML = CHECKLIST_TEMPLATE.map(
        (cat, ci) => `
        <div class="checklist-category">
            <div class="checklist-category-title">${cat.category}</div>
            ${cat.items
                .map(
                    (item, ii) => `
                <div class="check-item ${checklistState[`${ci}-${ii}`] ? 'checked' : ''}"
                     data-key="${ci}-${ii}">
                    <div class="check-box">${checklistState[`${ci}-${ii}`] ? '✓' : ''}</div>
                    <span class="check-label">${item}</span>
                </div>
            `
                )
                .join('')}
        </div>
    `
    ).join('');

    container.querySelectorAll('.check-item').forEach((el) => {
        el.addEventListener('click', () => {
            const key = el.dataset.key;
            checklistState[key] = !checklistState[key];
            saveChecklist();
            renderChecklist();
        });
    });
}

function renderCards() {
    const container = document.getElementById('cards-grid');
    document.getElementById('card-total').textContent = `${cards.length}장`;

    // Update header badge
    document.querySelector('#badge-count .badge-num').textContent = cards.length;

    if (cards.length === 0) {
        container.innerHTML = `
            <div class="empty-state" style="grid-column: 1/-1">
                <span class="empty-icon">🃏</span>
                <p>매물 근처에서 체크인하면<br>카드를 획득할 수 있어요!</p>
            </div>
        `;
        return;
    }

    container.innerHTML = cards
        .map(
            (card) => `
        <div class="game-card">
            <div class="card-type-icon">${TYPE_ICONS[card.spotType] || '📍'}</div>
            <div class="card-name">${card.spotName}</div>
            <div class="card-date">${formatDate(card.acquiredAt)}</div>
            <div class="card-stats">
                <div class="card-stat">
                    <span class="card-stat-label">가격</span>
                    <span class="card-stat-value">${card.stats.distance}</span>
                </div>
            </div>
            <span class="card-rarity rarity-${card.rarity}">${card.rarityLabel}</span>
        </div>
    `
        )
        .join('');
}

function updateBadges() {
    const visitedCount = spots.filter((s) => s.visited).length;
    document.querySelector('#visit-count .badge-num').textContent = visitedCount;
    document.querySelector('#badge-count .badge-num').textContent = cards.length;
}

// ========== Spot Detail ==========
function showSpotDetail(id) {
    const spot = spots.find((s) => s.id === id);
    if (!spot) return;

    currentDetailSpotId = id;
    document.getElementById('detail-title').textContent = `${TYPE_ICONS[spot.type]} ${spot.name}`;

    const body = document.getElementById('detail-body');
    body.innerHTML = `
        <div class="detail-section">
            <div class="detail-row">
                <span class="detail-label">유형</span>
                <span class="detail-value">${TYPE_LABELS[spot.type] || '기타'}</span>
            </div>
            ${
                spot.price
                    ? `<div class="detail-row">
                        <span class="detail-label">가격</span>
                        <span class="detail-value">${formatPrice(spot.price)}</span>
                    </div>`
                    : ''
            }
            <div class="detail-row">
                <span class="detail-label">좌표</span>
                <span class="detail-value" style="font-size:12px;font-family:monospace">${spot.lat.toFixed(6)}, ${spot.lng.toFixed(6)}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">등록일</span>
                <span class="detail-value">${formatDate(spot.createdAt)}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">방문 여부</span>
                <span class="detail-value">${spot.visited ? `✅ ${formatDate(spot.visitedAt)}` : '❌ 미방문'}</span>
            </div>
        </div>
        ${spot.note ? `<div class="detail-note">📝 ${spot.note}</div>` : ''}
    `;

    openModal('modal-spot-detail');

    // Center map on spot
    map.flyTo([spot.lat, spot.lng], 16, { duration: 0.5 });
}

// ========== Events ==========
function bindEvents() {
    // Tab navigation
    document.querySelectorAll('.tab-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach((c) => c.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
        });
    });

    // Bottom sheet toggle
    document.getElementById('sheet-handle').addEventListener('click', () => {
        const sheet = document.getElementById('bottom-sheet');
        sheet.classList.toggle('collapsed');
        sheet.classList.toggle('expanded');
    });

    // Map buttons
    document.getElementById('btn-locate').addEventListener('click', locateUser);

    document.getElementById('btn-add-spot').addEventListener('click', () => {
        if (addingSpotMode) {
            cancelAddMode();
        } else {
            addingSpotMode = true;
            document.getElementById('btn-add-spot').classList.add('active');
            showToast('📌 지도를 탭하여 위치를 선택하세요');
            
            // If user location available, use it as default
            if (userLatLng) {
                tempLatLng = { lat: userLatLng.lat, lng: userLatLng.lng };
                document.getElementById('spot-coords').textContent =
                    `${userLatLng.lat.toFixed(6)}, ${userLatLng.lng.toFixed(6)}`;
            }
        }
    });

    document.getElementById('btn-fog-toggle').addEventListener('click', () => {
        fogEnabled = !fogEnabled;
        document.getElementById('btn-fog-toggle').classList.toggle('active', fogEnabled);
        toggleFog(fogEnabled);
    });

    // Checkin
    document.getElementById('btn-checkin').addEventListener('click', performCheckin);

    // Add Spot Form
    document.getElementById('form-add-spot').addEventListener('submit', (e) => {
        e.preventDefault();
        const name = document.getElementById('spot-name').value.trim();
        if (!name) return;
        if (!tempLatLng) {
            showToast('⚠️ 지도에서 위치를 클릭해 주세요');
            return;
        }

        addSpot({
            name,
            type: document.getElementById('spot-type').value,
            price: document.getElementById('spot-price').value.trim(),
            note: document.getElementById('spot-note').value.trim(),
            lat: tempLatLng.lat,
            lng: tempLatLng.lng,
        });

        closeModal('modal-add-spot');
        cancelAddMode();
        document.getElementById('form-add-spot').reset();
    });

    // Cancel add
    document.getElementById('btn-cancel-spot').addEventListener('click', () => {
        closeModal('modal-add-spot');
        cancelAddMode();
    });

    // Modal closes
    document.getElementById('modal-close-spot').addEventListener('click', () => {
        closeModal('modal-add-spot');
        cancelAddMode();
    });
    document.getElementById('modal-close-detail').addEventListener('click', () => closeModal('modal-spot-detail'));
    document.getElementById('btn-close-card').addEventListener('click', () => closeModal('modal-card'));

    // Backdrop clicks
    document.querySelectorAll('.modal-backdrop').forEach((bd) => {
        bd.addEventListener('click', () => {
            bd.closest('.modal').classList.add('hidden');
            cancelAddMode();
        });
    });

    // Delete spot
    document.getElementById('btn-delete-spot').addEventListener('click', () => {
        if (currentDetailSpotId && confirm('정말 삭제하시겠습니까?')) {
            deleteSpot(currentDetailSpotId);
        }
    });

    // Navigate to spot
    document.getElementById('btn-navigate-spot').addEventListener('click', () => {
        const spot = spots.find((s) => s.id === currentDetailSpotId);
        if (spot) {
            const url = `https://map.kakao.com/link/to/${encodeURIComponent(spot.name)},${spot.lat},${spot.lng}`;
            window.open(url, '_blank');
        }
    });

    // Reset checklist
    document.getElementById('btn-reset-checklist').addEventListener('click', () => {
        if (confirm('체크리스트를 초기화하시겠습니까?')) {
            checklistState = {};
            saveChecklist();
            renderChecklist();
            showToast('🔄 체크리스트 초기화 완료');
        }
    });
}

function cancelAddMode() {
    addingSpotMode = false;
    document.getElementById('btn-add-spot').classList.remove('active');
    if (tempMarker) {
        map.removeLayer(tempMarker);
        tempMarker = null;
    }
    tempLatLng = null;
}

// ========== Fog of War ==========
function toggleFog(enabled) {
    let fogEl = document.querySelector('.fog-overlay');
    if (enabled) {
        if (!fogEl) {
            fogEl = document.createElement('div');
            fogEl.className = 'fog-overlay';
            document.getElementById('map-container').appendChild(fogEl);
        }
        fogEl.style.opacity = '1';
        showToast('🌫️ 안개 모드 ON - 방문한 곳만 보입니다');
    } else {
        if (fogEl) {
            fogEl.style.opacity = '0';
            setTimeout(() => fogEl.remove(), 500);
        }
        showToast('🌫️ 안개 모드 OFF');
    }
}

// ========== Modals ==========
function openModal(id) {
    document.getElementById(id).classList.remove('hidden');
}

function closeModal(id) {
    document.getElementById(id).classList.add('hidden');
}

// ========== Toast ==========
function showToast(message) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.remove('hidden');
    clearTimeout(toast._timeout);
    toast._timeout = setTimeout(() => toast.classList.add('hidden'), 2500);
}

// ========== Data Persistence ==========
function loadData() {
    try {
        spots = JSON.parse(localStorage.getItem(STORAGE_KEYS.spots)) || [];
        checklistState = JSON.parse(localStorage.getItem(STORAGE_KEYS.checklist)) || {};
        cards = JSON.parse(localStorage.getItem(STORAGE_KEYS.cards)) || [];

        // Render existing markers
        spots.forEach((spot) => addSpotMarker(spot));
    } catch (e) {
        console.error('Load data error:', e);
    }
}

function saveData() {
    localStorage.setItem(STORAGE_KEYS.spots, JSON.stringify(spots));
}

function saveChecklist() {
    localStorage.setItem(STORAGE_KEYS.checklist, JSON.stringify(checklistState));
}

function saveCards() {
    localStorage.setItem(STORAGE_KEYS.cards, JSON.stringify(cards));
}

// ========== Utilities ==========
function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // meters
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lon2 - lon1) * Math.PI) / 180;
    const a =
        Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
        Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatPrice(val) {
    const num = parseInt(val);
    if (isNaN(num)) return val;
    if (num >= 10000) return `${(num / 10000).toFixed(1)}억`;
    return `${num.toLocaleString()}만원`;
}

function formatDate(iso) {
    if (!iso) return '-';
    const d = new Date(iso);
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

// ========== Service Worker ==========
function registerSW() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker
            .register('sw.js')
            .then(() => console.log('SW registered'))
            .catch((err) => console.warn('SW registration failed:', err));
    }
}
