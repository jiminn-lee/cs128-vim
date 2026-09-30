/* registerBundledVim is supplied by scripts/build.mjs. */
(() => {
  const singleton = Symbol.for("cs128-vim.controller.v1");
  if (window[singleton]) {
    window[singleton].refresh();
    return;
  }

  const workspaceSelector =
    "section.block--activity .activity-workspace, .activity-fullscreen-overlay .activity-workspace";
  const editorSelector =
    ".editor:not(.activity-light-editor), .ace_editor:not(.activity-light-editor)";
  const groups = new Map();
  const records = new Map();
  const modules = new WeakMap();
  let scheduled = false;
  let suspended = false;
  let retryTimer;
  let nextMenuId = 0;

  function closeMenu(group, returnFocus = false) {
    group.more.setAttribute("aria-expanded", "false");
    group.controls.classList.remove("cs128-vim-menu-open");
    if (returnFocus) group.more.focus();
  }

  function openMenu(group) {
    for (const other of groups.values()) if (other !== group) closeMenu(other);
    group.more.setAttribute("aria-expanded", "true");
    group.controls.classList.add("cs128-vim-menu-open");
    group.toggle.focus();
  }

  function removeControls(group) {
    group.cancelTabFocus?.();
    group.layoutObserver.disconnect();
    group.host?.classList.remove("cs128-vim-action-row");
    group.controls.remove();
  }

  function vimModule(ace) {
    if (modules.has(ace)) return modules.get(ace);
    registerBundledVim(ace);
    const module = ace.require("ace/keyboard/cs128-vim");
    if (!module?.handler || !module.Vim?.mapCommand)
      throw new Error("Vim module unavailable");
    // This privately named module leaves any site-provided Vim module alone.
    module.Vim.defineAction("cs128NoCommandLine", () => {});
    for (const context of ["normal", "visual"]) {
      for (const keys of [":", "ZZ", "ZQ"]) {
        module.Vim.mapCommand(
          keys,
          "action",
          "cs128NoCommandLine",
          {},
          { context },
        );
      }
    }
    modules.set(ace, module);
    return module;
  }

  function activeRecord(group) {
    const activePanel = group.workspace.querySelector(".tab-pane.active");
    return (
      [...group.records].find((r) => activePanel?.contains(r.element)) ||
      [...group.records].find((r) => r.editor.isFocused()) ||
      group.records.values().next().value
    );
  }

  function switchFile(event) {
    if (
      suspended || event.defaultPrevented || !event.altKey ||
      event.ctrlKey || event.metaKey || event.shiftKey || event.isComposing ||
      event.getModifierState("AltGraph")
    ) return;
    // Option changes event.key to punctuation on macOS. Physical key codes
    // keep these shortcuts consistent with Alt+[ / Alt+] on Windows.
    const code = event.code || event.key;
    const direction = code === "BracketLeft" || code === "[" ? -1
      : code === "BracketRight" || code === "]" ? 1 : 0;
    if (!direction) return;
    const source = records.get(event.target.closest?.(editorSelector));
    // Leave search fields, runnable examples, and other page inputs alone.
    if (!source || event.target !== source.editor.textInput.getElement()) return;
    const group = source.group;
    const files = [...group.workspace.querySelectorAll('.new-core-tabs [role="tab"]')]
      .filter((tab) => !tab.disabled && tab.getAttribute("aria-disabled") !== "true" &&
        tab.getClientRects().length && getComputedStyle(tab).visibility === "visible")
      .map((tab) => {
        const target = tab.getAttribute("data-bs-target");
        const id = target?.startsWith("#") ? target.slice(1) : tab.getAttribute("aria-controls");
        const panel = id && document.getElementById(id);
        const record = panel && [...group.records].find((r) => panel.contains(r.element));
        return { tab, panel, record };
      })
      .filter(({ panel, record }) => record && panel.closest(workspaceSelector) === group.workspace);
    const index = files.findIndex(({ record }) => record === source);
    if (index < 0 || files.length < 2) return;
    const next = files[(index + direction + files.length) % files.length];
    event.preventDefault();
    event.stopImmediatePropagation();
    group.cancelTabFocus?.();

    // Use the site's tab click handler, then focus its existing Ace instance.
    // Bootstrap may finish showing a fading panel after click() returns.
    const origin = event.target;
    let timeout;
    const cleanup = () => {
      clearTimeout(timeout);
      next.tab.removeEventListener("shown.bs.tab", focusSelected);
      if (group.cancelTabFocus === cleanup) group.cancelTabFocus = null;
    };
    const focusSelected = () => {
      if (!next.panel.classList.contains("active") || !next.record.element.getClientRects().length) return;
      cleanup();
      if (records.get(next.record.element) !== next.record ||
          ![origin, next.tab, document.body].includes(document.activeElement)) return;
      next.record.editor.resize();
      next.record.editor.focus();
      render(group);
    };
    group.cancelTabFocus = cleanup;
    next.tab.addEventListener("shown.bs.tab", focusSelected);
    timeout = setTimeout(cleanup, 1000);
    next.tab.click();
    focusSelected();
  }

  function render(group) {
    if (!group.controls.isConnected) return;
    const record = activeRecord(group);
    let mode = group.enabled ? "Loading…" : "Off";
    if (group.enabled && (group.failed || record?.failed)) mode = "Unavailable";
    else if (group.enabled && record?.enabled && record.editor.state?.cm) {
      const status = record.module.handler.getStatusText(record.editor);
      mode = status.startsWith("INSERT")
        ? "Insert"
        : status.startsWith("VISUAL")
          ? "Visual"
          : "Normal";
    }
    group.toggle.setAttribute("aria-checked", String(group.enabled));
    group.mode.hidden = !group.enabled;
    group.mode.textContent = group.enabled ? `-- ${mode.toUpperCase()} --` : "";
    group.controls.dataset.mode = mode.toLowerCase();
    group.relativeToggle.setAttribute(
      "aria-checked",
      String(group.relativeNumbers),
    );
    const available =
      group.records.size > 0 &&
      [...group.records].every((r) => r.supportsRelative);
    group.relativeToggle.disabled = !available;
    group.relativeToggle.title = available
      ? "Toggle relative line numbers for all files in this activity"
      : "Relative line numbers are unavailable in this editor";
  }

  function setRelativeNumbers(record, value) {
    if (!record.supportsRelative) return;
    record.relativeTouched = true;
    record.editor.setOption("relativeLineNumbers", value);
  }

  function restore(record) {
    if (!record.enabled && !record.attaching) return;
    const editor = record.editor;
    // Detach emits status events. Stop reading Vim state before it is torn down.
    record.enabled = false;
    record.attaching = false;
    try {
      // Remove our handler directly; do not pass the default CommandManager back
      // through the site's setKeyboardHandler wrapper. Other handlers stay intact.
      editor.keyBinding.removeKeyboardHandler(record.module.handler);
      if (editor.getKeyboardHandler() !== record.originalHandler) {
        editor.keyBinding.setKeyboardHandler(
          record.originalHandler === editor.commands
            ? null
            : record.originalHandler,
        );
      }
    } finally {
      if (record.escapeCommand)
        editor.commands.addCommand(record.escapeCommand);
      editor.renderer.$blockCursor = record.originalCursor.block;
      editor.renderer.$keepTextAreaAtCursor = record.originalCursor.keep;
      editor.renderer.$cursorLayer.drawCursor = record.originalCursor.draw;
      editor.renderer.updateCursor();
    }
  }

  function enable(record) {
    if (record.enabled) return;
    const editor = record.editor;
    record.originalHandler = editor.getKeyboardHandler();
    record.escapeCommand = editor.commands.commands.escapeToTabs;
    record.originalCursor = {
      block: editor.renderer.$blockCursor,
      keep: editor.renderer.$keepTextAreaAtCursor,
      draw: editor.renderer.$cursorLayer.drawCursor,
    };
    try {
      // Do not call ace.edit(): it can create a replacement editor before the site is ready.
      record.module = vimModule(window.ace);
      record.attaching = true;
      if (record.escapeCommand) editor.commands.removeCommand("escapeToTabs");
      editor.setKeyboardHandler(record.module.handler);
      record.enabled = true;
      record.attaching = false;
      record.failed = false;
    } catch (error) {
      try {
        restore(record);
      } catch {
        /* Keep the rest of the page usable. */
      }
      record.failed = true;
      console.warn("[CS 128 Vim] Could not enable Vim:", error.message);
    }
  }

  function mountControls(group) {
    // Site rendering or cached markup can copy DOM without copying listeners.
    // Keep the live control, removing any inert copies left in this workspace.
    group.workspace
      .querySelectorAll(".cs128-vim-controls")
      .forEach((control) => {
        if (control !== group.controls) control.remove();
      });
    const row = group.workspace.querySelector(".activity-light-buttons");
    const host = row || group.workspace;
    if (group.host !== host) {
      group.layoutObserver.disconnect();
      group.host?.classList.remove("cs128-vim-action-row");
      group.host = host;
      host.classList.add("cs128-vim-action-row");
      group.layoutObserver.observe(host);
    }
    group.controls.classList.toggle("cs128-vim-controls--fallback", !row);
    if (group.controls.parentElement !== host) host.append(group.controls);
  }

  function makeSwitch(text, className, accessibleName) {
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = `btn btn-core-save activity-light-btn cs128-editor-toggle ${className}`;
    toggle.setAttribute("role", "switch");
    toggle.setAttribute("aria-label", accessibleName);
    const label = document.createElement("span");
    label.textContent = text;
    const track = document.createElement("span");
    track.className = "cs128-vim-switch";
    track.setAttribute("aria-hidden", "true");
    toggle.append(label, track);
    return toggle;
  }

  function makeGroup(workspace) {
    // Cached navigation can preserve markup after the old document's JS has gone.
    workspace
      .querySelectorAll(".cs128-vim-controls")
      .forEach((el) => el.remove());
    const controls = document.createElement("div");
    controls.className = "cs128-vim-controls";
    controls.setAttribute("role", "group");
    controls.setAttribute("aria-label", "Editor controls");
    const toggle = makeSwitch("Vim", "cs128-vim-toggle", "Vim editing");
    toggle.title = "Toggle Vim for all files in this activity";
    const relativeToggle = makeSwitch(
      "Rel. #",
      "cs128-relative-toggle",
      "Relative line numbers",
    );
    const mode = document.createElement("span");
    mode.className = "cs128-vim-mode";
    mode.setAttribute("role", "status");
    mode.setAttribute("aria-label", "Vim mode");
    const panel = document.createElement("div");
    panel.className = "cs128-vim-panel";
    panel.id = `cs128-vim-menu-${++nextMenuId}`;
    panel.setAttribute("role", "group");
    panel.setAttribute("aria-label", "Editor settings");
    panel.append(mode, toggle, relativeToggle);
    const more = document.createElement("button");
    more.type = "button";
    more.className = "btn btn-core-save activity-light-btn cs128-vim-more";
    more.setAttribute("aria-label", "Editor settings");
    more.setAttribute("aria-expanded", "false");
    more.setAttribute("aria-controls", panel.id);
    more.title = "Vim and relative line numbers";
    const moreIcon = document.createElement("span");
    moreIcon.className = "cs128-vim-more-icon";
    moreIcon.setAttribute("aria-hidden", "true");
    moreIcon.textContent = "\u2022\u2022\u2022";
    more.append(moreIcon);
    controls.append(panel, more);
    const group = {
      workspace,
      controls,
      toggle,
      mode,
      relativeToggle,
      more,
      panel,
      relativeNumbers: false,
      records: new Set(),
      enabled: true,
    };
    group.layoutObserver = new ResizeObserver(() => {
      const compact = getComputedStyle(more).display !== "none";
      if (!compact) {
        if (document.activeElement === more) toggle.focus();
        closeMenu(group);
      } else if (more.getAttribute("aria-expanded") === "false" && panel.contains(document.activeElement)) {
        more.focus();
      }
    });
    mountControls(group);
    more.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (more.getAttribute("aria-expanded") === "true") closeMenu(group, true);
      else openMenu(group);
    });
    controls.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && more.getAttribute("aria-expanded") === "true") {
        event.preventDefault();
        event.stopPropagation();
        closeMenu(group, true);
      } else if (event.target === more && event.key === "ArrowDown") {
        event.preventDefault();
        openMenu(group);
      }
    });
    toggle.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      group.enabled = !group.enabled;
      group.failed = false;
      for (const record of group.records) {
        try {
          if (group.enabled) enable(record);
          else restore(record);
        } catch (error) {
          record.failed = true;
          console.warn("[CS 128 Vim] Could not restore editor:", error.message);
        }
      }
      render(group);
      refresh();
    });
    relativeToggle.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const previous = [...group.records].map((record) => [
        record,
        record.editor.getOption("relativeLineNumbers"),
      ]);
      try {
        for (const record of group.records)
          setRelativeNumbers(record, !group.relativeNumbers);
        group.relativeNumbers = !group.relativeNumbers;
      } catch (error) {
        for (const [record, value] of previous) {
          try {
            setRelativeNumbers(record, value);
          } catch {
            /* The site may have destroyed this editor. */
          }
        }
        console.warn(
          "[CS 128 Vim] Could not change line numbers:",
          error.message,
        );
      }
      render(group);
    });
    groups.set(workspace, group);
    return group;
  }

  function release(record) {
    try {
      restore(record);
    } catch {
      /* The site may already have destroyed this editor. */
    }
    if (record.relativeTouched) {
      try {
        setRelativeNumbers(record, record.originalRelative);
      } catch {
        /* A destroyed renderer needs no restoration. */
      }
    }
    for (const event of ["changeStatus", "focus", "changeSession"]) {
      record.editor.off(event, record.update);
    }
    record.group.records.delete(record);
    records.delete(record.element);
  }

  function scan() {
    scheduled = false;
    clearTimeout(retryTimer);
    if (suspended) return;
    for (const [element, record] of records) {
      if (
        !element.isConnected ||
        element.env?.editor !== record.editor ||
        element.closest(workspaceSelector) !== record.group.workspace
      )
        release(record);
    }
    for (const [workspace, group] of groups) {
      if (!workspace.isConnected) {
        removeControls(group);
        groups.delete(workspace);
      }
    }
    let pending = false;
    for (const workspace of document.querySelectorAll(workspaceSelector)) {
      const elements = workspace.querySelectorAll(editorSelector);
      if (!elements.length) continue;
      const group = groups.get(workspace) || makeGroup(workspace);
      mountControls(group);
      group.failed = false;
      for (const element of elements) {
        if (records.has(element)) continue;
        const editor = element.env?.editor;
        if (
          !window.ace?.define ||
          !window.ace?.require ||
          !editor?.getKeyboardHandler
        ) {
          // Retry only while known activity editors are waiting to initialize.
          // Also retry on later focus/navigation, even after this window expires.
          group.waitSince ??= Date.now();
          if (Date.now() - group.waitSince < 10000) pending = true;
          else group.failed = true;
          continue;
        }
        const record = { element, editor, group, enabled: false };
        record.supportsRelative = Object.hasOwn(
          editor.getOptions(),
          "relativeLineNumbers",
        );
        if (record.supportsRelative)
          record.originalRelative = editor.getOption("relativeLineNumbers");
        record.update = () => render(group);
        records.set(element, record);
        group.records.add(record);
        for (const event of ["changeStatus", "focus", "changeSession"])
          editor.on(event, record.update);
        if (group.enabled) enable(record);
        if (group.relativeNumbers) {
          try {
            setRelativeNumbers(record, true);
          } catch {
            record.supportsRelative = false;
          }
        }
      }
      render(group);
    }
    if (pending) retryTimer = setTimeout(refresh, 100);
  }

  function refresh() {
    if (scheduled || suspended) return;
    scheduled = true;
    queueMicrotask(scan);
  }

  // Ignore edits to Ace's rendered lines and our own status text. A scan is needed
  // only for workspace/editor lifecycle changes, not every keystroke.
  const relevant =
    "section.block--activity, .activity-workspace, .activity-light-buttons, .ace_editor, .editor, .cs128-vim-controls";
  const observer = new MutationObserver((changes) => {
    if (
      changes.some((change) =>
        change.type === "attributes"
          ? change.target.matches(".editor, .ace_editor, .tab-pane")
          : [...change.addedNodes, ...change.removedNodes].some(
              (node) =>
                node.nodeType === 1 &&
                (node.matches(relevant) || node.querySelector(relevant)),
            ),
      )
    )
      refresh();
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class"],
  });
  document.addEventListener("focusin", refresh);
  // Capture before Ace so the shortcut also works in Insert mode and with Vim off.
  document.addEventListener("keydown", switchFile, true);
  for (const event of ["pointerdown", "focusin"]) {
    document.addEventListener(event, (e) => {
      for (const group of groups.values()) {
        if (!group.controls.contains(e.target)) closeMenu(group);
      }
    });
  }
  document.addEventListener("click", (event) => {
    if (event.target.closest?.('[role="tab"]')) setTimeout(refresh, 0);
  });
  for (const event of [
    "turbo:load",
    "turbolinks:load",
    "shown.bs.tab",
    "fullscreenchange",
  ]) {
    document.addEventListener(event, () => {
      if (event.endsWith(":load")) suspended = false;
      refresh();
    });
  }
  window.addEventListener("pageshow", () => {
    suspended = false;
    refresh();
  });
  // Remove extension controls and hooks before Turbo caches the document.
  for (const event of ["turbo:before-cache", "turbolinks:before-cache"]) {
    document.addEventListener(event, () => {
      suspended = true;
      clearTimeout(retryTimer);
      for (const record of [...records.values()]) release(record);
      for (const group of groups.values()) {
        removeControls(group);
      }
      groups.clear();
    });
  }
  window[singleton] = { refresh };
  refresh();
})();
