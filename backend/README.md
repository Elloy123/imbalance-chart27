# 🚀 ImbalanceChart v5 — Engine Edition

## Arquitetura

```
┌─────────────────┐     ┌──────────────────────┐     ┌─────────────────┐
│  Binance WS     │────▶│  Engine Orchestrator  │────▶│  Frontend App   │
│  (trades real)  │     │  (análise em tempo)   │     │  (Canvas chart) │
│  BTC/USDT       │     │                       │     │                 │
│  Volume REAL    │     │  ⚡ TickVelocity      │     │  Clusters Δ     │
│  Side REAL      │     │  🧩 MicroCluster      │     │  Footprint      │
│                 │     │  📊 ATR (5s candles)   │     │  Absorções ▲▼   │
│                 │     │  🔥 ImbalanceDetector  │     │  Stacking ║║    │
│                 │     │  📉 SpreadWeight       │     │  Engine Panel   │
└─────────────────┘     └──────────────────────┘     └─────────────────┘
     ws:9443               ws:8765                    http:8000
```

## O que mudou vs versão anterior

### Volume REAL preservado
Os engines **NÃO alteram o volume**. Antes, engines multiplicavam o volume por
fatores arbitrários (ex: spread_weight × 1.5), distorcendo completamente os dados.
Agora os engines são **analistas** que retornam metadados:

- `is_absorption`: bool — absorção detectada?
- `absorption_type`: "buy_absorption" | "sell_absorption"
- `stacking_buy/sell`: int — imbalances diagonais empilhados
- `composite_signal`: float (-1 a +1)

### Engines melhorados

| Engine | Antes | Agora |
|--------|-------|-------|
| **TickVelocity** | Multiplicava volume por velocidade | Retorna `velocity`, `is_burst` como sinal |
| **SpreadWeight** | Multiplicava volume por spread | Mede regime de volatilidade (low/medium/high) |
| **MicroCluster** | Conceito ok mas sem threshold adaptativo | Threshold adaptativo + detecção de divergência delta vs preço |
| **ATR** | Tick-a-tick (mede ruído) | Candles sintéticos de 5s (volatilidade real) |
| **ImbalanceDetector** | ❌ Não existia | 🔥 NOVO: detecta stacking de imbalances diagonais (estilo YuCluster) |

### Frontend com overlays dos engines

- **▲ Triângulos** = absorções detectadas (verde=buy, vermelho=sell)
- **║ Barras laterais** = stacking de imbalances (S2, S3... indica intensidade)
- **● Dots** = sinal composto quando forte (>20%)
- **Engine Panel** = painel em tempo real com dados de cada engine

## Setup

### 1. Instalar dependências

```bash
cd backend
pip install websockets
```

### 2. Copiar arquivos

Copie a pasta `backend/` para seu projeto ImbalanceChart:
```
imbalancechart/
├── backend/
│   ├── websocket_server.py      ← SUBSTITUIR
│   ├── binance_ws.py            ← SUBSTITUIR
│   ├── engine_orchestrator.py   ← NOVO
│   ├── requirements.txt
│   └── volume_engines/          ← SUBSTITUIR TODA A PASTA
│       ├── __init__.py
│       ├── base.py
│       ├── tick_velocity.py
│       ├── spread_weight.py
│       ├── micro_cluster.py
│       ├── atr_normalize.py
│       └── imbalance_detector.py
├── frontend/
│   └── src/
│       └── App.tsx              ← SUBSTITUIR
```

### 3. Rodar o backend

```bash
cd backend
python websocket_server.py
```

Saída esperada:
```
============================================================
🚀 IMBALANCE CHART + ENGINE — BTC/USDT Tempo Real
============================================================
📡 WebSocket: ws://localhost:8765
🌐 Frontend: http://localhost:8000
✅ Engines: tick_velocity, micro_cluster, atr_normalize, imbalance_detector
✅ Abra: http://localhost:8000
⚠️  Dados públicos Binance — zero API keys
```

### 4. Rodar o frontend (desenvolvimento)

```bash
cd frontend
npm install
npm run dev
```

Ou se preferir usar o build:
```bash
npm run build
# O backend serve os arquivos estáticos de frontend/dist automaticamente
```

### 5. Usar

1. Abra o frontend (dev: http://localhost:5173, build: http://localhost:8000)
2. Clique **▶ LIVE** para conectar
3. Status muda para 🟢 WS e ✅ BINANCE
4. Clusters formam por critério de delta (threshold Δ ajustável)
5. Painel **🔥 Engines** mostra análise em tempo real
6. Overlays aparecem automaticamente no gráfico

## Controles

- **Δ slider**: Threshold de delta para fechar cluster (5000 padrão para BTC)
- **Step slider**: Tamanho do nível de preço no footprint
- **Scroll**: Pan horizontal no gráfico
- **Ctrl+Scroll**: Zoom horizontal
- **Drag borda direita**: Zoom vertical de preço
- **🔥 Engines**: Toggle painel de engines
- **⚙️ Config**: Configurações visuais

## Notas técnicas

- **WebSocket porta 8765** (backend → frontend)
- **HTTP porta 8000** (serve frontend estático)
- **Binance stream público** (sem API key, sem autenticação)
- **BTC/USDT** como ativo padrão (outros símbolos pré-configurados mas sem feed Binance)
- **Volume em USDT** (preço × quantidade BTC)
- **Side real** do Binance (is_maker=false → BUY agressivo)
