(() => {
  'use strict';
  const publicKey = 'c6e9d79d42b4ff5990ee1e9dbc1d7039';
  const supportUrl = 'https://lootlane-test-backend.brycen0407.workers.dev/api/shop';
  const rewardsUrl = 'https://lootlane-test-backend.brycen0407.workers.dev/api/rewards';
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
  const format = value => value.toLocaleString('en-US', { maximumFractionDigits: 4 });
  $('payoutPool').textContent = format(readNumber('lootlane-payout-pool', 423567));
  let rewardTimer;
  let rewardRequest;
  let rewardGeneration = 0;
  function resetRewards() {
    rewardGeneration++;
    rewardRequest?.abort();
    clearTimeout(rewardTimer);
    $('balance').textContent = '--';
    $('completed').textContent = '--';
    $('withdraw').textContent = 'Checking progress';
    $('rewardStatus').textContent = 'Checking confirmed rewards...';
    $('rewardBreakdown').textContent = '';
    void refreshRewards();
  }
  async function refreshRewards() {
    clearTimeout(rewardTimer);
    if (document.hidden || rewardRequest) return;
    const generation = rewardGeneration;
    const user = username || guestId;
    const controller = new AbortController();
    rewardRequest = controller;
    $('refreshRewards').disabled = true;
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(rewardsUrl + '?userId=' + encodeURIComponent(user), {
        cache: 'no-store', signal: controller.signal
      });
      const reward = await response.json();
      if (!response.ok) throw new Error(reward.error || 'Unable to refresh rewards.');
      if (generation !== rewardGeneration) return;
      if (reward.userId !== user || !Number.isFinite(reward.balance) || !Number.isInteger(reward.completedSurveys)) throw new Error('Invalid reward response.');
      $('balance').textContent = format(reward.balance);
      $('completed').textContent = format(reward.completedSurveys);
      $('rewardBreakdown').textContent = reward.storeCorrection > 0
        ? format(reward.providerBalance) + ' Robux from Offerwall.GG + ' + format(reward.storeCorrection) + ' Robux store correction.'
        : '';
      $('withdraw').textContent = reward.completedSurveys < 10 ? 'Complete ' + (10 - reward.completedSurveys) + ' more' : 'Payout setup pending';
      $('rewardStatus').textContent = reward.syncDelayed
        ? 'Showing confirmed rewards. Provider updates are delayed; retrying automatically.'
        : 'Synced with Offerwall.GG. New completions appear after provider confirmation.';
    } catch (error) {
      if (generation === rewardGeneration) $('rewardStatus').textContent = 'Could not refresh rewards. Your confirmed balance is saved; please retry.';
    } finally {
      clearTimeout(timeout);
      if (rewardRequest === controller) rewardRequest = null;
      $('refreshRewards').disabled = false;
      if (!document.hidden) rewardTimer = setTimeout(refreshRewards, generation === rewardGeneration ? 15000 : 0);
    }
  }
  $('refreshRewards').addEventListener('click', () => void refreshRewards());
  document.addEventListener('visibilitychange', () => {
    clearTimeout(rewardTimer);
    if (!document.hidden) void refreshRewards();
  });
  window.addEventListener('focus', () => { if (!document.hidden) void refreshRewards(); });

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
    const supportLink = new URL('https://offerwall.gg/wall/' + publicKey + '/support');
    supportLink.searchParams.set('userId', username || guestId);
    $('rewardHelp').href = supportLink.href;
    $('earningIdentity').textContent = username
      ? 'Rewards are credited to ' + username + '.'
      : 'Guest rewards stay with this browser. Log in before starting to earn under your Roblox username.';
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
      $('wallLoadNote').textContent = 'If the offers have not appeared, open them in a new tab using the link above.';
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
  resetRewards();

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
    if (changed) resetRewards();
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
