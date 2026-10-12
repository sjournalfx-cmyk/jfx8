import React from 'react';
// Bundled directly from the repo-root LOGO.jpg so the new brand mark ships
// with the JS bundle (no public/ copy step needed for in-app use).
// @ts-ignore - vite/client handles .jpg, keep building even without it
import logoSrc from '../../LOGO.jpg';

interface AppLogoProps {
  /** pixel size of the square tile */
  size?: number;
  /** corner radius — 28% matches the iOS squircle at small sizes */
  radius?: number | string;
  className?: string;
  /** inner padding as % of tile — keeps arrow tip + pen nib inside the
   *  Android adaptive-icon safe zone and iOS rounded-corner mask */
  paddingPct?: number;
}

/**
 * AppLogo — single source of truth for the JFX brand mark.
 * White tile + `object-contain` + safe padding so the tall LOGO.jpg artwork
 * never clips in headers, drawers, loaders or the phone launcher.
 */
export const AppLogo: React.FC<AppLogoProps> = ({
  size = 48,
  radius = '28%',
  className = '',
  paddingPct = 9,
}) => {
  return (
    <div
      className={`relative shrink-0 overflow-hidden bg-white shadow-[0_2px_12px_rgba(0,0,0,0.45)] ring-1 ring-white/20 ${className}`}
      style={{ width: size, height: size, borderRadius: radius }}
      aria-label="JFX Journal logo"
      role="img"
    >
      <img
        src={logoSrc}
        alt="JFX Journal"
        draggable={false}
        className="absolute inset-0 m-auto"
        style={{
          width: `${100 - paddingPct * 2}%`,
          height: `${100 - paddingPct * 2}%`,
          objectFit: 'contain',
          objectPosition: 'center',
        }}
      />
    </div>
  );
};

export default AppLogo;
