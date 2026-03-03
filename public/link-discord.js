/**
 * Link Discord ID Page — Client-Side Logic
 *
 * Validates the Discord ID format (17-20 digit snowflake)
 * and submits it to the server via AJAX.
 */
(function () {
  'use strict';

  var form = document.getElementById('linkForm');
  var input = document.getElementById('discordIdInput');
  var submitBtn = document.getElementById('linkSubmitBtn');
  var msgEl = document.getElementById('linkMessage');

  function showMessage(text, type) {
    msgEl.textContent = text;
    msgEl.className = 'link-message ' + type;
  }

  function clearMessage() {
    msgEl.textContent = '';
    msgEl.className = 'link-message';
  }

  /**
   * Validate Discord snowflake ID format.
   * @param {string} id - The value to validate
   * @returns {boolean} true if valid
   */
  function isValidDiscordId(id) {
    return /^\d{17,20}$/.test(id);
  }

  // Live validation feedback
  input.addEventListener('input', function () {
    var val = input.value.trim();
    if (val.length > 0 && !isValidDiscordId(val) && val.length >= 17) {
      input.style.borderColor = '#991b1b';
    } else if (isValidDiscordId(val)) {
      input.style.borderColor = '#166534';
    } else {
      input.style.borderColor = '#374151';
    }
  });

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    clearMessage();

    var discordId = input.value.trim();

    if (!isValidDiscordId(discordId)) {
      showMessage('Please enter a valid Discord User ID (17-20 digit number).', 'error');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Linking...';

    try {
      var resp = await fetch('/auth/link-discord', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ discordId: discordId })
      });

      var data = await resp.json();

      if (!resp.ok || !data.ok) {
        showMessage(data.error || 'Failed to link Discord ID. Please try again.', 'error');
        return;
      }

      showMessage('Discord ID linked successfully! Redirecting...', 'success');
      setTimeout(function () {
        window.location.href = data.redirect || '/';
      }, 800);
    } catch (err) {
      showMessage('Network error. Please check your connection and try again.', 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<i class="fab fa-discord"></i> Link Discord ID';
    }
  });
})();
