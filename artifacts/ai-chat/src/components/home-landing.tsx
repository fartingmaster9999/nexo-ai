import { ArrowRight, ArrowUpRight, Code2, Compass, Lightbulb, Sparkles } from 'lucide-react';

type Prompt = { label: string; text: string };

type Props = {
  logoUrl: string;
  prompts: Prompt[];
  onStart: () => void;
  onPrompt: (text: string) => void;
};

const startingPoints = [
  { title: 'Make a clear plan', note: 'Turn a big week into a plan you can use.', prompt: 0, Icon: Compass },
  { title: 'Understand an idea', note: 'Get the clear version without jargon.', prompt: 1, Icon: Lightbulb },
  { title: 'Start building', note: 'Begin with a working code example.', prompt: 3, Icon: Code2 },
];

export function HomeLanding({ logoUrl, prompts, onStart, onPrompt }: Props) {
  return (
    <div className="home-landing" data-testid="home-landing">
      <div className="landing-topline">
        <span className="landing-wordmark"><img src={logoUrl} alt="" aria-hidden="true" /> NEXO AI</span>
      </div>

      <div className="landing-hero">
        <div className="landing-copy">
          <h1>Think clearly.<br /><span>Build boldly.</span></h1>
          <p className="landing-intro">
            Bring a question, a half-formed idea, or a line of code. Nexo helps you work through it and take the next step.
          </p>
          <div className="landing-actions">
            <button className="landing-primary" type="button" onClick={onStart} data-testid="button-start-from-home">
              Start a conversation <ArrowRight size={17} aria-hidden="true" />
            </button>
            <span className="landing-action-note">Your chat opens in a focused workspace.</span>
          </div>
        </div>

        <div className="landing-visual" aria-hidden="true">
          <div className="landing-orbit landing-orbit-outer" />
          <div className="landing-orbit landing-orbit-inner" />
          <div className="landing-glow" />
          <div className="landing-sphere"><img src={logoUrl} alt="" /></div>
          <div className="landing-preview">
            <div className="landing-preview-head">
              <span className="landing-window-dots"><i /><i /><i /></span>
              <span>IDEA → NEXT STEP</span>
            </div>
            <div className="landing-preview-question">How do I make room for focused work?</div>
            <div className="landing-preview-answer">
              <span className="landing-answer-mark"><Sparkles size={13} /></span>
              <span className="landing-answer-lines"><i /><i /><i /></span>
            </div>
            <div className="landing-preview-code"><span>01</span> <b>make_space</b>(<em>one thing at a time</em>)</div>
          </div>
          <div className="landing-float-card">
            <span className="landing-float-icon"><Code2 size={15} /></span>
            <span><b>From thought</b><small>to something real</small></span>
            <ArrowUpRight size={14} className="landing-float-arrow" />
          </div>
        </div>
      </div>

      <div className="landing-start-heading">
        <div><h2>What’s on your mind?</h2></div>
        <span className="landing-start-hint">Choose a prompt or write your own below.</span>
      </div>
      <div className="landing-prompts">
        {startingPoints.map(({ title, note, prompt, Icon }) => {
          const suggestion = prompts[prompt];
          return (
            <button
              className="landing-prompt"
              type="button"
              key={title}
              onClick={() => suggestion && onPrompt(suggestion.text)}
              data-testid={`home-prompt-${prompt}`}
            >
              <span className="landing-prompt-icon"><Icon size={17} aria-hidden="true" /></span>
              <span className="landing-prompt-copy"><b>{title}</b><small>{note}</small></span>
              <ArrowUpRight size={15} className="landing-prompt-arrow" aria-hidden="true" />
            </button>
          );
        })}
      </div>
    </div>
  );
}
