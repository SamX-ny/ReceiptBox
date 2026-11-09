/**
 * 轻量 Canvas 2D 图表组件（无第三方依赖）。
 *
 * <rb-chart type="bar" data="{{series}}" height="320" />
 *   data: [{ label: '1', value: 12.5, title: '11月1日', sub: 'Woolworths' }]
 *   type=line 时可提供 date（YYYY-MM-DD），横轴按真实时间间隔排布。
 *
 * 视觉规范：单一系列色、细线（2px）、≥8px 标记点带 2px 底色描边、
 * 柱子顶端 4px 圆角并贴合基线、网格与坐标轴弱化；点按显示数值提示。
 */

const format = require('../../utils/format');
const dates = require('../../shared/dates');

const THEMES = {
  light: { surface: '#ffffff', series: '#2a78d6', grid: '#ecebe7', axis: '#8a8984', text: '#52514e' },
  dark: { surface: '#1a1a19', series: '#3987e5', grid: '#2e2e2c', axis: '#8f8e88', text: '#c3c2b7' }
};

function niceStep(range, ticks) {
  const raw = range / ticks;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  return step * mag;
}

function niceScale(min, max, ticks, zeroBased) {
  if (zeroBased) min = 0;
  if (max <= min) {
    max = min + (min === 0 ? 10 : Math.abs(min) * 0.2);
    if (!zeroBased) min = Math.max(0, min - (max - min));
  }
  const step = niceStep(max - min, ticks);
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const out = [];
  for (let v = lo; v <= hi + step / 2; v += step) out.push(Math.round(v * 100) / 100);
  return { min: lo, max: hi, ticks: out, step: step };
}

/** 坐标轴金额：步长小于 1 时保留小数（如价格走势 $3.50 / $4.00），大额用 k 简写 */
function axisLabel(v, step) {
  if (v >= 1000 || step >= 1) return format.shortMoney(v);
  return format.money(v);
}

function roundTopRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h);
  ctx.beginPath();
  ctx.moveTo(x, y + h);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h);
  ctx.closePath();
  ctx.fill();
}

