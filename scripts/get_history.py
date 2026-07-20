import MetaTrader5 as mt5
import json
import sys
from datetime import datetime, timedelta

if not mt5.initialize():
    print(json.dumps({"error": mt5.last_error()}))
    exit()

def fetch_history(from_date, to_date):
    if not mt5.initialize():
        return {"error": mt5.last_error()}

    deals = mt5.history_deals_get(from_date, to_date)
    if deals is None:
        mt5.shutdown()
        return {"deals": []}

    deals_data = []
    for deal in deals:
        # entry: 0=IN, 1=OUT, 2=INOUT, 3=OUT_BY
        # Frontend filters for entry==1 (DEAL_ENTRY_OUT) or entry==2 (DEAL_ENTRY_INOUT)
        entry_val = deal.entry  # numeric entry type from MT5
        
        entry_price = deal.price
        entry_time = deal.time

        # If this is an exit deal, try to pair it with its entry deal (entry == 0)
        if entry_val in [1, 2]: # OUT or INOUT
            position_deals = mt5.history_deals_get(position=deal.position_id)
            if position_deals:
                # Find the first entry deal (entry == 0) for this position
                entry_deal = next((d for d in position_deals if d.entry == 0), None)
                if entry_deal:
                    entry_price = entry_deal.price
                    entry_time = entry_deal.time

        deals_data.append({
            "ticket": deal.ticket,
            "order": deal.order,
            "symbol": deal.symbol,
            "type": "SELL" if deal.type == 1 else "BUY",
            "volume": deal.volume,
            "price": deal.price,
            "price_open": entry_price,
            "price_close": deal.price,
            "entry_price": entry_price,
            "entry_time": entry_time,
            "profit": deal.profit,
            "commission": deal.commission,
            "swap": deal.swap,
            "magic": deal.magic,
            "comment": deal.comment or "",
            "time": deal.time,
            "time_open": entry_time,
            "time_close": deal.time,
            "time_closed": deal.time,
            "entry": entry_val,  # critical: 1=OUT (closed trade), 2=INOUT
            "sl": 0,
            "tp": 0
        })

    mt5.shutdown()
    return {"deals": deals_data}

if __name__ == "__main__":
    if len(sys.argv) >= 3:
        try:
            from_date = datetime.fromisoformat(sys.argv[1])
            to_date = datetime.fromisoformat(sys.argv[2])
        except ValueError:
            try:
                from_date = datetime.strptime(sys.argv[1], "%Y-%m-%d")
                to_date = datetime.strptime(sys.argv[2], "%Y-%m-%d").replace(hour=23, minute=59, second=59)
            except ValueError:
                to_date = datetime.now()
                from_date = to_date - timedelta(days=30)
    else:
        to_date = datetime.now()
        from_date = to_date - timedelta(days=30)

    result = fetch_history(from_date, to_date)
    print(json.dumps(result))