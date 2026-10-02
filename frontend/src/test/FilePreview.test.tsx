import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import FilePreview, { type PreviewSibling } from '../components/FilePreview'

/**
 * 预览连续翻阅。
 *
 * 场景：一次上传十几张现场照片后，原来只能"看一张 → 关掉 → 再点下一张"，
 * 翻完一轮要点几十下。现在预览里直接给上一个/下一个。
 *
 * 这里锁住三件事：定位靠 fileId 在 siblings 里查（调用方不必维护索引）、
 * 首尾边界不越界、方向键可用。
 */
vi.mock('../api/files', () => ({
  previewUrl: (kind: string, id: string) => `/api/files/${kind}/${id}/preview`,
  officePreviewUrl: (kind: string, id: string) => `/api/files/${kind}/${id}/office`,
  downloadFile: vi.fn(),
}))

const PHOTOS: PreviewSibling[] = [
  { id: 'p1', fileName: '现场照片-1.jpg', mimeType: 'image/jpeg', fileSize: 1024 },
  { id: 'p2', fileName: '现场照片-2.jpg', mimeType: 'image/jpeg', fileSize: 2048 },
  { id: 'p3', fileName: '现场照片-3.jpg', mimeType: 'image/jpeg', fileSize: 3072 },
]

/*
 * 翻页按钮刻意渲染了两处：工具栏里一组（全屏时也够得着）、内容区两侧各一个大按钮
 * （连翻十几张时鼠标不用回到顶部）。所以断言一律用 *All* 版本，
 * 单数版的 queryByRole 遇到同名多个会直接抛错。
 */
function renderAt(index: number, onNavigate = vi.fn(), siblings: PreviewSibling[] | undefined = PHOTOS) {
  const cur = PHOTOS[index]
  const view = render(
    <FilePreview
      isOpen
      onClose={vi.fn()}
      fileKind="documents"
      fileId={cur.id}
      fileName={cur.fileName}
      mimeType={cur.mimeType}
      fileSize={cur.fileSize}
      siblings={siblings}
      onNavigate={onNavigate}
    />,
  )
  return { onNavigate, view }
}

/**
 * 一律在**本次渲染的容器**内查询，不用全局 screen。
 *
 * FilePreview 不走 portal，弹层就在 render 返回的 container 里。
 * 用 container 作用域可以彻底摆脱"上一条用例的 DOM 有没有清干净"这个变量 ——
 * 断言"某按钮不存在"时尤其重要，否则残留会让用例假失败。
 */
const inView = (view: ReturnType<typeof render>) => within(view.container)

describe('FilePreview —— 连续翻阅', () => {
  afterEach(() => cleanup())

  it('显示当前位置，便于知道还剩几张', () => {
    const { view } = renderAt(1)
    expect(inView(view).getByText('2 / 3')).toBeInTheDocument()
  })

  it('点「下一个」回传下一条记录', async () => {
    const { onNavigate, view } = renderAt(0)
    await userEvent.click(inView(view).getAllByRole('button', { name: '下一个' })[0])
    expect(onNavigate).toHaveBeenCalledWith(PHOTOS[1])
  })

  it('点「上一个」回传上一条记录', async () => {
    const { onNavigate, view } = renderAt(2)
    await userEvent.click(inView(view).getAllByRole('button', { name: '上一个' })[0])
    expect(onNavigate).toHaveBeenCalledWith(PHOTOS[1])
  })

  it('第一张时「上一个」禁用，不会越界', () => {
    const { view } = renderAt(0)
    const prev = inView(view).queryAllByRole('button', { name: '上一个' })
    expect(prev.length).toBeGreaterThan(0)
    prev.forEach((b) => expect(b).toBeDisabled())
  })

  it('最后一张时「下一个」禁用，不会越界', () => {
    const { view } = renderAt(PHOTOS.length - 1)
    const next = inView(view).queryAllByRole('button', { name: '下一个' })
    expect(next.length).toBeGreaterThan(0)
    next.forEach((b) => expect(b).toBeDisabled())
  })

  it('方向键可翻页 —— 看一批照片时手不用离开键盘', async () => {
    const { onNavigate } = renderAt(1)
    await userEvent.keyboard('{ArrowRight}')
    expect(onNavigate).toHaveBeenCalledWith(PHOTOS[2])
    onNavigate.mockClear()
    await userEvent.keyboard('{ArrowLeft}')
    expect(onNavigate).toHaveBeenCalledWith(PHOTOS[0])
  })

  it('没传 siblings 时不出现翻页（老调用方行为不变）', () => {
    // 注意不能走 renderAt 传 undefined —— 显式传 undefined 会触发默认参数，
    // siblings 反而变成整个 PHOTOS。这里直接渲染一个不带该属性的实例。
    const view = render(
      <FilePreview
        isOpen
        onClose={vi.fn()}
        fileKind="documents"
        fileId={PHOTOS[0].id}
        fileName={PHOTOS[0].fileName}
        mimeType={PHOTOS[0].mimeType}
      />,
    )
    expect(inView(view).queryAllByRole('button', { name: '下一个' })).toHaveLength(0)
    expect(inView(view).queryAllByRole('button', { name: '上一个' })).toHaveLength(0)
    expect(inView(view).queryByText(/^\d+ \/ \d+$/)).not.toBeInTheDocument()
  })

  it('当前文件不在 siblings 里时不显示翻页，而不是乱跳', () => {
    const view = render(
      <FilePreview
        isOpen
        onClose={vi.fn()}
        fileKind="documents"
        fileId="不在列表里的id"
        fileName="孤立文件.jpg"
        siblings={PHOTOS}
        onNavigate={vi.fn()}
      />,
    )
    expect(inView(view).queryAllByRole('button', { name: '下一个' })).toHaveLength(0)
  })

  it('只有一个文件时不显示翻页', () => {
    const view = render(
      <FilePreview
        isOpen
        onClose={vi.fn()}
        fileKind="documents"
        fileId="p1"
        fileName="只有这一张.jpg"
        siblings={[PHOTOS[0]]}
        onNavigate={vi.fn()}
      />,
    )
    expect(inView(view).queryAllByRole('button', { name: '下一个' })).toHaveLength(0)
  })
})
