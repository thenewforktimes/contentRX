"use client";

/**
 * HowItWorksDiagram — "the model around the model", v10.
 *
 * Ported from the Claude-design handoff (design_handoff_how_it_works/):
 * a two-column story — a clickable step rail on the left, a single
 * dark stage on the right that crossfades between five purpose-built
 * visuals as autoplay (or a click) advances the steps.
 *
 * Structure + motion are ported faithfully from the handoff:
 *   - Frames 1+2: a <canvas> of converging particle streams; the
 *     `narrow` value tweens from "every rule" to "the few that do".
 *   - Frames 3/4/5: composed cards that reveal in sequence.
 *   - Autoplay with a progress bar, pause-on-hover, click-to-jump.
 *
 * Content is OURS, not the handoff's. The handoff frames 3/4/5 shipped
 * the scorecard/threshold/`rule:` mechanics and a fabricated audit
 * receipt (invented model version, commit, latency, and a
 * `github.com/contentrx/judgments` repo that does not exist and would
 * violate ADR 2026-04-25). All of that is replaced with the locked
 * value-forward copy: the verdict + plain observations (frame 3), the
 * sharper line and the reason (frame 4), and the real published-
 * accuracy moat linking /accuracy (frame 5). The README explicitly
 * says the copy is meant to be swapped on port.
 *
 * Tokens: the handoff's raw navy/mint/butter palette is mapped onto
 * the app's semantic AAA tokens. The canvas reads the affirm token
 * from CSS custom properties at runtime so it stays themed.
 *
 * Boundaries kept: substrate-safe (no standard_id, rule version,
 * taxonomy-axis vocabulary, scores, or fabricated infra); voice-clean;
 * the section's eyebrow + "The model around the model." h2 + intro are
 * owned by the page (src/app/(marketing)/page.tsx), so this component
 * is the grid + the closer only — no duplicate heading.
 *
 * Accessibility:
 *   - The rail is real <button>s carrying the full story (title +
 *     body); it is the semantic interface, with focus rings and
 *     aria-current.
 *   - The stage is decorative (aria-hidden).
 *   - The closer carries the /accuracy link, reachable and not
 *     aria-hidden (CLAUDE.md non-negotiable: an accuracy claim links
 *     to /accuracy).
 *   - prefers-reduced-motion: no autoplay, no canvas RAF (one static
 *     frame), no typewriter/cascade (full content immediately), no
 *     scanline. The rail still advances on click.
 */

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pill } from "@/components/ui/pill";

type Step = { n: number; title: string; body: string };

// Rail copy — the locked value-forward arc.
const STEPS: ReadonlyArray<Step> = [
  {
    n: 1,
    title: "Every line your codebase ships",
    body: "Product writing, PRs, READMEs, and internal and external comms. All read in context, right where you build and ship.",
  },
  {
    n: 2,
    title: "Clearer communication, faster.",
    body: "Match the clarity of your ideas with the clarity of your writing, all of it.",
  },
  {
    n: 3,
    title: "Your whole team, elevated.",
    body: "Context-aware writing and editing for every corner of your org.",
  },
  {
    n: 4,
    title: "The sharper line, and why.",
    body: "ContentRX does the hard work. You focus on faster reviews and less back and forth.",
  },
  {
    n: 5,
    title: "Not just a tool. An agent.",
    body: "More than a writing and editing tool. A deterministic agent catches drift on a cadence and keeps your prose consistent, without burning a token.",
  },
];

// Stage top-right phase labels — value framing, not "SCORE".
const PHASE_LABELS = [
  "IN YOUR REPO",
  "IN FOCUS",
  "THE CALL",
  "THE REASON",
  "THE AGENT",
] as const;

const AUTOPLAY_MS = 6800;

