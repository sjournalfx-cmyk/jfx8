"""
JournalFX MT5 Bridge Manager
Orchestrates mt5-bridge instances and proxies to JournalFX frontend.
Enhanced with broker endpoints and diagnostics.
"""

import os
import subprocess
import time
import json
import hmac
from datetime import datetime, timezone
from typing import Optional

import httpx
from fastapi import FastAPI, HTTPException, Depends, Security, Query
from fastapi.security import APIKeyHeader
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# ============================================================
# Configuration
# ============================================================
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_ANON_KEY = os.environ.get("SUPABASE_ANON_KEY", "")
SYNC_EDGE_FUNCTION = f"{SUPABASE_URL}/functions/v1/sync-trades"
VPS_API_KEY = os.environ.get("VPS_API_KEY", "change-me")
MT5_BRIDGE_URL = os.environ.get("MT5_BRIDGE_URL", "http://127.0.0.1:8001")

# ============================================================
# In-memory state per user
# ============================================================
class BrokerState:
    def __init__(self):
        self.server: str = ""
        self.login: str = ""
        self.password: str = ""
        self.status: str = "disconnected"
        self.last_sync_at: Optional[str] = None
        self.last_error: Optional[str] = None
        self.sync_key: Optional[str] = None
        self.connected_at: Optional[str] = None
        self.id_token: Optional[str] = None  # User's Supabase JWT, forwarded on sync

user_states: dict[str, BrokerState] = {}

# ============================================================
# FastAPI App
# ============================================================
app = FastAPI(title="JournalFX MT5 Manager", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)

async def verify_key(api_key: str = Security(api_key_header)):
    # Constant-time comparison to avoid timing side-channels on the shared key.
    if not api_key or not hmac.compare_digest(api_key.encode(), VPS_API_KEY.encode()):
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

class CredentialsBody(BaseModel):
    server: str
    login: str
    password: str
    id_token: Optional[str] = None  # Supabase JWT of the connecting user

class SyncBody(BaseModel):
    user_id: str
    sync_key: str

# ============================================================
# MT5 Bridge Proxy
# ============================================================
async def proxy_to_bridge(path: str, method: str = "GET", body: dict = None):
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

# ============================================================
# Helpers
# ============================================================
def run_cmd(cmd: list[str]) -> str:
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
        return result.stdout.strip()
    except Exception as e:
        return f"error: {e}"

def check_mt5_process() -> dict:
    pid = run_cmd(["pgrep", "-f", "terminal64.exe"])
    if pid and "error" not in pid:
        return {"running": True, "pid": int(pid.split("\n")[0])}
    pid_wine = run_cmd(["pgrep", "-f", "wine.*terminal64"])
    if pid_wine and "error" not in pid_wine:
        return {"running": True, "pid": int(pid_wine.split("\n")[0])}
    return {"running": False, "pid": None}

def check_bridge_health() -> dict:
    try:
        resp = httpx.get(f"{MT5_BRIDGE_URL}/health", timeout=5)
        return {"reachable": resp.status_code == 200, "status_code": resp.status_code}
    except Exception as e:
        return {"reachable": False, "error": str(e)}

def get_system_info() -> dict:
    uptime = run_cmd(["uptime", "-p"])
    mem = run_cmd(["free", "-m"])
    mem_lines = mem.split("\n")
    mem_info = {}
    if len(mem_lines) > 1:
        parts = mem_lines[1].split()
        if len(parts) >= 3:
            mem_info = {"total_mb": parts[1], "used_mb": parts[2], "free_mb": parts[3]}
    return {"uptime": uptime, "memory": mem_info}

# ============================================================
# Health & Diagnostics
# ============================================================
@app.get("/health")
async def health():
    try:
        bridge_health = await proxy_to_bridge("/health")
        return {"status": "ok", "bridge": bridge_health}
    except:
        return {"status": "degraded", "bridge": "unreachable"}

@app.get("/api/broker/diagnostics")
async def diagnostics(api_key: str = Depends(verify_key)):
    mt5_proc = check_mt5_process()
    bridge = check_bridge_health()
    system = get_system_info()

    active_users = 0
    connected_users = 0
    for uid, state in user_states.items():
        active_users += 1
        if state.status == "connected":
            connected_users += 1

    return {
        "system": system,
        "services": {
            "mt5_terminal": mt5_proc,
            "mt5_bridge": bridge,
        },
        "users": {
            "active": active_users,
            "connected": connected_users,
        },
    }

# ============================================================
# MT5 API Proxies
# ============================================================
@app.get("/api/mt5/account")
async def get_account(api_key: str = Depends(verify_key)):
    account = await proxy_to_bridge("/account")
    login_id = account.get("login", "")
    state = None
    for uid, s in user_states.items():
        if str(s.login) == str(login_id):
            state = s
            break
    return {
        "account": account,
        "broker_login": account.get("login"),
        "broker_server": account.get("server"),
        "account_name": account.get("name"),
        "account_type": account.get("company"),
        "account_status": "Active",
        "last_sync_at": state.last_sync_at if state else datetime.now(timezone.utc).isoformat(),
        "broker_sync_enabled": True,
        "mt_terminal_status": "connected",
    }

@app.get("/api/mt5/positions")
async def get_positions(api_key: str = Depends(verify_key)):
    return await proxy_to_bridge("/positions")

@app.get("/api/mt5/history/{symbol}")
async def get_history(symbol: str, api_key: str = Depends(verify_key)):
    return await proxy_to_bridge(f"/history/{symbol}")

