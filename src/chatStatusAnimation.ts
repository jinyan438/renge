type AnimationClock = { nodes: Set<SVGSVGElement>; stop: () => void; wake: () => void };
const clocks = new WeakMap<Window, AnimationClock>();

/** Small progress icons need no compositor animation at the monitor's refresh
 * rate. Share a bounded clock, write only their transforms, and never render
 * React or read geometry on animation ticks. */
export function animateChatStatusIcon(node: SVGSVGElement) {
  const view = node.ownerDocument.defaultView;
  if (!view) return () => undefined;
  let clock = clocks.get(view);
  if (!clock) {
    const nodes = new Set<SVGSVGElement>();
    const reducedMotion = view.matchMedia("(prefers-reduced-motion: reduce)");
    let timer: number | null = null;
    const cancel = () => { if (timer !== null) view.clearTimeout(timer); timer = null; };
    const tick = () => {
      timer = null;
      if (!nodes.size || reducedMotion.matches || view.document.hidden) return;
      const transform = `rotate(${(view.performance.now() % 1_400) * 360 / 1_400}deg)`;
      for (const icon of nodes) if (icon.isConnected) icon.style.transform = transform;
      timer = view.setTimeout(tick, 1_000 / 30);
    };
    const wake = () => {
      cancel();
      if (reducedMotion.matches) for (const icon of nodes) icon.style.transform = "";
      if (nodes.size && !reducedMotion.matches && !view.document.hidden) timer = view.setTimeout(tick, 1_000 / 30);
    };
    view.document.addEventListener("visibilitychange", wake);
    reducedMotion.addEventListener("change", wake);
    clock = { nodes, wake, stop: () => {
      cancel();
      view.document.removeEventListener("visibilitychange", wake);
      reducedMotion.removeEventListener("change", wake);
      clocks.delete(view);
    } };
    clocks.set(view, clock);
  }
  const previousTransform = node.style.transform;
  clock.nodes.add(node);
  if (clock.nodes.size === 1) clock.wake();
  return () => {
    node.style.transform = previousTransform;
    clock.nodes.delete(node);
    if (!clock.nodes.size) clock.stop();
  };
}
