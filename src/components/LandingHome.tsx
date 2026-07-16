import { Menu, MessageSquare, Settings2, X } from "lucide-react";
import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { gsap } from "gsap";
import "../landing-home.css";

const HERO_VIDEO_URL =
  "https://pub-86dc5b5484314368ac5436a674b0d919.r2.dev/cloudinarry%20to%20cloudflare/202606021731-e_hqa6sn.mp4";
const DRUM_VIDEO_URL =
  "https://pub-86dc5b5484314368ac5436a674b0d919.r2.dev/cloudinarry%20to%20cloudflare/2026060218225-v_kcy5rl.mp4";
const MAX_SCROLL_PROGRESS = 3.5;

type LandingDestination = "studio" | "characters" | "extensions" | "settings" | "chat";

type RecentSession = {
  id: string;
  title: string;
  workspaceName: string;
  messageCount: number;
  updatedAt: string;
};

type LandingHomeProps = {
  activePersonaName: string;
  chatModelLabel: string;
  chatModelReady: boolean;
  personaCount: number;
  characterCount: number;
  extensionCount: number;
  enabledExtensionCount: number;
  sessionCount: number;
  recentSessions: RecentSession[];
  modal?: ReactNode;
  onOpenDestination: (destination: LandingDestination) => void;
  onOpenSession: (sessionId: string) => void;
};

type NavigationItem = {
  id: "projects" | "expertise" | "about" | "contact";
  label: string;
  scrollRatio: number;
};

type DrumSegment = {
  text: string;
  highlight?: boolean;
};

const NAVIGATION_ITEMS: NavigationItem[] = [
  { id: "projects", label: "能力", scrollRatio: 0.25 },
  { id: "expertise", label: "模块", scrollRatio: 0.5 },
  { id: "about", label: "理念", scrollRatio: 0.95 },
  { id: "contact", label: "宣言", scrollRatio: 3.5 },
];

const DRUM_LINES: DrumSegment[][] = [
  [{ text: "欢迎进入 " }, { text: "Renge Agent Lab", highlight: true }],
  [{ text: "一个为 " }, { text: "人格设计", highlight: true }, { text: "、" }, { text: "角色创作", highlight: true }, { text: " 与" }],
  [{ text: "高强度 " }, { text: "智能体协作", highlight: true }, { text: " 而生的工作空间。" }],
  [{ text: "我们拒绝让灵感困在 " }, { text: "重复配置", highlight: true }, { text: " 里。" }],
  [{ text: "把长期记忆、行为边界与 " }, { text: "人格结构", highlight: true }],
  [{ text: "变成可维护、可组合的 " }, { text: "系统资产", highlight: true }, { text: "。" }],
  [{ text: "从角色卡、世界书到正则与脚本，" }],
  [{ text: "每一层上下文都保持 " }, { text: "清晰可控", highlight: true }, { text: "。" }],
  [{ text: "在同一个界面组织 " }, { text: "多 Agent 角色", highlight: true }],
  [{ text: "让模型带着真正一致的 " }, { text: "身份与目标", highlight: true }, { text: " 工作。" }],
  [{ text: "连接你的模型供应商、MCP 与 " }, { text: "本地工具", highlight: true }],
  [{ text: "把复杂工作流压缩成一次 " }, { text: "自然对话", highlight: true }, { text: "。" }],
  [{ text: "这里没有被锁死的模板，" }],
  [{ text: "只有可以持续进化的 " }, { text: "创作协议", highlight: true }, { text: "。" }],
  [{ text: "导入、翻译、调试，然后直接开始演绎。" }],
  [],
  [{ text: "这不是另一个 " }, { text: "聊天壳", highlight: true }],
  [{ text: "也不是只适合演示的 " }, { text: "静态面板", highlight: true }, { text: "。" }],
  [{ text: "它是一套面向真实生产的 " }, { text: "上下文引擎", highlight: true }],
  [{ text: "为高密度创作者与 " }, { text: "Agent 架构师", highlight: true }, { text: " 构建。" }],
  [{ text: "人格、用户画像、预设与世界书" }],
  [{ text: "在每次请求前完成 " }, { text: "精确编排", highlight: true }, { text: "。" }],
  [{ text: "扩展兼容层让旧生态继续生长，" }],
  [{ text: "原生工具链让新能力 " }, { text: "立即接入", highlight: true }, { text: "。" }],
  [{ text: "我们的原则很简单：" }],
  [{ text: "消除上下文噪音", highlight: true }, { text: "，保留真正重要的信号；" }],
  [{ text: "自动化执行层", highlight: true }, { text: "，把注意力还给创造；" }],
  [{ text: "让每个数字角色都拥有 " }, { text: "连续生命", highlight: true }, { text: "。" }],
  [{ text: "我们拆解复杂系统，" }],
  [{ text: "重组传统界面", highlight: true }, { text: "，连接开放生态，" }],
  [{ text: "执行流畅、透明、可追溯的 " }, { text: "智能协作", highlight: true }],
  [{ text: "并持续重写 " }, { text: "人类与智能体的工作方式", highlight: true }, { text: "。" }],
];

