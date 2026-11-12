import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { Switch } from '@/components/ui/switch';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agentMode: boolean;
  deepthink: boolean;
  compareAgentMode: boolean;
  streaming: boolean;
  publicKeyMode: boolean;
  geminiConfigured: boolean;
  onCompareChange: (enabled: boolean) => void;
  onOpenProviderSettings: () => void;
};

export function AgentSettingsDialog({
  open,
  onOpenChange,
  agentMode,
  deepthink,
  compareAgentMode,
  streaming,
  publicKeyMode,
  geminiConfigured,
  onCompareChange,
  onOpenProviderSettings,
}: Props) {
  const canCompare = agentMode && deepthink;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="nx-overlay" />
        <Dialog.Content className="nx-dialog agent-settings-dialog" data-testid="dialog-agent-settings">
          <div className="nx-dialog-head">
            <Dialog.Title className="nx-dialog-title">Agent settings</Dialog.Title>
            <Dialog.Close className="icon-btn" aria-label="Close Agent settings" data-testid="button-close-agent-settings">
              <X size={16} />
            </Dialog.Close>
          </div>
          <Dialog.Description className="nx-dialog-desc">
            Configure how Agent handles coding requests. These settings are separate from the Deepthink control.
          </Dialog.Description>

          <section className="agent-setting-card" aria-labelledby="compare-agent-label">
            <div className="agent-setting-copy">
              <div className="agent-setting-title" id="compare-agent-label">Compare Agent Mode</div>
              <p id="compare-agent-description">
                For new coding requests, compare three Qwen drafts with two GPT-OSS drafts. Each model selects its strongest draft, then Gemini Decision 1 scores the finalists for correctness, completeness, usability, maintainability, and safety.
              </p>
              <p className="agent-setting-note">
                Only the winner is sent to the workspace. Requires access to gemini-decision-1 and can use up to 8 comparison calls, plus safety checks. Scores review source quality; they do not prove the code ran.
              </p>
              {!canCompare && (
                <p className="agent-setting-requirement">
                  Turn on both Agent and Deepthink in the composer to use this setting.
                </p>
              )}
              {publicKeyMode && !geminiConfigured && (
                <button
                  type="button"
                  className="agent-setting-link"
                  onClick={onOpenProviderSettings}
                  data-testid="button-agent-settings-gemini-key"
                >
                  Add a Gemini API key
                </button>
              )}
            </div>
            <Switch
              aria-label="Compare Agent Mode"
              aria-describedby="compare-agent-description"
              checked={compareAgentMode}
              disabled={!canCompare || streaming || (publicKeyMode && !geminiConfigured)}
              onCheckedChange={onCompareChange}
              data-testid="switch-compare-agent"
            />
          </section>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
