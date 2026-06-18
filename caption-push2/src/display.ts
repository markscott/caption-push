import type { CaptionStyle, ChannelMessage } from './types.js';
import { onMessage, sendMessage } from './channel.js';

const STAGE_W = 1920;
const STAGE_H = 360;

export function initDisplay(displayId: number): void {
  document.title = `Display ${displayId} — Caption Push 2`;

  const styleEl = document.createElement('style');
  styleEl.textContent = `
    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; background: #000; overflow: hidden; }
    #root {
      width: 100vw;
      height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #000;
      overflow: hidden;
    }
    /* Fixed 1920×360 reference stage — JS scales it to fit the viewport */
    #caption-stage {
      width: ${STAGE_W}px;
      height: ${STAGE_H}px;
      display: flex;
      align-items: center;
      flex-shrink: 0;
      transform-origin: center center;
      overflow: hidden;
      background: #000;
    }
    #caption-wrapper { width: 100%; padding: 2rem 3rem; overflow: hidden; }
    #caption-text {
      display: block;
      font-size: 2rem;
      text-align: center;
      font-family: sans-serif;
      color: #2a2a2a;
      line-height: 1.25;
      word-break: break-word;
      white-space: pre-wrap;
    }
    #hud {
      position: fixed;
      bottom: 0.75rem;
      right: 0.75rem;
      color: #1e1e1e;
      font-size: 0.65rem;
      font-family: monospace;
      user-select: none;
    }
  `;
  document.head.appendChild(styleEl);

  document.body.innerHTML = `
    <div id="root">
      <div id="caption-stage">
        <div id="caption-wrapper">
          <div id="caption-text">Display ${displayId} — Waiting for captions…</div>
        </div>
      </div>
    </div>
    <div id="hud">Display ${displayId} &nbsp;·&nbsp; F = fullscreen</div>
  `;

  const captionStage = document.getElementById('caption-stage')!;
  const captionText  = document.getElementById('caption-text')!;
  const wrapper      = document.getElementById('caption-wrapper')!;

  // Scale the fixed 1920×360 stage to fill the viewport while locking aspect ratio.
  function rescaleStage(): void {
    const scale = Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H);
    captionStage.style.transform = `scale(${scale})`;
  }
  window.addEventListener('resize', rescaleStage);
  rescaleStage();

  let scrollRafId: number | null = null;
  let autoClearTimer: ReturnType<typeof setTimeout> | null = null;

  function stopScroll(): void {
    if (scrollRafId !== null) {
      cancelAnimationFrame(scrollRafId);
      scrollRafId = null;
    }
    if (autoClearTimer !== null) {
      clearTimeout(autoClearTimer);
      autoClearTimer = null;
    }
    captionText.style.transform = '';
    captionText.style.whiteSpace = 'pre-wrap';
    captionText.style.display = 'block';
  }

  // startTime is the push timestamp from the channel message — both the
  // display window and the operator's NOW SHOWING sim use the same value so
  // their scroll animations are frame-locked together.
  function showCaption(text: string, s: CaptionStyle, hold = false, startTime = Date.now()): void {
    stopScroll();

    captionStage.style.backgroundColor = s.backgroundColor;
    captionText.style.fontSize = `${s.fontSize}px`;
    captionText.style.fontFamily = s.fontFamily;
    captionText.style.color = s.color;
    captionText.style.textAlign = s.textAlign;

    if (s.displayMode === 'fade') {
      captionText.style.transition = 'opacity 0.15s ease';
      captionText.style.opacity = '0';
      requestAnimationFrame(() => requestAnimationFrame(() => {
        captionText.textContent = text;
        captionText.style.opacity = '1';
      }));
      if (!hold) autoClearTimer = setTimeout(clearDisplay, 7000);
    } else if (s.displayMode === 'scroll') {
      captionText.style.transition = '';
      captionText.style.opacity = '1';
      captionText.textContent = text;
      captionText.style.whiteSpace = 'nowrap';
      captionText.style.display = 'inline-block';
      captionText.style.transform = 'translateX(0)';

      // Measure natural text width with a position:fixed probe outside any
      // overflow:hidden ancestor — Firefox constrains offsetWidth of inline-block
      // elements to the nearest overflow:hidden BFC, so we can't use captionText
      // directly even after clearing wrapper.overflow.
      const probe = document.createElement('span');
      probe.style.cssText = `position:fixed;top:-9999px;left:-9999px;white-space:nowrap;visibility:hidden;font-size:${s.fontSize}px;font-family:${s.fontFamily}`;
      probe.textContent = text;
      document.body.appendChild(probe);
      const textW = probe.offsetWidth;
      document.body.removeChild(probe);

      const contentW = STAGE_W - 96;

      if (textW <= contentW) {
        // Text fits — static display
        captionText.style.whiteSpace = 'pre-wrap';
        captionText.style.display = 'block';
        captionText.style.transform = '';
        if (!hold) autoClearTimer = setTimeout(clearDisplay, 7000);
      } else {
        // Text overflows: 1s start hold → scroll → 5s end hold → (loop if hold, else clear)
        const overflowPx = textW - contentW + 40;
        const scrollDuration = overflowPx / s.scrollSpeed;
        const phaseDuration = 1.0 + scrollDuration + 5.0;

        function tick(): void {
          const elapsed = (Date.now() - startTime) / 1000;
          const phase = hold ? elapsed % phaseDuration : elapsed;

          if (phase >= phaseDuration) {
            clearDisplay();
            return;
          }
          if (phase < 1.0) {
            captionText.style.transform = 'translateX(0)';
          } else if (phase < 1.0 + scrollDuration) {
            const scrolled = Math.min((phase - 1.0) * s.scrollSpeed, overflowPx);
            captionText.style.transform = `translateX(${-scrolled}px)`;
          } else {
            captionText.style.transform = `translateX(${-overflowPx}px)`;
          }
          scrollRafId = requestAnimationFrame(tick);
        }
        scrollRafId = requestAnimationFrame(tick);
      }
    } else {
      captionText.style.transition = '';
      captionText.style.opacity = '1';
      captionText.textContent = text;
      if (!hold) autoClearTimer = setTimeout(clearDisplay, 7000);
    }
  }

  function clearDisplay(): void {
    stopScroll();
    captionText.style.transition = '';
    captionStage.style.backgroundColor = '#000';
    captionText.style.fontSize = '2rem';
    captionText.style.fontFamily = 'sans-serif';
    captionText.style.color = '#2a2a2a';
    captionText.style.textAlign = 'center';
    captionText.style.whiteSpace = 'pre-wrap';
    captionText.style.opacity = '1';
    captionText.textContent = `Display ${displayId} — Waiting for captions…`;
  }

  function targetsMe(targets: number[] | 'all'): boolean {
    return targets === 'all' || targets.includes(displayId);
  }

  onMessage((msg: ChannelMessage) => {
    switch (msg.type) {
      case 'PUSH_CAPTION':
        if (targetsMe(msg.targets)) {
          showCaption(msg.text, msg.style, msg.hold ?? false, msg.timestamp);
        }
        break;
      case 'CLEAR':
        if (targetsMe(msg.targets)) clearDisplay();
        break;
      case 'BRIGHTNESS':
        if (targetsMe(msg.targets)) {
          document.documentElement.style.filter = msg.level < 100 ? `brightness(${msg.level}%)` : '';
        }
        break;
      case 'HEARTBEAT_REQ':
        sendMessage({ type: 'HEARTBEAT', displayId });
        break;
    }
  });

  function heartbeat(): void {
    sendMessage({ type: 'HEARTBEAT', displayId });
  }

  heartbeat();
  setInterval(heartbeat, 3000);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'f' || e.key === 'F') {
      const el = document.documentElement as HTMLElement & {
        webkitRequestFullscreen?: () => Promise<void>;
      };
      const doc = document as Document & {
        webkitFullscreenElement?: Element;
        webkitExitFullscreen?: () => Promise<void>;
      };
      const isFs = document.fullscreenElement || doc.webkitFullscreenElement;
      if (!isFs) {
        (el.requestFullscreen?.() ?? el.webkitRequestFullscreen?.())?.catch(() => undefined);
      } else {
        (document.exitFullscreen?.() ?? doc.webkitExitFullscreen?.())?.catch(() => undefined);
      }
    }
  });
}
