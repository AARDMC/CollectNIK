# Form Builder Pro — GitHub + Google Drive

## Setup

1. Upload `index.html`, `odk-engine.js`, `Code.gs` (keep as reference only — the real one lives in Apps Script), `README.md` to a **public** GitHub repo.
2. Enable GitHub Pages on `main` / root. Copy your URL.
3. Go to script.google.com → New project → paste `Code.gs` → set `SECRET` to a long random string.
4. Set `BOOT_USER` / `BOOT_PASS` (8+ chars) in `Code.gs`, select `bootstrap` in the editor and click Run once (approve the Drive/Sheets permissions). Then reset `BOOT_PASS` to a placeholder.
5. Deploy → New deployment → Web app → Execute as me → Anyone. Copy `/exec` URL. After editing `Code.gs` later, use Deploy → Manage deployments → New version.
6. Open your GitHub Pages URL → Cloud → paste URL + secret → **Publish**.

## Use

- **Collector link** = `https://<user>.github.io/<repo>/?form=FORM_ID&api=<EXEC_URL>`
- **Publish / CSV / XLSForm** = ☁ Cloud button
- **Sign in / create users** = 👤 Account
- **Review submissions** = 📊 Data

## Debug

- Health: `GET <EXEC_URL>?action=health`
- Audit: `FormBuilder Data/logs/audit_YYYY-MM-DD.csv` in Drive
- Version history: `FormBuilder Data/versions/<formId>/v_*.json`