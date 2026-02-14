"""
ImbalanceEngine WebSocket Server v2
Bridges Binance real-time data → ImbalanceChart frontend

Sends data in the format App.tsx expects:
  {type: "tick", data: {symbol, price, bid, ask, volume_synthetic, side, timestamp, ...engine_data}}

Also handles:
  - Engine configuration from frontend
  - Symbol switching (future: multi-symbol)
  - HTTP server for frontend static files
"""
import asyncio
import websockets
import json
import time
import threading
import os
from http.server import HTTPServer, SimpleHTTPRequestHandler
from binance_ws import BinanceDataFeed
from engine_orchestrator import VolumeEngineOrchestrator

# ============================================
# Estado global
# ============================================
connected_clients = set()
current_orchestrator = None
current_symbol = "btcusdt"
trade_count = 0

DEFAULT_ENGINES = ["tick_velocity", "spread_weight", "micro_cluster", "atr_normalize", "imbalance_detector"]

# Configuração de engines com parâmetros adaptados para BTC
ENGINE_CONFIGS = {
    "imbalance_detector": {
        "price_step": 1.0,  # $1 por nível para BTC
        "window_trades": 50,
        "imbalance_ratio": 3.0,
        "min_stacking": 2,
    }
}


# ============================================
# WebSocket: broadcast
# ============================================
async def broadcast(message: dict):
    if not connected_clients:
        return

    data = json.dumps(message)
    dead = set()
    for client in connected_clients:
        try:
            await client.send(data)
        except websockets.exceptions.ConnectionClosed:
            dead.add(client)
        except Exception:
            dead.add(client)

    for c in dead:
        connected_clients.discard(c)


# ============================================
# WebSocket: handler por conexão
# ============================================
async def ws_handler(websocket):
    global current_orchestrator, current_symbol

    connected_clients.add(websocket)
    print(f"🔌 Cliente conectado ({len(connected_clients)} total)")

    # Envia status de conexão (formato que App.tsx espera)
    try:
        await websocket.send(json.dumps({
            "type": "connected",
            "data": {
                "mt5_connected": True,  # Simula MT5 conectado (usamos Binance)
                "symbol": current_symbol.upper(),
                "source": "binance",
                "engines": VolumeEngineOrchestrator.get_all_engines(),
                "active_engines": list(current_orchestrator.engines.keys()) if current_orchestrator else [],
            }
        }))
    except Exception as e:
        print(f"⚠️ Erro ao enviar status: {e}")

    # Escuta mensagens do frontend
    try:
        async for message in websocket:
            try:
                data = json.loads(message)
                action = data.get("action") or data.get("type", "")

                if action == "subscribe":
                    symbol = data.get("symbol", "BTCUSDT")
                    await websocket.send(json.dumps({
                        "type": "subscribed",
                        "symbol": symbol
                    }))
                    print(f"📨 Cliente inscrito em: {symbol}")

                elif action == "switch_symbol":
                    # Futuro: suporte multi-símbolo
                    symbol = data.get("symbol", "BTCUSDT")
                    print(f"🔄 Switch symbol solicitado: {symbol}")
                    await websocket.send(json.dumps({
                        "type": "subscribed",
                        "symbol": symbol
                    }))

                elif action == "ping":
                    await websocket.send(json.dumps({"type": "pong"}))

                elif action == "set_engines":
                    try:
                        engine_names = data.get("engines", DEFAULT_ENGINES)
                        config = data.get("config", ENGINE_CONFIGS)
                        current_orchestrator = VolumeEngineOrchestrator(
                            engine_names=engine_names,
                            config=config,
                        )
                        await broadcast({
                            "type": "engines_updated",
                            "engines": engine_names,
                        })
                        print(f"⚙️ Engines atualizados: {engine_names}")
                    except Exception as e:
                        await websocket.send(json.dumps({
                            "type": "error",
                            "message": str(e)
                        }))

                elif action == "get_engine_list":
                    await websocket.send(json.dumps({
                        "type": "engine_list",
                        "engines": VolumeEngineOrchestrator.get_all_engines(),
                        "active": list(current_orchestrator.engines.keys()) if current_orchestrator else [],
                    }))

            except json.JSONDecodeError:
                pass

    except websockets.exceptions.ConnectionClosed:
        pass
    except Exception as e:
        print(f"⚠️ Erro: {e}")
    finally:
        connected_clients.discard(websocket)
        print(f"👋 Cliente desconectado ({len(connected_clients)} restantes)")


