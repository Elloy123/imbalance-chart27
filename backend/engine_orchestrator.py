"""
Engine Orchestrator v2 - Coordena todos os engines de análise.

MELHORIA CRÍTICA: o volume REAL é preservado intacto.
Os engines agora são analistas que produzem metadados (sinais, absorções, 
imbalances, etc.), NÃO multiplicadores que distorcem o volume.

O frontend recebe o volume real + metadados de cada engine.
"""
from typing import List, Dict, Any, Optional
from volume_engines import (
    VolumeEngine,
    TickVelocityEngine,
    SpreadWeightEngine,
    MicroClusterEngine,
    ATRNormalizeEngine,
    ImbalanceDetectorEngine,
)

ENGINE_REGISTRY = {
    "tick_velocity": TickVelocityEngine,
    "spread_weight": SpreadWeightEngine,
    "micro_cluster": MicroClusterEngine,
    "atr_normalize": ATRNormalizeEngine,
    "imbalance_detector": ImbalanceDetectorEngine,
}

# Descrições para o frontend
ENGINE_INFO = {
    "tick_velocity": {
        "id": "tick_velocity",
        "name": "⚡ Velocidade dos Trades",
        "description": "Detecta rajadas de trades (alta atividade = mercado agressivo)",
    },
    "spread_weight": {
        "id": "spread_weight",
        "name": "📉 Regime de Volatilidade",
        "description": "Mede volatilidade realizada para contextualizar sinais",
    },
    "micro_cluster": {
        "id": "micro_cluster",
        "name": "🧩 Micro-Absorção (100ms)",
        "description": "Detecta absorções: divergência entre delta e preço",
    },
    "atr_normalize": {
        "id": "atr_normalize",
        "name": "📊 ATR Real (5s candles)",
        "description": "ATR por candles sintéticos — volatilidade real do mercado",
    },
    "imbalance_detector": {
        "id": "imbalance_detector",
        "name": "🔥 Detector de Imbalance",
        "description": "Stacking de desequilíbrios diagonais (estilo YuCluster)",
    },
}


class VolumeEngineOrchestrator:
    def __init__(
        self,
        engine_names: List[str],
        config: Optional[Dict[str, Any]] = None,
    ):
        self.engines: Dict[str, VolumeEngine] = {}
        self.tick_count = 0
        self.last_price = 0.0
        self.config = config or {}

        for name in engine_names:
            if name not in ENGINE_REGISTRY:
                raise ValueError(f"Engine desconhecido: {name}. Disponíveis: {list(ENGINE_REGISTRY.keys())}")
            
            # Passa config específica se houver
            engine_config = self.config.get(name, {})
            if engine_config:
                self.engines[name] = ENGINE_REGISTRY[name](**engine_config)
            else:
                self.engines[name] = ENGINE_REGISTRY[name]()

    def analyze_tick(self, tick: Dict[str, Any]) -> Dict[str, Any]:
        """
        Analisa um tick com todos os engines ativos.
        
        Retorna:
        {
            "volume": float,         # Volume REAL (não alterado!)
            "side": str,             # Side REAL da Binance
            "is_absorption": bool,   # Absorção detectada?
            "absorption_type": str,  # Tipo de absorção
            "engines": {             # Resultado de cada engine
                "tick_velocity": {...},
                "micro_cluster": {...},
                ...
            },
            "composite_signal": float,  # Sinal composto (-1 a 1)
        }
        """
        self.tick_count += 1

        context = {
            "tick_count": self.tick_count,
            "real_side": tick.get("side_real", "neutral"),
            "real_volume": tick.get("volume_real", 1.0),
            "price": tick.get("price", 0.0),
            "last_price": self.last_price,
        }

        # Coleta análise de cada engine
        engine_results = {}
        for name, engine in self.engines.items():
            try:
                result = engine.analyze(tick, context)
                engine_results[name] = result
            except Exception as e:
                engine_results[name] = {"signal": 0.0, "error": str(e)}

        # === Análise composta ===
        
        # Absorção (do micro_cluster)
        mc = engine_results.get("micro_cluster", {})
        is_absorption = mc.get("is_absorption", False)
        absorption_type = mc.get("absorption_type", None)

        # Sinal composto: média ponderada dos sinais
        signals = []
        for name, result in engine_results.items():
            sig = result.get("signal", 0.0)
            if sig != 0.0:
                signals.append(sig)

        composite = sum(signals) / len(signals) if signals else 0.0

        # Imbalance stacking (do imbalance_detector)
        imb = engine_results.get("imbalance_detector", {})
        stacking_buy = imb.get("stacking_buy", 0)
        stacking_sell = imb.get("stacking_sell", 0)

        self.last_price = tick.get("price", 0.0)

        return {
            "volume": tick.get("volume_real", 1.0),  # VOLUME REAL, INTACTO
            "side": tick.get("side_real", "neutral"),  # SIDE REAL, INTACTO
            "is_absorption": is_absorption,
            "absorption_type": absorption_type,
            "absorption_strength": mc.get("absorption_strength", 0.0),
            "stacking_buy": stacking_buy,
            "stacking_sell": stacking_sell,
            "composite_signal": round(composite, 3),
            "engines": engine_results,
        }

    def reset_engines(self):
        """Reset todos os engines (ex: troca de símbolo)."""
        for engine in self.engines.values():
            engine.reset()
        self.tick_count = 0
        self.last_price = 0.0

    def get_active_engines(self) -> List[Dict[str, str]]:
        return [ENGINE_INFO.get(name, {"id": name}) for name in self.engines]

    @staticmethod
    def get_all_engines() -> List[Dict[str, str]]:
        return list(ENGINE_INFO.values())