const MARQUEE_ITEMS = [
  "PERSONA",
  "ROLEPLAY",
  "WORLDBOOK",
  "MCP",
  "CODEX",
  "TAVERN",
  "MULTI AGENT",
];

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function clamp01(value: number) {
  return clamp(value, 0, 1);
}

function getActiveSection(progress: number) {
  if (progress < 0.18) return "hero";
  if (progress < 0.45) return "projects";
  if (progress < 0.68) return "expertise";
  if (progress < 1.15) return "about";
  return "contact";
}

function RengeLogo({ size = 48 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      className="landing-logo-mark"
      width={size}
      height={size}
      viewBox="0 0 80 80"
      fill="none"
    >
      <path
        d="M40 80C17.9086 80 0 62.0914 0 40V0C15.0436 0 28.1476 8.30466 34.9776 20.5796C25.6529 22.8063 18.7198 31.1937 18.7198 41.2004V42.0962C18.7198 53.3099 27.8104 62.4004 39.0242 62.4004H39.9199L39.9197 41.2004C39.9197 52.9088 49.4113 62.4004 61.1198 62.4004L61.1198 41.2004C61.1198 29.5187 51.6717 20.0437 40 20.0005L40 0H41.6902C62.8481 0 80 17.1519 80 38.3099V40C80 62.0914 62.0914 80 40 80Z"
        fill="currentColor"
      />
    </svg>
  );
}

type LandingHeaderProps = {
  activeSectionId: string;
  activePersonaName: string;
  chatModelReady: boolean;
  onNavigate: (item: NavigationItem | { id: "hero"; label: string; scrollRatio: number }) => void;
  onOpenDestination: (destination: LandingDestination) => void;
};

