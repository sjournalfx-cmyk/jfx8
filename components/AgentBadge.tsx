import React from 'react';

// Outline robot badge for agent-executed trades: green when profitable, red
// when losing, grey at breakeven — rendered next to the pair name in the
// Trade Journal list (see Journal.tsx MobileTradeCard).
const strokeColor = (pnl: number): string =>
  pnl > 0 ? '#34d399' : pnl < 0 ? '#ff4f64' : '#a1a1aa';

export const AgentBadge: React.FC<{ pnl: number; className?: string }> = ({ pnl, className = '' }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    role="img"
    aria-label="Executed by agent"
    className={className}
  >
    <g stroke={strokeColor(pnl)} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      {/* antennae */}
      <path d="M8.6 6.6 6.8 3.9" />
      <path d="M15.4 6.6 17.2 3.9" />
      <circle cx="6.2" cy="3.3" r="0.9" />
      <circle cx="17.8" cy="3.3" r="0.9" />
      {/* head */}
      <rect x="4.4" y="6.6" width="15.2" height="12.4" rx="3.2" />
      {/* ears */}
      <path d="M2.6 11.2v3.4" />
      <path d="M21.4 11.2v3.4" />
      {/* eyes */}
      <circle cx="9.1" cy="11.6" r="1.15" fill={strokeColor(pnl)} stroke="none" />
      <circle cx="14.9" cy="11.6" r="1.15" fill={strokeColor(pnl)} stroke="none" />
      {/* mouth */}
      <path d="M9.4 15.6h5.2" />
    </g>
  </svg>
);

export default AgentBadge;
