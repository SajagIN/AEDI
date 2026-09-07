import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { gsap } from "gsap";

/*  StrokeText — adapted from React Bits
 *
 *  Two changes.
 *
 *  The original takes a fixed `fontSize` and gives its <svg> a fixed pixel
 *  height while letting the width run to 100%. With `meet`, a narrow viewport
 *  scales the glyphs down but the reserved height stays put, so the wordmark
 *  floats in a growing pocket of dead space. Here the type size is derived
 *  from the measured container width, which is what a display line on a
 *  fluid page actually needs.
 *
 *  ScrollTrigger is gone. The one place this is used draws on mount, and
 *  pulling in a second gsap plugin to support a trigger nothing calls is
 *  weight for nothing.
 */

export interface StrokeTextProps {
  text: string;
  strokeColor?: string;
  fillColor?: string;
  strokeWidth?: number;
  drawDuration?: number;
  fillDelay?: number;
  stagger?: number;
  ease?: string;
  fillMode?: "wipe" | "fade" | "none";
  /** SVG text inherits the page face unless told otherwise. */
  fontFamily?: string;
  minFontSize?: number;
  maxFontSize?: number;
  fontWeight?: number | string;
  letterSpacing?: number;
  className?: string;
  style?: CSSProperties;
}

interface Box { x: number; y: number; width: number; height: number }

