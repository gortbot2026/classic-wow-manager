/**
 * Login Page Client-Side Logic
 *
 * Handles tab switching between login/register modes,
 * form validation, and AJAX submission for email/password auth.
 * Also passes returnTo parameter to all auth links.
 */
(function () {
  'use strict';

  // Extract returnTo from URL params
  const urlParams = new URLSearchParams(window.location.search);
  const returnTo = urlParams.get('returnTo') || '/';
  const encodedReturnTo = encodeURIComponent(returnTo);

  // Update Discord and Google links with returnTo
  const discordBtn = document.getElementById('discordLoginBtn');
  if (discordBtn) discordBtn.href = '/auth/discord?returnTo=' + encodedReturnTo;

  const googleBtn = document.getElementById('googleLoginBtn');
  if (googleBtn) googleBtn.href = '/auth/google?returnTo=' + encodedReturnTo;

  // Tab switching
  const loginTab = document.getElementById('loginTab');
  const registerTab = document.getElementById('registerTab');
  const emailSubmitBtn = document.getElementById('emailSubmitBtn');
  const passwordHint = document.getElementById('passwordHint');
  const passwordInput = document.getElementById('passwordInput');
  let isRegisterMode = false;

  function setMode(register) {
    isRegisterMode = register;
    if (register) {
      registerTab.classList.add('active');
      loginTab.classList.remove('active');
      emailSubmitBtn.textContent = 'Create Account';
      passwordHint.style.display = 'block';
      passwordInput.setAttribute('autocomplete', 'new-password');
      passwordInput.setAttribute('minlength', '8');
    } else {
      loginTab.classList.add('active');
      registerTab.classList.remove('active');
      emailSubmitBtn.textContent = 'Login';
      passwordHint.style.display = 'none';
      passwordInput.setAttribute('autocomplete', 'current-password');
      passwordInput.removeAttribute('minlength');
    }
    clearMessage();
  }

  loginTab.addEventListener('click', function () { setMode(false); });
  registerTab.addEventListener('click', function () { setMode(true); });

  // Message display
  var msgEl = document.getElementById('loginMessage');

  function showMessage(text, type) {
    msgEl.textContent = text;
    msgEl.className = 'login-message ' + type;
  }

  function clearMessage() {
    msgEl.textContent = '';
    msgEl.className = 'login-message';
  }

  // Form submission
  var emailForm = document.getElementById('emailForm');
  emailForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    clearMessage();

    var email = document.getElementById('emailInput').value.trim();
    var password = document.getElementById('passwordInput').value;

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showMessage('Please enter a valid email address.', 'error');
      return;
    }

    if (isRegisterMode && password.length < 8) {
      showMessage('Password must be at least 8 characters.', 'error');
      return;
    }

    emailSubmitBtn.disabled = true;
    emailSubmitBtn.textContent = isRegisterMode ? 'Creating Account...' : 'Logging in...';

    try {
      var url = isRegisterMode ? '/auth/local/register' : '/auth/local/login';
      var body = { email: email, password: password, returnTo: returnTo };

      var resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      var data = await resp.json();

      if (!resp.ok || !data.ok) {
        showMessage(data.error || 'Something went wrong. Please try again.', 'error');
        return;
      }

      if (data.redirect) {
        window.location.href = data.redirect;
        return;
      }

      // Registration success — show message
      showMessage(data.message || 'Success!', 'success');
    } catch (err) {
      showMessage('Network error. Please check your connection and try again.', 'error');
    } finally {
      emailSubmitBtn.disabled = false;
      emailSubmitBtn.textContent = isRegisterMode ? 'Create Account' : 'Login';
    }
  });
})();
