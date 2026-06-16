# JournalFX VPS MT5 Bridge Deployment

## Project Overview

### What is JournalFX?
JournalFX (JFX) is a SaaS **forex trading journal** for South African traders. It helps traders log, analyze, and improve their trading — with auto-sync from MetaTrader 4/5 terminals.

**Stack:**
- Frontend: React 19 + TypeScript + Vite (hosted on Vercel)
- Database: Supabase (PostgreSQL)
- Backend (this VPS): Python FastAPI + MT5 bridge (what you're building)
- Auth: Supabase Auth

### What This VPS Needs to Do
Run MT5 terminals headlessly (under Wine) and expose a REST API for the JournalFX frontend. This is the **Premium Tier** feature — "Broker Connect" — where users enter their MT5 credentials in the browser and the backend handles the connection.

### Architecture

```
Frontend (Vercel)                    Debian VPS (this machine)
┌──────────────────┐     HTTPS      ┌──────────────────────────────┐
│ BrokerConnect.tsx │ ──────────►   │ FastAPI Manager (port 8000) │
│ EASetup.tsx       │               │ - routes /api/mt5/*         │
│ OpenPositions.tsx │ ◄─────────── │ - auth proxy                │
└──────────────────┘               │ - pool manager              │
                                   │ - sync to Supabase          │
                                   └──────┬───────────────────────┘
                                          │
                                     ┌────▼────┐
                                     │ mt5-    │
                                     │ bridge  │ REST (port 8001)
                                     │ (pip    │
                                     │ install)│
                                     └────┬────┘
                                          │
                                     ┌────▼────┐
                                     │ MT5     │
                                     │ Terminal│
                                     │ (Wine)  │
                                     └─────────┘
```

**Key design decision:** Instead of Docker + MQL5 socket bridge, we use:
- **Wine + Xvfb** to run MT5 headlessly on Linux
- **`mt5-bridge`** (PyPI package) as the REST API layer — it uses the official `MetaTrader5` Python package to communicate with MT5
- **Thin FastAPI manager** to handle auth, proxying, and sync to Supabase

This is lighter, faster to set up, and more reliable than Docker + Wine + MQL5 compilation.

---

## Step-by-Step Build Instructions

### Step 1: System Preparation

```bash
# Update system
apt update && apt upgrade -y

# Install essential tools
apt install -y curl wget git ufw fail2ban

# Install Wine (for running MT5)
apt install -y wine wine64 wine32 xvfb xauth

# Install Python 3.11+
apt install -y python3 python3-pip python3-venv

# Install build tools for Python packages
apt install -y build-essential python3-dev

# Configure firewall
ufw allow 22/tcp        # SSH
ufw allow 80/tcp        # HTTP (for Let's Encrypt)
ufw allow 443/tcp       # HTTPS
ufw allow 8000/tcp      # FastAPI manager
ufw --force enable

# Enable unattended security updates
apt install -y unattended-upgrades
dpkg-reconfigure -f noninteractive unattended-upgrades
```

### Step 2: Create Service User

```bash
# Create dedicated user for the MT5 service
useradd -m -s /bin/bash jfxservice
passwd -l jfxservice  # Disable password login, SSH key only

# Grant sudo for deployment (optional, remove later)
usermod -aG sudo jfxservice
```

### Step 3: Install MT5 Terminal Under Wine

```bash
# Switch to service user
su - jfxservice

# Configure Wine
export WINEPREFIX=/home/jfxservice/.wine
export WINEARCH=win64
wine wineboot --init

# Create directory for scripts
mkdir -p /home/jfxservice/mt5-setup
cd /home/jfxservice/mt5-setup

# Download MT5 installer
wget "https://download.mql5.com/cdn/web/metaquotes.software.corp/mt5/mt5setup.exe" -O mt5setup.exe

# Install MT5 headlessly using Xvfb
xvfb-run -a -s "-screen 0 800x600x16" wine /home/jfxservice/mt5-setup/mt5setup.exe /auto

# Wait for installation to complete (MT5 installer takes 2-3 minutes)
sleep 180

# Verify MT5 is installed
ls -la /home/jfxservice/.wine/drive_c/Program\ Files/MetaTrader\ 5/

# Create MT5 config for headless mode
mkdir -p "/home/jfxservice/.wine/drive_c/Program Files/MetaTrader 5/config"
cat > "/home/jfxservice/.wine/drive_c/Program Files/MetaTrader 5/config/terminal.ini" << 'EOF'
[Common]
Login=0
ProxyEnable=0
CertPassword=0
NewsEnable=0
SoundEnable=0
EventsEnable=0
MailEnable=0
FTPEnable=0
SignalEnable=0

[Charts]
MaxBars=5000

[Experts]
AllowLiveTrading=1
AllowDllImport=1
DisableAfterAccountChanged=0
DisableAfterProfileChanged=0
EOF

# Enable AutoTrading in MT5 registry
cd /home/jfxservice/.wine/drive_c/Program\ Files/MetaTrader\ 5/
wine reg import - <<< '
[HKEY_CURRENT_USER\Software\MetaQuotes\Terminal]
"AutoTrading"=dword:00000001
'
```

### Step 4: Create Script to Start MT5 Headlessly

```bash
cat > /home/jfxservice/start_mt5.sh << 'SCRIPT'
#!/bin/bash
export DISPLAY=:99
export WINEPREFIX=/home/jfxservice/.wine
export WINEARCH=win64
export WINEDEBUG=-all

# Start Xvfb if not running
if ! pgrep -x Xvfb > /dev/null; then
    /usr/bin/Xvfb :99 -screen 0 800x600x16 &
    sleep 2
fi

# Start MT5 terminal headlessly
exec wine "/home/jfxservice/.wine/drive_c/Program Files/MetaTrader 5/terminal64.exe" /portable /config:config/terminal.ini
SCRIPT

chmod +x /home/jfxservice/start_mt5.sh
chown jfxservice:jfxservice /home/jfxservice/start_mt5.sh
```

### Step 5: Install & Configure mt5-bridge

```bash
su - jfxservice

# Create Python virtual environment
python3 -m venv /home/jfxservice/jfx-venv
source /home/jfxservice/jfx-venv/bin/activate

# Install mt5-bridge (this automatically installs MetaTrader5 and FastAPI)
pip install mt5-bridge uvicorn

# Verify installation
python -c "from mt5_bridge import main; print('mt5-bridge installed')"

# Create mt5-bridge runner script
cat > /home/jfxservice/run_bridge.py << 'PYEOF'
"""
Run mt5-bridge server.
"""
import os

os.environ["MT5_BRIDGE_HOST"] = "127.0.0.1"
os.environ["MT5_BRIDGE_PORT"] = "8001"

from mt5_bridge.main import app
import uvicorn

if __name__ == "__main__":
    uvicorn.run(
        app,
        host="127.0.0.1",
        port=8001,
        log_level="info"
    )
PYEOF
```

### Step 6: Build the Thin Manager Service (FastAPI)

This is the main piece of custom code. The manager:

- Runs on port 8000 (public-facing)
- Authenticates requests (API key from JournalFX)
- Proxies MT5 calls to mt5-bridge on port 8001
- Syncs trades to Supabase edge function

Create directories:

```bash
mkdir -p /home/jfxservice/manager
```

Create `/home/jfxservice/manager/main.py`:

```python
"""
JournalFX MT5 Bridge Manager
Orchestrates mt5-bridge instances and proxies to JournalFX frontend.
"""

import os
import httpx
from fastapi import FastAPI, HTTPException, Depends, Security
from fastapi.security import APIKeyHeader
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional

# ============================================================
# Configuration
# ============================================================
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_ANON_KEY = os.environ.get("SUPABASE_ANON_KEY", "")
SYNC_EDGE_FUNCTION = f"{SUPABASE_URL}/functions/v1/sync-trades"
VPS_API_KEY = os.environ.get("VPS_API_KEY", "change-me")
MT5_BRIDGE_URL = os.environ.get("MT5_BRIDGE_URL", "http://127.0.0.1:8001")

# ============================================================
# FastAPI App
# ============================================================
app = FastAPI(title="JournalFX MT5 Manager", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)

async def verify_key(api_key: str = Security(api_key_header)):
    if not api_key or api_key != VPS_API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API key")
    return api_key

# ============================================================
# Models
# ============================================================
class TradeRequest(BaseModel):
    symbol: str
    volume: float = 0.01
    direction: str = "BUY"
    sl: Optional[float] = 0
    tp: Optional[float] = 0

class CloseRequest(BaseModel):
    ticket: int

# ============================================================
# MT5 Bridge Proxy
# ============================================================
async def proxy_to_bridge(path: str, method: str = "GET", body: dict = None):
    """Proxy request to mt5-bridge."""
    url = f"{MT5_BRIDGE_URL}{path}"
    async with httpx.AsyncClient(timeout=30) as client:
        try:
            if method == "GET":
                resp = await client.get(url)
            elif method == "POST":
                resp = await client.post(url, json=body)
            else:
                raise HTTPException(405, "Method not allowed")

            if resp.status_code >= 400:
                raise HTTPException(resp.status_code, resp.text)
            return resp.json()
        except httpx.RequestError as e:
            raise HTTPException(503, f"MT5 bridge unreachable: {str(e)}")

@app.get("/health")
async def health():
    """Health check."""
    try:
        bridge_health = await proxy_to_bridge("/health")
        return {"status": "ok", "bridge": bridge_health}
    except:
        return {"status": "degraded", "bridge": "unreachable"}

@app.get("/api/mt5/account")
async def get_account(api_key: str = Depends(verify_key)):
    """Get MT5 account info."""
    return await proxy_to_bridge("/account")

@app.get("/api/mt5/positions")
async def get_positions(api_key: str = Depends(verify_key)):
    """Get open positions."""
    return await proxy_to_bridge("/positions")

@app.get("/api/mt5/history/{symbol}")
async def get_history(
    symbol: str,
    api_key: str = Depends(verify_key)
):
    """Get position history."""
    return await proxy_to_bridge(f"/history/{symbol}")

@app.get("/api/mt5/rates/{symbol}")
async def get_rates(
    symbol: str,
    timeframe: str = "M1",
    count: int = 100,
    api_key: str = Depends(verify_key)
):
    """Get historical rates."""
    return await proxy_to_bridge(f"/rates/{symbol}?timeframe={timeframe}&count={count}")

@app.get("/api/mt5/tick/{symbol}")
async def get_tick(symbol: str, api_key: str = Depends(verify_key)):
    """Get latest tick."""
    return await proxy_to_bridge(f"/tick/{symbol}")

@app.post("/api/mt5/order")
async def place_order(order: TradeRequest, api_key: str = Depends(verify_key)):
    """Place a trade order."""
    return await proxy_to_bridge("/order", "POST", order.model_dump())

@app.post("/api/mt5/close")
async def close_position(req: CloseRequest, api_key: str = Depends(verify_key)):
    """Close a position by ticket."""
    return await proxy_to_bridge("/close", "POST", req.model_dump())

@app.post("/api/mt5/sync")
async def sync_trades(api_key: str = Depends(verify_key)):
    """Sync trades from MT5 to Supabase."""
    account = await proxy_to_bridge("/account")
    positions = await proxy_to_bridge("/positions")

    payload = {
        "account": account,
        "openPositions": positions.get("positions", []),
        "trades": [],
        "isHeartbeat": True,
        "timestamp": None
    }

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            SYNC_EDGE_FUNCTION,
            json=payload,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {SUPABASE_ANON_KEY}",
                "Sync-Key": api_key
            }
        )

    return {"synced": resp.status_code == 200, "status": resp.status_code}

@app.on_event("startup")
async def startup():
    print("Manager started. MT5 bridge expected at:", MT5_BRIDGE_URL)

@app.on_event("shutdown")
async def shutdown():
    print("Manager shutting down.")
```

Create requirements:

```bash
cat > /home/jfxservice/manager/requirements.txt << 'EOF'
fastapi>=0.115.0
uvicorn>=0.30.0
httpx>=0.27.0
pydantic>=2.0.0
EOF

# Install manager dependencies
source /home/jfxservice/jfx-venv/bin/activate
pip install -r /home/jfxservice/manager/requirements.txt
```

Set ownership:

```bash
chown -R jfxservice:jfxservice /home/jfxservice/manager
chown -R jfxservice:jfxservice /home/jfxservice/jfx-venv
chown -R jfxservice:jfxservice /home/jfxservice/run_bridge.py
```

### Step 7: Create systemd Services

Create `/etc/systemd/system/jfx-mt5.service`:

```bash
sudo bash -c 'cat > /etc/systemd/system/jfx-mt5.service << "EOF"
[Unit]
Description=JournalFX Headless MT5 Terminal
After=network.target

[Service]
Type=simple
User=jfxservice
Environment=DISPLAY=:99
Environment=WINEPREFIX=/home/jfxservice/.wine
Environment=WINEARCH=win64
Environment=WINEDEBUG=-all
ExecStartPre=/usr/bin/Xvfb :99 -screen 0 800x600x16
ExecStart=/usr/bin/wine "/home/jfxservice/.wine/drive_c/Program Files/MetaTrader 5/terminal64.exe" /portable /config:config/terminal.ini
Restart=always
RestartSec=10
KillMode=process

[Install]
WantedBy=multi-user.target
EOF'
```

Create `/etc/systemd/system/jfx-bridge.service`:

```bash
sudo bash -c 'cat > /etc/systemd/system/jfx-bridge.service << "EOF"
[Unit]
Description=JournalFX mt5-bridge REST API
After=network.target jfx-mt5.service
Requires=jfx-mt5.service

[Service]
Type=simple
User=jfxservice
WorkingDirectory=/home/jfxservice
Environment=PATH=/home/jfxservice/jfx-venv/bin:/usr/bin
ExecStart=/home/jfxservice/jfx-venv/bin/python /home/jfxservice/run_bridge.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF'
```

Create `/etc/systemd/system/jfx-manager.service`:

```bash
sudo bash -c 'cat > /etc/systemd/system/jfx-manager.service << "EOF"
[Unit]
Description=JournalFX MT5 Manager API
After=network.target jfx-bridge.service
Requires=jfx-bridge.service

[Service]
Type=simple
User=jfxservice
WorkingDirectory=/home/jfxservice/manager
Environment=PATH=/home/jfxservice/jfx-venv/bin:/usr/bin
ExecStart=/home/jfxservice/jfx-venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000 --log-level info
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF'
```

Reload and enable:

```bash
sudo systemctl daemon-reload
sudo systemctl enable jfx-mt5.service
sudo systemctl enable jfx-bridge.service
sudo systemctl enable jfx-manager.service
sudo systemctl start jfx-mt5.service
sudo systemctl start jfx-bridge.service
sudo systemctl start jfx-manager.service
```

### Step 8: Set Up Environment Variables

Create `/home/jfxservice/.env`:

```bash
cat > /home/jfxservice/.env << 'EOF'
# Supabase (get these from your Supabase project dashboard)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-supabase-anon-key

# VPS API key (generate a random string with: openssl rand -hex 32)
VPS_API_KEY=generate-a-random-secure-key-here

# MT5 Bridge
MT5_BRIDGE_URL=http://127.0.0.1:8001
MT5_WINE_PREFIX=/home/jfxservice/.wine
EOF

# Secure the env file
chmod 600 /home/jfxservice/.env
chown jfxservice:jfxservice /home/jfxservice/.env
```

Then update the systemd service files to load the env file. Add this line to the `[Service]` section of `jfx-manager.service` and `jfx-bridge.service`:

```
EnvironmentFile=/home/jfxservice/.env
```

```bash
# Example: add EnvironmentFile to jfx-manager.service
sudo sed -i '/^\[Service\]/a EnvironmentFile=/home/jfxservice/.env' /etc/systemd/system/jfx-manager.service
sudo sed -i '/^\[Service\]/a EnvironmentFile=/home/jfxservice/.env' /etc/systemd/system/jfx-bridge.service
sudo systemctl daemon-reload
sudo systemctl restart jfx-manager.service jfx-bridge.service
```

### Step 9: Install Nginx + SSL (Optional but Recommended)

```bash
apt install -y nginx certbot python3-certbot-nginx

# Configure nginx as reverse proxy
cat > /etc/nginx/sites-available/jfx-api << 'NGINX'
server {
    listen 80;
    server_name api.journalfx.com;  # Replace with your actual domain

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_cache_bypass $http_upgrade;
    }

    client_max_body_size 10m;
}
NGINX

ln -s /etc/nginx/sites-available/jfx-api /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx

# Get SSL certificate (replace with your actual domain)
# certbot --nginx -d api.journalfx.com
```

### Step 10: Verification

```bash
# Check services are running
systemctl status jfx-mt5.service
systemctl status jfx-bridge.service
systemctl status jfx-manager.service

# Test manager health endpoint
curl http://localhost:8000/health

# Test with API key
curl -H "X-API-Key: your-key" http://localhost:8000/api/mt5/account
```

---

## Endpoints Summary

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/health` | Health check | No |
| GET | `/api/mt5/account` | Account info (balance, equity, etc.) | Yes |
| GET | `/api/mt5/positions` | Open positions | Yes |
| GET | `/api/mt5/history/{symbol}` | Position history | Yes |
| GET | `/api/mt5/rates/{symbol}` | Historical rates | Yes |
| GET | `/api/mt5/tick/{symbol}` | Latest tick/price | Yes |
| POST | `/api/mt5/order` | Open trade | Yes |
| POST | `/api/mt5/close` | Close position | Yes |
| POST | `/api/mt5/sync` | Sync trades to Supabase | Yes |

All authenticated endpoints require header: `X-API-Key: <VPS_API_KEY>`

---

## Frontend Integration (for reference)

Once the VPS is running, the JournalFX frontend (which lives in a separate repo/deployment on Vercel) needs these changes:

**1.** In `lib/constants.ts`, add:
```typescript
export const VPS_API_URL = import.meta.env.VITE_VPS_API_URL || 'http://localhost:8000';
export const VPS_API_KEY = import.meta.env.VITE_VPS_API_KEY || '';
```

**2.** Add to Vercel environment variables:
```
VITE_VPS_API_URL=https://api.journalfx.com
VITE_VPS_API_KEY=<same-key-as-vps-env>
```

**3.** Update `components/BrokerConnect.tsx` to call the VPS URL instead of the Vite dev proxy paths.

---

## Troubleshooting

**MT5 won't start under Wine:**
```bash
# Check if Xvfb is running
pgrep -a Xvfb

# Try running MT5 manually as jfxservice
su - jfxservice -c "/home/jfxservice/start_mt5.sh"

# Check Wine logs
less /home/jfxservice/.wine/drive_c/users/jfxservice/Application\ Data/MetaQuotes/Terminal/common/logs/
```

**mt5-bridge can't connect to MT5:**
- Ensure MT5 terminal is running and logged into an account
- The `MetaTrader5` Python package needs to find the running terminal
- Check the bridge logs: `journalctl -u jfx-bridge.service -f`

**Manager can't reach mt5-bridge:**
```bash
# Test bridge directly
curl http://127.0.0.1:8001/health
```

**View service logs:**
```bash
journalctl -u jfx-mt5.service -f
journalctl -u jfx-bridge.service -f
journalctl -u jfx-manager.service -f
```

---

## Files Created During Setup

| File | Purpose |
|------|---------|
| `/home/jfxservice/.wine/` | Wine prefix with MT5 installed |
| `/home/jfxservice/start_mt5.sh` | Script to launch MT5 headlessly |
| `/home/jfxservice/jfx-venv/` | Python virtual environment |
| `/home/jfxservice/run_bridge.py` | mt5-bridge runner script |
| `/home/jfxservice/manager/main.py` | FastAPI manager app |
| `/home/jfxservice/manager/requirements.txt` | Python dependencies |
| `/home/jfxservice/.env` | Environment config (secrets) |
| `/etc/systemd/system/jfx-mt5.service` | MT5 systemd service |
| `/etc/systemd/system/jfx-bridge.service` | Bridge systemd service |
| `/etc/systemd/system/jfx-manager.service` | Manager systemd service |
| `/etc/nginx/sites-available/jfx-api` | Nginx reverse proxy config |
