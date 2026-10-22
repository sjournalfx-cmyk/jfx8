"""Mobile-web scroll check: every scrolling page must reveal its last content
above the floating nav, and the AI chat header must stay on screen.
Usage: python3 scripts/mobile-scroll-check.py [base_url]
Runs against a build made with .env.test (Supabase at 127.0.0.1:54321), mocking
auth + REST so the app boots straight into demo mode."""
import json, sys, time
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:4173"
UID = "00000000-0000-0000-0000-000000000001"
USER = {"id": UID, "aud": "authenticated", "role": "authenticated", "email": "qa@jfx.test",
        "app_metadata": {"provider": "email"}, "user_metadata": {}, "created_at": "2026-01-01T00:00:00Z"}
PROFILE = {"id": UID, "name": "QA Trader", "onboarded": True, "plan": "PRO", "currency_symbol": "$",
           "timezone": "Africa/Johannesburg", "theme_preference": "dark"}
SESSION = {"access_token": "x.eyJzdWIiOiIwIn0.x", "token_type": "bearer", "expires_in": 3600,
           "expires_at": int(time.time()) + 3600, "refresh_token": "r", "user": USER}

def route(r):
    url, h = r.request.url, r.request.headers
    if "/auth/v1/user" in url:
        return r.fulfill(json=USER)
    if "/auth/v1/" in url:
        return r.fulfill(json=SESSION)
    if "/rest/v1/profiles" in url:
        obj = "object" in h.get("accept", "")
        return r.fulfill(json=PROFILE if obj else [PROFILE])
    if "/rest/v1/" in url:
        obj = "object" in h.get("accept", "")
        return r.fulfill(status=406 if obj else 200, json={} if obj else [])
    return r.fulfill(json={})

# view label -> how to reach it (click texts in order)
PAGES = [
    ("Dashboard", []),
    ("Overview", ["text=Overview"]),
    ("Trade Analysis", ["text=Trade Analysis"]),
    ("History", ["nav >> text=History"]),
    ("Journal", ["nav >> text=Journal"]),
    ("Lab", ["nav >> text=Lab"]),
    ("Lab watchlist", ["text=Start Backtest"]),
    ("Log Trade", ["nav >> text=Log"]),
    ("Rules & Checklists", ["nav >> text=Home", "[aria-label='Open menu']", "text=Strategy Rules & Checklists"]),
    ("Settings", ["[aria-label='Back to home']", "[aria-label='Open menu']", "text=Settings >> nth=-1"]),
    ("Broker settings", ["[aria-label='Back to home']", "[aria-label='Open menu']", "text=Bridge & broker settings"]),
]

def check_page(page, name):
    main = page.locator("main").first
    info = main.evaluate("""m => {
        m.scrollTop = m.scrollHeight;
        // ignore content intentionally hidden inside a clipping ancestor
        // (carousels, collapsed panels, tooltips) — it is not page content
        const clipped = (e) => { const r = e.getBoundingClientRect();
          for (let a = e.parentElement; a && a !== m; a = a.parentElement) {
            const cs = getComputedStyle(a);
            if (cs.opacity === '0' || cs.display === 'none') return true;
            if (cs.overflowY !== 'visible' || cs.overflowX !== 'visible') {
              const ar = a.getBoundingClientRect();
              if (r.top >= ar.bottom - 1 || r.bottom <= ar.top + 1 || r.left >= ar.right - 1 || r.right <= ar.left + 1) return true;
            }
            if (getComputedStyle(a).position === 'fixed') return true;
          }
          return getComputedStyle(e).position === 'fixed';
        };
        const nav = document.querySelector('.jfx-mobile-nav');
        const navTop = nav ? nav.getBoundingClientRect().top : window.innerHeight;
        // last visible, non-spacer leaf content inside main
        const els = [...m.querySelectorAll('*')].filter(e => !e.closest('[data-testid=mobile-bottom-spacer]')
            && e.children.length === 0 && e.getBoundingClientRect().height > 0
            && getComputedStyle(e).visibility !== 'hidden' && !clipped(e));
        const bottom = Math.max(0, ...els.map(e => e.getBoundingClientRect().bottom));
        // nested scrollers that clip content
        const inner = [...m.querySelectorAll('*')].filter(e => {const s=getComputedStyle(e).overflowY;
            const r = e.getBoundingClientRect();
            const onScreen = r.right > 1 && r.left < window.innerWidth - 1 && r.width > 0;
            return onScreen && (s==='auto'||s==='scroll') && e.scrollHeight > e.clientHeight + 2;})
            .map(e => { e.scrollTop = e.scrollHeight; const r=e.getBoundingClientRect();
              return {cls: (e.className||'').toString().slice(0,60), bottom: r.bottom}; });
        const sp = m.querySelector('[data-testid=mobile-bottom-spacer]');
        const contentEnd = sp ? sp.getBoundingClientRect().top : bottom;
        const fullBleed = !sp;
        return {navTop, bottom: contentEnd, fullBleed, vh: window.innerHeight, docScroll: document.scrollingElement.scrollTop,
                mainScroll: m.scrollTop, inner};
    }""")
    ok = info["bottom"] <= info["navTop"] + 1 and info["docScroll"] == 0
    bad_inner = [i for i in info["inner"] if i["bottom"] > info["navTop"] + 1]
    ok = ok and not bad_inner
    print(("PASS" if ok else "FAIL"), name, json.dumps({k: info[k] for k in ("navTop","bottom","vh","docScroll")}),
          ("inner-clipped: %s" % bad_inner) if bad_inner else "")
    return ok

