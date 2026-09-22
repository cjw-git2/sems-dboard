/**
 * SEMS (Seoul Excavation Management System)
 * Dashboard Logic & Dynamic Data Engine
 * Modern Pure White Clean Light Theme Edition (Ver 1.0)
 * Integrated Web Hosting Authentication & Global Sync Engine
 */

// Authentication State (Updated Credentials)
const AUTH_SESSION_KEY = 'SEMS_AUTH_SESSION_TOKEN';
const DEFAULT_ID = 'semsb2';
const DEFAULT_PW = 'sems!2026';

// Global State
let rawData = [];                // Loaded dataset from Excel (인허가 엑셀 데이터)
let filteredData = [];           // Final table filtered dataset (includes active card filter)
let paymentData = [];            // Separate payment dataset (고지서 / 납부현황 DB)
let filteredPaymentData = [];    // Filtered payment dataset for Payment Card Click View
let refundPostpayData = [];      // Separate Refund/Postpay dataset (환수 / 사후납 대상 DB, Grouped by Permit No)
let filteredRefundPostpayData = []; // Filtered Refund/Postpay dataset
let activeCardFilter = null;     // Specific card item filter state
let isDataLoading = false;       // Loading state indicator for Google Sheet DB synchronization

// Multi-Select District State
let selectedDistricts = [];      // Array of selected district names (e.g. ['서초구', '강서구'])

// Local Storage Keys for Persistent Exception Databases
const MANUAL_BP_STORAGE_KEY = 'SEMS_MANUAL_BP_DB';
const CONTRACTOR_STORAGE_KEY = 'SEMS_CONTRACTOR_MAP_DB';
const PAYMENT_DB_STORAGE_KEY = 'SEMS_PAYMENT_DB';
const REFUND_POSTPAY_DB_STORAGE_KEY = 'SEMS_REFUND_POSTPAY_DB';

// Pagination State (Exact 10 items per page for exact card-table height alignment!)
let currentPage = 1;
const itemsPerPage = 10;     

// Exact Partner & District Mapping Dictionary
const BP_DISTRICT_MAP = [
  { bp: '㈜부민통신', districts: ['서초구'] },
  { bp: '에프투텔레콤㈜', districts: ['강북구', '성북구', '종로구'] },
  { bp: '엘케이테크넷㈜', districts: ['강서구', '영등포구', '양천구'] },
  { bp: '㈜세하통신', districts: ['강동구', '송파구'] },
  { bp: '㈜이화텔레콤', districts: ['노원구', '도봉구'] },
  { bp: '㈜지앤에스기술', districts: ['은평구', '마포구'] },
  { bp: '오티씨㈜', districts: ['구로구', '금천구', '동작구', '관악구'] },
  { bp: '우일정보기술㈜', districts: ['서대문구', '중구', '용산구'] },
  { bp: '㈜우호텔레콤', districts: ['동대문구', '중랑구', '성동구', '광진구'] },
  { bp: '㈜컴피아', districts: ['강남구'] }
];

const ALL_25_DISTRICTS = [
  '강남구', '강동구', '강북구', '강서구', '관악구', '광진구', '구로구', '금천구',
  '노원구', '도봉구', '동대문구', '동작구', '마포구', '서대문구', '서초구', '성동구',
  '성북구', '송파구', '양천구', '영등포구', '용산구', '은평구', '종로구', '중구', '중랑구'
];

const DISTRICT_TO_BP = {};
BP_DISTRICT_MAP.forEach(pair => {
  pair.districts.forEach(d => {
    DISTRICT_TO_BP[d] = pair.bp;
  });
});

// Construction Build Teams District Mapping (수남구축팀 vs 수북구축팀)
const SUNAM_DISTRICTS = ['서초구', '강서구', '영등포구', '양천구', '강동구', '송파구', '구로구', '금천구', '동작구', '관악구', '강남구'];

function getBuildTeam(district) {
  if (!district) return '수북구축팀';
  const cleanD = String(district).trim();
  return SUNAM_DISTRICTS.includes(cleanD) ? '수남구축팀' : '수북구축팀';
}

function normalizeString(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/\s+/g, '').trim();
}

function parseAreaNumber(val) {
  if (val === null || val === undefined || val === '') return 0;
  const num = parseFloat(String(val).replace(/[^\d\.]/g, ''));
  return isNaN(num) ? 0 : num;
}

function formatAreaNumber(num, isDiff = false) {
  if (num === null || num === undefined || isNaN(num)) return '0 ㎡';
  const val = Math.round(num * 10) / 10;
  const isInt = val % 1 === 0;
  const formattedStr = isInt 
    ? Math.abs(val).toLocaleString() 
    : Math.abs(val).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  
  if (isDiff) {
    if (val > 0) return `+${formattedStr} ㎡`;
    if (val < 0) return `-${formattedStr} ㎡`;
    return `0 ㎡`;
  }
  return `${val < 0 ? '-' : ''}${formattedStr} ㎡`;
}

function cleanForSearch(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .toLowerCase()
    .replace(/\(변경\)|\(연장\)|\(재고지\)|\(원적\)/gi, '')
    .replace(/[\s\-\_\.\,\/\(\)\[\]\–\—\－]/g, '')
    .trim();
}

/* Authentication Engine */
function checkAuthentication() {
  const token = sessionStorage.getItem(AUTH_SESSION_KEY) || localStorage.getItem(AUTH_SESSION_KEY);
  const loginOverlay = document.getElementById('loginModalOverlay');
  const appContainer = document.getElementById('dashboardAppContainer');

  if (token === 'AUTHENTICATED') {
    if (loginOverlay) loginOverlay.style.display = 'none';
    if (appContainer) appContainer.style.display = 'flex';
    return true;
  } else {
    if (loginOverlay) loginOverlay.style.display = 'flex';
    if (appContainer) appContainer.style.display = 'none';
    return false;
  }
}

function handleLoginSubmit(e) {
  e.preventDefault();
  const idInput = document.getElementById('loginId').value.trim();
  const pwInput = document.getElementById('loginPassword').value.trim();
  const errBox = document.getElementById('loginErrorMessage');
  const errText = document.getElementById('loginErrorText');

  if (idInput === DEFAULT_ID && pwInput === DEFAULT_PW) {
    sessionStorage.setItem(AUTH_SESSION_KEY, 'AUTHENTICATED');
    errBox.style.display = 'none';
    checkAuthentication();
    confetti({ particleCount: 80, spread: 70, origin: { y: 0.6 } });
    fetchDashboardData();
  } else {
    errBox.style.display = 'flex';
    errText.textContent = '아이디 또는 비밀번호가 올바르지 않습니다.';
  }
}

function handleLogout() {
  if (confirm('대시보드에서 로그아웃 하시겠습니까?')) {
    sessionStorage.removeItem(AUTH_SESSION_KEY);
    localStorage.removeItem(AUTH_SESSION_KEY);
    checkAuthentication();
  }
}

