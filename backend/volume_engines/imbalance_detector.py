"""
Imbalance Detector Engine - NOVO
Detecta desequilíbrios diagonais entre níveis de preço adjacentes.

Este é o conceito central do footprint/YuCluster:
- Compara Ask volume do nível N com Bid volume do nível N+1
- Se ratio >= threshold (ex: 300%), há "imbalance"
- Imbalances empilhados (stacking) = sinal forte de direção

MELHORIA sobre o projeto original: este engine acumula um mini-footprint
em janelas de N trades e detecta stacking de imbalances.
"""
from collections import deque, defaultdict
from typing import Dict, Any, List
from .base import VolumeEngine


class ImbalanceDetectorEngine(VolumeEngine):
    name = "imbalance_detector"
    description = "Detecta stacking de imbalances diagonais (YuCluster-style)"

    def __init__(
        self,
        price_step: float = 0.50,  # Tamanho do nível de preço
        imbalance_ratio: float = 3.0,  # Ratio para considerar imbalance (300%)
        window_trades: int = 50,  # Trades por janela de análise
        min_stacking: int = 2,  # Mínimo de imbalances empilhados
    ):
        self.price_step = price_step
        self.imbalance_ratio = imbalance_ratio
        self.window_trades = window_trades
        self.min_stacking = min_stacking

        # Acumula trades na janela atual
        self.trade_buffer: List[Dict[str, Any]] = []
        self.trade_count = 0

        # Último resultado de análise
        self.last_analysis: Dict[str, Any] = {
            "signal": 0.0,
            "imbalances": [],
            "stacking_buy": 0,
            "stacking_sell": 0,
            "dominant_direction": None,
        }

    def analyze(self, tick: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
        price = tick.get("price", 0.0)
        volume = tick.get("volume_real", 1.0)
        side = context.get("real_side", "neutral")

        self.trade_buffer.append({
            "price": price,
            "volume": volume,
            "side": side,
        })
        self.trade_count += 1

        # Analisa a cada N trades
        if len(self.trade_buffer) < self.window_trades:
            return self.last_analysis

        # === Constrói mini-footprint por nível de preço ===
        levels: Dict[float, Dict[str, float]] = defaultdict(
            lambda: {"buy": 0.0, "sell": 0.0}
        )

        for trade in self.trade_buffer:
            level = self._discretize(trade["price"])
            if trade["side"] == "buy":
                levels[level]["buy"] += trade["volume"]
            else:
                levels[level]["sell"] += trade["volume"]

        # Ordena níveis por preço
        sorted_levels = sorted(levels.items())

        # === Detecta imbalances diagonais ===
        imbalances = []
        buy_imbalances = 0
        sell_imbalances = 0

        for i in range(len(sorted_levels) - 1):
            price_low, vol_low = sorted_levels[i]
            price_high, vol_high = sorted_levels[i + 1]

            # Imbalance de compra: Ask do nível inferior >> Bid do nível superior
            # (compradores no nível baixo dominam vendedores no nível alto)
            ask_vol = vol_low["buy"]  # Compradores agressivos no nível baixo
            bid_vol = vol_high["sell"]  # Vendedores agressivos no nível alto

            if bid_vol > 0 and ask_vol / bid_vol >= self.imbalance_ratio:
                imbalances.append({
                    "type": "buy",
                    "price_low": price_low,
                    "price_high": price_high,
                    "ratio": round(ask_vol / bid_vol, 2),
                })
                buy_imbalances += 1

            elif ask_vol > 0 and bid_vol / ask_vol >= self.imbalance_ratio:
                imbalances.append({
                    "type": "sell",
                    "price_low": price_low,
                    "price_high": price_high,
                    "ratio": round(bid_vol / ask_vol, 2),
                })
                sell_imbalances += 1

            # Verifica zero-side (um lado com volume zero)
            if ask_vol > 0 and bid_vol == 0:
                imbalances.append({
                    "type": "buy_zero",
                    "price_low": price_low,
                    "price_high": price_high,
                    "ratio": float("inf"),
                })
                buy_imbalances += 1
            elif bid_vol > 0 and ask_vol == 0:
                imbalances.append({
                    "type": "sell_zero",
                    "price_low": price_low,
                    "price_high": price_high,
                    "ratio": float("inf"),
                })
                sell_imbalances += 1

        # === Detecta stacking (imbalances consecutivos na mesma direção) ===
        max_buy_stack = self._count_consecutive(imbalances, "buy")
        max_sell_stack = self._count_consecutive(imbalances, "sell")

        # Sinal baseado em stacking
        dominant = None
        signal = 0.0

        if max_buy_stack >= self.min_stacking and max_buy_stack > max_sell_stack:
            dominant = "buy"
            signal = min(max_buy_stack / 5.0, 1.0)  # Normaliza: 5 stacking = sinal máximo
        elif max_sell_stack >= self.min_stacking and max_sell_stack > max_buy_stack:
            dominant = "sell"
            signal = -min(max_sell_stack / 5.0, 1.0)

        self.last_analysis = {
            "signal": round(signal, 3),
            "imbalances": imbalances[:10],  # Limita para não sobrecarregar
            "stacking_buy": max_buy_stack,
            "stacking_sell": max_sell_stack,
            "dominant_direction": dominant,
            "levels_analyzed": len(sorted_levels),
            "total_imbalances": len(imbalances),
        }

        # Reset buffer
        self.trade_buffer.clear()

        return self.last_analysis

    def _discretize(self, price: float) -> float:
        return round(price / self.price_step) * self.price_step

    def _count_consecutive(self, imbalances: List[Dict], direction: str) -> int:
        """Conta máximo de imbalances consecutivos na mesma direção."""
        max_count = 0
        current = 0
        for imb in imbalances:
            if imb["type"].startswith(direction):
                current += 1
                max_count = max(max_count, current)
            else:
                current = 0
        return max_count

    def update_price_step(self, step: float):
        """Permite frontend ajustar o tamanho do nível de preço."""
        self.price_step = step

    def reset(self):
        self.trade_buffer.clear()
        self.trade_count = 0
        self.last_analysis = {
            "signal": 0.0,
            "imbalances": [],
            "stacking_buy": 0,
            "stacking_sell": 0,
            "dominant_direction": None,
        }
