<script>
  import { onMount, onDestroy } from 'svelte';
  import { ParticleSystem } from './lib/particles.js';
  import { invoke } from '@tauri-apps/api/core';
  import { register, unregister, isRegistered } from '@tauri-apps/plugin-global-shortcut';
  import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
  import { emit } from '@tauri-apps/api/event';
  import { listen } from '@tauri-apps/api/event';

  function focus(node) {
    node.focus();
  }

  let inputs = $state([]);
  let outputs = $state([]);
  let latestOutput = $state(null);

  // Check URL for panel parameter (for separate windows)
  const urlParams = new URLSearchParams(window.location.search);
  const panelMode = urlParams.get('panel'); // 'inputs' or 'outputs'

  let editValue = $state('');
  let editingInputIndex = $state(-1);

  let tempColor = $state(localStorage.getItem('rng-accent-color') || '#263ed2');
  let showCompletionModal = $state(false);
  let outputMode = $state(localStorage.getItem('rng-output-mode') || 'single');
  let outputSelections = $state([]);
  let inputSelections = $state([]);
  let showSettingsMenu = $state(false);
  let colorPickerOpen = $state(false);

  // --- New settings ---
  let particlesEnabled = $state(localStorage.getItem('rng-particles') !== 'false');
  let volume = $state(parseFloat(localStorage.getItem('rng-volume') ?? '1'));
  let shortcutKeys = $state(JSON.parse(localStorage.getItem('rng-shortcut') || 'null') || { alt: true, shift: true, ctrl: false, key: 'r' });
  let recordingShortcut = $state(false);
  let notifyOnShortcut = $state(localStorage.getItem('rng-notify-shortcut') === 'true');
  let shortcutDisplay = $derived(
    [shortcutKeys.ctrl && 'Ctrl', shortcutKeys.alt && 'Alt', shortcutKeys.shift && 'Shift', shortcutKeys.key?.toUpperCase()].filter(Boolean).join(' + ')
  );

  // --- Dockable panels ---
  let inputDocked = $state(localStorage.getItem('rng-input-docked') !== 'false');
  let outputDocked = $state(localStorage.getItem('rng-output-docked') !== 'false');
  let inputPos = $state(JSON.parse(localStorage.getItem('rng-input-pos') || 'null') || { x: 20, y: 60 });
  let outputPos = $state(JSON.parse(localStorage.getItem('rng-output-pos') || 'null') || { x: null, y: 60 });

  // Apply accent color synchronously before first render to avoid flash
  {
    const _c = tempColor;
    const _r = parseInt(_c.slice(1,3), 16);
    const _g = parseInt(_c.slice(3,5), 16);
    const _b = parseInt(_c.slice(5,7), 16);
    document.documentElement.style.setProperty('--accent', _c);
    document.documentElement.style.setProperty('--accent-glow', `rgba(${_r}, ${_g}, ${_b}, 0.3)`);
    document.documentElement.style.setProperty('--accent-bg-hover', `rgba(${_r}, ${_g}, ${_b}, 0.1)`);
    document.documentElement.style.setProperty('--accent-glow-medium', `rgba(${_r}, ${_g}, ${_b}, 0.15)`);
  }

  let svCanvasRef = null;
  let svWrapRef = null;

  const _initHsv = (function () {
    const r = parseInt(tempColor.slice(1,3), 16) / 255;
    const g = parseInt(tempColor.slice(3,5), 16) / 255;
    const b = parseInt(tempColor.slice(5,7), 16) / 255;
    const maxC = Math.max(r, g, b), minC = Math.min(r, g, b);
    const delta = maxC - minC;
    let h = 0;
    if (delta !== 0) {
      if (maxC === r) h = (((g - b) / delta) % 6);
      else if (maxC === g) h = ((b - r) / delta + 2);
      else h = ((r - g) / delta + 4);
    }
    return { h: Math.round(h * 60), s: maxC === 0 ? 0 : Math.round(delta / maxC * 100), v: Math.round(maxC * 100) };
  })();
  let hueVal = $state(_initHsv.h);
  let satVal = $state(_initHsv.s);
  let valVal = $state(_initHsv.v);

  function hsvToRgbStr(h, s, v) {
    h = ((h % 360) + 360) % 360;
    const c = (v / 100) * (s / 100);
    const x = c * (1 - Math.abs((h / 60) % 2 - 1));
    const m = v / 100 - c;
    let r, g, b;
    if (h < 60) { r = c; g = x; b = 0; }
    else if (h < 120) { r = x; g = c; b = 0; }
    else if (h < 180) { r = 0; g = c; b = x; }
    else if (h < 240) { r = 0; g = x; b = c; }
    else if (h < 300) { r = x; g = 0; b = c; }
    else { r = c; g = 0; b = x; }
    return `#${Math.round((r + m) * 255).toString(16).padStart(2, '0')}${Math.round((g + m) * 255).toString(16).padStart(2, '0')}${Math.round((b + m) * 255).toString(16).padStart(2, '0')}`;
  }

  let canvasRef = null;
  let outputCanvasRef = null;
  let particleSystem = $state(null);
  let outputParticleSystem = $state(null);
  let prevOutputsLen = 0;
  let resizeObserver = null;
  let shortcutHandler = null;
  let deleteHandler = null;
  let svDragging = false;
  let hueDragging = false;

  function playAudio(url) {
    try { const a = new Audio(url); a.volume = volume; a.play(); } catch (e) {}
  }

  function drawSV() {
    if (!svCanvasRef || !svWrapRef) return;
    const w = svWrapRef.offsetWidth;
    if (w === 0) return;
    const ctx = svCanvasRef.getContext('2d');
    const h = 150;
    svCanvasRef.width = w * 2;
    svCanvasRef.height = h * 2;
    ctx.scale(2, 2);
    const gW = ctx.createLinearGradient(0, 0, w, 0);
    gW.addColorStop(0, '#fff');
    gW.addColorStop(1, `hsl(${hueVal}, 100%, 50%)`);
    ctx.fillStyle = gW; ctx.fillRect(0, 0, w, h);
    const gB = ctx.createLinearGradient(0, 0, 0, h);
    gB.addColorStop(0, 'rgba(0,0,0,0)'); gB.addColorStop(1, '#000');
    ctx.fillStyle = gB; ctx.fillRect(0, 0, w, h);
    const thumbX = (satVal / 100) * w;
    const thumbY = ((100 - valVal) / 100) * h;
    ctx.beginPath(); ctx.arc(thumbX, thumbY, 6, 0, Math.PI * 2);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
    ctx.beginPath(); ctx.arc(thumbX, thumbY, 4, 0, Math.PI * 2);
    ctx.fillStyle = hsvToRgbStr(hueVal, satVal, valVal); ctx.fill();
  }

  function startSVDrag(e) {
    e.preventDefault(); e.stopPropagation(); svDragging = true; updateSVFromEvent(e);
    const onMove = (ev) => { if (svDragging) updateSVFromEvent(ev); };
    const onUp = () => { svDragging = false; window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp);
  }

  function startHueDrag(e) {
    e.preventDefault(); e.stopPropagation(); hueDragging = true; hueFromEvent(e);
    const onMove = (ev) => { if (hueDragging) hueFromEvent(ev); };
    const onUp = () => { hueDragging = false; window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp);
  }

  function updateSVFromEvent(e) {
    if (!svWrapRef) return;
    const rect = svWrapRef.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    satVal = Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100));
    valVal = Math.min(100, Math.max(0, 100 - ((clientY - rect.top) / rect.height) * 100));
    tempColor = hsvToRgbStr(hueVal, satVal, valVal);
    updateAccentColor(tempColor); drawSV();
  }

  function hueFromEvent(e) {
    if (!svWrapRef) return;
    const rect = svWrapRef.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    hueVal = Math.min(360, Math.max(0, ((clientX - rect.left) / rect.width) * 360));
    tempColor = hsvToRgbStr(hueVal, satVal, valVal);
    updateAccentColor(tempColor); drawSV();
  }

  async function rpc(cmd, args) { return invoke(cmd, args ?? {}); }

  async function refreshState() {
    const state = await rpc('get_state');
    if (state) {
      inputs = state.inputs || [];
      outputs = state.outputs || [];
      outputMode = state.output_mode || 'single';

      if (outputs.length > prevOutputsLen && particlesEnabled && particleSystem && canvasRef) {
        const lastOutputEl = document.querySelector('.latest-output-item');
        if (lastOutputEl) {
          const elRect = lastOutputEl.getBoundingClientRect();
          for (let i = 0; i < 6; i++) {
            particleSystem.particles.push({
              x: elRect.left + Math.random() * elRect.width, y: elRect.bottom,
              vx: (Math.random() - 0.5) * 0.3, vy: -(0.4 + Math.random() * 0.6),
              size: 1.5 + Math.random() * 2, alpha: 0.5, color: tempColor,
            });
          }
          particleSystem.startAnimation();
          lastOutputEl.classList.add('new');
          setTimeout(() => lastOutputEl.classList.remove('new'), 300);
        }
      }
      prevOutputsLen = outputs.length;
    }
  }

  $effect(() => {
    const _h = hueVal;
    if (colorPickerOpen && svCanvasRef) drawSV();
    return () => {};
  });

  function matchesShortcut(e) {
    return e.code === `Key${shortcutKeys.key.toUpperCase()}` &&
      !!e.altKey === !!shortcutKeys.alt &&
      !!e.shiftKey === !!shortcutKeys.shift &&
      !!e.ctrlKey === !!shortcutKeys.ctrl;
  }

  function makeShortcutHandler() {
    return (e) => {
      if (recordingShortcut) return;
      if (matchesShortcut(e)) { e.preventDefault(); handleGenerate(); }
    };
  }

  function getShortcutString() {
    const parts = [];
    if (shortcutKeys.ctrl) parts.push('CommandOrControl');
    if (shortcutKeys.alt) parts.push('Alt');
    if (shortcutKeys.shift) parts.push('Shift');
    parts.push('Key' + shortcutKeys.key.toUpperCase());
    return parts.join('+');
  }

  function setupDocumentShortcut() {
    if (shortcutHandler) document.removeEventListener('keydown', shortcutHandler);
    shortcutHandler = (e) => {
      console.log('Document keydown:', e.key, e.code, 'ctrl:', e.ctrlKey, 'alt:', e.altKey, 'shift:', e.shiftKey);
      console.log('Expected key:', shortcutKeys.key, 'ctrl:', shortcutKeys.ctrl, 'alt:', shortcutKeys.alt, 'shift:', shortcutKeys.shift);
      if (matchesShortcut(e) && !recordingShortcut) {
        console.log('Shortcut matched!');
        e.preventDefault();
        e.stopPropagation();
        handleGenerate();
      }
    };
    document.addEventListener('keydown', shortcutHandler, true);
    console.log('Document shortcut fallback registered');
  }

  async function registerGlobalShortcut() {
    const shortcutStr = getShortcutString();
    console.log('Registering global shortcut:', shortcutStr);
    try {
      const alreadyRegistered = await isRegistered(shortcutStr);
      console.log('Already registered:', alreadyRegistered);
      if (alreadyRegistered) {
        await unregister(shortcutStr);
      }
      await register(shortcutStr, async (event) => {
        console.log('Shortcut pressed:', event.state);
        if (event.state === 'Pressed' && !recordingShortcut) {
          await handleGenerate();
          if (notifyOnShortcut) {
            await invoke('send_notification', { title: 'RNG', body: `Generated: ${latestOutput || '(none)'}` });
          }
        }
      });
      console.log('Global shortcut registered successfully');
    } catch (e) {
      console.warn('Global shortcut failed, using fallback:', e);
    }
    // Always set up document shortcut as reliable fallback
    setupDocumentShortcut();
  }

  onMount(async () => {
    await refreshState();

    // Always listen for state updates from other windows
    unlistenState = await listen('state-updated', async () => {
      await refreshState();
    });

    // Listen for dock commands from standalone windows (only needed in main window)
    if (!panelMode) {
      unlistenDock = await listen('dock-panel', async (event) => {
        const panel = event.payload.panel;
        if (panel === 'inputs' && inputWindow) {
          try { await inputWindow.close(); } catch {}
          inputWindow = null;
          inputDocked = true;
          localStorage.setItem('rng-input-docked', 'true');
        } else if (panel === 'outputs' && outputWindow) {
          try { await outputWindow.close(); } catch {}
          outputWindow = null;
          outputDocked = true;
          localStorage.setItem('rng-output-docked', 'true');
        }
      });
    }

    setTimeout(() => {
      if (canvasRef) {
        const rect = canvasRef.parentElement.getBoundingClientRect();
        canvasRef.width = rect.width; canvasRef.height = rect.height;
        particleSystem = new ParticleSystem(canvasRef);
        resizeObserver = new ResizeObserver(() => {
          if (canvasRef) { const r = canvasRef.parentElement.getBoundingClientRect(); canvasRef.width = r.width; canvasRef.height = r.height; }
          if (outputCanvasRef) { const r = outputCanvasRef.parentElement.getBoundingClientRect(); outputCanvasRef.width = r.width; outputCanvasRef.height = r.height; }
        });
        resizeObserver.observe(canvasRef.parentElement);
        if (outputCanvasRef) resizeObserver.observe(outputCanvasRef.parentElement);
      }
      if (outputCanvasRef) {
        const rect = outputCanvasRef.parentElement.getBoundingClientRect();
        outputCanvasRef.width = rect.width; outputCanvasRef.height = rect.height;
        outputParticleSystem = new ParticleSystem(outputCanvasRef);
      }
    }, 100);

    // Setup document shortcut immediately (primary method)
    setupDocumentShortcut();

    // Also try to register global shortcut for when app is minimized
    await registerGlobalShortcut().catch(() => {});

    deleteHandler = (e) => {
      if (e.key !== 'Delete') return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (inputSelections.length > 0) handleBatchRemoveInputs();
      else if (outputSelections.length > 0) handleBatchRemoveOutputs();
    };
    document.addEventListener('keydown', deleteHandler);
  });

  $effect(() => {
    const _len = outputs.length;
    const _enabled = particlesEnabled;
    if (!_enabled || outputs.length === 0 || !particleSystem) return;
    const el = document.querySelector('.latest-output-item');
    if (!el) return;
    const canvasRect = canvasRef.getBoundingClientRect();
    const sparkleInterval = setInterval(() => {
      if (!particlesEnabled || outputs.length === 0 || !particleSystem) return;
      const el = document.querySelector('.latest-output-item');
      if (!el) return;
      const rect = el.getBoundingClientRect();
      for (let i = 0; i < 2; i++) {
        particleSystem.particles.push({
          x: rect.left - canvasRect.left + Math.random() * rect.width,
          y: rect.bottom - canvasRect.top,
          vx: (Math.random() - 0.5) * 0.3, vy: -(0.4 + Math.random() * 0.6),
          size: 1.5 + Math.random() * 2, alpha: 0.5, color: tempColor,
        });
      }
      particleSystem.startAnimation();
    }, 300);
    return () => clearInterval(sparkleInterval);
  });

  let prevParticlesEnabled = particlesEnabled;
  $effect(() => {
    if (particlesEnabled && !prevParticlesEnabled && particleSystem && canvasRef) {
      particleSystem.risingUpward(15, tempColor);
      particleSystem.startAnimation();
    }
    prevParticlesEnabled = particlesEnabled;
  });

  onDestroy(async () => {
    if (resizeObserver) resizeObserver.disconnect();
    if (unlistenState) unlistenState();
    if (unlistenDock) unlistenDock();
    try { await unregister(getShortcutString()); } catch {}
    if (shortcutHandler) document.removeEventListener('keydown', shortcutHandler);
    if (deleteHandler) document.removeEventListener('keydown', deleteHandler);
  });

  async function handleAddInput(value) {
    if (!value || !value.trim()) return;
    const parts = value.split('|').map(s => s.trim()).filter(Boolean);
    for (const part of parts) await rpc('add_input', { value: part });
    await refreshState();
    emit('state-updated');
  }

  async function handleClearInputs() {
    await rpc('clear_inputs'); inputSelections = []; await refreshState();
    emit('state-updated');
  }

  async function handleGenerate() {
    if (inputs.length === 0) return;
    if (outputMode === 'batch') { await handleBatchGenerate(); return; }
    const result = await rpc('generate');
    if (!result) {
      showCompletionModal = true;
      playAudio(new URL('./assets/yup-03.aac', import.meta.url).href);
      return;
    }
    latestOutput = result;
    playAudio(new URL('./assets/bew.aac', import.meta.url).href);
    updateAccentColors(tempColor);
    document.documentElement.style.setProperty('--accent', tempColor);
    if (particlesEnabled && outputParticleSystem && outputCanvasRef) {
      outputParticleSystem.risingUpward(150, tempColor);
      outputParticleSystem.startAnimation();
    }
    const latestField = document.querySelector('.latest-output-field');
    if (latestField) { latestField.classList.add('pulse'); setTimeout(() => latestField.classList.remove('pulse'), 600); }
    await refreshState();
    emit('state-updated');
    const centerPanel = document.querySelector('.center-panel');
    if (centerPanel) { centerPanel.classList.remove('animate-border'); void centerPanel.offsetWidth; centerPanel.classList.add('animate-border'); }
  }

  function toggleInputSelect(index) {
    if (inputSelections.includes(index)) inputSelections = inputSelections.filter(i => i !== index);
    else inputSelections = [...inputSelections, index];
  }

  async function handleBatchRemoveInputs() {
    if (inputSelections.length === 0) return;
    const indices = [...inputSelections].sort((a, b) => b - a);
    for (const i of indices) await rpc('remove_input', { index: i });
    inputSelections = []; await refreshState();
  }

  function toggleOutputSelect(value) {
    if (outputSelections.includes(value)) outputSelections = outputSelections.filter(v => v !== value);
    else outputSelections = [...outputSelections, value];
  }

  async function handleBatchRemoveOutputs() {
    if (outputSelections.length === 0) return;
    for (const v of outputSelections) await rpc('remove_output', { value: v });
    outputSelections = []; await refreshState();
  }

  function handleItemSelect(e, type) {
    if (e.target.classList.contains('checkmark')) return;
    if (type === 'input') toggleInputSelect(parseInt(e.currentTarget.dataset.index));
    else toggleOutputSelect(e.currentTarget.dataset.value);
  }

  async function handleClearOutputs() {
    showCompletionModal = false;
    await rpc('clear_outputs'); latestOutput = null; outputSelections = []; await refreshState();
    emit('state-updated');
  }

  function updateAccentColors(color) {
    const r = parseInt(color.slice(1,3), 16);
    const g = parseInt(color.slice(3,5), 16);
    const b = parseInt(color.slice(5,7), 16);
    document.documentElement.style.setProperty('--accent-glow', `rgba(${r}, ${g}, ${b}, 0.3)`);
    document.documentElement.style.setProperty('--accent-bg-hover', `rgba(${r}, ${g}, ${b}, 0.1)`);
    document.documentElement.style.setProperty('--accent-glow-medium', `rgba(${r}, ${g}, ${b}, 0.15)`);
  }

  function updateAccentColor(color) {
    tempColor = color;
    localStorage.setItem('rng-accent-color', color);
    document.documentElement.style.setProperty('--accent', color);
    updateAccentColors(color);
  }

  function startEditing(index, value) { editingInputIndex = index; editValue = value; }

  async function saveEdit() {
    if (editingInputIndex === -1 || !editValue.trim()) return;
    await rpc('update_input', { index: editingInputIndex, value: editValue.trim() });
    editingInputIndex = -1; editValue = ''; await refreshState();
  }

  function cancelEdit() { editingInputIndex = -1; editValue = ''; }

  async function setOutputMode(mode) {
    outputMode = mode;
    localStorage.setItem('rng-output-mode', mode);
    await rpc('set_output_mode', { mode });
  }

  async function handleBatchGenerate() {
    if (inputs.length === 0) return;
    const [results] = await rpc('batch_generate');
    if (!results || results.length === 0) {
      showCompletionModal = true;
      playAudio(new URL('./assets/yup-03.aac', import.meta.url).href);
      return;
    }
    latestOutput = null;
    playAudio(new URL('./assets/bip-bop-02.aac', import.meta.url).href);
    updateAccentColors(tempColor);
    document.documentElement.style.setProperty('--accent', tempColor);
    if (particlesEnabled && outputParticleSystem && outputCanvasRef) {
      outputParticleSystem.risingUpward(150, tempColor);
      outputParticleSystem.startAnimation();
    }
    await refreshState();
    emit('state-updated');
    const centerPanel = document.querySelector('.center-panel');
    if (centerPanel) { centerPanel.classList.remove('animate-border'); void centerPanel.offsetWidth; centerPanel.classList.add('animate-border'); }
  }

  // --- Shortcut recording ---
  function startRecordingShortcut() { recordingShortcut = true; }

  async function onShortcutKeydown(e) {
    if (!recordingShortcut) return;
    e.preventDefault(); e.stopPropagation();
    if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;
    shortcutKeys = { ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, key: e.key.toLowerCase() };
    localStorage.setItem('rng-shortcut', JSON.stringify(shortcutKeys));
    recordingShortcut = false;
    await registerGlobalShortcut();
  }

  // --- Docking ---
  let inputWindow = null;
  let outputWindow = null;
  let unlistenState = null;
  let unlistenDock = null;

  async function toggleInputDock() {
    if (inputDocked) {
      // Currently docked - switch to undocked (separate window)
      try {
        inputWindow = new WebviewWindow('inputs-window', {
          url: 'index.html?panel=inputs',
          title: 'RNG - Inputs',
          width: 280,
          height: 400,
          x: 100,
          y: 100,
          decorations: true,
          resizable: true,
          alwaysOnTop: false
        });
        inputWindow.once('tauri://destroyed', () => { inputWindow = null; inputDocked = true; });
        inputDocked = false;
      } catch (e) { console.error('Failed to create input window:', e); }
    } else {
      // Currently undocked - switch to docked (inline)
      if (inputWindow) {
        try { await inputWindow.close(); } catch {}
        inputWindow = null;
      }
      inputDocked = true;
    }
    localStorage.setItem('rng-input-docked', String(inputDocked));
  }

  async function toggleOutputDock() {
    if (outputDocked) {
      // Currently docked - switch to undocked (separate window)
      try {
        outputWindow = new WebviewWindow('outputs-window', {
          url: 'index.html?panel=outputs',
          title: 'RNG - Outputs',
          width: 280,
          height: 400,
          x: 400,
          y: 100,
          decorations: true,
          resizable: true,
          alwaysOnTop: false
        });
        outputWindow.once('tauri://destroyed', () => { outputWindow = null; outputDocked = true; });
        outputDocked = false;
      } catch (e) { console.error('Failed to create output window:', e); }
    } else {
      // Currently undocked - switch to docked (inline)
      if (outputWindow) {
        try { await outputWindow.close(); } catch {}
        outputWindow = null;
      }
      outputDocked = true;
    }
    localStorage.setItem('rng-output-docked', String(outputDocked));
  }

  function startPanelDrag(e, panel) {
    if (e.target.closest('button, input, .list-item')) return;
    e.preventDefault();
    const startX = e.clientX, startY = e.clientY;
    const startPos = panel === 'input' ? { ...inputPos } : { ...outputPos };
    const onMove = (ev) => {
      const dx = ev.clientX - startX, dy = ev.clientY - startY;
      if (panel === 'input') {
        inputPos = { x: (startPos.x || 0) + dx, y: (startPos.y || 60) + dy };
        localStorage.setItem('rng-input-pos', JSON.stringify(inputPos));
      } else {
        outputPos = { x: (startPos.x ?? window.innerWidth - 310) + dx, y: (startPos.y || 60) + dy };
        localStorage.setItem('rng-output-pos', JSON.stringify(outputPos));
      }
    };
    const onUp = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp);
  }

  let inputFloatStyle = $derived(`left: ${inputPos.x || 20}px; top: ${inputPos.y || 60}px;`);
  let outputFloatStyle = $derived(`left: ${outputPos.x ?? (typeof window !== 'undefined' ? window.innerWidth - 310 : 700)}px; top: ${outputPos.y || 60}px;`);
