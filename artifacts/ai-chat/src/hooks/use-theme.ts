import { useEffect, useState } from 'react';

export type ThemeId = 'midnight' | 'graphite' | 'abyss' | 'paper' | 'dune';
export type AccentId = 'blue' | 'cyan' | 'violet' | 'emerald' | 'amber' | 'rose';

type Palette = Record<string, string>;
export const THEMES: { id: ThemeId; name: string; note: string; light: boolean; vars: Palette }[] = [
  { id: 'midnight', name: 'Midnight', note: 'The original black and blue', light: false, vars: {
    background: '240 4% 4.5%', foreground: '240 6% 93%', border: '240 4% 15%', card: '240 5% 7.5%', muted: '240 4% 11%',
    'muted-foreground': '240 5% 65%', secondary: '240 4% 12%', accent: '214 40% 16%', 'accent-foreground': '214 90% 82%',
    sidebar: '240 5% 6%', 'sidebar-border': '240 4% 12%', 'sidebar-accent': '240 4% 11%', 'code-bg': '240 5% 3.5%' } },
  { id: 'graphite', name: 'Graphite', note: 'Neutral charcoal, low glare', light: false, vars: {
    background: '230 6% 9%', foreground: '40 10% 90%', border: '230 5% 18%', card: '230 6% 12%', muted: '230 5% 15%',
    'muted-foreground': '230 5% 60%', secondary: '230 6% 17%', accent: '230 8% 21%', 'accent-foreground': '40 20% 92%',
    sidebar: '230 7% 7%', 'sidebar-border': '230 5% 15%', 'sidebar-accent': '230 6% 14%', 'code-bg': '230 8% 6%' } },
  { id: 'abyss', name: 'Abyss', note: 'Deep navy, ink-blue panels', light: false, vars: {
    background: '226 52% 9%', foreground: '210 40% 93%', border: '224 40% 19%', card: '226 48% 12%', muted: '224 40% 15%',
    'muted-foreground': '220 22% 64%', secondary: '224 46% 18%', accent: '222 55% 24%', 'accent-foreground': '205 90% 84%',
    sidebar: '227 56% 7%', 'sidebar-border': '224 40% 16%', 'sidebar-accent': '224 46% 14%', 'code-bg': '228 58% 6%' } },
  { id: 'paper', name: 'Paper', note: 'Cool daylight, blue ink', light: true, vars: {
    background: '216 30% 97%', foreground: '222 35% 12%', border: '216 22% 86%', card: '216 40% 99%', muted: '216 25% 93%',
    'muted-foreground': '220 12% 42%', secondary: '214 45% 92%', accent: '214 60% 90%', 'accent-foreground': '220 60% 28%',
    sidebar: '216 28% 94%', 'sidebar-border': '216 22% 86%', 'sidebar-accent': '216 30% 89%', 'code-bg': '220 30% 12%' } },
  { id: 'dune', name: 'Dune', note: 'Warm sand, quiet contrast', light: true, vars: {
    background: '38 38% 95%', foreground: '28 25% 14%', border: '35 22% 82%', card: '40 45% 97%', muted: '36 28% 90%',
    'muted-foreground': '30 10% 40%', secondary: '36 32% 89%', accent: '34 40% 86%', 'accent-foreground': '25 40% 24%',
    sidebar: '36 32% 91%', 'sidebar-border': '35 22% 82%', 'sidebar-accent': '36 28% 86%', 'code-bg': '28 22% 13%' } },
];

export const ACCENTS: { id: AccentId; name: string; hsl: string }[] = [
  { id: 'blue', name: 'Nexo blue', hsl: '214 95% 58%' },
  { id: 'cyan', name: 'Cyan', hsl: '190 85% 46%' },
  { id: 'violet', name: 'Violet', hsl: '258 78% 64%' },
  { id: 'emerald', name: 'Emerald', hsl: '156 62% 42%' },
  { id: 'amber', name: 'Amber', hsl: '36 92% 52%' },
  { id: 'rose', name: 'Rose', hsl: '346 78% 60%' },
];

const KEY = 'nexo-theme-v1';
type Saved = { theme: ThemeId; accent: AccentId };

function read(): Saved {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Saved>;
    return {
      theme: THEMES.some((t) => t.id === v.theme) ? v.theme as ThemeId : 'midnight',
      accent: ACCENTS.some((a) => a.id === v.accent) ? v.accent as AccentId : 'blue',
    };
  } catch { return { theme: 'midnight', accent: 'blue' }; }
}

export function useThemeSettings() {
  const [saved, setSaved] = useState<Saved>(read);
  const theme = THEMES.find((t) => t.id === saved.theme)!;
  useEffect(() => {
    const root = document.documentElement;
    const accent = ACCENTS.find((a) => a.id === saved.accent)!;
    Object.entries(theme.vars).forEach(([k, v]) => root.style.setProperty(`--${k}`, v));
    ['input', 'sidebar-border'].forEach(() => root.style.setProperty('--input', theme.vars.border));
    root.style.setProperty('--popover', theme.vars.card);
    ['card-foreground', 'popover-foreground', 'secondary-foreground', 'sidebar-foreground'].forEach((k) => root.style.setProperty(`--${k}`, theme.vars.foreground));
    ['primary', 'ring', 'sidebar-primary', 'sidebar-ring'].forEach((k) => root.style.setProperty(`--${k}`, accent.hsl));
    root.style.setProperty('--primary-foreground', theme.light ? '0 0% 99%' : '222 40% 6%');
    root.classList.toggle('dark', !theme.light);
    root.dataset.theme = theme.id;
    try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch { /* ignore */ }
  }, [saved, theme]);
  return {
    themeId: saved.theme, accentId: saved.accent, isLight: theme.light,
    setTheme: (t: ThemeId) => setSaved((s) => ({ ...s, theme: t })),
    setAccent: (a: AccentId) => setSaved((s) => ({ ...s, accent: a })),
  };
}