// Three plain observations for frame 3 — a sharp editor's read,
// specific and about the reader's experience, never a put-down or a
// score. Same error-message artifact as frame 4 and the hero, so the
// page reads as one product.
const OBSERVATIONS = [
  "A reviewer can't tell what actually changed.",
  "Nothing says why it's safe to merge.",
  "The next person reading the history learns nothing.",
] as const;

const BAD =
  "Refactored the auth flow and fixed a couple edge cases. Should be good to merge.";
const READ = "A reviewer can't tell what changed or why it's safe to merge.";
const GOOD =
  "Shorten session expiry to 30m and add a refresh-token guard. No API changes.";

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.trim().replace("#", "");
  const v =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  const int = parseInt(v || "4ade80", 16);
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
}

function usePrefersReducedMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduce(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return reduce;
}

// ---- Frame 1 + 2: converging particle streams -----------------------------
// Canvas math ported 1:1 from the handoff. `narrow` 0..1 fades the
// non-survivor streams out and brightens the few that remain. Colors
// come from the affirm token so the stage stays on-theme.
const STREAM_COUNT = 19;
const SURVIVORS = new Set([3, 6, 13]);
const SEEDS = Array.from({ length: STREAM_COUNT }, (_, i) => ({
  y0: 0.05 + (i / (STREAM_COUNT - 1)) * 0.9,
  bow: 0.32 + Math.sin(i * 1.7) * 0.2,
  speed: 0.1 + (i % 4) * 0.014,
  phase: (i * 0.37) % 1,
  survives: SURVIVORS.has(i),
}));