function LandingHeader({
  activeSectionId,
  activePersonaName,
  chatModelReady,
  onNavigate,
  onOpenDestination,
}: LandingHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!menuOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [menuOpen]);

  const navigate = (item: NavigationItem) => {
    onNavigate(item);
    setMenuOpen(false);
  };

  const openDestination = (destination: LandingDestination) => {
    setMenuOpen(false);
    onOpenDestination(destination);
  };

  return (
    <>
      <header className="landing-header">
        <button
          type="button"
          className="landing-brand"
          aria-label="返回首页开场"
          onClick={() => onNavigate({ id: "hero", label: "首页", scrollRatio: 0 })}
        >
          <RengeLogo />
          <span className="landing-brand-copy">
            <strong>Renge Agent Lab</strong>
            <span>Persona systems. Agent workflows.</span>
            <span>{activePersonaName}</span>
          </span>
        </button>

        <nav className="landing-desktop-nav" aria-label="首页章节导航">
          {NAVIGATION_ITEMS.map((item) => (
            <button
              type="button"
              key={item.id}
              className={activeSectionId === item.id ? "active" : ""}
              onClick={() => navigate(item)}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className="landing-header-actions">
          <button
            type="button"
            className="landing-chat-action"
            onClick={() => openDestination("chat")}
          >
            <span className={`landing-status-dot ${chatModelReady ? "ready" : ""}`} />
            进入对话
            <MessageSquare size={15} />
          </button>
          <button
            type="button"
            className="landing-settings-action"
            aria-label="打开设置"
            onClick={() => openDestination("settings")}
          >
            <Settings2 size={17} />
          </button>
          <button
            type="button"
            className="landing-menu-toggle"
            aria-label={menuOpen ? "关闭菜单" : "打开菜单"}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((current) => !current)}
          >
            {menuOpen ? <X size={19} /> : <Menu size={19} />}
          </button>
        </div>
      </header>

      <div className={`landing-mobile-menu ${menuOpen ? "open" : ""}`} aria-hidden={!menuOpen}>
        <div className="landing-mobile-menu-inner">
          <div className="landing-mobile-menu-label">Explore / Renge</div>
          {NAVIGATION_ITEMS.map((item, index) => (
            <button
              type="button"
              key={item.id}
              tabIndex={menuOpen ? 0 : -1}
              className={activeSectionId === item.id ? "active" : ""}
              onClick={() => navigate(item)}
            >
              <span>0{index + 1}</span>
              {item.label}
            </button>
          ))}
          <div className="landing-mobile-quicklinks">
            <button type="button" onClick={() => openDestination("studio")}>人格工作室</button>
            <button type="button" onClick={() => openDestination("characters")}>角色卡</button>
            <button type="button" onClick={() => openDestination("extensions")}>扩展</button>
            <button type="button" onClick={() => openDestination("chat")}>开始对话</button>
            <button type="button" onClick={() => openDestination("settings")}>模型与设置</button>
          </div>
        </div>
      </div>
    </>
  );
}

type VideoScrubberProps = {
  scrollProgress: number;
  source: string;
  fallbackDuration: number;
  label: string;
  variant: "hero" | "drum";
};

function VideoScrubber({
  scrollProgress,
  source,
  fallbackDuration,
  label,
  variant,
}: VideoScrubberProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const progressRef = useRef(scrollProgress);
  const currentTimeRef = useRef(0);
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);

  progressRef.current = scrollProgress;

  useEffect(() => {
    let frameId = 0;
    const tick = () => {
      const video = videoRef.current;
      if (video) {
        const duration = Number.isFinite(video.duration) && video.duration > 0
          ? video.duration
          : fallbackDuration;
        const targetTime = clamp(progressRef.current * duration, 0, duration);
        currentTimeRef.current += (targetTime - currentTimeRef.current) * 0.15;
        if (
          video.readyState >= 1 &&
          !video.seeking &&
          Math.abs(video.currentTime - currentTimeRef.current) > 0.01
        ) {
          try {
            video.currentTime = currentTimeRef.current;
          } catch {
            // Browsers can reject a seek until media metadata becomes available.
          }
        }
      }
      frameId = window.requestAnimationFrame(tick);
    };
    frameId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frameId);
  }, [fallbackDuration]);

  useEffect(() => {
    const move = (event: MouseEvent) => {
      if (!containerRef.current || window.matchMedia("(pointer: coarse)").matches) return;
      const mx = event.clientX / window.innerWidth - 0.5;
      const my = event.clientY / window.innerHeight - 0.5;
      gsap.to(containerRef.current, {
        x: -mx * 40,
        y: -my * 40,
        duration: 1.2,
        ease: "power2.out",
        overwrite: "auto",
      });
    };
    window.addEventListener("mousemove", move);
    return () => {
      window.removeEventListener("mousemove", move);
      if (containerRef.current) gsap.killTweensOf(containerRef.current);
    };
  }, []);

  return (
    <div className={`landing-video landing-video-${variant} ${hasError ? "has-error" : ""}`}>
      <div ref={containerRef} className="landing-video-parallax">
        <video
          ref={videoRef}
          muted
          playsInline
          preload="auto"
          aria-hidden="true"
          onLoadedMetadata={() => setIsLoaded(true)}
          onCanPlay={() => setIsLoaded(true)}
          onError={() => {
            setHasError(true);
            setIsLoaded(true);
          }}
        >
          <source src={source} type="video/mp4" />
        </video>
      </div>
      <div className="landing-video-grade" />
      {!isLoaded && (
        <div className="landing-loader" role="status" aria-live="polite">
          <span className="landing-loader-rings" aria-hidden="true">
            <span />
            <span />
          </span>
          <span>{label}</span>
        </div>
      )}
    </div>
  );
}

