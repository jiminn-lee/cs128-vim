const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, message = 'Timed out waiting for the extension') {
  const deadline = Date.now() + 3500;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(message);
    await pause(20);
  }
}
function assert(condition, message) { if (!condition) throw new Error(message); }
function eq(actual, expected, message) {
  if (actual === expected) return;
  const describe = value => typeof value === 'object' ? String(value) : JSON.stringify(value);
  throw new Error(`${message}: expected ${describe(expected)}, got ${describe(actual)}`);
}
function mode(activity) { return activity.frame.querySelector('.cs128-vim-controls')?.dataset.mode; }
function toggle(activity) { activity.frame.querySelector('.cs128-vim-toggle').click(); }
function toggleNumbers(activity) { activity.frame.querySelector('.cs128-relative-toggle').click(); }
function gutterNumbers(editor) {
  return [...editor.container.querySelectorAll('.ace_gutter-cell')].map(cell => parseInt(cell.textContent, 10));
}
function text(editor, value) {
  // Ace remembers keydown/text-input pairs, so text input alone is not a
  // faithful simulation (a later Esc could be mistaken for the last letter).
  const punctuation = {' ': [32, 0], '\n': [13, 0], '/': [191, 0], '.': [190, 0], ':': [186, 4], '$': [52, 4]};
  for (const char of value) {
    const [code, modifiers] = punctuation[char] || [char.toUpperCase().charCodeAt(0), /[A-Z]/.test(char) ? 4 : 0];
    if (!key(editor, code, modifiers)) editor.keyBinding.onTextInput(char);
  }
}
function key(editor, code, modifiers = 0) {
  return editor.keyBinding.onCommandKey({ctrlKey: Boolean(modifiers & 1), altKey: Boolean(modifiers & 2), shiftKey: Boolean(modifiers & 4), metaKey: Boolean(modifiers & 8), preventDefault() {}, stopPropagation() {}}, modifiers, code);
}
function tabShortcut(element, direction, overrides = {}) {
  const event = new KeyboardEvent('keydown', {
    key: direction < 0 ? '[' : ']', code: direction < 0 ? 'BracketLeft' : 'BracketRight',
    altKey: true, bubbles: true, cancelable: true, ...overrides,
  });
  element.dispatchEvent(event);
  return event;
}
async function switchFile(activity, from, to, direction, overrides) {
  const source = activity.editors[from];
  source.focus();
  const event = tabShortcut(source.textInput.getElement(), direction, overrides);
  assert(event.defaultPrevented, 'Shortcut was not consumed');
  await until(() => activity.tabs[to].getAttribute('aria-selected') === 'true' && activity.editors[to].isFocused(), 'Target file was not selected and focused');
}
async function reset(editor, value = 'alpha beta gamma\nsecond line\nthird line\n') {
  key(editor, 27);
  editor.setValue(value, -1);
  editor.session.getUndoManager().reset();
  editor.focus();
  await pause(20);
  // setValue can create an external selection while replacing the document.
  // Each independent command scenario begins explicitly in Normal mode.
  key(editor, 27);
}