/* Local Persistent Database Utilities for Exception BP Overrides */
function getManualBPMap() {
  try {
    const stored = localStorage.getItem(MANUAL_BP_STORAGE_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch (e) {
    console.error('Failed to load manual BP DB:', e);
    return {};
  }
}

function saveManualBPMap(mapObj) {
  try {
    localStorage.setItem(MANUAL_BP_STORAGE_KEY, JSON.stringify(mapObj));
  } catch (e) {
    console.error('Failed to save manual BP DB:', e);
  }
}

/* Local Persistent Database Utilities for Manual Mapping DB (수동 맵핑 DB) */
function getContractorMap() {
  try {
    const stored = localStorage.getItem(CONTRACTOR_STORAGE_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch (e) {
    console.error('Failed to load contractor map DB:', e);
    return {};
  }
}

function saveContractorMap(mapObj) {
  try {
    localStorage.setItem(CONTRACTOR_STORAGE_KEY, JSON.stringify(mapObj));
  } catch (e) {
    console.error('Failed to save contractor map DB:', e);
  }
}

function updateContractorDbBadge() {
  const badge = document.getElementById('contractorDbBadge');
  if (!badge) return;
  const map = getContractorMap();
  const count = Object.keys(map).length;
  badge.textContent = `${count.toLocaleString()}건`;
}

/* Local Persistent Database Utilities for Payment Data (고지서 / 납부현황 DB) */
function getPaymentDBMap() {
  try {
    const stored = localStorage.getItem(PAYMENT_DB_STORAGE_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch (e) {
    console.error('Failed to load payment DB:', e);
    return {};
  }
}

function savePaymentDBMap(mapObj) {
  try {
    localStorage.setItem(PAYMENT_DB_STORAGE_KEY, JSON.stringify(mapObj));
  } catch (e) {
    console.error('Failed to save payment DB:', e);
  }
}

function updatePaymentDbBadge() {
  const badge = document.getElementById('paymentDbBadge');
  if (!badge) return;
  const map = getPaymentDBMap();
  const count = Object.keys(map).length;
  badge.textContent = `${count.toLocaleString()}건`;
}

function loadPaymentDataFromDB() {
  const dbMap = getPaymentDBMap();
  paymentData = Object.values(dbMap);
  updatePaymentDbBadge();
}

/* Local Persistent Database Utilities for Refund/Postpay Area Comparison (환수 / 사후납 대상 DB) */
function getRefundPostpayDBMap() {
  try {
    const stored = localStorage.getItem(REFUND_POSTPAY_DB_STORAGE_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch (e) {
    console.error('Failed to load refund DB:', e);
    return {};
  }
}

function saveRefundPostpayDBMap(mapObj) {
  try {
    localStorage.setItem(REFUND_POSTPAY_DB_STORAGE_KEY, JSON.stringify(mapObj));
  } catch (e) {
    console.error('Failed to save refund DB:', e);
  }
}

function updateRefundDbBadge() {
  const badge = document.getElementById('refundDbBadge');
  if (!badge) return;
  const map = getRefundPostpayDBMap();
  const count = Object.keys(map).length;
  badge.textContent = `${count.toLocaleString()}건`;
}

function loadRefundPostpayDataFromDB() {
  const dbMap = getRefundPostpayDBMap();
  
  const cleanedMap = {};
  for (const key in dbMap) {
    const item = dbMap[key];
    if (!item || !item.permitNo) continue;
    
    const pNo = String(item.permitNo).trim();
    const pArea = parseAreaNumber(item.permitArea);
    const cArea = parseAreaNumber(item.compArea);
    const diff = Math.round((pArea - cArea) * 100) / 100; // (허가면적 - 준공면적)

    let regionVal = item.region || (pNo.includes('-') ? pNo.split('-')[0] : '');
    let resolvedStatus = item.status || '준공검토';

    if (rawData.length > 0) {
      const cleanP = cleanForSearch(pNo);
      const match = rawData.find(r => cleanForSearch(r.permitNo) === cleanP);
      if (match) {
        if (match.rawStatus) resolvedStatus = match.rawStatus;
        if (match.region) regionVal = match.region;
      }
    }

    cleanedMap[pNo] = {
      permitNo: pNo,
      region: regionVal,
      status: resolvedStatus,
      restoreEntity: item.restoreEntity || '원인자복구',
      permitArea: pArea,
      compArea: cArea,
      areaDiff: diff,
      type: diff >= 1.0 ? '환수대상' : (diff <= -1.0 ? '사후납대상' : '일치'), // Auto-classify (1m2 미만 차이는 일치로 처리)
      lastUpdated: item.lastUpdated || getCurrentFormattedTimestamp()
    };
  }

  refundPostpayData = Object.values(cleanedMap);
  updateRefundDbBadge();
}

/**
 * Helper function to generate MMDD_hhmm timestamp string for excel exports
 */
function getFileTimestampString() {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  return `${mm}${dd}_${hh}${min}`;
}

/**
 * Enhanced Resolve BP Company Engine
 */
function resolveBPCompany(regionVal, rawCompanyVal, permitNoVal) {
  const cleanPermitNo = String(permitNoVal || '').trim();
  const cleanSearchPermit = cleanForSearch(cleanPermitNo);
  
  // 1순위: 대시보드 화면상 사용자 수동 지정 (웹 UI 예외BP 지정)
  const manualMap = getManualBPMap();
  for (const storedPermit in manualMap) {
    if (storedPermit === cleanPermitNo || cleanForSearch(storedPermit) === cleanSearchPermit) {
      const manualInfo = manualMap[storedPermit];
      const compName = typeof manualInfo === 'object' ? manualInfo.company : manualInfo;
      return { company: compName, isManual: true };
    }
  }

  // 2순위: 구글 시트 '수동맵핑' sheet 기준 BP사
  const contractorMap = getContractorMap();
  for (const storedPermit in contractorMap) {
    if (storedPermit === cleanPermitNo || cleanForSearch(storedPermit) === cleanSearchPermit) {
      const cInfo = contractorMap[storedPermit];
      if (cInfo && cInfo.bp && cInfo.bp.trim() !== '') {
        return { company: cInfo.bp.trim(), isManual: false };
      }
    }
  }

  // 3순위 (수동맵핑 sheet에 별도 명시되어 있지 않은 경우): 자치구별 BP사 계약지역(권역) 기준 맵핑
  if (regionVal && DISTRICT_TO_BP[regionVal]) {
    return { company: DISTRICT_TO_BP[regionVal], isManual: false };
  }

  const cleanComp = String(rawCompanyVal || '').trim();
  return { company: cleanComp || '협력사 미정', isManual: false };
}

function resolveContractorDetails(permitNoVal) {
  const cleanPermitNo = String(permitNoVal || '').trim();
  const cleanSearchPermit = cleanForSearch(cleanPermitNo);
  const contractorMap = getContractorMap();

  for (const storedPermit in contractorMap) {
    if (storedPermit === cleanPermitNo || cleanForSearch(storedPermit) === cleanSearchPermit) {
      const cInfo = contractorMap[storedPermit];
      const contractor = cInfo.contractor || '-';
      const media = cInfo.media || '';
      const code = cInfo.code || '';
      
      let remark = '-';
      if (media && code) {
        remark = `${media} / ${code}`;
      } else if (media) {
        remark = media;
      } else if (code) {
        remark = code;
      }

      return {
        contractor: contractor,
        media: media,
        code: code,
        remark: remark
      };
    }
  }

  return { contractor: '-', media: '', code: '', remark: '-' };
}

function getCurrentFormattedTimestamp() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}(${hh}:${min})`;
}

/**
 * Renamed to '최종 업로드'
 */
function updateDataTimestamp(timestampStr) {
  const elem = document.getElementById('timestampText');
  const badge = document.getElementById('dataTimestampBadge');
  const text = timestampStr || 'DB갱신';
  const isUpdating = text.includes('중...') || text.includes('로딩');

  if (badge) {
    const icon = badge.querySelector('i');
    if (isUpdating) {
      badge.style.background = '#2563eb';
      badge.style.borderColor = '#1d4ed8';
      badge.style.boxShadow = '0 0 10px rgba(37, 99, 235, 0.45)';
      badge.style.transition = 'all 0.3s ease';
      if (icon) icon.style.color = '#ffffff';
      if (elem) elem.innerHTML = `<span style="color:#ffffff; font-weight:800;">${text}</span>`;
    } else {
      badge.style.background = '#ffffff';
      badge.style.borderColor = '#cbd5e1';
      badge.style.boxShadow = '0 1px 2px rgba(0, 0, 0, 0.04)';
      if (icon) icon.style.color = '#2563eb';
      if (elem) elem.innerHTML = `<span style="color:#2563eb; font-weight:700;">${text}</span>`;
    }
  } else if (elem) {
    elem.innerHTML = `<span style="color:#2563eb; font-weight:700;">${text}</span>`;
  }
}

/**
 * Netlify Serverless Function (getData.js)을 불러와 구글 시트 데이터 반영
 */
async function fetchDashboardData() {
  isDataLoading = true;
  updateDataTimestamp('DB갱신 중...');

  // 로딩 시작 시 테이블 영역에 안내 로딩 UI 즉시 표시
  renderTableData();

  // 구글 시트 새로고침 시작 시 이전 세션의 로컬 DB 잔재 초기화
  localStorage.removeItem(PAYMENT_DB_STORAGE_KEY);
  localStorage.removeItem(REFUND_POSTPAY_DB_STORAGE_KEY);

  try {
    const response = await fetch('/.netlify/functions/getData');
    const result = await response.json();

    if (result.success && result.data) {
      const approvalData = result.data.approvalStatus || [];   // 신청서별허가현황
      const paymentList = result.data.paymentList || [];       // 납부현황목록
      const mappingData = result.data.manualMapping || [];     // 수동맵핑
      const refundData = result.data.refundAdjustment || [];   // 환수사후납정리

      console.log("허가현황 로드 완료:", approvalData.length, "행");
      console.log("납부목록 로드 완료:", paymentList.length, "행");
      console.log("수동맵핑 로드 완료:", mappingData.length, "행");
      console.log("환수사후납 로드 완료:", refundData.length, "행");

      // 1. 수동맵핑 처리
      if (mappingData.length > 0) {
        processManualMappingData(mappingData);
      }

      // 2. 신청서별 허가현황 처리
      if (approvalData.length > 0) {
        processApprovalStatusData(approvalData);
      }

      // 3. 납부현황목록 처리
      if (paymentList.length > 0) {
        processPaymentListData(paymentList);
      }

      // 4. 환수사후납정리 처리
      if (refundData.length > 0) {
        processRefundAdjustmentData(refundData);
      }

      let dbExportDate = '';
      for (let r = 0; r < Math.min(approvalData.length, 5); r++) {
        const rowStr = (approvalData[r] || []).join(' ');
        if (rowStr.includes('출력일')) {
          const match = rowStr.match(/\d{4}[\-\.\/]\d{2}[\-\.\/]\d{2}/);
          if (match) {
            dbExportDate = match[0];
          }
          break;
        }
      }

      if (dbExportDate) {
        updateDataTimestamp(`${dbExportDate} DB갱신`);
      } else {
        updateDataTimestamp('DB갱신');
      }

      isDataLoading = false;
      populateDropdownOptions();
      updateDefaultDateRange();
      applyFilters();

    } else {
      isDataLoading = false;
      console.error("서버 응답 오류:", result.message);
      if (timestampText) timestampText.innerHTML = '<span style="color:#dc2626; font-weight:700;">DB갱신 실패</span>';
      renderTableData();
    }
  } catch (error) {
    isDataLoading = false;
    console.error("서버에서 데이터를 가져오지 못했습니다:", error);
    if (timestampText) timestampText.innerHTML = '<span style="color:#dc2626; font-weight:700;">DB갱신 에러</span>';
    renderTableData();
  }
}

function processManualMappingData(rawRows) {
  if (!rawRows || rawRows.length <= 1) return;

  let headerRowIndex = 0;
  for (let r = 0; r < Math.min(rawRows.length, 10); r++) {
    const rowStr = rawRows[r].map(c => normalizeString(c)).join(' ');
    if (rowStr.includes('허가번호') || rowStr.includes('도급사') || rowStr.includes('공사매체') || rowStr.includes('공사코드')) {
      headerRowIndex = r;
      break;
    }
  }

  const headerRow = rawRows[headerRowIndex].map(h => normalizeString(h));

  const findCol = (kwList, defIdx) => {
    for (let i = 0; i < headerRow.length; i++) {
      if (kwList.some(kw => headerRow[i].includes(normalizeString(kw)))) return i;
    }
    return defIdx;
  };

  const permitColIdx = findCol(['허가번호', '신청번호'], 0);
  const bpColIdx = findCol(['BP사', '협력사'], 1);
  const contractorColIdx = findCol(['도급사'], 2);
  const mediaColIdx = findCol(['공사매체/구분', '공사매체', '매체', '구분'], 3);
  const codeColIdx = findCol(['TANGO공사코드/비고', 'TANGO공사코드', '공사코드', '코드', '비고'], 4);

  const contractorMap = getContractorMap();

  for (let r = headerRowIndex + 1; r < rawRows.length; r++) {
    const row = rawRows[r];
    if (!row || row.length === 0) continue;

    const pNo = String(row[permitColIdx] || '').trim();
    if (!pNo || pNo.includes('허가번호')) continue;

    const bpVal = String(row[bpColIdx] || '').trim();
    const contractorVal = String(row[contractorColIdx] || '').trim();
    const mediaVal = String(row[mediaColIdx] || '').trim();
    const codeVal = String(row[codeColIdx] || '').trim();

    contractorMap[pNo] = {
      bp: bpVal,
      contractor: contractorVal,
      media: mediaVal,
      code: codeVal,
      lastUpdated: getCurrentFormattedTimestamp()
    };
  }

  saveContractorMap(contractorMap);
  updateContractorDbBadge();
}

function processApprovalStatusData(rawRows) {
  if (!rawRows || rawRows.length <= 1) return;

  let headerRowIndex = 0;
  for (let r = 0; r < Math.min(rawRows.length, 10); r++) {
    const rowStr = rawRows[r].map(c => normalizeString(c)).join(' ');
    if (rowStr.includes('처리상태') || rowStr.includes('공사명') || rowStr.includes('신청접수일') || rowStr.includes('구청') || rowStr.includes('허가번호') || rowStr.includes('신청번호')) {
      headerRowIndex = r;
      break;
    }
  }

  const headerRow = rawRows[headerRowIndex].map(h => normalizeString(h));

  const findColIndex = (keywords, defaultIndex) => {
    for (let i = 0; i < headerRow.length; i++) {
      const h = headerRow[i];
      if (keywords.some(kw => h.includes(normalizeString(kw)))) {
        return i;
      }
    }
    return defaultIndex;
  };

  const regionIdx = findColIndex(['구청', '지역', '시군구', '자치구', '지자체'], 1);
  let companyIdx = -1;
  for (let i = 0; i < headerRow.length; i++) {
    const h = headerRow[i];
    if (h.includes('BP사') || h.includes('협력사') || h.includes('공사업체') || h.includes('시공사')) {
      companyIdx = i;
      break;
    }
  }
  if (companyIdx === -1) {
    companyIdx = findColIndex(['신청인', '업체명'], 10);
  }

  const COLUMN_F_INDEX = 5;
  const COLUMN_D_INDEX = 3;  
  const COLUMN_E_INDEX = 4;  
  const COLUMN_L_INDEX = 11; 
  const COLUMN_N_INDEX = 13; 

  const parsedData = [];
  let validCounter = 1;

  for (let r = headerRowIndex + 1; r < rawRows.length; r++) {
    const row = rawRows[r];
    if (!row || row.length === 0) continue;

    const rowJoinText = row.join(' ');
    
    let fColumnPermitNo = row[COLUMN_F_INDEX];
    if (fColumnPermitNo === undefined || fColumnPermitNo === null || String(fColumnPermitNo).trim() === '') {
      fColumnPermitNo = row[findColIndex(['허가번호', '신청번호'], 5)];
    }

    let dColumnApplyDate = row[COLUMN_D_INDEX];
    let eColumnPermitDate = row[COLUMN_E_INDEX];
    let lColumnTitle = row[COLUMN_L_INDEX];
    let nColumnStatus = row[COLUMN_N_INDEX];

    if (!dColumnApplyDate) dColumnApplyDate = row[findColIndex(['신청접수일', '신청일'], 3)];
    if (!eColumnPermitDate) eColumnPermitDate = row[findColIndex(['허가승인일', '허가일'], 4)];
    if (!lColumnTitle) lColumnTitle = row[findColIndex(['공사명', '사업명', '건명'], 11)];
    if (!nColumnStatus) nColumnStatus = row[findColIndex(['처리상태', '진행상태'], 13)];

    const regionVal = String(row[regionIdx] || '').trim();
    const permitNoVal = String(fColumnPermitNo || '').trim();
    const titleVal = String(lColumnTitle || '').trim();
    const statusVal = String(nColumnStatus || '').trim();
    const rawCompanyVal = String(row[companyIdx] || '').trim();

    if (!statusVal && !titleVal && !permitNoVal && !regionVal) {
      continue;
    }
    
    const normStatusStr = normalizeString(statusVal);
    if (normStatusStr === '처리상태' || normalizeString(titleVal) === '공사명' || regionVal === '구청' || regionVal === '지자체') {
      continue;
    }

    const bpResult = resolveBPCompany(regionVal, rawCompanyVal, permitNoVal);
    const cDetails = resolveContractorDetails(permitNoVal);

    parsedData.push({
      id: validCounter++,
      region: regionVal,
      permitNo: permitNoVal,
      title: titleVal,
      company: bpResult.company,
      isManualBP: bpResult.isManual,
      rawCompany: rawCompanyVal,
      contractor: cDetails.contractor,
      media: cDetails.media,
      code: cDetails.code,
      remark: cDetails.remark,
      applyDate: formatExcelDate(dColumnApplyDate),
      permitDate: formatExcelDate(eColumnPermitDate),
      rawStatus: statusVal || '진행중',
      rawRowText: rowJoinText
    });
  }

  rawData = parsedData;
}

function processPaymentListData(rawRows) {
  if (!rawRows || rawRows.length <= 1) return;

  let headerRowIndex = 0;
  for (let r = 0; r < Math.min(rawRows.length, 10); r++) {
    const rowStr = rawRows[r].map(c => normalizeString(c)).join(' ');
    if (rowStr.includes('허가신청번호') || rowStr.includes('고지종류') || rowStr.includes('영수증확인') || rowStr.includes('완납')) {
      headerRowIndex = r;
      break;
    }
  }

  const headerRow = rawRows[headerRowIndex].map(h => normalizeString(h));

  const findCol = (kwList, defIdx) => {
    for (let i = 0; i < headerRow.length; i++) {
      if (kwList.some(kw => headerRow[i].includes(normalizeString(kw)))) return i;
    }
    return defIdx;
  };

  const permitAppColIdx = findCol(['허가신청번호', '신청번호'], 0);
  const permitNoColIdx = findCol(['허가번호'], 1);
  const noticeTypeColIdx = findCol(['고지종류', '종류'], 2);
  const categoryColIdx = findCol(['부과구분', '구분'], 3);
  const titleColIdx = findCol(['공사명', '건명'], 4);
  const amountColIdx = findCol(['금액'], 5);
  const issueDateColIdx = findCol(['부과일'], 6);
  const dueDateColIdx = findCol(['납기내', '납기'], 7);
  const payDateColIdx = findCol(['납부일'], 8);
  const statusColIdx = findCol(['상태', '완납상태'], 10);

  const dbMap = {};

  for (let r = headerRowIndex + 1; r < rawRows.length; r++) {
    const row = rawRows[r];
    if (!row || row.length === 0) continue;

    const pAppNo = String(row[permitAppColIdx] || '').trim();
    if (!pAppNo || pAppNo.includes('허가신청번호')) continue;

    const permitNo = String(row[permitNoColIdx] || '').trim();
    const noticeType = String(row[noticeTypeColIdx] || '').trim();
    const category = String(row[categoryColIdx] || '').trim();
    const title = String(row[titleColIdx] || '').trim();
    const amount = String(row[amountColIdx] || '').trim();
    const issueDate = formatExcelDate(row[issueDateColIdx]);
    const dueDate = formatExcelDate(row[dueDateColIdx]);
    const payDate = formatExcelDate(row[payDateColIdx]);
    const status = String(row[statusColIdx] || '').trim();

    const itemKey = `${pAppNo}_${noticeType}_${permitNo}_${category}`;

    dbMap[itemKey] = {
      permitAppNo: pAppNo,
      permitNo: permitNo,
      noticeType: noticeType,
      category: category,
      title: title,
      amount: amount,
      issueDate: issueDate,
      dueDate: dueDate,
      payDate: payDate,
      status: status || '납부확인요청',
      lastUpdated: getCurrentFormattedTimestamp()
    };
  }

  savePaymentDBMap(dbMap);
  loadPaymentDataFromDB();
}

function processRefundAdjustmentData(rawRows) {
  if (!rawRows || rawRows.length <= 1) return;

  let headerRowIndex = 0;
  for (let r = 0; r < Math.min(rawRows.length, 10); r++) {
    const rowStr = rawRows[r].map(c => normalizeString(c)).join(' ');
    if (rowStr.includes('허가번호') || rowStr.includes('복구주체') || rowStr.includes('면적')) {
      headerRowIndex = r;
      break;
    }
  }

  const headerRow = rawRows[headerRowIndex].map(h => normalizeString(h));

  const findCol = (kwList, defIdx) => {
    for (let i = 0; i < headerRow.length; i++) {
      if (kwList.some(kw => headerRow[i].includes(normalizeString(kw)))) return i;
    }
    return defIdx;
  };

  const statusColIdx = findCol(['처리상태', '상태'], 0);
  const permitNoColIdx = findCol(['허가번호', '신청번호'], 1);
  const restoreEntityColIdx = findCol(['관리청', '복구주체', '주체'], 3);

  let permitAreaColIdx = 7;  // H열: 허가_면적(㎡)
  let compAreaColIdx = 12;   // M열: 준공_면적(㎡)

  for (let i = 0; i < headerRow.length; i++) {
    const h = headerRow[i];
    if (h.includes('허가_면적') || h.includes('허가면적') || (h.includes('면적') && h.includes('허가') && !h.includes('준공') && !h.includes('차이'))) {
      permitAreaColIdx = i;
    } else if (h.includes('준공_면적') || h.includes('준공면적') || (h.includes('면적') && h.includes('준공'))) {
      compAreaColIdx = i;
    }
  }

  const groupedPermits = {};

  for (let r = headerRowIndex + 1; r < rawRows.length; r++) {
    const row = rawRows[r];
    if (!row || row.length === 0) continue;

    const permitNo = String(row[permitNoColIdx] || '').trim();
    if (!permitNo || permitNo.includes('허가번호')) continue;

    const statusVal = String(row[statusColIdx] || '').trim();
    const restoreEntity = String(row[restoreEntityColIdx] || '').trim();
    const permitAreaVal = row[permitAreaColIdx];
    const compAreaVal = row[compAreaColIdx];

    const iArea = parseAreaNumber(permitAreaVal);
    const oArea = parseAreaNumber(compAreaVal);

    if (!groupedPermits[permitNo]) {
      groupedPermits[permitNo] = {
        permitNo: permitNo,
        status: statusVal,
        restoreEntity: restoreEntity,
        totalPermitArea: 0,
        totalCompArea: 0,
        rowCount: 0
      };
    }

    groupedPermits[permitNo].totalPermitArea += iArea;
    groupedPermits[permitNo].totalCompArea += oArea;
    if (statusVal && (!groupedPermits[permitNo].status || groupedPermits[permitNo].status === '')) {
      groupedPermits[permitNo].status = statusVal;
    }
    if (restoreEntity && (!groupedPermits[permitNo].restoreEntity || groupedPermits[permitNo].restoreEntity === '')) {
      groupedPermits[permitNo].restoreEntity = restoreEntity;
    }
    groupedPermits[permitNo].rowCount++;
  }

  const existingDbMap = {};

  for (const pNo in groupedPermits) {
    const pObj = groupedPermits[pNo];
    const permitAreaSum = Math.round(pObj.totalPermitArea * 100) / 100;
    const compAreaSum = Math.round(pObj.totalCompArea * 100) / 100;
    
    const diff = Math.round((permitAreaSum - compAreaSum) * 100) / 100;

    let targetType = '일치';
    if (diff >= 1.0) {
      targetType = '환수대상';
    } else if (diff <= -1.0) {
      targetType = '사후납대상';
    } else {
      continue; // 1㎡ 미만 면적 차이는 생략
    }

    let resolvedStatus = pObj.status || '';
    let regionVal = pNo.includes('-') ? pNo.split('-')[0] : '';
    if (rawData.length > 0) {
      const cleanP = cleanForSearch(pNo);
      const match = rawData.find(r => cleanForSearch(r.permitNo) === cleanP);
      if (match) {
        if (!resolvedStatus && match.rawStatus) resolvedStatus = match.rawStatus;
        if (match.region) regionVal = match.region;
      }
    }
    if (!resolvedStatus) resolvedStatus = '준공검토';

    existingDbMap[pNo] = {
      permitNo: pNo,
      region: regionVal,
      status: resolvedStatus,
      rawStatus: resolvedStatus,
      restoreEntity: pObj.restoreEntity || '원인자복구',
      permitArea: permitAreaSum,
      compArea: compAreaSum,
      areaDiff: diff,
      type: targetType,
      lastUpdated: getCurrentFormattedTimestamp()
    };
  }

  saveRefundPostpayDBMap(existingDbMap);
  loadRefundPostpayDataFromDB();
}

function formatExcelDate(val) {
  if (val === null || val === undefined || val === '') return '';

  if (typeof val === 'number') {
    try {
      const dateObj = XLSX.SSF.parse_date_code(val);
      if (dateObj && dateObj.y && dateObj.m && dateObj.d) {
        return `${dateObj.y}-${String(dateObj.m).padStart(2, '0')}-${String(dateObj.d).padStart(2, '0')}`;
      }
    } catch (e) {}
  }

  const str = String(val).trim();
  if (!str) return '';

  if (/^\d{8}$/.test(str)) {
    return `${str.substring(0, 4)}-${str.substring(4, 6)}-${str.substring(6, 8)}`;
  }

  const cleanParts = str.replace(/[^\d]/g, ' ').trim().split(/\s+/);
  if (cleanParts.length >= 3) {
    let y = cleanParts[0];
    let m = cleanParts[1].padStart(2, '0');
    let d = cleanParts[2].padStart(2, '0');
    if (y.length === 2) y = '20' + y;
    if (y.length === 4 && Number(m) >= 1 && Number(m) <= 12 && Number(d) >= 1 && Number(d) <= 31) {
      return `${y}-${m}-${d}`;
    }
  }

  const dObj = new Date(str);
  if (!isNaN(dObj.getTime())) {
    const y = dObj.getFullYear();
    const m = String(dObj.getMonth() + 1).padStart(2, '0');
    const d = String(dObj.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  return str;
}

function classifyRecord(record) {
  const rawStr = String(record.rawStatus || '').trim();
  const normStatus = normalizeString(rawStr);
  
  if (!normStatus) {
    return { category: '허가관리', sub: '진행중' };
  }

  if (normStatus.includes('공사취소') || normStatus.includes('취소')) {
    return { category: '제외', sub: '공사취소' };
  }

  if (normStatus.includes('준공완료') || normStatus.includes('준공승인')) {
    return { category: '준공관리', sub: '준공완료' };
  }
  if (normStatus.includes('준공계검토완료') || normStatus.includes('준공계검토중') || 
      normStatus.includes('준공계보완완료') || normStatus.includes('준공계보완제출') || 
      normStatus.includes('준공계사업소검토완료') || normStatus.includes('준공계접수요청') || 
      normStatus.includes('준공계접수') || normStatus.includes('준공접수')) {
    return { category: '준공관리', sub: '준공계접수' };
  }
  if (normStatus.includes('준공계보완요청') || normStatus.includes('준공계작성중') || normStatus.includes('준공보류') || normStatus.includes('준공작성')) {
    return { category: '준공관리', sub: '준공계작성중' };
  }
  if (normStatus.includes('준공')) {
    return { category: '준공관리', sub: '준공완료' };
  }

  if (normStatus.includes('허가증교부') || normStatus.includes('허가증발급') || normStatus.includes('허가증')) {
    return { category: '착공 및 복구공사', sub: '허가증교부' };
  }
  if (normStatus.includes('착공계접수') || normStatus.includes('착공계접수요청') || normStatus.includes('착공계제출') || normStatus.includes('착공')) {
    return { category: '착공 및 복구공사', sub: '착공계제출' };
  }
  if (normStatus.includes('복구공사완료통보') || normStatus.includes('복구공사완료') || normStatus.includes('복구')) {
    return { category: '착공 및 복구공사', sub: '복구공사완료' };
  }

  if (normStatus.includes('허가변경')) {
    return { category: '허가관리', sub: '허가변경' };
  }
  if (normStatus.includes('불허') || normStatus.includes('불가') || normStatus.includes('보완요청')) {
    return { category: '허가관리', sub: '불가(보완요청)' };
  }
  if (normStatus.includes('부과완료') || normStatus.includes('진행중') || normStatus.includes('허가신청') || normStatus.includes('허가')) {
    return { category: '허가관리', sub: '진행중' };
  }

  return { category: '허가관리', sub: '진행중' };
}

// Initialize Application
document.addEventListener('DOMContentLoaded', () => {
  lucide.createIcons();
  
  const isAuthenticated = checkAuthentication();

  const btnLogout = document.getElementById('btnLogout');
  if (btnLogout) btnLogout.addEventListener('click', handleLogout);

  const btnRefreshData = document.getElementById('btnRefreshData');
  if (btnRefreshData) btnRefreshData.addEventListener('click', fetchDashboardData);

  rawData = [];
  filteredData = [];
  paymentData = [];
  filteredPaymentData = [];
  refundPostpayData = [];
  filteredRefundPostpayData = [];
  selectedDistricts = [];
  
  // 새로고침 시 구글 시트 수신 전 이전 세션의 캐시 데이터가 노출되지 않도록 잔재 DB 초기화
  localStorage.removeItem(PAYMENT_DB_STORAGE_KEY);
  localStorage.removeItem(REFUND_POSTPAY_DB_STORAGE_KEY);
  
  updatePaymentDbBadge();
  updateRefundDbBadge();
  updateContractorDbBadge();
  initEventListeners();
  setupMultiSelectEvents();
  setupManualBpModalEvents();

  populateDropdownOptions();

  if (isAuthenticated) {
    updateDataTimestamp('DB갱신 중...');
    applyFilters();
    fetchDashboardData();
  } else {
    updateDataTimestamp('로그인 필요');
  }
});

function initTableColumnResizer() {
  const table = document.getElementById('dataTable');
  if (!table) return;

  const cols = table.querySelectorAll('th');
  cols.forEach(col => {
    const resizer = col.querySelector('.resizer');
    if (!resizer) return;

    if (resizer.dataset.bound === 'true') return;
    resizer.dataset.bound = 'true';

    let startX = 0;
    let startWidth = 0;

    const onMouseDown = (e) => {
      e.preventDefault();
      e.stopPropagation();

      startX = e.clientX;
      const styles = window.getComputedStyle(col);
      startWidth = parseInt(styles.width, 10);

      resizer.classList.add('resizing');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      const onMouseMove = (moveEvent) => {
        const deltaX = moveEvent.clientX - startX;
        const newWidth = Math.max(40, startWidth + deltaX);
        col.style.width = `${newWidth}px`;
      };

      const onMouseUp = () => {
        resizer.classList.remove('resizing');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    };

    resizer.addEventListener('mousedown', onMouseDown);
  });
}

function setupContractorMappingEvents() {
  const btnDownload = document.getElementById('btnDownloadContractorTemplate');
  const btnUpload = document.getElementById('btnUploadContractorMapping');
  const fileInput = document.getElementById('contractorFileInput');

  if (btnDownload) {
    btnDownload.addEventListener('click', downloadContractorMappingTemplate);
  }

  if (btnUpload && fileInput) {
    btnUpload.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        handleContractorMappingFile(e.target.files[0]);
      }
    });
  }
}

function downloadContractorMappingTemplate() {
  const contractorMap = getContractorMap();
  const keys = Object.keys(contractorMap);

  let exportRows = [];

  if (keys.length > 0) {
    exportRows = keys.map(pNo => {
      const cInfo = contractorMap[pNo];
      return {
        '허가번호': pNo,
        'BP사': cInfo.bp || '',
        '도급사': cInfo.contractor || '',
        '공사매체/구분': cInfo.media || '',
        'TANGO공사코드/비고': cInfo.code || ''
      };
    });
  } else {
    exportRows = [
      { '허가번호': '중랑구-2026-통신-0007', 'BP사': '', '도급사': 'PTCE', '공사매체/구분': '원인자', 'TANGO공사코드/비고': '' },
      { '허가번호': '중랑구-2025-통신-0022', 'BP사': '', '도급사': 'SKTNS', '공사매체/구분': '한전 종합정비', 'TANGO공사코드/비고': '' },
      { '허가번호': '중구-2024-통신-0064', 'BP사': '우일정보기술㈜', '도급사': 'SKTNS', '공사매체/구분': 'B2B사업', 'TANGO공사코드/비고': 'B24112066628977' }
    ];
  }

  const timestampStr = getFileTimestampString();
  const worksheet = XLSX.utils.json_to_sheet(exportRows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, '수동맵핑DB');
  XLSX.writeFile(workbook, `SEMS_수동_맵핑_DB_전체_${timestampStr}.xlsx`);
}

function handleContractorMappingFile(file) {
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array', cellDates: true });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      
      const rawRows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '', raw: false });

      if (rawRows.length <= 1) {
        alert('수동 맵핑 엑셀 파일에 데이터 행이 없습니다.');
        return;
      }

      let headerRowIndex = 0;
      for (let r = 0; r < Math.min(rawRows.length, 10); r++) {
        const rowStr = rawRows[r].map(c => normalizeString(c)).join(' ');
        if (rowStr.includes('허가번호') || rowStr.includes('도급사') || rowStr.includes('공사매체') || rowStr.includes('공사코드')) {
          headerRowIndex = r;
          break;
        }
      }

      const headerRow = rawRows[headerRowIndex].map(h => normalizeString(h));

      const findCol = (kwList, defIdx) => {
        for (let i = 0; i < headerRow.length; i++) {
          if (kwList.some(kw => headerRow[i].includes(normalizeString(kw)))) return i;
        }
        return defIdx;
      };

      const permitColIdx = findCol(['허가번호', '신청번호'], 0);
      const bpColIdx = findCol(['BP사', '협력사'], 1);
      const contractorColIdx = findCol(['도급사'], 2);
      const mediaColIdx = findCol(['공사매체/구분', '공사매체', '매체', '구분'], 3);
      const codeColIdx = findCol(['TANGO공사코드/비고', 'TANGO공사코드', '공사코드', '코드', '비고'], 4);

      const contractorMap = getContractorMap();
      let insertedCount = 0;
      let updatedCount = 0;
      let unchangedCount = 0;

      for (let r = headerRowIndex + 1; r < rawRows.length; r++) {
        const row = rawRows[r];
        if (!row || row.length === 0) continue;

        const pNo = String(row[permitColIdx] || '').trim();
        if (!pNo || pNo.includes('허가번호')) continue;

        const bpVal = String(row[bpColIdx] || '').trim();
        const contractorVal = String(row[contractorColIdx] || '').trim();
        const mediaVal = String(row[mediaColIdx] || '').trim();
        const codeVal = String(row[codeColIdx] || '').trim();

        const newItem = {
          bp: bpVal,
          contractor: contractorVal,
          media: mediaVal,
          code: codeVal,
          lastUpdated: getCurrentFormattedTimestamp()
        };

        if (!contractorMap[pNo]) {
          contractorMap[pNo] = newItem;
          insertedCount++;
        } else {
          const oldItem = contractorMap[pNo];
          const isChanged = oldItem.bp !== newItem.bp ||
                            oldItem.contractor !== newItem.contractor ||
                            oldItem.media !== newItem.media ||
                            oldItem.code !== newItem.code;

          if (isChanged) {
            contractorMap[pNo] = { ...oldItem, ...newItem };
            updatedCount++;
          } else {
            unchangedCount++;
          }
        }
      }

      saveContractorMap(contractorMap);
      updateContractorDbBadge();

      reapplyContractorMapToRawData();
      populateDropdownOptions();
      applyFilters();

      confetti({ particleCount: 100, spread: 80, origin: { y: 0.6 } });
      alert(`성공: 수동 맵핑 DB 업데이트 완료!\n\n- 신규 등록: ${insertedCount}건\n- 변경 업데이트: ${updatedCount}건\n- 변경없음 (기존유지): ${unchangedCount}건\n- 현재 DB 총 보관 허가번호: ${Object.keys(contractorMap).length}건`);
    } catch (err) {
      console.error(err);
      alert('수동 맵핑 엑셀 파일 파싱 중 오류가 발생했습니다.');
    }
  };
  reader.readAsArrayBuffer(file);
}

function setupPaymentDataEvents() {
  const btnDownload = document.getElementById('btnDownloadPaymentTemplate');
  const btnUpload = document.getElementById('btnUploadPaymentData');
  const fileInput = document.getElementById('paymentFileInput');

  if (btnDownload) {
    btnDownload.addEventListener('click', downloadPaymentTemplate);
  }

  if (btnUpload && fileInput) {
    btnUpload.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        handlePaymentExcelFile(e.target.files[0]);
      }
    });
  }
}

function downloadPaymentTemplate() {
  const dbMap = getPaymentDBMap();
  const items = Object.values(dbMap);

  let exportRows = [];

  if (items.length > 0) {
    exportRows = items.map(item => ({
      '허가신청번호': item.permitAppNo || '',
      '허가번호': item.permitNo || '',
      '고지종류': item.noticeType || '',
      '부과구분': item.category || '',
      '공사명': item.title || '',
      '금액': item.amount || '',
      '부과일': item.issueDate || '',
      '납기내': item.dueDate || '',
      '납부일': item.payDate || '',
      '영수증확인': '영수증확인',
      '상태': item.status || ''
    }));
  } else {
    exportRows = [
      { '허가신청번호': '통신-260513-0097', '허가번호': '동대문구-2026-통신-0016', '고지종류': '시비-점용료', '부과구분': '선납분', '공사명': '서울동대문구 고신자로 동신관로 지중화공사(시도_보도구간)', '금액': '62,040원', '부과일': '2026-07-30', '납기내': '2026-08-30', '납부일': '-', '영수증확인': '영수증확인', '상태': '납부확인요청' },
      { '허가신청번호': '통신-260421-0054', '허가번호': '동대문구-2026-통신-0010', '고지종류': '시비-점용료', '부과구분': '선납분', '공사명': '25년 서울 동대문구 용두동 원 앞 통신관로공사', '금액': '1,875,720원', '부과일': '2026-07-06', '납기내': '2026-08-06', '납부일': '2026-07-14', '영수증확인': '영수증확인', '상태': '완납' }
    ];
  }

  const timestampStr = getFileTimestampString();
  const worksheet = XLSX.utils.json_to_sheet(exportRows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, '납부현황내역');
  XLSX.writeFile(workbook, `SEMS_고지서_납부현황_DB_전체_${timestampStr}.xlsx`);
}

function handlePaymentExcelFile(file) {
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array', cellDates: true });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      
      const rawRows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '', raw: false });

      if (rawRows.length <= 1) {
        alert('고지서/납부현황 엑셀 파일에 데이터 행이 없습니다.');
        return;
      }

      let headerRowIndex = 0;
      for (let r = 0; r < Math.min(rawRows.length, 10); r++) {
        const rowStr = rawRows[r].map(c => normalizeString(c)).join(' ');
        if (rowStr.includes('허가신청번호') || rowStr.includes('고지종류') || rowStr.includes('영수증확인') || rowStr.includes('완납')) {
          headerRowIndex = r;
          break;
        }
      }

      const headerRow = rawRows[headerRowIndex].map(h => normalizeString(h));

      const findCol = (kwList, defIdx) => {
        for (let i = 0; i < headerRow.length; i++) {
          if (kwList.some(kw => headerRow[i].includes(normalizeString(kw)))) return i;
        }
        return defIdx;
      };

      const permitAppColIdx = findCol(['허가신청번호', '신청번호'], 0);
      const permitNoColIdx = findCol(['허가번호'], 1);
      const noticeTypeColIdx = findCol(['고지종류', '종류'], 2);
      const categoryColIdx = findCol(['부과구분', '구분'], 3);
      const titleColIdx = findCol(['공사명', '건명'], 4);
      const amountColIdx = findCol(['금액'], 5);
      const issueDateColIdx = findCol(['부과일'], 6);
      const dueDateColIdx = findCol(['납기내', '납기'], 7);
      const payDateColIdx = findCol(['납부일'], 8);
      const statusColIdx = findCol(['상태', '완납상태'], 10);

      const dbMap = getPaymentDBMap();
      let insertedCount = 0;
      let updatedCount = 0;
      let unchangedCount = 0;

      for (let r = headerRowIndex + 1; r < rawRows.length; r++) {
        const row = rawRows[r];
        if (!row || row.length === 0) continue;

        const pAppNo = String(row[permitAppColIdx] || '').trim();
        if (!pAppNo || pAppNo.includes('허가신청번호')) continue;

        const permitNo = String(row[permitNoColIdx] || '').trim();
        const noticeType = String(row[noticeTypeColIdx] || '').trim();
        const category = String(row[categoryColIdx] || '').trim();
        const title = String(row[titleColIdx] || '').trim();
        const amount = String(row[amountColIdx] || '').trim();
        const issueDate = formatExcelDate(row[issueDateColIdx]);
        const dueDate = formatExcelDate(row[dueDateColIdx]);
        const payDate = formatExcelDate(row[payDateColIdx]);
        const status = String(row[statusColIdx] || '').trim();

        const itemKey = `${pAppNo}_${noticeType}_${permitNo}_${category}`;

        const newItemData = {
          permitAppNo: pAppNo,
          permitNo: permitNo,
          noticeType: noticeType,
          category: category,
          title: title,
          amount: amount,
          issueDate: issueDate,
          dueDate: dueDate,
          payDate: payDate,
          status: status || '납부확인요청',
          lastUpdated: getCurrentFormattedTimestamp()
        };

        if (!dbMap[itemKey]) {
          dbMap[itemKey] = newItemData;
          insertedCount++;
        } else {
          const existing = dbMap[itemKey];
          if (existing.status !== newItemData.status || existing.payDate !== newItemData.payDate || existing.amount !== newItemData.amount) {
            dbMap[itemKey] = { ...existing, ...newItemData };
            updatedCount++;
          } else {
            unchangedCount++;
          }
        }
      }

      savePaymentDBMap(dbMap);
      loadPaymentDataFromDB();
      applyFilters();

      confetti({ particleCount: 100, spread: 80, origin: { y: 0.6 } });
      alert(`성공: 고지서 / 납부현황 DB 업데이트 완료!\n\n- 신규 등록: ${insertedCount}건\n- 변경 업데이트: ${updatedCount}건\n- 변경없음 (기존유지): ${unchangedCount}건\n- 현재 DB 총 보관: ${Object.keys(dbMap).length}건`);
    } catch (err) {
      console.error(err);
      alert('고지서/납부현황 엑셀 파일 파싱 중 오류가 발생했습니다.');
    }
  };
  reader.readAsArrayBuffer(file);
}

function setupRefundPostpayEvents() {
  const btnDownload = document.getElementById('btnDownloadRefundTemplate');
  const btnUpload = document.getElementById('btnUploadRefundData');
  const fileInput = document.getElementById('refundFileInput');

  if (btnDownload) {
    btnDownload.addEventListener('click', downloadRefundPostpayTemplate);
  }

  if (btnUpload && fileInput) {
    btnUpload.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        handleRefundPostpayExcelFile(e.target.files[0]);
      }
    });
  }
}

function downloadRefundPostpayTemplate() {
  const dbMap = getRefundPostpayDBMap();
  const items = Object.values(dbMap);

  let exportRows = [];

  if (items.length > 0) {
    exportRows = items.map(item => ({
      '허가번호': item.permitNo || '',
      '복구주체': item.restoreEntity || '',
      '허가면적 (㎡)': item.permitArea || 0,
      '준공면적 (㎡)': item.compArea || 0
    }));
  } else {
    exportRows = [
      {
        '허가번호': '중구-2022-통신-0010', '복구주체': '서부도로사업소',
        '허가면적 (㎡)': 199.2, '준공면적 (㎡)': 396.4
      },
      {
        '허가번호': '은평구-2025-통신-0033', '복구주체': '원인자복구',
        '허가면적 (㎡)': 301.2, '준공면적 (㎡)': 168
      }
    ];
  }

  const timestampStr = getFileTimestampString();
  const worksheet = XLSX.utils.json_to_sheet(exportRows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, '환수사후납대상');
  XLSX.writeFile(workbook, `SEMS_환수_사후납_대상_DB_전체_${timestampStr}.xlsx`);
}

function handleRefundPostpayExcelFile(file) {
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array', cellDates: true });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      
      const rawRows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '', raw: false });

      if (rawRows.length <= 1) {
        alert('환수/사후납 대상 엑셀 파일에 데이터 행이 없습니다.');
        return;
      }

      let headerRowIndex = 0;
      for (let r = 0; r < Math.min(rawRows.length, 10); r++) {
        const rowStr = rawRows[r].map(c => normalizeString(c)).join(' ');
        if (rowStr.includes('허가번호') || rowStr.includes('복구주체') || rowStr.includes('면적')) {
          headerRowIndex = r;
          break;
        }
      }

      const headerRow = rawRows[headerRowIndex].map(h => normalizeString(h));

      const findCol = (kwList, defIdx) => {
        for (let i = 0; i < headerRow.length; i++) {
          if (kwList.some(kw => headerRow[i].includes(normalizeString(kw)))) return i;
        }
        return defIdx;
      };

      const statusColIdx = findCol(['처리상태', '상태'], 0);
      const permitNoColIdx = findCol(['허가번호', '신청번호'], 1);
      const restoreEntityColIdx = findCol(['관리청', '복구주체', '주체'], 3);

      let permitAreaColIdx = 7;  // H열: 허가_면적(㎡)
      let compAreaColIdx = 12;   // M열: 준공_면적(㎡)

      for (let i = 0; i < headerRow.length; i++) {
        const h = headerRow[i];
        if (h.includes('허가_면적') || h.includes('허가면적') || (h.includes('면적') && h.includes('허가') && !h.includes('준공') && !h.includes('차이'))) {
          permitAreaColIdx = i;
        } else if (h.includes('준공_면적') || h.includes('준공면적') || (h.includes('면적') && h.includes('준공'))) {
          compAreaColIdx = i;
        }
      }

      const groupedPermits = {};

      for (let r = headerRowIndex + 1; r < rawRows.length; r++) {
        const row = rawRows[r];
        if (!row || row.length === 0) continue;

        const permitNo = String(row[permitNoColIdx] || '').trim();
        if (!permitNo || permitNo.includes('허가번호')) continue;

        const statusVal = String(row[statusColIdx] || '').trim();
        const restoreEntity = String(row[restoreEntityColIdx] || '').trim();
        const permitAreaVal = row[permitAreaColIdx];
        const compAreaVal = row[compAreaColIdx];

        const iArea = parseAreaNumber(permitAreaVal);
        const oArea = parseAreaNumber(compAreaVal);

        if (!groupedPermits[permitNo]) {
          groupedPermits[permitNo] = {
            permitNo: permitNo,
            status: statusVal,
            restoreEntity: restoreEntity,
            totalPermitArea: 0,
            totalCompArea: 0,
            rowCount: 0
          };
        }

        groupedPermits[permitNo].totalPermitArea += iArea;
        groupedPermits[permitNo].totalCompArea += oArea;
        if (statusVal && (!groupedPermits[permitNo].status || groupedPermits[permitNo].status === '')) {
          groupedPermits[permitNo].status = statusVal;
        }
        if (restoreEntity && (!groupedPermits[permitNo].restoreEntity || groupedPermits[permitNo].restoreEntity === '')) {
          groupedPermits[permitNo].restoreEntity = restoreEntity;
        }
        groupedPermits[permitNo].rowCount++;
      }

      const existingDbMap = getRefundPostpayDBMap();
      
      let insertedCount = 0;
      let updatedCount = 0;
      let unchangedCount = 0;

      for (const pNo in groupedPermits) {
        const pObj = groupedPermits[pNo];
        const permitAreaSum = Math.round(pObj.totalPermitArea * 100) / 100;
        const compAreaSum = Math.round(pObj.totalCompArea * 100) / 100;
        
        const diff = Math.round((permitAreaSum - compAreaSum) * 100) / 100;

        let targetType = '일치';
        if (permitAreaSum > compAreaSum) {
          targetType = '환수대상';
        } else if (permitAreaSum < compAreaSum) {
          targetType = '사후납대상';
        } else {
          continue;
        }

        let resolvedStatus = pObj.status || '';
        if (!resolvedStatus && rawData.length > 0) {
          const cleanP = cleanForSearch(pNo);
          const match = rawData.find(r => cleanForSearch(r.permitNo) === cleanP);
          if (match && match.rawStatus) {
            resolvedStatus = match.rawStatus;
          }
        }
        if (!resolvedStatus) resolvedStatus = '준공검토';

        const newItemData = {
          permitNo: pNo,
          status: resolvedStatus,
          rawStatus: resolvedStatus,
          restoreEntity: pObj.restoreEntity || '원인자복구',
          permitArea: permitAreaSum,
          compArea: compAreaSum,
          areaDiff: diff,
          type: targetType,
          lastUpdated: getCurrentFormattedTimestamp()
        };

        if (!existingDbMap[pNo]) {
          existingDbMap[pNo] = newItemData;
          insertedCount++;
        } else {
          const oldItem = existingDbMap[pNo];
          const isChanged = oldItem.permitArea !== newItemData.permitArea ||
                            oldItem.compArea !== newItemData.compArea ||
                            oldItem.areaDiff !== newItemData.areaDiff ||
                            oldItem.restoreEntity !== newItemData.restoreEntity ||
                            oldItem.type !== newItemData.type;

          if (isChanged) {
            existingDbMap[pNo] = { ...oldItem, ...newItemData };
            updatedCount++;
          } else {
            unchangedCount++;
          }
        }
      }

      saveRefundPostpayDBMap(existingDbMap);
      loadRefundPostpayDataFromDB();
      applyFilters();

      confetti({ particleCount: 100, spread: 80, origin: { y: 0.6 } });
      alert(`성공: 환수 / 사후납 대상 DB 업데이트 완료!\n\n- 신규 등록: ${insertedCount}건\n- 변경 업데이트: ${updatedCount}건\n- 변경없음 (기존유지): ${unchangedCount}건\n- 현재 DB 총 보관 허가번호: ${Object.keys(existingDbMap).length}건`);
    } catch (err) {
      console.error(err);
      alert('환수/사후납 대상 엑셀 파싱 중 오류가 발생했습니다.');
    }
  };
  reader.readAsArrayBuffer(file);
}

function reapplyContractorMapToRawData() {
  if (rawData.length === 0) return;
  rawData.forEach(item => {
    const bpResult = resolveBPCompany(item.region, item.rawCompany, item.permitNo);
    item.company = bpResult.company;
    item.isManualBP = bpResult.isManual;

    const cDetails = resolveContractorDetails(item.permitNo);
    item.contractor = cDetails.contractor;
    item.media = cDetails.media;
    item.code = cDetails.code;
    item.remark = cDetails.remark;
  });
}

function setupManualBpModalEvents() {
  const btnManage = document.getElementById('btnManageManualBP');
  const modal = document.getElementById('manualBpModal');
  const btnClose = document.getElementById('btnCloseManualBpModal');
  const btnSave = document.getElementById('btnSaveManualBP');
  const companySelect = document.getElementById('selectManualBPCompany');
  const customBpWrapper = document.getElementById('customBpInputWrapper');
  const customBpInput = document.getElementById('inputCustomBPCompany');

  if (!btnManage || !modal) return;

  companySelect.addEventListener('change', () => {
    if (companySelect.value === 'CUSTOM') {
      customBpWrapper.style.display = 'block';
    } else {
      customBpWrapper.style.display = 'none';
      customBpInput.value = '';
    }
  });

  btnManage.addEventListener('click', () => {
    renderManualBpTable();
    modal.style.display = 'flex';
  });

  btnClose.addEventListener('click', () => {
    modal.style.display = 'none';
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.style.display = 'none';
    }
  });

  btnSave.addEventListener('click', () => {
    const permitNoInput = document.getElementById('inputManualPermitNo');
    const permitNoVal = permitNoInput.value.trim();
    let companyVal = companySelect.value;

    if (companyVal === 'CUSTOM') {
      companyVal = customBpInput.value.trim();
      if (!companyVal) {
        alert('직접 입력할 BP사명을 입력해 주세요.');
        return;
      }
    }

    if (!permitNoVal) {
      alert('허가번호를 입력해 주세요.');
      return;
    }

    if (rawData.length === 0) {
      alert('현재 업로드된 엑셀 데이터가 없습니다. 먼저 엑셀 파일을 업로드한 후 허가번호를 조회하여 저장해 주세요.');
      return;
    }

    const cleanInputPermit = cleanForSearch(permitNoVal);
    const matchedItem = rawData.find(item => {
      const cleanItemPermit = cleanForSearch(item.permitNo);
      return (cleanItemPermit && cleanItemPermit === cleanInputPermit) || item.permitNo === permitNoVal;
    });

    if (!matchedItem) {
      alert(`⚠️ 입력하신 허가번호 [${permitNoVal}]는 현재 업로드된 엑셀 데이터에 존재하지 않습니다.\n\n허가번호를 다시 한번 정확히 확인해 주세요.`);
      return;
    }

    const targetRealPermitNo = matchedItem.permitNo || permitNoVal;
    const manualMap = getManualBPMap();
    const nowStr = getCurrentFormattedTimestamp();
    manualMap[targetRealPermitNo] = { company: companyVal, date: nowStr };
    saveManualBPMap(manualMap);

    permitNoInput.value = '';
    customBpInput.value = '';
    companySelect.value = '㈜부민통신';
    customBpWrapper.style.display = 'none';

    renderManualBpTable();
    
    reapplyManualBPToRawData();
    populateDropdownOptions();
    applyFilters();
    
    alert(`성공: [${targetRealPermitNo}] 허가건이 '${companyVal}' 수동 지정으로 보관 DB에 저장을 완료했습니다!`);
  });
}

function renderManualBpTable() {
  const tbody = document.getElementById('manualBpTableBody');
  if (!tbody) return;

  const manualMap = getManualBPMap();
  const keys = Object.keys(manualMap);

  if (keys.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="4" style="text-align: center; padding: 20px; color: #94a3b8;">
          등록된 수동 예외 BP사 지정 내역이 없습니다.
        </td>
      </tr>`;
    return;
  }

  tbody.innerHTML = keys.map(pNo => {
    const info = manualMap[pNo];
    const comp = typeof info === 'object' ? info.company : info;
    const dateStr = typeof info === 'object' ? info.date : '-';
    
    return `
      <tr>
        <td style="padding: 6px 10px;"><code style="color:#2563eb; font-weight:600;">${pNo}</code></td>
        <td style="padding: 6px 10px; font-weight: 700; color: #7c3aed;">${comp} <span class="manual-bp-tag">수동</span></td>
        <td style="padding: 6px 10px; color: #64748b; font-size: 0.72rem;">${dateStr}</td>
        <td style="padding: 6px 10px; text-align: center;">
          <button onclick="removeManualBPRecord('${pNo}')" style="background: #fef2f2; color: #dc2626; border: 1px solid #fecaca; padding: 2px 6px; border-radius: 4px; font-size: 0.7rem; cursor: pointer;">삭제</button>
        </td>
      </tr>
    `;
  }).join('');
}

window.removeManualBPRecord = function(permitNo) {
  if (confirm(`[${permitNo}] 수동 지정 내역을 삭제하시겠습니까?`)) {
    const manualMap = getManualBPMap();
    delete manualMap[permitNo];
    saveManualBPMap(manualMap);
    renderManualBpTable();
    
    reapplyManualBPToRawData();
    populateDropdownOptions();
    applyFilters();
  }
};

function reapplyManualBPToRawData() {
  if (rawData.length === 0) return;
  rawData.forEach(item => {
    const bpResult = resolveBPCompany(item.region, item.rawCompany, item.permitNo);
    item.company = bpResult.company;
    item.isManualBP = bpResult.isManual;
  });
}

function setupMultiSelectEvents() {
  const btnToggle = document.getElementById('btnMultiSelectToggle');
  const popover = document.getElementById('multiSelectPopover');
  const btnSelectAll = document.getElementById('btnSelectAllDistricts');
  const btnClear = document.getElementById('btnClearDistricts');

  if (!btnToggle || !popover) return;

  btnToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    const isVisible = popover.style.display === 'flex';
    popover.style.display = isVisible ? 'none' : 'flex';
  });

  document.addEventListener('click', (e) => {
    if (!popover.contains(e.target) && !btnToggle.contains(e.target)) {
      popover.style.display = 'none';
    }
  });

  btnSelectAll.addEventListener('click', () => {
    selectedDistricts = [...ALL_25_DISTRICTS];
    updateDistrictCheckboxesUI();
    updateMultiSelectLabel();
    currentPage = 1;
    applyFilters();
  });

  btnClear.addEventListener('click', () => {
    selectedDistricts = [];
    updateDistrictCheckboxesUI();
    updateMultiSelectLabel();
    currentPage = 1;
    applyFilters();
  });
}

function populateDistrictCheckboxes() {
  const listContainer = document.getElementById('districtCheckboxList');
  if (!listContainer) return;

  const districtsSet = new Set(ALL_25_DISTRICTS);
  rawData.forEach(item => { if (item.region) districtsSet.add(item.region); });

  const sortedDistricts = Array.from(districtsSet).sort();

  listContainer.innerHTML = sortedDistricts.map(d => {
    const isChecked = selectedDistricts.includes(d);
    return `
      <label class="multiselect-item">
        <input type="checkbox" value="${d}" ${isChecked ? 'checked' : ''} onchange="toggleDistrictSelection('${d}')" />
        <span>${d}</span>
      </label>
    `;
  }).join('');
}

window.toggleDistrictSelection = function(districtName) {
  const idx = selectedDistricts.indexOf(districtName);
  if (idx > -1) {
    selectedDistricts.splice(idx, 1);
  } else {
    selectedDistricts.push(districtName);
  }
  updateMultiSelectLabel();
  currentPage = 1;
  applyFilters();
};

function updateDistrictCheckboxesUI() {
  const checkboxes = document.querySelectorAll('#districtCheckboxList input[type="checkbox"]');
  checkboxes.forEach(cb => {
    cb.checked = selectedDistricts.includes(cb.value);
  });
}

function updateMultiSelectLabel() {
  const label = document.getElementById('multiSelectLabel');
  if (!label) return;

  if (selectedDistricts.length === 0) {
    label.textContent = '전체 지자체 (25개구)';
    label.style.color = '#64748b';
  } else if (selectedDistricts.length === ALL_25_DISTRICTS.length) {
    label.textContent = '전체 지자체 선택됨';
    label.style.color = '#2563eb';
  } else if (selectedDistricts.length === 1) {
    label.textContent = `${selectedDistricts[0]} 선택`;
    label.style.color = '#2563eb';
  } else {
    label.textContent = `${selectedDistricts[0]} 외 ${selectedDistricts.length - 1}개구`;
    label.style.color = '#2563eb';
  }
}

window.openVersionModal = function(e) {
  if (e) {
    if (e.stopPropagation) e.stopPropagation();
    if (e.preventDefault) e.preventDefault();
  }
  const modal = document.getElementById('versionModalOverlay');
  if (modal) {
    modal.style.display = 'flex';
    modal.style.zIndex = '99999';
    if (window.lucide && window.lucide.createIcons) {
      try { window.lucide.createIcons(); } catch(err) {}
    }
  }
  return false;
};

window.closeVersionModal = function(e) {
  if (e) {
    if (e.stopPropagation) e.stopPropagation();
    if (e.preventDefault) e.preventDefault();
  }
  const modal = document.getElementById('versionModalOverlay');
  if (modal) {
    modal.style.display = 'none';
  }
  return false;
};

function initVersionModal() {
  const badge = document.getElementById('btnVersionBadge');
  const modal = document.getElementById('versionModalOverlay');
  const btnClose = document.getElementById('btnCloseVersionModal');
  const btnConfirm = document.getElementById('btnConfirmVersionModal');

  if (badge) {
    badge.removeEventListener('click', window.openVersionModal);
    badge.addEventListener('click', window.openVersionModal);
  }

  if (btnClose) {
    btnClose.removeEventListener('click', window.closeVersionModal);
    btnClose.addEventListener('click', window.closeVersionModal);
  }
  if (btnConfirm) {
    btnConfirm.removeEventListener('click', window.closeVersionModal);
    btnConfirm.addEventListener('click', window.closeVersionModal);
  }

  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) window.closeVersionModal(e);
    });
  }
}

