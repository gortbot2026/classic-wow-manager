/**
 * Link Discord ID Page — Client-Side Logic (Two-Step Verification Flow)
 *
 * Step 1: User enters Discord ID → sends verification code via Discord DM
 * Step 2: User enters 4-digit code from DM → completes Discord ID linking
 *
 * Supports magic link pre-fill via URL params: ?code=XXXX&discord_id=ID&auto=1
 */
(function () {
  'use strict';

  // --- DOM Elements ---
  var step1El = document.getElementById('step1');
  var step2El = document.getElementById('step2');
  var step1Form = document.getElementById('step1Form');
  var step2Form = document.getElementById('step2Form');
  var discordIdInput = document.getElementById('discordIdInput');
  var codeInput = document.getElementById('codeInput');
  var step1Btn = document.getElementById('step1Btn');
  var step2Btn = document.getElementById('step2Btn');
  var displayDiscordId = document.getElementById('displayDiscordId');
  var changeIdLink = document.getElementById('changeIdLink');
  var resendLink = document.getElementById('resendLink');
  var msgEl = document.getElementById('linkMessage');

  // Track the current Discord ID being verified
  var currentDiscordId = '';

  // --- Utility Functions ---

  /**
   * Show a styled message banner.
   * @param {string} text - Message text
   * @param {'error'|'success'|'info'} type - Message style
   */
  function showMessage(text, type) {
    msgEl.textContent = text;
    msgEl.className = 'link-message ' + type;
  }

  /** Hide the message banner. */
  function clearMessage() {
    msgEl.textContent = '';
    msgEl.className = 'link-message';
  }

  /**
   * Validate Discord snowflake ID format.
   * @param {string} id - The value to validate
   * @returns {boolean} true if valid 17-20 digit numeric string
   */
  function isValidDiscordId(id) {
    return /^\d{17,20}$/.test(id);
  }

  /** Switch UI to Step 1 (enter Discord ID). */
  function showStep1() {
    step1El.classList.remove('step-hidden');
    step2El.classList.add('step-hidden');
    clearMessage();
    discordIdInput.value = currentDiscordId || '';
    discordIdInput.focus();
  }

  /**
   * Switch UI to Step 2 (enter verification code).
   * @param {string} discordId - The Discord ID being verified
   * @param {string} [prefillCode] - Optional code to pre-fill (from magic link)
   */
  function showStep2(discordId, prefillCode) {
    currentDiscordId = discordId;
    displayDiscordId.textContent = discordId;
    step1El.classList.add('step-hidden');
    step2El.classList.remove('step-hidden');
    if (prefillCode) {
      codeInput.value = prefillCode;
    } else {
      codeInput.value = '';
    }
    codeInput.focus();
  }

  // --- Live Validation ---
  discordIdInput.addEventListener('input', function () {
    var val = discordIdInput.value.trim();
    if (val.length > 0 && !isValidDiscordId(val) && val.length >= 17) {
      discordIdInput.style.borderColor = '#991b1b';
    } else if (isValidDiscordId(val)) {
      discordIdInput.style.borderColor = '#166534';
    } else {
      discordIdInput.style.borderColor = '#374151';
    }
  });

  // --- Step 1: Send Verification Code ---
  step1Form.addEventListener('submit', async function (e) {
    e.preventDefault();
    clearMessage();

    var discordId = discordIdInput.value.trim();
    if (!isValidDiscordId(discordId)) {
      showMessage('Please enter a valid Discord User ID (17-20 digit number).', 'error');
      return;
    }

    step1Btn.disabled = true;
    step1Btn.textContent = 'Sending...';

    try {
      var resp = await fetch('/api/auth/request-discord-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ discordId: discordId })
      });

      var data = await resp.json();

      if (!data.ok) {
        showMessage(data.error || 'Failed to send verification code. Please try again.', 'error');
        return;
      }

      showMessage('Verification code sent! Check your Discord DMs.', 'success');
      showStep2(discordId);
    } catch (err) {
      showMessage('Network error. Please check your connection and try again.', 'error');
    } finally {
      step1Btn.disabled = false;
      step1Btn.innerHTML = '<i class="fab fa-discord"></i> Send Verification Code';
    }
  });

  // --- Step 2: Confirm Verification Code ---
  step2Form.addEventListener('submit', async function (e) {
    e.preventDefault();
    clearMessage();

    var code = codeInput.value.trim();
    if (!/^\d{4}$/.test(code)) {
      showMessage('Please enter the 4-digit verification code.', 'error');
      return;
    }

    step2Btn.disabled = true;
    step2Btn.textContent = 'Verifying...';

    try {
      var resp = await fetch('/api/auth/confirm-discord-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ discordId: currentDiscordId, code: code })
      });

      var data = await resp.json();

      if (!data.ok) {
        showMessage(data.error || 'Verification failed. Please try again.', 'error');
        return;
      }

      showMessage('Discord ID verified and linked! Redirecting...', 'success');
      setTimeout(function () {
        window.location.href = data.redirect || '/';
      }, 800);
    } catch (err) {
      showMessage('Network error. Please check your connection and try again.', 'error');
    } finally {
      step2Btn.disabled = false;
      step2Btn.textContent = 'Link Account';
    }
  });

  // --- Change ID Link (go back to Step 1) ---
  changeIdLink.addEventListener('click', function (e) {
    e.preventDefault();
    showStep1();
  });

  // --- Resend Code ---
  resendLink.addEventListener('click', async function (e) {
    e.preventDefault();
    if (!currentDiscordId) return;
    clearMessage();

    resendLink.textContent = 'Sending...';

    try {
      var resp = await fetch('/api/auth/request-discord-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ discordId: currentDiscordId })
      });

      var data = await resp.json();

      if (!data.ok) {
        showMessage(data.error || 'Failed to resend code.', 'error');
      } else {
        showMessage('New verification code sent! Check your Discord DMs.', 'success');
        codeInput.value = '';
        codeInput.focus();
      }
    } catch (err) {
      showMessage('Network error. Please try again.', 'error');
    } finally {
      resendLink.textContent = "Didn't receive it? Resend code";
    }
  });

  // --- Magic Link Pre-fill ---
  // Check URL params for code, discord_id, and auto=1 (from magic link redirect)
  var params = new URLSearchParams(window.location.search);
  var urlCode = params.get('code');
  var urlDiscordId = params.get('discord_id');
  var urlAuto = params.get('auto');

  if (urlCode && urlDiscordId && urlAuto === '1') {
    showMessage('Magic link verified! Click "Link Account" to complete.', 'info');
    showStep2(urlDiscordId, urlCode);
    // Clean up URL params without reloading
    if (window.history && window.history.replaceState) {
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }
})();
