const crypto = require('crypto');

// In-memory Google OAuth2 Access Token Cache
let cachedGoogleToken = null;
let cachedGoogleTokenExp = 0;

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
  { bp: '㈜컴피아', districts: ['강남구'] },
];

const ALL_25_DISTRICTS = [
  '강남구', '강동구', '강북구', '강서구', '관악구', '광진구', '구로구', '금천구',
  '노원구', '도봉구', '동대문구', '동작구', '마포구', '서대문구', '서초구', '성동구',
  '성북구', '송파구', '양천구', '영등포구', '용산구', '은평구', '종로구', '중구', '중랑구',
];

const SUNAM_DISTRICTS = [
  '서초구', '강서구', '영등포구', '양천구', '강동구',
  '송파구', '구로구', '금천구', '동작구', '관악구', '강남구',
];

const DISTRICT_TO_BP = {};
BP_DISTRICT_MAP.forEach(pair => {
  pair.districts.forEach(d => {
    DISTRICT_TO_BP[d] = pair.bp;
  });
});

function getAuthSecret() {
  return (
    process.env.SEMS_AUTH_SECRET ||
    process.env.GOOGLE_PRIVATE_KEY ||
    'sems-default-server-hmac-secret-2026'
  );
}

function base64UrlEncode(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input), 'utf8');
  return buf
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlDecode(str) {
  let base64 = String(str).replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4 !== 0) {
    base64 += '=';
  }
  return Buffer.from(base64, 'base64').toString('utf8');
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const expectedSig = base64UrlEncode(
    crypto.createHmac('sha256', getAuthSecret()).update(signingInput, 'utf8').digest()
  );

  const sigBufA = crypto.createHash('sha256').update(String(encodedSignature), 'utf8').digest();
  const sigBufB = crypto.createHash('sha256').update(String(expectedSig), 'utf8').digest();
  if (!crypto.timingSafeEqual(sigBufA, sigBufB)) {
    return null;
  }

  try {
    const payload = JSON.parse(base64UrlDecode(encodedPayload));
    if (!payload.exp || Date.now() > payload.exp) {
      return null;
    }
    return payload;
  } catch (e) {
    return null;
  }
}

function normalizeString(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/\s+/g, '').trim();
}

function cleanForSearch(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .toLowerCase()
    .replace(/\(변경\)|\(연장\)|\(재고지\)|\(원적\)/gi, '')
    .replace(/[\s\-\_\.\,\/\(\)\[\]\–\—\－]/g, '')
    .trim();
}

function normalizeOrgName(str) {
  if (!str) return '';
  return String(str)
    .replace(/\(주\)|（주）|㈜|\s+/g, '')
    .toUpperCase()
    .trim();
}

function getContractorCategory(contractorVal) {
  if (!contractorVal) return '미분류';
  const cStr = String(contractorVal).toUpperCase().replace(/\s+/g, '');
  if (cStr.includes('SKTNS') || cStr.includes('TNS')) return 'SKTNS';
  if (cStr.includes('PTCE') || cStr.includes('피티씨이')) return 'PTCE';
  return '미분류';
}

function buildManualMapDict(manualRows) {
  const dict = {};
  const cleanDict = {};
  if (!manualRows || manualRows.length <= 1) return { dict, cleanDict };

  let headerRowIndex = 0;
  for (let r = 0; r < Math.min(manualRows.length, 10); r++) {
    const rowStr = (manualRows[r] || []).map(c => normalizeString(c)).join(' ');
    if (rowStr.includes('허가번호') || rowStr.includes('도급사')) {
      headerRowIndex = r;
      break;
    }
  }

  const headerRow = (manualRows[headerRowIndex] || []).map(h => normalizeString(h));
  const findCol = (kwList, defIdx) => {
    for (let i = 0; i < headerRow.length; i++) {
      if (kwList.some(kw => headerRow[i].includes(normalizeString(kw)))) return i;
    }
    return defIdx;
  };

  const permitColIdx = findCol(['허가번호', '신청번호'], 0);
  const bpColIdx = findCol(['BP사', '협력사'], 1);
  const contractorColIdx = findCol(['도급사'], 2);

  for (let r = headerRowIndex + 1; r < manualRows.length; r++) {
    const row = manualRows[r];
    if (!row || row.length === 0) continue;
    const pNo = String(row[permitColIdx] || '').trim();
    if (!pNo || pNo.includes('허가번호')) continue;

    const info = {
      bp: String(row[bpColIdx] || '').trim(),
      contractor: String(row[contractorColIdx] || '').trim(),
    };
    dict[pNo] = info;
    cleanDict[cleanForSearch(pNo)] = info;
  }
  return { dict, cleanDict };
}

