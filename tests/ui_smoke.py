"""Browser regression checks. Requires Python Playwright and installed Chrome."""
import functools
import http.server
import json
from pathlib import Path
import threading
import time
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
        def mock_wall(route):
            wall_requests.append(route.request.url)
            route.fulfill(content_type="text/html", body="<body style='background:#102329;color:#d6eee6'><h1>Provider fixture</h1><div style='height:1600px'>Scrollable offers</div></body>")
        page.route("https://offerwall.gg/**", mock_wall)
        page.goto(base)
        expect(page.locator("#profileButton")).to_have_text("Log in")
        assert len(wall_requests) == 0, "Wall should not load above the fold"
        page.screenshot(path=str(ARTIFACTS / "desktop.png"), full_page=True)
        page.locator("#offerwall").scroll_into_view_if_needed()
        expect(page.locator("#offerwallFrame")).to_be_visible()
        page.wait_for_function("document.querySelector('#offerwallFrame').src.includes('userId=')")
        page.wait_for_timeout(250)
        assert len(wall_requests) == 1, wall_requests
        wall_url = page.locator("#offerwallFrame").get_attribute("src")
        assert wall_url == page.locator("#offerwallOpen").get_attribute("href")
        for i in range(8):
            page.mouse.wheel(0, 500 if i % 2 else -500)
            page.wait_for_timeout(70)
        assert len(wall_requests) == 1, "Scrolling must not reload offers"
        page.reload()
        page.locator("#offerwall").scroll_into_view_if_needed()
        page.wait_for_timeout(300)
        assert page.locator("#offerwallFrame").get_attribute("src") == wall_url, "Guest identity must survive reload"

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
        assert "userId=Player_Test123" in page.locator("#offerwallOpen").get_attribute("href")

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
        blocked_page.route("https://offerwall.gg/**", mock_wall)
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
