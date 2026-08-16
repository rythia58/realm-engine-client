// Visual script (node graph) editor. Self-contained: VisualScriptEditor.init(container, { send })
// wires it up; incoming WS frames are fed via VisualScriptEditor.onMessage(msg).
(function () {
  'use strict';

  const CATEGORY_COLORS = {
    entry: '#4caf7d',
    control: '#c9a227',
    data: '#4a90d9',
    action: '#b06ad4',
  };

  let container = null;
  let sendFn = null;
  let defs = [];
  let defsByType = {};
  let scripts = [];
  let currentId = null;
  let graph = null;
  let dirty = false;

  let view = { x: 40, y: 40, scale: 1 };
  let selection = { nodeId: null, linkIndex: -1 };
  let dragState = null;
  let linkDrag = null;
  let liveActive = {};

  let els = {};

  function send(msg) { if (sendFn) sendFn(msg); }

  function uid() { return 'n' + Math.random().toString(36).slice(2, 8); }

  function markDirty() {
    dirty = true;
    els.saveBtn.classList.add('vs-attention');
  }

  // ── Layout ──────────────────────────────────────────────────────────────

  function init(root, opts) {
    container = root;
    sendFn = opts.send;
    injectStyles();
    container.innerHTML = '';
    container.classList.add('vs-root');

    const toolbar = div('vs-toolbar');
    els.scriptSelect = document.createElement('select');
    els.scriptSelect.className = 'vs-select';
    els.scriptSelect.onchange = () => openScript(els.scriptSelect.value);
    toolbar.appendChild(els.scriptSelect);

    els.newBtn = btn('New', () => newScript());
    els.saveBtn = btn('Save', () => saveScript());
    els.deleteBtn = btn('Delete', () => deleteScript());
    els.enableBtn = btn('Enable', () => toggleEnabled());
    toolbar.append(els.newBtn, els.saveBtn, els.deleteBtn, els.enableBtn);

    els.status = div('vs-status');
    toolbar.appendChild(els.status);

    const body = div('vs-body');
    els.palette = div('vs-palette');
    els.canvasWrap = div('vs-canvas-wrap');
    els.sidebar = div('vs-sidebar');
    body.append(els.palette, els.canvasWrap, els.sidebar);

    els.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    els.svg.setAttribute('class', 'vs-links');
    els.nodeLayer = div('vs-nodes');
    els.canvas = div('vs-canvas');
    els.canvas.append(els.svg, els.nodeLayer);
    els.canvasWrap.appendChild(els.canvas);

    container.append(toolbar, body);

    bindCanvasEvents();
    bindKeys();
    bindAutoFit();

    send({ type: 'visualScriptDefs' });
    send({ type: 'visualScriptList' });
    renderAll();
  }

  // Size the editor to the space above the packet-sniffer drawer.
  function fitToViewport() {
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const drawer = document.getElementById('sniffer-drawer');
    const drawerH = drawer ? drawer.getBoundingClientRect().height : 0;
    const h = Math.max(420, window.innerHeight - rect.top - drawerH - 14);
    container.style.height = h + 'px';
  }

  function bindAutoFit() {
    fitToViewport();
    window.addEventListener('resize', fitToViewport);
    const drawer = document.getElementById('sniffer-drawer');
    if (drawer) {
      drawer.addEventListener('transitionend', fitToViewport);
      const toggle = document.getElementById('sniffer-toggle');
      if (toggle) toggle.addEventListener('click', function () { setTimeout(fitToViewport, 300); });
    }
    setTimeout(fitToViewport, 100);
  }

  function div(cls) { const d = document.createElement('div'); d.className = cls; return d; }
  function btn(label, onClick) {
    const b = document.createElement('button');
    b.className = 'vs-btn';
    b.textContent = label;
    b.onclick = onClick;
    return b;
  }

  // ── WS in ───────────────────────────────────────────────────────────────

  function onMessage(msg) {
    if (!container) return false;
    switch (msg.type) {
      case 'visualScriptDefs':
        defs = msg.defs || [];
        defsByType = {};
        defs.forEach(d => { defsByType[d.type] = d; });
        renderPalette();
        return true;
      case 'visualScripts':
        scripts = msg.list || [];
        renderScriptSelect();
        if (!currentId && scripts.length) openScript(scripts[0].id);
        if (currentId) updateEnableBtn();
        return true;
      case 'visualScriptGraph':
        if (msg.id === currentId && msg.graph) {
          graph = msg.graph;
          dirty = false;
          els.saveBtn.classList.remove('vs-attention');
          selection = { nodeId: null, linkIndex: -1 };
          renderAll();
        }
        return true;
      case 'visualScriptSaveResult':
        if (msg.id === currentId) {
          setStatus(msg.ok ? (msg.errors ? 'Saved (warnings: ' + msg.errors.join('; ') + ')' : 'Saved') : 'Save failed', !msg.ok);
          if (msg.ok) { dirty = false; els.saveBtn.classList.remove('vs-attention'); }
        }
        send({ type: 'visualScriptList' });
        return true;
      case 'visualScriptLive': {
        liveActive = {};
        (msg.states || []).forEach(s => { liveActive[s.id] = s.activeNodeId; });
        updateLiveHighlight();
        return true;
      }
    }
    return false;
  }

  // ── Script lifecycle ────────────────────────────────────────────────────

  function newScript() {
    const name = prompt('Script name:', 'New Script');
    if (!name) return;
    const id = name.replace(/[^a-zA-Z0-9-_ ]/g, '').trim();
    if (!id) return;
    graph = {
      version: '1.0', name, enabled: false, idleFailSafeSec: 60,
      nodes: [{ id: uid(), type: 'Start', x: 60, y: 120, params: {} }],
      links: [],
    };
    currentId = id;
    dirty = true;
    saveScript();
    renderAll();
  }

  function openScript(id) {
    if (!id) return;
    if (dirty && !confirm('Discard unsaved changes?')) {
      els.scriptSelect.value = currentId;
      return;
    }
    currentId = id;
    graph = null;
    send({ type: 'visualScriptGet', id });
    renderAll();
  }

  function saveScript() {
    if (!currentId || !graph) return;
    send({ type: 'visualScriptSave', id: currentId, graph });
  }

  function deleteScript() {
    if (!currentId) return;
    if (!confirm('Delete script "' + currentId + '"?')) return;
    send({ type: 'visualScriptDelete', id: currentId });
    currentId = null;
    graph = null;
    send({ type: 'visualScriptList' });
    renderAll();
  }

  function toggleEnabled() {
    if (!currentId) return;
    const info = scripts.find(s => s.id === currentId);
    const next = !(info && info.enabled);
    if (graph) graph.enabled = next;
    send({ type: 'visualScriptToggle', id: currentId, enabled: next });
    setTimeout(() => send({ type: 'visualScriptList' }), 150);
  }

  function updateEnableBtn() {
    const info = scripts.find(s => s.id === currentId);
    const on = !!(info && info.enabled);
    els.enableBtn.textContent = on ? 'Disable' : 'Enable';
    els.enableBtn.classList.toggle('vs-on', on);
  }

  function setStatus(text, isError) {
    els.status.textContent = text;
    els.status.classList.toggle('vs-error', !!isError);
    if (text) setTimeout(() => { if (els.status.textContent === text) els.status.textContent = ''; }, 4000);
  }

  // ── Rendering ───────────────────────────────────────────────────────────

  function renderAll() {
    renderScriptSelect();
    renderPalette();
    renderCanvas();
    renderSidebar();
    updateEnableBtn();
  }

  function renderScriptSelect() {
    const sel = els.scriptSelect;
    sel.innerHTML = '';
    if (!scripts.length) {
      const o = document.createElement('option');
      o.textContent = '(no scripts)';
      o.value = '';
      sel.appendChild(o);
    }
    scripts.forEach(s => {
      const o = document.createElement('option');
      o.value = s.id;
      o.textContent = s.name + (s.enabled ? ' ●' : '');
      sel.appendChild(o);
    });
    if (currentId) sel.value = currentId;
  }

  function renderPalette() {
    const pal = els.palette;
    pal.innerHTML = '<div class="vs-pal-title">Nodes</div>';
    const cats = ['entry', 'control', 'data', 'action'];
    cats.forEach(cat => {
      const items = defs.filter(d => d.category === cat);
      if (!items.length) return;
      const h = div('vs-pal-cat');
      h.textContent = cat.toUpperCase();
      h.style.color = CATEGORY_COLORS[cat];
      pal.appendChild(h);
      items.forEach(d => {
        const it = div('vs-pal-item');
        it.textContent = d.label;
        it.style.borderLeftColor = CATEGORY_COLORS[cat];
        it.title = d.description || d.type;
        it.onclick = () => addNode(d.type);
        pal.appendChild(it);
      });
    });
  }

  function addNode(type) {
    if (!graph) return;
    const wrap = els.canvasWrap.getBoundingClientRect();
    const x = (wrap.width / 2 - view.x) / view.scale - 70;
    const y = (wrap.height / 2 - view.y) / view.scale - 20;
    const node = { id: uid(), type, x: Math.round(x), y: Math.round(y), params: {} };
    (defsByType[type] ? defsByType[type].params : []).forEach(p => { node.params[p.key] = p.value; });
    graph.nodes.push(node);
    selection = { nodeId: node.id, linkIndex: -1 };
    markDirty();
    renderCanvas();
    renderSidebar();
  }

  function applyView() {
    els.canvas.style.transform = 'translate(' + view.x + 'px,' + view.y + 'px) scale(' + view.scale + ')';
  }

  function renderCanvas() {
    els.nodeLayer.innerHTML = '';
    applyView();
    if (!graph) {
      els.svg.innerHTML = '';
      const empty = div('vs-empty');
      empty.textContent = currentId ? 'Loading…' : 'Create or select a script to edit.';
      els.nodeLayer.appendChild(empty);
      return;
    }
    graph.nodes.forEach(renderNode);
    renderLinks();
  }

  function renderNode(node) {
    const def = defsByType[node.type] || { label: node.type, category: 'data', inputs: [], outputs: [], params: [] };
    const el = div('vs-node');
    el.dataset.nodeId = node.id;
    el.style.left = node.x + 'px';
    el.style.top = node.y + 'px';
    if (selection.nodeId === node.id) el.classList.add('vs-selected');

    const head = div('vs-node-head');
    head.textContent = def.label;
    head.style.background = CATEGORY_COLORS[def.category] || '#666';
    el.appendChild(head);

    const bodyEl = div('vs-node-body');
    const inCol = div('vs-ports vs-in');
    const outCol = div('vs-ports vs-out');
    (def.inputs || []).forEach(p => inCol.appendChild(portEl(node, p, 'in')));
    (def.outputs || []).forEach(p => outCol.appendChild(portEl(node, p, 'out')));
    bodyEl.append(inCol, outCol);
    el.appendChild(bodyEl);

    const idTag = div('vs-node-id');
    idTag.textContent = node.id;
    el.appendChild(idTag);

    head.onmousedown = (e) => {
      e.stopPropagation();
      selection = { nodeId: node.id, linkIndex: -1 };
      dragState = { kind: 'node', nodeId: node.id, startX: e.clientX, startY: e.clientY, origX: node.x, origY: node.y };
      renderSidebar();
      refreshSelectionClasses();
    };
    el.onmousedown = (e) => {
      if (e.target.classList.contains('vs-port-dot')) return;
      e.stopPropagation();
      if (selection.nodeId !== node.id) {
        selection = { nodeId: node.id, linkIndex: -1 };
        renderSidebar();
        refreshSelectionClasses();
      }
    };

    els.nodeLayer.appendChild(el);
  }

  function portEl(node, port, side) {
    const row = div('vs-port vs-port-' + side);
    const dot = div('vs-port-dot' + (port.type === 'flow' ? ' vs-flow' : ''));
    dot.dataset.nodeId = node.id;
    dot.dataset.port = port.name;
    dot.dataset.portType = port.type;
    dot.dataset.side = side;
    const label = document.createElement('span');
    label.textContent = port.label || port.name;
    if (side === 'in') row.append(dot, label);
    else row.append(label, dot);

    dot.onmousedown = (e) => {
      e.stopPropagation();
      if (side === 'out') {
        linkDrag = { from: node.id, fromPort: port.name, portType: port.type, mouseX: e.clientX, mouseY: e.clientY };
      }
    };
    dot.onmouseup = (e) => {
      if (linkDrag && side === 'in') {
        e.stopPropagation();
        completeLink(node.id, port.name, port.type);
      }
    };
    return row;
  }

  function completeLink(toId, toPort, toType) {
    if (!linkDrag || !graph) { linkDrag = null; return; }
    const fromFlow = linkDrag.portType === 'flow';
    const toFlow = toType === 'flow';
    if (fromFlow !== toFlow) { linkDrag = null; renderLinks(); return; }
    const kind = fromFlow ? 'flow' : 'data';
    if (linkDrag.from === toId) { linkDrag = null; renderLinks(); return; }
    graph.links = graph.links.filter(l => !(l.to === toId && l.toPort === toPort && l.kind === kind) &&
      !(kind === 'flow' && l.from === linkDrag.from && l.fromPort === linkDrag.fromPort && l.kind === 'flow'));
    graph.links.push({ from: linkDrag.from, fromPort: linkDrag.fromPort, to: toId, toPort, kind });
    linkDrag = null;
    markDirty();
    renderLinks();
  }

  function portDotPos(nodeId, portName, side) {
    const dot = els.nodeLayer.querySelector('.vs-port-dot[data-node-id="' + nodeId + '"][data-port="' + portName + '"][data-side="' + side + '"]');
    if (!dot) return null;
    const canvasRect = els.canvas.getBoundingClientRect();
    const r = dot.getBoundingClientRect();
    return {
      x: (r.left + r.width / 2 - canvasRect.left) / view.scale,
      y: (r.top + r.height / 2 - canvasRect.top) / view.scale,
    };
  }

  function renderLinks() {
    const svg = els.svg;
    svg.innerHTML = '';
    if (!graph) return;
    graph.links.forEach((l, i) => {
      const a = portDotPos(l.from, l.fromPort, 'out');
      const b = portDotPos(l.to, l.toPort, 'in');
      if (!a || !b) return;
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      const dx = Math.max(40, Math.abs(b.x - a.x) / 2);
      path.setAttribute('d', 'M' + a.x + ',' + a.y + ' C' + (a.x + dx) + ',' + a.y + ' ' + (b.x - dx) + ',' + b.y + ' ' + b.x + ',' + b.y);
      path.setAttribute('class', 'vs-link ' + (l.kind === 'flow' ? 'vs-link-flow' : 'vs-link-data') + (selection.linkIndex === i ? ' vs-selected' : ''));
      path.onclick = (e) => {
        e.stopPropagation();
        selection = { nodeId: null, linkIndex: i };
        renderSidebar();
        renderLinks();
        refreshSelectionClasses();
      };
      svg.appendChild(path);
    });
    if (linkDrag) {
      const a = portDotPos(linkDrag.from, linkDrag.fromPort, 'out');
      if (a) {
        const canvasRect = els.canvas.getBoundingClientRect();
        const bx = (linkDrag.mouseX - canvasRect.left) / view.scale;
        const by = (linkDrag.mouseY - canvasRect.top) / view.scale;
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        const dx = Math.max(40, Math.abs(bx - a.x) / 2);
        path.setAttribute('d', 'M' + a.x + ',' + a.y + ' C' + (a.x + dx) + ',' + a.y + ' ' + (bx - dx) + ',' + by + ' ' + bx + ',' + by);
        path.setAttribute('class', 'vs-link vs-link-drag');
        svg.appendChild(path);
      }
    }
  }

  function refreshSelectionClasses() {
    els.nodeLayer.querySelectorAll('.vs-node').forEach(el => {
      el.classList.toggle('vs-selected', el.dataset.nodeId === selection.nodeId);
    });
  }

  function updateLiveHighlight() {
    const active = currentId ? liveActive[currentId] : null;
    els.nodeLayer.querySelectorAll('.vs-node').forEach(el => {
      el.classList.toggle('vs-live', !!active && el.dataset.nodeId === active);
    });
  }

  // ── Sidebar ─────────────────────────────────────────────────────────────

  function renderSidebar() {
    const sb = els.sidebar;
    sb.innerHTML = '';
    if (!graph) return;

    const title = div('vs-side-title');
    title.textContent = 'Script settings';
    sb.appendChild(title);

    sb.appendChild(fieldText('Name', graph.name, v => { graph.name = v; markDirty(); }));
    sb.appendChild(fieldNumber('Idle fail-safe (sec, 0=off)', graph.idleFailSafeSec, v => { graph.idleFailSafeSec = v; markDirty(); }));

    if (selection.linkIndex >= 0 && graph.links[selection.linkIndex]) {
      const l = graph.links[selection.linkIndex];
      const t = div('vs-side-title');
      t.textContent = 'Link';
      sb.appendChild(t);
      const info = div('vs-side-info');
      info.textContent = l.from + '.' + l.fromPort + ' → ' + l.to + '.' + l.toPort + ' (' + l.kind + ')';
      sb.appendChild(info);
      sb.appendChild(btn('Delete link', () => {
        graph.links.splice(selection.linkIndex, 1);
        selection.linkIndex = -1;
        markDirty();
        renderLinks();
        renderSidebar();
      }));
      return;
    }

    const node = graph.nodes.find(n => n.id === selection.nodeId);
    if (!node) {
      const hint = div('vs-side-info');
      hint.textContent = 'Select a node to edit its settings. Drag from an output dot to an input dot to connect. Del removes the selection.';
      sb.appendChild(hint);
      return;
    }

    const def = defsByType[node.type];
    const t = div('vs-side-title');
    t.textContent = (def ? def.label : node.type) + '  (' + node.id + ')';
    sb.appendChild(t);
    if (def && def.description) {
      const d = div('vs-side-info');
      d.textContent = def.description;
      sb.appendChild(d);
    }

    (def ? def.params : []).forEach(p => {
      const cur = node.params[p.key] !== undefined ? node.params[p.key] : p.value;
      if (p.type === 'number') {
        sb.appendChild(fieldNumber(p.label, Number(cur) || 0, v => { node.params[p.key] = v; markDirty(); }));
      } else if (p.type === 'boolean') {
        sb.appendChild(fieldCheckbox(p.label, cur === true || cur === 'true', v => { node.params[p.key] = v; markDirty(); }));
      } else if (p.type === 'select') {
        sb.appendChild(fieldSelect(p.label, String(cur), p.options || [], v => { node.params[p.key] = v; markDirty(); }));
      } else {
        sb.appendChild(fieldText(p.label, String(cur === undefined ? '' : cur), v => { node.params[p.key] = v; markDirty(); }));
      }
    });

    sb.appendChild(btn('Delete node', () => deleteSelectedNode()));
  }

  function fieldWrap(label) {
    const w = div('vs-field');
    const l = document.createElement('label');
    l.textContent = label;
    w.appendChild(l);
    return w;
  }
  function fieldText(label, value, onChange) {
    const w = fieldWrap(label);
    const i = document.createElement('input');
    i.type = 'text';
    i.value = value == null ? '' : value;
    i.oninput = () => onChange(i.value);
    w.appendChild(i);
    return w;
  }
  function fieldNumber(label, value, onChange) {
    const w = fieldWrap(label);
    const i = document.createElement('input');
    i.type = 'number';
    i.value = value;
    i.oninput = () => onChange(Number(i.value) || 0);
    w.appendChild(i);
    return w;
  }
  function fieldCheckbox(label, value, onChange) {
    const w = fieldWrap(label);
    const i = document.createElement('input');
    i.type = 'checkbox';
    i.checked = value;
    i.onchange = () => onChange(i.checked);
    w.appendChild(i);
    return w;
  }
  function fieldSelect(label, value, options, onChange) {
    const w = fieldWrap(label);
    const s = document.createElement('select');
    options.forEach(o => {
      const opt = document.createElement('option');
      opt.value = o;
      opt.textContent = o;
      s.appendChild(opt);
    });
    s.value = value;
    s.onchange = () => onChange(s.value);
    w.appendChild(s);
    return w;
  }

  function deleteSelectedNode() {
    if (!graph || !selection.nodeId) return;
    const id = selection.nodeId;
    graph.nodes = graph.nodes.filter(n => n.id !== id);
    graph.links = graph.links.filter(l => l.from !== id && l.to !== id);
    selection = { nodeId: null, linkIndex: -1 };
    markDirty();
    renderCanvas();
    renderSidebar();
  }

  // ── Canvas events ───────────────────────────────────────────────────────

  function bindCanvasEvents() {
    els.canvasWrap.onmousedown = (e) => {
      if (e.target !== els.canvasWrap && e.target !== els.canvas && e.target !== els.svg && e.target !== els.nodeLayer) return;
      selection = { nodeId: null, linkIndex: -1 };
      dragState = { kind: 'pan', startX: e.clientX, startY: e.clientY, origX: view.x, origY: view.y };
      renderSidebar();
      renderLinks();
      refreshSelectionClasses();
    };

    window.addEventListener('mousemove', (e) => {
      if (linkDrag) {
        linkDrag.mouseX = e.clientX;
        linkDrag.mouseY = e.clientY;
        renderLinks();
        return;
      }
      if (!dragState) return;
      const dx = e.clientX - dragState.startX;
      const dy = e.clientY - dragState.startY;
      if (dragState.kind === 'pan') {
        view.x = dragState.origX + dx;
        view.y = dragState.origY + dy;
        applyView();
      } else if (dragState.kind === 'node' && graph) {
        const node = graph.nodes.find(n => n.id === dragState.nodeId);
        if (node) {
          node.x = Math.round(dragState.origX + dx / view.scale);
          node.y = Math.round(dragState.origY + dy / view.scale);
          const el = els.nodeLayer.querySelector('.vs-node[data-node-id="' + node.id + '"]');
          if (el) { el.style.left = node.x + 'px'; el.style.top = node.y + 'px'; }
          renderLinks();
        }
      }
    });

    window.addEventListener('mouseup', () => {
      if (dragState && dragState.kind === 'node') markDirty();
      dragState = null;
      if (linkDrag) { linkDrag = null; renderLinks(); }
    });

    els.canvasWrap.addEventListener('wheel', (e) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.1 : 0.9;
      const next = Math.min(2, Math.max(0.4, view.scale * factor));
      const rect = els.canvasWrap.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      view.x = mx - ((mx - view.x) / view.scale) * next;
      view.y = my - ((my - view.y) / view.scale) * next;
      view.scale = next;
      applyView();
    }, { passive: false });
  }

  function bindKeys() {
    window.addEventListener('keydown', (e) => {
      if (!container || !container.offsetParent) return;
      const tag = (document.activeElement && document.activeElement.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selection.nodeId) deleteSelectedNode();
        else if (selection.linkIndex >= 0 && graph) {
          graph.links.splice(selection.linkIndex, 1);
          selection.linkIndex = -1;
          markDirty();
          renderLinks();
          renderSidebar();
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        saveScript();
      }
    });
  }

  // ── Styles ──────────────────────────────────────────────────────────────

  function injectStyles() {
    if (document.getElementById('vs-styles')) return;
    const s = document.createElement('style');
    s.id = 'vs-styles';
    s.textContent = `
.vs-root { display:flex; flex-direction:column; height:100%; min-height:560px; color:#ddd; }
.vs-toolbar { display:flex; gap:8px; align-items:center; padding:8px; border-bottom:1px solid #333; }
.vs-select { background:#1c1c22; color:#ddd; border:1px solid #444; border-radius:4px; padding:4px 8px; min-width:180px; }
.vs-btn { background:#2a2a33; color:#ddd; border:1px solid #444; border-radius:4px; padding:4px 12px; cursor:pointer; }
.vs-btn:hover { background:#38384a; }
.vs-btn.vs-on { background:#2e5c3a; border-color:#4caf7d; }
.vs-btn.vs-attention { border-color:#c9a227; color:#ffd75e; }
.vs-status { margin-left:auto; font-size:12px; color:#8f8; }
.vs-status.vs-error { color:#f88; }
.vs-body { display:flex; flex:1; min-height:0; }
.vs-palette { width:170px; overflow-y:auto; border-right:1px solid #333; padding:6px; }
.vs-pal-title { font-weight:600; margin-bottom:6px; }
.vs-pal-cat { font-size:10px; letter-spacing:1px; margin:8px 0 3px; }
.vs-pal-item { padding:4px 8px; margin:2px 0; background:#1c1c22; border:1px solid #333; border-left:3px solid #666; border-radius:3px; cursor:pointer; font-size:12px; }
.vs-pal-item:hover { background:#2a2a36; }
.vs-canvas-wrap { flex:1; position:relative; overflow:hidden; background:#121217; background-image:radial-gradient(#222 1px, transparent 1px); background-size:24px 24px; }
.vs-canvas { position:absolute; transform-origin:0 0; width:0; height:0; overflow:visible; }
.vs-links { position:absolute; overflow:visible; width:1px; height:1px; }
.vs-nodes { position:absolute; }
.vs-empty { position:absolute; left:40px; top:40px; color:#777; white-space:nowrap; }
.vs-node { position:absolute; min-width:140px; background:#1e1e26; border:1px solid #3a3a48; border-radius:6px; box-shadow:0 2px 10px rgba(0,0,0,.5); user-select:none; }
.vs-node.vs-selected { border-color:#8f7bff; box-shadow:0 0 0 1px #8f7bff, 0 2px 10px rgba(0,0,0,.5); }
.vs-node.vs-live { border-color:#4caf7d; box-shadow:0 0 8px #4caf7d88; }
.vs-node-head { padding:4px 10px; font-size:12px; font-weight:600; color:#111; border-radius:5px 5px 0 0; cursor:move; }
.vs-node-body { display:flex; justify-content:space-between; padding:6px 4px; gap:8px; }
.vs-ports { display:flex; flex-direction:column; gap:3px; }
.vs-port { display:flex; align-items:center; gap:5px; font-size:11px; color:#aab; }
.vs-port-out { justify-content:flex-end; }
.vs-port-dot { width:10px; height:10px; border-radius:50%; background:#4a90d9; cursor:crosshair; flex:none; }
.vs-port-dot.vs-flow { border-radius:2px; background:#c9a227; }
.vs-port-dot:hover { outline:2px solid #fff5; }
.vs-node-id { font-size:9px; color:#667; padding:0 6px 3px; text-align:right; }
.vs-link { fill:none; stroke-width:2; cursor:pointer; pointer-events:stroke; }
.vs-link-flow { stroke:#c9a227; }
.vs-link-data { stroke:#4a90d9; stroke-dasharray:5 3; }
.vs-link-drag { stroke:#888; stroke-dasharray:3 3; }
.vs-link.vs-selected { stroke:#fff; stroke-width:3; }
.vs-sidebar { width:230px; border-left:1px solid #333; padding:8px; overflow-y:auto; }
.vs-side-title { font-weight:600; margin:6px 0; font-size:13px; }
.vs-side-info { font-size:11px; color:#99a; margin-bottom:8px; }
.vs-field { margin:6px 0; }
.vs-field label { display:block; font-size:11px; color:#99a; margin-bottom:2px; }
.vs-field input[type=text], .vs-field input[type=number], .vs-field select { width:100%; background:#1c1c22; color:#ddd; border:1px solid #444; border-radius:3px; padding:3px 6px; box-sizing:border-box; }
`;
    document.head.appendChild(s);
  }

  window.VisualScriptEditor = { init, onMessage, fit: fitToViewport };
})();