function normalizeRoleCode(rawVal) {
  const val = String(rawVal || '')
    .replace(/\s+/g, '')
    .toUpperCase();
  if (val === '전체' || val === 'ADMIN' || val === 'ALL') return 'ADMIN';
  if (val === '소속구축팀' || val === '구축팀' || val === 'TEAM') return 'TEAM';
  if (val === '소속도급사' || val === '도급사' || val === 'CONTRACTOR') return 'CONTRACTOR';
  if (val === '소속BP' || val === '소속BP사' || val === 'BP' || val === '협력사') return 'BP';
  return 'ADMIN';
}

function isRecordPermittedForUser(recordMeta, user) {
  const role = normalizeRoleCode(user && user.role);
  if (!user || !user.role || role === 'ADMIN') return true;

  const targetOrg = normalizeOrgName(user.company || user.scope || '');
  if (!targetOrg || targetOrg === 'ALL' || targetOrg === '전체') return true;

  const region = String(recordMeta.region || '').trim();
  const bp = String(recordMeta.bp || '').trim();
  const contractor = String(recordMeta.contractor || '').trim();

  if (role === 'TEAM') {
    // 자치구가 없거나 25개 자치구에 속하지 않는 미분류(소속 미정) 건은 열람 허용
    if (!region || !ALL_25_DISTRICTS.includes(region)) return true;
    const buildTeam = SUNAM_DISTRICTS.includes(region) ? '수남구축팀' : '수북구축팀';
    const normTeam = normalizeOrgName(buildTeam);
    return normTeam === targetOrg || normTeam.includes(targetOrg) || targetOrg.includes(normTeam);
  }

  if (role === 'CONTRACTOR') {
    // 도급사가 미분류('-', 공란, '미분류')인 건은 모든 권한에서 열람 허용
    const cat = getContractorCategory(contractor);
    if (!contractor || contractor === '-' || contractor === '미분류' || contractor === '미구분' || cat === '미분류') {
      return true;
    }
    const normContractor = normalizeOrgName(contractor);
    const normCat = normalizeOrgName(cat);
    return (
      normContractor === targetOrg ||
      normCat === targetOrg ||
      normContractor.includes(targetOrg) ||
      targetOrg.includes(normContractor)
    );
  }

  if (role === 'BP') {
    // BP사가 미정/미분류인 건은 열람 허용
    if (!bp || bp === '-' || bp === '협력사 미정' || bp === '미분류' || bp === '미정') {
      return true;
    }
    const normBp = normalizeOrgName(bp);
    return normBp === targetOrg || normBp.includes(targetOrg) || targetOrg.includes(normBp);
  }

  return true;
}

