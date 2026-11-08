import type { Ref } from 'react';
import { ArrowRight, BookOpen, Code2, ListChecks, PanelLeft } from 'lucide-react';
import './home-welcome.css';

type Prompt = { label: string; text: string };

type Props = {
  logoUrl: string;
  prompts: Prompt[];
  onStart: () => void;
  onPrompt: (text: string) => void;
  onOpenHistory?: (trigger: HTMLButtonElement) => void;
  historyOpen?: boolean;
  headingRef?: Ref<HTMLHeadingElement>;
};

const startingPoints = [
  { title: 'Sort out a busy week', note: 'Turn a pile of tasks into an order you can follow.', prompt: 0, request: null, Icon: ListChecks },
  { title: 'Understand something', note: 'A plain explanation with one good example.', prompt: 1, request: null, Icon: BookOpen },
  { title: 'Build a small app', note: 'Working code you can run in the workspace.', prompt: 3, request: 'Build a small, responsive task list app in HTML, CSS and JavaScript with working add, complete, and delete controls. Make it run locally in the Nexo workspace without external services.', Icon: Code2 },
];

export function HomeLanding({ logoUrl, prompts, onStart, onPrompt, onOpenHistory, historyOpen = false, headingRef }: Props) {
  return (
    <div className="home-landing nx-welcome" data-testid="home-landing">
      <div className="nx-top nx-in" style={{ ['--d' as string]: '0ms' }}>
        <button
          className="nx-history"
          type="button"
          onClick={(event) => onOpenHistory?.(event.currentTarget)}
          aria-label={historyOpen ? 'Close conversation history' : 'Open conversation history'}
          aria-expanded={historyOpen}
          aria-controls="history-sidebar"
          data-testid="button-home-history"
        >
          <PanelLeft size={15} aria-hidden="true" />
          <span>Past conversations</span>
        </button>
      </div>

      <div className="nx-center">
        <button className="nx-mark nx-in" style={{ ['--d' as string]: '40ms' }}
          type="button" onClick={(event) => onOpenHistory?.(event.currentTarget)}
          aria-label={historyOpen ? 'Close conversation history' : 'Open conversation history'}
          aria-expanded={historyOpen} aria-controls="history-sidebar">
          <img src={logoUrl} alt="" aria-hidden="true" />
        </button>
        <p className="nx-hello nx-in" style={{ ['--d' as string]: '90ms' }}>Welcome to Nexo</p>
        <h1 ref={headingRef} tabIndex={-1} className="nx-title nx-in" style={{ ['--d' as string]: '130ms' }}>
          What's on your mind<span className="nx-accent"> today?</span>
        </h1>
        <p className="nx-intro nx-in" style={{ ['--d' as string]: '190ms' }}>
          Start with a question or a rough idea. We can think it through together, learn something, write it up, or build it into an app you can run.
        </p>
        <div className="nx-actions nx-in" style={{ ['--d' as string]: '240ms' }}>
          <button className="nx-primary" type="button" onClick={onStart} data-testid="button-start-from-home">
            Start a conversation
            <ArrowRight size={16} aria-hidden="true" />
          </button>
          <span className="nx-note">or type in the box below</span>
        </div>
      </div>

      <section className="nx-starts" aria-labelledby="nx-starts-label">
        <h2 id="nx-starts-label" className="nx-starts-label nx-in" style={{ ['--d' as string]: '300ms' }}>Not sure where to begin? Try one of these</h2>
        <div className="nx-start-list">
          {startingPoints.map(({ title, note, prompt, request, Icon }, i) => {
            const suggestion = prompts[prompt];
            return (
              <button
                className="nx-start nx-in"
                style={{ ['--d' as string]: `${340 + i * 60}ms` }}
                type="button"
                key={title}
                disabled={!suggestion}
                onClick={() => suggestion && onPrompt(request ?? suggestion.text)}
                data-testid={`home-prompt-${prompt}`}
              >
                <span className="nx-start-icon"><Icon size={17} aria-hidden="true" /></span>
                <span className="nx-start-copy"><b>{title}</b><small>{note}</small></span>
                <ArrowRight size={15} className="nx-start-arrow" aria-hidden="true" />
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
