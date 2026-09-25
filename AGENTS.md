# Project publishing preference

The owner explicitly authorized automatic publishing for changes made through chat.

- After completing a requested project update, run appropriate checks, commit only the task's files, push to `origin/main`, and deploy the frontend and backend to Cloudflare. Do not ask for publishing confirmation again; tool-level permission requirements still apply.
- Use `powershell -NoProfile -File scripts/publish.ps1` after committing. It checks the clean `main` checkout, runs regression checks, pushes origin, and deploys the complete Cloudflare Worker with its static assets.
- Never force-push, overwrite unrelated work, or publish untested changes. Report a failure or missing account permission honestly.
- Production is the existing `lootlane-test-backend` Worker in account `44014acb04e2be1ced2a310b54003139`, with the existing D1 database and secrets. The intended public domains are `lootlaneblox.com` and `www.lootlaneblox.com`; see `DOMAIN.md` for domain activation status.
- Do not claim the .com is active until DNS, HTTPS, and the live page have been verified.
