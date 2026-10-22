// Guard: mobile-web pages must always scroll fully to the bottom, and the AI
// chat header must never be scrolled off screen. These are static checks on
// the layout contract; scripts/mobile-scroll-check.py does the live check.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

describe('mobile web scroll contract', () => {
  const layout = read('components/mobile/MobileLayout.tsx');
  const css = read('index.css');
  const chat = read('components/AIChat.tsx');

  it('app shell is sized to the visible viewport (dvh), not 100vh', () => {
    expect(layout).toMatch(/className="jfx-app-shell /);
    expect(layout).not.toMatch(/flex flex-col h-screen w-full/);
    expect(css).toMatch(/\.jfx-app-shell\s*\{[^}]*height:\s*100dvh/);
  });

  it('document never scrolls on mobile — only <main> does', () => {
    expect(css).toMatch(/body\.jfx-mobile\s*\{\s*height:\s*100%;\s*overflow:\s*hidden/);
  });

  it('every scrolling page ends with a bottom spacer that clears the nav', () => {
    expect(layout).toContain('data-testid="mobile-bottom-spacer"');
    expect(layout).toContain('--jfx-nav-h');
    // spacer must be the last child of <main>
    const end = layout.indexOf('</main>');
    const spacer = layout.lastIndexOf('mobile-bottom-spacer', end);
    expect(spacer).toBeGreaterThan(-1);
    expect(layout.slice(spacer, end)).not.toMatch(/currentView ===/);
  });

  it('bottom nav visibility has a single source of truth', () => {
    expect(layout).toMatch(/const showBottomNav =/);
    expect(layout).toMatch(/\{showBottomNav && \(/);
  });

  it('AI chat never uses scrollIntoView (it scrolls ancestors and hides the header)', () => {
    expect(chat.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/\.scrollIntoView\(/);
    expect(chat).toContain('scrollMessagesToEnd');
  });
});
