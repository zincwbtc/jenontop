(() => {
  'use strict';
  const publicKey = 'c6e9d79d42b4ff5990ee1e9dbc1d7039';
  const supportUrl = 'https://lootlane-test-backend.brycen0407.workers.dev/api/shop';
  const rewardsUrl = 'https://lootlane-test-backend.brycen0407.workers.dev/api/rewards';
  const withdrawUrl = 'https://lootlane-test-backend.brycen0407.workers.dev/api/withdraw';
  const offersUrl = 'https://lootlane-test-backend.brycen0407.workers.dev/api/offers';
  const memory = new Map();
  // Storage can be unavailable in private or embedded browsers. The UI must still work.
  const storage = {
    get(key) { try { return localStorage.getItem(key) ?? memory.get(key) ?? null; } catch { return memory.get(key) ?? null; } },
    set(key, value) { memory.set(key, String(value)); try { localStorage.setItem(key, String(value)); return true; } catch { return false; } }
  };
  const $ = id => document.getElementById(id);
  // Highlight the nav pill for whichever section is currently in view.
  const navLinks = [...document.querySelectorAll('.nav-links a[href^="#"]')];
  if ('IntersectionObserver' in window) {
    const visible = new Map();
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => visible.set(entry.target.id, entry.intersectionRatio));
      let best = '', bestRatio = 0;
      visible.forEach((ratio, id) => { if (ratio > bestRatio) { best = id; bestRatio = ratio; } });
      navLinks.forEach(link => {
        if (bestRatio > 0 && link.getAttribute('href') === '#' + best) link.setAttribute('aria-current', 'true');
        else link.removeAttribute('aria-current');
      });
    }, { threshold: [0, .15, .3, .5, .75, 1] });
    navLinks.forEach(link => { const section = document.querySelector(link.getAttribute('href')); if (section) observer.observe(section); });
  }
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
    $('withdraw').disabled = true;
    $('rewardStatus').textContent = 'Checking confirmed rewards...';
    $('rewardBreakdown').textContent = '';
    void refreshRewards();
  }
  function showReward(reward) {
    $('balance').textContent = format(reward.balance);
    $('completed').textContent = format(reward.completedSurveys);
    const notes = [];
    if (reward.storeCorrection > 0) notes.push(format(reward.providerBalance) + ' Robux from Offerwall.GG + ' + format(reward.storeCorrection) + ' Robux store correction.');
    if (reward.pendingWithdrawal > 0) notes.push(format(reward.pendingWithdrawal) + ' Robux withdrawal is on its way.');
    if (reward.withdrawnBalance > 0) notes.push(format(reward.withdrawnBalance) + ' Robux paid out so far.');
    $('rewardBreakdown').textContent = notes.join(' ');
    const button = $('withdraw'), required = reward.requiredSurveys || 10;
    button.disabled = !reward.eligible;
    if (reward.eligible) button.textContent = 'Withdraw ' + format(reward.withdrawableBalance) + ' Robux';
    else if (!username) button.textContent = 'Log in to withdraw';
    else if (reward.completedSurveys < required) button.textContent = 'Complete ' + (required - reward.completedSurveys) + ' more';
    else if (!reward.payoutsEnabled) button.textContent = 'Withdrawals paused';
    else button.textContent = 'Earn 1 Robux to withdraw';
    $('withdrawNote').textContent = reward.pendingWithdrawal > 0 ? 'Request sent to our payout team' : 'Paid to your Roblox account';
  }
  $('withdraw').addEventListener('click', async () => {
    const button = $('withdraw');
    if (button.disabled || !username) return;
    const generation = rewardGeneration;
    button.disabled = true;
    button.textContent = 'Sending request...';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(withdrawUrl, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ userId: username })
      });
      const result = await response.json();
      if (generation !== rewardGeneration) return;
      if (result.summary) showReward(result.summary);
      if (!response.ok) throw new Error(result.error || 'Could not request a withdrawal. Please try again.');
      $('rewardStatus').textContent = 'Withdrawal requested: ' + format(result.withdrawal.amount) + ' Robux to ' + username + '. Our team will send it soon.';
    } catch (error) {
      if (generation !== rewardGeneration) return;
      $('rewardStatus').textContent = error.name === 'AbortError' ? 'The request timed out. Refresh rewards before trying again.' : error.message;
      void refreshRewards();
    } finally {
      clearTimeout(timeout);
    }
  });
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
      showReward(reward);
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

  let wallStarted = false;
  let offersRequest;
  let offerPage = 1;
  let offerSearch = '';
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
  async function loadWall() {
    offersRequest?.abort();
    const controller = new AbortController();
    offersRequest = controller;
    wallStarted = true;
    $('offerList').replaceChildren();
    $('offerList').setAttribute('aria-busy', 'true');
    $('wallStatus').textContent = 'Checking live offer prices...';
    $('offerPage').textContent = '';
    $('previousOffers').hidden = $('nextOffers').hidden = true;
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const url = new URL(offersUrl);
      url.search = new URLSearchParams({ userId: username || guestId, page: offerPage, search: offerSearch });
      const response = await fetch(url, { signal: controller.signal, cache: 'no-store', credentials: 'omit' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not load live offers.');
      if (offersRequest !== controller) return;
      if (!Array.isArray(data.offers) || data.currency?.name !== 'Robux') throw new Error('Live offer prices are unavailable.');
      const fragment = document.createDocumentFragment();
      for (const offer of data.offers) {
        if (!Number.isFinite(offer.reward) || offer.reward < 0) continue;
        const link = new URL(offer.detailsUrl);
        if (link.origin !== 'https://offerwall.gg' || !link.pathname.startsWith('/wall/' + publicKey + '/offer/')) continue;
        const card = document.createElement('article');
        card.className = 'live-offer';
        const badge = document.createElement('span'); badge.className = 'tag';
        badge.textContent = ({ variable: 'Variable reward', total: 'Multi-step total', estimate: 'Survey estimate', fixed: 'Provider reward' })[offer.rewardKind] || 'Provider reward';
        const title = document.createElement('h3'); title.textContent = offer.name;
        const description = document.createElement('p'); description.textContent = offer.requirements || offer.description || 'Read the requirements before starting.';
        const amount = document.createElement('strong'); amount.className = 'offer-amount';
        amount.textContent = offer.rewardKind === 'variable' ? 'Reward varies' : (offer.rewardKind === 'total' ? 'Up to ' : offer.rewardKind === 'estimate' ? 'Estimated ' : '') + format(offer.reward) + ' Robux';
        const note = document.createElement('small');
        note.textContent = ({ variable: 'The final amount is confirmed after completion.', total: 'Total across all paying steps, not per step.', estimate: 'The final credited amount may differ.', fixed: 'Credited after the provider confirms completion.' })[offer.rewardKind] || '';
        const action = document.createElement('a'); action.className = 'card-link'; action.textContent = 'Review requirements ↗';
        action.href = link.href; action.target = '_blank'; action.rel = 'noopener noreferrer';
        card.append(badge, title, description, amount, note, action); fragment.append(card);
      }
      $('offerList').append(fragment);
      $('offerRate').textContent = 'Current provider rate: ' + format(data.currency.perUsd) + ' Robux per US$1 of confirmed earnings.';
      $('wallStatus').textContent = data.offers.length ? 'Live rewards from Offerwall.GG. Review requirements before starting.' : 'No offers match right now. Try another search or check back later.';
      $('offerPage').textContent = 'Page ' + offerPage;
      $('previousOffers').hidden = offerPage <= 1;
      $('nextOffers').hidden = !data.hasMore;
    } catch (error) {
      if (offersRequest !== controller) return;
      $('wallStatus').textContent = error.name === 'AbortError' ? 'Offers timed out. Retry or use the provider link above.' : error.message;
      $('offerRate').textContent = 'Live rate unavailable. No estimated fallback prices are shown.';
    } finally {
      clearTimeout(timer);
      if (offersRequest === controller) { offersRequest = null; $('offerList').removeAttribute('aria-busy'); }
    }
  }
  $('loadOffers').addEventListener('click', () => void loadWall());
  $('offerSearch').addEventListener('submit', event => { event.preventDefault(); offerSearch = $('offerQuery').value.trim(); offerPage = 1; void loadWall(); });
  $('previousOffers').addEventListener('click', () => { offerPage = Math.max(1, offerPage - 1); void loadWall(); });
  $('nextOffers').addEventListener('click', () => { offerPage++; void loadWall(); });
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        observer.disconnect();
        if (!wallStarted) void loadWall();
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
      offerPage = 1;
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
