import type { Attachment } from "svelte/attachments";

/**
 * {@attach selectPortal(triggerEl)}
 *
 * Moves the decorated element to <body> and positions it below `triggerEl`.
 * The element stays reactive — Svelte still owns its DOM, we just re-parent it.
 *
 * The portalled menu element is stored on `triggerEl.__selectMenuEl` so that
 * the outside-click guard in Settings.svelte can exclude it from dismissal.
 */
export function selectPortal(triggerEl: HTMLElement & { __selectMenuEl?: HTMLElement | null }): Attachment {
  return (menuEl: HTMLElement) => {
    // Position & move to body
    function position() {
      const r = triggerEl.getBoundingClientRect();
      menuEl.style.position = "fixed";
      menuEl.style.top      = `${r.bottom + 4}px`;
      menuEl.style.left     = `${r.right - menuEl.offsetWidth}px`;
      // clamp to viewport left edge
      const left = parseFloat(menuEl.style.left);
      if (left < 8) menuEl.style.left = "8px";
    }

    document.body.appendChild(menuEl);
    triggerEl.__selectMenuEl = menuEl;
    position();

    // Reposition on scroll / resize while open
    window.addEventListener("scroll", position, true);
    window.addEventListener("resize", position);

    return () => {
      window.removeEventListener("scroll", position, true);
      window.removeEventListener("resize", position);
      triggerEl.__selectMenuEl = null;
      menuEl.remove();
    };
  };
}