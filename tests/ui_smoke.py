"""Browser regression checks. Requires Python Playwright and installed Chrome."""
import functools
import http.server
import json
from pathlib import Path
import threading
import time
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / ".tmp-ui"
ARTIFACTS.mkdir(exist_ok=True)

class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

server = http.server.ThreadingHTTPServer(
    ("127.0.0.1", 0), functools.partial(QuietHandler, directory=str(ROOT)))
threading.Thread(target=server.serve_forever, daemon=True).start()
base = "http://127.0.0.1:" + str(server.server_port)

try:
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome", headless=True)
        # Reproduce the old observer feedback loop, with a safety limit so the test can exit.
        repro = browser.new_page()
        legacy_count = repro.evaluate("""async () => {
          const activity = document.createElement('div');
          document.body.append(activity);
          let calls = 0;
          const observer = new MutationObserver(() => {
            if (++calls >= 1000) { observer.disconnect(); return; }
            const label = activity.querySelector('strong');
            if (label) label.textContent = 'Activity';
          });
          observer.observe(activity, {childList:true, subtree:true});
          activity.innerHTML = '<strong>Activity</strong>';
          await new Promise(resolve => setTimeout(resolve, 25));
          return calls;
        }""")
        assert legacy_count == 1000, legacy_count
        repro.close()

        context = browser.new_context(viewport={"width":1440, "height":1000})
        page = context.new_page()
        page.set_default_timeout(8000)
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        wall_requests = []
        wall_mode = {"empty":False,"failed":False}
        def mock_wall(route):
            wall_requests.append(route.request.url)
            query = parse_qs(urlparse(route.request.url).query)
            user = query["userId"][0]
            if wall_mode["failed"]:
                route.fulfill(status=503, content_type="application/json", body='{"error":"Live offer prices are unavailable."}')
                return
            offers = [{"id":i,"name":name,"requirements":"Complete the provider requirements.","reward":143.125,"rewardKind":kind,
                       "detailsUrl":f"https://offerwall.gg/wall/c6e9d79d42b4ff5990ee1e9dbc1d7039/offer/{i}?userId={user}"}
                      for i, (name, kind) in enumerate([("Game reward","fixed"),("Survey reward","estimate"),("Multi-step game","total"),("Variable offer","variable")], 1)]
            if query.get("category") == ["survey"]:
                offers = [{**offers[1],"id":i,"name":f"Survey {i}","reward":reward}
                          for i, reward in enumerate([15,30,50,100],1)
                          if query["maxReward"] == ["any"] or int(query["minReward"][0]) < reward <= int(query["maxReward"][0])]
            if wall_mode["empty"]:
                offers = []
            route.fulfill(content_type="application/json", body=json.dumps({"offers":offers,"total":len(offers),"currency":{"name":"Robux","perUsd":70},"page":1,"hasMore":False}))
        page.route("**/api/offers?*", mock_wall)
        reward_state = {"balance":53,"completedSurveys":1,"providerBalance":3.5,"storeCorrection":49.5}
        def mock_rewards(route):
            user = parse_qs(urlparse(route.request.url).query)["userId"][0]
            reward = reward_state if user == "Player_Test123" else {"balance":0,"completedSurveys":0,"providerBalance":0,"storeCorrection":0}
            route.fulfill(content_type="application/json", body=json.dumps({
                "requiredSurveys":10,"payoutsEnabled":True,"eligible":False,"withdrawableBalance":0,
                "pendingWithdrawal":0,"withdrawnBalance":0,"userId":user,**reward,
                "syncDelayed":False,"lastSyncedAt":"2026-09-23T10:00:00Z"
            }))
        page.route("**/api/rewards?*", mock_rewards)
        page.goto(base)
        expect(page.locator("#profileButton")).to_have_text("Log in")
        page.screenshot(path=str(ARTIFACTS / "desktop.png"), full_page=True)
        page.locator("#offerwall").scroll_into_view_if_needed()
        expect(page.locator(".live-offer")).to_have_count(4)
        expect(page.locator(".offer-amount").nth(0)).to_have_text("Estimated 15 Robux")
        expect(page.locator(".offer-amount").nth(3)).to_have_text("Estimated 100 Robux")
        assert parse_qs(urlparse(wall_requests[-1]).query)["category"] == ["survey"]
        assert parse_qs(urlparse(wall_requests[-1]).query)["maxReward"] == ["100"]
        assert page.locator(".preview-label").count() == 0
        expect(page.locator("#offerRate")).to_contain_text("70 Robux per US$1")
        page.wait_for_timeout(250)
        assert len(wall_requests) == 1, wall_requests
        wall_url = page.locator("#offerwallOpen").get_attribute("href")
        assert parse_qs(urlparse(wall_requests[-1]).query)["userId"] == parse_qs(urlparse(wall_url).query)["userId"]
        for i in range(8):
            page.mouse.wheel(0, 500 if i % 2 else -500)
            page.wait_for_timeout(70)
        assert len(wall_requests) == 1, "Scrolling must not reload offers"
        for value, reward in [("0-15",15),("15-30",30),("30-50",50),("50-100",100)]:
            page.locator("#offerMaxReward").select_option(value)
            expect(page.locator(".live-offer")).to_have_count(1)
            expect(page.locator(".offer-amount")).to_have_text(f"Estimated {reward} Robux")
            expect(page.locator("#wallStatus")).to_contain_text("Showing 1 of 1 matches")
            query = parse_qs(urlparse(wall_requests[-1]).query)
            assert query["page"] == ["1"]
            assert query["minReward"] == [value.split('-')[0]]
            assert query["maxReward"] == [value.split('-')[1]]
        page.locator("#offerMaxReward").select_option("0-100")
        expect(page.locator(".live-offer")).to_have_count(4)
        page.locator("#offerMaxReward").select_option("any")
        expect(page.locator("#wallStatus")).to_contain_text("Any reward")
        page.locator("#offerMaxReward").select_option("0-100")
        expect(page.locator("#wallStatus")).to_contain_text("All up to 100 Robux")
        page.locator('[data-offer-category="all"]').click()
        expect(page.locator("#surveyRewardFilters")).not_to_be_visible()
        expect(page.locator(".offer-amount").nth(0)).to_have_text("143.125 Robux")
        expect(page.locator(".offer-amount").nth(2)).to_have_text("Rewards by milestone")
        expect(page.locator(".live-offer").nth(2)).to_contain_text("Up to 143.125 Robux combined across all paying milestones")
        expect(page.locator(".offer-amount").nth(3)).to_have_text("Reward varies")
        page.locator('[data-offer-category="survey"]').click()
        expect(page.locator("#surveyRewardFilters")).to_be_visible()
        expect(page.locator(".offer-amount").nth(0)).to_have_text("Estimated 15 Robux")
        assert parse_qs(urlparse(page.locator("#offerwallOpen").get_attribute("href")).query)["category"] == ["survey"]
        wall_mode["empty"] = True
        page.locator("#loadOffers").click()
        expect(page.locator("#wallStatus")).to_contain_text("No surveys match")
        expect(page.locator(".live-offer")).to_have_count(0)
        wall_mode.update(empty=False,failed=True)
        page.locator("#loadOffers").click()
        expect(page.locator("#wallStatus")).to_contain_text("Live offer prices are unavailable")
        expect(page.locator(".live-offer")).to_have_count(0)
        wall_mode["failed"] = False
        page.reload()
        page.locator("#offerwall").scroll_into_view_if_needed()
        page.wait_for_timeout(300)
        assert page.locator("#offerwallOpen").get_attribute("href") == wall_url, "Guest identity must survive reload"

        # All close paths and keyboard input, beyond the old 18-second freeze trigger.
        page.locator("#profileButton").click()
        expect(page.locator("#loginUsername")).to_be_focused()
        page.keyboard.press("Escape")
        expect(page.locator("#loginDialog")).not_to_be_visible()
        page.locator("#profileButton").click()
        page.locator("#closeLogin").click()
        expect(page.locator("#loginDialog")).not_to_be_visible()
        page.locator("#profileButton").click()
        page.mouse.click(5, 200)
        expect(page.locator("#loginDialog")).not_to_be_visible()
        page.locator("#profileButton").click()
        page.locator("#loginUsername").fill("Player_Test123")
        page.locator("#loginUsername").press("Enter")
        expect(page.locator("#loginDialog")).not_to_be_visible()
        expect(page.locator("#dashboardUsername")).to_have_text("Player_Test123")
        expect(page.locator("#balance")).to_have_text("53")
        expect(page.locator("#completed")).to_have_text("1")
        expect(page.locator("#rewardBreakdown")).to_contain_text("49.5 Robux store correction")
        assert "userId=Player_Test123" in page.locator("#rewardHelp").get_attribute("href")
        # Browser-edited counters must never overwrite verified rewards.
        page.evaluate("localStorage.setItem('lootlane-balance','999999');localStorage.setItem('lootlane-completed-surveys','99')")
        reward_state.update(balance=106, completedSurveys=2, providerBalance=56.5)
        page.locator("#refreshRewards").click()
        expect(page.locator("#balance")).to_have_text("106")
        expect(page.locator("#completed")).to_have_text("2")
        assert "userId=Player_Test123" in page.locator("#offerwallOpen").get_attribute("href")
        expect(page.locator("#withdraw")).to_be_disabled()
        expect(page.locator("#withdraw")).to_have_text("Complete 8 more")

        # Ten surveys unlock withdrawing; the request is mocked so no Discord post is sent.
        withdraw_requests = []
        def mock_withdraw(route):
            withdraw_requests.append(route.request.post_data_json)
            reward_state.update(balance=0, completedSurveys=0, eligible=False, withdrawableBalance=0, pendingWithdrawal=106)
            route.fulfill(content_type="application/json", body=json.dumps({
                "ok":True,"withdrawal":{"id":"w-1","amount":106,"surveysUsed":10,"status":"pending"},
                "summary":{"userId":"Player_Test123","requiredSurveys":10,"payoutsEnabled":True,"withdrawnBalance":0,**reward_state}}))
        page.route("**/api/withdraw", mock_withdraw)
        reward_state.update(completedSurveys=10, eligible=True, withdrawableBalance=106)
        page.locator("#refreshRewards").click()
        expect(page.locator("#withdraw")).to_be_enabled()
        expect(page.locator("#withdraw")).to_have_text("Withdraw 106 Robux")
        page.locator("#withdraw").click()
        expect(page.locator("#rewardStatus")).to_contain_text("Withdrawal requested: 106 Robux to Player_Test123")
        assert withdraw_requests == [{"userId":"Player_Test123"}], withdraw_requests
        expect(page.locator("#withdraw")).to_be_disabled()
        expect(page.locator("#balance")).to_have_text("0")
        expect(page.locator("#rewardBreakdown")).to_contain_text("106 Robux withdrawal is on its way")
        page.locator("#dashboard").screenshot(path=str(ARTIFACTS / "withdraw.png"))
        reward_state.update(balance=106, completedSurveys=2, eligible=False, withdrawableBalance=0, pendingWithdrawal=0)
        page.locator("#refreshRewards").click()
        expect(page.locator("#balance")).to_have_text("106")

        # Support tests never send a real Discord message.
        page.route("**/api/shop", lambda route: route.fulfill(
            content_type="application/json", body='{"ok":true}'))
        page.locator("#supportToggle").click()
        page.locator("#supportMessage").fill("UI test only")
        page.locator("#sendSupport").click()
        expect(page.locator("#supportStatus")).to_have_text("Message sent to support.")
        page.locator("#closeSupport").click()
        expect(page.locator("#supportPanel")).not_to_be_visible()

        for width in [1440, 768, 390, 320]:
            page.set_viewport_size({"width":width, "height":900})
            page.evaluate("window.scrollTo(0,0)")
            layout = page.evaluate("""() => {
              const r = selector => document.querySelector(selector).getBoundingClientRect();
              const logo=r('.brand-mark'), name=r('.brand-name'), main=r('main'), art=r('.hero-art');
              return {
                overflow:document.documentElement.scrollWidth > innerWidth,
                logoLeft:logo.right <= name.left,
                aligned:Math.abs((logo.top+logo.height/2)-(name.top+name.height/2)) < 2,
                center:Math.abs(main.left+main.width/2-innerWidth/2),
                artCenter:Math.abs(art.left+art.width/2-innerWidth/2)
              };
            }""")
            assert not layout["overflow"], (width,layout)
            assert layout["logoLeft"] and layout["aligned"], (width,layout)
            assert layout["center"] < 2 and layout["artCenter"] < 2, (width,layout)
            page.locator("#profileButton").click()
            expect(page.locator("#loginUsername")).to_be_focused()
            page.keyboard.press("Escape")
            if width == 390:
                page.screenshot(path=str(ARTIFACTS / "mobile.png"), full_page=True)

        page.emulate_media(reduced_motion="reduce")
        assert page.locator(".decor-block").first.evaluate("e=>getComputedStyle(e).animationName") == "none"
        page.set_viewport_size({"width":1440, "height":1000})
        page.emulate_media(reduced_motion="no-preference")
        cdp = context.new_cdp_session(page)
        cdp.send("Performance.enable")
        before = {m["name"]:m["value"] for m in cdp.send("Performance.getMetrics")["metrics"]}
        page.wait_for_timeout(21000)
        page.locator("#profileButton").click()
        page.locator("#loginUsername").fill("Still_Responsive")
        page.keyboard.press("Escape")
        after = {m["name"]:m["value"] for m in cdp.send("Performance.getMetrics")["metrics"]}
        assert not errors, errors
        idle_task_seconds = after["TaskDuration"] - before["TaskDuration"]
        assert idle_task_seconds < 2, idle_task_seconds

        blocked = browser.new_context()
        blocked.add_init_script("Object.defineProperty(window, 'localStorage', {get(){throw new DOMException('Blocked','SecurityError')}})")
        blocked_page = blocked.new_page()
        blocked_page.route("**/api/offers?*", mock_wall)
        blocked_page.route("**/api/rewards?*", mock_rewards)
        blocked_page.goto(base)
        blocked_page.locator("#profileButton").click()
        blocked_page.locator("#loginUsername").fill("Private_Player")
        blocked_page.locator("#loginUsername").press("Enter")
        expect(blocked_page.locator("#dashboardUsername")).to_have_text("Private_Player")
        expect(blocked_page.locator("#profileNote")).to_contain_text("storage is disabled")
        blocked.close()
        print(json.dumps({"result":"passed","legacy_observer_callbacks_in_25ms":legacy_count,
            "new_page_task_seconds_during_21s_wait":round(idle_task_seconds,4),
            "viewport_widths":[1440,768,390,320],"browser_errors":errors,
            "screenshots":str(ARTIFACTS)}, indent=2))
        browser.close()
finally:
    server.shutdown()
