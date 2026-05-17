"use client";

/**
 * HowItWorksDiagram — "the model around the model", v11.
 *
 * v11 ports the second Claude-design handoff (revised frames 3/4/5)
 * and fixes the three issues Robert flagged:
 *
 *  1. Design-system fidelity. The handoff is browser-only raw hex;
 *     every colour is mapped to the app's semantic AAA tokens. The
 *     frame-5 agent card was unreadable (translucent navy + blur over
 *     a moving canvas) — it is now an OPAQUE token surface so the
 *     copy sits on a stable background, not the animation.
 *  2. Section was enormous below the fold. Root cause: v10 used a
 *     bare `aspect-[4/3]` on a `1fr` column with no cap, so the stage
 *     ballooned on desktop. v11 caps the whole block (`max-w-4xl`)
 *     and the stage (`max-h`), and uses the handoff's responsive
 *     aspect ratios.
 *  3. Broke on tablet/mobile (inner card overflowed the short stage
 *     and mangled the chrome). Root cause: v10 never ported the
 *     responsive aspect-ratio / padding rules. v11 does: portrait
 *     stage on phones, roomier padding shrink, agent-card max-width
 *     steps — so content always fits inside the clipped stage.
 *
 * Frames 1+2 (StreamsCanvas) are unchanged. Frames 3/4/5 are the new
 * designs: a highlighter-pen PR critique, the paired call→answer
 * card, and an orbital deterministic-agent scan.
 *
 * Content is OURS (the locked value-forward copy). The rail STEPS,
 * phase labels, and closer are not the handoff's placeholders. The
 * closer keeps the /accuracy link, reachable and not aria-hidden
 * (CLAUDE.md non-negotiable: an accuracy claim links to /accuracy).
 * page.tsx is untouched — it owns the section eyebrow + "The model
 * around the model." h2 + intro, so the copy-pin test stays green.
 *
 * Accessibility: the rail is the semantic interface (real buttons,
 * focus rings, aria-current); the stage is decorative (aria-hidden).
 * prefers-reduced-motion: no autoplay, no canvas RAF (one static
 * frame), no typewriter / staged reveal / ticker — content shown in
 * full; the rail still advances on click.
 */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pill } from "@/components/ui/pill";

type Step = { n: number; title: string; body: string };

// Rail copy — the locked value-forward arc (NOT the handoff's
// placeholder STEPS).
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

const PHASE_LABELS = [
  "IN YOUR REPO",
  "IN FOCUS",
  "THE CALL",
  "THE REASON",
  "THE AGENT",
] as const;

const AUTOPLAY_MS = 3800;

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

function tokenRgb(name: string, fallback: string): [number, number, number] {
  if (typeof window === "undefined") return hexToRgb(fallback);
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return hexToRgb(v || fallback);
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

// Frame-card chrome shared by frames 3 + 4 — a real token surface
// (not the handoff's translucent white gradient), so text is AAA.
const CARD =
  "w-full rounded-2xl border border-line bg-raised shadow-xl shadow-canvas/40";
// Responsive outer/inner padding (handoff: 6%/8% → 4%/5% → 3%/4%;
// inner 28 → 20 → 16/18).
const FRAME_PAD =
  "absolute inset-0 flex items-center justify-center p-[8%] max-[720px]:p-[5%] max-[480px]:p-[4%]";
const FRAME_INNER = "p-7 max-[720px]:p-5 max-[480px]:px-[18px] max-[480px]:py-4";

// ---- Frames 1 + 2: converging particle streams (unchanged) ---------------
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
      const [mr, mg, mb] = tokenRgb("--color-accent-affirm", "#4ade80");
      const [br, bg, bb] = tokenRgb("--color-accent-affirm-text", "#86efac");
      const mid = (a: number) => `rgba(${mr},${mg},${mb},${a})`;
      const bright = (a: number) => `rgba(${br},${bg},${bb},${a})`;
      const narrow = narrowRef.current ?? 0;

      ctx.clearRect(0, 0, w, h);

      const fx = w * 0.78;
      const fy = h * 0.5;
      const pulse = 0.5 + 0.5 * Math.sin(t * 1.4);

      const halo = ctx.createRadialGradient(fx, fy, 0, fx, fy, 90 + pulse * 28);
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

  return <canvas ref={canvasRef} className="block h-full w-full" aria-hidden />;
}

