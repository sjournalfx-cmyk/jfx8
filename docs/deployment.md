# Deployment

Since the Vercel Hobby plan blocks private repo deployments (commit author must be the project owner), the repo must remain **public**.

## Full workflow

Each time you have local changes to push to production:

1. ✅ **Commit local changes**
   ```powershell
   git add -A
   git commit -m "description of changes"
   ```

2. ✅ **Push to both remotes**
   ```powershell
   git push --force jfx8 master:main
   git push --force origin2 master:main
   ```

3. ✅ **Trigger Vercel deploy hook**
   ```powershell
   Invoke-RestMethod -Method Post -Uri "https://api.vercel.com/v1/integrations/deploy/prj_lQh9T1ByDI22nrN35Y5r4nI7C6FU/37DuJhjKQK"
   ```

   Or with `curl` (Git Bash / WSL):
   ```bash
   curl -X POST "https://api.vercel.com/v1/integrations/deploy/prj_lQh9T1ByDI22nrN35Y5r4nI7C6FU/37DuJhjKQK"
   ```
