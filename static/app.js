import { EditorState, Compartment } from "https://esm.sh/@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, dropCursor, rectangularSelection, crosshairCursor } from "https://esm.sh/@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "https://esm.sh/@codemirror/commands";
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching, foldGutter, foldKeymap, indentOnInput } from "https://esm.sh/@codemirror/language";
import { markdown } from "https://esm.sh/@codemirror/lang-markdown";
import { autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap } from "https://esm.sh/@codemirror/autocomplete";
import { oneDark } from "https://esm.sh/@codemirror/theme-one-dark";

const myBasicSetup = [
    lineNumbers(),
    highlightActiveLineGutter(),
    history(),
    foldGutter(),
    drawSelection(),
    dropCursor(),
    indentOnInput(),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    bracketMatching(),
    closeBrackets(),
    autocompletion(),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    keymap.of([
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...historyKeymap,
        ...foldKeymap,
        ...completionKeymap
    ])
];

document.addEventListener('DOMContentLoaded', () => {
    // UI Elements
    const editorWrapper = document.getElementById('editor-wrapper');
    const preview = document.getElementById('note-preview');
    const graphContainer = document.getElementById('graph-container');
    const editorContainer = document.getElementById('editor-container');
    const notesList = document.getElementById('notes-list');
    const tagsList = document.getElementById('tags-list');
    const searchInput = document.getElementById('search-input');
    const backlinksList = document.getElementById('backlinks-list');
    const commandOverlay = document.getElementById('command-palette-overlay');
    const commandInput = document.getElementById('command-input');
    const commandList = document.getElementById('command-list');
    const toastContainer = document.getElementById('toast-container');

    let currentNoteTitle = null;
    let allNotes = [];
    let cy = null;
    let editorView = null;
    let autoSaveTimer = null;
    let isDarkMode = localStorage.getItem('theme') === 'dark';
    let isGraphDirected = true;
    const themeConfig = new Compartment();

    // Restore State
    const savedMode = localStorage.getItem('currentMode') || 'edit';
    const savedNote = localStorage.getItem('currentNote');

    // Expose loadNote globally for Preview links
    window.loadNote = loadNote;
    window.filterNotes = (query) => {
        searchInput.value = query;
        filterNotes(query);
    };

    // Apply Theme
    applyTheme(isDarkMode);

    // Buttons
    document.getElementById('btn-edit').addEventListener('click', () => setMode('edit'));
    document.getElementById('btn-preview').addEventListener('click', () => {
        renderPreview();
        setMode('preview');
    });
    document.getElementById('btn-graph').addEventListener('click', () => {
        setMode('graph');
        loadGraph();
    });
    document.getElementById('btn-graph-arrow').addEventListener('click', toggleGraphArrows);
    document.getElementById('btn-new').addEventListener('click', createNewNote);
    document.getElementById('btn-save').addEventListener('click', () => {
        saveCurrentNote();
        showToast("Saved!");
    });
    document.getElementById('btn-delete').addEventListener('click', deleteCurrentNote);
    document.getElementById('btn-theme').addEventListener('click', toggleTheme);

    searchInput.addEventListener('input', (e) => filterNotes(e.target.value));

    // Command Palette
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
            e.preventDefault();
            toggleCommandPalette();
        }
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault();
            saveCurrentNote();
            showToast("Saved!");
        }
        if (e.key === 'Escape' && commandOverlay.style.display === 'flex') {
            toggleCommandPalette();
        }
    });

    commandOverlay.addEventListener('click', (e) => {
        if (e.target === commandOverlay) toggleCommandPalette();
    });

    commandInput.addEventListener('input', (e) => filterCommands(e.target.value));

    // Initial Load
    initEditor();
    loadNotes().then(() => {
        if (savedNote) loadNote(savedNote);
        if (savedMode === 'graph') {
            setMode('graph');
            loadGraph();
        } else if (savedMode === 'preview') {
            if (savedNote) loadNote(savedNote).then(() => {
                renderPreview();
                setMode('preview');
            });
        }
    });
    loadTags();

    function initEditor() {
        const extensions = [
            ...myBasicSetup,
            markdown(),
            autocompletion({ override: [completionSource] }),
            EditorView.updateListener.of((update) => {
                if (update.docChanged) {
                    triggerAutoSave();
                }
            }),
            EditorView.domEventHandlers({
                mousedown(event, view) {
                    if (event.ctrlKey || event.metaKey) {
                        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
                        if (pos) {
                            const line = view.state.doc.lineAt(pos);
                            const lineText = line.text;
                            const regex = /\[\[(.*?)\]\]/g;
                            let match;
                            while ((match = regex.exec(lineText)) !== null) {
                                const start = line.from + match.index;
                                const end = start + match[0].length;
                                if (pos >= start && pos <= end) {
                                    const target = match[1];
                                    loadNote(target);
                                    event.preventDefault();
                                    return true;
                                }
                            }
                        }
                    }
                },
                paste(event, view) {
                    const items = event.clipboardData?.items;
                    if (items) {
                        for (const item of items) {
                            if (item.type.startsWith('image/')) {
                                const file = item.getAsFile();
                                uploadImage(file, view);
                                event.preventDefault();
                                return true;
                            }
                        }
                    }
                }
            })
        ];

        // Theme is now handled by Compartment
        // if (isDarkMode) {
        //     extensions.push(oneDark);
        // }

        editorView = new EditorView({
            state: EditorState.create({
                doc: "",
                extensions: [
                    ...extensions,
                    themeConfig.of(isDarkMode ? oneDark : [])
                ]
            }),
            parent: editorWrapper
        });
    }

    async function uploadImage(file, view) {
        const formData = new FormData();
        formData.append('file', file);

        showToast("Uploading image...");
        try {
            const res = await fetch('/api/upload', {
                method: 'POST',
                body: formData
            });
            if (res.ok) {
                const data = await res.json();
                const imageMarkdown = `![${file.name}](${data.url})`;
                const transaction = view.state.update({
                    changes: { from: view.state.selection.main.head, insert: imageMarkdown }
                });
                view.dispatch(transaction);
                showToast("Image uploaded!");
            } else {
                showToast("Upload failed.");
            }
        } catch (e) {
            console.error(e);
            showToast("Upload error.");
        }
    }

    function completionSource(context) {
        let word = context.matchBefore(/\[\[\w*/) || context.matchBefore(/#\w*/);
        if (!word) return null;
        if (word.from == word.to && !context.explicit) return null;

        if (word.text.startsWith('[[')) {
            return {
                from: word.from + 2,
                options: allNotes.map(n => ({ label: n.title, type: "text" }))
            };
        } else if (word.text.startsWith('#')) {
            const tags = new Set();
            allNotes.forEach(n => n.tags.forEach(t => tags.add(t)));
            return {
                from: word.from + 1,
                options: Array.from(tags).map(t => ({ label: t, type: "keyword" }))
            };
        }
        return null;
    }

    function setMode(mode) {
        editorContainer.className = `view-mode-${mode}`;
        localStorage.setItem('currentMode', mode);
    }

    async function loadNotes() {
        try {
            const res = await fetch('/api/notes');
            if (!res.ok) throw new Error('Failed to fetch notes');
            allNotes = await res.json();
            renderNotesList(allNotes);
        } catch (e) {
            console.error(e);
            showToast("Error loading notes");
        }
    }

    function renderNotesList(notes) {
        notesList.innerHTML = '';
        notes.forEach(note => {
            const div = document.createElement('div');
            div.className = 'note-item';
            div.textContent = note.title;
            div.onclick = () => loadNote(note.title);
            notesList.appendChild(div);
        });
    }

    async function loadTags() {
        try {
            const res = await fetch('/api/tags');
            if (!res.ok) return;
            const tags = await res.json();
            tagsList.innerHTML = '';
            tags.forEach(tag => {
                const div = document.createElement('div');
                div.className = 'tag-item';
                div.textContent = `#${tag.name} (${tag.count})`;
                div.onclick = () => {
                    searchInput.value = `#${tag.name}`;
                    filterNotes(`#${tag.name}`);
                };
                tagsList.appendChild(div);
            });
        } catch (e) {
            console.error(e);
        }
    }

    async function loadNote(title) {
        currentNoteTitle = title;
        localStorage.setItem('currentNote', title);
        try {
            const res = await fetch(`/api/notes/${title}`);
            if (res.ok) {
                const note = await res.json();

                // Update CodeMirror
                const transaction = editorView.state.update({
                    changes: { from: 0, to: editorView.state.doc.length, insert: note.content }
                });
                editorView.dispatch(transaction);

                findBacklinks(title);
                setMode('edit');
            }
        } catch (e) {
            console.error(e);
            showToast("Error loading note");
        }
    }

    async function findBacklinks(targetTitle) {
        try {
            const res = await fetch('/api/graph');
            if (!res.ok) return;
            const graphData = await res.json();
            const edges = graphData.elements.filter(el => el.data.source && el.data.target === targetTitle);

            backlinksList.innerHTML = '';
            if (edges.length === 0) {
                backlinksList.innerHTML = '<div>No backlinks</div>';
                return;
            }

            edges.forEach(edge => {
                const div = document.createElement('div');
                div.className = 'note-item';
                div.textContent = edge.data.source;
                div.onclick = () => loadNote(edge.data.source);
                backlinksList.appendChild(div);
            });
        } catch (e) {
            console.error(e);
        }
    }

    function createNewNote() {
        const title = prompt("Note Title:");
        if (title) {
            currentNoteTitle = title;
            localStorage.setItem('currentNote', title);
            const content = `# ${title}\n\n`;
            const transaction = editorView.state.update({
                changes: { from: 0, to: editorView.state.doc.length, insert: content }
            });
            editorView.dispatch(transaction);
            setMode('edit');
            saveCurrentNote();
        }
    }

    async function saveCurrentNote() {
        if (!currentNoteTitle) return;
        const content = editorView.state.doc.toString();
        try {
            await fetch(`/api/notes/${currentNoteTitle}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: currentNoteTitle, content: content })
            });
            loadNotes();
            loadTags();
        } catch (e) {
            console.error(e);
            showToast("Error saving note");
        }
    }

    function triggerAutoSave() {
        if (autoSaveTimer) clearTimeout(autoSaveTimer);
        autoSaveTimer = setTimeout(() => {
            saveCurrentNote();
            showToast("Auto-saved");
        }, 2000);
    }

    async function deleteCurrentNote() {
        if (!currentNoteTitle || !confirm(`Delete ${currentNoteTitle}?`)) return;
        try {
            await fetch(`/api/notes/${currentNoteTitle}`, { method: 'DELETE' });
            currentNoteTitle = null;
            localStorage.removeItem('currentNote');
            const transaction = editorView.state.update({
                changes: { from: 0, to: editorView.state.doc.length, insert: "" }
            });
            editorView.dispatch(transaction);
            loadNotes();
            loadTags();
        } catch (e) {
            console.error(e);
            showToast("Error deleting note");
        }
    }

    function renderPreview() {
        const content = editorView.state.doc.toString();
        const renderer = new marked.Renderer();
        let html = marked.parse(content);

        html = html.replace(/\[\[(.*?)\]\]/g, (match, p1) => {
            return `<a href="#" onclick="loadNote('${p1}'); return false;">${p1}</a>`;
        });

        html = html.replace(/#([\w-]+)/g, (match, p1) => {
            return `<span class="tag-item" onclick="filterNotes('#${p1}')">#${p1}</span>`;
        });

        preview.innerHTML = html;
    }

    function filterNotes(query) {
        const lowerQuery = query.toLowerCase();
        const filtered = allNotes.filter(note => {
            const matchTitle = note.title.toLowerCase().includes(lowerQuery);
            const matchTag = note.tags.some(tag => `#${tag.toLowerCase()}`.includes(lowerQuery));
            const matchContent = note.content && note.content.toLowerCase().includes(lowerQuery);
            return matchTitle || matchTag || matchContent;
        });
        renderNotesList(filtered);
    }

    function toggleGraphArrows() {
        isGraphDirected = !isGraphDirected;
        document.getElementById('btn-graph-arrow').textContent = isGraphDirected ? '⇄' : '—';
        if (cy) {
            cy.style().selector('edge').style({
                'target-arrow-shape': isGraphDirected ? 'triangle' : 'none'
            }).update();
        }
    }

    async function loadGraph() {
        try {
            const res = await fetch('/api/graph');
            if (!res.ok) return;
            const data = await res.json();

            if (cy) {
                cy.destroy();
            }

            // Calculate degrees for sizing
            const degrees = {};
            data.elements.forEach(el => {
                if (el.data.source && el.data.target) {
                    degrees[el.data.source] = (degrees[el.data.source] || 0) + 1;
                    degrees[el.data.target] = (degrees[el.data.target] || 0) + 1;
                }
            });

            // Inject degree into node data
            data.elements.forEach(el => {
                if (!el.data.source) { // It's a node
                    el.data.degree = degrees[el.data.id] || 0;
                }
            });



            cy = cytoscape({
                container: document.getElementById('graph-container'),
                elements: data.elements,
                style: getGraphStyle(isDarkMode),
                layout: {
                    name: 'cose',
                    animate: false
                },
                wheelSensitivity: 0.2
            });

            // Ensure graph is properly sized
            cy.resize();
            cy.fit();

            cy.on('tap', 'node', function (evt) {
                const node = evt.target;
                loadNote(node.id());
            });

            cy.on('mouseover', 'node', function (e) {
                const node = e.target;
                const neighborhood = node.neighborhood().add(node);

                cy.elements().addClass('dimmed');
                neighborhood.removeClass('dimmed').addClass('highlighted');
            });

            cy.on('mouseout', 'node', function (e) {
                cy.elements().removeClass('dimmed highlighted');
            });

        } catch (e) {
            console.error(e);
        }
    }

    // Theme Logic
    function applyTheme(dark) {
        if (dark) {
            document.documentElement.setAttribute('data-theme', 'dark');
            document.getElementById('btn-theme').textContent = '☀️';
        } else {
            document.documentElement.removeAttribute('data-theme');
            document.getElementById('btn-theme').textContent = '🌙';
        }
    }

    function toggleTheme() {
        isDarkMode = !isDarkMode;
        localStorage.setItem('theme', isDarkMode ? 'dark' : 'light');
        applyTheme(isDarkMode);

        // Update CodeMirror
        if (editorView) {
            editorView.dispatch({
                effects: themeConfig.reconfigure(isDarkMode ? oneDark : [])
            });
        }

        // Update Graph
        if (cy) {
            // Use cy.json to update the style
            cy.json({ style: getGraphStyle(isDarkMode) });
        }
    }

    function getGraphStyle(dark) {
        return [
            {
                selector: 'node',
                style: {
                    'background-color': dark ? '#4daafc' : '#007bff',
                    'label': 'data(id)',
                    'color': dark ? '#e0e0e0' : '#333',
                    'font-size': '12px',
                    'text-valign': 'center',
                    'text-halign': 'center',
                    'width': (ele) => {
                        // We need to recalculate degree or store it. 
                        // For simplicity, we'll assume degree is stored in data or just use a default if not available immediately on style switch.
                        // Better approach: The degree calculation was done in loadGraph. 
                        // To make this work dynamically, we should store degree in node data.
                        return ele.data('degree') ? Math.max(20, ele.data('degree') * 5 + 20) : 20;
                    },
                    'height': (ele) => ele.data('degree') ? Math.max(20, ele.data('degree') * 5 + 20) : 20,
                    'padding': '10px',
                    'shape': 'ellipse'
                }
            },
            {
                selector: 'node[?ghost]',
                style: {
                    'background-color': dark ? '#37373d' : '#e0e0e0',
                    'color': '#999',
                    'border-style': 'dashed',
                    'border-width': 1
                }
            },
            {
                selector: 'edge',
                style: {
                    'width': 2,
                    'line-color': '#ccc',
                    'target-arrow-color': '#ccc',
                    'target-arrow-shape': isGraphDirected ? 'triangle' : 'none',
                    'curve-style': 'bezier'
                }
            },
            {
                selector: '.dimmed',
                style: {
                    'opacity': 0.2
                }
            },
            {
                selector: '.highlighted',
                style: {
                    'opacity': 1,
                    'line-color': '#ff5722',
                    'target-arrow-color': '#ff5722',
                    'z-index': 9999
                }
            }
        ];
    }

    // Command Palette Logic
    function toggleCommandPalette() {
        const display = commandOverlay.style.display;
        if (display === 'flex') {
            commandOverlay.style.display = 'none';
        } else {
            commandOverlay.style.display = 'flex';
            commandInput.value = '';
            commandInput.focus();
            renderCommands('');
        }
    }

    function renderCommands(query) {
        commandList.innerHTML = '';
        const commands = [
            { label: 'Create New Note', action: createNewNote },
            { label: 'Toggle Dark Mode', action: toggleTheme },
            { label: 'Show Graph', action: () => { setMode('graph'); loadGraph(); } },
            { label: 'Toggle Graph Arrows', action: toggleGraphArrows },
            ...allNotes.map(n => ({ label: `Open: ${n.title}`, action: () => loadNote(n.title) }))
        ];

        const filtered = commands.filter(c => c.label.toLowerCase().includes(query.toLowerCase()));

        filtered.forEach(cmd => {
            const div = document.createElement('div');
            div.className = 'command-item';
            div.textContent = cmd.label;
            div.onclick = () => {
                cmd.action();
                toggleCommandPalette();
            };
            commandList.appendChild(div);
        });
    }

    function filterCommands(query) {
        renderCommands(query);
    }

    function showToast(message) {
        const div = document.createElement('div');
        div.className = 'toast';
        div.textContent = message;
        toastContainer.appendChild(div);
        setTimeout(() => {
            div.remove();
        }, 3000);
    }
});
