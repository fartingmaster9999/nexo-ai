import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { ReplyStatus, type ReplyMode } from '../src/components/answer-details';
import '../src/nexo.css';
import '../src/refine.css';
import '../src/motion.css';

const cases: Array<{ mode: ReplyMode; compact: boolean }> = [
  { mode: 'normal', compact: false },
  { mode: 'normal', compact: true },
  { mode: 'deep', compact: false },
  { mode: 'deep', compact: true },
  { mode: 'search', compact: false },
  { mode: 'search', compact: true },
];

function Fixture() {
  return (
    <>
      {cases.map(({ mode, compact }) => {
        const name = `${mode}-${compact ? 'compact' : 'full'}`;
        return (
          <div className="fixture-case" data-case={name} key={name} data-testid={name}>
            <ReplyStatus mode={mode} compact={compact} />
          </div>
        );
      })}
      <div className="term is-live">
        <span className="term-ellipsis" aria-hidden="true" />
        <div className="agent-activity-list">
          {['running', 'complete', 'error'].map((status) => (
            <div key={status} className={`agent-activity-item status-${status}`}>
              <span className="agent-activity-dot" aria-hidden="true" />
              <span>{status}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

const root = createRoot(document.getElementById('fixture')!);
let revision = 0;
function render() {
  root.render(
    <div data-stream-revision={revision}>
      <Fixture />
    </div>,
  );
}

render();

Object.assign(window, {
  __triggerStreamRerenders(count: number) {
    for (let i = 0; i < count; i += 1) {
      flushSync(() => {
        revision += 1;
        render();
      });
    }
  },
  __verifyReplyStatusFixture() {
    const errors: string[] = [];
    const runningDot = document.querySelector('.status-running .agent-activity-dot')!;
    if (getComputedStyle(runningDot).animationName !== 'rsTmDot') {
      errors.push('Agent running marker is not animated');
    }
    for (const status of ['complete', 'error']) {
      if (getComputedStyle(document.querySelector(`.status-${status} .agent-activity-dot`)!).animationName !== 'none') {
        errors.push(`Agent ${status} marker must be static`);
      }
    }
    if (getComputedStyle(document.querySelector('.term-ellipsis')!, '::after').animationName !== 'rsTmLabel') {
      errors.push('The live header ellipsis is not animated');
    }
    const cases = [...document.querySelectorAll<HTMLElement>('.fixture-case')];
    const geometries = cases.map((fixtureCase) => {
      const status = fixtureCase.querySelector<HTMLElement>('.reply-status')!;
      const figure = status.querySelector<HTMLElement>('.rs-fig')!;
      const rect = figure.getBoundingClientRect();
      const compact = fixtureCase.dataset.case?.endsWith('-compact');
      const mode = fixtureCase.dataset.case?.split('-')[0];
      const expectedName =
        mode === 'search'
          ? 'Searching the web'
          : mode === 'deep'
            ? 'Deepthink is working'
            : 'Working on it';

      if (status.getAttribute('role') !== 'status') errors.push(`${fixtureCase.dataset.case}: missing status role`);
      if (status.getAttribute('aria-label') !== expectedName) errors.push(`${fixtureCase.dataset.case}: incorrect accessible name`);
      if (figure.getAttribute('aria-hidden') !== 'true') errors.push(`${fixtureCase.dataset.case}: decorative figure is not hidden`);
      if (Math.abs(rect.width - (compact ? 22 : 28)) > 0.1) errors.push(`${fixtureCase.dataset.case}: unexpected indicator width ${rect.width}`);
      if (Math.abs(rect.height - (compact ? 22 : 28)) > 0.1) errors.push(`${fixtureCase.dataset.case}: unexpected indicator height ${rect.height}`);
      if (compact && status.querySelector('.rs-label')) errors.push(`${fixtureCase.dataset.case}: compact label should be visually omitted`);
      if (!compact && status.querySelector('.rs-label')?.textContent !== expectedName) errors.push(`${fixtureCase.dataset.case}: full label is missing`);

      return {
        name: fixtureCase.dataset.case,
        width: rect.width,
        height: rect.height,
        status,
        figure,
        compact,
        mode,
      };
    });

    const originalStatusNodes = geometries.map((item) => item.status);
    const originalFigureNodes = geometries.map((item) => item.figure);
    const originalSizes = geometries.map((item) => ({ width: item.width, height: item.height }));
    (window as any).__triggerStreamRerenders(32);
    if (document.querySelector('[data-stream-revision]')?.getAttribute('data-stream-revision') !== '32') {
      errors.push('stream rerenders did not reach the requested revision');
    }
    geometries.forEach((item, index) => {
      const fixtureCase = document.querySelector<HTMLElement>(`[data-testid="${item.name}"]`)!;
      const status = fixtureCase.querySelector<HTMLElement>('.reply-status')!;
      const figure = status.querySelector<HTMLElement>('.rs-fig')!;
      const rect = figure.getBoundingClientRect();
      if (status !== originalStatusNodes[index] || figure !== originalFigureNodes[index]) {
        errors.push(`${item.name}: indicator nodes changed during streamed rerenders`);
      }
      if (Math.abs(rect.width - originalSizes[index].width) > 0.1 || Math.abs(rect.height - originalSizes[index].height) > 0.1) {
        errors.push(`${item.name}: indicator geometry changed during streamed rerenders`);
      }
    });

    const loopNames = new Set(['rsTmDepth', 'rsTmP1', 'rsTmP2', 'rsTmP3', 'rsTmBrain', 'rsTmSpin', 'rsTmNode', 'rsTmOrbit', 'rsTmCounter', 'rsTmMer']);
    const loopSamples: Array<{ name: string; animation: string; delta: number }> = [];
    for (const item of geometries) {
      const animations = item.figure.getAnimations({ subtree: true }) as CSSAnimation[];
      for (const animation of animations) {
        if (!loopNames.has(animation.animationName)) continue;
        const duration = Number(animation.effect?.getTiming().duration);
        if (!Number.isFinite(duration) || duration <= 0) {
          errors.push(`${item.name}: ${animation.animationName} has no finite loop duration`);
          continue;
        }
        animation.pause();
        animation.currentTime = 0;
        const start = getComputedStyle(animation.effect!.target as Element).transform;
        animation.currentTime = duration - 0.01;
        const end = getComputedStyle(animation.effect!.target as Element).transform;
        const startMatrix = new DOMMatrixReadOnly(start);
        const endMatrix = new DOMMatrixReadOnly(end);
        const delta = Math.max(...startMatrix.toFloat64Array().map((value, index) => Math.abs(value - endMatrix.toFloat64Array()[index])));
        loopSamples.push({ name: item.name, animation: animation.animationName, delta });
        if (delta > 0.002) errors.push(`${item.name}: ${animation.animationName} loop endpoints differ by ${delta}`);
      }
    }
    for (const [mode, required] of [
      ['normal', ['rsTmDepth', 'rsTmP1', 'rsTmP2', 'rsTmP3']],
      ['deep', ['rsTmBrain', 'rsTmSpin', 'rsTmNode']],
      ['search', ['rsTmOrbit', 'rsTmCounter', 'rsTmMer']],
    ] as const) {
      for (const animation of required) {
        if (!loopSamples.some((sample) => sample.name.startsWith(`${mode}-`) && sample.animation === animation)) {
          errors.push(`${mode}: expected ${animation} endpoint check did not run`);
        }
      }
    }

    return {
      errors,
      geometry: geometries.map(({ name, width, height }) => ({ name, width, height })),
      loopSamples,
    };
  },
  __verifyReducedMotion() {
    const errors: string[] = [];
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
      errors.push('reduced-motion preference was not enabled in the browser');
    }
    const runningDot = document.querySelector('.status-running .agent-activity-dot')!;
    if (getComputedStyle(runningDot).animationName !== 'none' ||
        getComputedStyle(runningDot, '::after').animationName !== 'none' ||
        getComputedStyle(document.querySelector('.term-ellipsis')!, '::after').animationName !== 'none') {
      errors.push('Agent activity or header ellipsis still animates with reduced motion');
    }
    for (const fixtureCase of document.querySelectorAll<HTMLElement>('.fixture-case')) {
      const name = fixtureCase.dataset.case ?? 'unknown';
      const status = fixtureCase.querySelector<HTMLElement>('.reply-status')!;
      const label = status.querySelector<HTMLElement>('.rs-label');
      const figure = status.querySelector<HTMLElement>('.rs-fig')!;
      if (getComputedStyle(status).animationName !== 'none') errors.push(`${name}: status still animates with reduced motion`);
      if (label && (getComputedStyle(label).animationName !== 'none' || getComputedStyle(label).backgroundImage !== 'none')) {
        errors.push(`${name}: label is not static with reduced motion`);
      }
      for (const element of [figure, ...figure.querySelectorAll<HTMLElement>('*')]) {
        if (getComputedStyle(element).animationName !== 'none') errors.push(`${name}: ${element.className || element.tagName} still animates with reduced motion`);
      }
      if (status.getAttribute('role') !== 'status' || !status.getAttribute('aria-label')) {
        errors.push(`${name}: accessible status was lost with reduced motion`);
      }
    }
    return { errors };
  },
  __verifyMotionRestored() {
    const errors: string[] = [];
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) errors.push('reduced-motion preference was not cleared');
    const expected = ['rsTmDepth', 'rsTmOrbit', 'rsTmCounter', 'rsTmSpin', 'rsTmP2', 'rsTmBrain', 'rsTmNode', 'rsTmDot'];
    for (const animationName of expected) {
      if (!document.getAnimations().some((animation) => (animation as CSSAnimation).animationName === animationName)) {
        errors.push(`${animationName} did not resume after reduced motion was disabled`);
      }
    }
    return { errors };
  },
  __replyStatusFixtureReady: true,
});
