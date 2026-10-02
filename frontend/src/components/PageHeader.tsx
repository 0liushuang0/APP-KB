import type { ReactNode } from 'react'

interface PageHeaderProps {
  title: string
  titleEm?: string
  desc?: string
  actions?: ReactNode
}

/** PageHeader — deprecated; title now shown in topbar breadcrumb. Renders nothing. */
export default function PageHeader(_props: PageHeaderProps) {
  return null
}
