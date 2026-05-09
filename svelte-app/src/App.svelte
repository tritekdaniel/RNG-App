<script>
  import { onMount, onDestroy } from 'svelte';
  import { ParticleSystem } from './lib/particles.js';
  import { invoke } from '@tauri-apps/api/core';

  let inputs = $state([]);
  let outputs = $state([]);
  let latestOutput = $state(null);

  let editValue = $state('');
  let editingInputIndex = $state(-1);

  let tempColor = $state(localStorage.getItem('rng-accent-color') || '#263ed2');
  let showCompletionModal = $state(false);
  let outputMode = $state(localStorage.getItem('rng-output-mode') || 'single');
  let outputSelections = $state([]);
  let inputSelections = $state([]);
  let showSettingsMenu = $state(false);
  let colorPickerOpen = $state(false);

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

  // Canvas refs for color picker
  let svCanvasRef = null;
  let svWrapRef = null;

  // HSV state initialized from loaded accent color
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
    return {
      h: Math.round(h * 60),
      s: maxC === 0 ? 0 : Math.round(delta / maxC * 100),
      v: Math.round(maxC * 100)
    };
  })();
  let hueVal = $state(_initHsv.h);
  let satVal = $state(_initHsv.s);
  let valVal = $state(_initHsv.v);

  function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const maxC = Math.max(r, g, b), minC = Math.min(r, g, b);
    const delta = maxC - minC;
    let h = 0;
    if (delta !== 0) {
      if (maxC === r) h = (((g - b) / delta) % 6);
      else if (maxC === g) h = ((b - r) / delta + 2);
      else h = ((r - g) / delta + 4);
    }
    return { h: Math.round(h * 60), s: maxC === 0 ? 0 : Math.round(delta / maxC * 100), v: Math.round(maxC * 100) };
  }

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
    return `#${Math.round((r + m) * 255).toString(16).padStart(2, '0')}${Math.round((g + m) * 255).toString(16).padStart(2, '00')}${Math.round((b + m) * 255).toString(16).padStart(2, '0')}`;
  }

  let canvasRef = null;
  let outputCanvasRef = null;
  let particleSystem = null;
  let outputParticleSystem = null;
  let prevOutputsLen = 0;
  let resizeObserver = null;
  let shortcutHandler = null;
  let svDragging = false;
  let hueDragging = false;
  let moveHandler = null;
  let upHandler = null;

  function drawSV() {
    if (!svCanvasRef || !svWrapRef) return;
    const ctx = svCanvasRef.getContext('2d');
    const w = svWrapRef.clientWidth;
    const h = 150;
    svCanvasRef.width = w * 2;
    svCanvasRef.height = h * 2;
    ctx.scale(2, 2);

    const hueColor = `hsl(${hueVal}, 100%, 50%)`;
    const gW = ctx.createLinearGradient(0, 0, w, 0);
    gW.addColorStop(0, '#fff');
    gW.addColorStop(1, hueColor);
    ctx.fillStyle = gW;
    ctx.fillRect(0, 0, w, h);
    const gB = ctx.createLinearGradient(0, 0, 0, h);
    gB.addColorStop(0, 'rgba(0,0,0,0)');
    gB.addColorStop(1, '#000');
    ctx.fillStyle = gB;
    ctx.fillRect(0, 0, w, h);

    const thumbX = (satVal / 100) * w;
    const thumbY = ((100 - valVal) / 100) * h;
    ctx.beginPath();
    ctx.arc(thumbX, thumbY, 6, 0, Math.PI * 2);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(thumbX, thumbY, 4, 0, Math.PI * 2);
    ctx.fillStyle = hsvToRgbStr(hueVal, satVal, valVal);
    ctx.fill();
  }

  function startSVDrag(e) {
    e.preventDefault();
    svDragging = true;
    updateSVFromEvent(e);
    const onMove = (ev) => { if (svDragging) updateSVFromEvent(ev); };
    const onUp = () => {
      svDragging = false;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  function startHueDrag(e) {
    e.preventDefault();
    hueDragging = true;
    hueFromEvent(e);
    const onMove = (ev) => { if (hueDragging) hueFromEvent(ev); };
    const onUp = () => {
      hueDragging = false;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  function updateSVFromEvent(e) {
    if (!svWrapRef) return;
    const rect = svWrapRef.getBoundingClientRect();
    let clientX, clientY;
    if (e.touches) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }
    satVal = Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100));
    valVal = Math.min(100, Math.max(0, 100 - ((clientY - rect.top) / rect.height) * 100));
    tempColor = hsvToRgbStr(hueVal, satVal, valVal);
    updateAccentColor(tempColor);
    drawSV();
  }

  function hueFromEvent(e) {
    if (!svWrapRef) return;
    const rect = svWrapRef.getBoundingClientRect();
    let clientX;
    if (e.touches) {
      clientX = e.touches[0].clientX;
    } else {
      clientX = e.clientX;
    }
    hueVal = Math.min(360, Math.max(0, ((clientX - rect.left) / rect.width) * 360));
    tempColor = hsvToRgbStr(hueVal, satVal, valVal);
    updateAccentColor(tempColor);
    drawSV();
  }

  async function rpc(cmd, args) {
    return invoke(cmd, args ?? {});
  }

  async function refreshState() {
    const state = await rpc('get_state');
    if (state) {
      inputs = state.inputs || [];
      outputs = state.outputs || [];
      outputMode = state.output_mode || 'single';

      if (outputs.length > prevOutputsLen && particleSystem && canvasRef) {
        const lastOutputEl = document.querySelector('.latest-output-item');
        if (lastOutputEl) {
          const elRect = lastOutputEl.getBoundingClientRect();
          for (let i = 0; i < 6; i++) {
            particleSystem.particles.push({
              x: elRect.left + Math.random() * elRect.width,
              y: elRect.bottom,
              vx: (Math.random() - 0.5) * 0.3,
              vy: -(0.4 + Math.random() * 0.6),
              size: 1.5 + Math.random() * 2,
              alpha: 0.5,
              color: tempColor,
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

  // Redraw SV canvas whenever color picker opens or hue changes
  $effect(() => {
    const _h = hueVal;
    if (colorPickerOpen && svCanvasRef) {
      drawSV();
    }
    return () => {};
  });

  onMount(async () => {
    await refreshState();

    setTimeout(() => {
      if (canvasRef) {
        const rect = canvasRef.parentElement.getBoundingClientRect();
        canvasRef.width = rect.width;
        canvasRef.height = rect.height;
        particleSystem = new ParticleSystem(canvasRef);

        resizeObserver = new ResizeObserver(() => {
          if (canvasRef && particleSystem) {
            const r = canvasRef.parentElement.getBoundingClientRect();
            canvasRef.width = r.width;
            canvasRef.height = r.height;
          }
          if (outputCanvasRef && outputParticleSystem) {
            const r = outputCanvasRef.parentElement.getBoundingClientRect();
            outputCanvasRef.width = r.width;
            outputCanvasRef.height = r.height;
          }
        });
        resizeObserver.observe(canvasRef.parentElement);
        if (outputCanvasRef) {
          resizeObserver.observe(outputCanvasRef.parentElement);
        }
      }

      if (outputCanvasRef) {
        const rect = outputCanvasRef.parentElement.getBoundingClientRect();
        outputCanvasRef.width = rect.width;
        outputCanvasRef.height = rect.height;
        outputParticleSystem = new ParticleSystem(outputCanvasRef);
      }
    }, 100);

    shortcutHandler = (e) => {
      if (e.altKey && e.shiftKey && e.code === 'KeyR') {
        e.preventDefault();
        handleGenerate();
      }
    };
    document.addEventListener('keydown', shortcutHandler);
    // updateAccentColors removed here — now runs synchronously at module level
  });

  // CSS-based sparkle particles for latest output item
  $effect(() => {
    const _len = outputs.length;
    if (outputs.length === 0 || !particleSystem) return;

    const el = document.querySelector('.latest-output-item');
    if (!el) return;

    const sparkleInterval = setInterval(() => {
      if (outputs.length === 0 || !particleSystem) return;
      const rect = el.getBoundingClientRect();
      for (let i = 0; i < 2; i++) {
        particleSystem.particles.push({
          x: rect.left + Math.random() * rect.width,
          y: rect.bottom,
          vx: (Math.random() - 0.5) * 0.3,
          vy: -(0.4 + Math.random() * 0.6),
          size: 1.5 + Math.random() * 2,
          alpha: 0.5,
          color: tempColor,
        });
      }
      particleSystem.startAnimation();
    }, 300);

    return () => clearInterval(sparkleInterval);
  });

  onDestroy(() => {
    if (resizeObserver) resizeObserver.disconnect();
    if (shortcutHandler) document.removeEventListener('keydown', shortcutHandler);
  });

  async function handleAddInput(value) {
    if (!value || !value.trim()) return;
    const parts = value.split('|').map(s => s.trim()).filter(Boolean);
    for (const part of parts) {
      await rpc('add_input', { value: part });
    }
    await refreshState();
  }

  async function handleRemoveInput(index) {
    await rpc('remove_input', { index });
    await refreshState();
  }

  async function handleClearInputs() {
    await rpc('clear_inputs');
    inputSelections = [];
    await refreshState();
  }

  async function handleGenerate() {
    if (inputs.length === 0) return;

    if (outputMode === 'batch') {
      await handleBatchGenerate();
      return;
    }

    const result = await rpc('generate');

    if (!result) {
      showCompletionModal = true;
      try { new Audio(new URL('./assets/yup-03.aac', import.meta.url)).play(); } catch (e) {}
      return;
    }

    latestOutput = result;

    try {
      const audio = new Audio(new URL('./assets/bew.aac', import.meta.url));
      audio.play();
    } catch (e) {}

    let accent = tempColor;
    updateAccentColors(accent);
    document.documentElement.style.setProperty('--accent', accent);

    if (outputParticleSystem && outputCanvasRef) {
      outputParticleSystem.risingUpward(150, accent);
      outputParticleSystem.startAnimation();
    }

    const latestField = document.querySelector('.latest-output-field');
    if (latestField) {
      latestField.classList.add('pulse');
      setTimeout(() => latestField.classList.remove('pulse'), 600);
    }

    await refreshState();

    const centerPanel = document.querySelector('.center-panel');
    if (centerPanel) {
      centerPanel.classList.remove('animate-border');
      void centerPanel.offsetWidth;
      centerPanel.classList.add('animate-border');
    }
  }

  function toggleInputSelect(index) {
    if (inputSelections.includes(index)) {
      inputSelections = inputSelections.filter(i => i !== index);
    } else {
      inputSelections = [...inputSelections, index];
    }
  }

  async function handleBatchRemoveInputs() {
    if (inputSelections.length === 0) return;
    const indices = [...inputSelections].sort((a, b) => b - a);
    for (const i of indices) {
      await rpc('remove_input', { index: i });
    }
    inputSelections = [];
    await refreshState();
  }

  function toggleOutputSelect(value) {
    if (outputSelections.includes(value)) {
      outputSelections = outputSelections.filter(v => v !== value);
    } else {
      outputSelections = [...outputSelections, value];
    }
  }

  async function handleBatchRemoveOutputs() {
    if (outputSelections.length === 0) return;
    for (const v of outputSelections) {
      await rpc('remove_output', { value: v });
    }
    outputSelections = [];
    await refreshState();
  }

  function handleItemSelect(e, type) {
    const target = e.target;
    if (target.classList.contains('checkmark')) return;
    if (type === 'input') {
      toggleInputSelect(parseInt(e.currentTarget.dataset.index));
    } else {
      toggleOutputSelect(e.currentTarget.dataset.value);
    }
  }

  async function handleClearOutputs() {
    showCompletionModal = false;
    await rpc('clear_outputs');
    latestOutput = null;
    outputSelections = [];
    await refreshState();
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

  function startEditing(index, value) {
    editingInputIndex = index;
    editValue = value;
  }

  async function saveEdit() {
    if (editingInputIndex === -1 || !editValue.trim()) return;
    await rpc('update_input', { index: editingInputIndex, value: editValue.trim() });
    editingInputIndex = -1;
    editValue = '';
    await refreshState();
  }

  function cancelEdit() {
    editingInputIndex = -1;
    editValue = '';
  }

  async function setOutputMode(mode) {
    outputMode = mode;
    localStorage.setItem('rng-output-mode', mode);
    await rpc('set_output_mode', { mode });
  }

  async function handleBatchGenerate() {
    if (inputs.length === 0) return;

    const [results, _state] = await rpc('batch_generate');

    if (!results || results.length === 0) {
      showCompletionModal = true;
      try { new Audio(new URL('./assets/yup-03.aac', import.meta.url)).play(); } catch (e) {}
      return;
    }

    latestOutput = null;

    try {
      const audio = new Audio(new URL('./assets/bip-bop-02.aac', import.meta.url));
      audio.play();
    } catch (e) {}

    let accent = tempColor;
    updateAccentColors(accent);
    document.documentElement.style.setProperty('--accent', accent);

    if (outputParticleSystem && outputCanvasRef) {
      outputParticleSystem.risingUpward(150, accent);
      outputParticleSystem.startAnimation();
    }

    await refreshState();

    const centerPanel = document.querySelector('.center-panel');
    if (centerPanel) {
      centerPanel.classList.remove('animate-border');
      void centerPanel.offsetWidth;
      centerPanel.classList.add('animate-border');
    }
  }
</script>

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

<div class="app-layout">
  <!-- Left Sidebar - Input List -->
  <div class="sidebar">
    <div class="sidebar-header">
      <span class="sidebar-title">Inputs</span>
      <div class="sidebar-actions">
        {#if inputSelections.length > 0}
          <button class="icon-btn" onclick={handleBatchRemoveInputs} title="Delete selected inputs ({inputSelections.length})">×</button>
        {:else}
          <button class="icon-btn" onclick={() => handleClearInputs()} title="Clear all">🗑️</button>
        {/if}
        <button class="icon-btn" onclick={async () => { const el = document.getElementById('inputField'); if (el?.value.trim()) { await handleAddInput(el.value); el.value = ''; } else { el?.focus(); } }} title="Add new item">+</button>
      </div>
    </div>

    <div class="input-list">
      {#each inputs as item, i (i)}
        {#if editingInputIndex === i}
          <div class="list-item edit-mode" onclick={(e) => e.stopPropagation()}>
            <input type="text" class="edit-input" bind:value={editValue} autofocus onkeydown={(e) => { if (e.key === 'Enter') { saveEdit(); e.preventDefault(); } else if (e.key === 'Escape') { cancelEdit(); e.preventDefault(); } }} />
          </div>
        {:else}
          <div class="list-item" class:selected={inputSelections.includes(i)} data-index={i} onclick={(e) => handleItemSelect(e, 'input')} tabindex="0" onkeydown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !e.target.classList.contains('checkmark')) { toggleInputSelect(i); e.preventDefault(); } }}>
            <span class="checkmark-wrap"><input type="checkbox" class="checkmark" onclick={(e) => { e.stopPropagation(); toggleInputSelect(i); }} checked={inputSelections.includes(i)} /></span>
            <span class="item-number">{i + 1}.</span>
            <span class="item-text">{item}</span>
            <span class="edit-link" title="Edit input" style="cursor:pointer; margin-left:auto; padding: 4px 8px; border-radius:6px; transition: all 0.2s ease;" onclick={(e) => { e.stopPropagation(); startEditing(i, item); }}>Edit</span>
          </div>
        {/if}
      {:else}
        <div class="empty-state">No inputs added yet</div>
      {/each}
    </div>

    <div class="add-input-container">
      <input id="inputField" type="text" class="add-input" placeholder="Type and press Enter..." onkeydown={(e) => { if (e.key === 'Enter') { handleAddInput(e.target.value); e.target.value = ''; } }} />
    </div>
  </div>

  <!-- Center Panel - Generator -->
  <div class="center-panel" onclick={(e) => { if (!e.target.closest('.hamburger-btn') && !e.target.closest('.settings-panel')) showSettingsMenu = false; }}>
    <button class="hamburger-btn" onclick={(e) => { e.stopPropagation(); showSettingsMenu = !showSettingsMenu }} title="Settings">&#x2630;</button>

    {#if showSettingsMenu}
      <div class="settings-panel">
        <h3>Output Mode</h3>
        <div class="mode-toggle">
          <button class={outputMode === 'single' ? 'mode-btn active' : 'mode-btn'} onclick={() => setOutputMode('single')}>Single</button>
          <button class={outputMode === 'batch' ? 'mode-btn active' : 'mode-btn'} onclick={() => setOutputMode('batch')}>Batch</button>
        </div>

        <h3 style="margin-top: 16px;">Accent Color</h3>
        {#if !colorPickerOpen}
          <button class="color-wheel-btn" onclick={() => colorPickerOpen = true} title="Open color picker">🎨 Pick Color</button>
        {:else}
          <div class="cp-wrap">
            <div class="cp-canvas-wrap" bind:this={svWrapRef} onpointerdown={(e) => { startSVDrag(e); }}>
              <canvas class="cp-canvas" bind:this={svCanvasRef} height="150"></canvas>
            </div>

            <div class="cp-hue-wrap">
              <div class="cp-hue-track" onpointerdown={(e) => { startHueDrag(e); }}>
                <div class="cp-hue-thumb" style="left: calc({(hueVal / 360) * 100}% - 4px);"></div>
              </div>
            </div>

            <div class="cp-output">
              <div class="cp-swatch" style="background: {tempColor};"></div>
              <div class="cp-values">
                <input class="cp-hex" bind:value={tempColor} oninput={(e) => { if (/^#[0-9A-Fa-f]{6}$/.test(e.currentTarget.value)) updateAccentColor(e.currentTarget.value); }} />
              </div>
            </div>

            <button class="cp-close-btn" onclick={() => colorPickerOpen = false}>Close</button>
          </div>
        {/if}
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
  </div>

  <!-- Right Sidebar - Output List -->
  <div class="sidebar">
    <div class="sidebar-header">
      <span class="sidebar-title">Outputs</span>
      <div class="sidebar-actions">
        {#if outputSelections.length > 0}
          <button class="icon-btn" onclick={handleBatchRemoveOutputs} title="Delete selected outputs ({outputSelections.length})">×</button>
        {:else}
          <button class="icon-btn" onclick={() => handleClearOutputs()} title="Clear all">🗑️</button>
        {/if}
      </div>
    </div>

    <div class="output-list">
      {#each outputs as item, i (i)}
        <div class="list-item" class:latest-output-item={i === outputs.length - 1} class:selected={outputSelections.includes(item)} data-value={item} onclick={(e) => handleItemSelect(e, 'output')} tabindex="0" onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { toggleOutputSelect(item); e.preventDefault(); } }} style="border-left: 3px solid var(--accent);">
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
</div>

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

  html, body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
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
  }

  :global(.sidebar) {
    background-color: var(--bg-secondary);
    border-radius: 12px;
    border: 1px solid var(--border-color);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    position: relative;
  }

  :global(.sidebar-header) {
    padding: 16px;
    border-bottom: 1px solid var(--border-color);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  :global(.sidebar-title) {
    font-size: 14px;
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
    padding: 6px 8px;
    cursor: pointer;
    transition: all 0.2s ease;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    line-height: 1;
  }

  :global(.icon-btn:hover) {
    color: var(--text-primary);
    border-color: var(--accent);
    background: var(--accent-bg-hover);
  }

  :global(.edit-link) {
    color: var(--bg-tertiary);
  }

  :global(.edit-link:hover) {
    color: var(--text-primary);
  }

  :global(.input-list), :global(.output-list) {
    flex: 1;
    overflow-y: auto;
    padding: 8px;
    text-align: left;
  }

  :global(.list-item) {
    padding: 10px 8px;
    margin-bottom: 4px;
    background: var(--bg-tertiary);
    border: 1px solid transparent;
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.2s ease;
    font-size: 14px;
    display: flex;
    align-items: center;
  }

  :global(.checkmark) {
    width: 16px;
    height: 16px;
    -webkit-appearance: none;
    appearance: none;
    border-radius: 3px;
    background-color: var(--bg-quaternary);
    cursor: pointer;
    flex-shrink: 0;
    vertical-align: middle;
  }

  :global(.checkmark:checked) {
    background-color: var(--accent);
  }

  :global(.checkmark-wrap) {
    display: inline-flex;
    align-items: center;
    height: 18px;
    margin-right: 8px;
  }

  :global(.item-number) {
    color: var(--text-secondary);
    min-width: 24px;
    text-align: right;
    margin-right: 8px;
    font-size: 14px;
    flex-shrink: 0;
  }

  .list-item {
    padding: 10px 8px;
    margin-bottom: 4px;
    background: var(--bg-tertiary);
    border: 1px solid transparent;
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.2s ease;
    font-size: 14px;
    display: flex;
    align-items: center;
    line-height: normal;
  }

  .input-list .list-item {
    background: var(--bg-input-item);
  }

  .output-list .list-item {
    background: var(--bg-output-item);
    justify-content: flex-start;
  }

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
  }

  :global(.hamburger-btn) {
    position: absolute;
    top: 8px;
    left: 8px;
    z-index: 100;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    color: var(--text-secondary);
    border-radius: 8px;
    width: 36px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    font-size: 18px;
    transition: all 0.2s ease;
  }

  :global(.hamburger-btn:hover) {
    color: var(--text-primary);
    border-color: var(--accent);
    background: var(--accent-bg-hover);
  }

  :global(.settings-panel) {
    position: absolute;
    top: 52px;
    left: 8px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: 12px;
    padding: 16px;
    z-index: 101;
    min-width: 200px;
  }

  :global(.settings-panel h3) {
    font-size: 14px;
    color: var(--text-secondary);
    margin-bottom: 12px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .color-wheel-btn {
    width: 100%;
    padding: 8px 16px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    border-radius: 8px;
    color: var(--text-secondary);
    font-size: 13px;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .color-wheel-btn:hover {
    border-color: var(--accent);
    color: var(--text-primary);
  }

  .cp-wrap { padding-top: 8px; }
  .cp-canvas-wrap { position: relative; width: 100%; border-radius: 8px; overflow: hidden; border: 1px solid var(--border-color); cursor: crosshair; touch-action: none; }
  .cp-canvas { display: block; width: 100%; height: 150px; pointer-events: none; }
  .cp-hue-wrap { margin-top: 8px; position: relative; }
  .cp-hue-track { width: 100%; height: 14px; border-radius: 7px; background: linear-gradient(to right, #f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00); cursor: pointer; position: relative; }
  .cp-hue-thumb { position: absolute; top: -2px; width: 8px; height: 18px; background: #fff; border-radius: 2px; box-shadow: 0 0 3px rgba(0,0,0,0.4); }
  .cp-output { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
  .cp-swatch { width: 28px; height: 28px; border-radius: 6px; border: 1px solid var(--border-color); flex-shrink: 0; }
  .cp-values { display: flex; align-items: center; gap: 8px; }
  .cp-hex { font-family: monospace; font-size: 13px; color: var(--text-primary); border: 1px solid var(--border-color); background: transparent; padding: 4px 6px; width: 90px; border-radius: 4px; outline: none; }
  .cp-close-btn { width: 100%; margin-top: 8px; padding: 6px 12px; background: var(--bg-tertiary); border: 1px solid var(--border-color); border-radius: 6px; color: var(--text-secondary); font-size: 12px; cursor: pointer; }
  .cp-close-btn:hover { border-color: var(--accent); color: var(--text-primary); }

  :global(.mode-toggle) { display: flex; gap: 8px; }

  :global(.mode-btn) {
    flex: 1;
    padding: 8px 16px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    border-radius: 8px;
    color: var(--text-secondary);
    font-size: 13px;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  :global(.mode-btn:hover) {
    border-color: var(--accent);
    color: var(--text-primary);
  }

  :global(.mode-btn.active) {
    background: var(--accent);
    border-color: var(--accent);
    color: white;
  }

  @keyframes slideIn { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }
  :global(.list-item.new) { animation: slideIn 0.3s ease forwards; }

  @keyframes subtlePulse {
    0%, 100% { box-shadow: 0 0 0 var(--accent-glow); }
    50% { box-shadow: 0 0 8px var(--accent-glow), 0 0 16px var(--accent-bg-hover); }
  }
  :global(.latest-output-item) { animation: subtlePulse 2s ease infinite; border-left-color: var(--accent); }

  @keyframes pulseGlow {
    0%, 100% { box-shadow: 0 0 24px var(--accent-glow); }
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
    width: 100%;
    height: 100%;
    display: block;
    position: absolute;
    top: 0;
    left: 0;
    pointer-events: none;
  }

  .edit-input {
    background-color: var(--bg-primary);
    color: var(--text-primary);
    border: 1px solid var(--border-color);
    border-radius: 6px;
    padding: 8px;
    font-size: 14px;
    width: 100%;
    box-sizing: border-box;
    outline: none;
  }

  :global(.latest-output-field) {
    width: 100%;
    min-height: 48px;
    padding: 12px 16px;
    border-radius: 8px;
    border: 1px solid var(--border-color);
    background-color: var(--bg-input-item);
    color: var(--text-primary);
    font-size: 18px;
    font-weight: 500;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s ease;
  }

  :global(.latest-output-field.has-value) {
    border-color: var(--accent);
  }

  :global(.add-input) {
    background-color: var(--bg-input-item);
    color: var(--text-primary);
    border: 1px solid var(--border-color);
    border-radius: 6px;
    padding: 8px 12px;
    font-size: 14px;
    width: 100%;
    box-sizing: border-box;
    outline: none;
    transition: all 0.2s ease;
  }

  :global(.add-input:focus) { border-color: var(--accent); }
  :global(.add-input::placeholder) { color: var(--text-secondary); }
</style>