export class ParticleSystem {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.particles = [];
    this.animating = false;

    // Store bound reference so we can remove it later
    this._resizeHandler = () => this.resize();
    window.addEventListener('resize', this._resizeHandler);

    // Size the canvas without starting the animation loop
    this._syncSize();
  }

  // Just syncs canvas dimensions — does NOT start animation
  _syncSize() {
    if (!this.canvas.parentElement) return;
    const rect = this.canvas.parentElement.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      this.canvas.width = rect.width;
      this.canvas.height = rect.height;
    }
  }

  // Called on window resize — only syncs size, does not touch animation state
  resize() {
    this._syncSize();
  }

  // Call this to clean up when the ParticleSystem is no longer needed
  destroy() {
    window.removeEventListener('resize', this._resizeHandler);
    this.particles = [];
    this.animating = false;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  burst(count, color) {
    for (let i = 0; i < count / 2; i++) {
      this.particles.push({
        x: -Math.random() * 10,
        y: Math.random() * this.canvas.height,
        vx: 3 + Math.random() * 4,
        vy: (Math.random() - 0.5) * 1.5,
        size: 4 + Math.random() * 6,
        alpha: 1,
        color,
      });
    }
    for (let i = 0; i < count / 2; i++) {
      this.particles.push({
        x: this.canvas.width + Math.random() * 10,
        y: Math.random() * this.canvas.height,
        vx: -(3 + Math.random() * 4),
        vy: (Math.random() - 0.5) * 1.5,
        size: 4 + Math.random() * 6,
        alpha: 1,
        color,
      });
    }
  }

  rising(count, color) {
    for (let i = 0; i < count; i++) {
      this.particles.push({
        x: Math.random() * this.canvas.width,
        y: this.canvas.height - Math.random() * this.canvas.height * 0.3,
        vx: (Math.random() - 0.5) * 2,
        vy: -(1 + Math.random() * 2),
        size: 2 + Math.random() * 4,
        alpha: 0.8,
        color,
      });
    }
  }

  risingUpward(count, color) {
    for (let i = 0; i < count; i++) {
      this.particles.push({
        x: Math.random() * this.canvas.width,
        y: this.canvas.height + Math.random() * 10,
        vx: (Math.random() - 0.5) * 3,
        vy: -(2 + Math.random() * 4),
        size: 3 + Math.random() * 5,
        alpha: 1,
        color,
      });
    }
  }

  animate() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.alpha -= 0.011;

      if (p.alpha <= 0) {
        this.particles.splice(i, 1);
        continue;
      }

      this.ctx.globalAlpha = p.alpha;
      this.ctx.fillStyle = p.color;
      this.ctx.fillRect(p.x, p.y, p.size, p.size);
    }

    // Always reset globalAlpha so the canvas context is left clean
    this.ctx.globalAlpha = 1;

    if (this.particles.length > 0) {
      requestAnimationFrame(() => this.animate());
    } else {
      this.animating = false;
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }

  startAnimation() {
    if (this.particles.length > 0 && !this.animating) {
      this.animating = true;
      this.animate();
    }
  }
}