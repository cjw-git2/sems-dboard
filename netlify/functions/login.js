const crypto = require('crypto');

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12시간 유효

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

function safeCompare(a, b) {
  const hashA = crypto.createHash('sha256').update(String(a || ''), 'utf8').digest();
  const hashB = crypto.createHash('sha256').update(String(b || ''), 'utf8').digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

function signToken(payloadObj) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payloadObj));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto
    .createHmac('sha256', getAuthSecret())
    .update(signingInput, 'utf8')
    .digest();
  const encodedSignature = base64UrlEncode(signature);
  return `${signingInput}.${encodedSignature}`;
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

    const expectedId = process.env.SEMS_ADMIN_ID || 'semsb2';
    const expectedPw = process.env.SEMS_ADMIN_PW || 'sems!2026';

    const isIdValid = safeCompare(inputId, expectedId);
    const isPwValid = safeCompare(inputPw, expectedPw);

    if (!isIdValid || !isPwValid) {
      return {
        statusCode: 401,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          success: false,
          message: '아이디 또는 비밀번호가 올바르지 않습니다.',
        }),
      };
    }

    const now = Date.now();
    const payload = {
      sub: expectedId,
      role: 'ADMIN',
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
          id: expectedId,
          role: 'ADMIN',
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
