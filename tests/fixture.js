/* Local mock of the observed CS 128 markup and Ace initialization. */
window.fixture = {activities: [], calls: [], nextId: 0};
const starter = 'int first = 1;\nint second = 2;\nint third = 3;\n';
fixture.create = function ({delay = 0, broken = false} = {}) {
  const id = ++fixture.nextId;
  const section = document.createElement('section');
  section.className = 'block block--activity';
  section.innerHTML = `<div class="block__frame"><h2>Programming Activity ${id}</h2><button class="fullscreen">Expand to fullscreen</button>
    <div class="activity-workspace"><nav class="new-core-tabs" role="tablist" aria-label="Activity ${id} files"></nav>
    <div class="tab-content"></div><div class="activity-light-buttons actions"></div><output></output></div></div>`;
  document.querySelector('#activities').append(section);
  const activity = {section, frame: section.firstElementChild, editors: [], tabs: [], originals: [], pending: null};
  fixture.activities.push(activity);
  ['solution.cc', 'driver.cc', 'solution.hpp'].forEach((name, index) => {
    const tab = document.createElement('button');
    tab.type = 'button'; tab.role = 'tab'; tab.textContent = name;
    tab.setAttribute('aria-selected', String(index === 0));
    tab.className = 'new-core-tab-button' + (index ? '' : ' active');
    const panel = document.createElement('div');
    panel.id = `activity-${id}-file-${index}`;
    tab.id = `${panel.id}-tab`;
    tab.setAttribute('aria-controls', panel.id);
    tab.setAttribute('data-bs-toggle', 'pill');
    tab.setAttribute('data-bs-target', `#${panel.id}`);
    panel.setAttribute('aria-labelledby', tab.id);
    panel.className = 'tab-pane' + (index ? '' : ' active');
    panel.role = 'tabpanel';
    const element = document.createElement('div');
    element.id = `activity-${id}-editor-${index}`;
    element.className = 'editor';
    panel.append(element);
    section.querySelector('[role=tablist]').append(tab);
    section.querySelector('.tab-content').append(panel);
    activity.tabs.push(tab);
    tab.addEventListener('click', () => {
      const show = () => {
        activity.frame.querySelectorAll('[role=tab]').forEach(t => {
          t.setAttribute('aria-selected', String(t === tab));
          t.classList.toggle('active', t === tab);
        });
        activity.frame.querySelectorAll('.tab-pane').forEach(p => p.classList.toggle('active', p === panel));
        activity.editors[index]?.resize();
        tab.dispatchEvent(new Event('shown.bs.tab', {bubbles: true}));
      };
      if (activity.tabDelay) setTimeout(show, activity.tabDelay); else show();
    });
    const initialize = () => {
      const editor = ace.edit(element);
      editor.session.setUseWorker(false);
      editor.setValue(starter, -1);
      editor.setOption('fontSize', 15);
      editor.commands.addCommand({name: 'escapeToTabs', bindKey: {win: 'Escape', mac: 'Escape'}, exec() { tab.focus(); }});
      if (broken) {
        const original = editor.setKeyboardHandler;
        editor.setKeyboardHandler = function (handler) {
          if (handler?.$id === 'ace/keyboard/cs128-vim') throw new Error('Simulated incompatible editor');
          return original.call(this, handler);
        };
      }
      activity.editors[index] = editor;
      activity.originals[index] = {session: editor.session, undo: editor.session.getUndoManager(), handler: editor.getKeyboardHandler(), escape: editor.commands.commands.escapeToTabs};
    };
    if (delay) setTimeout(initialize, delay); else initialize();
  });
  for (const action of ['Run', 'Grade', 'Save', 'History']) {
    const button = document.createElement('button');
    button.className = `btn btn-core-${action.toLowerCase()} activity-light-btn`;
    button.dataset.action = action;
    button.textContent = action;
    button.addEventListener('click', () => {
      const call = {action, files: activity.editors.map(e => e.getValue())};
      fixture.calls.push(call);
      activity.frame.querySelector('output').textContent = JSON.stringify(call, null, 2);
    });
    section.querySelector('.actions').append(button);
  }
  activity.fullscreen = () => {
    if (activity.overlay) {
      section.append(activity.frame);
      activity.overlay.remove();
      activity.overlay = null;
    } else {
      const overlay = document.createElement('div');
      overlay.className = 'activity-fullscreen-overlay activity-fullscreen-overlay--panelled';
      overlay.role = 'dialog';
      const exit = document.createElement('button');
      exit.textContent = 'Exit fullscreen';
      exit.onclick = activity.fullscreen;
      overlay.append(exit, activity.frame);
      document.body.append(overlay);
      activity.overlay = overlay;
    }
    activity.editors.forEach(e => e.resize());
  };
  section.querySelector('.fullscreen').addEventListener('click', activity.fullscreen);
  return activity;
};
fixture.duplicate = () => new Promise(resolve => {
  const script = document.createElement('script');
  script.src = '/extension/content.js';
  script.onload = resolve;
  document.body.append(script);
});
fixture.navigate = () => {
  for (const activity of fixture.activities) {
    activity.editors.forEach(e => e.destroy());
    activity.overlay?.remove();
    activity.section.remove();
  }
  fixture.activities = [];
  const activity = fixture.create();
  document.dispatchEvent(new Event('turbo:load'));
  return activity;
};
fixture.create();
fixture.runnable = ace.edit('runnable');
fixture.runnable.session.setUseWorker(false);
fixture.runnable.setValue('Runnable example: type normally here.', -1);
document.querySelector('#add-activity').onclick = () => fixture.create({delay: 150});
document.querySelector('#duplicate').onclick = fixture.duplicate;
document.querySelector('#navigate').onclick = fixture.navigate;
