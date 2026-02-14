import { useState, useEffect, useRef, useCallback, useMemo } from 'react';

// ==========================================
// TIPOS
// ==========================================

interface TickData {
  symbol: string;
  price: number;
  bid: number;
  ask: number;
  volume_synthetic: number;
  side: 'buy' | 'sell';
  timestamp: number;
  // Engine analysis data from backend
  is_absorption?: boolean;
  absorption_type?: string | null;
  absorption_strength?: number;
  composite_signal?: number;
  stacking_buy?: number;
  stacking_sell?: number;
  engines?: Record<string, any>;
}

interface Tick {
  price: number;
  volume: number;
  side: 'buy' | 'sell';
  timestamp: number;
  // Engine metadata
  is_absorption?: boolean;
  absorption_type?: string | null;
  absorption_strength?: number;
  composite_signal?: number;
  stacking_buy?: number;
  stacking_sell?: number;
}

interface PriceLevel {
  price: number;
  volumeBuy: number;
  volumeSell: number;
  volumeTotal: number;
}

interface ClusterData {
  id: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volumeBuy: number;
  volumeSell: number;
  volumeTotal: number;
  volumeBody: number;    // Volume dentro do corpo (entre open e close)
  volumeWick: number;    // Volume nas sombras (max/min)
  wickPercent: number;   // Percentual do volume nas sombras
  delta: number;
  tickCount: number;
  startTime: number;
  endTime?: number;
  isClosed: boolean;
  ticks: Tick[];
  poc: number;
  priceLevels: PriceLevel[];
  // Engine analysis aggregates
  absorptionCount: number;      // Quantas absorções detectadas neste cluster
  absorptionBuyCount: number;   // Absorções de compra
  absorptionSellCount: number;  // Absorções de venda
  maxAbsorptionStrength: number; // Maior força de absorção detectada
  maxStackingBuy: number;       // Máximo stacking buy detectado
  maxStackingSell: number;      // Máximo stacking sell detectado
  compositeSignalAvg: number;   // Média do sinal composto
}

type ViewMode = 'clean' | 'hybrid' | 'raw';
type DrawTool = 'none' | 'hline' | 'vline' | 'rect' | 'trend';

interface Drawing {
  id: number;
  type: 'hline' | 'vline' | 'rect' | 'trend';
  p1: { x: number; y: number };
  p2?: { x: number; y: number };
  color: string;
  selected?: boolean;
}

interface ChartConfig {
  bg: string;
  bgPanel: string;
  grid: string;
  gridStrong: string;
  text: string;
  textStrong: string;
  bull: string;
  bear: string;
  bullBg: string;
  bearBg: string;
  highlight: string;
  crosshair: string;
  poc: string;
  volumeUp: string;
  volumeDown: string;
  clusterWidth: number;
  clusterGap: number;
  fontSize: number;
  showPOC: boolean;
  showVolume: boolean;
  showDelta: boolean;
  showHistogram: boolean;
  showWickWarning: boolean;
  wickWarningThreshold: number;
  histogramOpacity: number;
  histogramBullColor: string;
  histogramBearColor: string;
  // Novas configurações de estilo do cluster
  clusterOpacity: number; // Opacidade do corpo do cluster (0-100)
  clusterBorderWidth: number; // Largura da borda
  clusterBorderColor: string; // Cor da borda
  showClusterBorder: boolean; // Mostrar borda
  wickColor: string; // Cor do pavio (mais cinza)
  wickWidth: number; // Largura do pavio
  pocLineWidth: number; // Largura da linha POC
  showCurrentPrice: boolean; // Mostrar linha de preço atual
  currentPriceColor: string; // Cor da linha de preço atual
  showVolumeLabels: boolean; // Mostrar labels de volume corpo/pavio
  histogramHeight: number; // Altura do histograma (50-200)
}

// ==========================================
// CONFIGURAÇÃO PADRÃO
// ==========================================

const DEFAULT_CONFIG: ChartConfig = {
  bg: '#0a0d13',
  bgPanel: '#111520',
  grid: '#1a1f2e',
  gridStrong: '#252a3a',
  text: '#888888',
  textStrong: '#ffffff',
  bull: '#26a69a',
  bear: '#ef5350',
  bullBg: '#26a69a33',
  bearBg: '#ef535033',
  highlight: '#ffd740',
  crosshair: '#ffd74088',
  poc: '#ffd740',
  volumeUp: '#26a69a',
  volumeDown: '#ef5350',
  clusterWidth: 14,
  clusterGap: 2,
  fontSize: 11,
  showPOC: true,
  showVolume: true,
  showDelta: true,
  showHistogram: true,
  showWickWarning: true,
  wickWarningThreshold: 50,
  histogramOpacity: 80,
  histogramBullColor: '#26a69a',
  histogramBearColor: '#ef5350',
  // Novas configurações de estilo
  clusterOpacity: 60, // 60% - mais transparente para destacar histograma
  clusterBorderWidth: 1,
  clusterBorderColor: '#ffffff',
  showClusterBorder: true,
  wickColor: '#666677', // Cinza para o pavio
  wickWidth: 1,
  pocLineWidth: 3,
  showCurrentPrice: true,
  currentPriceColor: '#ffd740',
  showVolumeLabels: true,
  histogramHeight: 120, // Altura padrão do histograma
};

const SYMBOLS = [
  { name: 'BTCUSDT', label: 'BTC/USDT', digits: 2, deltaThreshold: 5000, basePrice: 97000, tickSize: 0.01, defaultPriceStep: 1.0 },
  { name: 'EURUSD', label: 'EUR/USD', digits: 5, deltaThreshold: 50, basePrice: 1.0850, tickSize: 0.00001, defaultPriceStep: 0.0001 },
  { name: 'GBPUSD', label: 'GBP/USD', digits: 5, deltaThreshold: 60, basePrice: 1.2650, tickSize: 0.00001, defaultPriceStep: 0.0001 },
  { name: 'XAUUSD', label: 'XAU/USD', digits: 2, deltaThreshold: 100, basePrice: 2350, tickSize: 0.01, defaultPriceStep: 0.1 },
  { name: 'USTEC', label: 'USTEC', digits: 2, deltaThreshold: 150, basePrice: 18500, tickSize: 0.25, defaultPriceStep: 0.5 },
];

const BACKEND_URL = 'http://localhost:8000';
const WS_URL = 'ws://localhost:8765';

// ==========================================
// FUNÇÕES AUXILIARES
// ==========================================

// Função para discretizar preço com base no priceStep
function discretizePrice(price: number, priceStep: number): number {
  return Math.round(price / priceStep) * priceStep;
}

function reprocessClusters(ticks: Tick[], threshold: number, priceStep: number = 0): ClusterData[] {
  if (ticks.length === 0) return [];

  const clusters: ClusterData[] = [];
  let currentCluster: ClusterData | null = null;
  let clusterId = 1;

  for (const tick of ticks) {
    const vol = tick.volume;
    // Discretizar o preço se priceStep > 0
    const discretePrice = priceStep > 0 ? discretizePrice(tick.price, priceStep) : tick.price;

    if (!currentCluster) {
      const priceLevels: PriceLevel[] = [{
        price: discretePrice,
        volumeBuy: tick.side === 'buy' ? vol : 0,
        volumeSell: tick.side === 'sell' ? vol : 0,
        volumeTotal: vol,
      }];

      currentCluster = {
        id: clusterId++,
        open: discretePrice,
        high: discretePrice,
        low: discretePrice,
        close: discretePrice,
        volumeBuy: tick.side === 'buy' ? vol : 0,
        volumeSell: tick.side === 'sell' ? vol : 0,
        volumeTotal: vol,
        volumeBody: vol, // Primeiro tick está no corpo
        volumeWick: 0,
        wickPercent: 0,
        delta: tick.side === 'buy' ? vol : -vol,
        tickCount: 1,
        startTime: tick.timestamp,
        isClosed: false,
        ticks: [tick],
        poc: discretePrice,
        priceLevels,
        // Engine fields
        absorptionCount: tick.is_absorption ? 1 : 0,
        absorptionBuyCount: tick.absorption_type === 'buy_absorption' ? 1 : 0,
        absorptionSellCount: tick.absorption_type === 'sell_absorption' ? 1 : 0,
        maxAbsorptionStrength: tick.absorption_strength || 0,
        maxStackingBuy: tick.stacking_buy || 0,
        maxStackingSell: tick.stacking_sell || 0,
        compositeSignalAvg: tick.composite_signal || 0,
      };
    } else {
      currentCluster.high = Math.max(currentCluster.high, discretePrice);
      currentCluster.low = Math.min(currentCluster.low, discretePrice);
      currentCluster.close = discretePrice;
      currentCluster.tickCount++;
      currentCluster.volumeTotal += vol;
      currentCluster.ticks.push(tick);

      // Calcular se está no corpo ou na sombra
      const bodyTop = Math.max(currentCluster.open, currentCluster.close);
      const bodyBottom = Math.min(currentCluster.open, currentCluster.close);
      
      if (discretePrice >= bodyBottom && discretePrice <= bodyTop) {
        // Dentro do corpo
        currentCluster.volumeBody += vol;
      } else {
        // Nas sombras (max/min)
        currentCluster.volumeWick += vol;
      }

      // Atualizar percentual da sombra
      currentCluster.wickPercent = (currentCluster.volumeWick / currentCluster.volumeTotal) * 100;

      if (tick.side === 'buy') {
        currentCluster.volumeBuy += vol;
        currentCluster.delta += vol;
      } else {
        currentCluster.volumeSell += vol;
        currentCluster.delta -= vol;
      }

      // Accumulate engine analysis data
      if (tick.is_absorption) {
        currentCluster.absorptionCount++;
        if (tick.absorption_type === 'buy_absorption') currentCluster.absorptionBuyCount++;
        if (tick.absorption_type === 'sell_absorption') currentCluster.absorptionSellCount++;
        currentCluster.maxAbsorptionStrength = Math.max(
          currentCluster.maxAbsorptionStrength, tick.absorption_strength || 0
        );
      }
      currentCluster.maxStackingBuy = Math.max(currentCluster.maxStackingBuy, tick.stacking_buy || 0);
      currentCluster.maxStackingSell = Math.max(currentCluster.maxStackingSell, tick.stacking_sell || 0);
      // Running average of composite signal
      const n = currentCluster.tickCount;
      currentCluster.compositeSignalAvg = 
        (currentCluster.compositeSignalAvg * (n - 1) + (tick.composite_signal || 0)) / n;

      // Agrupar por nível discreto de preço
      const existingLevel = currentCluster.priceLevels.find(l => l.price === discretePrice);
      if (existingLevel) {
        existingLevel.volumeTotal += vol;
        if (tick.side === 'buy') existingLevel.volumeBuy += vol;
        else existingLevel.volumeSell += vol;
      } else {
        currentCluster.priceLevels.push({
          price: discretePrice,
          volumeBuy: tick.side === 'buy' ? vol : 0,
          volumeSell: tick.side === 'sell' ? vol : 0,
          volumeTotal: vol,
        });
      }

      const maxLevel = currentCluster.priceLevels.reduce((max, l) => 
        l.volumeTotal > max.volumeTotal ? l : max
      , currentCluster.priceLevels[0]);
      currentCluster.poc = maxLevel.price;
    }

    if (currentCluster && Math.abs(currentCluster.delta) >= threshold) {
      currentCluster.isClosed = true;
      currentCluster.endTime = tick.timestamp;
      clusters.push({ ...currentCluster });
      currentCluster = null;
    }
  }

  if (currentCluster) {
    clusters.push(currentCluster);
  }

  return clusters;
}

