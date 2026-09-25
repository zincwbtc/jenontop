# Frontend regression checks

Run from the repository root with Python Playwright and Chrome installed:

```sh
python tests/ui_smoke.py
```

The test starts a temporary local HTTP server and runs headless Chrome. It:

- Reproduces the former activity observer feedback loop with a 1,000-callback safety limit.
- Checks login typing, Enter, Escape, backdrop dismissal, and close button behavior.
- Verifies a guest's offerwall identity survives reloads and matches the new-tab link.
- Checks exact provider prices, survey estimates, variable payouts and multi-step total labels.
- Confirms scrolling does not reload the offerwall.
- Checks logo alignment, artwork centering, and horizontal overflow at 1440, 768, 390, and 320 pixels.
- Exercises support using a mocked endpoint, without sending Discord messages.
- Verifies reduced-motion styles and login when browser storage is blocked.
- Keeps the page open beyond the old 18-second freeze trigger and checks responsiveness.

Provider content is mocked so these checks are repeatable. Real Offerwall.GG availability, offer eligibility, completion callbacks, and Robux delivery are separate integration concerns.

Screenshots are saved in the ignored `.tmp-ui/` directory.
