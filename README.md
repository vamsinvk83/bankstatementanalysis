# Ledger Import

Bank & card statements → accounting-ready CSV. Runs entirely in the browser —
PDF parsing, OCR, and Excel/CSV parsing all happen on-device; no statement
data is ever uploaded anywhere.

## Hosting this on GitHub Pages

1. Create a new GitHub repo (public or private — Pages works on both, private
   needs GitHub Pro/Team/Enterprise for Pages).
2. Add this file to the repo as `index.html` (rename it if it isn't already).
3. Push to GitHub.
4. In the repo, go to **Settings → Pages**, set **Source** to the branch/folder
   this file lives in (e.g. `main` / `/root`), save.
5. GitHub will give you a URL like `https://<your-username>.github.io/<repo>/`
   — that's the live tool.

No build step, no server, no dependencies to install — it's one self-contained
HTML file with every library (pdf.js, Tesseract.js, SheetJS) embedded inline.

## Updating it later

If you ask me to change the tool again, I'll rebuild this same file — just
re-download it and overwrite `index.html` in your repo, then push. GitHub
Pages picks up the new version automatically within a minute or two.

## What it does

- Drop in one or more PDF, CSV, XLS, or XLSX bank/card statements.
- PDFs are read via their text layer where possible, or on-device OCR
  (Tesseract.js) when the PDF is a scan with no real text.
- Rows are auto-categorized (UPI, ACH/NACH, EMI, Loan, Salary, Bonus, etc.) —
  edit the rules yourself in "Manage categorisation rules".
- An Analysis tab shows monthly cash flow, category breakdown, a balance
  trend, and underwriting-style notes (average balance, recurring
  obligations, cash-withdrawal ratio, high-value outliers).
- Export as 3-column (Date/Description/Amount) or 4-column
  (Date/Description/Debit/Credit) CSV, ready for QuickBooks or similar.
