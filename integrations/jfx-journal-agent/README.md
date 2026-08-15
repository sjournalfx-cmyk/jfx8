# JFX Journal Agent Skill

This package teaches Claude Code, Codex CLI, Hermes, and other tool-capable agents how to use the JFX Journal API.

It contains instructions and examples only. **Never commit a real `JFX_KEY` to this repository.** Store the key in the agent's environment or a secret manager.

## Install

Copy `SKILL.md` into the agent's skills directory. For Claude Code, a typical project-local path is `.claude/skills/jfx-journal/SKILL.md`. For Codex-compatible loaders, use `$CODEX_HOME/skills/jfx-journal/SKILL.md`.

Set the key before starting the agent:

```bash
export JFX_KEY="jfx_pat_..."
```

PowerShell:

```powershell
$env:JFX_KEY = "jfx_pat_..."
```

## Quick test

```bash
curl -sS -H "X-API-Key: $JFX_KEY" "https://lwlikhjgwazyrahucatl.supabase.co/functions/v1/jfx-api/v1/trades?limit=1"
```

Create the API key in JFX Journal under **Settings → Developer Tools**.