</script>

<!-- Shortcut recording overlay -->
{#if recordingShortcut}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="shortcut-overlay" onkeydown={onShortcutKeydown} tabindex="-1" use:focus>
    <div class="shortcut-dialog">
      <p>Press your new shortcut combination…</p>
      <small style="color: var(--text-secondary)">e.g. Ctrl+Shift+G, Alt+R</small>
      <button onclick={() => recordingShortcut = false}>Cancel</button>
    </div>
  </div>
{/if}

{#if showCompletionModal}
  <div class="completion-modal">
    <h2>All items generated!</h2>
    <p style="color: var(--text-secondary); margin-bottom: 16px;">The list is empty. Clear outputs to restart?</p>
    <div class="modal-actions">
      <button class="btn-secondary" onclick={() => showCompletionModal = false}>Cancel</button>
      <button class="btn-primary" onclick={handleClearOutputs}>Clear & Restart</button>
    </div>
  </div>
{/if}

<!-- Standalone panel windows -->
{#if panelMode === 'inputs'}
  <div class="standalone-panel">
    <div class="sidebar-header">
      <span class="sidebar-title">Inputs</span>
      <div class="sidebar-actions">
        {#if inputSelections.length > 0}
          <button class="icon-btn" onclick={handleBatchRemoveInputs} title="Delete selected ({inputSelections.length})">×</button>
        {:else}
          <button class="icon-btn" onclick={() => handleClearInputs()} title="Clear all">🗑️</button>
        {/if}
<button class="icon-btn" onclick={async () => { await emit('dock-panel', { panel: 'inputs' }); }} title="Dock">📌</button>
        <button class="icon-btn" onclick={async () => { const el = document.getElementById('inputFieldStandalone'); if (el?.value.trim()) { await handleAddInput(el.value); el.value = ''; } else el?.focus(); }} title="Add">+</button>
      </div>
    </div>
    <div class="input-list">
      {#each inputs as item, i (i)}
        {#if editingInputIndex === i}
          <div class="list-item edit-mode" onclick={(e) => e.stopPropagation()}>
            <input type="text" class="edit-input" bind:value={editValue} autofocus
              onkeydown={(e) => { if (e.key === 'Enter') { saveEdit(); e.preventDefault(); } else if (e.key === 'Escape') { cancelEdit(); e.preventDefault(); } }} />
          </div>
        {:else}
          <div class="list-item" class:selected={inputSelections.includes(i)} data-index={i}
            onclick={(e) => handleItemSelect(e, 'input')} tabindex="0"
            onkeydown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !e.target.classList.contains('checkmark')) { toggleInputSelect(i); e.preventDefault(); } }}>
            <span class="checkmark-wrap"><input type="checkbox" class="checkmark" onclick={(e) => { e.stopPropagation(); toggleInputSelect(i); }} checked={inputSelections.includes(i)} /></span>
            <span class="item-number">{i + 1}.</span>
            <span class="item-text">{item}</span>
            <span class="edit-link" onclick={(e) => { e.stopPropagation(); startEditing(i, item); }}>Edit</span>
          </div>
        {/if}
      {:else}
        <div class="empty-state">No inputs added yet</div>
      {/each}
    </div>
    <div class="add-input-container">
      <input id="inputFieldStandalone" type="text" class="add-input" placeholder="Type and press Enter..."
        onkeydown={(e) => { if (e.key === 'Enter') { handleAddInput(e.target.value); e.target.value = ''; } }} />
    </div>
  </div>
{:else if panelMode === 'outputs'}
  <div class="standalone-panel">
    <div class="sidebar-header">
      <span class="sidebar-title">Outputs</span>
      <div class="sidebar-actions">
        {#if outputSelections.length > 0}
          <button class="icon-btn" onclick={handleBatchRemoveOutputs} title="Delete selected ({outputSelections.length})">×</button>
        {:else}
          <button class="icon-btn" onclick={() => handleClearOutputs()} title="Clear all">🗑️</button>
        {/if}
        <button class="icon-btn" onclick={async () => { await emit('dock-panel', { panel: 'outputs' }); }} title="Dock">📌</button>
      </div>
    </div>
    <div class="output-list">
      {#each outputs as item, i (i)}
        <div class="list-item" class:latest-output-item={i === outputs.length - 1}
          class:selected={outputSelections.includes(item)} data-value={item}
          onclick={(e) => handleItemSelect(e, 'output')} tabindex="0"
          onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { toggleOutputSelect(item); e.preventDefault(); } }}
          style="border-left: 3px solid var(--accent);">
          <span class="checkmark-wrap"><input type="checkbox" class="checkmark" onclick={(e) => { e.stopPropagation(); toggleOutputSelect(item); }} checked={outputSelections.includes(item)} /></span>
          <span class="item-number">{i + 1}.</span>
          <span class="item-text">{item}</span>
        </div>
      {:else}
        <div class="empty-state">No outputs yet</div>
      {/each}
    </div>
  </div>
{:else}
<div class="app-layout"
  class:input-undocked={!inputDocked}
  class:output-undocked={!outputDocked}>

  <!-- Left sidebar (docked) -->
  {#if inputDocked}
    <div class="sidebar">
      <div class="sidebar-header">
        <span class="sidebar-title">Inputs</span>
        <div class="sidebar-actions">
          {#if inputSelections.length > 0}
            <button class="icon-btn" onclick={handleBatchRemoveInputs} title="Delete selected ({inputSelections.length})">×</button>
          {:else}
            <button class="icon-btn" onclick={() => handleClearInputs()} title="Clear all">🗑️</button>
          {/if}
<button class="icon-btn" onclick={toggleInputDock} title="Undock">⊞</button>
          <button class="icon-btn" onclick={async () => { const el = document.getElementById('inputField'); if (el?.value.trim()) { await handleAddInput(el.value); el.value = ''; } else el?.focus(); }} title="Add">+</button>
        </div>
      </div>
      <div class="input-list">
        {#each inputs as item, i (i)}
          {#if editingInputIndex === i}
            <div class="list-item edit-mode" onclick={(e) => e.stopPropagation()}>
              <input type="text" class="edit-input" bind:value={editValue} autofocus
                onkeydown={(e) => { if (e.key === 'Enter') { saveEdit(); e.preventDefault(); } else if (e.key === 'Escape') { cancelEdit(); e.preventDefault(); } }} />
            </div>
          {:else}
            <div class="list-item" class:selected={inputSelections.includes(i)} data-index={i}
              onclick={(e) => handleItemSelect(e, 'input')} tabindex="0"
              onkeydown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !e.target.classList.contains('checkmark')) { toggleInputSelect(i); e.preventDefault(); } }}>
              <span class="checkmark-wrap"><input type="checkbox" class="checkmark" onclick={(e) => { e.stopPropagation(); toggleInputSelect(i); }} checked={inputSelections.includes(i)} /></span>
              <span class="item-number">{i + 1}.</span>
              <span class="item-text">{item}</span>
              <span class="edit-link" onclick={(e) => { e.stopPropagation(); startEditing(i, item); }}>Edit</span>
            </div>
          {/if}
        {:else}
          <div class="empty-state">No inputs added yet</div>
        {/each}
      </div>
      <div class="add-input-container">
        <input id="inputField" type="text" class="add-input" placeholder="Type and press Enter..."
          onkeydown={(e) => { if (e.key === 'Enter') { handleAddInput(e.target.value); e.target.value = ''; } }} />
      </div>
    </div>
  {:else}
    <div class="sidebar-placeholder"></div>
  {/if}

  <!-- Center Panel -->
  <div class="center-panel" onclick={(e) => { if (!e.target.closest('.hamburger-btn') && !e.target.closest('.settings-panel')) showSettingsMenu = false; }}>
    <button class="hamburger-btn" onclick={(e) => { e.stopPropagation(); showSettingsMenu = !showSettingsMenu; }} title="Settings">&#x2630;</button>

    {#if showSettingsMenu}
      <div class="settings-panel">

        <h3>Output Mode</h3>
        <div class="mode-toggle">
          <button class={outputMode === 'single' ? 'mode-btn active' : 'mode-btn'} onclick={() => setOutputMode('single')}>Single</button>
          <button class={outputMode === 'batch' ? 'mode-btn active' : 'mode-btn'} onclick={() => setOutputMode('batch')}>Batch</button>
        </div>

        <h3 style="margin-top:14px">Accent Color</h3>
        {#if !colorPickerOpen}
          <button class="color-wheel-btn" onclick={() => colorPickerOpen = true}>🎨 Pick Color</button>
        {:else}
          <div class="cp-wrap">
            <div class="cp-canvas-wrap" bind:this={svWrapRef} onpointerdown={(e) => startSVDrag(e)}>
              <canvas class="cp-canvas" bind:this={svCanvasRef} height="150"></canvas>
            </div>
            <div class="cp-hue-wrap">
              <div class="cp-hue-track" onpointerdown={(e) => startHueDrag(e)}>
                <div class="cp-hue-thumb" style="left: calc({(hueVal / 360) * 100}% - 4px);"></div>
              </div>
            </div>
            <div class="cp-output">
              <div class="cp-swatch" style="background: {tempColor};"></div>
              <input class="cp-hex" bind:value={tempColor} oninput={(e) => { if (/^#[0-9A-Fa-f]{6}$/.test(e.currentTarget.value)) updateAccentColor(e.currentTarget.value); }} />
            </div>
            <button class="cp-close-btn" onclick={() => colorPickerOpen = false}>Close</button>
          </div>
        {/if}

        <h3 style="margin-top:14px">Particles</h3>
        <label class="toggle-row">
          <span>Particle effects</span>
          <button class="toggle-btn" class:on={particlesEnabled}
            onclick={() => { particlesEnabled = !particlesEnabled; localStorage.setItem('rng-particles', String(particlesEnabled)); }}>
            {particlesEnabled ? 'On' : 'Off'}
          </button>
        </label>

        <h3 style="margin-top:14px">Volume</h3>
        <div class="volume-row">
          <span class="vol-icon">{volume === 0 ? '🔇' : volume < 0.5 ? '🔉' : '🔊'}</span>
          <input type="range" min="0" max="1" step="0.05" bind:value={volume}
            oninput={() => localStorage.setItem('rng-volume', String(volume))} class="volume-slider" />
          <span class="vol-label">{Math.round(volume * 100)}%</span>
        </div>

        <h3 style="margin-top:14px">Keyboard Shortcut</h3>
        <div class="shortcut-row">
          <span class="shortcut-badge">{shortcutDisplay}</span>
          <button class="icon-btn" onclick={startRecordingShortcut} title="Change shortcut">✏️</button>
        </div>

        <div class="toggle-row">
          <span>Notify on shortcut</span>
          <button class="toggle-btn" class:on={notifyOnShortcut}
            onclick={() => { notifyOnShortcut = !notifyOnShortcut; localStorage.setItem('rng-notify-shortcut', String(notifyOnShortcut)); }}>
            {notifyOnShortcut ? 'On' : 'Off'}
          </button>
        </div>

        <h3 style="margin-top:14px">Panels</h3>
        <div class="dock-row">
          <button class="dock-btn" class:active={inputDocked} onclick={toggleInputDock}>
            {inputDocked ? '📌 Inputs — docked' : '🔓 Inputs — floating'}
          </button>
          <button class="dock-btn" class:active={outputDocked} onclick={toggleOutputDock}>
            {outputDocked ? '📌 Outputs — docked' : '🔓 Outputs — floating'}
          </button>
        </div>

      </div>
    {/if}

    <div class="latest-output-field" class:has-value={latestOutput !== null}>
      {latestOutput ?? 'Generate something...'}
    </div>

    <button class="generate-btn" onclick={handleGenerate} disabled={inputs.length === 0}>
      Generate
    </button>

    <div class="mode-status">Mode: {outputMode.charAt(0).toUpperCase() + outputMode.slice(1)}</div>

    <canvas class="particle-canvas" bind:this={canvasRef}></canvas>
    {#if !outputDocked}
    <canvas class="output-particle-canvas" bind:this={outputCanvasRef}></canvas>
    {/if}
  </div>

  <!-- Right sidebar (docked) -->
  {#if outputDocked}
    <div class="sidebar">
      <div class="sidebar-header">
        <span class="sidebar-title">Outputs</span>
        <div class="sidebar-actions">
          {#if outputSelections.length > 0}
            <button class="icon-btn" onclick={handleBatchRemoveOutputs} title="Delete selected ({outputSelections.length})">×</button>
          {:else}
            <button class="icon-btn" onclick={() => handleClearOutputs()} title="Clear all">🗑️</button>
          {/if}
<button class="icon-btn" onclick={toggleOutputDock} title="Undock">⊞</button>
        </div>
      </div>
      <div class="output-list">
        {#each outputs as item, i (i)}
          <div class="list-item" class:latest-output-item={i === outputs.length - 1}
            class:selected={outputSelections.includes(item)} data-value={item}
            onclick={(e) => handleItemSelect(e, 'output')} tabindex="0"
            onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { toggleOutputSelect(item); e.preventDefault(); } }}
            style="border-left: 3px solid var(--accent);">
            <span class="checkmark-wrap"><input type="checkbox" class="checkmark" onclick={(e) => { e.stopPropagation(); toggleOutputSelect(item); }} checked={outputSelections.includes(item)} /></span>
            <span class="item-number">{i + 1}.</span>
            <span class="item-text">{item}</span>
          </div>
        {:else}
          <div class="empty-state">No outputs yet</div>
        {/each}
      </div>
      <canvas class="output-particle-canvas" bind:this={outputCanvasRef}></canvas>
    </div>
  {:else}
    <div class="sidebar-placeholder"></div>
  {/if}
</div>
{/if}



<style>
  :root {
    --bg-primary: #121212;
    --bg-secondary: #151515;
    --bg-tertiary: #2e2d2b;
    --bg-input-item: #1a1a1a;
    --bg-output-item: #171717;
    --bg-quaternary: #202020;
    --border-color: #30363d;
    --text-primary: #e6edf3;
    --text-secondary: #8b949e;
    --accent: #263ed2;
  }

  .standalone-panel {
    width: 100%;
    height: 100vh;
    background: var(--bg-secondary);
    border-right: 1px solid var(--border-color);
    display: flex;
    flex-direction: column;
  }

  .standalone-panel .input-list,
  .standalone-panel .output-list {
    flex: 1;
    overflow-y: auto;
    padding: 0;
  }

  .standalone-panel .empty-state {
    color: var(--text-secondary);
    text-align: center;
    padding: 20px;
  }

  html, body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background-color: var(--bg-primary);
    color: var(--text-primary);
    overflow: hidden;
    height: 100%;
    margin: 0;
    padding: 0;
  }

  :global(.app-layout) {
    display: grid;
    grid-template-columns: 280px 1fr 280px;
    gap: 16px;
    padding: 16px;
    height: 100vh;
    max-height: 100vh;
    overflow: hidden;
    transition: grid-template-columns 0.25s ease;
  }

  :global(.app-layout.input-undocked) { grid-template-columns: 0px 1fr 280px; }
  :global(.app-layout.output-undocked) { grid-template-columns: 280px 1fr 0px; }
  :global(.app-layout.input-undocked.output-undocked) { grid-template-columns: 0px 1fr 0px; }

  .sidebar-placeholder { overflow: hidden; min-width: 0; }

  :global(.sidebar) {
    background-color: var(--bg-secondary);
    border-radius: 12px;
    border: 1px solid var(--border-color);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    position: relative;
    min-width: 0;
  }

 

  :global(.sidebar-header) {
    padding: 12px 16px;
    border-bottom: 1px solid var(--border-color);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    flex-shrink: 0;
  }

  :global(.sidebar-title) {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  :global(.icon-btn) {
    background: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    color: var(--text-secondary);
    border-radius: 6px;
    padding: 5px 8px;
    cursor: pointer;
    transition: all 0.15s ease;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 13px;
    line-height: 1;
  }

  :global(.icon-btn:hover) {
    color: var(--text-primary);
    border-color: var(--accent);
    background: var(--accent-bg-hover);
  }

  :global(.edit-link) {
    color: transparent;
    cursor: pointer;
    margin-left: auto;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 11px;
    transition: all 0.15s ease;
  }

  .list-item:hover :global(.edit-link) { color: var(--text-secondary); }
  :global(.edit-link:hover) { color: var(--text-primary) !important; background: var(--bg-quaternary); }

  :global(.input-list), :global(.output-list) {
    flex: 1;
    overflow-y: auto;
    padding: 8px;
    text-align: left;
    scrollbar-width: thin;
    scrollbar-color: var(--border-color) transparent;
  }

  :global(.list-item) {
    padding: 9px 8px;
    margin-bottom: 3px;
    background: var(--bg-tertiary);
    border: 1px solid transparent;
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.15s ease;
    font-size: 13px;
    display: flex;
    align-items: center;
  }

  :global(.checkmark) {
    width: 15px;
    height: 15px;
    -webkit-appearance: none;
    appearance: none;
    border-radius: 3px;
    background-color: var(--bg-quaternary);
    border: 1px solid var(--border-color);
    cursor: pointer;
    flex-shrink: 0;
    transition: all 0.15s ease;
  }

  :global(.checkmark:checked) { background-color: var(--accent); border-color: var(--accent); }

  :global(.checkmark-wrap) {
    display: inline-flex;
    align-items: center;
    height: 16px;
    margin-right: 7px;
  }

  :global(.item-number) {
    color: var(--text-secondary);
    min-width: 22px;
    text-align: right;
    margin-right: 7px;
    font-size: 12px;
    flex-shrink: 0;
  }

  .list-item {
    padding: 9px 8px;
    margin-bottom: 3px;
    background: var(--bg-tertiary);
    border: 1px solid transparent;
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.15s ease;
    font-size: 13px;
    display: flex;
    align-items: center;
    line-height: normal;
  }

  .list-item:hover { border-color: color-mix(in srgb, var(--accent) 50%, transparent); }
  .list-item.selected { border-color: var(--accent); background: var(--accent-bg-hover); }

  .input-list .list-item { background: var(--bg-input-item); }
  .output-list .list-item { background: var(--bg-output-item); justify-content: flex-start; }

  :global(.center-panel) {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 24px;
    background-color: var(--bg-secondary);
    border-radius: 12px;
    border: 1px solid var(--border-color);
    padding: 32px;
    position: relative;
    min-height: 200px;
    min-width: 200px;
  }

  :global(.hamburger-btn) {
    position: absolute;
    top: 8px; left: 8px;
    z-index: 100;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    color: var(--text-secondary);
    border-radius: 8px;
    width: 34px; height: 34px;
    display: flex; align-items: center; justify-content: center;
    cursor: pointer;
    font-size: 16px;
    transition: all 0.15s ease;
  }

  :global(.hamburger-btn:hover) { color: var(--text-primary); border-color: var(--accent); background: var(--accent-bg-hover); }

  :global(.settings-panel) {
    position: absolute;
    top: 50px; left: 8px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: 12px;
    padding: 14px;
    z-index: 101;
    min-width: 230px;
    max-height: calc(100vh - 100px);
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: var(--border-color) transparent;
    box-shadow: 0 8px 32px rgba(0,0,0,0.4);
  }

  :global(.settings-panel h3) {
    font-size: 10px;
    color: var(--text-secondary);
    margin-bottom: 8px;
    text-transform: uppercase;
    letter-spacing: 1px;
    font-weight: 600;
  }

  .color-wheel-btn {
    width: 100%;
    padding: 7px 12px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    border-radius: 8px;
    color: var(--text-secondary);
    font-size: 12px;
    cursor: pointer;
    transition: all 0.15s ease;
    text-align: left;
  }

  .color-wheel-btn:hover { border-color: var(--accent); color: var(--text-primary); }

  .cp-wrap { padding-top: 6px; }
  .cp-canvas-wrap { position: relative; width: 100%; border-radius: 7px; overflow: hidden; border: 1px solid var(--border-color); cursor: crosshair; touch-action: none; height: 150px; }
  .cp-canvas { display: block; width: 100%; height: 150px; pointer-events: none; position: absolute; top: 0; left: 0; }
  .cp-hue-wrap { margin-top: 7px; }
  .cp-hue-track { width: 100%; height: 12px; border-radius: 6px; background: linear-gradient(to right, #f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00); cursor: pointer; position: relative; }
  .cp-hue-thumb { position: absolute; top: -3px; width: 7px; height: 18px; background: #fff; border-radius: 2px; box-shadow: 0 0 3px rgba(0,0,0,0.5); }
  .cp-output { display: flex; align-items: center; gap: 7px; margin-top: 7px; }
  .cp-swatch { width: 26px; height: 26px; border-radius: 5px; border: 1px solid var(--border-color); flex-shrink: 0; }
  .cp-hex { font-family: monospace; font-size: 12px; color: var(--text-primary); border: 1px solid var(--border-color); background: transparent; padding: 4px 6px; width: 88px; border-radius: 4px; outline: none; }
  .cp-close-btn { width: 100%; margin-top: 7px; padding: 5px 10px; background: var(--bg-tertiary); border: 1px solid var(--border-color); border-radius: 5px; color: var(--text-secondary); font-size: 11px; cursor: pointer; }
  .cp-close-btn:hover { border-color: var(--accent); color: var(--text-primary); }

  /* Toggle */
  .toggle-row { display: flex; align-items: center; justify-content: space-between; font-size: 12px; color: var(--text-secondary); padding: 8px 0; }
  .toggle-btn { padding: 3px 10px; border-radius: 20px; border: 1px solid var(--border-color); background: var(--bg-tertiary); color: var(--text-secondary); font-size: 11px; cursor: pointer; transition: all 0.15s ease; min-width: 40px; }
  .toggle-btn.on { background: var(--accent); border-color: var(--accent); color: white; }

  /* Volume */
  .volume-row { display: flex; align-items: center; gap: 8px; }
  .vol-icon { font-size: 14px; }
  .volume-slider { flex: 1; accent-color: var(--accent); cursor: pointer; }
  .vol-label { font-size: 11px; color: var(--text-secondary); min-width: 32px; text-align: right; font-family: monospace; }

  /* Shortcut */
  .shortcut-row { display: flex; align-items: center; gap: 8px; }
  .shortcut-badge { flex: 1; background: var(--bg-quaternary); border: 1px solid var(--border-color); border-radius: 5px; padding: 4px 8px; font-family: monospace; font-size: 11px; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  /* Dock buttons */
  .dock-row { display: flex; flex-direction: column; gap: 5px; }
  .dock-btn { width: 100%; padding: 6px 10px; background: var(--bg-tertiary); border: 1px solid var(--border-color); border-radius: 7px; color: var(--text-secondary); font-size: 11px; cursor: pointer; text-align: left; transition: all 0.15s ease; }
  .dock-btn.active { border-color: var(--accent); color: var(--text-primary); }
  .dock-btn:hover { border-color: var(--accent); color: var(--text-primary); }

  /* Shortcut recording overlay */
  .shortcut-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.75); z-index: 1000; display: flex; align-items: center; justify-content: center; outline: none; }
  .shortcut-dialog { background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 16px; padding: 32px 40px; text-align: center; display: flex; flex-direction: column; gap: 14px; box-shadow: 0 16px 64px rgba(0,0,0,0.6); }
  .shortcut-dialog p { color: var(--text-primary); font-size: 15px; margin: 0; }
  .shortcut-dialog button { padding: 7px 20px; background: var(--bg-tertiary); border: 1px solid var(--border-color); border-radius: 7px; color: var(--text-secondary); cursor: pointer; font-size: 13px; align-self: center; }
  .shortcut-dialog button:hover { border-color: var(--accent); color: var(--text-primary); }

  :global(.mode-toggle) { display: flex; gap: 6px; }
  :global(.mode-btn) { flex: 1; padding: 6px 10px; background: var(--bg-tertiary); border: 1px solid var(--border-color); border-radius: 7px; color: var(--text-secondary); font-size: 12px; cursor: pointer; transition: all 0.15s ease; }
  :global(.mode-btn:hover) { border-color: var(--accent); color: var(--text-primary); }
  :global(.mode-btn.active) { background: var(--accent); border-color: var(--accent); color: white; }

  @keyframes slideIn { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: translateY(0); } }
  :global(.list-item.new) { animation: slideIn 0.25s ease forwards; }

  @keyframes subtlePulse {
    0%, 100% { box-shadow: 0 0 0 transparent; }
    50% { box-shadow: 0 0 10px var(--accent-glow), 0 0 20px var(--accent-bg-hover); }
  }
  :global(.latest-output-item) { animation: subtlePulse 2s ease infinite; }

  @keyframes pulseGlow {
    0%, 100% { box-shadow: 0 0 20px var(--accent-glow); }
    50% { box-shadow: 0 0 32px var(--accent-glow), 0 0 48px var(--accent-glow-medium); }
  }
  :global(.latest-output-field.pulse) { animation: pulseGlow 0.6s ease; }

  @keyframes gradientShift { 0% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } 100% { background-position: 0% 50%; } }

  body::before {
    content: ''; position: fixed; top: -50%; left: -50%; width: 200%; height: 200%;
    background: radial-gradient(circle at 30% 40%, var(--accent-bg-hover) 0%, transparent 50%),
                radial-gradient(circle at 70% 60%, rgba(139, 92, 246, 0.02) 0%, transparent 50%);
    animation: gradientShift 20s ease infinite; pointer-events: none; z-index: -1;
  }

  :global(.particle-canvas), :global(.output-particle-canvas) {
    width: 100%; height: 100%; display: block;
    position: absolute; top: 0; left: 0; pointer-events: none;
    z-index: 1000;
  }

  .edit-input {
    background-color: var(--bg-primary); color: var(--text-primary);
    border: 1px solid var(--border-color); border-radius: 6px;
    padding: 7px; font-size: 13px; width: 100%; box-sizing: border-box; outline: none;
  }

  :global(.latest-output-field) {
    width: 100%; min-height: 48px; padding: 12px 16px;
    border-radius: 8px; border: 1px solid var(--border-color);
    background-color: var(--bg-input-item); color: var(--text-primary);
    font-size: 18px; font-weight: 500;
    display: flex; align-items: center; justify-content: center;
    transition: all 0.2s ease;
  }

  :global(.latest-output-field.has-value) { border-color: var(--accent); }

  :global(.add-input) {
    background-color: var(--bg-input-item); color: var(--text-primary);
    border: 1px solid var(--border-color); border-radius: 6px;
    padding: 7px 10px; font-size: 13px; width: 100%; box-sizing: border-box;
    outline: none; transition: all 0.15s ease;
  }

  :global(.add-input:focus) { border-color: var(--accent); }
  :global(.add-input::placeholder) { color: var(--text-secondary); }

  :global(.add-input-container) { padding: 8px; border-top: 1px solid var(--border-color); flex-shrink: 0; }

  .completion-modal {
    position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
    background: var(--bg-secondary); border: 1px solid var(--border-color);
    border-radius: 16px; padding: 32px; z-index: 200; text-align: center; max-width: 400px;
    box-shadow: 0 16px 64px rgba(0,0,0,0.5);
  }

  .completion-modal h2 { margin-bottom: 16px; color: var(--text-primary); }
  .modal-actions { display: flex; gap: 12px; justify-content: center; margin-top: 24px; }

  .btn-primary { padding: 9px 22px; background: var(--accent); border: none; border-radius: 8px; color: white; font-size: 13px; cursor: pointer; transition: all 0.15s ease; }
  .btn-primary:hover { transform: translateY(-1px); box-shadow: 0 4px 16px var(--accent-glow); }
  .btn-secondary { padding: 9px 22px; background: var(--bg-tertiary); border: 1px solid var(--border-color); border-radius: 8px; color: var(--text-primary); font-size: 13px; cursor: pointer; }
  .btn-secondary:hover { border-color: var(--accent); }

  .empty-state { display: flex; align-items: center; justify-content: center; height: 100%; color: var(--text-secondary); font-size: 13px; text-align: center; padding: 16px; }

  .mode-status { font-size: 11px; color: var(--text-secondary); letter-spacing: 0.3px; }

  /* Generate button */
  :global(.generate-btn) {
    width: 180px; height: 56px;
    background: linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 75%, black));
    border: none; border-radius: 14px; color: white;
    font-size: 16px; font-weight: 700; cursor: pointer;
    transition: all 0.2s ease; text-transform: uppercase; letter-spacing: 1.5px;
  }

  :global(.generate-btn:hover) { transform: translateY(-2px); box-shadow: 0 8px 28px var(--accent-glow); }
  :global(.generate-btn:active) { transform: translateY(0); }
  :global(.generate-btn:disabled) { opacity: 0.4; cursor: not-allowed; transform: none; box-shadow: none; }
</style>