"""
Micro Cluster Engine - Agrupa trades em janelas temporais para detectar absorções.

Absorção = preço se move em uma direção, mas o volume dominante é do lado oposto.
Isso indica que ordens limitadas estão "absorvendo" a pressão agressiva.

MELHORIA:
- Detecção mais precisa: divergência delta vs preço
- Threshold adaptativo baseado no volume médio da janela
- Retorna metadados detalhados em vez de alterar volume
"""
import time
from collections import deque
from typing import Dict, Any, List, Optional
from .base import VolumeEngine


class MicroClusterEngine(VolumeEngine):
    name = "micro_cluster"
    description = "Detecta absorções em janelas de 100ms (divergência delta vs preço)"

    def __init__(self, window_ms: int = 100, min_trades: int = 3):
        self.window_seconds = window_ms / 1000.0
        self.min_trades = min_trades

        # Buffer da janela atual
        self.buffer: List[Dict[str, Any]] = []
        self.window_start = 0.0

        # Histórico de micro-clusters para calcular thresholds adaptativos
        self.cluster_history: deque = deque(maxlen=100)
        self.absorption_count = 0
        self.total_clusters = 0

        # Último resultado
        self.last_result: Optional[Dict[str, Any]] = None

    def analyze(self, tick: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
        timestamp = tick.get("timestamp", time.time() * 1000) / 1000.0

        if self.window_start == 0.0:
            self.window_start = timestamp

        # Acumula no buffer
        self.buffer.append({
            "price": tick.get("price", 0.0),
            "timestamp": timestamp,
            "side": context.get("real_side", "neutral"),
            "volume": tick.get("volume_real", 1.0),
        })

        # Verifica se janela expirou
        elapsed = timestamp - self.window_start
        if elapsed < self.window_seconds or len(self.buffer) < self.min_trades:
            # Janela ainda aberta, retorna último resultado ou neutro
            return self.last_result or {
                "signal": 0.0,
                "is_absorption": False,
                "absorption_type": None,
                "buy_volume": 0,
                "sell_volume": 0,
                "price_change": 0,
                "trade_count": len(self.buffer),
            }

        # === FECHA JANELA: analisa micro-cluster ===
        buy_vol = sum(t["volume"] for t in self.buffer if t["side"] == "buy")
        sell_vol = sum(t["volume"] for t in self.buffer if t["side"] == "sell")
        total_vol = buy_vol + sell_vol

        open_price = self.buffer[0]["price"]
        close_price = self.buffer[-1]["price"]
        price_change = close_price - open_price
        trade_count = len(self.buffer)

        # === Detecção de absorção por divergência ===
        is_absorption = False
        absorption_type = None
        absorption_strength = 0.0

        if total_vol > 0 and abs(price_change) > 0:
            # Calcula threshold adaptativo
            avg_vol = self._get_adaptive_threshold()

            # Preço subiu mas sell_vol domina → compradores absorvem vendas
            if price_change > 0 and sell_vol > buy_vol:
                dominance_ratio = sell_vol / max(buy_vol, 1)
                if dominance_ratio >= 1.5 and total_vol > avg_vol * 0.5:
                    is_absorption = True
                    absorption_type = "buy_absorption"  # compradores absorvendo
                    absorption_strength = min(dominance_ratio / 3.0, 1.0)

            # Preço caiu mas buy_vol domina → vendedores absorvem compras
            elif price_change < 0 and buy_vol > sell_vol:
                dominance_ratio = buy_vol / max(sell_vol, 1)
                if dominance_ratio >= 1.5 and total_vol > avg_vol * 0.5:
                    is_absorption = True
                    absorption_type = "sell_absorption"  # vendedores absorvendo
                    absorption_strength = min(dominance_ratio / 3.0, 1.0)

        # Salva no histórico
        self.total_clusters += 1
        cluster_info = {
            "buy_volume": buy_vol,
            "sell_volume": sell_vol,
            "total_volume": total_vol,
            "price_change": price_change,
            "trade_count": trade_count,
            "is_absorption": is_absorption,
        }
        self.cluster_history.append(cluster_info)

        if is_absorption:
            self.absorption_count += 1

        # Sinal: positivo para absorção de compra, negativo para absorção de venda
        if is_absorption:
            signal = absorption_strength if absorption_type == "buy_absorption" else -absorption_strength
        else:
            signal = 0.0

        self.last_result = {
            "signal": round(signal, 3),
            "is_absorption": is_absorption,
            "absorption_type": absorption_type,
            "absorption_strength": round(absorption_strength, 3),
            "buy_volume": round(buy_vol, 2),
            "sell_volume": round(sell_vol, 2),
            "price_change": round(price_change, 6),
            "trade_count": trade_count,
            "total_absorptions": self.absorption_count,
        }

        # Reset janela
        self.buffer.clear()
        self.window_start = timestamp

        return self.last_result

    def _get_adaptive_threshold(self) -> float:
        """Calcula volume médio dos últimos micro-clusters."""
        if len(self.cluster_history) < 5:
            return 0.0  # Sem threshold mínimo nos primeiros clusters
        
        volumes = [c["total_volume"] for c in self.cluster_history]
        return sum(volumes) / len(volumes)

    def reset(self):
        self.buffer.clear()
        self.window_start = 0.0
        self.cluster_history.clear()
        self.absorption_count = 0
        self.total_clusters = 0
        self.last_result = None