function filterSheetsByRole(resultData, user) {
  const role = normalizeRoleCode(user && user.role);
  if (!user || !user.role || role === 'ADMIN') {
    return resultData;
  }

  const { dict: manualDict, cleanDict: manualCleanDict } = buildManualMapDict(
    resultData.manualMapping
  );

  const resolveMeta = (permitNo, explicitRegion, fallbackCompany) => {
    const pNo = String(permitNo || '').trim();
    const cleanP = cleanForSearch(pNo);
    const mInfo = manualDict[pNo] || manualCleanDict[cleanP] || null;
    const region =
      String(explicitRegion || '').trim() ||
      (pNo.includes('-') ? pNo.split('-')[0].trim() : '');

    let bp = '';
    if (mInfo && mInfo.bp) {
      bp = mInfo.bp;
    } else if (region && DISTRICT_TO_BP[region]) {
      bp = DISTRICT_TO_BP[region];
    } else {
      bp = String(fallbackCompany || '').trim() || '협력사 미정';
    }

    const contractor = mInfo && mInfo.contractor ? mInfo.contractor : '-';
    return { region, bp, contractor };
  };

  // 1. 신청서별허가현황 필터링
  const approvalRows = resultData.approvalStatus || [];
  let filteredApproval = approvalRows;
  if (approvalRows.length > 1) {
    let headerIdx = 0;
    for (let r = 0; r < Math.min(approvalRows.length, 10); r++) {
      const rowStr = (approvalRows[r] || []).map(c => normalizeString(c)).join(' ');
      if (
        rowStr.includes('처리상태') ||
        rowStr.includes('공사명') ||
        rowStr.includes('신청접수일') ||
        rowStr.includes('자치구') ||
        rowStr.includes('허가번호')
      ) {
        headerIdx = r;
        break;
      }
    }

    const headerRow = (approvalRows[headerIdx] || []).map(h => normalizeString(h));
    const findCol = (keywords, defIdx) => {
      for (let i = 0; i < headerRow.length; i++) {
        if (keywords.some(kw => headerRow[i].includes(normalizeString(kw)))) return i;
      }
      return defIdx;
    };

    const regionIdx = findCol(['구청', '지역', '시군구', '자치구', '지자체'], 1);
    const permitIdx = findCol(['허가번호', '신청번호'], 5);

    filteredApproval = approvalRows.filter((row, idx) => {
      if (idx <= headerIdx) return true; // 상단 메타데이터(출력일 등) 및 헤더 유지
      if (!row || row.length === 0) return false;
      const regionVal = String(row[regionIdx] || '').trim();
      const permitNoVal = String(row[5] || row[permitIdx] || '').trim();
      if (!regionVal && !permitNoVal) return false;
      const meta = resolveMeta(permitNoVal, regionVal, '');
      return isRecordPermittedForUser(meta, user);
    });
  }

  // 2. 납부현황목록 필터링
  const paymentRows = resultData.paymentList || [];
  let filteredPayment = paymentRows;
  if (paymentRows.length > 1) {
    let headerIdx = 0;
    for (let r = 0; r < Math.min(paymentRows.length, 10); r++) {
      const rowStr = (paymentRows[r] || []).map(c => normalizeString(c)).join(' ');
      if (rowStr.includes('허가신청번호') || rowStr.includes('고지종류') || rowStr.includes('완납')) {
        headerIdx = r;
        break;
      }
    }
    const headerRow = (paymentRows[headerIdx] || []).map(h => normalizeString(h));
    let permitNoColIdx = 1;
    for (let i = 0; i < headerRow.length; i++) {
      if (headerRow[i].includes('허가번호')) {
        permitNoColIdx = i;
        break;
      }
    }

    filteredPayment = paymentRows.filter((row, idx) => {
      if (idx <= headerIdx) return true;
      if (!row || row.length === 0) return false;
      const permitNoVal = String(row[permitNoColIdx] || '').trim();
      const meta = resolveMeta(permitNoVal, '', '');
      return isRecordPermittedForUser(meta, user);
    });
  }

  // 3. 환수_사후납정리 필터링
  const refundRows = resultData.refundAdjustment || [];
  let filteredRefund = refundRows;
  if (refundRows.length > 1) {
    let headerIdx = 0;
    for (let r = 0; r < Math.min(refundRows.length, 10); r++) {
      const rowStr = (refundRows[r] || []).map(c => normalizeString(c)).join(' ');
      if (rowStr.includes('허가번호') || rowStr.includes('복구주체') || rowStr.includes('면적')) {
        headerIdx = r;
        break;
      }
    }
    const headerRow = (refundRows[headerIdx] || []).map(h => normalizeString(h));
    let permitNoColIdx = 1;
    for (let i = 0; i < headerRow.length; i++) {
      if (headerRow[i].includes('허가번호') || headerRow[i].includes('신청번호')) {
        permitNoColIdx = i;
        break;
      }
    }

    filteredRefund = refundRows.filter((row, idx) => {
      if (idx <= headerIdx) return true;
      if (!row || row.length === 0) return false;
      const permitNoVal = String(row[permitNoColIdx] || '').trim();
      const meta = resolveMeta(permitNoVal, '', '');
      return isRecordPermittedForUser(meta, user);
    });
  }

  return {
    approvalStatus: filteredApproval,
    paymentList: filteredPayment,
    manualMapping: resultData.manualMapping || [],
    refundAdjustment: filteredRefund,
  };
}