// ==========================================
// GRÁFICO PROFISSIONAL
// ==========================================

function ProfessionalChart({
  clusters,
  symbol,
  threshold,
  priceStep,
  config,
  viewMode,
  drawTool,
  drawings,
  onAddDrawing,
  onUpdateDrawing,
  selectedDrawing,
  onSelectDrawing,
}: {
  clusters: ClusterData[];
  symbol: string;
  threshold: number;
  priceStep: number;
  config: ChartConfig;
  viewMode: ViewMode;
  drawTool: DrawTool;
  drawings: Drawing[];
  onAddDrawing: (drawing: Drawing) => void;
  onUpdateDrawing: (drawing: Drawing) => void;
  selectedDrawing: number | null;
  onSelectDrawing: (id: number | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const preset = SYMBOLS.find(s => s.name === symbol) || SYMBOLS[0];

  const [viewState, setViewState] = useState({
    offsetX: 0,
    offsetY: 0,
    scaleX: 1,
    scaleY: 1,
    isDragging: false,
    isZooming: false,
    lastX: 0,
    lastY: 0,
    dragMode: 'pan' as 'pan' | 'zoom' | 'moveDrawing',
  });

  const [crosshair, setCrosshair] = useState({ x: 0, y: 0, visible: false });
  const [dimensions, setDimensions] = useState({ width: 900, height: 600 });
  const [currentDrawing, setCurrentDrawing] = useState<Drawing | null>(null);

  const PRICE_WIDTH = 80;
  const TIME_HEIGHT = 25;
  const HISTOGRAM_HEIGHT = config.showHistogram ? config.histogramHeight : 0;
  const CHART_HEIGHT = dimensions.height - TIME_HEIGHT - HISTOGRAM_HEIGHT;
  const chartWidth = dimensions.width - PRICE_WIDTH;

  const priceRange = useMemo(() => {
    if (clusters.length === 0) {
      const base = preset.basePrice;
      return { high: base * 1.005, low: base * 0.995 };
    }

    let high = -Infinity, low = Infinity;
    clusters.forEach(c => {
      high = Math.max(high, c.high);
      low = Math.min(low, c.low);
    });

    const range = (high - low) * viewState.scaleY;
    const center = (high + low) / 2;
    const pad = range * 0.15;

    return {
      high: center + range / 2 + pad - viewState.offsetY,
      low: center - range / 2 - pad - viewState.offsetY,
    };
  }, [clusters, preset, viewState.scaleY, viewState.offsetY]);

  const priceToY = useCallback((price: number) => {
    return ((priceRange.high - price) / (priceRange.high - priceRange.low)) * CHART_HEIGHT;
  }, [priceRange, CHART_HEIGHT]);

  const yToPrice = useCallback((y: number) => {
    return priceRange.high - (y / CHART_HEIGHT) * (priceRange.high - priceRange.low);
  }, [priceRange, CHART_HEIGHT]);

  const clusterWidth = config.clusterWidth * viewState.scaleX;

  const clusterToX = useCallback((index: number) => {
    return index * (clusterWidth + config.clusterGap) + viewState.offsetX + clusterWidth / 2;
  }, [viewState.offsetX, viewState.scaleX, config.clusterGap, clusterWidth]);

  const xToClusterIndex = useCallback((x: number) => {
    return Math.floor((x - viewState.offsetX) / (clusterWidth + config.clusterGap));
  }, [viewState.offsetX, clusterWidth, config.clusterGap]);

  const visibleClusters = useMemo(() => {
    const totalWidth = clusterWidth + config.clusterGap;
    const startIdx = Math.max(0, Math.floor(-viewState.offsetX / totalWidth) - 1);
    const count = Math.ceil(chartWidth / totalWidth) + 3;
    return { clusters: clusters.slice(startIdx, startIdx + count), startIdx };
  }, [clusters, viewState.offsetX, clusterWidth, config.clusterGap, chartWidth]);

  const maxVolume = useMemo(() => Math.max(...clusters.map(c => c.volumeTotal), 1), [clusters]);

  // ==========================================
  // RENDERIZAÇÃO
  // ==========================================

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = config.bg;
    ctx.fillRect(0, 0, dimensions.width, dimensions.height);

    // Grid horizontal
    ctx.strokeStyle = config.grid;
    ctx.lineWidth = 0.5;
    const gridPriceStep = (priceRange.high - priceRange.low) / 8;

    for (let i = 0; i <= 8; i++) {
      const y = (CHART_HEIGHT / 8) * i;
      const price = priceRange.high - gridPriceStep * i;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(chartWidth, y);
      ctx.stroke();

      ctx.fillStyle = config.text;
      ctx.font = `${config.fontSize}px monospace`;
      ctx.textAlign = 'left';
      ctx.fillText(price.toFixed(preset.digits), chartWidth + 5, y + 4);
    }

    // Linha de Preço Atual
    if (config.showCurrentPrice && clusters.length > 0) {
      const lastCluster = clusters[clusters.length - 1];
      const currentPrice = lastCluster.close;
      const currentY = priceToY(currentPrice);
      
      // Linha tracejada
      ctx.strokeStyle = config.currentPriceColor;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 3]);
      ctx.beginPath();
      ctx.moveTo(0, currentY);
      ctx.lineTo(chartWidth, currentY);
      ctx.stroke();
      ctx.setLineDash([]);
      
      // Box com preço atual
      const boxW = 75;
      const boxH = 18;
      ctx.fillStyle = config.currentPriceColor;
      ctx.fillRect(chartWidth, currentY - boxH/2, boxW, boxH);
      
      ctx.fillStyle = config.bg;
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'left';
      ctx.fillText(currentPrice.toFixed(preset.digits), chartWidth + 4, currentY + 4);
    }

    // Desenhos do usuário
    drawings.forEach(d => {
      const isSelected = d.id === selectedDrawing;
      ctx.strokeStyle = d.color;
      ctx.lineWidth = isSelected ? 2.5 : 1.5;

      if (d.type === 'hline') {
        const y = priceToY(d.p1.y);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(chartWidth, y);
        ctx.stroke();

        ctx.fillStyle = d.color;
        ctx.font = 'bold 10px monospace';
        ctx.textAlign = 'left';
        ctx.fillText(d.p1.y.toFixed(preset.digits), chartWidth + 5, y - 3);

        if (isSelected) {
          ctx.fillStyle = d.color;
          ctx.beginPath();
          ctx.arc(chartWidth - 10, y, 5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      else if (d.type === 'vline' && d.p1.x !== undefined) {
        const x = clusterToX(d.p1.x);
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, CHART_HEIGHT);
        ctx.stroke();
      }
      else if (d.type === 'rect' && d.p1 && d.p2) {
        const x1 = clusterToX(d.p1.x);
        const y1 = priceToY(d.p1.y);
        const x2 = clusterToX(d.p2.x);
        const y2 = priceToY(d.p2.y);

        ctx.fillStyle = d.color + '22';
        ctx.fillRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
        ctx.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
      }
      else if (d.type === 'trend' && d.p1 && d.p2) {
        const x1 = clusterToX(d.p1.x);
        const y1 = priceToY(d.p1.y);
        const x2 = clusterToX(d.p2.x);
        const y2 = priceToY(d.p2.y);

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();

        const dx = x2 - x1;
        const dy = y2 - y1;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(x1 - dx * 5, y1 - dy * 5);
        ctx.lineTo(x2 + dx * 5, y2 + dy * 5);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    });

    // Desenho em progresso
    if (currentDrawing && currentDrawing.p1) {
      ctx.strokeStyle = currentDrawing.color;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 5]);

      if (currentDrawing.type === 'hline') {
        const y = priceToY(currentDrawing.p1.y);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(chartWidth, y);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    // ==========================================
    // CLUSTERS
    // ==========================================

    visibleClusters.clusters.forEach((cluster, i) => {
      const globalIdx = visibleClusters.startIdx + i;
      const centerX = clusterToX(globalIdx);
      const x = centerX - clusterWidth / 2;
      const w = clusterWidth;

      if (centerX < -w || centerX > chartWidth + w) return;

      const isBull = cluster.close >= cluster.open;
      const color = isBull ? config.bull : config.bear;

      // Modos de visualização
      if (viewMode === 'clean') {
        const gridStep = (priceRange.high - priceRange.low) / 20;
        const gridOpen = Math.round(cluster.open / gridStep) * gridStep;
        const gridClose = Math.round(cluster.close / gridStep) * gridStep;

        const topY = priceToY(Math.max(gridOpen, gridClose));
        const bottomY = priceToY(Math.min(gridOpen, gridClose));
        const blockH = Math.max(2, bottomY - topY);

        ctx.fillStyle = cluster.isClosed ? color : color + '88';
        ctx.fillRect(x, topY, w, blockH);
      }
      else if (viewMode === 'hybrid' || viewMode === 'raw') {
        const bodyTop = priceToY(Math.max(cluster.open, cluster.close));
        const bodyBottom = priceToY(Math.min(cluster.open, cluster.close));
        const bodyH = Math.max(2, bodyBottom - bodyTop);

        // Opacidade do cluster configurável
        const clusterOpacityHex = Math.round((config.clusterOpacity / 100) * 255).toString(16).padStart(2, '0');
        
        // Corpo principal com opacidade configurável
        ctx.fillStyle = (cluster.isClosed ? color : color) + clusterOpacityHex;
        ctx.fillRect(x, bodyTop, w, bodyH);

        // Borda do cluster
        if (config.showClusterBorder) {
          ctx.strokeStyle = config.clusterBorderColor + '88';
          ctx.lineWidth = config.clusterBorderWidth;
          ctx.strokeRect(x, bodyTop, w, bodyH);
        }

        // Wick (pavio) com cor cinza
        ctx.strokeStyle = config.wickColor;
        ctx.lineWidth = config.wickWidth;
        ctx.beginPath();
        ctx.moveTo(centerX, priceToY(cluster.high));
        ctx.lineTo(centerX, bodyTop);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(centerX, bodyBottom);
        ctx.lineTo(centerX, priceToY(cluster.low));
        ctx.stroke();

        // POC mais evidente
        if (config.showPOC && cluster.poc) {
          const pocY = priceToY(cluster.poc);
          
          // Linha POC mais grossa e com brilho
          ctx.strokeStyle = config.poc;
          ctx.lineWidth = config.pocLineWidth;
          ctx.beginPath();
          ctx.moveTo(x - 2, pocY);
          ctx.lineTo(x + w + 2, pocY);
          ctx.stroke();
          
          // Sombra/glow na POC
          ctx.strokeStyle = config.poc + '44';
          ctx.lineWidth = config.pocLineWidth + 2;
          ctx.beginPath();
          ctx.moveTo(x - 4, pocY);
          ctx.lineTo(x + w + 4, pocY);
          ctx.stroke();
        }

        // Volume Profile Interno - Modo HYBRID e RAW
        if (cluster.priceLevels.length > 0) {
          const maxLevelVol = Math.max(...cluster.priceLevels.map(l => l.volumeTotal));
          const opacity = Math.round((config.histogramOpacity / 100) * 255).toString(16).padStart(2, '0');
          const barWidth = viewMode === 'raw' ? 0.85 : 0.6;

          cluster.priceLevels.forEach(level => {
            const y = priceToY(level.price);
            const barW = (level.volumeTotal / maxLevelVol) * w * barWidth;
            
            const baseColor = level.volumeBuy >= level.volumeSell ? config.histogramBullColor : config.histogramBearColor;
            ctx.fillStyle = baseColor + opacity;
            ctx.fillRect(centerX - barW / 2, y - 1, barW, 2);
          });
        }

        // Labels de Volume (corpo e pavio)
        if (config.showVolumeLabels && viewState.scaleX >= 1) {
          const lowY = priceToY(cluster.low);
          const highY = priceToY(cluster.high);
          
          // Volume do pavio (nas sombras)
          ctx.fillStyle = '#888899'; // Cinza
          ctx.font = '7px monospace';
          ctx.textAlign = 'center';
          ctx.fillText(`W:${cluster.volumeWick}`, centerX, lowY + 10);
          
          // Volume do corpo
          ctx.fillStyle = isBull ? config.bull : config.bear;
          ctx.fillText(`B:${cluster.volumeBody}`, centerX, highY - 4);
        }
      }

      // Borda tracejada para cluster em formação
      if (!cluster.isClosed) {
        ctx.strokeStyle = config.highlight;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        const bodyTop = priceToY(Math.max(cluster.open, cluster.close));
        const bodyBottom = priceToY(Math.min(cluster.open, cluster.close));
        ctx.strokeRect(x, bodyTop, w, Math.max(2, bodyBottom - bodyTop));
        ctx.setLineDash([]);
      }

      // ==========================================
      // AVISO DE VOLUME NAS SOMBRAS (>50%)
      // ==========================================

      if (config.showWickWarning && cluster.wickPercent >= config.wickWarningThreshold) {
        const lowY = priceToY(cluster.low);
        const warningY = lowY + 12;
        
        // Bolinha de aviso
        ctx.fillStyle = config.highlight;
        ctx.beginPath();
        ctx.arc(centerX, warningY, 4, 0, Math.PI * 2);
        ctx.fill();

        // Borda da bolinha
        ctx.strokeStyle = config.bg;
        ctx.lineWidth = 1;
        ctx.stroke();

        // Percentual ao lado (se zoom suficiente)
        if (viewState.scaleX >= 1) {
          ctx.fillStyle = config.highlight;
          ctx.font = 'bold 8px monospace';
          ctx.textAlign = 'center';
          ctx.fillText(`${cluster.wickPercent.toFixed(0)}%`, centerX, warningY + 12);
        }
      }

      // ==========================================
      // ENGINE OVERLAYS - Absorções, Imbalances, Sinal
      // ==========================================

      // 🧩 Absorption marker (triângulo no topo/base do cluster)
      if (cluster.absorptionCount > 0) {
        const highY = priceToY(cluster.high);
        const lowY = priceToY(cluster.low);
        const markerSize = Math.min(6, Math.max(3, clusterWidth * 0.3));

        if (cluster.absorptionBuyCount > cluster.absorptionSellCount) {
          // Buy absorption → triângulo verde embaixo (compradores absorvendo vendas)
          ctx.fillStyle = '#00e676';
          ctx.beginPath();
          ctx.moveTo(centerX, lowY + markerSize * 3);
          ctx.lineTo(centerX - markerSize, lowY + markerSize * 3 + markerSize * 1.5);
          ctx.lineTo(centerX + markerSize, lowY + markerSize * 3 + markerSize * 1.5);
          ctx.closePath();
          ctx.fill();

          // Quantidade se > 1
          if (cluster.absorptionBuyCount > 1 && viewState.scaleX >= 0.8) {
            ctx.fillStyle = '#00e676';
            ctx.font = 'bold 7px monospace';
            ctx.textAlign = 'center';
            ctx.fillText(`${cluster.absorptionBuyCount}`, centerX, lowY + markerSize * 3 + markerSize * 1.5 + 10);
          }
        } else if (cluster.absorptionSellCount > 0) {
          // Sell absorption → triângulo vermelho no topo (vendedores absorvendo compras)
          ctx.fillStyle = '#ff5252';
          ctx.beginPath();
          ctx.moveTo(centerX, highY - markerSize * 3);
          ctx.lineTo(centerX - markerSize, highY - markerSize * 3 - markerSize * 1.5);
          ctx.lineTo(centerX + markerSize, highY - markerSize * 3 - markerSize * 1.5);
          ctx.closePath();
          ctx.fill();

          if (cluster.absorptionSellCount > 1 && viewState.scaleX >= 0.8) {
            ctx.fillStyle = '#ff5252';
            ctx.font = 'bold 7px monospace';
            ctx.textAlign = 'center';
            ctx.fillText(`${cluster.absorptionSellCount}`, centerX, highY - markerSize * 3 - markerSize * 1.5 - 4);
          }
        }
      }

      // 🔥 Imbalance stacking indicator (barras laterais)
      if (cluster.maxStackingBuy >= 2 || cluster.maxStackingSell >= 2) {
        const barW = Math.max(2, clusterWidth * 0.12);
        const bodyTop = priceToY(Math.max(cluster.open, cluster.close));
        const bodyBottom = priceToY(Math.min(cluster.open, cluster.close));
        const bodyH = Math.max(4, bodyBottom - bodyTop);

        if (cluster.maxStackingBuy >= 2) {
          // Stacking de compra → barra verde na esquerda do cluster
          const intensity = Math.min(cluster.maxStackingBuy / 5, 1);
          const alpha = Math.round(intensity * 200 + 55).toString(16).padStart(2, '0');
          ctx.fillStyle = '#00e676' + alpha;
          ctx.fillRect(x - barW - 1, bodyTop, barW, bodyH);

          // Número de stacking
          if (viewState.scaleX >= 0.8) {
            ctx.fillStyle = '#00e676';
            ctx.font = 'bold 7px monospace';
            ctx.textAlign = 'right';
            ctx.fillText(`S${cluster.maxStackingBuy}`, x - barW - 2, bodyTop + bodyH / 2 + 3);
          }
        }

        if (cluster.maxStackingSell >= 2) {
          // Stacking de venda → barra vermelha na direita do cluster
          const intensity = Math.min(cluster.maxStackingSell / 5, 1);
          const alpha = Math.round(intensity * 200 + 55).toString(16).padStart(2, '0');
          ctx.fillStyle = '#ff5252' + alpha;
          ctx.fillRect(x + w + 1, bodyTop, barW, bodyH);

          if (viewState.scaleX >= 0.8) {
            ctx.fillStyle = '#ff5252';
            ctx.font = 'bold 7px monospace';
            ctx.textAlign = 'left';
            ctx.fillText(`S${cluster.maxStackingSell}`, x + w + barW + 2, bodyTop + bodyH / 2 + 3);
          }
        }
      }

      // 📊 Composite signal dot (bolinha no canto superior do cluster)
      if (Math.abs(cluster.compositeSignalAvg) > 0.2 && viewState.scaleX >= 0.7) {
        const dotX = x + w - 3;
        const dotY = priceToY(cluster.high) - 2;
        const dotSize = Math.min(4, 2 + Math.abs(cluster.compositeSignalAvg) * 3);
        
        ctx.fillStyle = cluster.compositeSignalAvg > 0 ? '#00e67688' : '#ff525288';
        ctx.beginPath();
        ctx.arc(dotX, dotY, dotSize, 0, Math.PI * 2);
        ctx.fill();
      }
    });

    // ==========================================
    // HISTOGRAMA DE VOLUME (DUAS BARRAS)
    // ==========================================

    if (config.showHistogram && HISTOGRAM_HEIGHT > 0) {
      const histY = CHART_HEIGHT;
      const labelSpace = 14; // Espaço para labels
      const gap = 3; // Espaço entre as barras
      const availableHeight = HISTOGRAM_HEIGHT - labelSpace - gap;
      const barHeight = availableHeight / 2; // Cada barra ocupa metade

      ctx.fillStyle = config.bgPanel;
      ctx.fillRect(0, histY, chartWidth, HISTOGRAM_HEIGHT);

      // Separador principal
      ctx.strokeStyle = config.gridStrong;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, histY);
      ctx.lineTo(chartWidth, histY);
      ctx.stroke();

      // Labels
      ctx.fillStyle = config.text;
      ctx.font = '9px monospace';
      ctx.textAlign = 'left';
      ctx.fillText('VOL', 3, histY + 11);
      ctx.fillText('BODY/WICK', 3, histY + barHeight + gap + 11);

      visibleClusters.clusters.forEach((cluster, i) => {
        const globalIdx = visibleClusters.startIdx + i;
        const centerX = clusterToX(globalIdx);
        const x = centerX - clusterWidth / 2;

        if (centerX < -clusterWidth || centerX > chartWidth + clusterWidth) return;

        const isBull = cluster.close >= cluster.open;

        // ===== BARRA 1: VOLUME TOTAL (superior) =====
        const volBar1H = (cluster.volumeTotal / maxVolume) * (barHeight - 8);
        const volBar1Y = histY + labelSpace + barHeight - volBar1H - 2;
        
        ctx.fillStyle = isBull ? config.bull + 'cc' : config.bear + 'cc';
        ctx.fillRect(x, volBar1Y, clusterWidth, volBar1H);

        // ===== BARRA 2: CORPO/PAVIO (inferior) =====
        const bar2Y = histY + labelSpace + barHeight + gap;
        const volBar2H = (cluster.volumeTotal / maxVolume) * (barHeight - 8);
        
        const bodyPercent = cluster.volumeBody / cluster.volumeTotal;
        const wickPercent = cluster.volumeWick / cluster.volumeTotal;
        
        const bodyH = volBar2H * bodyPercent;
        const wickH = volBar2H * wickPercent;
        
        const baseY2 = bar2Y + barHeight - volBar2H - 2;
        
        // Volume do corpo (verde mais claro ou vermelho mais claro)
        if (bodyH > 0) {
          const bodyColor = isBull ? '#4ade80' : '#f87171';
          ctx.fillStyle = bodyColor;
          ctx.fillRect(x, baseY2 + wickH, clusterWidth, bodyH);
        }
        
        // Volume do pavio (cinza ou amarelo se > 50%)
        if (wickH > 0) {
          const wickColor = cluster.wickPercent >= 50 ? '#ffd740' : '#6b7280';
          ctx.fillStyle = wickColor;
          ctx.fillRect(x, baseY2, clusterWidth, wickH);
        }
      });
    }

    // ==========================================
    // CROSSHAIR NATIVO
    // ==========================================

    if (crosshair.visible && !viewState.isDragging) {
      ctx.strokeStyle = config.crosshair;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);

      // Linha vertical (topo ao fim)
      ctx.beginPath();
      ctx.moveTo(crosshair.x, 0);
      ctx.lineTo(crosshair.x, CHART_HEIGHT + HISTOGRAM_HEIGHT);
      ctx.stroke();

      // Linha horizontal (esquerda à direita)
      ctx.beginPath();
      ctx.moveTo(0, crosshair.y);
      ctx.lineTo(chartWidth, crosshair.y);
      ctx.stroke();
      ctx.setLineDash([]);

      // Box preço
      const price = yToPrice(crosshair.y);
      ctx.fillStyle = config.highlight;
      ctx.fillRect(chartWidth, crosshair.y - 9, PRICE_WIDTH - 5, 18);
      ctx.fillStyle = config.bg;
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'left';
      ctx.fillText(price.toFixed(preset.digits), chartWidth + 3, crosshair.y + 4);

    }

    // Header
    ctx.fillStyle = config.bgPanel + 'cc';
    ctx.fillRect(0, 0, 420, 40);

    ctx.fillStyle = config.highlight;
    ctx.font = 'bold 13px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`${preset.label} | ${viewMode.toUpperCase()} | BINANCE LIVE`, 10, 15);

    ctx.fillStyle = config.text;
    ctx.font = '10px monospace';
    ctx.fillText(`Clusters: ${clusters.filter(c => c.isClosed).length} | Δ Th: ${threshold} | Step: ${priceStep.toFixed(preset.digits)} | Zoom: ${(viewState.scaleX * 100).toFixed(0)}%`, 10, 30);

    // Engine legend (top right)
    ctx.fillStyle = config.bgPanel + 'dd';
    ctx.fillRect(chartWidth - 215, 0, 215, 32);
    ctx.font = '8px monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#00e676'; ctx.fillText('▲ Buy Absorção', chartWidth - 210, 11);
    ctx.fillStyle = '#ff5252'; ctx.fillText('▼ Sell Absorção', chartWidth - 210, 22);
    ctx.fillStyle = '#00e676'; ctx.fillText('║ Stacking Buy', chartWidth - 115, 11);
    ctx.fillStyle = '#ff5252'; ctx.fillText('║ Stacking Sell', chartWidth - 115, 22);

    // Minimap
    if (clusters.length > 0) {
      const mmW = 100;
      const mmH = 28;
      const mmX = chartWidth - mmW - 10;
      const mmY = dimensions.height - mmH - 8;

      ctx.fillStyle = config.bgPanel;
      ctx.fillRect(mmX, mmY, mmW, mmH);
      ctx.strokeStyle = config.gridStrong;
      ctx.strokeRect(mmX, mmY, mmW, mmH);

      const mmScale = mmW / clusters.length;
      clusters.forEach((c, i) => {
        const mx = mmX + i * mmScale;
        ctx.fillStyle = (c.close >= c.open ? config.bull : config.bear) + '88';
        ctx.fillRect(mx, mmY + 2, Math.max(1, mmScale), mmH - 4);

        // Marcar clusters com aviso de wick
        if (c.wickPercent >= config.wickWarningThreshold) {
          ctx.fillStyle = config.highlight;
          ctx.fillRect(mx, mmY + mmH - 6, Math.max(1, mmScale), 4);
        }
      });

      const totalWidth = clusters.length * (clusterWidth + config.clusterGap);
      const viewportW = (chartWidth / totalWidth) * mmW;
      const viewportX = mmX + (-viewState.offsetX / totalWidth) * mmW;
      ctx.strokeStyle = config.highlight;
      ctx.lineWidth = 2;
      ctx.strokeRect(Math.max(mmX, viewportX), mmY, Math.min(viewportW, mmW), mmH);
    }

  }, [clusters, symbol, viewState, crosshair, dimensions, preset, config, viewMode,
      visibleClusters, priceRange, drawings, currentDrawing, selectedDrawing, threshold, priceStep]);

  // ==========================================
  // HANDLERS DE MOUSE
  // ==========================================

  const handleMouseDown = (e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (drawTool === 'none') {
      for (const d of drawings) {
        if (d.type === 'hline') {
          const dy = priceToY(d.p1.y);
          if (Math.abs(y - dy) < 8) {
            onSelectDrawing(d.id);
            setViewState(prev => ({
              ...prev,
              isDragging: true,
              lastY: e.clientY,
              dragMode: 'moveDrawing',
            }));
            return;
          }
        }
      }
    }

    if (x > chartWidth) {
      setViewState(prev => ({
        ...prev,
        isZooming: true,
        lastY: e.clientY,
        dragMode: 'zoom',
      }));
      return;
    }

    if (drawTool !== 'none') {
      const price = yToPrice(y);
      const idx = xToClusterIndex(x);

      setCurrentDrawing({
        id: Date.now(),
        type: drawTool as any,
        p1: { x: idx, y: price },
        color: config.highlight,
      });
      return;
    }

    onSelectDrawing(null);
    setViewState(prev => ({
      ...prev,
      isDragging: true,
      lastX: e.clientX,
      lastY: e.clientY,
      dragMode: 'pan',
    }));
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    setCrosshair({ x: Math.min(x, chartWidth), y, visible: true });

    if (viewState.isDragging && viewState.dragMode === 'moveDrawing' && selectedDrawing) {
      const drawing = drawings.find(d => d.id === selectedDrawing);
      if (drawing && drawing.type === 'hline') {
        const newPrice = yToPrice(y);
        onUpdateDrawing({ ...drawing, p1: { ...drawing.p1, y: newPrice } });
      }
      return;
    }

    if (viewState.isZooming && viewState.dragMode === 'zoom') {
      const dy = e.clientY - viewState.lastY;
      const scaleDelta = 1 + dy * 0.003;
      const newScaleY = Math.max(0.3, Math.min(15, viewState.scaleY * scaleDelta));

      setViewState(prev => ({
        ...prev,
        scaleY: newScaleY,
        lastY: e.clientY,
      }));
      return;
    }

    if (viewState.isDragging && viewState.dragMode === 'pan') {
      const dx = e.clientX - viewState.lastX;
      const totalWidth = clusters.length * (clusterWidth + config.clusterGap);
      const maxOffset = Math.max(0, totalWidth - chartWidth);
      const newOffset = Math.max(-maxOffset, Math.min(0, viewState.offsetX + dx));

      setViewState(prev => ({
        ...prev,
        offsetX: newOffset,
        lastX: e.clientX,
      }));
    }
    else if (currentDrawing && drawTool !== 'none') {
      const price = yToPrice(y);
      const idx = xToClusterIndex(x);
      setCurrentDrawing(prev => prev ? { ...prev, p2: { x: idx, y: price } } : null);
    }
  };

  const handleMouseUp = () => {
    if (currentDrawing && currentDrawing.p1) {
      if (currentDrawing.type === 'hline' || currentDrawing.p2) {
        onAddDrawing(currentDrawing);
      }
    }
    setCurrentDrawing(null);

    setViewState(prev => ({
      ...prev,
      isDragging: false,
      isZooming: false,
    }));
  };

  const handleMouseLeave = () => {
    setCrosshair(prev => ({ ...prev, visible: false }));
    setViewState(prev => ({ ...prev, isDragging: false, isZooming: false }));
  };

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (e.ctrlKey) {
      // Ctrl + Scroll = ZOOM
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      const newScale = Math.max(0.3, Math.min(15, viewState.scaleX * delta));

      setViewState(prev => ({
        ...prev,
        scaleX: newScale,
      }));
    } else {
      // Scroll normal = PAN HORIZONTAL
      const panSpeed = 50;
      const delta = e.deltaY > 0 ? panSpeed : -panSpeed;
      const totalWidth = clusters.length * (clusterWidth + config.clusterGap);
      const maxOffset = Math.max(0, totalWidth - chartWidth);
      const newOffset = Math.max(-maxOffset, Math.min(0, viewState.offsetX + delta));

      setViewState(prev => ({
        ...prev,
        offsetX: newOffset,
      }));
    }
  }, [viewState.scaleX, viewState.offsetX, clusters.length, clusterWidth, config.clusterGap, chartWidth]);

  // Prevenir zoom do navegador quando cursor está no canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const preventZoom = (e: WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault();
      }
    };

    canvas.addEventListener('wheel', preventZoom, { passive: false });
    return () => canvas.removeEventListener('wheel', preventZoom);
  }, []);

  useEffect(() => {
    if (clusters.length > 0) {
      const totalWidth = clusters.length * (clusterWidth + config.clusterGap);
      const maxOffset = Math.max(0, totalWidth - chartWidth);
      setViewState(prev => ({ ...prev, offsetX: -maxOffset }));
    }
  }, [clusters.length]);

  useEffect(() => {
    const handleResize = () => {
      if (containerRef.current) {
        setDimensions({ width: containerRef.current.clientWidth, height: 600 });
      }
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <canvas
        ref={canvasRef}
        width={dimensions.width}
        height={dimensions.height}
        style={{
          background: config.bg,
          borderRadius: 4,
          cursor: viewState.isDragging ? 'grabbing' : drawTool !== 'none' ? 'crosshair' : 'crosshair',
          touchAction: 'none',
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onWheel={handleWheel}
      />

      <div style={{ position: 'absolute', top: 5, right: 10, display: 'flex', gap: 5 }}>
        <button onClick={() => setViewState(prev => ({ ...prev, scaleX: Math.max(0.3, prev.scaleX * 0.8) }))}
          style={btnStyle(config)}>−</button>
        <button onClick={() => setViewState(prev => ({ ...prev, scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 }))}
          style={btnStyle(config)}>Reset</button>
        <button onClick={() => setViewState(prev => ({ ...prev, scaleX: Math.min(15, prev.scaleX * 1.2) }))}
          style={btnStyle(config)}>+</button>
      </div>

      <div style={{ position: 'absolute', bottom: 45, right: 10, display: 'flex', gap: 5 }}>
        <button onClick={() => setViewState(prev => ({ ...prev, offsetX: 0 }))}
          style={btnStyle(config)}>◀ Início</button>
        <button onClick={() => {
          const totalWidth = clusters.length * (clusterWidth + config.clusterGap);
          const maxOffset = Math.max(0, totalWidth - chartWidth);
          setViewState(prev => ({ ...prev, offsetX: -maxOffset }));
        }} style={btnStyle(config)}>Fim ▶</button>
      </div>
    </div>
  );
}

const btnStyle = (config: ChartConfig) => ({
  padding: '4px 10px',
  background: config.bgPanel,
  border: `1px solid ${config.grid}`,
  borderRadius: 4,
  color: config.text,
  cursor: 'pointer',
  fontSize: 11,
} as const);

// ==========================================
// APP PRINCIPAL
// ==========================================

export default function App() {
  const [allTicks, setAllTicks] = useState<Tick[]>([]);
  const [clusters, setClusters] = useState<ClusterData[]>([]);
  const [isLive, setIsLive] = useState(false);
  const [symbol, setSymbol] = useState('BTCUSDT');
  const [threshold, setThreshold] = useState(5000);
  const [priceStep, setPriceStep] = useState(0); // 0 = auto (usar tickSize do ativo)
  const [ticks, setTicks] = useState(0);

  const [wsStatus, setWsStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const [mt5Status, setMt5Status] = useState(false);
  const [engineState, setEngineState] = useState<Record<string, any>>({});
  const [showEnginePanel, setShowEnginePanel] = useState(true);

  const [config, setConfig] = useState<ChartConfig>(DEFAULT_CONFIG);
  const [viewMode, setViewMode] = useState<ViewMode>('hybrid');
  const [drawTool, setDrawTool] = useState<DrawTool>('none');
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [selectedDrawing, setSelectedDrawing] = useState<number | null>(null);
  const [showConfig, setShowConfig] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const preset = SYMBOLS.find(s => s.name === symbol) || SYMBOLS[0];

  const handleConfigChange = (key: keyof ChartConfig, value: any) => {
    setConfig(prev => ({ ...prev, [key]: value }));
  };

  const resetConfig = () => setConfig(DEFAULT_CONFIG);

  const handleAddDrawing = (drawing: Drawing) => {
    setDrawings(prev => [...prev, drawing]);
  };

  const handleUpdateDrawing = (drawing: Drawing) => {
    setDrawings(prev => prev.map(d => d.id === drawing.id ? drawing : d));
  };

  const clearDrawings = () => {
    setDrawings([]);
    setSelectedDrawing(null);
  };

  const deleteSelectedDrawing = () => {
    if (selectedDrawing) {
      setDrawings(prev => prev.filter(d => d.id !== selectedDrawing));
      setSelectedDrawing(null);
    }
  };

  // Calcular o priceStep efetivo (se 0, usar o defaultPriceStep do ativo)
  const effectivePriceStep = priceStep > 0 ? priceStep : (preset.defaultPriceStep || preset.tickSize || 0);
  
  useEffect(() => {
    const newClusters = reprocessClusters(allTicks, threshold, effectivePriceStep);
    setClusters(newClusters);
  }, [threshold, allTicks, effectivePriceStep]);

  const processTick = useCallback((tick: TickData) => {
    const newTick: Tick = {
      price: tick.price,
      volume: Math.round(tick.volume_synthetic || 1),
      side: tick.side,
      timestamp: tick.timestamp,
      // Pass through engine analysis
      is_absorption: tick.is_absorption || false,
      absorption_type: tick.absorption_type,
      absorption_strength: tick.absorption_strength || 0,
      composite_signal: tick.composite_signal || 0,
      stacking_buy: tick.stacking_buy || 0,
      stacking_sell: tick.stacking_sell || 0,
    };
    setAllTicks(prev => [...prev.slice(-10000), newTick]);
    setTicks(t => t + 1);
    // Update engine state for panel display
    if (tick.engines) {
      setEngineState(tick.engines);
    }
  }, []);

  useEffect(() => {
    if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
    if (!isLive) { setWsStatus('disconnected'); return; }

    setWsStatus('connecting');
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => setWsStatus('connected');
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'connected') {
          setMt5Status(msg.data?.mt5_connected || msg.data?.source === 'binance');
        }
        else if (msg.type === 'tick') processTick(msg.data);
        else if (msg.type === 'subscribed') {
          console.log('📨 Subscribed to:', msg.symbol);
        }
        else if (msg.type === 'engines_updated') {
          console.log('⚙️ Engines updated:', msg.engines);
        }
      } catch {}
    };
    ws.onclose = () => { setWsStatus('disconnected'); wsRef.current = null; };

    return () => { if (wsRef.current) { wsRef.current.close(); wsRef.current = null; } };
  }, [isLive, processTick]);

  const loadHistory = async (hours: number) => {
    try {
      const res = await fetch(`${BACKEND_URL}/history/${symbol}?hours=${hours}`);
      const data = await res.json();
      if (data.ticks?.length > 0) {
        const historyTicks: Tick[] = data.ticks.map((t: any) => ({
          price: t.price,
          volume: Math.round(t.volume_synthetic || 1),
          side: t.side,
          timestamp: t.timestamp,
        }));
        setAllTicks(historyTicks);
        setTicks(historyTicks.length);
      }
    } catch {}
  };

  const switchSymbol = async (sym: string) => {
    setSymbol(sym);
    setAllTicks([]);
    setClusters([]);
    setTicks(0);
    setPriceStep(0); // Reset priceStep para AUTO ao trocar de ativo
    const p = SYMBOLS.find(s => s.name === sym);
    if (p) setThreshold(p.deltaThreshold);
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ action: 'switch_symbol', symbol: sym }));
    }
    fetch(`${BACKEND_URL}/switch_symbol/${sym}`, { method: 'POST' }).catch(() => {});
  };

  const reset = () => {
    setAllTicks([]);
    setClusters([]);
    setTicks(0);
  };

  const currentCluster = clusters.find(c => !c.isClosed);
  const current_symbol_label = preset.label;

  return (
    <div style={{ padding: 12, background: config.bg, minHeight: '100vh', color: '#fff', fontFamily: 'monospace' }}>
      {/* Status */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <h1 style={{ color: config.bull, margin: 0, fontSize: 18 }}>📊 Imbalance Chart Pro v5 — Engine Edition</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{
            padding: '3px 8px',
            background: wsStatus === 'connected' ? config.bull + '22' : config.bear + '22',
            border: `1px solid ${wsStatus === 'connected' ? config.bull : config.bear}`,
            borderRadius: 3, fontSize: 10, color: wsStatus === 'connected' ? config.bull : config.bear
          }}>
            {wsStatus === 'connected' ? '🟢 WS' : '🔴 WS'}
          </span>
          <span style={{
            padding: '3px 8px',
            background: mt5Status ? config.bull + '22' : config.highlight + '22',
            border: `1px solid ${mt5Status ? config.bull : config.highlight}`,
            borderRadius: 3, fontSize: 10, color: mt5Status ? config.bull : config.highlight
          }}>
            {mt5Status ? '✅ BINANCE' : '⚠️ SIM'}
          </span>
          <span style={{ color: config.text, fontSize: 10 }}>Ticks: {ticks}</span>
        </div>
      </div>

      {/* Barra de controles */}
      <div style={{
        display: 'flex',
        gap: 8,
        marginBottom: 8,
        alignItems: 'center',
        flexWrap: 'wrap',
        background: config.bgPanel,
        padding: '8px 10px',
        borderRadius: 4,
      }}>
        {SYMBOLS.map(s => (
          <button key={s.name} onClick={() => switchSymbol(s.name)} style={{
            padding: '5px 10px',
            background: symbol === s.name ? config.bull : 'transparent',
            color: symbol === s.name ? '#fff' : config.text,
            border: `1px solid ${symbol === s.name ? config.bull : config.grid}`,
            borderRadius: 3, cursor: 'pointer', fontSize: 10,
          }}>
            {s.label}
          </button>
        ))}

        <div style={{ width: 1, height: 20, background: config.grid, margin: '0 5px' }} />

        {(['clean', 'hybrid', 'raw'] as ViewMode[]).map(mode => (
          <button key={mode} onClick={() => setViewMode(mode)} style={{
            padding: '5px 8px',
            background: viewMode === mode ? config.highlight : 'transparent',
            color: viewMode === mode ? config.bg : config.text,
            border: `1px solid ${viewMode === mode ? config.highlight : config.grid}`,
            borderRadius: 3, cursor: 'pointer', fontSize: 10,
          }}>
            {mode === 'clean' ? '🧹' : mode === 'hybrid' ? '🔀' : '📋'}
          </button>
        ))}

        <div style={{ width: 1, height: 20, background: config.grid, margin: '0 5px' }} />

        <select value={drawTool} onChange={e => setDrawTool(e.target.value as DrawTool)} style={{
          padding: '4px 6px',
          background: config.bgPanel,
          color: config.text,
          border: `1px solid ${config.grid}`,
          borderRadius: 3, fontSize: 10, cursor: 'pointer'
        }}>
          <option value="none">🖱️ Cursor</option>
          <option value="hline">━ H-Line</option>
          <option value="vline">┃ V-Line</option>
          <option value="rect">▢ Rect</option>
          <option value="trend">╱ Trend</option>
        </select>

        {selectedDrawing && (
          <button onClick={deleteSelectedDrawing} style={{
            padding: '4px 8px',
            background: config.bear,
            color: '#fff',
            border: 'none',
            borderRadius: 3, cursor: 'pointer', fontSize: 10,
          }}>
            🗑️ Del
          </button>
        )}

        {drawings.length > 0 && (
          <button onClick={clearDrawings} style={{
            padding: '4px 8px',
            background: config.bgPanel,
            color: config.text,
            border: `1px solid ${config.grid}`,
            borderRadius: 3, cursor: 'pointer', fontSize: 10,
          }}>
            Limpar ({drawings.length})
          </button>
        )}

        <div style={{ width: 1, height: 20, background: config.grid, margin: '0 5px' }} />

        <button onClick={() => setShowConfig(!showConfig)} style={{
          padding: '5px 10px',
          background: showConfig ? config.highlight : 'transparent',
          color: showConfig ? config.bg : config.text,
          border: `1px solid ${showConfig ? config.highlight : config.grid}`,
          borderRadius: 3, cursor: 'pointer', fontSize: 10,
        }}>
          ⚙️ Config
        </button>

        <button onClick={() => setShowEnginePanel(!showEnginePanel)} style={{
          padding: '5px 10px',
          background: showEnginePanel ? '#ff6b35' : 'transparent',
          color: showEnginePanel ? '#fff' : config.text,
          border: `1px solid ${showEnginePanel ? '#ff6b35' : config.grid}`,
          borderRadius: 3, cursor: 'pointer', fontSize: 10,
        }}>
          🔥 Engines
        </button>
      </div>

      {/* Configurações */}
      {showConfig && (
        <div style={{
          background: config.bgPanel,
          borderRadius: 4,
          marginBottom: 8,
          padding: 10,
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 12,
        }}>
          <div>
            <strong style={{ color: config.text, fontSize: 10, marginBottom: 5, display: 'block' }}>🎨 Cores:</strong>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {[
                { key: 'bull', label: 'Compra' },
                { key: 'bear', label: 'Venda' },
                { key: 'highlight', label: 'Destaque' },
                { key: 'poc', label: 'POC' },
              ].map(({ key, label }) => (
                <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                  <span style={{ color: config.text, fontSize: 9 }}>{label}:</span>
                  <input type="color" value={config[key as keyof ChartConfig] as string}
                    onChange={e => handleConfigChange(key as keyof ChartConfig, e.target.value)}
                    style={{ width: 22, height: 16, border: 'none', cursor: 'pointer', borderRadius: 2 }} />
                </div>
              ))}
            </div>
          </div>

          <div>
            <strong style={{ color: config.text, fontSize: 10, marginBottom: 5, display: 'block' }}>👁️ Exibir:</strong>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {[
                { key: 'showPOC', label: 'POC' },
                { key: 'showVolume', label: 'Vol.Body' },
                { key: 'showHistogram', label: 'Histograma' },
                { key: 'showWickWarning', label: 'Aviso Wick' },
              ].map(({ key, label }) => (
                <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 3, cursor: 'pointer' }}>
                  <input type="checkbox" checked={config[key as keyof ChartConfig] as boolean}
                    onChange={e => handleConfigChange(key as keyof ChartConfig, e.target.checked)} />
                  <span style={{ color: config.text, fontSize: 9 }}>{label}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <strong style={{ color: config.text, fontSize: 10, marginBottom: 5, display: 'block' }}>⚠️ Wick Warning:</strong>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <input type="range" min="20" max="80" value={config.wickWarningThreshold}
                onChange={e => handleConfigChange('wickWarningThreshold', Number(e.target.value))}
                style={{ width: 60 }} />
              <span style={{ color: config.highlight, fontSize: 10 }}>{config.wickWarningThreshold}%</span>
            </div>
          </div>

          <div>
            <strong style={{ color: config.text, fontSize: 10, marginBottom: 5, display: 'block' }}>📊 Histograma Interno:</strong>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 5 }}>
              <span style={{ color: config.text, fontSize: 9 }}>Opacidade:</span>
              <input type="range" min="20" max="100" value={config.histogramOpacity}
                onChange={e => handleConfigChange('histogramOpacity', Number(e.target.value))}
                style={{ width: 50 }} />
              <span style={{ color: config.highlight, fontSize: 10 }}>{config.histogramOpacity}%</span>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                <span style={{ color: config.text, fontSize: 9 }}>Bull:</span>
                <input type="color" value={config.histogramBullColor}
                  onChange={e => handleConfigChange('histogramBullColor', e.target.value)}
                  style={{ width: 22, height: 16, border: 'none', cursor: 'pointer', borderRadius: 2 }} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                <span style={{ color: config.text, fontSize: 9 }}>Bear:</span>
                <input type="color" value={config.histogramBearColor}
                  onChange={e => handleConfigChange('histogramBearColor', e.target.value)}
                  style={{ width: 22, height: 16, border: 'none', cursor: 'pointer', borderRadius: 2 }} />
              </div>
            </div>
          </div>

          <div>
            <strong style={{ color: config.text, fontSize: 10, marginBottom: 5, display: 'block' }}>📦 Estilo Cluster:</strong>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 5 }}>
              <span style={{ color: config.text, fontSize: 9 }}>Opacidade:</span>
              <input type="range" min="20" max="100" value={config.clusterOpacity}
                onChange={e => handleConfigChange('clusterOpacity', Number(e.target.value))}
                style={{ width: 50 }} />
              <span style={{ color: config.highlight, fontSize: 10 }}>{config.clusterOpacity}%</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 5 }}>
              <span style={{ color: config.text, fontSize: 9 }}>Largura:</span>
              <input type="range" min="8" max="30" value={config.clusterWidth}
                onChange={e => handleConfigChange('clusterWidth', Number(e.target.value))}
                style={{ width: 50 }} />
              <span style={{ color: config.highlight, fontSize: 10 }}>{config.clusterWidth}px</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ color: config.text, fontSize: 9 }}>Borda:</span>
              <input type="range" min="0" max="4" value={config.clusterBorderWidth}
                onChange={e => handleConfigChange('clusterBorderWidth', Number(e.target.value))}
                style={{ width: 40 }} />
              <input type="color" value={config.clusterBorderColor}
                onChange={e => handleConfigChange('clusterBorderColor', e.target.value)}
                style={{ width: 22, height: 16, border: 'none', cursor: 'pointer', borderRadius: 2 }} />
            </div>
          </div>

          <div>
            <strong style={{ color: config.text, fontSize: 10, marginBottom: 5, display: 'block' }}>🕯️ Pavio e POC:</strong>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 5 }}>
              <span style={{ color: config.text, fontSize: 9 }}>Cor Pavio:</span>
              <input type="color" value={config.wickColor}
                onChange={e => handleConfigChange('wickColor', e.target.value)}
                style={{ width: 22, height: 16, border: 'none', cursor: 'pointer', borderRadius: 2 }} />
              <span style={{ color: config.text, fontSize: 9 }}>Larg:</span>
              <input type="range" min="1" max="4" value={config.wickWidth}
                onChange={e => handleConfigChange('wickWidth', Number(e.target.value))}
                style={{ width: 30 }} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ color: config.text, fontSize: 9 }}>POC Larg:</span>
              <input type="range" min="1" max="6" value={config.pocLineWidth}
                onChange={e => handleConfigChange('pocLineWidth', Number(e.target.value))}
                style={{ width: 40 }} />
              <span style={{ color: config.highlight, fontSize: 10 }}>{config.pocLineWidth}px</span>
            </div>
          </div>

          <div>
            <strong style={{ color: config.text, fontSize: 10, marginBottom: 5, display: 'block' }}>📍 Extras:</strong>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 3, cursor: 'pointer' }}>
                <input type="checkbox" checked={config.showCurrentPrice}
                  onChange={e => handleConfigChange('showCurrentPrice', e.target.checked)} />
                <span style={{ color: config.text, fontSize: 9 }}>Preço Atual</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 3, cursor: 'pointer' }}>
                <input type="checkbox" checked={config.showVolumeLabels}
                  onChange={e => handleConfigChange('showVolumeLabels', e.target.checked)} />
                <span style={{ color: config.text, fontSize: 9 }}>Vol.Labels</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 3, cursor: 'pointer' }}>
                <input type="checkbox" checked={config.showClusterBorder}
                  onChange={e => handleConfigChange('showClusterBorder', e.target.checked)} />
                <span style={{ color: config.text, fontSize: 9 }}>Borda</span>
              </label>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 5 }}>
              <span style={{ color: config.text, fontSize: 9 }}>Cor Preço:</span>
              <input type="color" value={config.currentPriceColor}
                onChange={e => handleConfigChange('currentPriceColor', e.target.value)}
                style={{ width: 22, height: 16, border: 'none', cursor: 'pointer', borderRadius: 2 }} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 5 }}>
              <span style={{ color: config.text, fontSize: 9 }}>Hist. Altura:</span>
              <input type="range" min="60" max="250" value={config.histogramHeight}
                onChange={e => handleConfigChange('histogramHeight', Number(e.target.value))}
                style={{ width: 50 }} />
              <span style={{ color: config.highlight, fontSize: 10 }}>{config.histogramHeight}px</span>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <button onClick={resetConfig} style={{
              padding: '6px 12px',
              background: config.grid,
              color: config.text,
              border: 'none',
              borderRadius: 3, cursor: 'pointer', fontSize: 10,
            }}>
              🔄 Restaurar Padrão
            </button>
          </div>
        </div>
      )}

      {/* Engine Status Panel */}
      {showEnginePanel && (
        <div style={{
          background: config.bgPanel,
          borderRadius: 4,
          marginBottom: 8,
          padding: 10,
          border: `1px solid #ff6b3533`,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ color: '#ff6b35', fontSize: 11, fontWeight: 'bold' }}>🔥 Engine Analysis (Real-time)</span>
            <span style={{ color: config.text, fontSize: 9 }}>
              Fonte: Binance {current_symbol_label}
            </span>
          </div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 8,
          }}>
            {/* Tick Velocity */}
            <div style={{ background: config.bg, padding: 8, borderRadius: 4 }}>
              <div style={{ color: '#ffd740', fontSize: 9, marginBottom: 4 }}>⚡ Tick Velocity</div>
              <div style={{ display: 'flex', gap: 10, fontSize: 10 }}>
                <span style={{ color: config.textStrong }}>
                  {engineState?.tick_velocity?.velocity?.toFixed(1) || '--'} t/s
                </span>
                <span style={{ color: config.text }}>
                  base: {engineState?.tick_velocity?.baseline?.toFixed(1) || '--'}
                </span>
                {engineState?.tick_velocity?.is_burst && (
                  <span style={{ color: '#ff6b35', fontWeight: 'bold' }}>🔥 BURST</span>
                )}
              </div>
            </div>

            {/* Micro Cluster / Absorption */}
            <div style={{ background: config.bg, padding: 8, borderRadius: 4 }}>
              <div style={{ color: '#ffd740', fontSize: 9, marginBottom: 4 }}>🧩 Micro Absorção</div>
              <div style={{ display: 'flex', gap: 10, fontSize: 10 }}>
                <span style={{
                  color: engineState?.micro_cluster?.is_absorption 
                    ? (engineState?.micro_cluster?.absorption_type === 'buy_absorption' ? '#00e676' : '#ff5252')
                    : config.text
                }}>
                  {engineState?.micro_cluster?.is_absorption
                    ? `${engineState?.micro_cluster?.absorption_type === 'buy_absorption' ? '🟢 BUY' : '🔴 SELL'} ABS`
                    : 'Sem absorção'}
                </span>
                <span style={{ color: config.text }}>
                  Total: {engineState?.micro_cluster?.total_absorptions || 0}
                </span>
              </div>
            </div>

            {/* ATR */}
            <div style={{ background: config.bg, padding: 8, borderRadius: 4 }}>
              <div style={{ color: '#ffd740', fontSize: 9, marginBottom: 4 }}>📊 ATR (5s)</div>
              <div style={{ display: 'flex', gap: 10, fontSize: 10 }}>
                <span style={{ color: config.textStrong }}>
                  {engineState?.atr_normalize?.atr ? (engineState.atr_normalize.atr * 100).toFixed(4) : '--'}
                </span>
                <span style={{
                  color: engineState?.atr_normalize?.regime === 'expanding' ? '#ff5252' :
                         engineState?.atr_normalize?.regime === 'contracting' ? '#00e676' : config.text
                }}>
                  {engineState?.atr_normalize?.regime || 'warmup'}
                </span>
              </div>
            </div>

            {/* Imbalance Detector */}
            <div style={{ background: config.bg, padding: 8, borderRadius: 4 }}>
              <div style={{ color: '#ffd740', fontSize: 9, marginBottom: 4 }}>🔥 Imbalance Stacking</div>
              <div style={{ display: 'flex', gap: 10, fontSize: 10 }}>
                <span style={{ color: '#00e676' }}>
                  Buy: S{engineState?.imbalance_detector?.stacking_buy || 0}
                </span>
                <span style={{ color: '#ff5252' }}>
                  Sell: S{engineState?.imbalance_detector?.stacking_sell || 0}
                </span>
                {engineState?.imbalance_detector?.dominant_direction && (
                  <span style={{
                    color: engineState.imbalance_detector.dominant_direction === 'buy' ? '#00e676' : '#ff5252',
                    fontWeight: 'bold',
                  }}>
                    → {engineState.imbalance_detector.dominant_direction.toUpperCase()}
                  </span>
                )}
              </div>
            </div>

            {/* Composite Signal */}
            <div style={{ background: config.bg, padding: 8, borderRadius: 4 }}>
              <div style={{ color: '#ffd740', fontSize: 9, marginBottom: 4 }}>📡 Sinal Composto</div>
              <div style={{ fontSize: 14, fontWeight: 'bold', color:
                (engineState?.micro_cluster?.signal || 0) > 0.2 ? '#00e676' :
                (engineState?.micro_cluster?.signal || 0) < -0.2 ? '#ff5252' : config.text
              }}>
                {((engineState?.micro_cluster?.signal || 0) * 100).toFixed(0)}%
                <span style={{ fontSize: 9, color: config.text, marginLeft: 5 }}>
                  ({(engineState?.micro_cluster?.signal || 0) > 0 ? 'bullish' :
                    (engineState?.micro_cluster?.signal || 0) < 0 ? 'bearish' : 'neutro'})
                </span>
              </div>
            </div>

            {/* Spread/Volatility */}
            <div style={{ background: config.bg, padding: 8, borderRadius: 4 }}>
              <div style={{ color: '#ffd740', fontSize: 9, marginBottom: 4 }}>📉 Volatilidade</div>
              <div style={{ display: 'flex', gap: 10, fontSize: 10 }}>
                <span style={{ color: config.textStrong }}>
                  {engineState?.spread_weight?.volatility?.toFixed(2) || '--'} bps
                </span>
                <span style={{
                  color: engineState?.spread_weight?.regime === 'high' ? '#ff5252' :
                         engineState?.spread_weight?.regime === 'low' ? '#00e676' : config.text
                }}>
                  {engineState?.spread_weight?.regime || '--'}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Feed controls */}
      <div style={{
        display: 'flex',
        gap: 10,
        marginBottom: 8,
        alignItems: 'center',
        flexWrap: 'wrap',
        background: config.bgPanel,
        padding: '6px 10px',
        borderRadius: 4,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ color: config.text, fontSize: 10 }}>Δ:</span>
          <input type="range" min="10" max="50000" value={threshold}
            onChange={e => setThreshold(Number(e.target.value))}
            style={{ width: 100, accentColor: config.bull }} />
          <span style={{ color: config.bull, fontSize: 12, fontWeight: 'bold', width: 40 }}>{threshold}</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ color: config.text, fontSize: 10 }}>Step:</span>
          <input type="range" min="0" max="300" step="1" value={priceStep === 0 ? 0 : Math.round(priceStep / preset.tickSize)}
            onChange={e => {
              const val = Number(e.target.value);
              if (val === 0) setPriceStep(0);
              else setPriceStep(val * preset.tickSize);
            }}
            style={{ width: 80, accentColor: config.highlight }} />
          <span style={{ color: config.highlight, fontSize: 10, width: 60 }}>
            {priceStep === 0 ? 'AUTO' : (priceStep).toFixed(preset.digits)}
          </span>
        </div>

        <span style={{ color: config.text, fontSize: 10 }}>Hist:</span>
        {[1, 2, 4].map(h => (
          <button key={h} onClick={() => loadHistory(h)} disabled={!mt5Status} style={{
            padding: '4px 10px',
            background: mt5Status ? 'transparent' : config.bg,
            color: mt5Status ? '#fff' : '#444',
            border: `1px solid ${config.grid}`,
            borderRadius: 3, cursor: mt5Status ? 'pointer' : 'not-allowed', fontSize: 10
          }}>
            {h}h
          </button>
        ))}

        <button onClick={() => setIsLive(!isLive)} style={{
          padding: '5px 16px',
          background: isLive ? config.bear : config.bull,
          color: '#fff', border: 'none', borderRadius: 3,
          cursor: 'pointer', fontWeight: 'bold', fontSize: 11
        }}>
          {isLive ? '⏹ PARAR' : '▶ LIVE'}
        </button>

        <button onClick={reset} style={{
          padding: '5px 12px',
          background: 'transparent', color: config.text,
          border: `1px solid ${config.grid}`, borderRadius: 3,
          cursor: 'pointer', fontSize: 10
        }}>
          ↺ Reset
        </button>
      </div>

      {/* Status atual */}
      {currentCluster && (
        <div style={{
          marginBottom: 8, padding: '6px 10px',
          background: config.bgPanel, borderRadius: 4,
          display: 'flex', gap: 15, alignItems: 'center', fontSize: 11,
          flexWrap: 'wrap',
        }}>
          <span style={{ color: config.highlight }}>🔄 Formando #{currentCluster.id}</span>
          <span>Δ: <strong style={{ color: currentCluster.delta >= 0 ? config.bull : config.bear }}>
            {currentCluster.delta >= 0 ? '+' : ''}{currentCluster.delta}
          </strong></span>
          <span style={{ color: config.text, fontSize: 10 }}>
            Body: {((currentCluster.volumeBody / currentCluster.volumeTotal) * 100).toFixed(0)}% | Wick: {currentCluster.wickPercent.toFixed(0)}%
          </span>
          {currentCluster.absorptionCount > 0 && (
            <span style={{ color: '#ff6b35', fontSize: 10, fontWeight: 'bold' }}>
              🧩 {currentCluster.absorptionCount} abs
              ({currentCluster.absorptionBuyCount}B / {currentCluster.absorptionSellCount}S)
            </span>
          )}
          {(currentCluster.maxStackingBuy >= 2 || currentCluster.maxStackingSell >= 2) && (
            <span style={{
              color: currentCluster.maxStackingBuy > currentCluster.maxStackingSell ? '#00e676' : '#ff5252',
              fontSize: 10, fontWeight: 'bold'
            }}>
              🔥 Stack B{currentCluster.maxStackingBuy}/S{currentCluster.maxStackingSell}
            </span>
          )}
          <div style={{ flex: 1, background: config.grid, borderRadius: 2, height: 5, maxWidth: 100 }}>
            <div style={{
              background: currentCluster.delta >= 0 ? config.bull : config.bear,
              height: '100%',
              width: `${Math.min(100, (Math.abs(currentCluster.delta) / threshold) * 100)}%`,
              borderRadius: 2,
            }} />
          </div>
        </div>
      )}

      {/* Gráfico */}
      <ProfessionalChart
        clusters={clusters}
        symbol={symbol}
        threshold={threshold}
        priceStep={effectivePriceStep}
        config={config}
        viewMode={viewMode}
        drawTool={drawTool}
        drawings={drawings}
        onAddDrawing={handleAddDrawing}
        onUpdateDrawing={handleUpdateDrawing}
        selectedDrawing={selectedDrawing}
        onSelectDrawing={setSelectedDrawing}
      />
    </div>
  );
}
