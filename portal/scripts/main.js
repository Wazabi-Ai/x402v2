/**
 * x402 Portal - Interactive Scripts
 */

// ============================================================================
// Demo Tabs
// ============================================================================

function initDemoTabs() {
  const tabs = document.querySelectorAll('.demo-tab');
  const panels = document.querySelectorAll('.demo-panel');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const targetTab = tab.dataset.tab;

      // Update tab states
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      // Update panel visibility
      panels.forEach(panel => {
        panel.classList.remove('active');
        if (panel.id === `panel-${targetTab}`) {
          panel.classList.add('active');
        }
      });
    });
  });
}

// ============================================================================
// Copy to Clipboard
// ============================================================================

const codeSnippets = {
  client: `import { X402Client } from '@wazabiai/x402/client';

const client = new X402Client({
  privateKey: process.env.PRIVATE_KEY,
  onPaymentRequired: (requirement) => {
    console.log('Payment needed:', requirement.amount);
  },
  onPaymentSigned: (payment) => {
    console.log('Signed by:', payment.signer);
  }
});

const response = await client.fetch('https://api.example.com/premium-data');
console.log(response.data);`,

  server: `import express from 'express';
import { x402Middleware, BSC_USDT, parseTokenAmount } from '@wazabiai/x402/server';

const app = express();

const paymentConfig = {
  recipientAddress: '0xYourWalletAddress',
  amount: parseTokenAmount('0.10', BSC_USDT.address).toString(),
  tokenAddress: BSC_USDT.address,
  description: 'Access to premium API',
};

app.use('/api/premium', x402Middleware(paymentConfig));

app.get('/api/premium/data', (req, res) => {
  const { x402 } = req;
  console.log(\`Paid by: \${x402?.signer}\`);
  res.json({ premium: 'content', secret: 'data' });
});

app.listen(3000);`,

  types: `import type {
  PaymentRequirement,
  PaymentPayload,
  SignedPayment,
  X402ClientConfig,
  X402MiddlewareConfig,
} from '@wazabiai/x402/types';

interface PaymentRequirement {
  amount: string;
  token: string;
  network_id: string;
  pay_to: string;
  expires_at?: number;
  nonce?: string;
}

interface PaymentPayload {
  amount: string;
  token: string;
  chainId: number;
  payTo: string;
  payer: string;
  deadline: number;
  nonce: string;
  resource?: string;
}

interface SignedPayment {
  payload: PaymentPayload;
  signature: \`0x\${string}\`;
  signer: \`0x\${string}\`;
}`
};

function initCopyButtons() {
  // Code window copy buttons
  document.querySelectorAll('.code-copy').forEach(button => {
    button.addEventListener('click', async () => {
      const codeKey = button.dataset.code;
      const code = codeSnippets[codeKey];
      
      if (code) {
        await copyToClipboard(code, button);
      }
    });
  });

  // Inline copy buttons
  document.querySelectorAll('.code-copy-inline').forEach(button => {
    button.addEventListener('click', async () => {
      const code = button.dataset.copy;
      if (code) {
        await copyToClipboard(code, button);
      }
    });
  });
}

