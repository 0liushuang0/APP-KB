import { useState, useEffect, useRef, type ReactNode } from 'react'
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard,
  Users,
  ClipboardList,
  FileText,
  DollarSign,
  Package,
  Truck,
  FolderKanban,
  ScrollText,
  Headset,
  FolderOpen,
  Files,
  Bot,
  Settings,
  Menu,
  X,
  Zap,
  PanelLeftClose,
  PanelLeft,
  LogOut,
  Layers,
  Calculator,
  SlidersHorizontal,
  BookOpen,
  Workflow,
  HelpCircle,
} from 'lucide-react'
import { useAuthStore } from '../store/authStore'
import { useThemeStore } from '../store/themeStore'
import { useSystemNameStore } from '../store/systemNameStore'
import ThemeToggle from './ThemeToggle'
import FullscreenToggle from './FullscreenToggle'
import NotificationBell from './NotificationBell'
import { PageActionsContext } from '../contexts/PageActionsContext'
import { PageAssistantProvider } from '../contexts/PageAssistantContext'
import AssistantWidget from './AssistantWidget'
import { isZhEmbedded, onZhTheme } from '../lib/zh-embed'

type NavItem = { path: string; label: string; icon: typeof LayoutDashboard; teamOnly?: boolean }
type NavGroup = { label: string; items: NavItem[] }

const navGroups: NavGroup[] = [
  {
    label: 'AI 工作台',
    items: [
      { path: '/', label: '业务概览', icon: Workflow },
      { path: '/ai-assistant', label: '智能问答', icon: Bot },
    ],
  },
  {
    label: '客户业务',
    items: [
      { path: '/customers', label: '客户中心', icon: Users },
      { path: '/requirements', label: '客户需求', icon: ClipboardList },
      { path: '/proposals', label: '解决方案', icon: FileText },
      { path: '/quotations', label: '报价管理', icon: DollarSign },
      { path: '/contracts', label: '合同管理', icon: ScrollText },
      { path: '/projects', label: '项目跟踪', icon: FolderKanban },
      { path: '/after-sales', label: '售后管理', icon: Headset },
    ],
  },
  {
    label: '产品方案',
    items: [
      { path: '/products', label: '产品管理', icon: Package },
      { path: '/solutions', label: '标准方案', icon: Layers },
    ],
  },
  {
    label: '知识供应',
    items: [
      { path: '/documents', label: '业务资料', icon: Files },
      { path: '/customer-docs', label: '客户资料', icon: FolderOpen },
      { path: '/knowledge', label: '知识资料', icon: BookOpen },
      { path: '/param-templates', label: '需求模板', icon: SlidersHorizontal },
      { path: '/calc-tools', label: '工程计算', icon: Calculator },
      { path: '/suppliers', label: '供应管理', icon: Truck },
      { path: '/help', label: '帮助中心', icon: HelpCircle },
    ],
  },
]

const allNavItems = navGroups.flatMap((g) => g.items)
const labelByPath: Record<string, string> = Object.fromEntries(allNavItems.map((n) => [n.path, n.label]))
const groupByPath: Record<string, string> = Object.fromEntries(
  navGroups.flatMap((g) => g.items.map((n) => [n.path, g.label])),
)