document.querySelector('#self-test').onclick = async () => {
  const button = document.querySelector('#self-test');
  const output = document.querySelector('#results');
  button.disabled = true;
  output.className = '';
  output.textContent = 'Running…\n';
  let passed = 0;
  let failed = 0;
  async function test(name, action) {
    try {
      await pause(30);
      await action();
      passed++;
      output.textContent += `PASS ${name}\n`;
    } catch (error) {
      failed++;
      output.textContent += `FAIL ${name}: ${error.message}\n`;
    }
  }
  let activity = fixture.navigate();
  let editor = activity.editors[0];
  await test('All three file editors start in Normal mode', async () => {
    await until(() => mode(activity) === 'normal');
    assert(activity.editors.every(e => e.getKeyboardHandler()?.$id === 'ace/keyboard/cs128-vim'), 'Some tabs have no Vim handler');
  });
  await test('Controls sit at the right of the action row and match button sizing', () => {
    const controls = activity.frame.querySelector('.cs128-vim-controls');
    const row = activity.frame.querySelector('.activity-light-buttons');
    const toggle = controls.querySelector('button');
    const save = row.querySelector('[data-action="Save"]');
    eq(controls.parentElement, row, 'Action row placement');
    eq(controls.querySelector('.cs128-vim-mode').textContent, '-- NORMAL --', 'Mode format');
    eq(toggle.getAttribute('role'), 'switch', 'Switch role');
    eq(toggle.getAttribute('aria-checked'), 'true', 'Switch enabled state');
    eq(toggle.textContent, 'Vim', 'No On/Off text in the Vim switch');
    const oldWidth = activity.frame.style.width;
    try {
      activity.frame.style.width = '900px';
      const buttonRect = toggle.getBoundingClientRect();
      const saveRect = save.getBoundingClientRect();
      assert(Math.abs(buttonRect.height - saveRect.height) < 1, 'Vim button differs in height');
      assert(Math.abs(buttonRect.y - saveRect.y) < 1, 'Vim button is on a different line at desktop width');
      assert(Math.abs(controls.getBoundingClientRect().right - row.getBoundingClientRect().right) < 1, 'Controls are not right aligned');
      activity.frame.style.width = '300px';
      assert(row.scrollWidth <= row.clientWidth, 'Narrow action row overflows');
      assert(controls.getBoundingClientRect().right <= row.getBoundingClientRect().right + 1, 'Narrow controls overflow');
    } finally {
      activity.frame.style.width = oldWidth;
    }
  });
  await test('Original documents and undo managers are preserved', () => {
    activity.editors.forEach((e, i) => {
      eq(e.session, activity.originals[i].session, 'Session identity');
      eq(e.session.getUndoManager(), activity.originals[i].undo, 'Undo manager identity');
    });
  });
  await test('Narrow action rows collapse into a menu and expand without losing settings', async () => {
    const oldWidth = activity.frame.style.width;
    const controls = activity.frame.querySelector('.cs128-vim-controls');
    const more = controls.querySelector('.cs128-vim-more');
    const panel = controls.querySelector('.cs128-vim-panel');
    const vim = controls.querySelector('.cs128-vim-toggle');
    const before = fixture.calls.length;
    try {
      activity.frame.style.width = '360px';
      await until(() => more.getClientRects().length > 0 && panel.getClientRects().length === 0);
      const save = activity.frame.querySelector('[data-action="Save"]');
      assert(Math.abs(more.getBoundingClientRect().y - save.getBoundingClientRect().y) < 1, 'Menu wrapped beneath the action buttons');
      more.click();
      eq(more.getAttribute('aria-expanded'), 'true', 'Open state');
      eq(document.activeElement, vim, 'Focus enters the menu');
      assert(panel.getClientRects().length > 0, 'Open menu is hidden');
      toggle(activity);
      toggleNumbers(activity);
      eq(mode(activity), 'off', 'Vim switch inside menu');
      eq(editor.getOption('relativeLineNumbers'), true, 'Relative switch inside menu');
      activity.frame.style.width = '900px';
      await until(() => more.getAttribute('aria-expanded') === 'false' && more.getClientRects().length === 0);
      assert(vim.getClientRects().length > 0, 'Wide buttons did not return');
      eq(mode(activity), 'off', 'Resize changed Vim state');
      eq(editor.getOption('relativeLineNumbers'), true, 'Resize changed line numbers');
      activity.frame.style.width = '360px';
      await until(() => more.getClientRects().length > 0 && panel.getClientRects().length === 0);
      more.click();
      toggle(activity);
      toggleNumbers(activity);
      eq(fixture.calls.length, before, 'Menu invoked a site action');
    } finally {
      activity.frame.style.width = oldWidth;
      document.body.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true}));
    }
  });
  await test('Compact menu supports Escape, outside clicks, and keyboard focus leaving', async () => {
    const oldWidth = activity.frame.style.width;
    const more = activity.frame.querySelector('.cs128-vim-more');
    const vim = activity.frame.querySelector('.cs128-vim-toggle');
    try {
      activity.frame.style.width = '360px';
      await until(() => more.getClientRects().length > 0);
      more.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowDown', bubbles: true}));
      eq(document.activeElement, vim, 'ArrowDown focuses first switch');
      vim.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true, cancelable: true}));
      eq(more.getAttribute('aria-expanded'), 'false', 'Escape closes menu');
      eq(document.activeElement, more, 'Escape returns focus');
      more.click();
      document.body.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true}));
      eq(more.getAttribute('aria-expanded'), 'false', 'Outside click closes menu');
      more.click();
      document.querySelector('#ordinary-input').focus();
      eq(more.getAttribute('aria-expanded'), 'false', 'Leaving the controls closes menu');
    } finally {
      activity.frame.style.width = oldWidth;
    }
  });
  await test('Relative numbers follow cursor movement and switch back to absolute numbers', async () => {
    await reset(editor);
    const content = editor.getValue();
    const undo = editor.session.getUndoManager();
    const button = activity.frame.querySelector('.cs128-relative-toggle');
    eq(button.getAttribute('aria-checked'), 'false', 'Numbers start absolute');
    toggleNumbers(activity);
    eq(button.getAttribute('aria-checked'), 'true', 'Relative switch state');
    activity.editors.forEach(e => eq(e.getOption('relativeLineNumbers'), true, 'All files use relative numbers'));
    text(editor, '2j');
    await until(() => gutterNumbers(editor).slice(0, 4).join() === '2,1,3,1', 'Relative gutter did not track the cursor');
    text(editor, 'k');
    await until(() => gutterNumbers(editor).slice(0, 4).join() === '1,2,1,2', 'Relative gutter did not update after moving up');
    toggleNumbers(activity);
    await until(() => gutterNumbers(editor).slice(0, 4).join() === '1,2,3,4', 'Absolute gutter was not restored');
    eq(editor.getValue(), content, 'Line-number switch changed the document');
    eq(editor.session.getUndoManager(), undo, 'Line-number switch changed undo history');
  });
  await test('Relative numbers remain independent when Vim is off', async () => {
    toggleNumbers(activity);
    toggle(activity);
    const indicator = activity.frame.querySelector('.cs128-vim-mode');
    assert(indicator.hidden && indicator.getClientRects().length === 0, 'Off mode label still occupies space');
    eq(indicator.textContent, '', 'Off mode text was not removed');
    eq(activity.frame.querySelector('.cs128-vim-toggle').textContent, 'Vim', 'Off switch label');
    eq(editor.getOption('relativeLineNumbers'), true, 'Disabling Vim changed relative numbers');
    activity.tabs[1].click();
    eq(activity.editors[1].getOption('relativeLineNumbers'), true, 'Other file keeps relative numbers');
    toggleNumbers(activity);
    activity.editors.forEach(e => eq(e.getOption('relativeLineNumbers'), false, 'Absolute numbers with Vim off'));
    activity.tabs[0].click();
    toggle(activity);
    assert(!indicator.hidden, 'Re-enabling Vim did not restore the mode label');
  });
  await test('Insert mode, Esc, and repeated Esc keep editor focus', async () => {
    await reset(editor);
    text(editor, 'ihello ');
    eq(mode(activity), 'insert', 'Insert indicator');
    key(editor, 27);
    eq(mode(activity), 'normal', 'Normal indicator');
    key(editor, 27);
    assert(editor.isFocused(), 'Escape moved focus to a file tab');
    assert(editor.getValue().startsWith('hello alpha'), 'Inserted text missing');
  });
  await test('Motions and counts: 2w, 0, $, gg, G', async () => {
    await reset(editor);
    text(editor, '2w'); eq(editor.getCursorPosition().column, 11, '2w');
    text(editor, '0'); eq(editor.getCursorPosition().column, 0, '0');
    text(editor, '$'); eq(editor.getCursorPosition().column, 15, '$');
    text(editor, 'G'); eq(editor.getCursorPosition().row, 3, 'G');
    text(editor, 'gg'); eq(editor.getCursorPosition().row, 0, 'gg');
  });
  await test('Operator and text object: diw', async () => {
    await reset(editor); text(editor, 'diw');
    assert(editor.getValue().startsWith(' beta'), `diw result: ${JSON.stringify(editor.getValue())}`);
  });
  await test('Yank and paste: yy p', async () => {
    await reset(editor, 'first\nsecond\n'); text(editor, 'yyp');
    eq(editor.getValue(), 'first\nfirst\nsecond\n', 'Yanked line');
  });
  await test('Visual mode and deletion', async () => {
    await reset(editor); text(editor, 'vl');
    eq(mode(activity), 'visual', 'Visual indicator');
    text(editor, 'd');
    assert(editor.getValue().startsWith('pha'), 'Visual selection not deleted');
    eq(mode(activity), 'normal', 'Mode after deleting');
  });
  await test('Undo, redo, and repeat', async () => {
    await reset(editor); text(editor, 'x');
    assert(editor.getValue().startsWith('lpha'), `x result: ${JSON.stringify(editor.getValue())}`);
    text(editor, 'u'); assert(editor.getValue().startsWith('alpha'), 'u');
    key(editor, 82, 1); assert(editor.getValue().startsWith('lpha'), 'Ctrl-r');
    text(editor, '.'); assert(editor.getValue().startsWith('pha'), 'Repeat');
  });
  await test('Search dialog finds a word', async () => {
    await reset(editor); text(editor, '/');
    const input = editor.container.querySelector('.ace_dialog input');
    assert(input, 'No Vim search dialog');
    input.value = 'second';
    input.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', keyCode: 13, bubbles: true}));
    eq(editor.getCursorPosition().row, 1, 'Search result row');
  });
  await test('Read-only files remain read-only under Vim', async () => {
    await reset(editor); const before = editor.getValue();
    editor.setReadOnly(true);
    text(editor, 'ddiCHANGED'); key(editor, 27);
    eq(editor.getValue(), before, 'Read-only content');
    editor.setReadOnly(false);
  });
  await test('Switching files shows the active editor mode', async () => {
    editor.setReadOnly(false);
    await reset(editor); text(editor, 'i');
    activity.tabs[1].click();
    await until(() => mode(activity) === 'normal');
    activity.tabs[0].click();
    await until(() => mode(activity) === 'insert');
    key(editor, 27);
  });
  await test('Colon command mode and save/quit shortcuts are disabled', async () => {
    await reset(editor);
    const before = fixture.calls.length;
    const value = editor.getValue();
    for (const sequence of [':', '3:', 'ZZ', 'ZQ', 'v:', 'V:']) {
      key(editor, 27);
      text(editor, sequence);
      assert(!editor.container.querySelector('.ace_dialog'), `Command prompt opened for ${sequence}`);
      eq(editor.getValue(), value, 'Disabled command changed text');
    }
    key(editor, 27);
    eq(fixture.calls.length, before, 'Site action calls');
  });
  await test('Colons can still be inserted and found with f in Normal mode', async () => {
    await reset(editor, 'std::cout\n');
    text(editor, 'f:');
    eq(editor.getCursorPosition().column, 3, 'Find colon');
    text(editor, 'i:'); key(editor, 27);
    eq(editor.getValue(), 'std:::cout\n', 'Literal colon in Insert');
  });
  await test('Mock Save, Run, and Grade read the edited Ace documents', async () => {
    await reset(editor); text(editor, 'i// change\n'); key(editor, 27);
    const before = fixture.calls.length;
    activity.section.querySelectorAll('.actions [data-action]:not([data-action="History"])').forEach(b => b.click());
    eq(fixture.calls.length, before + 3, 'Button calls');
    for (const call of fixture.calls.slice(-3)) {
      eq(call.files[0], editor.getValue(), `${call.action} content`);
      eq(call.files.length, 3, 'File count');
    }
  });
  await test('Toggle restores keyboard handler, Escape, and undo history', () => {
    const content = editor.getValue();
    const undo = editor.session.getUndoManager();
    toggle(activity);
    eq(mode(activity), 'off', 'Off indicator');
    activity.editors.forEach((e, i) => {
      eq(e.getKeyboardHandler(), activity.originals[i].handler, 'Original keyboard handler');
      eq(e.commands.commands.escapeToTabs, activity.originals[i].escape, 'Original Escape command');
    });
    eq(editor.getValue(), content, 'Content after disabling');
    eq(editor.session.getUndoManager(), undo, 'Undo history after disabling');
    editor.focus(); key(editor, 27);
    eq(document.activeElement, activity.tabs[0], 'Restored Escape target');
    toggle(activity);
    eq(mode(activity), 'normal', 'Re-enabled mode');
  });
  await test('Runnable examples and ordinary text inputs are unaffected', () => {
    assert(!fixture.runnable.getKeyboardHandler()?.$id?.includes('cs128-vim'), 'Runnable example was changed');
    const input = document.querySelector('#ordinary-input');
    input.focus(); input.value = 'hjkl';
    eq(input.value, 'hjkl', 'Ordinary input');
    assert(!input.closest('.cs128-vim-controls'), 'Input wrapped by extension');
  });
  await test('Disabling from Normal, Insert, and Visual restores typing in every file', async () => {
    for (const sequence of ['', 'i', 'vl']) {
      await reset(editor);
      text(editor, sequence);
      toggle(activity);
      for (const e of activity.editors) {
        e.setValue('', -1);
        e.focus();
        text(e, 'hjkl:i');
        eq(e.getValue(), 'hjkl:i', `Ordinary typing after ${sequence || 'normal'}`);
        assert(!e.state?.cm, 'Vim state retained while off');
      }
      toggle(activity);
      activity.tabs[0].click();
      editor.focus();
      eq(mode(activity), 'normal', 'Re-enabled mode');
      const before = editor.getValue();
      text(editor, 'h');
      eq(editor.getValue(), before, 'Normal motion inserted text');
    }
  });
  await test('Disabling bypasses site keyboard-handler wrappers', () => {
    const setters = activity.editors.map(e => e.setKeyboardHandler);
    activity.editors.forEach(e => {
      e.setKeyboardHandler = () => { throw new Error('Site wrapper rejects a handler reset'); };
    });
    try {
      toggle(activity);
      eq(mode(activity), 'off', 'Switch disabled');
      activity.editors.forEach((e, i) => {
        eq(e.getKeyboardHandler(), activity.originals[i].handler, 'Original handler restored');
        eq(e.state.cm, null, 'Vim detached');
        e.setValue('', -1); text(e, 'hjkl');
        eq(e.getValue(), 'hjkl', 'Ordinary typing');
      });
    } finally {
      activity.editors.forEach((e, i) => { e.setKeyboardHandler = setters[i]; });
    }
    toggle(activity);
    eq(mode(activity), 'normal', 'Vim re-enabled');
  });
  await test('Switching off one activity leaves other activities enabled', async () => {
    const other = fixture.create();
    await until(() => mode(other) === 'normal');
    toggle(activity);
    eq(mode(activity), 'off', 'First activity');
    eq(mode(other), 'normal', 'Other activity');
    toggleNumbers(activity);
    other.editors.forEach(e => assert(!e.getOption('relativeLineNumbers'), 'Other activity line numbers changed'));
    toggleNumbers(activity);
    toggle(activity);
  });
  await test('Copied controls are replaced with a working switch', async () => {
    const controls = activity.frame.querySelector('.cs128-vim-controls');
    controls.replaceWith(controls.cloneNode(true));
    await until(() => controls.isConnected);
    eq(activity.frame.querySelectorAll('.cs128-vim-controls').length, 1, 'No inert duplicate');
    toggle(activity); eq(mode(activity), 'off', 'Repaired switch');
    toggle(activity);
  });
  await test('Replacing the action row moves controls and retains the switch state', async () => {
    toggle(activity);
    const row = activity.frame.querySelector('.activity-light-buttons');
    const replacement = row.cloneNode(false);
    row.replaceWith(replacement);
    await until(() => replacement.querySelector('.cs128-vim-toggle'));
    eq(mode(activity), 'off', 'Off state retained');
    toggle(activity);
    eq(mode(activity), 'normal', 'Replaced row switch works');
  });
  await test('Duplicate injection adds no handlers or controls', async () => {
    const handler = editor.getKeyboardHandler();
    const cm = editor.state.cm;
    await fixture.duplicate(); await pause(50);
    eq(activity.section.querySelectorAll('.cs128-vim-controls').length, 1, 'Controls count');
    eq(editor.getKeyboardHandler(), handler, 'Handler identity');
    eq(editor.state.cm, cm, 'Vim state identity');
  });
  await test('Delayed activity initialization is detected', async () => {
    const late = fixture.create({delay: 100});
    await until(() => mode(late) === 'normal');
    eq(late.editors.length, 3, 'Delayed file count');
  });
  await test('Incompatible editor falls back without losing ordinary editing', async () => {
    const broken = fixture.create({broken: true});
    await until(() => mode(broken) === 'unavailable');
    broken.editors.forEach((e, i) => {
      eq(e.getKeyboardHandler(), broken.originals[i].handler, 'Fallback handler');
      eq(e.commands.commands.escapeToTabs, broken.originals[i].escape, 'Fallback Escape');
    });
    text(broken.editors[0], 'ordinary');
    assert(broken.editors[0].getValue().startsWith('ordinary'), 'Fallback cannot type');
  });
  await test('Moving the activity into/out of fullscreen preserves Vim state and text', async () => {
    toggleNumbers(activity);
    const cm = editor.state.cm;
    const value = editor.getValue();
    activity.fullscreen();
    await pause(30);
    eq(editor.state.cm, cm, 'Vim state while fullscreen');
    eq(editor.getValue(), value, 'Text while fullscreen');
    eq(activity.overlay.querySelectorAll('.cs128-vim-controls').length, 1, 'Fullscreen controls');
    toggle(activity);
    eq(mode(activity), 'off', 'Fullscreen switch off');
    activity.tabs[1].click();
    await until(() => mode(activity) === 'off');
    toggle(activity);
    eq(mode(activity), 'normal', 'Fullscreen switch on');
    activity.tabs[0].click();
    const resumed = editor.state.cm;
    activity.fullscreen();
    await pause(30);
    eq(editor.state.cm, resumed, 'Vim state after fullscreen');
    eq(editor.getValue(), value, 'Text after fullscreen');
    eq(activity.section.querySelectorAll('.cs128-vim-controls').length, 1, 'Restored controls');
    eq(editor.getOption('relativeLineNumbers'), true, 'Relative numbers survive fullscreen');
  });
  await test('Replacing an Ace instance attaches to the new instance', async () => {
    const element = editor.container;
    editor.destroy();
    element.replaceChildren();
    const replacement = ace.edit(element);
    replacement.session.setUseWorker(false);
    replacement.setValue('replacement\n', -1);
    activity.editors[0] = editor = replacement;
    editor.focus();
    await until(() => editor.getKeyboardHandler()?.$id === 'ace/keyboard/cs128-vim');
    eq(editor.getOption('relativeLineNumbers'), true, 'Replacement inherits relative numbers');
    eq(activity.section.querySelectorAll('.cs128-vim-controls').length, 1, 'Controls after remount');
  });
  await test('Re-rendering a workspace restores controls and respects the off switch', async () => {
    toggle(activity);
    const workspace = activity.section.querySelector('.activity-workspace');
    activity.editors.forEach(e => e.destroy());
    workspace.innerHTML = '<nav role="tablist"><button role="tab" aria-selected="true">replacement.cc</button></nav><div class="tab-pane active"><div class="editor"></div></div>';
    editor = ace.edit(workspace.querySelector('.editor'));
    editor.session.setUseWorker(false);
    editor.setValue('rerendered\n', -1);
    activity.editors = [editor];
    await until(() => mode(activity) === 'off');
    eq(editor.getOption('relativeLineNumbers'), true, 'Re-rendered editor inherits relative numbers while Vim is off');
    assert(editor.getKeyboardHandler()?.$id !== 'ace/keyboard/cs128-vim', 'New editor ignored off switch');
    toggle(activity);
    eq(mode(activity), 'normal', 'Re-enabled re-rendered editor');
  });
  await test('Cache cleanup restores editors and navigation reattaches', async () => {
    document.dispatchEvent(new Event('turbo:before-cache'));
    await pause(50);
    eq(activity.section.querySelectorAll('.cs128-vim-controls').length, 0, 'Cached controls');
    assert(editor.getKeyboardHandler()?.$id !== 'ace/keyboard/cs128-vim', 'Handler retained in cache');
    assert(!editor.getOption('relativeLineNumbers'), 'Original line numbers were not restored before caching');
    document.dispatchEvent(new Event('turbo:load'));
    await until(() => mode(activity) === 'normal');
    eq(activity.frame.querySelector('.cs128-relative-toggle').getAttribute('aria-checked'), 'false', 'Relative numbers reset after navigation');
  });
  await test('New lesson resets the activity switch to enabled', async () => {
    toggle(activity);
    activity = fixture.navigate(); editor = activity.editors[0];
    await until(() => mode(activity) === 'normal');
    eq(activity.section.querySelector('.cs128-vim-toggle').getAttribute('aria-checked'), 'true', 'Enabled default');
  });
  await test('Alt/Option brackets switch files, wrap both ways, and preserve documents', async () => {
    await reset(editor);
    const original = editor.getValue();
    text(editor, 'iX'); key(editor, 27);
    const values = activity.editors.map(e => e.getValue());
    const before = fixture.calls.length;
    await switchFile(activity, 0, 1, 1);
    await switchFile(activity, 1, 2, 1, {key: '‘'});
    await switchFile(activity, 2, 0, 1);
    await switchFile(activity, 0, 2, -1, {key: '“'});
    await switchFile(activity, 2, 1, -1);
    await switchFile(activity, 1, 0, -1);
    activity.editors.forEach((e, i) => {
      eq(e.getValue(), values[i], 'Shortcut changed a document');
      eq(e.session, activity.originals[i].session, 'Shortcut replaced a document');
      eq(e.session.getUndoManager(), activity.originals[i].undo, 'Shortcut replaced undo history');
    });
    text(editor, 'u');
    eq(editor.getValue(), original, 'Undo after tab switching');
    key(editor, 82, 1);
    eq(editor.getValue(), values[0], 'Redo after tab switching');
    eq(fixture.calls.length, before, 'Shortcut invoked a site action');
  });
  await test('Tab shortcuts work in Normal, Insert, Visual, and with Vim off', async () => {
    for (const [sequence, expected] of [['', 'normal'], ['i', 'insert'], ['vl', 'visual'], ['', 'off']]) {
      activity.tabs[0].click();
      await reset(editor);
      if (expected === 'off') toggle(activity); else text(editor, sequence);
      const value = editor.getValue();
      const selection = editor.getSelectionRange().toString();
      await switchFile(activity, 0, 1, 1, {key: '‘'});
      await switchFile(activity, 1, 0, -1, {key: '“'});
      eq(mode(activity), expected, 'Returning to a file changed its mode');
      eq(editor.getSelectionRange().toString(), selection, 'Selection changed');
      eq(editor.getValue(), value, 'Shortcut inserted Option punctuation');
      if (expected === 'off') toggle(activity);
    }
  });
  await test('Tab shortcuts follow displayed order and skip disabled or hidden tabs', async () => {
    const nav = activity.tabs[0].parentElement;
    nav.insertBefore(activity.tabs[2], activity.tabs[1]);
    await switchFile(activity, 0, 2, 1);
    activity.tabs[1].disabled = true;
    await switchFile(activity, 2, 0, 1);
    activity.tabs[1].disabled = false;
    activity.tabs[2].hidden = true;
    await switchFile(activity, 0, 1, 1);
    activity.tabs[2].hidden = false;
    activity.tabs[2].setAttribute('aria-disabled', 'true');
    await switchFile(activity, 1, 0, 1);
    activity.tabs[1].disabled = true;
    const oneFile = tabShortcut(editor.textInput.getElement(), 1);
    assert(!oneFile.defaultPrevented, 'Single available tab consumed shortcut');
    activity.tabs[1].disabled = false;
    activity.tabs[2].removeAttribute('aria-disabled');
    nav.append(...activity.tabs);
    // Also support accessible tabs that do not repeat their target in data-bs-target.
    activity.tabs[1].removeAttribute('data-bs-target');
    await switchFile(activity, 0, 1, 1);
    activity.tabs[1].setAttribute('data-bs-target', `#${activity.tabs[1].getAttribute('aria-controls')}`);
    await switchFile(activity, 1, 0, -1);
  });
  await test('Tab shortcuts leave search, other inputs, and other modifiers alone', async () => {
    await reset(editor);
    for (const overrides of [{altKey: false}, {ctrlKey: true}, {metaKey: true}, {shiftKey: true}, {isComposing: true}, {modifierAltGraph: true}]) {
      tabShortcut(editor.textInput.getElement(), 1, overrides);
      eq(activity.tabs[0].getAttribute('aria-selected'), 'true', 'Different key combination switched files');
    }
    text(editor, '/');
    const search = editor.container.querySelector('.ace_dialog input');
    assert(search, 'Search input missing');
    assert(!tabShortcut(search, 1).defaultPrevented, 'Shortcut captured inside Vim search');
    search.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', keyCode: 27, bubbles: true}));
    for (const input of [document.querySelector('#ordinary-input'), fixture.runnable.textInput.getElement(), activity.tabs[0]]) {
      input.focus();
      assert(!tabShortcut(input, 1).defaultPrevented, 'Shortcut captured outside an activity editor');
      eq(activity.tabs[0].getAttribute('aria-selected'), 'true', 'Unrelated input switched files');
    }
  });
  await test('Tab shortcuts survive duplicate initialization, delayed activities, and fullscreen', async () => {
    const late = fixture.create({delay: 100});
    await until(() => mode(late) === 'normal');
    await fixture.duplicate();
    await switchFile(late, 0, 1, 1);
    eq(activity.tabs[0].getAttribute('aria-selected'), 'true', 'Shortcut changed another activity');
    late.fullscreen();
    await switchFile(late, 1, 2, 1);
    late.fullscreen();
    await switchFile(late, 2, 0, 1);
  });
  await test('Delayed tab activation focuses the editor without stealing focus after leaving', async () => {
    activity.tabs[0].click();
    activity.tabDelay = 70;
    try {
      await switchFile(activity, 0, 1, 1);
      tabShortcut(activity.editors[1].textInput.getElement(), 1);
      const input = document.querySelector('#ordinary-input');
      input.focus();
      await until(() => activity.tabs[2].getAttribute('aria-selected') === 'true');
      eq(document.activeElement, input, 'Late tab activation stole focus');
      await switchFile(activity, 2, 0, 1);
    } finally {
      activity.tabDelay = 0;
    }
  });
  output.textContent += `\n${passed} passed, ${failed} failed.\n`;
  output.className = failed ? 'fail' : 'pass';
  button.disabled = false;
};
