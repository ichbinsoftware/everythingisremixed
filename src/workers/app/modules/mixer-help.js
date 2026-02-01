// ==========================================
// Mixer Help System
// Desktop: Modal | Mobile: Bottom Sheet
// ==========================================

import { renderHelpModal } from './mixer-templates.js';

export class HelpController {
  constructor() {
    this.isOpen = false;
    this.isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
      || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    this.activeTab = 'controls';
    this.modal = null;
    this.backdrop = null;
    this.startY = 0;
    this.currentY = 0;
    this.isDragging = false;
  }

  init() {
    this.createModal();
    this.bindEvents();
  }

  createModal() {
    // Create backdrop
    this.backdrop = document.createElement('div');
    this.backdrop.className = 'help-backdrop';
    this.backdrop.id = 'helpBackdrop';

    // Create modal (works as both modal and bottom sheet via CSS)
    this.modal = document.createElement('div');
    this.modal.className = 'help-modal';
    this.modal.id = 'helpModal';
    this.modal.innerHTML = renderHelpModal();

    this.backdrop.appendChild(this.modal);
    document.body.appendChild(this.backdrop);
  }

  bindEvents() {
    // Help button in header
    const helpBtn = document.getElementById('helpBtn');
    if (helpBtn) {
      helpBtn.addEventListener('click', () => this.toggle());
    }

    // Close button
    const closeBtn = document.getElementById('helpClose');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.close());
    }

    // Dismiss button
    const dismissBtn = document.getElementById('helpDismiss');
    if (dismissBtn) {
      dismissBtn.addEventListener('click', () => this.close());
    }

    // Backdrop click
    this.backdrop.addEventListener('click', (e) => {
      if (e.target === this.backdrop) {
        this.close();
      }
    });

    // Tab switching
    const tabs = this.modal.querySelectorAll('.help-tab');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => this.switchTab(tab.dataset.tab));
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.key === '?' && !this.isInputFocused()) {
        e.preventDefault();
        this.toggle();
      }
      if (e.key === 'Escape' && this.isOpen) {
        this.close();
      }
    });

    // Mobile swipe to dismiss
    if (this.isMobile) {
      this.bindSwipeEvents();
    }
  }

  bindSwipeEvents() {
    const handle = this.modal.querySelector('.help-handle');
    const modal = this.modal;

    const onStart = (e) => {
      this.isDragging = true;
      this.startY = e.touches ? e.touches[0].clientY : e.clientY;
      this.currentY = 0;
      modal.style.transition = 'none';
    };

    const onMove = (e) => {
      if (!this.isDragging) return;
      const y = e.touches ? e.touches[0].clientY : e.clientY;
      this.currentY = Math.max(0, y - this.startY);
      modal.style.transform = `translateY(${this.currentY}px)`;
    };

    const onEnd = () => {
      if (!this.isDragging) return;
      this.isDragging = false;
      modal.style.transition = '';

      if (this.currentY > 100) {
        this.close();
      } else {
        modal.style.transform = '';
      }
    };

    handle.addEventListener('touchstart', onStart, { passive: true });
    handle.addEventListener('mousedown', onStart);
    document.addEventListener('touchmove', onMove, { passive: true });
    document.addEventListener('mousemove', onMove);
    document.addEventListener('touchend', onEnd);
    document.addEventListener('mouseup', onEnd);
  }

  switchTab(tabId) {
    this.activeTab = tabId;

    // Update tab buttons
    this.modal.querySelectorAll('.help-tab').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.tab === tabId);
    });

    // Update tab content
    this.modal.querySelectorAll('.help-tab-content').forEach(content => {
      content.classList.toggle('active', content.dataset.tab === tabId);
    });
  }

  toggle() {
    this.isOpen ? this.close() : this.open();
  }

  open() {
    this.isOpen = true;
    this.backdrop.classList.add('active');
    this.modal.style.transform = '';
    document.body.style.overflow = 'hidden';
  }

  close() {
    this.isOpen = false;
    this.backdrop.classList.remove('active');
    document.body.style.overflow = '';
  }

  isInputFocused() {
    const el = document.activeElement;
    return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');
  }
}
