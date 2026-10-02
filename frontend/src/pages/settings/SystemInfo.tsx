import { useQuery } from '@tanstack/react-query'
import { Info, BrainCircuit, Download, Server } from 'lucide-react'
import Button from '../../components/Button'
import { systemApi } from '../../api/services'

export default function SystemInfo() {
  const { data: systemInfo } = useQuery({
    queryKey: ['system-info'],
    queryFn: () => systemApi.info(),
  })

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-surface p-6 rounded-lg border border-border">
          <div className="flex items-center gap-2 mb-4">
            <Info size={20} className="text-accent-600" />
            <h2 className="text-lg font-semibold">系统信息</h2>
          </div>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between border-b border-border pb-2">
              <span className="text-muted">系统名称</span>
              <span className="font-medium">{systemInfo?.name || 'AI 业务知识库'}</span>
            </div>
            <div className="flex justify-between border-b border-border pb-2">
              <span className="text-muted">版本</span>
              <span className="font-medium">{systemInfo?.version || '0.1.0'}</span>
            </div>
            <div className="flex justify-between border-b border-border pb-2">
              <span className="text-muted">运行模式</span>
              <span className="font-medium">{systemInfo?.mode === 'single' ? '单用户模式' : '团队模式'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">运行状态</span>
              <span className="inline-flex items-center gap-1 text-success-fg">
                <span className="w-2 h-2 bg-success-fg rounded-full" /> 正常
              </span>
            </div>
          </div>
        </div>

        <div className="bg-surface p-6 rounded-lg border border-border">
          <div className="flex items-center gap-2 mb-4">
            <BrainCircuit size={20} className="text-accent-600" />
            <h2 className="text-lg font-semibold">AI 配置</h2>
          </div>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between border-b border-border pb-2">
              <span className="text-muted">Embedding 模型</span>
              <span className="font-medium">HashingVectorizer (basic)</span>
            </div>
            <div className="flex justify-between border-b border-border pb-2">
              <span className="text-muted">LLM 路由</span>
              <span className="font-medium">本地模型 / OpenAI 兼容</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">知识库索引</span>
              <span className="font-medium text-success-fg">已启用</span>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-surface p-6 rounded-lg border border-border">
        <div className="flex items-center gap-2 mb-4">
          <Server size={20} className="text-accent-600" />
          <h2 className="text-lg font-semibold">数据管理</h2>
        </div>
        <p className="text-sm text-muted mb-4">导出客户、方案、报价等业务数据到文件。</p>
        <Button onClick={() => window.open(systemApi.export(), '_blank')}>
          <Download size={16} className="mr-2" /> 导出业务数据
        </Button>
      </div>
    </div>
  )
}
