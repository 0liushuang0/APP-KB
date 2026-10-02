/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
        serif: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Microsoft YaHei', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      colors: {
        // ── 品牌 ──────────────────────────────────────────────────
        // BOYA 品牌紫：用于主操作、当前导航和知识引用。
        // 50/100/200 是浅色底（hover/选中/标签），深色下需要更暗的底，走 CSS 变量。
        accent: {
          50: 'var(--color-accent-50, #f5f3ff)',
          100: 'var(--color-accent-100, #ede9fe)',
          200: 'var(--color-accent-200, #ddd6fe)',
          300: '#c4b5fd',
          400: '#a78bfa',
          500: '#7c3aed',
          600: '#6d28d9',
          700: '#5b21b6',
          800: '#4c1d95',
          900: '#3b176b',
        },

        // ── 中性：全站唯一灰阶，不要再引入 slate / gray ──────────────
        ink: {
          DEFAULT: 'var(--color-ink, #0b0d12)',         // 主文本
          soft: 'var(--color-ink-soft, #3a3f4a)',       // 次级文本
        },
        muted: 'var(--color-muted, #6b7280)',       // 弱化文本 / 标签（canvas 上对比度 4.9:1，达 WCAG AA）
        canvas: 'var(--color-canvas, #f7f6f2)',      // 页面底色
        surface: 'var(--color-surface, #ffffff)',     // 卡片 / 浮层
        subtle: 'var(--color-subtle, #faf9f6)',      // 只读区 / 斑马纹
        border: 'var(--color-border, #e6e4df)',      // 常规边框
        divider: 'var(--color-divider, #f0eeea)',     // 轻分隔线

        // ── 状态：语义色，替代散落的 green-100 / red-700 ─────────────
        // 全部走 CSS 变量，在 index.css 的 :root / .dark 下切换明暗
        success: { bg: 'var(--color-success-bg, #ecfdf5)', fg: 'var(--color-success-fg, #047857)', line: 'var(--color-success-line, #a7f3d0)' },
        warning: { bg: 'var(--color-warning-bg, #fffbeb)', fg: 'var(--color-warning-fg, #b45309)', line: 'var(--color-warning-line, #fde68a)' },
        danger:  { bg: 'var(--color-danger-bg, #fef2f2)', fg: 'var(--color-danger-fg, #b91c1c)', line: 'var(--color-danger-line, #fecaca)' },
        info:    { bg: 'var(--color-info-bg, #eff6ff)', fg: 'var(--color-info-fg, #1d4ed8)', line: 'var(--color-info-line, #bfdbfe)' },
        neutral: { bg: 'var(--color-neutral-bg, #f3f4f6)', fg: 'var(--color-neutral-fg, #4b5563)', line: 'var(--color-neutral-line, #e5e7eb)' },

        // ── 数据可视化：5 序列分类色 ──────────────────────────────
        // 已通过色觉安全校验（亮度带 / 彩度下限 / CVD 相邻区分 / 对比度）。
        // 按固定顺序取用，不要循环复用；第 6 个序列请归入「其他」或改用小倍数图。
        // 注意 viz-2 曾用 #0e7490，彩度不足会读成灰色，已上调为 #0891b2。
        viz: {
          1: '#6d28d9',
          2: '#0891b2',
          3: '#ea580c',
          4: '#059669',
          5: '#b45309',
        },

        sidebar: {
          950: '#11151f',
          900: '#161b26',
          800: '#1e2330',
          700: '#272d3c',
        },
      },
      boxShadow: {
        card: '0 1px 2px rgba(11,13,18,.04), 0 1px 3px rgba(11,13,18,.06)',
        pop: '0 12px 40px rgba(11,13,18,.12)',
      },
      borderRadius: {
        xl: '12px',
      },
      fontSize: {
        'caption': ['0.6875rem', { lineHeight: '1.5' }],     // 11px - 标注、徽标
        'label': ['0.75rem', { lineHeight: '1.5' }],          // 12px - 标签、表头
        'body-sm': ['0.8125rem', { lineHeight: '1.5' }],      // 13px - 紧凑正文
        'body': ['0.875rem', { lineHeight: '1.5' }],           // 14px - 标准正文
        'heading-sm': ['1.125rem', { lineHeight: '1.4' }],    // 18px - 小标题
        'heading-md': ['1.25rem', { lineHeight: '1.35' }],    // 20px - 中标题
        'heading-lg': ['1.375rem', { lineHeight: '1.3' }],    // 22px - 大标题
      },
    },
  },
  plugins: [],
}