type ScrollExitSplitTextProps = {
  children: string;
  scrollProgress: number;
};

function ScrollExitSplitText({ children, scrollProgress }: ScrollExitSplitTextProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<gsap.core.Timeline | null>(null);

  useLayoutEffect(() => {
    if (!containerRef.current) return;
    const chars = containerRef.current.querySelectorAll<HTMLElement>(".landing-hero-char");
    const context = gsap.context(() => {
      timelineRef.current = gsap.timeline({ paused: true }).fromTo(
        chars,
        {
          opacity: 1,
          yPercent: 0,
          y: 0,
          scaleY: 1,
          scaleX: 1,
          transformOrigin: "50% 0%",
        },
        {
          opacity: 0,
          yPercent: 300,
          y: "25vh",
          scaleY: 1.2,
          scaleX: 0.9,
          stagger: 0.03,
          ease: "power2.inOut",
        },
      );
    }, containerRef);
    return () => {
      timelineRef.current = null;
      context.revert();
    };
  }, [children]);

  useEffect(() => {
    if (!timelineRef.current) return;
    gsap.to(timelineRef.current, {
      progress: scrollProgress,
      duration: 0.6,
      ease: "power1.out",
      overwrite: "auto",
    });
  }, [scrollProgress]);

  const words = children.split(/\s+/);

  return (
    <div ref={containerRef} className="landing-hero-title" aria-label={children}>
      {words.map((word, wordIndex) => (
        <span className="landing-hero-word" aria-hidden="true" key={`${word}-${wordIndex}`}>
          {Array.from(word).map((character, charIndex) => (
            <span className="landing-hero-char" key={`${character}-${charIndex}`}>
              {character}
            </span>
          ))}
          {wordIndex < words.length - 1 && <span className="landing-title-space">&nbsp;</span>}
        </span>
      ))}
    </div>
  );
}

type SoapTilesProps = {
  scrollProgress: number;
  onOpenDestination: (destination: LandingDestination) => void;
};

const SOAP_TILE_ITEMS: Array<{
  label: string;
  eyebrow: string;
  destination: LandingDestination;
  baseXOffset: number;
}> = [
  { label: "人格架构与长期记忆", eyebrow: "01 / PERSONA", destination: "studio", baseXOffset: 120 },
  { label: "角色卡与酒馆生态", eyebrow: "02 / CHARACTER", destination: "characters", baseXOffset: 180 },
  { label: "扩展兼容与智能体工具链", eyebrow: "03 / EXTENSIONS", destination: "extensions", baseXOffset: 240 },
];

function SoapTiles({ scrollProgress, onOpenDestination }: SoapTilesProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 767px), (pointer: coarse)");
    const update = () => setIsMobile(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  const easeProgress = clamp01((scrollProgress - 0.75) / 0.22);
  const visible = scrollProgress > 0.72;

  return (
    <div className={`landing-soap-tiles ${visible ? "visible" : ""}`} aria-hidden={!visible}>
      {SOAP_TILE_ITEMS.map((item, index) => {
        const responsiveOffset = isMobile ? item.baseXOffset * 0.25 : item.baseXOffset;
        const translateX = (easeProgress - 1) * responsiveOffset;
        const neighborShift = hoveredIndex === null || hoveredIndex === index
          ? 0
          : (index < hoveredIndex ? -1 : 1) * (isMobile ? 5.2 : 13.8);
        const scale = !isMobile && hoveredIndex === index ? 1.2 : 1;
        const style = {
          opacity: easeProgress,
          filter: `blur(${(1 - easeProgress) * 12}px)`,
          transform: `translate3d(${translateX}px, ${neighborShift}px, 0) scale(${scale})`,
          transitionDelay: `${index * 100}ms`,
        };
        return (
          <button
            type="button"
            className="landing-soap-tile"
            key={item.label}
            style={style}
            tabIndex={visible ? 0 : -1}
            onMouseEnter={() => setHoveredIndex(index)}
            onMouseLeave={() => setHoveredIndex(null)}
            onFocus={() => setHoveredIndex(index)}
            onBlur={() => setHoveredIndex(null)}
            onClick={() => onOpenDestination(item.destination)}
          >
            <span className="landing-soap-eyebrow">{item.eyebrow}</span>
            <span>{item.label}</span>
            <span className="landing-soap-arrow" aria-hidden="true">↗</span>
          </button>
        );
      })}
    </div>
  );
}

