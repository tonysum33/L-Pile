import React, { useState, useMemo, useRef } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceDot, ReferenceLine, ReferenceArea } from 'recharts';
import { Calculator, Printer, Info, Settings2, Download, RefreshCcw, ZoomIn, FileSpreadsheet, PanelLeftOpen, PanelLeftClose, ChevronLeft, ChevronRight } from 'lucide-react';
import { toPng } from 'html-to-image';
import { jsPDF } from 'jspdf';

const F1 = (z: number) => Math.exp(-z) * (Math.cos(z) + Math.sin(z));
const F2 = (z: number) => Math.exp(-z) * Math.sin(z);
const F3 = (z: number) => Math.exp(-z) * (Math.cos(z) - Math.sin(z));
const F4 = (z: number) => Math.exp(-z) * Math.cos(z);

function calculatePile(L: number, D: number, E_t_m2: number, I: number, ks: number, H: number, M: number, h: number, isFixed: boolean, fy: number, loadFactor: number, fc: number) {
  const E = E_t_m2; // T/m^2
  const EI = E * I;

  // Guard against invalid inputs that would cause NaN
  if (EI <= 0 || ks <= 0 || D <= 0) {
    return {
      beta: 0,
      betaL: 0,
      isLongPile: false,
      ymax: 0,
      ymaxDepth: 0,
      maxM: 0,
      maxMDepth: 0,
      maxV: 0,
      maxVDepth: 0,
      data: [],
      criticalSections: [],
      reinforcementTable: [],
      As_min: 0,
      Ag: 0,
      Ag_m2: 0
    };
  }

  const beta = Math.pow((ks * D) / (4 * EI), 0.25);
  const betaL = beta * L;
  const isLongPile = betaL > 2.5;

  let H0 = H;
  let M0 = 0;

  if (isFixed) {
    // 樁頭固定且考慮地上高度 h 時，地表處的等效彎矩
    M0 = (H / 2) * (h - 1 / beta);
  } else {
    // 樁頭自由，地表處的等效彎矩 = 樁頭彎矩 + 水平力產生的力矩
    M0 = M + H * h;
  }

  const data = [];

  // 1. 地上部分 (Above ground: from x = -h to x = 0)
  if (h > 0) {
    const numPointsAbove = Math.max(20, Math.ceil(h / 0.05));
    const dz = h / numPointsAbove;

    // 地表處的變位與轉角
    const y0 = (H0 / (2 * EI * Math.pow(beta, 3))) + (M0 / (2 * EI * Math.pow(beta, 2)));
    const theta0 = -(H0 / (2 * EI * Math.pow(beta, 2))) - (M0 / (EI * beta));

    for (let i = numPointsAbove; i > 0; i--) {
      const z_up = i * dz; // 距離地表的高度
      const x = -z_up;     // 深度為負值

      const y = y0 - theta0 * z_up + (M0 * Math.pow(z_up, 2)) / (2 * EI) - (H0 * Math.pow(z_up, 3)) / (6 * EI);
      const m_val = M0 - H0 * z_up;
      const v_val = H0;

      data.push({
        depth: Number((x + h).toFixed(2)),
        y: y * 1000, // mm
        m: m_val,
        v: v_val
      });
    }
  }

  // 2. 地下部分 (Embedded part: from x = 0 to x = L)
  const numPoints = 500; // 提高解析度以準確抓取最大值
  const dx = L / numPoints;

  for (let i = 0; i <= numPoints; i++) {
    const x = i * dx;
    const z = beta * x;

    const y = (H0 / (2 * EI * Math.pow(beta, 3))) * F4(z) + (M0 / (2 * EI * Math.pow(beta, 2))) * F3(z);
    const m_val = (H0 / beta) * F2(z) + M0 * F1(z);
    const v_val = H0 * F3(z) - 2 * M0 * beta * F2(z);

    data.push({
      depth: Number((x + h).toFixed(2)),
      y: y * 1000, // mm
      m: m_val,
      v: v_val
    });
  }

  // 尋找最大值
  let ymax = 0;
  let ymaxDepth = 0;
  let maxM = 0;
  let maxMDepth = 0;
  let maxV = 0;
  let maxVDepth = 0;

  data.forEach(pt => {
    if (Math.abs(pt.y) > Math.abs(ymax)) {
      ymax = Math.abs(pt.y);
      ymaxDepth = pt.depth;
    }
    if (Math.abs(pt.m) > Math.abs(maxM)) {
      maxM = pt.m;
      maxMDepth = pt.depth;
    }
    if (Math.abs(pt.v) > Math.abs(maxV)) {
      maxV = pt.v;
      maxVDepth = pt.depth;
    }
  });

  // 配筋計算 (Reinforcement Calculation)
  const Ag = (Math.PI * Math.pow(D * 100, 2)) / 4; // cm^2
  const As_min = 0.005 * Ag; // 0.5% 最小配筋率

  // 剪力強度計算 (Shear Capacity Calculation - ACI 318 simplified for circular)
  // Vc = 0.53 * sqrt(fc') * bw * d, where bw = D, d = 0.8D
  const phi_v = 0.75;
  const Vc_kgf = 0.53 * Math.sqrt(fc) * (D * 100) * (0.8 * D * 100);
  const Vc = (phi_v * Vc_kgf) / 1000; // Tonnes

  const calculateAs = (moment: number) => {
    const Mu = Math.abs(moment) * loadFactor; // T-m
    const Mu_kgf_cm = Mu * 1000 * 100;
    // 簡化公式: As = Mu / (0.9 * fy * 0.7 * D)
    const d_cm = D * 100 * 0.7; // 針對圓形斷面，jd 通常取約 0.7D (較矩形斷面 0.8D 保守)
    const As_req = Mu_kgf_cm / (0.9 * fy * d_cm);
    return Math.max(As_req, As_min);
  };

  const rebarData = data.map(pt => ({
    ...pt,
    As: calculateAs(pt.m)
  }));

  // 關鍵斷面
  const criticalSections = [
    { name: '樁頭', depth: data[0].depth, m: data[0].m, v: data[0].v, As: calculateAs(data[0].m), Vc: Vc },
    { name: '最大彎矩處', depth: maxMDepth, m: maxM, v: data.find(d => d.depth === maxMDepth)?.v || 0, As: calculateAs(maxM), Vc: Vc },
    { name: '最大剪力處', depth: maxVDepth, m: data.find(d => d.depth === maxVDepth)?.m || 0, v: maxV, As: calculateAs(data.find(d => d.depth === maxVDepth)?.m || 0), Vc: Vc }
  ];

  // 去除重複深度的關鍵斷面
  const uniqueCriticalSections = criticalSections.filter((v, i, a) => a.findIndex(t => (t.depth === v.depth)) === i);

  // 不同深度的配筋建議 (每 1m 或 2m 取一點，並包含關鍵斷面)
  const depthInterval = L > 20 ? 2 : 1;
  const tableDepths: number[] = [];
  for (let d = 0; d <= L; d += depthInterval) tableDepths.push(d);

  // 加入關鍵斷面深度
  uniqueCriticalSections.forEach(cs => {
    if (!tableDepths.some(d => Math.abs(d - cs.depth) < 0.01)) {
      tableDepths.push(cs.depth);
    }
  });
  tableDepths.sort((a, b) => a - b);

  const reinforcementTable = tableDepths.map(d => {
    const closestPt = rebarData.reduce((prev, curr) =>
      Math.abs(curr.depth - d) < Math.abs(prev.depth - d) ? curr : prev
    );
    const crit = uniqueCriticalSections.find(cs => Math.abs(cs.depth - d) < 0.01);
    return {
      depth: d,
      m: closestPt.m,
      v: closestPt.v,
      As: closestPt.As,
      Vc: Vc,
      isCritical: !!crit,
      name: crit ? crit.name : ''
    };
  });

  const Ag_m2 = (Math.PI * Math.pow(D, 2)) / 4;

  return {
    beta,
    betaL,
    isLongPile,
    ymax,
    ymaxDepth,
    maxM,
    maxMDepth,
    maxV,
    maxVDepth,
    data: rebarData,
    criticalSections: uniqueCriticalSections,
    reinforcementTable,
    As_min,
    Ag,
    Ag_m2,
    Vc
  };
}

