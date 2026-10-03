/**
 * Only One Pen
 * 一本のペン。やり直しはない。
 *
 * 固定値（ユーザーが変更できないもの）
 */
const PEN_SIZE = 5;
const ERASER_SIZE = 22;
const ERASER_ALPHA = 0.65; // 1往復するごとに残りが (1 - 0.65) 倍。約4往復で消える
const ERASE_STEP = ERASER_SIZE * 0.4; // 点を置く間隔
// 1往復で同じ場所が薄くなる度合いを補正し、「1往復 = ERASER_ALPHA」にする
const ERASE_DAB_ALPHA = 1 - Math.pow(1 - ERASER_ALPHA, ERASE_STEP / ERASER_SIZE);
const INITIAL_COLOR = "#171717";
const BACKGROUND_COLOR = "#ffffff";
const MAX_CANVAS_WIDTH = 1600;
const MAX_CANVAS_HEIGHT = 1100;

const MODE = { PEN: "PEN", ERASER: "ERASER" };

const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d", { willReadFrequently: false });

// 描画は ink に保存し、消しゴムは eraseMask に「消した割合」を保存する。
// 表示は 「ink から eraseMask の割合だけ抜き取る」ことで毎回正しく合成される。
const ink = document.createElement("canvas");
const inkCtx = ink.getContext("2d");
const eraseMask = document.createElement("canvas");
const maskCtx = eraseMask.getContext("2d");

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
  dabX: 0, // 消しゴムを最後に置いた位置
  dabY: 0,
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

function sizeBuffer(buffer, context, w, h, dpr) {
  buffer.width = Math.floor(w * dpr);
  buffer.height = Math.floor(h * dpr);
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.lineCap = "round";
  context.lineJoin = "round";
}

function resizeCanvas() {
  const { w, h } = cssSize();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  state.width = w;
  state.height = h;
  state.dpr = dpr;

  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  sizeBuffer(canvas, ctx, w, h, dpr);
  sizeBuffer(ink, inkCtx, w, h, dpr);
  sizeBuffer(eraseMask, maskCtx, w, h, dpr);

  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
  ctx.clearRect(0, 0, w, h);
  inkCtx.clearRect(0, 0, w, h);
  maskCtx.clearRect(0, 0, w, h);
}

/* ------------------------------------------------------------------ */
/* display compositing                                                 */
/* ------------------------------------------------------------------ */

/**
 * ink から eraseMask の割合だけを引き、表示用キャンバスに描く。
 * 消された部分は透明になり、CSS の白背景が透ける。
 */
function paintDisplay() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(ink, 0, 0);
  ctx.globalCompositeOperation = "destination-out";
  ctx.drawImage(eraseMask, 0, 0);
  ctx.globalCompositeOperation = "source-over";
  ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
}

let flattenQueued = false;
function queueDisplay() {
  if (flattenQueued) return;
  flattenQueued = true;
  requestAnimationFrame(() => {
    flattenQueued = false;
    paintDisplay();
  });
}

/* ------------------------------------------------------------------ */
/* drawing                                                             */
/* ------------------------------------------------------------------ */

function currentSize() {
  return state.mode === MODE.ERASER ? ERASER_SIZE : PEN_SIZE;
}

function applyStrokeStyle(context) {
  context.globalCompositeOperation = "source-over";
  context.globalAlpha = 1;
  context.strokeStyle = state.mode === MODE.ERASER ? BACKGROUND_COLOR : state.color;
  context.fillStyle = context.strokeStyle;
  context.lineWidth = currentSize();
  context.lineCap = "round";
  context.lineJoin = "round";
}

function dot(context, x, y) {
  context.beginPath();
  context.arc(x, y, currentSize() / 2, 0, Math.PI * 2);
  context.fill();
}

/**
 * 直線ではなく「前点を制御点にした二次曲線」を描く。
 * 線分は連続して繋がるため、曲線を描いても角が出ない。
 */