/* Yearly Incomplete Statistics Engine */
/* Yearly Incomplete Statistics Engine */
/* Yearly Incomplete Statistics Engine */
const MAJOR_17_BPS = [
  // 수남구축팀 (7개사)
  '㈜부민통신',
  '엘케이테크넷㈜',
  '㈜세하통신',
  '오티씨㈜',
  '㈜컴피아',
  '㈜벨에어테크',
  '㈜유지텔레콤',

  // 수북구축팀 (10개사)
  '에프투텔레콤㈜',
  '㈜이화텔레콤',
  '㈜지앤에스기술',
  '우일정보기술㈜',
  '㈜우호텔레콤',
  '㈜에스포스',
  '㈜제이케이엔티텔레콤',
  '㈜뉴젠스',
  '㈜우주텔레콤',
  '㈜에스피엔이'
];

const BP_EXPLICIT_TEAM_MAP = {
  '㈜부민통신': '수남구축팀',
  '엘케이테크넷㈜': '수남구축팀',
  '㈜세하통신': '수남구축팀',
  '오티씨㈜': '수남구축팀',
  '㈜컴피아': '수남구축팀',
  '㈜벨에어테크': '수남구축팀',
  '벨에어테크': '수남구축팀',
  '㈜유지텔레콤': '수남구축팀',
  '유지텔레콤': '수남구축팀',

  '에프투텔레콤㈜': '수북구축팀',
  '㈜이화텔레콤': '수북구축팀',
  '㈜지앤에스기술': '수북구축팀',
  '우일정보기술㈜': '수북구축팀',
  '㈜우호텔레콤': '수북구축팀',
  '㈜에스포스': '수북구축팀',
  '에스포스': '수북구축팀',
  '㈜제이케이엔티텔레콤': '수북구축팀',
  '㈜뉴젠스': '수북구축팀',
  '㈜우주텔레콤': '수북구축팀',
  '㈜에스피엔이': '수북구축팀'
};

