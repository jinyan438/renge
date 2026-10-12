import { Maximize, Minus, Plus, X } from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./chat-image-preview.css";

function ChatImagePreview({ src, alt, onClose }: {
  src: string;
  alt: string;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [zoom, setZoom] = useState(1);
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current!;
    const stage = stageRef.current!;
    dialog.showModal();
    closeRef.current?.focus({ preventScroll: true });
    const observer = new ResizeObserver(([entry]) => {
      setStageSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(stage);
    return () => {
      observer.disconnect();
      dialog.close();
    };
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    if (stage) {
      stage.scrollLeft = (stage.scrollWidth - stage.clientWidth) / 2;
      stage.scrollTop = (stage.scrollHeight - stage.clientHeight) / 2;
    }
  }, [zoom]);

  const scale = imageSize.width && stageSize.width
    ? Math.min(stageSize.width / imageSize.width, stageSize.height / imageSize.height) * zoom
    : 0;
  const close = () => dialogRef.current?.close();

  return createPortal(
    <dialog
      ref={dialogRef}
      className="chat-image-preview-dialog"
      aria-label={`图片预览：${alt}`}
      onClose={(event) => {
        // Strict Mode may reopen the dialog before a queued close event arrives.
        if (!event.currentTarget.open) onClose();
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key !== "Tab") return;
        const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
        const first = buttons[0];
        const last = buttons[buttons.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
      onClick={(event) => {
        event.stopPropagation();
        if (event.target === event.currentTarget) close();
      }}
    >
      <header className="chat-image-preview-toolbar">
        <strong title={alt}>{alt}</strong>
        <div className="chat-image-preview-controls">
          <button type="button" aria-label="缩小图片" disabled={zoom <= 1 || failed} onClick={() => setZoom((value) => Math.max(1, value - 0.5))}>
            <Minus size={18} />
          </button>
          <span aria-live="polite">{zoom}×</span>
          <button type="button" aria-label="放大图片" disabled={zoom >= 4 || failed} onClick={() => setZoom((value) => Math.min(4, value + 0.5))}>
            <Plus size={18} />
          </button>
          <button type="button" aria-label="适应窗口" title="适应窗口" disabled={failed} onClick={() => setZoom(1)}>
            <Maximize size={18} />
          </button>
          <button ref={closeRef} type="button" aria-label="关闭图片预览" onClick={close}>
            <X size={20} />
          </button>
        </div>
      </header>
      <div ref={stageRef} className="chat-image-preview-stage">
        <div className="chat-image-preview-canvas" onClick={(event) => {
          if (event.target === event.currentTarget) close();
        }}>
          {failed ? <p role="status">图片加载失败，请关闭后重试。</p> : (
            <img
              src={src}
              alt={alt}
              draggable={false}
              className={zoom > 1 ? "zoomed" : undefined}
              style={scale ? { width: imageSize.width * scale, height: imageSize.height * scale } : undefined}
              onLoad={(event) => setImageSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
              onError={() => setFailed(true)}
              onClick={() => setZoom((value) => value === 1 ? 2 : 1)}
            />
          )}
        </div>
      </div>
    </dialog>,
    document.body,
  );
}

export const ChatPreviewImage = memo(function ChatPreviewImage({ src, alt, className, loading }: {
  src: string;
  alt: string;
  className?: string;
  loading?: "lazy" | "eager";
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="chat-image-preview-trigger"
        aria-label={`放大查看：${alt}`}
        aria-haspopup="dialog"
        title="点击放大查看"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen(true);
        }}
      >
        <img src={src} alt={alt} className={className} loading={loading} />
      </button>
      {open && <ChatImagePreview src={src} alt={alt} onClose={() => setOpen(false)} />}
    </>
  );
});