export default function StrokeText({
  text,
  strokeColor = "#0071E3",
  fillColor = "hsl(var(--foreground))",
  strokeWidth = 1,
  drawDuration = 1.4,
  fillDelay = 0.1,
  stagger = 0.045,
  ease = "power2.out",
  fillMode = "wipe",
  fontFamily = "inherit",
  minFontSize = 40,
  maxFontSize = 132,
  fontWeight = 600,
  letterSpacing = -2,
  className = "",
  style = {},
}: StrokeTextProps) {
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const strokeTextRef = useRef<SVGTextElement | null>(null);
  const wipeRectRef = useRef<SVGRectElement | null>(null);

  const [box, setBox] = useState<Box | null>(null);
  const [fontSize, setFontSize] = useState(minFontSize);

  const rawId = useId();
  const wipeId = `stroke-${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const characters = useMemo(() => Array.from(String(text ?? "")), [text]);
  const dash = Math.max(fontSize * 7, 200);

  const fontStyle = useMemo<CSSProperties>(
    () => ({ fontFamily, fontSize: `${fontSize}px`, fontWeight, letterSpacing: `${letterSpacing}px` }),
    [fontFamily, fontSize, fontWeight, letterSpacing],
  );

  /* Size the type to the box it is in, rather than reserving a fixed height
     and letting the glyphs rattle around inside it.

     This used to multiply the character count by a hand-tuned em value, which
     is only right for the one typeface it was eyeballed against — swap the
     display face and the wordmark overflows or shrinks. getComputedTextLength
     reports the advance width the browser actually laid out, so the ratio is
     measured off the rendered glyphs instead of assumed. Width scales linearly
     with font-size, so a single correction converges, and the 1.5% tolerance
     stops it hunting between two adjacent integers. */
  useLayoutEffect(() => {
    const root = rootRef.current;
    const node = strokeTextRef.current;
    if (!root || !node) return;
    const fit = () => {
      const boxWidth = root.offsetWidth;
      if (!boxWidth) return;
      let laidOut = 0;
      try { laidOut = node.getComputedTextLength(); } catch { return; }
      if (!laidOut) return;
      const perPixel = laidOut / fontSize;
      const want = Math.round(Math.min(maxFontSize, Math.max(minFontSize, boxWidth / perPixel)));
      if (Math.abs(want - fontSize) / Math.max(fontSize, 1) > 0.015) setFontSize(want);
    };
    fit();
    document.fonts?.ready.then(fit).catch(() => {});
    const ro = new ResizeObserver(fit);
    ro.observe(root);
    return () => ro.disconnect();
  }, [characters.length, fontSize, minFontSize, maxFontSize]);

  useLayoutEffect(() => {
    let cancelled = false;
    const measure = () => {
      if (cancelled || !strokeTextRef.current) return;
      let bbox: DOMRect | undefined;
      try { bbox = strokeTextRef.current.getBBox(); } catch { return; }
      if (!bbox || !bbox.width) return;
      /* Vertical padding keeps ascenders and descenders off the edge. The
         horizontal pad is the stroke's own overhang and nothing more — pad the
         sides by a tenth of the font size and, left-aligned, the word visibly
         starts inboard of everything beneath it. */
      const padX = strokeWidth;
      const padY = fontSize * 0.1;
      const next = { x: bbox.x - padX, y: bbox.y - padY, width: bbox.width + padX * 2, height: bbox.height + padY * 2 };
      setBox((prev) =>
        prev && Math.abs(prev.x - next.x) < 0.5 && Math.abs(prev.width - next.width) < 0.5 && Math.abs(prev.y - next.y) < 0.5
          ? prev : next,
      );
    };
    measure();
    document.fonts?.ready.then(measure).catch(() => {});
    return () => { cancelled = true; };
  }, [characters, fontFamily, fontSize, fontWeight, letterSpacing, strokeWidth]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || !box) return;

    const strokes = gsap.utils.toArray<SVGTSpanElement>(root.querySelectorAll("[data-stroke-char]"));
    const fills = gsap.utils.toArray<SVGTSpanElement>(root.querySelectorAll("[data-fill-char]"));
    const wipe = wipeRectRef.current;
    if (!strokes.length) return;

    const useWipe = fillMode === "wipe";
    const fillEnabled = fillMode !== "none";
    const targets = [...strokes, ...fills, wipe].filter(Boolean) as object[];

    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      gsap.set(strokes, { strokeDasharray: dash, strokeDashoffset: 0 });
      gsap.set(fills, { opacity: fillEnabled ? 1 : 0 });
      if (wipe) gsap.set(wipe, { attr: { width: fillEnabled ? box.width : 0 } });
      return () => gsap.killTweensOf(targets);
    }

    gsap.killTweensOf(targets);
    gsap.set(strokes, { strokeDasharray: dash, strokeDashoffset: dash });
    gsap.set(fills, { opacity: useWipe ? 1 : 0 });
    if (wipe) gsap.set(wipe, { attr: { width: 0 } });

    const tl = gsap.timeline({ defaults: { overwrite: "auto" } });
    tl.to(strokes, { strokeDashoffset: 0, duration: drawDuration, ease, stagger }, 0);
    if (useWipe && wipe) {
      tl.to(wipe, { attr: { width: box.width }, duration: Math.max(0.4, drawDuration * 0.5), ease: "power2.inOut" }, drawDuration + fillDelay);
    } else if (fillEnabled) {
      tl.to(fills, { opacity: 1, duration: Math.max(0.4, drawDuration * 0.5), ease: "power2.out", stagger }, drawDuration + fillDelay);
    }

    return () => { tl.kill(); gsap.killTweensOf(targets); };
  }, [box, dash, drawDuration, fillDelay, stagger, ease, fillMode]);

  const viewBox = box ? `${box.x} ${box.y} ${box.width} ${box.height}` : `0 ${-fontSize} 600 ${fontSize * 1.3}`;

  return (
    <span
      ref={rootRef}
      className={`block w-full leading-[0] ${className}`.trim()}
      style={style}
      role="img"
      aria-label={String(text ?? "")}
    >
      <svg
        className="block w-full"
        style={{ height: `${Math.round(fontSize * 1.22)}px` }}
        viewBox={viewBox}
        preserveAspectRatio="xMinYMid meet"
        aria-hidden="true"
      >
        {fillMode === "wipe" && box && (
          <defs>
            <clipPath id={wipeId} clipPathUnits="userSpaceOnUse">
              <rect ref={wipeRectRef} x={box.x} y={box.y} width="0" height={box.height} />
            </clipPath>
          </defs>
        )}
        <text ref={strokeTextRef} className="select-none" x="0" y="0" fill="none"
          stroke={strokeColor} strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" style={fontStyle}>
          {characters.map((c, i) => <tspan data-stroke-char key={`s-${i}`}>{c}</tspan>)}
        </text>
        <text className="select-none" x="0" y="0" fill={fillColor} stroke="none" style={fontStyle}
          clipPath={fillMode === "wipe" && box ? `url(#${wipeId})` : undefined}>
          {characters.map((c, i) => <tspan data-fill-char key={`f-${i}`}>{c}</tspan>)}
        </text>
      </svg>
    </span>
  );
}
