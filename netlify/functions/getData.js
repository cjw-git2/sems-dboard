const crypto = require('crypto');
const { google } = require('googleapis');

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
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY
          ? process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n')
          : '',
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });

    const sheets = google.sheets({ version: 'v4', auth });

    const spreadsheetId =
      process.env.GOOGLE_SPREADSHEET_ID || '1nhATTYkTWrro8UDRNsUMmjrNbnyZ1LvTfZf9dzllkTY';

    const response = await sheets.spreadsheets.values.batchGet({
      spreadsheetId,
      ranges: [
        '신청서별허가현황!A1:Z',
        '납부현황목록!A1:Z',
        '수동맵핑!A1:Z',
        '환수_사후납정리!A1:Z',
      ],
    });

    const allData = response.data.valueRanges;

    const resultData = {
      approvalStatus: allData[0].values || [],  // 신청서별허가현황
      paymentList: allData[1].values || [],     // 납부현황목록
      manualMapping: allData[2].values || [],   // 수동맵핑
      refundAdjustment: allData[3].values || [] // 환수사후납정리
    };

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: true, data: resultData }),
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