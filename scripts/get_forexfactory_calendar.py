import sys
import json
import os
import time
import argparse
from datetime import datetime, timedelta
from dateutil.tz import gettz

try:
    from forexfactory.providers.forexfactory_html import ForexFactoryHtmlProvider
except ImportError:
    from scripts.forexfactory.providers.forexfactory_html import ForexFactoryHtmlProvider

CACHE_FILE = os.path.join(os.path.dirname(__file__), ".cache_calendar.json")
CACHE_TTL_SECONDS = 30 * 60  # 30 minutes

def main():
    parser = argparse.ArgumentParser(description="Fetch ForexFactory Economic Calendar with Caching")
    parser.add_argument("--start", help="Start date YYYY-MM-DD")
    parser.add_argument("--end", help="End date YYYY-MM-DD")
    parser.add_argument("--tz", default="UTC", help="Timezone")
    parser.add_argument("--force-refresh", action="store_true", help="Bypass cache")
    args = parser.parse_args()

    tzinfo = gettz(args.tz)
    now = datetime.now(tzinfo)

    start_str = args.start or (now - timedelta(days=1)).strftime("%Y-%m-%d")
    end_str = args.end or (now + timedelta(days=7)).strftime("%Y-%m-%d")

    # Check cache
    if not args.force_refresh and os.path.exists(CACHE_FILE):
        try:
            mtime = os.path.getmtime(CACHE_FILE)
            if (time.time() - mtime) < CACHE_TTL_SECONDS:
                with open(CACHE_FILE, "r", encoding="utf-8") as f:
                    cached_data = json.load(f)
                    if isinstance(cached_data, dict) and "data" in cached_data:
                        # Filter cache to requested range
                        filtered = [
                            e for e in cached_data["data"]
                            if start_str <= e.get("date", "") <= end_str
                        ]
                        print(json.dumps({"data": filtered, "source": "ForexFactory (Cached)"}))
                        return
        except Exception:
            pass  # Fallback to fetching fresh data if cache read fails

    start_dt = datetime.strptime(start_str, "%Y-%m-%d").replace(tzinfo=tzinfo)
    end_dt = datetime.strptime(end_str, "%Y-%m-%d").replace(tzinfo=tzinfo)

    provider = ForexFactoryHtmlProvider(debug=False, timeout=20)
    try:
        events = provider.fetch_events(start_dt, end_dt, tzname=args.tz)
        result = {"data": events, "source": "ForexFactory", "timestamp": time.time()}
        
        # Save cache
        try:
            with open(CACHE_FILE, "w", encoding="utf-8") as f:
                json.dump(result, f)
        except Exception:
            pass

        print(json.dumps(result))
    except Exception as e:
        # If scraper fails, attempt to return stale cache if available
        if os.path.exists(CACHE_FILE):
            try:
                with open(CACHE_FILE, "r", encoding="utf-8") as f:
                    cached_data = json.load(f)
                    if isinstance(cached_data, dict) and "data" in cached_data:
                        filtered = [
                            e for e in cached_data["data"]
                            if start_str <= e.get("date", "") <= end_str
                        ]
                        print(json.dumps({"data": filtered, "source": "ForexFactory (Stale Cache)", "warning": str(e)}))
                        return
            except Exception:
                pass
        print(json.dumps({"error": str(e), "data": []}), file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