function CylindricalTextDrum({ scrollProgress }: { scrollProgress: number }) {
  const radius = 380;
  const lineHeight = 32;
  const targetIndex = clamp01((scrollProgress - 1.45) / 2.05) * (DRUM_LINES.length - 1);

  return (
    <div className="landing-drum" aria-label="Renge 产品宣言">
      <div className="landing-drum-kicker">SYSTEM MANIFESTO / 2026</div>
      <div className="landing-drum-inner">
        {DRUM_LINES.map((segments, index) => {
          const indexDiff = index - targetIndex;
          const translateY = indexDiff * lineHeight;
          const angleRad = translateY / radius;
          const angleDeg = angleRad * 180 / Math.PI;
          const translateZ = Math.cos(angleRad) * radius - radius;
          const baseScale = 0.78 + Math.cos(angleRad) * 0.22;
          const opacity = Math.max(0, (Math.cos(angleRad) - 0.2) / 0.8);
          const depthBlur = Math.min(8, Math.max(0, (Math.abs(indexDiff) - 1.5) * 0.75));
          const style: CSSProperties = {
            opacity,
            filter: depthBlur > 0.1 ? `blur(${depthBlur}px)` : "none",
            transform: `translateY(${translateY - lineHeight / 2}px) translateZ(${translateZ}px) rotateX(${-angleDeg * 0.8}deg) scale(${baseScale})`,
            transformOrigin: "left center",
          };

          return (
            <p
              className={`landing-drum-line ${segments.length === 0 ? "spacer" : ""}`}
              style={style}
              key={index}
              aria-hidden={opacity < 0.2}
            >
              {segments.length === 0
                ? "\u00A0"
                : segments.map((segment, segmentIndex) => (
                    <span className={segment.highlight ? "highlight" : ""} key={segmentIndex}>
                      {segment.text}
                    </span>
                  ))}
            </p>
          );
        })}
      </div>
    </div>
  );
}