function getBpTeamName(bp, rowData) {
  if (BP_EXPLICIT_TEAM_MAP[bp]) return BP_EXPLICIT_TEAM_MAP[bp];
  const clean = bp.replace(/[㈜\s]/g, '');
  for (const key in BP_EXPLICIT_TEAM_MAP) {
    if (key.replace(/[㈜\s]/g, '') === clean) {
      return BP_EXPLICIT_TEAM_MAP[key];
    }
  }
  if (rowData) {
    if (rowData.sunamCount > rowData.subukCount) return '수남구축팀';
    if (rowData.subukCount > rowData.sunamCount) return '수북구축팀';
  }
  return '수북구축팀';
}

function getContractorCategory(contractorVal) {
  if (!contractorVal) return '미분류';
  const cStr = String(contractorVal).toUpperCase().replace(/\s+/g, '');
  if (cStr.includes('SKTNS') || cStr.includes('SK TNS') || cStr.includes('TNS')) return 'SKTNS';
  if (cStr.includes('PTCE') || cStr.includes('피티씨이')) return 'PTCE';
  return '미분류';
}

function extractRecordYear(item) {
  let targetDate = item.applyDate || item.permitDate;
  if (targetDate) {
    const match = String(targetDate).match(/\d{4}/);
    if (match) {
      const y = parseInt(match[0], 10);
      if (!isNaN(y)) {
        if (y <= 2020) return '2020년 이전';
        return String(y);
      }
    }
  }
  return '2020년 이전';
}

