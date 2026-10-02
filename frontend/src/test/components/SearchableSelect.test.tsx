import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SearchableSelect from '../../components/SearchableSelect'

const CATEGORIES = [
  { value: '装备/矫直设备', label: '装备/矫直设备' },
  { value: '装备/剪切设备', label: '装备/剪切设备' },
  { value: '零部件/联轴器', label: '零部件/联轴器' },
]

/** 受控组件，测试里要真的把新值回写才能验证收起后的显示 */
function Harness(props: { allowCustom?: boolean; onChange?: (v: string) => void; initial?: string }) {
  const [value, setValue] = useState(props.initial ?? '')
  return (
    <SearchableSelect
      label="分类"
      value={value}
      onChange={(v) => {
        setValue(v)
        props.onChange?.(v)
      }}
      options={CATEGORIES}
      allowCustom={props.allowCustom}
      groupBySlash
    />
  )
}

describe('SearchableSelect', () => {
  it('聚焦即展开，列出全部候选', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.click(screen.getByRole('combobox'))

    expect(screen.getByRole('button', { name: '矫直设备' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '剪切设备' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '联轴器' })).toBeInTheDocument()
  })

  it('输入关键词即筛选', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    const input = screen.getByRole('combobox')
    await user.click(input)
    await user.type(input, '联轴')

    expect(screen.getByRole('button', { name: '联轴器' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '矫直设备' })).not.toBeInTheDocument()
  })

  it('点选后回填值并收起面板', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)

    await user.click(screen.getByRole('combobox'))
    await user.click(screen.getByRole('button', { name: '矫直设备' }))

    expect(onChange).toHaveBeenCalledWith('装备/矫直设备')
    expect(screen.getByRole('combobox')).toHaveValue('装备/矫直设备')
    expect(screen.queryByRole('button', { name: '剪切设备' })).not.toBeInTheDocument()
  })

  it('方向键 + 回车可选中', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)

    await user.click(screen.getByRole('combobox'))
    await user.keyboard('{ArrowDown}{Enter}')

    expect(onChange).toHaveBeenCalledWith('装备/剪切设备')
  })

  it('allowCustom 关闭时，列表外的输入不会被提交', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <>
        <Harness onChange={onChange} initial="装备/矫直设备" />
        <button>外部</button>
      </>,
    )

    const input = screen.getByRole('combobox')
    await user.click(input)
    await user.type(input, '随手打的新分类')
    await user.click(screen.getByRole('button', { name: '外部' }))

    expect(onChange).not.toHaveBeenCalled()
    // 收起后仍显示原选中项，不会被草稿输入顶掉
    expect(input).toHaveValue('装备/矫直设备')
  })

  it('allowCustom 打开时，列表外的输入提交为新值', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <>
        <Harness allowCustom onChange={onChange} />
        <button>外部</button>
      </>,
    )

    const input = screen.getByRole('combobox')
    await user.click(input)
    await user.type(input, '不锈钢')
    await user.click(screen.getByRole('button', { name: '外部' }))

    expect(onChange).toHaveBeenCalledWith('不锈钢')
    expect(input).toHaveValue('不锈钢')
  })

  it('Esc 只收面板，不冒泡给外层弹窗', async () => {
    const user = userEvent.setup()
    const onEsc = vi.fn()
    render(
      <div onKeyDown={(e) => e.key === 'Escape' && onEsc()}>
        <Harness />
      </div>,
    )

    await user.click(screen.getByRole('combobox'))
    expect(screen.getByRole('button', { name: '矫直设备' })).toBeInTheDocument()

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('button', { name: '矫直设备' })).not.toBeInTheDocument()
    expect(onEsc).not.toHaveBeenCalled()
  })

  /*
   * Modal 的「Esc 关闭」挂在 document 上（见 Modal.tsx），不是 React 树里的父节点。
   * 面板展开时按 Esc 必须只收面板 —— 否则填到一半的表单会被整个关掉。
   */
  it('面板展开时 Esc 不会触发 document 上的关闭监听', async () => {
    const user = userEvent.setup()
    const onDocEsc = vi.fn()
    const listener = (e: KeyboardEvent) => e.key === 'Escape' && onDocEsc()
    document.addEventListener('keydown', listener)
    try {
      render(<Harness />)

      await user.click(screen.getByRole('combobox'))
      await user.keyboard('{Escape}')
      expect(onDocEsc).not.toHaveBeenCalled()

      // 面板已收起，此时的 Esc 应该正常传下去关闭弹窗
      await user.keyboard('{Escape}')
      expect(onDocEsc).toHaveBeenCalledTimes(1)
    } finally {
      document.removeEventListener('keydown', listener)
    }
  })
})
