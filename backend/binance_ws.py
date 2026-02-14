"""
Binance WebSocket Data Feed - Coleta trades em tempo real.
Feed público sem necessidade de API key.
"""
import asyncio
import websockets
import json
import time


class BinanceDataFeed:
    def __init__(self, symbol: str = "btcusdt"):
        self.symbol = symbol.lower()
        self.ws_url = f"wss://stream.binance.com:9443/ws/{self.symbol}@trade"
        self.running = False
        self.trade_count = 0
        self.last_price = 0.0

    async def connect(self, on_trade_callback=None):
        """Conecta e processa trades. NÃO reconecta sozinho."""
        self.running = True
        print(f"🔌 Conectando: {self.symbol.upper()} → {self.ws_url}")

        async with websockets.connect(self.ws_url) as ws:
            print(f"✅ Conectado à Binance ({self.symbol.upper()})")

            while self.running:
                message = await ws.recv()
                data = json.loads(message)
                await self._process_trade(data, on_trade_callback)

    async def _process_trade(self, data: dict, callback=None):
        self.trade_count += 1

        price = float(data["p"])
        volume_btc = float(data["q"])
        volume_usdt = price * volume_btc
        is_maker = data["m"]
        timestamp = int(data["T"])

        # Side REAL da Binance:
        # is_maker=False → comprador agressivo (BUY)
        # is_maker=True  → vendedor agressivo (SELL)
        side_real = "buy" if not is_maker else "sell"

        tick = {
            "price": price,
            "bid": float(data.get("b", price - 0.05)),
            "ask": float(data.get("a", price + 0.05)),
            "timestamp": timestamp,
            "volume_real": volume_usdt,
            "volume_btc": volume_btc,
            "side_real": side_real,
            "trade_id": data["t"],
        }

        self.last_price = price

        if callback:
            await callback(tick)

        # Log a cada 100 trades
        if self.trade_count % 100 == 0:
            icon = "🟢" if side_real == "buy" else "🔴"
            print(f"{icon} #{self.trade_count} | ${price:,.2f} | Vol: ${volume_usdt:,.0f}")

    def stop(self):
        self.running = False
