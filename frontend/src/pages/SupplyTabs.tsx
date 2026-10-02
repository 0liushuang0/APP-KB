import { useSearchParams } from 'react-router-dom'
import { Truck, Boxes } from 'lucide-react'
import Suppliers from './Suppliers'
import Materials from './Materials'

/**
 * 供应管理 + 物料管理 统一入口（2 个 Tab）。
 *
 * Tab1 供应管理：厂家名册（含经营品类），不录价格。
 * Tab2 物料管理：物料主档 + 各厂家报价（厂家来自 Tab1），报价表即比价。
 */
export default function SupplyTabs() {
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = searchParams.get('tab') === 'materials' ? 'materials' : 'suppliers'

  const switchTab = (t: 'suppliers' | 'materials') => {
    setSearchParams(t === 'suppliers' ? {} : { tab: 'materials' }, { replace: true })
  }

  const tabs = [
    { key: 'suppliers' as const, label: '供应管理', icon: Truck, desc: '厂家名册与经营品类' },
    { key: 'materials' as const, label: '物料管理', icon: Boxes, desc: '物料规格与厂家报价' },
  ]

  return (
    <div>
      {/* Tab 栏 */}
      <div className="flex items-center gap-1 mb-4 border-b border-border">
        {tabs.map((t) => {
          const active = tab === t.key
          return (
            <button
              key={t.key}
              onClick={() => switchTab(t.key)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
                active
                  ? 'border-accent-500 text-accent-700'
                  : 'border-transparent text-muted hover:text-ink-soft'
              }`}
            >
              <t.icon size={16} />
              {t.label}
              <span className="text-caption text-muted font-normal hidden sm:inline">· {t.desc}</span>
            </button>
          )
        })}
      </div>

      {/* Tab 内容 */}
      <div>
        {tab === 'suppliers' ? <Suppliers /> : <Materials />}
      </div>
    </div>
  )
}
