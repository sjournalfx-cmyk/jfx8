import React from 'react';
export const DesktopOnlyStub: React.FC<{ title?: string; description?: string; viewId?: string }> = ({ title = 'Available on Desktop', description, viewId }) => {
  const msg = description || (viewId === 'charts' || viewId === 'market-grid' ? 'Market Grid — live charts & watchlist — is desktop-only. Log and review trades here on mobile; open jfxjournal.site on your PC for charts. Data stays synced.' : 'This section is desktop-only. Open jfxjournal.site on a PC. Your trades & journal stay synced.');
  return (
    <div className="flex min-h-[60vh] w-full items-center justify-center bg-[#000000] p-4 pb-nav">
      <div className="w-full max-w-[360px] rounded-[24px] border border-zinc-800/80 bg-[#0a0a0a] p-6 text-center shadow-[0_8px_32px_rgba(0,0,0,0.5)]">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#FF4F01]/10 text-[#FF4F01] ring-1 ring-[#FF4F01]/15">◈</div>
        <h2 className="text-[11px] font-black tracking-[0.12em] text-white">{title.toUpperCase()}</h2>
        {viewId && <p className="mt-1 text-[10px] font-bold tracking-widest text-zinc-500">{viewId}</p>}
        <p className="mt-3 text-[13px] font-medium leading-6 text-zinc-400">{msg}</p>
        <div className="mt-5 rounded-2xl border border-zinc-800 bg-zinc-900/40 px-4 py-3 text-[11px] font-bold leading-relaxed text-zinc-500">Tip: Trades, Journal, Analytics & Notes work fully on mobile — charts stay on desktop.</div>
      </div>
    </div>
  );
};
