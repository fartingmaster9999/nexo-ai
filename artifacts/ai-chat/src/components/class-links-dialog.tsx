import * as Dialog from '@radix-ui/react-dialog';
import { Download, FileUp, Link2, Plus, Trash2, X } from 'lucide-react';
import { useRef, useState, type FormEvent, type ChangeEvent } from 'react';
import { createClassLink, parseClassLinksImport, type ClassLink } from '@/lib/class-links';
import './class-links.css';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  links: ClassLink[];
  onChange: (links: ClassLink[]) => void;
};

function describeError(error: unknown) {
  return error instanceof Error ? error.message : 'The class links could not be saved.';
}

export function ClassLinksDialog({ open, onOpenChange, links, onChange }: Props) {
  const importRef = useRef<HTMLInputElement>(null);
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  const [aliases, setAliases] = useState('');
  const [feedback, setFeedback] = useState('');

  const addLink = (event: FormEvent) => {
    event.preventDefault();
    try {
      const link = createClassLink(label, url, aliases);
      onChange([...links, link]);
      setLabel('');
      setUrl('');
      setAliases('');
      setFeedback(`${link.label} saved on this device.`);
    } catch (error) {
      setFeedback(describeError(error));
    }
  };

  const importFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    try {
      const imported = parseClassLinksImport(await file.text());
      const existing = new Set(links.map((link) => `${link.label.toLowerCase()}::${link.url}`));
      const additions = imported.filter((link) => !existing.has(`${link.label.toLowerCase()}::${link.url}`));
      onChange([...links, ...additions]);
      setFeedback(additions.length
        ? `Imported ${additions.length} class links to this device.`
        : 'Those class links are already saved here.');
    } catch (error) {
      setFeedback(describeError(error));
    }
  };

  const removeLink = (id: string) => {
    try {
      onChange(links.filter((link) => link.id !== id));
      setFeedback('Class link removed.');
    } catch (error) {
      setFeedback(describeError(error));
    }
  };

  const exportLinks = () => {
    try {
      const file = new Blob([JSON.stringify({ version: 1, links }, null, 2)], { type: 'application/json' });
      const href = URL.createObjectURL(file);
      const anchor = document.createElement('a');
      anchor.href = href;
      anchor.download = 'nexo-class-links.json';
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(href), 1000);
      setFeedback('Class links exported.');
    } catch (error) {
      setFeedback(describeError(error));
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="nx-overlay" />
        <Dialog.Content className="nx-dialog class-links-dialog" data-testid="dialog-class-links">
          <div className="nx-dialog-head">
            <Dialog.Title className="nx-dialog-title">Class links</Dialog.Title>
            <Dialog.Close className="icon-btn" aria-label="Close class links" data-testid="button-close-class-links">
              <X size={16} />
            </Dialog.Close>
          </div>
          <Dialog.Description className="nx-dialog-desc">
            Save course links on this device. Ask Nexo to open a class, stream, or classwork page by name.
          </Dialog.Description>

          <div className="class-links-tools">
            <button type="button" className="class-links-secondary" onClick={() => importRef.current?.click()}>
              <FileUp size={15} aria-hidden="true" /> Import links
            </button>
            <button type="button" className="class-links-secondary" onClick={exportLinks} disabled={!links.length}>
              <Download size={15} aria-hidden="true" /> Export backup
            </button>
            <input
              ref={importRef}
              className="class-links-file-input"
              type="file"
              accept=".json,application/json"
              aria-label="Import a Nexo class links JSON file"
              onChange={(event) => void importFile(event)}
            />
          </div>

          {links.length ? (
            <ul className="class-links-list" aria-label="Saved class links">
              {links.map((link) => (
                <li className="class-link-row" key={link.id}>
                  <div className="class-link-copy">
                    <strong>{link.label}</strong>
                    <span className="class-link-url">{link.url}</span>
                    {link.aliases.length > 0 && <span className="class-link-aliases">Say: {link.aliases.join(', ')}</span>}
                  </div>
                  <button
                    type="button"
                    className="icon-btn class-link-remove"
                    aria-label={`Remove ${link.label}`}
                    title={`Remove ${link.label}`}
                    onClick={() => removeLink(link.id)}
                  >
                    <Trash2 size={15} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="class-links-empty">
              <Link2 size={18} aria-hidden="true" />
              <span>Import your links file or add a course link below.</span>
            </div>
          )}

          <form className="class-links-form" onSubmit={addLink}>
            <div className="class-links-form-title">Add a link</div>
            <label>
              Link name
              <input value={label} onChange={(event) => setLabel(event.target.value)} maxLength={120} placeholder="English classwork" required />
            </label>
            <label>
              Website address
              <input value={url} onChange={(event) => setUrl(event.target.value)} maxLength={2048} placeholder="https://classroom.google.com/..." required />
            </label>
            <label>
              Alternate names <span>(comma-separated)</span>
              <input value={aliases} onChange={(event) => setAliases(event.target.value)} placeholder="English assignments, ELA work" />
            </label>
            <button className="class-links-add" type="submit"><Plus size={15} aria-hidden="true" /> Add link</button>
          </form>

          <p className="class-links-feedback" role="status" aria-live="polite">{feedback}</p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
