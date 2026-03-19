# GitHub Actions (every 10 minutes) setup

## Why
Vercel Hobby plan only supports daily cron. We use GitHub Actions scheduler to call `/api/refresh` every 10 minutes.

## Steps

1) Create a GitHub repo (private recommended) and push this project.

2) In GitHub repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**

Add secret:
- Name: `REFRESH_URL`
- Value: `https://world-peace-timer.vercel.app/api/refresh?token=YOUR_TOKEN`

3) Confirm the workflow exists:
- `.github/workflows/refresh.yml`

4) Wait ~10 minutes and check:
- GitHub → Actions → `Refresh world peace timer` runs
- Your site status:
  - `https://world-peace-timer.vercel.app/api/status` → `updatedAtISO` should advance

## Notes
- If you rotate the token, update both Vercel env `REFRESH_TOKEN` and the GitHub secret `REFRESH_URL`.
- GitHub scheduled workflows may be delayed slightly.
