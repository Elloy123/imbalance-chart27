"""
Base abstrata para Volume Engines.
MELHORIA: engines agora retornam análise como metadados.
O volume REAL é preservado — engines NÃO alteram o volume, 
apenas acrescentam sinais analíticos.
"""
from abc import ABC, abstractmethod
from typing import Dict, Any


class VolumeEngine(ABC):
    name: str = "base"
    description: str = "Engine base"

    @abstractmethod
    def analyze(self, tick: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
        """
        Analisa um tick e retorna metadados.
        
        Retorna dict com campos específicos de cada engine:
        - signal: float (-1.0 a 1.0) indicando intensidade do sinal
        - info: dict com detalhes específicos do engine
        """
        pass

    def reset(self):
        """Reset estado interno (para troca de símbolo)."""
        pass
