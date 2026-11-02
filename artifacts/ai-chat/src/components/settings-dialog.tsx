import * as Dialog from '@radix-ui/react-dialog';
import { Check, X } from 'lucide-react';
import { ACCENTS, THEMES, type AccentId, type ThemeId } from '@/hooks/use-theme';

type Props = {
  open: boolean; onOpenChange: (v: boolean) => void;
  themeId: ThemeId; accentId: AccentId; setTheme: (t: ThemeId) => void; setAccent: (a: AccentId) => void;
};

export function SettingsDialog({ open, onOpenChange, themeId, accentId, setTheme, setAccent }: Props) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="nx-overlay" />
        <Dialog.Content className="nx-dialog" data-testid="dialog-settings">
          <div className="nx-dialog-head">
            <Dialog.Title className="nx-dialog-title">Appearance</Dialog.Title>
            <Dialog.Close className="icon-btn" aria-label="Close settings" data-testid="button-close-settings"><X size={16} /></Dialog.Close>
          </div>
          <Dialog.Description className="nx-dialog-desc">Themes change the whole workspace. Saved on this device.</Dialog.Description>
          <div className="nx-group-label" id="theme-label">Theme</div>
          <div className="theme-grid" role="radiogroup" aria-labelledby="theme-label">
            {THEMES.map((t) => (
              <button key={t.id} type="button" role="radio" aria-checked={themeId === t.id}
                className={`theme-card ${themeId === t.id ? 'is-on' : ''}`} onClick={() => setTheme(t.id)} data-testid={`theme-${t.id}`}>
                <span className="theme-swatch" style={{ background: `hsl(${t.vars.background})`, borderColor: `hsl(${t.vars.border})` }}>
                  <i style={{ background: `hsl(${t.vars.sidebar})` }} />
                  <b style={{ background: `hsl(${t.vars.card})`, borderColor: `hsl(${t.vars.border})` }} />
                  <em style={{ background: 'hsl(var(--primary))' }} />
                </span>
                <span className="theme-name">{t.name}{themeId === t.id && <Check size={13} aria-hidden="true" />}</span>
                <span className="theme-note">{t.note}</span>
              </button>
            ))}
          </div>
          <div className="nx-group-label" id="accent-label">Accent</div>
          <div className="accent-row" role="radiogroup" aria-labelledby="accent-label">
            {ACCENTS.map((a) => (
              <button key={a.id} type="button" role="radio" aria-checked={accentId === a.id} aria-label={a.name} title={a.name}
                className={`accent-dot ${accentId === a.id ? 'is-on' : ''}`} style={{ background: `hsl(${a.hsl})` }}
                onClick={() => setAccent(a.id)} data-testid={`accent-${a.id}`} />
            ))}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
