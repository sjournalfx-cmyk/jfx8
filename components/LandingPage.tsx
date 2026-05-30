import React from 'react';
import { BarChart2, HelpCircle, Coins, Clock } from 'lucide-react';
import { RadarChart, PolarGrid, PolarAngleAxis, Radar, Tooltip, ResponsiveContainer } from 'recharts';
import { clsx } from 'clsx';
import { Tooltip as InfoTooltip } from './ui/Tooltip';
import { PerformanceSequence } from './PerformanceSequence';

interface LandingPageProps {
  onEnterAuth: () => void;
}

const trustBrands = [
  {
    name: 'TradingView',
    logo: 'https://www.tradingview.com/favicon.ico',
  },
  {
    name: 'MT5',
    logo: '/mt5-logo.png',
  },
];

const trustBrandLoop = Array.from({ length: 4 }, () => trustBrands).flat();

const useCaseCards = [
  {
    title: 'Day Trader',
    description: 'Rapid entries, session-based review.',
    accent: 'bg-jfx',
    shell: 'bg-zinc-900/60 border-zinc-800/50',
  },
  {
    title: 'Swing Trader',
    description: 'Multi-day holds, position management.',
    accent: 'bg-gradient-to-r from-[#FF416C] to-[#FF4B2B]',
    shell: 'bg-zinc-900/60 border-zinc-800/50',
  },
  {
    title: 'Scalper',
    description: 'High-frequency, micro-analysis.',
    accent: 'bg-gradient-to-r from-jfx to-orange-600',
    shell: 'bg-zinc-900/60 border-zinc-800/50',
  },
  {
    title: 'Position Trader',
    description: 'Long-term, macro view.',
    accent: 'bg-gradient-to-br from-jfx to-orange-700',
    shell: 'bg-[#181818]',
  },
];

const updates = [
  {
    title: 'Introducing JFX-JOURNAL Desktop Bridge',
    meta: 'Product Update • Oct 12',
  },
  {
    title: 'The Complete Guide to Trade Journaling',
    meta: 'Guide • Sep 28',
  },
  {
    title: 'JFX-JOURNAL Beta Now Open',
    meta: 'Company • Sep 15',
  },
];

const landingPairTiles = [
  { pair: 'XAUAUD', trades: '1 trade', pnl: '$-486.15', x: 0, y: 0, width: 430, height: 494, fill: '#C91F25' },
  { pair: 'EURUSD', trades: '4 trades', pnl: '$473.32', x: 430, y: 0, width: 808, height: 262, fill: '#0B8F68' },
  { pair: 'GBPUSD', trades: '10 trades', pnl: '$49.15', x: 430, y: 262, width: 404, height: 232, fill: '#064632' },
  { pair: 'NZDUSD', trades: '3 trades', pnl: '$138.35', x: 834, y: 262, width: 404, height: 232, fill: '#07523A' },
] as const;

const dayOfWeekData = [
  { name: 'Mon', pnl: 1240, absPnl: 1240, count: 8, winRate: 62.5, positiveDayRate: 75, medianTradePnL: 185, topThreeWinConcentration: 72 },
  { name: 'Tue', pnl: -380, absPnl: 380, count: 12, winRate: 41.7, positiveDayRate: 40, medianTradePnL: -42, topThreeWinConcentration: 88 },
  { name: 'Wed', pnl: 890, absPnl: 890, count: 6, winRate: 66.7, positiveDayRate: 80, medianTradePnL: 126, topThreeWinConcentration: 65 },
  { name: 'Thu', pnl: 2100, absPnl: 2100, count: 10, winRate: 70.0, positiveDayRate: 80, medianTradePnL: 210, topThreeWinConcentration: 60 },
  { name: 'Fri', pnl: -120, absPnl: 120, count: 5, winRate: 40.0, positiveDayRate: 33, medianTradePnL: -15, topThreeWinConcentration: 100 },
];

const currencyStrengthData = [
  { cur: 'USD', val: 8.2, raw: 2450 },
  { cur: 'GBP', val: 6.7, raw: 1320 },
  { cur: 'EUR', val: 5.4, raw: 890 },
  { cur: 'JPY', val: 3.1, raw: -410 },
  { cur: 'AUD', val: 2.8, raw: -620 },
  { cur: 'CAD', val: 1.5, raw: -1050 },
];

