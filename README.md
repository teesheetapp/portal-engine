# Builder portal engine

One engine powers every builder's client portal. Each builder gets their own small website that
loads this engine plus **their own** settings, look, logo, and pages. Nothing about one builder is
ever shipped to another builder's site.

```
portal-engine  (this repository, shared)        stoneledge-portal  (one per builder)
├── app.js        all features                    ├── index.html      loads engine vX.Y.Z
├── styles.css    base look + customization hooks ├── settings.js     brand, words, process, switches, pages
├── supabase/     database + email functions      ├── theme.css       their finishing touches
└── template/     starter folder for a builder    ├── logos/          logo, icons, sign-in photo
                                                  └── CNAME           portal.theirdomain.com
```

## What a builder can customize

| Where | What |
|---|---|
| `settings.js` → `colors`, `fonts`, `logo` | Brand |
| `labels`, `navLabels`, `glossary`, `tour` | Their words (rename any section, rewrite the welcome tour) |
| `phases`, `draws`, `warranty`, `warrantyService`, `duties` | Their process |
| `features` | Sections on or off: questions, selections, changes, messages, diary, walls, manual, warranty, calendar, budget, documents, walkthrough, glossary, moments |
| `theme` | Presets: corners (square/soft/round), hero (band/light/photo), density (airy/compact), headings (caps/bold), texture (paper) |
| `signin` | Split-screen sign-in with their photo, headline, text, caption |
| `pages` | Pages only they have. Simple ones are `html` (with `{{client}}`, `{{home}}`, `{{pm}}`, `{{builder}}`); pages with logic use `render(Portal)` |
| `theme.css` | Anything else visual. Loads after the engine, so it always wins |

Rule: customization lives in the builder's folder. Never edit the engine for one builder.
If a builder needs something the engine can't do, add a general option to the engine.

## Set up a new builder

1. **Repository.** Create `<builder>-portal` on GitHub and copy everything in `template/` into it.
2. **Brand files.** Put their logos, icons, and an optional sign-in photo in `logos/` (see `logos/README.txt`).
3. **Settings.** Work through `settings.js`: brand, words, phases, draws, warranty, team duties, features, theme, sign-in, pages.
4. **Database.** Add their row to `builders` (slug must match `settings.js`) with `settings`: `portal_url`, `logo_url`, `from_name`, `office`, `colors`. Create their admin login.
5. **Hosting.** Repository Settings → Pages → deploy from `main`. Then their web person adds one DNS record:
   `CNAME  portal  →  teesheetapp.github.io`, and you rename `CNAME.example` to `CNAME` containing `portal.theirdomain.com`.
6. **Email from their domain.** In Resend, add their domain and give them the DNS records; set `from_name` in their builders row.
7. **Supabase Auth.** Add `https://portal.theirdomain.com` to Authentication → URL Configuration → Redirect URLs.

## Release a new engine version

1. Change `app.js` / `styles.css`, test, bump `VERSION`, commit, and push.
2. Each builder upgrades when you choose: in their `index.html`, replace the commit id after `portal-engine@`
   (two places) with the new commit id, and update the version comment.
   A commit never changes, so a builder's portal can't be affected by an engine update until you upgrade it.
   (If you create GitHub releases such as `v1.1.0`, `@v1.1.0` works the same way.)

## Email function

`supabase/functions/notify` is deployed as a one-line file that imports the code from this repository at a
pinned commit. To deploy a change: commit, then redeploy `notify` with the new commit id in its import URL.
