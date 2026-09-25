# Project publishing preference

The owner explicitly authorized automatic publishing for changes made through chat.

- After completing a requested project update, run appropriate checks, commit only the task's files, push to `origin/main`, and deploy the frontend and backend to Cloudflare. Do not ask for publishing confirmation again; tool-level permission requirements still apply.
- Use `powershell -NoProfile -File scripts/publish.ps1` after committing. It checks the clean `main` checkout, runs regression checks, pushes origin, and deploys the complete Cloudflare Worker with its static assets.
- Never force-push, overwrite unrelated work, or publish untested changes. Report a failure or missing account permission honestly.
- The owner clarified that GitHub Pages serves the frontend at `lootlaneblox.com`. Keep the root `CNAME` file and GitHub Pages custom-domain setting. Cloudflare manages DNS and the `lootlane-test-backend` API, with its existing D1 database and secrets. Do not attach the .com to a Worker or migrate frontend hosting unless asked. Frontend API requests must use the Worker HTTPS origin, since GitHub Pages cannot serve `/api/`.
- Do not claim the .com is active until DNS, HTTPS, and the live page have been verified.
