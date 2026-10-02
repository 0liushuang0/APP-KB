import { useQuery } from '@tanstack/react-query'
import { paramTemplateApi } from '../api/services'
import { toList } from '../utils/apiList'

/**
 * 产品分类的唯一来源：需求模板表。
 *
 * 为什么是它而不是再建一张字典表：
 * 分类之所以有意义，是因为每个分类背后有一套参数字段定义 ——
 * 「装备/矫直设备」意味着辊数、板厚、屈服强度这一组参数。
 * 没有字段定义的分类，需求进来无法结构化，方案也无从比对，
 * 那它就只是个标签。所以「建一个分类」和「建一份模板」本来就是同一件事。
 *
 * 此前的状况是同一套分类被抄了三份且互不相同：
 *   · 需求模板页  17 项（写死）
 *   · 产品管理页   8 项（写死，含模板里根本没有的「装备/燃油输送」）
 *   · 客户需求页   7 项（写死，而且是招标文件/技术规范这类**来源类型**，
 *                        与库里实际存的产品大类完全对不上）
 * 结果就是同一台设备在三个模块里挂在三个名字下，串不起来。
 */
export function useProductCategories() {
  const { data, isLoading } = useQuery({
    queryKey: ['product-categories'],
    queryFn: () => paramTemplateApi.categories(),
    // 分类不常变，缓存久一点，避免每个表单都打一次
    staleTime: 5 * 60_000,
  })

  const categories = toList<string>(data)

  return {
    categories,
    isLoading,
    /** 直接给 FormSelect / datalist 用 */
    options: categories.map((c) => ({
      value: c,
      label: c.includes('/') ? c.split('/').join(' / ') : c,
    })),
  }
}

/**
 * 合并历史数据里出现过、但模板中已不存在的分类。
 *
 * 老产品可能挂在一个后来被删掉或改名的分类上。直接只用模板列表的话，
 * 编辑这条产品时下拉框里选不到它当前的分类，一保存就被悄悄改成别的值。
 */
export function withLegacyCategory(
  options: { value: string; label: string }[],
  current?: string,
) {
  if (!current || options.some((o) => o.value === current)) return options
  return [...options, { value: current, label: `${current}（模板已移除）` }]
}
