import sys
import os
from unittest.mock import MagicMock, patch

# Add scripts directory to path to import get_history
sys.path.append(os.path.join(os.path.dirname(__file__), '..', 'scripts'))

from get_history import fetch_history

def test_fetch_history_mapping():
    # Mock MT5 exit deal
    mock_deal = MagicMock()
    mock_deal.ticket = 152112753155
    mock_deal.order = 152253365914
    mock_deal.symbol = "EURUSD"
    mock_deal.type = 0  # BUY (0 is BUY, 1 is SELL)
    mock_deal.volume = 0.2
    mock_deal.price = 1.13787
    mock_deal.entry = 1  # DEAL_ENTRY_OUT (exit deal)
    mock_deal.profit = 15.5
    mock_deal.commission = -0.6
    mock_deal.swap = 0.2
    mock_deal.magic = 100
    mock_deal.comment = "Mock closed trade"
    mock_deal.time = 1782409511
    mock_deal.position_id = 98765

    # Mock entry deal
    mock_entry_deal = MagicMock()
    mock_entry_deal.ticket = 152112753000
    mock_entry_deal.order = 152253365900
    mock_entry_deal.symbol = "EURUSD"
    mock_entry_deal.type = 0  # BUY
    mock_entry_deal.volume = 0.2
    mock_entry_deal.price = 1.13700  # Entry price was lower
    mock_entry_deal.entry = 0  # DEAL_ENTRY_IN
    mock_entry_deal.profit = 0.0
    mock_entry_deal.commission = 0.0
    mock_entry_deal.swap = 0.0
    mock_entry_deal.magic = 100
    mock_entry_deal.comment = "Mock entry trade"
    mock_entry_deal.time = 1782409000
    mock_entry_deal.position_id = 98765

    # Mock MT5 functions
    with patch('MetaTrader5.initialize', return_value=True), \
         patch('MetaTrader5.history_deals_get') as mock_deals_get, \
         patch('MetaTrader5.shutdown'):
         
        # history_deals_get is called twice:
        # 1. to fetch deals for range: returns [mock_deal]
        # 2. to fetch deals for position=98765: returns [mock_entry_deal, mock_deal]
        mock_deals_get.side_effect = lambda *args, **kwargs: (
            [mock_entry_deal, mock_deal] if 'position' in kwargs else [mock_deal]
        )

        from datetime import datetime
        res = fetch_history(datetime.now(), datetime.now())
        
        assert "error" not in res
        assert len(res["deals"]) == 1
        
        deal = res["deals"][0]
        assert deal["ticket"] == 152112753155
        assert deal["symbol"] == "EURUSD"
        assert deal["type"] == "BUY"
        assert deal["volume"] == 0.2
        assert deal["price"] == 1.13787
        
        # Test entry matching
        assert deal["entry_price"] == 1.13700  # Matched from mock_entry_deal
        assert deal["entry_time"] == 1782409000  # Matched from mock_entry_deal
        assert deal["price_open"] == 1.13700
        assert deal["time_open"] == 1782409000
        assert deal["price_close"] == 1.13787
        assert deal["time_close"] == 1782409511
        assert deal["entry"] == 1
