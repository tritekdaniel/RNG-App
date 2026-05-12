<script>
  import { onMount, onDestroy, tick } from 'svelte';
  import { ParticleSystem } from './lib/particles.js';
  import { invoke } from '@tauri-apps/api/core';
  import { register, unregister, isRegistered } from '@tauri-apps/plugin-global-shortcut';
  import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
  import { emit } from '@tauri-apps/api/event';
  import { listen } from '@tauri-apps/api/event';

  import clearIcon from './assets/Clear.svg?raw';
  import saveIcon from './assets/Save.svg?raw';
  import importIcon from './assets/Import.svg?raw';
  import dockIcon from './assets/Dock.svg?raw';
  import undockIcon from './assets/Undock.svg?raw';
  import addIcon from './assets/Add.svg?raw';
  import removeIcon from './assets/Remove.svg?raw';
  import unselectIcon from './assets/Unselect.svg?raw';
  import colorIcon from './assets/Color.svg?raw';
  import settingsIcon from './assets/Settings.svg?raw';
  import volumeMuteIcon from './assets/Volume-mute.svg?raw';
  import volumeLowIcon from './assets/Volume-low.svg?raw';
  import volumeHighIcon from './assets/Volume-high.svg?raw';
  import dragIndicatorIcon from './assets/DragIndicator.svg?raw';

