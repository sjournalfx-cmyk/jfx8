---
name: deploy-pipeline
description: Use when the user asks to commit, push, or deploy this project (JournalFX). Triggers on "commit local changes", "push to both remotes", "deploy", "trigger vercel deploy hook", "ship it", or "release". Runs the full pipeline: stage + commit local changes, push to both origin/main and origin/master, then fire the Vercel deploy hook.
---

# Deploy Pipeline (JournalFX)

This project is hosted on Vercel (`jfx8`) and deployed manually via a deploy hook. Only run this pipeline when explicitly requested.

## Pipeline order

1. **Commit local changes**
2. **Push to both branches** (`origin/main` and `origin/master`)
3. **Trigger the Vercel deploy hook**

Stop if any step fails and report the error instead of continuing.

## 1. Commit

```powershell
git status
git diff
```

- Inspect changes. Stage only intended files.
- Never commit secrets beyond what the user has already deliberately placed in source.
- If `git commit` fails with "Author identity unknown", use the repo's existing author (check `git log --format='%an <%ae>' -1`) and pass it inline:

```powershell
git -c user.name="<author>" -c user.email="<email>" commit -m "<message>"
```

- Write a concise commit message matching the repo style (imperative, descriptive).

## 2. Push

The plain `git push origin main` may fail with "could not read Username" because the default helper prompts interactively. Do NOT use `GITHUB_PAT` for pushing — it lacks push access (403). Instead, resolve the stored credential and push via an authenticated URL:

```powershell
$cred = (Write-Output "protocol=https`nhost=github.com`n" | git credential fill) 2>$null
$token = ($cred | Where-Object { $_ -like "password=*" }).Substring(9)
$url = "https://x-access-token:$token@github.com/sjournalfx-cmyk/jfxbeta8.8.git"
git push $url main:main
if ($?) { git push $url main:master }
```

Push to **both** branches: `main:main` first, then `main:master`. The remote branch is `origin/master`; the local branch is `main`.

## 3. Trigger Vercel deploy hook

```powershell
$r = Invoke-WebRequest -Uri "https://api.vercel.com/v1/integrations/deploy/prj_lQh9T1ByDI22nrN35Y5r4nI7C6FU/37DuJhjKQK" -Method POST -UseBasicParsing
Write-Output "Status: $($r.StatusCode)"
Write-Output $r.Content
```

- Success = HTTP 201 with a JSON body containing `job.id` and `state: PENDING`.
- Report the job ID and state to the user.

## Reference values

- Remote: `https://github.com/sjournalfx-cmyk/jfxbeta8.8.git`
- Vercel project: `jfx8` (id `prj_lQh9T1ByDI22nrN35Y5r4nI7C6FU`)
- Deploy hook URL: `https://api.vercel.com/v1/integrations/deploy/prj_lQh9T1ByDI22nrN35Y5r4nI7C6FU/37DuJhjKQK`