const timeOfDayHeatmap: Record<string, Record<number, { pnl: number; count: number }>> = {
  Mon: { 0: {pnl:-120,count:1}, 1:{pnl:0,count:0}, 2:{pnl:0,count:0}, 3:{pnl:0,count:0}, 4:{pnl:0,count:0}, 5:{pnl:0,count:0}, 6:{pnl:0,count:0}, 7:{pnl:40,count:1}, 8:{pnl:180,count:2}, 9:{pnl:320,count:3}, 10:{pnl:-90,count:2}, 11:{pnl:210,count:2}, 12:{pnl:150,count:2}, 13:{pnl:60,count:1}, 14:{pnl:-45,count:1}, 15:{pnl:280,count:2}, 16:{pnl:190,count:2}, 17:{pnl:75,count:1}, 18:{pnl:-60,count:1}, 19:{pnl:0,count:0}, 20:{pnl:0,count:0}, 21:{pnl:0,count:0}, 22:{pnl:0,count:0}, 23:{pnl:0,count:0} },
  Tue: { 0: {pnl:0,count:0}, 1:{pnl:0,count:0}, 2:{pnl:0,count:0}, 3:{pnl:0,count:0}, 4:{pnl:0,count:0}, 5:{pnl:0,count:0}, 6:{pnl:0,count:0}, 7:{pnl:-30,count:1}, 8:{pnl:90,count:2}, 9:{pnl:410,count:4}, 10:{pnl:260,count:3}, 11:{pnl:-120,count:2}, 12:{pnl:80,count:1}, 13:{pnl:190,count:2}, 14:{pnl:340,count:3}, 15:{pnl:160,count:2}, 16:{pnl:-85,count:1}, 17:{pnl:55,count:1}, 18:{pnl:0,count:0}, 19:{pnl:0,count:0}, 20:{pnl:0,count:0}, 21:{pnl:0,count:0}, 22:{pnl:0,count:0}, 23:{pnl:0,count:0} },
  Wed: { 0: {pnl:0,count:0}, 1:{pnl:0,count:0}, 2:{pnl:0,count:0}, 3:{pnl:0,count:0}, 4:{pnl:0,count:0}, 5:{pnl:0,count:0}, 6:{pnl:0,count:0}, 7:{pnl:110,count:1}, 8:{pnl:240,count:2}, 9:{pnl:180,count:2}, 10:{pnl:520,count:3}, 11:{pnl:310,count:3}, 12:{pnl:-70,count:1}, 13:{pnl:95,count:2}, 14:{pnl:210,count:2}, 15:{pnl:140,count:1}, 16:{pnl:60,count:1}, 17:{pnl:-35,count:1}, 18:{pnl:0,count:0}, 19:{pnl:0,count:0}, 20:{pnl:0,count:0}, 21:{pnl:0,count:0}, 22:{pnl:0,count:0}, 23:{pnl:0,count:0} },
  Thu: { 0: {pnl:0,count:0}, 1:{pnl:0,count:0}, 2:{pnl:0,count:0}, 3:{pnl:0,count:0}, 4:{pnl:0,count:0}, 5:{pnl:0,count:0}, 6:{pnl:0,count:0}, 7:{pnl:70,count:1}, 8:{pnl:310,count:3}, 9:{pnl:640,count:4}, 10:{pnl:420,count:4}, 11:{pnl:280,count:3}, 12:{pnl:530,count:4}, 13:{pnl:360,count:3}, 14:{pnl:-110,count:2}, 15:{pnl:220,count:2}, 16:{pnl:380,count:3}, 17:{pnl:150,count:2}, 18:{pnl:90,count:1}, 19:{pnl:-50,count:1}, 20:{pnl:0,count:0}, 21:{pnl:0,count:0}, 22:{pnl:0,count:0}, 23:{pnl:0,count:0} },
  Fri: { 0: {pnl:0,count:0}, 1:{pnl:0,count:0}, 2:{pnl:0,count:0}, 3:{pnl:0,count:0}, 4:{pnl:0,count:0}, 5:{pnl:0,count:0}, 6:{pnl:0,count:0}, 7:{pnl:-80,count:1}, 8:{pnl:60,count:1}, 9:{pnl:-150,count:2}, 10:{pnl:-40,count:1}, 11:{pnl:120,count:2}, 12:{pnl:200,count:2}, 13:{pnl:-95,count:2}, 14:{pnl:80,count:1}, 15:{pnl:-25,count:1}, 16:{pnl:0,count:0}, 17:{pnl:0,count:0}, 18:{pnl:0,count:0}, 19:{pnl:0,count:0}, 20:{pnl:0,count:0}, 21:{pnl:0,count:0}, 22:{pnl:0,count:0}, 23:{pnl:0,count:0} },
};

