(() => {
  'use strict';
  const publicKey = 'c6e9d79d42b4ff5990ee1e9dbc1d7039';
  const supportUrl = 'https://lootlane-test-backend.brycen0407.workers.dev/api/shop';
  const memory = new Map();
  // Storage can be unavailable in private or embedded browsers. The UI must still work.
  const storage = {
    get(key) { try { return localStorage.getItem(key) ?? memory.get(key) ?? null; } catch { return memory.get(key) ?? null; } },
    set(key, value) { memory.set(key, String(value)); try { localStorage.setItem(key, String(value)); return true; } catch { return false; } }
  };
  const $ = id => document.getElementById(id);
  const validUsername = value => /^[A-Za-z0-9_]{3,20}$/.test(value || '');
  let username = storage.get('lootlane-username');
  if (!validUsername(username)) username = '';
  let guestId = storage.get('lootlane-offerwall-guest');
  if (!/^guest-[a-zA-Z0-9-]{8,60}$/.test(guestId || '')) {
    const random = window.crypto?.randomUUID?.() || (Date.now().toString(36) + Math.random().toString(36).slice(2));
    guestId = 'guest-' + random;
    storage.set('lootlane-offerwall-guest', guestId);
  }
  const readNumber = (key, fallback = 0) => {
    const raw = storage.get(key);
    const value = raw === null ? fallback : Number(raw);
    return Number.isFinite(value) && value >= 0 ? value : fallback;
  };
  const format = value => value.toLocaleString('en-US', { maximumFractionDigits: 2 });
  const completed = Math.floor(readNumber('lootlane-completed-surveys'));
  $('payoutPool').textContent = format(readNumber('lootlane-payout-pool', 423567));
  $('balance').textContent = format(readNumber('lootlane-balance'));
  $('completed').textContent = format(completed);
  // A local counter is not proof of a reward or an actual payout request.
  $('withdraw').textContent = completed < 10 ? 'Complete ' + (10 - completed) + ' surveys' : 'Payout setup pending';

  const frame = $('offerwallFrame');
  const placeholder = $('wallPlaceholder');
  let wallStarted = false;
  let wallTimer;
  function wallUrl() {
    const url = new URL('https://offerwall.gg/wall/' + publicKey);
    url.searchParams.set('userId', username || guestId);
    return url.href;
  }
  function updateProfile() {
    $('profileButton').textContent = username || 'Log in';
    $('profileButton').setAttribute('aria-label', username ? 'Edit profile for ' + username : 'Log in');
    $('dashboardUsername').textContent = username || 'Not logged in';
    $('profileNote').textContent = username ? 'Your profile is saved on this browser.' : 'Save your username to personalize this browser.';
    $('offerwallOpen').href = wallUrl();
  }
  function loadWall() {
    if (wallStarted) return;
    wallStarted = true;
    placeholder.hidden = true;
    frame.hidden = false;
    frame.src = wallUrl();
    clearTimeout(wallTimer);
    wallTimer = setTimeout(() => {
      // Never replace or unload an in-progress offer on a timer.
      document.querySelector('.wall-footnote').textContent = 'If the offers have not appeared, open them in a new tab using the link above.';
    }, 15000);
  }
  frame.addEventListener('load', () => { clearTimeout(wallTimer); });
  $('loadOffers').addEventListener('click', loadWall);
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        observer.disconnect();
        loadWall();
      }
    }, { rootMargin: '200px' });
    observer.observe($('offerwall'));
  } else {
    loadWall();
  }
  updateProfile();

  const dialog = $('loginDialog');
  let loginTrigger;
  function openLogin(event) {
    loginTrigger = event?.currentTarget || $('profileButton');
    $('loginUsername').value = username;
    $('loginError').textContent = '';
    if (!dialog.open) dialog.showModal();
    $('loginUsername').focus();
  }
  window.openLogin = openLogin;
  document.querySelectorAll('[data-login]').forEach(button => button.addEventListener('click', openLogin));
  $('closeLogin').addEventListener('click', () => dialog.close());
  let backdropDown = false;
  const outsideDialog = event => {
    const bounds = dialog.getBoundingClientRect();
    return event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom;
  };
  dialog.addEventListener('pointerdown', event => { backdropDown = event.target === dialog && outsideDialog(event); });
  dialog.addEventListener('click', event => {
    if (backdropDown && event.target === dialog && outsideDialog(event)) dialog.close();
    backdropDown = false;
  });
  dialog.addEventListener('close', () => loginTrigger?.focus({ preventScroll: true }));
  $('loginForm').addEventListener('submit', event => {
    event.preventDefault();
    const nextUsername = $('loginUsername').value.trim();
    if (!validUsername(nextUsername)) {
      $('loginError').textContent = 'Use 3-20 letters, numbers, or underscores.';
      return;
    }
    const changed = nextUsername !== username;
    username = nextUsername;
    const saved = storage.set('lootlane-username', username);
    updateProfile();
    if (!saved) $('profileNote').textContent = 'Your profile is available for this visit. Browser storage is disabled.';
    if (changed && wallStarted) {
      // Only an explicit identity change reloads the wall.
      wallStarted = false;
      loadWall();
    }
    dialog.close();
  });

  const panel = $('supportPanel');
  function setSupport(open) {
    panel.hidden = !open;
    $('supportToggle').setAttribute('aria-expanded', String(open));
    if (open) $('supportMessage').focus();
    else $('supportToggle').focus({ preventScroll: true });
  }
  $('supportToggle').addEventListener('click', () => setSupport(panel.hidden));
  $('closeSupport').addEventListener('click', () => setSupport(false));
  panel.addEventListener('keydown', event => { if (event.key === 'Escape') setSupport(false); });
  $('supportForm').addEventListener('submit', async event => {
    event.preventDefault();
    const message = $('supportMessage').value.trim();
    if (!message) { $('supportStatus').textContent = 'Write a message first.'; return; }
    const button = $('sendSupport');
    if (button.disabled) return;
    button.disabled = true;
    $('supportStatus').textContent = 'Sending...';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(supportUrl, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({ action: 'support_message', message, contact: $('supportContact').value.trim() })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not send. Please try again.');
      $('supportForm').reset();
      $('supportStatus').textContent = 'Message sent to support.';
    } catch (error) {
      $('supportStatus').textContent = error.name === 'AbortError' ? 'The request timed out. Please try again.' : error.message || 'Could not send. Please try again.';
    } finally {
      clearTimeout(timeout);
      button.disabled = false;
    }
  });
})();
