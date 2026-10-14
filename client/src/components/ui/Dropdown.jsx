import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const GAP = 6;
const EDGE = 8;

/**
 * A simple menu that closes on outside click, Escape, scroll or resize.
 * The menu is portalled to <body> with fixed positioning so scrolling
 * containers (tables, cards) never clip it; it flips above the trigger
 * when there is no room below.
 */
export function Dropdown({ trigger, children, align = 'right' }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState(null);
  const ref = useRef(null);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const inside = (target) => (ref.current && ref.current.contains(target)) || (menuRef.current && menuRef.current.contains(target));
    const onDown = (e) => !inside(e.target) && setOpen(false);
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    const onScroll = (e) => !(menuRef.current && menuRef.current.contains(e.target)) && setOpen(false);
    const onResize = () => setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return undefined;
    }
    const place = () => {
      const anchor = ref.current && ref.current.getBoundingClientRect();
      const menu = menuRef.current && menuRef.current.getBoundingClientRect();
      if (!anchor || !menu) return;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let left = align === 'left' ? anchor.left : anchor.right - menu.width;
      left = Math.max(EDGE, Math.min(left, vw - menu.width - EDGE));
      const below = anchor.bottom + GAP;
      const fitsBelow = below + menu.height <= vh - EDGE;
      const top = fitsBelow ? below : Math.max(EDGE, anchor.top - GAP - menu.height);
      setPosition({ top, left });
    };
    place();
    // Menus whose content loads after opening (notifications) change size.
    if (typeof ResizeObserver === 'undefined' || !menuRef.current) return undefined;
    const observer = new ResizeObserver(place);
    observer.observe(menuRef.current);
    return () => observer.disconnect();
  }, [open, align]);

  return (
    <div className="dropdown" ref={ref}>
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      {open && createPortal(
        <div
          ref={menuRef}
          className="dropdown-menu"
          role="menu"
          style={position ? { top: position.top, left: position.left } : { top: 0, left: 0, visibility: 'hidden' }}
          onClick={() => setOpen(false)}
        >
          {children}
        </div>,
        document.body,
      )}
    </div>
  );
}
