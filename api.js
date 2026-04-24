/* ============================================
   My House - API Service Layer
   국토교통부 실거래가 + 법정동코드 + 청약홈 분양정보
   ============================================ */

const API = (() => {
    // ========== Storage ==========
    const KEYS_STORAGE = 'myhouse_api_keys';

    function getKeys() {
        try {
            return JSON.parse(localStorage.getItem(KEYS_STORAGE)) || {};
        } catch { return {}; }
    }

    function saveKeys(keys) {
        localStorage.setItem(KEYS_STORAGE, JSON.stringify(keys));
    }

    function hasKeys() {
        const k = getKeys();
        return !!k.serviceKey;
    }

    function getServiceKey() {
        return getKeys().serviceKey || '';
    }

    // ========== Proxy / Fetch ==========
    // 공공데이터 API는 CORS를 지원하지 않으므로 프록시 필요
    // 기본: corsproxy.io (무료) / 사용자 변경 가능
    function getProxyUrl() {
        const k = getKeys();
        return k.proxyUrl || 'https://corsproxy.io/?url=';
    }

    async function apiFetch(url) {
        const proxyUrl = getProxyUrl();
        const finalUrl = proxyUrl + encodeURIComponent(url);
        
        const res = await fetch(finalUrl, {
            headers: { 'Accept': 'application/json' }
        });
        
        if (!res.ok) throw new Error(`API 응답 오류: ${res.status}`);
        return res.json();
    }

    // ========== 법정동코드 API ==========
    // 행정안전부_행정표준코드_법정동코드
    async function searchRegion(keyword) {
        const key = getServiceKey();
        if (!key) throw new Error('API 키가 설정되지 않았습니다. ⚙️ 설정에서 입력해 주세요.');

        const url = `https://apis.data.go.kr/1741000/StanReginCd/getStanReginCdList`
            + `?serviceKey=${key}`
            + `&locatadd_nm=${encodeURIComponent(keyword)}`
            + `&type=json`
            + `&pageNo=1`
            + `&numOfRows=20`;

        const data = await apiFetch(url);
        
        const rows = data?.StanReginCd?.[1]?.row;
        if (!rows || rows.length === 0) return [];

        return rows
            .filter(r => r.locatjumin_cd && r.locatjumin_cd !== '000')
            .map(r => ({
                code: r.region_cd?.substring(0, 5),
                fullCode: r.region_cd,
                name: r.locatjumin_nm || r.locatadd_nm,
                fullName: r.locatjumin_nm || r.locatadd_nm,
                sido: r.sido_cd,
                gugun: r.sgg_cd,
            }));
    }

    // 주요 지역 코드 (빠른 선택용)
    const POPULAR_REGIONS = [
        { code: '11680', name: '서울 강남구' },
        { code: '11650', name: '서울 서초구' },
        { code: '11710', name: '서울 송파구' },
        { code: '11740', name: '서울 강동구' },
        { code: '11500', name: '서울 강서구' },
        { code: '11440', name: '서울 마포구' },
        { code: '11410', name: '서울 서대문구' },
        { code: '11350', name: '서울 노원구' },
        { code: '11110', name: '서울 종로구' },
        { code: '26350', name: '부산 해운대구' },
        { code: '26440', name: '부산 수영구' },
        { code: '26410', name: '부산 연제구' },
        { code: '26110', name: '부산 중구' },
        { code: '28110', name: '인천 중구' },
        { code: '28245', name: '인천 연수구' },
        { code: '41135', name: '경기 성남 분당구' },
        { code: '41117', name: '경기 수원 팔달구' },
        { code: '41195', name: '경기 화성시' },
        { code: '41171', name: '경기 안양 만안구' },
        { code: '41285', name: '경기 하남시' },
        { code: '30110', name: '대전 동구' },
        { code: '27110', name: '대구 중구' },
        { code: '29110', name: '광주 동구' },
    ];

    // ========== 실거래가 API ==========
    // 국토교통부_아파트매매 실거래 상세 자료
    async function getAptTrade(regionCode, dealYearMonth) {
        const key = getServiceKey();
        if (!key) throw new Error('API 키가 설정되지 않았습니다. ⚙️ 설정에서 입력해 주세요.');

        const url = `https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev`
            + `?serviceKey=${key}`
            + `&LAWD_CD=${regionCode}`
            + `&DEAL_YMD=${dealYearMonth}`
            + `&pageNo=1`
            + `&numOfRows=100`
            + `&type=json`;

        const data = await apiFetch(url);
        
        const items = data?.response?.body?.items?.item;
        if (!items) return [];

        const list = Array.isArray(items) ? items : [items];
        return list.map(item => ({
            aptName: (item.aptNm || item.아파트 || '').trim(),
            dealAmount: (item.dealAmount || item.거래금액 || '').replace(/,/g, '').trim(),
            dealYear: item.dealYear || item.년,
            dealMonth: item.dealMonth || item.월,
            dealDay: item.dealDay || item.일,
            area: item.excluUseAr || item.전용면적,
            floor: item.floor || item.층,
            buildYear: item.buildYear || item.건축년도,
            roadName: item.roadNm || item.도로명 || '',
            dong: item.umdNm || item.법정동 || '',
        }));
    }

    // 최근 N개월치 실거래가를 가져오는 헬퍼
    async function getRecentTrades(regionCode, months = 6) {
        const results = [];
        const now = new Date();

        const promises = [];
        for (let i = 0; i < months; i++) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const ym = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
            promises.push(
                getAptTrade(regionCode, ym)
                    .then(items => results.push(...items))
                    .catch(() => {}) // 개별 월 실패 무시
            );
        }

        await Promise.all(promises);
        return results.sort((a, b) => {
            const da = `${a.dealYear}${String(a.dealMonth).padStart(2,'0')}${String(a.dealDay).padStart(2,'0')}`;
            const db = `${b.dealYear}${String(b.dealMonth).padStart(2,'0')}${String(b.dealDay).padStart(2,'0')}`;
            return db.localeCompare(da);
        });
    }

    // 아파트별 가격 추이 데이터 생성
    function buildPriceChart(trades, aptName) {
        const filtered = aptName
            ? trades.filter(t => t.aptName === aptName)
            : trades;

        const grouped = {};
        filtered.forEach(t => {
            const key = `${t.dealYear}.${String(t.dealMonth).padStart(2, '0')}`;
            const price = parseInt(t.dealAmount);
            if (isNaN(price)) return;
            if (!grouped[key]) grouped[key] = [];
            grouped[key].push(price);
        });

        const labels = Object.keys(grouped).sort();
        const avgPrices = labels.map(k => {
            const arr = grouped[k];
            return Math.round(arr.reduce((s, v) => s + v, 0) / arr.length);
        });
        const maxPrices = labels.map(k => Math.max(...grouped[k]));
        const minPrices = labels.map(k => Math.min(...grouped[k]));

        return { labels, avgPrices, maxPrices, minPrices };
    }

    // 아파트 이름 목록 추출
    function getAptNames(trades) {
        const names = new Set();
        trades.forEach(t => { if (t.aptName) names.add(t.aptName); });
        return [...names].sort();
    }

    // ========== 청약홈 분양정보 API ==========
    // 한국부동산원_청약홈 분양정보 조회 서비스
    async function getSubscriptionInfo(page = 1) {
        const key = getServiceKey();
        if (!key) throw new Error('API 키가 설정되지 않았습니다. ⚙️ 설정에서 입력해 주세요.');

        const url = `https://apis.data.go.kr/1613000/OpenStanReginInfoService/getAPTLttotPblancDetail`
            + `?serviceKey=${key}`
            + `&pageNo=${page}`
            + `&numOfRows=10`
            + `&type=json`;

        try {
            const data = await apiFetch(url);
            const items = data?.response?.body?.items?.item;
            if (!items) return [];

            const list = Array.isArray(items) ? items : [items];
            return list.map(item => ({
                houseManageNo: item.houseManageNo || item.HOUSE_MANAGE_NO || '',
                houseName: item.houseNm || item.HOUSE_NM || '정보 없음',
                houseDtlSecdNm: item.houseDtlSecdNm || item.HOUSE_DTL_SECD_NM || '',
                sido: item.sido || item.SUBSCRPT_AREA_CODE_NM || '',
                supplyLocation: item.hssplyAdres || item.HSSPLY_ADRES || '',
                recruitDate: item.rcritPblancDe || item.RCRIT_PBLANC_DE || '',
                applyStartDate: item.rceptBgnde || item.RCEPT_BGNDE || '',
                applyEndDate: item.rceptEndde || item.RCEPT_ENDDE || '',
                winnerDate: item.przwnerPresnatnDe || item.PRZWNER_PRESNATN_DE || '',
                totalSupply: item.totSuplyHshldco || item.TOT_SUPLY_HSHLDCO || 0,
                constructor: item.bsnsMbyNm || item.BSNS_MBY_NM || '',
                houseType: item.houseSecd || item.HOUSE_SECD || '',
            }));
        } catch (err) {
            console.error('청약 API 에러:', err);
            // 대체 엔드포인트 시도
            return getSubscriptionInfoFallback(page);
        }
    }

    // 대체 엔드포인트
    async function getSubscriptionInfoFallback(page = 1) {
        const key = getServiceKey();
        const url = `https://api.odcloud.kr/api/ApplyhomeInfoDetailSvc/v1/getAPTLttotPblancDetail`
            + `?serviceKey=${key}`
            + `&page=${page}`
            + `&perPage=10`;

        const data = await apiFetch(url);
        const items = data?.data;
        if (!items) return [];

        return items.map(item => ({
            houseManageNo: item.HOUSE_MANAGE_NO || '',
            houseName: item.HOUSE_NM || '정보 없음',
            houseDtlSecdNm: item.HOUSE_DTL_SECD_NM || '',
            sido: item.SUBSCRPT_AREA_CODE_NM || '',
            supplyLocation: item.HSSPLY_ADRES || '',
            recruitDate: item.RCRIT_PBLANC_DE || '',
            applyStartDate: item.RCEPT_BGNDE || '',
            applyEndDate: item.RCEPT_ENDDE || '',
            winnerDate: item.PRZWNER_PRESNATN_DE || '',
            totalSupply: item.TOT_SUPLY_HSHLDCO || 0,
            constructor: item.BSNS_MBY_NM || '',
        }));
    }

    // ========== Public Interface ==========
    return {
        getKeys,
        saveKeys,
        hasKeys,
        getServiceKey,
        getProxyUrl,
        searchRegion,
        POPULAR_REGIONS,
        getAptTrade,
        getRecentTrades,
        buildPriceChart,
        getAptNames,
        getSubscriptionInfo,
    };
})();