function curveStep(x, y) {
  const midX = (state.lastX + x) / 2;
  const midY = (state.lastY + y) / 2;

  for (const context of penTargets()) {
    context.beginPath();
    context.moveTo(state.drawX, state.drawY);
    context.quadraticCurveTo(state.lastX, state.lastY, midX, midY);
    context.stroke();
  }

  state.drawX = midX;
  state.drawY = midY;
  state.lastX = x;
  state.lastY = y;
}

/** ペンは ink（保存用）と表示用の2枚に描く */
function penTargets() {
  return [inkCtx, ctx];
}

function positionOf(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

/* ------------------------------------------------------------------ */
/* eraser                                                              */
/* ------------------------------------------------------------------ */

/**
 * 移動距離に応じて点を等間隔に置く。
 * ゆっくり動いても速く動っても、1往復あたり同じ回数だけ「消した割合」が乗る。
 */
function eraseTo(x, y) {
  const dx = x - state.dabX;
  const dy = y - state.dabY;
  const distance = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(distance / ERASE_STEP));

  maskCtx.globalCompositeOperation = "source-over";
  maskCtx.globalAlpha = ERASE_DAB_ALPHA;
  maskCtx.fillStyle = BACKGROUND_COLOR;

  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    const px = state.dabX + dx * t;
    const py = state.dabY + dy * t;
    maskCtx.beginPath();
    maskCtx.arc(px, py, ERASER_SIZE / 2, 0, Math.PI * 2);
    maskCtx.fill();
  }

  maskCtx.globalAlpha = 1;
  state.dabX = x;
  state.dabY = y;
  queueDisplay();
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

  const { x, y } = positionOf(event);
  state.lastX = x;
  state.lastY = y;
  state.drawX = x;
  state.drawY = y;
  state.dabX = x;
  state.dabY = y;

  if (state.mode === MODE.ERASER) {
    eraseTo(x, y);
    return;
  }

  applyStrokeStyle(inkCtx);
  applyStrokeStyle(ctx);
  dot(inkCtx, x, y); // 単一点でも点が描かれる
  dot(ctx, x, y);
}

function onPointerMove(event) {
  if (!state.drawing || event.pointerId !== state.pointerId) return;
  event.preventDefault();

  if (state.mode === MODE.ERASER) {
    // 高頻度のpointermoveをまとめて処理
    const events =
      typeof event.getCoalescedEvents === "function" ? event.getCoalescedEvents() : [];
    const list = events.length > 0 ? events : [event];

    for (const e of list) {
      const { x, y } = positionOf(e);
      eraseTo(x, y);
    }
    return;
  }

  const events =
    typeof event.getCoalescedEvents === "function" ? event.getCoalescedEvents() : [];

  if (events.length > 1) {
    for (const e of events) {
      const { x, y } = positionOf(e);
      curveStep(x, y);
    }
  } else {
    const { x, y } = positionOf(event);
    curveStep(x, y);
  }
}

function endStroke(event) {
  if (event && event.pointerId !== state.pointerId) return;

  if (state.drawing && state.mode === MODE.PEN) {
    // 中間点で止まった分だけ、最後の入力点まで確かに延長する
    for (const context of penTargets()) {
      context.beginPath();
      context.moveTo(state.drawX, state.drawY);
      context.lineTo(state.lastX, state.lastY);
      context.stroke();
    }
  }

  if (state.mode === MODE.ERASER) paintDisplay();

  state.drawing = false;
  state.pointerId = null;
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

/** 透明部分を白に置き換えてPNG化する（キャンバスの状態は変更しない） */
function savePng() {
  const flat = document.createElement("canvas");
  flat.width = canvas.width;
  flat.height = canvas.height;
  const flatCtx = flat.getContext("2d");
  flatCtx.fillStyle = BACKGROUND_COLOR;
  flatCtx.fillRect(0, 0, flat.width, flat.height);
  flatCtx.drawImage(canvas, 0, 0);

  flat.toBlob((blob) => {
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
paintDisplay();