import assert from 'node:assert/strict';
import { withFixture, waitFor } from './browser-harness.mjs';

const themes = ['midnight', 'graphite', 'abyss', 'paper', 'dune'];

await withFixture('tests/theme.html', async ({ cdp, evaluate }) => {
  await waitFor(() => evaluate(`!!document.querySelector('[data-testid="dialog-settings"]') && !!document.querySelector('.cm-content')`), 'theme fixture and code editor');

  const readContrast = (selector, foregroundProperty, backgroundSelector, pseudo = '') => evaluate(`(() => {
    const parse = (text) => {
      const channels = text.match(/[\\d.]+/g)?.map(Number) ?? [];
      return channels.length >= 3 ? channels.slice(0, 3) : null;
    };
    const linear = (channel) => {
      const value = channel / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    };
    const luminance = (rgb) => 0.2126 * linear(rgb[0]) + 0.7152 * linear(rgb[1]) + 0.0722 * linear(rgb[2]);
    const foreground = parse(getComputedStyle(document.querySelector(${JSON.stringify(selector)}), ${JSON.stringify(pseudo)})[${JSON.stringify(foregroundProperty)}]);
    const background = parse(getComputedStyle(document.querySelector(${JSON.stringify(backgroundSelector)})).backgroundColor);
    if (!foreground || !background) return null;
    const [high, low] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
    return Number(((high + 0.05) / (low + 0.05)).toFixed(2));
  })()`);

  for (const theme of themes) {
    if (!await evaluate(`!!document.querySelector('[data-testid="dialog-settings"]')`)) {
      await evaluate(`document.querySelector('.top-btn').click()`);
      await waitFor(() => evaluate(`!!document.querySelector('[data-testid="dialog-settings"]')`), 'appearance dialog reopen');
    }
    await evaluate(`document.querySelector('[data-testid="theme-${theme}"]').click()`);
    await waitFor(() => evaluate(`document.documentElement.dataset.theme === ${JSON.stringify(theme)}`), `${theme} theme selection`);
    await evaluate(`document.querySelector('[data-testid="button-close-settings"]').click()`);
    await waitFor(() => evaluate(`!document.querySelector('[data-testid="dialog-settings"]')`), `${theme} appearance dialog close`);

    const checks = [
      ['home description', await readContrast('.landing-intro', 'color', 'body'), 4.5],
      ['home wordmark', await readContrast('.landing-wordmark', 'color', 'body'), 4.5],
      ['sidebar section label', await readContrast('.thread-heading', 'color', '.sidebar'), 4.5],
      ['sidebar recent conversation', await readContrast('.thread-select', 'color', '.sidebar'), 4.5],
      ['sidebar inactive conversation', await readContrast('.thread-select:not(.is-active)', 'color', '.sidebar'), 4.5],
      ['sidebar appearance control', await readContrast('.sidebar-settings', 'color', '.sidebar'), 4.5],
      ['composer placeholder', await readContrast('.composer textarea', 'color', '.composer-wrap', '::placeholder'), 4.5],
      ['home primary button', await readContrast('.landing-primary', 'color', '.landing-primary'), 4.5],
      ['workspace run button', await readContrast('.ws-btn.run', 'color', '.ws-btn.run'), 4.5],
      ['workspace console text', await readContrast('.ws-console', 'color', '.ws-console'), 4.5],
      ['workspace console status', await readContrast('.c-status', 'color', '.ws-console'), 4.5],
      ['code editor text', await readContrast('.cm-content', 'color', '.cm-editor'), 4.5],
    ];
    for (const [label, ratio, minimum] of checks) {
      assert.ok(ratio >= minimum, `${theme}: ${label} contrast ${ratio}:1 is below ${minimum}:1`);
    }

    const borders = await evaluate(`(() => {
      const ratio = (a, b) => {
        const lum = (value) => {
          const c = value.match(/[\\d.]+/g).map(Number).slice(0, 3).map((n) => {
            const v = n / 255;
            return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
          });
          return .2126 * c[0] + .7152 * c[1] + .0722 * c[2];
        };
        const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
        return (hi + .05) / (lo + .05);
      };
      const sidebar = getComputedStyle(document.querySelector('.sidebar'));
      const composer = getComputedStyle(document.querySelector('.composer-wrap'));
      return {
        sidebar: ratio(sidebar.borderRightColor, sidebar.backgroundColor),
        composer: ratio(composer.borderTopColor, composer.backgroundColor),
        topbar: ratio(getComputedStyle(document.querySelector('.topbar')).borderBottomColor, getComputedStyle(document.querySelector('.topbar')).backgroundColor),
        workspace: ratio(getComputedStyle(document.querySelector('.workspace')).borderLeftColor, getComputedStyle(document.querySelector('.workspace')).backgroundColor),
        language: ratio(getComputedStyle(document.querySelector('.ws-select')).borderColor, getComputedStyle(document.querySelector('.ws-select')).backgroundColor),
      };
    })()`);
    assert.ok(borders.sidebar >= 1.2, `${theme}: sidebar edge should remain visible (${borders.sidebar}:1)`);
    assert.ok(borders.composer >= 1.2, `${theme}: composer edge should remain visible (${borders.composer}:1)`);
    assert.ok(borders.topbar >= 1.2, `${theme}: topbar separator should remain visible (${borders.topbar}:1)`);
    assert.ok(borders.workspace >= 1.2, `${theme}: workspace edge should remain visible (${borders.workspace}:1)`);
    assert.ok(borders.language >= 1.2, `${theme}: workspace control border should remain visible (${borders.language}:1)`);

    await evaluate(`document.querySelector('.composer textarea').focus()`);
    const focus = await evaluate(`(() => {
      const wrap = document.querySelector('.composer-wrap');
      return { within: wrap.matches(':focus-within'), border: getComputedStyle(wrap).borderTopColor,
        accent: getComputedStyle(document.querySelector('.landing-primary')).backgroundColor,
        boxShadow: getComputedStyle(wrap).boxShadow };
    })()`);
    assert.equal(focus.within, true, `${theme}: composer should enter its focused state`);
    assert.match(focus.boxShadow, /rgba?\(/, `${theme}: composer focus ring should be visible`);
    assert.deepEqual(focus.border.match(/\d+/g)?.slice(0, 3), focus.accent.match(/\d+/g)?.slice(0, 3),
      `${theme}: focused composer border should use the theme accent`);
    const composerFocusContrast = await readContrast('.composer-wrap', 'borderTopColor', '.composer-wrap');
    assert.ok(composerFocusContrast >= 3, `${theme}: focused composer border contrast ${composerFocusContrast}:1 is below 3:1`);

    await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    const outline = await evaluate(`(() => {
      const button = document.activeElement;
      const style = getComputedStyle(button);
      return { width: style.outlineWidth, style: style.outlineStyle, color: style.outlineColor };
    })()`);
    assert.equal(await evaluate(`document.activeElement?.classList.contains('send-button')`), true, `${theme}: Tab should move focus to the send control`);
    assert.ok(Number.parseFloat(outline.width) >= 2, `${theme}: keyboard focus outline should be at least 2px`);
    assert.equal(outline.style, 'solid', `${theme}: keyboard focus outline style`);
    const focusContrast = await readContrast('.send-button', 'outlineColor', '.composer-wrap');
    assert.ok(focusContrast >= 3, `${theme}: keyboard focus outline contrast ${focusContrast}:1 is below 3:1`);
  }

  assert.equal(await evaluate(`localStorage.getItem('nexo-theme-v1') !== null`), true, 'Selected theme is persisted');
  await evaluate(`document.querySelector('.top-btn').click()`);
  await waitFor(() => evaluate(`!!document.querySelector('[data-testid="dialog-settings"]')`), 'appearance dialog for selected state');
  assert.deepEqual(await evaluate(`document.querySelectorAll('[role="radio"][aria-checked="true"]').length`), 2, 'One theme and one accent remain selected');
});