// ---- Frame 3: The Call — highlighter PR critique -------------------------
const PR_PARTS = [
  { text: "Refactored the auth flow and fixed " },
  { text: "a couple edge cases", mark: 1 },
  { text: ". " },
  { text: "Should be good to merge.", mark: 2 },
] as const;

const ISSUES = [
  {
    n: "1",
    text: "A reviewer can't tell what actually changed.",
    phase: 3,
    meta: false,
  },
  {
    n: "2",
    text: "Nothing says why it's safe to merge.",
    phase: 4,
    meta: false,
  },
  {
    n: "*",
    text: "The next person reading the history learns nothing.",
    phase: 5,
    meta: true,
  },
] as const;

function CallFrame({ active, reduce }: { active: boolean; reduce: boolean }) {
  const MAX = 5;
  const [phase, setPhase] = useState(reduce ? MAX : 0);
  useEffect(() => {
    if (reduce) {
      setPhase(MAX);
      return;
    }
    if (!active) {
      setPhase(0);
      return;
    }
    const timers = [
      setTimeout(() => setPhase(1), 100),
      setTimeout(() => setPhase(2), 300),
      setTimeout(() => setPhase(3), 850),
      setTimeout(() => setPhase(4), 1500),
      setTimeout(() => setPhase(5), 2150),
    ];
    return () => timers.forEach(clearTimeout);
  }, [active, reduce]);

  const reveal = (n: number, x = false) => ({
    opacity: phase >= n ? 1 : 0,
    transform:
      phase >= n
        ? "translate(0,0)"
        : x
          ? "translateX(14px)"
          : "translateY(8px)",
    transition: "opacity 0.5s ease, transform 0.5s ease",
  });

  const filled = Math.max(0, Math.min(3, phase - 2));

  return (
    <div className={FRAME_PAD}>
      <div className={`${CARD} relative max-w-[600px] overflow-hidden`}>
        <div className={`relative ${FRAME_INNER}`}>
          <div
            className="mb-5 flex flex-wrap items-center justify-between gap-3"
            style={reveal(1)}
          >
            <span className="text-[10px] font-medium uppercase tracking-[0.22em] text-quiet">
              PR description
            </span>
            <Pill tone="amber" size="xs">
              Worth adjusting
            </Pill>
          </div>

          <p
            className="m-0 text-[15px] italic leading-[1.7] text-quiet"
            style={reveal(2)}
          >
            {PR_PARTS.map((part, i) => {
              if (!("mark" in part) || !part.mark)
                return <span key={i}>{part.text}</span>;
              const on = reduce || phase >= part.mark + 2;
              return (
                <span
                  key={i}
                  className={on ? "text-strong" : "text-quiet"}
                  style={{
                    backgroundImage:
                      "linear-gradient(120deg, var(--color-accent-caution-soft), var(--color-accent-caution-soft))",
                    backgroundRepeat: "no-repeat",
                    backgroundSize: on ? "100% 72%" : "0% 72%",
                    backgroundPosition: "0 78%",
                    transition:
                      "background-size 0.75s cubic-bezier(0.4,0,0.2,1), color 0.5s ease",
                    padding: "0 2px",
                    borderRadius: 2,
                  }}
                >
                  {part.text}
                </span>
              );
            })}
          </p>

          <div className="my-5 h-px bg-line" style={reveal(2)} />

          <div className="relative pl-[18px]">
            <div
              className="absolute left-1 top-2 w-0.5 rounded-full"
              style={{
                height: `calc(${(filled / 3) * 100}% - 16px)`,
                minHeight: phase >= 3 ? 24 : 0,
                background:
                  "linear-gradient(180deg, var(--color-accent-caution-border), var(--color-accent-caution-soft))",
                transition: "height 0.6s cubic-bezier(0.4,0,0.2,1)",
              }}
            />
            {ISSUES.map((issue, i) => (
              <div
                key={i}
                className="flex items-start gap-3.5 py-2"
                style={reveal(issue.phase, true)}
              >
                <span
                  className={[
                    "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border font-mono text-[11px] font-semibold leading-none",
                    issue.meta
                      ? "border-line bg-sunken text-quiet"
                      : "border-accent-caution-border bg-accent-caution-soft text-accent-caution-text",
                  ].join(" ")}
                >
                  {issue.n}
                </span>
                <span
                  className={[
                    "text-sm leading-relaxed",
                    issue.meta ? "text-quiet" : "text-default",
                  ].join(" ")}
                >
                  {issue.text}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---- Frame 4: The Reason — the paired call→answer ------------------------
const PR_DESC =
  "Refactored the auth flow and fixed a couple edge cases. Should be good to merge.";
const CRITIQUE = "A reviewer can't tell what changed or why it's safe to merge.";
const SUGGESTED =
  "Shorten session expiry to 30m and add a refresh-token guard. No API changes.";

function ReasonFrame({ active, reduce }: { active: boolean; reduce: boolean }) {
  const [phase, setPhase] = useState(reduce ? 4 : 0);
  const [typed, setTyped] = useState(reduce ? SUGGESTED : "");

  useEffect(() => {
    if (reduce) {
      setPhase(4);
      setTyped(SUGGESTED);
      return;
    }
    if (!active) {
      setPhase(0);
      setTyped("");
      return;
    }
    const timers: Array<ReturnType<typeof setTimeout>> = [
      setTimeout(() => setPhase(1), 100),
      setTimeout(() => setPhase(2), 350),
      setTimeout(() => setPhase(3), 900),
      setTimeout(() => setPhase(4), 1400),
    ];
    let interval: ReturnType<typeof setInterval> | undefined;
    const typeStart = setTimeout(() => {
      let i = 0;
      interval = setInterval(() => {
        i += 1;
        setTyped(SUGGESTED.slice(0, i));
        if (i >= SUGGESTED.length && interval) clearInterval(interval);
      }, 14);
    }, 1500);
    return () => {
      timers.forEach(clearTimeout);
      clearTimeout(typeStart);
      if (interval) clearInterval(interval);
    };
  }, [active, reduce]);

  const reveal = (n: number) => ({
    opacity: phase >= n ? 1 : 0,
    transform: phase >= n ? "translateY(0)" : "translateY(8px)",
    transition: "opacity 0.45s ease, transform 0.45s ease",
  });

  return (
    <div className={FRAME_PAD}>
      <div className={`${CARD} max-w-[560px] overflow-hidden`}>
        <div className={FRAME_INNER}>
          <div
            className="mb-5 flex flex-wrap items-center justify-between gap-3"
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
            className="mb-4 text-sm italic leading-relaxed text-quiet"
            style={reveal(2)}
          >
            {PR_DESC}
          </p>
          <p
            className="mb-5 text-[15px] font-medium leading-relaxed text-strong"
            style={reveal(3)}
          >
            {CRITIQUE}
          </p>

          <div
            className="rounded-xl border border-accent-affirm-border/40 bg-accent-affirm-soft p-4"
            style={reveal(4)}
          >
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-accent-affirm-text">
              Suggested
            </p>
            <p className="mt-2 min-h-[1.4rem] text-sm leading-relaxed text-default">
              {typed}
              {!reduce && phase >= 4 && typed.length < SUGGESTED.length && (
                <span
                  aria-hidden
                  className="ml-0.5 inline-block h-3.5 w-[7px] translate-y-0.5 bg-accent-affirm motion-safe:animate-pulse"
                />
              )}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---- Frame 5: The Agent — radar fan over the prose it watches ------------
// The kinds of prose the deterministic agent scans, in lifecycle order
// left -> right (define -> build -> document the interface -> the repo
// front door -> the words users read). Spans PM, eng, and design;
// internal and customer-facing. NOT service names — the agent watches
// prose, not APIs (so "API docs", never "API"). "copy" is banned from
// the lexicon, so error/product prose is "Product writing".
const REPOS = [
  "PRDs",
  "PR descriptions",
  "API docs",
  "READMEs",
  "Product writing",
] as const;
// Scrim opaque floor (px from the stage bottom). Mirrored in the scrim
// gradient + RepoLabels CSS below — keep all three in sync.
const SCRIM_PX = 260;
// The fan: a ~120° arc opening upward from an origin on the scrim
// horizon. Canvas angles (y is down): PI = left, 3PI/2 = straight up,
// 2PI = right. Nodes spread left -> right across the visible arc.
const FAN_PAD = 0.1 * Math.PI;
const FAN_A0 = Math.PI + FAN_PAD;
const FAN_A1 = 2 * Math.PI - FAN_PAD;
const REPO_ANGLES = REPOS.map(
  (_, i) => FAN_A0 + (i / (REPOS.length - 1)) * (FAN_A1 - FAN_A0),
);
const SWEEP_PERIOD = 7; // seconds for a full there-and-back sweep

function RepoLabels() {
  // Client-only: the positions are computed from a container-query
  // calc() with interpolated trig — that serialized differently
  // server vs client and tripped a React hydration warning. The
  // labels are decorative (aria-hidden), so rendering them only after
  // mount removes the SSR markup entirely (no diff) with no SEO/SR
  // cost. Rounded trig keeps the calc clean + deterministic too.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  // Mirrors the canvas arcR exactly: max(70, min(stageH - 296, 0.42w)).
  // The -296 (= 260 scrim + 36 reserve) leaves room for the label box
  // itself above the apex node so it never clips the top edge.
  const R = "max(70px, min(100cqh - 296px, 42cqw))";
  return (
    <div
      aria-hidden
      className="absolute inset-0"
      style={{ containerType: "size" }}
    >
      {REPOS.map((name, i) => {
        const a = REPO_ANGLES[i];
        const cosN = Math.cos(a);
        const sinN = Math.sin(a);
        const cos = cosN.toFixed(4);
        const sin = sinN.toFixed(4);
        // Anchor the box's INNER edge at the node's radial point and let
        // text grow toward center, instead of centering the box on the
        // point (which spilled half the longest label past the stage's
        // overflow-hidden edge at narrow widths). The outermost pixel is
        // now `cos * (R + 14px)` ≤ 0.42w → it can never clip for any
        // stage wider than ~132px, regardless of label length. Each
        // label stays tethered to its node; only the spill is removed.
        const anchorX =
          cosN > 0.25 ? "-100%" : cosN < -0.25 ? "0%" : "-50%";
        return (
          <div
            key={name}
            className="absolute font-mono text-[11px] font-medium text-strong"
            style={{
              // Origin = (50% w, stageH - 260px) on the scrim horizon;
              // radius R mirrors the canvas arcR = max(70, min(h-276,
              // 0.42w)). Keeps each label locked to its node on the fan.
              left: "50%",
              top: "calc(100% - 260px)",
              transform: `translate(${anchorX}, -50%) translate(calc(${cos} * (${R} + 14px)), calc(${sin} * (${R} + 14px)))`,
              whiteSpace: "nowrap",
              letterSpacing: "0.02em",
              textShadow: "0 1px 5px rgba(0,0,0,0.9)",
              textAlign:
                cosN > 0.25 ? "right" : cosN < -0.25 ? "left" : "center",
            }}
          >
            {name}
          </div>
        );
      })}
    </div>
  );
}

function AgentBullet({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 py-1.5">
      <span
        aria-hidden
        className="mt-[7px] h-[7px] w-[7px] shrink-0 rounded-full bg-accent-affirm"
        style={{ boxShadow: "0 0 8px var(--color-accent-affirm)" }}
      />
      <span className="text-[13.5px] leading-snug text-default">
        {children}
      </span>
    </div>
  );
}

function AgentFrame({ active, reduce }: { active: boolean; reduce: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Wall-clock timestamp of the moment this frame last became active.
  // The sweep angle is phase-locked to this (not the free-running rAF
  // clock) so the metronome always starts at the left edge (FAN_A0)
  // each time step 5 lights up — while the canvas keeps drawing.
  const activeAtRef = useRef(0);
  const seeds = useMemo(
    () =>
      REPOS.map((_, i) => ({
        angle: REPO_ANGLES[i],
        breathPhase: (i * 0.7) % (Math.PI * 2),
      })),
    [],
  );

  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, w: number, h: number, t: number) => {
      const [mr, mg, mb] = tokenRgb("--color-accent-affirm", "#4ade80");
      const [br, bgc, bb] = tokenRgb("--color-accent-affirm-text", "#86efac");
      const [qr, qg, qb] = tokenRgb("--color-quiet", "#c4c8d4");
      const mint = (a: number) => `rgba(${mr},${mg},${mb},${a})`;
      const bright = (a: number) => `rgba(${br},${bgc},${bb},${a})`;
      const faint = (a: number) => `rgba(${qr},${qg},${qb},${a})`;

      ctx.clearRect(0, 0, w, h);
      // Origin sits on the scrim horizon; the fan opens upward into
      // the clear zone, sized so it never clips or hides under the
      // scrim. arcR mirrors the RepoLabels CSS exactly.
      const ox = w * 0.5;
      const oy = h - SCRIM_PX;
      // oy - 36 reserves ~36px above the apex node for the label box
      // + a top margin, so the fan never clips the panel edge at any
      // width. Mirrored in the RepoLabels CSS R.
      const arcR = Math.max(70, Math.min(oy - 36, w * 0.42));

      // Concentric arc rings (upper semicircle).
      [arcR, arcR * 0.72, arcR * 0.44].forEach((r, idx) => {
        ctx.strokeStyle = mint(0.4 - idx * 0.08);
        ctx.lineWidth = idx === 0 ? 1.5 : 1;
        ctx.beginPath();
        ctx.arc(ox, oy, r, Math.PI, Math.PI * 2);
        ctx.stroke();
      });

      // Cadence ticks along the outer arc, across the fan span.
      const TICKS = 16;
      for (let i = 0; i <= TICKS; i++) {
        const a = FAN_A0 + (i / TICKS) * (FAN_A1 - FAN_A0);
        const major = i % 4 === 0;
        const r2 = arcR + (major ? 7 : 3);
        ctx.strokeStyle = major ? mint(0.85) : faint(0.55);
        ctx.lineWidth = major ? 1.5 : 1;
        ctx.beginPath();
        ctx.moveTo(ox + Math.cos(a) * arcR, oy + Math.sin(a) * arcR);
        ctx.lineTo(ox + Math.cos(a) * r2, oy + Math.sin(a) * r2);
        ctx.stroke();
      }

      // Oscillating sweep across the fan, eased at both ends. The
      // phase is measured from the moment the frame became active
      // (not the free-running canvas clock `t`), so the beam always
      // begins at the left edge (FAN_A0) and swings right, then back
      // left like a metronome — restarting cleanly on each activation.
      const st = (performance.now() - activeAtRef.current) / 1000;
      const ph = (1 - Math.cos((st / SWEEP_PERIOD) * Math.PI * 2)) / 2;
      const sweep = FAN_A0 + ph * (FAN_A1 - FAN_A0);
      const sx = ox + Math.cos(sweep) * arcR;
      const sy = oy + Math.sin(sweep) * arcR;

      // Soft beam around the sweep (direction-agnostic for the swing).
      const beamW = (16 * Math.PI) / 180;
      ctx.fillStyle = mint(0.14);
      ctx.beginPath();
      ctx.moveTo(ox, oy);
      ctx.arc(ox, oy, arcR, sweep - beamW, sweep + beamW);
      ctx.closePath();
      ctx.fill();

      // The sweep ray — bold, bright at the leading edge.
      const grad = ctx.createLinearGradient(ox, oy, sx, sy);
      grad.addColorStop(0, mint(0));
      grad.addColorStop(0.45, mint(0.4));
      grad.addColorStop(1, bright(0.98));
      ctx.strokeStyle = grad;
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(ox, oy);
      ctx.lineTo(sx, sy);
      ctx.stroke();
      ctx.lineCap = "butt";

      // Leading glow + dot at the sweep tip.
      const tipG = ctx.createRadialGradient(sx, sy, 0, sx, sy, 14);
      tipG.addColorStop(0, bright(0.95));
      tipG.addColorStop(0.4, mint(0.4));
      tipG.addColorStop(1, mint(0));
      ctx.fillStyle = tipG;
      ctx.beginPath();
      ctx.arc(sx, sy, 14, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = bright(0.98);
      ctx.beginPath();
      ctx.arc(sx, sy, 3, 0, Math.PI * 2);
      ctx.fill();

      // The watched-prose nodes; brighten + pulse as the sweep nears.
      seeds.forEach((s) => {
        const x = ox + Math.cos(s.angle) * arcR;
        const y = oy + Math.sin(s.angle) * arcR;
        const proximity = Math.max(0, 1 - Math.abs(sweep - s.angle) / 0.22);
        const breath = 0.5 + 0.5 * Math.sin(t * 1.2 + s.breathPhase);
        ctx.fillStyle = mint(0.62 + breath * 0.22 + proximity * 0.45);
        ctx.beginPath();
        ctx.arc(x, y, 3.2 + proximity * 1.8, 0, Math.PI * 2);
        ctx.fill();
        if (proximity > 0.05) {
          ctx.strokeStyle = bright(proximity * 0.95);
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(x, y, 4 + (1 - proximity) * 18, 0, Math.PI * 2);
          ctx.stroke();
        }
      });

      // Origin anchor — the agent, a dish on the horizon.
      const coreR = 3.5 + 0.6 * Math.sin(t * 1.5);
      const cG = ctx.createRadialGradient(ox, oy, 0, ox, oy, 26);
      cG.addColorStop(0, bright(0.9));
      cG.addColorStop(0.4, mint(0.35));
      cG.addColorStop(1, mint(0));
      ctx.fillStyle = cG;
      ctx.beginPath();
      ctx.arc(ox, oy, 26, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = bright(0.95);
      ctx.beginPath();
      ctx.arc(ox, oy, coreR, 0, Math.PI * 2);
      ctx.fill();
    },
    [seeds],
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
      if (reduce) drawRef.current(ctx, w, h, 3);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    // The canvas runs a single always-on rAF for the component's
    // lifetime (cheap; one fan). The metronome's start-at-left
    // behaviour is handled by phase-locking the sweep angle to
    // `activeAtRef` in `draw`, not by gating this loop on `active`.
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

  // Stamp the activation time so the sweep phase resets to FAN_A0
  // (left edge) every time step 5 lights up. The canvas keeps
  // drawing; only the metronome's zero point moves.
  useEffect(() => {
    if (!reduce && active) activeAtRef.current = performance.now();
  }, [active, reduce]);

  const [phase, setPhase] = useState(reduce ? 5 : 0);
  useEffect(() => {
    if (reduce) {
      setPhase(5);
      return;
    }
    if (!active) {
      setPhase(0);
      return;
    }
    const timers = [
      setTimeout(() => setPhase(1), 150),
      setTimeout(() => setPhase(2), 400),
      setTimeout(() => setPhase(3), 700),
      setTimeout(() => setPhase(4), 1000),
      setTimeout(() => setPhase(5), 1300),
    ];
    return () => timers.forEach(clearTimeout);
  }, [active, reduce]);

  const reveal = (n: number) => ({
    opacity: phase >= n ? 1 : 0,
    transform: phase >= n ? "translateY(0)" : "translateY(8px)",
    transition: "opacity 0.45s ease, transform 0.45s ease",
  });

  return (
    <div className="absolute inset-0">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 block h-full w-full"
        aria-hidden
      />

      {/* Soft bottom-up scrim: opaque to 260px so the copy sits on
          solid canvas (AAA), fading out by 330px so the radar fan
          above it stays clear. Token-driven. Drawn BEFORE the labels
          so the labels are never dimmed by it. Keep 260 in sync with
          SCRIM_PX + the RepoLabels CSS. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "linear-gradient(to top, var(--color-canvas, #0e1430) 0px, var(--color-canvas, #0e1430) 260px, transparent 330px)",
        }}
      />

      <RepoLabels />

      {/* Copy, bottom-anchored within the opaque floor of the scrim. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 p-[8%] max-[720px]:p-[5%] max-[480px]:p-[4%]">
        <div className="max-w-[34rem]">
          <p
            className="text-[10px] font-semibold uppercase tracking-[0.22em] text-accent-affirm-text"
            style={reveal(1)}
          >
            The agent
          </p>
          <p
            className="mt-2 text-[22px] font-semibold leading-tight tracking-tight text-strong max-[480px]:text-[18px]"
            style={reveal(2)}
          >
            Not just a tool. An agent.
          </p>
          <p
            className="mt-2.5 text-sm leading-relaxed text-default max-[480px]:mt-2 max-[480px]:text-[13px]"
            style={reveal(3)}
          >
            A deterministic agent watches your repos on a cadence. It
            catches drift and keeps your prose consistent, without
            burning a token.
          </p>
          <div className="mt-2.5" style={reveal(4)}>
            <AgentBullet>Runs on its own, on the schedule you set.</AgentBullet>
          </div>
          <div style={reveal(5)}>
            <AgentBullet>
              Deterministic, so it never spends a token to do it.
            </AgentBullet>
          </div>
        </div>
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

  let narrow = 1;
  if (active === 0) narrow = 0;
  else if (active === 1) {
    const p = Math.min(1, progress / 0.55);
    narrow = 1 - Math.pow(1 - p, 4);
  }
  if (reduce) narrow = 1;
  narrowRef.current = narrow;

  return (
    <div className="mx-auto max-w-4xl">
      <div
        className="flex flex-col gap-7 lg:grid lg:grid-cols-[minmax(220px,280px)_1fr] lg:items-stretch lg:gap-10"
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
            <span>
              {reduce ? "click to advance" : paused ? "paused" : "auto · 3.8s"}
            </span>
            <span className="ml-auto">
              {`0${active + 1} / 0${STEPS.length}`}
            </span>
          </li>
        </ol>

        {/* Right stage — decorative. Responsive aspect + a hard
            max-height so it can never balloon below the fold. */}
        <div
          aria-hidden
          className="relative order-1 aspect-[2/3] max-h-[460px] overflow-hidden rounded-2xl border border-line bg-canvas shadow-2xl shadow-canvas/60 sm:aspect-auto sm:h-[460px] lg:order-2"
        >
          <div className="absolute left-4 top-4 z-10 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-quiet">
            <span
              className="h-1.5 w-1.5 rounded-full bg-accent-affirm motion-safe:animate-pulse"
              style={{ boxShadow: "0 0 6px var(--color-accent-affirm)" }}
            />
            {`Stage · 0${active + 1}`}
          </div>
          <div className="absolute right-4 top-4 z-10 hidden font-mono text-[10px] uppercase tracking-[0.22em] text-quiet sm:block">
            {PHASE_LABELS[active]}
          </div>

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
              {idx === 2 && <CallFrame active={active === 2} reduce={reduce} />}
              {idx === 3 && (
                <ReasonFrame active={active === 3} reduce={reduce} />
              )}
              {idx === 4 && <AgentFrame active={active === 4} reduce={reduce} />}
            </div>
          ))}

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