function CapabilityMarquee() {
  return (
    <div className="landing-marquee" aria-label="Renge 支持的能力">
      <div className="landing-marquee-track">
        {[0, 1].map((group) => (
          <div className="landing-marquee-group" aria-hidden={group === 1} key={group}>
            {MARQUEE_ITEMS.map((item) => (
              <span key={item}>{item}</span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

type LandingActionDockProps = Pick<
  LandingHomeProps,
  | "activePersonaName"
  | "chatModelLabel"
  | "chatModelReady"
  | "personaCount"
  | "characterCount"
  | "extensionCount"
  | "enabledExtensionCount"
  | "sessionCount"
  | "recentSessions"
  | "onOpenDestination"
  | "onOpenSession"
>;

function LandingActionDock({
  activePersonaName,
  chatModelLabel,
  chatModelReady,
  personaCount,
  characterCount,
  extensionCount,
  enabledExtensionCount,
  sessionCount,
  recentSessions,
  onOpenDestination,
  onOpenSession,
}: LandingActionDockProps) {
  const latestSession = recentSessions[0];

  return (
    <aside className="landing-action-dock" aria-label="工作台快速入口">
      <div className="landing-dock-topline">
        <span>WORKSPACE / LIVE</span>
        <span className={chatModelReady ? "ready" : ""}>
          {chatModelReady ? "MODEL READY" : "SETUP REQUIRED"}
        </span>
      </div>
      <div className="landing-dock-identity">
        <span>当前人格</span>
        <strong>{activePersonaName}</strong>
        <small>{chatModelLabel}</small>
      </div>
      <div className="landing-dock-stats">
        <span><strong>{personaCount}</strong> 人格</span>
        <span><strong>{characterCount}</strong> 角色</span>
        <span><strong>{enabledExtensionCount}/{extensionCount}</strong> 扩展</span>
        <span><strong>{sessionCount}</strong> 会话</span>
      </div>
      {latestSession && (
        <button
          type="button"
          className="landing-resume-session"
          onClick={() => onOpenSession(latestSession.id)}
        >
          <span>
            <small>继续最近会话 · {latestSession.workspaceName} · {latestSession.messageCount} 条消息</small>
            <strong>{latestSession.title}</strong>
          </span>
          <span aria-hidden="true">↗</span>
        </button>
      )}
      <div className="landing-dock-actions">
        <button type="button" onClick={() => onOpenDestination("studio")}>打开工作台</button>
        <button type="button" onClick={() => onOpenDestination("chat")}>开始对话 ↗</button>
      </div>
    </aside>
  );
}

export function LandingHome(props: LandingHomeProps) {
  const [scrollProgress, setScrollProgress] = useState(0);
  const [lerpedScrollProgress, setLerpedScrollProgress] = useState(0);
  const scrollProgressRef = useRef(0);
  const lerpedProgressRef = useRef(0);
  const navAnimationRef = useRef<number | null>(null);
  const touchYRef = useRef(0);

  const updateScrollProgress = useCallback((value: number) => {
    const nextValue = clamp(value, 0, MAX_SCROLL_PROGRESS);
    scrollProgressRef.current = nextValue;
    setScrollProgress(nextValue);
  }, []);

  const cancelNavigation = useCallback(() => {
    if (navAnimationRef.current !== null) {
      window.cancelAnimationFrame(navAnimationRef.current);
      navAnimationRef.current = null;
    }
  }, []);

  useEffect(() => {
    let frameId = 0;
    const tick = () => {
      const current = lerpedProgressRef.current;
      const target = scrollProgressRef.current;
      const next = Math.abs(target - current) < 0.0001
        ? target
        : current + (target - current) * 0.08;
      if (next !== current) {
        lerpedProgressRef.current = next;
        setLerpedScrollProgress(next);
      }
      frameId = window.requestAnimationFrame(tick);
    };
    frameId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frameId);
  }, []);

  useEffect(() => {
    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    const previousBodyOverscroll = document.body.style.overscrollBehavior;
    const previousHtmlOverscroll = document.documentElement.style.overscrollBehavior;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    document.body.style.overscrollBehavior = "none";
    document.documentElement.style.overscrollBehavior = "none";

    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey) return;
      event.preventDefault();
      cancelNavigation();
      updateScrollProgress(scrollProgressRef.current + event.deltaY * 0.0006);
    };
    const onTouchStart = (event: TouchEvent) => {
      touchYRef.current = event.touches[0]?.clientY ?? 0;
      cancelNavigation();
    };
    const onTouchMove = (event: TouchEvent) => {
      const currentY = event.touches[0]?.clientY;
      if (currentY === undefined) return;
      event.preventDefault();
      cancelNavigation();
      const delta = touchYRef.current - currentY;
      touchYRef.current = currentY;
      updateScrollProgress(scrollProgressRef.current + delta * 0.0015);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable='true']")) return;
      let delta = 0;
      if (["ArrowDown", "PageDown", " "].includes(event.key)) delta = 0.18;
      if (["ArrowUp", "PageUp"].includes(event.key)) delta = -0.18;
      if (event.key === "Home") {
        event.preventDefault();
        cancelNavigation();
        updateScrollProgress(0);
        return;
      }
      if (event.key === "End") {
        event.preventDefault();
        cancelNavigation();
        updateScrollProgress(MAX_SCROLL_PROGRESS);
        return;
      }
      if (delta !== 0) {
        event.preventDefault();
        cancelNavigation();
        updateScrollProgress(scrollProgressRef.current + delta);
      }
    };

    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("keydown", onKeyDown);
      cancelNavigation();
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
      document.body.style.overscrollBehavior = previousBodyOverscroll;
      document.documentElement.style.overscrollBehavior = previousHtmlOverscroll;
    };
  }, [cancelNavigation, updateScrollProgress]);

  const handleNavigate = useCallback((item: NavigationItem | { scrollRatio: number }) => {
    cancelNavigation();
    const start = scrollProgressRef.current;
    const destination = clamp(item.scrollRatio, 0, MAX_SCROLL_PROGRESS);
    const startedAt = performance.now();
    const duration = 1200;
    const animate = (now: number) => {
      const progress = clamp01((now - startedAt) / duration);
      const eased = progress < 0.5
        ? 4 * progress * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 3) / 2;
      updateScrollProgress(start + (destination - start) * eased);
      if (progress < 1) {
        navAnimationRef.current = window.requestAnimationFrame(animate);
      } else {
        navAnimationRef.current = null;
      }
    };
    navAnimationRef.current = window.requestAnimationFrame(animate);
  }, [cancelNavigation, updateScrollProgress]);

  const secondScreenProgress = clamp01((lerpedScrollProgress - 1.15) / 0.5);
  const easedRisingProgress = 1 - Math.pow(1 - secondScreenProgress, 3);
  const smoothBlurAmount = Math.sin(secondScreenProgress * Math.PI / 2) * 64;
  const drumProgress = clamp01((lerpedScrollProgress - 1.45) / (3.5 - 1.45));
  const activeSectionId = getActiveSection(lerpedScrollProgress);
  const progressPercent = (scrollProgress / MAX_SCROLL_PROGRESS) * 100;
  const pageStyle = useMemo(() => ({ "--landing-progress": `${progressPercent}%` }) as CSSProperties, [progressPercent]);

  return (
    <>
      <main className="landing-home" style={pageStyle}>
        <div className="landing-stage">
          <div
            className="landing-first-screen"
            style={{ filter: secondScreenProgress > 0 ? `blur(${smoothBlurAmount}px)` : "none" }}
          >
            <VideoScrubber
              scrollProgress={Math.min(1, lerpedScrollProgress)}
              source={HERO_VIDEO_URL}
              fallbackDuration={4.2}
              label="LOADING SCROLL STREAM..."
              variant="hero"
            />

            <div className="landing-hero-meta">
              <span>PERSONA / AGENT / ROLEPLAY</span>
              <span>ONE WORKSPACE · ZERO FRICTION</span>
            </div>

            <div className="landing-hero-title-strip">
              <ScrollExitSplitText scrollProgress={Math.min(1, lerpedScrollProgress)}>
                RENGE AGENT LAB
              </ScrollExitSplitText>
            </div>

            <SoapTiles
              scrollProgress={lerpedScrollProgress}
              onOpenDestination={props.onOpenDestination}
            />

            <div className="landing-scroll-cue" aria-hidden="true">
              <span>SCROLL TO ENTER</span>
              <span className="landing-scroll-cue-line"><i /></span>
              <span>00 — 35</span>
            </div>
          </div>

          <LandingHeader
            activeSectionId={activeSectionId}
            activePersonaName={props.activePersonaName}
            chatModelReady={props.chatModelReady}
            onNavigate={handleNavigate}
            onOpenDestination={props.onOpenDestination}
          />

          <div
            className="landing-second-screen"
            style={{
              transform: `translateY(${(1 - easedRisingProgress) * 100}%)`,
              visibility: secondScreenProgress > 0 ? "visible" : "hidden",
            }}
          >
            <div className="landing-grab-handle" />
            <VideoScrubber
              scrollProgress={drumProgress}
              source={DRUM_VIDEO_URL}
              fallbackDuration={4.2}
              label="LOADING DRUM STREAM..."
              variant="drum"
            />
            <CylindricalTextDrum scrollProgress={lerpedScrollProgress} />
            <div className="landing-marquee-wrap">
              <CapabilityMarquee />
            </div>
            <LandingActionDock {...props} />
          </div>

          <div className="landing-progress-rail" aria-hidden="true">
            <span />
          </div>
        </div>
      </main>
      {props.modal}
    </>
  );
}