function StreamsCanvas({
  narrowRef,
  reduce,
}: {
  narrowRef: React.RefObject<number>;
  reduce: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, w: number, h: number, t: number) => {
      const css = getComputedStyle(document.documentElement);
      const [mr, mg, mb] = hexToRgb(
        css.getPropertyValue("--color-accent-affirm") || "#4ade80",
      );
      const [br, bg, bb] = hexToRgb(
        css.getPropertyValue("--color-accent-affirm-text") || "#86efac",
      );
      const mid = (a: number) => `rgba(${mr},${mg},${mb},${a})`;
      const bright = (a: number) => `rgba(${br},${bg},${bb},${a})`;
      const narrow = narrowRef.current ?? 0;

      // Transparent canvas over the bg-canvas container — no token
      // guesswork, stays themed.
      ctx.clearRect(0, 0, w, h);

      const fx = w * 0.78;
      const fy = h * 0.5;
      const pulse = 0.5 + 0.5 * Math.sin(t * 1.4);

      const halo = ctx.createRadialGradient(
        fx,
        fy,
        0,
        fx,
        fy,
        90 + pulse * 28,
      );
      halo.addColorStop(0, mid(0.32 + pulse * 0.12));
      halo.addColorStop(0.5, mid(0.06));
      halo.addColorStop(1, mid(0));
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(fx, fy, 120, 0, Math.PI * 2);
      ctx.fill();

      SEEDS.forEach((s) => {
        const y0 = s.y0 * h;
        const cx1 = w * 0.36;
        const cy1 = y0 + (fy - y0) * s.bow;
        const streamAlpha = s.survives
          ? 1 + narrow * 0.35
          : Math.max(0, 1 - narrow);

        const lineAlpha = s.survives
          ? 0.06 + narrow * 0.18
          : 0.06 * streamAlpha;
        ctx.strokeStyle = bright(lineAlpha);
        ctx.lineWidth = s.survives ? 1 + narrow * 0.8 : 1;
        ctx.beginPath();
        ctx.moveTo(-4, y0);
        ctx.quadraticCurveTo(cx1, cy1, fx, fy);
        ctx.stroke();

        const PARTS = 5;
        ctx.globalCompositeOperation = "lighter";
        for (let p = 0; p < PARTS; p++) {
          const u = (t * s.speed + s.phase + p / PARTS) % 1;
          const omu = 1 - u;
          const x = omu * omu * -4 + 2 * omu * u * cx1 + u * u * fx;
          const y = omu * omu * y0 + 2 * omu * u * cy1 + u * u * fy;
          const nearEnd = Math.pow(u, 1.4);
          const fadeIn = Math.min(1, u * 6);
          const fadeOut = u > 0.95 ? 1 - (u - 0.95) / 0.05 : 1;
          const alpha = fadeIn * fadeOut * (0.4 + nearEnd * 0.6) * streamAlpha;
          const r = (s.survives ? 1.1 + narrow * 0.5 : 1.1) + nearEnd * 2.3;
          const g = ctx.createRadialGradient(x, y, 0, x, y, r * 4);
          g.addColorStop(0, bright(alpha));
          g.addColorStop(0.4, mid(alpha * 0.3));
          g.addColorStop(1, mid(0));
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(x, y, r * 4, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalCompositeOperation = "source-over";

        if (s.survives) {
          const dotR = 2.4 + narrow * 2.2;
          const glow = ctx.createRadialGradient(8, y0, 0, 8, y0, dotR * 4);
          glow.addColorStop(0, bright(0.9));
          glow.addColorStop(0.4, mid(0.5 + narrow * 0.3));
          glow.addColorStop(1, mid(0));
          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(8, y0, dotR * 4, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = bright(0.95);
          ctx.beginPath();
          ctx.arc(8, y0, dotR, 0, Math.PI * 2);
          ctx.fill();
        } else {
          const a = Math.max(0, (1 - narrow) * 0.55);
          if (a > 0.01) {
            ctx.fillStyle = mid(a);
            ctx.beginPath();
            ctx.arc(8, y0, 2.2, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      });

      const coreR = 4 + pulse * 1.2 + narrow * 1.4;
      const coreG = ctx.createRadialGradient(fx, fy, 0, fx, fy, coreR * 7);
      coreG.addColorStop(0, bright(0.96));
      coreG.addColorStop(0.3, mid(0.55 + narrow * 0.2));
      coreG.addColorStop(1, mid(0));
      ctx.fillStyle = coreG;
      ctx.beginPath();
      ctx.arc(fx, fy, coreR * 7, 0, Math.PI * 2);
      ctx.fill();
    },
    [narrowRef],
  );

  const drawRef = useRef(draw);
  useEffect(() => {
    drawRef.current = draw;
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let running = true;
    let w = 0;
    let h = 0;
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const resize = () => {
      const r = canvas.getBoundingClientRect();
      w = r.width;
      h = r.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (reduce) drawRef.current(ctx, w, h, 0.6);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    if (!reduce) {
      const start = performance.now();
      const tick = (now: number) => {
        if (!running) return;
        drawRef.current(ctx, w, h, (now - start) / 1000);
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }
    return () => {
      running = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [reduce]);

  return (
    <canvas
      ref={canvasRef}
      className="block h-full w-full"
      aria-hidden
    />
  );
}

// ---- Frame 3: the call ----------------------------------------------------
function CallFrame({ active, reduce }: { active: boolean; reduce: boolean }) {
  const [phase, setPhase] = useState(reduce ? OBSERVATIONS.length + 1 : 0);
  useEffect(() => {
    if (reduce) {
      setPhase(OBSERVATIONS.length + 1);
      return;
    }
    if (!active) {
      setPhase(0);
      return;
    }
    let id: ReturnType<typeof setTimeout>;
    const step = (i: number) => {
      setPhase(i);
      if (i <= OBSERVATIONS.length) id = setTimeout(() => step(i + 1), 600);
    };
    id = setTimeout(() => step(1), 350);
    return () => clearTimeout(id);
  }, [active, reduce]);

  return (
    <div className="absolute inset-0 flex items-center justify-center p-[6%]">
      <div className="w-full max-w-[34rem] rounded-2xl border border-line bg-raised p-7 shadow-xl shadow-canvas/40">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Pill tone="amber" size="xs">
            Worth adjusting
          </Pill>
          <span className="text-[10px] font-medium uppercase tracking-[0.22em] text-quiet">
            PR description
          </span>
        </div>
        <ul className="mt-5 space-y-3">
          {OBSERVATIONS.map((o, i) => (
            <li
              key={o}
              className="flex gap-3 text-sm leading-relaxed text-default transition-all duration-500"
              style={{
                opacity: phase > i ? 1 : 0,
                transform: phase > i ? "translateY(0)" : "translateY(6px)",
              }}
            >
              <span
                aria-hidden
                className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-affirm-border"
              />
              {o}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ---- Frame 4: the sharper line, and why -----------------------------------
function ReasonFrame({ active, reduce }: { active: boolean; reduce: boolean }) {
  const [phase, setPhase] = useState(reduce ? 5 : 0);
  const [badTyped, setBadTyped] = useState(reduce ? BAD : "");
  const [goodTyped, setGoodTyped] = useState(reduce ? GOOD : "");

  useEffect(() => {
    if (reduce) {
      setPhase(5);
      setBadTyped(BAD);
      setGoodTyped(GOOD);
      return;
    }
    if (!active) {
      setPhase(0);
      setBadTyped("");
      setGoodTyped("");
      return;
    }
    const timers: Array<ReturnType<typeof setTimeout>> = [];
    const intervals: Array<ReturnType<typeof setInterval>> = [];
    timers.push(setTimeout(() => setPhase(1), 200));
    timers.push(setTimeout(() => setPhase(2), 500));
    let bi = 0;
    intervals.push(
      setInterval(() => {
        bi += 1;
        setBadTyped(BAD.slice(0, bi));
        if (bi >= BAD.length) intervals.forEach(clearInterval);
      }, 18),
    );
    timers.push(setTimeout(() => setPhase(3), 1700));
    timers.push(setTimeout(() => setPhase(4), 2100));
    timers.push(
      setTimeout(() => {
        let gi = 0;
        const gt = setInterval(() => {
          gi += 1;
          setGoodTyped(GOOD.slice(0, gi));
          if (gi >= GOOD.length) clearInterval(gt);
        }, 20);
        intervals.push(gt);
      }, 2200),
    );
    timers.push(setTimeout(() => setPhase(5), 4000));
    return () => {
      timers.forEach(clearTimeout);
      intervals.forEach(clearInterval);
    };
  }, [active, reduce]);

  const reveal = (n: number) => ({
    opacity: phase >= n ? 1 : 0,
    transform: phase >= n ? "translateY(0)" : "translateY(6px)",
    transition: "opacity 0.4s ease, transform 0.4s ease",
  });

  return (
    <div className="absolute inset-0 flex items-center justify-center p-[6%]">
      <div className="w-full max-w-[34rem] rounded-2xl border border-line bg-raised p-6 shadow-xl shadow-canvas/40">
        <div
          className="flex flex-wrap items-center justify-between gap-3"
          style={reveal(1)}
        >
          <div className="flex flex-wrap items-center gap-2.5">
            <Pill tone="amber" size="xs">
              Worth adjusting
            </Pill>
            <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-quiet">
              <span aria-hidden>⚡</span> Instant
              <span aria-hidden className="mx-1.5 text-quiet/50">
                ·
              </span>
              ✓ Before merge
            </span>
          </div>
          <span className="text-[10px] font-medium uppercase tracking-[0.22em] text-quiet">
            PR description
          </span>
        </div>

        <p
          className="mt-4 min-h-[1.4rem] text-[13px] italic leading-relaxed text-quiet"
          style={reveal(2)}
        >
          {badTyped}
        </p>
        <p
          className="mt-3 text-sm font-medium leading-relaxed text-strong"
          style={reveal(3)}
        >
          {READ}
        </p>

        <div
          className="mt-4 rounded-xl border border-accent-affirm-border/40 bg-accent-affirm-soft p-4"
          style={reveal(4)}
        >
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-accent-affirm-text">
            Suggested
          </p>
          <p className="mt-2 min-h-[1.4rem] text-[13px] leading-relaxed text-default">
            {goodTyped}
          </p>
        </div>
      </div>
    </div>
  );
}

// ---- Frame 5: the published-accuracy moat ---------------------------------
function AgentFrame({ active, reduce }: { active: boolean; reduce: boolean }) {
  const [shown, setShown] = useState(reduce);
  useEffect(() => {
    if (reduce) {
      setShown(true);
      return;
    }
    if (!active) {
      setShown(false);
      return;
    }
    const id = setTimeout(() => setShown(true), 300);
    return () => clearTimeout(id);
  }, [active, reduce]);

  return (
    <div className="absolute inset-0 flex items-center justify-center p-[6%]">
      <div
        className="w-full max-w-[34rem] rounded-2xl border border-line bg-raised p-7 shadow-xl shadow-canvas/40 transition-all duration-500"
        style={{
          opacity: shown ? 1 : 0,
          transform: shown ? "translateY(0)" : "translateY(8px)",
        }}
      >
        <span className="text-[10px] font-medium uppercase tracking-[0.22em] text-quiet">
          The agent
        </span>
        <p className="mt-3 text-lg font-semibold text-strong">
          Not just a tool. An agent.
        </p>
        <p className="mt-3 text-sm leading-relaxed text-default">
          A deterministic agent watches your repos on a cadence. It
          catches drift and keeps your prose consistent, without
          burning a token.
        </p>
        <ul className="mt-5 space-y-2 text-sm text-quiet">
          <li className="flex gap-2.5">
            <span
              aria-hidden
              className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-affirm"
            />
            Runs on its own, on the schedule you set.
          </li>
          <li className="flex gap-2.5">
            <span
              aria-hidden
              className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-affirm"
            />
            Deterministic, so it never spends a token to do it.
          </li>
        </ul>
      </div>
    </div>
  );
}

export function HowItWorksDiagram() {
  const reduce = usePrefersReducedMotion();
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const narrowRef = useRef(0);

  // Autoplay with progress. Disabled under reduced motion (click to
  // advance) and while hovered.
  useEffect(() => {
    if (reduce || paused) return;
    setProgress(0);
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / AUTOPLAY_MS);
      setProgress(p);
      if (p < 1) raf = requestAnimationFrame(tick);
      else setActive((a) => (a + 1) % STEPS.length);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, paused, reduce]);

  // narrow: frame 1 = 0; frame 2 = easeOutQuart over the first 55% of
  // the step; frames 3+ = 1. Held in a ref so the canvas rAF reads the
  // latest value without restarting.
  let narrow = 1;
  if (active === 0) narrow = 0;
  else if (active === 1) {
    const p = Math.min(1, progress / 0.55);
    narrow = 1 - Math.pow(1 - p, 4);
  }
  if (reduce) narrow = 1;
  narrowRef.current = narrow;

  return (
    <div className="my-2">
      <div
        className="grid gap-8 lg:grid-cols-[minmax(220px,300px)_1fr] lg:items-stretch lg:gap-12"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
      >
        {/* Left rail — the semantic interface */}
        <ol className="order-2 lg:order-1">
          {STEPS.map((s, i) => {
            const isActive = i === active;
            return (
              <li key={s.n}>
                <button
                  type="button"
                  onClick={() => setActive(i)}
                  aria-current={isActive ? "step" : undefined}
                  className="relative block w-full rounded-lg py-3 pl-11 pr-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
                >
                  <span
                    className={[
                      "absolute left-0 top-3 flex h-7 w-7 items-center justify-center rounded-full border text-[12px] font-semibold transition-colors duration-300",
                      isActive
                        ? "border-accent-affirm-border bg-accent-affirm text-accent-affirm-on"
                        : "border-line text-quiet",
                    ].join(" ")}
                  >
                    {s.n}
                  </span>
                  <span
                    className={[
                      "block text-base font-medium transition-colors duration-300",
                      isActive ? "text-strong" : "text-quiet",
                    ].join(" ")}
                  >
                    {s.title}
                  </span>
                  <span
                    className="block overflow-hidden text-[13px] leading-relaxed text-default transition-all duration-[450ms] ease-out"
                    style={{
                      maxHeight: isActive ? 96 : 0,
                      opacity: isActive ? 1 : 0,
                      marginTop: isActive ? 6 : 0,
                    }}
                  >
                    {s.body}
                  </span>
                </button>
              </li>
            );
          })}

          <li
            aria-hidden
            className="mt-3 flex items-center gap-2.5 pl-11 font-mono text-[11px] text-quiet"
          >
            <span
              className={
                reduce || paused
                  ? "text-accent-caution-text"
                  : "text-accent-affirm-text"
              }
            >
              ●
            </span>
            <span>{reduce ? "click to advance" : paused ? "paused" : "auto"}</span>
            <span className="ml-auto">
              {`0${active + 1} / 0${STEPS.length}`}
            </span>
          </li>
        </ol>

        {/* Right stage — decorative */}
        <div
          aria-hidden
          className="relative order-1 aspect-[4/3] overflow-hidden rounded-2xl border border-line bg-canvas shadow-2xl shadow-canvas/60 lg:order-2"
        >
          <div className="absolute left-4 top-4 z-10 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-quiet">
            <span
              className="h-1.5 w-1.5 rounded-full bg-accent-affirm motion-safe:animate-pulse"
              style={{
                boxShadow: "0 0 6px var(--color-accent-affirm)",
              }}
            />
            {`Stage · 0${active + 1}`}
          </div>
          <div className="absolute right-4 top-4 z-10 hidden font-mono text-[10px] uppercase tracking-[0.22em] text-quiet sm:block">
            {PHASE_LABELS[active]}
          </div>

          {/* Streams (frames 1 + 2) */}
          <div
            className="absolute inset-0 transition-opacity duration-700"
            style={{
              opacity: active <= 1 ? 1 : 0,
              pointerEvents: active <= 1 ? "auto" : "none",
            }}
          >
            <StreamsCanvas narrowRef={narrowRef} reduce={reduce} />
          </div>

          {[2, 3, 4].map((idx) => (
            <div
              key={idx}
              className="absolute inset-0 transition-opacity duration-700"
              style={{
                opacity: active === idx ? 1 : 0,
                pointerEvents: active === idx ? "auto" : "none",
              }}
            >
              {idx === 2 && (
                <CallFrame active={active === 2} reduce={reduce} />
              )}
              {idx === 3 && (
                <ReasonFrame active={active === 3} reduce={reduce} />
              )}
              {idx === 4 && (
                <AgentFrame active={active === 4} reduce={reduce} />
              )}
            </div>
          ))}

          {/* Bottom progress bar */}
          <div className="absolute inset-x-0 bottom-0 z-10 h-0.5 bg-line">
            <div
              className="h-full bg-accent-affirm"
              style={{
                width: `${(reduce ? 0 : progress) * 100}%`,
                boxShadow: "0 0 8px var(--color-accent-affirm)",
                transition: paused ? "width 0.25s" : "none",
              }}
            />
          </div>
        </div>
      </div>

      {/* Closer — reachable, not aria-hidden. Carries the /accuracy
          link required whenever a surface claims accuracy. */}
      <p className="mt-8 max-w-2xl text-sm leading-relaxed text-quiet">
        The context-aware editor in your codebase. Sharper
        communication, shipped faster, with the accuracy{" "}
        <Link
          href="/accuracy"
          className="rounded font-medium text-accent-affirm-text underline underline-offset-2 hover:text-accent-affirm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
        >
          published
        </Link>
        .
      </p>
    </div>
  );
}
