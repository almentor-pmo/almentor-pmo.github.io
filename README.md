# almentor PMO Recognition Dashboard

Live dashboard for `PMO_Recognition_Sheet_2026.xlsx` ("For Business Review" tab).

- **Site:** https://abdallahadel945-beep.github.io/almentor-dashboard/
- **Refresh:** a GitHub Action pulls the Excel file every hour, and on demand from the dashboard's **Refresh** button.
- **Access:** username + password. All data in this public repo is encrypted (AES-256-GCM); without a valid login it can't be read.

## How it works
1. `.github/workflows/sync.yml` runs hourly (and when the dashboard asks).
2. `scripts/sync.py` downloads the workbook from the SharePoint share link, parses the
   "For Business Review" tab (`scripts/sheetparse.py`), checks the numbers against the sheet's own
   Totals row, applies project-manager edits, and encrypts everything.
3. Encrypted data history is committed to `data/` on `main`; the site is published to GitHub Pages
   (and copied to the `published` branch, which the Refresh button reads for instant results).

New months, years and projects added to the sheet appear automatically, as long as the tab keeps
the same layout (project rows on top, `Mon-YY` month headers with Planned/Actual × C.Currency/USD columns,
then the "Total Projects Recognition" table).

## Repository secrets (Settings → Secrets and variables → Actions)
| Secret | What it is |
|---|---|
| `SHEET_URL` | SharePoint "Anyone with the link can view" link to the workbook |
| `DATA_KEY` | Encryption key for the dashboard data (base64, 32 bytes). Keep it private. |
| `DISPATCH_TOKEN` | Fine-grained GitHub token for this repo only, permission **Actions: Read and write**. Powers the Refresh button and PM editing. |

## Logins
Logins live in `keys.json` (safe to be public). Add or remove one with:
```
DATA_KEY=... python3 scripts/users.py add <username> <password>
python3 scripts/users.py remove <username>
```
then commit `keys.json`. A device that chose "Keep me signed in" stays signed in until it signs out;
to cut off every device, generate a new `DATA_KEY` and re-create the logins.
