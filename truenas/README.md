# Open WebUI (Fork) — TrueNAS SCALE Deployment

This directory contains deployment templates for TrueNAS SCALE 24.10+ (Electric Eel) and 25.04+ (Fangtooth).

## Quick Start

1. **Create a dataset** for persistent data:
   ```
   Apps → Manage → Datasets → Add Dataset
   Name: open-webui
   ```

2. **Open the YAML editor**:
   ```
   Apps → Discover Apps → Custom App → Install via YAML
   ```

3. **Paste one of the templates below** and adjust paths/version as needed.

4. **Click Save** to deploy.

## Templates

| File | Description |
|------|-------------|
| `docker-compose.yaml` | Standard deployment with local Ollama |
| `docker-compose.remote.yaml` | Standalone UI connecting to a remote Ollama/server |
| `docker-compose.no-ollama.yaml` | Minimal deployment without Ollama (for API-only use) |

## Updating

Edit the image tag in the TrueNAS UI:
1. `Apps → Installed Applications → open-webui → Edit`
2. Update the `tag` field to the new version
3. Save — TrueNAS will pull and restart automatically

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `OLLAMA_BASE_URL` | `http://ollama:11434` | Ollama server URL |
| `WEBUI_SECRET_KEY` | (auto-generated) | Session encryption key |
| `OPENAI_API_BASE_URL` | (empty) | External OpenAI-compatible API |
| `OPENAI_API_KEY` | (empty) | API key for external services |

## Storage Layout

```
/mnt/<pool>/apps/open-webui/     ← Host Path (persistent data)
  └── /app/backend/data          ← Container mount point
```

All chats, settings, users, and uploaded documents are stored under this path.
