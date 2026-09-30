# CS 128 Vim

A small Chrome extension that enables standard Vim editing in CS 128 Programming Activities. It attaches to the site's existing Ace editors and starts in **Normal** mode. Every file tab in an activity is covered.

## Install in Chrome

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode** in the upper-right corner.
3. Click **Load unpacked**.
4. Select the **extension** folder in this project — the folder containing `manifest.json`.
5. Refresh your CS 128 lesson and open its Programming Activity.

The **Vim** switch and mode indicator appear at the bottom right, on the same row as **Run**, **Grade**, **Save**, and **History**. Modes are shown as **-- NORMAL --**, **-- INSERT --**, or **-- VISUAL --**. Turning Vim off hides the mode label. The Vim button shows just its name and a switch icon. No build, account, or additional installation is required to use the included `extension` folder. Keep that folder in place after loading it.

When the activity action row is narrow, the controls collapse into a **•••** button. Open it to use the Vim and Rel. # switches or see the current mode. Escape, clicking outside, or moving keyboard focus away closes the menu. Widening the activity restores the inline controls without changing either setting.

If using the release ZIP, extract it and select the extracted **cs128-vim** folder instead. Chrome cannot load the ZIP directly.

## Updating an existing installation

If Chrome loaded this project's **extension** folder, open `chrome://extensions`, click **Reload** on CS 128 Vim, then refresh the lesson. If you loaded a separately extracted ZIP, replace that folder with the new release first. Refreshing only the lesson does not update a separately copied extension.

## Use

| Keys | Action |
| --- | --- |
| `h j k l`, `w b e`, `0 $`, `gg G` | Move |
| `i`, `a`, `o` | Enter Insert mode |
| `Esc` | Return to Normal mode; keep focus in the editor |
| `v`, `V`, `Ctrl-v` | Visual, Visual Line, Visual Block |
| `dd`, `dw`, `ciw`, `yy`, `p` | Delete, change, yank, paste |
| `u`, `Ctrl-r`, `.` | Undo, redo, repeat |
| `/pattern`, `n`, `N` | Search and jump between matches |
| Counts such as `3w`, `2dd` | Repeat a motion or operator |
| Mac: `Option + [` / `Option + ]` | Previous / next file tab |
| Windows: `Alt + [` / `Alt + ]` | Previous / next file tab |

The file-tab shortcuts work while the activity's code editor has focus, in every Vim mode and with Vim off. They follow the displayed tab order, wrap at either end, and put the cursor in the selected file's editor. Disabled or hidden tabs are skipped. Search boxes and other inputs keep their normal keyboard behavior. On Mac, the shortcuts use the physical bracket keys so Option-generated punctuation does not get inserted into your code.

Use CS 128's **Save**, **Run**, and **Grade** buttons as usual. The `:` command prompt is disabled, as are `ZZ` and `ZQ`. There are no Vim save/quit commands. `/` and `?` search still work, and you can type colons normally in Insert mode. Vim yanks use Ace's internal registers; normal system copy/paste is still available, subject to browser shortcuts.

Click the **Vim** switch to turn it off for all files in that activity. This restores the site's keyboard handler and its Escape-to-file-tabs shortcut. The switch lasts for the current activity on the current page; a reload or new lesson starts enabled again. Browser-reserved shortcuts are still controlled by Chrome.

The separate **Rel. #** switch toggles relative line numbers for every file in that activity, independently of Vim. Other lines show their distance from the cursor; the current line keeps its actual line number. Turn it off to return to absolute numbers. Relative numbers start off and reset on page reload or navigation.

Vim runs only in activity workspaces on `https://cs128.org/*`. Smaller runnable examples, ordinary form inputs, and other websites are unaffected. This is Ace's Vim emulation, not Neovim; vimrc files and plugins are not supported.

## Troubleshooting

- After installing, reloading the extension, disabling it, or removing it, refresh the lesson. Chrome does not undo already injected page scripts when an extension is disabled.
- If the status says **-- UNAVAILABLE --**, ordinary editing remains available. Toggle Vim off/on to retry. A future CS 128 editor update may require a compatibility update.
- If no switch appears, check that you're signed in and looking at an editable Programming Activity, and that Chrome allows the extension on `cs128.org`.
- The live inspection confirmed the current activity action row and the site's `escapeToTabs` command. Automated execution and mouse/keyboard tests use the local Ace fixture; the updated extension still needs a final check in your installed Chrome session.

## Development and tests

Requires Node.js 20+ and npm. Python 3 is needed only to create the optional release ZIP.

```sh
npm ci --ignore-scripts
npm run build
npm run check
npm run dev
```

Open `http://127.0.0.1:8128` and click **Run integration tests**. The fixture contains three-file activities, delayed initialization, editor replacement, the site's Escape shortcut, and mock Save/Run/Grade actions. It never contacts CS 128 or submits coursework. **Expand to fullscreen** moves the workspace into an overlay just like CS 128; the suite verifies entering and leaving it. It also checks relative gutter numbers while moving the cursor, independent Vim/number switches, and restoring the original line-number setting during navigation.

The integration suite also checks tab shortcuts with both Windows and Mac-style key events, all Vim modes, wraparound, reordered tabs, delayed tab activation, fullscreen, and focus outside the editor.

`npm run package` produces `dist/cs128-vim-1.4.0.zip`.

The readable integration source is `src/content.js`; `extension/content.js` is generated and committed so the extension loads without a build. `scripts/build.mjs` bundles the pinned `ace-builds@1.44.0` Vim module under a private Ace module name, delaying registration until the site's Ace is initialized. It never replaces the site's Ace runtime. The manifest uses a `MAIN` world content script in Chrome 111+ and requests no extension API permissions, storage, background worker, or network access beyond its site match.

All extension code is local. There is no analytics, backend, credential access, or collection of coursework. See the bundled third-party notices and Ace license.
