/**
 * SEMS (Seoul Excavation Management System)
 * Account Management, Authentication & Role-Based Access Control Module (auth.js)
 * Separated from main dashboard logic (app.js) for modular testing & maintenance
 */

const AUTH_SESSION_KEY = 'SEMS_AUTH_SESSION_TOKEN';
let currentUser = null;

function getAuthToken() {
  return (
    sessionStorage.getItem(AUTH_SESSION_KEY) ||
    localStorage.getItem(AUTH_SESSION_KEY) ||
    ''
  );
}

function decodeTokenPayload(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    let base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4 !== 0) base64 += '=';
    const binaryStr = atob(base64);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    const jsonStr = new TextDecoder('utf-8').decode(bytes);
    return JSON.parse(jsonStr);
  } catch (e) {
    return null;
  }
}

function isTokenFormatValid(token) {
  const payload = decodeTokenPayload(token);
  if (!payload || !payload.exp || Date.now() > payload.exp) return false;
  return true;
}

function normalizeOrgName(str) {
  if (!str) return '';
  return String(str)
    .replace(/\(주\)|（주）|㈜|\s+/g, '')
    .toUpperCase()
    .trim();
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

function updateUserRoleBadge() {
  const badge = document.getElementById('userRoleBadge');
  const badgeText = document.getElementById('userRoleBadgeText');
  if (!badge || !badgeText) return;

  if (!currentUser) {
    badge.style.display = 'none';
    return;
  }

  const role = normalizeRoleCode(currentUser.role);
  const roleColors = {
    ADMIN: { bg: '#eff6ff', color: '#1d4ed8', border: '#bfdbfe', label: '전체' },
    TEAM: { bg: '#faf5ff', color: '#7e22ce', border: '#e9d5ff', label: '소속구축팀' },
    CONTRACTOR: { bg: '#ecfdf5', color: '#047857', border: '#a7f3d0', label: '소속도급사' },
    BP: { bg: '#fff7ed', color: '#c2410c', border: '#fed7aa', label: '소속BP' },
  };
  const style = roleColors[role] || roleColors.BP;
  const safeFn = typeof escapeHtml === 'function' ? escapeHtml : s => String(s || '');
  const badgeLabel = safeFn(currentUser.roleLabel || style.label);
  const userName = safeFn(currentUser.name || currentUser.id || '');
  const userComp = safeFn(currentUser.company || currentUser.scope || '전체');

  badge.style.display = 'inline-flex';
  badgeText.innerHTML = `
    <span style="background:${style.bg}; color:${style.color}; border:1px solid ${style.border}; padding:1px 6px; border-radius:5px; font-size:0.7rem; font-weight:800; margin-right:4px;">${badgeLabel}</span>
    <span>${userName}</span>
    <span style="color:#64748b; font-weight:600; font-size:0.72rem;">(${userComp})</span>
  `;
}

function isRecordPermittedForCurrentUser(recordMeta) {
  const role = normalizeRoleCode(currentUser && currentUser.role);
  if (!currentUser || !currentUser.role || role === 'ADMIN') return true;

  const targetOrg = normalizeOrgName(currentUser.company || currentUser.scope || '');
  if (!targetOrg || targetOrg === 'ALL' || targetOrg === '전체') return true;

  const region = String(recordMeta.region || '').trim();
  const bp = String(recordMeta.company || recordMeta.bp || '').trim();
  const contractor = String(recordMeta.contractor || '').trim();

  if (role === 'TEAM') {
    if (!region || !ALL_25_DISTRICTS.includes(region)) return true;
    const buildTeam = getBuildTeam(region);
    const normTeam = normalizeOrgName(buildTeam);
    return normTeam === targetOrg || normTeam.includes(targetOrg) || targetOrg.includes(normTeam);
  }

  if (role === 'CONTRACTOR') {
    const cat = typeof getContractorCategory === 'function' ? getContractorCategory(contractor) : contractor;
    if (
      !contractor ||
      contractor === '-' ||
      contractor === '미분류' ||
      contractor === '미구분' ||
      cat === '미분류'
    ) {
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
    if (!bp || bp === '-' || bp === '협력사 미정' || bp === '미분류' || bp === '미정') {
      return true;
    }
    const normBp = normalizeOrgName(bp);
    return normBp === targetOrg || normBp.includes(targetOrg) || targetOrg.includes(normBp);
  }

  return true;
}

function isPermitNoPermittedForCurrentUser(permitNo, fallbackRegion = '') {
  const role = normalizeRoleCode(currentUser && currentUser.role);
  if (!currentUser || role === 'ADMIN') return true;
  const pNo = String(permitNo || '').trim();
  const cleanP = typeof cleanForSearch === 'function' ? cleanForSearch(pNo) : pNo;
  if (typeof rawData !== 'undefined' && rawData.length > 0 && cleanP) {
    const match = rawData.find(r => cleanForSearch(r.permitNo) === cleanP);
    if (match) {
      return isRecordPermittedForCurrentUser(match);
    }
  }
  const regionVal = fallbackRegion || (pNo.includes('-') ? pNo.split('-')[0].trim() : '');
  const bpResult =
    typeof resolveBPCompany === 'function'
      ? resolveBPCompany(regionVal, '', pNo)
      : { company: '협력사 미정' };
  const cDetails =
    typeof resolveContractorDetails === 'function'
      ? resolveContractorDetails(pNo)
      : { contractor: '-' };
  return isRecordPermittedForCurrentUser({
    region: regionVal,
    company: bpResult.company,
    contractor: cDetails.contractor,
  });
}

function checkAuthentication() {
  const token = getAuthToken();
  const loginOverlay = document.getElementById('loginModalOverlay');
  const appContainer = document.getElementById('dashboardAppContainer');

  if (isTokenFormatValid(token)) {
    const payload = decodeTokenPayload(token);
    currentUser = payload
      ? {
          id: payload.sub,
          name: payload.name || payload.sub,
          company: payload.company || '',
          role: normalizeRoleCode(payload.role),
          roleLabel: payload.roleLabel || '',
          scope: payload.scope || 'ALL',
        }
      : null;
    updateUserRoleBadge();
    if (loginOverlay) loginOverlay.style.display = 'none';
    if (appContainer) appContainer.style.display = 'flex';
    return true;
  } else {
    currentUser = null;
    updateUserRoleBadge();
    sessionStorage.removeItem(AUTH_SESSION_KEY);
    localStorage.removeItem(AUTH_SESSION_KEY);
    if (loginOverlay) loginOverlay.style.display = 'flex';
    if (appContainer) appContainer.style.display = 'none';
    return false;
  }
}

function switchAuthModalTab(tabMode) {
  const loginForm = document.getElementById('loginForm');
  const registerForm = document.getElementById('registerForm');
  const registerFormFields = document.getElementById('registerFormFields');
  const registerSuccessView = document.getElementById('registerSuccessView');
  const tabLoginBtn = document.getElementById('tabBtnLogin');
  const tabRegisterBtn = document.getElementById('tabBtnRegister');
  const loginErr = document.getElementById('loginErrorMessage');
  const regMsg = document.getElementById('registerFeedbackMessage');

  if (loginErr) loginErr.style.display = 'none';
  if (regMsg) regMsg.style.display = 'none';
  toggleRegisterPasswordVisibility(false);

  if (tabMode === 'REGISTER') {
    if (loginForm) loginForm.style.display = 'none';
    if (registerForm) registerForm.style.display = 'flex';
    if (registerFormFields) registerFormFields.style.display = 'flex';
    if (registerSuccessView) registerSuccessView.style.display = 'none';
    if (tabLoginBtn) {
      tabLoginBtn.style.background = 'transparent';
      tabLoginBtn.style.color = '#64748b';
      tabLoginBtn.style.boxShadow = 'none';
    }
    if (tabRegisterBtn) {
      tabRegisterBtn.style.background = '#ffffff';
      tabRegisterBtn.style.color = '#2563eb';
      tabRegisterBtn.style.boxShadow = '0 1px 3px rgba(15, 23, 42, 0.1)';
    }
  } else {
    if (loginForm) loginForm.style.display = 'flex';
    if (registerForm) registerForm.style.display = 'none';
    if (registerFormFields) registerFormFields.style.display = 'flex';
    if (registerSuccessView) registerSuccessView.style.display = 'none';
    if (tabLoginBtn) {
      tabLoginBtn.style.background = '#ffffff';
      tabLoginBtn.style.color = '#2563eb';
      tabLoginBtn.style.boxShadow = '0 1px 3px rgba(15, 23, 42, 0.1)';
    }
    if (tabRegisterBtn) {
      tabRegisterBtn.style.background = 'transparent';
      tabRegisterBtn.style.color = '#64748b';
      tabRegisterBtn.style.boxShadow = 'none';
    }
  }
}

function toggleRegisterPasswordVisibility(show) {
  const pwInput = document.getElementById('regPassword');
  const pwConfirmInput = document.getElementById('regPasswordConfirm');
  const chk = document.getElementById('regShowPassword');
  const targetType = show ? 'text' : 'password';
  if (pwInput) pwInput.type = targetType;
  if (pwConfirmInput) pwConfirmInput.type = targetType;
  if (chk && chk.checked !== Boolean(show)) chk.checked = Boolean(show);
}

function handleRegisterCompanySelectChange() {
  const selectEl = document.getElementById('regCompanySelect');
  const customWrapper = document.getElementById('regCompanyCustomWrapper');
  const customInput = document.getElementById('regCompanyCustom');
  if (!selectEl || !customWrapper || !customInput) return;

  if (selectEl.value === 'DIRECT_INPUT') {
    customWrapper.style.display = 'block';
    customInput.required = true;
    customInput.focus();
  } else {
    customWrapper.style.display = 'none';
    customInput.required = false;
    customInput.value = '';
  }
}

async function handleLoginSubmit(e) {
  e.preventDefault();
  const idInput = document.getElementById('loginId').value.trim();
  const pwInput = document.getElementById('loginPassword').value.trim();
  const errBox = document.getElementById('loginErrorMessage');
  const errText = document.getElementById('loginErrorText');
  const submitBtn = document.querySelector('#loginForm button[type="submit"]');
  const submitSpan = submitBtn ? submitBtn.querySelector('span') : null;
  const origBtnText = submitSpan ? submitSpan.textContent : '대시보드 접속하기';

  if (submitBtn) {
    if (submitBtn.disabled) return;
    submitBtn.disabled = true;
    submitBtn.style.opacity = '0.7';
    submitBtn.style.cursor = 'wait';
    if (submitSpan) submitSpan.textContent = '인증 확인 중...';
  }
  if (errBox) errBox.style.display = 'none';

  try {
    const response = await fetch('/.netlify/functions/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: idInput, password: pwInput }),
    });
    const result = await response.json();

    if (response.ok && result.success && result.token) {
      sessionStorage.setItem(AUTH_SESSION_KEY, result.token);
      errBox.style.display = 'none';
      document.getElementById('loginPassword').value = '';
      checkAuthentication();
      if (typeof resetFilters === 'function') resetFilters();
      if (typeof confetti === 'function') {
        confetti({ particleCount: 80, spread: 70, origin: { y: 0.6 } });
      }
      if (typeof fetchDashboardData === 'function') fetchDashboardData();
    } else {
      errBox.style.display = 'flex';
      if (result.code === 'PENDING_APPROVAL') {
        errBox.style.background = '#fffbeb';
        errBox.style.borderColor = '#fde68a';
        errBox.style.color = '#b45309';
      } else {
        errBox.style.background = '#fef2f2';
        errBox.style.borderColor = '#fecaca';
        errBox.style.color = '#dc2626';
      }
      errText.textContent = result.message || '아이디 또는 비밀번호가 올바르지 않습니다.';
    }
  } catch (err) {
    console.error('Login request failed:', err);
    errBox.style.display = 'flex';
    errText.textContent = '로그인 서버와 통신할 수 없습니다. 잠시 후 다시 시도해 주세요.';
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.style.opacity = '1';
      submitBtn.style.cursor = 'pointer';
      if (submitSpan) submitSpan.textContent = origBtnText;
    }
  }
}

