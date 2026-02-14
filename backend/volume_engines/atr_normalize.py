"""
ATR Normalize Engine - Calcula ATR real baseado em candles sintéticos.

MELHORIA CRÍTICA: ATR agora usa candles de N segundos em vez de tick-a-tick.
O ATR tick-a-tick mede micro-volatilidade (ruído), não volatilidade de mercado.
Candles sintéticos de 5s capturam a volatilidade relevante para trading.
"""
import time
from collections import deque
from typing import Dict, Any
from .base import VolumeEngine


class ATRNormalizeEngine(VolumeEngine):
    name = "atr_normalize"
    description = "ATR por candles sintéticos (5s) - normaliza volatilidade real do mercado"

    def __init__(self, candle_seconds: float = 5.0, atr_period: int = 14):
        self.candle_seconds = candle_seconds
        self.atr_period = atr_period

        # Candle sintético atual
        self.candle_start = 0.0
        self.candle_open = 0.0
        self.candle_high = 0.0
        self.candle_low = float("inf")
        self.candle_close = 0.0
        self.prev_close = 0.0

        # True Range history
        self.tr_values: deque = deque(maxlen=atr_period)
        self.atr = 0.0
        self.atr_baseline = 0.0  # ATR médio de longo prazo

    def analyze(self, tick: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
        price = tick.get("price", 0.0)
        now = time.time()

        # Inicializa candle
        if self.candle_start == 0.0:
            self.candle_start = now
            self.candle_open = price
            self.candle_high = price
            self.candle_low = price
            self.candle_close = price
            self.prev_close = price
            return {"signal": 0.0, "atr": 0.0, "regime": "warmup"}

        # Atualiza candle atual
        self.candle_high = max(self.candle_high, price)
        self.candle_low = min(self.candle_low, price)
        self.candle_close = price

        # Verifica se candle fechou
        elapsed = now - self.candle_start
        if elapsed < self.candle_seconds:
            return {
                "signal": 0.0,
                "atr": round(self.atr, 6),
                "regime": self._get_regime(),
            }

        # === Fecha candle: calcula True Range ===
        tr = max(
            self.candle_high - self.candle_low,
            abs(self.candle_high - self.prev_close),
            abs(self.candle_low - self.prev_close),
        )

        self.tr_values.append(tr)
        self.prev_close = self.candle_close

        # Calcula ATR
        if len(self.tr_values) >= self.atr_period:
            self.atr = sum(self.tr_values) / len(self.tr_values)
        elif len(self.tr_values) > 0:
            self.atr = sum(self.tr_values) / len(self.tr_values)

        # Baseline com EMA lenta
        if self.atr_baseline == 0.0:
            self.atr_baseline = self.atr
        else:
            self.atr_baseline = self.atr_baseline * 0.995 + self.atr * 0.005

        # Reset candle
        self.candle_start = now
        self.candle_open = price
        self.candle_high = price
        self.candle_low = price

        # Sinal: ATR alto relativo à baseline = volatilidade expandindo
        regime = self._get_regime()
        if self.atr_baseline > 0:
            ratio = self.atr / self.atr_baseline
            signal = min(max((ratio - 1.0) / 1.0, -1.0), 1.0)
        else:
            signal = 0.0

        return {
            "signal": round(signal, 3),
            "atr": round(self.atr, 6),
            "atr_baseline": round(self.atr_baseline, 6),
            "regime": regime,
            "tr": round(tr, 6),
        }

    def _get_regime(self) -> str:
        if self.atr_baseline == 0:
            return "warmup"
        ratio = self.atr / self.atr_baseline if self.atr_baseline > 0 else 1.0
        if ratio < 0.7:
            return "contracting"
        elif ratio > 1.5:
            return "expanding"
        return "normal"

    def reset(self):
        self.candle_start = 0.0
        self.candle_open = 0.0
        self.candle_high = 0.0
        self.candle_low = float("inf")
        self.candle_close = 0.0
        self.prev_close = 0.0
        self.tr_values.clear()
        self.atr = 0.0
        self.atr_baseline = 0.0
