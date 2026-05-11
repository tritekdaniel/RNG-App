export class ParticleSystem {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.particles = [];
    this.animating = false;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    this.canvas.width = rect.width;
    this.canvas.height = rect.height;
    if (!this.animating) {
      this.animating = true;
      this.animate();
    }
  }

  burst(count, color) {
    for (let i = 0; i < count / 2; i++) {
      // Left side particles moving right
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
      // Right side particles moving left
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

    if (this.particles.length > 0) {
      requestAnimationFrame(() => this.animate());
    } else {
      this.animating = false;
      // Final clear after all particles gone
      setTimeout(() => {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      }, 100);
    }
  }

  startAnimation() {
    if (this.particles.length > 0 && !this.animating) {
      this.animating = true;
      this.animate();
    }
  }
}
