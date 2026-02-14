"""
Spread Weight / Volatility Engine - Mede regime de volatilidade.
Alta volatilidade = mercado mais incerto, sinais de volume são menos confiáveis.
Baixa volatilidade = mercado range-bound, absorções são mais significativas.

MELHORIA: usa desvio padrão real dos retornos, não variância absoluta de preços.
"""
from collections import deque
from typing import Dict, Any
import math
from .base import VolumeEngine


class SpreadWeightEngine(VolumeEngine):
    name = "spread_weight"
    description = "Mede regime de volatilidade (alta vol = incerteza, baixa vol = absorções claras)"

    def __init__(self, window: int = 50):
        self.window = window
        self.prices: deque = deque(maxlen=window + 1)
        self.returns: deque = deque(maxlen=window)

    def analyze(self, tick: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
        price = tick.get("price", 0.0)
        self.prices.append(price)

        if len(self.prices) < 2:
            return {"signal": 0.0, "volatility": 0.0, "regime": "unknown"}

        # Retorno percentual
        prev = self.prices[-2]
        if prev > 0:
            ret = (price - prev) / prev
        else:
            ret = 0.0
        self.returns.append(ret)

        if len(self.returns) < 5:
            return {"signal": 0.0, "volatility": 0.0, "regime": "warmup"}

        # Desvio padrão dos retornos (volatilidade realizada)
        mean_ret = sum(self.returns) / len(self.returns)
        variance = sum((r - mean_ret) ** 2 for r in self.returns) / len(self.returns)
        std_ret = math.sqrt(variance)

        # Anualized vol equivalent (rough)
        vol_annualized = std_ret * math.sqrt(252 * 24 * 3600)  # per-tick scaled

        # Classificar regime
        if std_ret < 0.00005:
            regime = "low"
            signal = 0.3  # Baixa vol = absorções mais claras
        elif std_ret < 0.0002:
            regime = "medium"
            signal = 0.0
        else:
            regime = "high"
            signal = -0.3  # Alta vol = sinais menos confiáveis

        return {
            "signal": round(signal, 3),
            "volatility": round(std_ret * 10000, 4),  # em bps
            "regime": regime,
        }

    def reset(self):
        self.prices.clear()
        self.returns.clear()
