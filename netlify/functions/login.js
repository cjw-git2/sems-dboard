const crypto = require('crypto');

const TOKEN_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours
const DEFAULT_ACCOUNT_SHEET_ID = '1QnSSDSwvqK4sGFuc8czSKafb8BVh3WcFfH5f1D4g3Dk';
const LOGIN_HISTORY_TAB_NAME = '접속이력';

// In-memory Google OAuth2 Access Token Cache
let cachedGoogleToken = null;
let cachedGoogleTokenExp = 0;

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

async function getGoogleAccessToken() {
  const now = Date.now();
  if (cachedGoogleToken && now < cachedGoogleTokenExp - 60000) {
    return cachedGoogleToken;
  }

  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY
    ? process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n')
    : '';

  const nowSec = Math.floor(now / 1000);
  const header = base64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = base64UrlEncode(
    JSON.stringify({
      iss: clientEmail,
      scope: 'https://www.googleapis.com/auth/spreadsheets',
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

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${assertion}`,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Google OAuth error (${res.status}): ${errText}`);
  }

  const data = await res.json();
  cachedGoogleToken = data.access_token;
  cachedGoogleTokenExp = now + (data.expires_in || 3600) * 1000;
  return cachedGoogleToken;
}

async function sheetsGetValues(accessToken, spreadsheetId, range) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Sheets GET failed (${res.status}): ${await res.text()}`);
  }
  return res.json();
}

async function sheetsUpdateValues(accessToken, spreadsheetId, range, values) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ values }),
  });
  if (!res.ok) {
    throw new Error(`Sheets UPDATE failed (${res.status}): ${await res.text()}`);
  }
  return res.json();
}

async function sheetsAppendValues(accessToken, spreadsheetId, range, values) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ values }),
  });
  if (!res.ok) {
    throw new Error(`Sheets APPEND failed (${res.status}): ${await res.text()}`);
  }
  return res.json();
}

function signToken(payload) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = base64UrlEncode(
    crypto.createHmac('sha256', getAuthSecret()).update(signingInput, 'utf8').digest()
  );
  return `${signingInput}.${signature}`;
}

function safeCompare(a, b) {
  const hashA = crypto.createHash('sha256').update(String(a || ''), 'utf8').digest();
  const hashB = crypto.createHash('sha256').update(String(b || ''), 'utf8').digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

function verifyPassword(inputPw, storedPw) {
  const rawInput = String(inputPw || '').trim();
  const rawStored = String(storedPw || '').trim();
  if (!rawInput || !rawStored) return false;

  if (/^[a-f0-9]{64}$/i.test(rawStored)) {
    const inputSha256 = crypto
      .createHash('sha256')
      .update(rawInput, 'utf8')
      .digest('hex')
      .toLowerCase();
    return safeCompare(inputSha256, rawStored.toLowerCase());
  }

  return safeCompare(rawInput, rawStored);
}

function normalizeHeader(str) {
  return String(str || '').replace(/\s+/g, '').toLowerCase();
}

function parseRoleAndLabel(rawVal) {
  const val = String(rawVal || '')
    .replace(/\s+/g, '')
    .toUpperCase();
  if (val === '전체' || val === 'ADMIN' || val === 'ALL') {
    return { role: 'ADMIN', roleLabel: '전체' };
  }
  if (val === '소속구축팀' || val === '구축팀' || val === 'TEAM') {
    return { role: 'TEAM', roleLabel: '소속구축팀' };
  }
  if (val === '소속도급사' || val === '도급사' || val === 'CONTRACTOR') {
    return { role: 'CONTRACTOR', roleLabel: '소속도급사' };
  }
  if (val === '소속BP' || val === '소속BP사' || val === 'BP' || val === '협력사') {
    return { role: 'BP', roleLabel: '소속BP' };
  }
  return { role: '', roleLabel: '' };
}

function getKstTimestampString() {
  const now = new Date();
  const kstTime = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const yyyy = kstTime.getUTCFullYear();
  const mm = String(kstTime.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(kstTime.getUTCDate()).padStart(2, '0');
  const hh = String(kstTime.getUTCHours()).padStart(2, '0');
  const min = String(kstTime.getUTCMinutes()).padStart(2, '0');
  const sec = String(kstTime.getUTCSeconds()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${min}:${sec}`;
}

async function fetchAccountListFromSheet(accessToken) {
  const spreadsheetId =
    process.env.GOOGLE_ACCOUNT_SPREADSHEET_ID || DEFAULT_ACCOUNT_SHEET_ID;

  const response = await sheetsGetValues(accessToken, spreadsheetId, 'A1:G500');
  const rows = response.values || [];
  if (rows.length <= 1) return [];

  const headerRow = rows[0].map(normalizeHeader);
  const findIdx = (keywords, defIdx) => {
    for (let i = 0; i < headerRow.length; i++) {
      if (keywords.some(kw => headerRow[i].includes(kw))) return i;
    }
    return defIdx;
  };

  const idIdx = findIdx(['아이디', 'username', 'id'], 0);
  const pwIdx = findIdx(['비밀번호', 'password', 'pw'], 1);
  const nameIdx = findIdx(['사용자명', '이름', '성명'], 2);
  const companyIdx = findIdx(['소속', 'company', '부서', '업체'], 3);
  const roleIdx = findIdx(['권한_열람범위', '권한등급', '권한', '열람범위', 'role'], 4);
  const activeIdx = findIdx(['사용여부', '활성', 'active'], 5);
  const lastLoginIdx = findIdx(['최근접속일시', 'last_login', '접속일시'], 6);

  const APPROVED_VALUES = ['Y', 'TRUE', '1', '승인', '허용', '사용'];
  const REJECTED_VALUES = ['N', 'FALSE', '0', '중지', '비활성', '미사용', '반려', '거절'];

  const accounts = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.length === 0) continue;

    const username = String(row[idIdx] || '').trim();
    if (!username) continue;

    const password = String(row[pwIdx] || '').trim();
    const name = String(row[nameIdx] || '').trim() || username;
    const company = String(row[companyIdx] || '').trim();
    const rawRoleCell = String(row[roleIdx] || '').trim();
    const activeVal = String(row[activeIdx] || '').trim().toUpperCase();

    const { role, roleLabel } = parseRoleAndLabel(rawRoleCell);
    const hasValidRole = Boolean(role);

    let approvalStatus = 'PENDING';
    if (REJECTED_VALUES.includes(activeVal)) {
      approvalStatus = 'REJECTED';
    } else if (hasValidRole && APPROVED_VALUES.includes(activeVal)) {
      approvalStatus = 'APPROVED';
    }

    const effectiveAffiliation = role === 'ADMIN' ? 'ALL' : company || '';

    accounts.push({
      rowNumber: r + 1,
      lastLoginColLetter: String.fromCharCode(65 + lastLoginIdx),
      username,
      password,
      name,
      company,
      role: role || 'BP',
      roleLabel: roleLabel || '소속BP',
      scope: effectiveAffiliation,
      approvalStatus,
      isActive: approvalStatus === 'APPROVED',
    });
  }

  return accounts;
}

