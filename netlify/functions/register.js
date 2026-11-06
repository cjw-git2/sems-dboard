const crypto = require('crypto');

const DEFAULT_ACCOUNT_SHEET_ID = '1QnSSDSwvqK4sGFuc8czSKafb8BVh3WcFfH5f1D4g3Dk';

const CORS_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGIN || '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// In-memory Google OAuth2 Access Token Cache (eliminates repeated token round-trips)
let cachedGoogleToken = null;
let cachedGoogleTokenExp = 0;

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

function normalizeHeader(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/\s+/g, '');
}

function normalizeRoleCode(rawVal) {
  const val = String(rawVal || '')
    .replace(/\s+/g, '')
    .toUpperCase();
  if (val === '전체' || val === 'ADMIN' || val === 'ALL') return 'ADMIN';
  if (val === '소속구축팀' || val === '구축팀' || val === 'TEAM') return 'TEAM';
  if (val === '소속도급사' || val === '도급사' || val === 'CONTRACTOR') return 'CONTRACTOR';
  if (val === '소속BP' || val === '소속BP사' || val === 'BP' || val === '협력사') return 'BP';
  return '';
}

function getKstTimestampString() {
  const now = new Date();
  const kstTime = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const yyyy = kstTime.getUTCFullYear();
  const mm = String(kstTime.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(kstTime.getUTCDate()).padStart(2, '0');
  const hh = String(kstTime.getUTCHours()).padStart(2, '0');
  const min = String(kstTime.getUTCMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

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
    const inputName = String(body.name || '').trim();
    const inputCompany = String(body.company || '').trim();

    if (!inputId || !inputPw || !inputName || !inputCompany) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          success: false,
          message: '아이디, 비밀번호, 사용자명, 소속을 모두 입력해 주세요.',
        }),
      };
    }

    if (!/^[a-zA-Z0-9_.\-]{3,30}$/.test(inputId)) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          success: false,
          message: '아이디는 영문, 숫자, 밑줄(_), 하이픈(-) 조합 3~30자로 입력해 주세요.',
        }),
      };
    }

    if (inputPw.length < 4) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          success: false,
          message: '비밀번호는 최소 4자 이상 입력해 주세요.',
        }),
      };
    }

    const spreadsheetId =
      process.env.GOOGLE_ACCOUNT_SPREADSHEET_ID || DEFAULT_ACCOUNT_SHEET_ID;
    const accessToken = await getGoogleAccessToken();

    // 1. 기존 시트 데이터를 조회하여 아이디 중복 여부 확인 (A1:G500)
    const readRes = await sheetsGetValues(accessToken, spreadsheetId, 'A1:G500');
    const rows = readRes.values || [];

    let idIdx = 0;
    let roleIdx = 4;
    let activeIdx = 5;

    if (rows.length > 0) {
      const headerRow = rows[0].map(normalizeHeader);
      const findIdx = (keywords, defIdx) => {
        for (let i = 0; i < headerRow.length; i++) {
          if (keywords.some(kw => headerRow[i].includes(kw))) return i;
        }
        return defIdx;
      };
      idIdx = findIdx(['아이디', 'username', 'id'], 0);
      roleIdx = findIdx(['권한_열람범위', '권한등급', '권한', '열람범위', 'role'], 4);
      activeIdx = findIdx(['사용여부', '활성', 'active'], 5);
    }

    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row || row.length === 0) continue;
      const existingId = String(row[idIdx] || '').trim();
      if (existingId && existingId.toLowerCase() === inputId.toLowerCase()) {
        const existingRole = normalizeRoleCode(row[roleIdx]);
        const existingActive = String(row[activeIdx] || '').trim().toUpperCase();
        const isApproved =
          Boolean(existingRole) &&
          ['Y', 'TRUE', '1', '승인', '허용', '사용'].includes(existingActive);

        return {
          statusCode: 409,
          headers: CORS_HEADERS,
          body: JSON.stringify({
            success: false,
            message: isApproved
              ? '이미 등록되어 사용 중인 아이디입니다. 다른 아이디를 입력해 주세요.'
              : '이미 승인 요청이 접수되어 관리자 승인 대기 중인 아이디입니다.',
          }),
        };
      }
    }

    // 2. 비밀번호 SHA-256 해시 변환
    const passwordHash = crypto
      .createHash('sha256')
      .update(inputPw, 'utf8')
      .digest('hex');

    const kstNow = getKstTimestampString();
    const reqTimestamp = `승인요청(${kstNow})`;

    // 3. SEMS_계정관리 시트(7열 구조 A~G)에 신규 승인 요청 행 추가
    const newRow = [
      inputId,
      passwordHash,
      inputName,
      inputCompany,
      '', // E열: 관리자가 [전체 / 소속구축팀 / 소속도급사 / 소속BP] 입력
      '', // F열: 관리자가 [Y] 입력 시 승인 완료
      reqTimestamp, // G열: 승인요청 시각 기록
    ];

    await sheetsAppendValues(accessToken, spreadsheetId, 'A1:G1', [newRow]);

    // 4. 관리자 이메일 알림 발송 (외부 배포 환경에서는 웹훅 즉시 호출, 사내망 차단 시 구글 시트 트리거가 자동 발송)
    const webhookUrl =
      process.env.GOOGLE_APPS_SCRIPT_WEBHOOK_URL ||
      'https://script.google.com/macros/s/AKfycbzUoTpXG22QdWj27GYUikMAn-Lt4GKvyfzRV2S1e3WfQziMfQK-vZ-JZfxb-sAJRLA_/exec';
    const adminEmails =
      process.env.ADMIN_NOTIFY_EMAILS || 'jw777@sk.com, LEE105233@sktns.com';
    const notifyPayload = {
      recipients: adminEmails,
      id: inputId,
      name: inputName,
      company: inputCompany,
      requestedAt: kstNow,
      sheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
    };

    let emailDispatched = false;
    if (webhookUrl) {
      try {
        const res = await fetch(webhookUrl, {
          method: 'POST',
          redirect: 'manual',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(notifyPayload),
          signal: AbortSignal.timeout(1500),
        });
        if (res.ok || (res.status >= 300 && res.status < 400)) {
          emailDispatched = true;
        }
      } catch (_) {
        // 사내망(ePrism) 등에서 script.google.com 접근이 차단된 경우 구글 클라우드 내 트리거가 발송을 처리함
      }
    }

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        success: true,
        emailDispatched,
        message: '계정 승인 요청이 정상적으로 접수되었습니다. 관리자 승인 후 접속하실 수 있습니다.',
      }),
    };
  } catch (error) {
    console.error('Account registration error:', error);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        success: false,
        message: '승인 요청 처리 중 서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
      }),
    };
  }
};
