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

function cleanForSearch(str) {
  if (str === null || str === undefined) return '';
  return String(str).toLowerCase().replace(/[\s\-\_\.\,\/\(\)\[\]\–\—\－]/g, '').trim();
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

    // Lookup rawStatus from rawData if available
    let resolvedStatus = item.status || '준공검토';
    if (rawData.length > 0) {
      const cleanP = cleanForSearch(pNo);
      const match = rawData.find(r => cleanForSearch(r.permitNo) === cleanP);
      if (match && match.rawStatus) {
        resolvedStatus = match.rawStatus;
      }
    }

    cleanedMap[pNo] = {
      permitNo: pNo,
      status: resolvedStatus,
      restoreEntity: item.restoreEntity || '원인자복구',
      permitArea: pArea,
      compArea: cArea,
      areaDiff: diff,
      type: pArea > cArea ? '환수대상' : '사후납대상', // Auto-classify based on area comparison!
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
  
  const manualMap = getManualBPMap();
  for (const storedPermit in manualMap) {
    if (storedPermit === cleanPermitNo || cleanForSearch(storedPermit) === cleanSearchPermit) {
      const manualInfo = manualMap[storedPermit];
      const compName = typeof manualInfo === 'object' ? manualInfo.company : manualInfo;
      return { company: compName, isManual: true };
    }
  }

  const contractorMap = getContractorMap();
  for (const storedPermit in contractorMap) {
    if (storedPermit === cleanPermitNo || cleanForSearch(storedPermit) === cleanSearchPermit) {
      const cInfo = contractorMap[storedPermit];
      if (cInfo && cInfo.bp && cInfo.bp.trim() !== '') {
        return { company: cInfo.bp.trim(), isManual: false };
      }
    }
  }

  const cleanComp = String(rawCompanyVal || '').trim();
  const isAdministrativeDong = /동$/.test(cleanComp) || /^[가-힣]+[0-9]*동$/.test(cleanComp);
  
  let finalComp = cleanComp;
  if (!cleanComp || isAdministrativeDong || (!cleanComp.includes('㈜') && !cleanComp.includes('텔레콤') && !cleanComp.includes('기술') && !cleanComp.includes('통신') && !cleanComp.includes('오티씨'))) {
    if (regionVal && DISTRICT_TO_BP[regionVal]) {
      finalComp = DISTRICT_TO_BP[regionVal];
    }
  }
  return { company: finalComp || DISTRICT_TO_BP[regionVal] || '협력사 미정', isManual: false };
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
 * 구글시트 타임스탬프 뱃지 텍스트 및 디자인 업데이트
 */
function updateDataTimestamp(dateStr, isError = false) {
  const elem = document.getElementById('timestampText');
  if (!elem) return;

  if (isError) {
    elem.innerHTML = `<span style="color:#dc2626; font-weight:700; font-size:0.75rem;">${dateStr}</span>`;
    return;
  }

  if (!dateStr || dateStr === 'loading') {
    elem.innerHTML = `<span style="color:#64748b; font-weight:500; font-size:0.75rem;">구글 시트 연동 중...</span>`;
    return;
  }

  elem.innerHTML = `
    <span style="color:#334155; font-weight:600; font-size:0.75rem; margin-right:2px;">데이터 추출일 :</span>
    <span style="color:#1d4ed8; font-weight:800; font-size:0.78rem; font-family:'Inter', -apple-system, sans-serif; background:#eff6ff; padding:2px 7px; border-radius:4px; border:1px solid #bfdbfe; display:inline-block;">${dateStr}</span>
  `;
}

/**
 * 구글시트 '신청서별허가현황' sheet의 A3:C3 (3번째 행, 1~3번째 열) 출력일자 추출 및 정제
 */
function extractSheetPrintDate(approvalData) {
  if (!approvalData || approvalData.length === 0) return '';

  let rawText = '';
  // 1. A3:C3 (3번째 행, index 2) 확인
  if (approvalData.length >= 3 && approvalData[2]) {
    const a3c3Row = approvalData[2];
    const cellValues = a3c3Row.slice(0, 3).map(v => String(v || '').trim()).filter(Boolean);
    rawText = cellValues.join(' ');
  }

  // 2. Fallback: 상위 5개 행에서 '출력일' 키워드가 포함된 셀 탐색
  if (!rawText) {
    for (let r = 0; r < Math.min(approvalData.length, 5); r++) {
      const row = approvalData[r];
      if (!row) continue;
      for (let c = 0; c < Math.min(row.length, 5); c++) {
        const val = String(row[c] || '').trim();
        if (val.includes('출력일')) {
          rawText = val;
          break;
        }
      }
      if (rawText) break;
    }
  }

  if (!rawText) return '';

  // 3. '▣출력일 :', '출력일자 :', '출력일시 :' 등에서 순수 날짜/시간 텍스트만 정제
  let cleaned = rawText
    .replace(/[▣■□▶]/g, '')
    .replace(/출력일자|출력일시|출력일/g, '')
    .replace(/^[\s:]+/, '')
    .trim();

  return cleaned || rawText;
}

/**
 * Netlify Serverless Function (getData.js)을 불러와 구글 시트 데이터 반영
 */
async function fetchDashboardData() {
  updateDataTimestamp('loading');

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

      // 신청서별허가현황 A3:C3 출력일자 표시 ('데이터 추출일 : YYYY-MM-DD' 포맷)
      const printDateStr = extractSheetPrintDate(approvalData);
      const displayTime = printDateStr || getCurrentFormattedTimestamp();
      updateDataTimestamp(displayTime);

      populateDropdownOptions();
      updateDefaultDateRange();
      applyFilters();

    } else {
      console.error("서버 응답 오류:", result.message);
      updateDataTimestamp('구글시트 연동 실패', true);
    }
  } catch (error) {
    console.error("서버에서 데이터를 가져오지 못했습니다:", error);
    updateDataTimestamp('구글시트 연동 에러', true);
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

  const dbMap = getPaymentDBMap();

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

  const permitNoColIdx = findCol(['허가번호', '신청번호'], 0);
  const restoreEntityColIdx = findCol(['복구주체', '주체'], 3);

  let permitAreaColIdx = 8;
  let compAreaColIdx = 14;

  for (let i = 0; i < headerRow.length; i++) {
    const h = headerRow[i];
    if (h.includes('허가면적') || (h.includes('면적') && !h.includes('준공') && !h.includes('차이'))) {
      permitAreaColIdx = i;
    } else if (h.includes('준공면적') || (h.includes('준공') && h.includes('면적'))) {
      compAreaColIdx = i;
    }
  }

  const groupedPermits = {};

  for (let r = headerRowIndex + 1; r < rawRows.length; r++) {
    const row = rawRows[r];
    if (!row || row.length === 0) continue;

    const permitNo = String(row[permitNoColIdx] || '').trim();
    if (!permitNo || permitNo.includes('허가번호')) continue;

    const restoreEntity = String(row[restoreEntityColIdx] || '').trim();
    const permitAreaVal = row[permitAreaColIdx];
    const compAreaVal = row[compAreaColIdx];

    const iArea = parseAreaNumber(permitAreaVal);
    const oArea = parseAreaNumber(compAreaVal);

    if (!groupedPermits[permitNo]) {
      groupedPermits[permitNo] = {
        permitNo: permitNo,
        restoreEntity: restoreEntity,
        totalPermitArea: 0,
        totalCompArea: 0,
        rowCount: 0
      };
    }

    groupedPermits[permitNo].totalPermitArea += iArea;
    groupedPermits[permitNo].totalCompArea += oArea;
    if (restoreEntity && (!groupedPermits[permitNo].restoreEntity || groupedPermits[permitNo].restoreEntity === '')) {
      groupedPermits[permitNo].restoreEntity = restoreEntity;
    }
    groupedPermits[permitNo].rowCount++;
  }

  const existingDbMap = getRefundPostpayDBMap();

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

    let resolvedStatus = '준공검토';
    if (rawData.length > 0) {
      const cleanP = cleanForSearch(pNo);
      const match = rawData.find(r => cleanForSearch(r.permitNo) === cleanP);
      if (match && match.rawStatus) {
        resolvedStatus = match.rawStatus;
      }
    }

    existingDbMap[pNo] = {
      permitNo: pNo,
      status: resolvedStatus,
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
  
  checkAuthentication();

  const btnLogout = document.getElementById('btnLogout');
  if (btnLogout) btnLogout.addEventListener('click', handleLogout);

  rawData = [];
  filteredData = [];
  paymentData = [];
  filteredPaymentData = [];
  refundPostpayData = [];
  filteredRefundPostpayData = [];
  selectedDistricts = [];
  
  loadPaymentDataFromDB();
  loadRefundPostpayDataFromDB();
  updateDataTimestamp('구글시트 데이터 로드 중...');
  updateContractorDbBadge();
  initEventListeners();
  setupMultiSelectEvents();
  setupManualBpModalEvents();

  populateDropdownOptions();
  applyFilters();

  // 구글 시트 데이터 서버리스 함수 호출
  fetchDashboardData();
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
  if (btnDownload) {
    btnDownload.addEventListener('click', downloadContractorMappingTemplate);
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

function setupPaymentDataEvents() {
  const btnDownload = document.getElementById('btnDownloadPaymentTemplate');
  if (btnDownload) {
    btnDownload.addEventListener('click', downloadPaymentTemplate);
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

function setupRefundPostpayEvents() {
  const btnDownload = document.getElementById('btnDownloadRefundTemplate');
  if (btnDownload) {
    btnDownload.addEventListener('click', downloadRefundPostpayTemplate);
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
      alert('현재 데이터가 로드되지 않았습니다.');
      return;
    }

    const cleanInputPermit = cleanForSearch(permitNoVal);
    const matchedItem = rawData.find(item => {
      const cleanItemPermit = cleanForSearch(item.permitNo);
      return (cleanItemPermit && cleanItemPermit === cleanInputPermit) || item.permitNo === permitNoVal;
    });

    if (!matchedItem) {
      alert(`⚠️ 입력하신 허가번호 [${permitNoVal}]는 현재 데이터에 존재하지 않습니다.\n\n허가번호를 다시 한번 정확히 확인해 주세요.`);
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

function initEventListeners() {
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
          if (validPermitSet) {
            const cleanP = cleanForSearch(r.permitNo);
            return validPermitSet.has(r.permitNo) || validCleanPermitSet.has(cleanP);
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
    badge.textContent = '구글시트 데이터 대기중';
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

function renderTableData() {
  const tbody = document.getElementById('tableBody');
  const thead = document.getElementById('tableHead');
  const headerTitle = document.getElementById('tableHeaderTitle');

  const isPaymentCategory = activeCardFilter && activeCardFilter.category === '납부관리';
  const subName = isPaymentCategory ? String(activeCardFilter.sub || '').trim() : '';

  const isRefundOrPostpay = isPaymentCategory && (subName === '환수대상' || subName === '사후납대상');
  const isNoticeOrPaid = isPaymentCategory && (subName === '고지서발행' || subName === '납부완료');

  if (isRefundOrPostpay) {
    headerTitle.textContent = `납부 관리 - ${subName} 정산 내역`;
    
    thead.innerHTML = `
      <tr>
        <th style="width: 45px;">No<div class="resizer"></div></th>
        <th style="width: 170px;">허가번호<div class="resizer"></div></th>
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
      const dataTable = document.getElementById('dataTable');
      if (dataTable) dataTable.style.height = '100%';
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
      const diffFormatted = diffVal > 0 ? `+${diffVal.toLocaleString()} ㎡` : `${diffVal.toLocaleString()} ㎡`;
      
      const diffTagStyle = isRefund 
        ? 'color:#c2410c; font-weight:800; background:#fff7ed; border:1px solid #ffedd5; padding:3px 10px; border-radius:6px;'
        : 'color:#7c3aed; font-weight:800; background:#faf5ff; border:1px solid #e9d5ff; padding:3px 10px; border-radius:6px;';

      let currentStatus = '준공검토';
      if (rawData.length > 0) {
        const cleanP = cleanForSearch(item.permitNo);
        const match = rawData.find(r => cleanForSearch(r.permitNo) === cleanP);
        if (match && match.rawStatus) {
          currentStatus = match.rawStatus;
        } else if (item.status) {
          currentStatus = item.status;
        }
      } else if (item.status) {
        currentStatus = item.status;
      }

      const rawStatusTag = `<span style="font-size:0.78rem; color:#1e293b; font-weight:700; background:#f1f5f9; border:1px solid #cbd5e1; padding:2px 8px; border-radius:4px; display:inline-block;">${currentStatus}</span>`;

      return `
        <tr>
          <td>${startIndex + index + 1}</td>
          <td><code style="color:#2563eb; font-weight:700; font-size:0.88rem;">${item.permitNo || '-'}</code></td>
          <td>${rawStatusTag}</td>
          <td><span style="color:#475569; font-weight:600;">${item.restoreEntity || '-'}</span></td>
          <td style="font-weight:700; color:#c2410c; background:#fff7ed;">${(item.permitArea || 0).toLocaleString()} ㎡</td>
          <td style="font-weight:700; color:#059669; background:#f0fdf4;">${(item.compArea || 0).toLocaleString()} ㎡</td>
          <td><span style="${diffTagStyle}">${diffFormatted}</span></td>
        </tr>
      `;
    }).join('');

    const dataTable = document.getElementById('dataTable');
    if (dataTable) {
      dataTable.style.height = pageData.length >= 10 ? '100%' : 'auto';
    }

    renderPagination(totalCount);
    initTableColumnResizer();

  } else if (isNoticeOrPaid) {
    headerTitle.textContent = `납부 관리 고지 내역 (${subName})`;
    
    thead.innerHTML = `
      <tr>
        <th style="width: 40px;">No<div class="resizer"></div></th>
        <th style="width: 145px;">허가번호<div class="resizer"></div></th>
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
            <p>선택하신 필터 조건에 부합하는 납부 관리 [${subName}] 내역이 없습니다.</p>
          </td>
        </tr>`;
      const dataTable = document.getElementById('dataTable');
      if (dataTable) dataTable.style.height = '100%';
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
          <td><code style="color:#2563eb; font-weight:600;">${item.permitNo || '-'}</code></td>
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

    const dataTable = document.getElementById('dataTable');
    if (dataTable) {
      dataTable.style.height = pageData.length >= 10 ? '100%' : 'auto';
    }

    renderPagination(totalCount);
    initTableColumnResizer();

  } else {
    headerTitle.textContent = '인허가 및 공사 목록 상세';
    
    thead.innerHTML = `
      <tr>
        <th style="width: 40px;">No<div class="resizer"></div></th>
        <th style="width: 140px;">허가번호<div class="resizer"></div></th>
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
              <h3>구글 시트 데이터를 가져오는 중이거나 데이터가 없습니다</h3>
              <p style="font-size: 0.85rem; color: #475569; max-width: 580px; line-height: 1.5;">
                Netlify 서버리스 함수를 통해 구글 시트의 최신 데이터를 자동으로 반영합니다.<br>
                데이터가 나타나지 않을 경우 잠시 후 <strong>페이지를 새로고침(F5)</strong> 해주세요.
              </p>
            </div>
          </td>
        </tr>`;
      const dataTable = document.getElementById('dataTable');
      if (dataTable) dataTable.style.height = '100%';
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
      const dataTable = document.getElementById('dataTable');
      if (dataTable) dataTable.style.height = '100%';
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
          <td><code style="color:#2563eb; font-weight:600;">${item.permitNo || '-'}</code></td>
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

    const dataTable = document.getElementById('dataTable');
    if (dataTable) {
      dataTable.style.height = pageData.length >= 10 ? '100%' : 'auto';
    }

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
