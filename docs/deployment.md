# Deployment

Since the Vercel Hobby plan blocks private repo deployments (commit author must be the project owner), the repo must remain **public**.

## Trigger a deploy

```powershell
Invoke-RestMethod -Method Post -Uri "https://api.vercel.com/v1/integrations/deploy/prj_Q3NrV3DDu6mhdskwn249cbACxx6l/vVc6M0ZJsK"
```

Alternatively with `curl` (Git Bash / WSL):

```bash
curl -X POST "https://api.vercel.com/v1/integrations/deploy/prj_Q3NrV3DDu6mhdskwn249cbACxx6l/vVc6M0ZJsK"
```

## Push to GitHub

```powershell
git push --force origin2 master:main
```

Then trigger the deploy hook.