async function copyToClipboard(text, button) {
  try {
    await navigator.clipboard.writeText(text);
    
    // Visual feedback
    const originalHTML = button.innerHTML;
    button.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="20 6 9 17 4 12"/>
      </svg>
    `;
    button.style.color = '#22c55e';
    
    setTimeout(() => {
      button.innerHTML = originalHTML;
      button.style.color = '';
    }, 2000);
  } catch (err) {
    console.error('Failed to copy:', err);
  }
}

// ============================================================================
// Smooth Scroll
// ============================================================================

function initSmoothScroll() {
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function(e) {
      e.preventDefault();
      const target = document.querySelector(this.getAttribute('href'));
      if (target) {
        const navHeight = document.querySelector('.nav').offsetHeight;
        const targetPosition = target.getBoundingClientRect().top + window.pageYOffset - navHeight - 20;
        
        window.scrollTo({
          top: targetPosition,
          behavior: 'smooth'
        });
      }
    });
  });
}

// ============================================================================
// Navigation Scroll Effect
// ============================================================================

function initNavScrollEffect() {
  const nav = document.querySelector('.nav');
  let lastScroll = 0;

  function getNavBg(scrolled) {
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    if (isLight) {
      return scrolled ? 'rgba(245, 245, 247, 0.95)' : 'rgba(245, 245, 247, 0.85)';
    }
    return scrolled ? 'rgba(10, 10, 15, 0.95)' : 'rgba(10, 10, 15, 0.8)';
  }

  window.addEventListener('scroll', () => {
    const currentScroll = window.pageYOffset;
    nav.style.background = getNavBg(currentScroll > 100);
    lastScroll = currentScroll;
  });
}

// ============================================================================
// Mobile Navigation
// ============================================================================

function initMobileNav() {
  const toggle = document.querySelector('.nav-toggle');
  const links = document.querySelector('.nav-links');

  if (toggle && links) {
    toggle.addEventListener('click', () => {
      links.classList.toggle('active');
      toggle.classList.toggle('active');
    });
  }
}

// ============================================================================
// Intersection Observer Animations
// ============================================================================

function initScrollAnimations() {
  const observerOptions = {
    threshold: 0.1,
    rootMargin: '0px 0px -50px 0px'
  };

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('animate-in');
        observer.unobserve(entry.target);
      }
    });
  }, observerOptions);

  // Observe elements
  document.querySelectorAll('.feature-card, .flow-step, .resource-card, .token-card').forEach(el => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(20px)';
    el.style.transition = 'opacity 0.6s ease-out, transform 0.6s ease-out';
    observer.observe(el);
  });
}

// Add animate-in class styles
const style = document.createElement('style');
style.textContent = `
  .animate-in {
    opacity: 1 !important;
    transform: translateY(0) !important;
  }
`;
document.head.appendChild(style);

// ============================================================================
// Typing Animation for Hero
// ============================================================================

function initTypingAnimation() {
  const codeContent = document.querySelector('.hero-visual .code-content code');
  if (!codeContent) return;

  const originalHTML = codeContent.innerHTML;
  const lines = originalHTML.split('\n');
  
  codeContent.innerHTML = '';
  
  let lineIndex = 0;
  let charIndex = 0;
  let currentLine = '';
  
  function typeNextChar() {
    if (lineIndex >= lines.length) {
      return;
    }
    
    const line = lines[lineIndex];
    
    if (charIndex < line.length) {
      currentLine += line[charIndex];
      charIndex++;
    } else {
      currentLine += '\n';
      lineIndex++;
      charIndex = 0;
    }
    
    // Rebuild all typed lines
    let displayHTML = '';
    for (let i = 0; i < lineIndex; i++) {
      displayHTML += lines[i] + '\n';
    }
    displayHTML += currentLine.split('\n').pop();
    
    codeContent.innerHTML = displayHTML;
    
    // Speed varies
    const delay = line[charIndex - 1] === '\n' ? 100 : Math.random() * 20 + 10;
    
    if (lineIndex < lines.length) {
      setTimeout(typeNextChar, delay);
    } else {
      // Restore original with syntax highlighting after typing
      setTimeout(() => {
        codeContent.innerHTML = originalHTML;
      }, 500);
    }
  }
  
  // Start typing after a delay
  setTimeout(typeNextChar, 1000);
}

// ============================================================================
// Particle Effect (Optional Enhancement)
// ============================================================================

function initParticles() {
  const canvas = document.createElement('canvas');
  canvas.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 0;
  `;
  document.body.insertBefore(canvas, document.body.firstChild);

  const ctx = canvas.getContext('2d');
  let particles = [];
  
  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  
  resize();
  window.addEventListener('resize', resize);

  class Particle {
    constructor() {
      this.reset();
    }
    
    reset() {
      this.x = Math.random() * canvas.width;
      this.y = Math.random() * canvas.height;
      this.vx = (Math.random() - 0.5) * 0.3;
      this.vy = (Math.random() - 0.5) * 0.3;
      this.size = Math.random() * 2 + 0.5;
      this.alpha = Math.random() * 0.5 + 0.1;
    }
    
    update() {
      this.x += this.vx;
      this.y += this.vy;
      
      if (this.x < 0 || this.x > canvas.width || this.y < 0 || this.y > canvas.height) {
        this.reset();
      }
    }
    
    draw() {
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(0, 240, 255, ${this.alpha})`;
      ctx.fill();
    }
  }
  
  // Create particles
  for (let i = 0; i < 50; i++) {
    particles.push(new Particle());
  }
  
  function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    particles.forEach(p => {
      p.update();
      p.draw();
    });
    
    // Draw connections
    particles.forEach((p1, i) => {
      particles.slice(i + 1).forEach(p2 => {
        const dx = p1.x - p2.x;
        const dy = p1.y - p2.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        if (dist < 150) {
          ctx.beginPath();
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.strokeStyle = `rgba(0, 240, 255, ${0.1 * (1 - dist / 150)})`;
          ctx.stroke();
        }
      });
    });
    
    requestAnimationFrame(animate);
  }
  
  animate();
}

// ============================================================================
// Theme Toggle
// ============================================================================

function initThemeToggle() {
  const toggle = document.querySelector('.theme-toggle');
  if (!toggle) return;

  const STORAGE_KEY = 'x402-theme';

  function getPreferredTheme() {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return stored;
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }

  function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(STORAGE_KEY, theme);
  }

  // Apply saved or system theme on load
  setTheme(getPreferredTheme());

  // Toggle on click
  toggle.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme');
    setTheme(current === 'light' ? 'dark' : 'light');
  });

  // Listen for system preference changes
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', (e) => {
    if (!localStorage.getItem(STORAGE_KEY)) {
      setTheme(e.matches ? 'light' : 'dark');
    }
  });
}

// ============================================================================
// Initialize Everything
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
  initThemeToggle();
  initDemoTabs();
  initCopyButtons();
  initSmoothScroll();
  initNavScrollEffect();
  initMobileNav();
  initScrollAnimations();
  initParticles();

  // Typing animation disabled by default (can be uncommented)
  // initTypingAnimation();
});

// Add staggered animation delays for feature cards
document.querySelectorAll('.feature-card').forEach((card, index) => {
  card.style.transitionDelay = `${index * 0.1}s`;
});

document.querySelectorAll('.flow-step').forEach((step, index) => {
  step.style.transitionDelay = `${index * 0.15}s`;
});

document.querySelectorAll('.token-card').forEach((card, index) => {
  card.style.transitionDelay = `${index * 0.1}s`;
});

document.querySelectorAll('.resource-card').forEach((card, index) => {
  card.style.transitionDelay = `${index * 0.1}s`;
});