async function handleRegisterSubmit(e) {
  e.preventDefault();
  const submitBtn = document.getElementById('btnSubmitRegister');
  if (submitBtn && submitBtn.disabled) return;

  const regId = document.getElementById('regId').value.trim();
  const regPw = document.getElementById('regPassword').value.trim();
  const regPwConfirm = document.getElementById('regPasswordConfirm').value.trim();
  const regName = document.getElementById('regName').value.trim();
  const selectCompany = document.getElementById('regCompanySelect').value;
  const customCompany = document.getElementById('regCompanyCustom').value.trim();
  const regCompany = selectCompany === 'DIRECT_INPUT' ? customCompany : selectCompany;

  const feedbackBox = document.getElementById('registerFeedbackMessage');
  const feedbackText = document.getElementById('registerFeedbackText');
  const registerFormFields = document.getElementById('registerFormFields');
  const registerSuccessView = document.getElementById('registerSuccessView');
  const registerSuccessText = document.getElementById('registerSuccessText');
  const submitSpan = submitBtn ? submitBtn.querySelector('span') : null;
  const origBtnText = submitSpan ? submitSpan.textContent : '계정 승인 요청하기';

  const showFeedback = (msg, isSuccess) => {
    if (!feedbackBox || !feedbackText) return;
    feedbackBox.style.display = 'flex';
    if (isSuccess) {
      feedbackBox.style.background = '#ecfdf5';
      feedbackBox.style.borderColor = '#a7f3d0';
      feedbackBox.style.color = '#047857';
    } else {
      feedbackBox.style.background = '#fef2f2';
      feedbackBox.style.borderColor = '#fecaca';
      feedbackBox.style.color = '#dc2626';
    }
    feedbackText.textContent = msg;
  };

  if (!regId || !regPw || !regName || !regCompany) {
    showFeedback('아이디, 비밀번호, 사용자명, 소속을 모두 입력해 주세요.', false);
    return;
  }

  if (regPw !== regPwConfirm) {
    showFeedback('비밀번호와 비밀번호 확인이 일치하지 않습니다.', false);
    return;
  }

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.style.opacity = '0.7';
    submitBtn.style.cursor = 'wait';
    if (submitSpan) submitSpan.textContent = '승인 요청 처리 중...';
  }
  if (feedbackBox) feedbackBox.style.display = 'none';

  try {
    const response = await fetch('/.netlify/functions/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: regId,
        password: regPw,
        name: regName,
        company: regCompany,
      }),
    });
    const result = await response.json();

    if (response.ok && result.success) {
      const loginIdEl = document.getElementById('loginId');
      if (loginIdEl) loginIdEl.value = regId;

      document.getElementById('registerForm').reset();
      toggleRegisterPasswordVisibility(false);
      handleRegisterCompanySelectChange();
      if (feedbackBox) feedbackBox.style.display = 'none';

      // 신청 완료 시 입력 폼을 닫고 완료 확인 화면 표시
      if (registerFormFields && registerSuccessView) {
        if (registerSuccessText) {
          registerSuccessText.textContent =
            result.message ||
            '계정 승인 요청이 정상적으로 접수되었습니다. 관리자가 권한_열람범위 및 사용여부를 승인한 후 접속하실 수 있습니다.';
        }
        registerFormFields.style.display = 'none';
        registerSuccessView.style.display = 'flex';
      } else {
        switchAuthModalTab('LOGIN');
      }
    } else {
      showFeedback(result.message || '승인 요청 처리에 실패했습니다.', false);
    }
  } catch (err) {
    console.error('Register request failed:', err);
    showFeedback('서버와 통신할 수 없습니다. 잠시 후 다시 시도해 주세요.', false);
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.style.opacity = '1';
      submitBtn.style.cursor = 'pointer';
      if (submitSpan) submitSpan.textContent = origBtnText;
    }
  }
}

function handleLogout() {
  if (confirm('대시보드에서 로그아웃 하시겠습니까?')) {
    sessionStorage.removeItem(AUTH_SESSION_KEY);
    localStorage.removeItem(AUTH_SESSION_KEY);
    currentUser = null;
    if (typeof rawData !== 'undefined') rawData = [];
    if (typeof filteredData !== 'undefined') filteredData = [];
    if (typeof paymentData !== 'undefined') paymentData = [];
    if (typeof refundPostpayData !== 'undefined') refundPostpayData = [];
    checkAuthentication();
  }
}
