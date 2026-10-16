/**
 * 工具条按钮分组分隔线。
 *
 * 设备配套 / 备件管理 / 外协加工三个页签的顶部工具条原来是 7~10 个同等视觉权重的按钮
 * 挤在一行——设备管理类、分类/工序管理类、导出类混在一起，窄屏换行后更难分辨。
 * 用一条竖线把它们分组，不引入新的交互，只是给眼睛一个停顿点。
 */
export default function ToolbarDivider() {
  return <span className="h-5 w-px bg-border self-center shrink-0" aria-hidden="true" />
}