# ============================================
# Binance → Frontend bridge
# ============================================
async def binance_forwarder():
    global current_orchestrator, trade_count

    # Inicializa engines
    current_orchestrator = VolumeEngineOrchestrator(
        engine_names=DEFAULT_ENGINES,
        config=ENGINE_CONFIGS,
    )

    feed = BinanceDataFeed(symbol=current_symbol)

    async def on_trade(tick):
        global trade_count
        trade_count += 1

        # Processa com engines
        analysis = current_orchestrator.analyze_tick(tick)

        # Formata para o App.tsx (formato TickData)
        # O frontend usa volume_synthetic como campo de volume
        tick_message = {
            "type": "tick",
            "data": {
                "symbol": current_symbol.upper(),
                "price": tick["price"],
                "bid": tick["bid"],
                "ask": tick["ask"],
                "volume_synthetic": round(analysis["volume"]),  # Volume REAL em USDT
                "side": analysis["side"],
                "timestamp": tick["timestamp"],
                # Dados extras dos engines (frontend pode usar)
                "is_absorption": analysis["is_absorption"],
                "absorption_type": analysis.get("absorption_type"),
                "absorption_strength": analysis.get("absorption_strength", 0),
                "composite_signal": analysis.get("composite_signal", 0),
                "stacking_buy": analysis.get("stacking_buy", 0),
                "stacking_sell": analysis.get("stacking_sell", 0),
                "engines": {
                    name: {
                        k: v for k, v in result.items()
                        if not isinstance(v, (list, dict)) or k in ("regime",)
                    }
                    for name, result in analysis.get("engines", {}).items()
                },
            }
        }

        await broadcast(tick_message)

    # Loop de reconexão
    while True:
        try:
            await feed.connect(on_trade)
        except Exception as e:
            print(f"⚠️ Binance erro: {e}. Reconectando em 5s...")
            await asyncio.sleep(5)


# ============================================
# HTTP: serve frontend
# ============================================
def start_http_server(port=8000):
    # Procura a pasta frontend (dist se buildado, ou serve o dev)
    base = os.path.dirname(os.path.abspath(__file__))

    # Tenta encontrar o frontend buildado ou dev
    for candidate in [
        os.path.join(base, "..", "frontend", "dist"),
        os.path.join(base, "..", "frontend"),
        os.path.join(base, "frontend"),
    ]:
        if os.path.exists(os.path.join(candidate, "index.html")):
            os.chdir(candidate)
            break
    else:
        print(f"⚠️ Frontend não encontrado! Coloque index.html na pasta frontend/")
        return

    class QuietHandler(SimpleHTTPRequestHandler):
        def log_message(self, fmt, *args):
            pass

        def end_headers(self):
            # CORS para desenvolvimento
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            super().end_headers()

    httpd = HTTPServer(("localhost", port), QuietHandler)
    print(f"🌐 Frontend: http://localhost:{port}")
    httpd.serve_forever()


# ============================================
# Main
# ============================================
async def main():
    server = await websockets.serve(ws_handler, "localhost", 8765)
    print(f"📡 WebSocket: ws://localhost:8765")
    await binance_forwarder()


if __name__ == "__main__":
    print("=" * 60)
    print("🚀 IMBALANCE CHART + ENGINE — BTC/USDT Tempo Real")
    print("=" * 60)

    if hasattr(asyncio, "WindowsSelectorEventLoopPolicy"):
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

    # HTTP server em thread separada
    http_thread = threading.Thread(target=start_http_server, daemon=True)
    http_thread.start()

    print(f"\n✅ Engines: {', '.join(DEFAULT_ENGINES)}")
    print("✅ Abra: http://localhost:8000")
    print("⚠️  Dados públicos Binance — zero API keys\n")

    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n👋 Servidor encerrado")
    except Exception as e:
        print(f"\n❌ Erro: {e}")
        print("💡 Execute: pip install websockets --upgrade")