Component({
  properties: {
    type: { type: String, value: 'bar' },
    data: { type: Array, value: [] },
    height: { type: Number, value: 320 },
    emptyText: { type: String, value: '暂无数据' },
    zeroBased: { type: Boolean, value: true }
  },

  data: {
    tip: null,
    empty: false
  },

  observers: {
    'data, type': function () {
      this.setData({ tip: null, empty: !this.hasData() });
      this.draw();
    }
  },

  lifetimes: {
    attached() {
      this._onTheme = () => this.draw();
      if (wx.onThemeChange) wx.onThemeChange(this._onTheme);
    },
    ready() {
      this.init();
    },
    detached() {
      if (wx.offThemeChange && this._onTheme) wx.offThemeChange(this._onTheme);
    }
  },

  methods: {
    hasData() {
      const d = this.properties.data || [];
      return d.some((p) => Number(p.value) > 0);
    },

    init() {
      this.createSelectorQuery()
        .select('#rb-canvas')
        .fields({ node: true, size: true })
        .exec((res) => {
          const r = res && res[0];
          if (!r || !r.node) return;
          const dpr = (wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()).pixelRatio || 2;
          const canvas = r.node;
          canvas.width = r.width * dpr;
          canvas.height = r.height * dpr;
          this._canvas = canvas;
          this._ctx = canvas.getContext('2d');
          this._ctx.scale(dpr, dpr);
          this._w = r.width;
          this._h = r.height;
          this.draw();
        });
    },

    theme() {
      const info = wx.getAppBaseInfo ? wx.getAppBaseInfo() : wx.getSystemInfoSync();
      return THEMES[info.theme === 'dark' ? 'dark' : 'light'];
    },

    layout() {
      const pad = { left: 40, right: 12, top: 14, bottom: 24 };
      return {
        pad: pad,
        x0: pad.left,
        x1: this._w - pad.right,
        y0: pad.top,
        y1: this._h - pad.bottom
      };
    },

    draw() {
      const ctx = this._ctx;
      if (!ctx) return;
      const t = this.theme();
      ctx.clearRect(0, 0, this._w, this._h);
      const data = this.properties.data || [];
      if (!data.length) return;

      const L = this.layout();
      const values = data.map((d) => Number(d.value) || 0);
      const isLine = this.properties.type === 'line';
      const scale = niceScale(
        isLine ? Math.min.apply(null, values) : 0,
        Math.max.apply(null, values),
        3,
        !isLine || this.properties.zeroBased
      );
      const yOf = (v) => L.y1 - (v - scale.min) / (scale.max - scale.min) * (L.y1 - L.y0);
      this._scale = scale;

      // 网格与纵轴刻度
      ctx.font = '10px sans-serif';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'right';
      ctx.lineWidth = 1;
      scale.ticks.forEach((v) => {
        const y = Math.round(yOf(v)) + 0.5;
        ctx.strokeStyle = t.grid;
        ctx.beginPath();
        ctx.moveTo(L.x0, y);
        ctx.lineTo(L.x1, y);
        ctx.stroke();
        ctx.fillStyle = t.axis;
        ctx.fillText(axisLabel(v, scale.step), L.x0 - 6, y);
      });

      if (isLine) this.drawLine(ctx, t, L, data, yOf);
      else this.drawBars(ctx, t, L, data, yOf);
    },

    xLabelStep(n) {
      return n <= 8 ? 1 : Math.ceil(n / 7);
    },

    drawBars(ctx, t, L, data, yOf) {
      const n = data.length;
      const slot = (L.x1 - L.x0) / n;
      const barW = Math.max(2, Math.min(slot - 2, slot * 0.64, 22));
      const active = this.data.tip ? this.data.tip.index : -1;
      const step = this.xLabelStep(n);
      this._points = [];
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      data.forEach((d, i) => {
        const cx = L.x0 + slot * (i + 0.5);
        const v = Number(d.value) || 0;
        const y = yOf(v);
        this._points.push({ x: cx, y: y });
        if (v > 0) {
          ctx.globalAlpha = active >= 0 && active !== i ? 0.35 : 1;
          ctx.fillStyle = t.series;
          roundTopRect(ctx, cx - barW / 2, y, barW, Math.max(1, L.y1 - y), 4);
          ctx.globalAlpha = 1;
        }
        if (i % step === 0) {
          ctx.fillStyle = t.axis;
          ctx.fillText(d.label, cx, L.y1 + 6);
        }
      });
    },

    drawLine(ctx, t, L, data, yOf) {
      const n = data.length;
      const useDates = data.every((d) => d.date);
      const span = useDates ? Math.max(1, dates.daysBetween(data[0].date, data[n - 1].date)) : Math.max(1, n - 1);
      const inset = 10;
      const xOf = (d, i) => {
        const frac = n === 1 ? 0.5 : (useDates ? dates.daysBetween(data[0].date, d.date) : i) / span;
        return L.x0 + inset + frac * (L.x1 - L.x0 - inset * 2);
      };
      this._points = data.map((d, i) => ({ x: xOf(d, i), y: yOf(Number(d.value) || 0) }));

      ctx.strokeStyle = t.series;
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      this._points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.stroke();

      const active = this.data.tip ? this.data.tip.index : -1;
      this._points.forEach((p, i) => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, i === active ? 6 : 4, 0, Math.PI * 2);
        ctx.fillStyle = t.series;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = t.surface;
        ctx.stroke();
      });

      // 横轴：首尾两个日期标签，避免拥挤
      ctx.fillStyle = t.axis;
      ctx.textBaseline = 'top';
      ctx.textAlign = 'left';
      ctx.fillText(data[0].label, Math.max(L.x0, this._points[0].x - 12), L.y1 + 6);
      if (n > 1) {
        ctx.textAlign = 'right';
        ctx.fillText(data[n - 1].label, Math.min(L.x1, this._points[n - 1].x + 12), L.y1 + 6);
      }
    },

    onTouch(e) {
      if (!this._points || !this._points.length || !this.hasData()) return;
      const touch = e.touches[0];
      const x = touch.x !== undefined ? touch.x : touch.clientX;
      let best = 0;
      let bestD = Infinity;
      this._points.forEach((p, i) => {
        const d = Math.abs(p.x - x);
        if (d < bestD) { bestD = d; best = i; }
      });
      if (this.data.tip && this.data.tip.index === best) return;
      const d = this.properties.data[best];
      const p = this._points[best];
      const left = Math.min(Math.max(p.x, 50), this._w - 50);
      this.setData({
        tip: {
          index: best,
          left: left,
          top: Math.max(p.y - 8, 40),
          title: d.title || d.label,
          value: format.money(d.value),
          sub: d.sub || ''
        }
      });
      this.draw();
      this.triggerEvent('select', { index: best, item: d });
    }
  }
});