@app.get("/api/mt5/rates/{symbol}")
async def get_rates(symbol: str, timeframe: str = "M1", count: int = 100, api_key: str = Depends(verify_key)):
    return await proxy_to_bridge(f"/rates/{symbol}?timeframe={timeframe}&count={count}")

@app.get("/api/mt5/tick/{symbol}")
async def get_tick(symbol: str, api_key: str = Depends(verify_key)):
    return await proxy_to_bridge(f"/tick/{symbol}")

@app.post("/api/mt5/order")
async def place_order(order: TradeRequest, api_key: str = Depends(verify_key)):
    return await proxy_to_bridge("/order", "POST", order.model_dump())

@app.post("/api/mt5/close")
async def close_position(req: CloseRequest, api_key: str = Depends(verify_key)):
    return await proxy_to_bridge("/close", "POST", req.model_dump())

# ============================================================
# Broker Direct Endpoints (used by BrokerConnect.tsx)
# ============================================================
@app.post("/api/broker/credentials")
async def store_credentials(
    user_id: str = Query(...),
    body: CredentialsBody = None,
    api_key: str = Depends(verify_key),
):
    state = user_states.get(user_id)
    if not state:
        state = BrokerState()
        user_states[user_id] = state
    state.server = body.server
    state.login = body.login
    state.password = body.password
    state.status = "credentials_stored"
    state.last_error = None
    state.id_token = body.id_token or None
    return {"status": "ok", "message": "Credentials stored"}

@app.post("/api/broker/sync")
async def broker_sync(
    body: SyncBody = None,
    api_key: str = Depends(verify_key),
):
    user_id = body.user_id
    sync_key = body.sync_key
    state = user_states.get(user_id)
    if not state:
        raise HTTPException(404, "No credentials found for this user")

    try:
        account = await proxy_to_bridge("/account")
        positions = await proxy_to_bridge("/positions")

        history = []
        try:
            if account and "server" in account:
                history = await proxy_to_bridge("/history/all")
        except:
            history = []

        payload = {
            "account": account,
            "openPositions": positions.get("positions", []),
            "trades": history if isinstance(history, list) else [],
            "isHeartbeat": True,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "user_id": user_id,
        }

        # Forward the user's own Supabase JWT (captured when credentials were
        # stored) so the sync-trades edge function can verify the caller. The
        # anon key is never used as an Authorization credential.
        auth_headers = {
            "Content-Type": "application/json",
            "Sync-Key": sync_key,
        }
        if state.id_token:
            auth_headers["Authorization"] = f"Bearer {state.id_token}"

        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                SYNC_EDGE_FUNCTION,
                json=payload,
                headers=auth_headers,
            )

        if resp.status_code == 200:
            now = datetime.now(timezone.utc).isoformat()
            state.status = "connected"
            state.last_sync_at = now
            state.last_error = None
            state.sync_key = sync_key
            if not state.connected_at:
                state.connected_at = now
            return {"synced": True, "status": resp.status_code, "last_sync_at": now}
        else:
            state.last_error = f"Sync rejected by edge function: {resp.status_code}"
            raise HTTPException(resp.status_code, state.last_error)

    except httpx.RequestError as e:
        state.status = "auth_failed"
        state.last_error = f"Bridge unreachable: {e}"
        raise HTTPException(503, f"MT5 bridge unreachable: {e}")
    except HTTPException:
        raise
    except Exception as e:
        state.status = "auth_failed"
        state.last_error = str(e)
        raise HTTPException(500, f"Sync failed: {e}")

@app.get("/api/broker/status/{user_id}")
async def broker_status(user_id: str, api_key: str = Depends(verify_key)):
    state = user_states.get(user_id)
    if not state:
        return {
            "connected": False,
            "mt_terminal_status": "disconnected",
            "broker_sync_enabled": False,
        }

    bridge = check_bridge_health()
    mt5_proc = check_mt5_process()
    terminal_ok = bridge.get("reachable") and mt5_proc.get("running")

    return {
        "connected": state.status == "connected",
        "mt_terminal_status": state.status,
        "broker_sync_enabled": state.status == "connected",
        "broker_server": state.server,
        "broker_login": state.login,
        "last_sync_at": state.last_sync_at,
        "last_error": state.last_error,
        "bridge_reachable": bridge.get("reachable"),
        "mt5_running": mt5_proc.get("running"),
        "account": None,
    }

@app.post("/api/broker/disconnect/{user_id}")
async def broker_disconnect(user_id: str, api_key: str = Depends(verify_key)):
    state = user_states.get(user_id)
    if state:
        state.status = "disconnected"
        state.last_error = None
        state.connected_at = None
    return {"status": "ok", "message": "Disconnected"}

# ============================================================
# Legacy sync endpoint (for backward compatibility)
# ============================================================
@app.post("/api/mt5/sync")
async def sync_trades(api_key: str = Depends(verify_key)):
    account = await proxy_to_bridge("/account")
    positions = await proxy_to_bridge("/positions")

    payload = {
        "account": account,
        "openPositions": positions.get("positions", []),
        "trades": [],
        "isHeartbeat": True,
        "timestamp": None,
    }

    # Legacy endpoint: without a verified user JWT the sync-trades edge function
    # rejects the request, so nothing can be written anonymously.
    return {"synced": False, "status": 401, "error": "Unauthenticated legacy sync is disabled"}

@app.on_event("startup")
async def startup():
    print(f"Manager v2 started. MT5 bridge expected at: {MT5_BRIDGE_URL}")

@app.on_event("shutdown")
async def shutdown():
    print("Manager shutting down.")