import addSound from './assets/Add.m4a?url';
  import removeSound from './assets/Remove.m4a?url';
  import clearSound from './assets/Clear.m4a?url';
  import dockSound from './assets/Dock.m4a?url';
  import undockSound from './assets/Undock.m4a?url';
  import settingsOpenSound from './assets/SettingsOpen.m4a?url';
  import settingsCloseSound from './assets/SettingsClose.m4a?url';
  import singleOutputSound from './assets/SingleOutput.m4a?url';
  import batchOutputSound from './assets/BatchOutput.m4a?url';
  import outOfInputsSound from './assets/OutOfInputs.m4a?url';
  import buttonGenericSound from './assets/ButtonGeneric.m4a?url';
  import notificationSound from './assets/Notification.m4a?url';
  import selectedItemSound from './assets/SelectedItem.m4a?url';
  import unselectedItemSound from './assets/UnSelectedItem.m4a?url';
  import editItemSound from './assets/EditItem.m4a?url';
  import saveSound from './assets/Save.m4a?url';
  import loadSound from './assets/Load.m4a?url';
  import volumeChangeSound from './assets/VolumeChange.m4a?url';
  import dragPickUpSound from './assets/DragPickUp.m4a?url';
  import dragPutDownSound from './assets/DragPutDown.m4a?url';

  let inputs = $state([]);
  let outputs = $state([]);
  let latestOutput = $state(null);
  let unlistenState = null;
  let unlistenDock = null;
  let unlistenAccent = null;
  let unlistenTheme = null;

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
  let lastInputSelectionIndex = $state(-1);
  let lastOutputSelectionIndex = $state(-1);
  let showSettingsMenu = $state(false);
  let colorPickerOpen = $state(false);

  // --- New settings ---
  let theme = $state(localStorage.getItem('rng-theme') || 'dark');
  let particlesEnabled = $state(localStorage.getItem('rng-particles') !== 'false');
  let volume = $state(parseFloat(localStorage.getItem('rng-volume') ?? '1'));
  let shortcutKeys = $state(JSON.parse(localStorage.getItem('rng-shortcut') || 'null') || { alt: false, shift: true, ctrl: true, key: 'g', code: 'KeyG' });
  let shortcutDisplay = $derived([shortcutKeys.ctrl && 'Ctrl', shortcutKeys.alt && 'Alt', shortcutKeys.shift && 'Shift', shortcutKeys.key?.toUpperCase()].filter(Boolean).join(' + '));
  let recordingShortcut = $state(false);
  let notifyOnShortcut = $state(localStorage.getItem('rng-notify-shortcut') === 'true');
  let inputFilter = $state('');
  let outputFilter = $state('');
  function dragContainer(node, listType) {
    let ghost = null;
    let fromIndex = -1;
    let currentDropIndex = -1;
    let dragging = false;
    const THRESHOLD = 4; // px movement before drag starts

    function getItemAtPoint(x, y) {
      // Temporarily hide ghost so elementFromPoint works
      if (ghost) ghost.style.display = 'none';
      const el = document.elementFromPoint(x, y)?.closest('.list-item[data-index]');
      if (ghost) ghost.style.display = '';
      return el;
    }

    function clearDropTargets() {
      node.querySelectorAll('.list-item.drop-target').forEach(el => el.classList.remove('drop-target'));
      currentDropIndex = -1;
    }

    function cleanup() {
      if (ghost) { ghost.remove(); ghost = null; }
      node.querySelectorAll('.list-item').forEach(el => {
        el.classList.remove('dragging', 'drop-target');
      });
      node.classList.remove('is-dragging');
      fromIndex = -1;
      currentDropIndex = -1;
      dragging = false;
    }

    function handlePointerDown(e) {
      // Only left button, only from drag handle
      if (e.button !== 0) return;
      if (!e.target.closest('.drag-handle')) return;
      const item = e.target.closest('.list-item[data-index]');
      if (!item) return;

      // Prevent click from selecting item if drag was attempted (even if not dragged far enough)
      const parentItem = e.target.closest('.list-item');
      if (parentItem) parentItem.dataset.dragAttempted = 'true';

      const startX = e.clientX;
      const startY = e.clientY;
      const datasetIndex = parseInt(item.dataset.index);

      // Adjust fromIndex if filtering is active - dataset.index is position in filtered array
      if (listType === 'input' && inputFilter) {
        fromIndex = filteredInputIndices[datasetIndex]?.index ?? datasetIndex;
      } else if (listType === 'output' && outputFilter) {
        fromIndex = filteredOutputIndices[datasetIndex]?.index ?? datasetIndex;
      } else {
        fromIndex = datasetIndex;
      }
      dragging = false;

      function onMove(ev) {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;

        if (!dragging) {
          if (Math.abs(dx) < THRESHOLD && Math.abs(dy) < THRESHOLD) return;
          // Threshold crossed — start drag
          dragging = true;
          item.classList.add('dragging');
          node.classList.add('is-dragging');
          playSound(dragPickUpSound);

          // Create ghost
          ghost = item.cloneNode(true);
          ghost.style.cssText = `
            position: fixed;
            pointer-events: none;
            z-index: 9999;
            width: ${item.offsetWidth}px;
            opacity: 0.85;
            border-radius: 8px;
            box-shadow: 0 8px 24px rgba(0,0,0,0.4);
            transform: rotate(1.5deg) scale(1.02);
            transition: none;
            left: ${item.getBoundingClientRect().left}px;
            top: ${item.getBoundingClientRect().top}px;
          `;
          document.body.appendChild(ghost);
        }

        if (!dragging) return;

        // Move ghost - position under cursor, not centered
        ghost.style.left = `${ev.clientX}px`;
        ghost.style.top = `${ev.clientY}px`;

        // Find drop target
        const target = getItemAtPoint(ev.clientX, ev.clientY);
        if (!target) { clearDropTargets(); return; }
        const idx = parseInt(target.dataset.index);
        if (idx === currentDropIndex) return;
        clearDropTargets();
        if (idx !== fromIndex) { target.classList.add('drop-target'); currentDropIndex = idx; }
      }

      async function onUp(ev) {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);

        if (!dragging) { cleanup(); return; }

        const target = getItemAtPoint(ev.clientX, ev.clientY);
        if (!target) { cleanup(); return; }

        const datasetIndex = parseInt(target.dataset.index);
        const fi = fromIndex;
        let toIndex = datasetIndex;

        // Adjust toIndex if filtering is active - dataset.index is position in filtered array
        if (listType === 'input' && inputFilter) {
          const filtered = filteredInputIndices;
          toIndex = filtered[datasetIndex]?.index ?? datasetIndex;
        } else if (listType === 'output' && outputFilter) {
          const filtered = filteredOutputIndices;
          toIndex = filtered[datasetIndex]?.index ?? datasetIndex;
        }

        cleanup();

        if (toIndex === fi) {
          // No reorder - flag stays set to prevent selection, will be cleared by next pointerdown
          return;
        }

        // Reorder happened - clear the flag so normal selection works next time
        node.querySelectorAll('.list-item').forEach(el => delete el.dataset.dragAttempted);

        playSound(dragPutDownSound);
        if (listType === 'input') {
          const el = inputs[fi];
          inputs.splice(fi, 1);
          inputs.splice(toIndex, 0, el);
          inputs = [...inputs];
          await rpc('reorder_input', { fromIndex: fi, toIndex });
        } else {
          const el = outputs[fi];
          outputs.splice(fi, 1);
          outputs.splice(toIndex, 0, el);
          outputs = [...outputs];
          await rpc('reorder_output', { fromIndex: fi, toIndex });
        }
        emit('state-updated');
      }

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    }

    node.addEventListener('pointerdown', handlePointerDown);
    return {
      destroy() {
        node.removeEventListener('pointerdown', handlePointerDown);
        cleanup();
      }
    };
  }
  let focusedInputIndex = $state(-1);
  let focusedOutputIndex = $state(-1);
  let inputDocked = $state(localStorage.getItem('rng-input-docked') !== 'false');
  let outputDocked = $state(localStorage.getItem('rng-output-docked') !== 'false');
  let filteredInputIndices = $derived(inputFilter ? inputs.map((v, i) => ({ value: v, index: i })).filter(item => item.value.toLowerCase().includes(inputFilter.toLowerCase())) : inputs.map((v, i) => ({ value: v, index: i })));
  let filteredOutputIndices = $derived(outputFilter ? outputs.map((v, i) => ({ value: v, index: i })).filter(item => item.value.toLowerCase().includes(outputFilter.toLowerCase())) : outputs.map((v, i) => ({ value: v, index: i })));

  function setAccentColor(color) {
    const r = parseInt(color.slice(1,3), 16);
    const g = parseInt(color.slice(3,5), 16);
    const b = parseInt(color.slice(5,7), 16);
    document.documentElement.style.setProperty('--accent', color);
    document.documentElement.style.setProperty('--accent-glow', `rgba(${r}, ${g}, ${b}, 0.3)`);
    document.documentElement.style.setProperty('--accent-bg-hover', `rgba(${r}, ${g}, ${b}, 0.1)`);
    document.documentElement.style.setProperty('--accent-glow-medium', `rgba(${r}, ${g}, ${b}, 0.15)`);
    const rN = r/255, gN = g/255, bN = b/255;
    document.documentElement.style.setProperty('--icon-filter', `matrix(${0.213 + 0.787*(1-rN)} ${0.715 - 0.715*rN} ${0.072 - 0.072*rN} 0 0 ${0.213 - 0.213*gN} ${0.715 + 0.285*(1-gN)} ${0.072 - 0.072*gN} 0 0 ${0.213 - 0.213*bN} ${0.715 - 0.715*bN} ${0.072 + 0.928*(1-bN)} 0 0 0 0 0 1 0)`);
  }

  function setTheme(newTheme) {
    theme = newTheme;
    localStorage.setItem('rng-theme', newTheme);
    document.documentElement.setAttribute('data-theme', newTheme);
    emit('theme-updated', { theme: newTheme });
  }

  // Apply accent color and theme synchronously before first render to avoid flash
  setAccentColor(tempColor);
  document.documentElement.setAttribute('data-theme', theme);

  let svCanvasRef = $state(null);
  let svWrapRef = $state(null);

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
  let visibilityChangeHandler = null;
  let lastGenerateTime = 0;
  let generating = false;
  let svDragging = false;
  let hueDragging = false;

  let audioCtx = null;
  const audioBufferCache = new Map();

  function getAudioContext() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return audioCtx;
  }

  async function playAudio(url) {
    try {
      const ctx = getAudioContext();
      if (ctx.state === 'suspended') await ctx.resume();
      let audioBuffer;
      if (audioBufferCache.has(url)) {
        audioBuffer = audioBufferCache.get(url);
      } else {
        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();
        audioBuffer = await ctx.decodeAudioData(arrayBuffer);
        audioBufferCache.set(url, audioBuffer);
      }
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      const gainNode = ctx.createGain();
      gainNode.gain.value = volume ?? 1;
      source.connect(gainNode);
      gainNode.connect(ctx.destination);
      source.start(0);
    } catch (e) {}
  }

  function playSound(soundUrl) {
    if (soundUrl) playAudio(soundUrl);
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

      if (outputs.length > prevOutputsLen) {
        await tick();
        const lastOutputEl = document.querySelector('.latest-output-item');
        if (lastOutputEl) {
          lastOutputEl.classList.add('new');
          setTimeout(() => lastOutputEl.classList.remove('new'), 300);
        }
        if (particlesEnabled && particleSystem && canvasRef && lastOutputEl) {
          const elRect = lastOutputEl.getBoundingClientRect();
          for (let i = 0; i < 6; i++) {
            particleSystem.particles.push({
              x: elRect.left + Math.random() * elRect.width, y: elRect.bottom,
              vx: (Math.random() - 0.5) * 0.3, vy: -(0.4 + Math.random() * 0.6),
              size: 1.5 + Math.random() * 2, alpha: 0.5, color: tempColor,
            });
          }
          particleSystem.startAnimation();
        }
      }
      prevOutputsLen = outputs.length;
    }
  }

  $effect(() => {
    const _h = hueVal;
    const _ref = svCanvasRef;
    if (colorPickerOpen && _ref) drawSV();
    return () => {};
  });

  function matchesShortcut(e) {
    const codeMatch = shortcutKeys.code
      ? e.code === shortcutKeys.code
      : e.code === `Key${shortcutKeys.key.toUpperCase()}`;
    return codeMatch &&
      !!e.altKey === !!shortcutKeys.alt &&
      !!e.shiftKey === !!shortcutKeys.shift &&
      !!e.ctrlKey === !!shortcutKeys.ctrl;
  }

  function getShortcutString() {
    const parts = [];
    if (shortcutKeys.ctrl) parts.push('CommandOrControl');
    if (shortcutKeys.alt) parts.push('Alt');
    if (shortcutKeys.shift) parts.push('Shift');
    const keyPart = shortcutKeys.code && shortcutKeys.code.startsWith('Key') 
      ? 'Key' + shortcutKeys.key.toUpperCase()
      : shortcutKeys.code || 'Key' + shortcutKeys.key.toUpperCase();
    parts.push(keyPart);
    return parts.join('+');
  }

  function setupDocumentShortcut() {
    if (shortcutHandler) document.removeEventListener('keydown', shortcutHandler);
    shortcutHandler = (e) => {
      if (matchesShortcut(e) && !recordingShortcut) {
        e.preventDefault();
        e.stopPropagation();
        if (showCompletionModal) {
          handleClearOutputs();
          showCompletionModal = false;
        } else {
          handleGenerate();
        }
      }
    };
    document.addEventListener('keydown', shortcutHandler, true);
  }

  let registeredShortcut = null;

  async function registerGlobalShortcut() {
    const shortcutStr = getShortcutString();
    const oldShortcut = registeredShortcut;
    if (oldShortcut && oldShortcut !== shortcutStr) {
      try { await unregister(oldShortcut); } catch (e) { console.warn('unregister failed:', e); }
      await new Promise(r => setTimeout(r, 100));
    }
    try {
      await unregister(shortcutStr).catch(() => {});
      await new Promise(r => setTimeout(r, 50));
      await register(shortcutStr, async (event) => {
        if (event.state === 'Pressed' && !recordingShortcut) {
          if (showCompletionModal) {
            await handleClearOutputs();
            showCompletionModal = false;
          } else {
            await handleGenerate();
            if (notifyOnShortcut && !document.hasFocus()) {
              await invoke('send_notification', { title: 'RNG', body: `Generated: ${latestOutput || '(none)'}` });
            }
          }
        }
      });
      registeredShortcut = shortcutStr;
    } catch (e) {
      console.warn('Global shortcut registration failed:', e);
    }
  }

  onMount(async () => {
    await refreshState();

    // Always listen for state updates from other windows
    unlistenState = await listen('state-updated', async () => {
      await refreshState();
    });

    // Listen for accent color changes from other windows
    unlistenAccent = await listen('accent-updated', (event) => {
      const color = event.payload.color;
      tempColor = color;
      setAccentColor(color);
      updateAccentColors(color);
    });

    // Listen for theme changes from other windows
    unlistenTheme = await listen('theme-updated', (event) => {
      const newTheme = event.payload.theme;
      theme = newTheme;
      document.documentElement.setAttribute('data-theme', newTheme);
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
          playSound(dockSound);
        } else if (panel === 'outputs' && outputWindow) {
          try { await outputWindow.close(); } catch {}
          outputWindow = null;
          outputDocked = true;
          localStorage.setItem('rng-output-docked', 'true');
          playSound(dockSound);
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

    // Setup shortcut (global + document fallback)
    await registerGlobalShortcut();
    setupDocumentShortcut();

    // Re-register global shortcut on visibility change (fixes issues after minimize)
    visibilityChangeHandler = () => {
      if (!document.hidden) {
        setTimeout(() => registerGlobalShortcut().catch(console.warn), 100);
      }
    };
    document.addEventListener('visibilitychange', visibilityChangeHandler);

    deleteHandler = (e) => {
      if (e.key !== 'Delete') return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (inputSelections.length > 0) handleBatchRemoveInputs();
      else if (outputSelections.length > 0) handleBatchRemoveOutputs();
    };
    document.addEventListener('keydown', deleteHandler);
  });

  let lastOutputDimensions = $state({ width: 0, height: 0 });
  $effect(() => {
    const ref = outputCanvasRef;
    const _docked = outputDocked;
    if (!ref || !ref.parentElement) return;
    const t = setTimeout(() => {
      if (!ref.parentElement) return;
      const rect = ref.parentElement.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        if (rect.width !== lastOutputDimensions.width || rect.height !== lastOutputDimensions.height) {
          lastOutputDimensions = { width: rect.width, height: rect.height };
          ref.width = rect.width;
          ref.height = rect.height;
          if (outputParticleSystem) outputParticleSystem.destroy();
          outputParticleSystem = new ParticleSystem(ref);
        }
      }
    }, 50);
    return () => clearTimeout(t);
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
    generating = false;
    if (resizeObserver) resizeObserver.disconnect();
    if (unlistenState) unlistenState();
    if (unlistenDock) unlistenDock();
    if (unlistenAccent) unlistenAccent();
    if (unlistenTheme) unlistenTheme();
    if (registeredShortcut) { try { await unregister(registeredShortcut); } catch {} registeredShortcut = null; }
    if (shortcutHandler) document.removeEventListener('keydown', shortcutHandler);
    if (deleteHandler) document.removeEventListener('keydown', deleteHandler);
    if (visibilityChangeHandler) document.removeEventListener('visibilitychange', visibilityChangeHandler);
    if (audioCtx) { audioCtx.close(); audioCtx = null; }
    if (particleSystem) particleSystem.destroy();
    if (outputParticleSystem) outputParticleSystem.destroy();
  });

  async function handleAddInput(value) {
    if (!value || !value.trim()) return;
    const parts = value.split('|').map(s => s.trim()).filter(Boolean);
    if (parts.length === 1) {
      await rpc('add_input', { value: parts[0] });
    } else {
      await rpc('add_inputs', { values: parts });
    }
    emit('state-updated');
    playSound(addSound);
  }

  async function handleClearInputs() {
    await rpc('clear_inputs'); inputSelections = [];
    playSound(clearSound);
    emit('state-updated');
  }

  async function saveInputsList() {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const path = await save({
      defaultPath: 'rng-inputs.json',
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    if (path) {
      const { writeTextFile } = await import('@tauri-apps/plugin-fs');
      await writeTextFile(path, JSON.stringify(inputs, null, 2));
      playSound(saveSound);
    }
  }

  async function loadInputsList() {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const { readTextFile } = await import('@tauri-apps/plugin-fs');
    const path = await open({
      multiple: false,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    if (path) {
      try {
        const text = await readTextFile(path);
        const loaded = JSON.parse(text);
        if (Array.isArray(loaded)) {
          const items = loaded.map(item => String(item));
          await rpc('add_inputs', { values: items });
          await refreshState();
          emit('state-updated');
          playSound(loadSound);
        }
      } catch (err) {
        console.error('Failed to load inputs:', err);
      }
    }
  }

  // FIX: wrap in try/finally so `generating` is always reset even on unexpected errors;
  // batch path is delegated cleanly without double-resetting the flag
  async function handleGenerate() {
    if (generating) return;
    generating = true;
    try {
      if (inputs.length === 0) return;
      if (outputMode === 'batch') {
        await handleBatchGenerate();
        return;
      }
      const result = await rpc('generate');
      if (!result) {
        showCompletionModal = true;
        playSound(outOfInputsSound);
        return;
      }
      latestOutput = result;
      if (notifyOnShortcut && !document.hasFocus()) {
        playSound(notificationSound);
      } else {
        playSound(singleOutputSound);
      }
      updateAccentColors(tempColor);
      setAccentColor(tempColor);
      if (particlesEnabled && outputCanvasRef) {
        if (!outputParticleSystem || !outputCanvasRef.parentElement) {
          const rect = outputCanvasRef.parentElement?.getBoundingClientRect();
          if (rect?.width > 0) {
            outputCanvasRef.width = rect.width;
            outputCanvasRef.height = rect.height;
            outputParticleSystem = new ParticleSystem(outputCanvasRef);
          }
        }
        if (outputParticleSystem) {
          outputParticleSystem.gentleRise(150, tempColor);
          outputParticleSystem.startAnimation();
        }
      }
      const latestField = document.querySelector('.latest-output-field');
      if (latestField) { latestField.classList.add('pulse'); setTimeout(() => latestField.classList.remove('pulse'), 600); }
      emit('state-updated');
      const centerPanel = document.querySelector('.center-panel');
      if (centerPanel) { centerPanel.classList.remove('animate-border'); void centerPanel.offsetWidth; centerPanel.classList.add('animate-border'); }
    } finally {
      generating = false;
    }
  }

  function toggleInputSelect(index) {
    if (inputSelections.includes(index)) { inputSelections = inputSelections.filter(i => i !== index); playSound(unselectedItemSound); }
    else { inputSelections = [...inputSelections, index]; playSound(selectedItemSound); }
  }

  async function handleBatchRemoveInputs() {
    if (inputSelections.length === 0) return;
    const indices = [...inputSelections];
    await rpc('remove_inputs', { indices });
    inputSelections = [];
    emit('state-updated');
    playSound(removeSound);
  }

  function toggleOutputSelect(value) {
    if (outputSelections.includes(value)) { outputSelections = outputSelections.filter(v => v !== value); playSound(unselectedItemSound); }
    else { outputSelections = [...outputSelections, value]; playSound(selectedItemSound); }
  }

  function unselectAllInputs() {
    if (inputSelections.length > 0) { inputSelections = []; playSound(unselectedItemSound); }
  }

  function unselectAllOutputs() {
    if (outputSelections.length > 0) { outputSelections = []; playSound(unselectedItemSound); }
  }

  async function handleBatchRemoveOutputs() {
    if (outputSelections.length === 0) return;
    await rpc('remove_outputs', { values: outputSelections });
    outputSelections = [];
    emit('state-updated');
    playSound(removeSound);
  }

  function handleItemSelect(e, type) {
    if (e.target.classList.contains('checkmark')) return;
    // Prevent selection if drag was attempted from drag handle
    if (e.currentTarget.dataset.dragAttempted === 'true') {
      e.currentTarget.dataset.dragAttempted = 'false';
      return;
    }
    if (type === 'input') {
      const index = parseInt(e.currentTarget.dataset.index);
      if (e.shiftKey && lastInputSelectionIndex >= 0) {
        const start = Math.min(lastInputSelectionIndex, index);
        const end = Math.max(lastInputSelectionIndex, index);
        let added = false;
        for (let i = start; i <= end; i++) {
          if (!inputSelections.includes(i)) { inputSelections = [...inputSelections, i]; added = true; }
        }
        if (added) playSound(selectedItemSound);
      } else {
        toggleInputSelect(index);
      }
      lastInputSelectionIndex = index;
    } else {
      const value = e.currentTarget.dataset.value;
      if (e.shiftKey && lastOutputSelectionIndex >= 0) {
        const start = Math.min(lastOutputSelectionIndex, outputs.indexOf(value));
        const end = Math.max(lastOutputSelectionIndex, outputs.indexOf(value));
        let added = false;
        for (let i = start; i <= end; i++) {
          const v = outputs[i];
          if (!outputSelections.includes(v)) { outputSelections = [...outputSelections, v]; added = true; }
        }
        if (added) playSound(selectedItemSound);
      } else {
        toggleOutputSelect(value);
      }
      lastOutputSelectionIndex = outputs.indexOf(value);
    }
  }

  async function handleClearOutputs() {
    showCompletionModal = false;
    await rpc('clear_outputs'); latestOutput = null; outputSelections = [];
    emit('state-updated');
    playSound(clearSound);
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
    setAccentColor(color);
    updateAccentColors(color);
    emit('accent-updated', { color });
  }

  function startEditing(index, value) { editingInputIndex = index; editValue = value; playSound(editItemSound); }

  async function saveEdit() {
    if (editingInputIndex === -1 || !editValue.trim()) return;
    await rpc('update_input', { index: editingInputIndex, value: editValue.trim() });
    editingInputIndex = -1; editValue = '';
    emit('state-updated');
    playSound(addSound);
  }

  function cancelEdit() { editingInputIndex = -1; editValue = ''; }

  async function setOutputMode(mode) {
    outputMode = mode;
    localStorage.setItem('rng-output-mode', mode);
    await rpc('set_output_mode', { mode });
    playSound(buttonGenericSound);
  }

  // FIX: no longer sets generating = false itself; handleGenerate owns that via finally
  async function handleBatchGenerate() {
    if (inputs.length === 0) return;
    // batch_generate returns (Vec<String>, AppState) — destructure index 0 for the results array
    const [results] = await rpc('batch_generate');
    if (!results || results.length === 0) {
      showCompletionModal = true;
      playSound(outOfInputsSound);
      return;
    }
    latestOutput = null;
    if (notifyOnShortcut && !document.hasFocus()) {
      playSound(notificationSound);
    } else {
      playSound(batchOutputSound);
    }
    updateAccentColors(tempColor);
    setAccentColor(tempColor);
    if (particlesEnabled && outputCanvasRef) {
      if (!outputParticleSystem || !outputCanvasRef.parentElement) {
        const rect = outputCanvasRef.parentElement?.getBoundingClientRect();
        if (rect?.width > 0) {
          outputCanvasRef.width = rect.width;
          outputCanvasRef.height = rect.height;
          outputParticleSystem = new ParticleSystem(outputCanvasRef);
        }
      }
      if (outputParticleSystem) {
        outputParticleSystem.gentleRise(150, tempColor);
        outputParticleSystem.startAnimation();
      }
    }
    await refreshState();
    emit('state-updated');
    const centerPanel = document.querySelector('.center-panel');
    if (centerPanel) { centerPanel.classList.remove('animate-border'); void centerPanel.offsetWidth; centerPanel.classList.add('animate-border'); }
  }

  // --- Shortcut recording ---
  let captureListener = null;

  async function startRecordingShortcut() {
    if (registeredShortcut) {
      try { await unregister(registeredShortcut); } catch {}
      await new Promise(r => setTimeout(r, 50));
    }
    recordingShortcut = true;
    if (captureListener) {
      document.removeEventListener('keydown', captureListener, true);
      captureListener = null;
    }
    captureListener = (e) => {
      if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;
      const validCode = e.code.startsWith('Key') || e.code.startsWith('Digit') || /^F\d+$/.test(e.code) || e.code === 'Space';
      if (!validCode) return;
      e.preventDefault();
      e.stopPropagation();
      shortcutKeys = {
        ctrl: e.ctrlKey,
        alt: e.altKey,
        shift: e.shiftKey,
        key: e.key.toLowerCase(),
        code: e.code,
      };
      localStorage.setItem('rng-shortcut', JSON.stringify(shortcutKeys));
      recordingShortcut = false;
      playSound(notificationSound);
      document.removeEventListener('keydown', captureListener, true);
      captureListener = null;
      setupDocumentShortcut();
      registerGlobalShortcut().catch(console.warn);
    };
    document.addEventListener('keydown', captureListener, true);
  }

  // --- Docking ---
  let inputWindow = null;
  let outputWindow = null;

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
        playSound(undockSound);
      } catch (e) { console.error('Failed to create input window:', e); }
    } else {
      // Currently undocked - switch to docked (inline)
      playSound(dockSound);
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
        playSound(undockSound);
      } catch (e) { console.error('Failed to create output window:', e); }
    } else {
      // Currently undocked - switch to docked (inline)
      playSound(dockSound);
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
  // FIX: outputPos.x is always a number now (set at init), so no runtime fallback needed
  let outputFloatStyle = $derived(`left: ${outputPos.x}px; top: ${outputPos.y || 60}px;`);
</script>

<!-- Shortcut recording overlay -->
{#if recordingShortcut}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="shortcut-overlay" onclick={() => { recordingShortcut = false; generating = false; if (captureListener) { document.removeEventListener('keydown', captureListener, true); captureListener = null; } }}>
    <div class="shortcut-dialog">
      <p>Press your new shortcut combination…</p>
      <small style="color: var(--text-secondary)">e.g. Ctrl+Shift+G, Alt+R</small>
      <button onclick={() => { recordingShortcut = false; generating = false; if (captureListener) { document.removeEventListener('keydown', captureListener, true); captureListener = null; } }}>Cancel</button>
    </div>
  </div>
{/if}

{#if showCompletionModal}
  <div class="completion-modal">
    <h2>All items generated!</h2>
    <p style="color: var(--text-secondary); margin-bottom: 16px;">The list is empty. Clear outputs to restart?</p>
    <div class="modal-actions">
      <button class="btn-secondary" onclick={() => { showCompletionModal = false; playSound(buttonGenericSound); }}>Cancel</button>
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
          <button class="icon-btn icon-remove" onclick={handleBatchRemoveInputs} title="Delete selected ({inputSelections.length})">{@html removeIcon}</button>
          <button class="icon-btn icon-unselect" onclick={unselectAllInputs} title="Unselect all">{@html unselectIcon}</button>
        {:else}
  <button class="icon-btn icon-clear" onclick={() => handleClearInputs()} title="Clear all">{@html clearIcon}</button>
        {/if}
        {#if inputSelections.length === 0}
        <button class="icon-btn icon-add" onclick={async () => { const el = document.getElementById('inputFieldStandalone'); if (el?.value.trim()) { await handleAddInput(el.value); el.value = ''; } else el?.focus(); }} title="Add">{@html addIcon}</button>
        {/if}
  <button class="icon-btn icon-dock" onclick={async () => { try { new Audio(dockSound).play(); } catch {} emit('dock-panel', { panel: 'inputs' }); }} title="Dock">{@html dockIcon}</button>
      </div>
    </div>
    {#if inputs.length > 5}
      <input type="text" class="filter-input" placeholder="Filter..." bind:value={inputFilter} />
    {/if}
    <div class="list-wrapper" use:dragContainer={'input'}>
      <div class="input-list">
        {#each filteredInputIndices as { value: item, index: origIndex } (origIndex)}
          {#if editingInputIndex === origIndex}
            <div class="list-item edit-mode" onclick={(e) => e.stopPropagation()}>
              <input type="text" class="edit-input" bind:value={editValue} autofocus
                onkeydown={(e) => { if (e.key === 'Enter') { saveEdit(); e.preventDefault(); } else if (e.key === 'Escape') { cancelEdit(); e.preventDefault(); } }} />
              <button class="edit-cancel" onclick={() => { cancelEdit(); playSound(buttonGenericSound); }}>✕</button>
            </div>
          {:else}
            <div class="list-item" class:selected={inputSelections.includes(origIndex)}
              data-index={origIndex}
              onclick={(e) => handleItemSelect(e, 'input')} tabindex="0"
              onkeydown={(e) => { if (e.key === 'ArrowDown') { e.preventDefault(); focusedInputIndex = Math.min(origIndex + 1, inputs.length - 1); document.querySelectorAll('.input-list .list-item')[focusedInputIndex]?.focus(); } else if (e.key === 'ArrowUp') { e.preventDefault(); focusedInputIndex = Math.max(origIndex - 1, 0); document.querySelectorAll('.input-list .list-item')[focusedInputIndex]?.focus(); } else if ((e.key === 'Enter' || e.key === ' ') && !e.target.classList.contains('checkmark')) { toggleInputSelect(origIndex); e.preventDefault(); } }}>
              <span class="drag-handle" title="Drag to reorder">{@html dragIndicatorIcon}</span>
              <span class="checkmark-wrap"><input type="checkbox" class="checkmark" onclick={(e) => { e.stopPropagation(); toggleInputSelect(origIndex); }} checked={inputSelections.includes(origIndex)} /></span>
              <span class="item-number">{origIndex + 1}.</span>
              <span class="item-text">{item}</span>
              <span class="edit-link" onclick={(e) => { e.stopPropagation(); startEditing(origIndex, item); }}>Edit</span>
            </div>
          {/if}
        {:else}
          <div class="empty-state">No inputs added yet</div>
        {/each}
      </div>
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
          <button class="icon-btn icon-remove" onclick={handleBatchRemoveOutputs} title="Delete selected ({outputSelections.length})">{@html removeIcon}</button>
          <button class="icon-btn icon-unselect" onclick={unselectAllOutputs} title="Unselect all">{@html unselectIcon}</button>
        {:else}
          <button class="icon-btn icon-clear" onclick={() => handleClearOutputs()} title="Clear all">{@html clearIcon}</button>
        {/if}
        <button class="icon-btn icon-dock" onclick={async () => { try { new Audio(dockSound).play(); } catch {} emit('dock-panel', { panel: 'outputs' }); }} title="Dock">{@html dockIcon}</button>
      </div>
    </div>
    {#if outputs.length > 5}
      <input type="text" class="filter-input" placeholder="Filter..." bind:value={outputFilter} />
    {/if}
    <div class="list-wrapper">
      <div class="output-list">
        {#each filteredOutputIndices as { value: item, index: origIndex } (origIndex)}
          <div class="list-item" class:latest-output-item={origIndex === outputs.length - 1}
            class:selected={outputSelections.includes(item)} data-index={origIndex} data-value={item}
            onclick={(e) => handleItemSelect(e, 'output')} tabindex="0"
            onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { toggleOutputSelect(item); e.preventDefault(); } }}
            style="border-left: 3px solid var(--accent);">
            <span class="checkmark-wrap"><input type="checkbox" class="checkmark" onclick={(e) => { e.stopPropagation(); toggleOutputSelect(item); }} checked={outputSelections.includes(item)} /></span>
            <span class="item-number">{origIndex + 1}.</span>
            <span class="item-text">{item}</span>
          </div>
        {:else}
          <div class="empty-state">No outputs yet</div>
        {/each}
      </div>
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
            <button class="icon-btn icon-remove" onclick={handleBatchRemoveInputs} title="Delete selected ({inputSelections.length})">{@html removeIcon}</button>
            <button class="icon-btn icon-unselect" onclick={unselectAllInputs} title="Unselect all">{@html unselectIcon}</button>
          {:else}
  <button class="icon-btn icon-clear" onclick={() => handleClearInputs()} title="Clear all">{@html clearIcon}</button>
          {/if}
          {#if inputSelections.length === 0}
          <button class="icon-btn icon-add" onclick={async () => { const el = document.getElementById('inputField'); if (el?.value.trim()) { await handleAddInput(el.value); el.value = ''; } else el?.focus(); }} title="Add">{@html addIcon}</button>
          {/if}
          <button class="icon-btn icon-save" onclick={saveInputsList} title="Save inputs">{@html saveIcon}</button>
          <button class="icon-btn icon-load" onclick={loadInputsList} title="Load inputs">{@html importIcon}</button>
  <button class="icon-btn icon-undock" onclick={toggleInputDock} title="Undock">{@html undockIcon}</button>
        </div>
      </div>
      {#if inputs.length > 5}
        <input type="text" class="filter-input" placeholder="Filter..." bind:value={inputFilter} />
      {/if}
      <div class="list-wrapper" use:dragContainer={'input'}>
        <div class="input-list">
          {#each filteredInputIndices as { value: item, index: origIndex } (origIndex)}
            {#if editingInputIndex === origIndex}
              <div class="list-item edit-mode" onclick={(e) => e.stopPropagation()}>
                <input type="text" class="edit-input" bind:value={editValue} autofocus
                  onkeydown={(e) => { if (e.key === 'Enter') { saveEdit(); e.preventDefault(); } else if (e.key === 'Escape') { cancelEdit(); e.preventDefault(); } }} />
                <button class="edit-cancel" onclick={() => { cancelEdit(); playSound(buttonGenericSound); }}>✕</button>
              </div>
            {:else}
              <div class="list-item" class:selected={inputSelections.includes(origIndex)}
                data-index={origIndex}
                onclick={(e) => handleItemSelect(e, 'input')} tabindex="0"
                onkeydown={(e) => { if (e.key === 'ArrowDown') { e.preventDefault(); focusedInputIndex = Math.min(origIndex + 1, inputs.length - 1); document.querySelectorAll('.input-list .list-item')[focusedInputIndex]?.focus(); } else if (e.key === 'ArrowUp') { e.preventDefault(); focusedInputIndex = Math.max(origIndex - 1, 0); document.querySelectorAll('.input-list .list-item')[focusedInputIndex]?.focus(); } else if ((e.key === 'Enter' || e.key === ' ') && !e.target.classList.contains('checkmark')) { toggleInputSelect(origIndex); e.preventDefault(); } }}>
                <span class="drag-handle" title="Drag to reorder">{@html dragIndicatorIcon}</span>
                <span class="checkmark-wrap"><input type="checkbox" class="checkmark" onclick={(e) => { e.stopPropagation(); toggleInputSelect(origIndex); }} checked={inputSelections.includes(origIndex)} /></span>
                <span class="item-number">{origIndex + 1}.</span>
                <span class="item-text">{item}</span>
                <span class="edit-link" onclick={(e) => { e.stopPropagation(); startEditing(origIndex, item); }}>Edit</span>
              </div>
            {/if}
          {:else}
            <div class="empty-state">No inputs added yet</div>
          {/each}
        </div>
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
  <div class="center-panel" onclick={(e) => { if (!e.target.closest('.settings-btn') && !e.target.closest('.settings-panel')) { if (showSettingsMenu) playSound(settingsCloseSound); showSettingsMenu = false; } }}>
    <button class="settings-btn icon-settings" onclick={(e) => { e.stopPropagation(); if (showSettingsMenu) { showSettingsMenu = false; playSound(settingsCloseSound); } else { showSettingsMenu = true; playSound(settingsOpenSound); } }} title="Settings">{@html settingsIcon}</button>

    {#if showSettingsMenu}
      <div class="settings-panel">

        <h3>Output Mode</h3>
        <div class="mode-toggle">
          <button class={outputMode === 'single' ? 'mode-btn active' : 'mode-btn'} onclick={() => setOutputMode('single')}>Single</button>
          <button class={outputMode === 'batch' ? 'mode-btn active' : 'mode-btn'} onclick={() => setOutputMode('batch')}>Batch</button>
        </div>

        <h3 style="margin-top:14px">Theme</h3>
        <label class="toggle-row">
          <span>Dark/Light</span>
          <button class="toggle-btn" class:on={theme === 'light'}
            onclick={() => { setTheme(theme === 'light' ? 'dark' : 'light'); playSound(buttonGenericSound); }}>
            {theme === 'light' ? 'Light' : 'Dark'}
          </button>
        </label>

        <h3 style="margin-top:14px">Accent Color</h3>
        {#if !colorPickerOpen}
          <button class="color-wheel-btn" onclick={() => { colorPickerOpen = true; playSound(buttonGenericSound); }}>{@html colorIcon} Pick Color</button>
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
            <button class="cp-close-btn" onclick={() => { colorPickerOpen = false; playSound(buttonGenericSound); }}>Close</button>
          </div>
        {/if}

        <h3 style="margin-top:14px">Particles</h3>
        <label class="toggle-row">
          <span>Particle effects</span>
          <button class="toggle-btn" class:on={particlesEnabled}
            onclick={() => { particlesEnabled = !particlesEnabled; localStorage.setItem('rng-particles', String(particlesEnabled)); playSound(buttonGenericSound); }}>
            {particlesEnabled ? 'On' : 'Off'}
          </button>
        </label>

        <h3 style="margin-top:14px">Volume</h3>
        <div class="volume-row">
          <span class="vol-icon" style="color: var(--accent);">{@html (volume === 0 ? volumeMuteIcon : volume < 0.5 ? volumeLowIcon : volumeHighIcon)}</span>
          <input type="range" min="0" max="1" step="0.05" bind:value={volume}
            oninput={() => { localStorage.setItem('rng-volume', String(volume)); playSound(volumeChangeSound); }} class="volume-slider" />
          <span class="vol-label">{Math.round(volume * 100)}%</span>
        </div>

        <h3 style="margin-top:14px">Keyboard Shortcut</h3>
        <div class="shortcut-row">
          <span class="shortcut-badge">{shortcutDisplay}</span>
          <button class="icon-btn" onclick={() => { playSound(buttonGenericSound); startRecordingShortcut(); }} title="Change shortcut">Edit</button>
        </div>

        <div class="toggle-row">
          <span>Notify on shortcut</span>
          <button class="toggle-btn" class:on={notifyOnShortcut}
            onclick={() => { notifyOnShortcut = !notifyOnShortcut; localStorage.setItem('rng-notify-shortcut', String(notifyOnShortcut)); playSound(buttonGenericSound); }}>
            {notifyOnShortcut ? 'On' : 'Off'}
          </button>
        </div>

        <h3 style="margin-top:14px">Panels</h3>
        <div class="dock-row">
          <button class="dock-btn icon-dock-panel" class:active={inputDocked} onclick={toggleInputDock}>
            {#if inputDocked}{@html undockIcon}{:else}{@html dockIcon}{/if}
            <span>Inputs — {inputDocked ? 'docked' : 'floating'}</span>
          </button>
          <button class="dock-btn icon-dock-panel" class:active={outputDocked} onclick={toggleOutputDock}>
            {#if outputDocked}{@html undockIcon}{:else}{@html dockIcon}{/if}
            <span>Outputs — {outputDocked ? 'docked' : 'floating'}</span>
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
<button class="icon-btn icon-remove" onclick={handleBatchRemoveOutputs} title="Delete selected ({outputSelections.length})">{@html removeIcon}</button>
            <button class="icon-btn icon-unselect" onclick={unselectAllOutputs} title="Unselect all">{@html unselectIcon}</button>
          {:else}
            <button class="icon-btn icon-clear" onclick={() => handleClearOutputs()} title="Clear all">{@html clearIcon}</button>
          {/if}
  <button class="icon-btn icon-undock" onclick={toggleOutputDock} title="Undock">{@html undockIcon}</button>
        </div>
      </div>
      {#if outputs.length > 5}
        <input type="text" class="filter-input" placeholder="Filter..." bind:value={outputFilter} />
      {/if}
      <div class="list-wrapper">
        <div class="output-list">
          {#each filteredOutputIndices as { value: item, index: origIndex } (origIndex)}
            <div class="list-item" class:latest-output-item={origIndex === outputs.length - 1}
              class:selected={outputSelections.includes(item)} data-index={origIndex} data-value={item}
              onclick={(e) => handleItemSelect(e, 'output')} tabindex="0"
              onkeydown={(e) => { if (e.key === 'ArrowDown') { e.preventDefault(); focusedOutputIndex = Math.min(origIndex + 1, outputs.length - 1); document.querySelectorAll('.output-list .list-item')[focusedOutputIndex]?.focus(); } else if (e.key === 'ArrowUp') { e.preventDefault(); focusedOutputIndex = Math.max(origIndex - 1, 0); document.querySelectorAll('.output-list .list-item')[focusedOutputIndex]?.focus(); } else if (e.key === 'Enter' || e.key === ' ') { toggleOutputSelect(item); e.preventDefault(); } }}
              style="border-left: 3px solid var(--accent);">
              <span class="checkmark-wrap"><input type="checkbox" class="checkmark" onclick={(e) => { e.stopPropagation(); toggleOutputSelect(item); }} checked={outputSelections.includes(item)} /></span>
              <span class="item-number">{origIndex + 1}.</span>
              <span class="item-text">{item}</span>
            </div>
          {:else}
            <div class="empty-state">No outputs yet</div>
          {/each}
        </div>
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
    --bg-input-item: var(--bg-tertiary);
    --bg-output-item: var(--bg-tertiary);
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
    padding: 8px;
  }

  .standalone-panel .empty-state {
    color: var(--text-secondary);
    text-align: center;
    padding: 20px;
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
    transition: opacity 0.25s ease, transform 0.25s ease;
  }

  :global(.app-layout.input-undocked .sidebar:first-child),
  :global(.app-layout.output-undocked .sidebar:last-child) {
    opacity: 0;
    transform: scale(0.95);
    pointer-events: none;
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
    color: var(--text-secondary) !important;
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

  :global(.icon-btn svg) { width: 16px; height: 16px; color: inherit !important; }

  :global(.icon-btn:hover) {
    color: var(--accent) !important;
    border-color: var(--accent);
    background: var(--accent-bg-hover);
  }
  :global(.icon-btn:hover svg) { color: var(--accent) !important; }

  @keyframes spin-back-forward {
    0% { transform: rotate(0deg); }
    25% { transform: rotate(360deg); }
    50% { transform: rotate(0deg); }
    75% { transform: rotate(-360deg); }
    100% { transform: rotate(0deg); }
  }
  @keyframes bounce-up {
    0%, 100% { transform: translateY(0); }
    25% { transform: translateY(-4px); }
    50% { transform: translateY(0); }
    75% { transform: translateY(-4px); }
  }
  @keyframes jiggle {
    0%, 100% { transform: rotate(0deg); }
    25% { transform: rotate(-15deg); }
    75% { transform: rotate(15deg); }
  }
  @keyframes shrink-pulse {
    0%, 100% { transform: scale(1); }
    50% { transform: scale(0.75); }
  }
  @keyframes expand-pulse {
    0%, 100% { transform: scale(1); }
    50% { transform: scale(1.25); }
  }
  @keyframes jerk-down {
    0%, 100% { transform: translateY(0); }
    25% { transform: translateY(2px); }
    50% { transform: translateY(0); }
    75% { transform: translateY(2px); }
  }
  @keyframes shrink-subtle {
    0%, 100% { transform: scale(1); }
    50% { transform: scale(0.889); }
  }
  @keyframes double-shrink {
    0%, 100% { transform: scale(1); }
    25% { transform: scale(0.85); }
    50% { transform: scale(1); }
    75% { transform: scale(0.85); }
  }
  @keyframes tilt-right {
    0%, 100% { transform: rotate(0deg); }
    50% { transform: rotate(20deg); }
  }
  @keyframes spin-slow {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }

  :global(.icon-settings:hover svg) { animation: spin-back-forward 0.8s ease-in-out; }
  :global(.color-wheel-btn:hover svg) { animation: spin-slow 1s linear; }
  :global(.icon-undock:hover svg) { animation: bounce-up 0.5s ease-in-out; }
  :global(.icon-clear:hover svg) { animation: jiggle 0.3s ease-in-out; }
  :global(.icon-save:hover svg) { animation: shrink-pulse 0.4s ease-in-out; }
  :global(.icon-load:hover svg) { animation: expand-pulse 0.4s ease-in-out; }
  :global(.icon-dock:hover svg) { animation: double-shrink 0.4s ease-in-out; }
  :global(.icon-add:hover svg) { animation: tilt-right 0.4s ease-in-out; }
  :global(.icon-remove:hover svg) { animation: jiggle 0.3s ease-in-out; }
  :global(.icon-unselect:hover svg) { animation: jiggle 0.3s ease-in-out; }
  :global(.icon-dock-panel:hover svg) { animation: shrink-subtle 0.3s ease-in-out; }

  :global(.dock-btn svg) { color: currentColor; }
  :global(.settings-btn svg) { color: currentColor; }
  :global(.color-wheel-btn svg) { color: currentColor; }

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
    user-select: none;
  }

  :global(.checkmark) {
    width: 15px;
    height: 15px;
    -webkit-appearance: none;
    appearance: none;
    border-radius: 3px;
    background-color: var(--bg-tertiary);
    border: 1px solid var(--text-secondary);
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
    border: 1px solid var(--border-color);
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

  /* FIX: added animate-border keyframe and class that was referenced in JS but missing from CSS */
  @keyframes animate-border-pulse {
    0%, 100% { border-color: var(--border-color); box-shadow: none; }
    40% { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-glow); }
  }
  :global(.center-panel.animate-border) {
    animation: animate-border-pulse 0.6s ease forwards;
  }

  :global(.settings-btn) {
    position: absolute;
    top: 8px; left: 8px;
    z-index: 100;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    border-radius: 8px;
    width: 34px; height: 34px;
    display: flex; align-items: center; justify-content: center;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  :global(.settings-btn) { color: var(--text-secondary); }
  :global(.settings-btn svg) { width: 18px; height: 18px; color: inherit; }
  :global(.settings-btn:hover) { color: var(--accent); border-color: var(--accent); background: var(--accent-bg-hover); }
  :global(.settings-btn:active svg) { animation: iconPulse 150ms ease-out; }

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

  :global(.settings-panel svg) { color: var(--accent) !important; }
  :global(.vol-icon svg) { color: var(--accent) !important; }

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
    display: flex;
    align-items: center;
    gap: 6px;
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
  .vol-icon { font-size: 14px; display: flex; align-items: center; color: var(--accent); }
  .volume-slider { flex: 1; accent-color: var(--accent); cursor: pointer; }
  .vol-label { font-size: 11px; color: var(--text-secondary); min-width: 32px; text-align: right; font-family: monospace; }

  /* Shortcut */
  .shortcut-row { display: flex; align-items: center; gap: 8px; }
  .shortcut-badge { flex: 1; background: var(--bg-quaternary); border: 1px solid var(--border-color); border-radius: 5px; padding: 4px 8px; font-family: monospace; font-size: 11px; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  /* Dock buttons */
  .dock-row { display: flex; flex-direction: column; gap: 5px; }
  .dock-btn { width: 100%; padding: 6px 10px; background: var(--bg-tertiary); border: 1px solid var(--border-color); border-radius: 7px; color: var(--text-secondary); font-size: 11px; cursor: pointer; text-align: left; transition: all 0.15s ease; display: flex; align-items: center; gap: 6px; }
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
    0%, 100% { filter: drop-shadow(0 0 0 transparent); }
    50% { filter: drop-shadow(0 0 8px var(--accent-glow)) drop-shadow(0 0 16px var(--accent-bg-hover)); }
  }
  .list-item.dragging {
    opacity: 0.35;
    background: var(--accent-bg-hover);
  }

  .list-wrapper.is-dragging {
    cursor: grabbing;
    user-select: none;
  }

  .list-wrapper.is-dragging .list-item {
    cursor: grabbing;
  }

  :global(.latest-output-item) { animation: subtlePulse 2s ease; will-change: filter; }

  @keyframes pulseGlow {
    0%, 100% { box-shadow: 0 0 20px var(--accent-glow); }
    50% { box-shadow: 0 0 32px var(--accent-glow), 0 0 48px var(--accent-glow-medium); }
  }
  :global(.latest-output-field.pulse) { animation: pulseGlow 0.6s ease; }

  @keyframes gradientDrift { 0% { transform: translate(0, 0); } 50% { transform: translate(-5%, -5%); } 100% { transform: translate(0, 0); } }

  body::before {
    content: ''; position: fixed; top: -50%; left: -50%; width: 200%; height: 200%;
    background: radial-gradient(circle at 30% 40%, var(--accent-bg-hover) 0%, transparent 50%),
                radial-gradient(circle at 70% 60%, rgba(139, 92, 246, 0.02) 0%, transparent 50%);
    animation: gradientDrift 20s ease infinite; will-change: transform; pointer-events: none; z-index: -1;
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

  .edit-cancel {
    background: transparent; border: none; color: var(--text-secondary); cursor: pointer;
    font-size: 14px; padding: 0 6px; opacity: 0.7;
  }
  .edit-cancel:hover { opacity: 1; color: var(--accent); }

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