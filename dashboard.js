(() => {
  'use strict';
  const publicKey = 'c6e9d79d42b4ff5990ee1e9dbc1d7039';
  const cloudflareOrigin = 'https://lootlane-test-backend.brycen0407.workers.dev';
  // On lootlaneblox.com the API is served from the same domain (lootlaneblox.com/api/*), which phones,
  // in-app browsers and school filters don't block the way they can block *.workers.dev.
  const apiOrigin = location.hostname === 'lootlaneblox.com' ? location.origin : cloudflareOrigin;
  const rewardsUrl = apiOrigin + '/api/rewards';
  const withdrawUrl = apiOrigin + '/api/withdraw';
  const offersUrl = apiOrigin + '/api/offers';
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
  let offerCategory = 'survey';
  let offerRewardRange = '0-100';
  function wallUrl() {
    const url = new URL('https://offerwall.gg/wall/' + publicKey);
    url.searchParams.set('userId', username || guestId);
    if (offerCategory === 'survey') url.searchParams.set('category', 'survey');
    url.searchParams.set('sort', 'popular');
    if (offerSearch) url.searchParams.set('search', offerSearch);
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
    $('offerwallOpen').href = wallUrl();
    $('surveyRewardFilters').hidden = offerCategory !== 'survey';
    $('offerList').setAttribute('aria-label', offerCategory === 'survey' ? 'Available surveys' : 'Available offers');
    $('offerList').replaceChildren();
    $('offerList').setAttribute('aria-busy', 'true');
    $('wallStatus').textContent = 'Checking live offer prices...';
    $('offerPage').textContent = '';
    $('previousOffers').hidden = $('nextOffers').hidden = true;
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const url = new URL(offersUrl);
      const [minReward, maxReward] = offerRewardRange === 'any' ? ['0', 'any'] : offerRewardRange.split('-');
      url.search = new URLSearchParams({ userId: username || guestId, page: offerPage, search: offerSearch,
        category: offerCategory, minReward, maxReward });
      let response;
      try {
        response = await fetch(url, { signal: controller.signal, cache: 'no-store', credentials: 'omit' });
      } catch (networkError) {
        if (controller.signal.aborted) throw networkError;
        // Phones drop requests now and then ("Load failed"). Try once more, via the backup address.
        await new Promise(resolve => setTimeout(resolve, 600));
        if (offersRequest !== controller) return;
        const backup = new URL(cloudflareOrigin + '/api/offers'); backup.search = url.search;
        response = await fetch(backup, { signal: controller.signal, cache: 'no-store', credentials: 'omit' });
      }
      const data = await response.json().catch(() => ({}));
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
        badge.textContent = ({ variable: 'Variable reward', total: 'Multi-step offer', estimate: 'Survey estimate', fixed: 'Provider reward' })[offer.rewardKind] || 'Provider reward';
        const title = document.createElement('h3'); title.textContent = offer.name;
        const description = document.createElement('p'); description.textContent = offer.requirements || offer.description || 'Read the requirements before starting.';
        const amount = document.createElement('strong'); amount.className = 'offer-amount';
        amount.textContent = offer.rewardKind === 'variable' ? 'Reward varies' : offer.rewardKind === 'total' ? 'Rewards by milestone' : (offer.rewardKind === 'estimate' ? 'Estimated ' : '') + format(offer.reward) + ' Robux';
        const note = document.createElement('small');
        note.textContent = ({ variable: 'Check your matched survey or offer for its reward before starting.', total: 'Up to ' + format(offer.reward) + ' Robux combined across all paying milestones. Review each step, deadline and any purchase requirement.', estimate: 'Qualification required. Screening out may pay less or nothing; the provider confirms the final amount.', fixed: 'Credited after the provider confirms completion.' })[offer.rewardKind] || '';
        const action = document.createElement('a'); action.className = 'card-link'; action.textContent = 'Review requirements ↗';
        action.href = link.href; action.target = '_blank'; action.rel = 'noopener noreferrer';
        card.append(badge, title, description, amount, note, action); fragment.append(card);
      }
      $('offerList').append(fragment);
      $('offerRate').textContent = 'Current provider rate: ' + format(data.currency.perUsd) + ' Robux per US$1 of confirmed earnings.';
      const rangeLabel = $('offerMaxReward').selectedOptions[0].textContent;
      $('wallStatus').textContent = offerCategory === 'survey'
        ? (data.offers.length ? 'Live surveys: ' + rangeLabel + '. Showing ' + data.offers.length + ' of ' + (data.total ?? data.offers.length) + ' matches. Amounts are estimates, not guaranteed payouts.' : 'No surveys match ' + rangeLabel + ' for your location and device right now. Try Any reward, clear your search, or check back later.')
        : (data.offers.length ? 'Live offers allowed by Lootlane\'s provider settings. Review each offer\'s requirements before starting.' : 'No offers match right now. Try another search or check back later.');
      $('offerPage').textContent = 'Page ' + offerPage;
      $('previousOffers').hidden = offerPage <= 1;
      $('nextOffers').hidden = !data.hasMore;
    } catch (error) {
      if (offersRequest !== controller) return;
      $('wallStatus').textContent = error.name === 'AbortError' ? 'Offers timed out. Tap Search again or use the provider link above.'
        : error instanceof TypeError ? 'Could not reach the survey list. Check your connection and tap Search again.' : error.message;
      $('offerRate').textContent = 'Live rate unavailable. No estimated fallback prices are shown.';
    } finally {
      clearTimeout(timer);
      if (offersRequest === controller) { offersRequest = null; $('offerList').removeAttribute('aria-busy'); }
    }
  }
  $('loadOffers').addEventListener('click', () => void loadWall());
  document.querySelectorAll('[data-offer-category]').forEach(button => button.addEventListener('click', () => {
    offerCategory = button.dataset.offerCategory;
    document.querySelectorAll('[data-offer-category]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    offerPage = 1; void loadWall();
  }));
  $('offerMaxReward').addEventListener('change', () => { offerRewardRange = $('offerMaxReward').value; offerPage = 1; void loadWall(); });
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

  // Help now goes to our Discord (bottom-right button links to the invite); no in-page form.

  // DEMO activity pop-ups (bottom-left). These are examples, not real users or real payouts:
  // names are randomly generated and every pop-up is labeled DEMO. Real activity should never be mixed in here.
  const demoFeed = $('demoFeed');
  if (demoFeed) {
    const letters = 'abcdefghijklmnopqrstuvwxyz';
    const pick = list => list[Math.floor(Math.random() * list.length)];
    const fakeName = () => {
      const start = Array.from({ length: 3 }, () => pick(letters)).join('');
      return start.charAt(0).toUpperCase() + start.slice(1) + '***';
    };
    const demoEvent = () => (Math.random() < 0.7
      ? { verb: 'completed a survey for', amount: pick([3, 5, 5, 8, 10, 15, 15, 25, 50, 100]) }
      : { verb: 'withdrew', amount: pick([50, 75, 100, 100, 150, 200]) });
    const showDemo = () => {
      const { verb, amount } = demoEvent();
      const toast = document.createElement('div');
      toast.className = 'demo-toast';
      toast.innerHTML = '<img class="demo-avatar" alt="" width="36" height="36"><div><span class="demo-badge">DEMO</span> <strong></strong> <span class="demo-text"></span><small>Example activity, not a real user or payout</small></div>';
      // Official Roblox catalog character renders (assets/demo-avatars), never a real player's avatar.
      toast.querySelector('img').src = 'assets/demo-avatars/' + String(1 + Math.floor(Math.random() * 18)).padStart(2, '0') + '.png';
      toast.querySelector('strong').textContent = fakeName();
      toast.querySelector('.demo-text').textContent = verb + ' ' + amount + ' Robux';
      demoFeed.append(toast);
      requestAnimationFrame(() => toast.classList.add('show'));
      if (!new URLSearchParams(location.search).has('demopreview')) setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 400); }, 6000);
    };
    // Mostly every 1-2 minutes; about 1 in 6 times a longer ~4-6 minute gap.
    const nextWait = () => (Math.random() < 1 / 6 ? 240000 + Math.random() * 120000 : 60000 + Math.random() * 18);
    const schedule = () => setTimeout(() => { if (!document.hidden) showDemo(); schedule(); }, nextWait());
    if (new URLSearchParams(location.search).has('demopreview')) { showDemo(); demoFeed.lastChild.classList.add('show'); return; } // design check only
    setTimeout(() => { showDemo(); schedule(); }, 15000 + Math.random() * 18);
  }
})();