async function recordLoginHistory(accessToken, account, clientIp) {
  const spreadsheetId =
    process.env.GOOGLE_ACCOUNT_SPREADSHEET_ID || DEFAULT_ACCOUNT_SHEET_ID;
  const loginTimeStr = getKstTimestampString();

  const tasks = [];

  if (account.rowNumber) {
    const colLetter = account.lastLoginColLetter || 'G';
    tasks.push(
      sheetsUpdateValues(
        accessToken,
        spreadsheetId,
        `${colLetter}${account.rowNumber}`,
        [[loginTimeStr]]
      ).catch(err => console.warn('Failed to update last_login cell:', err.message))
    );
  }

  const logRow = [
    loginTimeStr,
    account.username,
    account.name,
    account.company || '-',
    account.roleLabel || account.role,
    clientIp || '-',
  ];

  tasks.push(
    sheetsAppendValues(
      accessToken,
      spreadsheetId,
      `${LOGIN_HISTORY_TAB_NAME}!A1:F1`,
      [logRow]
    ).catch(err => console.warn('Failed to append login history:', err.message))
  );

  await Promise.allSettled(tasks);
}

const CORS_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGIN || '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: false, message: '허용되지 않는 요청 방식입니다.' }),
    };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const inputId = String(body.id || '').trim();
    const inputPw = String(body.password || '').trim();

    if (!inputId || !inputPw) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({ success: false, message: '아이디와 비밀번호를 모두 입력해 주세요.' }),
      };
    }

    let accessToken = '';
    let accounts = [];
    try {
      accessToken = await getGoogleAccessToken();
      accounts = await fetchAccountListFromSheet(accessToken);
    } catch (sheetErr) {
      console.error('Failed to read SEMS_계정관리 sheet, using fallback admin:', sheetErr.message);
      accounts = [
        {
          rowNumber: null,
          username: process.env.SEMS_ADMIN_ID || 'semsb2',
          password: process.env.SEMS_ADMIN_PW || 'sems!2026',
          name: '관리자',
          company: '전체',
          role: 'ADMIN',
          roleLabel: '전체',
          scope: 'ALL',
          approvalStatus: 'APPROVED',
          isActive: true,
        },
      ];
    }

    const matchedAccount = accounts.find(acc => safeCompare(inputId, acc.username));

    if (!matchedAccount || !verifyPassword(inputPw, matchedAccount.password)) {
      return {
        statusCode: 401,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          success: false,
          message: '아이디 또는 비밀번호가 올바르지 않습니다.',
        }),
      };
    }

    if (matchedAccount.approvalStatus === 'PENDING') {
      return {
        statusCode: 403,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          success: false,
          code: 'PENDING_APPROVAL',
          message: '현재 관리자 승인 대기 중인 계정입니다.',
        }),
      };
    }

    if (matchedAccount.approvalStatus === 'REJECTED' || !matchedAccount.isActive) {
      return {
        statusCode: 403,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          success: false,
          code: 'ACCOUNT_DISABLED',
          message: '사용이 중지되었거나 반려된 계정입니다. 시스템 관리자에게 문의해 주세요.',
        }),
      };
    }

    if (accessToken) {
      const headers = event.headers || {};
      const rawIp =
        headers['x-nf-client-connection-ip'] ||
        headers['x-forwarded-for'] ||
        headers['client-ip'] ||
        '127.0.0.1';
      const clientIp = String(rawIp).split(',')[0].trim();

      await recordLoginHistory(accessToken, matchedAccount, clientIp);
    }

    const now = Date.now();
    const payload = {
      sub: matchedAccount.username,
      name: matchedAccount.name,
      company: matchedAccount.company,
      role: matchedAccount.role,
      roleLabel: matchedAccount.roleLabel,
      scope: matchedAccount.scope,
      iat: now,
      exp: now + TOKEN_TTL_MS,
    };

    const token = signToken(payload);

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        success: true,
        token,
        user: {
          id: matchedAccount.username,
          name: matchedAccount.name,
          company: matchedAccount.company,
          role: matchedAccount.role,
          roleLabel: matchedAccount.roleLabel,
          scope: matchedAccount.scope,
          expiresAt: payload.exp,
        },
      }),
    };
  } catch (error) {
    console.error('Login error:', error);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        success: false,
        message: '로그인 처리 중 서버 오류가 발생했습니다.',
      }),
    };
  }
};