const BP_PRIMARY_TEAM = {
  '㈜부민통신': '수남구축팀',
  '엘케이테크넷㈜': '수남구축팀',
  '㈜세하통신': '수남구축팀',
  '오티씨㈜': '수남구축팀',
  '㈜컴피아': '수남구축팀',
  '㈜벨에어테크': '수남구축팀',
  '㈜유지텔레콤': '수남구축팀',

  '에프투텔레콤㈜': '수북구축팀',
  '㈜이화텔레콤': '수북구축팀',
  '㈜지앤에스기술': '수북구축팀',
  '우일정보기술㈜': '수북구축팀',
  '㈜우호텔레콤': '수북구축팀',
  '㈜에스포스': '수북구축팀',
  '㈜제이케이엔티텔레콤': '수북구축팀',
  '㈜뉴젠스': '수북구축팀',
  '㈜우주텔레콤': '수북구축팀',
  '㈜에스피엔이': '수북구축팀'
};

function getContractorCategory(contractorVal) {
  if (!contractorVal) return '미분류';
  const cStr = String(contractorVal).toUpperCase().replace(/\s+/g, '');
  if (cStr.includes('SKTNS') || cStr.includes('SK TNS') || cStr.includes('TNS')) return 'SKTNS';
  if (cStr.includes('PTCE') || cStr.includes('피티씨이')) return 'PTCE';
  return '미분류';
}

function extractRecordYear(item) {
  let targetDate = item.applyDate || item.permitDate;
  if (targetDate) {
    const match = String(targetDate).match(/\d{4}/);
    if (match) {
      const y = parseInt(match[0], 10);
      if (!isNaN(y)) {
        if (y <= 2020) return '2020년 이전';
        return String(y);
      }
    }
  }
  return '2020년 이전';
}

function computeYearlyIncompleteStats() {
  const incompleteRecords = rawData.filter(item => {
    const { category } = classifyRecord(item);
    if (category === '제외') return false; // 공사취소 제외
    const normStatus = normalizeString(item.rawStatus || '');
    if (normStatus.includes('준공완료') || normStatus.includes('준공승인')) return false; // 준공완료 제외
    return true; // All active/ongoing incomplete items
  });

  const yearsSet = new Set();
  incompleteRecords.forEach(item => {
    const y = extractRecordYear(item);
    yearsSet.add(y);
  });

  const sortedYears = Array.from(yearsSet).sort((a, b) => {
    if (a === '2020년 이전') return -1;
    if (b === '2020년 이전') return 1;
    return parseInt(a, 10) - parseInt(b, 10);
  });

  if (sortedYears.length === 0) sortedYears.push('2020년 이전');

  // District Matrix (Table 1)
  const districtMatrix = {};
  ALL_25_DISTRICTS.forEach(d => {
    districtMatrix[d] = { total: 0 };
    sortedYears.forEach(y => districtMatrix[d][y] = 0);
  });

  const buildTeamMatrix = {
    '수남구축팀': { total: 0 },
    '수북구축팀': { total: 0 }
  };
  sortedYears.forEach(y => {
    buildTeamMatrix['수남구축팀'][y] = 0;
    buildTeamMatrix['수북구축팀'][y] = 0;
  });

  // Contractor Matrix for Tables 2-1, 2-2, 2-3
  // Structure: contractorMatrix[cCat][bTeam][bp][y]
  const contractorCats = ['SKTNS', 'PTCE', '미분류'];
  const buildTeams = ['수남구축팀', '수북구축팀'];
  const contractorMatrix = {};

  contractorCats.forEach(c => {
    contractorMatrix[c] = {};
    buildTeams.forEach(bt => {
      contractorMatrix[c][bt] = {};
      MAJOR_17_BPS.forEach(bp => {
        contractorMatrix[c][bt][bp] = { total: 0 };
        sortedYears.forEach(y => {
          contractorMatrix[c][bt][bp][y] = 0;
        });
      });
    });
  });

  // Populate counts based on permit district build team
  incompleteRecords.forEach(item => {
    const y = extractRecordYear(item);
    const validYear = sortedYears.includes(y) ? y : sortedYears[sortedYears.length - 1];
    const dist = item.region;
    const bTeam = getBuildTeam(dist); // '수남구축팀' or '수북구축팀' based on permit district
    const company = item.company;
    const cCat = getContractorCategory(item.contractor); // 'SKTNS', 'PTCE', or '미분류'

    // Build Team Matrix
    if (buildTeamMatrix[bTeam]) {
      buildTeamMatrix[bTeam][validYear] = (buildTeamMatrix[bTeam][validYear] || 0) + 1;
      buildTeamMatrix[bTeam].total++;
    }

    // District Matrix
    if (districtMatrix[dist]) {
      districtMatrix[dist][validYear] = (districtMatrix[dist][validYear] || 0) + 1;
      districtMatrix[dist].total++;
    }

    // BP Company Matching & Typo Resilience
    let matchedBP = null;
    const companyStr = String(company || '').trim();
    const cleanCompany = companyStr.replace(/[㈜\s]/g, '');

    for (const b of MAJOR_17_BPS) {
      const cleanB = b.replace(/[㈜\s]/g, '');
      if (cleanCompany === cleanB || cleanCompany.includes(cleanB) || cleanB.includes(cleanCompany)) {
        matchedBP = b;
        break;
      }
      if ((b.includes('벨에어') || b.includes('벨어어')) && (cleanCompany.includes('벨에어') || cleanCompany.includes('벨이어') || cleanCompany.includes('벨아이') || cleanCompany.includes('벨어어'))) {
        matchedBP = b;
        break;
      }
      if (b.includes('제이케이엔티') && cleanCompany.includes('제이케이엔티')) {
        matchedBP = b;
        break;
      }
      if (b.includes('에스피엔이') && (cleanCompany.includes('에스피엔이') || cleanCompany.includes('에스피엔'))) {
        matchedBP = b;
        break;
      }
    }

    if (matchedBP) {
      if (!contractorMatrix[cCat][bTeam][matchedBP]) {
        contractorMatrix[cCat][bTeam][matchedBP] = { total: 0 };
        sortedYears.forEach(yr => contractorMatrix[cCat][bTeam][matchedBP][yr] = 0);
      }

      contractorMatrix[cCat][bTeam][matchedBP][validYear] = (contractorMatrix[cCat][bTeam][matchedBP][validYear] || 0) + 1;
      contractorMatrix[cCat][bTeam][matchedBP].total++;
    }
  });

  return {
    years: sortedYears,
    districtMatrix,
    buildTeamMatrix,
    contractorMatrix,
    totalCount: incompleteRecords.length
  };
}

function openStatsModal(e) {
  if (e) {
    if (e.stopPropagation) e.stopPropagation();
    if (e.preventDefault) e.preventDefault();
  }
  const modal = document.getElementById('statsModalOverlay');
  if (modal) {
    modal.style.display = 'flex';
    modal.style.zIndex = '99990';
    renderYearlyStatsModal();
    if (window.lucide && window.lucide.createIcons) {
      try { window.lucide.createIcons(); } catch(err) {}
    }
  }
  return false;
}

function closeStatsModal(e) {
  if (e) {
    if (e.stopPropagation) e.stopPropagation();
    if (e.preventDefault) e.preventDefault();
  }
  const modal = document.getElementById('statsModalOverlay');
  if (modal) {
    modal.style.display = 'none';
  }
  return false;
}

window.openStatsModal = openStatsModal;
window.closeStatsModal = closeStatsModal;

