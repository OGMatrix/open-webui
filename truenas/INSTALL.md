# TrueNAS SCALE — Step-by-Step Installation Guide

## Prerequisites

1. **TrueNAS SCALE 24.10+** (Electric Eel) or **25.04+** (Fangtooth)
2. **Internet access** to pull the container image from GHCR
3. **A dataset** created for persistent data

---

## Step 1: Create the Dataset

Persistent data (chats, settings, users, documents) must survive container restarts.

1. Go to **Storage → Datasets**
2. Select your apps pool (e.g., `tank`)
3. Click **Add Dataset**
   - **Name:** `open-webui`
   - **Compression:** LZ4 (recommended)
   - **Record Size:** 128K (recommended)
4. Click **Save**

Repeat for Ollama if using local models:
- **Name:** `ollama`

---

## Step 2: Deploy via YAML

1. Go to **Apps → Discover Apps**
2. Click **Custom App** (top right)
3. Select **Install via YAML**
4. Paste the contents of your chosen template
5. **Replace `<pool>`** with your actual pool name (e.g., `tank`)
6. Click **Save**

---

## Step 3: Access the Web UI

1. Go to **Apps → Installed Applications**
2. Wait for `open-webui` status to show **Running**
3. Click the **Portal URL** or open `http://<NAS_IP>:8080`
4. Create your admin account on first visit

---

## Step 4: Configure LLM Backend

### Option A: Local Ollama (included in compose)

The compose file includes an Ollama container. To add models:

1. Open WebUI → **Settings → Ollama**
2. The base URL is pre-configured as `http://ollama:11434`
3. Go to **Admin → Models** to pull models
4. Or use the built-in model downloader

### Option B: Remote Ollama

1. Edit the compose file
2. Set `OLLAMA_BASE_URL=http://<YOUR_OLLAMA_IP>:11434`
3. Ensure Ollama is running with `--listen` flag on the remote host

### Option C: OpenAI / OpenRouter API

1. Open WebUI → **Settings → Connections**
2. Enter your API key
3. Select your preferred model

---

## Updating

1. Go to **Apps → Installed Applications**
2. Click on `open-webui`
3. Click **Edit** (pencil icon)
4. Update the `tag` field to the new version
5. Click **Save**

TrueNAS will pull the new image and restart the container automatically.

---

## Troubleshooting

### Container won't start
- Check **Apps → Installed Applications → open-webui → Logs**
- Ensure dataset paths exist and are accessible
- Verify the image tag is correct

### Can't connect to Web UI
- Confirm port 8080 isn't used by another service
- Check firewall rules if accessing remotely
- Try `http://localhost:8080` from the NAS shell

### Data not persisting
- Verify the host path in the compose file matches your dataset
- Check dataset permissions (should be readable by the container)

### Ollama connection refused
- Ensure Ollama container is running: `docker ps`
- Check Ollama logs in TrueNAS UI
- Verify `OLLAMA_BASE_URL` matches the service name