const CORS_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGIN || '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

exports.handler = async function (event, context) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  // 1. Authorization Bearer 토큰 검증
  const authHeader =
    (event.headers && (event.headers.authorization || event.headers.Authorization)) || '';
  const bearerToken = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7).trim()
    : '';

  const verifiedUser = verifyToken(bearerToken);
  if (!verifiedUser) {
    return {
      statusCode: 401,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        success: false,
        code: 'UNAUTHORIZED',
        message: '인증 세션이 만료되었거나 유효하지 않습니다. 다시 로그인해 주세요.',
      }),
    };
  }

  try {
    const now = Date.now();
    if (!cachedGoogleToken || now >= cachedGoogleTokenExp - 60000) {
      const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
      const privateKey = process.env.GOOGLE_PRIVATE_KEY
        ? process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n')
        : '';
      const nowSec = Math.floor(now / 1000);
      const header = base64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
      const claim = base64UrlEncode(
        JSON.stringify({
          iss: clientEmail,
          scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
          aud: 'https://oauth2.googleapis.com/token',
          iat: nowSec,
          exp: nowSec + 3600,
        })
      );
      const signingInput = `${header}.${claim}`;
      const signer = crypto.createSign('RSA-SHA256');
      signer.update(signingInput, 'utf8');
      const signature = base64UrlEncode(signer.sign(privateKey));
      const assertion = `${signingInput}.${signature}`;

      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${assertion}`,
      });
      if (!tokenRes.ok) {
        throw new Error(`Google OAuth error (${tokenRes.status})`);
      }
      const tokenData = await tokenRes.json();
      cachedGoogleToken = tokenData.access_token;
      cachedGoogleTokenExp = now + (tokenData.expires_in || 3600) * 1000;
    }

    const spreadsheetId =
      process.env.GOOGLE_SPREADSHEET_ID || '1nhATTYkTWrro8UDRNsUMmjrNbnyZ1LvTfZf9dzllkTY';

    const ranges = [
      '신청서별허가현황!A1:Z',
      '납부현황목록!A1:Z',
      '수동맵핑!A1:Z',
      '환수_사후납정리!A1:Z',
    ];
    const queryParams = ranges.map(r => `ranges=${encodeURIComponent(r)}`).join('&');
    const sheetRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchGet?${queryParams}`,
      {
        headers: { Authorization: `Bearer ${cachedGoogleToken}` },
      }
    );

    if (!sheetRes.ok) {
      throw new Error(`Sheets batchGet error (${sheetRes.status})`);
    }

    const responseData = await sheetRes.json();
    const allData = responseData.valueRanges || [];

    const rawResultData = {
      approvalStatus: (allData[0] && allData[0].values) || [],  // 신청서별허가현황
      paymentList: (allData[1] && allData[1].values) || [],     // 납부현황목록
      manualMapping: (allData[2] && allData[2].values) || [],   // 수동맵핑
      refundAdjustment: (allData[3] && allData[3].values) || [] // 환수사후납정리
    };

    const filteredResultData = filterSheetsByRole(rawResultData, verifiedUser);

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        success: true,
        user: {
          id: verifiedUser.sub,
          name: verifiedUser.name,
          company: verifiedUser.company,
          role: verifiedUser.role,
          scope: verifiedUser.scope,
        },
        data: filteredResultData,
      }),
    };
  } catch (error) {
    console.error('Google Sheets Data Fetch Error:', error);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        success: false,
        message: '데이터를 가져오지 못했습니다. 잠시 후 다시 시도해 주세요.',
      }),
    };
  }
};