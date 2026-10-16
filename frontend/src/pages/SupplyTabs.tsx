import { useSearchParams } from 'react-router-dom'
import { Truck, Boxes, Wrench, Package, Factory } from 'lucide-react'
import Suppliers from './Suppliers'
import Materials from './Materials'
import EquipmentConfig from './EquipmentConfig'
import SpareParts from './SpareParts'
import OutsourcingBoard from './OutsourcingBoard'

/**
 * 供应管理 统一入口（4 个 Tab）。
 *
 * Tab1 供应管理：厂家名册（含经营品类），不录价格。
 * Tab2 物料管理：物料主档 + 各厂家报价（厂家来自 Tab1），报价表即比价。
 * Tab3 设备配套：选设备 → 配件清单 → 每个配件选供应商 → 导出对照表（技术附件用）。
 * Tab4 备件管理：按设备维护备件清单（专业分组 + 调试/2年期备件类型）。
 */
export default function SupplyTabs() {
  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get('tab')
  const tab = tabParam === 'materials' ? 'materials' : tabParam === 'equipment' ? 'equipment' : tabParam === 'spares' ? 'spares' : tabParam === 'outsourcing' ? 'outsourcing' : 'suppliers'

  const switchTab = (t: 'suppliers' | 'materials' | 'equipment' | 'spares' | 'outsourcing') => {
    setSearchParams(t === 'suppliers' ? {} : { tab: t }, { replace: true })
  }

  const tabs = [
    { key: 'suppliers' as const, label: '供应管理', icon: Truck, desc: '厂家名册与经营品类' },
    { key: 'materials' as const, label: '物料管理', icon: Boxes, desc: '物料规格与厂家报价' },
    { key: 'equipment' as const, label: '设备配套', icon: Wrench, desc: '设备配件供应商选型' },
    { key: 'spares' as const, label: '备件管理', icon: Package, desc: '调试/2年期备件清单' },
    { key: 'outsourcing' as const, label: '外协加工', icon: Factory, desc: '供应方式与工序外协' },
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
        {tab === 'suppliers' ? <Suppliers /> : tab === 'materials' ? <Materials /> : tab === 'equipment' ? <EquipmentConfig /> : tab === 'spares' ? <SpareParts /> : <OutsourcingBoard />}
      </div>
    </div>
  )
}
