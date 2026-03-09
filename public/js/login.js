import { AUTH_TOKEN_KEY, AUTH_ERROR_KEY } from './state.js';
import * as api from './api.js';

const ALLOWED_NEXT_PREFIXES = ['/rt', '/a/', '/b/'];

function byId(id) {
  return document.getElementById(id);
}

const elements = {
  tabLogin: byId('tabLogin'),
  tabSignup: byId('tabSignup'),
  loginPanel: byId('loginPanel'),
  signupPanel: byId('signupPanel'),
  loginForm: byId('loginForm'),
  signupForm: byId('signupForm'),
  loginEmail: byId('loginEmail'),
  loginPassword: byId('loginPassword'),
  signupEmail: byId('signupEmail'),
  signupPassword: byId('signupPassword'),
  signupNickname: byId('signupNickname'),
  loginSubmitBtn: byId('loginSubmitBtn'),
  signupSubmitBtn: byId('signupSubmitBtn'),
  loginMessage: byId('loginMessage'),
};

function getStoredToken() {
  return String(localStorage.getItem(AUTH_TOKEN_KEY) || '').trim();
}

function setStoredToken(token) {
  const value = String(token || '').trim();
  if (!value) {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    return;
  }
  localStorage.setItem(AUTH_TOKEN_KEY, value);
}

function consumeAuthErrorMessage() {
  const value = String(sessionStorage.getItem(AUTH_ERROR_KEY) || '').trim();
  if (!value) return '';
  sessionStorage.removeItem(AUTH_ERROR_KEY);
  return value;
}

function sanitizeNext(rawNext) {
  const value = String(rawNext || '').trim();
  if (!value.startsWith('/')) return '/rt';
  if (value.startsWith('//')) return '/rt';
  if (!ALLOWED_NEXT_PREFIXES.some((prefix) => value === prefix.slice(0, -1) || value.startsWith(prefix))) {
    return '/rt';
  }
  return value;
}

function getNextPath() {
  const params = new URLSearchParams(location.search);
  return sanitizeNext(params.get('next'));
}

function navigateToNext() {
  location.assign(getNextPath());
}

function setMessage(message, type = 'default') {
  elements.loginMessage.textContent = String(message || '');
  elements.loginMessage.className = 'message';
  if (type === 'error') elements.loginMessage.classList.add('error');
  if (type === 'success') elements.loginMessage.classList.add('success');
}

function setSubmitting(button, submitting) {
  button.disabled = submitting;
  if (submitting) {
    button.dataset.original = button.textContent;
    button.textContent = 'Processing...';
    return;
  }
  if (button.dataset.original) {
    button.textContent = button.dataset.original;
  }
}

function setTab(mode) {
  const loginMode = mode !== 'signup';
  elements.tabLogin.classList.toggle('active', loginMode);
  elements.tabSignup.classList.toggle('active', !loginMode);
  elements.loginPanel.classList.toggle('active', loginMode);
  elements.signupPanel.classList.toggle('active', !loginMode);
  setMessage('');
}

async function ensureAlreadyAuthenticatedRedirect() {
  const token = getStoredToken();
  if (!token) return;
  try {
    api.setAccessToken(token);
    await api.me();
    navigateToNext();
  } catch {
    api.clearAccessToken();
    setStoredToken('');
  }
}

async function handleLoginSubmit(event) {
  event.preventDefault();
  const email = elements.loginEmail.value.trim();
  const password = elements.loginPassword.value.trim();
  if (!email || !password) {
    setMessage('Enter email and password.', 'error');
    return;
  }

  setSubmitting(elements.loginSubmitBtn, true);
  setMessage('');
  try {
    const result = await api.login(email, password);
    setStoredToken(result.accessToken);
    sessionStorage.removeItem(AUTH_ERROR_KEY);
    setMessage('Login success. Redirecting...', 'success');
    navigateToNext();
  } catch (error) {
    setMessage(error.message || 'Login failed.', 'error');
  } finally {
    setSubmitting(elements.loginSubmitBtn, false);
  }
}

async function handleSignupSubmit(event) {
  event.preventDefault();
  const email = elements.signupEmail.value.trim();
  const password = elements.signupPassword.value.trim();
  const nickname = elements.signupNickname.value.trim();
  if (!email || !password || !nickname) {
    setMessage('Enter email, password, and nickname.', 'error');
    return;
  }

  setSubmitting(elements.signupSubmitBtn, true);
  setMessage('');
  try {
    await api.signup(email, password, nickname);
    const result = await api.login(email, password);
    setStoredToken(result.accessToken);
    sessionStorage.removeItem(AUTH_ERROR_KEY);
    setMessage('Signup and login complete. Redirecting...', 'success');
    navigateToNext();
  } catch (error) {
    setMessage(error.message || 'Signup failed.', 'error');
  } finally {
    setSubmitting(elements.signupSubmitBtn, false);
  }
}

function bindEvents() {
  elements.tabLogin.addEventListener('click', () => setTab('login'));
  elements.tabSignup.addEventListener('click', () => setTab('signup'));
  elements.loginForm.addEventListener('submit', handleLoginSubmit);
  elements.signupForm.addEventListener('submit', handleSignupSubmit);
}

async function bootstrapLoginPage() {
  bindEvents();
  const recentError = consumeAuthErrorMessage();
  if (recentError) {
    setMessage(recentError, 'error');
  }
  await ensureAlreadyAuthenticatedRedirect();
}

bootstrapLoginPage();