export default function Layout() {
  const location = useLocation()
  const navigate = useNavigate()
  const { user, clearAuth, appMode } = useAuthStore()
  const initTheme = useThemeStore((s) => s.initTheme)
  const systemName = useSystemNameStore((s) => s.name)
  const adminTitle = useSystemNameStore((s) => s.adminTitle)
  const systemSubtitle = useSystemNameStore((s) => s.subtitle)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(isZhEmbedded) // 被智汇工作台内嵌时默认收起为图标栏
  const [pageActions, setPageActions] = useState<ReactNode>(null)
  // 路由切换时把内容区滚回顶部：滚动容器是常驻 <main>，不重置的话
  // 从长列表页跳到别的页面会停在原来的滚动位置。
  const mainRef = useRef<HTMLElement>(null)
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 })
  }, [location.pathname])

  useEffect(() => {
    initTheme()
  }, [initTheme])

  // 单人模式下隐藏组织与权限相关入口
  const visibleGroups = navGroups
    .map((g) => ({ ...g, items: g.items.filter((n) => !(n.teamOnly && appMode === 'single')) }))
    .filter((g) => g.items.length > 0)

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/'
    if (path === '/settings') return location.pathname === '/settings'
    // /products 不应在 /products/tree 时高亮
    if (path === '/products') return location.pathname === '/products'
    return location.pathname === path || location.pathname.startsWith(`${path}/`)
  }

  const activeItem = allNavItems.find((n) => isActive(n.path))
  // /settings 及子页不在导航列表里，单独映射，避免退回「AI 工作台 / 智能问答」
  const isSettings = location.pathname === '/settings' || location.pathname.startsWith('/settings/')
  const currentLabel = isSettings ? '系统设置' : labelByPath[location.pathname] || activeItem?.label || '智能问答'
  const currentGroup = isSettings ? '系统' : (activeItem && groupByPath[activeItem.path]) || 'AI 工作台'

  // 被智汇工作台内嵌时: 主题跟随门户(只切换显示, 不改本系统保存的主题偏好)
  useEffect(() => onZhTheme((t) => document.documentElement.classList.toggle('dark', t === 'dark')), [])

  const handleLogout = async () => {
    // 先调后端清除 httpOnly Cookie
    try {
      await fetch(`${import.meta.env.VITE_API_BASE_URL || '/api'}/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      })
    } catch {
      // 即使后端调用失败也要清除本地状态
    }
    // 标记显式退出：登录页不再自动登录，防止被拉回主界面
    sessionStorage.setItem('aikb-skip-auto-login', '1')
    // 再清本地状态
    clearAuth()
    navigate('/login', { replace: true })
  }

  const displayName = adminTitle || user?.nickname || user?.username || 'Admin'
  const initials = displayName.slice(0, 1).toUpperCase()

  return (
    <div className="h-screen flex overflow-hidden bg-canvas">
      {/* WCAG 2.4.1 跳转链接：键盘用户第一个 Tab 命中，跳过侧边栏直达内容 */}
      <a href="#main-content" className="skip-link">
        跳转到主内容
      </a>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 bg-black/40 z-40 lg:hidden" onClick={() => setMobileOpen(false)} aria-hidden="true" />
      )}

      {/* Mobile trigger */}
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        className="lg:hidden fixed top-3 left-3 z-30 p-2 bg-surface border border-border rounded-lg shadow-card"
        title={"打开菜单"}
        aria-label="打开菜单"
      >
        <Menu size={18} />
      </button>

      {/* Sidebar */}
      <aside
        className={`fixed lg:static inset-y-0 left-0 z-50 zh-side ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        } ${collapsed ? 'is-mini' : ''}`}
      >
        {/* Brand */}
        <div className="zh-brand">
          <div className="zh-brand-mark">
            <Zap size={17} fill="white" />
          </div>
          <div className="zh-brand-text">
            <div className="zh-brand-name">{systemName}</div>
            <div className="zh-brand-sub">{systemSubtitle}</div>
          </div>
        </div>

        {/* Nav */}
        <nav className="zh-nav">
          {visibleGroups.map((group) => (
            <div key={group.label} className="zh-nav-group">
              <div className="zh-nav-sep" />
              <div className="zh-nav-label">{group.label}</div>
              {group.items.map((item) => {
                const Icon = item.icon
                const active = isActive(item.path)
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    onClick={() => setMobileOpen(false)}
                    title={collapsed ? item.label : undefined}
                    aria-current={active ? 'page' : undefined}
                    className={`zh-nav-item ${active ? 'is-active' : ''}`}
                  >
                    <Icon size={18} />
                    <span>{item.label}</span>
                  </Link>
                )
              })}
            </div>
          ))}
        </nav>

        {/* User */}
        <div className="zh-embed-hide zh-side-foot">
          <div className="flex items-center gap-2.5">
            <div className="zh-avatar">
              {initials}
            </div>
            <div className="zh-foot-text min-w-0 flex-1">
                <div className="zh-foot-name">{displayName}</div>
                <div className="zh-foot-sub">
                  {user?.roles?.[0]?.name || (appMode === 'single' ? '超级管理员' : '用户')}
                </div>
              </div>
            <Link
              to="/settings"
              onClick={() => setMobileOpen(false)}
              title="设置"
              aria-label="设置"
              className="zh-icon-btn"
            >
              <Settings size={15} />
            </Link>
            <button
                onClick={handleLogout}
                title="退出登录"
                className="zh-icon-btn zh-foot-extra"
              >
                <LogOut size={15} />
              </button>
          </div>
        </div>

        {/* Mobile close */}
        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          className="lg:hidden absolute top-3 right-3 text-white/50 hover:text-white"
          title={"关闭菜单"}
          aria-label="关闭菜单"
        >
          <X size={20} />
        </button>
      </aside>

      {/* Main column */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Topbar */}
        <header className="zh-top pl-14 sm:pl-3 bg-surface border-b border-border">
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="hidden lg:flex w-8 h-8 items-center justify-center rounded-lg text-muted hover:text-ink hover:bg-canvas transition-colors flex-shrink-0"
            title={"折叠侧边栏"}
            aria-label="折叠侧边栏"
          >
            {collapsed ? <PanelLeft size={17} /> : <PanelLeftClose size={17} />}
          </button>
          <div className="zh-crumb hidden sm:flex">
            <span className="zh-crumb-group">{currentGroup}</span>
            <span className="zh-crumb-sep">/</span>
            <span className="zh-crumb-page">{currentLabel}</span>
          </div>
          <div className="flex-1" />
          {/* 页面操作区（搜索/标签/新建）居中偏右，紧贴主题 */}
          {pageActions && (
            <div className="flex items-center gap-1.5 flex-shrink-0">
              {pageActions}
            </div>
          )}
          {/* 主题/放大/通知 固定最右侧 */}
          <div className="flex items-center gap-1 flex-shrink-0">
            <span className="zh-embed-hide contents"><ThemeToggle /></span>
            <FullscreenToggle />
            <NotificationBell />
          </div>
        </header>

        {/* Content —— scrollbar-gutter:stable 预留滚动条宽度，
            避免不同页面/标签内容高矮不一时滚动条出现/消失导致内容左右跳动 */}
        <main ref={mainRef} id="main-content" role="main" aria-label="主内容区" className="flex-1 overflow-y-auto [scrollbar-gutter:stable]">
          {/*
            pb-24：为右下角 AI 助手悬浮球留出安全空间，
            否则分页控件的"下一页"按钮会被悬浮球遮住。
            悬浮球 56px + bottom-6 间距 24px + 缓冲 = 96px（pb-24）。
          */}
          <div className="zh-main-inner h-full pb-24">
            <PageActionsContext.Provider value={setPageActions}>
              <PageAssistantProvider>
                <Outlet />
                {/*
                  AI 助手统一在这里渲染：页面只需用 useRegisterPageAssistant 声明
                  "我这儿有什么"，不必各自挂一遍组件。没注册上下文的页面不显示。
                */}
                <AssistantWidget />
              </PageAssistantProvider>
            </PageActionsContext.Provider>
          </div>
        </main>
      </div>
    </div>
  )
}
