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
        let k = getKeys().serviceKey || '';
        // 디코딩 키(+, = 포함)가 입력되었지만 인코딩되지 않은 상태라면 자동으로 인코딩 처리
        if (k && !k.includes('%') && (k.includes('+') || k.includes('='))) {
            k = encodeURIComponent(k);
        }
        return k;
    }

    // ========== Fetch ==========
    // 공공데이터 API는 CORS를 지원하므로 프록시 없이 직접 호출이 가능합니다.
    function getCustomProxy() {
        return getKeys().proxyUrl || '';
    }

    async function apiFetch(url) {
        let res;
        try {
            res = await fetch(url);
        } catch (e) {
            throw new Error('네트워크 오류 또는 공공데이터 서버 응답 지연입니다.');
        }

        let text = await res.text();
        if (!text) throw new Error('빈 응답값을 받았습니다.');
        
        // 공공 API XML 응답 또는 HTML 에러 페이지 처리
        const lowerText = text.trim().toLowerCase();
        if (lowerText.startsWith('<!doctype') || lowerText.startsWith('<html')) {
            throw new Error('API에러: 공공데이터 포털 서버에서 일시적인 HTML 에러 페이지를 반환했습니다.');
        }
        
        if (text.trim().startsWith('<')) {
            // 실제 에러인지 확인
            const isError = !res.ok || text.includes('<errMsg>') || text.includes('<returnAuthMsg>') || text.includes('SERVICE ERROR') || text.includes('<resultCode>99</resultCode>');
            if (isError) {
                const em = text.match(/<errMsg>(.*?)<\/errMsg>/) || 
                           text.match(/<returnAuthMsg>(.*?)<\/returnAuthMsg>/) || 
                           text.match(/<originalMessage>(.*?)<\/originalMessage>/);
                const msg = em ? em[1].trim() : '잘못된 API 키이거나 권한이 없습니다. (API 관리자 페이지를 확인하세요)';
                throw new Error(`API에러: ${msg}`);
            }

            // 정상적인 XML 응답 (XML을 JSON 형태로 변환)
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(text, "text/xml");
            const items = xmlDoc.querySelectorAll('item');

            const resultItems = Array.from(items).map(itemNode => {
                const obj = {};
                for (const child of itemNode.children) {
                    obj[child.tagName] = child.textContent;
                }
                return obj;
            });
            
            return { response: { body: { items: { item: resultItems } } } };
        }
        
        // JSON 응답인 경우
        if (!res.ok) {
            throw new Error(`API에러: HTTP ${res.status} - 키가 유효하지 않거나 권한이 없습니다.`);
        }
        
        try {
            return JSON.parse(text);
        } catch (e) {
            throw new Error('API 응답 파싱 실패 (JSON 포맷이 아님)');
        }
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

        const url = `https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade`
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
        const errors = [];
        // 데이터 조회를 위해 시스템 시간이 미래(예: 2026년)인 경우, 최신 실거래 데이터가 존재하는 2024년 4월 기준으로 캡핑
        let now = new Date();
        if (now.getFullYear() > 2024) {
            now = new Date(2024, 3, 28); // 2024년 4월
        }

        const promises = [];
        for (let i = 0; i < months; i++) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const ym = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
            promises.push(
                getAptTrade(regionCode, ym)
                    .then(items => results.push(...items))
                    .catch(err => errors.push({ month: ym, error: err.message }))
            );
        }

        await Promise.all(promises);

        // 전부 실패한 경우 에러 throw
        if (results.length === 0 && errors.length > 0) {
            throw new Error(`API 호출 실패 (${errors.length}건): ${errors[0].error}`);
        }

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
            + `&numOfRows=100`
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
            + `&perPage=100`;

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

    // ========== 주소 검색 (VWorld - 한국 전용 초고속 검색) ==========
    // VWorld API는 JSONP를 지원하므로 CORS 문제 없이 즉시 호출 가능
    function searchLocation(query) {
        return new Promise((resolve, reject) => {
            const callbackName = 'vworld_cb_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
            const targetUrl = `https://api.vworld.kr/req/search?service=search&request=search&version=2.0&crs=EPSG:4326&size=8&page=1&query=${encodeURIComponent(query)}&type=place&format=jsonp&callback=${callbackName}&errorformat=jsonp&key=CEB52025-E065-364C-9DBA-44880E3B02B8`;
            
            const script = document.createElement('script');
            script.src = targetUrl;
            
            window[callbackName] = function(data) {
                delete window[callbackName];
                document.head.removeChild(script);
                
                if (data.response.status !== 'OK' || !data.response.result) {
                    resolve([]);
                    return;
                }
                
                const items = data.response.result.items.map(item => {
                    const addr = item.address.road || item.address.parcel || item.title;
                    return {
                        name: addr + ` (${item.title})`,
                        shortName: item.title,
                        lat: parseFloat(item.point.y),
                        lng: parseFloat(item.point.x),
                        type: item.category,
                    };
                });
                resolve(items);
            };
            
            script.onerror = function() {
                delete window[callbackName];
                document.head.removeChild(script);
                reject(new Error('검색 서버 상태 이상'));
            };
            
            document.head.appendChild(script);
        });
    }

    // ========== Public Interface ==========
    return {
        getKeys,
        saveKeys,
        hasKeys,
        getServiceKey,
        getCustomProxy,
        searchRegion,
        searchLocation,
        POPULAR_REGIONS,
        getAptTrade,
        getRecentTrades,
        buildPriceChart,
        getAptNames,
        getSubscriptionInfo,
    };
})();
