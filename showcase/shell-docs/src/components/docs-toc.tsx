"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { TocHeading } from "@/lib/toc";

export interface DocsTocProps {
  headings: TocHeading[];
}

interface IndicatorState {
  top: number;
  height: number;
  visible: boolean;
}

// useLayoutEffect on the server warns; swap to useEffect during SSR.
const useIsoLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

// Right-rail TOC. Hidden below xl (1280px) because the main column
// already fills most of the viewport at laptop widths. Above that, it
// sits beside the content with a scrollspy-highlighted active link.
//
// A single absolutely-positioned indicator slides between active items
// (220ms ease) instead of each item drawing its own border. This mirrors
// canonical fumadocs' `#nd-toc` behavior.
export function DocsToc({ headings }: DocsTocProps) {
  const [activeSlug, setActiveSlug] = useState<string | null>(
    headings[0]?.slug ?? null,
  );
  const [indicator, setIndicator] = useState<IndicatorState>({
    top: 0,
    height: 0,
    visible: false,
  });
  const navRef = useRef<HTMLElement | null>(null);
  const linkRefs = useRef<Map<string, HTMLAnchorElement>>(new Map());

  useEffect(() => {
    if (headings.length === 0) return;

    const targets = headings
      .map((h) => document.getElementById(h.slug))
      .filter((el): el is HTMLElement => el !== null);
    if (targets.length === 0) return;

    // Mark a heading active once its top crosses ~20% from the top of
    // the viewport. `-20% 0px -70% 0px` creates a narrow "active band"
    // near the top so a heading activates as it scrolls into reading
    // position, not when it merely enters the viewport from the bottom.
    const observer = new IntersectionObserver(
      (entries) => {
        const intersecting = entries.filter((e) => e.isIntersecting);
        if (intersecting.length === 0) return;
        intersecting.sort(
          (a, b) => a.boundingClientRect.top - b.boundingClientRect.top,
        );
        setActiveSlug(intersecting[0].target.id);
      },
      { rootMargin: "-20% 0px -70% 0px", threshold: 0 },
    );

    targets.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [headings]);

  // Recompute indicator geometry whenever the active item changes, the
  // nav resizes, or fonts finish loading (which can shift line heights
  // after first paint).
  useIsoLayoutEffect(() => {
    if (!activeSlug) {
      setIndicator((s) => ({ ...s, visible: false }));
      return;
    }
    const nav = navRef.current;
    const link = linkRefs.current.get(activeSlug);
    if (!nav || !link) return;

    const measure = () => {
      const navRect = nav.getBoundingClientRect();
      const linkRect = link.getBoundingClientRect();
      setIndicator({
        top: linkRect.top - navRect.top,
        height: linkRect.height,
        visible: true,
      });
    };

    measure();

    const ro = new ResizeObserver(measure);
    ro.observe(nav);

    if (typeof document !== "undefined" && document.fonts?.ready) {
      document.fonts.ready.then(measure).catch(() => {});
    }

    return () => ro.disconnect();
  }, [activeSlug, headings]);

  if (headings.length === 0) return null;

  return (
    <aside className="hidden xl:block w-[220px] shrink-0 sticky top-[88px] xl:top-[112px] self-start max-h-[calc(100vh-88px)] xl:max-h-[calc(100vh-112px)] overflow-y-auto py-8 pl-6 pr-4">
      <div className="text-[13px] font-medium text-[var(--text-secondary)] mb-3">
        On this page
      </div>
      <nav
        ref={navRef}
        className="relative flex flex-col text-[13px] leading-[1.55]"
      >
        {/* Single sliding indicator. Color matches canonical's
         * `--color-fd-primary` (a softer violet than our --accent). */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-0 w-[2px] rounded-[1px]"
          style={{
            top: indicator.top,
            height: indicator.height,
            opacity: indicator.visible ? 1 : 0,
            background: "#7076D5",
            transition:
              "top 220ms cubic-bezier(0.4,0,0.2,1), height 220ms cubic-bezier(0.4,0,0.2,1), opacity 120ms ease",
          }}
        />
        {headings.map((h) => {
          const isActive = activeSlug === h.slug;
          const isNested = h.depth === 3;
          return (
            <a
              key={h.slug}
              ref={(el) => {
                if (el) linkRefs.current.set(h.slug, el);
                else linkRefs.current.delete(h.slug);
              }}
              href={`#${h.slug}`}
              // Sync the highlight immediately on click. The
              // IntersectionObserver can't take over here because the
              // anchor jump lands the target above the active band
              // (which starts ~20% from the top of the viewport), so
              // no intersection fires and the last-active slug would
              // otherwise stay selected.
              onClick={() => setActiveSlug(h.slug)}
              className={`block py-1.5 transition-opacity ${
                isNested ? "pl-6 ml-3" : "pl-3"
              } text-[var(--text)] ${
                isActive
                  ? "font-medium opacity-100"
                  : "opacity-60 hover:opacity-90"
              }`}
            >
              {h.text}
            </a>
          );
        })}
      </nav>
    </aside>
  );
}