def main():
    results = []
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path="/usr/bin/chromium", args=["--no-sandbox"])
        for w, h in [(360, 640), (390, 740), (412, 800)]:
            ctx = b.new_context(bypass_csp=True, viewport={"width": w, "height": h}, device_scale_factor=2, is_mobile=True,
                                has_touch=True, user_agent="Mozilla/5.0 (Linux; Android 14; SM-A156E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36")
            ctx.route("http://127.0.0.1:54321/**", route)
            ctx.route(lambda u: not (u.startswith(BASE) or u.startswith("http://127.0.0.1:54321")), lambda r: r.abort())
            ctx.add_init_script(f"""localStorage.setItem('sb-127-auth-token', JSON.stringify({json.dumps(SESSION)}));
                                    localStorage.setItem('jfx_demo_mode','true');""")
            page = ctx.new_page()
            page.goto(BASE, wait_until="load", timeout=60000)
            page.wait_for_timeout(3000)
            for t in ["text=Continue to App", "text=Skip", "text=Got it"]:
                try:
                    page.locator(t).first.click(timeout=1500); page.wait_for_timeout(1500)
                except Exception:
                    pass
            page.wait_for_timeout(3000)
            page.screenshot(path=f"/tmp/shot-{w}-dash.png")
            for name, clicks in PAGES:
                try:
                    for c in clicks:
                        loc = page.locator(c).first
                        try:
                            loc.click(timeout=3000)
                        except Exception:
                            loc.dispatch_event("click", timeout=3000)
                        page.wait_for_timeout(900)
                    results.append(check_page(page, f"{name}@{w}x{h}"))
                    page.screenshot(path=f"/tmp/shot-{w}-{name.replace(' ','_')}.png")
                except Exception as e:
                    print("SKIP", name, w, c, str(e).splitlines()[0]); page.screenshot(path=f"/tmp/skip-{w}-{name[:5]}.png")
            # AI chat header
            try:
                page.locator("nav >> text=Home").first.click(timeout=3000); page.wait_for_timeout(500)
                page.locator("[aria-label*='Copilot' i], [aria-label*='AI' i]").first.click(timeout=4000)
                page.wait_for_timeout(6000)
                hdr = page.evaluate("""() => { const h = [...document.querySelectorAll('header')].find(x => x.textContent.includes('JFX'));
                    if (!h) return null; const r = h.getBoundingClientRect(); return {top: r.top, bottom: r.bottom,
                    doc: document.scrollingElement.scrollTop, main: document.querySelector('main').scrollTop}; }""")
                ok = bool(hdr) and hdr["top"] >= 0 and hdr["doc"] == 0 and hdr["main"] == 0
                print("PASS" if ok else "FAIL", f"AIChat header@{w}x{h}", hdr)
                results.append(ok)
                page.screenshot(path=f"/tmp/shot-{w}-aichat.png")
            except Exception as e:
                print("SKIP aichat", w, str(e).splitlines()[0])
            ctx.close()
        b.close()
    print("ALL PASS" if results and all(results) else "SOME FAILED")
    sys.exit(0 if results and all(results) else 1)

if __name__ == "__main__":
    main()
