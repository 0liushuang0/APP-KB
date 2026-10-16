import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import Button from './Button'
import Modal from './Modal'
import ConfirmDialog from './ConfirmDialog'
import { useEquipmentRoster } from '../hooks/useEquipmentRoster'

/**
 * 「管理设备」弹窗：设备名册改名 / 删除 / 新增，设备配套 / 备件管理 / 外协加工三个页签共用同一个组件。
 *
 * 此前只有「设备配套」页有这个入口，备件管理和外协加工的用户想改个设备名字，
 * 得先切回设备配套页才能操作——现在三个页签都能直接打开，行为（改名同步备件/外协清单、
 * 删除前提示另外两份清单各留了多少行）完全一致，不会出现"设备配套里改了名，
 * 外协加工里还是旧名"的分裂设备清单。
 */
interface Props {
  open: boolean
  onClose: () => void
  /** 新增设备：不传则只在设备名册里建一个空清单（无初始行）；传了用调用方自己的初始化逻辑 */
  onAddNew?: (name: string) => void
  /** 当前页正在查看的设备被改名/删除时，通知调用方同步自己的选中状态 */
  onRenamed?: (from: string, to: string) => void
  onDeleted?: (name: string) => void
}

export default function EquipmentManagerModal({ open, onClose, onAddNew, onRenamed, onDeleted }: Props) {
  const { equipmentNames, renameEquipment, renameEquipments, removeEquipment, keptElsewhere } = useEquipmentRoster()
  const [deleteEquip, setDeleteEquip] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<{ from: string; to: string } | null>(null)
  const [newName, setNewName] = useState('')
  const nameInputRefs = useRef<Array<HTMLInputElement | null>>([])

  const addNew = () => {
    const name = newName.trim()
    if (!name) return
    // 已存在就交给调用方自己的 addCustomEquipment 处理"切过去"，这里不重复判断
    onAddNew?.(name)
    setNewName('')
  }

  const saveManageEdits = async () => {
    const edits: Array<{ from: string; to: string }> = []
    equipmentNames.forEach((name, i) => {
      const v = nameInputRefs.current[i]?.value?.trim()
      if (v && v !== name) edits.push({ from: name, to: v })
    })
    if (!edits.length) {
      toast.info('没有修改需要保存')
      return
    }
    const toNames = edits.map((e) => e.to)
    if (new Set([...toNames, ...equipmentNames.filter((n) => !edits.some((e) => e.from === n))]).size !== equipmentNames.length) {
      toast.error('改名后出现重名，请调整')
      return
    }
    const { synced } = await renameEquipments(edits)
    for (const e of edits) onRenamed?.(e.from, e.to)
    toast.success(`已保存 ${edits.length} 项改名：${edits.map((e) => `${e.from}→${e.to}`).join('、')}${synced.length ? `（${synced.join('/')}同步改名）` : ''}`)
  }

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={`管理设备清单（${equipmentNames.length}）`}
        size="sm"
        cancelText="关闭"
        onConfirm={saveManageEdits}
        confirmText="保存修改"
        confirmVariant="primary"
      >
        <div className="space-y-1.5 max-h-80 overflow-y-auto">
          {equipmentNames.map((m, i) => (
            <div key={m + i} className="flex items-center gap-2">
              <span className="text-muted text-caption w-6 text-right tabular-nums">{i + 1}</span>
              <input
                ref={(el) => { nameInputRefs.current[i] = el }}
                defaultValue={m}
                className="eo-input !py-1 !text-sm flex-1"
                aria-label={`设备名 ${m}`}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const v = nameInputRefs.current[i]?.value?.trim()
                    if (v && v !== m) setRenaming({ from: m, to: v })
                  }
                }}
              />
              <button
                onClick={() => {
                  const v = nameInputRefs.current[i]?.value?.trim()
                  if (!v) { toast.warning('设备名不能为空'); return }
                  if (v === m) { toast.info('名称未变化'); return }
                  setRenaming({ from: m, to: v })
                }}
                className="text-muted hover:text-accent-600 p-1 shrink-0"
                title={`把「${m}」改名为输入框中的新名称`}
                aria-label={`改名 ${m}`}
              >
                <Pencil size={15} />
              </button>
              <button
                onClick={() => setDeleteEquip(m)}
                className="text-muted hover:text-danger-fg p-1 shrink-0"
                title={`删除「${m}」`}
                aria-label={`删除 ${m}`}
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-divider">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addNew()}
            placeholder="新增设备名，回车添加"
            className="eo-input !py-1 !text-sm flex-1"
            aria-label="新增设备名"
          />
          <Button size="sm" className="!py-1" onClick={addNew}>
            <Plus size={13} className="mr-0.5" /> 添加
          </Button>
        </div>
        <p className="text-caption text-muted mt-2">
          在输入框修改名称后点「保存修改」生效（单个改名也可点行尾铅笔或回车）；改名会同步备件管理与外协加工里挂在该设备下的数据。
          删除只清掉设备配套的选型记录，备件管理/外协加工里已录的数据保留不动，不影响供应管理数据。
        </p>
      </Modal>

      <ConfirmDialog
        open={!!deleteEquip}
        onClose={() => setDeleteEquip(null)}
        onConfirm={async () => {
          if (!deleteEquip) return
          const name = deleteEquip
          await removeEquipment(name)
          setDeleteEquip(null)
          onDeleted?.(name)
        }}
        title="删除设备"
        message={<>确定删除设备「{deleteEquip}」吗？</>}
        detail={(() => {
          if (!deleteEquip) return undefined
          const { spareCount, outCount } = keptElsewhere(deleteEquip)
          const kept = [spareCount ? `备件管理 ${spareCount} 行` : '', outCount ? `外协加工 ${outCount} 行` : ''].filter(Boolean)
          return `其配件与供应商选型记录将一并清除，此操作不可恢复。${kept.length ? `${kept.join('、')}保留不动，不受影响。` : ''}`
        })()}
        loading={false}
      />

      <ConfirmDialog
        open={!!renaming}
        onClose={() => setRenaming(null)}
        onConfirm={async () => {
          if (!renaming) return
          const { from, to } = renaming
          const res = await renameEquipment(from, to)
          setRenaming(null)
          if (res.ok) onRenamed?.(from, res.to)
        }}
        title="确认改名"
        confirmText="改名"
        danger={false}
        message={<>把设备「{renaming?.from}」改名为「{renaming?.to}」？</>}
        detail="其配件与选型记录保留，仅名称变化；备件管理与外协加工里挂在该设备下的数据一并改名。"
      />
    </>
  )
}
