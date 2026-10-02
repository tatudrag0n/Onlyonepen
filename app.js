/**
 * Only One Pen
 * 一本のペン。やり直しはない。
 *
 * 固定値（ユーザーが変更できないもの）
 */
const PEN_SIZE = 5;
const ERASER_SIZE = 22;
const ERASER_ALPHA = 0.18; // 1回ごすりで薄く。重ねるほど消えていく
const INITIAL_COLOR = "#171717";
const BACKGROUND_COLOR = "#ffffff";
const MAX_CANVAS_WIDTH = 1600;
const MAX_CANVAS_HEIGHT = 1100;

const MODE = { PEN: "PEN", ERASER: "ERASER" };

const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d", { willReadFrequently: false });

const colorPicker = document.getElementById("colorPicker");
const colorDot = document.getElementById("colorDot");
const colorValue = document.getElementById("colorValue");
const eraserButton = document.getElementById("eraserButton");
const eraserLabel = document.getElementById("eraserLabel");
const saveButton = document.getElementById("saveButton");
const statusEl = document.getElementById("status");

/** セッション中の状態（Undo用の履歴は持たない） */
const state = {
  color: INITIAL_COLOR,
  mode: MODE.PEN,
  drawing: false,
  pointerId: null,
  lastX: 0,
  lastY: 0,
};

/* ------------------------------------------------------------------ */
/* canvas sizing                                                       */
/* ------------------------------------------------------------------ */

function cssSize() {
  const stage = canvas.parentElement;
  const styles = getComputedStyle(stage);
  const padX =
    parseFloat(styles.paddingLeft || "0") + parseFloat(styles.paddingRight || "0");
  const padY =
    parseFloat(styles.paddingTop || "0") + parseFloat(styles.paddingBottom || "0");

  const isNarrow = window.innerWidth <= 640;
  const availableW = isNarrow ? stage.clientWidth : stage.clientWidth - padX;
  const availableH = isNarrow ? stage.clientHeight : stage.clientHeight - padY;

  const w = Math.max(1, Math.min(Math.floor(availableW), MAX_CANVAS_WIDTH));
  const h = Math.max(1, Math.min(Math.floor(availableH), MAX_CANVAS_HEIGHT));
  return { w, h };
}

function resizeCanvas() {
  const { w, h } = cssSize();
  const dpr = Math.min(window.devicePixelRatio || 1, 3);

  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // 背景は白。消しゴムは白で塗る方式
  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = BACKGROUND_COLOR;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* drawing                                                             */
/* ------------------------------------------------------------------ */

function currentSize() {
  return state.mode === MODE.ERASER ? ERASER_SIZE : PEN_SIZE;
}

function dot(x, y) {
  ctx.beginPath();
  ctx.arc(x, y, currentSize() / 2, 0, Math.PI * 2);
  ctx.fill();
}

function segment(x0, y0, x1, y1) {
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
}

function positionOf(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

function onPointerDown(event) {
  if (state.pointerId !== null) return;
  if (event.pointerType === "mouse" && event.button !== 0) return;

  event.preventDefault();
  state.pointerId = event.pointerId;
  state.drawing = true;

  try {
    canvas.setPointerCapture(event.pointerId);
  } catch (_) {
    /* capture is optional */
  }

  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = state.mode === MODE.ERASER ? ERASER_ALPHA : 1;
  ctx.strokeStyle = state.mode === MODE.ERASER ? BACKGROUND_COLOR : state.color;
  ctx.fillStyle = ctx.strokeStyle;
  ctx.lineWidth = currentSize();

  const { x, y } = positionOf(event);
  state.lastX = x;
  state.lastY = y;
  dot(x, y); // 単一点でも点が描かれる
}

function onPointerMove(event) {
  if (!state.drawing || event.pointerId !== state.pointerId) return;
  event.preventDefault();

  // 高頻度のpointermoveを分割してなめらかに
  const events =
    typeof event.getCoalescedEvents === "function" ? event.getCoalescedEvents() : [];

  if (events.length > 1) {
    for (const e of events) {
      const { x, y } = positionOf(e);
      segment(state.lastX, state.lastY, x, y);
      state.lastX = x;
      state.lastY = y;
    }
    return;
  }

  const { x, y } = positionOf(event);
  segment(state.lastX, state.lastY, x, y);
  state.lastX = x;
  state.lastY = y;
}

function endStroke(event) {
  if (event && event.pointerId !== state.pointerId) return;
  state.drawing = false;
  state.pointerId = null;
  ctx.globalAlpha = 1;
}

canvas.addEventListener("pointerdown", onPointerDown);
canvas.addEventListener("pointermove", onPointerMove);
canvas.addEventListener("pointerup", endStroke);
canvas.addEventListener("pointercancel", endStroke);
canvas.addEventListener("pointerleave", endStroke);
canvas.addEventListener("contextmenu", (e) => e.preventDefault());

/* ------------------------------------------------------------------ */
/* color / mode                                                        */
/* ------------------------------------------------------------------ */

function renderColor() {
  colorDot.style.background = state.color;
  colorValue.textContent = state.color.toUpperCase();
}

function setColor(value) {
  state.color = value;
  colorPicker.value = value;
  renderColor();
  // 色を変えたら自動的にペンモードへ戻る
  if (state.mode !== MODE.PEN) setMode(MODE.PEN);
}

function setMode(mode) {
  state.mode = mode;
  const erasing = mode === MODE.ERASER;

  eraserButton.classList.toggle("is-active", erasing);
  eraserButton.setAttribute("aria-pressed", String(erasing));
  eraserLabel.textContent = erasing ? "消しゴム ON" : "消しゴム";
  canvas.classList.toggle("is-erasing", erasing);
}

colorPicker.addEventListener("input", (e) => {
  state.color = e.target.value;
  renderColor();
  if (state.mode !== MODE.PEN) setMode(MODE.PEN);
});

eraserButton.addEventListener("click", () => {
  setMode(state.mode === MODE.ERASER ? MODE.PEN : MODE.ERASER);
});

/* ------------------------------------------------------------------ */
/* PNG save                                                            */
/* ------------------------------------------------------------------ */

function flashStatus(message) {
  statusEl.textContent = message;
  statusEl.classList.add("is-visible");
  clearTimeout(flashStatus.timer);
  flashStatus.timer = setTimeout(
    () => statusEl.classList.remove("is-visible"),
    1600
  );
}

function savePng() {
  canvas.toBlob((blob) => {
    if (!blob) {
      flashStatus("保存できませんでした");
      return;
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "only-one-pen.png";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    flashStatus("only-one-pen.png を保存しました");
  }, "image/png");
}

saveButton.addEventListener("click", savePng);

/* ------------------------------------------------------------------ */
/* init                                                                */
/* ------------------------------------------------------------------ */

let resizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(resizeCanvas, 120);
});
window.addEventListener("orientationchange", () => setTimeout(resizeCanvas, 200));

renderColor();
setMode(MODE.PEN);
resizeCanvas();