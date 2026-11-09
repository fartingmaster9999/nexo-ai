import { useEffect, useState, type FormEvent } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Eye, EyeOff, KeyRound, X } from 'lucide-react';

export type PublicProviderKeys = {
  groq: string;
  gemini: string;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  keys: PublicProviderKeys;
  onSave: (keys: PublicProviderKeys) => void;
};

export function ProviderSettingsDialog({ open, onOpenChange, keys, onSave }: Props) {
  const [draft, setDraft] = useState(keys);
  const [showGroq, setShowGroq] = useState(false);
  const [showGemini, setShowGemini] = useState(false);

  useEffect(() => {
    if (open) setDraft(keys);
  }, [keys, open]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSave({ groq: draft.groq.trim(), gemini: draft.gemini.trim() });
    onOpenChange(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="nx-overlay" />
        <Dialog.Content className="nx-dialog public-settings-dialog" data-testid="dialog-provider-settings">
          <div className="nx-dialog-head">
            <Dialog.Title className="nx-dialog-title">Settings</Dialog.Title>
            <Dialog.Close className="icon-btn" aria-label="Close settings" data-testid="button-close-provider-settings">
              <X size={16} />
            </Dialog.Close>
          </div>
          <Dialog.Description className="nx-dialog-desc">
            Connect your own providers. Groq is required; Gemini adds image understanding and more Agent capabilities.
          </Dialog.Description>

          <form onSubmit={submit}>
            <label className="public-key-field" htmlFor="public-groq-key">
              <span className="public-key-label">Groq API key <span>Required</span></span>
              <span className="public-key-input-wrap">
                <KeyRound size={15} aria-hidden="true" />
                <input
                  id="public-groq-key"
                  type={showGroq ? 'text' : 'password'}
                  autoComplete="off"
                  spellCheck={false}
                  value={draft.groq}
                  onChange={(event) => setDraft((current) => ({ ...current, groq: event.target.value }))}
                  placeholder="Paste your Groq key"
                  data-testid="input-groq-api-key"
                />
                <button type="button" aria-label={showGroq ? 'Hide Groq key' : 'Show Groq key'}
                  onClick={() => setShowGroq((shown) => !shown)} data-testid="button-toggle-groq-key-visibility">
                  {showGroq ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </span>
              <a href="https://console.groq.com/keys" target="_blank" rel="noreferrer">Create a key in Groq Console</a>
            </label>

            <label className="public-key-field" htmlFor="public-gemini-key">
              <span className="public-key-label">Gemini API key <span>Optional</span></span>
              <span className="public-key-input-wrap">
                <KeyRound size={15} aria-hidden="true" />
                <input
                  id="public-gemini-key"
                  type={showGemini ? 'text' : 'password'}
                  autoComplete="off"
                  spellCheck={false}
                  value={draft.gemini}
                  onChange={(event) => setDraft((current) => ({ ...current, gemini: event.target.value }))}
                  placeholder="Add Gemini for expanded features"
                  data-testid="input-gemini-api-key"
                />
                <button type="button" aria-label={showGemini ? 'Hide Gemini key' : 'Show Gemini key'}
                  onClick={() => setShowGemini((shown) => !shown)} data-testid="button-toggle-gemini-key-visibility">
                  {showGemini ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </span>
              <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">Create a key in Google AI Studio</a>
            </label>

            <p className="public-key-privacy" data-testid="text-key-storage-note">
              Keys stay in this browser and are sent over HTTPS only with model requests. They are not saved in Nexo’s database. Avoid saving keys on shared devices.
            </p>
            <div className="public-key-actions">
              <button type="button" className="public-key-cancel" onClick={() => onOpenChange(false)} data-testid="button-cancel-provider-settings">Cancel</button>
              <button type="submit" className="public-key-save" data-testid="button-save-provider-settings">Save keys</button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
