"""Render the existing brand artwork as a crawler-friendly PNG. Requires Playwright and Chrome."""
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'assets' / 'lootlane-social-v1.png'

with sync_playwright() as p:
    browser = p.chromium.launch(channel='chrome', headless=True)
    page = browser.new_page(viewport={'width': 1200, 'height': 630}, device_scale_factor=1)
    page.goto((ROOT / 'scripts' / 'social-preview.html').as_uri(), wait_until='load')
    page.evaluate('document.fonts.ready')
    assert page.locator('img').evaluate_all('(images) => images.every(img => img.complete && img.naturalWidth > 0)'), 'Brand artwork did not load'
    page.screenshot(path=str(OUTPUT))
    browser.close()
print(f'Saved {OUTPUT} ({OUTPUT.stat().st_size:,} bytes, 1200 x 630)')