const LandingPage: React.FC<LandingPageProps> = ({ onEnterAuth }) => {
  const [hoveredCell, setHoveredCell] = React.useState<{ day: string; hour: number } | null>(null);
  const [mousePos, setMousePos] = React.useState({ x: 0, y: 0 });
  const heroFrameRef = React.useRef<HTMLDivElement | null>(null);
  const heroVideoRef = React.useRef<HTMLVideoElement | null>(null);
  const heroVideoEndedRef = React.useRef(false);
  const heroVideoExitedAfterEndRef = React.useRef(false);

  React.useEffect(() => {
    const heroFrame = heroFrameRef.current;
    const heroVideo = heroVideoRef.current;

    if (!heroFrame || !heroVideo || typeof IntersectionObserver === 'undefined') return;

    const handleEnded = () => {
      heroVideoEndedRef.current = true;
      heroVideoExitedAfterEndRef.current = false;
      heroVideo.pause();
    };

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;

        if (!entry.isIntersecting && heroVideoEndedRef.current) {
          heroVideoExitedAfterEndRef.current = true;
          return;
        }

        const shouldStartPlayback = entry.isIntersecting && entry.intersectionRatio >= 0.65;

        if (shouldStartPlayback && heroVideoEndedRef.current && heroVideoExitedAfterEndRef.current) {
          heroVideoEndedRef.current = false;
          heroVideoExitedAfterEndRef.current = false;
          heroVideo.currentTime = 0;
          void heroVideo.play().catch(() => undefined);
          return;
        }

        if (shouldStartPlayback && !heroVideoEndedRef.current && heroVideo.paused) {
          void heroVideo.play().catch(() => undefined);
        }
      },
      { threshold: [0, 0.35, 0.65], rootMargin: '0px 0px -12% 0px' }
    );

    heroVideo.addEventListener('ended', handleEnded);
    observer.observe(heroFrame);

    return () => {
      heroVideo.removeEventListener('ended', handleEnded);
      observer.disconnect();
    };
  }, []);

  return (
    <div className="min-h-dvh bg-[#FAF9F5] text-[#1B1B1B]">
      <header className="fixed top-[24px] left-0 right-0 z-50 flex items-center justify-center px-4 w-full pointer-events-none">
        <div className="pointer-events-auto w-full max-w-[900px] h-[92px] flex items-center justify-between bg-black rounded-full px-3 py-3 shadow-[0_12px_30px_rgba(0,0,0,0.2)] border border-white/10">
          <div className="flex items-center gap-5 pl-3">
            <div className="w-[34px] h-[34px] rounded-full flex items-center justify-center shrink-0">
              <span className="text-white font-bold text-sm leading-none">JFX</span>
            </div>
            <nav className="hidden md:flex items-center gap-6">
              <a className="text-[12px] font-semibold uppercase tracking-[0.05em] text-white/80 hover:text-white transition-colors" href="#product">Product</a>
              <a className="text-[12px] font-semibold uppercase tracking-[0.05em] text-white/80 hover:text-white transition-colors" href="#solutions">Solutions</a>
              <a className="text-[12px] font-semibold uppercase tracking-[0.05em] text-white/80 hover:text-white transition-colors" href="#about">About</a>
              <a className="text-[12px] font-semibold uppercase tracking-[0.05em] text-white/80 hover:text-white transition-colors" href="#updates">Blog</a>
            </nav>
          </div>
          <button
            type="button"
            onClick={onEnterAuth}
            className="bg-jfx text-white text-[12px] font-semibold h-full px-8 rounded-full hover:bg-[#e64601] transition-colors duration-300 shrink-0 flex items-center shadow-sm shadow-jfx/20"
          >
            Register / Log in
          </button>
        </div>
      </header>

      <main>
        <section className="pt-[220px] px-10 max-w-[1728px] mx-auto flex flex-col items-center text-center relative overflow-visible bg-[#FAF9F5]">
          <h1 className="text-[82px] leading-[1.05] tracking-[-0.04em] font-bold max-w-4xl mb-8 text-[#1B1B1B] text-balance">
            The trading journal for traders who are serious about their craft
          </h1>
          <p className="text-[18px] leading-[1.6] text-[#111111] max-w-2xl mb-16">
            Track every trade, analyse every outcome, and evolve your strategy with the most comprehensive trading journal built for serious traders.
          </p>
          <div ref={heroFrameRef} className="w-full max-w-[1194px] bg-[#F0EFEB] overflow-hidden shadow-2xl relative z-10 rounded-[40px] h-[640px]">
            <video
              ref={heroVideoRef}
              className="w-full h-full object-cover"
              muted
              playsInline
              preload="auto"
              src="/Man_decluttering_desk_then_relaxing_202605241120.mp4"
            />
            <div
              className="absolute -top-6 -left-16 w-[340px] h-[86px] -rotate-45 z-20 rounded-sm shadow-md"
              style={{ backgroundColor: 'rgba(243, 239, 224, 0.98)', backdropFilter: 'blur(3px)' }}
            />
            <div
              className="absolute -top-6 -right-16 w-[340px] h-[86px] rotate-45 z-20 rounded-sm shadow-md"
              style={{ backgroundColor: 'rgba(243, 239, 224, 0.98)', backdropFilter: 'blur(3px)' }}
            />
            <div
              className="absolute -bottom-6 -left-16 w-[340px] h-[86px] rotate-45 z-20 rounded-sm shadow-md"
              style={{ backgroundColor: 'rgba(243, 239, 224, 0.98)', backdropFilter: 'blur(3px)' }}
            />
            <div
              className="absolute -bottom-6 -right-16 w-[340px] h-[86px] -rotate-45 z-20 rounded-sm shadow-md"
              style={{ backgroundColor: 'rgba(243, 239, 224, 0.98)', backdropFilter: 'blur(3px)' }}
            />
          </div>
        </section>

        <section className="py-20 px-10 border-t border-[#D9D7D0]/40 max-w-[1728px] mx-auto flex flex-col items-center bg-[#FAF9F5] relative z-0">
          <div className="flex justify-center items-center opacity-[0.72] text-[#BDBAB2] w-full overflow-hidden">
            <div className="marquee-container">
              <div className="marquee-content flex gap-[100px] items-center text-[#BDBAB2]">
                {trustBrandLoop.map((brand, index) => (
                  <div key={`${brand.name}-${index}`} className="flex items-center gap-3 opacity-60 hover:opacity-100 transition-all duration-300 cursor-default shrink-0">
                    <img
                      src={brand.logo}
                      alt={brand.name}
                      className="h-8 w-8 object-contain shrink-0"
                    />
                    <span className="text-[20px] font-semibold tracking-tight text-[#111111]">
                      {brand.name}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="min-h-[1400px] w-full max-w-[1728px] mx-auto relative overflow-visible bg-[#FAF9F5] py-20">
          <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
            <h2 className="text-[132px] leading-[0.9] tracking-[-0.06em] font-bold text-[#1B1B1B] text-center text-balance">
              Advanced
              <br />
              Analytics
            </h2>
          </div>
          <div className="absolute left-[7%] top-[18%] z-20 w-[58vw] max-w-[780px] rotate-[-6deg] origin-center opacity-60">
            <svg
              viewBox="0 0 1238 494"
              role="img"
              aria-label="Pair distribution treemap showing XAUAUD, EURUSD, and GBPUSD"
              className="block h-auto w-full overflow-visible shadow-[0_24px_70px_rgba(17,17,17,0.12)]"
            >
              {landingPairTiles.map((tile) => (
                <g key={tile.pair}>
                  <rect
                    x={tile.x}
                    y={tile.y}
                    width={tile.width}
                    height={tile.height}
                    fill={tile.fill}
                    stroke="#050505"
                    strokeWidth="3"
                  />
                  <text
                    x={tile.x + tile.width / 2}
                    y={tile.y + tile.height / 2 - 18}
                    textAnchor="middle"
                    fill="#ffffff"
                    fontSize="18"
                    fontWeight="800"
                    style={{ pointerEvents: 'none', filter: 'drop-shadow(0 2px 2px rgba(0,0,0,0.35))' }}
                  >
                    {tile.pair}
                  </text>
                  <text
                    x={tile.x + tile.width / 2}
                    y={tile.y + tile.height / 2 + 2}
                    textAnchor="middle"
                    fill="#f8fafc"
                    fontSize="14"
                    fontWeight="700"
                    style={{ pointerEvents: 'none', filter: 'drop-shadow(0 1px 1px rgba(0,0,0,0.35))' }}
                  >
                    {tile.trades}
                  </text>
                  <text
                    x={tile.x + tile.width / 2}
                    y={tile.y + tile.height / 2 + 22}
                    textAnchor="middle"
                    fill="#ffffff"
                    fontSize="14"
                    fontWeight="800"
                    style={{ pointerEvents: 'none', filter: 'drop-shadow(0 1px 1px rgba(0,0,0,0.35))' }}
                  >
                    {tile.pnl}
                  </text>
                </g>
              ))}
            </svg>
          </div>

          <div className="absolute right-[5%] top-[18%] z-20 w-[280px] rotate-[3deg] origin-center opacity-60">
            <div className="p-4 rounded-[32px] border flex flex-col bg-[#000000] border-zinc-800 shadow-2xl shadow-black/40">
              <div className="mb-3">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-black tracking-tight italic flex items-center gap-2 uppercase text-white">
                    <BarChart2 size={18} className="text-jfx" />
                    Day of Week
                  </h3>
                  <InfoTooltip content="Typical trade: Thu has the strongest median trade at +$210.00. Consistency: Wed closes green on 80% of its trading days. Edge quality: Fri is the most top-heavy, with 100% of its winning PnL coming from the top 3 trades." isDarkMode={true}>
                    <HelpCircle size={12} className="opacity-40 cursor-help hover:opacity-100 text-zinc-400" />
                  </InfoTooltip>
                </div>
                <p className="text-[9px] font-bold opacity-40 uppercase tracking-widest mt-1 ml-7 text-zinc-400">Performance by Trading Day</p>
              </div>

              <div className="flex items-center justify-center w-full h-[170px] py-2">
                <div className="w-[160px] h-[160px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <RadarChart cx="50%" cy="50%" outerRadius="80%" data={dayOfWeekData}>
                      <PolarGrid stroke="rgba(255,255,255,0.08)" />
                      <PolarAngleAxis
                        dataKey="name"
                        tick={{ fill: '#a1a1aa', fontSize: 10, fontWeight: '900' }}
                      />
                      <Radar
                        name="Win Rate"
                        dataKey="winRate"
                        stroke="#8251EE"
                        strokeWidth={3}
                        fill="#8251EE"
                        fillOpacity={0.3}
                      />
                      <Tooltip
                        cursor={{ stroke: '#8251EE', strokeWidth: 1, strokeOpacity: 0.2 }}
                        content={({ active, payload, label }) => {
                          if (!active || !payload?.length) return null;
                          const point = payload[0]?.payload as { winRate?: number; count?: number };
                          const winRate = typeof point?.winRate === 'number' ? point.winRate : Number(payload[0]?.value ?? 0);
                          const totalTrades = point?.count ?? 0;
                          return (
                            <div className="rounded-2xl border border-zinc-800 bg-[#000000] px-4 py-3 shadow-2xl">
                              <div className="text-sm font-black text-white">{label}</div>
                              <div className="mt-1 text-xs font-semibold text-zinc-300">
                                Win Rate: <span className="text-violet-400">{winRate.toFixed(0)}%</span>
                              </div>
                              <div className="mt-1 text-xs font-semibold text-zinc-300">
                                Total trades: <span className="text-white">{totalTrades}</span>
                              </div>
                            </div>
                          );
                        }}
                      />
                    </RadarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="space-y-2 mt-3">
                {dayOfWeekData.map(d => {
                  const maxAbsPnl = Math.max(...dayOfWeekData.map(x => x.absPnl), 1);
                  return (
                    <div key={d.name} className="space-y-0.5">
                      <div className="flex justify-between items-center px-1">
                        <span className="text-[9px] font-black uppercase tracking-widest opacity-60 text-zinc-400">{d.name}</span>
                        <span className={clsx("text-[10px] font-black", d.pnl >= 0 ? "text-emerald-500" : "text-rose-500")}>
                          {d.pnl >= 0 ? '+' : ''}${Math.abs(d.pnl).toLocaleString()}
                        </span>
                      </div>
                      <div className="h-1 w-full rounded-full overflow-hidden bg-black">
                        <div
                          className={clsx("h-full rounded-full", d.pnl >= 0 ? "bg-emerald-500" : "bg-rose-500")}
                          style={{ width: `${Math.min(100, (d.absPnl / maxAbsPnl) * 100)}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="absolute right-[5%] top-[58%] z-20 w-[400px] rotate-[3deg] origin-center opacity-60">
            <div className="p-4 rounded-[32px] border flex flex-col bg-[#000000] border-zinc-800 shadow-2xl shadow-black/40">
              <div className="mb-3">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-black tracking-tight italic flex items-center gap-2 uppercase text-white">
                    <Coins size={18} className="text-jfx" />
                    Currency Strength
                  </h3>
                </div>
                <p className="text-[9px] font-bold opacity-40 uppercase tracking-widest mt-1 ml-7 text-zinc-400">Score by base currency</p>
              </div>
              <div className="space-y-3">
                {currencyStrengthData.map(item => {
                  const strengthColor =
                    item.val > 7 ? 'bg-emerald-500' :
                    item.val > 4 ? 'bg-blue-500' :
                    item.val > 2 ? 'bg-amber-500' : 'bg-rose-500';
                  return (
                    <div key={item.cur} className="flex items-center gap-3">
                      <div className="w-10 flex flex-col items-center">
                        <span className="text-xs font-black text-white">{item.cur}</span>
                      </div>
                      <div className="flex-1 h-2 rounded-full overflow-hidden bg-black">
                        <div
                          className={`h-full rounded-full ${strengthColor}`}
                          style={{ width: `${Math.max(5, item.val * 10)}%` }}
                        />
                      </div>
                      <span className="text-[9px] font-mono font-bold opacity-50 text-zinc-400 w-6 text-right">
                        {item.val.toFixed(1)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="absolute left-[7%] top-[58%] z-20 w-[58vw] max-w-[780px] rotate-[-3deg] origin-center opacity-60">
            <div className="p-4 rounded-[32px] border flex flex-col bg-[#000000] border-zinc-800 shadow-2xl shadow-black/40" onMouseMove={e => { const r = e.currentTarget.getBoundingClientRect(); setMousePos({ x: e.clientX - r.left, y: e.clientY - r.top }); }}>
              <div className="mb-3">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-black tracking-tight italic flex items-center gap-2 uppercase text-white">
                    <Clock size={18} className="text-jfx" />
                    Time-of-Day Performance
                  </h3>
                  <InfoTooltip content="Day vs Hour heatmap showing net P&L per trading hour across the week. Green = profitable, Red = loss-making." isDarkMode={true}>
                    <HelpCircle size={12} className="opacity-40 cursor-help hover:opacity-100 text-zinc-400" />
                  </InfoTooltip>
                </div>
                <p className="text-[9px] font-bold opacity-40 uppercase tracking-widest mt-1 ml-7 text-zinc-400">Day vs Hour Heatmap</p>
              </div>
              <div className="overflow-hidden">
                <div className="min-w-0">
                  <div className="flex mb-1 ml-12">
                    {Array.from({ length: 24 }, (_, h) => (
                      <div key={h} className="flex-1 text-center text-[8px] font-black opacity-60 tracking-wider text-zinc-300">
                        {h % 3 === 0 ? h.toString().padStart(2, '0') : ''}
                      </div>
                    ))}
                  </div>
                  <div className="space-y-[1px]">
                    {['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map(day => (
                      <div key={day} className="flex items-center">
                        <div className="w-12 text-[11px] font-black uppercase tracking-wider text-zinc-300 opacity-70 text-right pr-3">{day}</div>
                        <div className="flex-1 flex gap-[1px] h-6">
                          {Array.from({ length: 24 }, (_, hour) => {
                            const cell = timeOfDayHeatmap[day]?.[hour];
                            const pnl = cell?.pnl ?? 0;
                            const count = cell?.count ?? 0;
                            const maxAbs = 2000;
                            const opacity = count === 0 ? 0.03 : Math.min(0.9, 0.1 + (Math.abs(pnl) / maxAbs) * 0.8);
                            const bg = count === 0 ? 'rgba(255,255,255,0.03)' : pnl >= 0 ? `rgba(16,185,129,${opacity})` : `rgba(239,68,68,${opacity})`;
                            const isHovered = hoveredCell?.day === day && hoveredCell?.hour === hour;
                            return (
                              <div
                                key={hour}
                                className="flex-1 rounded-sm transition-all duration-100"
                                style={{
                                  backgroundColor: bg,
                                  transform: isHovered ? 'scaleY(1.3)' : 'scaleY(1)',
                                  boxShadow: isHovered ? '0 0 12px rgba(255,255,255,0.15)' : 'none',
                                }}
                                onMouseEnter={() => setHoveredCell({ day, hour })}
                                onMouseLeave={() => setHoveredCell(null)}
                              />
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="flex mt-1 ml-12">
                    {Array.from({ length: 24 }, (_, h) => (
                      <div key={h} className="flex-1 text-center">
                        <span className={`text-[6px] font-bold uppercase px-0.5 py-0.5 rounded ${
                          h >= 0 && h < 9 ? 'bg-amber-500/20 text-amber-400' :
                          h >= 9 && h < 15 ? 'bg-blue-500/20 text-blue-400' :
                          h >= 15 && h < 18 ? 'bg-purple-500/20 text-purple-400' :
                          'bg-orange-500/20 text-orange-400'
                        }`}>
                          {h >= 0 && h < 9 ? 'ASIA' : h >= 9 && h < 15 ? 'LON' : h >= 15 && h < 18 ? 'OVL' : 'NY'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
            {hoveredCell && timeOfDayHeatmap[hoveredCell.day]?.[hoveredCell.hour]?.count > 0 && (() => {
              const cell = timeOfDayHeatmap[hoveredCell.day][hoveredCell.hour];
              const avgPnl = cell.pnl / cell.count;
              return (
                <div
                  className="fixed pointer-events-none z-[9999] p-3 rounded-2xl border shadow-2xl backdrop-blur-xl"
                  style={{
                    left: mousePos.x + 320,
                    top: mousePos.y + 350,
                    backgroundColor: 'rgba(0, 0, 0, 0.95)',
                    borderColor: 'rgba(63, 63, 70, 0.5)',
                    minWidth: '180px'
                  }}
                >
                  <div className="flex items-center justify-between mb-2 pb-2 border-b border-zinc-500/10">
                    <div className="flex items-center gap-2">
                      <Clock size={12} className="text-indigo-500" />
                      <span className="font-black uppercase tracking-widest text-[9px] text-white">{hoveredCell.day} @ {hoveredCell.hour}:00</span>
                    </div>
                    <span className={`px-2 py-0.5 rounded text-[7px] font-black uppercase ${
                      hoveredCell.hour >= 0 && hoveredCell.hour < 9 ? 'bg-amber-500/20 text-amber-400' :
                      hoveredCell.hour >= 9 && hoveredCell.hour < 15 ? 'bg-blue-500/20 text-blue-400' :
                      hoveredCell.hour >= 15 && hoveredCell.hour < 18 ? 'bg-purple-500/20 text-purple-400' :
                      'bg-orange-500/20 text-orange-400'
                    }`}>
                      {hoveredCell.hour >= 0 && hoveredCell.hour < 9 ? 'ASIA' : hoveredCell.hour >= 9 && hoveredCell.hour < 15 ? 'LON' : hoveredCell.hour >= 15 && hoveredCell.hour < 18 ? 'OVL' : 'NY'}
                    </span>
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between items-center">
                      <span className="text-[8px] font-bold uppercase tracking-widest opacity-40 text-zinc-400">Net P&L</span>
                      <span className={cell.pnl >= 0 ? 'text-[10px] font-black text-emerald-500' : 'text-[10px] font-black text-rose-500'}>
                        {cell.pnl >= 0 ? '+' : ''}${Math.abs(cell.pnl).toLocaleString()}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-[8px] font-bold uppercase tracking-widest opacity-40 text-zinc-400">Trades</span>
                      <span className="text-[10px] font-black text-white">{cell.count}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-[8px] font-bold uppercase tracking-widest opacity-40 text-zinc-400">Avg P&L</span>
                      <span className={avgPnl >= 0 ? 'text-[10px] font-black text-emerald-500' : 'text-[10px] font-black text-rose-500'}>
                        {avgPnl >= 0 ? '+' : ''}${Math.abs(avgPnl).toFixed(0)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>

        </section>

        <section className="py-[200px] px-10 max-w-[1728px] mx-auto relative flex flex-col items-center text-center bg-[#FAF9F5]">
          <h2 className="text-[49px] leading-[1.1] tracking-[-0.03em] max-w-[1200px] font-bold text-[#1B1B1B] relative z-10">
            Every trade tells a story. The question is whether you are listening. JFX JOURNAL turns your trading data into a coherent narrative so you can stop guessing and start improving.
          </h2>
        </section>

        <PerformanceSequence />

        <section className="py-[120px] px-10 max-w-[1728px] mx-auto bg-[#FAF9F5]">
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,0.65fr)] gap-[40px] items-center">
            <div className="bg-gradient-to-tr from-[#E0EAFC] to-[#CFDEF3] rounded-[40px] p-8 h-[700px] flex items-center justify-center relative overflow-hidden border border-[#D7E0F3]/70 shadow-inner order-1 lg:order-2">
              <div className="w-full max-w-[520px] bg-white/80 backdrop-blur-xl rounded-[36px] shadow-2xl p-8 border border-white/50">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-[24px] h-[24px] rounded-full border border-[#1B1B1B] flex items-center justify-center shrink-0">
                    <span className="text-[#1B1B1B] font-bold text-[10px] leading-none">JFX</span>
                  </div>
                  <span className="text-[12px] font-bold text-[#8C8880]">JFX-JOURNAL</span>
                </div>
                <div className="bg-white rounded-[14px] p-4 mb-6 border border-[#E9E4DB] shadow-sm">
                  <p className="text-[15px] text-[#1B1B1B]">Review my last 10 trades and tell me what I am doing wrong on EUR/USD.</p>
                </div>
                <div className="flex justify-end">
                  <div className="w-8 h-8 rounded-full bg-[#FF6D6D] flex items-center justify-center shadow-md shadow-[#FF6D6D]/30">
                    <span className="material-symbols-outlined text-white text-sm">auto_awesome</span>
                  </div>
                </div>
              </div>
            </div>
            <div className="flex flex-col justify-center h-full w-full max-w-[760px] order-2 lg:order-1">
              <h3 className="text-[32px] leading-[1.2] tracking-[-0.02em] mb-12 font-bold text-[#1B1B1B]">
                Review, reflect, and refine - in seconds.
              </h3>
              <div className="relative pl-8 border-l-[3px] border-zinc-800 space-y-10">
                <div className="absolute left-[-3px] top-0 w-[3px] h-1/4 bg-jfx" />
                <div>
                  <h4 className="text-[24px] leading-[1.3] tracking-[-0.01em] font-bold mb-2 text-[#1B1B1B]">Automated Trade Analysis</h4>
                  <p className="text-[15px] leading-[1.6] text-[#8C8880]">Every trade reviewed against your rules automatically.</p>
                </div>
                <div className="opacity-60 hover:opacity-100 transition-opacity">
                  <h4 className="text-[24px] leading-[1.3] tracking-[-0.01em] font-bold mb-2 text-[#1B1B1B]">Psychology Insights</h4>
                  <p className="text-[15px] leading-[1.6] text-[#8C8880]">Track your mindset, emotions, and discipline over time.</p>
                </div>
                <div className="opacity-60 hover:opacity-100 transition-opacity">
                  <h4 className="text-[24px] leading-[1.3] tracking-[-0.01em] font-bold mb-2 text-[#1B1B1B]">Multi-Channel Sync</h4>
                  <p className="text-[15px] leading-[1.6] text-[#8C8880]">Desktop bridge, broker VPS, or manual entry - pick your flow.</p>
                </div>
                <div className="opacity-60 hover:opacity-100 transition-opacity">
                  <h4 className="text-[24px] leading-[1.3] tracking-[-0.01em] font-bold mb-2 text-[#1B1B1B]">Predictive Analytics</h4>
                  <p className="text-[15px] leading-[1.6] text-[#8C8880]">Surface patterns and probabilities from your own history.</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="solutions" className="py-[160px] px-10 max-w-[1728px] mx-auto flex flex-col items-center bg-[#FAF9F5]">
          <h2 className="text-[32px] leading-[1.2] tracking-[-0.02em] mb-12 font-bold text-center text-[#1B1B1B]">
            Built for every trader.
          </h2>
          <div className="flex flex-wrap justify-center gap-3 mb-16">
            <button className="px-6 py-2 rounded-full bg-jfx text-white text-sm font-semibold shadow-md shadow-jfx/20">Day Trader</button>
            <button className="px-6 py-2 rounded-full bg-zinc-900 text-zinc-300 text-sm font-semibold hover:bg-zinc-800 transition-colors shadow-sm border border-zinc-800">Swing Trader</button>
            <button className="px-6 py-2 rounded-full bg-zinc-900 text-zinc-300 text-sm font-semibold hover:bg-zinc-800 transition-colors shadow-sm border border-zinc-800">Scalper</button>
            <button className="px-6 py-2 rounded-full bg-zinc-900 text-zinc-300 text-sm font-semibold hover:bg-zinc-800 transition-colors shadow-sm border border-zinc-800">Position Trader</button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 w-full">
            {useCaseCards.map((card) => (
              <div key={card.title} className={`h-[400px] rounded-[32px] p-8 flex flex-col justify-between group overflow-hidden relative shadow-sm border ${card.shell}`}>
                <div className="relative z-10">
                  <h4 className="text-[24px] leading-[1.3] font-bold mb-2 text-white">{card.title}</h4>
                  <p className="text-[15px] leading-[1.6] text-zinc-400">{card.description}</p>
                </div>
                <div className={`absolute bottom-[-20px] right-[-20px] w-2/3 h-2/3 rounded-tl-3xl shadow-[0_8px_30px_rgb(0,0,0,0.3)] border border-zinc-800/50 p-6 transform group-hover:-translate-y-2 group-hover:-translate-x-2 transition-transform duration-500 ${card.title === 'Position Trader' ? 'bg-[#181818]' : 'bg-zinc-900'}`}>
                  <div className={`h-3 w-1/2 rounded-full mb-4 ${card.accent}`} />
                  <div className="h-2 w-full bg-zinc-700/50 rounded-full mb-3" />
                  <div className="h-2 w-5/6 bg-zinc-700/50 rounded-full mb-3" />
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="py-[160px] px-10 max-w-[1200px] mx-auto flex flex-col items-center text-center bg-[#FAF9F5]">
          <div className="mb-12 opacity-30 text-transparent bg-clip-text bg-gradient-to-r from-[#FF416C] to-[#FF4B2B]">
            <span className="material-symbols-outlined text-[64px]">format_quote</span>
          </div>
          <h2 className="text-[56px] leading-[1.1] font-bold tracking-[-0.03em] text-[#1B1B1B] mb-16 text-balance">
            JFX-JOURNAL completely changed how I review my trades. I finally see what is working and what is not.
          </h2>
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-[#D9D7D0] overflow-hidden shadow-md">
              <img className="w-full h-full object-cover" src="https://lh3.googleusercontent.com/aida-public/AB6AXuD_dQOYUXm-9ocUk-1cRA5ZyP6tu7OdWwNIU7SRhouWt3u89anzj3A5_pr7FGCCICOiz6a2FoSpC-bN53AYbiVQ-spgKPawBtGZtLq-9c6QyNclym7oEuOsCnQllJenEGuMkAeM3mwnTOLdgJakEE63ozCYcDA2l-C2EQnZiozAakUbDrwJG_jxTwrvV9I5p2oiVPXIDBv-rltdG9P0TX6X2OUHQcwckpskXXJEawplcI8ff_rzn1YnIDgrniF27Vjc0Lz4LKcazue9" />
            </div>
            <div className="text-left">
              <p className="text-sm font-bold text-[#1B1B1B]">Sarah Chen</p>
              <p className="text-xs text-[#8C8880]">Professional Trader, 8 years</p>
            </div>
          </div>
        </section>

        <section id="updates" className="py-[120px] px-10 max-w-[1728px] mx-auto bg-[#FAF9F5]">
          <div className="flex justify-between items-end mb-12">
            <h2 className="text-[32px] leading-[1.2] font-bold tracking-[-0.02em] text-[#1B1B1B]">Latest Updates</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {updates.map((item, index) => (
              <article key={item.title} className={`group rounded-[28px] p-8 border shadow-sm ${index === 0 ? 'bg-white border-[#D9D7D0]' : index === 1 ? 'bg-[#F4F3EF] border-[#D9D7D0]' : 'bg-black border-black'}`}>
                <p className={`text-[12px] uppercase tracking-[0.22em] mb-6 ${index === 2 ? 'text-white/50' : 'text-[#8C8880]'}`}>{item.meta}</p>
                <h3 className={`text-[24px] leading-[1.3] font-bold mb-3 ${index === 2 ? 'text-white' : 'text-[#1B1B1B]'}`}>{item.title}</h3>
                <p className={index === 2 ? 'text-white/70' : 'text-[#8C8880]'}>Product notes and field updates from the JFX-JOURNAL team.</p>
              </article>
            ))}
          </div>
        </section>

        <section className="py-[160px] px-10 max-w-[1200px] mx-auto flex flex-col items-center text-center bg-[#FAF9F5]">
          <h2 className="text-[56px] leading-[1.1] font-bold tracking-[-0.03em] text-[#1B1B1B] mb-8 text-balance">
            Start your trading journal journey.
          </h2>
          <button
            type="button"
            onClick={onEnterAuth}
            className="bg-jfx text-white px-8 py-4 rounded-full hover:bg-[#e64601] transition-colors font-semibold"
          >
            Start Free Trial
          </button>
        </section>

        <footer className="bg-gradient-to-b from-[#181818] to-[#0A0A0A] text-[#FAF9F5] w-full pt-12 pb-16 px-10 rounded-t-[40px] mt-0 relative overflow-hidden">
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
          <div className="max-w-[1728px] mx-auto w-full relative z-10">
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-12 w-full text-left border-t border-white/10 pt-16 text-white">
              <div className="flex flex-col gap-4">
                <h4 className="text-[12px] font-semibold uppercase tracking-[0.16em] text-white/50 mb-2">Product</h4>
                <a className="hover:text-white transition-colors text-white/80" href="#product">Features</a>
                <a className="hover:text-white transition-colors text-white/80" href="#product">Integrations</a>
                <a className="hover:text-white transition-colors text-white/80" href="#pricing">Pricing</a>
                <a className="hover:text-white transition-colors text-white/80" href="#updates">Changelog</a>
              </div>
              <div className="flex flex-col gap-4">
                <h4 className="text-[12px] font-semibold uppercase tracking-[0.16em] text-white/50 mb-2">Solutions</h4>
                <a className="hover:text-white transition-colors text-white/80" href="#solutions">Day Trading</a>
                <a className="hover:text-white transition-colors text-white/80" href="#solutions">Swing Trading</a>
                <a className="hover:text-white transition-colors text-white/80" href="#solutions">Scalping</a>
                <a className="hover:text-white transition-colors text-white/80" href="#solutions">Position Trading</a>
              </div>
              <div className="flex flex-col gap-4">
                <h4 className="text-[12px] font-semibold uppercase tracking-[0.16em] text-white/50 mb-2">Company</h4>
                <a className="hover:text-white transition-colors text-white/80" href="#about">About Us</a>
                <a className="hover:text-white transition-colors text-white/80" href="#updates">Blog</a>
                <a className="hover:text-white transition-colors text-white/80" href="#updates">Contact</a>
              </div>
              <div className="flex flex-col gap-4">
                <h4 className="text-[12px] font-semibold uppercase tracking-[0.16em] text-white/50 mb-2">Legal</h4>
                <a className="hover:text-white transition-colors text-white/80" href="#privacy">Privacy Policy</a>
                <a className="hover:text-white transition-colors text-white/80" href="#terms">Terms of Service</a>
                <a className="hover:text-white transition-colors text-white/80" href="#cookies">Cookie Policy</a>
              </div>
              <div className="flex flex-col gap-4">
                <h4 className="text-[12px] font-semibold uppercase tracking-[0.16em] text-white/50 mb-2">Social</h4>
                <a className="hover:text-white transition-colors text-white/80" href="#social">Twitter / X</a>
                <a className="hover:text-white transition-colors text-white/80" href="#social">LinkedIn</a>
                <a className="hover:text-white transition-colors text-white/80" href="#social">Instagram</a>
              </div>
              <div className="flex flex-col gap-4">
                <h4 className="text-[12px] font-semibold uppercase tracking-[0.16em] text-white/50 mb-2">Support</h4>
                <a className="hover:text-white transition-colors text-white/80" href="#support">Help Center</a>
                <a className="hover:text-white transition-colors text-white/80" href="#support">Community</a>
                <a className="hover:text-white transition-colors text-white/80" href="#support">API Docs</a>
              </div>
              <div className="flex flex-col gap-4">
                <h4 className="text-[12px] font-semibold uppercase tracking-[0.16em] text-white/50 mb-2">Security</h4>
                <a className="hover:text-white transition-colors text-white/80" href="#security">Trust Center</a>
                <a className="hover:text-white transition-colors text-white/80" href="#security">Compliance</a>
                <div className="flex items-center gap-2 text-white/80 hover:text-white transition-colors cursor-pointer">
                  <div className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.5)]" />
                  <span>Operational</span>
                </div>
              </div>
            </div>
            <div className="flex flex-col md:flex-row items-center justify-between w-full pt-8 text-white/50 text-sm border-t border-white/10 mt-16">
              <p>© 2025 JFX-JOURNAL. All rights reserved.</p>
            </div>
          </div>
        </footer>
      </main>
    </div>
  );
};

export default LandingPage;
