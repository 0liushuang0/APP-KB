import { Outlet, NavLink, useLocation } from 'react-router-dom'
import { Activity, Archive, Hash, Info, ScrollText, Settings, Sparkles, DollarSign, Trash2, ShieldCheck, MapPin } from 'lucide-react'
import ZhManagedNotice from '../lib/ZhManagedNotice'

const tabs = [
  { path: '/settings', label: '系统信息', icon: Info },
  { path: '/settings/security', label: '安全设置', icon: ShieldCheck },
  { path: '/settings/config', label: '系统参数', icon: Settings },
  { path: '/settings/ai', label: 'AI 配置', icon: Sparkles },
  { path: '/settings/budget', label: 'AI 预算', icon: DollarSign },
  { path: '/settings/numbering', label: '编号规则', icon: Hash },
  { path: '/settings/regions', label: '区域字典', icon: MapPin },
  // 回收站排在备份还原旁边：都是"数据找得回来"这一类事，用户会往一处找
  { path: '/settings/recycle-bin', label: '回收站', icon: Trash2 },
  { path: '/settings/backup', label: '备份还原', icon: Archive },
  { path: '/settings/metrics', label: '使用效能', icon: Activity },
  { path: '/settings/audit', label: '操作记录', icon: ScrollText },
]

export default function SettingsLayout() {
  const location = useLocation()

  return (
    <div className="h-full">
      <ZhManagedNotice url="/api/system-configs-managed" />
      {/* 页面标题已移至顶栏面包屑（系统 / 系统设置），此处不再重复 */}
      <div className="flex flex-col lg:flex-row gap-6">
        <aside className="lg:w-56 shrink-0">
          <nav className="bg-surface border border-border rounded-lg overflow-hidden">
            {tabs.map((tab) => (
              <NavLink
                key={tab.path}
                to={tab.path}
                end={tab.path === '/settings'}
                className={() =>
                  `flex items-center gap-3 px-4 py-3 text-sm border-b border-border last:border-b-0 transition-colors ${
                    (tab.path === '/settings' ? location.pathname === '/settings' : location.pathname.startsWith(tab.path))
                      ? 'bg-accent-50 text-accent-700 font-medium'
                      : 'text-ink-soft hover:bg-subtle'
                  }`
                }
              >
                <tab.icon size={18} />
                {tab.label}
              </NavLink>
            ))}
          </nav>
        </aside>
        <div className="flex-1 min-w-0">
          <Outlet />
        </div>
      </div>
    </div>
  )
}
