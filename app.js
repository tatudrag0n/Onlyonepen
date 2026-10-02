/**
 * Only One Pen
 * 一本のペン。やり直しはない。
 *
 * 固定値（ユーザーが変更できないもの）
 */
const PEN_SIZE = 5;
const ERASER_SIZE = 22;
const ERASER_ALPHA = 0.65; // 1回こするごとに線の濃さが (1 - 0.65) 倍になる
const INITIAL_COLOR = "#171717";
const BACKGROUND_COLOR = "#ffffff";
const MAX_CANVAS_WIDTH = 1600;
const MAX_CANVAS_HEIGHT = 1100;

const MODE = { PEN: "PEN", ERASER: "ERASER" };

const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d", { willReadFrequently: false });

// 消しゴム用の作業バッファ。1回のなぞり=1回のフェードにするために使う
const scratch = document.createElement("canvas");
const scratchCtx = scratch.getContext("2d");
const before = document.createElement("canvas");
const beforeCtx = before.getContext("2d");

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
  lastX: 0, // 直前の入力点
  lastY: 0,
  drawX: 0, // 実際に描画した線の終端
  drawY: 0,
  erasing: false, // 消しゴム 表示中かどうか
  width: 0,
  height: 0,
  dpr: 1,
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

  state.width = w;
  state.height = h;
  state.dpr = dpr;

  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // 背景は白。消しゴムは白を薄く重ねる方式
  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
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

/** ペン描画は直接、消しゴムは作業バッファに描く */
function targetCtx() {
  return state.mode === MODE.ERASER ? scratchCtx : ctx;
}

function applyStrokeStyle(target) {
  target.globalCompositeOperation = "source-over";
  target.globalAlpha = 1; // 濃さは合成時に掛ける
  target.strokeStyle = state.mode === MODE.ERASER ? BACKGROUND_COLOR : state.color;
  target.fillStyle = target.strokeStyle;
  target.lineWidth = currentSize();
  target.lineCap = "round";
  target.lineJoin = "round";
}

function dot(target, x, y) {
  target.beginPath();
  target.arc(x, y, currentSize() / 2, 0, Math.PI * 2);
  target.fill();
}

/**
 * 直線ではなく「前点を制御点にした二次曲線」を描く。
 * 線分は連続して繋がるため、曲線を描いても角が出ない。
 */
function curveStep(target, x, y) {
  const midX = (state.lastX + x) / 2;
  const midY = (state.lastY + y) / 2;

  target.beginPath();
  target.moveTo(state.drawX, state.drawY);
  target.quadraticCurveTo(state.lastX, state.lastY, midX, midY);
  target.stroke();

  state.drawX = midX;
  state.drawY = midY;
  state.lastX = x;
  state.lastY = y;
}

function positionOf(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

/* ------------------------------------------------------------------ */
/* eraser compositing                                                  */
/* ------------------------------------------------------------------ */

/** なぞり始める前の状態を控えておく */
function beginErase() {
  scratch.width = before.width = canvas.width;
  scratch.height = before.height = canvas.height;
  scratchCtx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
  scratchCtx.clearRect(0, 0, state.width, state.height);
  beforeCtx.drawImage(canvas, 0, 0);
  state.erasing = true;
}

/**
 * 作業バッファを「1回分だけ」合成する。
 * ゆっくりなぞっても、同じ场所を何度通っても濃さは1回分だけ減る。
 */
function renderErase() {
  if (!state.erasing) return;
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(before, 0, 0);
  ctx.globalAlpha = ERASER_ALPHA;
  ctx.drawImage(scratch, 0, 0);
  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* pointer events                                                      */
/* ------------------------------------------------------------------ */

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

  if (state.mode === MODE.ERASER) beginErase();

  const target = targetCtx();
  applyStrokeStyle(target);

  const { x, y } = positionOf(event);
  state.lastX = x;
  state.lastY = y;
  state.drawX = x;
  state.drawY = y;
  dot(target, x, y); // 単一点でも点が描かれる

  renderErase();
}

function onPointerMove(event) {
  if (!state.drawing || event.pointerId !== state.pointerId) return;
  event.preventDefault();

  const target = targetCtx();

  // 高頻度のpointermoveを分割してなめらかに
  const events =
    typeof event.getCoalescedEvents === "function" ? event.getCoalescedEvents() : [];

  if (events.length > 1) {
    for (const e of events) {
      const { x, y } = positionOf(e);
      curveStep(target, x, y);
    }
  } else {
    const { x, y } = positionOf(event);
    curveStep(target, x, y);
  }

  renderErase();
}

function endStroke(event) {
  if (event && event.pointerId !== state.pointerId) return;

  if (state.drawing) {
    // 中間点で止まった分だけ、最後の入力点まで確かに延長する
    const target = targetCtx();
    target.beginPath();
    target.moveTo(state.drawX, state.drawY);
    target.lineTo(state.lastX, state.lastY);
    target.stroke();
  }

  renderErase();

  state.drawing = false;
  state.pointerId = null;
  state.erasing = false;
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