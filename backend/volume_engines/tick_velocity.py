"""
Tick Velocity Engine - Mede velocidade de chegada dos trades.
Rajadas de trades em curto intervalo indicam agressividade no mercado.

MELHORIA: não altera volume, retorna intensidade como sinal analítico.
"""
import time
from collections import deque
from typing import Dict, Any
from .base import VolumeEngine


class TickVelocityEngine(VolumeEngine):
    name = "tick_velocity"
    description = "Detecta rajadas de trades (alta velocidade = mercado agressivo)"

    def __init__(self, window_seconds: float = 1.0, max_history: int = 200):
        self.window_seconds = window_seconds
        self.timestamps: deque = deque(maxlen=max_history)
        self.last_velocity = 0.0
        self.baseline_velocity = 10.0  # trades/s considerado "normal"

    def analyze(self, tick: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
        now = time.time()
        self.timestamps.append(now)

        # Conta trades na janela
        cutoff = now - self.window_seconds
        recent = sum(1 for t in self.timestamps if t >= cutoff)

        velocity = recent / self.window_seconds
        self.last_velocity = velocity

        # Atualiza baseline com média móvel
        self.baseline_velocity = self.baseline_velocity * 0.99 + velocity * 0.01

        # Sinal: velocidade relativa à baseline
        if self.baseline_velocity > 0:
            relative = velocity / self.baseline_velocity
        else:
            relative = 1.0

        # Normaliza para -1 a 1 (>1 baseline = positivo, <1 = negativo)
        signal = min(max((relative - 1.0) / 2.0, -1.0), 1.0)

        is_burst = velocity > self.baseline_velocity * 2.0

        return {
            "signal": round(signal, 3),
            "velocity": round(velocity, 1),
            "baseline": round(self.baseline_velocity, 1),
            "relative": round(relative, 2),
            "is_burst": is_burst,
        }

    def reset(self):
        self.timestamps.clear()
        self.last_velocity = 0.0
        self.baseline_velocity = 10.0