export default function App() {
  const [L, setL] = useState<number>(15);
  const [D, setD] = useState<number>(1.0);
  const [fc, setFc] = useState<number>(280);  // 混凝土強度 (kgf/cm²)
  const [E, setE] = useState<number>(2509980);  // 彈性模數 (T/m²)
  const [I, setI] = useState<number>(0.0491);
  const [ks, setKs] = useState<number>(2000); // T/m³
  const [soilType, setSoilType] = useState<'cohesive' | 'granular'>('cohesive');
  const [nValue, setNValue] = useState<number>(10);
  const [isManualSoil, setIsManualSoil] = useState<boolean>(true);
  const [isManualPile, setIsManualPile] = useState<boolean>(false);
  const [h, setH_height] = useState<number>(0); // 樁頂高出地表 (m)
  const [H, setH] = useState<number>(10);     // T
  const [M, setM] = useState<number>(5);      // T-m
  const [fy, setFy] = useState<number>(4200); // 鋼筋降伏強度 (kgf/cm²)
  const [loadFactor, setLoadFactor] = useState<number>(1.5); // 載重因數
  const [isFixed, setIsFixed] = useState<boolean>(false);
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [isPdfMode, setIsPdfMode] = useState<boolean>(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(true);

  // Zoom state
  const [zoomDomain, setZoomDomain] = useState<[number, number] | null>(null);
  const [refAreaTop, setRefAreaTop] = useState<number | null>(null);
  const [refAreaBottom, setRefAreaBottom] = useState<number | null>(null);

  const handleZoom = () => {
    if (refAreaTop === refAreaBottom || refAreaBottom === null || refAreaTop === null) {
      setRefAreaTop(null);
      setRefAreaBottom(null);
      return;
    }

    // Ensure we always have [min, max] for the domain
    const [min, max] = [Number(refAreaTop), Number(refAreaBottom)].sort((a, b) => a - b);
    setZoomDomain([min, max]);
    setRefAreaTop(null);
    setRefAreaBottom(null);
  };

  const resetZoom = () => {
    setZoomDomain(null);
  };

  const ReferenceAreaAny = ReferenceArea as any;

  // Auto-calculate E when fc changes
  React.useEffect(() => {
    if (!isManualPile) {
      // 15000 * sqrt(fc') 得到 kgf/cm²，再乘 10 轉為 T/m²
      const calculatedE = 150000 * Math.sqrt(fc);
      setE(Number(calculatedE.toFixed(0)));
    }
  }, [fc, isManualPile]);

  // Auto-calculate I when D changes
  React.useEffect(() => {
    if (!isManualPile) {
      const calculatedI = (Math.PI * Math.pow(D, 4)) / 64;
      setI(Number(calculatedI.toFixed(4)));
    }
  }, [D, isManualPile]);

  // Auto-calculate ks from N-value
  React.useEffect(() => {
    if (!isManualSoil) {
      // 參考日本道路協會 (JRA) 或台灣規範簡化公式
      // ks = 0.8 * E0 * D^(-3/4), E0 = 2800 * N (kN/m2) = 280 * N (T/m2)
      // 這裡使用簡化估計: ks = 224 * nValue * D^(-0.75) (T/m3)
      const calculatedKs = 224 * nValue * Math.pow(D, -0.75);
      setKs(Number(calculatedKs.toFixed(0)));
    }
  }, [nValue, D, isManualSoil]);

  const reportRef = useRef<HTMLDivElement>(null);
  const pdfPage1Ref = useRef<HTMLDivElement>(null);
  const pdfPage2Ref = useRef<HTMLDivElement>(null);

  const results = useMemo(() => calculatePile(L, D, E, I, ks, H, M, h, isFixed, fy, loadFactor, fc), [L, D, E, I, ks, H, M, h, isFixed, fy, loadFactor, fc]);

  const handleExportPDF = async () => {
    setIsExporting(true);
    setIsPdfMode(true);

    // Wait for React to render the PDF mode layout
    setTimeout(async () => {
      try {
        const page1Element = pdfPage1Ref.current;
        const page2Element = pdfPage2Ref.current;
        if (!page1Element || !page2Element) return;

        const capturePage = async (element: HTMLDivElement) => {
          const exportWidth = element.scrollWidth;
          const exportHeight = element.scrollHeight;
          return toPng(element, {
            quality: 0.95,
            backgroundColor: '#ffffff',
            pixelRatio: 2,
            width: exportWidth,
            height: exportHeight,
            style: {
              width: `${exportWidth}px`,
              height: `${exportHeight}px`,
              margin: '0',
              overflow: 'hidden',
              boxSizing: 'border-box',
            }
          });
        };

        const [page1DataUrl, page2DataUrl] = await Promise.all([
          capturePage(page1Element),
          capturePage(page2Element)
        ]);

        const pdf = new jsPDF('p', 'mm', 'a4');
        const pageWidth = pdf.internal.pageSize.getWidth();   // 210mm
        const pageHeight = pdf.internal.pageSize.getHeight(); // 297mm
        const margin = 10; // 10mm margin each side
        const pdfContentWidth = pageWidth - 2 * margin;       // 190mm
        const pdfContentHeight = pageHeight - 2 * margin;     // 277mm

        const loadImage = async (src: string) => {
          const img = new Image();
          img.src = src;
          await new Promise(resolve => {
            img.onload = resolve;
          });
          return img;
        };

        const drawPageNumber = (pageNumber: number) => {
          pdf.setFillColor(255, 255, 255);
          pdf.rect(0, pageHeight - margin, pageWidth, margin, 'F');
          pdf.setFontSize(9);
          pdf.setTextColor(120);
          pdf.text(`第 ${pageNumber} 頁 / 共 2 頁`, pageWidth / 2, pageHeight - 3, { align: 'center' });
        };

        const addPageImage = async (dataUrl: string, pageNumber: number) => {
          const img = await loadImage(dataUrl);
          const scale = Math.min(pdfContentWidth / img.width, pdfContentHeight / img.height);
          const renderWidth = img.width * scale;
          const renderHeight = img.height * scale;
          const x = margin + (pdfContentWidth - renderWidth) / 2;
          const y = margin;
          pdf.addImage(dataUrl, 'PNG', x, y, renderWidth, renderHeight);
          drawPageNumber(pageNumber);
        };

        await addPageImage(page1DataUrl, 1);
        pdf.addPage();
        await addPageImage(page2DataUrl, 2);

        pdf.save('基樁側向承載力分析報告.pdf');
      } catch (error) {
        console.error("PDF Export failed", error);
        alert("匯出 PDF 失敗，請稍後再試。");
      } finally {
        setIsPdfMode(false);
        setIsExporting(false);
      }
    }, 500); // Give Recharts time to adjust layout
  };

  const handleExportCSV = () => {
    const headers = ['Depth', 'Deflection y', 'Moment Mu', 'Required As', 'Shear Vu', 'Capacity phiVc', 'D/C Ratio', 'Note'];

    // Combine critical sections and reinforcement table
    const csvRows = [];

    // Add Critical Sections
    results.criticalSections.forEach(sec => {
      const Vu = Math.abs(sec.v) * loadFactor;
      const ratio = Vu / sec.Vc;
      csvRows.push([
        sec.depth.toFixed(2),
        (results.data.find(d => Math.abs(d.depth - sec.depth) < 0.01)?.y ?? 0).toFixed(2),
        Math.abs(sec.m * loadFactor).toFixed(2),
        sec.As.toFixed(2),
        Vu.toFixed(2),
        sec.Vc.toFixed(2),
        ratio.toFixed(2),
        `Critical: ${sec.name}`
      ]);
    });

    // Add a separator row
    csvRows.push(['---', '---', '---', '---', '---', '---', '---', '---']);

    // Add Full Profile
    results.reinforcementTable.forEach(pt => {
      const Vu = Math.abs(pt.v) * loadFactor;
      const ratio = Vu / pt.Vc;
      csvRows.push([
        pt.depth.toFixed(2),
        pt.y.toFixed(2),
        Math.abs(pt.m * loadFactor).toFixed(2),
        pt.As.toFixed(2),
        Vu.toFixed(2),
        pt.Vc.toFixed(2),
        ratio.toFixed(2),
        'Full Profile'
      ]);
    });

    const csvContent = [
      headers.join(','),
      ...csvRows.map(row => row.join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', '基樁側向分析數據.csv');
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white p-3 border border-slate-200 shadow-lg rounded-md text-sm z-50">
          <p className="font-semibold text-slate-700 mb-1">深度: {label.toFixed(2)} m</p>
          {payload.map((p: any, idx: number) => (
            <p key={idx} style={{ color: p.color }}>
              {p.name}: {p.value.toFixed(2)} {p.unit}
            </p>
          ))}
        </div>
      );
    }
    return null;
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans">
      {/* Header */}
      {!isPdfMode && (
        <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
          <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <button
                onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                className="no-print p-2 hover:bg-slate-100 rounded-lg text-slate-500 transition-colors"
                title={isSidebarOpen ? "隱藏參數" : "顯示參數"}
              >
                {isSidebarOpen ? <PanelLeftClose className="w-5 h-5" /> : <PanelLeftOpen className="w-5 h-5" />}
              </button>
              <div className="bg-blue-600 p-2 rounded-lg">
                <Calculator className="w-5 h-5 text-white" />
              </div>
              <h1 className="text-xl font-bold text-slate-900">基樁側向承載力分析v1</h1>
            </div>
            <div className="flex items-center space-x-2">
              <button
                onClick={handleExportCSV}
                className="no-print flex items-center space-x-2 bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2 rounded-md transition-colors font-medium text-sm"
              >
                <FileSpreadsheet className="w-4 h-4" />
                <span>匯出 CSV</span>
              </button>
              <button
                onClick={handleExportPDF}
                disabled={isExporting}
                className="no-print flex items-center space-x-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md transition-colors font-medium text-sm disabled:opacity-50"
              >
                {isExporting ? (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Download className="w-4 h-4" />
                )}
                <span>{isExporting ? '匯出中...' : '匯出 PDF 報表'}</span>
              </button>
            </div>
          </div>
        </header>
      )}

      <main className="max-w-[1800px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex flex-col lg:flex-row gap-8">

          {/* Sidebar - Inputs & Summary (輸出參數) */}
          {!isPdfMode && (
            <div className={`transition-all duration-300 ease-in-out overflow-hidden no-print flex-shrink-0 ${isSidebarOpen ? 'w-full lg:w-72 opacity-100' : 'w-0 opacity-0'}`}>
              <div className="space-y-6 w-72">
                {/* Pile Parameters */}
                <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center">
                      <Settings2 className="w-4 h-4 mr-2 text-blue-500" />
                      輸入：樁身參數
                    </h2>
                    <label className="flex items-center cursor-pointer">
                      <span className="text-[10px] text-slate-400 mr-2">手動</span>
                      <input
                        type="checkbox"
                        checked={isManualPile}
                        onChange={e => setIsManualPile(e.target.checked)}
                        className="w-3 h-3 text-blue-600 rounded focus:ring-blue-500"
                      />
                    </label>
                  </div>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-[10px] font-medium text-slate-500 mb-1">樁長 L (m)</label>
                      <input type="number" value={L} onChange={e => setL(Number(e.target.value))} className="w-full px-3 py-1.5 border border-slate-300 rounded-md text-xs outline-none focus:ring-1 focus:ring-blue-500" />
                    </div>
                    <div>
                      <label className="block text-[10px] font-medium text-slate-500 mb-1">樁徑 D (m)</label>
                      <input type="number" step="0.1" value={D} onChange={e => setD(Number(e.target.value))} className="w-full px-3 py-1.5 border border-slate-300 rounded-md text-xs outline-none focus:ring-1 focus:ring-blue-500" />
                    </div>
                    <div>
                      <label className="block text-[10px] font-medium text-slate-500 mb-1">樁頂高出地表 h (m)</label>
                      <input type="number" step="0.1" value={h} onChange={e => setH_height(Number(e.target.value))} className="w-full px-3 py-1.5 border border-slate-300 rounded-md text-xs outline-none focus:ring-1 focus:ring-blue-500" />
                    </div>
                    <div>
                      <label className="block text-[10px] font-medium text-slate-500 mb-1">慣性矩 I (m⁴)</label>
                      {isManualPile ? (
                        <input type="number" step="0.0001" value={I} onChange={e => setI(Number(e.target.value))} className="w-full px-3 py-1.5 border border-slate-300 rounded-md text-xs outline-none focus:ring-1 focus:ring-blue-500" />
                      ) : (
                        <div className="w-full px-3 py-1.5 border border-slate-200 bg-slate-50 rounded-md text-xs text-slate-500 cursor-not-allowed">
                          {I}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

              {/* Material Parameters */}
              <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider mb-4 flex items-center">
                  <RefreshCcw className="w-4 h-4 mr-2 text-indigo-600" />
                  材料參數
                </h2>
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">混凝土強度 fc' (kgf/cm²)</label>
                    <input type="number" value={fc} onChange={e => setFc(Number(e.target.value))} className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">鋼筋降伏強度 fy (kgf/cm²)</label>
                    <input type="number" value={fy} onChange={e => setFy(Number(e.target.value))} className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">彈性模數 E (T/m²)</label>
                    {isManualPile ? (
                      <input type="number" value={E} onChange={e => setE(Number(e.target.value))} className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all" />
                    ) : (
                      <div className="w-full px-3 py-2 border border-slate-200 bg-slate-50 rounded-md text-sm text-slate-500 cursor-not-allowed">
                        {E.toLocaleString()}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Soil Parameters */}
              <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider flex items-center">
                    <Settings2 className="w-4 h-4 mr-2 text-amber-600" />
                    土壤參數
                  </h2>
                  <label className="flex items-center cursor-pointer">
                    <span className="text-[10px] text-slate-400 mr-2">手動輸入</span>
                    <input
                      type="checkbox"
                      checked={isManualSoil}
                      onChange={e => setIsManualSoil(e.target.checked)}
                      className="w-3 h-3 text-amber-600 rounded focus:ring-amber-500"
                    />
                  </label>
                </div>
                <div className="space-y-4">
                  {!isManualSoil && (
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">平均 N 值</label>
                      <input
                        type="number"
                        value={nValue}
                        onChange={e => setNValue(Number(e.target.value))}
                        className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none transition-all"
                      />
                      <p className="text-[10px] text-slate-400 mt-1">依 JRA 公式自動估算 k_s</p>
                    </div>
                  )}
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">地盤反應係數 k_s (T/m³)</label>
                    <input
                      type="number"
                      value={ks}
                      onChange={e => setKs(Number(e.target.value))}
                      disabled={!isManualSoil}
                      className={`w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none transition-all ${!isManualSoil ? 'bg-slate-50 text-slate-500 cursor-not-allowed' : ''}`}
                    />
                    <p className="text-[10px] text-slate-400 mt-1">註: 常數假設，適用於凝聚性土壤或簡化分析</p>
                  </div>
                </div>
              </div>

              <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider mb-4 flex items-center">
                  <Settings2 className="w-4 h-4 mr-2 text-emerald-600" />
                  載重與邊界
                </h2>
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-2">樁頭條件</label>
                    <div className="flex bg-slate-100 p-1 rounded-lg">
                      <button
                        onClick={() => setIsFixed(false)}
                        className={`flex-1 text-sm py-1.5 rounded-md font-medium transition-all ${!isFixed ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}
                      >
                        樁頭自由
                      </button>
                      <button
                        onClick={() => setIsFixed(true)}
                        className={`flex-1 text-sm py-1.5 rounded-md font-medium transition-all ${isFixed ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}
                      >
                        樁頭固定
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">水平力 H (T)</label>
                    <input type="number" value={H} onChange={e => setH(Number(e.target.value))} className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all" />
                  </div>
                  {!isFixed && (
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">外加力矩 M (T-m)</label>
                      <input type="number" value={M} onChange={e => setM(Number(e.target.value))} className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all" />
                    </div>
                  )}
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">載重因數</label>
                    <input type="number" step="0.1" value={loadFactor} onChange={e => setLoadFactor(Number(e.target.value))} className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

          {/* Main Content - Results & Charts (Wrapped for PDF Export) */}
          <div
            className={`${isPdfMode ? 'w-[794px] bg-white p-8 overflow-hidden' : 'flex-1 min-w-0'} space-y-8`}
            ref={reportRef}
          >

            <div ref={isPdfMode ? pdfPage1Ref : undefined} className={isPdfMode ? 'space-y-8' : ''}>
            {/* PDF Report Header (Only visible in PDF) */}
            {isPdfMode && (
              <div className="mb-8 font-serif" style={{ fontFamily: '"Times New Roman", PMingLiU, serif' }}>
                <div className="border-4 border-gray-900 p-8 mb-8">
                  <div className="text-center mb-10 border-b-2 border-gray-900 pb-6">
                    <h1 className="text-4xl font-bold text-gray-900 mb-3 tracking-widest">結構計算書</h1>
                    <h2 className="text-2xl font-bold text-gray-800 mb-2">基樁側向承載力分析 (Chang's Formula)</h2>
                    <p className="text-base text-gray-600">Pile Lateral Bearing Capacity Analysis Report</p>
                  </div>

                  <table className="w-full text-base mb-6 border-collapse border border-gray-900">
                    <tbody>
                      <tr>
                        <td className="border border-gray-900 p-3 font-bold bg-gray-100 w-1/4">專案名稱</td>
                        <td className="border border-gray-900 p-3 w-1/4">基樁工程分析</td>
                        <td className="border border-gray-900 p-3 font-bold bg-gray-100 w-1/4">日期</td>
                        <td className="border border-gray-900 p-3 w-1/4">{new Date().toLocaleDateString('zh-TW')}</td>
                      </tr>
                      <tr>
                        <td className="border border-gray-900 p-3 font-bold bg-gray-100">設計者</td>
                        <td className="border border-gray-900 p-3"></td>
                        <td className="border border-gray-900 p-3 font-bold bg-gray-100">檢核者</td>
                        <td className="border border-gray-900 p-3"></td>
                      </tr>
                    </tbody>
                  </table>

                  <h3 className="text-xl font-bold text-gray-900 mb-3 mt-8 border-l-4 border-gray-900 pl-3">一、設計參數彙整表</h3>
                  <table className="w-full text-sm border-collapse border border-gray-900 text-center">
                    <thead className="bg-gray-100">
                      <tr>
                        <th className="border border-gray-900 p-2" colSpan={2}>幾何與材料參數</th>
                        <th className="border border-gray-900 p-2" colSpan={2}>載重與地盤參數</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td className="border border-gray-900 p-2 font-bold bg-gray-50">樁長 L</td>
                        <td className="border border-gray-900 p-2">{L} <span className="text-gray-500 text-xs">m</span></td>
                        <td className="border border-gray-900 p-2 font-bold bg-gray-50">樁頭條件</td>
                        <td className="border border-gray-900 p-2">{isFixed ? '固定 (Fixed)' : '自由 (Free)'}</td>
                      </tr>
                      <tr>
                        <td className="border border-gray-900 p-2 font-bold bg-gray-50">樁徑 D</td>
                        <td className="border border-gray-900 p-2">{D} <span className="text-gray-500 text-xs">m</span></td>
                        <td className="border border-gray-900 p-2 font-bold bg-gray-50">水平力 H</td>
                        <td className="border border-gray-900 p-2">{H} <span className="text-gray-500 text-xs">T</span></td>
                      </tr>
                      <tr>
                        <td className="border border-gray-900 p-2 font-bold bg-gray-50">高出地表 h</td>
                        <td className="border border-gray-900 p-2">{h} <span className="text-gray-500 text-xs">m</span></td>
                        <td className="border border-gray-900 p-2 font-bold bg-gray-50">彎矩 M</td>
                        <td className="border border-gray-900 p-2">{M} <span className="text-gray-500 text-xs">T-m</span></td>
                      </tr>
                      <tr>
                        <td className="border border-gray-900 p-2 font-bold bg-gray-50">混凝土 fc'</td>
                        <td className="border border-gray-900 p-2">{fc} <span className="text-gray-500 text-xs">kgf/cm²</span></td>
                        <td className="border border-gray-900 p-2 font-bold bg-gray-50">載重因數</td>
                        <td className="border border-gray-900 p-2">{loadFactor}</td>
                      </tr>
                      <tr>
                        <td className="border border-gray-900 p-2 font-bold bg-gray-50">鋼筋 fy</td>
                        <td className="border border-gray-900 p-2">{fy} <span className="text-gray-500 text-xs">kgf/cm²</span></td>
                        <td className="border border-gray-900 p-2 font-bold bg-gray-50">地盤係數 ks</td>
                        <td className="border border-gray-900 p-2">{ks} <span className="text-gray-500 text-xs">T/m³</span></td>
                      </tr>
                      <tr>
                        <td className="border border-gray-900 p-2 font-bold bg-gray-50">彈性模數 E</td>
                        <td className="border border-gray-900 p-2">{E.toLocaleString()} <span className="text-gray-500 text-xs">T/m²</span></td>
                        <td className="border border-gray-900 p-2 font-bold bg-gray-50">特徵長度 β</td>
                        <td className="border border-gray-900 p-2">{results.beta.toFixed(4)} <span className="text-gray-500 text-xs">m⁻¹</span></td>
                      </tr>
                      <tr>
                        <td className="border border-gray-900 p-2 font-bold bg-gray-50">慣性矩 I</td>
                        <td className="border border-gray-900 p-2">{I} <span className="text-gray-500 text-xs">m⁴</span></td>
                        <td className="border border-gray-900 p-2 font-bold bg-gray-50">βL 與長樁判定</td>
                        <td className="border border-gray-900 p-2">{results.betaL.toFixed(2)} ({results.isLongPile ? '長樁' : '短樁'})</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            )}



            {/* Charts Header with Reset Zoom */}
            <div className="flex items-center justify-between mb-4">
              <h3 className={`text-xl font-bold flex items-center ${isPdfMode ? 'text-gray-900 border-l-4 border-gray-900 pl-3 font-serif' : 'text-slate-800'}`}>
                {!isPdfMode && <ZoomIn className="w-5 h-5 mr-2 text-blue-600" />}
                {isPdfMode ? '二、分析圖表' : '分析圖表'}
                {zoomDomain && !isPdfMode && <span className="ml-3 text-xs font-normal text-blue-600 bg-blue-50 px-2 py-1 rounded-full border border-blue-100">已縮放</span>}
              </h3>
              {zoomDomain && !isPdfMode && (
                <button
                  onClick={resetZoom}
                  className="flex items-center space-x-1 text-xs font-medium text-slate-500 hover:text-blue-600 transition-colors bg-white border border-slate-200 px-3 py-1.5 rounded-md shadow-sm"
                >
                  <RefreshCcw className="w-3 h-3" />
                  <span>重置縮放</span>
                </button>
              )}
            </div>

            {/* Charts Grid */}
            <div className={`grid gap-4 print-break-inside-avoid ${isPdfMode ? 'grid-cols-2' : 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-4'}`}>

              {/* Deflection Chart */}
              <div className={`bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col min-w-0 overflow-hidden ${isPdfMode ? 'h-[340px]' : 'h-[500px]'}`}>
                <div className="mb-4 flex h-16 flex-col justify-start">
                  <h3 className="text-sm font-bold text-slate-800 text-center">變位圖 (mm)</h3>
                  <div className="mt-2 flex items-baseline justify-center gap-2 text-center">
                    <span className="text-xs font-medium text-blue-600 uppercase">y_max</span>
                    <span className="text-base font-bold text-blue-700">{results.ymax.toFixed(2)}</span>
                    <span className="text-xs text-blue-500">mm</span>
                  </div>
                  <p className="mt-1 text-center text-[11px] text-slate-500">發生深度 {results.ymaxDepth.toFixed(2)} m</p>
                </div>
                <div className="flex-1 w-full min-w-0 overflow-hidden cursor-crosshair">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      syncId="pileCharts"
                      layout="vertical"
                      data={results.data}
                      margin={{ top: 40, right: 40, left: 10, bottom: 20 }}
                      onMouseDown={(e: any) => e && setRefAreaTop(e.activeLabel)}
                      onMouseMove={(e: any) => refAreaTop && e && setRefAreaBottom(e.activeLabel)}
                      onMouseUp={handleZoom}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={true} vertical={true} />
                      <XAxis type="number" dataKey="y" name="變位" domain={['auto', 'auto']} tick={{ fontSize: 12 }} />
                      {/* 移除 reversed={true} 以將深度 0 (樁頭) 置於下方，對調最淺與最深位置 */}
                      <YAxis type="number" dataKey="depth" name="深度" domain={zoomDomain || [0, L + h]} tickCount={11} tick={{ fontSize: 12 }} allowDataOverflow={true} />
                      <Tooltip content={<CustomTooltip />} />
                      <ReferenceLine x={0} stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="3 3" />
                      {h > 0 && (
                        <ReferenceLine y={h} stroke="#64748b" strokeWidth={1} strokeDasharray="5 5" label={{ position: 'insideTopRight', value: '地表', fill: '#64748b', fontSize: 10 }} />
                      )}
                      <Line type="monotone" dataKey="y" name="變位" unit=" mm" stroke="#2563eb" strokeWidth={2} dot={false} activeDot={{ r: 6, strokeWidth: 0 }} isAnimationActive={false} />
                      {Number.isFinite(results.ymax) && Number.isFinite(results.ymaxDepth) && (
                        <ReferenceDot
                          x={results.ymax}
                          y={results.ymaxDepth}
                          r={6}
                          fill="#2563eb"
                          stroke="white"
                          strokeWidth={2}
                          label={(props: any) => {
                            const { cx, cy } = props;
                            if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null;
                            const isAtTop = results.ymaxDepth <= 0.5;
                            const labelY = isAtTop ? cy + 25 : cy - 15;
                            return (
                              <g>
                                <rect
                                  x={cx - 45}
                                  y={labelY - 12}
                                  width={90}
                                  height={20}
                                  rx={4}
                                  fill="white"
                                  fillOpacity={0.9}
                                  stroke="#2563eb"
                                  strokeWidth={1}
                                />
                                <text
                                  x={cx}
                                  y={labelY + 2}
                                  fill="#2563eb"
                                  fontSize={10}
                                  fontWeight={700}
                                  textAnchor="middle"
                                  dominantBaseline="middle"
                                >
                                  {`ymax: ${results.ymax.toFixed(2)} mm`}
                                </text>
                              </g>
                            );
                          }}
                        />
                      )}
                      {refAreaTop && refAreaBottom && (
                        <ReferenceAreaAny y1={refAreaTop} y2={refAreaBottom} fill="#8884d8" fillOpacity={0.3} />
                      )}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <p className="text-center text-xs text-slate-500 mt-2">變位 y (mm)</p>
              </div>

              {/* Moment Chart */}
              <div className={`bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col min-w-0 overflow-hidden ${isPdfMode ? 'h-[340px]' : 'h-[500px]'}`}>
                <div className="mb-4 flex h-16 flex-col justify-start">
                  <h3 className="text-sm font-bold text-slate-800 text-center">彎矩圖 (T-m)</h3>
                  <div className="mt-2 flex items-baseline justify-center gap-2 text-center">
                    <span className="text-xs font-medium text-rose-600 uppercase">M_max</span>
                    <span className="text-base font-bold text-rose-700">{Math.abs(results.maxM).toFixed(1)}</span>
                    <span className="text-xs text-rose-500">T-m</span>
                  </div>
                  <p className="mt-1 text-center text-[11px] text-slate-500">發生深度 {results.maxMDepth.toFixed(2)} m</p>
                </div>
                <div className="flex-1 w-full min-w-0 overflow-hidden cursor-crosshair">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      syncId="pileCharts"
                      layout="vertical"
                      data={results.data}
                      margin={{ top: 40, right: 40, left: 10, bottom: 20 }}
                      onMouseDown={(e: any) => e && setRefAreaTop(e.activeLabel)}
                      onMouseMove={(e: any) => refAreaTop && e && setRefAreaBottom(e.activeLabel)}
                      onMouseUp={handleZoom}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={true} vertical={true} />
                      <XAxis type="number" dataKey="m" name="彎矩" domain={['auto', 'auto']} tick={{ fontSize: 12 }} />
                      {/* 移除 reversed={true} 以將深度 0 (樁頭) 置於下方，對調最淺與最深位置 */}
                      <YAxis type="number" dataKey="depth" name="深度" domain={zoomDomain || [0, L + h]} tickCount={11} tick={{ fontSize: 12 }} allowDataOverflow={true} />
                      <Tooltip content={<CustomTooltip />} />
                      <ReferenceLine x={0} stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="3 3" />
                      {h > 0 && (
                        <ReferenceLine y={h} stroke="#64748b" strokeWidth={1} strokeDasharray="5 5" label={{ position: 'insideTopRight', value: '地表', fill: '#64748b', fontSize: 10 }} />
                      )}
                      <Line type="monotone" dataKey="m" name="彎矩" unit=" T-m" stroke="#e11d48" strokeWidth={2} dot={false} activeDot={{ r: 6, strokeWidth: 0 }} isAnimationActive={false} />
                      {Number.isFinite(results.maxM) && Number.isFinite(results.maxMDepth) && (
                        <ReferenceDot
                          x={results.maxM}
                          y={results.maxMDepth}
                          r={6}
                          fill="#e11d48"
                          stroke="white"
                          strokeWidth={2}
                          label={(props: any) => {
                            const { cx, cy } = props;
                            if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null;
                            const isAtTop = results.maxMDepth <= 0.5;
                            const labelY = isAtTop ? cy + 25 : cy - 15;
                            return (
                              <g>
                                <rect
                                  x={cx - 50}
                                  y={labelY - 12}
                                  width={100}
                                  height={20}
                                  rx={4}
                                  fill="white"
                                  fillOpacity={0.9}
                                  stroke="#e11d48"
                                  strokeWidth={1}
                                />
                                <text
                                  x={cx}
                                  y={labelY + 2}
                                  fill="#e11d48"
                                  fontSize={10}
                                  fontWeight={700}
                                  textAnchor="middle"
                                  dominantBaseline="middle"
                                >
                                  {`Mmax: ${results.maxM.toFixed(1)} T-m`}
                                </text>
                              </g>
                            );
                          }}
                        />
                      )}
                      {refAreaTop && refAreaBottom && (
                        <ReferenceAreaAny y1={refAreaTop} y2={refAreaBottom} fill="#8884d8" fillOpacity={0.3} />
                      )}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <p className="text-center text-xs text-slate-500 mt-2">彎矩 M (T-m)</p>
              </div>

              {/* Shear Chart */}
              <div className={`bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col min-w-0 overflow-hidden ${isPdfMode ? 'h-[340px]' : 'h-[500px]'}`}>
                <div className="mb-4 flex h-16 flex-col justify-start">
                  <h3 className="text-sm font-bold text-slate-800 text-center">剪力圖 (T)</h3>
                  <div className="mt-2 flex items-baseline justify-center gap-2 text-center">
                    <span className="text-xs font-medium text-emerald-600 uppercase">V_max</span>
                    <span className="text-base font-bold text-emerald-700">{Math.abs(results.maxV).toFixed(1)}</span>
                    <span className="text-xs text-emerald-500">T</span>
                  </div>
                  <p className="mt-1 text-center text-[11px] text-slate-500">發生深度 {results.maxVDepth.toFixed(2)} m</p>
                </div>
                <div className="flex-1 w-full min-w-0 overflow-hidden cursor-crosshair">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      syncId="pileCharts"
                      layout="vertical"
                      data={results.data}
                      margin={{ top: 40, right: 40, left: 10, bottom: 20 }}
                      onMouseDown={(e: any) => e && setRefAreaTop(e.activeLabel)}
                      onMouseMove={(e: any) => refAreaTop && e && setRefAreaBottom(e.activeLabel)}
                      onMouseUp={handleZoom}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={true} vertical={true} />
                      <XAxis type="number" dataKey="v" name="剪力" domain={['auto', 'auto']} tick={{ fontSize: 12 }} />
                      {/* 移除 reversed={true} 以將深度 0 (樁頭) 置於下方，對調最淺與最深位置 */}
                      <YAxis type="number" dataKey="depth" name="深度" domain={zoomDomain || [0, L + h]} tickCount={11} tick={{ fontSize: 12 }} allowDataOverflow={true} />
                      <Tooltip content={<CustomTooltip />} />
                      <ReferenceLine x={0} stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="3 3" />
                      {h > 0 && (
                        <ReferenceLine y={h} stroke="#64748b" strokeWidth={1} strokeDasharray="5 5" label={{ position: 'insideTopRight', value: '地表', fill: '#64748b', fontSize: 10 }} />
                      )}
                      <Line type="monotone" dataKey="v" name="剪力" unit=" T" stroke="#059669" strokeWidth={2} dot={false} activeDot={{ r: 6, strokeWidth: 0 }} isAnimationActive={false} />
                      {Number.isFinite(results.maxV) && Number.isFinite(results.maxVDepth) && (
                        <ReferenceDot
                          x={results.maxV}
                          y={results.maxVDepth}
                          r={6}
                          fill="#059669"
                          stroke="white"
                          strokeWidth={2}
                          label={(props: any) => {
                            const { cx, cy } = props;
                            if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null;
                            const isAtTop = results.maxVDepth <= 0.5;
                            const labelY = isAtTop ? cy + 25 : cy - 15;
                            return (
                              <g>
                                <rect
                                  x={cx - 45}
                                  y={labelY - 12}
                                  width={90}
                                  height={20}
                                  rx={4}
                                  fill="white"
                                  fillOpacity={0.9}
                                  stroke="#059669"
                                  strokeWidth={1}
                                />
                                <text
                                  x={cx}
                                  y={labelY + 2}
                                  fill="#059669"
                                  fontSize={10}
                                  fontWeight={700}
                                  textAnchor="middle"
                                  dominantBaseline="middle"
                                >
                                  {`Vmax: ${results.maxV.toFixed(1)} T`}
                                </text>
                              </g>
                            );
                          }}
                        />
                      )}
                      {refAreaTop && refAreaBottom && (
                        <ReferenceAreaAny y1={refAreaTop} y2={refAreaBottom} fill="#8884d8" fillOpacity={0.3} />
                      )}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <p className="text-center text-xs text-slate-500 mt-2">剪力 V (T)</p>
              </div>

              {/* Reinforcement Envelope Chart */}
              <div className={`bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col min-w-0 overflow-hidden ${isPdfMode ? 'h-[340px]' : 'h-[500px]'}`}>
                <div className="mb-4 flex h-16 flex-col justify-start">
                  <h3 className="text-sm font-bold text-slate-800 text-center">配筋包絡線 (cm²)</h3>
                  <div className="mt-2 text-center text-[11px] text-slate-500">需求鋼筋分布與最小配筋檢核</div>
                </div>
                <div className="flex-1 w-full min-w-0 overflow-hidden cursor-crosshair">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      syncId="pileCharts"
                      layout="vertical"
                      data={results.data}
                      margin={{ top: 40, right: 40, left: 10, bottom: 20 }}
                      onMouseDown={(e: any) => e && setRefAreaTop(e.activeLabel)}
                      onMouseMove={(e: any) => refAreaTop && e && setRefAreaBottom(e.activeLabel)}
                      onMouseUp={handleZoom}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={true} vertical={true} />
                      <XAxis type="number" dataKey="As" name="需求 As" domain={[0, 'auto']} tick={{ fontSize: 12 }} />
                      {/* 移除 reversed={true} 以將深度 0 (樁頭) 置於下方，對調最淺與最深位置 */}
                      <YAxis type="number" dataKey="depth" name="深度" domain={zoomDomain || [0, L + h]} tickCount={11} tick={{ fontSize: 12 }} allowDataOverflow={true} />
                      <Tooltip content={<CustomTooltip />} />
                      <ReferenceLine x={results.As_min} stroke="#ef4444" strokeWidth={1.5} strokeDasharray="3 3" label={{ position: 'insideTopLeft', value: 'As,min', fill: '#ef4444', fontSize: 12, offset: 10 }} />
                      {h > 0 && (
                        <ReferenceLine y={h} stroke="#64748b" strokeWidth={1} strokeDasharray="5 5" label={{ position: 'insideTopRight', value: '地表', fill: '#64748b', fontSize: 10 }} />
                      )}
                      <Line type="monotone" dataKey="As" name="需求 As" stroke="#8b5cf6" strokeWidth={2} dot={false} activeDot={{ r: 6, strokeWidth: 0 }} isAnimationActive={false} />
                      {refAreaTop && refAreaBottom && (
                        <ReferenceAreaAny y1={refAreaTop} y2={refAreaBottom} fill="#8884d8" fillOpacity={0.3} />
                      )}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <p className="text-center text-xs text-slate-500 mt-2">需求鋼筋面積 As (cm²)</p>
              </div>

            </div>
            </div>

            {/* Reinforcement Section */}
            <div ref={isPdfMode ? pdfPage2Ref : undefined} className={isPdfMode ? 'space-y-8' : ''}>
            <div className={`p-6 rounded-xl border ${isPdfMode ? 'mt-12 border-gray-900 border-2 font-serif' : 'bg-white border-slate-200 shadow-sm'} print-break-inside-avoid`}>
              <h3 className={`text-xl font-bold mb-6 flex items-center ${isPdfMode ? 'text-gray-900 border-l-4 border-gray-900 pl-3' : 'text-slate-800'}`}>
                {!isPdfMode && <Settings2 className="w-5 h-5 mr-2 text-slate-600" />}
                {isPdfMode ? '三、基樁斷面分析與配筋設計總表' : '基樁斷面分析與配筋設計總表'}
              </h3>

              <div className="space-y-8">
                <div>
                  <h4 className={`text-sm font-semibold uppercase tracking-wider mb-3 ${isPdfMode ? 'text-gray-800' : 'text-slate-600'}`}>分析結果摘要</h4>
                  <div className={`grid gap-3 ${isPdfMode ? 'grid-cols-3' : 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3'}`}>
                    <div className={`${isPdfMode ? 'border border-gray-900 p-3' : 'bg-slate-50 border border-slate-200 rounded-lg p-3'}`}>
                      <p className="text-xs text-slate-500">特徵長度 β</p>
                      <p className="mt-1 text-lg font-bold text-slate-900">{results.beta.toFixed(4)} <span className="text-xs font-normal text-slate-500">m⁻¹</span></p>
                    </div>
                    <div className={`${isPdfMode ? 'border border-gray-900 p-3' : 'bg-slate-50 border border-slate-200 rounded-lg p-3'}`}>
                      <p className="text-xs text-slate-500">βL 與長樁判定</p>
                      <p className="mt-1 text-lg font-bold text-slate-900">{results.betaL.toFixed(2)}</p>
                      <p className="text-xs text-slate-500">{results.isLongPile ? '長樁' : '短樁'}</p>
                    </div>
                  </div>
                </div>

                {/* Integrated Analysis Table */}
                <div>
                  <h4 className={`text-sm font-semibold uppercase tracking-wider mb-3 ${isPdfMode ? 'text-gray-800' : 'text-slate-600'}`}>斷面分析總表</h4>
                  <div className={isPdfMode ? 'border border-gray-900 overflow-hidden' : 'overflow-x-auto border border-slate-200 rounded-md max-h-[600px] overflow-y-auto'}>
                    <table className={`w-full text-sm text-center border-collapse ${isPdfMode ? 'text-gray-900 border-gray-900 text-[11px]' : 'text-left'}`} style={isPdfMode ? { tableLayout: 'fixed' } : {}}>
                      <thead className={`text-xs ${isPdfMode ? 'bg-gray-100 text-gray-900 border-b-2 border-gray-900' : 'text-slate-500 bg-slate-50 border-b border-slate-200'} sticky top-0 z-10`}>
                        <tr>
                          <th className={`px-3 py-3 font-bold border-r break-words ${isPdfMode ? 'border-gray-900' : 'border-slate-200'}`}>位置</th>
                          <th className={`px-3 py-3 font-bold border-r break-words ${isPdfMode ? 'border-gray-900' : 'border-slate-200'}`}>深度 (m)</th>
                          <th className={`px-3 py-3 font-bold border-r break-words ${isPdfMode ? 'border-gray-900' : 'border-slate-200'}`}>變位 y (mm)</th>
                          <th className={`px-3 py-3 font-bold border-r break-words ${isPdfMode ? 'border-gray-900' : 'border-slate-200'}`}>彎矩 Mu (T-m)</th>
                          <th className={`px-3 py-3 font-bold border-r break-words ${isPdfMode ? 'border-gray-900' : 'border-slate-200'}`}>需求 As (cm²)</th>
                          <th className={`px-3 py-3 font-bold border-r break-words ${isPdfMode ? 'border-gray-900' : 'border-slate-200'}`}>剪力 Vu (T)</th>
                          <th className={`px-3 py-3 font-bold border-r break-words ${isPdfMode ? 'border-gray-900' : 'border-slate-200'}`}>強度 φVc (T)</th>
                          <th className="px-3 py-3 font-bold break-words">檢核 (Ratio)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {results.reinforcementTable.map((pt, idx) => {
                          const Vu = Math.abs(pt.v) * loadFactor;
                          const ratio = Vu / pt.Vc;
                          const isSafe = ratio <= 1.0;
                          return (
                            <tr key={idx} className={`${isPdfMode ? 'border-b border-gray-300' : 'hover:bg-slate-50'} ${pt.isCritical ? (isPdfMode ? 'bg-gray-200 font-bold' : 'bg-amber-50/60 font-semibold border-l-4 border-amber-400') : ''}`}>
                              <td className={`px-3 py-2 border-r break-words ${isPdfMode ? 'border-gray-300' : 'border-slate-200'}`}>
                                {pt.isCritical ? (
                                  <span>{pt.name.split(' ')[0]}</span>
                                ) : (
                                  <span className="text-gray-400">-</span>
                                )}
                              </td>
                              <td className={`px-3 py-2 border-r break-words ${isPdfMode ? 'border-gray-300' : 'border-slate-200'}`}>{pt.depth.toFixed(2)}</td>
                              <td className={`px-3 py-2 border-r break-words ${isPdfMode ? 'border-gray-300' : 'border-slate-200'}`}>{pt.y.toFixed(2)}</td>
                              <td className={`px-3 py-2 border-r break-words ${isPdfMode ? 'border-gray-300' : 'border-slate-200'}`}>{Math.abs(pt.m * loadFactor).toFixed(2)}</td>
                              <td className={`px-3 py-2 border-r break-words ${isPdfMode ? 'border-gray-300' : 'border-slate-200'}`}>{pt.As.toFixed(2)}</td>
                              <td className={`px-3 py-2 border-r break-words ${isPdfMode ? 'border-gray-300' : 'border-slate-200'}`}>{Vu.toFixed(2)}</td>
                              <td className={`px-3 py-2 border-r break-words ${isPdfMode ? 'border-gray-300' : 'border-slate-200'}`}>{pt.Vc.toFixed(2)}</td>
                              <td className="px-3 py-2 break-words">
                                <span className={`font-medium ${isSafe ? (isPdfMode ? 'text-gray-900' : 'text-emerald-600') : (isPdfMode ? 'text-black font-bold' : 'text-rose-600')}`}>
                                  {ratio.toFixed(2)} {isSafe ? ' (OK)' : ' (NG)'}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className={`mt-4 p-3 ${isPdfMode ? 'border border-gray-900' : 'bg-slate-50 border border-slate-100 rounded-lg'}`}>
                    <p className={`text-xs ${isPdfMode ? 'text-gray-800' : 'text-slate-500'} leading-relaxed`}>
                      註解：<br/>
                      1. 強度 φVc = φ * 0.53 * √fc' * bw * d。此計算僅考慮混凝土剪力強度。<br/>
                      2. 設計彎矩 Mu 與 設計剪力 Vu 已計入載重因數 {loadFactor}。<br/>
                      3. Ratio = Vu / φVc。檢核條件：Ratio ≤ 1.0 時為安全 (OK)。
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Info Section */}
            <div className={`${isPdfMode ? 'mt-8 border border-gray-900 p-6 font-serif' : 'bg-blue-50 p-5 rounded-xl border border-blue-100 flex items-start space-x-3'} print-break-inside-avoid`}>
              {!isPdfMode && <Info className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />}
              <div className={`text-sm space-y-2 ${isPdfMode ? 'text-gray-900' : 'text-blue-900'}`}>
                <p className={`font-bold ${isPdfMode ? 'text-lg border-l-4 border-gray-900 pl-3 mb-4' : ''}`}>{isPdfMode ? '四、張有齡公式與配筋說明' : '張有齡公式 與配筋說明'}</p>
                <p>採用張有齡公式進行基樁側向分析，假設土壤為彈性地盤且地盤反應係數 k_s 為常數。此假設常用於凝聚性土壤或工程初步設計階段。</p>
                <ul className="list-disc pl-5 space-y-1 mt-2">
                  <li><strong>長樁判定：</strong> 當 βL &gt; 2.5 時，視為長樁，樁底邊界條件對樁頭變位影響極小。</li>
                  <li><strong>配筋設計：</strong> 需求鋼筋面積 As 採用圓形斷面簡化公式 As = Mu / (0.9 * fy * 0.7D) 估算，其中 Mu = M * 載重因數。係數 0.7 係考量圓形斷面鋼筋沿圓周分佈之特性。</li>
                  <li><strong>最小配筋率：</strong> 程式預設最小配筋率為 0.5% Ag，若計算之 As 小於此值，將自動採用最小配筋面積。</li>
                  <li><strong>單位系統：</strong> 內部計算統一採用公尺 與 噸，1 T = 9.81 kN。</li>
                </ul>
              </div>
            </div>
            </div>

          </div>
        </div>
      </main>
    </div>
  );
}
