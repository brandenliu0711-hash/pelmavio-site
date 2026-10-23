# pelmavio-site

Static website for Pelmavio Studio and the Ringwell app, served at https://pelmavio.com via GitHub Pages.

Plain HTML and CSS plus one small first-party script, `assets/ringwell.js`, used only on the Ringwell product pages for the scroll-driven demo. The script makes no network requests and uses no cookies or storage; without it (or with reduced motion) the page shows a static version. No third-party scripts, fonts, analytics or cookies.

- `assets/style.css`: site styles. `assets/gallery.css`: the real-screenshot gallery on the Ringwell pages. `assets/lite.css`: the 404 page.
- `assets/shots/`: real iPhone screenshots of Ringwell 1.0 (WebP with PNG fallback).
- `ringwell/app-config.json`: read by the app's version check. Keep it valid; changing `minSupportedVersion` affects users.
- `CNAME`, `.nojekyll`, `404.html`: GitHub Pages setup.

Before publishing, run `node scripts/check-site.js` (links, lang/title/description, draft leftovers, script rules, size budgets, sitemap, app-config.json).
