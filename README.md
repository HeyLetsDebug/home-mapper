# Where's My Stuff

A tiny web app for tracking what's stored where around your home. Snap a photo of a shelf, drawer, or box, tap the exact spot, and jot a note. No account, no server, no app store.

## Put it live on GitHub Pages

1. Create a new **repository** on GitHub.
2. Upload every file in this folder to the repo (drag-and-drop on github.com works, or `git push` if you use git).
3. In the repo: **Settings → Pages**.
4. Under "Build and deployment," set Source to **Deploy from a branch**, pick `main` and `/ (root)`, then Save.
5. GitHub gives you a URL like `https://yourname.github.io/repo-name/` — open that on your phone.

## Add it to your home screen

- **iPhone (Safari):** open the link → Share icon → "Add to Home Screen."
- **Android (Chrome):** open the link → ⋮ menu → "Add to Home screen" / "Install app."

It then opens full-screen like a regular app. On iPhone specifically, doing this also makes your saved data less likely to get cleared than if you just kept it as a Safari tab.

## How your data is stored

Photos and notes are saved **only in the browser storage of the phone you're using** — never uploaded anywhere, never part of the GitHub repo. That means:

- Your home inventory is never public, even if the repo itself is public (the repo only ever contains app code).
- It works offline once loaded.
- It's tied to that one browser on that one device. Clearing your browser's site data, or switching phones, means starting over — unless you back up first.

Use **Export backup** (⋮ menu, top right) every so often to save a `.json` file somewhere safe, and **Import backup** to restore it later or move to a new phone.

## If you ever want it to sync across devices

That would mean saving entries into this GitHub repo itself (via a personal access token) instead of the phone's local storage, so any device could see the same data. It's a bigger change — happy to build it if you decide you want it.