function renderContractorTableHTML(cCat, titleTag, title, accentColor, bgHeader, stats) {
  const { years, contractorMatrix } = stats;
  const matrixData = contractorMatrix[cCat] || {};

  const sunamData = matrixData['수남구축팀'] || {};
  const subukData = matrixData['수북구축팀'] || {};

  // Sunam BP list: only BPs with total > 0 in Sunam
  const sunamBPs = Object.keys(sunamData).filter(bp => sunamData[bp] && sunamData[bp].total > 0);
  sunamBPs.sort((a, b) => {
    const idxA = MAJOR_17_BPS.indexOf(a);
    const idxB = MAJOR_17_BPS.indexOf(b);
    if (idxA !== -1 && idxB !== -1) return idxA - idxB;
    if (idxA !== -1) return -1;
    if (idxB !== -1) return 1;
    return a.localeCompare(b);
  });

  // Subuk BP list: only BPs with total > 0 in Subuk
  const subukBPs = Object.keys(subukData).filter(bp => subukData[bp] && subukData[bp].total > 0);
  subukBPs.sort((a, b) => {
    const idxA = MAJOR_17_BPS.indexOf(a);
    const idxB = MAJOR_17_BPS.indexOf(b);
    if (idxA !== -1 && idxB !== -1) return idxA - idxB;
    if (idxA !== -1) return -1;
    if (idxB !== -1) return 1;
    return a.localeCompare(b);
  });

  // Compute Sunam Subtotals
  const sunamSubtotal = { total: 0 };
  years.forEach(y => sunamSubtotal[y] = 0);
  sunamBPs.forEach(bp => {
    const d = sunamData[bp] || { total: 0 };
    sunamSubtotal.total += (d.total || 0);
    years.forEach(y => sunamSubtotal[y] += (d[y] || 0));
  });

  // Compute Subuk Subtotals
  const subukSubtotal = { total: 0 };
  years.forEach(y => subukSubtotal[y] = 0);
  subukBPs.forEach(bp => {
    const d = subukData[bp] || { total: 0 };
    subukSubtotal.total += (d.total || 0);
    years.forEach(y => subukSubtotal[y] += (d[y] || 0));
  });

  const grandTotal = sunamSubtotal.total + subukSubtotal.total;

  return `
    <div class="stats-card-box">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
        <h4 style="font-size: 0.95rem; font-weight: 800; color: #0f172a; display: flex; align-items: center; gap: 6px;">
          <i data-lucide="building-2" style="color: ${accentColor}; width: 16px; height: 16px;"></i>
          [${titleTag}] ${title} 미완료(진행중) 현황
        </h4>
        <span style="font-size: 0.74rem; color: #64748b; font-weight: 600;">※ 인허가 지자체(구청) 권역 기준 구축팀 구분</span>
      </div>

      <div style="overflow-x: auto;">
        <table class="stats-matrix-table">
          <thead>
            <tr>
              <th style="width: 45px;">No</th>
              <th style="width: 110px;">인허가 구축팀</th>
              <th style="width: 160px;">BP사명</th>
              ${years.map(y => `<th>${y === '2020년 이전' ? '2020년 이전' : y + '년'}</th>`).join('')}
              <th style="background: ${bgHeader}; color: ${accentColor};">미완료 합계</th>
            </tr>
          </thead>
          <tbody>
            <!-- 수남구축팀 관할 BP사 Header & Rows -->
            <tr class="group-header-row">
              <td colspan="${years.length + 4}" style="background: #eff6ff; color: #1d4ed8;">
                <span class="badge-sunam">수남구축팀</span> 관할 지자체 인허가 BP사 (${sunamBPs.length}개사)
              </td>
            </tr>
            ${sunamBPs.length === 0 ? `
              <tr>
                <td colspan="${years.length + 4}" style="text-align: center; color: #94a3b8; padding: 10px; font-size: 0.82rem;">
                  미완료(진행중) 건이 있는 BP사가 없습니다.
                </td>
              </tr>
            ` : sunamBPs.map((bp, idx) => {
              const rowData = sunamData[bp] || { total: 0 };
              return `
                <tr>
                  <td style="text-align: center; color: #64748b;">${idx + 1}</td>
                  <td style="text-align: center;"><span class="badge-sunam">수남구축팀</span></td>
                  <td style="text-align: left; font-weight: 700; color: #0f172a; padding-left: 10px;">${bp}</td>
                  ${years.map(y => {
                    const val = rowData[y] || 0;
                    return `<td class="${val > 0 ? 'stats-val-active' : 'stats-val-zero'}">${val.toLocaleString()}</td>`;
                  }).join('')}
                  <td style="font-weight: 800; background: #eff6ff; color: #1e40af;">${(rowData.total || 0).toLocaleString()}</td>
                </tr>
              `;
            }).join('')}
            <!-- 수남 소계 -->
            <tr class="subtotal-row" style="background: #eff6ff;">
              <td colspan="3" style="text-align: center; font-weight: 800; color: #1d4ed8;">수남구축팀 ${cCat} 소계</td>
              ${years.map(y => `<td style="font-weight: 800; color: #1d4ed8;">${(sunamSubtotal[y] || 0).toLocaleString()}</td>`).join('')}
              <td style="font-weight: 900; color: #1d4ed8; background: #dbeafe;">${sunamSubtotal.total.toLocaleString()}</td>
            </tr>

            <!-- 수북구축팀 관할 BP사 Header & Rows -->
            <tr class="group-header-row">
              <td colspan="${years.length + 4}" style="background: #faf5ff; color: #7e22ce;">
                <span class="badge-subuk">수북구축팀</span> 관할 지자체 인허가 BP사 (${subukBPs.length}개사)
              </td>
            </tr>
            ${subukBPs.length === 0 ? `
              <tr>
                <td colspan="${years.length + 4}" style="text-align: center; color: #94a3b8; padding: 10px; font-size: 0.82rem;">
                  미완료(진행중) 건이 있는 BP사가 없습니다.
                </td>
              </tr>
            ` : subukBPs.map((bp, idx) => {
              const rowData = subukData[bp] || { total: 0 };
              return `
                <tr>
                  <td style="text-align: center; color: #64748b;">${sunamBPs.length + idx + 1}</td>
                  <td style="text-align: center;"><span class="badge-subuk">수북구축팀</span></td>
                  <td style="text-align: left; font-weight: 700; color: #0f172a; padding-left: 10px;">${bp}</td>
                  ${years.map(y => {
                    const val = rowData[y] || 0;
                    return `<td class="${val > 0 ? 'stats-val-active' : 'stats-val-zero'}">${val.toLocaleString()}</td>`;
                  }).join('')}
                  <td style="font-weight: 800; background: #faf5ff; color: #6b21a8;">${(rowData.total || 0).toLocaleString()}</td>
                </tr>
              `;
            }).join('')}
            <!-- 수북 소계 -->
            <tr class="subtotal-row" style="background: #faf5ff;">
              <td colspan="3" style="text-align: center; font-weight: 800; color: #7e22ce;">수북구축팀 ${cCat} 소계</td>
              ${years.map(y => `<td style="font-weight: 800; color: #7e22ce;">${(subukSubtotal[y] || 0).toLocaleString()}</td>`).join('')}
              <td style="font-weight: 900; color: #7e22ce; background: #f3e8ff;">${subukSubtotal.total.toLocaleString()}</td>
            </tr>

            <!-- Grand Total Row -->
            <tr class="grandtotal-row" style="background: #f8fafc;">
              <td colspan="3" style="text-align: center; font-weight: 900;">${cCat} 도급 전체 총합</td>
              ${years.map(y => {
                const yearTotal = (sunamSubtotal[y] || 0) + (subukSubtotal[y] || 0);
                return `<td style="font-weight: 900;">${yearTotal.toLocaleString()}</td>`;
              }).join('')}
              <td style="font-weight: 900; background: #e2e8f0; color: #0f172a;">${grandTotal.toLocaleString()}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderYearlyStatsModal() {
  const content = document.getElementById('statsModalBodyContent');
  if (!content) return;

  const stats = computeYearlyIncompleteStats();
  const { years, districtMatrix, totalCount } = stats;

  const sunamDistricts = SUNAM_DISTRICTS.filter(d => ALL_25_DISTRICTS.includes(d));
  const subukDistricts = ALL_25_DISTRICTS.filter(d => !SUNAM_DISTRICTS.includes(d));

  // Compute District Subtotals
  const sunamSubtotals = { total: 0 };
  const subukSubtotals = { total: 0 };
  years.forEach(y => {
    sunamSubtotals[y] = 0;
    subukSubtotals[y] = 0;
    sunamDistricts.forEach(d => { sunamSubtotals[y] += (districtMatrix[d][y] || 0); });
    subukDistricts.forEach(d => { subukSubtotals[y] += (districtMatrix[d][y] || 0); });
    sunamSubtotals.total += sunamSubtotals[y];
    subukSubtotals.total += subukSubtotals[y];
  });

  let html = `
    <!-- Top KPI Cards -->
    <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px;">
      <div class="stats-card-box" style="border-left: 4px solid #2563eb; background: #eff6ff;">
        <div style="font-size: 0.78rem; font-weight: 700; color: #1d4ed8; display: flex; align-items: center; gap: 6px;">
          <span class="badge-sunam">수남구축팀</span>
          <span>11개 자치구 미완료 총계</span>
        </div>
        <div style="font-size: 1.5rem; font-weight: 900; color: #1e40af; margin-top: 4px;">
          ${sunamSubtotals.total.toLocaleString()}<span style="font-size: 0.9rem; font-weight: 700; margin-left: 2px;">건</span>
        </div>
      </div>

      <div class="stats-card-box" style="border-left: 4px solid #7c3aed; background: #faf5ff;">
        <div style="font-size: 0.78rem; font-weight: 700; color: #7e22ce; display: flex; align-items: center; gap: 6px;">
          <span class="badge-subuk">수북구축팀</span>
          <span>14개 자치구 미완료 총계</span>
        </div>
        <div style="font-size: 1.5rem; font-weight: 900; color: #6b21a8; margin-top: 4px;">
          ${subukSubtotals.total.toLocaleString()}<span style="font-size: 0.9rem; font-weight: 700; margin-left: 2px;">건</span>
        </div>
      </div>

      <div class="stats-card-box" style="border-left: 4px solid #059669; background: #f0fdf4;">
        <div style="font-size: 0.78rem; font-weight: 700; color: #047857; display: flex; align-items: center; gap: 6px;">
          <i data-lucide="pie-chart" style="width: 14px; height: 14px; color: #059669;"></i>
          <span>전체 25개 자치구 미완료 총계</span>
        </div>
        <div style="font-size: 1.5rem; font-weight: 900; color: #065f46; margin-top: 4px;">
          ${totalCount.toLocaleString()}<span style="font-size: 0.9rem; font-weight: 700; margin-left: 2px;">건</span>
        </div>
      </div>
    </div>

    <!-- Table 1: 연도별 구축팀 & 25개 자치구 미완료 현황 -->
    <div class="stats-card-box">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
        <h4 style="font-size: 0.95rem; font-weight: 800; color: #0f172a; display: flex; align-items: center; gap: 6px;">
          <i data-lucide="map-pin" style="color: #2563eb; width: 16px; height: 16px;"></i>
          [표 1] 연도별 25개 자치구 미완료(진행중) 현황 (구축팀 구분)
        </h4>
        <span style="font-size: 0.74rem; color: #64748b; font-weight: 600;">※ 준공완료 및 취소건 제외한 진행중 건수</span>
      </div>

      <div style="overflow-x: auto;">
        <table class="stats-matrix-table">
          <thead>
            <tr>
              <th style="width: 110px;">구축팀</th>
              <th style="width: 110px;">자치구</th>
              ${years.map(y => `<th>${y === '2020년 이전' ? '2020년 이전' : y + '년'}</th>`).join('')}
              <th style="background: #e0f2fe; color: #0369a1;">미완료 합계</th>
            </tr>
          </thead>
          <tbody>
            <!-- 수남구축팀 Header & Rows -->
            <tr class="group-header-row">
              <td colspan="${years.length + 3}" style="background: #eff6ff; color: #1d4ed8;">
                <span class="badge-sunam">수남구축팀</span> (11개 관할 자치구)
              </td>
            </tr>
            ${sunamDistricts.map((d, idx) => `
              <tr>
                ${idx === 0 ? `<td rowspan="${sunamDistricts.length}" style="text-align: center; vertical-align: middle; background: #ffffff; font-weight: 700; color: #1d4ed8;">수남구축팀</td>` : ''}
                <td style="text-align: center; font-weight: 700; background: #ffffff;">${d}</td>
                ${years.map(y => {
                  const val = districtMatrix[d][y] || 0;
                  return `<td class="${val > 0 ? 'stats-val-active' : 'stats-val-zero'}">${val.toLocaleString()}</td>`;
                }).join('')}
                <td style="font-weight: 800; background: #f0fdf4; color: #047857;">${(districtMatrix[d].total || 0).toLocaleString()}</td>
              </tr>
            `).join('')}
            <!-- 수남 소계 -->
            <tr class="subtotal-row" style="background: #eff6ff;">
              <td colspan="2" style="text-align: center; font-weight: 800; color: #1d4ed8;">수남구축팀 소계</td>
              ${years.map(y => `<td style="font-weight: 800; color: #1d4ed8;">${(sunamSubtotals[y] || 0).toLocaleString()}</td>`).join('')}
              <td style="font-weight: 900; color: #1d4ed8; background: #dbeafe;">${sunamSubtotals.total.toLocaleString()}</td>
            </tr>

            <!-- 수북구축팀 Header & Rows -->
            <tr class="group-header-row">
              <td colspan="${years.length + 3}" style="background: #faf5ff; color: #7e22ce;">
                <span class="badge-subuk">수북구축팀</span> (14개 관할 자치구)
              </td>
            </tr>
            ${subukDistricts.map((d, idx) => `
              <tr>
                ${idx === 0 ? `<td rowspan="${subukDistricts.length}" style="text-align: center; vertical-align: middle; background: #ffffff; font-weight: 700; color: #7e22ce;">수북구축팀</td>` : ''}
                <td style="text-align: center; font-weight: 700; background: #ffffff;">${d}</td>
                ${years.map(y => {
                  const val = districtMatrix[d][y] || 0;
                  return `<td class="${val > 0 ? 'stats-val-active' : 'stats-val-zero'}">${val.toLocaleString()}</td>`;
                }).join('')}
                <td style="font-weight: 800; background: #f0fdf4; color: #047857;">${(districtMatrix[d].total || 0).toLocaleString()}</td>
              </tr>
            `).join('')}
            <!-- 수북 소계 -->
            <tr class="subtotal-row" style="background: #faf5ff;">
              <td colspan="2" style="text-align: center; font-weight: 800; color: #7e22ce;">수북구축팀 소계</td>
              ${years.map(y => `<td style="font-weight: 800; color: #7e22ce;">${(subukSubtotals[y] || 0).toLocaleString()}</td>`).join('')}
              <td style="font-weight: 900; color: #7e22ce; background: #f3e8ff;">${subukSubtotals.total.toLocaleString()}</td>
            </tr>

            <!-- Grand Total Row -->
            <tr class="grandtotal-row">
              <td colspan="2" style="text-align: center; font-weight: 900;">전체 자치구 총합</td>
              ${years.map(y => {
                const yearTotal = (sunamSubtotals[y] || 0) + (subukSubtotals[y] || 0);
                return `<td style="font-weight: 900;">${yearTotal.toLocaleString()}</td>`;
              }).join('')}
              <td style="font-weight: 900; background: #bfdbfe; color: #1e40af;">${totalCount.toLocaleString()}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  `;

  // Render Table 2-1 (SKTNS), Table 2-2 (PTCE), Table 2-3 (미분류)
  html += renderContractorTableHTML('SKTNS', '표 2-1', 'SKTNS 도급 연도별/BP사별', '#2563eb', '#dbeafe', stats);
  html += renderContractorTableHTML('PTCE', '표 2-2', 'PTCE 도급 연도별/BP사별', '#059669', '#d1fae5', stats);
  html += renderContractorTableHTML('미분류', '표 2-3', '미분류 도급 연도별/BP사별', '#64748b', '#e2e8f0', stats);

  content.innerHTML = html;
}

function exportYearlyStatsToExcel() {
  const stats = computeYearlyIncompleteStats();
  const { years, districtMatrix, contractorMatrix } = stats;

  const timestampStr = getFileTimestampString();

  // Sheet 1: District Matrix (25개 자치구)
  const sunamDistricts = SUNAM_DISTRICTS.filter(d => ALL_25_DISTRICTS.includes(d));
  const subukDistricts = ALL_25_DISTRICTS.filter(d => !SUNAM_DISTRICTS.includes(d));

  const districtRows = [];
  
  sunamDistricts.forEach(d => {
    const rowObj = { '구축팀': '수남구축팀', '자치구': d };
    years.forEach(y => {
      const headerKey = y === '2020년 이전' ? '2020년 이전' : `${y}년`;
      rowObj[headerKey] = districtMatrix[d][y] || 0;
    });
    rowObj['미완료 합계'] = districtMatrix[d].total || 0;
    districtRows.push(rowObj);
  });

  subukDistricts.forEach(d => {
    const rowObj = { '구축팀': '수북구축팀', '자치구': d };
    years.forEach(y => {
      const headerKey = y === '2020년 이전' ? '2020년 이전' : `${y}년`;
      rowObj[headerKey] = districtMatrix[d][y] || 0;
    });
    rowObj['미완료 합계'] = districtMatrix[d].total || 0;
    districtRows.push(rowObj);
  });

  const workbook = XLSX.utils.book_new();

  // Add Sheet 1
  const ws1 = XLSX.utils.json_to_sheet(districtRows);
  XLSX.utils.book_append_sheet(workbook, ws1, '구축팀_자치구_미완료_통계');

  // Add Sheet 2, 3, 4 for SKTNS, PTCE, 미분류
  const contractorCats = [
    { cat: 'SKTNS', sheetName: 'SKTNS_도급_BP사_통계' },
    { cat: 'PTCE', sheetName: 'PTCE_도급_BP사_통계' },
    { cat: '미분류', sheetName: '미분류_도급_BP사_통계' }
  ];

  contractorCats.forEach(({ cat, sheetName }) => {
    const matrixData = contractorMatrix[cat] || {};
    const sunamData = matrixData['수남구축팀'] || {};
    const subukData = matrixData['수북구축팀'] || {};

    const sunamBPs = Object.keys(sunamData).filter(bp => sunamData[bp] && sunamData[bp].total > 0);
    sunamBPs.sort((a, b) => {
      const idxA = MAJOR_17_BPS.indexOf(a);
      const idxB = MAJOR_17_BPS.indexOf(b);
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;
      return a.localeCompare(b);
    });

    const subukBPs = Object.keys(subukData).filter(bp => subukData[bp] && subukData[bp].total > 0);
    subukBPs.sort((a, b) => {
      const idxA = MAJOR_17_BPS.indexOf(a);
      const idxB = MAJOR_17_BPS.indexOf(b);
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;
      return a.localeCompare(b);
    });

    const rows = [];
    let counter = 1;

    sunamBPs.forEach(bp => {
      const d = sunamData[bp] || { total: 0 };
      const rowObj = {
        'No': counter++,
        '인허가 구축팀': '수남구축팀',
        'BP사명': bp
      };
      years.forEach(y => {
        const headerKey = y === '2020년 이전' ? '2020년 이전' : `${y}년`;
        rowObj[headerKey] = d[y] || 0;
      });
      rowObj['미완료 합계'] = d.total || 0;
      rows.push(rowObj);
    });

    subukBPs.forEach(bp => {
      const d = subukData[bp] || { total: 0 };
      const rowObj = {
        'No': counter++,
        '인허가 구축팀': '수북구축팀',
        'BP사명': bp
      };
      years.forEach(y => {
        const headerKey = y === '2020년 이전' ? '2020년 이전' : `${y}년`;
        rowObj[headerKey] = d[y] || 0;
      });
      rowObj['미완료 합계'] = d.total || 0;
      rows.push(rowObj);
    });

    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(workbook, ws, sheetName);
  });

  XLSX.writeFile(workbook, `SEMS_연도별_미완료_통계_리포트_${timestampStr}.xlsx`);
}

function initEventListeners() {
  initVersionModal();

  const btnStats1 = document.getElementById('btnOpenStatsModal');
  if (btnStats1) btnStats1.addEventListener('click', openStatsModal);

  const btnStats2 = document.getElementById('btnOpenStatsModalSub');
  if (btnStats2) btnStats2.addEventListener('click', openStatsModal);

  const btnCloseStats = document.getElementById('btnCloseStatsModal');
  if (btnCloseStats) btnCloseStats.addEventListener('click', closeStatsModal);

  const modalOverlay = document.getElementById('statsModalOverlay');
  if (modalOverlay) {
    modalOverlay.addEventListener('click', (e) => {
      if (e.target === modalOverlay) closeStatsModal();
    });
  }

  const btnExportStats = document.getElementById('btnExportStatsExcel');
  if (btnExportStats) btnExportStats.addEventListener('click', exportYearlyStatsToExcel);

  const btnRefreshData = document.getElementById('btnRefreshData');
  if (btnRefreshData) {
    btnRefreshData.addEventListener('click', fetchDashboardData);
  }

  document.getElementById('selectOrgCategory').addEventListener('change', () => {
    populateDropdownOptions();
    currentPage = 1;
    applyFilters();
  });
  document.getElementById('selectOrgValue').addEventListener('change', () => { currentPage = 1; applyFilters(); });
  
  document.getElementById('selectDateCategory').addEventListener('change', () => {
    updateDefaultDateRange();
    currentPage = 1;
    applyFilters();
  });

  document.getElementById('inputStartDate').addEventListener('change', () => { clearActivePresets(); currentPage = 1; applyFilters(); });
  document.getElementById('inputEndDate').addEventListener('change', () => { clearActivePresets(); currentPage = 1; applyFilters(); });
  document.getElementById('selectSearchCategory').addEventListener('change', () => { currentPage = 1; applyFilters(); });
  document.getElementById('inputSearchKeyword').addEventListener('input', () => { currentPage = 1; applyFilters(); });

  const presetBtns = document.querySelectorAll('.preset-btn');
  presetBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      const type = e.target.getAttribute('data-preset');
      applyQuickPreset(type);
    });
  });

  document.getElementById('btnResetFilter').addEventListener('click', resetFilters);
  document.getElementById('btnExportExcel').addEventListener('click', exportFilteredToExcel);
}

function clearActivePresets() {
  document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
}

function updateDefaultDateRange() {
  clearActivePresets();
  if (rawData.length === 0) {
    document.getElementById('inputStartDate').value = '';
    document.getElementById('inputEndDate').value = '';
    return;
  }

  const dateCategory = document.getElementById('selectDateCategory').value;
  const validDates = [];

  rawData.forEach(item => {
    let rawDateVal = (dateCategory === '허가승인일') ? item.permitDate : item.applyDate;
    const formatted = formatExcelDate(rawDateVal);
    if (formatted && /^\d{4}-\d{2}-\d{2}$/.test(formatted)) {
      validDates.push(formatted);
    }
  });

  if (validDates.length > 0) {
    validDates.sort();
    const minDate = validDates[0];
    const maxDate = validDates[validDates.length - 1];

    document.getElementById('inputStartDate').value = minDate;
    document.getElementById('inputEndDate').value = maxDate;
  } else {
    document.getElementById('inputStartDate').value = '';
    document.getElementById('inputEndDate').value = '';
  }
}

function applyQuickPreset(presetType) {
  clearActivePresets();
  
  const activeBtn = document.querySelector(`.preset-btn[data-preset="${presetType}"]`);
  if (activeBtn) activeBtn.classList.add('active');

  let endDateStr = document.getElementById('inputEndDate').value;
  if (!endDateStr) {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    endDateStr = `${yyyy}-${mm}-${dd}`;
    document.getElementById('inputEndDate').value = endDateStr;
  }

  const endD = new Date(endDateStr);
  let startD = new Date(endD);

  if (presetType === 'YEAR') {
    const yyyy = endD.getFullYear();
    startD = new Date(`${yyyy}-01-01`);
  } else if (presetType === '12M') {
    startD.setMonth(startD.getMonth() - 12);
  } else if (presetType === '6M') {
    startD.setMonth(startD.getMonth() - 6);
  } else if (presetType === '3M') {
    startD.setMonth(startD.getMonth() - 3);
  } else if (presetType === '1M') {
    startD.setMonth(startD.getMonth() - 1);
  }

  const sYear = startD.getFullYear();
  const sMonth = String(startD.getMonth() + 1).padStart(2, '0');
  const sDay = String(startD.getDate()).padStart(2, '0');
  const startDateStr = `${sYear}-${sMonth}-${sDay}`;

  document.getElementById('inputStartDate').value = startDateStr;

  currentPage = 1;
  applyFilters();
}

function populateDropdownOptions() {
  const orgCategory = document.getElementById('selectOrgCategory').value;
  const selectOrgValue = document.getElementById('selectOrgValue');
  const orgMultiWrapper = document.getElementById('orgMultiSelectWrapper');
  
  if (orgCategory === '지자체') {
    selectOrgValue.style.display = 'none';
    orgMultiWrapper.style.display = 'flex';
    populateDistrictCheckboxes();
    updateMultiSelectLabel();
  } else {
    selectOrgValue.style.display = 'block';
    orgMultiWrapper.style.display = 'none';

    const currentSelection = selectOrgValue.value;
    selectOrgValue.innerHTML = '<option value="ALL">전체 항목</option>';

    const valuesSet = new Set();

    if (orgCategory === 'BP사') {
      BP_DISTRICT_MAP.forEach(pair => valuesSet.add(pair.bp));
      rawData.forEach(item => { if (item.company) valuesSet.add(item.company); });
      const manualMap = getManualBPMap();
      Object.values(manualMap).forEach(info => {
        const cName = typeof info === 'object' ? info.company : info;
        if (cName) valuesSet.add(cName);
      });
    } else if (orgCategory === '구축팀') {
      valuesSet.add('수남구축팀');
      valuesSet.add('수북구축팀');
    } else if (orgCategory === '도급사') {
      valuesSet.add('미분류'); // Renamed '미구분' to '미분류' for contractor filter!
      rawData.forEach(item => { if (item.contractor && item.contractor !== '-') valuesSet.add(item.contractor); });
      const contractorMap = getContractorMap();
      Object.values(contractorMap).forEach(cInfo => {
        if (cInfo.contractor) valuesSet.add(cInfo.contractor);
      });
    }

    Array.from(valuesSet).sort().forEach(val => {
      const opt = document.createElement('option');
      opt.value = val;
      opt.textContent = val;
      selectOrgValue.appendChild(opt);
    });

    if (Array.from(valuesSet).includes(currentSelection)) {
      selectOrgValue.value = currentSelection;
    } else {
      selectOrgValue.value = 'ALL';
    }
  }
}

function resetFilters() {
  document.getElementById('selectOrgCategory').value = 'BP사';
  selectedDistricts = [];
  populateDropdownOptions();
  document.getElementById('selectOrgValue').value = 'ALL';
  
  document.getElementById('selectDateCategory').value = '신청접수일';
  updateDefaultDateRange();
  
  document.getElementById('selectSearchCategory').value = '공사명';
  document.getElementById('inputSearchKeyword').value = '';

  activeCardFilter = null;
  currentPage = 1;
  applyFilters();
}

function applyFilters() {
  const orgCategory = document.getElementById('selectOrgCategory').value;
  const orgValue = document.getElementById('selectOrgValue').value;
  
  const dateCategory = document.getElementById('selectDateCategory').value;
  const startDate = document.getElementById('inputStartDate').value;
  const endDate = document.getElementById('inputEndDate').value;
  
  const searchKeyword = document.getElementById('inputSearchKeyword').value.trim();

  const cleanKeyword = cleanForSearch(searchKeyword);
  const rawKeyword = searchKeyword.toLowerCase();

  const baseFilteredData = rawData.filter(item => {
    if (orgCategory === '지자체') {
      if (selectedDistricts.length > 0 && !selectedDistricts.includes(item.region)) return false;
    } else if (orgValue !== 'ALL') {
      if (orgCategory === 'BP사' && item.company !== orgValue) return false;
      if (orgCategory === '구축팀' && getBuildTeam(item.region) !== orgValue) return false;
      if (orgCategory === '도급사') {
        if (orgValue === '미분류' || orgValue === '미구분') {
          // Filter out items that have no contractor or specified as '-' / empty
          if (item.contractor && item.contractor !== '-' && item.contractor.trim() !== '' && item.contractor !== '미분류' && item.contractor !== '미구분') {
            return false;
          }
        } else if (item.contractor !== orgValue) {
          return false;
        }
      }
    }

    if (!searchKeyword && (startDate || endDate)) {
      let rawTargetDate = (dateCategory === '허가승인일') ? item.permitDate : item.applyDate;
      const targetDate = formatExcelDate(rawTargetDate);
      if (targetDate && /^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
        if (startDate && targetDate < startDate) return false;
        if (endDate && targetDate > endDate) return false;
      }
    }

    if (searchKeyword) {
      const pNo = item.permitNo || '';
      const pTitle = item.title || '';
      const pRegion = item.region || '';
      const pCompany = item.company || '';
      const pContractor = item.contractor || '';
      const pRemark = item.remark || '';
      const pStatus = item.rawStatus || '';
      const pRawRow = item.rawRowText || '';

      const combinedRaw = `${pNo} ${pTitle} ${pRegion} ${pCompany} ${pContractor} ${pRemark} ${pStatus} ${pRawRow}`.toLowerCase();
      const combinedClean = cleanForSearch(combinedRaw);

      const isMatch = combinedRaw.includes(rawKeyword) || combinedClean.includes(cleanKeyword);
      if (!isMatch) return false;
    }

    return true;
  });

  const hasRawData = rawData.length > 0;
  const isFilterActive = (orgCategory === '지자체' && selectedDistricts.length > 0) || (orgCategory !== '지자체' && orgValue !== 'ALL') || searchKeyword || startDate || endDate;

  let validPermitSet = null;
  let validCleanPermitSet = null;
  if (hasRawData && isFilterActive) {
    validPermitSet = new Set(baseFilteredData.map(item => String(item.permitNo || '').trim()));
    validCleanPermitSet = new Set(baseFilteredData.map(item => cleanForSearch(item.permitNo)));
  }

  if (activeCardFilter) {
    if (activeCardFilter.category === '납부관리') {
      const targetSub = String(activeCardFilter.sub || '').trim();
      
      if (targetSub === '환수대상' || targetSub === '사후납대상') {
        filteredRefundPostpayData = refundPostpayData.filter(r => {
          if (String(r.type || '').trim() !== targetSub) return false;
          
          const rRegion = r.region || (r.permitNo && r.permitNo.includes('-') ? r.permitNo.split('-')[0] : '');
          if (orgCategory === '지자체') {
            if (selectedDistricts.length > 0 && !selectedDistricts.includes(rRegion)) return false;
          } else if (orgValue !== 'ALL') {
            if (orgCategory === 'BP사' && r.company && r.company !== orgValue) return false;
            if (orgCategory === '구축팀' && getBuildTeam(rRegion) !== orgValue) return false;
          }

          if (searchKeyword) {
            const cleanP = cleanForSearch(r.permitNo);
            const rawP = String(r.permitNo || '').toLowerCase();
            const rawEntity = String(r.restoreEntity || '').toLowerCase();
            const isMatch = rawP.includes(rawKeyword) || cleanP.includes(cleanKeyword) || rawEntity.includes(rawKeyword);
            if (!isMatch) return false;
          }

          if (validPermitSet) {
            const cleanP = cleanForSearch(r.permitNo);
            return validPermitSet.has(r.permitNo) || validCleanPermitSet.has(cleanP) || (rRegion && selectedDistricts.length === 0);
          }
          return true;
        });
        filteredPaymentData = [];
        filteredData = [];
      } else if (targetSub === '고지서발행' || targetSub === '납부완료') {
        filteredPaymentData = paymentData.filter(p => {
          if (targetSub === '고지서발행' && p.status === '완납') return false;
          if (targetSub === '납부완료' && p.status !== '완납') return false;
          if (validPermitSet) {
            const cleanP = cleanForSearch(p.permitNo);
            return validPermitSet.has(p.permitNo) || validCleanPermitSet.has(cleanP);
          }
          return true;
        });
        filteredRefundPostpayData = [];
        filteredData = [];
      } else {
        filteredPaymentData = [];
        filteredRefundPostpayData = [];
        filteredData = baseFilteredData;
      }
    } else {
      filteredPaymentData = [];
      filteredRefundPostpayData = [];
      filteredData = baseFilteredData.filter(item => {
        const { category, sub } = classifyRecord(item);
        return category === activeCardFilter.category && sub === activeCardFilter.sub;
      });
    }
  } else {
    filteredPaymentData = [];
    filteredRefundPostpayData = [];
    filteredData = baseFilteredData;
  }

  updateActiveFilterBadge(orgValue, startDate, endDate, searchKeyword, baseFilteredData.length);
  updateDashboardUI(baseFilteredData, validPermitSet, validCleanPermitSet);
}

function updateActiveFilterBadge(orgValue, startDate, endDate, searchKeyword, baseCount) {
  const badge = document.getElementById('activeFilterBadge');
  const orgCategory = document.getElementById('selectOrgCategory').value;
  
  if (rawData.length === 0 && paymentData.length === 0 && refundPostpayData.length === 0) {
    badge.textContent = '엑셀 데이터 업로드 대기중';
    badge.style.background = '#fef2f2';
    badge.style.color = '#dc2626';
    badge.style.borderColor = '#fecaca';
    return;
  }

  const isMultiDistrictFiltered = orgCategory === '지자체' && selectedDistricts.length > 0;
  const isFiltered = (orgCategory !== '지자체' && orgValue !== 'ALL') || isMultiDistrictFiltered || searchKeyword || activeCardFilter;
  
  if (isFiltered) {
    let filterText = `필터 적용 중 (테이블 ${filteredData.length}건 표시)`;
    if (activeCardFilter) {
      if (activeCardFilter.category === '납부관리') {
        if (activeCardFilter.sub === '환수대상' || activeCardFilter.sub === '사후납대상') {
          filterText = `[납부관리 > ${activeCardFilter.sub}] 정산 내역 (${filteredRefundPostpayData.length}건 표시)`;
        } else {
          filterText = `[납부관리 > ${activeCardFilter.sub}] 고지 내역 (${filteredPaymentData.length}건 표시)`;
        }
      } else {
        filterText = `[${activeCardFilter.sub}] 상태 선택 중 (목록 ${filteredData.length}건 표시 / 전체 ${baseCount}건 유지)`;
      }
    } else if (isMultiDistrictFiltered) {
      filterText = `지자체 ${selectedDistricts.length}개구 선택 중 (필터 연동 ${filteredData.length}건)`;
    } else if (searchKeyword) {
      filterText = `키워드 '${searchKeyword}' 검색 중 (필터 연동 ${filteredData.length}건)`;
    }
    badge.textContent = filterText;
    badge.style.background = '#fffbeb';
    badge.style.color = '#d97706';
    badge.style.borderColor = '#fde68a';
  } else {
    const cancelledCount = rawData.filter(i => classifyRecord(i).category === '제외').length;
    const validCount = rawData.length - cancelledCount;
    badge.textContent = `전체 데이터 조회중 (${rawData.length}건 / 카운트 집계: ${validCount}건, 취소: ${cancelledCount}건)`;
    badge.style.background = '#eff6ff';
    badge.style.color = '#2563eb';
    badge.style.borderColor = '#bfdbfe';
  }
}

function updateDashboardUI(baseDataset = rawData, validPermitSet = null, validCleanPermitSet = null) {
  const counts = {
    permit: { total: 0, ongoing: 0, change: 0, reject: 0 },
    payment: { total: 0, notice: 0, paid: 0, refundTarget: 0, postPayTarget: 0 },
    const: { total: 0, issue: 0, submit: 0, restoreDone: 0 },
    comp: { total: 0, writing: 0, received: 0, done: 0 }
  };

  baseDataset.forEach(item => {
    const { category, sub } = classifyRecord(item);
    
    if (category === '제외') return;

    if (category === '허가관리') {
      counts.permit.total++;
      if (sub === '진행중') counts.permit.ongoing++;
      if (sub === '허가변경') counts.permit.change++;
      if (sub === '불가(보완요청)') counts.permit.reject++;
    } else if (category === '착공 및 복구공사') {
      counts.const.total++;
      if (sub === '허가증교부') counts.const.issue++;
      if (sub === '착공계제출') counts.const.submit++;
      if (sub === '복구공사완료') counts.const.restoreDone++;
    } else if (category === '준공관리') {
      counts.comp.total++;
      if (sub === '준공계작성중') counts.comp.writing++;
      if (sub === '준공계접수') counts.comp.received++;
      if (sub === '준공완료') counts.comp.done++;
    }
  });

  let activePaymentList = paymentData;
  if (validPermitSet) {
    activePaymentList = paymentData.filter(p => {
      const cleanP = cleanForSearch(p.permitNo);
      return validPermitSet.has(p.permitNo) || validCleanPermitSet.has(cleanP);
    });
  }

  const paidCount = activePaymentList.filter(p => p.status === '완납' || String(p.status).includes('완납')).length;
  const totalNoticeRows = activePaymentList.length;
  const netNoticeCount = Math.max(0, totalNoticeRows - paidCount);

  let activeRefundList = refundPostpayData;
  if (validPermitSet) {
    activeRefundList = refundPostpayData.filter(r => {
      const cleanP = cleanForSearch(r.permitNo);
      return validPermitSet.has(r.permitNo) || validCleanPermitSet.has(cleanP);
    });
  }

  const refundCount = activeRefundList.filter(r => String(r.type).trim() === '환수대상').length;
  const postpayCount = activeRefundList.filter(r => String(r.type).trim() === '사후납대상').length;

  counts.payment.total = totalNoticeRows;
  counts.payment.paid = paidCount;
  counts.payment.notice = netNoticeCount;
  counts.payment.refundTarget = refundCount;
  counts.payment.postPayTarget = postpayCount;

  updateSummaryCard('Permit', counts.permit, [
    ['cntPermitOngoing', 'colPermitOngoing', counts.permit.ongoing, '허가관리', '진행중'],
    ['cntPermitChange', 'colPermitChange', counts.permit.change, '허가관리', '허가변경'],
    ['cntPermitReject', 'colPermitReject', counts.permit.reject, '허가관리', '불가(보완요청)']
  ]);

  updateSummaryCard('Payment', counts.payment, [
    ['cntPaymentNotice', 'colPaymentNotice', counts.payment.notice, '납부관리', '고지서발행'],
    ['cntPaymentPaid', 'colPaymentPaid', counts.payment.paid, '납부관리', '납부완료'],
    ['cntPaymentRefundTarget', 'colPaymentRefundTarget', counts.payment.refundTarget, '납부관리', '환수대상'],
    ['cntPaymentPostPayTarget', 'colPaymentPostPayTarget', counts.payment.postPayTarget, '납부관리', '사후납대상']
  ]);

  updateSummaryCard('Const', counts.const, [
    ['cntConstPermitIssue', 'colConstPermitIssue', counts.const.issue, '착공 및 복구공사', '허가증교부'],
    ['cntConstStartSubmit', 'colConstStartSubmit', counts.const.submit, '착공 및 복구공사', '착공계제출'],
    ['cntConstRestoreDone', 'colConstRestoreDone', counts.const.restoreDone, '착공 및 복구공사', '복구공사완료']
  ]);

  updateSummaryCard('Comp', counts.comp, [
    ['cntCompWriting', 'colCompWriting', counts.comp.writing, '준공관리', '준공계작성중'],
    ['cntCompReceived', 'colCompReceived', counts.comp.received, '준공관리', '준공계접수'],
    ['cntCompDone', 'colCompDone', counts.comp.done, '준공관리', '준공완료']
  ]);

  renderTableData();
}

function updateSummaryCard(prefix, groupData, elementList) {
  elementList.forEach(item => {
    const [cntId, colId, countVal, category, sub] = item;
    const cntElem = document.getElementById(cntId);
    const colElem = document.getElementById(colId);
    
    if (cntElem) {
      cntElem.textContent = `${countVal.toLocaleString()}건`;
    }

    if (colElem) {
      const isSelected = activeCardFilter && activeCardFilter.category === category && activeCardFilter.sub === sub;
      if (isSelected) {
        colElem.classList.add('active');
      } else {
        colElem.classList.remove('active');
      }

      colElem.onclick = () => {
        if (activeCardFilter && activeCardFilter.category === category && activeCardFilter.sub === sub) {
          activeCardFilter = null;
        } else {
          activeCardFilter = { category, sub };
        }
        currentPage = 1;
        applyFilters();
      };
    }
  });
}

function bindEmptyGuideDragAndDrop() {
  const guideCard = document.getElementById('mainEmptyUploadGuide');
  if (!guideCard) return;

  ['dragenter', 'dragover'].forEach(eventName => {
    guideCard.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      guideCard.classList.add('drag-active');
    }, false);
  });

  ['dragleave', 'dragend'].forEach(eventName => {
    guideCard.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      guideCard.classList.remove('drag-active');
    }, false);
  });

  guideCard.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    guideCard.classList.remove('drag-active');
    
    if (e.dataTransfer && e.dataTransfer.files.length > 0) {
      handleExcelFile(e.dataTransfer.files[0]);
    }
  }, false);
}

function renderTableData() {
  const tbody = document.getElementById('tableBody');
  const thead = document.getElementById('tableHead');
  const headerTitle = document.getElementById('tableHeaderTitle');

  if (isDataLoading) {
    if (headerTitle) headerTitle.textContent = '인허가 및 공사 목록 상세';
    const countTag = document.getElementById('tableRecordCount');
    if (countTag) {
      countTag.textContent = 'DB 갱신 중...';
      countTag.style.background = '#2563eb';
      countTag.style.color = '#ffffff';
      countTag.style.borderColor = '#1d4ed8';
      countTag.style.boxShadow = '0 0 8px rgba(37, 99, 235, 0.4)';
    }
    if (thead) thead.innerHTML = '';
    if (tbody) {
      tbody.innerHTML = `
        <tr>
          <td colspan="15" style="padding: 0; border: none;">
            <div style="padding: 70px 20px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; background: #ffffff; text-align: center;">
              <div style="width: 52px; height: 52px; border-radius: 50%; background: #eff6ff; display: flex; align-items: center; justify-content: center; border: 2px solid #bfdbfe; box-shadow: 0 4px 12px rgba(37, 99, 235, 0.15);">
                <i data-lucide="loader-2" class="spin-icon" style="color: #2563eb; width: 28px; height: 28px;"></i>
              </div>
              <div style="display: flex; flex-direction: column; gap: 8px; align-items: center;">
                <h4 style="font-size: 1.25rem; font-weight: 800; color: #0f172a; margin: 0;">
                  인허가 및 공사 데이터 DB 갱신 중...
                </h4>
                <p style="font-size: 1.05rem; color: #2563eb; font-weight: 800; margin: 0; line-height: 1.6; max-width: 640px;">
                  📌 서울시 도로굴착복구시스템 DB 실시간 갱신에는 수 초에서 수십 초가 소요될 수 있습니다. 잠시만 기다려 주세요.
                </p>
              </div>
            </div>
          </td>
        </tr>
      `;
    }
    if (window.lucide && window.lucide.createIcons) {
      try { window.lucide.createIcons(); } catch(e) {}
    }
    renderPagination(0);
    return;
  }

  const countTag = document.getElementById('tableRecordCount');
  if (countTag) {
    countTag.style.background = '#e0f2fe';
    countTag.style.color = '#0284c7';
    countTag.style.borderColor = 'transparent';
    countTag.style.boxShadow = 'none';
  }

  const isPaymentCategory = activeCardFilter && activeCardFilter.category === '납부관리';
  const subName = isPaymentCategory ? String(activeCardFilter.sub || '').trim() : '';

  const isRefundOrPostpay = isPaymentCategory && (subName === '환수대상' || subName === '사후납대상');
  const isNoticeOrPaid = isPaymentCategory && (subName === '고지서발행' || subName === '납부완료');

  if (isRefundOrPostpay) {
    headerTitle.textContent = `납부 관리 - ${subName} 정산 내역`;
    
    thead.innerHTML = `
      <tr>
        <th style="width: 45px;">No<div class="resizer"></div></th>
        <th style="width: 210px;">허가번호<div class="resizer"></div></th>
        <th style="width: 150px;">원본 처리상태<div class="resizer"></div></th>
        <th style="width: 130px;">복구주체<div class="resizer"></div></th>
        <th style="width: 130px; background:#fff7ed;">허가면적 (㎡)<div class="resizer"></div></th>
        <th style="width: 130px; background:#f0fdf4;">준공면적 (㎡)<div class="resizer"></div></th>
        <th style="width: 140px;">허가-준공면적 (㎡)<div class="resizer"></div></th>
      </tr>
    `;

    const totalCount = filteredRefundPostpayData.length;
    document.getElementById('tableRecordCount').textContent = `${totalCount}건 표시 중`;

    if (totalCount === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" class="empty-state">
            <div class="empty-icon">⚖️</div>
            <p>선택하신 필터 조건에 부합하는 [${subName}] 정산 내역이 없습니다.</p>
          </td>
        </tr>`;
      renderPagination(0);
      initTableColumnResizer();
      return;
    }

    const totalPages = Math.ceil(totalCount / itemsPerPage) || 1;
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;

    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = Math.min(startIndex + itemsPerPage, totalCount);
    const pageData = filteredRefundPostpayData.slice(startIndex, endIndex);

    tbody.innerHTML = pageData.map((item, index) => {
      const isRefund = item.type === '환수대상';
      const diffVal = Math.round((item.permitArea - item.compArea) * 100) / 100;
      const diffFormatted = formatAreaNumber(diffVal, true);
      
      const diffTagStyle = isRefund 
        ? 'color:#c2410c; font-weight:800; background:#fff7ed; border:1px solid #ffedd5; padding:3px 10px; border-radius:6px;'
        : 'color:#7c3aed; font-weight:800; background:#faf5ff; border:1px solid #e9d5ff; padding:3px 10px; border-radius:6px;';

      let currentStatus = item.status || item.rawStatus || '';
      if (!currentStatus && rawData.length > 0) {
        const cleanP = cleanForSearch(item.permitNo);
        const match = rawData.find(r => cleanForSearch(r.permitNo) === cleanP);
        if (match && match.rawStatus) {
          currentStatus = match.rawStatus;
        }
      }
      if (!currentStatus) currentStatus = '준공검토';

      const rawStatusTag = `<span style="font-size:0.78rem; color:#1e293b; font-weight:700; background:#f1f5f9; border:1px solid #cbd5e1; padding:2px 8px; border-radius:4px; display:inline-block;">${currentStatus}</span>`;

      return `
        <tr>
          <td>${startIndex + index + 1}</td>
          <td style="white-space:nowrap;"><code style="color:#2563eb; font-weight:700; font-size:0.86rem; white-space:nowrap;">${item.permitNo || '-'}</code></td>
          <td>${rawStatusTag}</td>
          <td><span style="color:#475569; font-weight:600;">${item.restoreEntity || '-'}</span></td>
          <td style="font-weight:700; color:#c2410c; background:#fff7ed;">${formatAreaNumber(item.permitArea)}</td>
          <td style="font-weight:700; color:#059669; background:#f0fdf4;">${formatAreaNumber(item.compArea)}</td>
          <td><span style="${diffTagStyle}">${diffFormatted}</span></td>
        </tr>
      `;
    }).join('');

    renderPagination(totalCount);
    initTableColumnResizer();

  } else if (isNoticeOrPaid) {
    headerTitle.textContent = `납부 관리 고지 내역 (${subName})`;
    
    thead.innerHTML = `
      <tr>
        <th style="width: 40px;">No<div class="resizer"></div></th>
        <th style="width: 210px;">허가번호<div class="resizer"></div></th>
        <th style="width: 110px;">고지종류<div class="resizer"></div></th>
        <th style="width: 100px;">부과구분<div class="resizer"></div></th>
        <th style="width: 260px;">공사명<div class="resizer"></div></th>
        <th style="width: 110px;">금액<div class="resizer"></div></th>
        <th style="width: 95px;">부과일<div class="resizer"></div></th>
        <th style="width: 95px;">납기내<div class="resizer"></div></th>
        <th style="width: 95px;">납부일<div class="resizer"></div></th>
      </tr>
    `;

    const totalCount = filteredPaymentData.length;
    document.getElementById('tableRecordCount').textContent = `${totalCount}건 표시 중`;

    if (totalCount === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="9" class="empty-state">
            <div class="empty-icon">💳</div>
            <p>선택하신 필터 조건에 부합하는 납부 관리 [${subName}] 내역이 없습니다.<br><span style="font-size:0.78rem; color:#64748b;">하단의 [고지서 / 납부현황 DB] 업로드 버튼을 통해 엑셀을 입력하시거나 상단 검색조건을 변경해보세요.</span></p>
          </td>
        </tr>`;
      renderPagination(0);
      initTableColumnResizer();
      return;
    }

    const totalPages = Math.ceil(totalCount / itemsPerPage) || 1;
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;

    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = Math.min(startIndex + itemsPerPage, totalCount);
    const pageData = filteredPaymentData.slice(startIndex, endIndex);

    tbody.innerHTML = pageData.map((item, index) => {
      const isPaid = item.status === '완납';
      const statusTag = isPaid 
        ? '<span style="color:#059669; font-weight:700; background:#ecfdf5; border:1px solid #a7f3d0; padding:2px 6px; border-radius:4px; font-size:0.74rem;">완납</span>'
        : `<span style="color:#d97706; font-weight:600; background:#fffbeb; border:1px solid #fde68a; padding:2px 6px; border-radius:4px; font-size:0.74rem;">${item.status || '납부대기'}</span>`;

      return `
        <tr>
          <td>${startIndex + index + 1}</td>
          <td style="white-space:nowrap;"><code style="color:#2563eb; font-weight:700; font-size:0.86rem; white-space:nowrap;">${item.permitNo || '-'}</code></td>
          <td><span style="font-weight:600; color:#475569;">${item.noticeType || '-'}</span></td>
          <td>${item.category || '-'}</td>
          <td style="font-weight:600;" title="${item.title || ''}">${item.title || '-'}</td>
          <td style="font-weight:700; color:#0f172a;">${item.amount || '-'}</td>
          <td>${item.issueDate || '-'}</td>
          <td>${item.dueDate || '-'}</td>
          <td>${item.payDate && item.payDate !== '-' ? `<span style="color:#059669; font-weight:700;">${item.payDate}</span>` : statusTag}</td>
        </tr>
      `;
    }).join('');

    renderPagination(totalCount);
    initTableColumnResizer();

  } else {
    headerTitle.textContent = '인허가 및 공사 목록 상세';
    
    thead.innerHTML = `
      <tr>
        <th style="width: 40px;">No<div class="resizer"></div></th>
        <th style="width: 210px;">허가번호<div class="resizer"></div></th>
        <th style="width: 260px;">공사명<div class="resizer"></div></th>
        <th style="width: 125px;">BP사(협력사)<div class="resizer"></div></th>
        <th style="width: 95px;">도급사<div class="resizer"></div></th>
        <th style="width: 90px;">신청접수일<div class="resizer"></div></th>
        <th style="width: 90px;">허가승인일<div class="resizer"></div></th>
        <th style="width: 145px;">원본 처리상태<div class="resizer"></div></th>
        <th style="width: 180px;">비고 (매체/코드)<div class="resizer"></div></th>
      </tr>
    `;

    const totalCount = filteredData.length;
    document.getElementById('tableRecordCount').textContent = `${totalCount}건 표시 중`;

    if (rawData.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="9" style="padding: 0; border: none;">
            <div id="mainEmptyUploadGuide" class="empty-upload-guide">
              <i data-lucide="refresh-cw" style="width:48px; height:48px; color:#2563eb; animation: spin 2s linear infinite;"></i>
              <h3>서울시 도로굴착복구시스템 DB 데이터를 가져오는 중이거나 데이터가 없습니다</h3>
              <p style="font-size: 0.85rem; color: #475569; max-width: 580px; line-height: 1.5;">
                Netlify 서버리스 함수를 통해 서울시 도로굴착복구시스템 DB의 최신 데이터를 자동으로 반영합니다.<br>
                데이터가 나타나지 않을 경우 상단의 <strong>[DB 새로고침]</strong> 버튼을 클릭해주세요.
              </p>
              <div class="empty-guide-actions" style="margin-top: 10px;">
                <button onclick="fetchDashboardData()" class="btn btn-primary">
                  <i data-lucide="refresh-cw"></i> 데이터 다시 불러오기
                </button>
              </div>
            </div>
          </td>
        </tr>`;
      lucide.createIcons();
      renderPagination(0);
      initTableColumnResizer();
      return;
    }

    if (totalCount === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="9" class="empty-state">
            <div class="empty-icon">🔍</div>
            <p>선택하신 조건과 일치하는 인허가 데이터가 없습니다.</p>
          </td>
        </tr>`;
      renderPagination(0);
      initTableColumnResizer();
      return;
    }

    const totalPages = Math.ceil(totalCount / itemsPerPage) || 1;
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;

    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = Math.min(startIndex + itemsPerPage, totalCount);
    const pageData = filteredData.slice(startIndex, endIndex);

    tbody.innerHTML = pageData.map((item, index) => {
      const manualTag = item.isManualBP ? '<span class="manual-bp-tag">수동</span>' : '';
      const contractorDisplay = item.contractor && item.contractor !== '-' ? `<span style="font-weight:700; color:#0284c7;">${item.contractor}</span>` : '-';
      const remarkDisplay = item.remark && item.remark !== '-' ? `<span style="font-size:0.74rem; color:#475569;" title="${item.remark}">${item.remark}</span>` : '-';

      return `
        <tr>
          <td>${startIndex + index + 1}</td>
          <td style="white-space:nowrap;"><code style="color:#2563eb; font-weight:700; font-size:0.86rem; white-space:nowrap;">${item.permitNo || '-'}</code></td>
          <td style="font-weight:600;" title="${item.title || ''}">${item.title || '-'}</td>
          <td><span style="color:#7c3aed; font-weight:600;">${item.company || '-'}</span>${manualTag}</td>
          <td>${contractorDisplay}</td>
          <td>${item.applyDate || '-'}</td>
          <td>${item.permitDate || '-'}</td>
          <td><span style="color:#dc2626; font-weight:700;">${item.rawStatus}</span></td>
          <td>${remarkDisplay}</td>
        </tr>
      `;
    }).join('');

    renderPagination(totalCount);
    initTableColumnResizer();
  }
}

function renderPagination(totalCount) {
  const container = document.getElementById('paginationControls');
  if (!container) return;

  if (totalCount === 0) {
    container.innerHTML = '';
    return;
  }

  const totalPages = Math.ceil(totalCount / itemsPerPage) || 1;
  const startNum = (currentPage - 1) * itemsPerPage + 1;
  const endNum = Math.min(currentPage * itemsPerPage, totalCount);

  let pagesHtml = '';
  pagesHtml += `<button class="page-btn" ${currentPage === 1 ? 'disabled' : ''} onclick="changePage(${currentPage - 1})">&laquo; 이전</button>`;

  const maxVisiblePages = 5;
  let startPage = Math.max(1, currentPage - 2);
  let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);
  if (endPage - startPage < maxVisiblePages - 1) {
    startPage = Math.max(1, endPage - maxVisiblePages + 1);
  }

  for (let p = startPage; p <= endPage; p++) {
    pagesHtml += `<button class="page-btn ${p === currentPage ? 'active' : ''}" onclick="changePage(${p})">${p}</button>`;
  }

  pagesHtml += `<button class="page-btn" ${currentPage === totalPages ? 'disabled' : ''} onclick="changePage(${currentPage + 1})">${currentPage + 1} &raquo;</button>`;

  container.innerHTML = `
    <div class="page-info">전체 ${totalCount.toLocaleString()}건 중 ${startNum.toLocaleString()}-${endNum.toLocaleString()}건 표시 (페이지 ${currentPage} / ${totalPages})</div>
    <div class="page-btn-group">${pagesHtml}</div>
  `;
}

window.changePage = function(newPage) {
  const isPaymentCategory = activeCardFilter && activeCardFilter.category === '납부관리';
  const subName = isPaymentCategory ? String(activeCardFilter.sub || '').trim() : '';

  let totalCount = filteredData.length;
  if (subName === '환수대상' || subName === '사후납대상') totalCount = filteredRefundPostpayData.length;
  else if (subName === '고지서발행' || subName === '납부완료') totalCount = filteredPaymentData.length;

  const totalPages = Math.ceil(totalCount / itemsPerPage) || 1;
  if (newPage >= 1 && newPage <= totalPages) {
    currentPage = newPage;
    renderTableData();
  }
};

function handleExcelFile(file) {
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array', cellDates: true });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      
      const rawRows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '', raw: false });

      if (rawRows.length <= 1) {
        alert('엑셀 파일에 데이터 행이 존재하지 않습니다.');
        return;
      }

      let headerRowIndex = 0;
      for (let r = 0; r < Math.min(rawRows.length, 10); r++) {
        const rowStr = rawRows[r].map(c => normalizeString(c)).join(' ');
        if (rowStr.includes('처리상태') || rowStr.includes('공사명') || rowStr.includes('신청접수일') || rowStr.includes('구청') || rowStr.includes('허가번호') || rowStr.includes('신청번호')) {
          headerRowIndex = r;
          break;
        }
      }

      const headerRow = rawRows[headerRowIndex].map(h => normalizeString(h));

      const findColIndex = (keywords, defaultIndex) => {
        for (let i = 0; i < headerRow.length; i++) {
          const h = headerRow[i];
          if (keywords.some(kw => h.includes(normalizeString(kw)))) {
            return i;
          }
        }
        return defaultIndex;
      };

      const regionIdx = findColIndex(['구청', '지역', '시군구', '자치구', '지자체'], 1);
      
      let companyIdx = -1;
      for (let i = 0; i < headerRow.length; i++) {
        const h = headerRow[i];
        if (h.includes('BP사') || h.includes('협력사') || h.includes('공사업체') || h.includes('시공사')) {
          companyIdx = i;
          break;
        }
      }
      if (companyIdx === -1) {
        companyIdx = findColIndex(['신청인', '업체명'], 10);
      }

      const COLUMN_F_INDEX = 5;
      const COLUMN_D_INDEX = 3;  
      const COLUMN_E_INDEX = 4;  
      const COLUMN_L_INDEX = 11; 
      const COLUMN_N_INDEX = 13; 

      const parsedData = [];
      let validCounter = 1;

      for (let r = headerRowIndex + 1; r < rawRows.length; r++) {
        const row = rawRows[r];
        if (!row || row.length === 0) continue;

        const rowJoinText = row.join(' ');
        
        let fColumnPermitNo = row[COLUMN_F_INDEX];
        if (fColumnPermitNo === undefined || fColumnPermitNo === null || String(fColumnPermitNo).trim() === '') {
          fColumnPermitNo = row[findColIndex(['허가번호', '신청번호'], 5)];
        }

        let dColumnApplyDate = row[COLUMN_D_INDEX];
        let eColumnPermitDate = row[COLUMN_E_INDEX];
        let lColumnTitle = row[COLUMN_L_INDEX];
        let nColumnStatus = row[COLUMN_N_INDEX];

        if (!dColumnApplyDate) dColumnApplyDate = row[findColIndex(['신청접수일', '신청일'], 3)];
        if (!eColumnPermitDate) eColumnPermitDate = row[findColIndex(['허가승인일', '허가일'], 4)];
        if (!lColumnTitle) lColumnTitle = row[findColIndex(['공사명', '사업명', '건명'], 11)];
        if (!nColumnStatus) nColumnStatus = row[findColIndex(['처리상태', '진행상태'], 13)];

        const regionVal = String(row[regionIdx] || '').trim();
        const permitNoVal = String(fColumnPermitNo || '').trim();
        const titleVal = String(lColumnTitle || '').trim();
        const statusVal = String(nColumnStatus || '').trim();
        const rawCompanyVal = String(row[companyIdx] || '').trim();

        if (!statusVal && !titleVal && !permitNoVal && !regionVal) {
          continue;
        }
        
        const normStatusStr = normalizeString(statusVal);
        if (normStatusStr === '처리상태' || normalizeString(titleVal) === '공사명' || regionVal === '구청' || regionVal === '지자체') {
          continue;
        }

        const bpResult = resolveBPCompany(regionVal, rawCompanyVal, permitNoVal);
        const cDetails = resolveContractorDetails(permitNoVal);

        parsedData.push({
          id: validCounter++,
          region: regionVal,
          permitNo: permitNoVal,
          title: titleVal,
          company: bpResult.company,
          isManualBP: bpResult.isManual,
          rawCompany: rawCompanyVal,
          contractor: cDetails.contractor,
          media: cDetails.media,
          code: cDetails.code,
          remark: cDetails.remark,
          applyDate: formatExcelDate(dColumnApplyDate),
          permitDate: formatExcelDate(eColumnPermitDate),
          rawStatus: statusVal || '진행중',
          rawRowText: rowJoinText
        });
      }

      rawData = parsedData;
      populateDropdownOptions();
      updateDefaultDateRange();
      resetFilters();
      
      updateDataTimestamp();
      
      confetti({ particleCount: 100, spread: 80, origin: { y: 0.6 } });
      alert(`성공적으로 인허가 엑셀 데이터 ${rawData.length}건이 업로드되었습니다!`);
    } catch (err) {
      console.error(err);
      alert('엑셀 파일을 읽는 도중 오류가 발생했습니다. 포맷을 확인해 주세요.');
    }
  };
  reader.readAsArrayBuffer(file);
}

function exportFilteredToExcel() {
  const isPaymentCategory = activeCardFilter && activeCardFilter.category === '납부관리';
  const subName = isPaymentCategory ? String(activeCardFilter.sub || '').trim() : '';

  const isRefundOrPostpay = isPaymentCategory && (subName === '환수대상' || subName === '사후납대상');
  const timestampStr = getFileTimestampString();

  if (isRefundOrPostpay) {
    if (filteredRefundPostpayData.length === 0) {
      alert('내보낼 정산 데이터가 없습니다.');
      return;
    }

    const exportRows = filteredRefundPostpayData.map(item => ({
      '허가번호': item.permitNo || '-',
      '처리상태': item.status || '-',
      '복구주체': item.restoreEntity || '-',
      '허가면적 (㎡)': item.permitArea,
      '준공면적 (㎡)': item.compArea,
      '허가-준공면적 (㎡)': item.areaDiff,
      '정산 구분': item.type
    }));

    const worksheet = XLSX.utils.json_to_sheet(exportRows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, '면적정산조회결과');
    XLSX.writeFile(workbook, `SEMS_면적정산_${subName}_조회결과_${timestampStr}.xlsx`);

  } else if (isPaymentCategory) {
    if (filteredPaymentData.length === 0) {
      alert('내보낼 납부 데이터가 없습니다.');
      return;
    }

    const exportRows = filteredPaymentData.map(item => ({
      '허가신청번호': item.permitAppNo || '-',
      '허가번호': item.permitNo || '-',
      '고지종류': item.noticeType || '-',
      '부과구분': item.category || '-',
      '공사명': item.title || '-',
      '금액': item.amount || '-',
      '부과일': item.issueDate || '-',
      '납기내': item.dueDate || '-',
      '납부일': item.payDate || '-',
      '상태': item.status || '-'
    }));

    const worksheet = XLSX.utils.json_to_sheet(exportRows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, '납부현황조회결과');
    XLSX.writeFile(workbook, `SEMS_납부현황_${subName}_조회결과_${timestampStr}.xlsx`);

  } else {
    if (filteredData.length === 0) {
      alert('내보낼 데이터가 없습니다.');
      return;
    }

    const exportRows = filteredData.map(item => {
      const { category, sub } = classifyRecord(item);
      return {
        '구청(자치구)': item.region,
        '구축팀': getBuildTeam(item.region),
        '허가번호': item.permitNo,
        '공사명': item.title,
        'BP사(협력사)': item.company + (item.isManualBP ? ' (수동지정)' : ''),
        '도급사': item.contractor || '-',
        '신청접수일': item.applyDate,
        '허가승인일': item.permitDate,
        '원본 처리상태': item.rawStatus,
        '대시보드 분류': category === '제외' ? '제외' : category,
        '세부 항목': sub,
        '비고 (공사매체/공사코드)': item.remark || '-'
      };
    });

    const worksheet = XLSX.utils.json_to_sheet(exportRows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'SEMS_조회결과');
    XLSX.writeFile(workbook, `SEMS_인허가현황_조회결과_${timestampStr}.xlsx`);
  }
}
